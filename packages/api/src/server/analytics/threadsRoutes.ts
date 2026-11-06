import axios from 'axios';
import type { Router, Response } from 'express';
import type { Request } from '../../types/http.ts';
import { logger } from '../../logger.ts';
import type { AnalyticsDeps } from './helpers.ts';
import type { SyncHelpers } from './syncHelpers.ts';

export function registerThreadsRoutes(router: Router, { requireAuth, pool, getPublishableSocialConnection, getPlatformConfig }: AnalyticsDeps, syncHelpers: SyncHelpers): void {
  const threadsBase = 'https://graph.threads.net/v1.0';

  // POST /social/threads/sync
  router.post('/social/threads/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const accountRes = await pool.query(
        `SELECT id, account_id, account_name, handle, followers, profile_image, access_token, access_token_encrypted, token_data
         FROM social_accounts
         WHERE user_id=$1 AND platform='threads' AND connected=true AND account_type='profile'
         ORDER BY connected_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );
      if (accountRes.rows.length === 0) return res.status(404).json({ success: false, error: 'No connected Threads account found' });

      const tokenConn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!tokenConn || tokenConn.needs_reapproval || !tokenConn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      const result = await syncHelpers.syncThreadsAnalyticsAccount({
        userId: auth.userId,
        account: { ...accountRes.rows[0], access_token: tokenConn.access_token, access_token_encrypted: null },
        days: 30,
        maxPosts: 120,
      });
      return res.json({ success: true, synced: result.synced, errors: result.errors.length > 0 ? result.errors : undefined });
    } catch (err) {
      logger.error('Threads sync error:', err);
      return res.status(500).json({ success: false, error: 'Threads sync failed' });
    }
  });

  // GET /social/threads/profile
  router.get('/social/threads/profile', async (req: Request, res: Response) => {
    const empty = { hasData: false, followers: null, posts_count: null, total_likes: null, total_views: null, total_replies: null, total_reposts: null, total_quotes: null, total_clicks: null, follower_demographics: null, bio: null, is_verified: null, account_name: null, handle: null, picture_url: null, synced_at: null };
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json(empty);

      const { rows } = await pool.query(
        `SELECT sa.id, sa.account_id, sa.account_name, sa.handle, sa.followers AS sa_followers, sa.profile_image, sa.token_data,
           sps.followers, sps.posts_count, sps.total_likes, sps.bio, sps.is_verified, sps.raw_response, sps.synced_at
         FROM social_accounts sa
         LEFT JOIN social_profile_stats sps ON sps.social_account_id = sa.id
         WHERE sa.user_id = $1 AND sa.platform = 'threads' AND sa.account_type = 'profile' AND sa.connected = true
         ORDER BY sps.synced_at DESC NULLS LAST, sa.connected_at DESC NULLS LAST LIMIT 1`,
        [auth.userId]
      );
      if (!rows.length) return res.json(empty);

      const row: any = rows[0];
      const tokenData = row.token_data || {};
      const raw = row.raw_response || {};
      const rawProfile = raw?.profile || {};
      const followers = row.followers ?? row.sa_followers ?? null;
      const metricNumOrNull = (v: any) => { if (v === null || v === undefined) return null; const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
      const accountMetrics = raw?.account_metrics || {};

      return res.json({
        hasData: followers !== null || row.posts_count !== null || Boolean(row.account_name) || Boolean(row.handle),
        followers: followers !== null ? Number(followers) : null,
        posts_count: row.posts_count !== null ? Number(row.posts_count) : null,
        total_likes: row.total_likes !== null ? Number(row.total_likes) : null,
        total_views: metricNumOrNull(accountMetrics?.views),
        total_replies: metricNumOrNull(accountMetrics?.replies),
        total_reposts: metricNumOrNull(accountMetrics?.reposts),
        total_quotes: metricNumOrNull(accountMetrics?.quotes),
        total_clicks: metricNumOrNull(accountMetrics?.clicks),
        follower_demographics: raw?.follower_demographics || null,
        bio: row.bio ?? (typeof rawProfile?.threads_biography === 'string' ? rawProfile.threads_biography : null) ?? (typeof tokenData?.about === 'string' ? tokenData.about : null) ?? null,
        is_verified: row.is_verified === true || rawProfile?.is_verified === true || tokenData?.is_verified === true,
        account_name: row.account_name ?? (typeof rawProfile?.name === 'string' ? rawProfile.name : null) ?? (typeof tokenData?.name === 'string' ? tokenData.name : null) ?? null,
        handle: row.handle ?? (typeof rawProfile?.username === 'string' ? rawProfile.username : null) ?? (typeof tokenData?.username === 'string' ? tokenData.username : null) ?? null,
        picture_url: row.profile_image ?? (typeof rawProfile?.threads_profile_picture_url === 'string' ? rawProfile.threads_profile_picture_url : null) ?? (typeof tokenData?.avatar_url === 'string' ? tokenData.avatar_url : null) ?? null,
        synced_at: row.synced_at ?? null,
      });
    } catch (err) {
      logger.error('Threads profile error:', err);
      return res.json(empty);
    }
  });

  // GET /social/threads/posts
  router.get('/social/threads/posts', async (req: Request, res: Response) => {
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
         WHERE sm.user_id = $1 AND sm.platform = 'threads' AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${accountFilter}
         ORDER BY COALESCE(sm.posted_at, sm.fetched_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM social_metrics sm WHERE sm.user_id = $1 AND sm.platform = 'threads' AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${accountFilter}`,
        params.slice(0, params.length - 2)
      );
      const summaryRes = await pool.query(
        `SELECT COUNT(*) AS total_posts,
           COALESCE(SUM(impressions), 0) AS total_views, COALESCE(SUM(likes), 0) AS total_likes,
           COALESCE(SUM(comments), 0) AS total_replies, COALESCE(SUM(shares), 0) AS total_shares,
           COALESCE(SUM(engagement), 0) AS total_engagement,
           COALESCE(SUM(COALESCE(NULLIF(sm.raw_data->'metrics'->>'reposts', '')::numeric, 0)), 0) AS total_reposts,
           COALESCE(SUM(COALESCE(NULLIF(sm.raw_data->'metrics'->>'quotes', '')::numeric, 0)), 0) AS total_quotes,
           CASE WHEN COALESCE(SUM(impressions), 0) > 0 THEN ROUND((SUM(engagement)::numeric / NULLIF(SUM(impressions), 0)) * 100, 2) ELSE 0 END AS avg_engagement_rate
         FROM social_metrics sm
         WHERE sm.user_id = $1 AND sm.platform = 'threads' AND (sm.posted_at IS NULL OR sm.posted_at >= $2) ${accountFilter}`,
        params.slice(0, params.length - 2)
      );

      const metricNum = (v: any) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0')); return Number.isFinite(n) ? n : 0; };
      const posts = postsRes.rows.map((row: any) => {
        const raw = row.raw_data || {};
        const post = raw?.post || {};
        const metrics = raw?.metrics || {};
        const mediaUrl = typeof post?.media_url === 'string' ? post.media_url : null;
        const gifUrl = typeof post?.gif_url === 'string' ? post.gif_url : null;
        return { ...row, thread_id: row.platform_post_id, text: typeof post?.text === 'string' ? post.text : null, permalink: typeof post?.permalink === 'string' ? post.permalink : null, username: typeof post?.username === 'string' ? post.username : (row.handle || null), media_product_type: typeof post?.media_product_type === 'string' ? post.media_product_type : null, media_type: typeof post?.media_type === 'string' ? post.media_type : null, media_url: mediaUrl || gifUrl, gif_url: gifUrl, thumbnail_url: typeof post?.thumbnail_url === 'string' ? post.thumbnail_url : null, alt_text: typeof post?.alt_text === 'string' ? post.alt_text : null, link_attachment_url: typeof post?.link_attachment_url === 'string' ? post.link_attachment_url : null, poll_attachment: post?.poll_attachment ?? null, location_id: post?.location_id != null ? String(post.location_id) : null, topic_tag: typeof post?.topic_tag === 'string' ? post.topic_tag : null, is_quote_post: post?.is_quote_post === true, has_replies: post?.has_replies === true, views: row.impressions != null ? Number(row.impressions) : metricNum(metrics?.views), replies: row.comments != null ? Number(row.comments) : metricNum(metrics?.replies), reposts: metricNum(metrics?.reposts), quotes: metricNum(metrics?.quotes) };
      });

      return res.json({ success: true, posts, total: parseInt(countRes.rows[0]?.count || '0', 10), summary: summaryRes.rows[0] || { total_posts: 0, total_views: 0, total_likes: 0, total_replies: 0, total_shares: 0, total_engagement: 0, total_reposts: 0, total_quotes: 0, avg_engagement_rate: 0 }, days });
    } catch (err) {
      logger.error('Threads posts error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Threads posts' });
    }
  });

  // GET /social/threads/debug-token
  router.get('/social/threads/debug-token', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const conn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      if (!getPlatformConfig) return res.status(503).json({ success: false, error: 'Platform config not available' });
      const cfg = await getPlatformConfig('threads');
      const appId = String(cfg.appId || process.env.VITE_THREADS_APP_ID || process.env.VITE_THREADS_CLIENT_ID || '').trim();
      const appSecret = String(cfg.appSecret || process.env.THREADS_APP_SECRET || process.env.VITE_THREADS_APP_SECRET || '').trim();
      const appToken = appId && appSecret ? `${appId}|${appSecret}` : '';
      if (!appToken) return res.status(400).json({ success: false, error: 'Threads app credentials not configured by admin' });

      const resp = await axios.get('https://graph.threads.net/debug_token', { params: { input_token: conn.access_token, access_token: appToken }, validateStatus: () => true, timeout: 15000 });
      const data: any = resp.data || {};
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.error?.message || `Threads debug_token failed (${resp.status})` });
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('Threads debug-token error:', err);
      return res.status(500).json({ success: false, error: 'Failed to debug Threads token' });
    }
  });

  // GET /social/threads/replies
  router.get('/social/threads/replies', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const threadId = String((req.query as any).thread_id || '').trim();
      if (!threadId) return res.status(400).json({ success: false, error: 'thread_id is required' });

      const conn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      const fields = String((req.query as any).fields || '').trim() || 'id,text,timestamp,media_product_type,media_type,media_url,gif_url,permalink,shortcode,thumbnail_url,username,children,is_quote_post,quoted_post,reposted_post,alt_text,link_attachment_url,has_replies,is_reply,is_reply_owned_by_me,root_post,replied_to,hide_status,reply_audience,location_id,topic_tag,is_verified,profile_picture_url,reply_approval_status';
      const limit = Math.min(100, Math.max(1, parseInt(String((req.query as any).limit || '50'), 10)));
      const after = String((req.query as any).after || '').trim();
      const reverseRaw = String((req.query as any).reverse || '').trim().toLowerCase();
      const reverse = reverseRaw === '1' || reverseRaw === 'true' || reverseRaw === 'yes';

      const resp = await axios.get(`${threadsBase}/${encodeURIComponent(threadId)}/replies`, {
        params: { fields, limit, reverse, ...(after ? { after } : {}), access_token: conn.access_token },
        validateStatus: () => true, timeout: 20000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.error?.message || `Threads replies fetch failed (${resp.status})` });
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('Threads replies error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Threads replies' });
    }
  });

  // POST /social/threads/replies/hide
  router.post('/social/threads/replies/hide', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { replyId, hide } = req.body as { replyId?: string; hide?: boolean };
      const rid = String(replyId || '').trim();
      if (!rid) return res.status(400).json({ success: false, error: 'replyId is required' });

      const conn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      const resp = await axios.post(`${threadsBase}/${encodeURIComponent(rid)}/manage_reply`, null, { params: { hide: hide === false ? 'false' : 'true', access_token: conn.access_token }, validateStatus: () => true, timeout: 15000 });
      const data: any = resp.data || {};
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.error?.message || `Threads manage_reply failed (${resp.status})` });
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('Threads manage-reply error:', err);
      return res.status(500).json({ success: false, error: 'Failed to manage Threads reply' });
    }
  });

  // POST /social/threads/replies/respond
  router.post('/social/threads/replies/respond', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { replyToId, text } = req.body as { replyToId?: string; text?: string };
      const rid = String(replyToId || '').trim();
      const bodyText = String(text || '').trim();
      if (!rid || !bodyText) return res.status(400).json({ success: false, error: 'replyToId and text are required' });

      const conn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      let threadsUserId = String(conn.token_data?.user_id || conn.token_data?.userId || conn.token_data?.id || '').trim();
      if (!threadsUserId) {
        const meResp = await axios.get(`${threadsBase}/me`, { params: { fields: 'id', access_token: conn.access_token }, validateStatus: () => true, timeout: 15000 });
        const meData: any = meResp.data || {};
        if (meResp.status >= 400) throw new Error(meData?.error?.message || `Threads profile lookup failed (${meResp.status})`);
        threadsUserId = String(meData?.id || '').trim();
      }
      if (!threadsUserId) return res.status(400).json({ success: false, error: 'Threads user id not available' });

      const createParams = new URLSearchParams({ media_type: 'TEXT', text: bodyText, reply_to_id: rid, access_token: conn.access_token });
      const createResp = await axios.post(`${threadsBase}/${encodeURIComponent(threadsUserId)}/threads`, createParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 });
      const createData: any = createResp.data || {};
      if (createResp.status >= 400) return res.status(400).json({ success: false, error: createData?.error?.message || `Threads create reply error ${createResp.status}` });
      const creationId = String(createData?.id || '').trim();
      if (!creationId) return res.status(400).json({ success: false, error: 'Threads creation id missing' });

      const publishParams = new URLSearchParams({ creation_id: creationId, access_token: conn.access_token });
      const pubResp = await axios.post(`${threadsBase}/${encodeURIComponent(threadsUserId)}/threads_publish`, publishParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 });
      const pubData: any = pubResp.data || {};
      if (pubResp.status >= 400) return res.status(400).json({ success: false, error: pubData?.error?.message || `Threads publish reply error ${pubResp.status}` });
      return res.json({ success: true, platformPostId: String(pubData?.id || '').trim() });
    } catch (err) {
      logger.error('Threads reply publish error:', err);
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to publish Threads reply' });
    }
  });

  // GET /social/threads/locations/search
  router.get('/social/threads/locations/search', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const q = String((req.query as any).q || '').trim();
      if (!q) return res.status(400).json({ success: false, error: 'q is required' });

      const conn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      const latitude = String((req.query as any).latitude || '').trim();
      const longitude = String((req.query as any).longitude || '').trim();
      const fields = String((req.query as any).fields || '').trim() || 'id,address,city,country,name,latitude,longitude,postal_code';

      const resp = await axios.get('https://graph.threads.net/location_search', { params: { q, ...(latitude ? { latitude } : {}), ...(longitude ? { longitude } : {}), fields, access_token: conn.access_token }, validateStatus: () => true, timeout: 15000 });
      const data: any = resp.data || {};
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.error?.message || `Threads location_search failed (${resp.status})` });
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('Threads location search error:', err);
      return res.status(500).json({ success: false, error: 'Failed to search Threads locations' });
    }
  });

  // GET /social/threads/locations/:locationId
  router.get('/social/threads/locations/:locationId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const locationId = String(req.params.locationId || '').trim();
      if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });

      const conn = await getPublishableSocialConnection(auth.userId, 'threads');
      if (!conn || conn.needs_reapproval || !conn.access_token) {
        return res.status(400).json({ success: false, error: 'Threads access token missing or expired — reconnect Threads.' });
      }

      const fields = String((req.query as any).fields || '').trim() || 'id,address,city,country,name,latitude,longitude,postal_code';
      const resp = await axios.get(`https://graph.threads.net/${encodeURIComponent(locationId)}`, { params: { fields, access_token: conn.access_token }, validateStatus: () => true, timeout: 15000 });
      const data: any = resp.data || {};
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.error?.message || `Threads location lookup failed (${resp.status})` });
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('Threads location lookup error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch Threads location' });
    }
  });
}
