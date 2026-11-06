import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// Locks the admin dashboard's API surface: every endpoint the admin UI calls
// must exist (unauthenticated requests get 401/403/400 — never 404). Catches
// the double-prefix / unmounted-router class of regression before deploy.

async function loadApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/server.ts');
  return mod.default;
}

const ADMIN_GET_ENDPOINTS = [
  '/api/admin/overview',
  '/api/admin/ai-config',
  '/api/admin/ai-usage',
  '/api/admin/ai-skills',
  '/api/admin/audit-logs',
  '/api/admin/auth-providers',
  '/api/admin/payments',
  '/api/admin/payments/stats',
  '/api/admin/platform-configs',
  '/api/admin/billing/customers',
  '/api/admin/billing/metrics',
  '/api/admin/agent-templates',
  '/api/admin/agent-tools',
  '/api/admin/platform-agents',
  '/api/admin/platform-agents/notifications',
  '/api/admin/google/config',
  '/api/admin/google/generations',
  '/api/admin/openai/config',
  '/api/admin/openai/generations',
  '/api/admin/kling/config',
  '/api/admin/kling/generations',
  '/api/admin/magnific/config',
  '/api/admin/magnific/generations',
  '/api/admin/replicate/config',
  '/api/admin/higgsfield/status',
  '/api/admin/higgsfield/generations',
  '/api/admin/apify/status',
  '/api/admin/apify/actors',
  '/api/admin/apify/runs',
  '/api/admin/mcp/servers',
  '/api/admin/media',
  '/api/admin/media/stats',
  '/api/platform/nav-settings', // reads here; writes go to PUT /api/admin/nav-settings
  '/api/learn',
  '/api/learn/meta',
  '/api/pricing/plans',
  '/api/users',
];

test('routes: every admin-UI endpoint resolves (no 404s)', async () => {
  const app = await loadApp();
  for (const path of ADMIN_GET_ENDPOINTS) {
    const res = await request(app).get(path);
    assert.notEqual(res.status, 404, `GET ${path} should exist (got 404)`);
  }
});

test('routes: admin endpoints reject unauthenticated requests', async () => {
  const app = await loadApp();
  // Spot-check the sensitive ones: must be 401/403 (never 200) without a token
  for (const path of ['/api/admin/overview', '/api/admin/platform-configs', '/api/admin/ai-config', '/api/users']) {
    const res = await request(app).get(path);
    assert.ok([401, 403].includes(res.status), `GET ${path} unauthenticated should be 401/403 (got ${res.status})`);
  }
});
