import axios from "axios";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

export class LinkedInAdapter {
  static async publishPost(
    content: string,
    _media: { url?: string } | null,
    userIntegration: UserIntegration
  ) {
    const accessToken = userIntegration.accessToken || "";
    const authorId = userIntegration.accountId;

    try {
      if (!accessToken || !authorId) {
        return { success: false, error: "Missing LinkedIn auth" };
      }

      const body = {
        author: `urn:li:person:${authorId}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: content },
            shareMediaCategory: "NONE",
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      };

      const resp = await axios.post("https://api.linkedin.com/v2/ugcPosts", body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });

      return { success: true, platformPostId: resp.data?.id };
    } catch (error: any) {
      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: error?.message || "LinkedIn publish failed",
      });
      return {
        success: false,
        error:
          error?.response?.data?.message ||
          error?.message ||
          "LinkedIn publish failed",
      };
    }
  }

  static async validateToken(accessToken: string) {
    try {
      const resp = await axios.get("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: resp.status < 400 };
    } catch {
      return { valid: false };
    }
  }

  static async getAccountProfile(organizationId: string, accessToken: string) {
    try {
      const resp = await axios.get(
        `https://api.linkedin.com/v2/organizations/${encodeURIComponent(organizationId)}?projection=(id,localizedName,followerCount,description,website)`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      return {
        username: resp.data.localizedName || "",
        followers: resp.data.followerCount || 0,
        followings: 0,
        total_likes: 0,
        verified: false,
        website: resp.data.website || null,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "LinkedIn profile fetch failed" };
    }
  }

  static async getProfile(accessToken: string) {
    try {
      const profileResp = await axios.get("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const emailResp = await axios.get(
        "https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const email =
        emailResp.data?.elements?.[0]?.["handle~"]?.emailAddress || null;

      return {
        id: profileResp.data?.id,
        name: `${profileResp.data?.localizedFirstName || ""} ${
          profileResp.data?.localizedLastName || ""
        }`.trim(),
        email,
      };
    } catch {
      return null;
    }
  }
  static async getOrganizationMetrics(
    organizationId: string,
    accessToken: string,
    _dateRange: { start: Date; end: Date }
  ) {
    try {
      const resp = await axios.get(
        "https://api.linkedin.com/v2/organizationalEntityShareStatistics",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            q: "organizationalEntity",
            organizationalEntity: `urn:li:organization:${organizationId}`,
          },
        }
      );
      const elements = resp.data?.elements || [];
      if (!Array.isArray(elements) || elements.length === 0) {
        return null;
      }
      const totals = elements.reduce(
        (acc: any, element: any) => {
          const stats = element.totalShareStatistics || {};
          acc.impressions += stats.impressionCount || 0;
          acc.engagement += stats.engagement || 0;
          acc.likes += stats.likeCount || 0;
          acc.comments += stats.commentCount || 0;
          acc.shares += stats.shareCount || 0;
          return acc;
        },
        { impressions: 0, engagement: 0, likes: 0, comments: 0, shares: 0 }
      );

      return {
        posts: elements.length,
        impressions: totals.impressions,
        reach: totals.impressions,
        engagement: totals.engagement,
        likes: totals.likes,
        comments: totals.comments,
        shares: totals.shares,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "LinkedIn metrics failed" };
    }
  }\n}

