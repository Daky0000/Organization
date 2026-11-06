import { prisma } from "../utils/prisma";

import { TikTokAdapter } from "./platform-adapters/tiktok.adapter";
import { decryptToken } from "../utils/encryption";


export class AccountMetricsService {
  /**
   * Fetch and store account-level metrics (followers, following, etc.)
   * Called: Daily or when syncing account profile
   */
  static async syncAccountMetrics(
    userIntegrationId: string,
    accessToken: string,
    platform: string,
    accountId: string
  ) {
    try {
      let profileData: any;

      switch (platform) {
        case "tiktok":
          profileData = await TikTokAdapter.getAccountProfile(
            accountId,
            accessToken
          );
          break;
        default:
          return { error: "Unsupported platform" };
      }

      if (profileData.error) {
        return { error: profileData.error };
      }

      // Store in AccountMetrics table
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stored = await prisma.accountMetrics.upsert({
        where: {
          userIntegrationId_platform_date: {
            userIntegrationId,
            platform,
            date: today,
          },
        },
        update: {
          followers: profileData.followers || 0,
          followings: profileData.followings || 0,
          totalLikes: profileData.total_likes || 0,
          avgEngagementRate: 0, // Calculate separately if needed
        },
        create: {
          userIntegrationId,
          platform,
          followers: profileData.followers || 0,
          followings: profileData.followings || 0,
          totalLikes: profileData.total_likes || 0,
          avgEngagementRate: 0,
          date: today,
        },
      });

      return stored;
    } catch (error: any) {
      return { error: error?.message || "Failed to sync account metrics" };
    }
  }

  /**
   * Get follower growth over time
   */
  static async getFollowerGrowth(
    userIntegrationId: string,
    platform: string,
    days: number = 30
  ) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await prisma.accountMetrics.findMany({
      where: {
        userIntegrationId,
        platform,
        date: { gte: startDate },
      },
      orderBy: { date: "asc" },
      select: {
        date: true,
        followers: true,
        followings: true,
        totalLikes: true,
      },
    });

    if (!metrics.length) return null;

    const growth = metrics[metrics.length - 1].followers - metrics[0].followers;

    return {
      platform,
      currentFollowers: metrics[metrics.length - 1].followers,
      previousFollowers: metrics[0].followers,
      growth,
      growthPercent: metrics[0].followers
        ? Number(((growth / metrics[0].followers) * 100).toFixed(2))
        : 0,
      history: metrics,
    };
  }

  /**
   * Get current account status snapshot
   */
  static async getAccountSnapshot(
    userIntegrationId: string,
    platform: string
  ) {
    const latest = await prisma.accountMetrics.findFirst({
      where: {
        userIntegrationId,
        platform,
      },
      orderBy: { date: "desc" },
    });

    if (!latest) return null;

    return {
      platform,
      followers: latest.followers,
      followings: latest.followings,
      totalLikes: latest.totalLikes,
      lastUpdated: latest.updatedAt,
    };
  }
}
