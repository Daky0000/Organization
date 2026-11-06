import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const ds = await import('../src/server/designSystem.ts');
const pm = await import('../src/server/preferenceMemory.ts');

const scan: any = {
  website_url: 'https://acme.test', scanned_at: '2026-11-03T00:00:00Z', pages_scanned: ['/'], robots_respected: true,
  inferred_brand_name: 'Acme', inferred_description: 'Coffee roasters', inferred_offerings: [], warnings: [],
  candidate_tokens: [
    { category: 'color', sub_type: 'primary', value: { hex: '#1A73E8', css_var: '--brand-primary' } },
    { category: 'color', sub_type: 'background', value: { hex: '#ffffff' } },
    { category: 'color', sub_type: 'primary', value: { hex: '#1a73e8' } },
    { category: 'typography', sub_type: 'display', value: { family: 'Playfair+Display:wght@700' } },
    { category: 'logo', sub_type: 'primary_logo', value: { url: 'https://acme.test/logo.svg', variant: 'header-img' } },
    { category: 'voice', sub_type: 'tone', value: { attributes: ['warm', 'confident'] } },
  ],
};

/** A tiny in-memory stand-in for the user_design_systems table. */
function fakeDb() {
  const rows = new Map<string, any>();
  const query = async (sql: string, p: any[] = []) => {
    if (/^\s*CREATE/i.test(sql)) return { rows: [] };
    if (/INSERT INTO user_design_systems/.test(sql)) {
      const prev = rows.get(p[0]) ?? {};
      rows.set(p[0], { ...prev, website_url: p[1], design: JSON.parse(p[2]), design_hash: p[3] });
      return { rows: [] };
    }
    if (/SELECT design, design_hash/.test(sql)) return { rows: rows.has(p[0]) ? [rows.get(p[0])] : [] };
    if (/UPDATE user_design_systems SET magnific_kit_id/.test(sql)) {
      Object.assign(rows.get(p[0]), { magnific_kit_id: p[1], magnific_kit_hash: p[2] });
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { query, rows };
}

test('design system: colours (deduped, with roles), fonts, logo and voice come from the website scan', () => {
  const d = ds.designFromScan(scan);
  assert.deepEqual(d.colors.map((c) => `${c.role}:${c.hex}`), ['primary:#1a73e8', 'background:#ffffff']);
  assert.deepEqual(d.typography, [{ family: 'Playfair Display', use: 'display' }]);
  assert.equal(d.logos[0].url, 'https://acme.test/logo.svg');
  assert.deepEqual(d.voice, ['warm', 'confident']);
  const md = ds.designMd(d);
  assert.match(md, /## Colours\n- primary: #1a73e8/);
  assert.match(ds.designPromptHint(d), /#1a73e8 \(primary\).*Playfair Display/);
});

test('design system: sent to Magnific once as a Brand Kit, reused, and re-sent only when it changes', async () => {
  const db = fakeDb();
  const calls: string[] = [];
  const mcp = async (tool: string, args: any) => {
    calls.push(tool);
    if (tool === 'brand_kit_create') return { ok: true, payload: { brandKit: { id: 'kit_123', status: 'draft' } } };
    if (tool === 'brand_kit_update') { assert.match(args.design_md, /#1a73e8/); return { ok: true, payload: { id: args.id } }; }
    return { ok: false, payload: null };
  };
  await ds.captureDesignSystem(db.query, 'u1', 'https://acme.test', undefined, scan);
  assert.equal(await ds.ensureMagnificBrandKit(db.query, 'u1', mcp), 'kit_123');
  assert.deepEqual(calls, ['brand_kit_create', 'brand_kit_update']);
  assert.equal(await ds.ensureMagnificBrandKit(db.query, 'u1', mcp), 'kit_123');
  assert.deepEqual(calls, ['brand_kit_create', 'brand_kit_update'], 'unchanged design: Magnific is not called again');
  const changed = { ...(await ds.getDesignSystem(db.query, 'u1'))!, rules: ['Always dark backgrounds'] };
  await ds.saveDesignSystem(db.query, 'u1', changed);
  assert.equal(await ds.ensureMagnificBrandKit(db.query, 'u1', mcp), 'kit_123');
  assert.deepEqual(calls, ['brand_kit_create', 'brand_kit_update', 'brand_kit_update'], 'a changed design updates the same kit, no new kit');
});

test('branded image: queued creation is awaited and its image URL returned', async () => {
  const db = fakeDb();
  await ds.captureDesignSystem(db.query, 'u2', 'https://acme.test', undefined, scan);
  let waits = 0;
  const mcp = async (tool: string, args: any) => {
    if (tool === 'brand_kit_create') return { ok: true, payload: { id: 'kit_9' } };
    if (tool === 'brand_kit_update') return { ok: true, payload: {} };
    if (tool === 'images_generate') { assert.equal(args.brandKitId, 'kit_9'); return { ok: true, payload: { creations: [{ identifier: 'cr_1', status: 'queued' }] } }; }
    if (tool === 'creations_wait') {
      waits++;
      return waits < 2 ? { ok: true, payload: { results: [{ identifier: 'cr_1', status: 'in_progress' }] } }
        : { ok: true, payload: { results: [{ identifier: 'cr_1', status: 'completed', url: 'https://cdn.magnific.test/img/cr_1.jpg' }] } };
    }
    return { ok: false, payload: null };
  };
  const r = await ds.generateWithBrandKit({ query: db.query, userId: 'u2', mcp, prompt: 'Launch day', aspectRatio: '4:5', channel: 'instagram_post' });
  assert.deepEqual(r, { url: 'https://cdn.magnific.test/img/cr_1.jpg', kitId: 'kit_9' });
});

test('memory: an edit is described by what changed; a reschedule names the new time', () => {
  const note = pm.describeEdit('Big news!!! 🎉🎉 We launched our new roast today and it is amazing #coffee #new #launch #roast', 'We launched a new roast today. #coffee', 'an instagram post "Launch"')!;
  assert.match(note, /made it shorter/);
  assert.match(note, /removed emojis/);
  assert.match(note, /fewer hashtags/);
  assert.equal(pm.describeEdit('same', 'same', 'x'), null);
  assert.match(pm.describeReschedule('2026-11-03T09:00:00Z', '2026-11-05T18:00:00Z', 'a post', 'UTC')!, /Tue 09:00 to Thu 18:00/);
  const block = pm.preferencesBlock([{ id: '1', kind: 'dislike', subject: 'post', note: 'Too many emojis', source: 'feedback', created_at: '' }]);
  assert.match(block, /Disliked \(post\): Too many emojis/);
  assert.equal(pm.preferencesBlock([]), '');
});
