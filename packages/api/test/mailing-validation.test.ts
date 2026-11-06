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

test('mailing: rejects contact without valid email', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/contacts').set('Authorization', authHeader()).send({ email: 'nope' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'Validation failed');
  assert.ok(res.body.issues.some((i: { path: string }) => i.path === 'email'));
});

test('mailing: rejects import without contacts array', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/contacts/import').set('Authorization', authHeader()).send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('mailing: rejects bulk action with unknown action', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/contacts/bulk').set('Authorization', authHeader()).send({ action: 'nuke', ids: ['a'] });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('mailing: rejects bulk action with empty ids', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/contacts/bulk').set('Authorization', authHeader()).send({ action: 'delete', ids: [] });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('mailing: rejects campaign without subject', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/campaigns').set('Authorization', authHeader()).send({ name: 'My campaign' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.issues.some((i: { path: string }) => i.path === 'subject'));
});

test('mailing: rejects segment without name', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/segments').set('Authorization', authHeader()).send({ rules: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('mailing: rejects automation without trigger_type', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/automations').set('Authorization', authHeader()).send({ name: 'Welcome flow' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('mailing: rejects send-email without subject', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/contacts/some-id/send-email').set('Authorization', authHeader()).send({ html: '<p>hi</p>' });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('mailing: requires auth before validation result leaks data', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/mailing/campaigns').send({ name: 'x', subject: 'y' });
  assert.equal(res.status, 401);
});
