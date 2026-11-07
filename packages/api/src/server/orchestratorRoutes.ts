// The AI Agent API — mounted at /api/agent. One orchestrator, its skills, its
// runs, and event-based lead targeting.

import express from 'express';
import type { Response, Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';
import { createContextItem, isUpcoming, listContextItems } from './companyContext.ts';
import { userSalesTimezone } from './sales/dailyPlan.ts';
import {
  dismissSuggestion, latestSuggestions, suggestionDetail, suggestionToList, suggestTargets,
} from './sales/leadTargeting.ts';
import { zonedDateKey } from './timezones.ts';
import { getRun, listRuns, startRun } from './orchestrator/engine.ts';
import { PACK_LABELS } from './orchestrator/dataPacks.ts';
import { aiAvailable } from './orchestrator/llm.ts';
import { loadSkills } from './orchestrator/skills.ts';

interface Deps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool;
}

export function registerOrchestratorRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();
  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });
  const handle = (res: Response, err: any, key: string, msg: string) => {
    if (err?.status && err.status < 500) return fail(res, err.status, err.message);
    logger.error({ err }, key);
    return fail(res, 500, msg);
  };
  const isAdmin = async (userId: string) => {
    const { rows } = await pool.query(`SELECT role FROM users WHERE id=$1`, [userId]);
    return rows[0]?.role === 'admin';
  };

  router.get('/skills', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const skills = await loadSkills(pool, { isAdmin: await isAdmin(auth.userId) });
      res.json({ success: true, ai_available: await aiAvailable(), packs: PACK_LABELS, skills });
    } catch (err) { handle(res, err, 'agent_skills_failed', 'Failed to load skills'); }
  });

  // ── Runs ──
  router.post('/runs', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = z.object({ message: z.string().trim().min(1).max(4000), parent_run_id: z.string().max(64).nullish() }).safeParse(req.body ?? {});
    if (!b.success) return fail(res, 400, 'Type a request');
    try {
      if (!(await aiAvailable())) return fail(res, 503, 'No AI is configured — add the free NVIDIA key in Admin → NVIDIA, or a paid key in Admin → AI Configuration.');
      let parent: string | null = null;
      if (b.data.parent_run_id) parent = (await getRun(pool, auth.userId, b.data.parent_run_id))?.id ?? null;
      const run = await startRun(pool, auth.userId, b.data.message, parent, await isAdmin(auth.userId));
      res.json({ success: true, run });
    } catch (err) { handle(res, err, 'agent_run_start_failed', 'Could not start the agent'); }
  });

  router.get('/runs', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try { res.json({ success: true, runs: await listRuns(pool, auth.userId) }); }
    catch (err) { handle(res, err, 'agent_runs_failed', 'Failed to load history'); }
  });

  router.get('/runs/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const run = await getRun(pool, auth.userId, req.params.id);
      if (!run) return fail(res, 404, 'Not found');
      res.json({ success: true, run });
    } catch (err) { handle(res, err, 'agent_run_failed', 'Failed to load the run'); }
  });

  /** Runs a server-side action the agent proposed. Others (open a page, hand to chat) happen in the browser. */
  router.post('/runs/:id/actions/:index', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const run = await getRun(pool, auth.userId, req.params.id);
      const action = run?.result?.actions?.[Number(req.params.index)];
      if (!action) return fail(res, 404, 'Action not found');
      if (action.type === 'target_leads') {
        const t = await suggestTargets(pool, auth.userId, action.params.event_id, { runId: run.id, focus: action.params.focus ?? null });
        return res.json({ success: true, type: action.type, targeting: t });
      }
      if (action.type === 'save_note') {
        const item = await createContextItem(pool, auth.userId, { kind: 'note', title: action.params.title, body: action.params.body, summary: null }, 'ai');
        return res.json({ success: true, type: action.type, item });
      }
      return fail(res, 400, 'This action runs in the browser');
    } catch (err) { handle(res, err, 'agent_action_failed', 'The action failed'); }
  });

  // ── Lead targeting ──
  router.get('/targeting/events', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const today = zonedDateKey(Date.now(), await userSalesTimezone(pool, auth.userId));
      const items = (await listContextItems(pool, auth.userId, { activeOnly: true }))
        .filter((i) => (i.kind === 'event' || i.kind === 'program' || i.kind === 'offering') && isUpcoming(i, today))
        .sort((a, b) => ['event', 'program', 'offering'].indexOf(a.kind) - ['event', 'program', 'offering'].indexOf(b.kind)
          || String(a.data.start_date ?? '9999').localeCompare(String(b.data.start_date ?? '9999')));
      res.json({ success: true, today, events: items });
    } catch (err) { handle(res, err, 'agent_targeting_events_failed', 'Failed to load events'); }
  });

  router.post('/targeting/suggest', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = z.object({ event_id: z.string().min(1).max(64), focus: z.string().max(500).nullish(), use_ai: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!b.success) return fail(res, 400, 'Pick an event');
    try {
      res.json({ success: true, ...(await suggestTargets(pool, auth.userId, b.data.event_id, { useAi: b.data.use_ai, focus: b.data.focus ?? null })) });
    } catch (err) { handle(res, err, 'agent_targeting_suggest_failed', 'Could not build the lead groups'); }
  });

  router.get('/targeting', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const eventId = typeof req.query.event_id === 'string' && req.query.event_id ? req.query.event_id : null;
      res.json({ success: true, suggestions: await latestSuggestions(pool, auth.userId, eventId) });
    } catch (err) { handle(res, err, 'agent_targeting_list_failed', 'Failed to load suggestions'); }
  });

  router.get('/targeting/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const d = await suggestionDetail(pool, auth.userId, req.params.id);
      if (!d) return fail(res, 404, 'Not found');
      res.json({ success: true, ...d });
    } catch (err) { handle(res, err, 'agent_targeting_detail_failed', 'Failed to load the leads'); }
  });

  router.post('/targeting/:id/list', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = z.object({ name: z.string().max(120).nullish() }).safeParse(req.body ?? {});
    if (!b.success) return fail(res, 400, 'Invalid name');
    try { res.json({ success: true, ...(await suggestionToList(pool, auth.userId, req.params.id, b.data.name ?? null)) }); }
    catch (err) { handle(res, err, 'agent_targeting_list_create_failed', 'Could not create the list'); }
  });

  router.post('/targeting/:id/dismiss', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      if (!(await dismissSuggestion(pool, auth.userId, req.params.id))) return fail(res, 404, 'Not found');
      res.json({ success: true });
    } catch (err) { handle(res, err, 'agent_targeting_dismiss_failed', 'Could not dismiss'); }
  });

  return router;
}
