import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { validateSalesOps } = await import('../src/server/sales/salesOps.ts');
const { parseAnalystOutput, analystRecordToOps } = await import('../src/server/sales/analystAgent.ts');
const { CALL_TYPE_BRIEFS } = await import('../src/server/sales/callBrief.ts');
const { CALL_TYPES, isCallType } = await import('../src/server/sales/types.ts');

const NOW = new Date('2026-08-12T10:00:00Z');
const sheetColumns = [
  { key: 'amount_owed', label: 'Amount owed', type: 'currency' as const, options: null },
  { key: 'attending', label: 'Attending', type: 'boolean' as const, options: null },
  { key: 'tier', label: 'Tier', type: 'select' as const, options: ['Gold', 'Silver'] },
];
const ctx = { now: NOW, requireApprovalFor: [] as string[], sheetColumns, companyId: 'co1' };

test('update_custom_field writes only the lead\'s own sheet columns, coerced to their type', () => {
  const r = validateSalesOps([
    { op: 'update_custom_field', key: 'amount_owed', value: '1,200' },
    { op: 'update_custom_field', key: 'attending', value: 'yes' },
    { op: 'update_custom_field', key: 'tier', value: 'Gold' },
  ], ctx);
  assert.equal(r.rejected.length, 0);
  assert.deepEqual(r.ok.map((o: any) => o.value), [1200, true, 'Gold']);
  assert.equal((r.ok[0] as any).label, 'Amount owed');
});

test('update_custom_field rejects unknown columns, bad values and blanking', () => {
  const r = validateSalesOps([
    { op: 'update_custom_field', key: 'password', value: 'x' },
    { op: 'update_custom_field', key: 'amount_owed', value: 'a lot' },
    { op: 'update_custom_field', key: 'tier', value: 'Platinum' },
    { op: 'update_custom_field', key: 'amount_owed', value: '' },
  ], ctx);
  assert.equal(r.ok.length, 0);
  assert.equal(r.rejected.length, 4);
});

test('a company note needs a company', () => {
  assert.equal(validateSalesOps([{ op: 'add_company_note', body: 'Opening a second branch' }], ctx).ok.length, 1);
  const none = validateSalesOps([{ op: 'add_company_note', body: 'Opening a second branch' }], { ...ctx, companyId: null });
  assert.equal(none.ok.length, 0);
  assert.equal(none.rejected.length, 1);
});

test('the analyst record carries field updates and a company note into ops', () => {
  const record = parseAnalystOutput(JSON.stringify({
    summary: 'They paid part of the balance.',
    sentiment: 'positive', intent: 'interested', objections: [], commitments: [], promises: [],
    recommended_action: 'none', confidence: 0.9,
    field_updates: [{ key: 'amount_owed', value: '300' }, { key: '', value: 'x' }, { key: 'attending', value: { bad: 1 } }],
    company_note: 'They are hiring two accountants.',
  }));
  assert.ok(record);
  assert.deepEqual(record!.field_updates, [{ key: 'amount_owed', value: '300' }]);
  const ops = analystRecordToOps(record!, { now: NOW, currentStage: 'new' }) as any[];
  assert.ok(ops.some((o) => o.op === 'update_custom_field' && o.key === 'amount_owed'));
  assert.ok(ops.some((o) => o.op === 'add_company_note'));
});

test('an older analyst record without the new fields still parses', () => {
  const record = parseAnalystOutput(JSON.stringify({
    summary: 'x', sentiment: 'neutral', intent: 'undecided', objections: [], commitments: [], promises: [],
    recommended_action: 'none', confidence: 0.5,
  }));
  assert.deepEqual(record!.field_updates, []);
  assert.equal(record!.company_note, null);
});

test('every call type has a brief', () => {
  for (const t of CALL_TYPES) {
    assert.ok(isCallType(t));
    assert.ok(CALL_TYPE_BRIEFS[t].guidance.length > 20);
  }
  assert.equal(isCallType('robocall'), false);
});
