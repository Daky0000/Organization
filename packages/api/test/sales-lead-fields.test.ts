import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { coerceFieldValue, validateCustomValues, slugifyKey, endOfLocalDay } =
  await import('../src/server/sales/leadWorkspace.ts');

const f = (type: any, options: string[] | null = null) => ({ key: 'k', label: 'Col', type, options });

test('each column type coerces valid values', () => {
  assert.equal(coerceFieldValue(f('text'), '  hello '), 'hello');
  assert.equal(coerceFieldValue(f('number'), '1,200'), 1200);
  assert.equal(coerceFieldValue(f('currency'), 2000.5), 2000.5);
  assert.equal(coerceFieldValue(f('date'), '2026-11-18T10:00:00Z'), '2026-11-18');
  assert.equal(coerceFieldValue(f('boolean'), 'Yes'), true);
  assert.equal(coerceFieldValue(f('boolean'), false), false);
  assert.equal(coerceFieldValue(f('email'), ' Ama@Example.com '), 'ama@example.com');
  assert.equal(coerceFieldValue(f('phone'), '+233 24 123 4567'), '+233 24 123 4567');
  assert.equal(coerceFieldValue(f('url'), 'example.com/x'), 'https://example.com/x');
  assert.equal(coerceFieldValue(f('select', ['Auditor', 'Banker']), 'Banker'), 'Banker');
});

test('empty values clear the cell', () => {
  for (const t of ['text', 'number', 'date', 'select']) assert.equal(coerceFieldValue(f(t, ['a']), ''), null);
  assert.equal(coerceFieldValue(f('text'), null), null);
});

test('invalid values are rejected with the column name', () => {
  assert.throws(() => coerceFieldValue(f('number'), 'abc'), /Col: must be a number/);
  assert.throws(() => coerceFieldValue(f('date'), '18/11/2026'), /date/);
  assert.throws(() => coerceFieldValue(f('email'), 'nope'), /email/);
  assert.throws(() => coerceFieldValue(f('phone'), '2.33241E+11x'), /phone/);
  assert.throws(() => coerceFieldValue(f('select', ['A']), 'B'), /one of: A/);
  assert.throws(() => coerceFieldValue(f('boolean'), 'maybe'), /yes or no/);
});

test('validateCustomValues rejects unknown and built-in keys', () => {
  const fields = [
    { key: 'role', label: 'Role', type: 'text', options: null, builtin: false, position: 0, width: null, hidden: false },
    { key: 'email', label: 'Email', type: 'email', options: null, builtin: true, position: 1, width: null, hidden: false },
  ] as any;
  assert.deepEqual(validateCustomValues(fields, { role: 'Banker' }), { role: 'Banker' });
  assert.throws(() => validateCustomValues(fields, { salary: 1 }), /Unknown column "salary"/);
  assert.throws(() => validateCustomValues(fields, { email: 'a@b.co' }), /Unknown column "email"/);
});

test('slugifyKey makes safe keys', () => {
  assert.equal(slugifyKey('Current Role'), 'current_role');
  assert.equal(slugifyKey('2nd follow-up'), 'f_2nd_follow_up');
  assert.equal(slugifyKey('!!!'), 'field');
});

test('endOfLocalDay respects the timezone', () => {
  const now = Date.parse('2026-11-06T22:30:00Z');
  assert.equal(endOfLocalDay(now, 'Africa/Accra').toISOString(), '2026-11-06T23:59:59.999Z');
  // Already 7 Nov in Tokyo.
  assert.equal(endOfLocalDay(now, 'Asia/Tokyo').toISOString(), '2026-11-07T14:59:59.999Z');
});
