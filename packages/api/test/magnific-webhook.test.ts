import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';

// Magnific signs callbacks the Standard Webhooks way: base64 HMAC-SHA256 of
// "{webhook-id}.{webhook-timestamp}.{body}", keyed by the secret's UTF-8 bytes.
const SECRET = '0123456789abcdef0123456789abcdef';
const settle = () => new Promise((r) => setTimeout(r, 75));

function sign(body: string, opts: { id?: string; ts?: number; key?: Buffer } = {}) {
  const id = opts.id ?? 'wh_1';
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', opts.key ?? Buffer.from(SECRET, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

async function buildApp(platformConfig: Record<string, string>) {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  delete process.env.MAGNIFIC_WEBHOOK_SECRET;
  const { registerWebhookRoutes } = await import('../src/server/webhookRoutes.ts');

  const poolCalls: Array<{ sql: string; params?: any[] }> = [];
  const pool = { query: async (sql: string, params?: any[]) => { poolCalls.push({ sql, params }); return { rows: [] }; } };
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(registerWebhookRoutes({
    hasDatabase: () => true,
    dbQuery: async () => ({ rows: [] }),
    pool: pool as any,
    requireAuth: () => null,
    markSocialAccountNeedsReapproval: async () => undefined,
    logIntegrationEvent: async () => undefined,
    decryptIntegrationSecret: (s: string) => s,
    getPlatformConfig: async () => platformConfig,
    fireAutomationTrigger: async () => undefined,
    recalcLeadScore: async () => null,
  } as any));
  return { app, poolCalls };
}

const completed = JSON.stringify({ data: { task_id: 'task_42', status: 'COMPLETED', generated: ['https://cdn.example/out.png'] } });

test('magnific webhook: refused when no signing secret is configured', async () => {
  const { app, poolCalls } = await buildApp({});
  const res = await request(app).post('/webhooks/magnific').set('Content-Type', 'application/json').set(sign(completed)).send(completed);
  assert.equal(res.status, 503);
  await settle();
  assert.equal(poolCalls.length, 0);
});

test('magnific webhook: forged signature is refused', async () => {
  const { app, poolCalls } = await buildApp({ webhookSecret: SECRET });
  const res = await request(app).post('/webhooks/magnific').set('Content-Type', 'application/json')
    .set(sign(completed, { key: Buffer.from('not-the-secret') })).send(completed);
  assert.equal(res.status, 401);
  await settle();
  assert.equal(poolCalls.length, 0);
});

test('magnific webhook: stale timestamp is refused', async () => {
  const { app, poolCalls } = await buildApp({ webhookSecret: SECRET });
  const res = await request(app).post('/webhooks/magnific').set('Content-Type', 'application/json')
    .set(sign(completed, { ts: Math.floor(Date.now() / 1000) - 3600 })).send(completed);
  assert.equal(res.status, 401);
  await settle();
  assert.equal(poolCalls.length, 0);
});

test('magnific webhook: signed completion finishes the in-flight generation', async () => {
  const { app, poolCalls } = await buildApp({ webhookSecret: SECRET });
  const res = await request(app).post('/webhooks/magnific').set('Content-Type', 'application/json').set(sign(completed)).send(completed);
  assert.equal(res.status, 200);
  await settle();
  const update = poolCalls.find((c) => c.sql.includes('UPDATE magnific_generations'));
  assert.ok(update, 'expected the generation row to be updated');
  assert.deepEqual(update!.params, ['https://cdn.example/out.png', 'task_42']);
  assert.match(update!.sql, /status IN \('pending','processing'\)/, 'must never overwrite a finished or failed row');
});

test('magnific webhook: env secret is the fallback when admin has none', async () => {
  const { app, poolCalls } = await buildApp({});
  process.env.MAGNIFIC_WEBHOOK_SECRET = SECRET;
  try {
    const res = await request(app).post('/webhooks/magnific').set('Content-Type', 'application/json').set(sign(completed)).send(completed);
    assert.equal(res.status, 200);
    await settle();
    assert.ok(poolCalls.some((c) => c.sql.includes('UPDATE magnific_generations')));
  } finally {
    delete process.env.MAGNIFIC_WEBHOOK_SECRET;
  }
});

test('resend webhook: a correctly signed svix event still verifies after the refactor', async () => {
  const rawKey = Buffer.from('k'.repeat(24));
  const { app, poolCalls } = await buildApp({ webhookSecret: 'whsec_' + rawKey.toString('base64') });
  const body = JSON.stringify({ type: 'email.opened', data: { email_id: 're_test_1' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', rawKey).update(`msg_1.${ts}.${body}`).digest('base64');
  const res = await request(app).post('/webhooks/resend').set('Content-Type', 'application/json')
    .set('svix-id', 'msg_1').set('svix-timestamp', ts).set('svix-signature', `v1,${sig}`).send(body);
  assert.equal(res.status, 200);
  await settle();
  assert.ok(poolCalls.length > 0, 'verified event should reach the DB lookup');
});
