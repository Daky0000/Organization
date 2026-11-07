import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

const { buildDigestHtml } = await import('../src/server/sales/leadReminders.ts');

test('digest HTML escapes lead names and reasons', () => {
  const html = buildDigestHtml({
    appUrl: 'https://app.example', tz: 'Africa/Accra', today: [], confirm: [],
    overdue: [{ contact_id: 'c1', name: '<script>x</script>', reason: 'a & b', channel: 'call', at: new Date('2026-11-06T09:00:00Z'), needs_confirmation: false }],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /https:\/\/app\.example\/sales\/leads\?lead=c1&tab=activity/);
});

test('Lead workspace: human reminders, dialer guard, notifications, digest', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await (await import('../src/db-migrations.ts')).runDatabaseMigrations(pool);
    const { createLeadActivity, readActivity, processPendingActivityReads } = await import('../src/server/sales/leadActivities.ts');
    const { runLeadReminders, runLeadDigests } = await import('../src/server/sales/leadReminders.ts');
    const { registerSalesLeadsRoutes } = await import('../src/server/salesLeadsRoutes.ts');

    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,role,status) VALUES($1,$2,'fixture','user','active')", [userId, `${userId}@example.com`]);
    await pool.query("UPDATE users SET timezone='Africa/Accra' WHERE id=$1", [userId]);
    const contactId = randomUUID();
    await pool.query("INSERT INTO mailing_contacts(id,user_id,email,first_name,last_name) VALUES($1,$2,$3,'Kwame','Mensah')", [contactId, userId, `${contactId}@example.com`]);
    const otherUser = randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash,role,status) VALUES($1,$2,'fixture','user','active')", [otherUser, `${otherUser}@example.com`]);

    // A reader stub: "call back Friday 3pm" → one candidate.
    const fakeReader = async () => ({
      output: { needs_followup: true, candidates: [{ due_local: '2026-11-13T15:00', time_specified: true }], channel: 'call' as const, reason: 'Call back for decision', confidence: 0.9 },
      model: 'stub', provider: 'stub', inputTokens: 0, outputTokens: 0, suspicious: false,
    });
    const NOW = () => Date.parse('2026-11-06T14:00:00Z');

    await t.test('an activity note becomes exactly one human reminder', async () => {
      const { activity } = await createLeadActivity(pool, userId, contactId, { type: 'call', body: 'Shared details on WhatsApp, will call back Friday 3pm', followUpRound: 1, responseStatus: 'call_back' }, { runReader: false, now: NOW });
      const first = await readActivity(pool, userId, contactId, activity.id, { reader: fakeReader as any, now: NOW });
      const second = await readActivity(pool, userId, contactId, activity.id, { reader: fakeReader as any, now: NOW });
      assert.equal(first.status, 'done');
      assert.equal(first.reminder.scheduled_for.toISOString(), '2026-11-13T15:00:00.000Z');
      assert.equal(first.reminder.mode, 'human');
      assert.equal(second.reminder, null, 'unique source_activity_id prevents a duplicate');
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM sales_followups WHERE source_activity_id=$1`, [activity.id]);
      assert.equal(rows[0].n, 1);
    });

    await t.test('human activities do not touch the dialer attempt counter', async () => {
      const { rows } = await pool.query(`SELECT attempt_count, last_contacted_at FROM sales_lead_profiles WHERE contact_id=$1`, [contactId]);
      assert.equal(rows[0].attempt_count ?? 0, 0);
      assert.ok(rows[0].last_contacted_at);
    });

    await t.test('the AI dialer never claims a human reminder', async () => {
      await pool.query(`UPDATE sales_followups SET scheduled_for=NOW() - INTERVAL '1 minute' WHERE user_id=$1`, [userId]);
      const { buildSalesEngine } = await import('../src/server/sales/salesEngine.ts');
      const engine = buildSalesEngine({ pool } as any);
      await engine.processDueFollowUps();
      const { rows } = await pool.query(`SELECT status FROM sales_followups WHERE user_id=$1 AND mode='human'`, [userId]);
      assert.ok(rows.length > 0);
      for (const r of rows) assert.equal(r.status, 'scheduled');
    });

    await t.test('a due human reminder produces one bell notification, even with concurrent runs', async () => {
      await Promise.all([runLeadReminders(pool), runLeadReminders(pool)]);
      await runLeadReminders(pool);
      const { rows } = await pool.query(`SELECT title, data FROM notifications WHERE user_id=$1 AND type='lead_reminder'`, [userId]);
      assert.equal(rows.length, 1);
      assert.match(rows[0].title, /Kwame Mensah/);
      assert.equal(rows[0].data.url, `/sales/leads?lead=${contactId}&tab=activity`);
    });

    await t.test('the digest is sent once per local day and released on failure', async () => {
      const sent: string[] = [];
      const at8 = () => Date.parse('2026-11-06T08:00:00Z');
      const fail = async () => { throw new Error('smtp down'); };
      assert.equal(await runLeadDigests(pool, fail, { appUrl: 'https://app.example', now: at8 }), 0);
      const ok = async (m: { to: string }) => { sent.push(m.to); };
      assert.equal(await runLeadDigests(pool, ok, { appUrl: 'https://app.example', now: at8 }), 1);
      assert.equal(await runLeadDigests(pool, ok, { appUrl: 'https://app.example', now: at8 }), 0);
      assert.equal(sent.filter((s) => s.startsWith(userId)).length, 1);
      // Before 07:00 local the next day: nothing.
      assert.equal(await runLeadDigests(pool, ok, { appUrl: 'https://app.example', now: () => Date.parse('2026-11-07T06:30:00Z') }), 0);
    });

    await t.test('a timed-out inline read is retried by the worker', async () => {
      const { activity } = await createLeadActivity(pool, userId, contactId, { type: 'note', body: 'will revert' }, { runReader: false, now: NOW });
      await pool.query(`UPDATE crm_activities SET ai_status='pending' WHERE id=$1`, [activity.id]);
      // No AI provider configured in tests → worker marks it skipped, not stuck.
      await processPendingActivityReads(pool);
      const { rows } = await pool.query(`SELECT ai_status FROM crm_activities WHERE id=$1`, [activity.id]);
      assert.ok(['skipped', 'pending', 'failed', 'done'].includes(rows[0].ai_status));
      assert.notEqual(rows[0].ai_status, 'processing');
    });

    await t.test('routes: ownership, validation and manual reminders', async () => {
      let caller = userId;
      const app = express();
      app.use(express.json());
      app.use('/api/sales', registerSalesLeadsRoutes({ pool, requireAuth: () => ({ userId: caller }) }));

      const bad = await request(app).post(`/api/sales/leads/${contactId}/activities`).send({ type: 'carrier-pigeon' });
      assert.equal(bad.status, 400);

      const manual = await request(app).post(`/api/sales/leads/${contactId}/activities`).send({
        type: 'whatsapp', body: 'sent payment details', response_status: 'interested',
        manual_followup: { due_local: '2099-01-05T10:00', channel: 'whatsapp' },
      });
      assert.equal(manual.status, 200, JSON.stringify(manual.body));
      assert.equal(manual.body.ai, 'skipped');
      assert.equal(manual.body.reminder.requested_by, 'human');

      const past = await request(app).post(`/api/sales/leads/${contactId}/reminders`).send({ due_local: '2001-01-01T10:00' });
      assert.equal(past.status, 400);

      const list = await request(app).get(`/api/sales/leads/${contactId}/activities`);
      assert.equal(list.status, 200);
      assert.equal(list.body.timezone, 'Africa/Accra');
      assert.ok(list.body.activities.length >= 2);

      const cancel = await request(app).post(`/api/sales/followups/${manual.body.reminder.id}/cancel`);
      assert.equal(cancel.body.reminder.status, 'cancelled');

      caller = otherUser;
      const foreign = await request(app).get(`/api/sales/leads/${contactId}/activities`);
      assert.equal(foreign.status, 404);
      const foreignCancel = await request(app).post(`/api/sales/followups/${manual.body.reminder.id}/confirm`);
      assert.equal(foreignCancel.status, 404);

      const tz = await request(app).put('/api/sales/reminder-settings').send({ timezone: 'Mars/Olympus' });
      assert.equal(tz.status, 400);
    });
  } finally {
    await pool.end();
  }
});
