import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const ui = await import('../src/server/uiStateRoutes.ts');
const core = await import('../../web/src/components/tour/tourCore.ts');
const { MARKETING_TOURS, MARKETING_SETUP_ORDER } = await import('../../web/src/components/tour/marketingTours.ts');

const at = (d: string) => new Date(d).toISOString();

test('tour progress: a replay ("started") never undoes "done" or "dismissed"; anything else takes the newer record', () => {
  const base = { tours: {
    contacts: { status: 'done' as const, step: 5, at: at('2026-11-01') },
    email: { status: 'dismissed' as const, step: 0, at: at('2026-11-01') },
    forms: { status: 'started' as const, step: 1, at: at('2026-11-01') },
  } };
  const incoming = { tours: {
    contacts: { status: 'started' as const, step: 0, at: at('2026-11-02') },
    email: { status: 'done' as const, step: 3, at: at('2026-11-02') },
    forms: { status: 'done' as const, step: 1, at: at('2026-11-02') },
    surveys: { status: 'started' as const, step: 0, at: at('2026-11-02') },
  } };
  for (const merge of [core.mergeTourState, ui.mergeUiState]) {
    const m = merge(base, incoming);
    assert.equal(m.tours.contacts.status, 'done', 'a replay on another device does not bring the welcome back');
    assert.equal(m.tours.email.status, 'done');
    assert.equal(m.tours.forms.status, 'done');
    assert.equal(m.tours.surveys.status, 'started');
  }
  assert.ok(core.tourSettled(core.mergeTourState(base, incoming), 'contacts'));
  assert.ok(!core.tourSettled(core.mergeTourState(base, incoming), 'surveys'));
});

test('tour progress API: only well-formed records are kept (ids, statuses, steps, dates bounded)', () => {
  const clean = ui.cleanUiState({ tours: {
    'marketing-contacts': { status: 'done', step: 4, at: '2026-11-02T10:00:00Z' },
    'bad id with spaces': { status: 'done', step: 1, at: '2026-11-02T10:00:00Z' },
    weird: { status: 'hacked', step: 1, at: 'x' },
    negative: { status: 'started', step: -3, at: 'not a date' },
  }, extra: { evil: true } });
  assert.deepEqual(Object.keys(clean.tours).sort(), ['marketing-contacts', 'negative']);
  assert.equal(clean.tours.negative.step, 0);
  assert.ok(!Number.isNaN(Date.parse(clean.tours.negative.at)));
  assert.deepEqual(ui.cleanUiState('nope'), { tours: {} });
  assert.deepEqual(ui.cleanUiState({ tours: [1, 2] }), { tours: {} });
});

test('tour progress API: GET and PUT merge per user (signed-in only)', async () => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const rows = new Map<string, string>();
  const dbQuery = async (sql: string, params: unknown[] = []) => {
    if (/^CREATE TABLE/i.test(sql.trim())) return { rows: [] };
    if (/^SELECT state/i.test(sql.trim())) { const v = rows.get(String(params[0])); return { rows: v ? [{ state: JSON.parse(v) }] : [] }; }
    if (/^INSERT INTO user_ui_state/i.test(sql.trim())) { rows.set(String(params[0]), String(params[1])); return { rows: [] }; }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const app = express();
  app.use(express.json());
  app.use('/api', ui.registerUiStateRoutes({
    requireAuth: (req: any, res: any) => {
      const id = req.headers['x-user'];
      if (!id) { res.status(401).json({ error: 'Unauthorized' }); return null; }
      return { userId: String(id) };
    },
    dbQuery,
  }));
  await request(app).get('/api/me/ui-state').expect(401);
  const empty = await request(app).get('/api/me/ui-state').set('x-user', 'u1').expect(200);
  assert.deepEqual(empty.body.state, { tours: {} });
  await request(app).put('/api/me/ui-state').set('x-user', 'u1').send({ tours: { 'marketing-email': { status: 'done', step: 3, at: at('2026-11-02') } } }).expect(200);
  const replay = await request(app).put('/api/me/ui-state').set('x-user', 'u1').send({ tours: { 'marketing-email': { status: 'started', step: 0, at: at('2026-11-03') } } }).expect(200);
  assert.equal(replay.body.state.tours['marketing-email'].status, 'done');
  const other = await request(app).get('/api/me/ui-state').set('x-user', 'u2').expect(200);
  assert.deepEqual(other.body.state, { tours: {} }, 'each user has their own progress');
});

test('tour card: placed beside the control when it fits, flipped when not, never off screen', () => {
  const view = { width: 1280, height: 800 };
  const below = core.placeCard({ top: 100, left: 600, width: 120, height: 40 }, 320, 200, view);
  assert.equal(below.side, 'bottom');
  assert.equal(below.top, 100 + 40 + core.TOUR_GAP);
  const nearBottom = core.placeCard({ top: 700, left: 600, width: 120, height: 40 }, 320, 200, view);
  assert.equal(nearBottom.side, 'top', 'no room below: above');
  const sidebar = core.placeCard({ top: 300, left: 0, width: 220, height: 300 }, 320, 200, view, 'right');
  assert.equal(sidebar.side, 'right');
  assert.equal(sidebar.left, 220 + core.TOUR_GAP);
  const edge = core.placeCard({ top: 100, left: 1250, width: 30, height: 30 }, 320, 200, view);
  assert.ok(edge.left + 320 <= view.width - 12 && edge.left >= 12, 'kept inside the window');
  const huge = core.placeCard({ top: 0, left: 0, width: 1200, height: 760 }, 320, 200, view);
  assert.equal(huge.side, 'inside');
});

test('marketing tours: every tool has a short tour on its own page, with unique steps and real targets', () => {
  const tours = Object.values(MARKETING_TOURS);
  assert.ok(tours.length >= 9);
  const pages = new Set(tours.map((t) => t.page));
  assert.equal(pages.size, tours.length, 'one tour per page');
  for (const t of tours) {
    assert.ok(t.minutes >= 1 && t.minutes <= 2, `${t.id} is short`);
    assert.ok(t.steps.length >= 1 && t.steps.length <= 6, `${t.id} has a handful of steps`);
    assert.ok(t.done.length >= 1, `${t.id} says what was learned`);
    assert.equal(new Set(t.steps.map((s) => s.id)).size, t.steps.length, `${t.id} step ids are unique`);
    for (const s of t.steps) {
      if (s.target) assert.match(s.target, /^\[data-tour="[a-z0-9-]+"\]$/, `${t.id}/${s.id} targets a data-tour control`);
      if (s.waitFor) assert.ok(s.doText?.startsWith('Try it:'), `${t.id}/${s.id} says what to try`);
      assert.ok(!/\b(unlock|elevate|seamless|game-changer|supercharge)\b/i.test(`${s.title} ${s.body}`), `${t.id}/${s.id} is plain language`);
    }
  }
  for (const s of MARKETING_SETUP_ORDER) assert.ok(MARKETING_TOURS[s.tour], `setup order names a real tour: ${s.tour}`);
});

test('marketing tours: every data-tour target exists in the app source', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = join(import.meta.dirname, '../../web/src');
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f)) files.push(p); } };
  walk(root);
  const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const t of Object.values(MARKETING_TOURS)) {
    for (const s of t.steps) {
      if (!s.target) continue;
      const name = s.target.match(/data-tour="([^"]+)"/)![1];
      // Literal attribute, or a tab button built as data-tour={`tab-…-${id}`}.
      const tab = name.match(/^(tab(?:-[a-z]+)?)-([a-z]+)$/);
      const found = source.includes(`data-tour="${name}"`) || (tab && source.includes(`data-tour={\`${tab[1]}-\${`));
      assert.ok(found, `${t.id}/${s.id}: no element has data-tour="${name}"`);
    }
  }
});
