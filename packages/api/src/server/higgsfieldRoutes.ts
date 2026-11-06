import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';

type AuthResult = { userId: string; role?: string } | null;

type HiggsfieldCfg = { apiId: string; apiSecret: string; baseUrl: string };

interface HiggsfieldDeps {
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

export function registerHiggsfieldRoutes({ requireAdmin, hasDatabase, dbQuery }: HiggsfieldDeps): Router {
  const router = express.Router();

  async function getHiggsfieldConfig(): Promise<HiggsfieldCfg | null> {
    try {
      const r = await dbQuery<{ config: Record<string, string> }>(
        `SELECT config FROM platform_configs WHERE platform = 'higgsfield' AND enabled = true LIMIT 1`
      );
      const cfg = decryptPlatformConfig((r.rows[0] as any)?.config);
      const apiId = cfg?.apiId ?? '';
      const apiSecret = cfg?.apiSecret ?? '';
      if (!apiId || !apiSecret) return null;
      return { apiId, apiSecret, baseUrl: 'https://platform.higgsfield.ai' };
    } catch (_err) { return null; }
  }

  function higgsfieldHeaders(cfg: HiggsfieldCfg): Record<string, string> {
    return { Authorization: `Key ${cfg.apiId}:${cfg.apiSecret}`, 'Content-Type': 'application/json' };
  }

  function higgsfieldErrMsg(data: any, status: number): string {
    if (!data) return `Higgsfield API error ${status}`;
    if (typeof data === 'string') return data;
    const msg = data.error ?? data.message ?? data.detail ?? data.details ?? null;
    if (msg) return `${msg} (HTTP ${status})`;
    return `HTTP ${status}: ${JSON.stringify(data).slice(0, 300)}`;
  }

  async function pollHiggsfieldRequest(
    cfg: HiggsfieldCfg,
    requestId: string,
    maxWaitMs = 120000,
    onProgress?: (status: string) => void
  ): Promise<string> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      const resp = await axios.get(
        `${cfg.baseUrl}/requests/${requestId}/status`,
        { headers: higgsfieldHeaders(cfg), validateStatus: () => true, timeout: 12000 }
      );
      const d = resp.data ?? {};
      const st: string = d.status ?? '';
      onProgress?.(st);
      if (st === 'completed') {
        const url: string | null = d.images?.[0]?.url ?? d.images?.[0] ?? d.video?.url ?? null;
        if (!url) throw new Error('Generation completed but no media URL returned');
        return url;
      }
      if (st === 'failed' || st === 'nsfw') {
        throw new Error(`Generation ${st}${d.error ? ': ' + d.error : ''}`);
      }
    }
    throw new Error('Generation timed out');
  }

  // GET /api/admin/higgsfield/status
  router.get('/status', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const cfg = await getHiggsfieldConfig();
    if (!cfg) return res.json({ connected: false });
    try {
      const resp = await axios.get(`${cfg.baseUrl}/requests/connection-probe/status`, {
        headers: higgsfieldHeaders(cfg),
        validateStatus: () => true,
        timeout: 8000,
      });
      if (resp.status === 401 || resp.status === 403) {
        return res.json({ connected: false, error: `Invalid API credentials (${resp.status})` });
      }
      return res.json({ connected: true });
    } catch (e: any) {
      return res.json({ connected: false, error: e?.message || 'Connection failed' });
    }
  });

  // POST /api/admin/higgsfield/generate/image
  router.post('/generate/image', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const cfg = await getHiggsfieldConfig();
    if (!cfg) return res.status(400).json({ error: 'Higgsfield credentials not configured' });
    const {
      prompt = '',
      model = 'higgsfield-ai/soul/standard',
      aspect_ratio = '1:1',
      resolution = '720p',
    } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const genId = randomUUID();
    await dbQuery(
      `INSERT INTO higgsfield_generations (id, type, model, prompt, params, status)
       VALUES ($1, 'image', $2, $3, $4, 'pending')`,
      [genId, model, prompt.trim(), JSON.stringify({ aspect_ratio, resolution })]
    ).catch(() => undefined);
    try {
      const submitResp = await axios.post(
        `${cfg.baseUrl}/${model}`,
        { prompt: prompt.trim(), aspect_ratio, resolution },
        { headers: higgsfieldHeaders(cfg), validateStatus: () => true, timeout: 30000 }
      );
      if (submitResp.status >= 400) {
        const errMsg = higgsfieldErrMsg(submitResp.data, submitResp.status);
        await dbQuery(`UPDATE higgsfield_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }
      const requestId: string = submitResp.data?.request_id;
      if (!requestId) {
        const errMsg = 'No request_id returned from Higgsfield';
        await dbQuery(`UPDATE higgsfield_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(500).json({ error: errMsg });
      }
      await dbQuery(`UPDATE higgsfield_generations SET status='processing' WHERE id=$1`, [genId]).catch(() => undefined);
      const resultUrl = await pollHiggsfieldRequest(cfg, requestId);
      await dbQuery(
        `UPDATE higgsfield_generations SET status='completed', result_url=$1 WHERE id=$2`,
        [resultUrl, genId]
      ).catch(() => undefined);
      return res.json({ success: true, id: genId, url: resultUrl });
    } catch (e: any) {
      const errMsg = e?.message || 'Generation failed';
      await dbQuery(`UPDATE higgsfield_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
      return res.status(500).json({ error: errMsg });
    }
  });

  // POST /api/admin/higgsfield/generate/video
  router.post('/generate/video', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const cfg = await getHiggsfieldConfig();
    if (!cfg) return res.status(400).json({ error: 'Higgsfield credentials not configured' });
    const {
      prompt = '',
      model = 'higgsfield-ai/dop/standard',
      image_url,
      aspect_ratio = '16:9',
      resolution = '720p',
    } = req.body as Record<string, any>;
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const genId = randomUUID();
    await dbQuery(
      `INSERT INTO higgsfield_generations (id, type, model, prompt, params, status)
       VALUES ($1, 'video', $2, $3, $4, 'pending')`,
      [genId, model, prompt.trim(), JSON.stringify({ image_url, aspect_ratio, resolution })]
    ).catch(() => undefined);
    try {
      const payload: Record<string, any> = { prompt: prompt.trim(), aspect_ratio, resolution };
      if (image_url) payload.image_url = image_url;
      const submitResp = await axios.post(
        `${cfg.baseUrl}/${model}`,
        payload,
        { headers: higgsfieldHeaders(cfg), validateStatus: () => true, timeout: 30000 }
      );
      if (submitResp.status >= 400) {
        const errMsg = higgsfieldErrMsg(submitResp.data, submitResp.status);
        await dbQuery(`UPDATE higgsfield_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }
      const requestId: string = submitResp.data?.request_id;
      if (!requestId) {
        const errMsg = 'No request_id returned from Higgsfield';
        await dbQuery(`UPDATE higgsfield_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(500).json({ error: errMsg });
      }
      await dbQuery(`UPDATE higgsfield_generations SET status='processing' WHERE id=$1`, [genId]).catch(() => undefined);
      const resultUrl = await pollHiggsfieldRequest(cfg, requestId, 180000);
      await dbQuery(
        `UPDATE higgsfield_generations SET status='completed', result_url=$1 WHERE id=$2`,
        [resultUrl, genId]
      ).catch(() => undefined);
      return res.json({ success: true, id: genId, url: resultUrl, request_id: requestId });
    } catch (e: any) {
      const errMsg = e?.message || 'Generation failed';
      await dbQuery(`UPDATE higgsfield_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
      return res.status(500).json({ error: errMsg });
    }
  });

  // GET /api/admin/higgsfield/generations
  router.get('/generations', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ generations: [] });
    try {
      const { rows } = await dbQuery(
        `SELECT * FROM higgsfield_generations ORDER BY created_at DESC LIMIT 100`
      );
      return res.json({ generations: rows });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to fetch generations' });
    }
  });

  // DELETE /api/admin/higgsfield/generations/:id
  router.delete('/generations/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    await dbQuery(`DELETE FROM higgsfield_generations WHERE id=$1`, [req.params.id]).catch(() => undefined);
    return res.json({ success: true });
  });

  return router;
}
