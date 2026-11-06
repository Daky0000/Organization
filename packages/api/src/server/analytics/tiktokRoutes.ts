import axios from 'axios';
import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import { fetchTikTokUserProfile } from './helpers.ts';

// Per-user sync, shared by the POST /social/tiktok/sync route and the
// periodic analytics auto-sync in analyticsRoutes.ts.
export async function syncTikTokAnalyticsForUser(
  { pool, decryptIntegrationSecret }: Pick<AnalyticsDeps, 'pool' | 'decryptIntegrationSecret'>,
  userId: string
): Promise<{ found: number; synced: number; errors: string[] }> {
  if (!pool) return { found: 0, synced: 0, errors: ['DB not ready'] };

  const accountRes = await pool.query(
    `SELECT id, account_id, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
     FROM social_accounts WHERE user_id=$1 AND platform='tiktok' AND connected=true`,
    [userId]
  );

  let synced = 0;
  const errors: string[] = [];

  for (const acct of accountRes.rows as any[]) {
        let token = '';
        if (acct.access_token_encrypted) {
          try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ }
        }
        if (!token) token = String(acct.access_token || '').trim();
        if (!token) { errors.push('No access token available'); continue; }

        try {
          const { user: u, scopeLimited } = await fetchTikTokUserProfile(token);
          if (u) {
            const followers  = Number(u.follower_count  ?? 0);
            const following  = Number(u.following_count ?? 0);
            const postsCount = Number(u.video_count     ?? 0);
            const totalLikes = Number(u.likes_count     ?? 0);
            const bio        = typeof u.bio_description === 'string' ? u.bio_description : null;
            const isVerified = Boolean(u.is_verified ?? false);
            await pool.query(
              `INSERT INTO social_profile_stats
                 (id, user_id, social_account_id, platform, followers, following, posts_count, total_likes, bio, is_verified, raw_response, synced_at)
               VALUES (gen_random_uuid()::text, $1, $2, 'tiktok', $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
               ON CONFLICT (social_account_id) DO UPDATE SET
                 followers   = CASE WHEN EXCLUDED.followers   > 0 THEN EXCLUDED.followers   ELSE social_profile_stats.followers   END,
                 following   = CASE WHEN EXCLUDED.following   > 0 THEN EXCLUDED.following   ELSE social_profile_stats.following   END,
                 posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
                 total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
                 bio         = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
                 is_verified = EXCLUDED.is_verified,
                 raw_response= EXCLUDED.raw_response,
                 synced_at   = NOW()`,
              [userId, acct.id, followers, following, postsCount, totalLikes, bio, isVerified, JSON.stringify(u)]
            );
            const displayName = typeof u.display_name === 'string' && u.display_name.trim() ? u.display_name.trim() : null;
            const username    = typeof u.username    === 'string' && u.username.trim()    ? u.username.trim()    : null;
            await pool.query(
              `UPDATE social_accounts SET account_name = COALESCE($1, account_name), handle = COALESCE($2, handle), followers = CASE WHEN $3 > 0 THEN $3 ELSE followers END WHERE id = $4`,
              [displayName, username, followers, acct.id]
            );
            synced++;
            if (scopeLimited) errors.push('Stats scope not granted — reconnect TikTok to enable follower/video counts');
          }
        } catch (profileErr: any) {
          errors.push(`Profile sync failed: ${profileErr.message}`);
        }

        try {
          const VIDEO_FIELDS = 'id,title,cover_image_url,share_url,video_description,create_time,duration,height,width,embed_html,embed_link,like_count,comment_count,share_count,view_count';
          let cursor: number | undefined;
          let hasMore = true;
          let pageCount = 0;
          const MAX_PAGES = 10;

          while (hasMore && pageCount < MAX_PAGES) {
            const body: Record<string, any> = { max_count: 20 };
            if (cursor !== undefined) body.cursor = cursor;

            const listResp = await axios.post('https://open.tiktokapis.com/v2/video/list/', body, {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              params: { fields: VIDEO_FIELDS },
              validateStatus: () => true,
              timeout: 15000,
            });

            const listErrCode = listResp.data?.error?.code;
            if (listErrCode && listErrCode !== 'ok') {
              if (pageCount === 0) logger.info(`TikTok video.list scope not available (${listErrCode}) — skipping video sync`);
              break;
            }
            if (listResp.status !== 200) break;

            const pageVideos: any[] = listResp.data?.data?.videos || [];
            hasMore = listResp.data?.data?.has_more === true;
            cursor  = listResp.data?.data?.cursor;
            pageCount++;

            for (const v of pageVideos) {
              if (!v.id) continue;
              const likes    = Number(v.like_count    ?? 0);
              const comments = Number(v.comment_count ?? 0);
              const shares   = Number(v.share_count   ?? 0);
              const views    = Number(v.view_count    ?? 0);
              const engagement = likes + comments + shares;

              await pool.query(
                `INSERT INTO tiktok_video_insights
                   (id, user_id, social_account_id, video_id, title, cover_url, share_url,
                    likes, comments, shares, views, engagement, duration_seconds, posted_at,
                    video_description, embed_html, embed_link, height, width, fetched_at, raw_data)
                 VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), $19::jsonb)
                 ON CONFLICT (social_account_id, video_id) DO UPDATE SET
                   title = EXCLUDED.title, cover_url = EXCLUDED.cover_url, share_url = EXCLUDED.share_url,
                   likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
                   views = EXCLUDED.views, engagement = EXCLUDED.engagement, duration_seconds = EXCLUDED.duration_seconds,
                   video_description = EXCLUDED.video_description, embed_html = EXCLUDED.embed_html,
                   embed_link = EXCLUDED.embed_link, height = EXCLUDED.height, width = EXCLUDED.width,
                   fetched_at = NOW(), raw_data = EXCLUDED.raw_data`,
                [
                  userId, acct.id, String(v.id),
                  typeof v.title === 'string' ? v.title.slice(0, 500) : null,
                  typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
                  typeof v.share_url === 'string' ? v.share_url : null,
                  likes, comments, shares, views, engagement,
                  Number(v.duration ?? 0),
                  v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
                  typeof v.video_description === 'string' ? v.video_description.slice(0, 2000) : null,
                  typeof v.embed_html === 'string' ? v.embed_html : null,
                  typeof v.embed_link === 'string' ? v.embed_link : null,
                  Number(v.height ?? 0), Number(v.width ?? 0),
                  JSON.stringify(v),
                ]
              );
              synced++;
            }
            if (!hasMore || cursor === undefined) break;
          }
        } catch (vidErr: any) {
          errors.push(`Video sync failed: ${vidErr.message}`);
        }
      }

  return { found: accountRes.rows.length, synced, errors };
}

export function registerTikTokRoutes(router: Router, { requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection }: AnalyticsDeps): void {
  // POST /social/tiktok/sync
  router.post('/social/tiktok/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
      // TikTok access tokens last 24 hours: renew the stored one first.
      await getPublishableSocialConnection(auth.userId, 'tiktok').catch(() => null);
      const result = await syncTikTokAnalyticsForUser({ pool, decryptIntegrationSecret }, auth.userId);
      if (result.found === 0) return res.status(404).json({ success: false, error: 'No connected TikTok account found' });
      return res.json({ success: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined });
    } catch (err) {
      logger.error('TikTok sync error:', err);
      return res.status(500).json({ success: false, error: 'TikTok sync failed' });
    }
  });

  // GET /social/tiktok/videos
  router.get('/social/tiktok/videos', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const q = req.query as any;
      const days = Math.min(365, Math.max(1, parseInt(q.days || '30', 10)));
      const limit = Math.min(200, Math.max(1, parseInt(q.limit || '100', 10)));
      const offset = Math.max(0, parseInt(q.offset || '0', 10));
      const accountId = q.account_id ? String(q.account_id) : null;

      const params: any[] = [auth.userId];
      let accountFilter = '';
      if (accountId) { params.push(accountId); accountFilter = `AND tvi.social_account_id = $${params.length}`; }
      params.push(limit, offset);

      const videosRes = await pool.query(
        `SELECT tvi.*, sa.account_name, sa.handle FROM tiktok_video_insights tvi
         JOIN social_accounts sa ON sa.id = tvi.social_account_id
         WHERE tvi.user_id = $1 ${accountFilter}
         ORDER BY COALESCE(tvi.posted_at, tvi.fetched_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM tiktok_video_insights tvi WHERE tvi.user_id = $1 ${accountFilter}`,
        params.slice(0, params.length - 2)
      );
      const summaryRes = await pool.query(
        `SELECT COUNT(*) AS total_videos,
           COALESCE(SUM(likes), 0) AS total_likes, COALESCE(SUM(comments), 0) AS total_comments,
           COALESCE(SUM(shares), 0) AS total_shares, COALESCE(SUM(views), 0) AS total_views,
           COALESCE(SUM(engagement), 0) AS total_engagement,
           CASE WHEN COALESCE(SUM(views), 0) > 0
                THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(views), 0)) * 100, 2)
                ELSE 0 END AS avg_engagement_rate
         FROM tiktok_video_insights tvi WHERE tvi.user_id = $1 ${accountFilter}`,
        params.slice(0, params.length - 2)
      );

      return res.json({ success: true, videos: videosRes.rows, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: summaryRes.rows[0] || {}, days });
    } catch (err) {
      logger.error('TikTok videos error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch TikTok videos' });
    }
  });

  // GET /social/tiktok/followers
  router.get('/social/tiktok/followers', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ followers: null, hasData: false });

      const { rows: accounts } = await pool.query(
        `SELECT sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers,
           sps.followers, sps.following, sps.posts_count,
           sps.total_likes, sps.bio, sps.is_verified, sps.synced_at
         FROM social_accounts sa
         LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.connected = true AND (sa.platform = 'tiktok' OR sa.platform ILIKE 'tiktok')
         ORDER BY sps.synced_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );

      if (!accounts.length) return res.json({ followers: null, hasData: false });
      const row = accounts[0];
      const followers = row.followers ?? row.sa_followers ?? null;
      const hasData = followers !== null || row.following !== null || row.posts_count !== null;

      return res.json({
        hasData,
        followers:   followers          !== null ? Number(followers)         : null,
        following:   row.following      !== null ? Number(row.following)     : null,
        posts_count: row.posts_count    !== null ? Number(row.posts_count)   : null,
        total_likes: row.total_likes    !== null ? Number(row.total_likes)   : null,
        bio:         row.bio            ?? null,
        is_verified: row.is_verified    ?? null,
        display_name:row.account_name   ?? null,
        handle:      row.handle         ?? null,
        synced_at:   row.synced_at      ?? null,
      });
    } catch (err) {
      logger.error('TikTok followers error:', err);
      return res.json({ followers: null, hasData: false });
    }
  });
}
