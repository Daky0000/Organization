import { createHash } from 'crypto';
import { dbQuery, hasDatabase } from '../db.ts';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Generation checkpoints: a multi-step generation saves each finished step,
// so a failure (a provider error, a timeout, a deploy restarting the process)
// resumes at the step that failed instead of paying for every step again.
//
//   const cp = await openCheckpoint({ kind: 'content_plan_run', ref: runId, userId });
//   const copy = await cp.step('copy', () => writeCopy());   // skipped on resume
//   const image = await cp.step('image', () => drawImage());
//   await cp.complete();
//
// A step's result must be JSON. A step that throws is not saved; the error
// is recorded and the checkpoint stays open for the next attempt.
//
// The same table de-duplicates side-effecting chat tool calls: when a chat
// turn is retried after a dropped stream, the drafts and posts it already
// made are returned instead of made twice (memoTool below).
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckpointState {
  id: string;
  kind: string;
  ref: string;
  userId: string | null;
  steps: Record<string, unknown>;
  status: 'running' | 'failed' | 'done';
  attempts: number;
  lastError: string | null;
  updatedAt: number;
}

// Used when there is no database (local dev, tests).
const memory = new Map<string, CheckpointState>();

const idFor = (kind: string, ref: string) => `${kind}:${ref}`.slice(0, 200);

function fromRow(r: any): CheckpointState {
  return {
    id: r.id, kind: r.kind, ref: r.ref_id, userId: r.user_id ?? null,
    steps: r.steps && typeof r.steps === 'object' ? r.steps : {},
    status: r.status, attempts: Number(r.attempts) || 0, lastError: r.last_error ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

export async function loadCheckpoint(kind: string, ref: string): Promise<CheckpointState | null> {
  const id = idFor(kind, ref);
  if (!hasDatabase()) return memory.get(id) ?? null;
  const { rows } = await dbQuery(`SELECT * FROM generation_checkpoints WHERE id=$1`, [id]).catch(() => ({ rows: [] as any[] }));
  return rows[0] ? fromRow(rows[0]) : (memory.get(id) ?? null);
}

export interface Checkpoint {
  readonly state: CheckpointState;
  /** Steps finished on an earlier attempt, which this attempt will skip. */
  readonly resumedSteps: string[];
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Saves a value without running anything (e.g. an id the next steps need). */
  save(name: string, value: unknown): Promise<void>;
  has(name: string): boolean;
  get<T>(name: string): T | undefined;
  complete(): Promise<void>;
  fail(err: unknown): Promise<void>;
}

/** Opens (or reopens, on a retry) the checkpoint for one generation. */
export async function openCheckpoint(params: { kind: string; ref: string; userId: string | null }): Promise<Checkpoint> {
  const id = idFor(params.kind, params.ref);
  let state: CheckpointState;
  if (hasDatabase()) {
    const { rows } = await dbQuery(
      `INSERT INTO generation_checkpoints (id, kind, ref_id, user_id, steps, status, attempts)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,'running',1)
       ON CONFLICT (id) DO UPDATE SET status='running', attempts=generation_checkpoints.attempts+1, updated_at=NOW()
       RETURNING *`,
      [id, params.kind, params.ref, params.userId],
    ).catch((err) => { logger.warn({ err: err instanceof Error ? err.message : err, id }, 'checkpoint_open_failed'); return { rows: [] as any[] }; });
    state = rows[0] ? fromRow(rows[0]) : openInMemory(id, params);
  } else {
    state = openInMemory(id, params);
  }
  const resumedSteps = Object.keys(state.steps);

  const persist = async (name: string, value: unknown) => {
    state.steps[name] = value;
    state.updatedAt = Date.now();
    if (!hasDatabase()) { memory.set(id, state); return; }
    await dbQuery(
      `UPDATE generation_checkpoints SET steps = steps || jsonb_build_object($2::text, $3::jsonb), updated_at=NOW() WHERE id=$1`,
      [id, name, JSON.stringify(value ?? null)],
    ).catch((err) => {
      // The step still succeeded; only a later resume loses it.
      logger.warn({ err: err instanceof Error ? err.message : err, id, step: name }, 'checkpoint_save_failed');
      memory.set(id, state);
    });
  };

  const setStatus = async (status: 'done' | 'failed', error: string | null) => {
    state.status = status;
    state.lastError = error;
    if (!hasDatabase()) { memory.set(id, state); return; }
    await dbQuery(`UPDATE generation_checkpoints SET status=$2, last_error=$3, updated_at=NOW() WHERE id=$1`, [id, status, error])
      .catch(() => memory.set(id, state));
  };

  return {
    state,
    resumedSteps,
    has: (name) => Object.prototype.hasOwnProperty.call(state.steps, name),
    get: <T,>(name: string) => state.steps[name] as T | undefined,
    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
      if (Object.prototype.hasOwnProperty.call(state.steps, name)) return state.steps[name] as T;
      const value = await fn();
      await persist(name, value);
      return value;
    },
    save: persist,
    complete: () => setStatus('done', null),
    fail: (err) => setStatus('failed', (err instanceof Error ? err.message : String(err)).slice(0, 500)),
  };
}

function openInMemory(id: string, params: { kind: string; ref: string; userId: string | null }): CheckpointState {
  const prev = memory.get(id);
  const state: CheckpointState = prev
    ? { ...prev, status: 'running', attempts: prev.attempts + 1, updatedAt: Date.now() }
    : { id, kind: params.kind, ref: params.ref, userId: params.userId, steps: {}, status: 'running', attempts: 1, lastError: null, updatedAt: Date.now() };
  memory.set(id, state);
  return state;
}

/** Finished checkpoints are only an audit trail after a while; keep the table small. */
export async function pruneCheckpoints(days = 14): Promise<void> {
  const cutoff = Date.now() - days * 86400_000;
  for (const [k, v] of memory) if (v.updatedAt < cutoff) memory.delete(k);
  if (!hasDatabase()) return;
  await dbQuery(`DELETE FROM generation_checkpoints WHERE updated_at < NOW() - make_interval(days => $1)`, [days]).catch(() => undefined);
}

// ── Chat: side-effecting tool calls run once per turn ────────────────────────

const TOOL_MEMO_TTL_MS = 30 * 60 * 1000;

/**
 * A stable key for one chat turn: the user plus the exact conversation sent.
 * A retry after a dropped stream sends the same conversation, so it gets the
 * same key; a follow-up message changes it.
 */
export function chatTurnKey(userId: string, messages: Array<{ role: string; content: unknown }>): string {
  return createHash('sha256').update(userId).update('\u0000').update(JSON.stringify(messages.map((m) => [m.role, String(m.content ?? '')]))).digest('hex').slice(0, 40);
}

const argsHash = (args: unknown) => createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex').slice(0, 16);

/**
 * Runs a side-effecting tool once per (turn, tool, arguments). Within 30
 * minutes, the same call in a retried turn returns the first result marked
 * `replayed`, instead of creating a second draft or a second video.
 */
export function makeToolMemo(params: { userId: string; turnKey: string }) {
  let cpPromise: Promise<Checkpoint> | null = null;
  const cp = () => (cpPromise ??= (async () => {
    const existing = await loadCheckpoint('chat_tool', params.turnKey);
    if (existing && Date.now() - existing.updatedAt > TOOL_MEMO_TTL_MS && Object.keys(existing.steps).length) {
      // Stale: a deliberate repeat much later is a new request, not a retry.
      await dbQuery(`DELETE FROM generation_checkpoints WHERE id=$1`, [existing.id]).catch(() => undefined);
      memory.delete(existing.id);
    }
    return openCheckpoint({ kind: 'chat_tool', ref: params.turnKey, userId: params.userId });
  })());

  return async function memoTool<T>(name: string, args: unknown, run: () => Promise<T>): Promise<T | (T & { replayed: true })> {
    const c = await cp();
    const key = `${name}:${argsHash(args)}`;
    if (c.has(key)) {
      const prior = c.get<T>(key);
      return (prior && typeof prior === 'object' ? { ...(prior as any), replayed: true } : prior) as T;
    }
    return c.step(key, run);
  };
}

export function resetCheckpointsForTests(): void {
  memory.clear();
}
