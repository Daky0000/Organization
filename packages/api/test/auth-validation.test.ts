import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

async function loadApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/server.ts');
  return mod.default;
}

test('rejects invalid register payload', async () => {
    const app = await loadApp();
    const res = await request(app).post('/api/auth/register').send({ email: 'not-an-email' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Validation failed');
});

test('rejects login without identifier/email', async () => {
    const app = await loadApp();
    const res = await request(app).post('/api/auth/login').send({ password: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
});
