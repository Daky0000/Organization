import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

// The Resend handler ACKs with 200 immediately and processes asynchronously,
// so tests assert on whether the (fake) pool was touched after a settle delay.
const settle = () => new Promise((r) => setTimeout(r, 75));

async function buildApp(platformConfig: Record<string, string>) {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const { registerWebhookRoutes } = await import('../src/server/webhookRoutes.ts');

  const poolCalls: string[] = [];
  const pool = { query: async (sql: string) => { poolCalls.push(sql); return { rows: [] }; } };
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(registerWebhookRoutes({
    stripe: null,
    getStripeWebhookSecret: () => '',
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
  }));
  return { app, poolCalls };
}

const openedEvent = { type: 'email.opened', data: { email_id: 're_test_1' } };

test('resend webhook: unverified events are discarded in production', async () => {
  const { app, poolCalls } = await buildApp({}); // no webhookSecret configured
  const savedNodeEnv = process.env.NODE_ENV;
  const savedSecret = process.env.RESEND_WEBHOOK_SECRET;
  const savedAllow = process.env.RESEND_WEBHOOK_ALLOW_UNVERIFIED;
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_WEBHOOK_ALLOW_UNVERIFIED;
  process.env.NODE_ENV = 'production';
  try {
    const res = await request(app).post('/webhooks/resend').send(openedEvent);
    assert.equal(res.status, 200); // always ACKed so Resend does not retry-storm
    await settle();
    assert.equal(poolCalls.length, 0, 'unverified production event must never reach the DB');
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
    if (savedSecret !== undefined) process.env.RESEND_WEBHOOK_SECRET = savedSecret;
    if (savedAllow !== undefined) process.env.RESEND_WEBHOOK_ALLOW_UNVERIFIED = savedAllow;
  }
});

test('resend webhook: unverified events are still processed outside production', async () => {
  const { app, poolCalls } = await buildApp({});
  delete process.env.RESEND_WEBHOOK_SECRET;
  const res = await request(app).post('/webhooks/resend').send(openedEvent);
  assert.equal(res.status, 200);
  await settle();
  assert.ok(poolCalls.length > 0, 'dev/test convenience path should process the event');
});

test('resend webhook: invalid signature is discarded when a secret is configured', async () => {
  const { app, poolCalls } = await buildApp({ webhookSecret: 'whsec_' + Buffer.from('k'.repeat(24)).toString('base64') });
  const res = await request(app)
    .post('/webhooks/resend')
    .set('svix-id', 'msg_1')
    .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
    .set('svix-signature', 'v1,Zm9yZ2VkLXNpZ25hdHVyZQ==')
    .send(openedEvent);
  assert.equal(res.status, 200);
  await settle();
  assert.equal(poolCalls.length, 0, 'forged event must never reach the DB');
});
