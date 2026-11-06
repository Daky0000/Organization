import test from 'node:test';
import assert from 'node:assert/strict';

// config.ts validates env at import time and the sales modules transitively
// import the logger, so env must be set before the dynamic import.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { decideCallAction, nextPermittedSlot, localBucket, localParts, zonedTimeToUtc } =
  await import('../src/server/sales/callPolicy.ts');
const { DEFAULT_CALL_POLICY } = await import('../src/server/sales/types.ts');

type Policy = typeof DEFAULT_CALL_POLICY;

/** An account that has turned calling on and does not require consent. */
function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    ...DEFAULT_CALL_POLICY,
    enabled: true,
    requireConsent: false,
    defaultTimezone: 'UTC',
    ...overrides,
  };
}

function lead(overrides: Partial<Parameters<typeof decideCallAction>[0]['lead']> = {}) {
  return {
    phone: '+233200000000',
    doNotCall: false,
    consentAt: null,
    timezone: 'UTC',
    humanHandling: false,
    consecutiveNoAnswer: 0,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof decideCallAction>[0]> = {}) {
  return {
    // Wednesday 2026-08-12, 10:00 UTC — inside the default Mon-Fri 09:00-17:00.
    now: new Date('2026-08-12T10:00:00Z'),
    policy: policy(),
    lead: lead(),
    recentAttempts: [],
    callsMadeToday: 0,
    pendingFollowUp: null,
    ...overrides,
  };
}

// ─── Decision order ──────────────────────────────────────────────────────────
// The order is the specification. Each test pins one rung of the ladder and
// deliberately makes a LOWER-priority rule also true, so a reordering fails.

test('a healthy lead inside the window is called', () => {
  const d = decideCallAction(input());
  assert.equal(d.action, 'call');
});

test('a disabled policy stops before anything else is considered', () => {
  const d = decideCallAction(input({ policy: policy({ enabled: false }), lead: lead({ doNotCall: true }) }));
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'disabled');
});

test('a lead with no phone number is stopped', () => {
  const d = decideCallAction(input({ lead: lead({ phone: null }) }));
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'no_phone');
});

test('do-not-call outranks every soft limit', () => {
  const d = decideCallAction(
    input({
      lead: lead({ doNotCall: true, consecutiveNoAnswer: 99 }),
      callsMadeToday: 9999,
    }),
  );
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'do_not_call');
});

test('missing consent stops when the policy requires it', () => {
  const d = decideCallAction(input({ policy: policy({ requireConsent: true }) }));
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'no_consent');
});

test('recorded consent satisfies the consent requirement', () => {
  const d = decideCallAction(
    input({ policy: policy({ requireConsent: true }), lead: lead({ consentAt: new Date('2026-01-01T00:00:00Z') }) }),
  );
  assert.equal(d.action, 'call');
});

test('a human handling the lead stops the agent', () => {
  const d = decideCallAction(input({ lead: lead({ humanHandling: true }) }));
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'human_handling');
});

test('a spent no-answer streak stops before the weekly cap is examined', () => {
  const d = decideCallAction(
    input({
      policy: policy({ maxConsecutiveNoAnswer: 4, maxAttemptsPerLeadPerWeek: 1 }),
      lead: lead({ consecutiveNoAnswer: 4 }),
      recentAttempts: [{ startedAt: new Date('2026-08-11T10:00:00Z'), outcome: 'no_answer' }],
    }),
  );
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'exhausted');
});

test('the weekly attempt cap counts only the trailing seven days', () => {
  const old = { startedAt: new Date('2026-08-01T10:00:00Z'), outcome: 'no_answer' };
  const recent = { startedAt: new Date('2026-08-10T10:00:00Z'), outcome: 'no_answer' };

  const capped = decideCallAction(
    input({ policy: policy({ maxAttemptsPerLeadPerWeek: 1 }), recentAttempts: [recent] }),
  );
  assert.equal(capped.action, 'stop');
  assert.equal(capped.code, 'attempt_cap');

  // The same attempt, but 11 days back, must not count.
  const notCapped = decideCallAction(
    input({ policy: policy({ maxAttemptsPerLeadPerWeek: 1, minHoursBetweenAttempts: 0 }), recentAttempts: [old] }),
  );
  assert.equal(notCapped.action, 'call');
});

test('the daily cap stops the call', () => {
  const d = decideCallAction(input({ policy: policy({ dailyCallCap: 10 }), callsMadeToday: 10 }));
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'daily_cap');
});

// ─── Rescheduling ────────────────────────────────────────────────────────────

test('the minimum gap between attempts pushes the call out', () => {
  const d = decideCallAction(
    input({
      policy: policy({ minHoursBetweenAttempts: 24, maxAttemptsPerLeadPerWeek: 5 }),
      recentAttempts: [{ startedAt: new Date('2026-08-12T09:00:00Z'), outcome: 'no_answer' }],
    }),
  );
  assert.equal(d.action, 'reschedule');
  assert.equal(d.reason, 'min_gap');
  // 09:00 + 24h = Thursday 09:00, which is exactly when the window opens.
  assert.equal(d.runAt.toISOString(), '2026-08-13T09:00:00.000Z');
});

test('a future follow-up obligation is honoured', () => {
  const d = decideCallAction(
    input({
      pendingFollowUp: { scheduledFor: new Date('2026-08-13T15:00:00Z'), exactTimeRequested: true },
    }),
  );
  assert.equal(d.action, 'reschedule');
  assert.equal(d.reason, 'honoring_followup');
  assert.equal(d.runAt.toISOString(), '2026-08-13T15:00:00.000Z');
});

test('a follow-up outside the calling window is snapped into it', () => {
  // The lead asked for 22:00; policy allows 09:00-17:00. Compliance wins, but
  // only over the CLOCK — the obligation itself is still honoured, next morning.
  const d = decideCallAction(
    input({
      pendingFollowUp: { scheduledFor: new Date('2026-08-13T22:00:00Z'), exactTimeRequested: true },
    }),
  );
  assert.equal(d.action, 'reschedule');
  assert.equal(d.runAt.toISOString(), '2026-08-14T09:00:00.000Z');
});

test('a call before the window opens waits for opening time', () => {
  const d = decideCallAction(input({ now: new Date('2026-08-12T06:30:00Z') }));
  assert.equal(d.action, 'reschedule');
  assert.equal(d.reason, 'outside_hours');
  assert.equal(d.runAt.toISOString(), '2026-08-12T09:00:00.000Z');
});

test('a call after the window closes rolls to the next allowed day', () => {
  // Friday 18:00 → skips the weekend to Monday 09:00.
  const d = decideCallAction(input({ now: new Date('2026-08-14T18:00:00Z') }));
  assert.equal(d.action, 'reschedule');
  assert.equal(d.runAt.toISOString(), '2026-08-17T09:00:00.000Z');
});

test('a blackout date is skipped', () => {
  const d = decideCallAction(
    input({ now: new Date('2026-08-12T06:00:00Z'), policy: policy({ blackoutDates: ['2026-08-12'] }) }),
  );
  assert.equal(d.action, 'reschedule');
  assert.equal(d.runAt.toISOString(), '2026-08-13T09:00:00.000Z');
});

test('the window is evaluated in the lead\'s timezone, not the server\'s', () => {
  // 20:00 UTC is outside 09:00-17:00 UTC, but it is 15:00 in New York.
  const d = decideCallAction(
    input({ now: new Date('2026-08-12T19:00:00Z'), lead: lead({ timezone: 'America/New_York' }) }),
  );
  assert.equal(d.action, 'call');
});

// ─── nextPermittedSlot ───────────────────────────────────────────────────────

test('an empty allowed-days list admits no window rather than looping', () => {
  const slot = nextPermittedSlot(new Date('2026-08-12T10:00:00Z'), policy({ allowedDays: [] }), 'UTC');
  assert.equal(slot, null);
});

test('a blackout longer than the search horizon terminates', () => {
  const blackout: string[] = [];
  for (let i = 0; i < 100; i++) {
    blackout.push(new Date(Date.UTC(2026, 7, 12) + i * 86400000).toISOString().slice(0, 10));
  }
  const slot = nextPermittedSlot(new Date('2026-08-12T10:00:00Z'), policy({ blackoutDates: blackout }), 'UTC');
  assert.equal(slot, null);
});

test('a policy with no permitted window stops rather than rescheduling', () => {
  const d = decideCallAction(input({ policy: policy({ allowedDays: [] }) }));
  assert.equal(d.action, 'stop');
  assert.equal(d.code, 'no_window');
});

test('a window whose end precedes its start is clamped, never wrapped past midnight', () => {
  // 22:00-02:00 is almost certainly a misconfiguration. Clamping to 23:59 keeps
  // calls in the evening; wrapping would dial people at 1am.
  const p = policy({ windowStart: '22:00', windowEnd: '02:00' });
  const slot = nextPermittedSlot(new Date('2026-08-12T23:00:00Z'), p, 'UTC');
  assert.ok(slot);
  assert.equal(slot!.toISOString(), '2026-08-12T23:00:00.000Z');

  // At 03:00 the clamped window has closed; the next open is 22:00 the same day.
  const next = nextPermittedSlot(new Date('2026-08-12T03:00:00Z'), p, 'UTC');
  assert.equal(next!.toISOString(), '2026-08-12T22:00:00.000Z');
});

test('a DST spring-forward boundary produces the correct local opening time', () => {
  // US DST begins 2026-03-08. On the 9th, 09:00 New York is 13:00 UTC (EDT),
  // where before the transition it would have been 14:00 UTC (EST).
  const slot = nextPermittedSlot(
    new Date('2026-03-09T02:00:00Z'),
    policy({ defaultTimezone: 'America/New_York' }),
    'America/New_York',
  );
  assert.ok(slot);
  assert.equal(slot!.toISOString(), '2026-03-09T13:00:00.000Z');
  assert.equal(localParts(slot!, 'America/New_York').hour, 9);
});

test('zonedTimeToUtc round-trips through localParts', () => {
  const at = zonedTimeToUtc(2026, 11, 3, 14, 30, 'Africa/Accra');
  const parts = localParts(at, 'Africa/Accra');
  assert.equal(parts.year, 2026);
  assert.equal(parts.month, 11);
  assert.equal(parts.day, 3);
  assert.equal(parts.hour, 14);
  assert.equal(parts.minute, 30);
});

test('an invalid timezone falls back to UTC instead of throwing', () => {
  const parts = localParts(new Date('2026-08-12T10:00:00Z'), 'Not/AZone');
  assert.equal(parts.hour, 10);
});

test('localBucket reports ISO weekday and local hour', () => {
  // 2026-08-12 is a Wednesday.
  const bucket = localBucket(new Date('2026-08-12T15:00:00Z'), 'UTC');
  assert.deepEqual(bucket, { weekday: 3, hour: 15 });
});
