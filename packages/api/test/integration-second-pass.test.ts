import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

// Second integration audit pass: provider trouble must never read as an
// expired login (the web app signs users out on any API 401), stale token
// flags must not break the integrations catalog, Google grants that were
// revoked surface as "reconnect", and Social Inbox replies are delivered
// through the platform they came from.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

const policy = await import('../src/social-token-policy.ts');
const { isDeadGrantFlag } = await import('../src/google-oauth.ts');
const { decodeWordPressUpload } = await import('../src/integration-helpers.ts');
const { OAUTH_AUTH_URLS } = await import('../src/platform-helpers.ts');
const { INSTAGRAM_GRAPH_BASE, META_GRAPH_BASE } = await import('../src/meta-graph.ts');
const delivery = await import('../src/server/socialInboxDelivery.ts');
const { registerPlatformConfigRoutes } = await import('../src/server/platformConfigRoutes.ts');
const { registerCalendarRoutes } = await import('../src/server/calendarRoutes.ts');
const { registerGmailInboxRoutes, attachmentDisposition } = await import('../src/server/gmailInboxRoutes.ts');
const { registerLinkedInRoutes } = await import('../src/server/linkedinRoutes.ts');
const { registerConnectorPreferencesRoutes } = await import('../src/server/connectorPreferencesRoutes.ts');
const { registerSocialInboxRoutes } = await import('../src/server/socialInboxRoutes.ts');
const { registerWordPressRoutes } = await import('../src/server/wordpressRoutes.ts');

type Call = { sql: string; params: any[] };
const stubPool = (handler: (sql: string, params: any[]) => { rows: any[]; rowCount?: number } | undefined = () => undefined) => {
  const calls: Call[] = [];
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return handler(sql, params) ?? { rows: [], rowCount: 0 };
    },
  };
  return { calls, pool };
};
const appWith = (router: express.Router) => {
  const app = express();
  app.use(express.json());
  app.use(router);
  const errors: unknown[] = [];
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    errors.push(err);
    if (!res.headersSent) res.status(500).json({ error: 'boom' });
  });
  return { app, errors };
};
const authed = () => ({ userId: 'u1', role: 'user', tokenVersion: null });
const reverse = (value: string) => value.split('').reverse().join('');

// ── Health of stale flags ─────────────────────────────────────────────────────

test('health: an old "expiring" flag without a known expiry no longer throws', () => {
  assert.doesNotThrow(() => policy.computeConnectionHealth({ needsReapproval: true, reason: 'token_expiring', expiresAt: null, refreshable: false }));
  assert.equal(policy.computeConnectionHealth({ needsReapproval: true, reason: 'token_expiring', expiresAt: null, refreshable: false }).status, 'healthy');
  // Tokens the server renews itself are never "expiring" for the user.
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(policy.computeConnectionHealth({ needsReapproval: true, reason: 'token_expiring', expiresAt: soon, refreshable: true }).status, 'healthy');
  assert.equal(policy.computeConnectionHealth({ needsReapproval: true, reason: 'token_expiring', expiresAt: soon, refreshable: false }).status, 'expiring');
});

test('catalog: stale soft flags on Gmail do not break the page; a revoked grant shows reconnect', async () => {
  const gmailRow = (overrides: Record<string, unknown>) => ({
    platform: 'gmail', account_type: 'profile', account_id: 'me@example.com', account_name: 'Me', handle: null,
    connected: true, created_at: new Date().toISOString(), needs_reapproval: false, expires_at: null, reason: null,
    login_method: null, graph_host: null, page_id: null, has_refresh: true, has_access: true, ...overrides,
  });
  const catalogFor = async (row: Record<string, unknown>) => {
    const { pool } = stubPool((sql) => {
      if (sql.includes('FROM platform_configs')) return { rows: [{ platform: 'gmail', config: { clientId: 'cid', clientSecret: 'secret' }, enabled: true }] };
      if (sql.includes('FROM social_accounts')) return { rows: [row] };
      return undefined;
    });
    const { app } = appWith(registerPlatformConfigRoutes({
      requireAuth: authed, requireAdmin: async () => null, hasDatabase: () => true, dbQuery: async () => ({ rows: [] }), pool: pool as any,
      inMemoryPlatformConfigs: new Map(), getPlatformConfig: async () => ({}), getIntegrationRowBySlug: async () => null,
      getResendConfig: async () => ({ apiKey: '', fromEmail: '', fromName: '' }), oauthAuthUrls: OAUTH_AUTH_URLS,
      resolveOAuthRedirectUri: () => 'https://api.test/auth/gmail/callback', isOAuthClientSecretRequired: () => true,
    }));
    const res = await request(app).get('/integrations/catalog');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.integrations.find((i: any) => i.slug === 'gmail');
  };
  assert.equal((await catalogFor(gmailRow({ needs_reapproval: true, reason: 'token_expiring' }))).health.status, 'healthy');
  const revoked = await catalogFor(gmailRow({ needs_reapproval: true, reason: 'token_inactive' }));
  assert.equal(revoked.health.status, 'reconnect_required');
});

test('google: only a dead grant blocks use of the stored token', () => {
  assert.ok(isDeadGrantFlag(true, 'token_inactive'));
  assert.ok(isDeadGrantFlag(true, 'deauthorized'));
  assert.ok(!isDeadGrantFlag(true, 'token_expiring'));
  assert.ok(!isDeadGrantFlag(false, 'token_inactive'));
});

// ── Provider trouble is not a login problem ───────────────────────────────────

test('calendar: missing or revoked access answers 409, never 401', async () => {
  const { pool } = stubPool((sql) => (sql.includes('needs_reapproval') && sql.includes('LIMIT 1') && sql.startsWith('SELECT needs_reapproval')
    ? { rows: [{ needs_reapproval: true, reason: 'token_inactive' }] }
    : undefined));
  const { app } = appWith(registerCalendarRoutes({
    requireAuth: authed, pool: pool as any, getPlatformConfig: async () => ({}),
    encryptIntegrationSecret: reverse, decryptIntegrationSecret: reverse, frontendUrl: 'https://app.test',
  }));
  const events = await request(app).get('/events');
  assert.equal(events.status, 409);
  assert.equal(events.body.notConnected, true);
  assert.equal((await request(app).post('/events').send({ summary: 'x', start: { dateTime: new Date().toISOString() } })).status, 409);
  assert.equal((await request(app).delete('/events/abc')).status, 409);
  const status = await request(app).get('/google/status');
  assert.deepEqual(status.body, { connected: false, reconnectRequired: true });
});

test('gmail: a missing connection answers 409 and a running sync is not started twice', async () => {
  const { calls, pool } = stubPool((sql) => (sql.includes('INSERT INTO gmail_sync_state') ? { rows: [] } : undefined));
  const { app } = appWith(registerGmailInboxRoutes({
    requireAuth: authed as any, pool: pool as any, getPlatformConfig: async () => ({}),
    encryptIntegrationSecret: reverse, decryptIntegrationSecret: reverse,
    getAIConfig: async () => ({}), resolveActiveKey: () => null, GEMINI_MODELS: [], callAINonStreaming: (async () => '') as any,
  }));
  for (const path of ['/gmail/messages/m1/body', '/gmail/messages/m1/attachments', '/gmail/messages/m1/attachments/a1']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 409, path);
    assert.equal(res.body.reconnect, 'gmail');
  }
  const sync = await request(app).post('/gmail/sync');
  assert.equal(sync.body.message, 'Sync already in progress');
  const claim = calls.find((c) => c.sql.includes('INSERT INTO gmail_sync_state'));
  assert.match(String(claim?.sql), /updated_at < NOW\(\)/);
  assert.equal(calls.filter((c) => c.sql.includes('FROM social_accounts')).length, 3, 'no sync ran after the refused claim');
});

test('gmail: attachment names of any script make a valid header', () => {
  const header = attachmentDisposition('Résumé 履歴書.pdf');
  assert.ok([...header].every((ch) => ch.charCodeAt(0) < 0x7f), header);
  assert.match(header, /filename\*=UTF-8''R%C3%A9sum%C3%A9%20/);
  assert.equal(attachmentDisposition('a"\r\nb.txt').includes('\n'), false);
});

// ── Token hygiene and auth checks ─────────────────────────────────────────────

test('linkedin: a manual refresh stores no tokens in token_data and touches only the profile', async () => {
  const { calls, pool } = stubPool();
  const { app } = appWith(registerLinkedInRoutes({
    requireAuth: authed, pool: pool as any, encryptIntegrationSecret: reverse,
    computeIsoFromTtlSeconds: (s: unknown) => new Date(Date.now() + Number(s) * 1000).toISOString(),
    getLinkedInOrganizationScopeError: () => null, upsertUserIntegration: async () => {},
    getPublishableSocialConnection: async () => ({ refresh_token: 'old-refresh', account_id: 'p1', account_name: 'Me', token_data: {} }),
    refreshLinkedInAccessToken: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'w_member_social' }),
  } as any));
  const res = await request(app).post('/api/v1/social/linkedin/token-refresh');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = calls.find((c) => c.sql.includes('UPDATE social_accounts'));
  assert.ok(update && /account_type = 'profile'/.test(update.sql));
  const stored = update!.params.find((p) => typeof p === 'string' && p.startsWith('{'));
  assert.ok(stored && !stored.includes('new-access') && !stored.includes('new-refresh'), stored);
  assert.ok(stored.includes('w_member_social'));
});

test('connector defaults: an unauthenticated call ends at the 401', async () => {
  const { pool } = stubPool();
  const { app, errors } = appWith(registerConnectorPreferencesRoutes({
    requireAuth: (_req: any, res: any) => { res.status(401).json({ error: 'Unauthorized' }); return null; },
    pool: pool as any,
  }));
  const res = await request(app).get('/field-maps/defaults/crm/hubspot');
  assert.equal(res.status, 401);
  assert.deepEqual(errors, []);
});

// ── WordPress ─────────────────────────────────────────────────────────────────

test('wordpress: uploads keep their real type and a safe name', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const fromDataUrl = decodeWordPressUpload(`data:image/png;base64,${png}`, 'photo.jpg', 'featured.jpg');
  assert.equal(fromDataUrl.contentType, 'image/png');
  assert.equal(fromDataUrl.filename, 'photo.png');
  assert.equal(decodeWordPressUpload(`data:image/webp;base64,${png}`, '../../etc/passwd', 'x.jpg').filename, 'passwd.webp');
  const bare = decodeWordPressUpload(png, undefined, 'featured.jpg');
  assert.equal(bare.contentType, 'image/jpeg');
  assert.equal(bare.filename, 'featured.jpg');
  assert.equal(bare.buffer.length, 4);
});

test('wordpress: connection errors read cleanly', async () => {
  const { app } = appWith(registerWordPressRoutes({ requireAuth: authed, hasDatabase: () => true } as any));
  const res = await request(app).post('/wordpress/connect').send({ siteUrl: 'https://blog.example.com', username: 'admin' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Users → Profile → Application Passwords/);
});

// ── Social Inbox replies ──────────────────────────────────────────────────────

const thread = (overrides: Partial<{ platform: string; channel_type: string; external_thread_id: string | null; external_account_id: string | null }>) => ({
  platform: 'facebook', channel_type: 'dm', external_thread_id: 'psid-1', external_account_id: 'page-1', ...overrides,
});
const fbCreds = { accessToken: 'page-token', instagramDirect: false, pageId: 'page-1' };

test('inbox: replies are routed to the right Graph call', () => {
  const dm = delivery.planInboxReply(thread({}), fbCreds, 'Hi');
  assert.ok('url' in dm);
  assert.equal(dm.url, `${META_GRAPH_BASE}/page-1/messages`);
  assert.deepEqual(dm.body, { recipient: { id: 'psid-1' }, messaging_type: 'RESPONSE', message: { text: 'Hi' } });

  const comment = delivery.planInboxReply(thread({ channel_type: 'comment', external_thread_id: 'c_1' }), fbCreds, 'Thanks');
  assert.ok('url' in comment && comment.url === `${META_GRAPH_BASE}/c_1/comments`);

  const igDirectDm = delivery.planInboxReply(thread({ platform: 'instagram', external_thread_id: 'igsid', external_account_id: 'ig-1' }),
    { accessToken: 'IGtoken', instagramDirect: true, instagramAccountId: 'ig-1' }, 'Hey');
  assert.ok('url' in igDirectDm && igDirectDm.url === `${INSTAGRAM_GRAPH_BASE}/ig-1/messages`);

  const igViaFacebookComment = delivery.planInboxReply(thread({ platform: 'instagram', channel_type: 'comment', external_thread_id: '1789' }),
    { accessToken: 'page-token', instagramDirect: false, pageId: 'page-9' }, 'Thanks');
  assert.ok('url' in igViaFacebookComment && igViaFacebookComment.url === `${META_GRAPH_BASE}/1789/replies`);

  assert.equal(delivery.checkInboxReplyable(thread({ channel_type: 'mention' }))?.status, 422);
  assert.equal(delivery.checkInboxReplyable(thread({ platform: 'linkedin' }))?.status, 422);
  assert.equal(delivery.checkInboxReplyable(thread({ external_thread_id: null }))?.status, 422);
});

test('inbox: Graph errors become actionable messages', () => {
  const window = delivery.describeReplyFailure('facebook', 400, { error: { code: 10, error_subcode: 2018278, message: 'outside window' } }, 'pages_messaging', false);
  assert.match(window.error, /24-hour/);
  assert.equal(window.reconnect, undefined);
  const permission = delivery.describeReplyFailure('instagram', 403, { error: { code: 200, message: 'Requires instagram_manage_comments permission' } }, 'instagram_manage_comments', false);
  assert.deepEqual(permission.reconnect, { platform: 'instagram', method: 'facebook', extraScopes: ['instagram_manage_comments'] });
  const expired = delivery.describeReplyFailure('facebook', 400, { error: { code: 190, message: 'Session has expired' } }, 'pages_messaging', false);
  assert.equal(expired.status, 409);
  assert.equal(delivery.describeReplyFailure('facebook', 500, { error: { code: 2, message: 'Service down' } }, 'pages_messaging', false).status, 502);
});

test('inbox: the reply route validates before contacting any platform', async () => {
  const threads: Record<string, any> = {
    seeded: { id: 'seeded', user_id: 'u1', platform: 'x', channel_type: 'mention', external_thread_id: null, external_account_id: null },
    fb: { id: 'fb', user_id: 'u1', platform: 'facebook', channel_type: 'dm', external_thread_id: 'psid', external_account_id: 'page-1' },
  };
  const { calls, pool } = stubPool((sql, params) => {
    if (sql.startsWith('SELECT * FROM social_inbox_threads')) return { rows: threads[params[0]] ? [threads[params[0]]] : [] };
    return undefined;
  });
  const { app } = appWith(registerSocialInboxRoutes({
    requireAuth: authed, pool: pool as any, decryptIntegrationSecret: reverse,
    getPublishableSocialConnection: async () => null,
  }));
  assert.equal((await request(app).post('/social-inbox/threads/fb/reply').send({ body: '   ' })).status, 400);
  assert.equal((await request(app).post('/social-inbox/threads/none/reply').send({ body: 'Hi' })).status, 404);
  assert.equal((await request(app).post('/social-inbox/threads/seeded/reply').send({ body: 'Hi' })).status, 422);
  // The receiving Page is not saved, so there is no Page token to reply with.
  const noPage = await request(app).post('/social-inbox/threads/fb/reply').send({ body: 'Hi' });
  assert.equal(noPage.status, 409);
  assert.equal(noPage.body.reconnect.platform, 'facebook');
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO social_inbox_messages')), 'nothing recorded without delivery');
});

test('meta webhook: inbox threads record the receiving account and skip the account\'s own replies', async () => {
  const { createHmac } = await import('node:crypto');
  const { registerWebhookRoutes } = await import('../src/server/webhookRoutes.ts');
  const { calls, pool } = stubPool((sql) => {
    if (sql.includes('FROM social_accounts WHERE account_id')) return { rows: [{ user_id: 'u1', handle: '@acme' }] };
    return undefined;
  });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(registerWebhookRoutes({
    hasDatabase: () => true, dbQuery: async () => ({ rows: [] }), pool: pool as any, requireAuth: authed as any,
    markSocialAccountNeedsReapproval: async () => {}, logIntegrationEvent: async () => {}, decryptIntegrationSecret: reverse,
    getPlatformConfig: async (p: string) => (p === 'facebook' ? { appSecret: 'fb-secret' } : {}),
    fireAutomationTrigger: async () => {}, recalcLeadScore: async () => null,
    salesEngine: { getProviderByName: async () => ({ verifySignature: () => false, normalizeWebhook: () => ({}) }), handleProviderEvent: async () => ({ handled: false }) },
  } as any));
  const send = async (from: Record<string, string>) => {
    const body = JSON.stringify({ object: 'instagram', entry: [{ id: 'ig-1', changes: [{ field: 'comments', value: { id: 'c-2', parent_id: 'c-1', text: 'Nice!', from, media: { id: 'm-1' } } }] }] });
    const sig = `sha256=${createHmac('sha256', 'fb-secret').update(body).digest('hex')}`;
    await request(app).post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    // Processing continues after the 200; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  await send({ id: 'igsid-self', username: 'acme' });
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO social_inbox_threads')), 'own reply skipped');

  await send({ id: 'igsid-fan', username: 'fan_account' });
  const insert = calls.find((c) => c.sql.includes('INSERT INTO social_inbox_threads'));
  assert.ok(insert, 'fan comment recorded');
  // Replies to a comment join that comment's thread, on the receiving account.
  assert.equal(insert!.params[3], 'c-1');
  assert.equal(insert!.params[7], 'comment');
  assert.equal(insert!.params[10], 'ig-1');
});


test('meta webhook: GET challenge verification succeeds on /webhooks/meta and /webhooks/instagram', async () => {
  const { registerWebhookRoutes } = await import('../src/server/webhookRoutes.ts');
  const app = express();
  app.use(registerWebhookRoutes({
    hasDatabase: () => false, dbQuery: async () => ({ rows: [] }), pool: null, requireAuth: (() => null) as any,
    markSocialAccountNeedsReapproval: async () => {}, logIntegrationEvent: async () => {}, decryptIntegrationSecret: (s: string) => s,
    getPlatformConfig: async () => ({}),
    fireAutomationTrigger: async () => {}, recalcLeadScore: async () => null,
    salesEngine: { getProviderByName: async () => ({ verifySignature: () => false, normalizeWebhook: () => ({}) }), handleProviderEvent: async () => ({ handled: false }) },
  } as any));

  const resMeta = await request(app)
    .get('/webhooks/meta?hub.mode=subscribe&hub.challenge=test_challenge_123&hub.verify_token=dakyworld_hub_meta_verify_2026_token');
  assert.equal(resMeta.status, 200);
  assert.equal(resMeta.text, 'test_challenge_123');

  const resIg = await request(app)
    .get('/webhooks/instagram?hub.mode=subscribe&hub.challenge=ig_challenge_456&hub.verify_token=any_token_user_typed');
  assert.equal(resIg.status, 200);
  assert.equal(resIg.text, 'ig_challenge_456');

  const resWrongMode = await request(app)
    .get('/webhooks/meta?hub.mode=unsubscribe&hub.challenge=123&hub.verify_token=token');
  assert.equal(resWrongMode.status, 403);
});
