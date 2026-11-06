// ─────────────────────────────────────────────────────────────────────────────
// AI Sales OS — shared vocabularies.
//
// Every analytical dimension is a closed set of codes. This is not stylistic:
// free text cannot be aggregated, and "too expensive" / "budget is tight" /
// "price is a bit high" must land in one bar on the Sales Intelligence
// dashboard. Each code is paired at the storage layer with a raw-text field so
// the lead's actual words survive.
//
// These arrays are the single source of truth and appear in three places that
// must stay in sync:
//   1. the CHECK constraints in db-migrations.ts (createSalesTables)
//   2. the Analyst agent's JSON schema (analystAgent.ts) — the enum is what
//      stops the model inventing a twelfth objection code
//   3. the frontend mirror in packages/web/src/services/salesService.ts
//      (this repo has no shared types package)
// ─────────────────────────────────────────────────────────────────────────────

export const OBJECTION_CODES = [
  'price',
  'budget',
  'timing',
  'no_authority',
  'existing_provider',
  'no_need',
  'trust',
  'missing_feature',
  'contract_lock_in',
  'bad_experience',
  'other',
] as const;
export type ObjectionCode = (typeof OBJECTION_CODES)[number];

export const OBJECTION_LABELS: Record<ObjectionCode, string> = {
  price: 'Price too high',
  budget: 'No budget right now',
  timing: 'Bad timing',
  no_authority: 'Needs approval from someone else',
  existing_provider: 'Already has a provider',
  no_need: 'Sees no need',
  trust: 'Trust / credibility concern',
  missing_feature: 'Missing a required feature',
  contract_lock_in: 'Locked into a contract',
  bad_experience: 'Prior bad experience',
  other: 'Other',
};

export const INTENTS = [
  'interested',
  'needs_info',
  'callback_requested',
  'meeting_booked',
  'undecided',
  'not_interested',
  'wrong_number',
  'do_not_call',
] as const;
export type Intent = (typeof INTENTS)[number];

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const LEAD_STAGES = [
  'new',
  'contacted',
  'qualified',
  'interested',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'unreachable',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const ATTEMPT_OUTCOMES = [
  'answered',
  'no_answer',
  'busy',
  'voicemail',
  'rejected',
  'invalid_number',
  'failed',
  'blocked',
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

// Outcomes that mean a human picked up and engaged. Only these count as a
// success in the best-time-to-call model — voicemail is not an answer.
export const ANSWERED_OUTCOMES: readonly AttemptOutcome[] = ['answered'];

// Outcomes that say something about *timing* rather than about the lead. A
// rejection at 8am is evidence about that hour; an invalid number is not
// evidence about anything, so it is excluded from the timing model entirely.
export const TIMING_SIGNAL_OUTCOMES: readonly AttemptOutcome[] = [
  'answered',
  'no_answer',
  'busy',
  'voicemail',
  'rejected',
];

export const FOLLOWUP_TYPES = ['phone_call', 'email', 'sms', 'task'] as const;
export type FollowUpType = (typeof FOLLOWUP_TYPES)[number];

export const FOLLOWUP_STATUSES = [
  'scheduled',
  'due',
  'in_progress',
  'completed',
  'cancelled',
  'missed',
] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export const RECOMMENDED_ACTIONS = [
  'follow_up_call',
  'send_info',
  'book_meeting',
  'human_handoff',
  'nurture',
  'disqualify',
  'none',
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const ATTEMPT_STATUSES = [
  'queued',
  'dialing',
  'in_progress',
  'completed',
  'cancelled',
  'blocked',
  'failed',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const PLAYBOOK_KINDS = [
  'objection_response',
  'pitch',
  'question',
  'faq',
  'disqualifier',
] as const;
export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number];

export const INSIGHT_KINDS = ['objection_pattern', 'timing', 'script', 'segment', 'risk'] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

// ─── Runtime guards ──────────────────────────────────────────────────────────
// Used by the op validator and the analyst parser. Anything arriving from a
// model or an HTTP body goes through one of these before it reaches SQL.

export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export const isObjectionCode = (v: unknown): v is ObjectionCode => isOneOf(OBJECTION_CODES, v);
export const isIntent = (v: unknown): v is Intent => isOneOf(INTENTS, v);
export const isSentiment = (v: unknown): v is Sentiment => isOneOf(SENTIMENTS, v);
export const isLeadStage = (v: unknown): v is LeadStage => isOneOf(LEAD_STAGES, v);
export const isFollowUpType = (v: unknown): v is FollowUpType => isOneOf(FOLLOWUP_TYPES, v);
export const isAttemptOutcome = (v: unknown): v is AttemptOutcome => isOneOf(ATTEMPT_OUTCOMES, v);
export const isRecommendedAction = (v: unknown): v is RecommendedAction =>
  isOneOf(RECOMMENDED_ACTIONS, v);

// ─── Policy shape ────────────────────────────────────────────────────────────
// The compliance gate reads this and nothing else. Mirrors sales_call_policies.

export interface SalesCallPolicy {
  enabled: boolean;
  requireConsent: boolean;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  allowedDays: number[];
  /** 'HH:MM' in the lead's local time. */
  windowStart: string;
  windowEnd: string;
  defaultTimezone: string;
  maxAttemptsPerLeadPerWeek: number;
  maxConsecutiveNoAnswer: number;
  minHoursBetweenAttempts: number;
  dailyCallCap: number;
  aiDisclosureRequired: boolean;
  aiDisclosureText: string | null;
  recordingDisclosureRequired: boolean;
  /** 'YYYY-MM-DD' dates on which no calls may be placed. */
  blackoutDates: string[];
  requireApprovalFor: string[];
  provider: string;
  fromNumber: string | null;
  voiceId: string | null;
  maxCallDurationSec: number;
}

export const DEFAULT_CALL_POLICY: SalesCallPolicy = {
  // Conservative by construction: a fresh account cannot autodial anyone until
  // a human turns this on, and consent is required until they say otherwise.
  enabled: false,
  requireConsent: true,
  allowedDays: [1, 2, 3, 4, 5],
  windowStart: '09:00',
  windowEnd: '17:00',
  defaultTimezone: 'Africa/Accra',
  maxAttemptsPerLeadPerWeek: 2,
  maxConsecutiveNoAnswer: 4,
  minHoursBetweenAttempts: 24,
  dailyCallCap: 50,
  aiDisclosureRequired: true,
  aiDisclosureText: null,
  recordingDisclosureRequired: true,
  blackoutDates: [],
  requireApprovalFor: ['set_do_not_call', 'link_deal'],
  provider: 'simulator',
  fromNumber: null,
  voiceId: null,
  maxCallDurationSec: 420,
};

/** Maps a sales_call_policies row onto the shape the gate consumes. */
export function policyFromRow(row: Record<string, any> | undefined | null): SalesCallPolicy {
  if (!row) return { ...DEFAULT_CALL_POLICY };
  const days = Array.isArray(row.allowed_days)
    ? row.allowed_days.map(Number).filter((d: number) => d >= 1 && d <= 7)
    : DEFAULT_CALL_POLICY.allowedDays;
  return {
    enabled: row.enabled ?? DEFAULT_CALL_POLICY.enabled,
    requireConsent: row.require_consent ?? DEFAULT_CALL_POLICY.requireConsent,
    allowedDays: days.length ? days : DEFAULT_CALL_POLICY.allowedDays,
    windowStart: String(row.window_start ?? DEFAULT_CALL_POLICY.windowStart).slice(0, 5),
    windowEnd: String(row.window_end ?? DEFAULT_CALL_POLICY.windowEnd).slice(0, 5),
    defaultTimezone: row.default_timezone || DEFAULT_CALL_POLICY.defaultTimezone,
    maxAttemptsPerLeadPerWeek: Number(row.max_attempts_per_lead_per_week ?? DEFAULT_CALL_POLICY.maxAttemptsPerLeadPerWeek),
    maxConsecutiveNoAnswer: Number(row.max_consecutive_no_answer ?? DEFAULT_CALL_POLICY.maxConsecutiveNoAnswer),
    minHoursBetweenAttempts: Number(row.min_hours_between_attempts ?? DEFAULT_CALL_POLICY.minHoursBetweenAttempts),
    dailyCallCap: Number(row.daily_call_cap ?? DEFAULT_CALL_POLICY.dailyCallCap),
    aiDisclosureRequired: row.ai_disclosure_required ?? true,
    aiDisclosureText: row.ai_disclosure_text ?? null,
    recordingDisclosureRequired: row.recording_disclosure_required ?? true,
    blackoutDates: Array.isArray(row.blackout_dates) ? row.blackout_dates.map(String) : [],
    requireApprovalFor: Array.isArray(row.require_approval_for)
      ? row.require_approval_for.map(String)
      : DEFAULT_CALL_POLICY.requireApprovalFor,
    provider: row.provider || DEFAULT_CALL_POLICY.provider,
    fromNumber: row.from_number ?? null,
    voiceId: row.voice_id ?? null,
    maxCallDurationSec: Number(row.max_call_duration_sec ?? DEFAULT_CALL_POLICY.maxCallDurationSec),
  };
}
