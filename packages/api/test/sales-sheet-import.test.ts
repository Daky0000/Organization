import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { analyzeImport, detectBlocks, normalizePhone, inferResponseStatus, isScientificPhone } =
  await import('../src/server/sales/salesSheetImport.ts');
const { parseCsv, toGrid } = await import('../src/server/leads/services/spreadsheet.ts');

// Shaped like the client's sheet: context rows, a header row whose name cell is
// the list title, two in-table section rows, note columns per round.
const CSV = [
  'isaac,CONTACT,,,',
  ',FINANCE CLASS- 1st list,,,',
  'Finance comprehensive,EMAIL,CONTACT,NOTES,1st Follow up',
  'Kwame Mensah,kwame.mensah@example.com,233241000001,send a full brochure,Shared details on whatsapp/ Will follow up on friday',
  'Ama Asante,Ama.Asante@Example.com,2.33241E+11,did not pick up,',
  'Kofi Boateng,kofi.boateng@example.com,0241000003,registered,',
  ',,,,',
  'NEW LIST,,,,',
  'Kojo Annan,kojo.annan@example.com,233241000004,Not interested,',
  ',NEW LIST - july ads,,,',
  'Kwaku Acheampong,kwaku.acheampong@example.com,233243000001,will call back at 4pm,Will pay this afternoon 6th Aug',
  'Zaney Bonsu,,,,',
  'CEO MASTERCLASS,,,,',
  'Kwame Asante,kwame.asante@example.com,233244000001,October CEO Masterclass will be ideal,',
].join('\n');

const grids = [toGrid('Leads', parseCsv(CSV))];

test('blocks follow the sheet sections and carry their titles', () => {
  const blocks = detectBlocks(grids);
  assert.deepEqual(blocks.map((b) => b.title), [
    'isaac CONTACT – FINANCE CLASS- 1st list – Finance comprehensive',
    'NEW LIST',
    'NEW LIST - july ads',
    'CEO MASTERCLASS',
  ]);
  assert.deepEqual(blocks.map((b) => b.rows.length), [3, 1, 2, 1]);
});

test('columns get sensible suggestions, notes become rounds in order', () => {
  const [first, second] = detectBlocks(grids);
  assert.deepEqual(first.columns.map((c) => c.suggested), ['full_name', 'email', 'phone', 'round:1', 'round:2']);
  // Inherited headers for an in-table section.
  assert.deepEqual(second.columns.map((c) => c.suggested), ['full_name', 'email', 'phone', 'round:1', 'round:2']);
});

test('analyze warns about phones the spreadsheet already corrupted', async () => {
  const res = await analyzeImport(Buffer.from(CSV).toString('base64'), 'leads.csv');
  assert.equal(res.blocks.length, 4);
  assert.match(res.warnings.join(' '), /1 phone number was saved .* lost their last digits/);
});

test('phone normalisation', () => {
  assert.deepEqual(normalizePhone('233241000001'), { ok: true, value: '+233241000001' });
  assert.deepEqual(normalizePhone('0241000003'), { ok: true, value: '0241000003' });
  assert.deepEqual(normalizePhone('+233 24 100 0001'), { ok: true, value: '+233 24 100 0001' });
  assert.deepEqual(normalizePhone('2.33241E+11'), { ok: false, reason: 'scientific' });
  assert.deepEqual(normalizePhone('call me'), { ok: false, reason: 'invalid' });
  assert.deepEqual(normalizePhone(''), { ok: true, value: null });
  assert.equal(isScientificPhone('23324100110'), false);
});

test('note text maps conservatively to an outcome', () => {
  assert.equal(inferResponseStatus('registered'), 'registered');
  assert.equal(inferResponseStatus('registed-amenfiman'), null);
  assert.equal(inferResponseStatus('Did not answer/ did not answer'), 'no_answer');
  assert.equal(inferResponseStatus('Unreachable/ Invalid'), 'unreachable');
  assert.equal(inferResponseStatus('switched off'), 'unreachable');
  assert.equal(inferResponseStatus('Not interested'), 'not_interested');
  assert.equal(inferResponseStatus('Made a payment of 2000.00. yet to pay the rest'), 'paid');
  assert.equal(inferResponseStatus('Will call me back'), 'call_back');
  assert.equal(inferResponseStatus('send a full brochure'), null);
});
