import express from 'express';
import { chargeAICredits } from '../ai-helpers.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { encryptPlatformConfig, decryptPlatformConfig } from '../integration-helpers.ts';

type AuthResult = { userId: string; role?: string } | null;

interface GoogleDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  pool: Pool;
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const GOOGLE_IMAGE_MODELS: Record<string, { googleId: string; type: 'imagen' | 'gemini'; credits: number }> = {
  'google-imagen-4-fast':   { googleId: 'imagen-4.0-fast-generate-001',    type: 'imagen', credits: 4  },
  'google-imagen-4':        { googleId: 'imagen-4.0-generate-001',         type: 'imagen', credits: 6  },
  'google-imagen-4-ultra':  { googleId: 'imagen-4.0-ultra-generate-001',   type: 'imagen', credits: 10 },
  'google-gemini-flash':    { googleId: 'gemini-2.5-flash-image',          type: 'gemini', credits: 3  },
  'google-gemini-nano-2':   { googleId: 'gemini-3.1-flash-image-preview',  type: 'gemini', credits: 5  },
  'google-gemini-nano-pro': { googleId: 'gemini-3-pro-image-preview',      type: 'gemini', credits: 8  },
};

const GOOGLE_VIDEO_MODELS: Record<string, { googleId: string; credits: number }> = {
  'google-veo-3-fast': { googleId: 'veo-3.1-fast-generate-preview', credits: 25 },
  'google-veo-3':      { googleId: 'veo-3.1-generate-preview',      credits: 40 },
};

export function registerGoogleRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool }: GoogleDeps): Router {
  const router = express.Router();

  async function getGoogleApiKey(): Promise<string | null> {
    // Admin-configured key (AI Assistant → Google AI) wins; env is fallback only
    try {
      const r = await dbQuery<{ config: Record<string, string> }>('SELECT config FROM platform_configs WHERE platform=$1', ['google']);
      const dbKey = decryptPlatformConfig(r.rows[0]?.config)?.api_key;
      if (dbKey) return dbKey;
    } catch (_err) { /* fall through to env */ }
    return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || null;
  }

  async function storeGoogleImage(base64Data: string, mimeType: string): Promise<string> {
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
    } catch (e) { logger.error('[storeGoogleImage] imgbb upload failed:', e); }
    return `data:${mimeType};base64,${base64Data}`;
  }

  async function pollGoogleOperation(
    operationName: string, key: string, maxSeconds = 300,
  ): Promise<{ url?: string; error?: string }> {
    const deadline = Date.now() + maxSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        const resp = await axios.get(`${GOOGLE_BASE}/${operationName}`, {
          headers: { 'x-goog-api-key': key },
          timeout: 15000,
        });
        if (resp.data.done) {
          const videos: any[] = resp.data.response?.generated_videos ?? [];
          if (videos.length > 0) {
            const uri: string = videos[0].video?.uri ?? videos[0].video ?? '';
            if (uri) return { url: uri };
          }
          const errMsg: string = resp.data.error?.message ?? 'Generation failed';
          return { error: errMsg };
        }
      } catch (e: any) { logger.error('[pollGoogleOperation]', e.message); }
    }
    return { error: 'Video generation timed out' };
  }

  // GET /api/admin/google/config
  router.get('/admin/google/config', async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const key = await getGoogleApiKey();
    const hasKey = !!key;
    const masked = key ? `${key.slice(0, 6)}${'•'.repeat(Math.max(0, key.length - 10))}${key.slice(-4)}` : '';
    res.json({ success: true, hasKey, maskedKey: masked });
  });

  // PUT /api/admin/google/config
  router.put('/admin/google/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { apiKey, imgbbKey } = req.body as { apiKey?: string; imgbbKey?: string };
    try {
      const patch: Record<string, string> = {};
      if (apiKey?.trim())    patch.api_key     = apiKey.trim();
      if (imgbbKey?.trim())  patch.imgbb_api_key = imgbbKey.trim();
      if (Object.keys(patch).length > 0) {
        await dbQuery(
          `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2::jsonb, true, NOW())
           ON CONFLICT (platform) DO UPDATE SET config = platform_configs.config || $2::jsonb, enabled=true, updated_at=NOW()`,
          ['google', JSON.stringify(encryptPlatformConfig(patch))]
        );
      }
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'google', fields: Object.keys(patch) });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/google/test
  router.get('/admin/google/test', async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    const key = await getGoogleApiKey();
    if (!key) return res.status(400).json({ success: false, error: 'No Google API key configured' });
    try {
      const resp = await axios.get(`${GOOGLE_BASE}/models`, {
        headers: { 'x-goog-api-key': key },
        params: { pageSize: 5 },
        timeout: 10000,
      });
      const models: string[] = (resp.data?.models ?? []).map((m: any) => m.name).slice(0, 5);
      res.json({ success: true, models });
    } catch (e: any) {
      const msg: string = e.response?.data?.error?.message ?? e.message;
      res.json({ success: false, error: msg });
    }
  });

  // GET /api/admin/google/generations
  router.get('/admin/google/generations', async (req: Request, res: Response) => {
    if (!await requireAdmin(req, res)) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool.query(
        `SELECT g.id, u.email AS user_email, g.type, g.model, g.prompt,
                g.status, g.result_url, g.error, g.credits_used, g.created_at
         FROM google_generations g
         LEFT JOIN users u ON u.id = g.user_id
         ORDER BY g.created_at DESC LIMIT 100`
      );
      res.json({ success: true, generations: rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/google/generate-image
  router.post('/google/generate-image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { prompt = '', model = 'google-imagen-4-fast', aspect_ratio = '1:1', save = true } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });

    const cfg = GOOGLE_IMAGE_MODELS[model];
    if (!cfg) return res.status(400).json({ error: 'Unknown Google image model' });

    const apiKey = await getGoogleApiKey();
    if (!apiKey) return res.status(503).json({ error: 'Google API not configured' });

    const creditCost = cfg.credits;
    const credRow = await pool.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id=$1', [auth.userId])
      .catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (credRow.rows.length > 0 && currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const genId = randomUUID();
    await pool.query(
      `INSERT INTO google_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,'image',$3,$4,$5,'pending',$6)`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ aspect_ratio }), creditCost]
    ).catch(() => undefined);

    try {
      let imageUrl: string | null = null;

      if (cfg.type === 'imagen') {
        const resp = await axios.post(
          `${GOOGLE_BASE}/models/${cfg.googleId}:predict`,
          {
            instances: [{ prompt: prompt.trim() }],
            parameters: { sampleCount: 1, aspectRatio: aspect_ratio, imageSize: '1K' },
          },
          { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 }
        );
        const b64: string = resp.data?.predictions?.[0]?.bytesBase64Encoded ?? '';
        const mime: string = resp.data?.predictions?.[0]?.mimeType ?? 'image/png';
        if (!b64) throw new Error('No image data returned from Imagen');
        imageUrl = await storeGoogleImage(b64, mime);

      } else {
        const resp = await axios.post(
          `${GOOGLE_BASE}/models/${cfg.googleId}:generateContent`,
          {
            contents: [{ parts: [{ text: prompt.trim() }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
          },
          { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 }
        );
        const parts: any[] = resp.data?.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
        if (!imgPart) throw new Error('No image returned from Gemini');
        imageUrl = await storeGoogleImage(imgPart.inlineData.data, imgPart.inlineData.mimeType);
      }

      await pool.query(`UPDATE google_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [imageUrl, genId]).catch(() => undefined);
      await chargeAICredits(auth.userId, creditCost, 'image_generate_google', { gen_id: genId });

      let designId: string | null = null;
      if (save && imageUrl) {
        designId = randomUUID();
        const dName = `Google AI — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await pool.query(
          `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at)
           VALUES ($1,$2,$3,1080,1080,$4,$5,NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: prompt.trim(), model }), imageUrl]
        ).catch(() => undefined);
      }

      return res.json({ success: true, url: imageUrl, design_id: designId, gen_id: genId });
    } catch (e: any) {
      const msg: string = e.response?.data?.error?.message ?? e.message;
      logger.error('[google/generate-image]', msg);
      await pool.query(`UPDATE google_generations SET status='failed', error=$1 WHERE id=$2`, [msg, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Image generation is temporarily unavailable. Please try again later.' });
    }
  });

  // POST /api/google/generate-video
  router.post('/google/generate-video', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const {
      prompt = '', model = 'google-veo-3-fast',
      aspect_ratio = '16:9', duration = 5, resolution = '720p',
      image_url = '',
    } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });

    const cfg = GOOGLE_VIDEO_MODELS[model];
    if (!cfg) return res.status(400).json({ error: 'Unknown Google video model' });

    const apiKey = await getGoogleApiKey();
    if (!apiKey) return res.status(503).json({ error: 'Google API not configured' });

    const creditCost = cfg.credits;
    const credRow = await pool.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id=$1', [auth.userId])
      .catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (credRow.rows.length > 0 && currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const genId = randomUUID();
    await pool.query(
      `INSERT INTO google_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,'video',$3,$4,$5,'pending',$6)`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ aspect_ratio, duration, resolution, has_image: !!image_url }), creditCost]
    ).catch(() => undefined);

    try {
      const instance: Record<string, any> = { prompt: prompt.trim() };
      if (image_url.trim()) instance.image = { bytesBase64Encoded: image_url.replace(/^data:[^;]+;base64,/, '') };

      const submitResp = await axios.post(
        `${GOOGLE_BASE}/models/${cfg.googleId}:predictLongRunning`,
        {
          instances: [instance],
          parameters: {
            aspectRatio: aspect_ratio,
            durationSeconds: String(duration),
            resolution,
            personGeneration: 'allow_adult',
          },
        },
        { headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 30000 }
      );

      const operationName: string = submitResp.data?.name ?? '';
      if (!operationName) throw new Error('No operation name returned from Google');

      await pool.query(`UPDATE google_generations SET operation_name=$1, status='processing' WHERE id=$2`, [operationName, genId]).catch(() => undefined);
      await chargeAICredits(auth.userId, creditCost, 'image_generate_google', { gen_id: genId });

      const result = await pollGoogleOperation(operationName, apiKey, 300);
      if (result.error) throw new Error(result.error);

      await pool.query(`UPDATE google_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [result.url, genId]).catch(() => undefined);

      const designId = randomUUID();
      const dName = `Google Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      await pool.query(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at)
         VALUES ($1,$2,$3,1920,1080,$4,$5,'video',NOW())`,
        [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl: result.url, prompt: prompt.trim(), model }), result.url]
      ).catch(() => undefined);

      return res.json({ success: true, url: result.url, design_id: designId, gen_id: genId });
    } catch (e: any) {
      const msg: string = e.response?.data?.error?.message ?? e.message;
      logger.error('[google/generate-video]', msg);
      await pool.query(`UPDATE google_generations SET status='failed', error=$1 WHERE id=$2`, [msg, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Video generation is temporarily unavailable. Please try again later.' });
    }
  });

  return router;
}
