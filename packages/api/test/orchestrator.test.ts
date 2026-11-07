import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { parsePlan, assignWaves, parseResult, fallbackPlan } = await import('../src/server/orchestrator/engine.ts');
const { fillBrand } = await import('../src/server/orchestrator/skills.ts');
const { buildProfile, matchSegment, ruleSegments, parseSegments, keywordRegex } = await import('../src/server/sales/leadTargeting.ts');
const { renderContext, isUpcoming, AFRICON_SEED } = await import('../src/server/companyContext.ts');

const skill = (key: string, plannable = true) => ({
  key, name: key, role: key, description: key, source: 'core' as const, icon: '', color: '', prompt: '', packs: ['company' as const], tools: [], plannable,
});
const SKILLS = [skill('business_analyst'), skill('lead_targeting'), skill('decision_advisor'), skill('sage'), skill('followup_reader', false)];

test('parsePlan keeps known skills, drops unknown ones and forward dependencies', () => {
  const raw = JSON.stringify({
    goal: 'Fill the 26 Nov event', event_id: 'ev1',
    steps: [
      { id: 's1', skill: 'lead_targeting', title: 'Who to call', task: 'Find finance leads', packs: ['lead_base', 'bogus'], depends_on: ['s3'] },
      { id: 's2', skill: 'hacker', title: 'x', task: 'x', packs: [], depends_on: [] },
      { id: 's3', skill: 'followup_reader', title: 'bg', task: 'x', packs: [], depends_on: [] },
      { id: 's4', skill: 'sage', title: 'Campaign', task: 'Write the brief', packs: ['company'], depends_on: ['s1'] },
      { id: 's5', skill: 'decision_advisor', title: 'Decide', task: 'Recommend', packs: [], depends_on: ['s1', 's4'] },
    ],
  });
  const plan = parsePlan(raw, SKILLS as any, new Set(['ev1']));
  assert.ok(plan);
  assert.deepEqual(plan!.steps.map((s) => s.skill), ['lead_targeting', 'sage', 'decision_advisor']);
  assert.deepEqual(plan!.steps[0].depends_on, []); // s3 was dropped
  assert.ok(plan!.steps[0].packs.includes('lead_base') && !plan!.steps[0].packs.includes('bogus' as any));
  assert.equal(plan!.event_id, 'ev1');
  const waves = assignWaves(plan!.steps);
  assert.deepEqual(plan!.steps.map((s) => waves.get(s.id)), [0, 1, 2]);
  assert.equal(parsePlan(JSON.stringify({ steps: [] }), SKILLS as any, new Set()), null);
  assert.equal(parsePlan(JSON.stringify({ event_id: 'nope', steps: [{ skill: 'sage', task: 't' }] }), SKILLS as any, new Set(['ev1']))!.event_id, null);
});

test('independent steps share a wave (parallel)', () => {
  const steps = [
    { id: 'a', depends_on: [] }, { id: 'b', depends_on: [] }, { id: 'c', depends_on: ['a', 'b'] }, { id: 'd', depends_on: [] },
  ] as any;
  const w = assignWaves(steps);
  assert.deepEqual([w.get('a'), w.get('b'), w.get('c'), w.get('d')], [0, 0, 1, 0]);
});

test('fallbackPlan picks targeting + decision for "who should we call"', () => {
  const p = fallbackPlan('Who should we call for the finance masterclass?', SKILLS as any, []);
  assert.deepEqual(p.steps.map((s) => s.skill), ['lead_targeting', 'decision_advisor']);
  assert.deepEqual(p.steps[1].depends_on, ['s1']);
});

test('parseResult validates actions and always links lead groups built in the run', () => {
  const raw = JSON.stringify({
    answer: 'Call finance leads first.',
    decision: { question: 'Which segment?', options: [{ name: 'Finance', pros: 'fit', cons: 'busy' }], recommendation: 'Finance', confidence: 'sure' },
    actions: [
      { type: 'target_leads', label: 'Build', params: { event_id: 'ev2' } },
      { type: 'target_leads', label: 'Again', params: { event_id: 'ev1' } }, // already built
      { type: 'target_leads', label: 'Bad', params: { event_id: 'nope' } },
      { type: 'open_page', label: 'Leads', params: { page: 'sales-leads' } },
      { type: 'open_page', label: 'Evil', params: { page: 'admin' } },
      { type: 'delete_everything', label: 'x', params: {} },
      { type: 'save_note', label: 'Save', params: { title: 'Decision', body: 'Finance first' } },
    ],
  });
  const r = parseResult(raw, new Set(['ev1', 'ev2']), new Set(['ev1']))!;
  assert.equal(r.decision?.confidence, 'medium');
  assert.deepEqual(r.actions.map((a) => a.type), ['open_targeting', 'target_leads', 'open_page', 'save_note']);
  assert.equal(r.actions[1].params.event_id, 'ev2');
  assert.equal(parseResult('not json', new Set(), new Set()), null);
});

test('fillBrand fills placeholders and falls back gracefully', () => {
  assert.equal(fillBrand('For {brand.brand_name} in {brand.niche}.', { brand_name: 'Africon' }), 'For Africon in the niche.');
  assert.equal(fillBrand('{brand.brand_name}', {}), 'the company');
});

const lead = (id: string, over: Record<string, unknown>) => buildProfile({
  contact_id: id, first_name: id, last_name: null, email: null, phone: '233', custom_data: {}, lists: [], notes: null, last_status: null, ...over,
});

test('profiles read titles, companies and domains from custom columns and email', () => {
  const p = lead('a', { email: 'kofi@gcbbank.com.gh', custom_data: { 'Job Title': 'Finance Manager', Organisation: 'GCB Bank' } });
  assert.match(p.fields.title, /Finance Manager/);
  assert.match(p.fields.company, /GCB Bank/);
  assert.equal(p.fields.email, 'gcbbank.com.gh');
  assert.equal(lead('b', { email: 'x@gmail.com' }).fields.email, '');
});

test('matchSegment matches whole words with evidence, warm leads first, skips not-interested', () => {
  const profiles = [
    lead('cfo', { custom_data: { Position: 'CFO' } }),
    lead('acc', { custom_data: { Position: 'Senior Accountant' }, last_status: 'interested' }),
    lead('it', { custom_data: { Position: 'IT Officer' } }),
    lead('no', { custom_data: { Position: 'Auditor' }, last_status: 'not_interested' }),
    lead('mdx', { custom_data: { Position: 'Admin' } }),
  ];
  const m = matchSegment(profiles, { name: 'Finance', reason: '', pitch: '', keywords: ['cfo', 'accountant', 'auditor'], fields: ['title'], priority: 1 });
  assert.deepEqual(m.map((x) => x.contact_id), ['acc', 'cfo']);
  assert.match(m[0].evidence[0], /title: Senior Accountant/);
  // "md" must not match inside "Admin"
  assert.equal(keywordRegex('md').test('admin'), false);
  assert.equal(keywordRegex('md').test('MD, Acme'), true);
});

test('ruleSegments for the finance masterclass includes finance and warm groups', () => {
  const ev = AFRICON_SEED.find((s) => s.key === 'event-finance-masterclass-c3')!;
  const specs = ruleSegments({ title: ev.title, data: ev.data!, tags: ev.tags ?? [] });
  assert.ok(specs.some((s) => s.name.startsWith('Warm leads')));
  assert.ok(specs.some((s) => s.name === 'Finance, banking & insurance'));
});

test('parseSegments validates the AI answer', () => {
  const p = parseSegments(JSON.stringify({ summary: 's', segments: [
    { name: 'Banks', reason: 'r', pitch: 'p', keywords: ['Bank', 'CFO'], fields: ['company', 'bogus'], priority: 1, statuses: [] },
    { name: 'Empty', keywords: [] },
  ] }));
  assert.equal(p!.segments.length, 1);
  assert.deepEqual(p!.segments[0].keywords, ['bank', 'cfo']);
  assert.deepEqual(p!.segments[0].fields, ['company']);
});

test('company context renders upcoming events in date order and hides past ones', () => {
  const items = AFRICON_SEED.map((s, i) => ({
    id: `i${i}`, kind: s.kind, title: s.title, summary: s.summary, body: s.body, data: s.data ?? {}, tags: [], position: i, active: true,
    source: 'seed', seed_key: s.key, created_at: '', updated_at: '',
  })) as any[];
  const text = renderContext(items, '2026-11-20');
  assert.ok(!text.includes('Executive AI Masterclass for CEOs'), 'the 13-14 Nov event is past on 20 Nov');
  assert.ok(text.indexOf('Build AI Adoption') < text.indexOf('Finance Professionals'));
  assert.equal(isUpcoming({ kind: 'event', data: { start_date: '2026-11-26' } } as any, '2026-11-26'), true);
});
