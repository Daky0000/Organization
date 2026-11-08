import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCallPurpose, resolveLeadPhone } from '../src/server/sales/callPlanner.ts';
import type { SheetColumn } from '../src/server/sales/leadSheetContext.ts';

const col = (label: string, value: unknown, type: SheetColumn['type'] = 'text'): SheetColumn =>
  ({ key: label.toLowerCase(), label, type, options: null, value });

// ─── Purpose ────────────────────────────────────────────────────────────────

test('an explicit call type is kept as given', () => {
  const d = detectCallPurpose({ requested: 'sales', note: 'Remind him to pay the balance' });
  assert.equal(d.callType, 'sales');
  assert.equal(d.autoDetected, false);
});

test('the reason decides the purpose', () => {
  const cases: Array<[string, string]> = [
    ['Remind her the GHS 500 balance for the June cohort is due Friday', 'reminder_payment'],
    ['Rappel: le paiement de la formation est attendu lundi', 'reminder_payment'],
    ['Remind him about the onboarding meeting tomorrow at 10am on Zoom', 'reminder_meeting'],
    ['Remind them the AI Sprint is on Tuesday 2pm', 'reminder_meeting'],
    ["Tell them Saturday's session is postponed to Sunday 10am", 'notice'],
    ['Inform all participants the office is closed for the holiday', 'notice'],
    ['Follow up on the proposal we sent last week', 'follow_up'],
    ['Call him back as promised about the quote', 'reminder_followup'],
    ['Introduce our corporate AI training and book a consultation', 'sales'],
  ];
  for (const [note, expected] of cases) {
    const d = detectCallPurpose({ requested: 'auto', note });
    assert.equal(d.callType, expected, `"${note}" → ${d.callType} (${d.reason})`);
    assert.ok(d.reason.length > 0);
  }
});

test('"masterclass" alone is a product to sell, not an appointment', () => {
  assert.equal(detectCallPurpose({ note: 'Tell them about the Executive AI Masterclass for CEOs' }).callType, 'sales');
});

test('without a reason, the lead data decides', () => {
  assert.equal(detectCallPurpose({ sheet: { columns: [col('Amount owed', 500, 'currency')], openReminders: [] } }).callType, 'reminder_payment');
  assert.equal(detectCallPurpose({ sheet: { columns: [col('Meeting date', '2026-11-20', 'date')], openReminders: [] } }).callType, 'reminder_meeting');
  assert.equal(detectCallPurpose({ sheet: { columns: [], openReminders: ['2026-11-10 call: follow up'] } }).callType, 'reminder_followup');
  assert.equal(detectCallPurpose({ hasPriorConversation: true }).callType, 'follow_up');
  assert.equal(detectCallPurpose({}).callType, 'sales');
  // An empty column says nothing.
  assert.equal(detectCallPurpose({ sheet: { columns: [col('Amount owed', '')], openReminders: [] } }).callType, 'sales');
});

// ─── Number ─────────────────────────────────────────────────────────────────

test('the contact phone is used and described', () => {
  const r = resolveLeadPhone({ contactPhone: '0545950611', localCountry: 'GH' });
  assert.equal(r.callable, true);
  assert.equal(r.phone?.e164, '+233545950611');
  assert.equal(r.phone?.country, 'GH');
  assert.equal(r.source, 'Phone');
  assert.equal(r.warning, null);
});

test('a phone column is used when the contact phone is missing or invalid', () => {
  const sheet = { columns: [col('WhatsApp', '+228 90 12 34 56'), col('Amount', '500', 'number')] };
  const r = resolveLeadPhone({ contactPhone: '12345', sheet, localCountry: 'GH' });
  assert.equal(r.callable, true);
  assert.equal(r.phone?.country, 'TG');
  assert.equal(r.source, 'WhatsApp');
  assert.match(r.warning ?? '', /WhatsApp/);
});

test('a cell with two numbers is split, and a mobile wins', () => {
  const r = resolveLeadPhone({ contactPhone: null, sheet: { columns: [col('Tel', '0302 123456 / 0244 123 456')] }, localCountry: 'GH' });
  assert.equal(r.phone?.type, 'MOBILE');
  assert.equal(r.candidates.length, 2);
});

test('no valid number → not callable, with the reason', () => {
  const r = resolveLeadPhone({ contactPhone: '0000', localCountry: 'GH' });
  assert.equal(r.callable, false);
  assert.match(r.warning ?? '', /not a valid phone number/);
  const none = resolveLeadPhone({ contactPhone: null, localCountry: 'GH' });
  assert.match(none.warning ?? '', /no phone number/);
});

test('toll-free numbers are callable but flagged; premium-rate are refused', () => {
  const tf = resolveLeadPhone({ contactPhone: '+1 800 555 0199', localCountry: 'GH' });
  assert.equal(tf.callable, true);
  assert.equal(tf.phone?.type, 'TOLL_FREE');
  assert.match(tf.warning ?? '', /toll-free/);
  const premium = resolveLeadPhone({ contactPhone: '+44 909 879 0000', localCountry: 'GH' });
  assert.equal(premium.phone?.type, 'PREMIUM_RATE');
  assert.equal(premium.callable, false);
});
