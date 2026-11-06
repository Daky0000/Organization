import cron from "node-cron";
import { prisma } from "../../utils/prisma";

import { PostPlatformStatus, PostStatus } from "@prisma/client";
import { addPostToQueue } from "./queue";
import { logIntegrationEvent } from "../../utils/integration-log";
import { AnalyticsSyncService } from "../analytics-sync.service";
import { calculateNextRun } from "./post-automation.service";


const toTimeString = (date?: Date | null) => {
  if (!date) return undefined;
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
};

export const handleScheduledPosts = async () => {
  const now = new Date();

  const posts = await prisma.post.findMany({
    where: {
      status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] },
      scheduledAt: { lte: now },
      postedAt: null,
    },
    include: { platformIntegrations: { include: { userIntegration: true } } },
  });

  for (const post of posts) {
    if (!post.platformIntegrations.length) continue;

    // Skip posts where all integrations are already in progress or done;
    // retry jobs handle RETRY integrations, so no need to re-queue here
    const hasPendingIntegrations = post.platformIntegrations.some(
      (i) => i.status === PostPlatformStatus.PENDING
    );
    if (!hasPendingIntegrations) continue;

    const jobId = await addPostToQueue(post.id, null);

    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.SCHEDULED },
    });

    const firstIntegration = post.platformIntegrations[0];
    await logIntegrationEvent({
      userId: post.createdById,
      integrationId: firstIntegration.userIntegration.integrationId,
      userIntegrationId: firstIntegration.userIntegrationId,
      eventType: "scheduled",
      status: "success",
      response: { jobId },
    });
  }
};

export const handleRecurringPosts = async () => {
  const now = new Date();

  const posts = await prisma.post.findMany({
    where: {
      status: PostStatus.RECURRING,
      isRecurring: true,
      nextScheduledRun: { lte: now },
    },
    include: { platformIntegrations: { include: { userIntegration: true } } },
  });

  for (const post of posts) {
    if (!post.platformIntegrations.length) continue;

    await prisma.postIntegration.updateMany({
      where: { postId: post.id },
      data: {
        status: PostPlatformStatus.PENDING,
        retryCount: 0,
        error: null,
        platformPostId: null,
        postedAt: null,
      },
    });

    const jobId = await addPostToQueue(post.id, null);

    const nextRun = post.recurringPattern
      ? calculateNextRun(
          post.recurringPattern,
          {
            time: toTimeString(post.nextScheduledRun),
            endDate: post.recurringEndDate ?? undefined,
            daysOfWeek:
              post.recurringDayOfWeek != null
                ? [post.recurringDayOfWeek]
                : undefined,
          },
          new Date(post.nextScheduledRun ?? now)
        )
      : null;

    await prisma.post.update({
      where: { id: post.id },
      data: {
        lastExecutedAt: now,
        nextScheduledRun: nextRun,
        scheduledAt: nextRun ?? post.scheduledAt,
      },
    });

    const firstIntegration = post.platformIntegrations[0];
    await logIntegrationEvent({
      userId: post.createdById,
      integrationId: firstIntegration.userIntegration.integrationId,
      userIntegrationId: firstIntegration.userIntegrationId,
      eventType: "recurring_scheduled",
      status: "success",
      response: { jobId, nextRun: nextRun?.toISOString() ?? null },
    });
  }
};

export const startScheduler = () => {
  cron.schedule("* * * * *", async () => {
    try {
      await handleScheduledPosts();
      await handleRecurringPosts();
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  });

  // Sync analytics every 6 hours instead of once daily at 2AM,
  // so data is never more than 6 hours stale.
  cron.schedule("0 */6 * * *", async () => {
    try {
      const agencies = await prisma.agency.findMany({ include: { users: true } });
      for (const agency of agencies) {
        for (const user of agency.users) {
          await AnalyticsSyncService.syncAllUserAnalytics(user.id, agency.id);
        }
      }
    } catch (error) {
      console.error("Analytics sync error:", error);
    }
  });
};
