import axios from "axios";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

const GRAPH_BASE = "https://graph.facebook.com/v18.0";

export class InstagramAdapter {
  static async publishPost(
    content: string,
    media: { url?: string; type?: string } | null,
    userIntegration: UserIntegration
  ) {
    const igAccountId = userIntegration.accountId;
    const accessToken = userIntegration.accessToken || "";

    try {
      if (!igAccountId || !accessToken) {
        return { success: false, error: "Missing Instagram account or token" };
      }

      if (!media?.url) {
        return { success: false, error: "Instagram requires media URL" };
      }

      const containerResp = await axios.post(
        `${GRAPH_BASE}/${encodeURIComponent(igAccountId)}/media`,
        new URLSearchParams({
          image_url: media.url,
          caption: content,
          access_token: accessToken,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const creationId = containerResp.data?.id;
      if (!creationId) {
        return { success: false, error: "Instagram media creation failed" };
      }

      const publishResp = await axios.post(
        `${GRAPH_BASE}/${encodeURIComponent(igAccountId)}/media_publish`,
        new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      return { success: true, platformPostId: publishResp.data?.id };
    } catch (error: any) {
      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: error?.message || "Instagram publish failed",
      });
      return {
        success: false,
        error:
          error?.response?.data?.error?.message ||
          error?.message ||
          "Instagram publish failed",
      };
    }
  }

  static async getAccounts(accessToken: string) {
    try {
      const pagesResp = await axios.get(`${GRAPH_BASE}/me/accounts`, {
        params: {
          fields: "id,name,instagram_business_account",
          access_token: accessToken,
        },
      });

      const pages = pagesResp.data?.data || [];
      const accounts = [] as any[];
      pages.forEach((page: any) => {
        if (page.instagram_business_account) {
          accounts.push({
            id: page.instagram_business_account.id,
            username: page.name,
            name: page.name,
          });
        }
      });
      return accounts;
    } catch {
      return [];
    }
  }

  static async uploadMedia(
    mediaUrl: string,
    accountId: string,
    accessToken: string,
    caption?: string
  ) {
    const resp = await axios.post(
      `${GRAPH_BASE}/${encodeURIComponent(accountId)}/media`,
      new URLSearchParams({
        image_url: mediaUrl,
        caption: caption || "",
        access_token: accessToken,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return { media_id: resp.data?.id };
  }

  static async validateToken(accessToken: string) {
    try {
      const resp = await axios.get(`${GRAPH_BASE}/me`, {
        params: { access_token: accessToken },
      });
      return { valid: resp.status < 400 };
    } catch {
      return { valid: false };
    }
  }

  static async getAccountProfile(accountId: string, accessToken: string) {
    try {
      const resp = await axios.get(
        `${GRAPH_BASE}/${encodeURIComponent(accountId)}`,
        {
          params: {
            fields: "username,name,biography,follower_count,follows_count,ig_id,ig_user_id,website,is_verified",
            access_token: accessToken,
          },
        }
      );
      return {
        username: resp.data.username || "",
        followers: resp.data.follower_count || 0,
        followings: resp.data.follows_count || 0,
        total_likes: 0,
        bio: resp.data.biography || null,
        verified: resp.data.is_verified || false,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Instagram profile fetch failed" };
    }
  }

  static async getAccountMetrics(
    accountId: string,
    accessToken: string,
    dateRange: { start: Date; end: Date }
  ) {
    try {
      const metrics = ["impressions", "reach", "profile_views", "follower_count"];
      const resp = await axios.get(
        `${GRAPH_BASE}/${encodeURIComponent(accountId)}/insights`,
        {
          params: {
            metric: metrics.join(","),
            period: "day",
            since: Math.floor(dateRange.start.getTime() / 1000),
            until: Math.floor(dateRange.end.getTime() / 1000),
            access_token: accessToken,
          },
        }
      );
      const data = resp.data?.data || [];
      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }
      const sumMetric = (name: string) => {
        const metric = data.find((item: any) => item.name === name);
        return (metric?.values || []).reduce(
          (acc: number, entry: any) => acc + (entry.value || 0),
          0
        );
      };
      const impressions = sumMetric("impressions");
      const reach = sumMetric("reach");
      return {
        impressions,
        reach,
        engagement: sumMetric("profile_views"),
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Instagram metrics failed" };
    }
  }

  static async getMediaMetrics(
    mediaId: string,
    accessToken: string
  ) {
    try {
      const resp = await axios.get(
        `${GRAPH_BASE}/${encodeURIComponent(mediaId)}/insights`,
        {
          params: {
            metric: "impressions,reach,engagement,saved",
            access_token: accessToken,
          },
        }
      );
      return { data: resp.data };
    } catch (error: any) {
      return { error: error?.message || "Instagram media metrics failed" };
    }
  }\n}

