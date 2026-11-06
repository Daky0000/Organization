import express from 'express';
import { OPENAI_TTS_USD_PER_1K_CHARS, creditsForUsd } from './aiPricing.ts';
import { chargeAICredits, ensureCreditAccount } from '../ai-helpers.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { encryptPlatformConfig, decryptPlatformConfig } from '../integration-helpers.ts';

type AuthResult = { userId: string; role?: string } | null;

interface OpenAIDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  pool: Pool;
}

const OPENAI_BASE = 'https://api.openai.com/v1';

// Checked against developers.openai.com/api/docs/models and /deprecations on
// 2026-10-29. providerCostUsd is an upper estimate (image output is priced per
// token); keep it, the credits and the autopilot registry in step — the
// registry-consistency test fails when they drift.
export const OPENAI_IMAGE_MODELS: Record<string, { credits: number; providerCostUsd: number; returnFormat: 'b64' }> = {
  'gpt-image-2.5-flare':    { credits: 8,  providerCostUsd: 0.129, returnFormat: 'b64' },
  'gpt-image-2.5-sunburst': { credits: 12, providerCostUsd: 0.129, returnFormat: 'b64' },
};

// `.credits` follows the provider cost × 1.54 (server/aiPricing.ts).
for (const m of Object.values(OPENAI_IMAGE_MODELS)) {
  Object.defineProperty(m, 'credits', { get: () => creditsForUsd(m.providerCostUsd), enumerable: true, configurable: true });
}

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';

// Shut down (dall-e-2, dall-e-3: 2026-05-12; gpt-image-1: 2026-10-23) or
// announced for shutdown (gpt-image-1-mini, gpt-image-1.5, chatgpt-image-latest: 2026-12-01).
export const DEPRECATED_OPENAI_IMAGE_MODELS = new Set([
  'dall-e-2', 'dall-e-3', 'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1.5-2025-12-16', 'chatgpt-image-latest',
]);

/** WIDTHxHEIGHT for gpt-image-2.5: both sides divisible by 16, ratio between 1:3 and 3:1. */
export function openaiImageSizeForAspect(aspect: string): string {
  switch (aspect) {
    case '16:9': return '1792x1008';
    case '9:16': return '1008x1792';
    case '4:5': return '1024x1280';
    case '3:4': return '1152x1536';
    case '4:3': return '1536x1152';
    default: return '1024x1024';
  }
}

/** Minimum charge per speech request; the real charge follows the text length (OPENAI_TTS_USD_PER_1K_CHARS). */
const OPENAI_TTS_CREDITS: Record<string, number> = { 'gpt-4o-mini-tts': 1, 'tts-1': 1, 'tts-1-hd': 1 };

export function registerOpenAIRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool }: OpenAIDeps): Router {
  const router = express.Router();

  async function getOpenAIApiKey(): Promise<string | null> {
    // Admin-configured key (AI Assistant → OpenAI) wins; env is fallback only
    try {
      const r = await dbQuery<{ config: Record<string, string> }>('SELECT config FROM platform_configs WHERE platform=$1', ['openai']);
      const dbKey = decryptPlatformConfig(r.rows[0]?.config)?.api_key;
      if (dbKey) return dbKey;
    } catch (_err) { /* fall through to env */ }
    return process.env.OPENAI_API_KEY || null;
  }

  function openaiImageSize(_model: string, aspect: string): string {
    return openaiImageSizeForAspect(aspect);
  }

  async function storeImageViaImgbb(base64Data: string, mimeType: string): Promise<string> {
    try {
      const r = await dbQuery<{ config: Record<string, string> }>('SELECT config FROM platform_configs WHERE platform=$1', ['google']);
      const imgbbKey: string | null = decryptPlatformConfig(r.rows[0]?.config)?.imgbb_api_key || process.env.IMGBB_API_KEY || null;
      if (imgbbKey) {
        const params = new URLSearchParams({ key: imgbbKey, image: base64Data });
        const resp = await axios.post('https://api.imgbb.com/1/upload', params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20000,
        });
        const url: string = resp.data?.data?.display_url ?? resp.data?.data?.url ?? '';
        if (url) return url;
      }
    } catch (e) { logger.error('[storeImageViaImgbb] imgbb upload failed:', e); }
    return `data:${mimeType};base64,${base64Data}`;
  }

  // GET /api/admin/openai/config
  router.get('/admin/openai/config', async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const key = await getOpenAIApiKey();
    const hasKey = !!key;
    const masked = key ? `sk-...${key.slice(-6)}` : '';
    res.json({ success: true, hasKey, maskedKey: masked });
  });

  // PUT /api/admin/openai/config
  router.put('/admin/openai/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await dbQuery(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2::jsonb, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config = platform_configs.config || $2::jsonb, enabled=true, updated_at=NOW()`,
        ['openai', JSON.stringify(encryptPlatformConfig({ api_key: apiKey.trim() }))]
      );
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'openai' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/openai/test
  router.get('/admin/openai/test', async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const key = await getOpenAIApiKey();
    if (!key) return res.status(400).json({ success: false, error: 'No OpenAI API key configured' });
    try {
      const resp = await axios.get(`${OPENAI_BASE}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 10000,
      });
      const models: string[] = (resp.data?.data ?? [])
        .map((m: any) => m.id as string)
        .filter((id: string) => id.includes('gpt') || id.includes('tts') || id.includes('whisper'))
        .slice(0, 8);
      res.json({ success: true, models });
    } catch (e: any) {
      const msg: string = e.response?.data?.error?.message ?? e.message;
      res.json({ success: false, error: msg });
    }
  });

  // GET /api/admin/openai/generations
  router.get('/admin/openai/generations', async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool.query(
        `SELECT g.id, u.email AS user_email, g.type, g.model, g.prompt,
                g.status, g.result_url, g.error, g.credits_used, g.created_at
         FROM openai_generations g
         LEFT JOIN users u ON u.id = g.user_id
         ORDER BY g.created_at DESC LIMIT 100`
      );
      res.json({ success: true, generations: rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/openai/generate-image
  router.post('/openai/generate-image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { prompt = '', model = DEFAULT_OPENAI_IMAGE_MODEL, aspect_ratio = '1:1', quality = 'auto', save = true } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    if (DEPRECATED_OPENAI_IMAGE_MODELS.has(String(model))) {
      return res.status(400).json({ code: 'MODEL_UNAVAILABLE', error: `Model "${model}" is retired or scheduled for shutdown by OpenAI. Use ${Object.keys(OPENAI_IMAGE_MODELS).map((m) => `"${m}"`).join(' or ')}.` });
    }

    const cfg = OPENAI_IMAGE_MODELS[model];
    if (!cfg) {
      return res.status(400).json({ error: `Unsupported OpenAI image model "${model}". Supported models: ${Object.keys(OPENAI_IMAGE_MODELS).join(', ')}` });
    }
    const apiKey = await getOpenAIApiKey();
    if (!apiKey) return res.status(503).json({ error: 'OpenAI API not configured' });

    // Support admin-configurable rate card override in platform_configs('openai') so prices are never hard-coded indefinitely
    let providerCostUsd = cfg.providerCostUsd;
    let adminCredits = 0;
    try {
      const cfgRow = await dbQuery<{ config: Record<string, string> }>('SELECT config FROM platform_configs WHERE platform=$1', ['openai']);
      const dec = decryptPlatformConfig(cfgRow.rows[0]?.config);
      const customCredits = Number(dec?.[`credits_${model}`]);
      const customUsd = Number(dec?.[`cost_usd_${model}`]);
      if (Number.isFinite(customCredits) && customCredits > 0) adminCredits = Math.round(customCredits);
      if (Number.isFinite(customUsd) && customUsd >= 0) providerCostUsd = customUsd;
    } catch { /* fallback to default rate card */ }
    // Never below cost × 1.54: an admin price can raise it, not undercut it.
    const creditCost = Math.max(creditsForUsd(providerCostUsd), adminCredits);

    const creditAcc = await ensureCreditAccount(auth.userId).catch(() => ({ credits: 0 }));
    const currentCredits = typeof creditAcc === 'number' ? creditAcc : creditAcc.credits;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const genId = randomUUID();
    await pool.query(
      `INSERT INTO openai_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,'image',$3,$4,$5,'pending',$6)`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ aspect_ratio, quality, estimated_provider_cost_usd: providerCostUsd }), creditCost]
    ).catch(() => undefined);

    try {
      const size = openaiImageSize(model, aspect_ratio);
      const validQuality = ['low', 'medium', 'high', 'auto'].includes(String(quality)) ? String(quality) : 'auto';
      const body: Record<string, any> = {
        model,
        prompt: prompt.trim(),
        n: 1,
        size,
        quality: validQuality,
      };

      const resp = await axios.post(`${OPENAI_BASE}/images/generations`, body, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 90000,
      });

      const item = resp.data?.data?.[0];
      if (!item?.b64_json && !item?.url) throw new Error('No image data returned');

      const imageUrl = item.b64_json
        ? await storeImageViaImgbb(item.b64_json, 'image/png')
        : String(item.url);

      await pool.query(`UPDATE openai_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [imageUrl, genId]).catch(() => undefined);
      await chargeAICredits(auth.userId, creditCost, 'image_generate_openai', { gen_id: genId, model, provider_cost_usd: providerCostUsd });

      let designId: string | null = null;
      if (save && imageUrl) {
        designId = randomUUID();
        const dName = `OpenAI — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await pool.query(
          `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at)
           VALUES ($1,$2,$3,1024,1024,$4,$5,NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: prompt.trim(), model, revisedPrompt: item.revised_prompt ?? null }), imageUrl]
        ).catch(() => undefined);
      }

      return res.json({ success: true, url: imageUrl, design_id: designId, gen_id: genId, model, credits_charged: creditCost, estimated_provider_cost_usd: providerCostUsd, revised_prompt: item.revised_prompt ?? null });
    } catch (e: any) {
      const msg: string = e.response?.data?.error?.message ?? e.message;
      logger.error('[openai/generate-image]', msg);
      await pool.query(`UPDATE openai_generations SET status='failed', error=$1 WHERE id=$2`, [msg, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Image generation is temporarily unavailable. Please try again later.' });
    }
  });

  // POST /api/openai/tts
  router.post('/openai/tts', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { text = '', model = 'gpt-4o-mini-tts', voice = 'nova', speed = 1.0 } = req.body as Record<string, any>;
    if (!text.trim()) return res.status(400).json({ error: 'Text is required' });
    if (text.trim().length > 4096) return res.status(400).json({ error: 'Text must be 4096 characters or less' });

    const apiKey = await getOpenAIApiKey();
    if (!apiKey) return res.status(503).json({ error: 'OpenAI API not configured' });

    // Billed per character: cost × 1.54 (server/aiPricing.ts).
    const creditCost = Math.max(OPENAI_TTS_CREDITS[model] ?? 1, creditsForUsd((text.trim().length / 1000) * (OPENAI_TTS_USD_PER_1K_CHARS[model] ?? 0.03)));
    const creditAcc = await ensureCreditAccount(auth.userId).catch(() => ({ credits: 0 }));
    const currentCredits = typeof creditAcc === 'number' ? creditAcc : creditAcc.credits;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const genId = randomUUID();
    await pool.query(
      `INSERT INTO openai_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,'tts',$3,$4,$5,'pending',$6)`,
      [genId, auth.userId, model, text.trim().slice(0, 200), JSON.stringify({ voice, speed }), creditCost]
    ).catch(() => undefined);

    try {
      const resp = await axios.post(
        `${OPENAI_BASE}/audio/speech`,
        { model, input: text.trim(), voice, speed, response_format: 'mp3' },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 60000,
        }
      );

      const audioBase64 = Buffer.from(resp.data).toString('base64');
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

      await pool.query(`UPDATE openai_generations SET status='completed', result_url='[audio]', completed_at=NOW() WHERE id=$1`, [genId]).catch(() => undefined);
      await chargeAICredits(auth.userId, creditCost, 'tts_openai', { gen_id: genId, model });

      return res.json({ success: true, audio_url: audioUrl, gen_id: genId, model, credits_charged: creditCost });
    } catch (e: any) {
      const msg: string = e.response
        ? JSON.parse(Buffer.from(e.response.data).toString())?.error?.message ?? `HTTP ${e.response.status}`
        : e.message;
      logger.error('[openai/tts]', msg);
      await pool.query(`UPDATE openai_generations SET status='failed', error=$1 WHERE id=$2`, [msg, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Text-to-speech is temporarily unavailable. Please try again later.' });
    }
  });

  return router;
}
