import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'x'.repeat(32);

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

test('billing: rejects checkout without planId', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/billing/checkout').set('Authorization', authHeader()).send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'Validation failed');
});

test('billing: rejects checkout with invalid period', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/billing/checkout').set('Authorization', authHeader()).send({ planId: 'plan-1', period: 'weekly' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('billing: unauthenticated checkout with valid body is rejected', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/billing/checkout').send({ planId: 'plan-1' });
  assert.equal(res.status, 401);
});
