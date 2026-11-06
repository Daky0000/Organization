import express from 'express';
import type { Router, Response } from 'express';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';
import { isPlanTierKey } from '../middleware/planQuotaMiddleware.ts';

/**
 * DakyX accounts in the Marketing SaaS.
 *
 * DakyXTech OS (os.dakyx.com / app.dakyx.com, repository Daky0000/dakyworld)
 * is the record of who has paid DakyX for what: a client on a retainer gets
 * every DakyX product, this one included. This module is the SaaS's half:
 *
 *   GET  /api/auth/dakyx/config     is "Continue with DakyX" switched on
 *   GET  /api/auth/dakyx/start      browser → the OS's authorize step (state + PKCE)
 *   POST /api/auth/dakyx/link-start a signed-in SaaS user connecting their DakyX account
 *   GET  /api/auth/dakyx/callback   code → identity + grants → the normal SaaS JWT
 *   POST /api/internal/dakyx/events "this person's DakyX access changed" (signed)
 *   reconcileDakyxGrants()          hourly re-fetch of every linked person
 *
 * What it never does: share a database or cookie with the OS, take a plan name
 * from a browser, or merge two accounts because an unverified email matches.
 * The OS's design note is docs/cross-product-access.md in that repository.
 */

export const DAKYX_PROVIDER = 'dakyx';
const STATE_TTL_MINUTES = 10;
const EVENT_SKEW_MS = 5 * 60_000;

export type DakyxConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  partnerKey: string;
  issuer: string;
};

export function dakyxConfig(env: NodeJS.ProcessEnv = process.env, appUrl = ''): DakyxConfig | null {
  const baseUrl = env.DAKYX_BASE_URL?.trim().replace(/\/$/, '');
  const clientSecret = env.DAKYX_CLIENT_SECRET?.trim();
  const partnerKey = env.DAKYX_PARTNER_KEY?.trim();
  if (!baseUrl || !clientSecret || !partnerKey) return null;
  return {
    baseUrl,
    clientId: env.DAKYX_CLIENT_ID?.trim() || 'marketing',
    clientSecret,
    redirectUri: env.DAKYX_REDIRECT_URI?.trim() || `${appUrl.replace(/\/$/, '')}/api/auth/dakyx/callback`,
    partnerKey,
    issuer: (env.DAKYX_ISSUER?.trim() || 'https://os.dakyx.com').replace(/\/$/, ''),
  };
}

export type DakyxGrant = { product: string; tier: string; source: string; validUntil: string | null };
export type DakyxEntitlements = { subject: string; version: number; active: boolean; grants: DakyxGrant[] };

/** The one grant this app cares about, if its tier is one this app has. */
export function marketingGrant(entitlements: DakyxEntitlements | null | undefined): DakyxGrant | null {
  if (!entitlements?.active) return null;
  const grant = entitlements.grants?.find((g) => g.product === 'marketing-suite');
  return grant && isPlanTierKey(grant.tier) ? grant : null;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/** Same scheme as the OS's own webhooks: HMAC-SHA256 over `${timestamp}.${body}`. */
export function verifyDakyxSignature(secret: string, headers: Record<string, unknown>, rawBody: string, now = Date.now()): boolean {
  const signature = String(headers['x-dakyworld-signature'] ?? '');
  const timestamp = String(headers['x-dakyworld-timestamp'] ?? '');
  const sentAt = Number(timestamp);
  if (!signature || !Number.isFinite(sentAt) || Math.abs(now - sentAt) > EVENT_SKEW_MS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return safeEqual(signature, expected);
}

type Db = { query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }> };

export type DakyxDeps = {
  pool: Pool | null;
  dbQuery: Db['query'];
  hasDatabase: () => boolean;
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  getUserById: (id: string) => Promise<any>;
  signToken: (userId: string, email: string, tokenVersion?: number) => string;
  appUrl: string;
  /** For checks: replaces global fetch for calls to the OS. */
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

/** Writes (or clears) what DakyX grants a person. Older answers never overwrite newer ones. */
export async function storeDakyxGrant(db: Db['query'], userId: string, entitlements: DakyxEntitlements): Promise<void> {
  const grant = marketingGrant(entitlements);
  if (!grant) {
    await db(`DELETE FROM plan_grants WHERE user_id=$1 AND source='dakyx' AND version <= $2`, [userId, entitlements.version]);
    return;
  }
  await db(
    `INSERT INTO plan_grants(user_id, source, tier, reason, valid_until, version, synced_at)
     VALUES($1,'dakyx',$2,$3,$4,$5,NOW())
     ON CONFLICT (user_id, source) DO UPDATE SET tier=EXCLUDED.tier, reason=EXCLUDED.reason, valid_until=EXCLUDED.valid_until,
       version=EXCLUDED.version, synced_at=NOW()
     WHERE plan_grants.version <= EXCLUDED.version`,
    [userId, grant.tier, grant.source, grant.validUntil, entitlements.version]
  );
}

export function registerDakyxRoutes(deps: DakyxDeps): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const config = () => dakyxConfig(env, deps.appUrl);
  const fetcher = deps.fetchImpl ?? fetch;
  const loginUrl = (params: Record<string, string>) => `${deps.appUrl.replace(/\/$/, '')}/login?${new URLSearchParams(params)}`;

  async function fetchEntitlements(cfg: DakyxConfig, subject: string): Promise<DakyxEntitlements> {
    const response = await fetcher(`${cfg.baseUrl}/api/partner/v1/entitlements/${encodeURIComponent(subject)}`, {
      headers: { Authorization: `Bearer ${cfg.partnerKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`DakyX answered ${response.status}`);
    return await response.json() as DakyxEntitlements;
  }

  async function startUrl(cfg: DakyxConfig, linkUserId: string | null): Promise<string> {
    const state = randomBytes(24).toString('base64url');
    const { verifier, challenge } = pkcePair();
    await deps.dbQuery(
      `INSERT INTO dakyx_sso_states(state, code_verifier, link_user_id, expires_at) VALUES($1,$2,$3,NOW() + ($4 || ' minutes')::interval)`,
      [state, verifier, linkUserId, String(STATE_TTL_MINUTES)]
    );
    const url = new URL(`${cfg.baseUrl}/api/auth/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state,
      code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  router.get('/api/auth/dakyx/config', (_req, res) => {
    res.json({ success: true, enabled: Boolean(config() && deps.hasDatabase()) });
  });

  router.get('/api/auth/dakyx/start', async (_req: Request, res: Response) => {
    const cfg = config();
    if (!cfg || !deps.hasDatabase()) return res.redirect(loginUrl({ auth_error: 'DakyX sign-in is not available' }));
    try {
      return res.redirect(await startUrl(cfg, null));
    } catch (error) {
      logger.error({ error }, 'dakyx_start_failed');
      return res.redirect(loginUrl({ auth_error: 'DakyX sign-in failed' }));
    }
  });

  // A signed-in user connecting the DakyX account they also have. The SPA holds
  // its token in localStorage, so a browser navigation cannot prove who it is:
  // the SPA asks for the URL with its bearer token, and the state remembers.
  router.post('/api/auth/dakyx/link-start', async (req: Request, res: Response) => {
    const auth = deps.requireAuth(req, res);
    if (!auth) return;
    const cfg = config();
    if (!cfg || !deps.hasDatabase()) return res.status(503).json({ success: false, error: 'DakyX sign-in is not available' });
    try {
      return res.json({ success: true, url: await startUrl(cfg, auth.userId) });
    } catch (error) {
      logger.error({ error }, 'dakyx_link_start_failed');
      return res.status(500).json({ success: false, error: 'Could not start linking' });
    }
  });

  router.get('/api/auth/dakyx/callback', async (req: Request, res: Response) => {
    const cfg = config();
    if (!cfg || !deps.hasDatabase() || !deps.pool) return res.redirect(loginUrl({ auth_error: 'DakyX sign-in is not available' }));
    const { code, state, error, iss } = req.query as Record<string, string | undefined>;
    try {
      // Spent whether or not what follows succeeds: a state works once.
      const consumed = await deps.dbQuery<{ code_verifier: string; link_user_id: string | null }>(
        'DELETE FROM dakyx_sso_states WHERE state=$1 AND expires_at > NOW() RETURNING code_verifier, link_user_id',
        [String(state ?? '')]
      );
      const saved = consumed.rows[0];
      if (!saved) return res.redirect(loginUrl({ auth_error: 'That sign-in link expired. Try again.' }));
      if (error) return res.redirect(loginUrl({ auth_error: error === 'access_denied' ? 'Your DakyX account cannot sign in here.' : 'DakyX sign-in failed' }));
      if (iss && iss.replace(/\/$/, '') !== cfg.issuer) return res.redirect(loginUrl({ auth_error: 'DakyX sign-in failed' }));
      if (!code) return res.redirect(loginUrl({ auth_error: 'DakyX sign-in failed' }));

      const tokenResponse = await fetcher(`${cfg.baseUrl}/api/auth/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: saved.code_verifier }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResponse.ok) return res.redirect(loginUrl({ auth_error: 'DakyX sign-in failed' }));
      const identity = await tokenResponse.json() as {
        iss: string; aud: string; sub: string; email: string; email_verified: boolean; name: string; entitlements: DakyxEntitlements;
      };
      if (identity.iss?.replace(/\/$/, '') !== cfg.issuer || identity.aud !== cfg.clientId || !identity.sub || identity.entitlements?.subject !== identity.sub) {
        return res.redirect(loginUrl({ auth_error: 'DakyX sign-in failed' }));
      }

      const result = await resolveAccount(deps.pool, identity, saved.link_user_id);
      if ('error' in result) return res.redirect(loginUrl(result.error === 'link_required'
        ? { dakyx: 'link_required', email: identity.email }
        : { auth_error: result.error }));

      await storeDakyxGrant(deps.dbQuery, result.userId, identity.entitlements);
      const user = await deps.getUserById(result.userId);
      if (!user || user.status !== 'active') return res.redirect(loginUrl({ auth_error: 'Account is disabled' }));
      const token = deps.signToken(user.id, user.email, user.token_version);
      logger.info({ userId: user.id, linked: result.linked, created: result.created }, 'dakyx_sign_in');
      return res.redirect(`${deps.appUrl.replace(/\/$/, '')}/login#auth_token=${encodeURIComponent(token)}&auth_provider=dakyx`);
    } catch (err) {
      logger.error({ error: err }, 'dakyx_callback_failed');
      return res.redirect(loginUrl({ auth_error: 'DakyX sign-in failed' }));
    }
  });

  router.post('/api/internal/dakyx/events', async (req: Request, res: Response) => {
    const cfg = config();
    if (!cfg || !deps.hasDatabase()) return res.status(503).json({ success: false });
    const raw = (req as any).rawBody ? Buffer.from((req as any).rawBody).toString('utf8') : JSON.stringify(req.body ?? {});
    if (!verifyDakyxSignature(cfg.partnerKey, req.headers as Record<string, unknown>, raw)) return res.status(401).json({ success: false });
    const body = req.body as { id?: string; event?: string; data?: { sub?: string } };
    if (body.event !== 'entitlements.changed' || typeof body.id !== 'string' || typeof body.data?.sub !== 'string') {
      return res.status(400).json({ success: false });
    }
    try {
      const fresh = await deps.dbQuery('INSERT INTO dakyx_event_deliveries(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [body.id]);
      if (!fresh.rows.length) return res.json({ success: true, duplicate: true });
      const linked = await deps.dbQuery<{ user_id: string }>('SELECT user_id FROM social_login_identities WHERE provider=$1 AND subject=$2', [DAKYX_PROVIDER, body.data.sub]);
      // Somebody DakyX knows and this app does not: nothing to do until they sign in.
      if (!linked.rows[0]) return res.json({ success: true, linked: false });
      // The event says *that* something changed, never *what*. The answer comes
      // from the authenticated API, so a forged event grants nothing.
      const entitlements = await fetchEntitlements(cfg, body.data.sub);
      await applyEntitlements(deps, linked.rows[0].user_id, entitlements);
      return res.json({ success: true });
    } catch (error) {
      logger.error({ error }, 'dakyx_event_failed');
      // Let the OS retry: forget the delivery so the retry is not a "duplicate".
      await deps.dbQuery('DELETE FROM dakyx_event_deliveries WHERE id=$1', [body.id]).catch(() => undefined);
      return res.status(502).json({ success: false });
    }
  });

  return router;
}

/**
 * Stores the grant and, when somebody has lost their DakyX plan and has no plan
 * of their own here, signs them out everywhere so the loss takes effect now
 * rather than when a seven-day token runs out.
 */
export async function applyEntitlements(deps: Pick<DakyxDeps, 'dbQuery'>, userId: string, entitlements: DakyxEntitlements): Promise<void> {
  const before = await deps.dbQuery<{ tier: string }>(`SELECT tier FROM plan_grants WHERE user_id=$1 AND source='dakyx'`, [userId]);
  await storeDakyxGrant(deps.dbQuery, userId, entitlements);
  const after = marketingGrant(entitlements);
  if (before.rows[0] && !after) {
    const paying = await deps.dbQuery(
      `SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end > NOW())`,
      [userId]
    );
    if (!paying.rows.length) await deps.dbQuery('UPDATE users SET token_version = token_version + 1 WHERE id=$1', [userId]);
  }
}

type ResolveResult = { userId: string; linked: boolean; created: boolean } | { error: string };

/**
 * Which account a DakyX identity signs in to. In order: the account already
 * linked to it; the signed-in account that asked to link; an account with the
 * same address, only when DakyX says the address is verified (the rule this
 * app's social login already uses); otherwise a new account. An unverified
 * match is never merged — the person signs in with their password and links.
 */
export async function resolveAccount(
  pool: Pool,
  identity: { sub: string; email: string; email_verified: boolean; name: string },
  linkUserId: string | null
): Promise<ResolveResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const known = await client.query<{ user_id: string }>('SELECT user_id FROM social_login_identities WHERE provider=$1 AND subject=$2', [DAKYX_PROVIDER, identity.sub]);
    let userId: string;
    let linked = false;
    let created = false;
    if (known.rows[0]) {
      userId = known.rows[0].user_id;
      if (linkUserId && linkUserId !== userId) { await client.query('ROLLBACK'); return { error: 'That DakyX account is already connected to a different account here.' }; }
    } else if (linkUserId) {
      const other = await client.query('SELECT 1 FROM social_login_identities WHERE provider=$1 AND user_id=$2', [DAKYX_PROVIDER, linkUserId]);
      if (other.rows.length) { await client.query('ROLLBACK'); return { error: 'This account is already connected to a different DakyX account.' }; }
      userId = linkUserId;
      linked = true;
    } else {
      const email = String(identity.email ?? '').trim().toLowerCase();
      if (!email.includes('@')) { await client.query('ROLLBACK'); return { error: 'Your DakyX account has no email address.' }; }
      const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
      if (existing.rows[0]) {
        if (!identity.email_verified) { await client.query('ROLLBACK'); return { error: 'link_required' }; }
        const other = await client.query('SELECT 1 FROM social_login_identities WHERE provider=$1 AND user_id=$2', [DAKYX_PROVIDER, existing.rows[0].id]);
        if (other.rows.length) { await client.query('ROLLBACK'); return { error: 'This email is already connected to a different DakyX account.' }; }
        userId = existing.rows[0].id;
        linked = true;
      } else {
        userId = randomUUID();
        // An unusable password: this account signs in through DakyX until its
        // owner sets one with "forgot password".
        await client.query(
          `INSERT INTO users(id, full_name, username, email, password_hash, role, status, email_verified)
           VALUES($1,$2,$3,$4,$5,'user','active',$6)`,
          [userId, identity.name || email.split('@')[0], `dakyx_${userId.slice(0, 8)}`, email, await bcrypt.hash(randomBytes(32).toString('hex'), 12), Boolean(identity.email_verified)]
        );
        created = true;
      }
    }
    const status = await client.query<{ status: string }>('SELECT status FROM users WHERE id=$1', [userId]);
    if (status.rows[0]?.status !== 'active') { await client.query('ROLLBACK'); return { error: 'Account is disabled' }; }
    await client.query('INSERT INTO social_login_identities(provider, subject, user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [DAKYX_PROVIDER, identity.sub, userId]);
    await client.query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [userId]);
    await client.query('COMMIT');
    return { userId, linked, created };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Re-fetches every linked person's grants, which covers an event the OS never
 * managed to deliver. When DakyX cannot be reached, the stored grant stands
 * until `synced_at` is DAKYX_GRANT_STALE_HOURS old (see getEffectivePlan):
 * a retainer client should not lose their plan because the OS redeployed.
 */
export async function reconcileDakyxGrants(deps: Pick<DakyxDeps, 'dbQuery' | 'appUrl' | 'fetchImpl' | 'env'>): Promise<{ checked: number; failed: number }> {
  const cfg = dakyxConfig(deps.env ?? process.env, deps.appUrl);
  if (!cfg) return { checked: 0, failed: 0 };
  const fetcher = deps.fetchImpl ?? fetch;
  const linked = await deps.dbQuery<{ subject: string; user_id: string }>('SELECT subject, user_id FROM social_login_identities WHERE provider=$1', [DAKYX_PROVIDER]);
  let failed = 0;
  for (const row of linked.rows) {
    try {
      const response = await fetcher(`${cfg.baseUrl}/api/partner/v1/entitlements/${encodeURIComponent(row.subject)}`, {
        headers: { Authorization: `Bearer ${cfg.partnerKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`DakyX answered ${response.status}`);
      await applyEntitlements(deps, row.user_id, await response.json() as DakyxEntitlements);
    } catch (error) {
      failed++;
      logger.warn({ error: (error as Error).message, userId: row.user_id }, 'dakyx_reconcile_failed');
    }
  }
  await deps.dbQuery(`DELETE FROM dakyx_sso_states WHERE expires_at < NOW()`).catch(() => undefined);
  await deps.dbQuery(`DELETE FROM dakyx_event_deliveries WHERE received_at < NOW() - INTERVAL '7 days'`).catch(() => undefined);
  return { checked: linked.rows.length, failed };
}

export async function runDakyxMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dakyx_sso_states (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_grants (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      tier TEXT NOT NULL,
      reason TEXT NOT NULL,
      valid_until TIMESTAMPTZ,
      version BIGINT NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, source)
    );
    CREATE TABLE IF NOT EXISTS dakyx_event_deliveries (
      id TEXT PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS social_login_identities_dakyx_user ON social_login_identities(user_id) WHERE provider = 'dakyx';
  `);
}
