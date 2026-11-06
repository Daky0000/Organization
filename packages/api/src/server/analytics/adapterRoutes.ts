import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import { analyticsFmtDate } from './helpers.ts';

export function registerAdapterRoutes(router: Router, { requireAuth, pool }: AnalyticsDeps): void {
  // GET /analytics/overview
  router.get('/analytics/overview', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const sinceIso = since.toISOString();
      const prevSinceIso = new Date(since.getTime() - days * 86400000).toISOString();

      const [postsRes, metricsRes, platformRes, trendsRes, prevMetricsRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) as count FROM publishing_logs WHERE user_id=$1 AND status IN ('success','published') AND created_at >= $2`, [auth.userId, sinceIso]),
        pool.query(`SELECT COALESCE(SUM(reach),0) as total_reach, COALESCE(SUM(impressions),0) as total_impressions, COALESCE(SUM(engagement),0) as total_engagement FROM social_metrics WHERE user_id=$1`, [auth.userId]),
        pool.query(`SELECT platform, COALESCE(SUM(reach),0) as reach, COALESCE(SUM(impressions),0) as impressions, COALESCE(SUM(engagement),0) as engagement FROM social_metrics WHERE user_id=$1 GROUP BY platform`, [auth.userId]),
        pool.query(`SELECT DATE(posted_at) as date, COALESCE(SUM(engagement),0) as total_engagement, COALESCE(SUM(reach),0) as total_reach, COALESCE(SUM(impressions),0) as total_impressions FROM social_metrics WHERE user_id=$1 AND posted_at >= $2 GROUP BY DATE(posted_at) ORDER BY date`, [auth.userId, sinceIso]),
        pool.query(`SELECT COALESCE(SUM(engagement),0) as total_engagement FROM social_metrics WHERE user_id=$1 AND posted_at < $2 AND posted_at >= $3`, [auth.userId, sinceIso, prevSinceIso]),
      ]);

      const totalPosts = parseInt(postsRes.rows[0]?.count || '0');
      const totalReach = parseInt(metricsRes.rows[0]?.total_reach || '0');
      const totalImpressions = parseInt(metricsRes.rows[0]?.total_impressions || '0');
      const totalEngagement = parseInt(metricsRes.rows[0]?.total_engagement || '0');
      const engagementRate = totalImpressions > 0 ? parseFloat(((totalEngagement / totalImpressions) * 100).toFixed(2)) : 0;
      const prevEngagement = parseInt(prevMetricsRes.rows[0]?.total_engagement || '0');
      const growthRate = prevEngagement > 0 ? parseFloat(((totalEngagement - prevEngagement) / prevEngagement * 100).toFixed(2)) : null;

      const platforms = (platformRes.rows as any[]).map((r) => {
        const reach = parseInt(r.reach) || 0;
        const impressions = parseInt(r.impressions) || 0;
        const engagement = parseInt(r.engagement) || 0;
        return { platform: r.platform, reach: reach || null, impressions: impressions || null, engagement: engagement || null, engagementRate: impressions > 0 ? parseFloat((engagement / impressions * 100).toFixed(2)) : null };
      });

      const trends = (trendsRes.rows as any[]).map((r) => ({
        date: r.date instanceof Date ? analyticsFmtDate(r.date) : String(r.date).slice(0, 10),
        totalEngagement: parseInt(r.total_engagement) || 0,
        totalReach: parseInt(r.total_reach) || 0,
        totalImpressions: parseInt(r.total_impressions) || 0,
      }));

      return res.json({
        success: true,
        data: {
          dateRange: { start: analyticsFmtDate(since), end: analyticsFmtDate(new Date()) },
          summary: { totalPosts, totalReach, totalImpressions, totalEngagement, engagementRate, growthRate },
          platforms,
          topPlatforms: [...platforms].filter((p) => p.engagement && p.engagement > 0).sort((a, b) => (b.engagement || 0) - (a.engagement || 0)).slice(0, 5).map((p) => ({ platform: p.platform, engagement: p.engagement || 0 })),
          trends: trends.length > 0 ? trends : null,
        },
      });
    } catch (err) {
      logger.error('Analytics overview error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch analytics overview' });
    }
  });

  // GET /analytics/platforms
  router.get('/analytics/platforms', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const [accountsRes, metricsRes] = await Promise.all([
        pool.query(`SELECT platform, account_name, handle FROM social_accounts WHERE user_id=$1 AND connected=true`, [auth.userId]),
        pool.query(`SELECT platform, COALESCE(SUM(reach),0) as reach, COALESCE(SUM(impressions),0) as impressions, COALESCE(SUM(engagement),0) as engagement, COALESCE(SUM(likes),0) as likes FROM social_metrics WHERE user_id=$1 AND (posted_at >= $2 OR posted_at IS NULL) GROUP BY platform`, [auth.userId, sinceIso]),
      ]);

      const metricsMap = new Map<string, any>();
      for (const r of metricsRes.rows as any[]) metricsMap.set(r.platform, r);

      return res.json({
        success: true,
        data: (accountsRes.rows as any[]).map((r) => {
          const m = metricsMap.get(r.platform) || {};
          return { platform: r.platform, accountName: r.account_name || r.handle || null, metrics: { reach: parseInt(m.reach || '0') || null, impressions: parseInt(m.impressions || '0') || null, engagement: parseInt(m.engagement || '0') || null, likes: parseInt(m.likes || '0') || null } };
        }),
      });
    } catch (err) {
      logger.error('Analytics platforms error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch platform metrics' });
    }
  });

  // GET /analytics/posts
  router.get('/analytics/posts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || '10'))));
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const result = await pool.query(
        `SELECT sm.platform, sm.platform_post_id, sm.post_id, sm.likes, sm.comments, sm.shares, sm.impressions, sm.reach, sm.engagement, sm.posted_at, sa.account_name, sa.handle
         FROM social_metrics sm LEFT JOIN social_accounts sa ON sa.id = sm.social_account_id
         WHERE sm.user_id=$1 AND (sm.posted_at >= $2 OR sm.posted_at IS NULL)
         ORDER BY sm.engagement DESC NULLS LAST, sm.likes DESC NULLS LAST LIMIT $3`,
        [auth.userId, sinceIso, limit]
      );

      return res.json({
        success: true,
        data: (result.rows as any[]).map((r) => ({ id: r.platform_post_id || r.post_id, platform: r.platform, accountName: r.account_name || r.handle || null, likes: parseInt(r.likes || '0'), comments: parseInt(r.comments || '0'), shares: parseInt(r.shares || '0'), impressions: parseInt(r.impressions || '0'), reach: parseInt(r.reach || '0'), engagement: parseInt(r.engagement || '0'), postedAt: r.posted_at || null })),
      });
    } catch (err) {
      logger.error('Analytics posts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch top posts' });
    }
  });

  // GET /analytics/trending
  router.get('/analytics/trending', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'))));
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const [trendsRes, topPostsRes, topPlatformsRes] = await Promise.all([
        pool.query(`SELECT DATE(posted_at) as date, COALESCE(SUM(engagement),0) as engagement, COALESCE(SUM(reach),0) as reach, COALESCE(SUM(impressions),0) as impressions FROM social_metrics WHERE user_id=$1 AND posted_at >= $2 GROUP BY DATE(posted_at) ORDER BY date`, [auth.userId, sinceIso]),
        pool.query(`SELECT platform, platform_post_id, likes, comments, shares, engagement, posted_at FROM social_metrics WHERE user_id=$1 AND posted_at >= $2 ORDER BY engagement DESC NULLS LAST LIMIT 5`, [auth.userId, sinceIso]),
        pool.query(`SELECT platform, COALESCE(SUM(engagement),0) as engagement FROM social_metrics WHERE user_id=$1 AND posted_at >= $2 GROUP BY platform ORDER BY engagement DESC LIMIT 5`, [auth.userId, sinceIso]),
      ]);

      const fmtDate = (r: any) => r.date instanceof Date ? analyticsFmtDate(r.date) : String(r.date).slice(0, 10);
      return res.json({
        success: true,
        data: {
          engagementTrend: (trendsRes.rows as any[]).map((r) => ({ date: fmtDate(r), value: parseInt(r.engagement) || 0 })),
          reachTrend: (trendsRes.rows as any[]).map((r) => ({ date: fmtDate(r), value: parseInt(r.reach) || 0 })),
          impressionsTrend: (trendsRes.rows as any[]).map((r) => ({ date: fmtDate(r), value: parseInt(r.impressions) || 0 })),
          topPosts: topPostsRes.rows,
          topPlatforms: (topPlatformsRes.rows as any[]).map((r) => ({ platform: r.platform, engagement: parseInt(r.engagement) || 0 })),
        },
      });
    } catch (err) {
      logger.error('Analytics trending error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch trends' });
    }
  });

  // GET /analytics/comparison
  router.get('/analytics/comparison', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

      const [thisRes, lastRes] = await Promise.all([
        pool.query(`SELECT COALESCE(SUM(engagement),0) as engagement, COALESCE(SUM(reach),0) as reach, COALESCE(SUM(impressions),0) as impressions, COUNT(*) as posts FROM social_metrics WHERE user_id=$1 AND posted_at >= $2`, [auth.userId, thisMonthStart]),
        pool.query(`SELECT COALESCE(SUM(engagement),0) as engagement, COALESCE(SUM(reach),0) as reach, COALESCE(SUM(impressions),0) as impressions, COUNT(*) as posts FROM social_metrics WHERE user_id=$1 AND posted_at >= $2 AND posted_at <= $3`, [auth.userId, lastMonthStart, lastMonthEnd]),
      ]);

      const thisMonth = { engagement: parseInt(thisRes.rows[0]?.engagement || '0'), reach: parseInt(thisRes.rows[0]?.reach || '0'), impressions: parseInt(thisRes.rows[0]?.impressions || '0'), posts: parseInt(thisRes.rows[0]?.posts || '0') };
      const lastMonth = { engagement: parseInt(lastRes.rows[0]?.engagement || '0'), reach: parseInt(lastRes.rows[0]?.reach || '0'), impressions: parseInt(lastRes.rows[0]?.impressions || '0'), posts: parseInt(lastRes.rows[0]?.posts || '0') };
      const pct = (a: number, b: number) => b > 0 ? parseFloat(((a - b) / b * 100).toFixed(2)) : null;

      return res.json({ success: true, data: { thisMonth, lastMonth, change: { engagement: pct(thisMonth.engagement, lastMonth.engagement), reach: pct(thisMonth.reach, lastMonth.reach), impressions: pct(thisMonth.impressions, lastMonth.impressions), posts: pct(thisMonth.posts, lastMonth.posts) } } });
    } catch (err) {
      logger.error('Analytics comparison error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch comparison data' });
    }
  });

  // POST /analytics/refresh
  router.post('/analytics/refresh', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      await pool.query(
        `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at)
         VALUES (gen_random_uuid()::text, $1, 'last_synced', $2::jsonb, NOW() + INTERVAL '1 year')
         ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
        [auth.userId, JSON.stringify({ lastSyncedAt: new Date().toISOString() })]
      );
      return res.json({ success: true, message: 'Analytics refresh queued. Sync your social accounts to fetch latest data.' });
    } catch (err) {
      logger.error('Analytics refresh error:', err);
      return res.status(500).json({ success: false, error: 'Failed to refresh analytics' });
    }
  });
}
