import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import type { SyncHelpers } from './syncHelpers.ts';

export function registerInstagramRoutes(router: Router, { requireAuth, pool, getPublishableSocialConnection }: AnalyticsDeps, syncHelpers: SyncHelpers): void {
  // POST /social/instagram/sync
  router.post('/social/instagram/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const accountRes = await pool.query(
        `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
         FROM social_accounts WHERE user_id=$1 AND platform='instagram' AND connected=true`,
        [auth.userId]
      );
      if (accountRes.rows.length === 0) return res.status(404).json({ success: false, error: 'No connected Instagram account found' });

      // Renews a direct Instagram Login token before it lapses.
      const conn = await getPublishableSocialConnection(auth.userId, 'instagram').catch(() => null);
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(409).json({ success: false, error: 'Instagram access expired or was revoked — reconnect Instagram to sync analytics.' });
      }
      let synced = 0;
      const errors: string[] = [];
      for (const acct of accountRes.rows as any[]) {
        const result = await syncHelpers.syncInstagramAnalyticsAccount({
          userId: auth.userId,
          account: { ...acct, access_token: conn.access_token, access_token_encrypted: null },
          days: 30,
        });
        synced += result.synced;
        errors.push(...result.errors);
      }
      return res.json({ success: true, synced, errors: errors.length > 0 ? errors : undefined });
    } catch (err) {
      logger.error('Instagram sync error:', err);
      return res.status(500).json({ success: false, error: 'Instagram sync failed' });
    }
  });

  // GET /social/instagram/profile
  router.get('/social/instagram/profile', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ profile: null, hasData: false });

      const { rows } = await pool.query(
        `SELECT sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers, sa.profile_image, sa.token_data,
           sps.followers, sps.following, sps.posts_count, sps.bio, sps.is_verified, sps.synced_at
         FROM social_accounts sa
         LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.platform = 'instagram' AND sa.connected = true
         ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );
      if (!rows.length) return res.json({ profile: null, hasData: false });

      const row: any = rows[0];
      const tokenData = row.token_data || {};
      const followers = row.followers ?? row.sa_followers ?? null;
      return res.json({
        hasData: followers !== null || row.posts_count !== null || Boolean(row.account_name),
        followers: followers !== null ? Number(followers) : null,
        following: row.following !== null ? Number(row.following) : null,
        posts_count: row.posts_count !== null ? Number(row.posts_count) : null,
        bio: row.bio ?? null, is_verified: row.is_verified === true,
        account_name: row.account_name ?? tokenData?.instagramName ?? null,
        handle: row.handle ?? tokenData?.instagramUsername ?? null,
        picture_url: row.profile_image ?? tokenData?.profilePictureUrl ?? null,
        account_type: tokenData?.accountType ?? null, page_name: tokenData?.pageName ?? null,
        page_id: tokenData?.pageId ?? null, website: tokenData?.website ?? null, synced_at: row.synced_at ?? null,
      });
    } catch (err) {
      logger.error('Instagram profile error:', err);
      return res.json({ profile: null, hasData: false });
    }
  });

  // GET /social/instagram/posts
  router.get('/social/instagram/posts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const q = req.query as any;
      const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
      const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
      const offset = Math.max(0, parseInt(q.offset || '0', 10));
      const accountId = q.account_id ? String(q.account_id).trim() : '';
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const params: any[] = [auth.userId, sinceDate];
      let accountFilter = '';
      if (accountId) { params.push(accountId); accountFilter = `AND sm.social_account_id = $${params.length}`; }
      params.push(limit, offset);

      const postsRes = await pool.query(
        `SELECT sm.*, sa.account_name, sa.handle FROM social_metrics sm
         JOIN social_accounts sa ON sa.id = sm.social_account_id
         WHERE sm.user_id = $1 AND sm.platform = 'instagram'
           AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
           ${accountFilter}
         ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM social_metrics sm WHERE sm.user_id = $1 AND sm.platform = 'instagram' AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${accountFilter}`,
        params.slice(0, params.length - 2)
      );
      const summaryRes = await pool.query(
        `SELECT COUNT(*) AS total_posts,
           COALESCE(SUM(likes), 0) AS total_likes, COALESCE(SUM(comments), 0) AS total_comments,
           COALESCE(SUM(shares), 0) AS total_shares, COALESCE(SUM(saves), 0) AS total_saves,
           COALESCE(SUM(impressions), 0) AS total_impressions, COALESCE(SUM(reach), 0) AS total_reach,
           COALESCE(SUM(engagement), 0) AS total_engagement,
           CASE WHEN COALESCE(SUM(impressions), 0) > 0
                THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2)
                ELSE 0 END AS avg_engagement_rate
         FROM social_metrics sm WHERE sm.user_id = $1 AND sm.platform = 'instagram'
           AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${accountFilter}`,
        params.slice(0, params.length - 2)
      );

      const posts = postsRes.rows.map((row: any) => {
        const raw = row.raw_data || {};
        const media = raw?.media || {};
        const account = raw?.account || {};
        return { ...row, media_id: row.platform_post_id, caption: media?.caption || null, media_type: media?.media_type || null, media_product_type: media?.media_product_type || null, media_url: media?.media_url || null, thumbnail_url: media?.thumbnail_url || null, permalink: media?.permalink || null, instagram_username: account?.instagramUsername || row.handle || null };
      });

      return res.json({ success: true, posts, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: summaryRes.rows[0] || { total_posts: 0, total_likes: 0, total_comments: 0, total_shares: 0, total_saves: 0, total_impressions: 0, total_reach: 0, total_engagement: 0, avg_engagement_rate: 0 }, days });
    } catch (err) {
      logger.error('Instagram posts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Instagram posts' });
    }
  });
}
