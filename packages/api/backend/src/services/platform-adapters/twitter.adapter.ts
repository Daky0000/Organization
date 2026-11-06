/**
 * Twitter / X Adapter — X API v2
 *
 * Used by the Prisma-based backend routes (post.service.ts, analytics.service.ts).
 * All posting goes through POST /2/tweets with OAuth 2.0 user context.
 * Media upload uses the v1.1 chunked endpoint (Twitter has not yet published a v2 equivalent).
 */
import axios, { AxiosResponse } from "axios";
import FormData from "form-data";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

// ─── Constants ────────────────────────────────────────────────────────────────

const TWEET_API = "https://api.twitter.com/2/tweets";
const USERS_ME_API = "https://api.twitter.com/2/users/me";
const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const CHUNK_SIZE = 5 * 1024 * 1024;

// ─── Error helpers ────────────────────────────────────────────────────────────

function parseXApiError(data: any, status: number): string {
  const errors: any[] = data?.errors || [];
  const code: number | undefined = errors[0]?.code ?? data?.status;
  const codeMessages: Record<number, string> = {
    88:  "Rate limit reached. Try again in a few minutes.",
    89:  "X access token expired. Please reconnect your account.",
    186: "Tweet text is too long (max 280 characters).",
    187: "Duplicate tweet — this exact text was posted recently.",
    185: "Daily tweet limit reached for this account.",
    226: "Tweet flagged as automated. Vary your content.",
    261: "App does not have write permission for this account.",
    326: "X account is locked. Unlock at x.com.",
    64:  "X account is suspended.",
  };
  if (code && codeMessages[code]) return codeMessages[code];
  const detail = data?.detail || errors[0]?.message || data?.title || "";
  return detail || `X API error (HTTP ${status})`;
}

// ─── Media upload ─────────────────────────────────────────────────────────────

interface UploadOpts {
  accessToken: string;
  fileUrl: string;
  mimeType?: string;
}

/**
 * Upload a single media file to X.
 * Uses simple multipart for images < 5 MB; chunked INIT/APPEND/FINALIZE for large files and video.
 * Returns { mediaId } on success, { error } on failure.
 */
async function uploadMedia(
  opts: UploadOpts
): Promise<{ mediaId: string } | { error: string }> {
  const { accessToken, fileUrl } = opts;

  // Fetch the file
  let buffer: Buffer;
  let mimeType: string;
  try {
    const fetchResp = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      validateStatus: () => true,
      timeout: 60_000,
    });
    if (fetchResp.status >= 400) {
      return { error: `Failed to fetch media (HTTP ${fetchResp.status})` };
    }
    buffer = Buffer.from(fetchResp.data as ArrayBuffer);
    mimeType =
      opts.mimeType ||
      String(fetchResp.headers["content-type"] || "")
        .split(";")[0]
        .trim() ||
      "image/jpeg";
  } catch (err: any) {
    return { error: `Media fetch error: ${err?.message || err}` };
  }

  // Validate
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { error: `Unsupported media type: ${mimeType}` };
  }
  const isVideo = mimeType.startsWith("video/");
  const isGif = mimeType === "image/gif";
  if (!isVideo && buffer.byteLength > MAX_IMAGE_BYTES) {
    return { error: "Image exceeds 5 MB limit" };
  }
  if (isVideo && buffer.byteLength > MAX_VIDEO_BYTES) {
    return { error: "Video exceeds 512 MB limit" };
  }

  const mediaCategory = isVideo ? "tweet_video" : isGif ? "tweet_gif" : "tweet_image";
  const authHeader = { Authorization: `Bearer ${accessToken}` };
  const useChunked = isVideo || isGif || buffer.byteLength > CHUNK_SIZE;

  if (!useChunked) {
    // Simple multipart upload
    const form = new FormData();
    form.append("media", buffer, { filename: "upload", contentType: mimeType });
    form.append("media_category", mediaCategory);

    const resp: AxiosResponse = await axios.post(MEDIA_UPLOAD_URL, form, {
      headers: { ...authHeader, ...form.getHeaders() },
      validateStatus: () => true,
      timeout: 60_000,
    });
    if (resp.status >= 400) {
      return { error: `Media upload failed (${resp.status})` };
    }
    const mediaId = String((resp.data as any)?.media_id_string || "");
    return mediaId ? { mediaId } : { error: "No media_id in response" };
  }

  // Chunked upload
  const totalBytes = buffer.byteLength;

  // INIT
  const initParams = new URLSearchParams({
    command: "INIT",
    total_bytes: String(totalBytes),
    media_type: mimeType,
    media_category: mediaCategory,
  });
  const initResp: AxiosResponse = await axios.post(
    MEDIA_UPLOAD_URL,
    initParams.toString(),
    {
      headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: () => true,
      timeout: 15_000,
    }
  );
  if (initResp.status >= 400) {
    return { error: `Media INIT failed (${initResp.status})` };
  }
  const mediaId = String((initResp.data as any)?.media_id_string || "");
  if (!mediaId) return { error: "No media_id from INIT" };

  // APPEND
  let segmentIndex = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
    const appendForm = new FormData();
    appendForm.append("command", "APPEND");
    appendForm.append("media_id", mediaId);
    appendForm.append("segment_index", String(segmentIndex));
    appendForm.append("media", chunk, {
      filename: `seg_${segmentIndex}`,
      contentType: mimeType,
    });

    const appendResp: AxiosResponse = await axios.post(
      MEDIA_UPLOAD_URL,
      appendForm,
      {
        headers: { ...authHeader, ...appendForm.getHeaders() },
        validateStatus: () => true,
        timeout: 120_000,
      }
    );
    if (appendResp.status >= 400) {
      return { error: `Media APPEND failed at segment ${segmentIndex} (${appendResp.status})` };
    }
    segmentIndex++;
  }

  // FINALIZE
  const finalizeParams = new URLSearchParams({
    command: "FINALIZE",
    media_id: mediaId,
  });
  const finalizeResp: AxiosResponse = await axios.post(
    MEDIA_UPLOAD_URL,
    finalizeParams.toString(),
    {
      headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: () => true,
      timeout: 15_000,
    }
  );
  if (finalizeResp.status >= 400) {
    return { error: `Media FINALIZE failed (${finalizeResp.status})` };
  }

  // STATUS polling for async processing (video/GIF)
  const finalData: any = finalizeResp.data || {};
  if (finalData?.processing_info) {
    let waitSecs: number = finalData.processing_info.check_after_secs ?? 3;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, waitSecs * 1000));
      const statusResp: AxiosResponse = await axios.get(MEDIA_UPLOAD_URL, {
        params: { command: "STATUS", media_id: mediaId },
        headers: authHeader,
        validateStatus: () => true,
        timeout: 15_000,
      });
      const statusData: any = statusResp.data || {};
      const state: string = statusData?.processing_info?.state || "";
      if (state === "succeeded") break;
      if (state === "failed") {
        return {
          error:
            statusData?.processing_info?.error?.message ||
            "Media processing failed",
        };
      }
      waitSecs = statusData?.processing_info?.check_after_secs ?? 3;
    }
  }

  return { mediaId };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class TwitterAdapter {
  /** Post a tweet. Returns { success, platformPostId } or { success: false, error }. */
  static async publishPost(
    content: string,
    media: { url?: string; mimeType?: string } | null,
    userIntegration: UserIntegration
  ) {
    if (content.length > 280) {
      return { success: false, error: "Tweet exceeds 280 characters" };
    }

    const accessToken = String(userIntegration.accessToken || "").trim();
    if (!accessToken) {
      return { success: false, error: "Missing X access token — please reconnect" };
    }

    try {
      let mediaIds: string[] = [];

      if (media?.url) {
        const result = await uploadMedia({
          accessToken,
          fileUrl: media.url,
          mimeType: media.mimeType,
        });
        if ("mediaId" in result) {
          mediaIds = [result.mediaId];
        }
        // Media failure is non-fatal — post proceeds as text-only
      }

      const body: Record<string, any> = { text: content };
      if (mediaIds.length) body.media = { media_ids: mediaIds };

      const resp: AxiosResponse = await axios.post(TWEET_API, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
        timeout: 20_000,
      });

      if (resp.status >= 400) {
        const errMsg = parseXApiError(resp.data, resp.status);
        await logIntegrationEvent({
          userId: userIntegration.userId,
          integrationId: userIntegration.integrationId,
          userIntegrationId: userIntegration.id,
          eventType: "post_publish",
          status: "failed",
          errorMessage: errMsg,
        });
        return { success: false, error: errMsg };
      }

      return {
        success: true,
        platformPostId: String((resp.data as any)?.data?.id || ""),
      };
    } catch (error: any) {
      const msg =
        error?.response?.data
          ? parseXApiError(error.response.data, error.response.status)
          : error?.message || "X publish failed";

      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: msg,
      });
      return { success: false, error: msg };
    }
  }

  /** Validate an access token by calling /2/users/me */
  static async validateToken(accessToken: string): Promise<{ valid: boolean; userId?: string; username?: string }> {
    try {
      const resp: AxiosResponse = await axios.get(USERS_ME_API, {
        params: { "user.fields": "id,username,name" },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10_000,
      });
      if (resp.status >= 400) return { valid: false };
      const data = (resp.data as any)?.data || {};
      return { valid: true, userId: data.id, username: data.username };
    } catch {
      return { valid: false };
    }
  }

  /** Get account profile info */
  static async getAccountProfile(userId: string, accessToken: string) {
    try {
      const resp: AxiosResponse = await axios.get(
        `https://api.twitter.com/2/users/${encodeURIComponent(userId)}`,
        {
          params: { "user.fields": "username,name,public_metrics,verified" },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 10_000,
        }
      );
      if (resp.status >= 400) {
        return { error: parseXApiError(resp.data, resp.status) };
      }
      const user = (resp.data as any)?.data || {};
      const metrics = user.public_metrics || {};
      return {
        username: user.username || "",
        followers: metrics.followers_count || 0,
        followings: metrics.following_count || 0,
        total_likes: 0,
        verified: user.verified || false,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Twitter profile fetch failed" };
    }
  }

  /** Fetch public metrics for a single tweet */
  static async getTweetMetrics(
    tweetId: string,
    accessToken: string
  ): Promise<{
    likes?: number;
    retweets?: number;
    replies?: number;
    impressions?: number;
    quotes?: number;
    error?: string;
  }> {
    try {
      const resp: AxiosResponse = await axios.get(
        `https://api.twitter.com/2/tweets/${encodeURIComponent(tweetId)}`,
        {
          params: { "tweet.fields": "public_metrics,created_at" },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 15_000,
        }
      );
      if (resp.status >= 400) {
        return { error: parseXApiError(resp.data, resp.status) };
      }
      const pub = (resp.data as any)?.data?.public_metrics || {};
      return {
        likes: pub.like_count,
        retweets: pub.retweet_count,
        replies: pub.reply_count,
        impressions: pub.impression_count, // only with elevated access
        quotes: pub.quote_count,
      };
    } catch (err: any) {
      return { error: err?.message || "Metrics fetch failed" };
    }
  }

  /** Aggregate metrics for a user's recent tweets (date range) */
  static async getUserMetrics(
    userId: string,
    accessToken: string,
    dateRange: { start: Date; end: Date }
  ) {
    try {
      const resp: AxiosResponse = await axios.get(
        `https://api.twitter.com/2/users/${encodeURIComponent(userId)}/tweets`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            start_time: dateRange.start.toISOString(),
            end_time: dateRange.end.toISOString(),
            max_results: 100,
            "tweet.fields": "public_metrics",
          },
          validateStatus: () => true,
          timeout: 20_000,
        }
      );
      if (resp.status >= 400) {
        return { error: parseXApiError(resp.data, resp.status) };
      }
      const tweets: any[] = (resp.data as any)?.data || [];
      if (!tweets.length) return null;

      const totals = tweets.reduce(
        (acc, tweet) => {
          const m = tweet.public_metrics || {};
          acc.likes += m.like_count || 0;
          acc.retweets += m.retweet_count || 0;
          acc.replies += m.reply_count || 0;
          acc.impressions += m.impression_count || 0;
          acc.posts += 1;
          return acc;
        },
        { likes: 0, retweets: 0, replies: 0, impressions: 0, posts: 0 }
      );

      return {
        posts: totals.posts,
        likes: totals.likes,
        retweets: totals.retweets,
        comments: totals.replies,
        impressions: totals.impressions,
        engagement: totals.likes + totals.retweets + totals.replies,
        raw: resp.data,
      };
    } catch (err: any) {
      return { error: err?.message || "User metrics failed" };
    }
  }

  /** Fetch user profile from /2/users/me */
  static async getProfile(accessToken: string) {
    try {
      const resp: AxiosResponse = await axios.get(USERS_ME_API, {
        params: { "user.fields": "id,name,username,profile_image_url,public_metrics" },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10_000,
      });
      if (resp.status >= 400) return null;
      return (resp.data as any)?.data || null;
    } catch {
      return null;
    }
  }
}
