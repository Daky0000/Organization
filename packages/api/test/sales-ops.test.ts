import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { validateSalesOps } = await import('../src/server/sales/salesOps.ts');
const { parseAnalystOutput, analystRecordToOps, truncateTranscript } =
  await import('../src/server/sales/analystAgent.ts');
const { mapVapiEndedReason } = await import('../src/server/sales/providers/vapi.ts');

const NOW = new Date('2026-08-12T10:00:00Z');
const ctx = { now: NOW, requireApprovalFor: [] as string[] };
const soon = new Date('2026-08-15T15:00:00Z').toISOString();

// ─── The whitelist ───────────────────────────────────────────────────────────

test('a non-array payload is rejected, not thrown on', () => {
  const r = validateSalesOps({ op: 'add_note' }, ctx);
  assert.equal(r.ok.length, 0);
  assert.equal(r.rejected.length, 1);
});

test('an unknown op is rejected with a reason', () => {
  const r = validateSalesOps([{ op: 'DROP TABLE users' }], ctx);
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /unknown op/);
});

test('an invented objection code is rejected', () => {
  const r = validateSalesOps([{ op: 'record_objection', code: 'kinda_pricey', raw_text: 'bit dear' }], ctx);
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /unknown objection code/);
});

test('a valid objection code is accepted', () => {
  const r = validateSalesOps([{ op: 'record_objection', code: 'price', raw_text: 'too expensive' }], ctx);
  assert.equal(r.ok.length, 1);
  assert.equal(r.rejected.length, 0);
});

test('an invented stage is rejected', () => {
  const r = validateSalesOps([{ op: 'update_lead_stage', stage: 'super_hot', reason: 'vibes' }], ctx);
  assert.equal(r.ok.length, 0);
});

test('a follow-up in the past is rejected', () => {
  const r = validateSalesOps(
    [{ op: 'create_followup', scheduled_for: '2026-08-01T10:00:00Z', type: 'phone_call' }],
    ctx,
  );
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /past/);
});

test('a follow-up beyond the horizon is rejected', () => {
  const r = validateSalesOps(
    [{ op: 'create_followup', scheduled_for: '2030-01-01T10:00:00Z', type: 'phone_call' }],
    ctx,
  );
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /180 days/);
});

test('an unparseable follow-up date is rejected', () => {
  const r = validateSalesOps([{ op: 'create_followup', scheduled_for: 'next Thursdayish' }], ctx);
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /not a date/);
});

test('a follow-up defaults to a phone call and normalises the date', () => {
  const r = validateSalesOps([{ op: 'create_followup', scheduled_for: soon }], ctx);
  assert.equal(r.ok.length, 1);
  assert.equal((r.ok[0] as any).type, 'phone_call');
  assert.equal((r.ok[0] as any).scheduled_for, soon);
});

test('a probability outside 0-100 is rejected', () => {
  const r = validateSalesOps([{ op: 'link_deal', deal_id: 'd1', probability: 250 }], ctx);
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /between 0 and 100/);
});

test('an un-updatable field is rejected', () => {
  const r = validateSalesOps([{ op: 'update_lead_field', field: 'do_not_call', value: 'false' }], ctx);
  assert.equal(r.ok.length, 0);
  assert.match(r.rejected[0].reason, /not updatable/);
});

test('an empty note is rejected rather than written as blank', () => {
  const r = validateSalesOps([{ op: 'add_note', body: '   ' }], ctx);
  assert.equal(r.ok.length, 0);
});

test('ops needing approval are held, not applied', () => {
  const r = validateSalesOps(
    [
      { op: 'set_do_not_call', reason: 'asked to stop' },
      { op: 'add_note', body: 'called them' },
    ],
    { now: NOW, requireApprovalFor: ['set_do_not_call'] },
  );
  assert.equal(r.ok.length, 1);
  assert.equal((r.ok[0] as any).op, 'add_note');
  assert.equal(r.pending.length, 1);
  assert.equal((r.pending[0] as any).op, 'set_do_not_call');
});

test('one bad op does not discard the good ones in the same batch', () => {
  const r = validateSalesOps(
    [
      { op: 'add_note', body: 'good' },
      { op: 'nonsense' },
      { op: 'record_objection', code: 'timing', raw_text: 'not now' },
    ],
    ctx,
  );
  assert.equal(r.ok.length, 2);
  assert.equal(r.rejected.length, 1);
});

// ─── Analyst parsing ─────────────────────────────────────────────────────────

const VALID = JSON.stringify({
  summary: 'Lead is interested but thinks the price is high.',
  sentiment: 'positive',
  intent: 'callback_requested',
  suggested_stage: 'interested',
  objections: [{ code: 'price', raw_text: 'that is more than we budgeted' }],
  commitments: ['Will review the proposal'],
  promises: ['Send revised pricing'],
  questions: [],
  buying_signals: ['Asked about onboarding time'],
  follow_up: { required: true, requested_datetime: soon, exact_time_requested: true, reason: 'Lead asked' },
  recommended_action: 'follow_up_call',
  confidence: 0.82,
});

test('a clean structured response parses', () => {
  const r = parseAnalystOutput(VALID);
  assert.ok(r);
  assert.equal(r!.intent, 'callback_requested');
  assert.equal(r!.objections[0].code, 'price');
  assert.equal(r!.confidence, 0.82);
});

test('JSON wrapped in prose still parses via the brace fallback', () => {
  const r = parseAnalystOutput(`Sure! Here is the record:\n\n${VALID}\n\nLet me know if you need more.`);
  assert.ok(r);
  assert.equal(r!.sentiment, 'positive');
});

test('non-JSON returns null rather than a fabricated record', () => {
  assert.equal(parseAnalystOutput('The call went well overall.'), null);
  assert.equal(parseAnalystOutput(''), null);
});

test('invalid enum values are coerced to safe defaults, not passed through', () => {
  const r = parseAnalystOutput(
    JSON.stringify({ summary: 'x', sentiment: 'ecstatic', intent: 'super_keen', objections: [{ code: 'made_up', raw_text: 'x' }], confidence: 5 }),
  );
  assert.ok(r);
  assert.equal(r!.sentiment, 'neutral');
  assert.equal(r!.intent, 'undecided');
  assert.equal(r!.objections.length, 0); // the bad code is dropped, not defaulted
  assert.equal(r!.confidence, 1); // clamped
});

test('a garbage requested_datetime is dropped rather than becoming Invalid Date', () => {
  const r = parseAnalystOutput(
    JSON.stringify({ summary: 'x', follow_up: { required: true, requested_datetime: 'whenever' } }),
  );
  assert.ok(r);
  assert.equal(r!.follow_up.requested_datetime, null);
});

test('a long transcript keeps its head and tail', () => {
  const long = `START${'x'.repeat(50_000)}END`;
  const out = truncateTranscript(long, 1000);
  assert.ok(out.startsWith('START'));
  assert.ok(out.endsWith('END'));
  assert.ok(out.includes('omitted'));
  assert.ok(out.length < 1200);
});

// ─── Record → ops ────────────────────────────────────────────────────────────

test('every promise becomes a task', () => {
  const record = parseAnalystOutput(VALID)!;
  const ops = analystRecordToOps(record, { now: NOW, currentStage: 'contacted' }) as any[];
  const tasks = ops.filter((o) => o.op === 'create_task');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Send revised pricing');
});

test('a stage that has not moved produces no stage op', () => {
  const record = parseAnalystOutput(VALID)!;
  const ops = analystRecordToOps(record, { now: NOW, currentStage: 'interested' }) as any[];
  assert.equal(ops.filter((o) => o.op === 'update_lead_stage').length, 0);
});

test('an exact requested time is carried through to the follow-up op', () => {
  const record = parseAnalystOutput(VALID)!;
  const ops = analystRecordToOps(record, { now: NOW, currentStage: 'new' }) as any[];
  const followUp = ops.find((o) => o.op === 'create_followup');
  assert.ok(followUp);
  assert.equal(followUp.exact_time_requested, true);
  assert.equal(followUp.scheduled_for, soon);
});

test('a do-not-call intent sets DNC and creates no follow-up', () => {
  const record = parseAnalystOutput(
    JSON.stringify({
      summary: 'Asked to be removed.', intent: 'do_not_call', sentiment: 'negative',
      follow_up: { required: true }, recommended_action: 'disqualify', confidence: 0.9,
    }),
  )!;
  const ops = analystRecordToOps(record, { now: NOW, currentStage: 'contacted' }) as any[];
  assert.ok(ops.some((o) => o.op === 'set_do_not_call'));
  assert.equal(ops.filter((o) => o.op === 'create_followup').length, 0);
});

// ─── Vapi outcome mapping ────────────────────────────────────────────────────

test('Vapi ended reasons map onto our outcome vocabulary', () => {
  assert.equal(mapVapiEndedReason('customer-did-not-answer', 0), 'no_answer');
  assert.equal(mapVapiEndedReason('customer-busy', 0), 'busy');
  assert.equal(mapVapiEndedReason('voicemail', 25), 'voicemail');
  assert.equal(mapVapiEndedReason('customer-ended-call', 120), 'answered');
  assert.equal(mapVapiEndedReason('assistant-ended-call', 95), 'answered');
  assert.equal(mapVapiEndedReason('pipeline-error-openai-llm-failed', 3), 'failed');
  assert.equal(mapVapiEndedReason('twilio-failed-to-connect-call', 0), 'failed');
});

test('a hang-up too short to be a conversation is not counted as answered', () => {
  assert.equal(mapVapiEndedReason('customer-ended-call', 2), 'no_answer');
});

test('silence timing out is a voicemail when it ran long, a no-answer when short', () => {
  assert.equal(mapVapiEndedReason('silence-timed-out', 40), 'voicemail');
  assert.equal(mapVapiEndedReason('silence-timed-out', 5), 'no_answer');
});

test('a missing ended reason falls back to duration', () => {
  assert.equal(mapVapiEndedReason(null, 60), 'answered');
  assert.equal(mapVapiEndedReason(undefined, 0), 'no_answer');
});
