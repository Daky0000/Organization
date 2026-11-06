import axios from 'axios';
import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import { encryptIntegrationSecret } from '../../integration-helpers.ts';
import { getPlatformConfig } from '../../user-auth.ts';
import { syncFacebookPagesForUser } from '../socialConnectRoutes.ts';
import { META_GRAPH_BASE } from '../../meta-graph.ts';

const GRAPH_BASE = META_GRAPH_BASE;

async function ensureFacebookPagesSyncedForAnalytics(
  pool: AnalyticsDeps['pool'],
  decryptIntegrationSecret: AnalyticsDeps['decryptIntegrationSecret'],
  userId: string,
): Promise<void> {
  if (!pool) return;
  try {
    const existingPages = await pool.query(
      `SELECT id FROM social_accounts WHERE user_id = $1 AND platform = 'facebook' AND account_type = 'page' AND connected = true LIMIT 1`,
      [userId],
    );
    if ((existingPages.rowCount ?? 0) > 0) return;

    const profileRes = await pool.query(
      `SELECT access_token, access_token_encrypted
       FROM social_accounts
       WHERE user_id = $1 AND platform = 'facebook' AND connected = true
       ORDER BY CASE WHEN account_type = 'profile' THEN 0 ELSE 1 END, connected_at DESC NULLS LAST
       LIMIT 1`,
      [userId],
    );
    const row: any = profileRes.rows?.[0];
    if (!row) return;
    let userToken = '';
    if (row.access_token_encrypted) {
      try {
        userToken = decryptIntegrationSecret(String(row.access_token_encrypted));
      } catch (_e) {
        // ignore
      }
    }
    if (!userToken) userToken = String(row.access_token || '').trim();
    if (!userToken) return;

    await syncFacebookPagesForUser(
      {
        pool,
        dbQuery: <T = any>(sql: string, params?: any[]) =>
          pool.query(sql, params) as unknown as Promise<{ rows: T[]; rowCount?: number | null }>,
        getPlatformConfig,
        encryptIntegrationSecret,
      },
      userId,
      userToken,
    );
  } catch (err) {
    logger.warn({ err }, 'ensureFacebookPagesSyncedForAnalytics_failed');
  }
}

// Per-user sync, shared by the POST /social/facebook/sync route and the
// periodic analytics auto-sync in analyticsRoutes.ts.
export async function syncFacebookAnalyticsForUser(
  { pool, decryptIntegrationSecret }: Pick<AnalyticsDeps, 'pool' | 'decryptIntegrationSecret'>,
  userId: string
): Promise<{ found: number; synced: number; errors: string[] }> {
  if (!pool) return { found: 0, synced: 0, errors: ['DB not ready'] };

  await ensureFacebookPagesSyncedForAnalytics(pool, decryptIntegrationSecret, userId);

  const accountRes = await pool.query(
    `SELECT id, account_id, account_type, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted, token_data
     FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND connected=true`,
    [userId]
  );

  let synced = 0;
  const errors: string[] = [];

  const pageRows = (accountRes.rows as any[]).filter((r) => r.account_type === 'page');
  const rowsToSync = pageRows.length > 0 ? pageRows : (accountRes.rows as any[]);

  for (const acct of rowsToSync) {
    let token = '';
    if (acct.access_token_encrypted) { try { token = decryptIntegrationSecret(String(acct.access_token_encrypted)); } catch (_err) { /* */ } }
    if (!token) token = String(acct.access_token || '').trim();
    if (!token) { errors.push('No access token available'); continue; }

    const pageId = String(acct.account_id);

        try {
          const pageResp = await axios.get(`${GRAPH_BASE}/${pageId}`, {
            params: { fields: 'id,name,followers_count,fan_count,picture.type(large),bio', access_token: token },
            validateStatus: () => true, timeout: 15000,
          });
          if (pageResp.status === 200 && pageResp.data?.id) {
            const p = pageResp.data;
            const followers = Number(p.followers_count ?? 0);
            const pageLikes = Number(p.fan_count ?? 0);
            const bio = typeof p.bio === 'string' ? p.bio : null;
            const pictureUrl = typeof p.picture?.data?.url === 'string' ? p.picture.data.url : null;

            await pool.query(
              `INSERT INTO facebook_page_stats
                 (id, user_id, social_account_id, platform, followers, page_likes, bio, picture_url, raw_response, synced_at)
               VALUES (gen_random_uuid()::text, $1, $2, 'facebook', $3, $4, $5, $6, $7::jsonb, NOW())
               ON CONFLICT (social_account_id) DO UPDATE SET
                 followers = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE facebook_page_stats.followers END,
                 page_likes = CASE WHEN EXCLUDED.page_likes > 0 THEN EXCLUDED.page_likes ELSE facebook_page_stats.page_likes END,
                 bio = COALESCE(EXCLUDED.bio, facebook_page_stats.bio),
                 picture_url = COALESCE(EXCLUDED.picture_url, facebook_page_stats.picture_url),
                 raw_response = EXCLUDED.raw_response, synced_at = NOW()`,
              [userId, acct.id, followers, pageLikes, bio, pictureUrl, JSON.stringify(p)]
            );
            const displayName = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;
            await pool.query(
              `UPDATE social_accounts SET account_name = COALESCE($1, account_name), followers = CASE WHEN $2 > 0 THEN $2 ELSE followers END WHERE id = $3`,
              [displayName, followers, acct.id]
            );
            synced++;
          }
        } catch (profileErr: any) {
          errors.push(`Profile sync failed: ${profileErr.message}`);
        }

        try {
          const POST_FIELDS = 'id,message,picture,story,type,created_time,shares.summary(total_count).as(shares_summary),likes.summary(total_count).as(likes_summary),comments.summary(total_count).as(comments_summary),permalink_url';
          let cursor: string | null | undefined;
          let hasMore = true;
          let pageCount = 0;
          const MAX_PAGES = 10;

          while (hasMore && pageCount < MAX_PAGES) {
            const params: Record<string, any> = { fields: POST_FIELDS, limit: 100, access_token: token };
            if (cursor) params.after = cursor;

            const postsResp = await axios.get(`${GRAPH_BASE}/${pageId}/posts`, { params, validateStatus: () => true, timeout: 15000 });
            if (postsResp.status !== 200) { if (pageCount === 0) logger.info(`Facebook posts endpoint error (${postsResp.status}) — skipping posts sync`); break; }

            const pageData = postsResp.data?.data || [];
            const paging = postsResp.data?.paging || {};
            hasMore = !!paging.cursors?.after;
            cursor = paging.cursors?.after;
            pageCount++;

            for (const post of pageData) {
              if (!post.id) continue;
              const likes = Number(post.likes_summary?.summary?.total_count ?? 0);
              const comments = Number(post.comments_summary?.summary?.total_count ?? 0);
              const shares = Number(post.shares_summary?.summary?.total_count ?? 0);
              const engagement = likes + comments + shares;
              const createdAt = post.created_time ? new Date(post.created_time).toISOString() : null;

              await pool.query(
                `INSERT INTO facebook_post_insights
                   (id, user_id, social_account_id, post_id, message, picture, story, type, permalink_url, shares, likes_count, comments_count, engagement, created_at, fetched_at, raw_data)
                 VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14::jsonb)
                 ON CONFLICT (social_account_id, post_id) DO UPDATE SET
                   message = EXCLUDED.message, picture = EXCLUDED.picture, story = EXCLUDED.story,
                   type = EXCLUDED.type, permalink_url = EXCLUDED.permalink_url,
                   shares = EXCLUDED.shares, likes_count = EXCLUDED.likes_count,
                   comments_count = EXCLUDED.comments_count, engagement = EXCLUDED.engagement,
                   fetched_at = NOW(), raw_data = EXCLUDED.raw_data`,
                [userId, acct.id, String(post.id), typeof post.message === 'string' ? post.message.slice(0, 5000) : null, typeof post.picture === 'string' ? post.picture : null, typeof post.story === 'string' ? post.story : null, typeof post.type === 'string' ? post.type : null, typeof post.permalink_url === 'string' ? post.permalink_url : null, shares, likes, comments, engagement, createdAt, JSON.stringify(post)]
              );
              synced++;
            }
            if (!hasMore) break;
          }
        } catch (postsErr: any) {
          errors.push(`Posts sync failed: ${postsErr.message}`);
        }
      }

  return { found: accountRes.rows.length, synced, errors };
}

export function registerFacebookRoutes(router: Router, { requireAuth, pool, decryptIntegrationSecret }: AnalyticsDeps): void {
  // POST /social/facebook/sync
  router.post('/social/facebook/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });
      const result = await syncFacebookAnalyticsForUser({ pool, decryptIntegrationSecret }, auth.userId);
      if (result.found === 0) return res.status(404).json({ success: false, error: 'No connected Facebook account found' });
      return res.json({ success: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined });
    } catch (err) {
      logger.error('Facebook sync error:', err);
      return res.status(500).json({ success: false, error: 'Facebook sync failed' });
    }
  });

  // GET /social/facebook/posts
  router.get('/social/facebook/posts', async (req: Request, res: Response) => {
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
      if (accountId) { params.push(accountId); accountFilter = `AND fpi.social_account_id = $${params.length}`; }
      params.push(limit, offset);

      const postsRes = await pool.query(
        `SELECT fpi.*, sa.account_name FROM facebook_post_insights fpi
         JOIN social_accounts sa ON sa.id = fpi.social_account_id
         WHERE fpi.user_id = $1 ${accountFilter}
         ORDER BY COALESCE(fpi.created_at, fpi.fetched_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countRes = await pool.query(`SELECT COUNT(*) FROM facebook_post_insights fpi WHERE fpi.user_id = $1 ${accountFilter}`, params.slice(0, params.length - 2));
      const summaryRes = await pool.query(
        `SELECT COUNT(*) AS total_posts,
           COALESCE(SUM(likes_count), 0) AS total_likes,
           COALESCE(SUM(comments_count), 0) AS total_comments,
           COALESCE(SUM(shares), 0) AS total_shares,
           COALESCE(SUM(engagement), 0) AS total_engagement,
           CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(engagement)::numeric / NULLIF(COUNT(*), 0)), 2) ELSE 0 END AS avg_engagement_per_post
         FROM facebook_post_insights fpi WHERE fpi.user_id = $1 ${accountFilter}`,
        params.slice(0, params.length - 2)
      );
      return res.json({ success: true, posts: postsRes.rows, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: summaryRes.rows[0] || {}, days });
    } catch (err) {
      logger.error('Facebook posts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Facebook posts' });
    }
  });

  // GET /social/facebook/stats
  router.get('/social/facebook/stats', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ stats: null, hasData: false });

      const { rows: pages } = await pool.query(
        `SELECT sa.id, sa.account_name, sa.handle, sa.followers AS sa_followers,
           fps.followers, fps.page_likes, fps.posts_count, fps.engagement_rate, fps.bio, fps.picture_url, fps.synced_at
         FROM social_accounts sa
         LEFT JOIN facebook_page_stats fps ON fps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.connected = true AND (sa.platform = 'facebook' OR sa.platform ILIKE 'facebook')
         ORDER BY fps.synced_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );
      if (!pages.length) return res.json({ stats: null, hasData: false });
      const row = pages[0];
      const followers = row.followers ?? row.sa_followers ?? null;
      return res.json({ hasData: followers !== null || row.page_likes !== null, followers: followers !== null ? Number(followers) : null, page_likes: row.page_likes !== null ? Number(row.page_likes) : null, posts_count: row.posts_count !== null ? Number(row.posts_count) : null, engagement_rate: row.engagement_rate !== null ? Number(row.engagement_rate) : null, bio: row.bio ?? null, picture_url: row.picture_url ?? null, account_name: row.account_name ?? null, synced_at: row.synced_at ?? null });
    } catch (err) {
      logger.error('Facebook stats error:', err);
      return res.json({ stats: null, hasData: false });
    }
  });

  // GET /social/facebook/accounts
  router.get('/social/facebook/accounts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      await ensureFacebookPagesSyncedForAnalytics(pool, decryptIntegrationSecret, auth.userId);

      const { rows: accounts } = await pool.query(
        `SELECT sa.id, sa.account_id, sa.account_name, sa.account_type, sa.followers, sa.profile_image, sa.handle, fps.followers as page_followers, fps.page_likes
         FROM social_accounts sa LEFT JOIN facebook_page_stats fps ON fps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.platform = 'facebook' AND sa.connected = true
         ORDER BY sa.account_type DESC, sa.account_name ASC`,
        [auth.userId]
      );
      const pages = accounts.filter((a: any) => a.account_type === 'page');
      const groups = accounts.filter((a: any) => a.account_type === 'group');
      return res.json({
        success: true,
        pages: pages.map((p: any) => ({ id: p.id, account_id: p.account_id, name: p.account_name, type: p.account_type, followers: p.page_followers || p.followers || 0, likes: p.page_likes || 0, picture_url: p.profile_image })),
        groups: groups.map((g: any) => ({ id: g.id, account_id: g.account_id, name: g.account_name, type: g.account_type, members: g.followers || 0, picture_url: g.profile_image })),
        total_pages: pages.length, total_groups: groups.length,
      });
    } catch (err) {
      logger.error('Facebook accounts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Facebook accounts' });
    }
  });
}
