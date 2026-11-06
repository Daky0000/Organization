import axios from 'axios';
import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import { getLinkedInRestHeaders } from './helpers.ts';
import { getLinkedInOrganizationScopeError } from '../../social-helpers.ts';
import {
  fetchLinkedInOrganizationsByIds,
  fetchLinkedInOrganizationNetworkSize,
  fetchLinkedInPostsByAuthor,
  fetchLinkedInSocialMetadataBatch,
  sumLinkedInReactionCounts,
  fetchLinkedInShareStatisticsForPosts,
  listLinkedInAdminOrganizations,
  resolveLinkedInProfileIdentity,
  extractLinkedInOrganizationDescription,
  extractLinkedInPostText,
  extractLinkedInPostMediaType,
} from '../distribution/linkedinHelpers.ts';

// Per-user sync, shared by the POST /social/linkedin/sync route and the
// periodic analytics auto-sync in analyticsRoutes.ts.
export async function syncLinkedInAnalyticsForUser(
  { pool, decryptIntegrationSecret }: Pick<AnalyticsDeps, 'pool' | 'decryptIntegrationSecret'>,
  userId: string
): Promise<{ found: number; synced: number; errors: string[] }> {
  if (!pool) return { found: 0, synced: 0, errors: ['DB not ready'] };

  const accountRes = await pool.query(
    `SELECT id, account_id, access_token, access_token_encrypted, token_data
     FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND connected=true`,
    [userId]
  );

  let synced = 0;
  const errors: string[] = [];
  for (const acct of accountRes.rows as any[]) {
    let token = '';
    if (acct.access_token_encrypted) { try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ } }
    if (!token) token = String(acct.access_token || '').trim();
    if (!token) { errors.push('No access token available'); continue; }

    try {
      const profileResp = await axios.get('https://api.linkedin.com/v2/me', { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 15000 });
      if (profileResp.status === 200 && profileResp.data?.id) {
        const profile = profileResp.data;
        const firstName = profile.localizedFirstName || profile.firstName?.localized?.[Object.keys(profile.firstName?.localized || {})[0]] || '';
        const lastName = profile.localizedLastName || profile.lastName?.localized?.[Object.keys(profile.lastName?.localized || {})[0]] || '';
        await pool.query(
          `INSERT INTO linkedin_profile_stats (id, user_id, social_account_id, platform, first_name, last_name, headline, profile_picture_url, raw_response, synced_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'linkedin', $3, $4, $5, $6, $7::jsonb, NOW())
           ON CONFLICT (social_account_id) DO UPDATE SET
             first_name = COALESCE(EXCLUDED.first_name, linkedin_profile_stats.first_name),
             last_name = COALESCE(EXCLUDED.last_name, linkedin_profile_stats.last_name),
             headline = COALESCE(EXCLUDED.headline, linkedin_profile_stats.headline),
             profile_picture_url = COALESCE(EXCLUDED.profile_picture_url, linkedin_profile_stats.profile_picture_url),
             raw_response = EXCLUDED.raw_response, synced_at = NOW()`,
          [userId, acct.id, firstName, lastName, profile.headline?.localized?.[Object.keys(profile.headline?.localized || {})[0]] || null, profile.profilePicture?.displayImage || null, JSON.stringify(profile)]
        );
        await pool.query(`UPDATE social_accounts SET account_name = $1 WHERE id = $2`, [`${firstName} ${lastName}`.trim(), acct.id]);
        synced++;
      }
    } catch (profileErr: any) { errors.push(`Profile sync failed: ${profileErr.message}`); }

    try {
      const postsResp = await axios.get('https://api.linkedin.com/v2/ugcPosts', { params: { q: 'authors', authors: `urn:li:person:${acct.account_id}`, count: 100 }, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 15000 });
      if (postsResp.status === 200 && postsResp.data?.elements) {
        for (const post of postsResp.data.elements) {
          if (!post.id) continue;
          const createdAt = post.created?.time ? new Date(post.created.time).toISOString() : null;
          await pool.query(
            `INSERT INTO linkedin_post_metrics (id, user_id, social_account_id, post_id, text, post_url, media_type, created_at, fetched_at, raw_data)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), $8::jsonb)
             ON CONFLICT (social_account_id, post_id) DO UPDATE SET text = EXCLUDED.text, post_url = EXCLUDED.post_url, media_type = EXCLUDED.media_type, fetched_at = NOW(), raw_data = EXCLUDED.raw_data`,
            [userId, acct.id, String(post.id), post.specificContent?.com?.linkedin?.ugcPost?.content?.com?.linkedin?.ugcPost?.shareCommentary?.text?.slice(0, 5000) || null, `https://www.linkedin.com/feed/update/${post.id}`, post.specificContent?.com?.linkedin?.ugcPost?.content?.media?.length > 0 ? 'media' : 'text', createdAt, JSON.stringify(post)]
          );
          synced++;
        }
      }
    } catch (postsErr: any) { errors.push(`Posts sync failed: ${postsErr.message}`); }
  }
  return { found: accountRes.rows.length, synced, errors };
}

export function registerLinkedInAnalyticsRoutes(router: Router, { requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection }: AnalyticsDeps): void {
  async function getLinkedInAuthContext(userId: string) {
    const conn = await getPublishableSocialConnection(userId, 'linkedin');
    const preferredAccountId = String(conn?.account_id || '').trim();
    let socialAccountId: string | null = null;
    if (pool) {
      const accountRes = await pool.query(
        `SELECT id FROM social_accounts WHERE user_id=$1 AND platform='linkedin' AND connected=true
         ORDER BY CASE WHEN account_type='profile' OR account_type IS NULL THEN 0 ELSE 1 END,
           CASE WHEN $2 <> '' AND account_id=$2 THEN 0 ELSE 1 END,
           CASE WHEN COALESCE(access_token_encrypted, '') <> '' OR COALESCE(access_token, '') <> '' THEN 0 ELSE 1 END,
           COALESCE(connected_at, created_at) DESC, created_at DESC LIMIT 1`,
        [userId, preferredAccountId]
      );
      socialAccountId = accountRes.rows[0]?.id ? String(accountRes.rows[0].id) : null;
    }
    return { accessToken: String(conn?.access_token || '').trim(), socialAccountId, hasConnection: Boolean(conn || socialAccountId), accountId: conn?.account_id || null, accountName: conn?.account_name || null, tokenData: conn?.token_data || {} };
  }

  // POST /social/linkedin/sync
  router.post('/social/linkedin/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
      // Renews the stored token first when LinkedIn issued a refresh token.
      await getPublishableSocialConnection(auth.userId, 'linkedin').catch(() => null);
      const result = await syncLinkedInAnalyticsForUser({ pool, decryptIntegrationSecret }, auth.userId);
      if (result.found === 0) return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
      return res.json({ success: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined });
    } catch (err) {
      logger.error('LinkedIn sync error:', err);
      return res.status(500).json({ success: false, error: 'LinkedIn sync failed' });
    }
  });

  // GET /social/linkedin/profile
  router.get('/social/linkedin/profile', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ profile: null, hasData: false });

      const { rows } = await pool.query(
        `SELECT sa.id, sa.account_name, sa.handle, sa.followers, lps.first_name, lps.last_name, lps.headline, lps.connections_count, lps.profile_picture_url, lps.synced_at
         FROM social_accounts sa LEFT JOIN linkedin_profile_stats lps ON lps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.connected = true AND sa.platform = 'linkedin'
         ORDER BY lps.synced_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );
      if (!rows.length) return res.json({ profile: null, hasData: false });
      const row = rows[0];
      return res.json({ hasData: row.first_name !== null || row.headline !== null, first_name: row.first_name ?? null, last_name: row.last_name ?? null, headline: row.headline ?? null, connections_count: row.connections_count !== null ? Number(row.connections_count) : 0, profile_picture_url: row.profile_picture_url ?? null, account_name: row.account_name ?? null, synced_at: row.synced_at ?? null });
    } catch (err) {
      logger.error('LinkedIn profile error:', err);
      return res.json({ profile: null, hasData: false });
    }
  });

  // GET /social/linkedin/posts
  router.get('/social/linkedin/posts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const q = req.query as any;
      const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
      const offset = Math.max(0, parseInt(q.offset || '0', 10));

      const postsRes = await pool.query(`SELECT lpm.*, sa.account_name FROM linkedin_post_metrics lpm JOIN social_accounts sa ON sa.id = lpm.social_account_id WHERE lpm.user_id = $1 ORDER BY COALESCE(lpm.created_at, lpm.fetched_at) DESC LIMIT $2 OFFSET $3`, [auth.userId, limit, offset]);
      const countRes = await pool.query(`SELECT COUNT(*) FROM linkedin_post_metrics WHERE user_id = $1`, [auth.userId]);
      return res.json({ success: true, posts: postsRes.rows, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: { total_posts: parseInt(countRes.rows[0]?.count || '0', 10) } });
    } catch (err) {
      logger.error('LinkedIn posts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch LinkedIn posts' });
    }
  });

  // GET /social/linkedin/organizations
  router.get('/social/linkedin/organizations', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const linkedInAuth = await getLinkedInAuthContext(auth.userId);
      if (!linkedInAuth.hasConnection) return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
      const token = linkedInAuth.accessToken;
      if (!token) return res.status(409).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect', reconnect: 'linkedin' });
      const scopeError = getLinkedInOrganizationScopeError(linkedInAuth.tokenData);
      if (scopeError) return res.status(400).json({ success: false, error: scopeError });

      const { personId } = await resolveLinkedInProfileIdentity(token, { accountId: linkedInAuth.accountId, accountName: linkedInAuth.accountName, tokenData: linkedInAuth.tokenData });
      if (!personId) return res.status(400).json({ success: false, error: 'Unable to resolve your LinkedIn profile id' });

      const { organizations } = await listLinkedInAdminOrganizations(token, personId, { allowedRoles: ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'ANALYST', 'CURATOR'] });
      return res.json({ success: true, organizations });
    } catch (err: any) {
      logger.error('LinkedIn organizations error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch organizations' });
    }
  });

  // POST /social/linkedin/company-sync
  router.post('/social/linkedin/company-sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const { organizationId } = req.body as any;
      if (!organizationId) return res.status(400).json({ success: false, error: 'organizationId required' });

      const linkedInAuth = await getLinkedInAuthContext(auth.userId);
      if (!linkedInAuth.hasConnection || !linkedInAuth.socialAccountId) return res.status(404).json({ success: false, error: 'No connected LinkedIn account found' });
      const token = linkedInAuth.accessToken;
      if (!token) return res.status(409).json({ success: false, error: 'LinkedIn access token missing or expired — please reconnect', reconnect: 'linkedin' });
      const scopeError = getLinkedInOrganizationScopeError(linkedInAuth.tokenData, { requireSocialRead: true });
      if (scopeError) return res.status(400).json({ success: false, error: scopeError });

      let synced = 0;
      const errors: string[] = [];
      const organizationUrn = `urn:li:organization:${organizationId}`;

      try {
        const [organizationDetails, followerCount, pageStatsResp, shareStatsResp, posts] = await Promise.all([
          fetchLinkedInOrganizationsByIds(token, [organizationId]),
          fetchLinkedInOrganizationNetworkSize(token, organizationUrn),
          axios.get('https://api.linkedin.com/rest/organizationPageStatistics', { params: { q: 'organization', organization: organizationUrn }, headers: getLinkedInRestHeaders(token), validateStatus: () => true, timeout: 15000 }),
          axios.get('https://api.linkedin.com/rest/organizationalEntityShareStatistics', { params: { q: 'organizationalEntity', organizationalEntity: organizationUrn }, headers: getLinkedInRestHeaders(token), validateStatus: () => true, timeout: 15000 }),
          fetchLinkedInPostsByAuthor(token, organizationUrn, 100),
        ]);

        const org = organizationDetails[0]?.raw || null;
        const orgName = organizationDetails[0]?.name || `LinkedIn Page ${organizationId}`;
        const logoUrl = organizationDetails[0]?.picture_url || null;
        const description = extractLinkedInOrganizationDescription(org);
        const shareElements = Array.isArray((shareStatsResp.data as any)?.elements) ? (shareStatsResp.data as any).elements : [];
        const aggregateShareStats = (shareElements[0]?.totalShareStatistics || {}) as Record<string, any>;

        await pool.query(
          `INSERT INTO linkedin_company_stats (id, user_id, social_account_id, organization_id, organization_name, follower_count, engagement_rate, posts_created, logo_url, description, raw_response, synced_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
           ON CONFLICT (social_account_id, organization_id) DO UPDATE SET
             organization_name = COALESCE(EXCLUDED.organization_name, linkedin_company_stats.organization_name),
             follower_count = COALESCE(EXCLUDED.follower_count, linkedin_company_stats.follower_count),
             engagement_rate = COALESCE(EXCLUDED.engagement_rate, linkedin_company_stats.engagement_rate),
             posts_created = COALESCE(EXCLUDED.posts_created, linkedin_company_stats.posts_created),
             logo_url = COALESCE(EXCLUDED.logo_url, linkedin_company_stats.logo_url),
             description = COALESCE(EXCLUDED.description, linkedin_company_stats.description),
             raw_response = EXCLUDED.raw_response, synced_at = NOW()`,
          [auth.userId, linkedInAuth.socialAccountId, organizationId, orgName, followerCount ?? 0, Number(aggregateShareStats?.engagement || 0), posts.length, logoUrl, description, JSON.stringify({ organization: org, followerCount, pageStatistics: pageStatsResp.status < 400 ? pageStatsResp.data : null, shareStatistics: shareStatsResp.status < 400 ? shareStatsResp.data : null })]
        );
        synced++;

        const postUrns = posts.map((post) => String(post?.id || '').trim()).filter(Boolean);
        const [socialMetadataByPostId, shareStatsByPostId] = await Promise.all([
          fetchLinkedInSocialMetadataBatch(token, postUrns),
          fetchLinkedInShareStatisticsForPosts(token, organizationUrn, postUrns),
        ]);

        for (const post of posts) {
          const postId = String(post?.id || '').trim();
          if (!postId) continue;
          const socialMetadata = socialMetadataByPostId[postId] || {};
          const postStats = shareStatsByPostId.get(postId) || {};
          const impressions = Number(postStats?.impressionCount || 0) || 0;
          const clicks = Number(postStats?.clickCount || 0) || 0;
          const likes = Number(postStats?.likeCount || sumLinkedInReactionCounts(socialMetadata) || 0) || 0;
          const comments = Number(postStats?.commentCount || socialMetadata?.commentSummary?.count || 0) || 0;
          const reposts = Number(postStats?.shareCount || socialMetadata?.repostSummary?.count || 0) || 0;
          const createdAt = (post?.publishedAt || post?.createdAt) ? new Date(post?.publishedAt || post?.createdAt).toISOString() : null;

          await pool.query(
            `INSERT INTO linkedin_company_posts (id, user_id, social_account_id, post_id, organization_id, text, media_type, impressions, likes, comments, reposts, clicks, engagement_rate, created_at, fetched_at, raw_data)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14::jsonb)
             ON CONFLICT (social_account_id, post_id) DO UPDATE SET
               text = EXCLUDED.text, media_type = EXCLUDED.media_type, impressions = EXCLUDED.impressions,
               likes = EXCLUDED.likes, comments = EXCLUDED.comments, reposts = EXCLUDED.reposts,
               clicks = EXCLUDED.clicks, engagement_rate = EXCLUDED.engagement_rate,
               created_at = COALESCE(EXCLUDED.created_at, linkedin_company_posts.created_at),
               fetched_at = NOW(), raw_data = EXCLUDED.raw_data`,
            [auth.userId, linkedInAuth.socialAccountId, postId, organizationId, extractLinkedInPostText(post), extractLinkedInPostMediaType(post), impressions, likes, comments, reposts, clicks, Number(postStats?.engagement || 0), createdAt, JSON.stringify({ post, socialMetadata, shareStatistics: postStats })]
          );
          synced++;
        }
      } catch (syncErr: any) { errors.push(`Company analytics sync failed: ${syncErr.message}`); }

      return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
    } catch (err) {
      logger.error('LinkedIn company sync error:', err);
      return res.status(500).json({ success: false, error: 'LinkedIn company sync failed' });
    }
  });

  // GET /social/linkedin/company-stats
  router.get('/social/linkedin/company-stats', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ stats: null, hasData: false });

      const { organization_id } = req.query as any;
      if (!organization_id) return res.json({ stats: null, hasData: false });

      const { rows } = await pool.query(
        `SELECT sa.id, sa.account_name, lcs.organization_id, lcs.organization_name, lcs.follower_count, lcs.posts_created, lcs.engagement_rate, lcs.logo_url, lcs.synced_at
         FROM social_accounts sa LEFT JOIN linkedin_company_stats lcs ON lcs.social_account_id = sa.id
         WHERE sa.user_id = $1 AND lcs.organization_id = $2 AND sa.connected = true AND sa.platform = 'linkedin' LIMIT 1`,
        [auth.userId, organization_id]
      );
      if (!rows.length) return res.json({ stats: null, hasData: false });
      const row = rows[0];
      return res.json({ hasData: row.follower_count !== null || row.posts_created !== null, organization_id: row.organization_id, organization_name: row.organization_name ?? null, follower_count: row.follower_count !== null ? Number(row.follower_count) : 0, posts_created: row.posts_created !== null ? Number(row.posts_created) : 0, engagement_rate: row.engagement_rate !== null ? Number(row.engagement_rate) : 0, logo_url: row.logo_url ?? null, synced_at: row.synced_at ?? null });
    } catch (err) {
      logger.error('LinkedIn company stats error:', err);
      return res.json({ stats: null, hasData: false });
    }
  });

  // GET /social/linkedin/company-posts
  router.get('/social/linkedin/company-posts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const { organization_id, limit = '50', offset = '0' } = req.query as any;
      if (!organization_id) return res.status(400).json({ success: false, error: 'organization_id required' });

      const pageLimit = Math.min(500, Math.max(1, parseInt(limit, 10)));
      const pageOffset = Math.max(0, parseInt(offset, 10));

      const postsRes = await pool.query(`SELECT lcp.*, sa.account_name FROM linkedin_company_posts lcp JOIN social_accounts sa ON sa.id = lcp.social_account_id WHERE lcp.user_id = $1 AND lcp.organization_id = $2 ORDER BY lcp.created_at DESC NULLS LAST LIMIT $3 OFFSET $4`, [auth.userId, organization_id, pageLimit, pageOffset]);
      const countRes = await pool.query(`SELECT COUNT(*) FROM linkedin_company_posts WHERE user_id = $1 AND organization_id = $2`, [auth.userId, organization_id]);
      const summaryRes = await pool.query(`SELECT COUNT(*) AS total_posts, COALESCE(SUM(impressions), 0) AS total_impressions, COALESCE(SUM(likes), 0) AS total_likes, COALESCE(SUM(comments), 0) AS total_comments, COALESCE(SUM(clicks), 0) AS total_clicks, CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(likes + comments)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2) ELSE 0 END AS avg_engagement_rate FROM linkedin_company_posts WHERE user_id = $1 AND organization_id = $2`, [auth.userId, organization_id]);

      return res.json({ success: true, posts: postsRes.rows, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: summaryRes.rows[0] || {} });
    } catch (err) {
      logger.error('LinkedIn company posts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch company posts' });
    }
  });
}
