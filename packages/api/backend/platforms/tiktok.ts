import axios from 'axios';
import type {
  AnalyticsResult,
  PlatformContext,
  PlatformPostResult,
  PostObject,
  SocialPlatform,
  TokenRefreshResult,
  ValidationResult,
} from './types.js';

const TIKTOK_MAX_CAPTION = 2200;
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v1';

const isRetryableStatus = (status?: number) =>
  status === 429 || (typeof status === 'number' && status >= 500);

export class TikTokPlatform implements SocialPlatform {
  id = 'tiktok';
  name = 'TikTok';

  handleError(error: any): { retryable: boolean; message: string } {
    const msg = error?.response?.data?.message
      || error?.response?.data?.error?.message
      || (error instanceof Error ? error.message : 'TikTok error');
    const status = error?.response?.status;
    
    // 429 = rate limited, 5xx = server error (retryable)
    // 401/403 = auth errors (not retryable)
    const retryable = status === 429 || (typeof status === 'number' && status >= 500);
    
    return { retryable, message: msg };
  }

  validate(post: PostObject): ValidationResult {
    const text = String(post?.content?.text || '').trim();
    
    if (text.length > TIKTOK_MAX_CAPTION) {
      return { ok: false, error: `TikTok caption exceeds max ${TIKTOK_MAX_CAPTION} characters.` };
    }

    const media = Array.isArray(post.media) ? post.media : [];

    // TikTok videos must have media
    if (!media.length) {
      return { ok: false, error: 'TikTok posts require at least one video.' };
    }

    // Verify we have a video
    const hasVideo = media.some((m) => {
      const mime = String(m?.mimeType || '').toLowerCase();
      return mime.startsWith('video/') || m?.type === 'video';
    });

    if (!hasVideo) {
      return { ok: false, error: 'TikTok requires a video file.' };
    }

    return { ok: true };
  }

  async post(
    post: PostObject,
    ctx: PlatformContext
  ): Promise<PlatformPostResult> {
    try {
      // TikTok direct posting requires business account and proper OAuth scopes
      // This is a simplified implementation — real posting may need additional setup
      
      const accessToken = String(ctx.accessToken || '').trim();
      if (!accessToken) {
        return { status: 'failed', error: 'TikTok access token is missing.' };
      }

      const caption = String(post?.content?.text || '').trim();
      const media = Array.isArray(post.media) ? post.media : [];
      
      if (!media[0]?.url) {
        return { status: 'failed', error: 'Video URL is required.' };
      }

      // Note: TikTok API for direct publishing is limited
      // Most integrations use webhook callbacks or manual posting
      // This is a placeholder for future enhancement
      
      return {
        status: 'pending',
        error: 'TikTok direct posting not yet implemented. Please use manual posting.'
      };
    } catch (err: any) {
      const { retryable, message } = this.handleError(err);
      return {
        status: 'failed',
        error: message,
        retryable,
      };
    }
  }

  async getPostAnalytics(
    postId: string,
    ctx: PlatformContext
  ): Promise<AnalyticsResult> {
    try {
      const accessToken = String(ctx.accessToken || '').trim();
      if (!accessToken) return {};

      // Fetch post analytics from TikTok API
      const response = await axios.get(
        `${TIKTOK_API_BASE}/video/query/`,
        {
          params: {
            fields: 'id,like_count,comment_count,share_count,view_count',
            video_ids: postId,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          validateStatus: () => true,
          timeout: 15000,
        }
      );

      if (response.status >= 400) {
        return {};
      }

      const data = response.data?.data?.[0] || {};
      return {
        likes: data.like_count || 0,
        comments: data.comment_count || 0,
        shares: data.share_count || 0,
        impressions: data.view_count || 0,
        reach: data.view_count || 0,
        raw: data,
      };
    } catch {
      return {};
    }
  }

  async refreshToken(
    ctx: PlatformContext
  ): Promise<TokenRefreshResult> {
    try {
      // TikTok OAuth tokens typically have long validity periods
      // Implement token refresh if your OAuth flow requires it
      
      if (!ctx.refreshToken) {
        return { ok: false, error: 'No refresh token available' };
      }

      // Placeholder for actual refresh implementation
      return {
        ok: false,
        error: 'Token refresh not yet implemented for TikTok',
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Token refresh failed',
      };
    }
  }
}
