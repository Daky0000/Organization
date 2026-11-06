import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

// The user's agents as a team: strategies carry a rationale and are replaced
// when their KPI keeps missing, research reaches the agents that use it,
// agents message each other, and approved work is handed downstream.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

const policy = await import('../src/server/agentTeam/policy.ts');

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-09-01T00:00:00Z');
const state = (over: Partial<Parameters<typeof policy.evaluateStrategy>[0]> = {}) => ({
  kpi: 'approval_rate' as const,
  baseline: 0.3,
  target: 0.6,
  evalWindowDays: 14,
  startedAt: t0,
  lastEvaluatedAt: null,
  consecutiveMisses: 0,
  ...over,
});
const at = (days: number) => new Date(t0.getTime() + days * DAY);

// ── Strategy evaluation ──────────────────────────────────────────────────────

test('strategy: not judged inside its evaluation window', () => {
  const e = policy.evaluateStrategy(state(), { value: 0.1, sample: 20 }, at(5));
  assert.equal(e.verdict, 'warming_up');
  assert.equal(e.counted, false);
  assert.equal(e.shouldSwitch, false);
  assert.match(e.reason, /Day 6 of a 14-day/);
});

test('strategy: two underperforming reviews in a row switch it, with the reason', () => {
  const first = policy.evaluateStrategy(state(), { value: 0.25, sample: 10 }, at(15));
  assert.equal(first.verdict, 'underperforming');
  assert.equal(first.counted, true);
  assert.equal(first.consecutiveMisses, 1);
  assert.equal(first.shouldSwitch, false);

  // A day later is too soon to count another review.
  const tooSoon = policy.evaluateStrategy(state({ lastEvaluatedAt: at(15), consecutiveMisses: 1 }), { value: 0.25, sample: 10 }, at(16));
  assert.equal(tooSoon.counted, false);
  assert.equal(tooSoon.consecutiveMisses, 1);
  assert.equal(tooSoon.shouldSwitch, false);

  const second = policy.evaluateStrategy(state({ lastEvaluatedAt: at(15), consecutiveMisses: 1 }), { value: 0.25, sample: 10 }, at(22));
  assert.equal(second.shouldSwitch, true);
  assert.match(second.reason, /25\.0%.*started at 30\.0%.*60\.0% target.*2 reviews in a row/);
});

test('strategy: reaching the target or improving on the baseline resets misses', () => {
  const hit = policy.evaluateStrategy(state({ consecutiveMisses: 1, lastEvaluatedAt: at(10) }), { value: 0.65, sample: 10 }, at(20));
  assert.equal(hit.verdict, 'on_track');
  assert.equal(hit.consecutiveMisses, 0);
  const better = policy.evaluateStrategy(state({ consecutiveMisses: 1, lastEvaluatedAt: at(10) }), { value: 0.45, sample: 10 }, at(20));
  assert.equal(better.verdict, 'progressing');
  assert.equal(better.consecutiveMisses, 0);
  assert.equal(better.shouldSwitch, false);
});

test('strategy: too little data is not a failure until it lasts three windows', () => {
  const early = policy.evaluateStrategy(state(), { value: 0.1, sample: 2 }, at(15));
  assert.equal(early.verdict, 'insufficient_data');
  assert.equal(early.shouldSwitch, false);
  const stale = policy.evaluateStrategy(state({ lastEvaluatedAt: at(30) }), { value: null, sample: 0 }, at(43));
  assert.equal(stale.shouldSwitch, true);
  assert.match(stale.reason, /measured on a signal/);
});

test('strategy: targets are sane for rates and counts', () => {
  assert.equal(policy.resolveTarget('approval_rate', 14, 0.4, 0.7), 0.7);
  assert.equal(policy.resolveTarget('approval_rate', 14, 0.4, 7), 0.46); // a rate above 1 is ignored
  assert.equal(policy.resolveTarget('approval_rate', 14, 0.4, 0.2), 0.46); // below baseline is ignored
  assert.equal(policy.resolveTarget('approval_rate', 14, 0.95), 1);
  assert.equal(policy.resolveTarget('engagement_rate', 14, null), 0.03);
  assert.equal(policy.resolveTarget('posts_published', 14, 4), 5);
  assert.equal(policy.resolveTarget('posts_published', 14, null), 6);
});

test('strategy: chooses a KPI the workspace can measure', () => {
  const none = { approval_rate: { value: null, sample: 0 }, engagement_rate: { value: null, sample: 0 }, publish_success_rate: { value: null, sample: 0 }, posts_published: { value: 0, sample: 0 } };
  assert.equal(policy.chooseMeasurableKpi('engagement_rate', none), 'posts_published');
  assert.equal(policy.chooseMeasurableKpi(null, none), 'approval_rate');
  const engaged = { ...none, engagement_rate: { value: 0.02, sample: 5 } };
  assert.equal(policy.chooseMeasurableKpi('publish_success_rate', engaged), 'engagement_rate');
  assert.equal(policy.chooseMeasurableKpi('engagement_rate', engaged), 'engagement_rate');
});

test('playbooks: chosen from the signals, with a reason, never repeating a failed one', () => {
  const perf = { approval_rate: { value: 0.2, sample: 10 }, engagement_rate: { value: null, sample: 0 }, publish_success_rate: { value: null, sample: 0 }, posts_published: { value: 0, sample: 0 } };
  const first = policy.pickPlaybook({ perf, niche: 'vegan bakeries', excludedPlaybooks: [] });
  assert.equal(first.playbook, 'consistency_cadence');
  assert.equal(first.kpi, 'posts_published');
  assert.ok(first.rationale.length > 40);
  const second = policy.pickPlaybook({ perf, niche: 'vegan bakeries', excludedPlaybooks: ['consistency_cadence'] });
  assert.equal(second.playbook, 'proven_themes');
  assert.match(second.rationale, /20\.0%.*10 decisions/);
  const trend = policy.pickPlaybook({ perf: { ...perf, posts_published: { value: 5, sample: 5 }, approval_rate: { value: 0.7, sample: 10 } }, niche: 'vegan bakeries', topTrend: 'oat-milk croissants', excludedPlaybooks: [] });
  assert.equal(trend.playbook, 'ride_niche_trend');
  assert.match(trend.rationale, /oat-milk croissants.*vegan bakeries/);
  // Everything excluded still yields a strategy.
  const last = policy.pickPlaybook({ perf, niche: '', excludedPlaybooks: ['consistency_cadence', 'proven_themes', 'audience_pain_focus'] });
  assert.ok(last.title);
});

test('director plans: unusable answers are rejected, the rest is cleaned', () => {
  const perf = { approval_rate: { value: 0.5, sample: 8 }, engagement_rate: { value: null, sample: 0 }, publish_success_rate: { value: null, sample: 0 }, posts_published: { value: 1, sample: 1 } };
  assert.equal(policy.normalizeStrategyPlan({ title: 'x', rationale: 'too short' }, perf, ['daky']), null);
  const plan = policy.normalizeStrategyPlan({
    title: 'Educate first',
    rationale: 'Approval is 50% and research shows buyers ask how-to questions first.',
    kpi: 'engagement_rate',
    eval_window_days: 90,
    focus: { daky: 'Write how-to posts', ghost: 'nope', NOVA: 'Diagrams' },
    evidence: ['approval 50%'],
  }, perf, ['daky', 'nova']);
  assert.ok(plan);
  assert.equal(plan!.kpi, 'approval_rate'); // no engagement data yet
  assert.equal(plan!.evalWindowDays, policy.MAX_WINDOW_DAYS);
  assert.deepEqual(Object.keys(plan!.focus).sort(), ['daky', 'nova']);
});

// ── Routing and messages ─────────────────────────────────────────────────────

test('research: each agent gets the slice it uses', () => {
  const findings = { summary: 's', trends: [{ name: 't' }], keywords: [{ term: 'k' }], audience: { pains: ['p'] }, competitors: [{ name: 'c' }] };
  const seo = policy.selectResearchFor('seo_research', findings);
  assert.ok(seo.keywords && seo.competitors && seo.summary);
  assert.equal(seo.trends, undefined);
  const sage = policy.selectResearchFor('sage', findings);
  assert.ok(sage.trends && sage.keywords && sage.audience);
  assert.deepEqual(policy.selectResearchFor('unknown_agent', findings), { summary: 's' });
});

test('research: findings are normalised and invented structure is dropped', () => {
  assert.equal(policy.normalizeFindings({}), null);
  const f = policy.normalizeFindings(policy.extractJsonObject('Here you go:\n```json\n{"summary":"Niche is growing","trends":[{"name":"A","why":"b"},{"why":"no name"}],"audience":{"pains":["slow", 3]}}\n```'));
  assert.ok(f);
  assert.equal(f!.trends.length, 1);
  assert.deepEqual(f!.audience.pains, ['slow']);
  assert.equal(policy.extractJsonObject('no json here'), null);
});

test('messages: agents can only send valid messages to real teammates', () => {
  const known = ['daky', 'nova', 'sage'];
  const out = policy.sanitizeAgentMessages('daky', [
    { to: 'nova', kind: 'request', subject: 'Need a visual', body: 'For the launch post' },
    { to: 'nova', kind: 'request', subject: 'need a visual', body: 'duplicate' },
    { to: 'daky', kind: 'insight', subject: 'self', body: 'self' },
    { to: 'ghost', kind: 'request', subject: 'x', body: 'y' },
    { to: 'sage', kind: 'directive', subject: 'only the director directs', body: 'y' },
    { to: 'director', kind: 'alert', subject: 'Strategy is off', body: 'Users reject trend posts' },
    { to: 'sage', kind: 'insight', subject: 'One', body: 'b' },
    { to: '*', kind: 'insight', subject: 'Two', body: 'b' },
  ], known);
  assert.deepEqual(out.map((m) => m.to), ['nova', 'director', 'sage']);
  assert.deepEqual(policy.sanitizeAgentMessages('daky', 'nope', known), []);
});

test('handoffs: downstream and upstream are consistent', () => {
  assert.ok(policy.handoffTargets('sage').includes('daky'));
  assert.ok(policy.upstreamAgents('daky').includes('sage'));
  assert.ok(policy.upstreamAgents('daky').includes('trend_research'));
  assert.deepEqual(policy.handoffTargets('calculator'), []);
});

// ── Against PostgreSQL ───────────────────────────────────────────────────────
// The coordination module uses the shared db.ts pool, so this runs only when
// that pool points at the test database.

const pgReady = Boolean(process.env.TEST_DATABASE_URL) && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL;

test('team coordination against PostgreSQL', { skip: !pgReady }, async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const { pool, setDbReady } = await import('../src/db.ts');
  assert.ok(pool);
  await (await import('../src/db-migrations.ts')).runDatabaseMigrations(pool as any);
  await (await import('../src/payment-migrations.ts')).runPaymentMigrations(pool as any);
  setDbReady(true);
  const team = await import('../src/server/agentTeam/coordination.ts');
  const { registerAgentTeamRoutes } = await import('../src/server/agentTeamRoutes.ts');

  const userId = `agent-team-${randomUUID()}`;
  await pool!.query("INSERT INTO users(id,email,password_hash,role,status) VALUES($1,$2,'fixture','user','active')", [userId, `${userId}@example.test`]);
  await pool!.query(`INSERT INTO brand_profiles (user_id, brand_name, niche, audience) VALUES ($1,'Crumb','vegan bakeries','home bakers')`, [userId]);
  // Mostly rejected proposals and nothing published.
  for (let i = 0; i < 6; i++) {
    await pool!.query(
      `INSERT INTO user_agent_tasks (user_id, agent_key, title, status, decided_at) VALUES ($1,'daky',$2,$3,NOW() - INTERVAL '2 days' + $4::int * INTERVAL '1 minute')`,
      [userId, `Idea ${i}`, i === 0 ? 'approved' : 'rejected', i],
    );
  }

  // First review: no AI provider, so a built-in playbook is adopted, with a rationale.
  const first = await team.runDirectorReview(userId);
  assert.equal(first.switched, false);
  assert.match(String(first.research_error), /No AI provider/);
  assert.ok(first.strategy);
  assert.equal(first.strategy!.playbook, 'consistency_cadence');
  assert.ok(first.strategy!.rationale.length > 40);
  assert.equal(first.strategy!.kpi, 'posts_published');

  // The team is told, and agents with a focus get their own directive.
  const dakyInbox = await team.readAgentInbox(userId, 'daky');
  assert.ok(dakyInbox.some((m) => m.kind === 'directive' && m.subject.startsWith('Team strategy:')));
  assert.ok(dakyInbox.some((m) => m.subject.startsWith('Your focus under')));
  const { briefing, inboxIds } = await team.buildAgentBriefing(userId, 'daky');
  assert.equal(briefing.team_strategy?.title, first.strategy!.title);
  assert.ok(briefing.team_strategy?.your_focus);
  assert.deepEqual(briefing.your_track_record, { approved: 1, rejected: 5, recently_rejected: ['Idea 5', 'Idea 4', 'Idea 3', 'Idea 2'] });
  await team.markInboxConsumed(userId, 'daky', inboxIds);
  assert.equal((await team.readAgentInbox(userId, 'daky')).length, 0);
  // Team-wide messages stay open for the others.
  assert.ok((await team.readAgentInbox(userId, 'nova')).some((m) => m.subject.startsWith('Team strategy:')));

  // Approved work is handed to the agents downstream.
  await pool!.query(`INSERT INTO user_agent_tasks (user_id, agent_key, title, body, status, decided_at) VALUES ($1,'sage','Own the oat-milk niche','Lead with oat-milk recipes','approved',NOW())`, [userId]);
  const sent = await team.handOffApprovedWork(userId, { id: randomUUID(), agent_key: 'sage', task_type: 'strategy_proposal', title: 'Own the oat-milk niche', body: 'Lead with oat-milk recipes' });
  assert.equal(sent, policy.handoffTargets('sage').length);
  assert.ok((await team.readAgentInbox(userId, 'nova')).some((m) => m.kind === 'handoff' && m.from === 'sage'));
  const dakyBrief = await team.buildAgentBriefing(userId, 'daky');
  assert.deepEqual(dakyBrief.briefing.teammates_approved_work?.map((w) => w.title), ['Own the oat-milk niche']);

  // Fifteen days on with still nothing published: one miss. A week later: switched.
  const started = new Date(first.strategy!.started_at).getTime();
  const review1 = await team.runDirectorReview(userId, { now: new Date(started + 15 * DAY) });
  assert.equal(review1.evaluation?.verdict, 'underperforming');
  assert.equal(review1.switched, false);
  await pool!.query(`UPDATE agent_strategies SET last_evaluated_at = $2 WHERE id = $1`, [first.strategy!.id, new Date(started + 15 * DAY)]);
  const review2 = await team.runDirectorReview(userId, { now: new Date(started + 22 * DAY) });
  assert.equal(review2.switched, true);
  assert.equal(review2.previous_strategy?.id, first.strategy!.id);
  assert.notEqual(review2.strategy!.playbook, 'consistency_cadence');
  assert.match(review2.strategy!.rationale, /Replaces "Build a consistent publishing cadence"/);

  const strategies = await team.listStrategies(userId);
  const old = strategies.find((s) => s.id === first.strategy!.id)!;
  assert.equal(old.status, 'superseded');
  assert.equal(old.superseded_by, review2.strategy!.id);
  assert.match(String(old.ended_reason), /2 reviews in a row/);
  const reviews = await team.listStrategyReviews(userId, first.strategy!.id);
  assert.deepEqual(reviews.map((r: any) => r.verdict), ['switched', 'underperforming']);
  // Directives from the old strategy are withdrawn.
  const { rows: stale } = await pool!.query(`SELECT COUNT(*)::int AS n FROM agent_messages WHERE user_id=$1 AND status='open' AND kind='directive' AND context->>'strategy_id' = $2`, [userId, first.strategy!.id]);
  assert.equal(stale[0].n, 0);

  // Routes.
  const app = express();
  app.use(express.json());
  app.use(registerAgentTeamRoutes({ requireAuth: () => ({ userId }), hasDatabase: () => true }));
  const overview = await request(app).get('/user/agent-team/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.strategy.id, review2.strategy!.id);
  assert.equal(overview.body.history[0].status, 'superseded');
  assert.ok(overview.body.messages.length > 0);
  assert.equal((await request(app).post('/user/agent-team/messages').send({ to: 'ghost', subject: 's', body: 'b' })).status, 400);
  const direct = await request(app).post('/user/agent-team/messages').send({ to: 'nova', subject: 'Use our new palette', body: 'Sage green and cream from now on.' });
  assert.equal(direct.status, 200);
  assert.equal((await team.readAgentInbox(userId, 'nova'))[0].from, 'user');
  assert.equal((await request(app).put('/user/agent-team/strategy').send({ title: 'Mine', rationale: 'short' })).status, 400);
  const own = await request(app).put('/user/agent-team/strategy').send({ title: 'Recipes every Tuesday', rationale: 'Our customers ask for recipes more than anything else.', kpi: 'posts_published', eval_window_days: 7 });
  assert.equal(own.status, 200);
  assert.equal(own.body.strategy.created_by, 'user');
  assert.equal((await team.getActiveStrategy(userId))!.title, 'Recipes every Tuesday');
  assert.equal((await request(app).post('/user/agent-team/research')).status, 503);

  // Research through a stub Claude API: the fallback parameter is refused
  // once, the search turn pauses and is continued, and sources are kept.
  const bodies: any[] = [];
  const stub = express();
  stub.use(express.json({ limit: '5mb' }));
  stub.post('/v1/messages', (req, res) => {
    bodies.push(req.body);
    const usage = { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 2 } };
    if (bodies.length === 1) return res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: unknown parameter' } });
    if (bodies.length === 2) {
      return res.json({
        id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'pause_turn', usage,
        content: [{ type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://example.test/vegan', title: 'Vegan baking 2026', encrypted_content: 'x' }] }],
      });
    }
    return res.json({
      id: 'm2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 80 },
      content: [{ type: 'text', text: JSON.stringify({ summary: 'Home bakers want egg-free basics.', trends: [{ name: 'Aquafaba meringues', why: 'Rising searches' }], audience: { pains: ['Eggless bakes collapse'] } }) }],
    });
  });
  const stubServer = stub.listen(0);
  const prevBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stubServer.address() as any).port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  try {
    await (await import('../src/ai-helpers.ts')).grantCredits(userId, 500, 'test_grant');
    const outcome = await team.runNicheResearch(userId);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (outcome.ok) {
      assert.equal(outcome.research.method, 'web_search');
      assert.deepEqual(outcome.research.sources, [{ title: 'Vegan baking 2026', url: 'https://example.test/vegan' }]);
      assert.equal(outcome.research.findings.trends[0].name, 'Aquafaba meringues');
    }
    assert.equal(bodies.length, 3);
    assert.equal(bodies[0].fallbacks, 'default');
    assert.equal(bodies[1].fallbacks, undefined);
    assert.equal(bodies[1].tools[0].type, 'web_search_20260209');
    assert.equal(bodies[1].model, 'claude-opus-5-5');
    assert.equal(bodies[2].messages.length, 2); // the paused turn was continued
    // Research-relevant agents now see it; the team was told.
    const seo = await team.buildAgentBriefing(userId, 'hook_writing');
    assert.deepEqual((seo.briefing.niche_research as any).audience.pains, ['Eggless bakes collapse']);
    assert.ok((await team.readAgentInbox(userId, 'daky')).some((m) => m.kind === 'insight' && m.from === 'trend_research'));
  } finally {
    stubServer.close();
    delete process.env.ANTHROPIC_API_KEY;
    if (prevBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prevBase;
  }

  // The user stays: the credit ledger keeps its history, and ids are unique per run.
});
