import axios from 'axios';
import { INSTAGRAM_GRAPH_BASE, META_GRAPH_BASE } from '../../src/meta-graph.ts';
import type {
  AnalyticsResult,
  PlatformContext,
  PlatformPostResult,
  PostObject,
  SocialPlatform,
  TokenRefreshResult,
  ValidationResult,
} from './types.js';

type InstagramHelpers = {
  graphBase?: string;
  appId?: string;
  appSecret?: string;
};

const INSTAGRAM_MAX_CAPTION = 2200;
const GRAPH_BASE = META_GRAPH_BASE;
const IG_GRAPH_BASE = INSTAGRAM_GRAPH_BASE;

function resolveGraphBase(accessToken: string, helpers?: InstagramHelpers): string {
  if (helpers?.graphBase) return helpers.graphBase;
  if (String(accessToken || '').trim().startsWith('IG')) return IG_GRAPH_BASE;
  return GRAPH_BASE;
}

// Meta reports throttling as HTTP 400 with these codes; 9007 means the media
// container was not ready yet.
const META_RETRYABLE_ERROR_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 9007]);

const isRetryableStatus = (status?: number, data?: any) =>
  status === 429 ||
  (typeof status === 'number' && status >= 500) ||
  META_RETRYABLE_ERROR_CODES.has(Number(data?.error?.code));

const isVideoItem = (item: any) => {
  const mime = String(item?.mimeType || '').toLowerCase();
  return mime.startsWith('video/') || item?.type === 'video' || item?.type === 'reel';
};

type ContainerWait = { ready: true } | { ready: false; error: string; retryable: boolean };

// Containers must reach FINISHED before media_publish. Images are usually
// ready at once; video is transcoded and takes longer.
const IMAGE_WAIT = { attempts: 10, intervalMs: 2000 };
const VIDEO_WAIT = { attempts: 30, intervalMs: 5000 };

export class InstagramBusinessPlatform implements SocialPlatform {
  id = 'instagram';
  name = 'Instagram Business';

  handleError(error: any): { retryable: boolean; message: string } {
    const msg = error?.response?.data?.error?.message
      || (error instanceof Error ? error.message : 'Instagram error');
    const status = error?.response?.status;
    // Code 190 = token expired; 10/200 = permission errors (not retryable)
    return { retryable: isRetryableStatus(status, error?.response?.data), message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (text.length > INSTAGRAM_MAX_CAPTION) {
      return { ok: false, error: `Instagram caption exceeds max ${INSTAGRAM_MAX_CAPTION} characters.` };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    const postType = String(post?.type || 'FEED_POST').toUpperCase();

    if (postType === 'STORY') {
      if (!media.length) return { ok: false, error: 'Instagram Stories require at least one image or video.' };
      return { ok: true };
    }

    if (postType === 'REEL') {
      if (!media.length) return { ok: false, error: 'Instagram Reels require a video.' };
      if (!isVideoItem(media[0])) return { ok: false, error: 'Instagram Reels require a video file.' };
      return { ok: true };
    }

    // Feed post
    if (!media.length) {
      return { ok: false, error: 'Instagram feed posts require at least one image.' };
    }
    if (media.length > 10) {
      return { ok: false, error: 'Instagram carousel supports up to 10 images.' };
    }
    for (const item of media) {
      const mime = String(item?.mimeType || '').toLowerCase();
      if (mime && !mime.startsWith('image/') && !mime.startsWith('video/')) {
        return { ok: false, error: 'Instagram supports images and videos only.' };
      }
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const igUserId = String(ctx.accountId || '').trim();
      if (!igUserId) return { status: 'failed', error: 'Instagram account ID is missing.' };

      // Pre-flight: verify this is a Business/Creator account
      const accountCheck = await this._verifyBusinessAccount(igUserId, ctx.accessToken, ctx.helpers as InstagramHelpers);
      if (!accountCheck.ok) return { status: 'failed', error: accountCheck.error };

      const postType = String(post?.type || 'FEED_POST').toUpperCase();
      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const graphBase = resolveGraphBase(ctx.accessToken, helpers);
      const media = Array.isArray(post.media) ? post.media : [];
      const caption = String(post?.content?.text || '').trim();

      if (postType === 'STORY') {
        return await this._postStory(graphBase, igUserId, ctx.accessToken, media[0]);
      }
      if (media.length > 1) {
        return await this._postCarousel(graphBase, igUserId, ctx.accessToken, media, caption);
      }

      const item = media[0];
      if (!item?.url) return { status: 'failed', error: 'Instagram image URL is missing.' };

      // A single feed video is a Reel: the VIDEO media type was retired for
      // feed posts in November 2023 and is rejected.
      const isVideo = postType === 'REEL' || isVideoItem(item);
      const params: Record<string, string> = isVideo
        ? { media_type: 'REELS', video_url: item.url, caption }
        : { image_url: item.url, caption };
      return await this._createAndPublish(graphBase, igUserId, ctx.accessToken, params, isVideo ? VIDEO_WAIT : IMAGE_WAIT);
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  private async _verifyBusinessAccount(
    igUserId: string,
    accessToken: string,
    helpers: InstagramHelpers,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const graphBase = resolveGraphBase(accessToken, helpers);
      const resp = await axios.get(`${graphBase}/${encodeURIComponent(igUserId)}`, {
        params: { fields: 'account_type,username', access_token: accessToken },
        validateStatus: () => true,
        timeout: 10000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400) return { ok: true }; // Don't block posting on lookup failure
      const accountType: string = String(data?.account_type || '').toUpperCase();
      if (accountType && accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR') {
        return {
          ok: false,
          error: 'Instagram publishing requires a Business or Creator account. Go to Instagram Settings → Account → Switch to Professional Account.',
        };
      }
      return { ok: true };
    } catch {
      return { ok: true }; // Don't block on network error during check
    }
  }

  private async _createContainer(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    params: Record<string, string>,
  ): Promise<{ id: string } | { error: PlatformPostResult }> {
    const resp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media`,
      new URLSearchParams({ ...params, access_token: accessToken }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 30000 }
    );
    const data: any = resp.data || {};
    if (resp.status >= 400 || !data?.id) {
      return {
        error: {
          status: 'failed',
          error: data?.error?.message || `Instagram media create failed (${resp.status})`,
          code: data?.error?.code ? String(data.error.code) : undefined,
          retryable: isRetryableStatus(resp.status, data),
          raw: data,
        },
      };
    }
    return { id: String(data.id) };
  }

  private async _waitForContainer(
    graphBase: string,
    containerId: string,
    accessToken: string,
    wait: { attempts: number; intervalMs: number },
  ): Promise<ContainerWait> {
    for (let i = 0; i < wait.attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, wait.intervalMs));
      const resp = await axios.get(`${graphBase}/${encodeURIComponent(containerId)}`, {
        params: { fields: 'status_code,status', access_token: accessToken },
        validateStatus: () => true,
        timeout: 10000,
      }).catch(() => null);
      const data: any = resp?.data || {};
      const statusCode = String(data?.status_code || '').toUpperCase();
      if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') return { ready: true };
      if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
        return { ready: false, error: `Instagram could not process the media${data?.status ? ` (${data.status})` : ''}.`, retryable: false };
      }
    }
    return { ready: false, error: 'Instagram is still processing the media; the post will be retried.', retryable: true };
  }

  private async _publishContainer(graphBase: string, igUserId: string, accessToken: string, creationId: string): Promise<PlatformPostResult> {
    const pubResp = await axios.post(
      `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
      new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 20000 }
    );
    const pubData: any = pubResp.data || {};
    if (pubResp.status >= 400) {
      return {
        status: 'failed',
        error: pubData?.error?.message || `Instagram publish failed (${pubResp.status})`,
        code: pubData?.error?.code ? String(pubData.error.code) : undefined,
        retryable: isRetryableStatus(pubResp.status, pubData),
        raw: pubData,
      };
    }
    return { status: 'published', platformPostId: String(pubData?.id || creationId), raw: pubData };
  }

  private async _createAndPublish(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    params: Record<string, string>,
    wait: { attempts: number; intervalMs: number },
  ): Promise<PlatformPostResult> {
    const container = await this._createContainer(graphBase, igUserId, accessToken, params);
    if ('error' in container) return container.error;
    const ready = await this._waitForContainer(graphBase, container.id, accessToken, wait);
    if (!ready.ready) return { status: 'failed', error: ready.error, retryable: ready.retryable };
    return this._publishContainer(graphBase, igUserId, accessToken, container.id);
  }

  private async _postStory(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    item: any,
  ): Promise<PlatformPostResult> {
    if (!item?.url) return { status: 'failed', error: 'Instagram Story media URL is missing.' };
    // Stories use their own media type; captions are not supported on them.
    const isVideo = isVideoItem(item);
    const params: Record<string, string> = { media_type: 'STORIES', ...(isVideo ? { video_url: item.url } : { image_url: item.url }) };
    return this._createAndPublish(graphBase, igUserId, accessToken, params, isVideo ? VIDEO_WAIT : IMAGE_WAIT);
  }

  private async _postCarousel(
    graphBase: string,
    igUserId: string,
    accessToken: string,
    media: any[],
    caption: string,
  ): Promise<PlatformPostResult> {
    const childIds: string[] = [];
    for (const item of media) {
      const isVideo = isVideoItem(item);
      const params: Record<string, string> = isVideo
        ? { is_carousel_item: 'true', media_type: 'VIDEO', video_url: item.url }
        : { is_carousel_item: 'true', image_url: item.url };
      const child = await this._createContainer(graphBase, igUserId, accessToken, params);
      if ('error' in child) return { ...child.error, error: child.error.error || 'Instagram carousel item failed.' };
      // Every child must be processed before the carousel container references it.
      const ready = await this._waitForContainer(graphBase, child.id, accessToken, isVideo ? VIDEO_WAIT : IMAGE_WAIT);
      if (!ready.ready) return { status: 'failed', error: ready.error, retryable: ready.retryable };
      childIds.push(child.id);
    }

    return this._createAndPublish(
      graphBase,
      igUserId,
      accessToken,
      { media_type: 'CAROUSEL', children: childIds.join(','), caption },
      IMAGE_WAIT,
    );
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const graphBase = resolveGraphBase(ctx.accessToken, helpers);

      // "impressions" was retired in favour of "views" (Graph v22+); asking
      // for a retired metric fails the whole request, so fall back to a
      // smaller set rather than losing every number.
      const metricSets = [
        'views,reach,likes,comments,shares,saved,total_interactions',
        'reach,likes,comments,saved',
      ];
      let raw: any = {};
      for (const metric of metricSets) {
        const resp = await axios.get(`${graphBase}/${encodeURIComponent(postId)}/insights`, {
          params: { metric, access_token: ctx.accessToken },
          validateStatus: () => true,
          timeout: 15000,
        });
        raw = resp.data || {};
        if (resp.status < 400) break;
      }
      if (!Array.isArray(raw?.data)) return { raw };

      const metrics: Record<string, number> = {};
      for (const item of raw.data || []) {
        metrics[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? item.value ?? 0;
      }
      return {
        impressions: metrics['views'] ?? metrics['impressions'],
        reach: metrics['reach'],
        likes: metrics['likes'],
        comments: metrics['comments'],
        shares: metrics['shares'],
        saves: metrics['saved'],
        raw: metrics,
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as InstagramHelpers;
      const token = String(ctx.accessToken || '').trim();
      const isDirectIg = token.startsWith('IG') || Boolean(helpers.graphBase && helpers.graphBase.includes('graph.instagram.com'));

      if (isDirectIg) {
        // Instagram API with Instagram Login: refresh long-lived token via graph.instagram.com/refresh_access_token
        const resp = await axios.get('https://graph.instagram.com/refresh_access_token', {
          params: { grant_type: 'ig_refresh_token', access_token: token },
          validateStatus: () => true,
          timeout: 15000,
        });
        const data: any = resp.data || {};
        if (resp.status >= 400 || !data.access_token) {
          return { ok: false, error: data?.error?.message || 'Instagram token refresh failed.' };
        }
        const expiresAt = new Date(Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000);
        return { ok: true, accessToken: data.access_token, expiresAt };
      }

      // Instagram API with Facebook Login: refresh via fb_exchange_token
      const appId = helpers.appId || process.env.FACEBOOK_APP_ID || '';
      const appSecret = helpers.appSecret || process.env.FACEBOOK_APP_SECRET || '';
      if (!appId || !appSecret) return { ok: false, error: 'Instagram/Facebook app credentials not configured.' };

      const resp = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token },
        validateStatus: () => true,
        timeout: 15000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error?.message || 'Instagram token refresh failed.' };
      }
      const expiresAt = new Date(Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000);
      return { ok: true, accessToken: data.access_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Instagram token refresh failed.' };
    }
  }
}
