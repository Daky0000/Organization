// ─────────────────────────────────────────────────────────────────────────────
// The compliance gate.
//
// Nothing dials without passing through decideCallAction. It is pure — no DB,
// no clock, no I/O — because it is the one place where getting it wrong is a
// legal problem rather than a bug, and it must be exhaustively testable.
//
// The decision ORDER is the specification, not an implementation detail: the
// unit tests assert it branch by branch. A stop always outranks a reschedule,
// and a hard prohibition (DNC, consent) always outranks a soft one (call caps).
//
// Timezone arithmetic uses Intl.DateTimeFormat rather than a date library, so
// this stays dependency-free. All wall-clock reasoning happens in the LEAD's
// timezone — calling someone at 9am *our* time is not the promise being made.
// ─────────────────────────────────────────────────────────────────────────────

import type { SalesCallPolicy } from './types.ts';

export type BlockCode =
  | 'disabled'
  | 'no_phone'
  | 'do_not_call'
  | 'no_consent'
  | 'human_handling'
  | 'exhausted'
  | 'attempt_cap'
  | 'daily_cap'
  | 'no_window';

export type RescheduleReason = 'honoring_followup' | 'outside_hours' | 'min_gap';

export type CallDecision =
  | { action: 'call' }
  | { action: 'reschedule'; runAt: Date; reason: RescheduleReason }
  | { action: 'stop'; code: BlockCode; reason: string };

export interface GateLead {
  phone: string | null;
  doNotCall: boolean;
  consentAt: Date | null;
  timezone: string | null;
  humanHandling: boolean;
  consecutiveNoAnswer: number;
}

export interface GateInput {
  now: Date;
  policy: SalesCallPolicy;
  lead: GateLead;
  /** Attempts in the trailing 7 days, newest first or any order. */
  recentAttempts: { startedAt: Date; outcome: string | null }[];
  /** Calls this user has already placed today, across all leads. */
  callsMadeToday: number;
  pendingFollowUp: { scheduledFor: Date; exactTimeRequested: boolean } | null;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** If the next permitted slot is within this, just call now. */
const DIAL_NOW_TOLERANCE_MS = 60 * 1000;
/** nextPermittedSlot must terminate even under a pathological policy. */
const MAX_SEARCH_DAYS = 60;

// ─── Timezone helpers ────────────────────────────────────────────────────────

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/** Wall-clock parts of an instant, as seen in `timeZone`. */
export function localParts(date: Date, timeZone: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    }).formatToParts(date);
  } catch {
    // An invalid IANA name must not take the worker down; fall back to UTC.
    return localParts(date, 'UTC');
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // hourCycle h23 still emits "24" for midnight in some ICU builds.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: ISO_WEEKDAY[get('weekday')] ?? 1,
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Round to the second — formatToParts drops milliseconds.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads the given local
 * time. Two passes: guess by treating the wall time as UTC, then correct using
 * the offset that actually applies at the guessed instant. The second pass is
 * what makes DST transitions come out right.
 */
export function zonedTimeToUtc(
  y: number, m: number, d: number, hh: number, mm: number, timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const firstOffset = tzOffsetMs(new Date(wallAsUtc), timeZone);
  let ts = wallAsUtc - firstOffset;
  const secondOffset = tzOffsetMs(new Date(ts), timeZone);
  if (secondOffset !== firstOffset) ts = wallAsUtc - secondOffset;
  return new Date(ts);
}

function parseHHMM(value: string, fallbackHour: number): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return { hour: fallbackHour, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute };
}

function toDateKey(p: LocalParts): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// ─── Next permitted slot ─────────────────────────────────────────────────────

/**
 * The earliest instant at or after `from` that satisfies the policy's allowed
 * days, calling window and blackout dates, evaluated in `timeZone`.
 *
 * Returns null when the policy admits no slot within MAX_SEARCH_DAYS — an empty
 * allowedDays list, or a blackout run longer than the horizon. The caller turns
 * that into a stop rather than looping forever.
 *
 * A window whose end is at or before its start (e.g. 22:00–02:00) is clamped to
 * end at 23:59 on the same local day rather than wrapping past midnight.
 * Wrapping is almost always a misconfiguration, and silently calling people at
 * 1am is a far worse failure than refusing to.
 */
export function nextPermittedSlot(
  from: Date,
  policy: SalesCallPolicy,
  timeZone: string,
): Date | null {
  const allowed = new Set((policy.allowedDays ?? []).filter((d) => d >= 1 && d <= 7));
  if (allowed.size === 0) return null;

  const blackout = new Set(policy.blackoutDates ?? []);
  const start = parseHHMM(policy.windowStart, 9);
  const rawEnd = parseHHMM(policy.windowEnd, 17);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = rawEnd.hour * 60 + rawEnd.minute;
  const end = endMinutes <= startMinutes ? { hour: 23, minute: 59 } : rawEnd;

  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_DAYS; dayOffset++) {
    // Step in local terms by advancing the instant a day at a time and
    // re-reading the wall clock, so DST shifts don't accumulate drift.
    const probe = new Date(from.getTime() + dayOffset * MS_PER_DAY);
    const p = localParts(probe, timeZone);
    if (!allowed.has(p.weekday)) continue;
    if (blackout.has(toDateKey(p))) continue;

    const windowOpen = zonedTimeToUtc(p.year, p.month, p.day, start.hour, start.minute, timeZone);
    const windowClose = zonedTimeToUtc(p.year, p.month, p.day, end.hour, end.minute, timeZone);

    if (from.getTime() <= windowOpen.getTime()) return windowOpen;
    if (from.getTime() < windowClose.getTime()) return new Date(from.getTime());
    // Past today's close — keep searching from tomorrow.
  }
  return null;
}

// ─── The gate ────────────────────────────────────────────────────────────────

/**
 * Decide whether this lead may be called right now.
 *
 * Order is the specification:
 *   1  policy disabled          → stop
 *   2  no phone number          → stop
 *   3  do-not-call              → stop
 *   4  consent required, absent → stop
 *   5  a human took over        → stop
 *   6  no-answer streak spent   → stop
 *   7  weekly attempt cap hit   → stop
 *   8  daily call cap hit       → stop
 *   9  minimum gap since last attempt not elapsed → earliest moves
 *  10  a follow-up obligation exists            → earliest moves
 *  11  outside the permitted window / blackout  → reschedule
 *  12  otherwise                                → call
 */
export function decideCallAction(input: GateInput): CallDecision {
  const { now, policy, lead, recentAttempts, callsMadeToday, pendingFollowUp } = input;
  const tz = lead.timezone || policy.defaultTimezone || 'UTC';

  if (!policy.enabled) {
    return { action: 'stop', code: 'disabled', reason: 'Outbound calling is turned off for this account' };
  }
  if (!lead.phone || !String(lead.phone).trim()) {
    return { action: 'stop', code: 'no_phone', reason: 'Lead has no phone number' };
  }
  if (lead.doNotCall) {
    return { action: 'stop', code: 'do_not_call', reason: 'Lead is on the do-not-call list' };
  }
  if (policy.requireConsent && !lead.consentAt) {
    return { action: 'stop', code: 'no_consent', reason: 'No recorded consent to call this lead' };
  }
  if (lead.humanHandling) {
    return { action: 'stop', code: 'human_handling', reason: 'A person is handling this lead' };
  }
  if (lead.consecutiveNoAnswer >= policy.maxConsecutiveNoAnswer) {
    return {
      action: 'stop',
      code: 'exhausted',
      reason: `${lead.consecutiveNoAnswer} consecutive no-answers (limit ${policy.maxConsecutiveNoAnswer})`,
    };
  }

  const weekAgo = now.getTime() - 7 * MS_PER_DAY;
  const attemptsThisWeek = recentAttempts.filter((a) => a.startedAt.getTime() >= weekAgo);
  if (attemptsThisWeek.length >= policy.maxAttemptsPerLeadPerWeek) {
    return {
      action: 'stop',
      code: 'attempt_cap',
      reason: `${attemptsThisWeek.length} attempts in the last 7 days (limit ${policy.maxAttemptsPerLeadPerWeek})`,
    };
  }
  if (callsMadeToday >= policy.dailyCallCap) {
    return {
      action: 'stop',
      code: 'daily_cap',
      reason: `Daily cap of ${policy.dailyCallCap} calls reached`,
    };
  }

  // From here the answer is "yes, but possibly later". Accumulate the earliest
  // instant every soft constraint permits, then snap that to the calling window
  // once at the end — snapping per-constraint would ping-pong between rules.
  let earliest = now;
  let reason: RescheduleReason = 'outside_hours';

  const lastAttempt = recentAttempts.reduce<Date | null>(
    (acc, a) => (!acc || a.startedAt > acc ? a.startedAt : acc),
    null,
  );
  if (lastAttempt) {
    const gapBoundary = new Date(lastAttempt.getTime() + policy.minHoursBetweenAttempts * MS_PER_HOUR);
    if (gapBoundary > earliest) {
      earliest = gapBoundary;
      reason = 'min_gap';
    }
  }

  if (pendingFollowUp && pendingFollowUp.scheduledFor > earliest) {
    // An explicit obligation. Note this is the only thing the timing model is
    // never allowed to override — but the compliance window still applies,
    // because "the lead asked for 8pm Sunday" does not make 8pm Sunday legal.
    earliest = pendingFollowUp.scheduledFor;
    reason = 'honoring_followup';
  }

  const slot = nextPermittedSlot(earliest, policy, tz);
  if (!slot) {
    return {
      action: 'stop',
      code: 'no_window',
      reason: 'Calling policy admits no permitted window in the next 60 days',
    };
  }
  if (slot.getTime() <= now.getTime() + DIAL_NOW_TOLERANCE_MS) {
    return { action: 'call' };
  }
  return { action: 'reschedule', runAt: slot, reason };
}

/**
 * The (weekday, hour) bucket a dial belongs to, in the lead's local time.
 * Denormalized onto sales_call_attempts at dial time so the stats rollup is a
 * plain GROUP BY instead of 100k timezone conversions.
 */
export function localBucket(at: Date, timeZone: string): { weekday: number; hour: number } {
  const p = localParts(at, timeZone);
  return { weekday: p.weekday, hour: p.hour };
}
