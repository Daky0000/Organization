import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';

// DakyX accounts: sign-in through DakyXTech OS, retainer grants, change events.
// A stub stands in for the OS; everything on this side is the real code against
// a real PostgreSQL. Half of what is asserted is refusals.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32); process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32); process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

import { Pool } from 'pg';
const { getEffectivePlan: getEffectivePlanFor, signToken, requireAuth } = await import('../src/user-auth.ts');
const { checkPlanQuota, resolvePlanQuotaLimits, PLAN_QUOTA_BY_TIER } = await import('../src/middleware/planQuotaMiddleware.ts');
const dakyx = await import('../src/server/dakyxRoutes.ts');

test('Pro holds more social accounts than Starter', () => {
  assert.ok(PLAN_QUOTA_BY_TIER.pro.social_accounts > PLAN_QUOTA_BY_TIER.growth.social_accounts);
  assert.ok(PLAN_QUOTA_BY_TIER.growth.social_accounts > PLAN_QUOTA_BY_TIER.starter.social_accounts);
  assert.equal(resolvePlanQuotaLimits('Agency'), PLAN_QUOTA_BY_TIER.agency);
  assert.equal(resolvePlanQuotaLimits('pro'), PLAN_QUOTA_BY_TIER.pro);
});

test('DakyX routes are mounted before social auth, whose /api/auth/:provider/start would 404 "dakyx"', async () => {
  const { readFileSync } = await import('node:fs');
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  const dakyxAt = server.indexOf('app.use(registerDakyxRoutes(');
  const socialAt = server.indexOf('app.use(registerSocialAuthRoutes(');
  assert.ok(dakyxAt > 0 && socialAt > 0 && dakyxAt < socialAt);
});

test('event signatures: right key and fresh only', () => {
  const body = '{"id":"e1"}'; const ts = String(Date.now());
  const sig = createHmac('sha256', 'k').update(`${ts}.${body}`).digest('hex');
  assert.equal(dakyx.verifyDakyxSignature('k', { 'x-dakyworld-signature': sig, 'x-dakyworld-timestamp': ts }, body), true);
  assert.equal(dakyx.verifyDakyxSignature('other', { 'x-dakyworld-signature': sig, 'x-dakyworld-timestamp': ts }, body), false);
  assert.equal(dakyx.verifyDakyxSignature('k', { 'x-dakyworld-signature': sig, 'x-dakyworld-timestamp': ts }, body + ' '), false);
  assert.equal(dakyx.verifyDakyxSignature('k', { 'x-dakyworld-signature': sig, 'x-dakyworld-timestamp': ts }, body, Date.now() + 10 * 60_000), false);
  assert.equal(dakyx.marketingGrant({ subject: 's', version: 1, active: true, grants: [{ product: 'marketing-suite', tier: 'Pro Plus', source: 'comp', validUntil: null }] }), null);
  assert.equal(dakyx.marketingGrant({ subject: 's', version: 1, active: false, grants: [{ product: 'marketing-suite', tier: 'pro', source: 'retainer', validUntil: null }] }), null);
});

test('DakyX sign-in, linking, grants and events against PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  // Its own pool, like credit-store.test.ts: under --test-isolation=none the
  // shared db.ts module was loaded by an earlier file and points elsewhere.
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const dbQuery = (sql: string, params?: unknown[]) => pool.query(sql, params as any[]);
  const getEffectivePlan = (userId: string) => getEffectivePlanFor(userId, dbQuery as any);
  await (await import('../src/db-migrations.ts')).runDatabaseMigrations(pool);
  await (await import('../src/payment-migrations.ts')).runPaymentMigrations(pool);
  await dakyx.runDakyxMigrations(pool);

  // ── the OS, stubbed ─────────────────────────────────────────────────────────
  const os = { challenges: new Map<string, string>(), identities: new Map<string, any>(), entitlements: new Map<string, any>(), down: false, iss: 'https://os.example.test' };
  const osApp = express(); osApp.use(express.urlencoded({ extended: false }));
  osApp.post('/api/auth/oauth/token', (req, res) => {
    if (req.get('authorization') !== `Basic ${Buffer.from('marketing:client-secret').toString('base64')}`) return res.status(401).json({ error: 'invalid_client' });
    const challenge = os.challenges.get(req.body.code);
    os.challenges.delete(req.body.code);
    if (!challenge || createHash('sha256').update(String(req.body.code_verifier)).digest('base64url') !== challenge) return res.status(400).json({ error: 'invalid_grant' });
    const who = os.identities.get(req.body.code);
    res.json({ iss: os.iss, aud: 'marketing', ...who, entitlements: os.entitlements.get(who.sub) });
  });
  osApp.get('/api/partner/v1/entitlements/:sub', (req, res) => {
    if (os.down) return res.status(503).end();
    if (req.get('authorization') !== 'Bearer partner-key') return res.status(401).end();
    res.json(os.entitlements.get(req.params.sub) ?? { subject: req.params.sub, version: Date.now(), active: false, grants: [] });
  });
  const osServer = osApp.listen(0);
  const osBase = `http://127.0.0.1:${(osServer.address() as AddressInfo).port}`;
  const env = { DAKYX_BASE_URL: osBase, DAKYX_CLIENT_SECRET: 'client-secret', DAKYX_PARTNER_KEY: 'partner-key', DAKYX_ISSUER: 'https://os.example.test' } as NodeJS.ProcessEnv;
  const getUserById = async (id: string) => (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  const deps = { pool, dbQuery, hasDatabase: () => true, requireAuth, getUserById, signToken, appUrl: 'https://marketing.example.test', env };

  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(dakyx.registerDakyxRoutes(deps as any));

  const grantOf = (sub: string, tier: string | null, version = Date.now()) => ({
    subject: sub, version, active: true,
    grants: tier ? [{ product: 'marketing-suite', tier, source: 'retainer', validUntil: null }, { product: 'website-builder', tier: 'MANAGED', source: 'retainer', validUntil: null }] : [],
  });
  /** Runs start → (the OS approving) → callback and returns where the browser ends up. */
  async function signIn(identity: { sub: string; email: string; email_verified: boolean; name: string }, opts: { startPath?: string; bearer?: string } = {}) {
    let authorizeUrl: string;
    if (opts.bearer) authorizeUrl = (await request(app).post('/api/auth/dakyx/link-start').set('Authorization', `Bearer ${opts.bearer}`)).body.url;
    else authorizeUrl = (await request(app).get('/api/auth/dakyx/start')).headers.location;
    const url = new URL(authorizeUrl);
    assert.equal(url.origin + url.pathname, `${osBase}/api/auth/oauth/authorize`);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://marketing.example.test/api/auth/dakyx/callback');
    const code = randomUUID();
    os.challenges.set(code, url.searchParams.get('code_challenge')!);
    os.identities.set(code, identity);
    const response = await request(app).get(`/api/auth/dakyx/callback?code=${code}&state=${url.searchParams.get('state')}&iss=${encodeURIComponent(os.iss)}`);
    return { location: response.headers.location as string, state: url.searchParams.get('state')!, code };
  }
  const tokenFrom = (location: string) => decodeURIComponent(new URL(location).hash.match(/auth_token=([^&]+)/)?.[1] ?? '');
  const userIdOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).userId as string;
  const created: string[] = [];

  try {
    assert.equal((await request(express().use(dakyx.registerDakyxRoutes({ ...deps, env: {} } as any))).get('/api/auth/dakyx/config')).body.enabled, false, 'switched off with no configuration');
    assert.equal((await request(app).get('/api/auth/dakyx/config')).body.enabled, true);

    // A new person on a Growth retainer: account created, Pro granted.
    const ama = { sub: `os_${randomUUID().slice(0, 12)}`, email: `ama-${randomUUID()}@example.com`, email_verified: true, name: 'Ama' };
    os.entitlements.set(ama.sub, grantOf(ama.sub, 'pro'));
    let result = await signIn(ama);
    assert.match(result.location, /^https:\/\/marketing\.example\.test\/login#auth_token=/, 'a new DakyX customer lands signed in');
    const amaId = userIdOf(tokenFrom(result.location)); created.push(amaId);
    const plan = await getEffectivePlan(amaId);
    assert.deepEqual([plan.name, plan.tier, plan.source], ['Pro', 'pro', 'dakyx'], 'on the plan their retainer includes');
    assert.equal((await checkPlanQuota(pool, amaId, 'social_accounts', plan.name)).limit, PLAN_QUOTA_BY_TIER.pro.social_accounts, 'and every quota reads it');

    // Signing in again finds the same account rather than making another.
    result = await signIn(ama);
    assert.equal(userIdOf(tokenFrom(result.location)), amaId);

    // A state works once.
    const replay = await request(app).get(`/api/auth/dakyx/callback?code=${result.code}&state=${result.state}`);
    assert.match(replay.headers.location, /auth_error=/, 'a spent state is refused');

    // A wrong issuer is refused.
    const wrong = await request(app).get('/api/auth/dakyx/start');
    const wrongState = new URL(wrong.headers.location).searchParams.get('state');
    assert.match((await request(app).get(`/api/auth/dakyx/callback?code=x&state=${wrongState}&iss=https%3A%2F%2Fevil.example`)).headers.location, /auth_error=/);

    // Somebody who already has an account here, unverified at DakyX: never merged.
    const kofiId = randomUUID(); created.push(kofiId);
    const kofiEmail = `kofi-${randomUUID()}@example.com`;
    await pool.query("INSERT INTO users(id,email,password_hash,role,status) VALUES($1,$2,'fixture','user','active')", [kofiId, kofiEmail]);
    const kofi = { sub: `os_${randomUUID().slice(0, 12)}`, email: kofiEmail, email_verified: false, name: 'Kofi' };
    os.entitlements.set(kofi.sub, grantOf(kofi.sub, 'agency'));
    result = await signIn(kofi);
    assert.match(result.location, /dakyx=link_required/, 'an unverified matching email asks them to sign in and link');
    assert.equal((await pool.query("SELECT 1 FROM social_login_identities WHERE provider='dakyx' AND user_id=$1", [kofiId])).rows.length, 0, 'and links nothing');
    assert.equal((await getEffectivePlan(kofiId)).source, 'local', 'and grants nothing');

    // …which they then do, signed in with their own token.
    const kofiToken = signToken(kofiId, kofiEmail, 1);
    result = await signIn(kofi, { bearer: kofiToken });
    assert.equal(userIdOf(tokenFrom(result.location)), kofiId, 'linking from a signed-in session joins the two');
    assert.equal((await getEffectivePlan(kofiId)).tier, 'agency');

    // A second DakyX account cannot be attached to an already-linked user.
    const other = { sub: `os_${randomUUID().slice(0, 12)}`, email: `x-${randomUUID()}@example.com`, email_verified: true, name: 'X' };
    os.entitlements.set(other.sub, grantOf(other.sub, 'growth'));
    assert.match((await signIn(other, { bearer: kofiToken })).location, /auth_error=/);

    // A verified matching email links, like the existing social login does.
    const esiId = randomUUID(); created.push(esiId);
    const esiEmail = `esi-${randomUUID()}@example.com`;
    await pool.query("INSERT INTO users(id,email,password_hash,role,status) VALUES($1,$2,'fixture','user','active')", [esiId, esiEmail]);
    const esi = { sub: `os_${randomUUID().slice(0, 12)}`, email: esiEmail, email_verified: true, name: 'Esi' };
    os.entitlements.set(esi.sub, grantOf(esi.sub, null));
    result = await signIn(esi);
    assert.equal(userIdOf(tokenFrom(result.location)), esiId, 'a verified address joins the account that has it');
    assert.equal((await getEffectivePlan(esiId)).source, 'local', 'with no DakyX grant, the local plan stands');

    // A local plan higher than the grant wins.
    const planId = randomUUID();
    await pool.query("INSERT INTO pricing_plans(id,name,description,price) VALUES($1,'Agency','fixture',99)", [planId]);
    await pool.query("INSERT INTO subscriptions(id,user_id,plan_id,status) VALUES($1,$2,$3,'active') ON CONFLICT (user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id, status='active'", [randomUUID(), amaId, planId]);
    assert.deepEqual([(await getEffectivePlan(amaId)).tier, (await getEffectivePlan(amaId)).source], ['agency', 'local'], 'a higher plan bought here wins');
    await pool.query('DELETE FROM subscriptions WHERE user_id=$1', [amaId]);
    await pool.query('DELETE FROM pricing_plans WHERE id=$1', [planId]);

    // ── events ────────────────────────────────────────────────────────────────
    const send = (body: object, key = 'partner-key', ts = String(Date.now())) => {
      const raw = JSON.stringify(body);
      return request(app).post('/api/internal/dakyx/events').set('Content-Type', 'application/json')
        .set('x-dakyworld-timestamp', ts).set('x-dakyworld-signature', createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex')).send(raw);
    };
    os.entitlements.set(ama.sub, grantOf(ama.sub, null));
    assert.equal((await send({ id: randomUUID(), event: 'entitlements.changed', data: { sub: ama.sub } }, 'wrong')).status, 401, 'a forged event is refused');
    assert.equal((await getEffectivePlan(amaId)).source, 'dakyx', 'and changed nothing');
    const versionBefore = (await pool.query('SELECT token_version FROM users WHERE id=$1', [amaId])).rows[0].token_version;
    const eventId = randomUUID();
    assert.equal((await send({ id: eventId, event: 'entitlements.changed', data: { sub: ama.sub } })).status, 200);
    assert.equal((await getEffectivePlan(amaId)).source, 'local', 'a churned retainer takes the plan away');
    assert.equal((await pool.query('SELECT token_version FROM users WHERE id=$1', [amaId])).rows[0].token_version, versionBefore + 1, 'and signs them out, having no plan of their own');
    assert.equal((await send({ id: eventId, event: 'entitlements.changed', data: { sub: ama.sub } })).body.duplicate, true, 'a repeated delivery is recognised');
    assert.equal((await send({ id: randomUUID(), event: 'entitlements.changed', data: { sub: 'never-signed-in' } })).body.linked, false, 'somebody never seen here is a no-op');

    // ── reconcile ─────────────────────────────────────────────────────────────
    os.entitlements.set(ama.sub, grantOf(ama.sub, 'growth'));
    await dakyx.reconcileDakyxGrants(deps as any);
    assert.equal((await getEffectivePlan(amaId)).tier, 'growth', 'the hourly reconcile picks up what an event missed');
    os.down = true;
    const outcome = await dakyx.reconcileDakyxGrants(deps as any);
    assert.ok(outcome.failed >= 1);
    assert.equal((await getEffectivePlan(amaId)).tier, 'growth', 'DakyX being down does not take a plan away');
    await pool.query("UPDATE plan_grants SET synced_at = NOW() - INTERVAL '4 days' WHERE user_id=$1", [amaId]);
    assert.equal((await getEffectivePlan(amaId)).source, 'local', 'but a grant not confirmed for three days lapses');

    // An older answer never overwrites a newer one.
    const later = Date.now() + 60_000;
    await dakyx.storeDakyxGrant(dbQuery as any, amaId, grantOf(ama.sub, 'agency', later));
    await dakyx.storeDakyxGrant(dbQuery as any, amaId, grantOf(ama.sub, 'starter', later - 1));
    assert.equal((await pool.query("SELECT tier FROM plan_grants WHERE user_id=$1", [amaId])).rows[0].tier, 'agency');
  } finally {
    osServer.close();
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [created]);
    await pool.end();
  }
});
