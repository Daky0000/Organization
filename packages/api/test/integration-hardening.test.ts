import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';

// Locks the integration audit fixes: credentials stay out of token_data and
// API responses, provider compliance callbacks act only on signed requests,
// OAuth state is single-use, admin secrets are masked, and the token
// lifecycle policy matches each platform's real token lifetimes.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

const tokenData = await import('../src/token-data.ts');
const compliance = await import('../src/oauth-compliance.ts');
const policy = await import('../src/social-token-policy.ts');
const helpers = await import('../src/integration-helpers.ts');
const platformHelpers = await import('../src/platform-helpers.ts');
const providerChecks = await import('../src/oauth-provider-checks.ts');
const { META_OAUTH_DIALOG_URL } = await import('../src/meta-graph.ts');
const { fetchMediaBytes } = await import('../src/ssrf-guard.ts');
const { fetchLinkMetadata } = await import('../src/link-metadata.ts');
const { resolveLinkedInDestinationUrn } = await import('../backend/platforms/linkedin.ts');
const { registerComplianceRoutes } = await import('../src/server/complianceRoutes.ts');
const { registerSocialConnectRoutes, sanitizeOAuthReturnTo } = await import('../src/server/socialConnectRoutes.ts');
const { registerPlatformConfigRoutes } = await import('../src/server/platformConfigRoutes.ts');

const reverse = (value: string) => value.split('').reverse().join('');
const base64Url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const signMeta = (payload: Record<string, unknown>, secret: string) => {
  const encodedPayload = base64Url(Buffer.from(JSON.stringify(payload)));
  return `${base64Url(createHmac('sha256', secret).update(encodedPayload).digest())}.${encodedPayload}`;
};
const nowSeconds = () => Math.floor(Date.now() / 1000);

// ── token_data ────────────────────────────────────────────────────────────────

test('token data: secrets are stripped at every depth, metadata is kept', () => {
  const cleaned = tokenData.sanitizeTokenData({
    access_token: 'at', refresh_token: 'rt', pageAccessToken: 'pat', short_lived_access_token: 'sl',
    name: 'Acme', username: 'acme', scope: 'tweet.write', pageId: '42',
    authed_user: { id: 'U1', access_token: 'xoxp' },
    incoming_webhook: { channel: '#general', url: 'https://hooks.slack.com/services/secret' },
  });
  assert.deepEqual(cleaned, {
    name: 'Acme', username: 'acme', scope: 'tweet.write', pageId: '42',
    authed_user: { id: 'U1' },
    incoming_webhook: { channel: '#general' },
  });
});

test('token data: the Meta user token is kept only as ciphertext', () => {
  const cleaned = tokenData.sanitizeTokenData({ user_access_token: 'EAAuser', login_method: 'facebook' }, reverse);
  assert.equal(cleaned.user_access_token, undefined);
  assert.equal(cleaned[tokenData.USER_ACCESS_TOKEN_ENC_KEY], 'resuAAE');
  assert.equal(tokenData.readUserAccessToken(cleaned, reverse), 'EAAuser');
  // Rows written before the change still work through the plaintext key.
  assert.equal(tokenData.readUserAccessToken({ user_access_token: 'legacy' }, reverse), 'legacy');
  // An undecryptable copy falls back instead of throwing.
  assert.equal(tokenData.readUserAccessToken({ user_access_token_enc: 'x' }, () => { throw new Error('bad key'); }), '');
});

test('token data: the public connection summary never carries credentials', () => {
  const summary = tokenData.toPublicConnectionSummary('twitter', { access_token: 'at', refresh_token: 'rt', user_id: '7', name: 'A', username: 'a', avatar_url: 'https://x/a.png' });
  assert.deepEqual(summary, { platform: 'twitter', accountId: '7', accountName: 'A', username: 'a', avatarUrl: 'https://x/a.png' });
  assert.ok(!JSON.stringify(summary).includes('rt'));
});

test('token data: legacy rows are rewritten without secrets; a failed re-encryption leaves the row alone', async () => {
  const updates: Array<{ id: string; data: any }> = [];
  const query = async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT')) {
      return { rows: [
        { id: 'a', token_data: { access_token: 'at', name: 'A' } },
        { id: 'b', token_data: { user_access_token: 'EAA', pageId: '1' } },
      ] };
    }
    updates.push({ id: String(params?.[0]), data: JSON.parse(String(params?.[1])) });
    return { rows: [] };
  };
  assert.equal(await tokenData.migrateLegacyTokenData(query, reverse), 2);
  assert.deepEqual(updates, [
    { id: 'a', data: { name: 'A' } },
    { id: 'b', data: { pageId: '1', user_access_token_enc: 'AAE' } },
  ]);

  updates.length = 0;
  const migrated = await tokenData.migrateLegacyTokenData(query, () => { throw new Error('no key'); });
  assert.equal(migrated, 1);
  assert.deepEqual(updates.map((u) => u.id), ['a']);
});

// ── Provider signatures ───────────────────────────────────────────────────────

test('compliance: Meta signed_request verifies against any configured app secret', () => {
  const signed = signMeta({ algorithm: 'HMAC-SHA256', user_id: '1001' }, 'ig-secret');
  assert.deepEqual(compliance.parseMetaSignedRequest(signed, ['fb-secret', 'ig-secret'])?.user_id, '1001');
  assert.equal(compliance.parseMetaSignedRequest(signed, ['fb-secret']), null);
  assert.equal(compliance.parseMetaSignedRequest(signMeta({ algorithm: 'HMAC-SHA1', user_id: '1' }, 's'), ['s']), null);
  assert.equal(compliance.parseMetaSignedRequest('garbage', ['s']), null);
});

test('compliance: Slack, Zoom and TikTok signatures reject tampering and stale timestamps', () => {
  const body = JSON.stringify({ event: 'x' });
  const ts = String(nowSeconds());
  const v0 = (secret: string, timestamp: string) => `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;

  assert.ok(compliance.verifySlackSignature({ 'x-slack-request-timestamp': ts, 'x-slack-signature': v0('slk', ts) }, body, 'slk'));
  assert.ok(!compliance.verifySlackSignature({ 'x-slack-request-timestamp': ts, 'x-slack-signature': v0('other', ts) }, body, 'slk'));
  const stale = String(nowSeconds() - 3600);
  assert.ok(!compliance.verifySlackSignature({ 'x-slack-request-timestamp': stale, 'x-slack-signature': v0('slk', stale) }, body, 'slk'));
  assert.ok(!compliance.verifySlackSignature({ 'x-slack-request-timestamp': ts, 'x-slack-signature': v0('slk', ts) }, `${body} `, 'slk'));

  assert.ok(compliance.verifyZoomSignature({ 'x-zm-request-timestamp': ts, 'x-zm-signature': v0('zm', ts) }, body, 'zm'));
  assert.ok(!compliance.verifyZoomSignature({ 'x-zm-request-timestamp': ts, 'x-zm-signature': v0('zm', ts) }, body, ''));
  assert.deepEqual(compliance.zoomUrlValidationResponse('plain', 'zm'), {
    plainToken: 'plain',
    encryptedToken: createHmac('sha256', 'zm').update('plain').digest('hex'),
  });

  const tiktokSig = createHmac('sha256', 'tt').update(`${ts}.${body}`).digest('hex');
  assert.ok(compliance.verifyTikTokSignature({ 'tiktok-signature': `t=${ts},s=${tiktokSig}` }, body, 'tt'));
  assert.ok(!compliance.verifyTikTokSignature({ 'tiktok-signature': `t=${ts},s=${tiktokSig}` }, body, 'other'));
});

test('compliance: only events that revoke our grant yield account ids', () => {
  assert.deepEqual(compliance.extractRevokedAccountIds('slack', { team_id: 'T1', event: { type: 'app_uninstalled' } }), ['T1']);
  assert.deepEqual(compliance.extractRevokedAccountIds('slack', { team_id: 'T1', event: { type: 'tokens_revoked', tokens: { bot: ['B1'] } } }), ['T1']);
  // A revoked user token leaves the workspace bot token working.
  assert.deepEqual(compliance.extractRevokedAccountIds('slack', { team_id: 'T1', event: { type: 'tokens_revoked', tokens: { oauth: ['U1'] } } }), []);
  assert.deepEqual(compliance.extractRevokedAccountIds('zoom', { event: 'app_deauthorized', payload: { user_id: 'Z1' } }), ['Z1']);
  assert.deepEqual(compliance.extractRevokedAccountIds('tiktok', { event: 'authorization.removed', user_openid: 'open-1' }), ['open-1']);
  assert.deepEqual(compliance.extractRevokedAccountIds('facebook', null, { user_id: '99' }), ['99']);
});

// ── Token lifecycle policy ────────────────────────────────────────────────────

test('token policy: refresh mode and margin follow each platform', () => {
  assert.equal(policy.getRefreshMode('twitter', { hasRefreshToken: false, isInstagramDirect: false }), 'refresh_token');
  assert.equal(policy.getRefreshMode('pinterest', { hasRefreshToken: true, isInstagramDirect: false }), 'refresh_token');
  assert.equal(policy.getRefreshMode('linkedin', { hasRefreshToken: false, isInstagramDirect: false }), 'none');
  assert.equal(policy.getRefreshMode('instagram', { hasRefreshToken: false, isInstagramDirect: true }), 'instagram_access_token');
  assert.equal(policy.getRefreshMode('instagram', { hasRefreshToken: false, isInstagramDirect: false }), 'none');
  assert.equal(policy.getRefreshMode('threads', { hasRefreshToken: false, isInstagramDirect: false }), 'threads_access_token');
  // Short-lived tokens get short margins, or every use would refresh them.
  assert.equal(policy.getRefreshMarginMs('twitter', 10), 10 * 60_000);
  assert.equal(policy.getRefreshMarginMs('tiktok', 10), 2 * 3_600_000);
  assert.equal(policy.getRefreshMarginMs('linkedin', 10), 10 * 86_400_000);
  assert.ok(policy.isSoftReapprovalReason('token_refresh_failed'));
  assert.ok(!policy.isSoftReapprovalReason('deauthorized'));
});

test('token policy: health tells expiring, expired and revoked apart', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const day = 86_400_000;
  const at = (offset: number) => new Date(now + offset).toISOString();
  assert.equal(policy.computeConnectionHealth({ needsReapproval: false, expiresAt: at(30 * day), refreshable: false, now }).status, 'healthy');
  assert.equal(policy.computeConnectionHealth({ needsReapproval: false, expiresAt: at(3 * day), refreshable: false, now }).status, 'expiring');
  assert.equal(policy.computeConnectionHealth({ needsReapproval: false, expiresAt: at(-day), refreshable: false, now }).status, 'reconnect_required');
  // The server renews these itself, so an expiry is not the user's problem.
  assert.equal(policy.computeConnectionHealth({ needsReapproval: false, expiresAt: at(-day), refreshable: true, now }).status, 'healthy');
  const revoked = policy.computeConnectionHealth({ needsReapproval: true, reason: 'deauthorized', expiresAt: null, refreshable: true, now });
  assert.equal(revoked.status, 'reconnect_required');
  assert.match(String(revoked.message), /removed/);
});

// ── OAuth authorize URL ───────────────────────────────────────────────────────

test('authorize url: X requires PKCE and always asks for media.write and offline.access', () => {
  const missing = platformHelpers.buildOAuthAuthorizeUrl({ platform: 'twitter', cfg: { clientId: 'cid' }, redirectUri: 'https://api.test/auth/twitter/callback', state: 's'.repeat(32) });
  assert.equal(missing.ok, false);
  const built = platformHelpers.buildOAuthAuthorizeUrl({
    platform: 'twitter', cfg: { clientId: 'cid', scopes: 'tweet.read tweet.write users.read' },
    redirectUri: 'https://api.test/auth/twitter/callback', state: 's'.repeat(32), codeChallenge: 'challenge',
  });
  assert.ok(built.ok);
  const url = new URL(built.url);
  assert.deepEqual(url.searchParams.get('scope')?.split(' ').sort(), ['media.write', 'offline.access', 'tweet.read', 'tweet.write', 'users.read']);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('authorize url: provider-specific parameters', () => {
  const tiktok = platformHelpers.buildOAuthAuthorizeUrl({ platform: 'tiktok', cfg: { clientKey: 'ck' }, redirectUri: 'https://api.test/cb', state: 'state-value-123456' });
  assert.ok(tiktok.ok && new URL(tiktok.url).searchParams.get('client_key') === 'ck');

  const gmail = platformHelpers.buildOAuthAuthorizeUrl({ platform: 'gmail', cfg: { clientId: 'g' }, redirectUri: 'https://api.test/cb', state: 'state-value-123456' });
  assert.ok(gmail.ok);
  assert.equal(new URL(gmail.url).searchParams.get('access_type'), 'offline');

  const instagramViaFacebook = platformHelpers.buildOAuthAuthorizeUrl({
    platform: 'instagram', cfg: { appId: 'fb-app', appSecret: 's', configId: 'cfg-1' }, redirectUri: 'https://api.test/cb', state: 'state-value-123456',
  });
  assert.ok(instagramViaFacebook.ok && instagramViaFacebook.url.startsWith(`${META_OAUTH_DIALOG_URL}?`));
  assert.equal(new URL(instagramViaFacebook.url).searchParams.get('config_id'), 'cfg-1');

  const unconfigured = platformHelpers.buildOAuthAuthorizeUrl({ platform: 'linkedin', cfg: {}, redirectUri: 'https://api.test/cb', state: 'state-value-123456' });
  assert.equal(unconfigured.ok, false);

  const pkce = platformHelpers.generatePkcePair();
  assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(pkce.codeChallenge, pkce.codeVerifier);
});

// ── Admin config secrets ──────────────────────────────────────────────────────

test('admin secrets: masked on the way out, restored when the mask comes back', () => {
  const stored = { clientId: 'cid', clientSecret: 'super-secret-value', signingSecret: 'abc', redirectUri: 'https://x/cb' };
  const masked = helpers.maskPlatformConfigSecrets(stored);
  assert.equal(masked.clientId, 'cid');
  assert.equal(masked.redirectUri, 'https://x/cb');
  assert.ok(helpers.isMaskedSecretValue(masked.clientSecret));
  assert.ok(!String(masked.clientSecret).includes('super'));
  assert.ok(String(masked.clientSecret).endsWith('alue'));

  const merged = helpers.mergeMaskedSecrets(stored, { ...masked, clientId: 'cid-2', signingSecret: 'rotated' });
  assert.deepEqual(merged, { clientId: 'cid-2', clientSecret: 'super-secret-value', signingSecret: 'rotated', redirectUri: 'https://x/cb' });
  // A mask with nothing stored behind it is dropped, never saved.
  assert.deepEqual(helpers.mergeMaskedSecrets({}, { apiKey: '••••' }), {});
});

test('mailchimp: the datacenter must look like one, since it becomes a hostname', () => {
  assert.equal(helpers.resolveMailchimpServerPrefix('abc123-us6'), 'us6');
  assert.equal(helpers.resolveMailchimpServerPrefix('abc123-us6', 'US19'), 'us19');
  assert.equal(helpers.resolveMailchimpServerPrefix('abc123-us6', 'evil.com/'), null);
  assert.equal(helpers.resolveMailchimpServerPrefix('abc123', ''), null);
});

test('credential probe: provider answers are classified honestly', () => {
  assert.equal(providerChecks.classifyOAuthProbe({ status: 200, data: { access_token: 'x' } }).status, 'valid');
  assert.equal(providerChecks.classifyOAuthProbe({ status: 400, data: { error: 'invalid_grant' } }).status, 'valid');
  assert.equal(providerChecks.classifyOAuthProbe({ status: 401, data: { error: 'invalid_client' } }).status, 'invalid');
  assert.equal(providerChecks.classifyOAuthProbe({ status: 400, data: { error: { message: 'Error validating client secret.' } } }).status, 'invalid');
  assert.equal(providerChecks.classifyOAuthProbe({ status: 400, data: { error: 'redirect_uri_mismatch' } }).status, 'invalid');
  assert.equal(providerChecks.classifyOAuthProbe({ status: 503, data: 'upstream down' }).status, 'unknown');
});

// ── Destinations and redirects ────────────────────────────────────────────────

test('linkedin: a company page destination posts as the organization', () => {
  assert.equal(resolveLinkedInDestinationUrn({ type: 'page', id: '12345' }), 'urn:li:organization:12345');
  assert.equal(resolveLinkedInDestinationUrn({ type: 'organization', id: 'urn:li:organization:777' }), 'urn:li:organization:777');
  assert.equal(resolveLinkedInDestinationUrn({ type: 'profile', id: 'abc' }), null);
  assert.equal(resolveLinkedInDestinationUrn(null), null);
});

test('oauth returnTo: only same-app paths survive', () => {
  assert.equal(sanitizeOAuthReturnTo('/integrations?fbType=page'), '/integrations?fbType=page');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/a\nb', 42]) {
    assert.equal(sanitizeOAuthReturnTo(bad), null, String(bad));
  }
});

// ── Outbound fetches ──────────────────────────────────────────────────────────

test('media fetch: data URLs decode locally and respect the size cap', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const decoded = await fetchMediaBytes(`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(decoded.mimeType, 'image/png');
  assert.deepEqual(decoded.buffer, png);
  await assert.rejects(fetchMediaBytes(`data:image/png;base64,${png.toString('base64')}`, { maxBytes: 2 }), /size limit/);
});

test('media fetch and link previews never reach private hosts', async () => {
  await assert.rejects(fetchMediaBytes('http://127.0.0.1:9/secret.png'));
  await assert.rejects(fetchMediaBytes('http://169.254.169.254/latest/meta-data/'));
  assert.equal(await fetchLinkMetadata('http://127.0.0.1:9/admin'), null);
});

// ── Compliance routes ─────────────────────────────────────────────────────────

type Call = { sql: string; params: any[] };
const recordingDb = (handler?: (sql: string, params: any[]) => { rows: any[]; rowCount?: number } | undefined) => {
  const calls: Call[] = [];
  const dbQuery = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return handler?.(sql, params) ?? { rows: [], rowCount: 0 };
  };
  return { calls, dbQuery };
};
const complianceApp = (dbQuery: any, configs: Record<string, Record<string, string>>) => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(express.urlencoded({ extended: true }));
  app.use(registerComplianceRoutes({ hasDatabase: () => true, dbQuery, getPlatformConfig: async (p: string) => configs[p] || {} }));
  return app;
};
const writes = (calls: Call[]) => calls.filter((c) => /^\s*(UPDATE|DELETE|INSERT)/i.test(c.sql));

test('compliance routes: unsigned or forged callbacks change nothing', async () => {
  const { calls, dbQuery } = recordingDb();
  const app = complianceApp(dbQuery, { facebook: { appSecret: 'fb-secret' }, slack: { signingSecret: 'slk' } });

  // Providers without signed callbacks are not accepted at all.
  assert.equal((await request(app).post('/oauth/linkedin/deauthorize').send({ user_id: 'victim' })).status, 404);
  assert.equal((await request(app).post('/oauth/twitter/data-deletion').send({ user_id: 'victim' })).status, 404);
  // Meta without, or with a forged, signed_request.
  assert.equal((await request(app).post('/meta/deauthorize').type('form').send({ user_id: 'victim' })).status, 400);
  const forged = signMeta({ algorithm: 'HMAC-SHA256', user_id: 'victim' }, 'attacker-secret');
  assert.equal((await request(app).post('/meta/data-deletion').type('form').send({ signed_request: forged })).status, 401);
  assert.equal((await request(app).post('/oauth/facebook/deauthorize').type('form').send({ signed_request: forged })).status, 401);
  // Slack event without a valid signature.
  assert.equal((await request(app).post('/oauth/slack/deauthorize').send({ team_id: 'T1', event: { type: 'app_uninstalled' } })).status, 401);

  assert.deepEqual(writes(calls), []);
});

test('compliance routes: a signed Meta deauthorization disconnects the matching accounts', async () => {
  const { calls, dbQuery } = recordingDb((sql) => {
    if (sql.includes('SELECT DISTINCT user_id')) return { rows: [{ user_id: 'u1', platform: 'facebook' }] };
    if (sql.startsWith('UPDATE social_accounts') || sql.includes('UPDATE social_accounts')) return { rows: [{ platform: 'facebook' }, { platform: 'instagram' }] };
    return undefined;
  });
  const app = complianceApp(dbQuery, { facebook: { appSecret: 'fb-secret' } });
  const signed = signMeta({ algorithm: 'HMAC-SHA256', user_id: 'fb-user-1' }, 'fb-secret');

  const res = await request(app).post('/meta/deauthorize').type('form').send({ signed_request: signed });
  assert.equal(res.status, 200);
  const lookup = calls.find((c) => c.sql.includes('SELECT DISTINCT user_id'));
  assert.deepEqual(lookup?.params, [['facebook', 'instagram'], ['fb-user-1']]);
  const disconnect = calls.find((c) => c.sql.includes('UPDATE social_accounts'));
  assert.ok(disconnect && /connected = FALSE/.test(disconnect.sql) && /access_token_encrypted = NULL/.test(disconnect.sql));
  assert.deepEqual(disconnect?.params.slice(0, 2), ['u1', 'facebook']);
  const integrations = calls.find((c) => c.sql.includes('UPDATE user_integrations'));
  assert.deepEqual(integrations?.params[1]?.slice().sort(), ['facebook', 'instagram']);
});

test('compliance routes: a signed Meta data deletion deletes and returns a status code', async () => {
  const { calls, dbQuery } = recordingDb((sql) => {
    if (sql.includes('SELECT DISTINCT user_id')) return { rows: [{ user_id: 'u1', platform: 'facebook' }] };
    if (sql.startsWith('DELETE FROM social_accounts')) return { rows: [{ platform: 'facebook' }] };
    return undefined;
  });
  const app = complianceApp(dbQuery, { facebook: { appSecret: 'fb-secret' } });
  const res = await request(app).post('/meta/data-deletion').type('form')
    .send({ signed_request: signMeta({ algorithm: 'HMAC-SHA256', user_id: 'fb-user-1' }, 'fb-secret') });
  assert.equal(res.status, 200);
  assert.ok(res.body.confirmation_code);
  assert.match(res.body.url, /\/data-deletion\?code=/);
  assert.ok(calls.some((c) => c.sql.startsWith('DELETE FROM social_accounts')));
  const record = calls.find((c) => c.sql.includes('INSERT INTO data_deletion_requests'));
  assert.deepEqual(record?.params.slice(0, 4), [res.body.confirmation_code, 'meta', 'fb-user-1', 'completed']);
});

test('compliance routes: Slack and Zoom URL handshakes answer only when signed', async () => {
  const { dbQuery } = recordingDb();
  const app = complianceApp(dbQuery, { slack: { signingSecret: 'slk' }, zoom: { webhookSecret: 'zm' } });
  const ts = String(nowSeconds());

  const slackBody = JSON.stringify({ type: 'url_verification', challenge: 'chal-1' });
  const slackSig = `v0=${createHmac('sha256', 'slk').update(`v0:${ts}:${slackBody}`).digest('hex')}`;
  const slack = await request(app).post('/oauth/slack/deauthorize').set('Content-Type', 'application/json')
    .set('X-Slack-Request-Timestamp', ts).set('X-Slack-Signature', slackSig).send(slackBody);
  assert.equal(slack.status, 200);
  assert.deepEqual(slack.body, { challenge: 'chal-1' });

  const zoomBody = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'pt' } });
  const zoomSig = `v0=${createHmac('sha256', 'zm').update(`v0:${ts}:${zoomBody}`).digest('hex')}`;
  const zoom = await request(app).post('/oauth/zoom/deauthorize').set('Content-Type', 'application/json')
    .set('x-zm-request-timestamp', ts).set('x-zm-signature', zoomSig).send(zoomBody);
  assert.equal(zoom.status, 200);
  assert.equal(zoom.body.encryptedToken, createHmac('sha256', 'zm').update('pt').digest('hex'));

  const unsigned = await request(app).post('/oauth/zoom/deauthorize').send({ event: 'endpoint.url_validation', payload: { plainToken: 'pt' } });
  assert.equal(unsigned.status, 401);
});

// ── OAuth state ───────────────────────────────────────────────────────────────

const connectApp = (dbQuery: any) => {
  const app = express();
  app.use(express.json());
  app.use(registerSocialConnectRoutes({
    requireAuth: () => ({ userId: 'u1', role: 'user', tokenVersion: null }),
    hasDatabase: () => true,
    pool: {} as any,
    dbQuery,
  } as any));
  return app;
};

test('oauth state: malformed or reused states are refused', async () => {
  const { dbQuery } = recordingDb((sql) => (sql.startsWith('INSERT INTO oauth_states') ? { rows: [], rowCount: 0 } : undefined));
  const app = connectApp(dbQuery);
  assert.equal((await request(app).post('/oauth/state').send({ state: 'short', platform: 'twitter' })).status, 400);
  assert.equal((await request(app).post('/oauth/state').send({ state: 'a'.repeat(32), platform: 'myspace' })).status, 400);
  assert.equal((await request(app).post('/oauth/state').send({ state: 'a'.repeat(32), platform: 'twitter', codeVerifier: 'too-short' })).status, 400);
  // ON CONFLICT DO NOTHING inserted nothing: someone already holds this state.
  assert.equal((await request(app).post('/oauth/state').send({ state: 'a'.repeat(32), platform: 'twitter' })).status, 409);
});

test('oauth callback: a state can be redeemed once, before any code exchange', async () => {
  const { calls, dbQuery } = recordingDb((sql) => {
    if (sql.startsWith('SELECT user_id, platform')) return { rows: [{ user_id: 'u1', platform: 'twitter', return_to: '//evil.com', code_verifier: 'v'.repeat(43) }] };
    if (sql.startsWith('DELETE FROM oauth_states')) return { rows: [], rowCount: 0 };
    return undefined;
  });
  const res = await request(connectApp(dbQuery)).post('/oauth/callback').send({ platform: 'twitter', code: 'c', state: 'a'.repeat(32) });
  assert.equal(res.status, 409);
  assert.ok(calls.some((c) => c.sql.startsWith('DELETE FROM oauth_states') && c.params[1] === 'u1'));
});

// ── Admin platform config ─────────────────────────────────────────────────────

test('admin platform config: secrets are masked, a masked save keeps them, and disabling sticks', async () => {
  const inMemoryPlatformConfigs = new Map<string, any>();
  inMemoryPlatformConfigs.set('twitter', {
    platform: 'twitter',
    config: helpers.encryptPlatformConfig({ clientId: 'cid', clientSecret: 'real-secret-1234', redirectUri: 'https://api.test/auth/twitter/callback' }),
    enabled: true,
    updated_at: null,
  });
  const app = express();
  app.use(express.json());
  app.use(registerPlatformConfigRoutes({
    requireAuth: () => ({ userId: 'admin', role: 'admin', tokenVersion: null }),
    requireAdmin: async () => ({ id: 'admin', userId: 'admin', role: 'admin' }),
    hasDatabase: () => false,
    dbQuery: async () => ({ rows: [] }),
    pool: null,
    inMemoryPlatformConfigs,
    getPlatformConfig: async (p: string) => helpers.decryptPlatformConfig(inMemoryPlatformConfigs.get(p)?.config),
    getIntegrationRowBySlug: async () => null,
    getResendConfig: async () => ({ apiKey: '', fromEmail: '', fromName: '' }),
    oauthAuthUrls: platformHelpers.OAUTH_AUTH_URLS,
    resolveOAuthRedirectUri: (_p: string, uri?: string) => uri || 'https://api.test/auth/twitter/callback',
    isOAuthClientSecretRequired: () => false,
  }));

  const single = await request(app).get('/admin/platform-configs/twitter');
  assert.equal(single.status, 200);
  const shown = single.body.config.config;
  assert.ok(helpers.isMaskedSecretValue(shown.clientSecret));
  assert.ok(!JSON.stringify(single.body).includes('real-secret-1234'));
  const list = await request(app).get('/admin/platform-configs');
  assert.ok(!JSON.stringify(list.body).includes('real-secret-1234'));

  // Saving the form unchanged (mask included) while switching it off.
  assert.equal((await request(app).put('/admin/platform-configs/twitter').send({ config: shown, enabled: false })).status, 200);
  const saved = inMemoryPlatformConfigs.get('twitter');
  assert.equal(saved.enabled, false);
  assert.equal(helpers.decryptPlatformConfig(saved.config).clientSecret, 'real-secret-1234');
});
