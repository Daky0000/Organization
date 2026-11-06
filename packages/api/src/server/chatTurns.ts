import type { Response } from 'express';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Chat replies that do not depend on the browser tab.
//
// A reply (a "turn") runs on the server as a job. Everything it would have
// streamed is recorded as numbered events: kept in memory while it runs (and
// 15 minutes after), and saved to the database as it goes. The browser that
// asked follows the job; if it leaves the tab, sleeps, or loses its
// connection, the job carries on, and when it comes back it asks for the
// events after the last one it saw — live if the job is still running.
//
// The chat handlers themselves are unchanged: they write to a TurnSink, which
// looks like an Express response but records events instead of sending them.
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type TurnStatus = 'running' | 'done' | 'failed';
export interface TurnEvent { seq: number; type?: string; [k: string]: unknown }

const KEEP_FINISHED_MS = 15 * 60_000;
const SAVE_EVERY_MS = 1_000;
/** A job that has not saved for this long, and is not running here, died with its server. */
export const TURN_STALE_MS = 90_000;
const MAX_EVENTS = 4_000;

export function cleanTurnId(raw: unknown): string | null {
  const id = String(raw ?? '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/**
 * The events as saved: consecutive text deltas joined into one (with the seq
 * of the last), only the latest "thinking", everything else as it was.
 */
export function compactEvents(events: TurnEvent[]): TurnEvent[] {
  const out: TurnEvent[] = [];
  let lastThinking = -1;
  for (const ev of events) {
    const prev = out[out.length - 1];
    if (ev.type === 'text' && prev?.type === 'text') {
      out[out.length - 1] = { ...prev, text: `${prev.text ?? ''}${ev.text ?? ''}`, seq: ev.seq };
      continue;
    }
    if (ev.type === 'thinking') {
      if (lastThinking >= 0) out.splice(lastThinking, 1);
      lastThinking = out.length;
    }
    out.push(ev);
  }
  return out;
}

export class TurnJob {
  readonly events: TurnEvent[] = [];
  status: TurnStatus = 'running';
  seq = 0;
  readonly startedAt = Date.now();
  endedAt: number | null = null;
  private listeners = new Set<(ev: TurnEvent | null) => void>();
  /** tool_start ids still open, per tool name, so tool_done can carry the same id. */
  private openTools = new Map<string, string[]>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly kind: string,
    private readonly save: (job: TurnJob) => Promise<void>,
  ) {}

  emit(data: Record<string, unknown>): void {
    if (this.status !== 'running') return;
    const ev: TurnEvent = { ...data, seq: ++this.seq };
    // Tool cards get a stable id, so a replay updates the card instead of adding another.
    if (ev.type === 'tool_start' && typeof ev.name === 'string') {
      ev.tool_id = `tool-${this.id.slice(0, 8)}-${ev.seq}`;
      this.openTools.set(ev.name, [...(this.openTools.get(ev.name) ?? []), String(ev.tool_id)]);
    } else if (ev.type === 'tool_done' && typeof ev.name === 'string') {
      const open = this.openTools.get(ev.name) ?? [];
      if (open.length) ev.tool_id = open.shift();
    }
    if (this.events.length < MAX_EVENTS) this.events.push(ev);
    for (const l of this.listeners) { try { l(ev); } catch { /* a closed stream */ } }
    this.scheduleSave(ev.type === 'estimate' || ev.type === 'error' || ev.type === 'text_reset');
  }

  finish(status: Exclude<TurnStatus, 'running'>): void {
    if (this.status !== 'running') return;
    this.status = status;
    this.endedAt = Date.now();
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    void this.save(this).catch((err) => logger.warn({ err, turn: this.id }, 'chat_turn_save_failed'));
    for (const l of this.listeners) { try { l(null); } catch { /* a closed stream */ } }
    this.listeners.clear();
  }

  /** Events after `after`, then live ones; `null` means the turn ended. Returns the unsubscribe. */
  subscribe(after: number, listener: (ev: TurnEvent | null) => void): () => void {
    for (const ev of this.events) if (ev.seq > after) listener(ev);
    if (this.status !== 'running') { listener(null); return () => undefined; }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private scheduleSave(now: boolean): void {
    if (now) {
      if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
      void this.save(this).catch((err) => logger.warn({ err, turn: this.id }, 'chat_turn_save_failed'));
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save(this).catch((err) => logger.warn({ err, turn: this.id }, 'chat_turn_save_failed'));
    }, SAVE_EVERY_MS);
    this.saveTimer.unref?.();
  }
}

/**
 * Stands in for the Express response a chat handler writes to: SSE "data:"
 * lines become events, "[DONE]" or end() finishes the turn, and an early
 * res.status(n).json({error}) becomes an error event.
 */
export class TurnSink {
  headersSent = true;
  writableEnded = false;
  private closeListeners: Array<() => void> = [];
  private code = 200;
  private buffer = '';

  constructor(private readonly job: TurnJob) {}

  setHeader(): this { return this; }
  flushHeaders(): void { /* nothing to flush */ }

  on(event: string, fn: () => void): this {
    if (event === 'close') this.closeListeners.push(fn);
    return this;
  }

  status(code: number): this { this.code = code; return this; }

  json(body: any): this {
    this.job.emit({ type: 'error', error: String(body?.error || 'Something went wrong.'), status: this.code, retryable: this.code >= 500 });
    this.end(false);
    return this;
  }

  write(chunk: string): boolean {
    if (this.writableEnded) return false;
    this.buffer += String(chunk);
    let at: number;
    while ((at = this.buffer.indexOf('\n\n')) >= 0) {
      const frame = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { this.end(); return true; }
        try { this.job.emit(JSON.parse(payload)); } catch { /* not an event */ }
      }
    }
    return true;
  }

  end(ok = true): this {
    if (this.writableEnded) return this;
    this.writableEnded = true;
    for (const fn of this.closeListeners) { try { fn(); } catch { /* ignore */ } }
    this.closeListeners = [];
    this.job.finish(ok && this.code < 400 ? 'done' : 'failed');
    return this;
  }
}

/** Running and recent turns, plus their saved copies, for one process. */
export class TurnRegistry {
  private jobs = new Map<string, TurnJob>();
  private ensured: Promise<void> | null = null;
  private lastCleanup = 0;

  constructor(private readonly query: Query) {}

  private ensureTable(): Promise<void> {
    this.ensured ??= (async () => {
      await this.query(`CREATE TABLE IF NOT EXISTS chat_turns (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'chat',
          status TEXT NOT NULL DEFAULT 'running',
          seq INTEGER NOT NULL DEFAULT 0,
          events JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await this.query(`CREATE INDEX IF NOT EXISTS chat_turns_created_idx ON chat_turns(created_at)`);
    })().catch((err) => { this.ensured = null; throw err; });
    return this.ensured;
  }

  private saveJob = async (job: TurnJob): Promise<void> => {
    await this.ensureTable();
    await this.query(
      `INSERT INTO chat_turns (id, user_id, kind, status, seq, events, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, seq=EXCLUDED.seq, events=EXCLUDED.events, updated_at=NOW()
       WHERE chat_turns.user_id = EXCLUDED.user_id`,
      [job.id, job.userId, job.kind, job.status, job.seq, JSON.stringify(compactEvents(job.events))],
    );
    // Old turns go after a week (at most once an hour per process).
    if (Date.now() - this.lastCleanup > 3_600_000) {
      this.lastCleanup = Date.now();
      await this.query(`DELETE FROM chat_turns WHERE created_at < NOW() - INTERVAL '7 days'`).catch(() => undefined);
    }
  };

  /** This user's turn running (or recently run) in this process. */
  live(id: string, userId: string): TurnJob | null {
    const job = this.jobs.get(id);
    return job && job.userId === userId ? job : null;
  }

  /** Starts a turn; the handler runs to completion whether or not anybody is watching. */
  start(id: string, userId: string, kind: string, run: (sink: TurnSink) => Promise<unknown>): TurnJob {
    const job = new TurnJob(id, userId, kind, this.saveJob);
    this.jobs.set(id, job);
    const sink = new TurnSink(job);
    void this.saveJob(job).catch((err) => logger.warn({ err, turn: id }, 'chat_turn_save_failed'));
    // While it runs, a save every 20 s says "still alive" to other processes.
    const alive = setInterval(() => { if (job.status === 'running') void this.saveJob(job).catch(() => undefined); }, 20_000);
    alive.unref?.();
    void (async () => {
      try {
        await run(sink);
      } catch (err) {
        logger.error({ err, turn: id }, 'chat_turn_failed');
        job.emit({ type: 'error', error: 'This reply could not be finished. Press Retry — anything already made is kept.', retryable: true });
      } finally {
        clearInterval(alive);
        if (!sink.writableEnded) sink.end();
        const t = setTimeout(() => { if (this.jobs.get(id) === job) this.jobs.delete(id); }, KEEP_FINISHED_MS);
        t.unref?.();
      }
    })();
    return job;
  }

  /** The saved copy of a turn (another process ran it, or this one restarted). */
  async saved(id: string, userId: string): Promise<{ status: TurnStatus; seq: number; events: TurnEvent[]; stale: boolean } | null> {
    await this.ensureTable();
    const { rows } = await this.query(
      `SELECT status, seq, events, EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 AS age_ms FROM chat_turns WHERE id=$1 AND user_id=$2`,
      [id, userId],
    );
    const r = rows[0];
    if (!r) return null;
    return { status: r.status, seq: Number(r.seq) || 0, events: Array.isArray(r.events) ? r.events : [], stale: Number(r.age_ms) > TURN_STALE_MS };
  }

  async markInterrupted(id: string, userId: string): Promise<void> {
    await this.query(`UPDATE chat_turns SET status='failed', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='running'`, [id, userId]).catch(() => undefined);
  }

  /**
   * Streams a turn to a response: the events after `after`, then live ones,
   * until it ends. Leaving (closing the response) never stops the turn.
   */
  async follow(res: Response, id: string, userId: string, after: number): Promise<void> {
    const open = () => {
      if (res.headersSent) return;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
    };
    const write = (line: string) => { if (!res.writableEnded) res.write(line); };
    const job = this.live(id, userId);
    if (job) {
      open();
      const heartbeat = setInterval(() => write(': ping\n\n'), 15_000);
      let off: () => void = () => undefined;
      const stop = () => { clearInterval(heartbeat); off(); };
      res.on('close', stop);
      off = job.subscribe(after, (ev) => {
        if (ev === null) { stop(); write('data: [DONE]\n\n'); if (!res.writableEnded) res.end(); return; }
        write(`data: ${JSON.stringify(ev)}\n\n`);
      });
      return;
    }
    // Not running here: what was saved. The client rebuilds the reply from it.
    const saved = await this.saved(id, userId).catch(() => null);
    if (!saved) {
      if (!res.headersSent) res.status(404).json({ success: false, code: 'turn_not_found', error: 'This reply is no longer available. Press Retry to send your message again.' });
      return;
    }
    open();
    const missed = saved.events.some((e) => e.seq > after);
    if (missed) {
      // Saved events are joined up, so the client starts this reply over from them.
      write(`data: ${JSON.stringify({ type: 'turn_reset', seq: 0 })}\n\n`);
      for (const ev of saved.events) write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    if (saved.status === 'running' && !saved.stale) {
      // Another process is still on it: come back in a moment.
      write(`data: ${JSON.stringify({ type: 'turn_elsewhere', seq: saved.seq })}\n\n`);
      if (!res.writableEnded) res.end();
      return;
    }
    if (saved.status === 'running') {
      await this.markInterrupted(id, userId);
      write(`data: ${JSON.stringify({ type: 'error', seq: saved.seq + 1, interrupted: true, retryable: true, error: 'The server restarted before this reply finished. Press Retry to send it again — anything already made is kept and won\'t be made twice.' })}\n\n`);
    }
    write('data: [DONE]\n\n');
    if (!res.writableEnded) res.end();
  }
}
