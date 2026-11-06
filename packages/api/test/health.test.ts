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

test('GET /health returns ok + timestamp', async () => {
    const app = await loadApp();
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.timestamp, 'string');
    assert.ok(res.headers['x-request-id']);
});

test('404 includes request id', async () => {
    const app = await loadApp();
    const res = await request(app).get('/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.ok(res.headers['x-request-id']);
});
