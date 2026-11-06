import { normalizeWordPressSiteUrl, getMakeWebhookConnection, removeWordPressSocialAccount, isValidWebhookUrl, decodeWordPressUpload } from '../integration-helpers.ts';
import axios from 'axios';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { safeAxios, assertSafePublicUrl } from '../ssrf-guard.ts';

export interface WordPressDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  encryptWordPressPassword: (plain: string) => string;
  decryptWordPressPassword: (encrypted: string) => string;
  getWordPressConnection: (userId: string) => Promise<any>;
  wpRequest: (siteUrl: string, username: string, password: string, method: string, path: string, opts?: any) => Promise<any>;
  upsertUserIntegration: (params: any) => Promise<void>;
  logIntegrationEvent: (params: any) => Promise<void>;
  ensureWordPressSocialAccount: (userId: string) => Promise<void>;
}

export function registerWordPressRoutes(deps: WordPressDeps): Router {
  const {
    requireAuth, hasDatabase, dbQuery, pool,
    encryptWordPressPassword, decryptWordPressPassword, getWordPressConnection, wpRequest,
    upsertUserIntegration, logIntegrationEvent, ensureWordPressSocialAccount,
  } = deps;
  const router = Router();

router.post('/wordpress/connect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { siteUrl, username, applicationPassword, password } = req.body;
    if (!siteUrl || !username) {
      return res.status(400).json({ success: false, error: 'WordPress Site URL and Username are required' });
    }
    const hasAppPassword = applicationPassword && String(applicationPassword).trim();
    const hasLoginPassword = password && String(password).trim();
    if (!hasAppPassword && !hasLoginPassword) {
      return res.status(400).json({
        success: false,
        error: 'Provide either your WordPress login password or an Application Password (Users → Profile → Application Passwords).',
      });
    }

    const site = normalizeWordPressSiteUrl(siteUrl);
    let credentialToStore: string | undefined;
    let lastError: string | undefined;
    let lastStatus: number | undefined;

    // Try Application Password first (recommended)
    if (hasAppPassword) {
      const res = await wpRequest(site, username, String(applicationPassword).trim(), 'GET', '/wp/v2/users/me');
      lastStatus = res.status;
      if (res.status === 200 && res.data?.id) {
        credentialToStore = String(applicationPassword).trim();
      } else {
        lastError = res.error;
      }
    }

    // If Application Password failed or not provided, try login password (works with many hosts/plugins)
    if (credentialToStore === undefined && hasLoginPassword) {
      const res = await wpRequest(site, username, String(password).trim(), 'GET', '/wp/v2/users/me');
      lastStatus = res.status;
      if (res.status === 200 && res.data?.id) {
        credentialToStore = String(password).trim();
      } else {
        lastError = lastError || res.error;
      }
    }

    if (typeof credentialToStore === 'undefined') {
      const err = lastError ? String(lastError).toLowerCase() : '';
      const isNotFound = lastStatus === 404 || err.includes('not found');
      const isNotLoggedIn = err.includes('not currently logged in') || err.includes('not logged in') || err.includes('rest_forbidden');
      const urlHint = 'Use the full site URL only (e.g. https://yoursite.com), no trailing slash. If WordPress is in a subfolder use https://yoursite.com/folder.';
      let message: string;
      if (isNotFound) {
        message = `Site not found. ${urlHint}`;
      } else if (isNotLoggedIn) {
        message = 'WordPress REST API requires an Application Password, not your normal login password. In your WordPress admin go to Users → your profile → Application Passwords, create a new one, and paste it in the "Application Password" field above. Some hosts disable this; if you don’t see it, check your host’s docs or use a plugin that enables REST API auth.';
      } else {
        message = lastError || 'WordPress authentication failed. Try an Application Password (Users → Profile → Application Passwords).';
      }
      return res.status(400).json({ success: false, error: message });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const encrypted = encryptWordPressPassword(credentialToStore);
    const id = randomUUID();
    await dbQuery(
      `INSERT INTO wordpress_connections (id, user_id, site_url, username, app_password_encrypted)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET site_url = EXCLUDED.site_url, username = EXCLUDED.username, app_password_encrypted = EXCLUDED.app_password_encrypted`,
      [id, auth.userId, site, username, encrypted]
    );

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: site,
      accountName: String(username || '').trim() || null,
      status: 'connected',
    });
    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'connection_attempt',
      status: 'success',
      response: { siteUrl: site },
    });

    await ensureWordPressSocialAccount(auth.userId);

    return res.json({ success: true, message: 'WordPress Connected Successfully' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      logger.error('WordPress connect error:', err.message);
    }
    await logIntegrationEvent({
      userId: null,
      integrationSlug: 'wordpress',
      eventType: 'connection_attempt',
      status: 'failed',
      response: { error: err instanceof Error ? err.message : 'Connection failed' },
    });
    return res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// GET /api/wordpress/status (checks Make webhook first, then direct WordPress API)
router.get('/wordpress/status', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const webhookConn = await getMakeWebhookConnection(auth.userId);
    if (webhookConn) {
      return res.json({ success: true, connected: true, connectionType: 'make_webhook' });
    }
    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.json({ success: true, connected: false });
    }
    return res.json({ success: true, connected: true, connectionType: 'wordpress_api', siteUrl: conn.siteUrl });
  } catch (err) {
    logger.error('WordPress status error:', err);
    return res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// DELETE /api/wordpress/disconnect (removes both Make webhook and direct API connection)
router.delete('/wordpress/disconnect', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    if (!pool) {
      return res.json({ success: true });
    }
    await dbQuery('DELETE FROM make_webhook_connections WHERE user_id = $1', [auth.userId]);
    await dbQuery('DELETE FROM wordpress_connections WHERE user_id = $1', [auth.userId]);
    await removeWordPressSocialAccount(auth.userId);

    await upsertUserIntegration({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      accountId: null,
      accountName: null,
      status: 'disconnected',
    });
    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'disconnect',
      status: 'info',
      response: {},
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('WordPress disconnect error:', err);
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/wordpress/connect-webhook — validate and store Make webhook URL
const MAKE_TEST_PAYLOAD = {
  title: 'Connection Test',
  content: 'This is a test post from the web app.',
  status: 'draft',
};

router.post('/wordpress/connect-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const { webhookUrl } = req.body;
    const url = typeof webhookUrl === 'string' ? webhookUrl.trim() : '';
    if (!url || !isValidWebhookUrl(url)) {
      return res.status(400).json({ success: false, error: 'A valid webhook URL (https:// or http://) is required.' });
    }
    try {
      await assertSafePublicUrl(url);
    } catch {
      return res.status(400).json({ success: false, error: 'That webhook URL is not allowed (it points to a private or reserved address).' });
    }

    // Validate webhook by sending test request (do not log URL)
    let responseStatus: number;
    try {
      const axRes = await safeAxios({
        method: 'POST', url, data: MAKE_TEST_PAYLOAD,
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      });
      responseStatus = axRes.status;
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: err?.message || 'Webhook request failed. Check the URL and that your Make scenario is running.',
      });
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      return res.status(400).json({
        success: false,
        error: 'Webhook did not respond successfully. Ensure your Make scenario is active and the webhook URL is correct.',
      });
    }

    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    const encrypted = encryptWordPressPassword(url);
    const id = randomUUID();
    await dbQuery(
      `INSERT INTO make_webhook_connections (id, user_id, webhook_url_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET webhook_url_encrypted = EXCLUDED.webhook_url_encrypted`,
      [id, auth.userId, encrypted]
    );

    await ensureWordPressSocialAccount(auth.userId);

    return res.json({ success: true, message: 'WordPress (Make) connected successfully' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('webhook')) {
      logger.error('Connect webhook error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// DELETE /api/wordpress/disconnect-webhook
router.delete('/wordpress/disconnect-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (pool) {
      await dbQuery('DELETE FROM make_webhook_connections WHERE user_id = $1', [auth.userId]);
      await removeWordPressSocialAccount(auth.userId);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/wordpress/publish-webhook — send payload to stored Make webhook
router.post('/wordpress/publish-webhook', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const webhookConn = await getMakeWebhookConnection(auth.userId);
    if (!webhookConn) {
      return res.status(400).json({ success: false, error: 'WordPress (Make webhook) not connected' });
    }

    const webhookUrl = decryptWordPressPassword(webhookConn.webhookUrlEncrypted);
    const raw = req.body;

    const payload: Record<string, unknown> = {};
    if (typeof raw.title === 'string') payload.title = raw.title;
    if (typeof raw.content === 'string') payload.content = raw.content;
    if (typeof raw.excerpt === 'string') payload.excerpt = raw.excerpt;
    if (raw.status === 'draft' || raw.status === 'publish') payload.status = raw.status;
    if (typeof raw.featured_image === 'string') payload.featured_image = raw.featured_image;
    if (Array.isArray(raw.categories)) payload.categories = raw.categories.filter((c: unknown) => typeof c === 'string');
    if (Array.isArray(raw.tags)) payload.tags = raw.tags.filter((t: unknown) => typeof t === 'string');

    if (!payload.title && !payload.content) {
      return res.status(400).json({ success: false, error: 'Title or content is required' });
    }

    let axiosRes;
    try {
      // Re-validate at send time: the stored URL is trusted, but re-check
      // guards against a rebind to an internal host.
      axiosRes = await safeAxios({
        method: 'POST', url: webhookUrl, data: payload,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: () => true,
      });
    } catch {
      return res.status(400).json({ success: false, error: 'The stored webhook URL is no longer allowed.' });
    }

    if (axiosRes.status < 200 || axiosRes.status >= 300) {
      return res.status(502).json({
        success: false,
        error: 'Failed to publish to WordPress. Make scenario may have failed.',
      });
    }

    return res.json({ success: true, message: 'Post sent to WordPress successfully.' });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('webhook')) {
      logger.error('Publish webhook error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to publish to WordPress.' });
  }
});

// GET /api/wordpress/categories
router.get('/wordpress/categories', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', '/wp/v2/categories?per_page=100');
    if (status !== 200) {
      return res.status(400).json({ success: false, error: error || 'Failed to fetch categories' });
    }
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      logger.error('WordPress categories error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// GET /api/wordpress/tags
router.get('/wordpress/tags', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', '/wp/v2/tags?per_page=100');
    if (status !== 200) {
      return res.status(400).json({ success: false, error: error || 'Failed to fetch tags' });
    }
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      logger.error('WordPress tags error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch tags' });
  }
});

// POST /api/wordpress/publish — create post (optionally upload featured image, set meta)
// GET /api/wordpress/posts — import/list posts from WordPress
router.get('/wordpress/posts', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const page = Math.max(1, Number((req.query as any).page || 1));
    const perPage = Math.min(100, Math.max(1, Number((req.query as any).per_page || 20)));
    const status = String((req.query as any).status || '').trim();

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const path = `/wp/v2/posts?per_page=${perPage}&page=${page}${status ? `&status=${encodeURIComponent(status)}` : ''}`;
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', path);
    if (s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to fetch posts' });
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    logger.error('WordPress list posts error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// GET /api/wordpress/posts/:id — fetch a single post
router.get('/wordpress/posts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const postId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(postId)) return res.status(400).json({ success: false, error: 'Invalid post id' });

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'GET', `/wp/v2/posts/${postId}`);
    if (s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to fetch post' });
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('WordPress get post error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

// PATCH /api/wordpress/posts/:id — update a post
router.patch('/wordpress/posts/:id', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const postId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(postId)) return res.status(400).json({ success: false, error: 'Invalid post id' });

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, { data: payload });
    if (s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to update post' });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'post_updated',
      status: 'success',
      response: { postId: Number(postId) },
    });

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('WordPress update post error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// POST /api/wordpress/media/upload — upload media to WordPress
router.post('/wordpress/media/upload', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) return res.status(400).json({ success: false, error: 'WordPress not connected' });

    const { fileBase64, filename } = req.body as { fileBase64?: string; filename?: string };
    if (typeof fileBase64 !== 'string' || !fileBase64.trim()) return res.status(400).json({ success: false, error: 'fileBase64 is required' });
    const upload = decodeWordPressUpload(fileBase64, filename, 'upload.jpg');
    if (!upload.buffer.length) return res.status(400).json({ success: false, error: 'Invalid fileBase64' });

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', upload.buffer, { filename: upload.filename, contentType: upload.contentType });

    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
    const { data, status: s, error } = await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', '/wp/v2/media', { formData: form });
    if (s !== 201 && s !== 200) return res.status(400).json({ success: false, error: error || 'Failed to upload media' });

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'media_uploaded',
      status: 'success',
      response: { mediaId: data?.id || null },
    });

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('WordPress media upload error:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload media' });
  }
});

// POST /api/wordpress/publish — create post (optionally upload featured image, set meta)
router.post('/wordpress/publish', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const conn = await getWordPressConnection(auth.userId);
    if (!conn) {
      return res.status(400).json({ success: false, error: 'WordPress not connected' });
    }
    const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);

    const {
      title,
      content,
      excerpt,
      slug,
      status,
      categories,
      tags,
      author,
      featuredImageBase64,
      featuredImageFilename,
      seoTitle,
      seoDescription,
      focusKeyword,
    } = req.body;

    if (!title && !content) {
      return res.status(400).json({ success: false, error: 'Title or content is required' });
    }

    let featuredMediaId: number | undefined;
    if (featuredImageBase64 && typeof featuredImageBase64 === 'string') {
      const upload = decodeWordPressUpload(featuredImageBase64, typeof featuredImageFilename === 'string' ? featuredImageFilename : undefined, 'featured.jpg');
      if (!upload.buffer.length) return res.status(400).json({ success: false, error: 'Invalid featured image data' });
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', upload.buffer, { filename: upload.filename, contentType: upload.contentType });
      const { data: mediaData, status: mediaStatus, error: mediaError } = await wpRequest(
        conn.siteUrl,
        conn.username,
        appPassword,
        'POST',
        '/wp/v2/media',
        { formData: form as any }
      );
      if (mediaStatus !== 201 || !mediaData?.id) {
        return res.status(400).json({
          success: false,
          error: mediaError || 'Failed to upload featured image',
        });
      }
      featuredMediaId = mediaData.id;
    }

    const postPayload: Record<string, any> = {
      title: title || '',
      content: content || '',
      status: status === 'draft' ? 'draft' : 'publish',
    };
    if (excerpt !== undefined && excerpt !== '') postPayload.excerpt = excerpt;
    if (slug !== undefined && slug !== '') postPayload.slug = slug;
    if (Array.isArray(categories) && categories.length) postPayload.categories = categories;
    if (Array.isArray(tags) && tags.length) postPayload.tags = tags;
    if (author !== undefined && author !== '') postPayload.author = Number(author);
    if (featuredMediaId !== undefined) postPayload.featured_media = featuredMediaId;

    const { data: postData, status: postStatus, error: postError } = await wpRequest(
      conn.siteUrl,
      conn.username,
      appPassword,
      'POST',
      '/wp/v2/posts',
      { data: postPayload }
    );

    if (postStatus !== 201 && postStatus !== 200) {
      return res.status(400).json({ success: false, error: postError || 'Failed to create post' });
    }

    const postId = postData?.id;
    if (postId && (seoTitle || seoDescription || focusKeyword)) {
      const meta: Record<string, string> = {};
      if (seoTitle) {
        meta._yoast_wpseo_title = seoTitle;
        meta.rank_math_title = seoTitle;
      }
      if (seoDescription) {
        meta._yoast_wpseo_metadesc = seoDescription;
        meta.rank_math_description = seoDescription;
      }
      if (focusKeyword) {
        meta._yoast_wpseo_focuskw = focusKeyword;
        meta.rank_math_focus_keyword = focusKeyword;
      }
      await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, {
        data: { meta },
      });
    }

    const isDraft = postPayload.status === 'draft';

    await logIntegrationEvent({
      userId: auth.userId,
      integrationSlug: 'wordpress',
      eventType: 'post_published',
      status: 'success',
      response: { postId: postId || null, status: postPayload.status },
    });

    return res.json({
      success: true,
      message: isDraft ? 'Post Saved as Draft' : 'Post Published Successfully',
      data: { postId, link: postData?.link, status: postPayload.status },
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('password')) {
      logger.error('WordPress publish error:', err.message);
    }
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// Pricing Plans Routes
  return router;
}
