import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { parsePlan, planToBlocks, renderSheet } = await import('../src/server/sales/sheetAnalyst.ts');
const { toGrid } = await import('../src/server/leads/services/spreadsheet.ts');

const grid = (name: string, rows: string[][]) => toGrid(name, rows);

const people = grid('July', [
  ['FINANCE CLASS – 1st list', '', '', ''],
  ['Name', 'Email', 'Phone', 'Notes'],
  ['Kwame Mensah', 'kwame@example.com', '233241000001', 'call back friday'],
  ['Ama Asante', 'ama@example.com', '233241000002', ''],
  ['', '', '', ''],
  ['CEO MASTERCLASS', '', '', ''],
  ['Kojo Annan', 'kojo@example.com', '233241000004', 'registered'],
]);

test('parsePlan reads fenced JSON and rejects junk', () => {
  assert.ok(parsePlan('```json\n{"summary":"x","sections":[]}\n```'));
  assert.equal(parsePlan('not json'), null);
  assert.equal(parsePlan('{"summary":"x"}'), null);
});

test('planToBlocks maps targets, numbers note rounds and skips the header row', () => {
  const { blocks, repairs } = planToBlocks({
    summary: 'two lists',
    sections: [
      { sheet: 'July', title: 'Finance class', header_row: 1, first_row: 1, last_row: 3,
        columns: [{ index: 0, target: 'full_name' }, { index: 1, target: 'email' }, { index: 2, target: 'phone' }, { index: 3, target: 'note' }] },
      { sheet: 'july', title: 'CEO Masterclass', header_row: null, first_row: 6, last_row: 99,
        columns: [{ index: 0, target: 'full_name' }, { index: 1, target: 'email' }, { index: 2, target: 'email' }, { index: 3, target: 'custom', label: 'Status' }] },
    ],
  }, [people]);
  assert.deepEqual(repairs, []);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].rows, [2, 3]);
  assert.equal(blocks[0].columns.find((c) => c.index === 3)?.suggested, 'round:1');
  assert.equal(blocks[0].columns[0].header, 'Name');
  // Sheet name matched case-insensitively, range clamped to the sheet.
  assert.equal(blocks[1].sheet, 'July');
  assert.deepEqual(blocks[1].rows, [6]);
  // A second email column is demoted; custom uses the model's label.
  assert.equal(blocks[1].columns.find((c) => c.index === 2)?.suggested, 'skip');
  assert.equal(blocks[1].columns.find((c) => c.index === 3)?.suggested, 'custom:status');
});

test('planToBlocks drops unknown sheets and overlapping rows', () => {
  const { blocks, repairs } = planToBlocks({
    sections: [
      { sheet: 'July', title: 'A', header_row: 1, first_row: 2, last_row: 6, columns: [{ index: 1, target: 'email' }] },
      { sheet: 'July', title: 'B', header_row: null, first_row: 6, last_row: 6, columns: [{ index: 1, target: 'email' }] },
      { sheet: 'Nope', title: 'C', header_row: null, first_row: 0, last_row: 1, columns: [{ index: 0, target: 'email' }] },
    ],
  }, [people]);
  assert.equal(blocks.length, 1);
  assert.ok(repairs.some((r) => r.includes('"B"')));
  assert.ok(repairs.some((r) => r.includes('no worksheet called "Nope"')));
});

test('renderSheet collapses long runs of data rows but keeps every banner', () => {
  const rows = [['LIST ONE', ''], ['Name', 'Email'], ...Array.from({ length: 50 }, (_, i) => [`P${i}`, `p${i}@example.com`]), ['LIST TWO', '']];
  const text = renderSheet(grid('S', rows));
  assert.match(text, /r0: \[0\] LIST ONE/);
  assert.match(text, /r4–r51: … 48 more data rows/);
  assert.match(text, /r52: \[0\] LIST TWO/);
});
