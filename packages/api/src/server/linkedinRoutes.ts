import axios from 'axios';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { sanitizeTokenData, TOKEN_DATA_SECRET_KEYS } from '../token-data.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface LinkedInRouteDeps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool | null;
  encryptIntegrationSecret: (plain: string) => string;
  computeIsoFromTtlSeconds: (seconds: unknown) => string | null;
  getLinkedInOrganizationScopeError: (tokenData: any, opts?: { requireSocialRead?: boolean }) => string | null;
  upsertUserIntegration: (params: {
    userId: string; integrationSlug: string;
    accessTokenEncrypted?: string | null; refreshTokenEncrypted?: string | null;
    tokenExpiry?: string | null; accountId?: string | null; accountName?: string | null;
    status: 'connected' | 'disconnected' | 'error';
  }) => Promise<void>;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  refreshLinkedInAccessToken: (refreshToken: string, req?: Request) => Promise<any>;
  listLinkedInAdminOrganizations: (accessToken: string, personId: string, options?: { allowedRoles?: string[] }) => Promise<{ organizations: Array<{ id: string; name: string; picture_url?: string | null; roles?: string[] }>; warning: string | null }>;
  fetchLinkedInOrganizationNetworkSize: (accessToken: string, organizationUrn: string) => Promise<number | null>;
  fetchLinkedInSocialMetadataBatch: (accessToken: string, entityUrns: string[]) => Promise<Record<string, any>>;
  fetchLinkedInShareStatisticsForPosts: (accessToken: string, authorUrn: string, postIds: string[]) => Promise<Map<string, any>>;
  sumLinkedInReactionCounts: (metadata: any) => number;
  getClientIp: (req: Request) => string;
  checkLinkMetadataRateLimit: (ip: string) => boolean;
  fetchLinkMetadata: (url: string) => Promise<any>;
}

// ─── Local helpers ─────────────────────────────────────────────────────────────

const LINKEDIN_MARKETING_VERSION = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';
function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerLinkedInRoutes(deps: LinkedInRouteDeps): Router {
  const {
    requireAuth, pool, encryptIntegrationSecret, computeIsoFromTtlSeconds,
    getLinkedInOrganizationScopeError, upsertUserIntegration,
    getPublishableSocialConnection, refreshLinkedInAccessToken,
    listLinkedInAdminOrganizations, fetchLinkedInOrganizationNetworkSize,
    fetchLinkedInSocialMetadataBatch, fetchLinkedInShareStatisticsForPosts, sumLinkedInReactionCounts,
    getClientIp, checkLinkMetadataRateLimit, fetchLinkMetadata,
  } = deps;

  const router = Router();

  // GET /api/linkedin/targets — list profile + admin LinkedIn Pages
  router.get('/api/linkedin/targets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const visiblePlatforms = await (async () => {
        if (!pool) return [];
        const r = await pool.query(`SELECT platform FROM platform_configs WHERE enabled = true`);
        const providers = await pool.query(`SELECT provider FROM auth_providers WHERE enabled = true`);
        return [...r.rows.map((x: any) => String(x.platform || '').toLowerCase()), ...providers.rows.map((x: any) => String(x.provider || '').toLowerCase())].filter(Boolean);
      })();
      if (visiblePlatforms.length > 0 && !visiblePlatforms.includes('linkedin')) {
        return res.status(404).json({ success: false, error: 'LinkedIn is not enabled for this workspace' });
      }

      const conn = await getPublishableSocialConnection(auth.userId, 'linkedin');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) {
        return res.status(400).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect' });
      }

      const savedRows = await pool.query(
        `SELECT account_type, account_id FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND connected=true`,
        [auth.userId]
      );
      const savedKeys = new Set(
        savedRows.rows.map((row: any) => `${String(row.account_type || '').toLowerCase()}:${String(row.account_id || '').trim()}`)
      );

      let personId = String(conn?.account_id || '').trim() || String(conn?.token_data?.sub || conn?.token_data?.user_id || conn?.token_data?.id || '').trim();
      let profileName = String(conn?.account_name || conn?.token_data?.name || '').trim();

      if (!personId || !profileName) {
        const meResp = await axios.get('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (meResp.status < 400) {
          const meData: any = meResp.data || {};
          personId = personId || String(meData?.id || '').trim();
          profileName = profileName || [String(meData?.localizedFirstName || '').trim(), String(meData?.localizedLastName || '').trim()].filter(Boolean).join(' ').trim();
        }
        if (!personId) {
          const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            validateStatus: () => true,
            timeout: 15000,
          });
          if (userinfoResp.status >= 400) {
            return res.status(400).json({ success: false, error: 'LinkedIn profile lookup failed — please reconnect' });
          }
          const ud: any = userinfoResp.data || {};
          personId = String(ud?.sub || '').trim();
          profileName = profileName || String(ud?.name || '').trim() || [String(ud?.given_name || ''), String(ud?.family_name || '')].filter(Boolean).join(' ').trim();
        }
      }

      if (!personId) return res.status(400).json({ success: false, error: 'Unable to resolve your LinkedIn profile id' });

      const targets: Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved: boolean }> = [
        { id: personId, name: profileName || 'Personal profile', accountType: 'profile', saved: savedKeys.has(`profile:${personId}`) },
      ];

      const organizationScopeError = getLinkedInOrganizationScopeError(conn?.token_data);
      if (organizationScopeError) return res.json({ success: true, targets, warning: organizationScopeError });

      const { organizations: adminOrganizations, warning } = await listLinkedInAdminOrganizations(accessToken, personId);
      for (const organization of adminOrganizations) {
        targets.push({ id: organization.id, name: organization.name, accountType: 'page', saved: savedKeys.has(`page:${organization.id}`) });
      }

      return res.json({ success: true, targets, warning });
    } catch (error) {
      logger.error('LinkedIn targets error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch LinkedIn targets' });
    }
  });

  // POST /api/v1/social/linkedin/token-refresh
  router.post('/api/v1/social/linkedin/token-refresh', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
      if (!conn) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });
      const refreshToken = String(conn.refresh_token || '').trim();
      if (!refreshToken) return res.status(400).json({ success: false, error: 'No refresh token stored — reconnect LinkedIn' });

      const refreshed = await refreshLinkedInAccessToken(refreshToken, req);
      const newToken = String(refreshed?.access_token || '').trim();
      if (!newToken) return res.status(400).json({ success: false, error: 'LinkedIn token refresh returned no token' });
      const nextRefreshToken = String(refreshed?.refresh_token || refreshToken || '').trim() || null;
      const expiresAt = String(refreshed?.access_token_expires_at || '').trim() || computeIsoFromTtlSeconds(refreshed?.expires_in);
      const accessTokenEncrypted = encryptIntegrationSecret(newToken);
      const refreshTokenEncrypted = nextRefreshToken ? encryptIntegrationSecret(nextRefreshToken) : null;

      // Tokens live only in the encrypted columns; token_data keeps metadata.
      await pool.query(
        `UPDATE social_accounts
         SET access_token=NULL, refresh_token=NULL, access_token_encrypted=$1, refresh_token_encrypted=$2,
             token_expires_at=$3, expires_at=$3, needs_reapproval=false,
             token_data = (COALESCE(token_data, '{}'::jsonb) - $4::text[]) || $5::jsonb
         WHERE user_id=$6 AND LOWER(platform)='linkedin' AND (account_type = 'profile' OR account_type IS NULL)`,
        [accessTokenEncrypted, refreshTokenEncrypted, expiresAt, ['reason', 'needs_reapproval_at', ...TOKEN_DATA_SECRET_KEYS], JSON.stringify(sanitizeTokenData(refreshed)), user.userId]
      );
      await upsertUserIntegration({
        userId: user.userId, integrationSlug: 'linkedin',
        accessTokenEncrypted, refreshTokenEncrypted, tokenExpiry: expiresAt,
        accountId: conn.account_id ?? null, accountName: conn.account_name ?? null, status: 'connected',
      });
      return res.json({ success: true, message: 'LinkedIn access token refreshed', expiresAt });
    } catch (err) {
      logger.error('LinkedIn token refresh error:', err);
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Refresh failed' });
    }
  });

  // GET /api/v1/social/linkedin/post-insights/:postId
  router.get('/api/v1/social/linkedin/post-insights/:postId', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });

      const postId = String(req.params.postId || '').trim();
      let orgId = String((req.query as any)?.orgId || '').trim();
      if (!orgId) {
        const pageRow = await pool.query(
          `SELECT account_id FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND account_type='page' AND connected=true ORDER BY created_at DESC LIMIT 1`,
          [user.userId]
        );
        orgId = pageRow.rows[0]?.account_id ? String(pageRow.rows[0].account_id).trim() : '';
      }

      const [socialMetadataById, shareStatsByPostId] = await Promise.all([
        fetchLinkedInSocialMetadataBatch(accessToken, [postId]),
        orgId
          ? fetchLinkedInShareStatisticsForPosts(accessToken, `urn:li:organization:${orgId}`, [postId])
          : Promise.resolve(new Map<string, any>()),
      ]);
      const socialMetadata: any = socialMetadataById[postId] || {};
      const stats: any = shareStatsByPostId.get(postId) || {};

      return res.json({
        success: true,
        insights: {
          likes: stats?.likeCount ?? sumLinkedInReactionCounts(socialMetadata) ?? null,
          comments: stats?.commentCount ?? socialMetadata?.commentSummary?.count ?? socialMetadata?.commentSummary?.totalCount ?? null,
          shares: stats?.shareCount ?? socialMetadata?.repostSummary?.count ?? socialMetadata?.repostSummary?.totalCount ?? null,
          impressions: stats.impressionCount ?? null,
          clicks: stats.clickCount ?? null,
          uniqueImpressionsCount: stats.uniqueImpressionsCount ?? null,
          engagement: stats.engagement ?? null,
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch post insights' });
    }
  });

  // GET /api/v1/social/linkedin/org-analytics
  router.get('/api/v1/social/linkedin/org-analytics', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const conn = await getPublishableSocialConnection(user.userId, 'linkedin');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });
      const organizationScopeError = getLinkedInOrganizationScopeError(conn?.token_data, { requireSocialRead: true });
      if (organizationScopeError) return res.status(400).json({ success: false, error: organizationScopeError });

      let orgId = String((req.query as any)?.orgId || '').trim();
      if (!orgId) {
        const pageRow = await pool.query(
          `SELECT account_id FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND account_type='page' AND connected=true ORDER BY created_at DESC LIMIT 1`,
          [user.userId]
        );
        orgId = pageRow.rows[0]?.account_id ? String(pageRow.rows[0].account_id).trim() : '';
      }
      if (!orgId) return res.status(400).json({ success: false, error: 'No LinkedIn organization page found. Connect a company page first.' });

      const orgUrn = `urn:li:organization:${orgId}`;
      const since = String((req.query as any)?.since || '').trim();
      const until = String((req.query as any)?.until || '').trim();
      const timeGranularity = String((req.query as any)?.granularity || 'MONTH').toUpperCase();

      const params: Record<string, string> = {
        q: 'organizationalEntity',
        organizationalEntity: orgUrn,
        'timeIntervals.timeGranularityType': timeGranularity,
        'timeIntervals.timeRange.start': since || String(Date.now() - 30 * 24 * 60 * 60 * 1000),
        'timeIntervals.timeRange.end': until || String(Date.now()),
      };

      const [networkSize, followerResp, visitorResp, shareResp] = await Promise.all([
        fetchLinkedInOrganizationNetworkSize(accessToken, orgUrn),
        axios.get('https://api.linkedin.com/rest/organizationalEntityFollowerStatistics', { params, headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 }),
        axios.get('https://api.linkedin.com/rest/organizationPageStatistics', {
          params: { q: 'organization', organization: orgUrn, 'timeIntervals.timeGranularityType': timeGranularity, 'timeIntervals.timeRange.start': since || String(Date.now() - 30 * 24 * 60 * 60 * 1000), 'timeIntervals.timeRange.end': until || String(Date.now()) },
          headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000,
        }),
        axios.get('https://api.linkedin.com/rest/organizationalEntityShareStatistics', { params, headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 }),
      ]);

      return res.json({
        success: true, orgId,
        followerCount: networkSize,
        followers: followerResp.status < 400 ? (followerResp.data as any)?.elements || [] : null,
        visitors: visitorResp.status < 400 ? (visitorResp.data as any)?.elements || [] : null,
        shares: shareResp.status < 400 ? (shareResp.data as any)?.elements || [] : null,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch org analytics' });
    }
  });

  // GET /api/link-metadata — open-graph/meta tag preview (public, IP rate-limited)
  router.get('/api/link-metadata', async (req: Request, res: Response) => {
    const url = String((req.query as any)?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL is required' });
    let parsed: URL;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Invalid URL protocol' });
    const ip = getClientIp(req);
    if (!checkLinkMetadataRateLimit(ip)) return res.status(429).json({ error: 'Rate limit exceeded' });
    const metadata = await fetchLinkMetadata(url);
    if (!metadata) return res.status(404).json({ error: 'Unable to fetch link metadata', url });
    return res.json(metadata);
  });

  return router;
}
