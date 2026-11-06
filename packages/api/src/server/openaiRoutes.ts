import express from 'express';
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

// Official current OpenAI image models; deprecated dall-e-2 / dall-e-3 removed per model audit.
export const OPENAI_IMAGE_MODELS: Record<string, { credits: number; providerCostUsd: number; returnFormat: 'b64' }> = {
  'gpt-image-1':      { credits: 8, providerCostUsd: 0.04, returnFormat: 'b64' },
  'gpt-image-1-mini': { credits: 4, providerCostUsd: 0.015, returnFormat: 'b64' },
};

export const DEPRECATED_OPENAI_IMAGE_MODELS = new Set(['dall-e-2', 'dall-e-3']);

const OPENAI_TTS_CREDITS: Record<string, number> = { 'gpt-4o-mini-tts': 3, 'tts-1': 2, 'tts-1-hd': 4 };

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
    if (aspect === '16:9') return '1536x1024';
    if (aspect === '9:16') return '1024x1536';
    return '1024x1024';
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

    const { prompt = '', model = 'gpt-image-1', aspect_ratio = '1:1', quality = 'auto', save = true } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    if (DEPRECATED_OPENAI_IMAGE_MODELS.has(String(model))) {
      return res.status(400).json({ error: `Model "${model}" is deprecated and no longer supported. Use "gpt-image-1" or "gpt-image-1-mini".` });
    }

    const cfg = OPENAI_IMAGE_MODELS[model];
    if (!cfg) {
      return res.status(400).json({ error: `Unsupported OpenAI image model "${model}". Supported models: ${Object.keys(OPENAI_IMAGE_MODELS).join(', ')}` });
    }
    const apiKey = await getOpenAIApiKey();
    if (!apiKey) return res.status(503).json({ error: 'OpenAI API not configured' });

    // Support admin-configurable rate card override in platform_configs('openai') so prices are never hard-coded indefinitely
    let creditCost = cfg.credits;
    let providerCostUsd = cfg.providerCostUsd;
    try {
      const cfgRow = await dbQuery<{ config: Record<string, string> }>('SELECT config FROM platform_configs WHERE platform=$1', ['openai']);
      const dec = decryptPlatformConfig(cfgRow.rows[0]?.config);
      const customCredits = Number(dec?.[`credits_${model}`]);
      const customUsd = Number(dec?.[`cost_usd_${model}`]);
      if (Number.isFinite(customCredits) && customCredits > 0) creditCost = Math.round(customCredits);
      if (Number.isFinite(customUsd) && customUsd >= 0) providerCostUsd = customUsd;
    } catch { /* fallback to default rate card */ }

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

    const creditCost = OPENAI_TTS_CREDITS[model] ?? 3;
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
