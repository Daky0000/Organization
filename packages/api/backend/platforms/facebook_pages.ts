import axios from 'axios';
import { META_GRAPH_BASE } from '../../src/meta-graph.ts';
import { fetchMediaBytes } from '../../src/ssrf-guard.ts';
import type {
  AnalyticsResult,
  PlatformContext,
  PlatformPostResult,
  PostObject,
  SocialPlatform,
  TokenRefreshResult,
  ValidationResult,
} from './types.js';

type ResolvePageTokenResult = {
  pageId: string;
  pageToken: string;
  pageName?: string;
};

type FacebookHelpers = {
  resolvePageToken?: (destination?: { type?: string; id?: string; name?: string }) => Promise<ResolvePageTokenResult | null>;
  graphBase?: string;
  appId?: string;
  appSecret?: string;
};

const FACEBOOK_MAX_TEXT = 63206;
const FACEBOOK_SUPPORTED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']);
const GRAPH_BASE = META_GRAPH_BASE;

// Facebook long-lived user tokens last ~60 days; refresh at 50-day safety margin
const FB_TOKEN_REFRESH_MARGIN_DAYS = 10;

// Meta reports throttling as HTTP 400 with these error codes (app, user, page
// and account-level rate limits), so the status alone undercounts retries.
const META_RETRYABLE_ERROR_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

const isRetryableStatus = (status?: number, data?: any) =>
  status === 429 ||
  (typeof status === 'number' && status >= 500) ||
  META_RETRYABLE_ERROR_CODES.has(Number(data?.error?.code));

export class FacebookPagesPlatform implements SocialPlatform {
  id = 'facebook';
  name = 'Facebook Pages';

  handleError(error: any): { retryable: boolean; message: string } {
    const msg = error?.response?.data?.error?.message
      || (error instanceof Error ? error.message : 'Facebook error');
    const status = error?.response?.status;
    const code = error?.response?.data?.error?.code;
    // Code 190 = token expired/invalid; 32/341 = rate limit
    const retryable = status === 429 || status >= 500 || code === 32 || code === 341;
    return { retryable, message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    const link = String(post?.content?.link || '').trim();

    if (!text && !link) {
      return { ok: false, error: 'Facebook post requires text or a link.' };
    }
    if (text.length > FACEBOOK_MAX_TEXT) {
      return { ok: false, error: `Facebook text exceeds max ${FACEBOOK_MAX_TEXT} characters.` };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > 1) {
      return { ok: false, error: 'Facebook multi-media posts are not supported yet.' };
    }
    if (media.length === 1) {
      const mime = String(media[0]?.mimeType || '').toLowerCase();
      if (mime && !FACEBOOK_SUPPORTED_MEDIA.has(mime)) {
        return { ok: false, error: 'Unsupported media type for Facebook. Use JPEG, PNG, WebP, GIF, or MP4.' };
      }
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const helpers = (ctx.helpers || {}) as FacebookHelpers;
      if (!helpers.resolvePageToken) {
        return { status: 'failed', error: 'Facebook page resolver not configured.' };
      }

      const destination = post?.destination;
      if (destination?.type && destination.type !== 'page') {
        return { status: 'failed', error: 'Facebook Pages only. Groups and personal profiles are not supported.' };
      }

      const page = await helpers.resolvePageToken(destination);
      if (!page?.pageId || !page.pageToken) {
        return { status: 'failed', error: 'Facebook Page access token not available.' };
      }

      const graphBase = helpers.graphBase || GRAPH_BASE;
      const text = String(post?.content?.text || '').trim();
      const link = String(post?.content?.link || '').trim();
      const media = Array.isArray(post.media) ? post.media : [];

      // Video post — resumable upload
      if (media.length === 1) {
        const item = media[0];
        const mime = String(item?.mimeType || '').toLowerCase();

        if (mime.startsWith('video/') || item?.type === 'video') {
          return await this._postVideo(graphBase, page.pageId, page.pageToken, item.url, text);
        }

        // Image post
        if ((mime.startsWith('image/') || item?.type === 'image') && item?.url) {
          // Base64 data URL — upload binary directly via multipart source field
          if (item.url.startsWith('data:')) {
            const match = item.url.match(/^data:(image\/[^;]+);base64,(.+)$/s);
            if (!match) {
              return { status: 'failed', error: 'Invalid base64 image data URL.' };
            }
            const [, imageMime, base64Data] = match;
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const ext = imageMime.split('/')[1]?.split('+')[0] || 'jpg';
            const FormData = (await import('form-data')).default;
            const form = new FormData();
            form.append('source', imageBuffer, { filename: `image.${ext}`, contentType: imageMime });
            form.append('caption', text);
            form.append('published', 'true');
            form.append('access_token', page.pageToken);
            const binaryResp = await axios.post(
              `${graphBase}/${encodeURIComponent(page.pageId)}/photos`,
              form,
              { headers: form.getHeaders(), validateStatus: () => true, timeout: 30000 }
            );
            const binaryData: any = binaryResp.data || {};
            if (binaryResp.status >= 400) {
              return {
                status: 'failed',
                error: binaryData?.error?.message || `Facebook API error ${binaryResp.status}`,
                code: binaryData?.error?.code ? String(binaryData.error.code) : undefined,
                retryable: isRetryableStatus(binaryResp.status, binaryData),
                raw: binaryData,
              };
            }
            return { status: 'published', platformPostId: String(binaryData?.id || ''), raw: binaryData };
          }

          // Public HTTPS URL — use url param
          const body = new URLSearchParams({
            url: item.url,
            caption: text,
            access_token: page.pageToken,
            published: 'true',
          });
          const resp = await axios.post(
            `${graphBase}/${encodeURIComponent(page.pageId)}/photos`,
            body.toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
          );
          const data: any = resp.data || {};
          if (resp.status >= 400) {
            return {
              status: 'failed',
              error: data?.error?.message || `Facebook API error ${resp.status}`,
              code: data?.error?.code ? String(data.error.code) : undefined,
              retryable: isRetryableStatus(resp.status, data),
              raw: data,
            };
          }
          return { status: 'published', platformPostId: String(data?.id || ''), raw: data };
        }
      }

      // Text/link feed post
      const body = new URLSearchParams({
        message: text,
        ...(link ? { link } : {}),
        access_token: page.pageToken,
      });
      const resp = await axios.post(
        `${graphBase}/${encodeURIComponent(page.pageId)}/feed`,
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 }
      );
      const data: any = resp.data || {};
      if (resp.status >= 400) {
        return {
          status: 'failed',
          error: data?.error?.message || `Facebook API error ${resp.status}`,
          code: data?.error?.code ? String(data.error.code) : undefined,
          retryable: isRetryableStatus(resp.status, data),
          raw: data,
        };
      }
      return { status: 'published', platformPostId: String(data?.id || ''), raw: data };
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  // Resumable Video Upload: Init → Upload → Publish
  private async _postVideo(
    graphBase: string,
    pageId: string,
    pageToken: string,
    videoUrl: string,
    description: string,
  ): Promise<PlatformPostResult> {
    try {
      // Step 1: Fetch video to buffer (user-supplied URL: SSRF-guarded, size-capped)
      const { buffer: videoBuffer } = await fetchMediaBytes(videoUrl, { maxBytes: 1024 * 1024 * 1024, timeoutMs: 120_000 });
      const fileSize = videoBuffer.length;

      // Step 2: Initialize resumable upload session
      const initResp = await axios.post(
        `${graphBase}/${encodeURIComponent(pageId)}/videos`,
        new URLSearchParams({
          upload_phase: 'start',
          file_size: String(fileSize),
          access_token: pageToken,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 }
      );
      const initData: any = initResp.data || {};
      if (initResp.status >= 400 || !initData.upload_session_id) {
        return { status: 'failed', error: initData?.error?.message || 'Facebook video init failed.', retryable: isRetryableStatus(initResp.status, initData) };
      }

      const sessionId = initData.upload_session_id;
      const videoId = initData.video_id;

      // Step 3: Upload (transfer phase) — single chunk for simplicity; chunk if needed
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('upload_phase', 'transfer');
      form.append('upload_session_id', sessionId);
      form.append('start_offset', '0');
      form.append('video_file_chunk', videoBuffer, { filename: 'video.mp4', contentType: 'video/mp4' });
      form.append('access_token', pageToken);

      const uploadResp = await axios.post(
        `${graphBase}/${encodeURIComponent(pageId)}/videos`,
        form,
        { headers: form.getHeaders(), validateStatus: () => true, timeout: 120000 }
      );
      const uploadData: any = uploadResp.data || {};
      if (uploadResp.status >= 400) {
        return { status: 'failed', error: uploadData?.error?.message || 'Facebook video upload failed.', retryable: isRetryableStatus(uploadResp.status, uploadData) };
      }

      // Step 4: Finish / publish
      const finishResp = await axios.post(
        `${graphBase}/${encodeURIComponent(pageId)}/videos`,
        new URLSearchParams({
          upload_phase: 'finish',
          upload_session_id: sessionId,
          description,
          published: 'true',
          access_token: pageToken,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 }
      );
      const finishData: any = finishResp.data || {};
      if (finishResp.status >= 400) {
        return { status: 'failed', error: finishData?.error?.message || 'Facebook video publish failed.', retryable: isRetryableStatus(finishResp.status, finishData) };
      }
      return { status: 'published', platformPostId: String(videoId || finishData?.id || ''), raw: finishData };
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const helpers = (ctx.helpers || {}) as FacebookHelpers;
      const pageToken = ctx.accessToken;
      const graphBase = helpers.graphBase || GRAPH_BASE;

      const resp = await axios.get(
        `${graphBase}/${encodeURIComponent(postId)}/insights`,
        {
          params: {
            metric: 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks',
            access_token: pageToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const raw: any = resp.data || {};
      if (resp.status >= 400) return { raw };

      const metrics: Record<string, number> = {};
      for (const item of raw.data || []) {
        metrics[item.name] = item.values?.[0]?.value ?? 0;
      }

      // Also fetch reactions/comments/shares from the post object
      const postResp = await axios.get(
        `${graphBase}/${encodeURIComponent(postId)}`,
        {
          params: { fields: 'reactions.summary(true),comments.summary(true),shares', access_token: pageToken },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const postData: any = postResp.data || {};
      return {
        likes: postData?.reactions?.summary?.total_count,
        comments: postData?.comments?.summary?.total_count,
        shares: postData?.shares?.count,
        impressions: metrics['post_impressions'],
        reach: metrics['post_impressions_unique'],
        clicks: metrics['post_clicks'],
        raw: { insights: metrics, post: postData },
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as FacebookHelpers;
      const appId = helpers.appId || process.env.FACEBOOK_APP_ID || '';
      const appSecret = helpers.appSecret || process.env.FACEBOOK_APP_SECRET || '';
      if (!appId || !appSecret) {
        return { ok: false, error: 'Facebook app credentials not configured.' };
      }

      const resp = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: ctx.accessToken,
        },
        validateStatus: () => true,
        timeout: 15000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error?.message || 'Facebook token refresh failed.' };
      }

      // Expires_in is in seconds; default 60 days
      const expiresSeconds = data.expires_in || 60 * 24 * 3600;
      const expiresAt = new Date(Date.now() + expiresSeconds * 1000);
      return { ok: true, accessToken: data.access_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Facebook token refresh failed.' };
    }
  }
}
