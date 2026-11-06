import Queue from "bull";
import { prisma } from "../../utils/prisma";

import {
  PrismaClient,
  PostPlatformStatus,
  PostStatus,
} from "@prisma/client";
import { formatContent } from "../../utils/platform-helpers";
import { decryptToken } from "../../utils/encryption";
import { logIntegrationEvent } from "../../utils/integration-log";
import { FacebookAdapter } from "../platform-adapters/facebook.adapter";
import { InstagramAdapter } from "../platform-adapters/instagram.adapter";
import { TwitterAdapter } from "../platform-adapters/twitter.adapter";
import { LinkedInAdapter } from "../platform-adapters/linkedin.adapter";
import { PinterestAdapter } from "../platform-adapters/pinterest.adapter";
import { WordPressAdapter } from "../platform-adapters/wordpress.adapter";


const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required to run the post queue");
}

const QUEUE_NAME = "post-publishing";

export const postQueue = new Queue(QUEUE_NAME, redisUrl);

const adapters: Record<string, any> = {
  facebook: FacebookAdapter,
  instagram: InstagramAdapter,
  twitter: TwitterAdapter,
  linkedin: LinkedInAdapter,
  pinterest: PinterestAdapter,
  wordpress: WordPressAdapter,
};

const getRetryDelayMs = (attempt: number) => {
  if (attempt <= 1) return 60_000;
  if (attempt === 2) return 5 * 60_000;
  return 15 * 60_000;
};

export const addPostToQueue = async (
  postId: string,
  scheduledAt?: Date | null
) => {
  const delay =
    scheduledAt && scheduledAt.getTime() > Date.now()
      ? scheduledAt.getTime() - Date.now()
      : 0;

  const job = await postQueue.add(
    { postId },
    {
      delay,
      jobId: scheduledAt ? `${postId}-${scheduledAt.getTime()}` : postId,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  return job.id;
};

export const retryFailedPost = async (postId: string) => {
  await prisma.postIntegration.updateMany({
    where: { postId, status: PostPlatformStatus.FAILED },
    data: { status: PostPlatformStatus.PENDING, retryCount: 0, error: null },
  });

  return addPostToQueue(postId, null);
};

export const removePostJobs = async (
  postId: string,
  scheduledAt?: Date | null
) => {
  const jobIds = new Set<string>();
  jobIds.add(postId);
  if (scheduledAt) {
    jobIds.add(`${postId}-${scheduledAt.getTime()}`);
  }

  const jobs = await Promise.all(
    Array.from(jobIds).map((jobId) => postQueue.getJob(jobId))
  );

  await Promise.all(
    jobs.filter(Boolean).map((job) => job!.remove())
  );
};

const publishWithAdapter = async (
  platform: string,
  content: string,
  media: any,
  userIntegration: any,
  postTitle: string
) => {
  const adapter = adapters[platform];
  if (!adapter) {
    return { success: false, error: `No adapter for ${platform}` };
  }

  if (platform === "wordpress") {
    return adapter.publishPost(content, postTitle, media, userIntegration);
  }

  if (platform === "pinterest") {
    const imageUrl = media?.url || media?.imageUrl || "";
    return adapter.publishPin(content, imageUrl, userIntegration);
  }

  return adapter.publishPost(content, media, userIntegration);
};

postQueue.process(async (job) => {
  const postId = job.data.postId as string;
  const retryIntegrationId = job.data.retryIntegrationId as string | undefined;

  // If this is a retry job, reset the specific integration back to PENDING
  if (retryIntegrationId) {
    await prisma.postIntegration.update({
      where: { id: retryIntegrationId },
      data: { status: PostPlatformStatus.PENDING },
    });
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      platformIntegrations: {
        include: { userIntegration: { include: { integration: true } } },
      },
    },
  });

  if (!post) return;

  if (
    ![
      PostStatus.APPROVED,
      PostStatus.SCHEDULED,
      PostStatus.RECURRING,
    ].includes(post.status)
  ) {
    return;
  }

  let anyAttempted = false;

  for (const integration of post.platformIntegrations) {
    if (integration.status !== PostPlatformStatus.PENDING) continue;
    anyAttempted = true;

    const platform = integration.userIntegration.integration.slug;
    const content = formatContent(integration.content, platform);
    let accessToken = integration.userIntegration.accessToken;

    if (accessToken) {
      try {
        accessToken = decryptToken(accessToken);
      } catch {
        // leave as-is
      }
    }

    const userIntegration = {
      ...integration.userIntegration,
      accessToken,
    };

    const response = await publishWithAdapter(
      platform,
      content,
      integration.media,
      userIntegration,
      post.title
    );

    if (response?.success) {
      await prisma.postIntegration.update({
        where: { id: integration.id },
        data: {
          status: PostPlatformStatus.POSTED,
          platformPostId: response.platformPostId ?? null,
          postedAt: new Date(),
          error: null,
        },
      });

      await logIntegrationEvent({
        userId: post.createdById,
        integrationId: integration.userIntegration.integrationId,
        userIntegrationId: integration.userIntegrationId,
        eventType: "post_published",
        status: "success",
        response: { platform, postId: response.platformPostId },
      });
    } else {
      const nextRetry = integration.retryCount + 1;
      const shouldRetry = nextRetry <= integration.maxRetries;

      await prisma.postIntegration.update({
        where: { id: integration.id },
        data: {
          status: shouldRetry
            ? PostPlatformStatus.RETRY
            : PostPlatformStatus.FAILED,
          error: response?.error ?? "Publish failed",
          retryCount: nextRetry,
        },
      });

      await logIntegrationEvent({
        userId: post.createdById,
        integrationId: integration.userIntegration.integrationId,
        userIntegrationId: integration.userIntegrationId,
        eventType: "post_publish",
        status: "failed",
        errorMessage: response?.error ?? "Publish failed",
      });

      if (shouldRetry) {
        const delay = getRetryDelayMs(nextRetry);
        await postQueue.add(
          { postId, retryIntegrationId: integration.id },
          { delay, jobId: `${postId}-retry-${integration.id}-${nextRetry}` }
        );
      }
    }
  }

  if (!anyAttempted) return;

  // Re-fetch final integration states to make an accurate determination
  const finalIntegrations = await prisma.postIntegration.findMany({
    where: { postId },
  });
  const allPosted = finalIntegrations.every(
    (i) => i.status === PostPlatformStatus.POSTED
  );
  const hasPermanentFailure = finalIntegrations.some(
    (i) => i.status === PostPlatformStatus.FAILED
  );
  const hasRetrying = finalIntegrations.some(
    (i) => i.status === PostPlatformStatus.RETRY
  );

  if (post.isRecurring || post.status === PostStatus.RECURRING) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: PostStatus.RECURRING,
        lastExecutedAt: new Date(),
        postedAt: allPosted ? new Date() : post.postedAt,
      },
    });
  } else if (allPosted) {
    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.POSTED, postedAt: new Date() },
    });
  } else if (hasPermanentFailure && !hasRetrying) {
    // Only mark failed when all retries are exhausted
    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.FAILED },
    });
  }
  // If hasRetrying: leave status as-is; retry jobs will handle the remaining integrations
});
