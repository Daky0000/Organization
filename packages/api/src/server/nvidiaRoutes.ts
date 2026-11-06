import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { encryptPlatformConfig, decryptPlatformConfig } from '../integration-helpers.ts';
import {
  DEFAULT_LADDERS, FREE_MODELS, IMAGE_MODELS, LADDER_MAX,
  discoverModels, getNvidiaConfig, invalidateNvidiaConfig, liveLadder, nvidiaImage, refreshNvidiaModels, type NvidiaConfig,
} from './nvidiaModels.ts';

// Admin → NVIDIA: the key, the on/off switch for the free tier, and which free
// models serve each job, in order. Mirrors Dakyworld OS Settings → AI models.

interface Deps {
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  pool: Pool | null;
}

const mask = (v: string) => (v.length > 8 ? `${'*'.repeat(v.length - 4)}${v.slice(-4)}` : (v ? '****' : ''));

function cleanLadder(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  const list = (Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean);
  return [...new Set(list)].slice(0, LADDER_MAX).join(',');
}

export function registerNvidiaRoutes({ requireAdmin, hasDatabase, pool }: Deps): Router {
  const router = express.Router();

  const view = (cfg: NvidiaConfig) => ({
    success: true,
    hasKey: Boolean(cfg.apiKey),
    // With source 'os' the "key" is the partner key, not an NVIDIA one; don't show it.
    maskedKey: cfg.source === 'os' ? 'Dakyworld OS' : mask(cfg.apiKey),
    keySource: cfg.source,
    enabled: cfg.enabled,
    ladders: cfg.ladders,
    defaults: DEFAULT_LADDERS,
    catalogue: { chat: FREE_MODELS, image: IMAGE_MODELS.map(({ functionId: _f, ...m }) => m) },
  });

  router.get('/admin/nvidia/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    return res.json(view(await getNvidiaConfig(true)));
  });

  // Each field is optional and replaces only itself; an empty ladder restores the default.
  router.put('/admin/nvidia/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const existing = await pool!.query(`SELECT config FROM platform_configs WHERE platform='nvidia' LIMIT 1`);
      const next: Record<string, string> = { ...(decryptPlatformConfig(existing.rows[0]?.config) ?? {}) };
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) next.apiKey = b.apiKey.trim();
      if (typeof b.enabled === 'boolean') next.enabled = String(b.enabled);
      const text = cleanLadder(b.textModels); if (text !== undefined) next.textModels = text;
      const fast = cleanLadder(b.fastModels); if (fast !== undefined) next.fastModels = fast;
      const agent = cleanLadder(b.agentModels); if (agent !== undefined) next.agentModels = agent;
      const image = cleanLadder(b.imageModels); if (image !== undefined) next.imageModels = image;
      if (image) {
        const unknown = image.split(',').filter((id) => !IMAGE_MODELS.some((m) => m.id === id));
        if (unknown.length) return res.status(400).json({ success: false, error: `Unknown image model: ${unknown.join(', ')}. Image models are reached by a function id, so only listed ones work.` });
      }
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ('nvidia', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, updated_at=NOW()`,
        [JSON.stringify(encryptPlatformConfig(next))],
      );
      invalidateNvidiaConfig();
      void refreshNvidiaModels(); // a new key may reach different models
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'nvidia', fields: Object.keys(b) });
      return res.json(view(await getNvidiaConfig(true)));
    } catch (e: any) {
      logger.error({ err: e }, 'nvidia_config_save_failed');
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // Probes every candidate free model (and the saved ladders) once, then
  // rebuilds the ladders from the ones that answered — so a model NVIDIA has
  // retired drops out here, and in every call, without a deploy.
  router.post('/admin/nvidia/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const cfg = await getNvidiaConfig(true);
    if (!cfg.apiKey) return res.status(400).json({ success: false, error: 'No NVIDIA key is set.' });
    try {
      const found = await discoverModels({ config: cfg });
      const results = found.results.map(({ tools: _t, toolError: _e, ...r }) => r);
      const toolResults = found.results.filter((r) => r.ok && r.tools !== undefined)
        .map((r) => (r.tools ? { model: r.model, ok: true, ms: r.ms, reply: 'called a tool' } : { model: r.model, ok: false, ms: r.ms, error: r.toolError }));
      return res.json({
        success: results.some((r) => r.ok), results, toolResults,
        liveLadders: { text: liveLadder(cfg, 'text'), fast: liveLadder(cfg, 'fast'), agent: liveLadder(cfg, 'agent') },
      });
    } catch (e: any) {
      return res.status(502).json({ success: false, error: e?.message || 'Test failed' });
    }
  });

  // One small picture through the image ladder, returned for preview.
  router.post('/admin/nvidia/test-image', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const started = Date.now();
    try {
      const drawn = await nvidiaImage({ prompt: 'A bright product photo of a ceramic coffee mug on a wooden table, soft daylight', width: 512, height: 512 });
      return res.json({ success: true, model: drawn.model, ms: Date.now() - started, bytes: drawn.bytes.length, preview: `data:${drawn.mimeType};base64,${drawn.bytes.toString('base64')}` });
    } catch (e: any) {
      return res.json({ success: false, ms: Date.now() - started, error: e?.message || 'failed' });
    }
  });

  return router;
}
