// ─────────────────────────────────────────────────────────────────────────────
// Best-time-to-call.
//
// This is a sparsity problem, not a prediction problem. A given lead has maybe
// three to ten attempts in their whole history, so a raw per-bucket answer rate
// reports 1/1 = "100% on Tuesdays" and nothing anywhere else. Ranking on that
// is worse than useless: it is confidently wrong, and it looks authoritative in
// a dashboard.
//
// So: hierarchical shrinkage. Each level is pulled toward the level above it,
// with the prior weighted in units of pseudo-observations.
//
//   L0  global   p0 = (answered_all + 1) / (attempts_all + 2)        Laplace
//   L1  bucket   p1 = (answered_b + K1·p0) / (attempts_b + K1)       K1 = 10
//   L2  lead     p  = (answered_lb + K2·p1) / (attempts_lb + K2)     K2 = 8
//
// On K2: a lead accumulates maybe three to ten attempts across all 168 buckets,
// so their per-bucket count is almost always 0 or 1. K2 was originally 3, which
// still let a single lucky answer (1-for-1 → 0.58) outrank a bucket answering
// 30 of 50 (→ 0.56). Shrinkage had stopped the naive "100% on Tuesdays" but not
// the ranking flip, which is the outcome that actually matters. At K2 = 8 one
// observation is a nudge rather than a driver.
//
// The honest consequence: with realistic volumes the ACCOUNT pattern dominates
// and per-lead history only breaks near-ties. That is the correct reading of
// the data — you cannot personalize a 168-bucket distribution from five
// samples. The one thing that genuinely overrides the model is an explicit
// request from the lead, and that bypasses this file entirely (see
// sales_followups.exact_time_requested).
//
// Everything here is pure and deterministic. No model is consulted about when
// to call anyone — the LLM's opinion about scheduling is not evidence.
// ─────────────────────────────────────────────────────────────────────────────

import type { SalesCallPolicy } from './types.ts';

/** Prior strength of the account-wide bucket rate, in pseudo-observations. */
export const K_BUCKET = 10;
/** Prior strength of the lead's own bucket history, in pseudo-observations. */
export const K_LEAD = 8;
/**
 * Below this many account-wide attempts there is nothing to learn from, and
 * reporting a percentage would be fabricating precision. The UI shows a
 * "still learning" state instead.
 */
export const MIN_ATTEMPTS_FOR_MODEL = 20;

export interface BucketStat {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Local hour, 0-23. */
  hour: number;
  attempts: number;
  answered: number;
}

export interface RankedWindow {
  weekday: number;
  hour: number;
  /** Shrunk P(answer). Never a raw rate. */
  probability: number;
  /** 0-1. How much of this estimate comes from data rather than the prior. */
  confidence: number;
  /** Observations behind it: lead attempts + account attempts in this bucket. */
  sampleSize: number;
}

export interface TimingModel {
  status: 'learning' | 'ready';
  /** Account-wide answer rate, Laplace-smoothed. */
  globalRate: number;
  totalAttempts: number;
  /** Permitted buckets, best first. Empty when status is 'learning'. */
  windows: RankedWindow[];
}

const key = (weekday: number, hour: number) => `${weekday}:${hour}`;

function indexBuckets(stats: BucketStat[]): Map<string, BucketStat> {
  const map = new Map<string, BucketStat>();
  for (const s of stats) {
    const k = key(s.weekday, s.hour);
    const prev = map.get(k);
    if (prev) {
      prev.attempts += s.attempts;
      prev.answered += s.answered;
    } else {
      map.set(k, { ...s });
    }
  }
  return map;
}

/**
 * The three-level shrunk estimate for one bucket. Exported so the tests can
 * pin the math directly rather than inferring it from a ranking.
 */
export function shrinkageEstimate(params: {
  leadAttempts: number;
  leadAnswered: number;
  bucketAttempts: number;
  bucketAnswered: number;
  globalRate: number;
}): { probability: number; confidence: number; sampleSize: number } {
  const { leadAttempts, leadAnswered, bucketAttempts, bucketAnswered, globalRate } = params;

  const bucketRate = (bucketAnswered + K_BUCKET * globalRate) / (bucketAttempts + K_BUCKET);
  const probability = (leadAnswered + K_LEAD * bucketRate) / (leadAttempts + K_LEAD);

  // Confidence is how much of the posterior mass is observation rather than
  // prior — not the point estimate. A bucket can have a high probability and
  // near-zero confidence, and the UI must be able to tell those apart.
  const observed = leadAttempts + bucketAttempts;
  const confidence = observed / (observed + K_LEAD + K_BUCKET);

  return {
    probability: Math.min(1, Math.max(0, probability)),
    confidence: Math.min(1, Math.max(0, confidence)),
    sampleSize: observed,
  };
}

function parseHour(value: string, fallback: number): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!m) return { hour: fallback, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(m[1]))),
    minute: Math.min(59, Math.max(0, Number(m[2]))),
  };
}

/**
 * The (weekday, hour) pairs the calling policy actually permits. Ranking a
 * bucket the gate would refuse anyway is noise — worse, it invites someone to
 * widen the policy to chase a number.
 */
export function permittedBuckets(policy: SalesCallPolicy): { weekday: number; hour: number }[] {
  const start = parseHour(policy.windowStart, 9);
  const rawEnd = parseHour(policy.windowEnd, 17);
  const startMinutes = start.hour * 60 + start.minute;
  let endMinutes = rawEnd.hour * 60 + rawEnd.minute;
  // Same clamp as nextPermittedSlot: a wrapping window is a misconfiguration.
  if (endMinutes <= startMinutes) endMinutes = 23 * 60 + 59;

  const firstHour = Math.floor(startMinutes / 60);
  const lastHour = endMinutes % 60 === 0 ? endMinutes / 60 - 1 : Math.floor(endMinutes / 60);

  const out: { weekday: number; hour: number }[] = [];
  for (const weekday of policy.allowedDays ?? []) {
    if (weekday < 1 || weekday > 7) continue;
    for (let hour = firstHour; hour <= lastHour; hour++) out.push({ weekday, hour });
  }
  return out;
}

/**
 * Rank the permitted calling windows for one lead, best first.
 *
 * Returns status 'learning' — and no windows — until the account has enough
 * attempts for the estimates to mean anything. Callers fall back to the policy
 * window in that case rather than showing an invented percentage.
 */
export function scoreCallWindows(params: {
  leadStats: BucketStat[];
  userStats: BucketStat[];
  policy: SalesCallPolicy;
  limit?: number;
}): TimingModel {
  const { leadStats, userStats, policy, limit = 5 } = params;

  const userIndex = indexBuckets(userStats);
  const leadIndex = indexBuckets(leadStats);

  let totalAttempts = 0;
  let totalAnswered = 0;
  for (const s of userIndex.values()) {
    totalAttempts += s.attempts;
    totalAnswered += s.answered;
  }
  const globalRate = (totalAnswered + 1) / (totalAttempts + 2);

  if (totalAttempts < MIN_ATTEMPTS_FOR_MODEL) {
    return { status: 'learning', globalRate, totalAttempts, windows: [] };
  }

  const windows: RankedWindow[] = permittedBuckets(policy).map(({ weekday, hour }) => {
    const k = key(weekday, hour);
    const bucket = userIndex.get(k);
    const lead = leadIndex.get(k);
    const est = shrinkageEstimate({
      leadAttempts: lead?.attempts ?? 0,
      leadAnswered: lead?.answered ?? 0,
      bucketAttempts: bucket?.attempts ?? 0,
      bucketAnswered: bucket?.answered ?? 0,
      globalRate,
    });
    return { weekday, hour, ...est };
  });

  // Probability first; ties broken by evidence, so a well-sampled bucket beats
  // a bucket sitting on the prior. Then by earliest slot for determinism.
  windows.sort(
    (a, b) =>
      b.probability - a.probability ||
      b.sampleSize - a.sampleSize ||
      a.weekday - b.weekday ||
      a.hour - b.hour,
  );

  return { status: 'ready', globalRate, totalAttempts, windows: windows.slice(0, limit) };
}

/**
 * The next instant matching a ranked window, at or after `from`, in `timeZone`.
 * Used to turn "Thursday 15:00 is best" into an actual run_at. Searches two
 * weeks and gives up, so a nonsense window cannot spin.
 */
export function nextInstantForWindow(
  from: Date,
  window: { weekday: number; hour: number },
  timeZone: string,
  localPartsFn: (d: Date, tz: string) => { year: number; month: number; day: number; weekday: number },
  zonedTimeToUtcFn: (y: number, m: number, d: number, hh: number, mm: number, tz: string) => Date,
): Date | null {
  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const probe = new Date(from.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const p = localPartsFn(probe, timeZone);
    if (p.weekday !== window.weekday) continue;
    const at = zonedTimeToUtcFn(p.year, p.month, p.day, window.hour, 0, timeZone);
    if (at.getTime() >= from.getTime()) return at;
  }
  return null;
}
