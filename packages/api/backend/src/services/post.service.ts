import { PostPlatformStatus, PostStatus } from "@prisma/client";
import { addPostToQueue, removePostJobs } from "./automation/queue";
import { pickPlatformContent } from "../utils/platform-helpers";
import { logIntegrationEvent } from "../utils/integration-log";
import { prisma } from "../utils/prisma";


export class PostService {
  static async getPostById(id: string, agencyId: string) {
    return prisma.post.findFirst({
      where: { id, agencyId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });
  }

  static async listPosts(agencyId: string, status?: PostStatus) {
    return prisma.post.findMany({
      where: { agencyId, ...(status ? { status } : {}) },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async savePlatformSelection(
    postId: string,
    selectedIntegrationIds: string[],
    userId: string,
    agencyId: string
  ) {
    const post = await prisma.post.findFirst({
      where: { id: postId, agencyId },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (!selectedIntegrationIds.length) {
      await prisma.postIntegration.deleteMany({ where: { postId } });
      const updated = await prisma.post.findUnique({
        where: { id: postId },
        include: {
          platformIntegrations: {
            include: { userIntegration: { include: { integration: true } } },
          },
        },
      });
      return updated;
    }

    const integrations = await prisma.userIntegration.findMany({
      where: { id: { in: selectedIntegrationIds }, userId },
      include: { integration: true, user: true },
    });

    if (integrations.length !== selectedIntegrationIds.length) {
      throw new Error("Invalid integrations selection");
    }

    const hasAgencyMismatch = integrations.some(
      (integration) => integration.user.agencyId !== agencyId
    );

    if (hasAgencyMismatch) {
      throw new Error("Integration does not belong to this agency");
    }

    await prisma.postIntegration.deleteMany({ where: { postId } });

    await Promise.all(
      integrations.map((integration) =>
        prisma.postIntegration.create({
          data: {
            postId,
            userIntegrationId: integration.id,
            content: pickPlatformContent(
              post.content,
              integration.integration.slug
            ),
            status: PostPlatformStatus.PENDING,
          },
        })
      )
    );

    const updated = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    return updated;
  }

  static async getPlatformSelection(postId: string, agencyId: string) {
    const post = await prisma.post.findFirst({
      where: { id: postId, agencyId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    return {
      postId: post.id,
      title: post.title,
      status: post.status,
      platformSelections: post.platformIntegrations.map((integration) => ({
        integrationId: integration.userIntegrationId,
        platform: integration.userIntegration.integration.slug,
        accountName: integration.userIntegration.accountName,
        isSelected: true,
        status: integration.status,
      })),
    };
  }

  static async getPostWithIntegrations(
    postId: string,
    agencyId: string,
    userId: string
  ) {
    const post = await prisma.post.findFirst({
      where: { id: postId, agencyId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    const selectedIntegrations = post.platformIntegrations.map((integration) => ({
      id: integration.userIntegrationId,
      platform: integration.userIntegration.integration.slug,
      accountName: integration.userIntegration.accountName,
    }));

    const availableIntegrations = await this.getAvailableIntegrationsForPost(
      userId,
      agencyId,
      postId
    );

    return { post, selectedIntegrations, availableIntegrations };
  }

  static async reschedulePost(
    postId: string,
    newScheduledAt: Date,
    userId: string,
    agencyId: string
  ) {
    if (newScheduledAt.getTime() <= Date.now()) {
      throw new Error("Schedule must be in the future");
    }

    const post = await prisma.post.findFirst({
      where: { id: postId, agencyId },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.status === PostStatus.POSTED) {
      throw new Error("Posted content cannot be rescheduled");
    }

    await removePostJobs(post.id, post.scheduledAt ?? undefined);

    await prisma.postIntegration.updateMany({
      where: { postId },
      data: {
        status: PostPlatformStatus.PENDING,
        retryCount: 0,
        error: null,
        platformPostId: null,
        postedAt: null,
      },
    });

    const updated = await prisma.post.update({
      where: { id: postId },
      data: {
        scheduledAt: newScheduledAt,
        status: PostStatus.SCHEDULED,
      },
    });

    const jobId = await addPostToQueue(postId, newScheduledAt);

    await prisma.automationLog.create({
      data: {
        postId,
        executedAt: new Date(),
        status: "SUCCESS",
        message: "Post rescheduled",
        platformsExecuted: { jobId, scheduledAt: newScheduledAt.toISOString() },
      },
    });

    const firstIntegration = await prisma.postIntegration.findFirst({
      where: { postId },
      include: { userIntegration: true },
    });

    if (firstIntegration) {
      await logIntegrationEvent({
        userId,
        integrationId: firstIntegration.userIntegration.integrationId,
        userIntegrationId: firstIntegration.userIntegrationId,
        eventType: "post_rescheduled",
        status: "success",
        response: { jobId, scheduledAt: newScheduledAt.toISOString() },
      });
    }

    return { post: updated, jobId };
  }

  static async updatePostWithIntegrations(
    postId: string,
    data: {
      title?: string;
      content?: unknown;
      selectedIntegrationIds?: string[];
    },
    userId: string,
    agencyId: string
  ) {
    const existing = await prisma.post.findFirst({
      where: { id: postId, agencyId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    if (!existing) {
      throw new Error("Post not found");
    }

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        title: data.title ?? undefined,
        content: data.content ?? undefined,
      },
    });

    if (data.selectedIntegrationIds) {
      await this.savePlatformSelection(
        postId,
        data.selectedIntegrationIds,
        userId,
        agencyId
      );
    } else if (data.content !== undefined) {
      await Promise.all(
        existing.platformIntegrations.map((integration) =>
          prisma.postIntegration.update({
            where: { id: integration.id },
            data: {
              content: pickPlatformContent(
                updatedPost.content,
                integration.userIntegration.integration.slug
              ),
            },
          })
        )
      );
    }

    const refreshed = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    return refreshed;
  }

  static async getAvailableIntegrationsForPost(
    userId: string,
    agencyId: string,
    postId: string
  ) {
    const selections = await prisma.postIntegration.findMany({
      where: { postId },
      select: { userIntegrationId: true },
    });

    const selectedIds = new Set(
      selections.map((selection) => selection.userIntegrationId)
    );

    const integrations = await prisma.userIntegration.findMany({
      where: { userId },
      include: {
        integration: true,
        posts: { where: { postedAt: { not: null } }, orderBy: { postedAt: "desc" }, take: 1, select: { postedAt: true } },
        user: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    const grouped: Record<string, any[]> = {};

    integrations.forEach((entry) => {
      if (entry.user.agencyId !== agencyId) return;
      const platform = entry.integration.slug;
      if (!grouped[platform]) grouped[platform] = [];
      grouped[platform].push({
        id: entry.id,
        accountName: entry.accountName,
        accountId: entry.accountId,
        status: entry.status,
        lastUsed: entry.posts[0]?.postedAt ?? null,
        isSelectedForPost: selectedIds.has(entry.id),
      });
    });

    return grouped;
  }
}



