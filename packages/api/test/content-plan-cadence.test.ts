import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const { CLAIM_DUE_PLANS_SQL, clampPerDay, MAX_PLAN_PER_DAY } = await import('../src/server/contentPlanRoutes.ts');

test('content plans: per-day input is clamped to 1..48', () => {
  assert.equal(clampPerDay(20), 20);
  assert.equal(clampPerDay('48'), 48);
  assert.equal(clampPerDay(500), MAX_PLAN_PER_DAY);
  assert.equal(clampPerDay(0), 3, 'zero/invalid falls back to the default');
  assert.equal(clampPerDay('junk'), 3);
});

// The claim's interval arithmetic only means anything against real Postgres.
test('content plans: claim spaces 20/day exactly 72 minutes apart without drift', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await pool.query(`CREATE TEMP TABLE content_plans (
      id TEXT PRIMARY KEY, status TEXT, per_day INTEGER, next_run_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
      last_run_at TIMESTAMPTZ, runs_count INTEGER DEFAULT 0, updated_at TIMESTAMPTZ)`);
    // Due 5 minutes ago (the tick noticed late): next slot is due + 72 min, not now + 72 min.
    await pool.query(`INSERT INTO content_plans (id,status,per_day,next_run_at) VALUES
      ('p20','active',20,NOW() - INTERVAL '5 minutes'),
      ('p48','active',48,NOW() - INTERVAL '1 minute'),
      ('stale','active',20,NOW() - INTERVAL '3 days'),
      ('future','active',20,NOW() + INTERVAL '10 minutes'),
      ('paused','paused',20,NOW() - INTERVAL '1 hour')`);
    const before = await pool.query(`SELECT id, next_run_at FROM content_plans`);
    const due0 = Object.fromEntries(before.rows.map((r) => [r.id, new Date(r.next_run_at).getTime()]));

    const { rows } = await pool.query(CLAIM_DUE_PLANS_SQL);
    const claimed = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(claimed).sort(), ['p20', 'p48', 'stale']);

    const gap = (id: string) => (new Date(claimed[id].next_run_at).getTime() - due0[id]) / 60_000;
    assert.ok(Math.abs(gap('p20') - 72) < 0.01, `20/day → 72 min, got ${gap('p20')}`);
    assert.ok(Math.abs(gap('p48') - 30) < 0.01, `48/day → 30 min, got ${gap('p48')}`);
    // A plan days behind resumes about a minute from now, not with a burst of missed slots.
    const staleAhead = (new Date(claimed.stale.next_run_at).getTime() - Date.now()) / 1000;
    assert.ok(staleAhead > 30 && staleAhead < 90, `stale plan resumes ~60s out, got ${staleAhead}s`);
    assert.equal(claimed.p20.runs_count, 1);

    // Simulate a day of 2-minute ticks for the 20/day plan: exactly 20 claims.
    await pool.query(`DELETE FROM content_plans`);
    await pool.query(`INSERT INTO content_plans (id,status,per_day,next_run_at) VALUES ('day','active',20,'2026-01-01T00:00:00Z')`);
    let claims = 0;
    for (let minute = 0; minute < 24 * 60; minute += 2) {
      const now = `TIMESTAMPTZ '2026-01-01T00:00:00Z' + make_interval(mins => ${minute})`;
      const sql = CLAIM_DUE_PLANS_SQL.replace(/NOW\(\)/g, now);
      claims += (await pool.query(sql)).rowCount ?? 0;
    }
    assert.equal(claims, 20, `expected 20 runs in 24h at 20/day, got ${claims}`);
  } finally {
    await pool.end();
  }
});
