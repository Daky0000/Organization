import { Router } from 'express';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';
import { TOKEN_DATA_SECRET_KEYS, USER_ACCESS_TOKEN_ENC_KEY } from '../token-data.ts';
import {
  extractRevokedAccountIds,
  parseMetaSignedRequest,
  verifySlackSignature,
  verifyTikTokSignature,
  verifyZoomSignature,
  zoomUrlValidationResponse,
} from '../oauth-compliance.ts';

// ─── OAuth compliance callbacks ──────────────────────────────────────────────
// Providers call these when a user removes the app (deauthorize) or asks for
// their data to be deleted. The endpoints are public, so nothing changes
// unless the provider's signature checks out, and the affected account ids are
// read from the signed payload only.

export interface ComplianceDeps {
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
}

type ComplianceMode = 'deauthorize' | 'delete';
type DataDeletionStatus = 'received' | 'completed' | 'unknown';
type DataDeletionRecord = { code: string; platform: string; externalUserId: string | null; status: DataDeletionStatus; createdAt: string; completedAt: string | null };

type Verification =
  | { kind: 'verified'; platforms: string[]; externalIds: string[]; payload: Record<string, unknown> }
  | { kind: 'reply'; body: Record<string, unknown> }
  | { kind: 'rejected'; status: number; error: string };

const META_PLATFORMS = new Set(['facebook', 'instagram', 'threads', 'whatsapp', 'meta']);
const HEADER_SIGNED_PLATFORMS = new Set(['slack', 'zoom', 'tiktok']);

function normalizeCompliancePlatform(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'x' || raw === 'twitter/x') return 'twitter';
  return raw;
}

function frontendBase(): string {
  return (process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyx.com').replace(/\/$/, '');
}

function rawBodyOf(req: Request): string {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw ? Buffer.from(raw).toString('utf8') : '';
}

export function registerComplianceRoutes(deps: ComplianceDeps): Router {
  const { hasDatabase, dbQuery, getPlatformConfig } = deps;
  const router = Router();
  const inMemoryDeletionRequests = new Map<string, DataDeletionRecord>();

  const platformConfig = (platform: string) => getPlatformConfig(platform).catch(() => ({} as Record<string, string>));

  const authProviderConfig = async (provider: string): Promise<Record<string, string>> => {
    if (!hasDatabase()) return {};
    const result = await dbQuery<{ config: Record<string, any> }>('SELECT config FROM auth_providers WHERE provider = $1', [provider])
      .catch(() => ({ rows: [] as Array<{ config: Record<string, any> }> }));
    return result.rows[0] ? (decryptPlatformConfig(result.rows[0].config) as Record<string, string>) : {};
  };

  // Each Meta app signs with its own secret; which one verifies tells us
  // whose id the payload carries (Facebook user, Instagram user, Threads user).
  const loadMetaApps = async (): Promise<Array<{ platforms: string[]; secrets: string[] }>> => {
    const [facebook, instagram, threads, facebookLogin] = await Promise.all([
      platformConfig('facebook'), platformConfig('instagram'), platformConfig('threads'), authProviderConfig('facebook'),
    ]);
    const env = (name: string) => process.env[name];
    return [
      { platforms: ['facebook', 'instagram'], secrets: [env('FACEBOOK_APP_SECRET'), env('META_APP_SECRET'), facebook.appSecret, instagram.facebookAppSecret, facebookLogin.clientSecret] },
      { platforms: ['instagram'], secrets: [env('INSTAGRAM_APP_SECRET'), instagram.appSecret] },
      { platforms: ['threads'], secrets: [env('THREADS_APP_SECRET'), threads.appSecret] },
    ].map((app) => ({ platforms: app.platforms, secrets: app.secrets.map((s) => String(s || '').trim()).filter(Boolean) }));
  };

  const verifyMeta = async (req: Request): Promise<Verification> => {
    const signedRequest = String((req.body as any)?.signed_request || '').trim();
    if (!signedRequest) return { kind: 'rejected', status: 400, error: 'signed_request required' };
    const apps = await loadMetaApps();
    if (!apps.some((app) => app.secrets.length > 0)) {
      logger.error('Meta compliance callback received but no Meta app secret is configured');
      return { kind: 'rejected', status: 503, error: 'Meta app secret not configured' };
    }
    const platforms = new Set<string>();
    let payload: Record<string, unknown> | null = null;
    for (const app of apps) {
      const parsed = parseMetaSignedRequest(signedRequest, app.secrets);
      if (!parsed) continue;
      payload = parsed;
      for (const p of app.platforms) platforms.add(p);
    }
    if (!payload) return { kind: 'rejected', status: 401, error: 'Invalid signed_request signature' };
    return { kind: 'verified', platforms: Array.from(platforms), externalIds: extractRevokedAccountIds('facebook', null, payload), payload };
  };

  const verifyHeaderSigned = async (platform: string, req: Request): Promise<Verification> => {
    const body = (req.body || {}) as Record<string, any>;
    const rawBody = rawBodyOf(req);
    const cfg = await platformConfig(platform);
    const secret = String(
      platform === 'slack' ? (cfg.signingSecret || process.env.SLACK_SIGNING_SECRET)
        : platform === 'zoom' ? (cfg.webhookSecret || process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
          : (cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET),
    ).trim();
    if (!secret) {
      logger.error({ platform }, 'Compliance callback received but no signing secret is configured');
      return { kind: 'rejected', status: 503, error: 'Signing secret not configured' };
    }
    const verified = platform === 'slack' ? verifySlackSignature(req.headers, rawBody, secret)
      : platform === 'zoom' ? verifyZoomSignature(req.headers, rawBody, secret)
        : verifyTikTokSignature(req.headers, rawBody, secret);
    if (!verified) return { kind: 'rejected', status: 401, error: 'Invalid signature' };

    // URL handshakes the providers send when the endpoint is first registered.
    if (platform === 'slack' && body.type === 'url_verification') return { kind: 'reply', body: { challenge: body.challenge } };
    if (platform === 'zoom' && body.event === 'endpoint.url_validation') {
      return { kind: 'reply', body: zoomUrlValidationResponse(String(body.payload?.plainToken || ''), secret) };
    }
    return { kind: 'verified', platforms: [platform], externalIds: extractRevokedAccountIds(platform, body), payload: body };
  };

  const verifyRequest = (platform: string, req: Request): Promise<Verification> => {
    if (META_PLATFORMS.has(platform)) return verifyMeta(req);
    if (HEADER_SIGNED_PLATFORMS.has(platform)) return verifyHeaderSigned(platform, req);
    return Promise.resolve({ kind: 'rejected', status: 404, error: 'This provider does not send signed deauthorization callbacks' });
  };

  // Disconnects (deauthorize) or deletes (data deletion) every stored
  // connection the verified ids belong to. Facebook Page rows and Instagram
  // accounts linked through Facebook Login ride on the same grant, so they go
  // with the Facebook user.
  const revokeConnections = async (mode: ComplianceMode, platforms: string[], externalIds: string[]): Promise<number> => {
    if (!hasDatabase() || platforms.length === 0 || externalIds.length === 0) return 0;
    const owners = await dbQuery<{ user_id: string; platform: string }>(
      `SELECT DISTINCT user_id, LOWER(platform) AS platform
         FROM social_accounts
        WHERE LOWER(platform) = ANY($1::text[])
          AND (account_type = 'profile' OR account_type IS NULL)
          AND (account_id = ANY($2::text[])
               OR token_data->>'user_id' = ANY($2::text[])
               OR token_data->>'app_scoped_user_id' = ANY($2::text[])
               OR token_data->>'facebook_user_id' = ANY($2::text[]))`,
      [platforms, externalIds],
    );

    let affected = 0;
    for (const owner of owners.rows) {
      const scope = `user_id = $1 AND (LOWER(platform) = $2 OR ($2 = 'facebook' AND LOWER(platform) = 'instagram' AND token_data->>'login_method' = 'facebook'))`;
      const result = mode === 'delete'
        ? await dbQuery<{ platform: string }>(`DELETE FROM social_accounts WHERE ${scope} RETURNING LOWER(platform) AS platform`, [owner.user_id, owner.platform])
        : await dbQuery<{ platform: string }>(
          `UPDATE social_accounts
              SET connected = FALSE,
                  needs_reapproval = TRUE,
                  access_token = NULL,
                  refresh_token = NULL,
                  access_token_encrypted = NULL,
                  refresh_token_encrypted = NULL,
                  token_data = (COALESCE(token_data, '{}'::jsonb) - $3::text[])
                    || jsonb_build_object('reason', 'deauthorized', 'needs_reapproval_at', NOW())
            WHERE ${scope}
            RETURNING LOWER(platform) AS platform`,
          [owner.user_id, owner.platform, [...TOKEN_DATA_SECRET_KEYS, USER_ACCESS_TOKEN_ENC_KEY]],
        );
      affected += result.rows.length;
      const slugs = Array.from(new Set([owner.platform, ...result.rows.map((r) => r.platform)]));
      await dbQuery(
        `UPDATE user_integrations ui
            SET status = 'disconnected', access_token = NULL, refresh_token = NULL, token_expiry = NULL
           FROM integrations i
          WHERE ui.user_id = $1 AND ui.integration_id = i.id AND i.slug = ANY($2::text[])`,
        [owner.user_id, slugs],
      ).catch(() => undefined);
      logger.info({ userId: owner.user_id, platforms: slugs, mode, rows: result.rows.length }, 'oauth_compliance_connections_revoked');
    }
    return affected;
  };

  // Facebook Login sign-ups without an email get a synthetic address; a data
  // deletion request for that Facebook user removes the account itself.
  const deleteFacebookLoginUser = async (facebookUserId: string): Promise<boolean> => {
    if (!hasDatabase() || !facebookUserId) return false;
    const result = await dbQuery('DELETE FROM users WHERE email = $1', [`fb_${facebookUserId}@facebook.social`]).catch(() => ({ rows: [], rowCount: 0 }));
    return Number(result.rowCount || 0) > 0;
  };

  const recordDeletionRequest = async (record: DataDeletionRecord, payload: Record<string, unknown>) => {
    if (!hasDatabase()) {
      inMemoryDeletionRequests.set(record.code, record);
      return;
    }
    await dbQuery(
      `INSERT INTO data_deletion_requests (code, platform, meta_user_id, status, payload, created_at, completed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), CASE WHEN $4 = 'completed' THEN NOW() ELSE NULL END)
       ON CONFLICT (code) DO NOTHING`,
      [record.code, record.platform, record.externalUserId, record.status, JSON.stringify(payload ?? {})],
    );
  };

  const getDeletionRequest = async (code: string): Promise<DataDeletionRecord | null> => {
    if (!hasDatabase()) return inMemoryDeletionRequests.get(code) ?? null;
    const result = await dbQuery(
      'SELECT code, platform, meta_user_id, status, created_at, completed_at FROM data_deletion_requests WHERE code = $1',
      [code],
    );
    const row = result.rows[0] as any;
    if (!row) return null;
    return {
      code: String(row.code),
      platform: String(row.platform || 'meta'),
      externalUserId: row.meta_user_id ? String(row.meta_user_id) : null,
      status: (String(row.status || 'received') as DataDeletionStatus) || 'received',
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    };
  };

  const handleDeauthorize = async (platform: string, req: Request, res: Response) => {
    try {
      const verification = await verifyRequest(platform, req);
      if (verification.kind === 'rejected') return res.status(verification.status).json({ success: false, error: verification.error });
      if (verification.kind === 'reply') return res.json(verification.body);
      const affected = await revokeConnections('deauthorize', verification.platforms, verification.externalIds);
      logger.info({ platform, ids: verification.externalIds.length, affected }, 'oauth_deauthorize_callback_processed');
      return res.json({ success: true, status: 'deauthorized' });
    } catch (error) {
      logger.error({ error, platform }, 'oauth_deauthorize_callback_error');
      return res.status(500).json({ success: false, error: 'Failed to process deauthorization callback' });
    }
  };

  const handleDataDeletion = async (platform: string, req: Request, res: Response) => {
    try {
      const verification = await verifyRequest(platform, req);
      if (verification.kind === 'rejected') return res.status(verification.status).json({ success: false, error: verification.error });
      if (verification.kind === 'reply') return res.json(verification.body);

      const affected = await revokeConnections('delete', verification.platforms, verification.externalIds);
      let userDeleted = false;
      if (verification.platforms.includes('facebook')) {
        for (const id of verification.externalIds) userDeleted = (await deleteFacebookLoginUser(id)) || userDeleted;
      }

      const code = randomUUID();
      const recordPlatform = META_PLATFORMS.has(platform) ? 'meta' : platform;
      await recordDeletionRequest({
        code,
        platform: recordPlatform,
        externalUserId: verification.externalIds[0] ?? null,
        // Nothing stored for the id is also a completed deletion.
        status: 'completed',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }, verification.payload);

      logger.info({ platform, ids: verification.externalIds.length, affected, userDeleted, code }, 'oauth_data_deletion_callback_processed');
      // Meta expects { url, confirmation_code }.
      return res.json({
        url: `${frontendBase()}/data-deletion?code=${encodeURIComponent(code)}`,
        confirmation_code: code,
        status: 'completed',
      });
    } catch (error) {
      logger.error({ error, platform }, 'oauth_data_deletion_callback_error');
      return res.status(500).json({ success: false, error: 'Failed to process data deletion request' });
    }
  };

  // Meta app dashboard callbacks. The doubled /api prefix keeps URLs that
  // were registered with it working.
  router.post(['/meta/deauthorize', '/api/meta/deauthorize'], (req: Request, res: Response) => handleDeauthorize('meta', req, res));
  router.post(['/meta/data-deletion', '/api/meta/data-deletion'], (req: Request, res: Response) => handleDataDeletion('meta', req, res));

  // GET /api/meta/data-deletion/status?code=... — used by the public status page
  router.get(['/meta/data-deletion/status', '/api/meta/data-deletion/status'], async (req: Request, res: Response) => {
    try {
      const code = String((req.query as any)?.code || '').trim();
      if (!code) return res.status(400).json({ success: false, error: 'code required' });
      const record = await getDeletionRequest(code);
      if (!record) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({
        success: true,
        data: { code: record.code, status: record.status, createdAt: record.createdAt, completedAt: record.completedAt },
      });
    } catch (error) {
      logger.error('Data deletion status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to load status' });
    }
  });

  // Universal per-provider callbacks (/api/oauth/:platform/deauthorize, /data-deletion).
  router.get('/oauth/:platform/deauthorize', (req: Request, res: Response) => {
    const platform = normalizeCompliancePlatform(req.params.platform);
    return res.json({ ok: true, endpoint: 'oauth_deauthorize_callback', platform, message: `Providers POST signed deauthorization events for ${platform} here.` });
  });
  router.post('/oauth/:platform/deauthorize', (req: Request, res: Response) => handleDeauthorize(normalizeCompliancePlatform(req.params.platform), req, res));

  router.get('/oauth/:platform/data-deletion', (req: Request, res: Response) => {
    const platform = normalizeCompliancePlatform(req.params.platform);
    return res.json({ ok: true, endpoint: 'oauth_data_deletion_callback', platform, instructions_url: `${frontendBase()}/data-deletion` });
  });
  router.post('/oauth/:platform/data-deletion', (req: Request, res: Response) => handleDataDeletion(normalizeCompliancePlatform(req.params.platform), req, res));

  return router;
}
