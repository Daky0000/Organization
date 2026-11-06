import axios from "axios";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

const GRAPH_BASE = "https://graph.facebook.com/v18.0";

export class FacebookAdapter {
  static async publishPost(
    content: string,
    media: { url?: string; type?: string } | null,
    userIntegration: UserIntegration
  ) {
    const pageId = userIntegration.accountId;
    const accessToken = userIntegration.accessToken || "";

    try {
      if (!pageId || !accessToken) {
        return { success: false, error: "Missing page ID or access token" };
      }

      if (media?.url) {
        const body = new URLSearchParams({
          url: media.url,
          caption: content,
          access_token: accessToken,
        });
        const resp = await axios.post(
          `${GRAPH_BASE}/${encodeURIComponent(pageId)}/photos`,
          body.toString(),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        return { success: true, platformPostId: resp.data?.id };
      }

      const body = new URLSearchParams({
        message: content,
        access_token: accessToken,
      });
      const resp = await axios.post(
        `${GRAPH_BASE}/${encodeURIComponent(pageId)}/feed`,
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      return { success: true, platformPostId: resp.data?.id };
    } catch (error: any) {
      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: error?.message || "Facebook publish failed",
      });

      return {
        success: false,
        error:
          error?.response?.data?.error?.message ||
          error?.message ||
          "Facebook publish failed",
      };
    }
  }

  static async getPages(accessToken: string) {
    try {
      const resp = await axios.get(`${GRAPH_BASE}/me/accounts`, {
        params: { access_token: accessToken },
      });
      return resp.data?.data || [];
    } catch {
      return [];
    }
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

  static async getAccountProfile(pageId: string, accessToken: string) {
    try {
      const resp = await axios.get(
        `${GRAPH_BASE}/${encodeURIComponent(pageId)}`,
        {
          params: {
            fields: "id,name,fan_count,website,about,picture,category,is_verified",
            access_token: accessToken,
          },
        }
      );
      return {
        username: resp.data.name || "",
        followers: resp.data.fan_count || 0,
        followings: 0,
        total_likes: 0,
        verified: resp.data.is_verified || false,
        website: resp.data.website || null,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Facebook profile fetch failed" };
    }
  }

  static async getInsights(
    pageId: string,
    accessToken: string,
    postId?: string
  ) {
    try {
      const target = postId ? postId : pageId;
      const resp = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(target)}/insights`, {
        params: { access_token: accessToken },
      });
      return resp.data;
    } catch (error: any) {
      return { error: error?.message || "Facebook insights failed" };
    }
  }
  static async getPageMetrics(
    pageId: string,
    accessToken: string,
    dateRange: { start: Date; end: Date }
  ) {
    try {
      const metrics = [
        "page_impressions",
        "page_impressions_unique",
        "page_engaged_users",
      ];
      const resp = await axios.get(
        `${GRAPH_BASE}/${encodeURIComponent(pageId)}/insights`,
        {
          params: {
            metric: metrics.join(","),
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
      const impressions = sumMetric("page_impressions");
      const reach = sumMetric("page_impressions_unique") || sumMetric("page_reach");
      const engagement = sumMetric("page_engaged_users");
      return {
        impressions,
        reach,
        engagement,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Facebook metrics failed" };
    }
  }

  static async getPostMetrics(
    pageId: string,
    accessToken: string,
    postId: string,
    dateRange: { start: Date; end: Date }
  ) {
    try {
      const metrics = [
        "post_impressions",
        "post_impressions_unique",
        "post_engaged_users",
      ];
      const resp = await axios.get(
        `${GRAPH_BASE}/${encodeURIComponent(postId)}/insights`,
        {
          params: {
            metric: metrics.join(","),
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
      return {
        impressions: sumMetric("post_impressions"),
        reach: sumMetric("post_impressions_unique"),
        engagement: sumMetric("post_engaged_users"),
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Facebook post metrics failed" };
    }
  }\n}

