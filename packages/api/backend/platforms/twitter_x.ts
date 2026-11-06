import axios from 'axios';
import FormData from 'form-data';
import { fetchMediaBytes } from '../../src/ssrf-guard.ts';
import type {
  AnalyticsResult,
  PlatformContext,
  PlatformPostResult,
  PostMedia,
  PostObject,
  SocialPlatform,
  TokenRefreshResult,
  ValidationResult,
} from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TWITTER_MAX_TEXT = 280;

// Official v2 endpoints per docs.x.com
const X_API_BASE        = 'https://api.x.com';
const TWEET_API         = `${X_API_BASE}/2/tweets`;
const OAUTH_TOKEN_URL   = `${X_API_BASE}/2/oauth2/token`;

// v2 media upload endpoints from docs.x.com
const MEDIA_V2_UPLOAD     = `${X_API_BASE}/2/media/upload`;
const MEDIA_V2_INITIALIZE = `${X_API_BASE}/2/media/upload/initialize`;
const MEDIA_V2_APPEND     = (id: string) => `${X_API_BASE}/2/media/upload/${id}/append`;
const MEDIA_V2_FINALIZE   = (id: string) => `${X_API_BASE}/2/media/upload/${id}/finalize`;
const MEDIA_V2_STATUS     = `${X_API_BASE}/2/media/upload`;

// v1.1 fallback (still works when media.write scope is absent)
const MEDIA_V1_UPLOAD   = 'https://upload.twitter.com/1.1/media/upload.json';

const CHUNK_SIZE        = 5 * 1024 * 1024;   // 5 MB per chunk
const MAX_IMAGE_BYTES   = 5 * 1024 * 1024;   // 5 MB
const MAX_VIDEO_BYTES   = 512 * 1024 * 1024; // 512 MB

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);
const TRANSIENT_STATUSES  = new Set([429, 500, 502, 503, 504]);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Error parsing ────────────────────────────────────────────────────────────

function parseXError(data: any, httpStatus: number): { message: string; code?: number; retryable: boolean } {
  const errors: any[] = data?.errors || [];
  const firstErr = errors[0] || {};
  const code: number | undefined = firstErr.code ?? data?.status;
  const detail: string = data?.detail || firstErr.message || firstErr.detail || '';
  const title: string  = data?.title  || firstErr.title  || '';
  const reason: string = data?.reason || firstErr.reason || '';

  // "client-not-enrolled" — app not inside a Project in the developer portal
  if (reason === 'client-not-enrolled' || String(detail).includes('client-not-enrolled')) {
    return {
      message: 'X app is not attached to a Project. In the X Developer Portal, move your app inside a Project, then reconnect your X account.',
      retryable: false,
    };
  }

  const codeMessages: Record<number, string> = {
    32:  'Could not authenticate. Please reconnect your X account.',
    64:  'Your X account is suspended.',
    88:  'Rate limit reached. Try again in a few minutes.',
    89:  'Access token expired or invalid. Please reconnect your X account.',
    93:  'App is not allowed to access this resource.',
    135: 'Timestamp out of bounds. Check server time.',
    185: 'Daily post limit reached for this X account.',
    186: 'Tweet text is too long (max 280 characters).',
    187: 'Duplicate tweet — this exact text was posted recently.',
    215: 'Bad authentication data.',
    226: 'Tweet flagged as automated. Vary your content.',
    261: 'App does not have write permission. Enable "Read and Write" in the X Developer Portal.',
    326: 'X account is locked. Unlock it at x.com.',
    453: 'App not associated with an approved project. Set up your app in the X Developer Portal.',
  };

  const retryable = httpStatus === 429 || httpStatus >= 500 || code === 88;
  let message = (code && codeMessages[code]) || detail || title || `X API error (HTTP ${httpStatus})`;
  if (code && !codeMessages[code] && message === `X API error (HTTP ${httpStatus})`) {
    message = `X error ${code}: ${detail || title || message}`;
  }
  return { message, code, retryable };
}

// ─── Media upload ─────────────────────────────────────────────────────────────

type UploadResult = { mediaId: string } | { error: string };

/** Poll STATUS until processing completes (video/GIF). Returns true on success. */
async function pollMediaStatus(
  mediaId: string,
  authHeader: Record<string, string>,
  log: (msg: string) => void
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const statusResp: any = await axios.get(MEDIA_V2_STATUS, {
      params: { media_id: mediaId, command: 'STATUS' },
      headers: authHeader,
      validateStatus: () => true,
      timeout: 15_000,
    });
    const info: any = (statusResp.data as any)?.data?.processing_info || (statusResp.data as any)?.processing_info || {};
    const state: string = info?.state || 'succeeded';
    log(`[X] Media STATUS: ${state} (${info?.progress_percent ?? '?'}%)`);
    if (state === 'succeeded') return true;
    if (state === 'failed') return false;
    const waitSecs: number = info?.check_after_secs ?? 3;
    await wait(waitSecs * 1000);
  }
  return false; // timed out
}

/** Upload via the current X API v2 media endpoints documented on docs.x.com. */
async function uploadV2(
  buffer: Buffer,
  mimeType: string,
  mediaCategory: string,
  authHeader: Record<string, string>,
  log: (msg: string) => void
): Promise<UploadResult> {
  const totalBytes = buffer.byteLength;
  const useChunked = totalBytes > CHUNK_SIZE || mimeType.startsWith('video/') || mimeType === 'image/gif';
  log(`[X] v2 upload (${Math.round(totalBytes / 1024)} KB, ${mimeType}, chunked=${useChunked})`);

  // INIT — first chunk (or full file if ≤ CHUNK_SIZE)
  if (!useChunked) {
    const uploadForm = new FormData();
    uploadForm.append('media', buffer, { filename: 'upload', contentType: mimeType });
    uploadForm.append('media_category', mediaCategory);

    const uploadResp: any = await axios.post(MEDIA_V2_UPLOAD, uploadForm, {
      headers: { ...authHeader, ...uploadForm.getHeaders() },
      validateStatus: () => true,
      timeout: 60_000,
    });
    if (uploadResp.status >= 400) {
      const { message } = parseXError(uploadResp.data, uploadResp.status);
      return { error: `Media upload failed (${uploadResp.status}): ${message}` };
    }
    const uploadedMediaId = String((uploadResp.data as any)?.data?.id || '');
    return uploadedMediaId ? { mediaId: uploadedMediaId } : { error: 'No media id in upload response' };
  }

  const initResp: any = await axios.post(
    MEDIA_V2_INITIALIZE,
    {
      media_category: mediaCategory,
      media_type: mimeType,
      total_bytes: totalBytes,
    },
    {
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 20_000,
    }
  );
  if (initResp.status >= 400) {
    const { message } = parseXError(initResp.data, initResp.status);
    return { error: `Media initialize failed (${initResp.status}): ${message}` };
  }
  const mediaId = String((initResp.data as any)?.data?.id || '');
  if (!mediaId) return { error: 'No media id in initialize response' };
  log(`[X] INITIALIZE OK, id=${mediaId}`);

  // APPEND — remaining chunks (if file > CHUNK_SIZE)
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
    const appendForm = new FormData();
    appendForm.append('media', chunk, { filename: `seg_${segmentIndex}`, contentType: mimeType });
    appendForm.append('segment_index', String(segmentIndex));

    const appendResp: any = await axios.post(MEDIA_V2_APPEND(mediaId), appendForm, {
      headers: { ...authHeader, ...appendForm.getHeaders() },
      validateStatus: () => true,
      timeout: 120_000,
    });
    if (appendResp.status >= 400) {
      const { message } = parseXError(appendResp.data, appendResp.status);
      return { error: `Media append failed at segment ${segmentIndex} (${appendResp.status}): ${message}` };
    }
    log(`[X] APPEND segment ${segmentIndex} OK`);
    segmentIndex++;
  }

  const finalResp: any = await axios.post(MEDIA_V2_FINALIZE(mediaId), null, {
    headers: authHeader,
    validateStatus: () => true,
    timeout: 15_000,
  });
  if (finalResp.status >= 400) {
    const { message } = parseXError(finalResp.data, finalResp.status);
    return { error: `Media finalize failed (${finalResp.status}): ${message}` };
  }
  log(`[X] FINALIZE OK`);

  const finalData: any = (finalResp.data as any)?.data || finalResp.data || {};
  const needsPoll = ['pending', 'in_progress'].includes(finalData?.processing_info?.state || '');
  if (needsPoll) {
    const ok = await pollMediaStatus(mediaId, authHeader, log);
    if (!ok) return { error: 'Media processing failed after finalize' };
  }

  return { mediaId };
}

/** Upload via legacy v1.1 endpoint — fallback when media.write scope is absent. */
async function uploadV1(
  buffer: Buffer,
  mimeType: string,
  mediaCategory: string,
  authHeader: Record<string, string>,
  log: (msg: string) => void
): Promise<UploadResult> {
  const totalBytes = buffer.byteLength;
  const useChunked = totalBytes > CHUNK_SIZE || mimeType.startsWith('video/') || mimeType === 'image/gif';
  log(`[X] v1.1 upload (${Math.round(totalBytes / 1024)} KB, chunked=${useChunked})`);

  if (!useChunked) {
    // Simple multipart
    const form = new FormData();
    form.append('media', buffer, { filename: 'upload', contentType: mimeType });
    form.append('media_category', mediaCategory);
    const resp: any = await axios.post(MEDIA_V1_UPLOAD, form, {
      headers: { ...authHeader, ...form.getHeaders() },
      validateStatus: () => true,
      timeout: 60_000,
    });
    if (resp.status >= 400) return { error: `v1.1 upload failed (${resp.status})` };
    const mediaId = String((resp.data as any)?.media_id_string || '');
    return mediaId ? { mediaId } : { error: 'No media_id_string in v1.1 response' };
  }

  // Chunked: INIT
  const initParams = new URLSearchParams({
    command: 'INIT', total_bytes: String(totalBytes), media_type: mimeType, media_category: mediaCategory,
  });
  const initResp: any = await axios.post(MEDIA_V1_UPLOAD, initParams.toString(), {
    headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true, timeout: 15_000,
  });
  if (initResp.status >= 400) return { error: `v1.1 INIT failed (${initResp.status})` };
  const mediaId = String((initResp.data as any)?.media_id_string || '');
  if (!mediaId) return { error: 'No media_id_string from v1.1 INIT' };

  // APPEND
  let seg = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
    const appendForm = new FormData();
    appendForm.append('command', 'APPEND');
    appendForm.append('media_id', mediaId);
    appendForm.append('segment_index', String(seg));
    appendForm.append('media', chunk, { filename: `seg_${seg}`, contentType: mimeType });
    const appendResp: any = await axios.post(MEDIA_V1_UPLOAD, appendForm, {
      headers: { ...authHeader, ...appendForm.getHeaders() },
      validateStatus: () => true, timeout: 120_000,
    });
    if (appendResp.status >= 400) return { error: `v1.1 APPEND failed at seg ${seg} (${appendResp.status})` };
    seg++;
  }

  // FINALIZE
  const finalParams = new URLSearchParams({ command: 'FINALIZE', media_id: mediaId });
  const finalResp: any = await axios.post(MEDIA_V1_UPLOAD, finalParams.toString(), {
    headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true, timeout: 15_000,
  });
  if (finalResp.status >= 400) return { error: `v1.1 FINALIZE failed (${finalResp.status})` };

  // Poll STATUS
  const fd: any = finalResp.data || {};
  if (fd?.processing_info) {
    let waitSecs: number = fd.processing_info.check_after_secs ?? 3;
    for (let i = 0; i < 30; i++) {
      await wait(waitSecs * 1000);
      const statusResp: any = await axios.get(MEDIA_V1_UPLOAD, {
        params: { command: 'STATUS', media_id: mediaId },
        headers: authHeader, validateStatus: () => true, timeout: 15_000,
      });
      const sd: any = statusResp.data || {};
      const state: string = sd?.processing_info?.state || '';
      if (state === 'succeeded') break;
      if (state === 'failed') return { error: 'v1.1 media processing failed' };
      waitSecs = sd?.processing_info?.check_after_secs ?? 3;
    }
  }
  return { mediaId };
}

/** Fetch, validate, and upload one media item. Tries v2 first, falls back to v1.1. */
async function uploadMediaItem(
  item: PostMedia,
  accessToken: string,
  log: (msg: string) => void
): Promise<string | null> {
  const url = item.url || '';
  if (!url) return null;

  // Fetch the file (user-supplied URL: SSRF-guarded and size-capped)
  let buffer: Buffer;
  let mimeType: string;
  try {
    const fetched = await fetchMediaBytes(url, { maxBytes: MAX_VIDEO_BYTES, timeoutMs: 60_000 });
    buffer = fetched.buffer;
    mimeType = item.mimeType
      || (fetched.mimeType !== 'application/octet-stream' ? fetched.mimeType : '')
      || 'image/jpeg';
  } catch (err) {
    log(`[X] Media fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // Validate
  const isVideo = ALLOWED_VIDEO_TYPES.has(mimeType) || item.type === 'video';
  const isGif   = mimeType === 'image/gif'           || item.type === 'gif';
  const isImage = !isVideo && !isGif;

  if (isImage && !ALLOWED_IMAGE_TYPES.has(mimeType)) {
    log(`[X] Unsupported image type: ${mimeType}`); return null;
  }
  if (isVideo && !ALLOWED_VIDEO_TYPES.has(mimeType)) {
    log(`[X] Unsupported video type: ${mimeType}`); return null;
  }
  if (isImage && buffer.byteLength > MAX_IMAGE_BYTES) {
    log(`[X] Image too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB > 5 MB)`); return null;
  }
  if (isVideo && buffer.byteLength > MAX_VIDEO_BYTES) {
    log(`[X] Video too large (> 512 MB)`); return null;
  }

  const mediaCategory = isVideo ? 'tweet_video' : isGif ? 'tweet_gif' : 'tweet_image';
  const authHeader    = { Authorization: `Bearer ${accessToken}` };

  // Try v2 first; fall back to v1.1 on auth errors (missing media.write scope)
  const v2Result = await uploadV2(buffer, mimeType, mediaCategory, authHeader, log);
  if ('mediaId' in v2Result) return v2Result.mediaId;

  log(`[X] v2 upload failed (${v2Result.error}), trying v1.1 fallback`);
  const v1Result = await uploadV1(buffer, mimeType, mediaCategory, authHeader, log);
  if ('mediaId' in v1Result) return v1Result.mediaId;

  log(`[X] All upload methods failed: ${v1Result.error}`);
  return null;
}

// ─── Helpers type ─────────────────────────────────────────────────────────────

type TwitterHelpers = {
  getGlobalWriteCount?: () => number;
  incrementGlobalWriteCount?: () => void;
  monthlyWriteLimit?: number;
  clientId?: string;
  clientSecret?: string;
};

// ─── Platform class ───────────────────────────────────────────────────────────

export class TwitterXPlatform implements SocialPlatform {
  id   = 'twitter';
  name = 'Twitter / X';

  handleError(error: any): { retryable: boolean; message: string } {
    const status: number | undefined = error?.response?.status;
    const data = error?.response?.data;
    if (data) {
      const parsed = parseXError(data, status ?? 0);
      return { retryable: parsed.retryable, message: parsed.message };
    }
    const msg = error instanceof Error ? error.message : 'X / Twitter error';
    return { retryable: status === 429 || (typeof status === 'number' && status >= 500), message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    if (!text) return { ok: false, error: 'X post requires text.', code: 'TEXT_REQUIRED' };
    if (text.length > TWITTER_MAX_TEXT) {
      return { ok: false, error: `X text exceeds ${TWITTER_MAX_TEXT} characters (${text.length}).`, code: 'TEXT_TOO_LONG' };
    }
    if (Array.isArray(post.media) && post.media.length > 4) {
      return { ok: false, error: 'X supports up to 4 images or 1 video per tweet.', code: 'MEDIA_LIMIT' };
    }
    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    const log = ctx.logger?.info.bind(ctx.logger)
      ?? ((...args: any[]) => console.log('[TwitterXPlatform]', ...args));

    try {
      const helpers = (ctx.helpers || {}) as TwitterHelpers;

      // Monthly write limit guard
      const limit = helpers.monthlyWriteLimit ?? Number(process.env.TWITTER_MONTHLY_WRITE_LIMIT || 0);
      if (limit > 0 && (helpers.getGlobalWriteCount?.() ?? 0) >= limit) {
        return { status: 'failed', error: `X posting paused: monthly write limit of ${limit} reached.`, retryable: false };
      }

      const text = String(post?.content?.text || '').trim().slice(0, TWITTER_MAX_TEXT);
      const body: Record<string, any> = { text };

      // Media upload (non-fatal: the post goes out text-only if every upload fails)
      const mediaItems = Array.isArray(post.media) ? post.media.slice(0, 4) : [];
      // Uploads need the media.write scope. A token granted without it would
      // fail every attempt, so skip straight to text-only and say why.
      const grantedScopes = String(ctx.tokenData?.scope || '').split(/[\s,]+/).filter(Boolean);
      let mediaWarning: string | undefined;
      if (mediaItems.length > 0 && grantedScopes.length > 0 && !grantedScopes.includes('media.write')) {
        mediaWarning = 'Image not attached: this X connection was approved without media upload access. Reconnect X to post images.';
        log(`[X] ${mediaWarning}`);
      } else if (mediaItems.length > 0) {
        log(`[X] Uploading ${mediaItems.length} media item(s)…`);
        const mediaIds: string[] = [];
        for (const item of mediaItems) {
          const mediaId = await uploadMediaItem(item, ctx.accessToken, log);
          if (mediaId) mediaIds.push(mediaId);
        }
        if (mediaIds.length > 0) {
          body.media = { media_ids: mediaIds };
          log(`[X] Attached media_ids: ${mediaIds.join(', ')}`);
        } else {
          mediaWarning = 'Image not attached: X rejected the media upload, so the post went out as text only.';
          log('[X] All media uploads failed — posting text-only');
        }
      }

      log(`[X] POST /2/tweets: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);

      // Up to 2 attempts for transient errors
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const resp: any = await axios.post(TWEET_API, body, {
            headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
            validateStatus: () => true,
            timeout: 20_000,
          });

          const rateLimit = {
            limit:     resp.headers?.['x-rate-limit-limit'],
            remaining: resp.headers?.['x-rate-limit-remaining'],
            reset:     resp.headers?.['x-rate-limit-reset'],
          };

          if (resp.status >= 400) {
            const { message, retryable } = parseXError(resp.data, resp.status);
            log(`[X] Failed (${resp.status}): ${message}`);
            if (retryable && attempt < 2 && TRANSIENT_STATUSES.has(resp.status)) {
              log('[X] Transient error — retrying in 2s');
              await wait(2000);
              continue;
            }
            return { status: 'failed', error: message, retryable, raw: { ...resp.data, rateLimit } };
          }

          helpers.incrementGlobalWriteCount?.();
          const tweetId: string = (resp.data as any)?.data?.id || '';
          log(`[X] Published — id=${tweetId}`);
          return { status: 'published', platformPostId: tweetId, warning: mediaWarning, raw: { ...(resp.data as any), rateLimit } };

        } catch (err: any) {
          const { retryable, message } = this.handleError(err);
          if (retryable && attempt < 2 && TRANSIENT_STATUSES.has(Number(err?.response?.status))) {
            log(`[X] Request error (attempt ${attempt}): ${message} — retrying in 2s`);
            await wait(2000);
            continue;
          }
          return { status: 'failed', error: message, retryable };
        }
      }

      return { status: 'failed', error: 'X publish failed after retry', retryable: true };
    } catch (err) {
      const { retryable, message } = this.handleError(err);
      return { status: 'failed', error: message, retryable };
    }
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const resp: any = await axios.get(
        `${X_API_BASE}/2/tweets/${encodeURIComponent(postId)}`,
        {
          params: { 'tweet.fields': 'public_metrics,non_public_metrics,organic_metrics,created_at' },
          headers: { Authorization: `Bearer ${ctx.accessToken}` },
          validateStatus: () => true,
          timeout: 15_000,
        }
      );
      const raw: any = resp.data || {};
      if (resp.status >= 400) return { raw };
      const pub     = raw?.data?.public_metrics  || {};
      const organic = raw?.data?.organic_metrics || {};
      return {
        likes:       pub.like_count,
        comments:    pub.reply_count,
        shares:      (pub.retweet_count || 0) + (pub.quote_count || 0),
        impressions: organic.impression_count ?? pub.impression_count,
        clicks:      organic.url_link_clicks,
        raw:         { public_metrics: pub, organic_metrics: organic },
      };
    } catch (err) {
      return { raw: { error: err instanceof Error ? err.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers    = (ctx.helpers || {}) as TwitterHelpers;
      const clientId   = (helpers.clientId   || process.env.TWITTER_CLIENT_ID || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
      const clientSecret = (helpers.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();

      if (!clientId)        return { ok: false, error: 'Twitter client_id not configured.' };
      if (!ctx.refreshToken) return { ok: false, error: 'No refresh token available. Please reconnect your X account.' };

      // Confidential clients: credentials via Basic auth only (not in body)
      const body = new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: ctx.refreshToken,
      });

      const resp: any = await axios.post(OAUTH_TOKEN_URL, body.toString(), {
        auth:            clientSecret ? { username: clientId, password: clientSecret } : undefined,
        headers:         { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus:  () => true,
        timeout:         15_000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error_description || data?.error || 'Token refresh failed.' };
      }
      const expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : undefined;
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Token refresh failed.' };
    }
  }
}

