import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import type { SyncHelpers } from './syncHelpers.ts';

export function registerPinterestRoutes(router: Router, { requireAuth, pool, getPublishableSocialConnection }: AnalyticsDeps, syncHelpers: SyncHelpers): void {
  // POST /social/pinterest/sync
  router.post('/social/pinterest/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const accountRes = await pool.query(
        `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
         FROM social_accounts
         WHERE user_id=$1 AND platform='pinterest' AND connected=true AND account_type='profile'
         ORDER BY connected_at DESC NULLS LAST, created_at DESC NULLS LAST
         LIMIT 1`,
        [auth.userId]
      );
      if (accountRes.rows.length === 0) return res.status(404).json({ success: false, error: 'No connected Pinterest account found' });

      // Pinterest access tokens last 30 days; renew before syncing.
      const conn = await getPublishableSocialConnection(auth.userId, 'pinterest').catch(() => null);
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(409).json({ success: false, error: 'Pinterest access expired or was revoked — reconnect Pinterest to sync analytics.' });
      }
      const result = await syncHelpers.syncPinterestAnalyticsAccount({
        userId: auth.userId,
        account: { ...accountRes.rows[0], access_token: conn.access_token, access_token_encrypted: null },
        days: 30,
        maxPins: 250,
      });
      return res.json({ success: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined });
    } catch (err) {
      logger.error('Pinterest sync error:', err);
      return res.status(500).json({ success: false, error: 'Pinterest sync failed' });
    }
  });

  // GET /social/pinterest/profile
  router.get('/social/pinterest/profile', async (req: Request, res: Response) => {
    const empty = { hasData: false, followers: null, following: null, posts_count: null, bio: null, account_name: null, handle: null, picture_url: null, website: null, monthly_views: null, synced_at: null };
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json(empty);

      const { rows } = await pool.query(
        `SELECT sa.id, sa.account_id, sa.account_name, sa.handle, sa.followers AS sa_followers, sa.profile_image,
           sps.followers, sps.following, sps.posts_count, sps.bio, sps.raw_response, sps.synced_at
         FROM social_accounts sa
         LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.platform = 'pinterest' AND sa.account_type = 'profile' AND sa.connected = true
         ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );
      if (!rows.length) return res.json(empty);

      const row: any = rows[0];
      const raw = row.raw_response || {};
      const followers = row.followers ?? row.sa_followers ?? null;

      return res.json({
        hasData: followers !== null || row.posts_count !== null || Boolean(row.account_name) || Boolean(row.handle),
        followers: followers !== null ? Number(followers) : null,
        following: row.following !== null ? Number(row.following) : null,
        posts_count: row.posts_count !== null ? Number(row.posts_count) : raw?.pin_count != null ? Number(raw.pin_count) : null,
        bio: row.bio ?? null,
        account_name: row.account_name ?? raw?.business_name ?? raw?.username ?? null,
        handle: row.handle ?? raw?.username ?? null,
        picture_url: row.profile_image ?? raw?.profile_image ?? null,
        website: raw?.website_url ?? null,
        monthly_views: raw?.monthly_views != null ? Number(raw.monthly_views) : null,
        synced_at: row.synced_at ?? null,
      });
    } catch (err) {
      logger.error('Pinterest profile error:', err);
      return res.json(empty);
    }
  });

  // GET /social/pinterest/pins
  router.get('/social/pinterest/pins', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const q = req.query as any;
      const days = Math.min(365, Math.max(1, parseInt(q.days || '90', 10)));
      const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
      const offset = Math.max(0, parseInt(q.offset || '0', 10));
      const accountId = q.account_id ? String(q.account_id).trim() : '';
      const boardId = q.board_id ? String(q.board_id).trim() : '';
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const params: any[] = [auth.userId, sinceDate];
      let extraFilter = '';
      if (accountId) { params.push(accountId); extraFilter += `AND sm.social_account_id = $${params.length}\n`; }
      if (boardId) { params.push(boardId); extraFilter += `AND (sm.raw_data->'pin'->>'board_id') = $${params.length}\n`; }
      const baseParams = params.slice();
      params.push(limit, offset);

      const pinsRes = await pool.query(
        `SELECT sm.*, sa.account_name, sa.handle FROM social_metrics sm
         JOIN social_accounts sa ON sa.id = sm.social_account_id
         WHERE sm.user_id = $1 AND sm.platform = 'pinterest'
           AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${extraFilter}
         ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM social_metrics sm WHERE sm.user_id = $1 AND sm.platform = 'pinterest' AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${extraFilter}`,
        baseParams
      );
      const summaryRes = await pool.query(
        `SELECT COUNT(*) AS total_pins,
           COALESCE(SUM(impressions), 0) AS total_impressions,
           COALESCE(SUM(clicks), 0) AS total_outbound_clicks,
           COALESCE(SUM(saves), 0) AS total_saves,
           COALESCE(SUM(likes), 0) AS total_reactions,
           COALESCE(SUM(comments), 0) AS total_comments,
           COALESCE(SUM(engagement), 0) AS total_engagement,
           COALESCE(SUM(CASE WHEN (raw_data->'metrics'->>'pin_click') ~ '^\\d+(\\.\\d+)?$' THEN (raw_data->'metrics'->>'pin_click')::numeric ELSE 0 END), 0) AS total_pin_clicks,
           CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2) ELSE 0 END AS avg_engagement_rate
         FROM social_metrics sm WHERE sm.user_id = $1 AND sm.platform = 'pinterest' AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${extraFilter}`,
        baseParams
      );

      const pins = pinsRes.rows.map((row: any) => {
        const raw = row.raw_data || {};
        const pin = raw?.pin || {};
        const metrics = raw?.metrics || {};
        const images = pin?.media?.images || {};
        const imageUrl = images?.['400x300']?.url || images?.['150x150']?.url || images?.['600x']?.url || null;
        return { ...row, pin_id: row.platform_post_id, title: pin?.title ?? null, description: pin?.description ?? null, link: pin?.link ?? null, board_id: pin?.board_id ?? null, creative_type: pin?.creative_type ?? null, media_url: imageUrl, pin_clicks: metrics?.pin_click ?? null, outbound_clicks: metrics?.outbound_clicks ?? row.clicks ?? null, saves_count: metrics?.saves ?? row.saves ?? null, created_at: row.posted_at ?? pin?.created_at ?? null };
      });

      return res.json({ success: true, pins, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: summaryRes.rows[0] || { total_pins: 0, total_impressions: 0, total_outbound_clicks: 0, total_saves: 0, total_reactions: 0, total_comments: 0, total_engagement: 0, total_pin_clicks: 0, avg_engagement_rate: 0 }, days });
    } catch (err) {
      logger.error('Pinterest pins error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest pins' });
    }
  });

  // GET /social/pinterest/boards-performance
  router.get('/social/pinterest/boards-performance', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const q = req.query as any;
      const days = Math.min(365, Math.max(1, parseInt(q.days || '90', 10)));
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const { rows } = await pool.query(
        `SELECT COALESCE(sm.raw_data->'pin'->>'board_id', '') AS board_id,
           MAX(sa_board.account_name) AS board_name,
           COUNT(*)::int AS total_pins,
           COALESCE(SUM(sm.impressions), 0) AS total_impressions,
           COALESCE(SUM(sm.clicks), 0) AS total_outbound_clicks,
           COALESCE(SUM(sm.saves), 0) AS total_saves,
           COALESCE(SUM(sm.likes), 0) AS total_reactions,
           COALESCE(SUM(sm.comments), 0) AS total_comments,
           COALESCE(SUM(sm.engagement), 0) AS total_engagement,
           MAX(COALESCE(sm.posted_at, sm.fetched_at)) AS last_activity,
           CASE WHEN COALESCE(SUM(sm.impressions), 0) > 0
                THEN ROUND((SUM(sm.engagement)::numeric / NULLIF(SUM(sm.impressions), 0)) * 100, 2)
                ELSE 0 END AS engagement_rate
         FROM social_metrics sm
         LEFT JOIN social_accounts sa_board
           ON sa_board.user_id = sm.user_id AND sa_board.platform = 'pinterest'
          AND sa_board.account_type = 'board' AND sa_board.account_id = (sm.raw_data->'pin'->>'board_id')
         WHERE sm.user_id = $1 AND sm.platform = 'pinterest'
           AND (sm.posted_at IS NULL OR sm.posted_at >= $2)
           AND COALESCE(sm.raw_data->'pin'->>'board_id', '') <> ''
         GROUP BY board_id
         ORDER BY COALESCE(SUM(sm.impressions), 0) DESC, COALESCE(SUM(sm.engagement), 0) DESC, COUNT(*) DESC
         LIMIT 200`,
        [auth.userId, sinceDate]
      );

      const boards = rows
        .map((row: any) => ({ board_id: String(row.board_id || '').trim(), board_name: row.board_name ? String(row.board_name) : null, total_pins: Number(row.total_pins || 0), total_impressions: Number(row.total_impressions || 0), total_outbound_clicks: Number(row.total_outbound_clicks || 0), total_saves: Number(row.total_saves || 0), total_reactions: Number(row.total_reactions || 0), total_comments: Number(row.total_comments || 0), total_engagement: Number(row.total_engagement || 0), engagement_rate: Number(row.engagement_rate || 0), last_activity: row.last_activity ? new Date(row.last_activity).toISOString() : null }))
        .filter((b: any) => b.board_id);

      return res.json({ success: true, boards, days });
    } catch (err) {
      logger.error('Pinterest boards performance error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest board performance' });
    }
  });
}
