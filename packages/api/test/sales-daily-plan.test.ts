import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { classifyLead, rankQueue, parsePlan, rulePlan, QUEUE_REASONS } = await import('../src/server/sales/dailyPlan.ts');

const TZ = 'Africa/Accra'; // UTC+0, no DST
const NOW = Date.parse('2026-11-09T10:00:00Z'); // Monday 10:00
const END_TODAY = Date.parse('2026-11-09T23:59:59.999Z');
const DAY = 24 * 3600_000;

const row = (over: Record<string, unknown> = {}) => ({
  contact_id: 'c1', first_name: 'Ama', last_name: 'Asante', phone: '233241000002', email: null,
  created_at: new Date(NOW - 3 * DAY).toISOString(), lists: ['July'],
  last_status: null, last_status_at: null, last_activity_at: null, last_note: null,
  max_round: null, attempts: 0, no_answer_streak: 0,
  followup_id: null, followup_at: null, followup_reason: null, followup_channel: null, followup_needs_confirmation: null,
  ...over,
});

test('never-contacted lead is new; paid and not interested are dropped', () => {
  assert.equal(classifyLead(row(), NOW, END_TODAY, TZ)?.reason, 'new');
  const at = new Date(NOW - 2 * DAY).toISOString();
  assert.equal(classifyLead(row({ last_status: 'paid', last_status_at: at, last_activity_at: at }), NOW, END_TODAY, TZ), null);
  assert.equal(classifyLead(row({ last_status: 'not_interested', last_status_at: at, last_activity_at: at }), NOW, END_TODAY, TZ), null);
});

test('open reminders win over the last outcome', () => {
  const at = new Date(NOW - 2 * DAY).toISOString();
  const overdue = classifyLead(row({
    last_status: 'not_interested', last_status_at: at, last_activity_at: at,
    followup_id: 'f1', followup_at: new Date(NOW - DAY).toISOString(), followup_reason: 'Call back for payment',
  }), NOW, END_TODAY, TZ);
  assert.equal(overdue?.reason, 'overdue');
  assert.match(overdue!.detail, /Call back for payment/);

  const today = classifyLead(row({ followup_id: 'f2', followup_at: new Date(NOW + 3 * 3600_000).toISOString() }), NOW, END_TODAY, TZ);
  assert.equal(today?.reason, 'due_today');
  assert.match(today!.detail, /13:00/);

  // Booked for a later day: not today's job.
  assert.equal(classifyLead(row({ followup_id: 'f3', followup_at: new Date(NOW + 2 * DAY).toISOString() }), NOW, END_TODAY, TZ), null);
});

test('leads already reached today are left alone; no-answers are retried', () => {
  const earlier = new Date(NOW - 3600_000).toISOString();
  assert.equal(classifyLead(row({ last_status: 'no_answer', last_status_at: earlier, last_activity_at: earlier }), NOW, END_TODAY, TZ), null);
  const yesterday = new Date(NOW - DAY).toISOString();
  const r = classifyLead(row({ last_status: 'no_answer', last_status_at: yesterday, last_activity_at: yesterday, no_answer_streak: 3, attempts: 3 }), NOW, END_TODAY, TZ);
  assert.equal(r?.reason, 'no_answer');
  assert.match(r!.detail, /3 times in a row/);
  assert.match(r!.detail, /yesterday/);
});

test('call_back, interested, registered map to their buckets', () => {
  const at = new Date(NOW - 3 * DAY).toISOString();
  const s = (status: string) => classifyLead(row({ last_status: status, last_status_at: at, last_activity_at: at }), NOW, END_TODAY, TZ)?.reason;
  assert.equal(s('call_back'), 'call_back');
  assert.equal(s('interested'), 'interested');
  assert.equal(s('registered'), 'payment');
  assert.equal(s('unreachable'), 'unreachable');
});

test('next_round follows the highest logged round', () => {
  const at = new Date(NOW - DAY).toISOString();
  assert.equal(classifyLead(row({ last_status: 'call_back', last_status_at: at, last_activity_at: at, max_round: 4 }), NOW, END_TODAY, TZ)?.next_round, 5);
});

test('rankQueue puts reminders first, then warm leads, then retries, then new', () => {
  const at = new Date(NOW - 2 * DAY).toISOString();
  const items = [
    classifyLead(row({ contact_id: 'new' }), NOW, END_TODAY, TZ)!,
    classifyLead(row({ contact_id: 'na', last_status: 'no_answer', last_status_at: at, last_activity_at: at }), NOW, END_TODAY, TZ)!,
    classifyLead(row({ contact_id: 'int', last_status: 'interested', last_status_at: at, last_activity_at: at }), NOW, END_TODAY, TZ)!,
    classifyLead(row({ contact_id: 'due', followup_id: 'f', followup_at: new Date(NOW - 60_000).toISOString() }), NOW, END_TODAY, TZ)!,
  ];
  assert.deepEqual(rankQueue(items).map((i) => i.contact_id), ['due', 'int', 'na', 'new']);
});

function snapshot(counts: Partial<Record<string, number>>, remaining = 100) {
  const c = Object.fromEntries(QUEUE_REASONS.map((r) => [r, counts[r] ?? 0])) as any;
  c.needs_confirmation = counts.needs_confirmation ?? 0;
  c.total = QUEUE_REASONS.reduce((s, r) => s + c[r], 0);
  const buckets = Object.fromEntries(QUEUE_REASONS.map((r) => [r, [] as any[]])) as any;
  return {
    date: '2026-11-09', timezone: TZ, target: 100,
    progress: { calls: 100 - remaining, touches: 100 - remaining, responses: 0, conversions: 0, leads_reached: 0, remaining },
    counts: c, queue: [], buckets,
    ai: { available: false, notes_waiting: 0, notes_failed: 0, notes_skipped: 0 },
  };
}

test('rulePlan orders follow-ups first and fills the call target', () => {
  const plan = rulePlan(snapshot({ overdue: 2, call_back: 5, interested: 3, no_answer: 40, new: 30 }));
  assert.equal(plan.tasks[0].bucket, 'overdue');
  const total = plan.tasks.reduce((s, t) => s + (t.target_count ?? 0), 0);
  assert.equal(total, 100);
  assert.ok(plan.tasks.some((t) => t.category === 'list' && t.target_count === 20), 'asks for more leads when the queue is short');
});

test('rulePlan with an empty workspace asks for leads', () => {
  const plan = rulePlan(snapshot({}, 100));
  assert.ok(plan.tasks.length >= 1);
  assert.equal(plan.tasks[0].category, 'list');
});

test('parsePlan validates tasks and drops unknown lead ids', () => {
  const raw = '```json\n' + JSON.stringify({
    headline: 'Clear follow-ups',
    tasks: [
      { title: 'Call back Ama', detail: 'She asked', priority: 'high', category: 'follow_up', bucket: 'call_back', lead_ids: ['c1', 'evil'], target_count: 1 },
      { title: '', detail: 'no title', priority: 'high', category: 'calls', bucket: null, lead_ids: [], target_count: null },
      { title: 'Weird', detail: '', priority: 'urgent', category: 'nope', bucket: 'bogus', lead_ids: 'x', target_count: -3 },
    ],
    tips: ['a', 'b', 'c', 'd'],
  }) + '\n```';
  const p = parsePlan(raw, new Set(['c1']));
  assert.ok(p);
  assert.equal(p!.tasks.length, 2);
  assert.deepEqual(p!.tasks[0].lead_ids, ['c1']);
  assert.equal(p!.tasks[1].priority, 'medium');
  assert.equal(p!.tasks[1].category, 'calls');
  assert.equal(p!.tasks[1].bucket, null);
  assert.equal(p!.tasks[1].target_count, null);
  assert.equal(p!.tips.length, 3);
  assert.equal(parsePlan('nope', new Set()), null);
  assert.equal(parsePlan('{"headline":"x","tasks":[]}', new Set()), null);
});
