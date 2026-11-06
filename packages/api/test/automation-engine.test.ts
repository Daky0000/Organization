import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'x'.repeat(32);

// config.ts validates env at import time, so env must be set before the engine
// (which transitively imports config) is loaded. Static imports would hoist
// above these assignments — hence the dynamic import.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = JWT_SECRET;
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
const {
  deriveTriggerType, matchesTrigger, runnableSteps, legacyActionsToSteps,
  delayToMs, personalize,
} = await import('../src/server/automationEngine.ts');

async function loadApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/server.ts');
  return mod.default;
}

function authHeader(): string {
  const token = jwt.sign({ userId: 'test-user-1', email: 'test@example.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

test('automation: trigger_type is derived from the flow trigger step', () => {
  const steps = [
    { type: 'trigger', config: { trigger: 'email_signup' } },
    { type: 'send_email', config: { subject: 'Welcome' } },
  ];
  assert.equal(deriveTriggerType(steps), 'email_signup');
  assert.equal(deriveTriggerType([{ type: 'trigger', config: {} }]), 'api');
  assert.equal(deriveTriggerType([]), 'api');
  assert.equal(deriveTriggerType(null), 'api');
});

test('automation: matchesTrigger honors stored type, step trigger, and signup alias', () => {
  // New flow-builder row: trigger lives in steps, stored type mirrors it
  const flow = { trigger_type: 'email_signup', steps: [{ type: 'trigger', config: { trigger: 'email_signup' } }] };
  assert.equal(matchesTrigger(flow, 'email_signup'), true);
  assert.equal(matchesTrigger(flow, 'signup'), true); // legacy alias
  assert.equal(matchesTrigger(flow, 'tag_added'), false);

  // Row created before trigger_type derivation: stored as 'api' but steps say otherwise
  const staleRow = { trigger_type: 'api', steps: [{ type: 'trigger', config: { trigger: 'tag_added' } }] };
  assert.equal(matchesTrigger(staleRow, 'tag_added'), true);

  // Legacy automation with no steps at all
  const legacy = { trigger_type: 'signup', steps: null };
  assert.equal(matchesTrigger(legacy, 'email_signup'), true);
});

test('automation: runnableSteps strips the trigger node and falls back to legacy actions', () => {
  const flow = {
    steps: [
      { type: 'trigger', config: { trigger: 'email_signup' } },
      { type: 'send_email', config: { subject: 'Hi' } },
    ],
    actions: null,
  };
  assert.deepEqual(runnableSteps(flow).map((s) => s.type), ['send_email']);

  const legacy = { steps: [], actions: [{ subject: 'Old welcome', content: '<p>hey</p>' }] };
  const converted = runnableSteps(legacy);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].type, 'send_email');
  assert.equal(converted[0].config?.subject, 'Old welcome');

  assert.deepEqual(legacyActionsToSteps(null), []);
});

test('automation: delayToMs converts units and clamps to at least 1', () => {
  assert.equal(delayToMs(5, 'minutes'), 5 * 60_000);
  assert.equal(delayToMs(2, 'hours'), 2 * 3_600_000);
  assert.equal(delayToMs(1, 'weeks'), 604_800_000);
  assert.equal(delayToMs(0, 'days'), 86_400_000); // clamped to 1
  assert.equal(delayToMs('junk', 'unknown-unit'), 86_400_000); // defaults: 1 day
});

test('automation: personalize substitutes contact placeholders', () => {
  const contact = { id: 'c1', email: 'ada@example.com', first_name: 'Ada', last_name: null };
  assert.equal(
    personalize('Hi {{first_name}} {{last_name}} ({{email}})', contact),
    'Hi Ada  (ada@example.com)'
  );
});

test('automation: manual run requires contact_id or email', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/automations/auto_x/run').set('Authorization', authHeader()).send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('automation: manual run requires auth', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/automations/auto_x/run').send({ email: 'a@b.com' });
  assert.equal(res.status, 401);
});

test('resend webhook: accepts events and returns 200', async () => {
  const app = await loadApp();
  const res = await request(app).post('/webhooks/resend').send({
    type: 'email.opened',
    data: { email_id: 'test-resend-id' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
});

test('resend webhook: ignores unknown event types without error', async () => {
  const app = await loadApp();
  const res = await request(app).post('/webhooks/resend').send({ type: 'email.delivery_delayed', data: {} });
  assert.equal(res.status, 200);
});

test('public trigger: rejects missing API key', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/v1/trigger').send({ email: 'a@b.com' });
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test('public trigger: rejects invalid body before auth leaks anything', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/v1/trigger')
    .set('Authorization', 'Bearer cf_live_deadbeef')
    .send({ email: 'not-an-email' });
  assert.equal(res.status, 400);
});

test('api keys: management requires auth', async () => {
  const app = await loadApp();
  const res = await request(app).get('/api/keys');
  assert.equal(res.status, 401);
});

test('forms: hosted form 404s for unknown id', async () => {
  const app = await loadApp();
  const res = await request(app).get('/f/nonexistent-form');
  assert.equal(res.status, 404);
});

test('forms: CRUD requires auth', async () => {
  const app = await loadApp();
  const res = await request(app).get('/api/forms');
  assert.equal(res.status, 401);
});

test('forms: create rejects invalid field keys', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/forms').set('Authorization', authHeader()).send({
    name: 'Bad form',
    fields: [{ key: 'has spaces!', label: 'Bad', type: 'text', required: false }],
  });
  assert.equal(res.status, 400);
});

test('mailing: contact timeline requires auth', async () => {
  const app = await loadApp();
  const res = await request(app).get('/api/mailing/contacts/c1/timeline');
  assert.equal(res.status, 401);
});

test('ai: admin usage endpoint rejects non-admin (403, or 503 fail-closed without DB)', async () => {
  const app = await loadApp();
  const res = await request(app).get('/api/admin/ai-usage').set('Authorization', authHeader());
  assert.equal([401, 403, 503].includes(res.status), true);
});

test('ai: model registry resolves Gemini equivalents including legacy IDs', async () => {
  const { resolveGeminiModel, FAST_MODEL, DEFAULT_CHAT_MODEL, CLAUDE_MODELS } = await import('../src/ai-helpers.ts');
  assert.equal(resolveGeminiModel('gemini-2.5-pro'), 'gemini-2.5-pro'); // passthrough
  assert.equal(resolveGeminiModel('claude-opus-4-8'), 'gemini-2.5-pro');
  assert.equal(resolveGeminiModel('claude-haiku-4-5-20251001'), 'gemini-2.0-flash'); // legacy id
  assert.equal(resolveGeminiModel('unknown-model'), 'gemini-2.0-flash'); // safe fallback
  assert.equal(FAST_MODEL, 'claude-haiku-4-5');
  assert.equal(DEFAULT_CHAT_MODEL, 'claude-opus-4-8');
  assert.ok(CLAUDE_MODELS.some((m) => m.id === DEFAULT_CHAT_MODEL));
});

test('credits: negative amount can no longer mint credits', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/credits/use').set('Authorization', authHeader()).send({ amount: -100000 });
  assert.equal(res.status, 400);
});

test('credits: non-integer and absurd amounts rejected', async () => {
  const app = await loadApp();
  for (const amount of [0, 2.5, 10_000, 'evil']) {
    const res = await request(app).post('/api/credits/use').set('Authorization', authHeader()).send({ amount });
    assert.equal(res.status, 400, `amount=${amount} should 400`);
  }
});

test('credits: cost math matches real API prices with 3x margin', async () => {
  const { computeAICostUsd, creditsForCostUsd, AI_PROFIT_MULTIPLIER, CREDIT_USD } = await import('../src/ai-helpers.ts');
  // Opus 4.8: $5/M in, $25/M out — 3K in + 500 out = $0.015 + $0.0125 = $0.0275
  const cost = computeAICostUsd('claude-opus-4-8', 3000, 500, 0);
  assert.ok(Math.abs(cost - 0.0275) < 1e-9, `cost=${cost}`);
  // ×3 margin at $0.01/credit → ceil(8.25) = 9 credits
  assert.equal(creditsForCostUsd(cost), 9);
  // Haiku: $1/M in, $5/M out — 2K in + 800 out = $0.006 → 2 credits
  assert.equal(creditsForCostUsd(computeAICostUsd('claude-haiku-4-5', 2000, 800)), 2);
  // Cache reads bill at ~0.1x input
  const cached = computeAICostUsd('claude-opus-4-8', 0, 0, 10000);
  assert.ok(Math.abs(cached - 0.005) < 1e-9);
  // Zero usage charges nothing; tiny usage charges minimum 1 credit
  assert.equal(creditsForCostUsd(0), 0);
  assert.equal(creditsForCostUsd(0.0001), 1);
  // Unknown models fall back to Sonnet-tier pricing (never undercharge to 0-cost)
  assert.ok(computeAICostUsd('mystery-model', 1000, 1000) > 0);
  assert.equal(AI_PROFIT_MULTIPLIER, 3);
  assert.equal(CREDIT_USD, 0.01);
});

test('routes: distribution/automation endpoints resolve at /api/* (double-prefix regression)', async () => {
  const app = await loadApp();
  // Unauthenticated: a live route returns 401, a missing route returns 404.
  for (const [method, path] of [
    ['get', '/api/automation/logs'],
    ['get', '/api/distribution/connected'],
    ['get', '/api/distribution/status/some-post'],
    ['post', '/api/automation/retry/some-log'],
    ['get', '/api/card-templates'],
    ['get', '/api/card-templates/published'],
    ['get', '/api/pricing/plans'],
    ['get', '/api/wordpress/status'],
  ] as const) {
    const res = await (request(app) as any)[method](path);
    assert.notEqual(res.status, 404, `${method.toUpperCase()} ${path} should exist (got 404)`);
  }
});

test('routes: meta data-deletion callbacks answer on both old and new paths', async () => {
  const app = await loadApp();
  for (const path of ['/api/meta/data-deletion', '/api/api/meta/data-deletion']) {
    const res = await request(app).post(path).send({});
    // 400 (signed_request required) proves the handler ran; 404 would mean broken
    assert.equal(res.status, 400, `${path} should reach the handler`);
  }
});

test('mcp: meigen gallery + inspiration markdown parse correctly (live-captured format)', async () => {
  const { parseGalleryMarkdown, parseInspirationMarkdown } = await import('../src/server/mcpRoutes.ts');

  const gallery = `Found 3 results for category: Photography:

1. **#305** by FL⭕RA — Photography
   ![Preview #305](https://images.meigen.ai/tweets/2021300975248736723/0.jpg)
   Prompt: A detailed, high-fashion studio photograph of a woman posing gracefully...
   Stats: 3143 likes, 400,448 views
   ID: 2021300975248736723

2. **#311** by Oogie — Photography
   ![Preview #311](https://images.meigen.ai/tweets/2011304086847832089/0.jpg)
   Prompt: Paparazzi-style extreme close-up photo of a woman...
   Stats: 2163 likes, 100,053 views
   ID: 2011304086847832089`;

  const entries = parseGalleryMarkdown(gallery);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, '2021300975248736723');
  assert.equal(entries[0].image, 'https://images.meigen.ai/tweets/2021300975248736723/0.jpg');
  assert.equal(entries[0].likes, 3143);
  assert.match(entries[0].prompt, /high-fashion studio photograph/);
  assert.equal(entries[1].likes, 2163);

  const detail = '# Trending Prompt #691\n## Generated Images\n![Image 1](https://images.meigen.ai/tweets/x/0.jpg)\n## Full Prompt\n```\nA first-person point-of-view (POV) shot inside a modern supermarket aisle.\n```\n## Metadata\n- Author: M (@x)\n- Model: nanobanana\n- Likes: 224';
  const parsed = parseInspirationMarkdown(detail);
  assert.match(parsed.prompt, /^A first-person point-of-view/);
  assert.equal(parsed.model, 'nanobanana');
});

test('routes: MCP admin + media endpoints resolve', async () => {
  const app = await loadApp();
  for (const [method, path] of [
    ['get', '/api/admin/mcp/servers'],
    ['get', '/api/mcp/media'],
    ['get', '/api/mcp/media/liked'],
    ['get', '/api/mcp/media/suggestions'],
    ['get', '/api/content-plans'],
    ['post', '/api/content-plans'],
  ] as const) {
    const res = await (request(app) as any)[method](path);
    assert.notEqual(res.status, 404, `${method.toUpperCase()} ${path} should exist (got 404)`);
  }
});

test('routes: tracking snippet and pixel are publicly reachable', async () => {
  const app = await loadApp();
  const js = await request(app).get('/t.js?u=nobody');
  assert.equal(js.status, 200);
  assert.match(String(js.headers['content-type']), /javascript/);

  const px = await request(app).get('/px.gif?u=nobody&url=https%3A%2F%2Fexample.com');
  assert.equal(px.status, 200);
  assert.match(String(px.headers['content-type']), /image\/gif/);
});

test('ssrf: private/reserved/metadata targets are blocked; public hosts allowed', async () => {
  const { isPrivateAddress, assertSafePublicUrl } = await import('../src/ssrf-guard.ts');

  // Direct IP checks
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.9', '192.168.1.1', '169.254.169.254',
                    '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} must be private`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} must be public`);
  }

  // URL-level guard rejects bad schemes, literals, and metadata
  for (const bad of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
                     'http://10.0.0.1/', 'http://localhost:8080/', 'file:///etc/passwd',
                     'gopher://x', 'http://[::1]/', 'http://user:pass@8.8.8.8/']) {
    await assert.rejects(assertSafePublicUrl(bad), undefined, `${bad} must be rejected`);
  }
  // A well-known public host resolves and passes
  await assert.doesNotReject(assertSafePublicUrl('https://example.com/'));
});
