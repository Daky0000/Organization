import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { dbQuery } from '../db.ts';
import { getTokenEfficiencyTelemetry } from '../ai-helpers.ts';
import { observabilitySummary, MONITOR_DEFAULTS } from './aiTrace.ts';
import { listEvalRuns, runLiveSuite, runOfflineSuite, saveEvalRun } from './aiEvals.ts';
import { AI_OPS_PLATFORM, invalidateRoutingMode, routingMode } from './aiRouting.ts';

// Admin → AI Ops: how the AI is doing (traces), whether it is any good
// (evals), and the one switch that changes cost (paid-model routing).

interface Deps {
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  inMemoryPlatformConfigs: Map<string, any>;
}

let liveEvalRunning = false;

export function registerAIOpsRoutes({ requireAdmin, hasDatabase, inMemoryPlatformConfigs }: Deps): Router {
  const router = express.Router();

  router.get('/admin/ai/ops', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
      const [summary, routing, evals] = await Promise.all([observabilitySummary(hours), routingMode(), listEvalRuns(10)]);
      return res.json({
        success: true, ...summary, routing, monitor: MONITOR_DEFAULTS,
        dailyCostAlertUsd: Number(process.env.AI_DAILY_COST_ALERT_USD) || 25,
        tokenEfficiency: getTokenEfficiencyTelemetry(),
        evals: evals.map((e) => ({ ...e, results: undefined, failed: (Array.isArray(e.results) ? e.results : []).filter((r: any) => !r.pass) })),
      });
    } catch (err) {
      logger.error({ err }, 'ai_ops_summary_failed');
      return res.status(500).json({ success: false, error: 'Failed to load AI ops' });
    }
  });

  router.put('/admin/ai/ops/routing', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const mode = req.body?.mode === 'off' ? 'off' : req.body?.mode === 'auto' ? 'auto' : null;
    if (!mode) return res.status(400).json({ success: false, error: 'mode must be auto or off' });
    try {
      const config = JSON.stringify({ routing: mode });
      if (hasDatabase()) {
        const u = await dbQuery(`UPDATE platform_configs SET config=$2, enabled=true, updated_at=NOW() WHERE platform=$1`, [AI_OPS_PLATFORM, config]);
        if (!u.rowCount) await dbQuery(`INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1,$2,true,NOW())`, [AI_OPS_PLATFORM, config]);
      } else {
        inMemoryPlatformConfigs.set(AI_OPS_PLATFORM, { platform: AI_OPS_PLATFORM, config: { routing: mode }, enabled: true, updated_at: new Date().toISOString() });
      }
      invalidateRoutingMode();
      void recordAuditLog((admin as any).id, 'admin_ai_routing_updated', [], { mode });
      return res.json({ success: true, routing: mode });
    } catch (err) {
      logger.error({ err }, 'ai_routing_save_failed');
      return res.status(500).json({ success: false, error: 'Failed to save routing' });
    }
  });

  router.post('/admin/ai/evals/run', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const suite = req.body?.suite === 'live' ? 'live' : 'offline';
    if (suite === 'live' && liveEvalRunning) return res.status(409).json({ success: false, error: 'A live eval is already running.' });
    try {
      if (suite === 'live') liveEvalRunning = true;
      const run = suite === 'live' ? await runLiveSuite() : runOfflineSuite();
      await saveEvalRun(run, (admin as any).id ?? null);
      return res.json({ success: true, run });
    } catch (err) {
      return res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Eval failed' });
    } finally {
      if (suite === 'live') liveEvalRunning = false;
    }
  });

  router.get('/admin/ai/evals/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { rows } = await dbQuery(`SELECT * FROM ai_eval_runs WHERE id=$1`, [req.params.id]).catch(() => ({ rows: [] as any[] }));
    if (!rows.length) return res.status(404).json({ success: false, error: 'Eval run not found' });
    return res.json({ success: true, run: rows[0] });
  });

  return router;
}
