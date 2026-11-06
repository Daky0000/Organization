import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

async function loadModule() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  return import('../src/server/connectorSyncRoutes.ts');
}

function makePool(jobRows: any[]) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    query: async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('FROM connector_sync_jobs')) return { rows: jobRows };
      return { rows: [] };
    },
  };
}

test('connector sync: manual run returns 501 and never fabricates a run record', async () => {
  const { registerConnectorSyncRoutes } = await loadModule();
  const pool = makePool([{ id: 'job-1' }]);
  const app = express();
  app.use(express.json());
  app.use(registerConnectorSyncRoutes({ requireAuth: () => ({ userId: 'u1' }), pool: pool as any }));

  const res = await request(app).post('/sync/jobs/job-1/run');
  assert.equal(res.status, 501);
  assert.match(res.body.error, /not available yet/i);
  assert.ok(
    !pool.calls.some((c) => c.sql.includes('connector_sync_runs')),
    'no sync run row may be created while adapters do not exist'
  );
});

test('connector sync: scheduler tick is a no-op until adapters exist', async () => {
  const { processDueConnectorSyncJobs } = await loadModule();
  const pool = makePool([]);
  await processDueConnectorSyncJobs(pool as any);
  assert.equal(pool.calls.length, 0, 'scheduler must not claim jobs or record fake runs');
});

test('test-user credit grant: disabled unless ENABLE_TEST_USER_CREDITS=true', async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const { isTestUserCreditGrantEnabled } = await import('../src/db-migrations.ts');
  assert.equal(isTestUserCreditGrantEnabled({}), false);
  assert.equal(isTestUserCreditGrantEnabled({ ENABLE_TEST_USER_CREDITS: 'true' }), true);
  assert.equal(isTestUserCreditGrantEnabled({ ENABLE_TEST_USER_CREDITS: '1' }), false, 'only the exact string "true" opts in');
});
