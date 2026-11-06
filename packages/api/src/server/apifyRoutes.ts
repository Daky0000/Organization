import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';

type AuthResult = { userId: string; role?: string } | null;

interface ApifyDeps {
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

export function registerApifyRoutes({ requireAdmin, hasDatabase, dbQuery }: ApifyDeps): Router {
  const router = express.Router();

  async function getApifyToken(): Promise<string | null> {
    try {
      const r = await dbQuery<{ config: Record<string, string> }>(
        `SELECT config FROM platform_configs WHERE platform = 'apify' AND enabled = true LIMIT 1`
      );
      return decryptPlatformConfig((r.rows[0] as any)?.config)?.apiKey ?? null;
    } catch (_err) { return null; }
  }

  // GET /api/admin/apify/status
  router.get('/status', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const token = await getApifyToken();
    if (!token) return res.json({ connected: false });
    try {
      const resp = await axios.get('https://api.apify.com/v2/users/me', {
        headers: { Authorization: `Bearer ${token}` },
        params: { token },
        validateStatus: () => true,
        timeout: 8000,
      });
      if (resp.status !== 200) return res.json({ connected: false });
      const d = resp.data?.data ?? {};
      return res.json({
        connected: true,
        username: d.username || d.email || '',
        plan: d.plan?.id ?? '',
        creditBalance: d.limits?.monthlyUsageUsd ?? null,
      });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.json({ connected: false });
    }
  });

  // GET /api/admin/apify/actors
  router.get('/actors', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ actors: [] });
    try {
      const { rows } = await dbQuery(`SELECT * FROM apify_actors ORDER BY created_at DESC`);
      return res.json({ actors: rows });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to fetch actors' });
    }
  });

  // POST /api/admin/apify/actors
  router.post('/actors', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { actor_id, name, description = '', tag = 'Custom' } = req.body as { actor_id: string; name: string; description?: string; tag?: string };
    if (!actor_id?.trim() || !name?.trim()) return res.status(400).json({ error: 'actor_id and name required' });
    try {
      const { rows } = await dbQuery(
        `INSERT INTO apify_actors (actor_id, name, description, tag)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (actor_id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, tag=EXCLUDED.tag
         RETURNING *`,
        [actor_id.trim(), name.trim(), description.trim(), tag.trim()]
      );
      return res.json({ actor: rows[0] });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to save actor' });
    }
  });

  // DELETE /api/admin/apify/actors/:id
  router.delete('/actors/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    await dbQuery(`DELETE FROM apify_actors WHERE id=$1`, [req.params.id]);
    return res.json({ success: true });
  });

  // POST /api/admin/apify/actors/:id/run
  router.post('/actors/:id/run', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const apiToken = await getApifyToken();
    if (!apiToken) return res.status(400).json({ error: 'Apify API key not configured' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM apify_actors WHERE id=$1`, [req.params.id]);
      const actor = rows[0] as any;
      if (!actor) return res.status(404).json({ error: 'Actor not found' });
      const input = (req.body as { input?: Record<string, unknown> }).input ?? {};
      const apifyActorId = actor.actor_id.replace('/', '~');
      const resp = await axios.post(
        `https://api.apify.com/v2/acts/${apifyActorId}/runs`,
        input,
        {
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          params: { token: apiToken },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      if (resp.status >= 400) return res.status(400).json({ error: `Apify error ${resp.status}: ${JSON.stringify(resp.data)}` });
      const run = resp.data?.data ?? {};
      await dbQuery(
        `INSERT INTO apify_runs (actor_db_id, actor_name, apify_run_id, status, input)
         VALUES ($1,$2,$3,$4,$5)`,
        [actor.id, actor.name, run.id ?? 'unknown', run.status ?? 'READY', JSON.stringify(input)]
      );
      return res.json({ success: true, runId: run.id });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to start run' });
    }
  });

  // GET /api/admin/apify/runs
  router.get('/runs', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ runs: [] });
    try {
      const { rows } = await dbQuery(
        `SELECT r.*, a.actor_id FROM apify_runs r LEFT JOIN apify_actors a ON a.id = r.actor_db_id ORDER BY r.started_at DESC LIMIT 50`
      );
      const apiToken = await getApifyToken();
      if (apiToken && rows.length) {
        const pending = rows.filter((r: any) => r.status === 'RUNNING' || r.status === 'READY');
        await Promise.allSettled(pending.map(async (run: any) => {
          try {
            const resp = await axios.get(`https://api.apify.com/v2/actor-runs/${run.apify_run_id}`, {
              headers: { Authorization: `Bearer ${apiToken}` },
              params: { token: apiToken },
              validateStatus: () => true,
              timeout: 5000,
            });
            if (resp.status === 200) {
              const d = resp.data?.data ?? {};
              await dbQuery(
                `UPDATE apify_runs SET status=$1, dataset_id=$2, finished_at=$3 WHERE id=$4`,
                [d.status ?? run.status, d.defaultDatasetId ?? run.dataset_id, d.finishedAt ?? run.finished_at, run.id]
              );
              run.status = d.status ?? run.status;
              run.dataset_id = d.defaultDatasetId ?? run.dataset_id;
              run.finished_at = d.finishedAt ?? run.finished_at;
            }
          } catch (_err) { /* skip */ }
        }));
      }
      return res.json({ runs: rows });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to fetch runs' });
    }
  });

  return router;
}
