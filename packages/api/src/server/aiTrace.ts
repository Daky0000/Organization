import { randomUUID } from 'crypto';
import { dbQuery, hasDatabase } from '../db.ts';
import { logger } from '../logger.ts';
import { Sentry, sentryEnabled } from '../instrument.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AI observability: one trace row per model call (or cache hit, or guard
// block), with latency, tokens, cost, which ladder rungs failed on the way,
// guard signals and quality signals. ai_usage_log stays the billing record;
// this table answers "is the AI working, how fast, at what cost, and is it
// any good?".
//
// The last few hundred traces are also kept in memory, so the admin view and
// the monitor still work in local dev with no database.
// ─────────────────────────────────────────────────────────────────────────────

export type TraceStatus = 'ok' | 'error' | 'cache_hit' | 'blocked';

export interface TraceRecord {
  traceId?: string;
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  status: TraceStatus;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  /** The configured model when the router picked a cheaper one. */
  routedFrom?: string | null;
  /** Free-ladder rungs that failed before this answer (or before the error). */
  attempts?: Array<{ model: string; error: string }>;
  /** Injection signals, blocked tools, output-check issues. */
  guard?: Record<string, unknown> | null;
  /** Online eval signals: format_ok, qa_approved, length… */
  quality?: Record<string, unknown> | null;
  error?: string | null;
}

const RECENT_MAX = 500;
const recent: Array<TraceRecord & { id: string; at: number }> = [];

export function recentTraces(): ReadonlyArray<TraceRecord & { id: string; at: number }> {
  return recent;
}

export function recordTrace(t: TraceRecord): void {
  const id = randomUUID();
  const row = { ...t, id, at: Date.now() };
  recent.push(row);
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
  if (!hasDatabase()) return;
  void dbQuery(
    `INSERT INTO ai_call_traces (id, trace_id, user_id, feature, provider, model, status, latency_ms, input_tokens, output_tokens,
       cache_read_tokens, cost_usd, routed_from, attempts, guard, quality, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17)`,
    [
      id, t.traceId ?? null, t.userId, t.feature.slice(0, 60), t.provider.slice(0, 30), t.model.slice(0, 120), t.status,
      Math.max(0, Math.round(t.latencyMs)), Math.round(t.inputTokens ?? 0), Math.round(t.outputTokens ?? 0),
      Math.round(t.cacheReadTokens ?? 0), (t.costUsd ?? 0).toFixed(6), t.routedFrom ?? null,
      JSON.stringify(t.attempts ?? []), t.guard ? JSON.stringify(t.guard) : null, t.quality ? JSON.stringify(t.quality) : null,
      t.error ? String(t.error).slice(0, 500) : null,
    ],
  ).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err }, 'ai_trace_record_failed'));
}

/** Times one call. `end` records the trace; call it exactly once. */
export function startSpan(base: { feature: string; userId: string | null; traceId?: string }) {
  const started = Date.now();
  return {
    traceId: base.traceId ?? randomUUID(),
    elapsed: () => Date.now() - started,
    end(rest: Omit<TraceRecord, 'feature' | 'userId' | 'latencyMs' | 'traceId'>) {
      recordTrace({ ...base, traceId: base.traceId, latencyMs: Date.now() - started, ...rest });
    },
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface FeatureMetrics {
  feature: string;
  calls: number;
  errors: number;
  errorRate: number;
  cacheHits: number;
  blocked: number;
  paidAfterFree: number;
  p50Ms: number;
  p95Ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  formatFailures: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Aggregates trace rows (from the DB or memory) per feature. Exported for tests. */
export function aggregateTraces(rows: Array<{
  feature: string; status: string; latency_ms: number; input_tokens: number; output_tokens: number;
  cost_usd: number | string; provider: string; attempts?: unknown; quality?: any;
}>): FeatureMetrics[] {
  const byFeature = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byFeature.get(r.feature) ?? [];
    list.push(r);
    byFeature.set(r.feature, list);
  }
  const out: FeatureMetrics[] = [];
  for (const [feature, list] of byFeature) {
    const real = list.filter((r) => r.status !== 'cache_hit');
    const latencies = real.map((r) => Number(r.latency_ms) || 0).sort((a, b) => a - b);
    const errors = list.filter((r) => r.status === 'error').length;
    out.push({
      feature,
      calls: list.length,
      errors,
      errorRate: list.length ? errors / list.length : 0,
      cacheHits: list.filter((r) => r.status === 'cache_hit').length,
      blocked: list.filter((r) => r.status === 'blocked').length,
      paidAfterFree: list.filter((r) => r.provider !== 'nvidia' && Array.isArray(r.attempts) && r.attempts.length > 0).length,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      inputTokens: list.reduce((n, r) => n + (Number(r.input_tokens) || 0), 0),
      outputTokens: list.reduce((n, r) => n + (Number(r.output_tokens) || 0), 0),
      costUsd: Number(list.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0).toFixed(6)),
      formatFailures: list.filter((r) => r.quality && r.quality.format_ok === false).length,
    });
  }
  return out.sort((a, b) => b.calls - a.calls);
}

const TRACE_COLUMNS = 'feature, status, latency_ms, input_tokens, output_tokens, cost_usd, provider, model, attempts, guard, quality, error, created_at';

export async function loadTraces(sinceMs: number): Promise<any[]> {
  if (hasDatabase()) {
    const { rows } = await dbQuery(
      `SELECT ${TRACE_COLUMNS} FROM ai_call_traces WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 20000`,
      [new Date(sinceMs).toISOString()],
    ).catch(() => ({ rows: [] as any[] }));
    if (rows.length) return rows;
  }
  return recent.filter((r) => r.at >= sinceMs).map((r) => ({
    feature: r.feature, status: r.status, latency_ms: r.latencyMs, input_tokens: r.inputTokens ?? 0,
    output_tokens: r.outputTokens ?? 0, cost_usd: r.costUsd ?? 0, provider: r.provider, model: r.model,
    attempts: r.attempts ?? [], guard: r.guard ?? null, quality: r.quality ?? null, error: r.error ?? null,
    created_at: new Date(r.at).toISOString(),
  }));
}

export async function observabilitySummary(hours: number) {
  const since = Date.now() - Math.min(Math.max(hours, 1), 24 * 30) * 3600_000;
  const rows = await loadTraces(since);
  const features = aggregateTraces(rows);
  const totals = aggregateTraces(rows.map((r) => ({ ...r, feature: 'all' })))[0] ?? null;
  const byModel = new Map<string, { calls: number; errors: number; costUsd: number }>();
  for (const r of rows) {
    if (r.status === 'cache_hit') continue;
    const key = `${r.provider}/${r.model}`;
    const m = byModel.get(key) ?? { calls: 0, errors: 0, costUsd: 0 };
    m.calls++;
    if (r.status === 'error') m.errors++;
    m.costUsd += Number(r.cost_usd) || 0;
    byModel.set(key, m);
  }
  const guardEvents = rows.filter((r) => r.guard && (r.status === 'blocked' || (r.guard as any).suspicious || (r.guard as any).deniedTools?.length || (r.guard as any).outputIssues?.length))
    .slice(0, 50)
    .map((r) => ({ at: r.created_at, feature: r.feature, status: r.status, guard: r.guard }));
  const recentErrors = rows.filter((r) => r.status === 'error').slice(0, 30)
    .map((r) => ({ at: r.created_at, feature: r.feature, provider: r.provider, model: r.model, error: r.error }));
  return {
    windowHours: hours,
    totals,
    features,
    models: [...byModel].map(([model, m]) => ({ model, ...m, costUsd: Number(m.costUsd.toFixed(6)) })).sort((a, b) => b.calls - a.calls),
    guardEvents,
    recentErrors,
    alerts: [...lastAlerts.values()].sort((a, b) => b.at - a.at).slice(0, 20),
  };
}

// ── Monitoring: alerts on error spikes and spend ─────────────────────────────

const lastAlerts = new Map<string, { key: string; message: string; at: number }>();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function alert(key: string, message: string, extra: Record<string, unknown>): void {
  const prev = lastAlerts.get(key);
  if (prev && Date.now() - prev.at < ALERT_COOLDOWN_MS) return;
  lastAlerts.set(key, { key, message, at: Date.now() });
  logger.error({ alert: key, ...extra }, message);
  if (sentryEnabled) Sentry.captureMessage(message, { level: 'error', extra });
}

export const MONITOR_DEFAULTS = {
  windowMinutes: 15,
  minCalls: 8,
  errorRate: 0.3,
  p95Ms: 90_000,
};

/**
 * Runs on the scheduler. Alerts (log + Sentry, at most hourly per key) when a
 * feature's error rate or p95 latency crosses its line in the last window,
 * or the day's paid spend crosses AI_DAILY_COST_ALERT_USD.
 */
export async function runAIMonitor(now = Date.now()): Promise<string[]> {
  const fired: string[] = [];
  const rows = await loadTraces(now - MONITOR_DEFAULTS.windowMinutes * 60_000);
  for (const f of aggregateTraces(rows)) {
    if (f.calls >= MONITOR_DEFAULTS.minCalls && f.errorRate >= MONITOR_DEFAULTS.errorRate) {
      const msg = `AI errors: ${f.feature} failed ${f.errors} of ${f.calls} calls in the last ${MONITOR_DEFAULTS.windowMinutes} minutes`;
      alert(`errors:${f.feature}`, msg, { feature: f.feature, calls: f.calls, errors: f.errors, errorRate: f.errorRate });
      fired.push(msg);
    }
    if (f.calls >= MONITOR_DEFAULTS.minCalls && f.p95Ms >= MONITOR_DEFAULTS.p95Ms) {
      const msg = `AI latency: ${f.feature} p95 is ${(f.p95Ms / 1000).toFixed(0)} s over the last ${MONITOR_DEFAULTS.windowMinutes} minutes`;
      alert(`latency:${f.feature}`, msg, { feature: f.feature, calls: f.calls, p50Ms: f.p50Ms, p95Ms: f.p95Ms });
      fired.push(msg);
    }
  }
  const limit = Number(process.env.AI_DAILY_COST_ALERT_USD) || 25;
  const day = await loadTraces(now - 24 * 3600_000);
  const spend = day.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
  if (spend >= limit) {
    const msg = `AI spend: $${spend.toFixed(2)} in the last 24 hours (alert at $${limit})`;
    alert('spend:24h', msg, { spend, limit });
    fired.push(msg);
  }
  return fired;
}

export function resetTraceStateForTests(): void {
  recent.length = 0;
  lastAlerts.clear();
}
