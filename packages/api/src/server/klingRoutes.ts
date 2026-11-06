import express from 'express';
import { chargeAICredits } from '../ai-helpers.ts';
import { generationLimiter } from '../middleware/rateLimiter.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import axios from 'axios';
import { randomUUID, createHmac } from 'crypto';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { encryptPlatformConfig, decryptPlatformConfig } from '../integration-helpers.ts';

type AuthResult = { userId: string; role?: string } | null;

interface KlingDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool;
}

const KLING_BASE = 'https://api.klingai.com';

const KLING_VIDEO_MODELS: Record<string, { label: string; credits: number; duration: number[] }> = {
  'kling-v2.6-pro':      { label: 'Kling v2.6 Pro',      credits: 35, duration: [5, 10] },
  'kling-v2.5-turbo':    { label: 'Kling v2.5 Turbo',    credits: 20, duration: [5, 10] },
  'kling-v1.6-pro':      { label: 'Kling v1.6 Pro',      credits: 25, duration: [5, 10] },
  'kling-v1.6-standard': { label: 'Kling v1.6 Standard', credits: 15, duration: [5, 10] },
};

const KLING_IMAGE_MODELS: Record<string, { label: string; credits: number }> = {
  'kling-v1-5': { label: 'Kling v1.5', credits: 5 },
  'kling-v1':   { label: 'Kling v1',   credits: 4 },
};

export function registerKlingRoutes({ requireAuth, requireAdmin, hasDatabase, pool }: KlingDeps): Router {
  const router = express.Router();

  function generateKlingJWT(ak: string, sk: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })).toString('base64url');
    const sig     = createHmac('sha256', sk).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  }

  async function getKlingKeys(): Promise<{ ak: string; sk: string } | null> {
    // Admin-configured keys (AI Assistant → Kling AI) win; env is fallback only
    try {
      const r = await pool.query(`SELECT config FROM platform_configs WHERE platform='kling' LIMIT 1`);
      const cfg = decryptPlatformConfig(r.rows[0]?.config);
      if (cfg?.accessKey && cfg?.secretKey) return { ak: cfg.accessKey, sk: cfg.secretKey };
    } catch (_err) { /* ignore */ }
    const envAk = process.env.KLING_ACCESS_KEY?.trim();
    const envSk = process.env.KLING_SECRET_KEY?.trim();
    if (envAk && envSk) return { ak: envAk, sk: envSk };
    return null;
  }

  async function klingRequest(method: 'GET' | 'POST', path: string, body?: object): Promise<any> {
    const keys = await getKlingKeys();
    if (!keys) throw new Error('Kling API not configured');
    const token = generateKlingJWT(keys.ak, keys.sk);
    const resp = await axios({
      method,
      url: `${KLING_BASE}${path}`,
      data: body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 20000,
    });
    return resp;
  }

  async function pollKlingTask(taskId: string, pollPath: string, maxSeconds = 300): Promise<{ url: string | null; error: string | null }> {
    const deadline = Date.now() + maxSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const r = await klingRequest('GET', pollPath);
      const data = r.data?.data ?? r.data;
      const status: string = data?.task_status ?? data?.status ?? '';
      if (status === 'succeed' || status === 'Completed' || status === 'completed') {
        const result = data?.task_result;
        const url: string = result?.videos?.[0]?.url ?? result?.images?.[0]?.url ?? data?.output ?? null;
        return { url, error: url ? null : 'Generation completed but no output URL found' };
      }
      if (status === 'failed' || status === 'Failed') {
        return { url: null, error: data?.task_status_msg ?? data?.error ?? 'Kling generation failed' };
      }
    }
    return { url: null, error: 'Timeout: Kling generation took too long' };
  }

  // GET /api/admin/kling/config
  router.get('/admin/kling/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      // Mirror getKlingKeys resolution: DB config first, env fallback
      const r = await pool.query(`SELECT config FROM platform_configs WHERE platform='kling' LIMIT 1`);
      const cfg = decryptPlatformConfig(r.rows[0]?.config);
      const ak: string = cfg.accessKey ?? ''; const sk: string = cfg.secretKey ?? '';
      if (ak && sk) {
        return res.json({ success: true, hasKey: true, source: 'db',
          maskedAk: ak.length > 4 ? `${'*'.repeat(ak.length - 4)}${ak.slice(-4)}` : '****',
          maskedSk: sk.length > 4 ? `${'*'.repeat(sk.length - 4)}${sk.slice(-4)}` : '****' });
      }
      const envAk = process.env.KLING_ACCESS_KEY?.trim();
      const envSk = process.env.KLING_SECRET_KEY?.trim();
      if (envAk && envSk) {
        return res.json({ success: true, hasKey: true, source: 'env',
          maskedAk: `${'*'.repeat(Math.max(0, envAk.length - 4))}${envAk.slice(-4)}`,
          maskedSk: `${'*'.repeat(Math.max(0, envSk.length - 4))}${envSk.slice(-4)}` });
      }
      return res.json({ success: true, hasKey: false, source: 'db', maskedAk: '', maskedSk: '' });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // PUT /api/admin/kling/config
  router.put('/admin/kling/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { accessKey, secretKey } = req.body as { accessKey?: string; secretKey?: string };
    if (!accessKey?.trim() || !secretKey?.trim()) return res.status(400).json({ error: 'accessKey and secretKey are required' });
    try {
      await pool.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ('kling', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify(encryptPlatformConfig({ accessKey: accessKey.trim(), secretKey: secretKey.trim() }))]
      );
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'kling' });
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/kling/test
  router.get('/admin/kling/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const now = Date.now();
      const start = now - 30 * 24 * 60 * 60 * 1000;
      const keys = await getKlingKeys();
      if (!keys) return res.json({ success: false, error: 'No Kling keys configured' });
      const token = generateKlingJWT(keys.ak, keys.sk);
      const r = await axios.get(`${KLING_BASE}/account/costs`, {
        params: { start_time: start, end_time: now },
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (r.status === 401 || r.status === 403) return res.json({ success: false, error: `Invalid keys (HTTP ${r.status})` });
      if (r.status >= 400) return res.json({ success: false, error: `Kling returned HTTP ${r.status}`, detail: r.data });
      return res.json({ success: true, account: r.data?.data ?? r.data });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // GET /api/admin/kling/generations
  router.get('/admin/kling/generations', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool.query(
        `SELECT kg.*, u.email AS user_email, u.full_name AS user_full_name
         FROM kling_generations kg LEFT JOIN users u ON u.id = kg.user_id
         ORDER BY kg.created_at DESC LIMIT 200`
      );
      return res.json({ success: true, generations: rows });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  // POST /api/kling/generate-video
  router.post('/kling/generate-video', generationLimiter, async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const {
      prompt = '', model = 'kling-v2.5-turbo', aspect_ratio = '16:9', duration = 5,
      image_url = '', tail_image_url = '',
    } = req.body as { prompt?: string; model?: string; aspect_ratio?: string; duration?: number; image_url?: string; tail_image_url?: string };
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const useImageToVideo = !!image_url.trim();
    const modelCfg = KLING_VIDEO_MODELS[model] ?? KLING_VIDEO_MODELS['kling-v2.5-turbo'];
    const creditCost = modelCfg.credits;
    const credRow = await pool.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id=$1', [auth.userId])
      .catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (credRow.rows.length > 0 && currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }
    const genId = randomUUID();
    const genType = useImageToVideo ? 'image-to-video' : 'video';
    await pool.query(
      `INSERT INTO kling_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
      [genId, auth.userId, genType, model, prompt.trim(), JSON.stringify({ aspect_ratio, duration, has_first_frame: useImageToVideo, has_last_frame: !!tail_image_url }), creditCost]
    ).catch(() => undefined);
    try {
      const keys = await getKlingKeys();
      if (!keys) {
        const fallbackVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
        await pool.query(`UPDATE kling_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [fallbackVideoUrl, genId]).catch(() => undefined);
        const designId = randomUUID();
        const dName = `AI Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await pool.query(
          `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at)
           VALUES ($1,$2,$3,1920,1080,$4,$5,'video',NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl: fallbackVideoUrl, prompt: prompt.trim(), model }), fallbackVideoUrl]
        ).catch(() => undefined);
        return res.json({ success: true, url: fallbackVideoUrl, design_id: designId, gen_id: genId, fallback: true });
      }

      let submitResp: any;
      let pollPath: string;
      if (useImageToVideo) {
        const body: Record<string, any> = {
          model, image_url: image_url.trim(), prompt: prompt.trim(),
          negative_prompt: '', duration, aspect_ratio, cfg_scale: 0.5,
        };
        if (tail_image_url.trim()) body.tail_image_url = tail_image_url.trim();
        submitResp = await klingRequest('POST', '/v1/videos/image2video', body);
        pollPath = 'image2video';
      } else {
        submitResp = await klingRequest('POST', '/v1/videos/text2video', {
          model, prompt: prompt.trim(), negative_prompt: '', duration, aspect_ratio, cfg_scale: 0.5,
        });
        pollPath = 'text2video';
      }
      if (submitResp.status >= 400) {
        const errMsg = submitResp.data?.message ?? `Kling API error ${submitResp.status}`;
        await pool.query(`UPDATE kling_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }
      const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id;
      if (!taskId) throw new Error('No task_id returned from Kling');
      await pool.query(`UPDATE kling_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
      const result = await pollKlingTask(taskId, `/v1/videos/${pollPath}/${taskId}`, 300);
      if (result.error || !result.url) throw new Error(result.error || 'No video URL returned from Kling');
      // Charge credits ONLY after verified completion (credit refund safety)
      await chargeAICredits(auth.userId, creditCost, 'video_generate_kling', { gen_id: genId });
      await pool.query(`UPDATE kling_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [result.url, genId]).catch(() => undefined);
      const designId = randomUUID();
      const dName = `AI Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      await pool.query(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at)
         VALUES ($1,$2,$3,1920,1080,$4,$5,'video',NOW())`,
        [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl: result.url, prompt: prompt.trim(), model }), result.url]
      ).catch(() => undefined);
      return res.json({ success: true, url: result.url, design_id: designId, gen_id: genId });
    } catch (e: any) {
      await pool.query(`UPDATE kling_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Video generation is temporarily unavailable. No credits were charged.' });
    }
  });

  // POST /api/kling/image-to-video
  router.post('/kling/image-to-video', generationLimiter, async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', image_url = '', model = 'kling-v2.5-turbo', aspect_ratio = '16:9', duration = 5 } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    if (!image_url.trim()) return res.status(400).json({ error: 'image_url is required' });
    const modelCfg = KLING_VIDEO_MODELS[model] ?? KLING_VIDEO_MODELS['kling-v2.5-turbo'];
    const creditCost = modelCfg.credits;
    const credRow = await pool.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id=$1', [auth.userId])
      .catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (credRow.rows.length > 0 && currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }
    const genId = randomUUID();
    await pool.query(
      `INSERT INTO kling_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,'i2v',$3,$4,$5,'pending',$6)`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ aspect_ratio, duration, image_url }), creditCost]
    ).catch(() => undefined);
    try {
      const submitResp = await klingRequest('POST', '/v1/videos/image2video', {
        model, image_url, prompt: prompt.trim(), negative_prompt: '', duration, aspect_ratio, cfg_scale: 0.5,
      });
      if (submitResp.status >= 400) {
        const errMsg = submitResp.data?.message ?? `Kling API error ${submitResp.status}`;
        await pool.query(`UPDATE kling_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }
      const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id;
      if (!taskId) throw new Error('No task_id returned from Kling');
      await pool.query(`UPDATE kling_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
      const result = await pollKlingTask(taskId, `/v1/videos/image2video/${taskId}`, 300);
      if (result.error || !result.url) throw new Error(result.error || 'No video URL returned from Kling');
      await chargeAICredits(auth.userId, creditCost, 'video_generate_kling', { gen_id: genId });
      await pool.query(`UPDATE kling_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [result.url, genId]).catch(() => undefined);
      const designId = randomUUID();
      const dName = `AI Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      await pool.query(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at)
         VALUES ($1,$2,$3,1920,1080,$4,$5,'video',NOW())`,
        [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl: result.url, prompt: prompt.trim(), model }), result.url]
      ).catch(() => undefined);
      return res.json({ success: true, url: result.url, design_id: designId, gen_id: genId });
    } catch (e: any) {
      await pool.query(`UPDATE kling_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Video generation is temporarily unavailable. No credits were charged.' });
    }
  });

  // POST /api/kling/generate-image
  router.post('/kling/generate-image', generationLimiter, async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', model = 'kling-v1-5', aspect_ratio = '1:1' } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const modelCfg = KLING_IMAGE_MODELS[model] ?? KLING_IMAGE_MODELS['kling-v1-5'];
    const creditCost = modelCfg.credits;
    const credRow = await pool.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id=$1', [auth.userId])
      .catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (credRow.rows.length > 0 && currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }
    const genId = randomUUID();
    await pool.query(
      `INSERT INTO kling_generations (id, user_id, type, model, prompt, params, status, credits_used)
       VALUES ($1,$2,'image',$3,$4,$5,'pending',$6)`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ aspect_ratio }), creditCost]
    ).catch(() => undefined);
    try {
      const submitResp = await klingRequest('POST', '/v1/images/generations', {
        model, prompt: prompt.trim(), negative_prompt: '', aspect_ratio, cfg_scale: 0.5, image_count: 1,
      });
      if (submitResp.status >= 400) {
        const errMsg = submitResp.data?.message ?? `Kling API error ${submitResp.status}`;
        await pool.query(`UPDATE kling_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }
      const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id;
      if (!taskId) throw new Error('No task_id returned from Kling');
      await pool.query(`UPDATE kling_generations SET task_id=$1, status='processing' WHERE id=$2`, [taskId, genId]).catch(() => undefined);
      const result = await pollKlingTask(taskId, `/v1/images/generations/${taskId}`, 120);
      if (result.error || !result.url) throw new Error(result.error || 'No image URL returned from Kling');
      await chargeAICredits(auth.userId, creditCost, 'video_generate_kling', { gen_id: genId });
      await pool.query(`UPDATE kling_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [result.url, genId]).catch(() => undefined);
      return res.json({ success: true, url: result.url, gen_id: genId });
    } catch (e: any) {
      await pool.query(`UPDATE kling_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: 'Image generation is temporarily unavailable. No credits were charged.' });
    }
  });

  // GET /api/kling/task/:id
  router.get('/kling/task/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool.query(
        `SELECT status, result_url, error, type, model, created_at FROM kling_generations WHERE id=$1 AND user_id=$2 LIMIT 1`,
        [req.params.id, auth.userId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      return res.json({ success: true, ...rows[0] });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  return router;
}
