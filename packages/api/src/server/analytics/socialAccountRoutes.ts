import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';

export function registerSocialAccountRoutes(router: Router, { requireAuth, pool }: AnalyticsDeps): void {
  // GET /analytics/social/accounts
  router.get('/analytics/social/accounts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const result = await pool.query(
        `SELECT
           sa.id, sa.platform,
           COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
           sa.handle, sa.connected_at,
           COALESCE(sps.followers, sa.followers, 0)::bigint  AS followers,
           COALESCE(sps.following,    0)::bigint             AS following_count,
           COALESCE(sps.posts_count,  0)::bigint             AS video_count,
           COALESCE(sps.total_likes,  0)::bigint             AS total_likes_count,
           sps.bio, sps.is_verified, sps.synced_at,
           COALESCE(SUM(sm.reach),       0)::bigint AS total_reach,
           COALESCE(SUM(sm.impressions), 0)::bigint AS total_impressions,
           COALESCE(SUM(sm.engagement),  0)::bigint AS total_engagement,
           COALESCE(SUM(sm.likes),       0)::bigint AS total_likes,
           COALESCE(SUM(sm.comments),    0)::bigint AS total_comments,
           COALESCE(SUM(sm.shares),      0)::bigint AS total_shares,
           COUNT(sm.id)::int AS posts_synced,
           CASE WHEN SUM(sm.impressions) > 0
             THEN ROUND(SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_accounts sa
         LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
         LEFT JOIN social_metrics sm ON sm.social_account_id = sa.id
           AND sm.user_id = $1
           AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
         WHERE sa.user_id = $1 AND sa.connected = true
         GROUP BY sa.id, sa.platform, sa.account_name, sa.handle, sa.followers, sa.connected_at,
                  sps.followers, sps.following, sps.posts_count, sps.total_likes,
                  sps.bio, sps.is_verified, sps.synced_at
         ORDER BY sa.platform`,
        [auth.userId, since]
      );
      return res.json({ success: true, accounts: result.rows, days });
    } catch (err) {
      logger.error('Social accounts analytics error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch account analytics' });
    }
  });

  // GET /analytics/social/account/:accountId
  router.get('/analytics/social/account/:accountId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const { accountId } = req.params;
      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const acctResult = await pool.query(
        `SELECT sa.id, sa.platform,
           COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
           sa.handle, sa.connected_at,
           COALESCE(sps.followers, sa.followers, 0)::bigint AS followers,
           COALESCE(sps.following,   0)::bigint AS following_count,
           COALESCE(sps.posts_count, 0)::bigint AS video_count,
           COALESCE(sps.total_likes, 0)::bigint AS total_likes_count,
           sps.bio, sps.is_verified, sps.synced_at
         FROM social_accounts sa
         LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
         WHERE sa.id = $1 AND sa.user_id = $2 AND sa.connected = true`,
        [accountId, auth.userId]
      );
      if (acctResult.rows.length === 0) return res.status(404).json({ success: false, error: 'Account not found' });
      const account = acctResult.rows[0];

      const [summaryResult, trendResult, topPostsResult] = await Promise.all([
        pool.query(
          `SELECT
             COALESCE(SUM(reach), 0)::bigint AS total_reach,
             COALESCE(SUM(impressions), 0)::bigint AS total_impressions,
             COALESCE(SUM(engagement), 0)::bigint AS total_engagement,
             COALESCE(SUM(likes), 0)::bigint AS total_likes,
             COALESCE(SUM(comments), 0)::bigint AS total_comments,
             COALESCE(SUM(shares), 0)::bigint AS total_shares,
             COUNT(*)::int AS posts_count,
             CASE WHEN SUM(impressions) > 0
               THEN ROUND(SUM(engagement)::numeric / NULLIF(SUM(impressions), 0) * 100, 2)
               ELSE 0 END AS engagement_rate
           FROM social_metrics
           WHERE social_account_id = $1 AND user_id = $2
             AND (posted_at >= $3 OR posted_at IS NULL)`,
          [accountId, auth.userId, since]
        ),
        pool.query(
          `SELECT DATE(posted_at) AS date,
             COALESCE(SUM(reach), 0)::bigint AS reach,
             COALESCE(SUM(impressions), 0)::bigint AS impressions,
             COALESCE(SUM(engagement), 0)::bigint AS engagement,
             COALESCE(SUM(likes), 0)::bigint AS likes,
             COALESCE(SUM(comments), 0)::bigint AS comments,
             COUNT(*)::int AS posts,
             CASE WHEN SUM(impressions) > 0
               THEN ROUND(SUM(engagement)::numeric / NULLIF(SUM(impressions), 0) * 100, 2)
               ELSE 0 END AS engagement_rate
           FROM social_metrics
           WHERE social_account_id = $1 AND user_id = $2
             AND posted_at IS NOT NULL AND posted_at >= $3
           GROUP BY DATE(posted_at) ORDER BY date`,
          [accountId, auth.userId, since]
        ),
        pool.query(
          `SELECT sm.platform_post_id, sm.post_id,
             COALESCE(bp.title, sm.raw_data->>'title', 'Post ' || LEFT(sm.platform_post_id, 8)) AS title,
             COALESCE(sm.likes, 0)::bigint AS likes,
             COALESCE(sm.comments, 0)::bigint AS comments,
             COALESCE(sm.shares, 0)::bigint AS shares,
             COALESCE(sm.impressions, 0)::bigint AS impressions,
             COALESCE(sm.reach, 0)::bigint AS reach,
             COALESCE(sm.engagement, 0)::bigint AS engagement,
             sm.posted_at,
             CASE WHEN sm.impressions > 0
               THEN ROUND(sm.engagement::numeric / NULLIF(sm.impressions, 0) * 100, 2)
               ELSE 0 END AS engagement_rate
           FROM social_metrics sm
           LEFT JOIN blog_posts bp ON bp.id = sm.post_id
           WHERE sm.social_account_id = $1 AND sm.user_id = $2
             AND (sm.posted_at >= $3 OR sm.posted_at IS NULL)
           ORDER BY sm.engagement DESC NULLS LAST, sm.likes DESC NULLS LAST LIMIT 10`,
          [accountId, auth.userId, since]
        ),
      ]);

      logger.info('[TikTok dashboard] account row followers:', account.followers, 'following_count:', account.following_count, 'video_count:', account.video_count);
      return res.json({
        success: true,
        account: {
          id: account.id, platform: account.platform, account_name: account.account_name,
          handle: account.handle, followers: parseInt(String(account.followers || '0')),
          following_count: parseInt(String(account.following_count || '0')),
          video_count: parseInt(String(account.video_count || '0')),
          total_likes_count: parseInt(String(account.total_likes_count || '0')),
          bio: account.bio || null, is_verified: Boolean(account.is_verified), connected_at: account.connected_at,
        },
        summary: summaryResult.rows[0] || {},
        trend: trendResult.rows,
        top_posts: topPostsResult.rows,
        days,
      });
    } catch (err) {
      logger.error('Account analytics error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch account analytics' });
    }
  });

  // GET /analytics/social/comparison
  router.get('/analytics/social/comparison', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const result = await pool.query(
        `SELECT sa.id, sa.platform,
           COALESCE(sa.account_name, sa.handle, sa.platform) AS account_name,
           sa.handle,
           COALESCE(sa.followers, 0)::bigint AS followers,
           COALESCE(SUM(sm.reach), 0)::bigint AS total_reach,
           COALESCE(SUM(sm.impressions), 0)::bigint AS total_impressions,
           COALESCE(SUM(sm.engagement), 0)::bigint AS total_engagement,
           COALESCE(SUM(sm.likes), 0)::bigint AS total_likes,
           COUNT(sm.id)::int AS posts_synced,
           CASE WHEN SUM(sm.impressions) > 0
             THEN ROUND(SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0) * 100, 2)
             ELSE 0 END AS engagement_rate
         FROM social_accounts sa
         LEFT JOIN social_metrics sm ON sm.social_account_id = sa.id
           AND sm.user_id = $1
           AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
         WHERE sa.user_id = $1 AND sa.connected = true
         GROUP BY sa.id, sa.platform, sa.account_name, sa.handle, sa.followers
         ORDER BY SUM(sm.engagement) DESC NULLS LAST`,
        [auth.userId, since]
      );

      const accounts: any[] = result.rows;
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const byFollowers = [...accounts].sort((a, b) => parseInt(b.followers) - parseInt(a.followers));
      const byEngagement = [...accounts].sort((a, b) => parseFloat(b.engagement_rate) - parseFloat(a.engagement_rate));
      const byReach = [...accounts].sort((a, b) => parseInt(b.total_reach) - parseInt(a.total_reach));

      const insights: Array<{ type: string; title: string; description: string; winner: string }> = [];
      if (accounts.length >= 2) {
        const topF = byFollowers[0];
        if (parseInt(topF.followers) > 0) insights.push({ type: 'followers_leader', title: 'Largest Audience', winner: topF.platform, description: `${cap(topF.platform)} has your largest audience with ${Number(topF.followers).toLocaleString()} followers.` });
        const topE = byEngagement[0];
        if (parseFloat(topE.engagement_rate) > 0) insights.push({ type: 'engagement_leader', title: 'Highest Engagement', winner: topE.platform, description: `${cap(topE.platform)} leads engagement at ${parseFloat(topE.engagement_rate).toFixed(2)}% over the last ${days} days.` });
        const topR = byReach[0];
        if (parseInt(topR.total_reach) > 0) insights.push({ type: 'reach_leader', title: 'Top Reach', winner: topR.platform, description: `${cap(topR.platform)} reached the most people — ${Number(topR.total_reach).toLocaleString()} in the last ${days} days.` });
      }

      return res.json({
        success: true, accounts,
        rankings: {
          by_followers: byFollowers.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseInt(a.followers), rank: i + 1 })),
          by_engagement: byEngagement.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseFloat(a.engagement_rate), rank: i + 1 })),
          by_reach: byReach.map((a, i) => ({ id: a.id, platform: a.platform, account_name: a.account_name, value: parseInt(a.total_reach), rank: i + 1 })),
        },
        insights, days,
      });
    } catch (err) {
      logger.error('Comparison analytics error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch comparison analytics' });
    }
  });
}
