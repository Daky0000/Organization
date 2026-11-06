import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// The lead-generation module (src/server/leads) was extracted from a
// single-tenant app: none of its own queries mention a user. Tenancy is bolted
// on from outside — an auth guard plus a Prisma extension that injects `userId`
// into every operation (src/server/leads-tenancy.ts).
//
// That makes two things worth locking down:
//
//  1. Every route is mounted and behind the guard. An unauthenticated request
//     must never reach the module, because the module would happily answer with
//     whatever rows it found.
//  2. The mount path stays /api/leadgen. /api/leads is a different, older
//     feature (Contacts' lead groups); if these two ever collide, one of them
//     silently stops working.

async function loadApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/server.ts');
  return mod.default;
}

// Every GET the module's UI calls on first paint.
const LEADGEN_GET_ENDPOINTS = [
  '/api/leadgen/leads',
  '/api/leadgen/leads/stats',
  '/api/leadgen/leads/groups',
  '/api/leadgen/leads/fields',
  '/api/leadgen/leads/export?format=xlsx',
  '/api/leadgen/imports',
  '/api/leadgen/imports/status',
];

const LEADGEN_WRITE_ENDPOINTS: [string, string][] = [
  ['post', '/api/leadgen/leads'],
  ['post', '/api/leadgen/leads/groups'],
  ['patch', '/api/leadgen/leads/bulk'],
  ['post', '/api/leadgen/leads/bulk/delete'],
  ['put', '/api/leadgen/leads/fields'],
  ['post', '/api/leadgen/imports/sheets'],
  ['post', '/api/leadgen/imports/analyze'],
];

test('leadgen: every endpoint is mounted (no 404s)', async () => {
  const app = await loadApp();
  for (const path of LEADGEN_GET_ENDPOINTS) {
    const res = await request(app).get(path);
    assert.notEqual(res.status, 404, `GET ${path} should exist (got 404)`);
  }
});

test('leadgen: unauthenticated reads are rejected, never answered', async () => {
  const app = await loadApp();
  for (const path of LEADGEN_GET_ENDPOINTS) {
    const res = await request(app).get(path);
    assert.ok(
      [401, 403].includes(res.status),
      `GET ${path} unauthenticated should be 401/403 (got ${res.status})`,
    );
  }
});

test('leadgen: unauthenticated writes are rejected before any body parsing', async () => {
  const app = await loadApp();
  for (const [method, path] of LEADGEN_WRITE_ENDPOINTS) {
    const res = await (request(app) as any)[method](path).send({});
    assert.ok(
      [401, 403].includes(res.status),
      `${method.toUpperCase()} ${path} unauthenticated should be 401/403 (got ${res.status})`,
    );
  }
});

test('leadgen: an invalid token is refused, not treated as anonymous', async () => {
  const app = await loadApp();
  const res = await request(app).get('/api/leadgen/leads').set('Authorization', 'Bearer not-a-real-token');
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
});

test('leadgen: does not shadow the older /api/leads feature', async () => {
  const app = await loadApp();
  // Contacts' lead groups still answer on their own path. A 404 here would mean
  // the new module had taken the mount point over.
  const res = await request(app).get('/api/leads/groups');
  assert.notEqual(res.status, 404, 'GET /api/leads/groups should still be mounted');
});
