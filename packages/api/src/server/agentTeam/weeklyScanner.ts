import { dbQuery } from '../../db.ts';
import { logger } from '../../logger.ts';
import { postAgentMessage } from './coordination.ts';

export type WeeklyScanResult = {
  userId: string;
  scannedAt: string;
  postsAnalyzed: number;
  topPlatform: string | null;
  avgEngagementRate: number;
  topPost: {
    platform: string;
    postId?: string;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    engagementRate: number;
  } | null;
  underperformingPlatform: string | null;
  summary: string;
  tacticalAdjustments: string[];
};

/**
 * Weekly regular scan of post performance across all connected social channels.
 * Identifies what popped vs what lagged, and sends tactical adjustments to the whole agent team.
 */
export async function runWeeklyPerformanceScan(userId: string): Promise<WeeklyScanResult> {
  const scannedAt = new Date().toISOString();
  const defaultResult: WeeklyScanResult = {
    userId,
    scannedAt,
    postsAnalyzed: 0,
    topPlatform: null,
    avgEngagementRate: 0,
    topPost: null,
    underperformingPlatform: null,
    summary: 'No published posts recorded in the last 14 days yet.',
    tacticalAdjustments: ['Maintain publishing cadence to establish initial baseline metrics.'],
  };

  try {
    // 1. Fetch metrics for posts published in the last 14 days across all platforms
    const { rows: metrics } = await dbQuery<{
      id: string;
      platform: string;
      platform_post_id: string;
      post_id: string | null;
      likes: number;
      comments: number;
      shares: number;
      impressions: number;
      reach: number;
      clicks: number;
      saves: number;
      posted_at: string | null;
      created_at: string;
    }>(
      `SELECT id, platform, platform_post_id, post_id,
              COALESCE(likes, 0)::int AS likes,
              COALESCE(comments, 0)::int AS comments,
              COALESCE(shares, 0)::int AS shares,
              COALESCE(impressions, 0)::int AS impressions,
              COALESCE(reach, 0)::int AS reach,
              COALESCE(clicks, 0)::int AS clicks,
              COALESCE(saves, 0)::int AS saves,
              COALESCE(posted_at, created_at) AS posted_at
         FROM social_metrics
        WHERE user_id = $1 AND COALESCE(posted_at, created_at) >= NOW() - INTERVAL '14 days'
        ORDER BY COALESCE(posted_at, created_at) DESC`,
      [userId],
    );

    // If no social_metrics yet, check publishing_logs to see if posts were recently published
    if (!metrics.length) {
      const { rows: publishedLogs } = await dbQuery<{ platform: string; count: number }>(
        `SELECT platform, COUNT(*)::int AS count
           FROM publishing_logs
          WHERE user_id = $1 AND status = 'published' AND created_at >= NOW() - INTERVAL '14 days'
          GROUP BY platform`,
        [userId],
      );
      if (publishedLogs.length) {
        const total = publishedLogs.reduce((acc, r) => acc + r.count, 0);
        defaultResult.postsAnalyzed = total;
        defaultResult.summary = `${total} post${total === 1 ? '' : 's'} published recently across ${publishedLogs.map((p) => p.platform).join(', ')}. Metric sync will update engagement shortly.`;
        defaultResult.tacticalAdjustments = [
          'Continue scheduled posts across priority channels.',
          'Focus on hook retention and conversation-starting calls to action.',
        ];
      }
      return defaultResult;
    }

    // 2. Score each post by weighted engagement:
    // Shares & Saves are high-intent (weighted 3x), Comments 2x, Clicks 2x, Likes 1x.
    const scoredPosts = metrics.map((p) => {
      const totalInteractions = p.likes + p.comments * 2 + p.shares * 3 + p.saves * 3 + p.clicks * 2;
      const reachBase = Math.max(p.reach || p.impressions || 1, 1);
      const engagementRate = totalInteractions / reachBase;
      return {
        ...p,
        totalInteractions,
        engagementRate,
      };
    });

    // Sort by engagement rate descending
    scoredPosts.sort((a, b) => b.engagementRate - a.engagementRate);

    const bestPost = scoredPosts[0];
    const worstPost = scoredPosts[scoredPosts.length - 1];
    const totalInteractions = scoredPosts.reduce((acc, p) => acc + p.totalInteractions, 0);
    const totalReach = scoredPosts.reduce((acc, p) => acc + Math.max(p.reach || p.impressions || 1, 1), 0);
    const avgRate = totalReach > 0 ? totalInteractions / totalReach : 0;

    // Platform aggregation
    const platformBreakdown: Record<string, { posts: number; totalScore: number }> = {};
    for (const p of scoredPosts) {
      if (!platformBreakdown[p.platform]) {
        platformBreakdown[p.platform] = { posts: 0, totalScore: 0 };
      }
      platformBreakdown[p.platform].posts++;
      platformBreakdown[p.platform].totalScore += p.engagementRate;
    }

    let topPlatform: string | null = null;
    let topPlatformAvg = -1;
    let underperformingPlatform: string | null = null;
    let lowestPlatformAvg = Infinity;

    for (const [platform, data] of Object.entries(platformBreakdown)) {
      const avg = data.totalScore / data.posts;
      if (avg > topPlatformAvg) {
        topPlatformAvg = avg;
        topPlatform = platform;
      }
      if (avg < lowestPlatformAvg && data.posts > 0) {
        lowestPlatformAvg = avg;
        underperformingPlatform = platform;
      }
    }

    // 3. Formulate tactical adjustments based on winning patterns
    const tacticalAdjustments: string[] = [];
    if (topPlatform && bestPost) {
      tacticalAdjustments.push(
        `Scale up ${topPlatform} content: Top post achieved ${bestPost.likes} likes, ${bestPost.comments} comments, and ${bestPost.saves} saves.`,
      );
    }
    if (bestPost && (bestPost.saves > 0 || bestPost.shares > 0)) {
      tacticalAdjustments.push(
        `Audience is saving/sharing high-value educational posts — double down on checklists, step-by-step guides, and practical breakdowns.`,
      );
    }
    if (underperformingPlatform && underperformingPlatform !== topPlatform) {
      tacticalAdjustments.push(
        `Rethink ${underperformingPlatform} format: Test shorter, more aggressive opening hooks or switch from static images to carousels/video.`,
      );
    }
    if (!tacticalAdjustments.length) {
      tacticalAdjustments.push('Maintain balanced publishing across connected channels.');
    }

    const summary = `Analyzed ${scoredPosts.length} posts over the past 14 days. ${topPlatform ? `Top performing platform: ${topPlatform}. ` : ''}Average engagement rate: ${(avgRate * 100).toFixed(1)}%.`;

    const result: WeeklyScanResult = {
      userId,
      scannedAt,
      postsAnalyzed: scoredPosts.length,
      topPlatform,
      avgEngagementRate: avgRate,
      topPost: bestPost
        ? {
            platform: bestPost.platform,
            postId: bestPost.post_id || undefined,
            likes: bestPost.likes,
            comments: bestPost.comments,
            shares: bestPost.shares,
            saves: bestPost.saves,
            reach: bestPost.reach,
            engagementRate: bestPost.engagementRate,
          }
        : null,
      underperformingPlatform: underperformingPlatform !== topPlatform ? underperformingPlatform : null,
      summary,
      tacticalAdjustments,
    };

    // 4. Send an insight message from Aria (Analytics & Perf) to the entire team
    await postAgentMessage(userId, {
      from: 'aria',
      to: '*',
      kind: 'insight',
      subject: `Weekly Performance Scan: ${topPlatform || 'Multi-channel'} leading engagement`,
      body: `${summary}\n\nTactical Adjustments for Next Week:\n${tacticalAdjustments.map((a) => `- ${a}`).join('\n')}`,
      priority: 1,
      ttlDays: 7,
      context: { weekly_scan: result },
    });

    // 5. Create in-app notification for user
    await dbQuery(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, 'weekly_performance_scan', $2, $3, $4)`,
      [
        userId,
        'Weekly Performance Scan Complete',
        `${summary} Your AI team has adjusted next week's draft queue to favor what's working best.`,
        JSON.stringify(result),
      ],
    ).catch(() => undefined);

    return result;
  } catch (err) {
    logger.error({ err, userId }, 'weekly_performance_scan_failed');
    return defaultResult;
  }
}

/**
 * Runs weekly scanning across all users with active social accounts or publishing logs.
 */
export async function runAllWeeklyPerformanceScans(): Promise<number> {
  try {
    const { rows: users } = await dbQuery<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM (
         SELECT user_id FROM social_accounts WHERE connected = true
         UNION
         SELECT user_id FROM publishing_logs WHERE created_at >= NOW() - INTERVAL '30 days'
       ) active_users`,
    );

    let processed = 0;
    for (const u of users) {
      try {
        await runWeeklyPerformanceScan(u.user_id);
        processed++;
      } catch (e) {
        logger.warn({ err: e, userId: u.user_id }, 'weekly_scan_user_failed');
      }
    }
    logger.info({ processed }, 'all_weekly_performance_scans_completed');
    return processed;
  } catch (err) {
    logger.error({ err }, 'run_all_weekly_performance_scans_error');
    return 0;
  }
}
