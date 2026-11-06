import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const it = await import('../src/server/imageTaste.ts');

/** In-memory stand-in for the taste and design-system tables (just the statements the module runs). */
function fakeDb() {
  const t: Record<string, any[]> = { ex: [], rules: [], assets: [], profile: [], design: [] };
  let clock = 0;
  const now = () => new Date(1_800_000_000_000 + clock++ * 1000).toISOString();
  const byUser = (rows: any[], u: string) => rows.filter((r) => r.user_id === u).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const query = async (sql: string, p: any[] = []): Promise<{ rows: any[] }> => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^CREATE/i.test(s)) return { rows: [] };
    // style examples
    if (s.startsWith('SELECT * FROM user_style_examples WHERE user_id=$1 ORDER BY')) return { rows: byUser(t.ex, p[0]).slice(0, p[1]) };
    if (s.startsWith('SELECT id FROM user_style_examples WHERE user_id=$1 AND url=$2')) return { rows: t.ex.filter((r) => r.user_id === p[0] && r.url === p[1]) };
    if (s.startsWith('INSERT INTO user_style_examples')) { t.ex.push({ id: p[0], user_id: p[1], url: p[2], note: p[3], source: p[4], magnific_creation_id: null, in_kit: false, created_at: now() }); return { rows: [] }; }
    if (s.startsWith('DELETE FROM user_style_examples WHERE user_id=$1 AND id IN')) { const keep = byUser(t.ex, p[0]).slice(0, p[1]).map((r) => r.id); t.ex = t.ex.filter((r) => r.user_id !== p[0] || keep.includes(r.id)); return { rows: [] }; }
    if (s.startsWith('SELECT * FROM user_style_examples WHERE id=$1')) return { rows: t.ex.filter((r) => r.id === p[0]) };
    if (s.startsWith('DELETE FROM user_style_examples WHERE user_id=$1 AND id=$2')) { t.ex = t.ex.filter((r) => !(r.user_id === p[0] && r.id === p[1])); return { rows: [] }; }
    if (s.startsWith('UPDATE user_style_examples SET magnific_creation_id=$2')) { t.ex.find((r) => r.id === p[0]).magnific_creation_id = p[1]; return { rows: [] }; }
    if (s.startsWith('UPDATE user_style_examples SET in_kit=true')) { t.ex.find((r) => r.id === p[0]).in_kit = true; return { rows: [] }; }
    // rules
    if (s.startsWith('SELECT * FROM user_image_rules WHERE user_id=$1 ORDER BY')) return { rows: byUser(t.rules, p[0]).slice(0, p[1]) };
    if (s.startsWith('INSERT INTO user_image_rules')) { t.rules.push({ id: p[0], user_id: p[1], directive: p[2], avoid_term: p[3], source: p[4], image_url: p[5], magnific_rule_id: null, synced: false, created_at: now() }); return { rows: [] }; }
    if (s.startsWith('DELETE FROM user_image_rules WHERE user_id=$1 AND id IN')) return { rows: [] };
    if (s.startsWith('SELECT * FROM user_image_rules WHERE id=$1')) return { rows: t.rules.filter((r) => r.id === p[0]) };
    if (s.startsWith('UPDATE user_image_rules SET synced=true')) { Object.assign(t.rules.find((r) => r.id === p[0]), { synced: true, magnific_rule_id: p[1] }); return { rows: [] }; }
    // assets
    if (s.startsWith('SELECT * FROM user_library_assets WHERE user_id=$1')) return { rows: byUser(t.assets, p[0]).slice(0, p[1]) };
    if (s.startsWith('INSERT INTO user_library_assets')) { t.assets.push({ id: p[0], user_id: p[1], type: p[2], name: p[3], description: p[4], images: JSON.parse(p[5]), magnific_library_id: p[6], created_at: now() }); return { rows: [] }; }
    // style profile
    if (s.startsWith('SELECT summary, examples_key FROM user_style_profile')) return { rows: t.profile.filter((r) => r.user_id === p[0]) };
    if (s.startsWith('SELECT summary FROM user_style_profile')) return { rows: t.profile.filter((r) => r.user_id === p[0]) };
    if (s.startsWith('INSERT INTO user_style_profile')) { t.profile = t.profile.filter((r) => r.user_id !== p[0]); t.profile.push({ user_id: p[0], summary: p[1], examples_key: p[2] }); return { rows: [] }; }
    // autopilot switch
    if (s.startsWith('ALTER TABLE user_custom_instructions')) return { rows: [] };
    if (s.startsWith('SELECT autopilot_style FROM user_custom_instructions')) return { rows: (t.settings ?? []).filter((r: any) => r.user_id === p[0]) };
    if (s.startsWith('INSERT INTO user_custom_instructions (user_id, autopilot_style')) { t.settings = [...(t.settings ?? []).filter((r: any) => r.user_id !== p[0]), { user_id: p[0], autopilot_style: p[1] }]; return { rows: [] }; }
    // design system
    if (s.startsWith('SELECT design, design_hash')) return { rows: t.design.filter((r) => r.user_id === p[0]) };
    if (s.startsWith('INSERT INTO user_design_systems')) { const prev = t.design.find((r) => r.user_id === p[0]); const row = { ...(prev ?? {}), user_id: p[0], website_url: p[1], design: JSON.parse(p[2]), design_hash: p[3] }; t.design = t.design.filter((r) => r.user_id !== p[0]); t.design.push(row); return { rows: [] }; }
    if (s.startsWith('UPDATE user_design_systems SET magnific_kit_id')) { Object.assign(t.design.find((r) => r.user_id === p[0]), { magnific_kit_id: p[1], magnific_kit_hash: p[2] }); return { rows: [] }; }
    throw new Error(`fake db: unexpected SQL ${s.slice(0, 80)}`);
  };
  return { query, t };
}

/** A fake Magnific that records every call. */
function fakeMagnific() {
  const calls: Array<{ tool: string; args: any }> = [];
  let n = 0;
  const mcp = async (tool: string, args: any) => {
    calls.push({ tool, args });
    if (tool === 'creations_upload_image') return { ok: true, payload: { creation: { identifier: `cr_up_${++n}` } } };
    if (tool === 'brand_kit_create') return { ok: true, payload: { id: 'kit_1' } };
    if (tool === 'brand_kit_update' || tool === 'brand_kit_add_document') return { ok: true, payload: { ok: true } };
    if (tool === 'brand_kit_add_rule') return { ok: true, payload: { rule: { id: `rule_${++n}` } } };
    if (tool === 'library_create') return { ok: true, payload: { asset: { id: 4242 } } };
    if (tool === 'images_generate') return { ok: true, payload: { creations: [{ identifier: 'gen_1', status: 'queued' }] } };
    if (tool === 'creations_wait') return { ok: true, payload: { results: [{ identifier: 'gen_1', status: 'completed', url: 'https://cdn.magnific.test/out/gen_1.jpg' }] } };
    return { ok: false, payload: null };
  };
  return { mcp, calls, count: (tool: string) => calls.filter((c) => c.tool === tool).length };
}

test('rules: a complaint becomes a directive and a short avoid term', () => {
  const r = it.ruleFromReason('too dark, and no stock-photo people');
  assert.match(r.directive, /^Avoid: too dark/);
  assert.equal(r.avoid_term, 'dark');
  assert.equal(it.ruleFromReason('Never use neon colours').directive, 'Never use neon colours');
});

test('saved items: names are normalised and found in prompts by @name or plain name', () => {
  assert.equal(it.assetName('Coffee Bag!'), 'coffee_bag');
  const assets: any[] = [{ name: 'coffee_bag', type: 'product' }, { name: 'mia', type: 'character' }, { name: 'roastery', type: 'locations' }];
  assert.deepEqual(it.assetsIn('A flat lay of @coffee_bag on a table', assets).map((a) => a.name), ['coffee_bag']);
  assert.deepEqual(it.assetsIn('mia holding the coffee bag in the roastery', assets).map((a) => a.name).sort(), ['coffee_bag', 'mia', 'roastery']);
  assert.deepEqual(it.assetsIn('nothing here', assets, ['@mia']).map((a) => a.name), ['mia']);
});

test('examples: up to 12 kept, duplicates ignored, only https', async () => {
  const db = fakeDb();
  for (let i = 0; i < 14; i++) await it.addStyleExample(db.query, 'u', `https://img.test/${i}.jpg`);
  assert.equal(await it.addStyleExample(db.query, 'u', 'https://img.test/13.jpg'), null, 'duplicate');
  const list = await it.listStyleExamples(db.query, 'u');
  assert.equal(list.length, 12);
  assert.equal(list[0].url, 'https://img.test/13.jpg', 'newest first; the oldest are dropped');
  await assert.rejects(() => it.addStyleExample(db.query, 'u', 'http://insecure.test/a.jpg'));
});

test('style summary: written by a vision model from the examples, refreshed only when they change', async () => {
  const db = fakeDb();
  await it.addStyleExample(db.query, 'u', 'https://img.test/a.jpg', 'pastel flat lay');
  let calls = 0;
  const describe = async (p: any) => { calls++; assert.equal(p.imageUrls.length, 1); return { text: 'Soft pastel flat lays, top-down, lots of white space.', model: 'v' }; };
  assert.match(await it.refreshStyleSummary(db.query, 'u', describe as any), /pastel/);
  await it.refreshStyleSummary(db.query, 'u', describe as any);
  assert.equal(calls, 1, 'same examples: no second vision call');
  await it.addStyleExample(db.query, 'u', 'https://img.test/b.jpg');
  await it.refreshStyleSummary(db.query, 'u', async (p: any) => { calls++; assert.equal(p.imageUrls.length, 2); return { text: 'x', model: 'v' }; });
  assert.equal(calls, 2);
});

test('Magnific sync: each example uploaded and attached once, each rule pushed once, kit created once', async () => {
  const db = fakeDb();
  const mag = fakeMagnific();
  await it.addStyleExample(db.query, 'u', 'https://img.test/a.jpg');
  await it.addStyleExample(db.query, 'u', 'https://img.test/b.jpg');
  await it.addImageRule(db.query, 'u', { reason: 'no dark backgrounds' });
  await it.syncTasteToMagnific(db.query, 'u', mag.mcp);
  assert.equal(mag.count('brand_kit_create'), 1);
  assert.equal(mag.count('creations_upload_image'), 2);
  assert.equal(mag.count('brand_kit_add_document'), 2);
  assert.equal(mag.count('brand_kit_add_rule'), 1);
  assert.equal(mag.calls.find((c) => c.tool === 'brand_kit_add_rule')!.args.id, 'kit_1');
  await it.syncTasteToMagnific(db.query, 'u', mag.mcp);
  assert.equal(mag.calls.length, 7, 'nothing new: Magnific is not called again (create + update + 2 uploads + 2 attaches + 1 rule)');
  const rules = await it.listImageRules(db.query, 'u');
  assert.equal(rules[0].synced, true);
});

test('saved items: registered in Magnific\'s library once, with the id kept', async () => {
  const db = fakeDb();
  const mag = fakeMagnific();
  const a = await it.createLibraryAsset(db.query, 'u', { type: 'product', name: 'Coffee Bag', description: 'kraft bag, blue label', images: ['https://img.test/bag1.jpg', 'https://img.test/bag2.jpg'] }, mag.mcp);
  assert.equal(a.name, 'coffee_bag');
  assert.equal(a.magnific_library_id, 4242);
  assert.deepEqual(mag.calls[0].args.images, [{ url: 'https://img.test/bag1.jpg' }, { url: 'https://img.test/bag2.jpg' }]);
  await assert.rejects(() => it.createLibraryAsset(db.query, 'u', { type: 'product', name: 'coffee bag', images: ['https://img.test/x.jpg'] }, mag.mcp), /already exists/);
});

test('Best quality image: Magnific One with the Brand Kit, example styles and the saved product', async () => {
  const db = fakeDb();
  const mag = fakeMagnific();
  await it.addStyleExample(db.query, 'u', 'https://img.test/a.jpg');
  await it.createLibraryAsset(db.query, 'u', { type: 'product', name: 'coffee_bag', images: ['https://img.test/bag.jpg'] }, mag.mcp);
  const r = await it.generateTastefulImage({ query: db.query, userId: 'u', mcp: mag.mcp, prompt: 'Morning ritual with @coffee_bag', aspectRatio: '4:5', mode: 'quality', channel: 'instagram_post' });
  assert.deepEqual(r, { url: 'https://cdn.magnific.test/out/gen_1.jpg', model: 'magnific-one', magnificCredits: 180 });
  const gen = mag.calls.find((c) => c.tool === 'images_generate')!.args;
  assert.equal(gen.mode, 'magnific-one');
  assert.equal(gen.brandKitId, 'kit_1');
  assert.equal(gen.channel, 'instagram_post');
  assert.deepEqual(gen.references, [{ type: 'product', identifier: '4242' }, { type: 'style', identifier: 'cr_up_1' }]);
  assert.doesNotMatch(gen.prompt, /Style direction|Avoid:/, 'with a Brand Kit the kit owns the look');
});

test('Lowest cost image: Z-Image with style references and bans in the prompt; Nano Banana 2 Lite when a saved item must appear', async () => {
  const db = fakeDb();
  const mag = fakeMagnific();
  await it.addStyleExample(db.query, 'u', 'https://img.test/a.jpg');
  await it.addImageRule(db.query, 'u', { directive: 'Never dark backgrounds', avoid_term: 'dark background' });
  const r1 = await it.generateTastefulImage({ query: db.query, userId: 'u', mcp: mag.mcp, prompt: 'A cosy cafe', aspectRatio: '1:1', mode: 'economy' });
  assert.equal(r1?.model, 'z-image');
  const g1 = mag.calls.filter((c) => c.tool === 'images_generate')[0].args;
  assert.equal(g1.brandKitId, undefined, 'cheap models cannot take a Brand Kit');
  assert.deepEqual(g1.references.map((x: any) => x.type), ['style']);
  assert.match(g1.prompt, /Avoid: dark background/);
  await it.createLibraryAsset(db.query, 'u', { type: 'character', name: 'mia', images: ['https://img.test/mia.jpg'] }, mag.mcp);
  const r2 = await it.generateTastefulImage({ query: db.query, userId: 'u', mcp: mag.mcp, prompt: 'Mia pouring a latte', aspectRatio: '4:5', mode: 'economy' });
  assert.equal(r2?.model, it.TASTE_ECONOMY_MODELS.withAssets);
  const g2 = mag.calls.filter((c) => c.tool === 'images_generate')[1].args;
  assert.deepEqual(g2.references[0], { type: 'character', identifier: '4242' });
});

test('nothing taught on Lowest cost: the normal cheap chain is used', async () => {
  const db = fakeDb();
  const mag = fakeMagnific();
  assert.equal(await it.generateTastefulImage({ query: db.query, userId: 'u', mcp: mag.mcp, prompt: 'x', aspectRatio: '1:1', mode: 'economy' }), null);
  assert.equal(mag.count('images_generate'), 0);
});

test('Autopilot: uses the taught style by default; the user can switch it off', async () => {
  const db = fakeDb();
  assert.equal(await it.autopilotUsesStyle(db.query, 'u'), true);
  await it.setAutopilotUsesStyle(db.query, 'u', false);
  assert.equal(await it.autopilotUsesStyle(db.query, 'u'), false);
  await it.setAutopilotUsesStyle(db.query, 'u', true);
  assert.equal(await it.autopilotUsesStyle(db.query, 'u'), true);
  assert.equal(await it.autopilotUsesStyle(db.query, null), false);
});

test('Autopilot: an image gets the learned style and bans, example designs and the saved item it mentions', () => {
  const taste: any = {
    styleSummary: 'Bright pastel flat lays.',
    examples: [1, 2, 3, 4].map((i) => ({ url: `https://img.test/ex${i}.jpg` })),
    rules: [{ avoid_term: 'dark background', directive: 'Never dark backgrounds' }],
    assets: [{ name: 'coffee_bag', type: 'product', description: 'kraft bag', images: ['https://img.test/bag1.jpg', 'https://img.test/bag2.jpg', 'https://img.test/bag3.jpg'] },
      { name: 'mia', type: 'character', description: '', images: ['https://img.test/mia.jpg'] }],
  };
  const r = it.autopilotTasteInputs(taste, 'Launch post: our new coffee bag on a shelf');
  assert.match(r.promptAddon, /Bright pastel flat lays/);
  assert.match(r.promptAddon, /Avoid: dark background/);
  assert.match(r.promptAddon, /coffee bag: kraft bag/);
  assert.deepEqual(r.referenceUrls, ['https://img.test/bag1.jpg', 'https://img.test/bag2.jpg', 'https://img.test/ex1.jpg', 'https://img.test/ex2.jpg', 'https://img.test/ex3.jpg'],
    'saved item photos first (2), then 3 examples; items not mentioned are left out');
});
