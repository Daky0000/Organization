import axios from 'axios';
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

type LinkedInHelpers = {
  resolveAuthorUrn?: (ctx: PlatformContext) => Promise<string | null>;
  clientId?: string;
  clientSecret?: string;
  clientSecrets?: string[];
  redirectUri?: string;
};

const LINKEDIN_API = 'https://api.linkedin.com';
const LINKEDIN_MARKETING_VERSION = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';
const LINKEDIN_MAX_TEXT = 3000;
const LINKEDIN_MAX_TITLE = 200;
const LINKEDIN_MAX_IMAGES = 9;

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

function restHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function getLinkedInClientSecrets(helpers: LinkedInHelpers): string[] {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(helpers.clientSecrets) ? helpers.clientSecrets : []),
        helpers.clientSecret,
        process.env.LINKEDIN_CLIENT_SECRET,
        process.env.LINKEDIN_CLIENT_SECRET_PREVIOUS,
        process.env.LINKEDIN_CLIENT_SECRET_ALT,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function shouldRetryLinkedInSecret(status: number, payload: any): boolean {
  const errorCode = String(payload?.error || payload?.code || '').trim().toLowerCase();
  return status === 401 || errorCode === 'invalid_client' || errorCode === 'unauthorized_client';
}

function buildBasePost(authorUrn: string, commentary: string) {
  return {
    author: authorUrn,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
}

function extractResponseEntityId(response: any): string {
  const headerValue = response?.headers?.['x-restli-id'];
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  if (Array.isArray(headerValue) && typeof headerValue[0] === 'string' && headerValue[0].trim()) {
    return headerValue[0].trim();
  }
  return String(response?.data?.id || '').trim();
}

// LinkedIn accepts videos up to several GB, but media is buffered in memory here.
const LINKEDIN_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

async function fetchMediaBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  return fetchMediaBytes(url, { maxBytes: LINKEDIN_MEDIA_MAX_BYTES });
}

// A Page destination posts as the organization; anything else posts as the member.
export function resolveLinkedInDestinationUrn(destination?: { type?: string; id?: string } | null): string | null {
  const type = String(destination?.type || '').trim().toLowerCase();
  if (type !== 'page' && type !== 'organization') return null;
  const raw = String(destination?.id || '').trim();
  const orgId = raw.match(/organization:(\d+)/i)?.[1] || (/^\d+$/.test(raw) ? raw : '');
  return orgId ? `urn:li:organization:${orgId}` : null;
}

export class LinkedInPlatform implements SocialPlatform {
  id = 'linkedin';
  name = 'LinkedIn';

  handleError(error: any): { retryable: boolean; message: string } {
    const status = error?.response?.status;
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error_description ||
      (error instanceof Error ? error.message : 'LinkedIn error');
    return { retryable: isRetryableStatus(status), message };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    const title = String(post?.content?.title || '').trim();
    if (!text) return { ok: false, error: 'LinkedIn post requires text.' };
    if (text.length > LINKEDIN_MAX_TEXT) {
      return { ok: false, error: `LinkedIn text exceeds max ${LINKEDIN_MAX_TEXT} characters.` };
    }
    if (title && title.length > LINKEDIN_MAX_TITLE) {
      return { ok: false, error: `LinkedIn title exceeds max ${LINKEDIN_MAX_TITLE} characters.` };
    }

    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length > LINKEDIN_MAX_IMAGES) {
      return { ok: false, error: `LinkedIn supports up to ${LINKEDIN_MAX_IMAGES} media items per post.` };
    }

    for (const item of media) {
      const mime = String(item?.mimeType || '').toLowerCase();
      if (mime && !mime.startsWith('image/') && !mime.startsWith('video/')) {
        return { ok: false, error: 'LinkedIn currently supports images and videos in this app.' };
      }
    }

    return { ok: true };
  }

  async post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult> {
    try {
      const authorUrn = await this._resolveAuthorUrn(ctx, post);
      if (!authorUrn) return { status: 'failed', error: 'LinkedIn author URN could not be resolved.' };

      const commentary = String(post?.content?.text || '').trim();
      const link = String(post?.content?.link || '').trim();
      const title = String(post?.content?.title || '').trim();
      const media = Array.isArray(post.media) ? post.media : [];

      if (media.length === 0) {
        return await this._postTextOrArticle(authorUrn, commentary, title, link || undefined, ctx);
      }

      if (media.length === 1) {
        const mime = String(media[0]?.mimeType || '').toLowerCase();
        if (mime.startsWith('video/') || media[0]?.type === 'video') {
          return await this._postVideo(authorUrn, media[0], commentary, title, ctx);
        }
        return await this._postImage(authorUrn, media[0], commentary, title, ctx);
      }

      return await this._postMultiImage(authorUrn, media, commentary, title, ctx);
    } catch (error) {
      const { retryable, message } = this.handleError(error);
      return { status: 'failed', error: message, retryable };
    }
  }

  private async _resolveAuthorUrn(ctx: PlatformContext, post?: PostObject): Promise<string | null> {
    // The destination decides the author. The cached member id used to win
    // unconditionally, so posts meant for a company Page went to the
    // publisher's personal profile.
    const destinationType = String(post?.destination?.type || '').trim().toLowerCase();
    if (destinationType === 'page' || destinationType === 'organization') {
      return resolveLinkedInDestinationUrn(post?.destination);
    }

    const cachedId = String(ctx.tokenData?.sub || ctx.tokenData?.user_id || ctx.tokenData?.id || '').trim();
    if (cachedId) return `urn:li:person:${cachedId}`;

    const helpers = (ctx.helpers || {}) as LinkedInHelpers;
    if (helpers.resolveAuthorUrn) return helpers.resolveAuthorUrn(ctx);

    const meResp = await axios.get(`${LINKEDIN_API}/v2/me`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (meResp.status < 400) {
      const id = String((meResp.data as any)?.id || '').trim();
      if (id) return `urn:li:person:${id}`;
    }

    const userinfoResp = await axios.get(`${LINKEDIN_API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (userinfoResp.status >= 400) return null;
    const sub = String((userinfoResp.data as any)?.sub || '').trim();
    return sub ? `urn:li:person:${sub}` : null;
  }

  private async _createRestPost(body: Record<string, any>, ctx: PlatformContext): Promise<PlatformPostResult> {
    const resp = await axios.post(`${LINKEDIN_API}/rest/posts`, body, {
      headers: restHeaders(ctx.accessToken),
      validateStatus: () => true,
      timeout: 20000,
    });
    if (resp.status >= 400) {
      const error: any = resp.data || {};
      return {
        status: 'failed',
        error: error?.message || `LinkedIn post failed (${resp.status})`,
        retryable: isRetryableStatus(resp.status),
        raw: error,
      };
    }

    return {
      status: 'published',
      platformPostId: extractResponseEntityId(resp),
      raw: resp.data,
    };
  }

  private async _postTextOrArticle(
    authorUrn: string,
    commentary: string,
    title: string,
    link: string | undefined,
    ctx: PlatformContext,
  ): Promise<PlatformPostResult> {
    const body: Record<string, any> = buildBasePost(authorUrn, commentary);
    if (link) {
      body.content = {
        article: {
          source: link,
          title: title || link,
          description: commentary.slice(0, 200),
        },
      };
    }
    return this._createRestPost(body, ctx);
  }

  private async _initializeImageUpload(ownerUrn: string, ctx: PlatformContext): Promise<{ imageUrn: string; uploadUrl: string } | null> {
    const resp = await axios.post(
      `${LINKEDIN_API}/rest/images?action=initializeUpload`,
      {
        initializeUploadRequest: {
          owner: ownerUrn,
        },
      },
      {
        headers: restHeaders(ctx.accessToken),
        validateStatus: () => true,
        timeout: 15000,
      },
    );
    if (resp.status >= 400) return null;

    const value: any = (resp.data as any)?.value || resp.data || {};
    const imageUrn = String(value?.image || value?.id || '').trim();
    const uploadUrl = String(value?.uploadUrl || '').trim();
    if (!imageUrn || !uploadUrl) return null;
    return { imageUrn, uploadUrl };
  }

  private async _initializeVideoUpload(
    ownerUrn: string,
    fileSizeBytes: number,
    ctx: PlatformContext,
  ): Promise<{ videoUrn: string; uploadToken: string; uploadInstructions: Array<{ firstByte: number; lastByte: number; uploadUrl: string }> } | null> {
    const resp = await axios.post(
      `${LINKEDIN_API}/rest/videos?action=initializeUpload`,
      {
        initializeUploadRequest: {
          owner: ownerUrn,
          fileSizeBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
      {
        headers: restHeaders(ctx.accessToken),
        validateStatus: () => true,
        timeout: 15000,
      },
    );
    if (resp.status >= 400) return null;

    const value: any = (resp.data as any)?.value || resp.data || {};
    const uploadInstructions = Array.isArray(value?.uploadInstructions) ? value.uploadInstructions : [];
    const videoUrn = String(value?.video || '').trim();
    const uploadToken = String(value?.uploadToken || '').trim();
    if (!videoUrn || !uploadToken || uploadInstructions.length === 0) return null;

    return {
      videoUrn,
      uploadToken,
      uploadInstructions: uploadInstructions
        .map((instruction: any) => ({
          firstByte: Number(instruction?.firstByte ?? 0),
          lastByte: Number(instruction?.lastByte ?? -1),
          uploadUrl: String(instruction?.uploadUrl || '').trim(),
        }))
        .filter((instruction: any) => instruction.uploadUrl && instruction.lastByte >= instruction.firstByte),
    };
  }

  private async _uploadBinary(
    uploadUrl: string,
    buffer: Buffer,
    mimeType: string,
    accessToken: string,
  ): Promise<{ ok: boolean; partId?: string }> {
    const resp = await axios.put(uploadUrl, buffer, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
      },
      validateStatus: () => true,
      timeout: 120000,
      maxBodyLength: Infinity,
    });
    const rawPartId = resp.headers?.etag || resp.headers?.ETag;
    const partId = typeof rawPartId === 'string' ? rawPartId.replace(/^"+|"+$/g, '') : undefined;
    return { ok: resp.status < 400, partId };
  }

  private async _finalizeVideoUpload(
    videoUrn: string,
    uploadToken: string,
    uploadedPartIds: string[],
    ctx: PlatformContext,
  ): Promise<boolean> {
    const resp = await axios.post(
      `${LINKEDIN_API}/rest/videos?action=finalizeUpload`,
      {
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken,
          uploadedPartIds,
        },
      },
      {
        headers: restHeaders(ctx.accessToken),
        validateStatus: () => true,
        timeout: 20000,
      },
    );
    return resp.status < 400;
  }

  private async _postImage(
    authorUrn: string,
    item: any,
    commentary: string,
    title: string,
    ctx: PlatformContext,
  ): Promise<PlatformPostResult> {
    const initialized = await this._initializeImageUpload(authorUrn, ctx);
    if (!initialized) return { status: 'failed', error: 'LinkedIn image upload initialization failed.' };

    let mediaBuffer: Buffer;
    let mimeType: string;
    try {
      ({ buffer: mediaBuffer, mimeType } = await fetchMediaBuffer(item.url));
    } catch (error) {
      return { status: 'failed', error: `Could not load image for LinkedIn: ${error instanceof Error ? error.message : 'fetch error'}` };
    }

    const uploadResult = await this._uploadBinary(initialized.uploadUrl, mediaBuffer, mimeType, ctx.accessToken);
    if (!uploadResult.ok) return { status: 'failed', error: 'LinkedIn image binary upload failed.' };

    return this._createRestPost(
      {
        ...buildBasePost(authorUrn, commentary),
        content: {
          media: {
            id: initialized.imageUrn,
            ...(title ? { title } : {}),
          },
        },
      },
      ctx,
    );
  }

  private async _postMultiImage(
    authorUrn: string,
    media: any[],
    commentary: string,
    title: string,
    ctx: PlatformContext,
  ): Promise<PlatformPostResult> {
    const uploadedImages: Array<{ id: string; altText?: string }> = [];

    for (const item of media) {
      const initialized = await this._initializeImageUpload(authorUrn, ctx);
      if (!initialized) continue;

      try {
        const { buffer, mimeType } = await fetchMediaBuffer(item.url);
        const uploadResult = await this._uploadBinary(initialized.uploadUrl, buffer, mimeType, ctx.accessToken);
        if (uploadResult.ok) {
          uploadedImages.push({
            id: initialized.imageUrn,
            ...(title ? { altText: title } : {}),
          });
        }
      } catch {
        // Ignore failed media items and publish with the successful uploads.
      }
    }

    if (uploadedImages.length === 0) {
      return { status: 'failed', error: 'No LinkedIn images uploaded successfully.' };
    }

    return this._createRestPost(
      {
        ...buildBasePost(authorUrn, commentary),
        content: {
          multiImage: {
            images: uploadedImages,
          },
        },
      },
      ctx,
    );
  }

  private async _postVideo(
    authorUrn: string,
    item: any,
    commentary: string,
    title: string,
    ctx: PlatformContext,
  ): Promise<PlatformPostResult> {
    let videoBuffer: Buffer;
    try {
      ({ buffer: videoBuffer } = await fetchMediaBuffer(item.url));
    } catch (error) {
      return { status: 'failed', error: `Could not load video for LinkedIn: ${error instanceof Error ? error.message : 'fetch error'}` };
    }

    const initialized = await this._initializeVideoUpload(authorUrn, videoBuffer.length, ctx);
    if (!initialized) return { status: 'failed', error: 'LinkedIn video upload initialization failed.' };

    const uploadedPartIds: string[] = [];
    for (const instruction of initialized.uploadInstructions) {
      const chunk = videoBuffer.subarray(instruction.firstByte, instruction.lastByte + 1);
      const uploadResult = await this._uploadBinary(instruction.uploadUrl, chunk, 'video/mp4', ctx.accessToken);
      if (!uploadResult.ok) {
        return { status: 'failed', error: 'LinkedIn video binary upload failed.' };
      }
      if (uploadResult.partId) uploadedPartIds.push(uploadResult.partId);
    }

    const finalized = await this._finalizeVideoUpload(initialized.videoUrn, initialized.uploadToken, uploadedPartIds, ctx);
    if (!finalized) return { status: 'failed', error: 'LinkedIn video finalize upload failed.' };

    return this._createRestPost(
      {
        ...buildBasePost(authorUrn, commentary),
        content: {
          media: {
            id: initialized.videoUrn,
            title: title || 'Video',
          },
        },
      },
      ctx,
    );
  }

  async getPostAnalytics(postId: string, ctx: PlatformContext): Promise<AnalyticsResult> {
    try {
      const metadataResp = await axios.get(
        `https://api.linkedin.com/rest/socialMetadata/${encodeURIComponent(postId)}`,
        {
          headers: restHeaders(ctx.accessToken, ''),
          validateStatus: () => true,
          timeout: 15000,
        },
      );
      const metadata: any = metadataResp.status < 400 ? metadataResp.data || {} : {};
      return {
        likes: Object.values(metadata?.reactionSummaries || {}).reduce((sum: number, value: any) => sum + Number(value?.count || 0), 0),
        comments: Number(metadata?.commentSummary?.count || metadata?.commentSummary?.totalCount || 0),
        shares: Number(metadata?.repostSummary?.count || metadata?.repostSummary?.totalCount || 0),
        raw: metadata,
      };
    } catch (error) {
      return { raw: { error: error instanceof Error ? error.message : 'Analytics fetch failed' } };
    }
  }

  async refreshToken(ctx: PlatformContext): Promise<TokenRefreshResult> {
    try {
      const helpers = (ctx.helpers || {}) as LinkedInHelpers;
      const clientId = String(helpers.clientId || process.env.LINKEDIN_CLIENT_ID || process.env.VITE_LINKEDIN_CLIENT_ID || '').trim();
      const redirectUri = String(helpers.redirectUri || process.env.LINKEDIN_REDIRECT_URI || process.env.VITE_LINKEDIN_REDIRECT_URI || '').trim();
      const clientSecrets = getLinkedInClientSecrets(helpers);
      if (!clientId || !redirectUri || clientSecrets.length === 0) return { ok: false, error: 'LinkedIn credentials not configured.' };
      if (!ctx.refreshToken) return { ok: false, error: 'No LinkedIn refresh token available.' };

      let finalResponse: any = null;
      for (let index = 0; index < clientSecrets.length; index += 1) {
        const resp = await axios.post(
          'https://www.linkedin.com/oauth/v2/accessToken',
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: ctx.refreshToken,
            client_id: clientId,
            client_secret: clientSecrets[index],
            redirect_uri: redirectUri,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 15000,
          },
        );
        finalResponse = resp;
        if (resp.status < 400) break;
        if (index === clientSecrets.length - 1 || !shouldRetryLinkedInSecret(resp.status, resp.data)) break;
      }

      const data: any = finalResponse?.data || {};
      if (!finalResponse || finalResponse.status >= 400 || !data.access_token) {
        return { ok: false, error: data?.error_description || data?.message || 'LinkedIn refresh failed.' };
      }

      return {
        ok: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || ctx.refreshToken,
        expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : undefined,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'LinkedIn refresh failed.' };
    }
  }
}
