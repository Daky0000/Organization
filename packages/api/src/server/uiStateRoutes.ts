import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Per-user UI state that should follow the user between devices — for now,
// guided-tour progress (which tours were taken, turned down or are under way).
//
//   GET /api/me/ui-state   → { state: { tours: { [id]: { status, step, at } } } }
//   PUT /api/me/ui-state   { tours: {...} } → merged in, the merged state back
//
// Merge rule (same as the browser's): the incoming record wins, except that a
// "started" never undoes a "dismissed" or "done" (a replay on one device does
// not bring the "New here?" card back on another).
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
type Status = 'started' | 'dismissed' | 'done';
export interface TourRecord { status: Status; step: number; at: string }
export interface UiState { tours: Record<string, TourRecord> }

const RANK: Record<Status, number> = { started: 0, dismissed: 1, done: 2 };
const MAX_TOURS = 200;

/** Only well-formed tour records, at most 200, ids and dates bounded — anything else is dropped. */
export function cleanUiState(input: unknown): UiState {
  const tours: Record<string, TourRecord> = {};
  const raw = (input as any)?.tours;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { tours };
  for (const [id, rec] of Object.entries(raw).slice(0, MAX_TOURS)) {
    if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(id)) continue;
    const r = rec as any;
    if (!r || !['started', 'dismissed', 'done'].includes(r.status)) continue;
    const step = Number(r.step);
    const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : new Date().toISOString();
    tours[id] = { status: r.status, step: Number.isInteger(step) && step >= 0 && step < 1000 ? step : 0, at };
  }
  return { tours };
}

export function mergeUiState(base: UiState, incoming: UiState): UiState {
  const tours: Record<string, TourRecord> = { ...base.tours };
  for (const [id, next] of Object.entries(incoming.tours)) {
    const prev = tours[id];
    tours[id] = prev && RANK[prev.status] > RANK[next.status] && next.status === 'started' ? prev : next;
  }
  const ids = Object.keys(tours);
  // Bounded: the oldest records go first.
  if (ids.length > MAX_TOURS) {
    ids.sort((a, b) => tours[a].at.localeCompare(tours[b].at)).slice(0, ids.length - MAX_TOURS).forEach((id) => delete tours[id]);
  }
  return { tours };
}

let ensured: Promise<void> | null = null;
function ensureTable(query: Query): Promise<void> {
  ensured ??= query(`CREATE TABLE IF NOT EXISTS user_ui_state (
      user_id TEXT PRIMARY KEY,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).then(() => undefined).catch((err) => { ensured = null; throw err; });
  return ensured;
}

export function registerUiStateRoutes({ requireAuth, dbQuery }: {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  dbQuery: Query;
}): Router {
  const router = express.Router();

  async function load(userId: string): Promise<UiState> {
    await ensureTable(dbQuery);
    const { rows } = await dbQuery(`SELECT state FROM user_ui_state WHERE user_id=$1`, [userId]);
    return cleanUiState(rows[0]?.state);
  }

  router.get('/me/ui-state', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, state: await load(auth.userId) });
    } catch (err) {
      logger.warn({ err }, 'ui_state_load_failed');
      res.status(500).json({ success: false, error: 'Could not load your settings.' });
    }
  });

  router.put('/me/ui-state', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const merged = mergeUiState(await load(auth.userId), cleanUiState(req.body));
      await dbQuery(
        `INSERT INTO user_ui_state (user_id, state, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET state=EXCLUDED.state, updated_at=NOW()`,
        [auth.userId, JSON.stringify(merged)],
      );
      res.json({ success: true, state: merged });
    } catch (err) {
      logger.warn({ err }, 'ui_state_save_failed');
      res.status(500).json({ success: false, error: 'Could not save your settings.' });
    }
  });

  return router;
}
