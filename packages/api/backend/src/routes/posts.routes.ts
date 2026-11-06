import { Router, Response } from "express";
import { PostPlatformStatus, PostStatus } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import {
import { prisma } from "../utils/prisma";
  addPostToQueue,
  removePostJobs,
  retryFailedPost,
} from "../services/automation/queue";
import { pickPlatformContent } from "../utils/platform-helpers";
import { logIntegrationEvent } from "../utils/integration-log";
import { PostService } from "../services/post.service";

const router = Router();

const parseDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatCountdown = (value?: Date | null) => {
  if (!value) return "Now";
  const diff = value.getTime() - Date.now();
  if (diff <= 0) return "Due";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
};

const buildPlatformStatuses = (post: any) => {
  return post.platformIntegrations.map((integration: any) => ({
    platform: integration.userIntegration.integration.slug,
    accountName: integration.userIntegration.accountName,
    status: integration.status,
    platformPostId: integration.platformPostId,
    postedAt: integration.postedAt,
    error: integration.error,
  }));
};

const getFirstIntegration = async (postId: string) => {
  return prisma.postIntegration.findFirst({
    where: { postId },
    include: { userIntegration: true },
  });
};

// POST /api/posts
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title,
      content,
      integrationIds,
      scheduledAt,
      media,
      status,
    } = req.body as {
      title?: string;
      content?: unknown;
      integrationIds?: string[];
      scheduledAt?: string;
      media?: any;
      status?: PostStatus;
    };

    if (!title || !content) {
      return res.status(400).json({ error: "Missing title or content" });
    }

    const scheduledDate = parseDate(scheduledAt);
    const now = new Date();
    const wantsDraft =
      status === PostStatus.DRAFT || !integrationIds || !integrationIds.length;

    if (wantsDraft) {
      const post = await prisma.post.create({
        data: {
          title,
          content: content as any,
          status: PostStatus.DRAFT,
          scheduledAt: null,
          agencyId: req.agencyId!,
          createdById: req.userId!,
        },
        include: {
          platformIntegrations: {
            include: { userIntegration: { include: { integration: true } } },
          },
        },
      });

      return res.status(201).json({
        ...post,
        platformStatuses: buildPlatformStatuses(post),
      });
    }

    if (!integrationIds || !Array.isArray(integrationIds) || !integrationIds.length) {
      return res
        .status(400)
        .json({ error: "Select at least one integration" });
    }

    const computedStatus =
      scheduledDate && scheduledDate.getTime() > now.getTime()
        ? PostStatus.SCHEDULED
        : PostStatus.APPROVED;

    const userIntegrations = await prisma.userIntegration.findMany({
      where: { id: { in: integrationIds }, userId: req.userId! },
      include: { integration: true },
    });

    if (userIntegrations.length !== integrationIds.length) {
      return res.status(400).json({ error: "Invalid integration selection" });
    }

    const post = await prisma.post.create({
      data: {
        title,
        content: content as any,
        status: computedStatus,
        scheduledAt: scheduledDate,
        agencyId: req.agencyId!,
        createdById: req.userId!,
        platformIntegrations: {
          create: userIntegrations.map((integration) => ({
            userIntegrationId: integration.id,
            content: pickPlatformContent(content, integration.integration.slug),
            media: media ?? undefined,
            status: PostPlatformStatus.PENDING,
          })),
        },
      },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    await logIntegrationEvent({
      userId: req.userId!,
      integrationId: userIntegrations[0].integrationId,
      userIntegrationId: userIntegrations[0].id,
      eventType: "post_created",
      status: "success",
      response: { postId: post.id },
    });

    res.status(201).json({
      ...post,
      platformStatuses: buildPlatformStatuses(post),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/posts
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const posts = await prisma.post.findMany({
      where: {
        agencyId: req.agencyId!,
        ...(status ? { status: status as PostStatus } : {}),
      },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      posts.map((post) => ({
        ...post,
        platformStatuses: buildPlatformStatuses(post),
      }))
    );
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/posts/:id/with-platforms
router.get(
  "/:id/with-platforms",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await PostService.getPostWithIntegrations(
        req.params.id,
        req.agencyId!,
        req.userId!
      );
      res.json({
        post: data.post,
        selectedIntegrations: data.selectedIntegrations,
        availableIntegrations: data.availableIntegrations,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/posts/:id
router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
      const post = await prisma.post.findFirst({
      where: { id: req.params.id, agencyId: req.agencyId! },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    if (!post) return res.status(404).json({ error: "Post not found" });

    res.json({
      ...post,
      platformStatuses: buildPlatformStatuses(post),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/posts/:id
router.put(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { title, content, selectedIntegrationIds } = req.body as {
        title?: string;
        content?: unknown;
        selectedIntegrationIds?: string[];
      };

      const updated = await PostService.updatePostWithIntegrations(
        req.params.id,
        { title, content, selectedIntegrationIds },
        req.userId!,
        req.agencyId!
      );

      if (!updated) {
        return res.status(404).json({ error: "Post not found" });
      }

      res.json({
        ...updated,
        platformStatuses: buildPlatformStatuses(updated),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// PUT /api/posts/:id/platform-selection
router.put(
  "/:id/platform-selection",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { integrationIds } = req.body as { integrationIds?: string[] };

      const updated = await PostService.savePlatformSelection(
        req.params.id,
        integrationIds ?? [],
        req.userId!,
        req.agencyId!
      );

      const firstIntegration = integrationIds?.length
        ? await getFirstIntegration(req.params.id)
        : null;

      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "platform_selection_updated",
          status: "success",
          response: { postId: req.params.id, integrationIds },
        });
      }

      res.json({
        ...updated,
        platformStatuses: updated ? buildPlatformStatuses(updated) : [],
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/reschedule
router.post(
  "/:id/reschedule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { scheduledAt } = req.body as { scheduledAt?: string };
      const scheduledDate = parseDate(scheduledAt);
      if (!scheduledDate) {
        return res.status(400).json({ error: "Invalid schedule date" });
      }

      const result = await PostService.reschedulePost(
        req.params.id,
        scheduledDate,
        req.userId!,
        req.agencyId!
      );

      res.json({
        success: true,
        newScheduledAt: scheduledDate.toISOString(),
        countdown: formatCountdown(scheduledDate),
        jobId: result.jobId,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/posts/:id/reschedule-options
router.get(
  "/:id/reschedule-options",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      const daysAhead = Number.parseInt(req.query.daysAhead as string, 10) || 7;
      const safeDaysAhead = Math.min(30, Math.max(1, daysAhead));

      const posts = await prisma.post.findMany({
        where: {
          agencyId: req.agencyId!,
          status: PostStatus.POSTED,
          postedAt: { not: null },
        },
        include: { analytics: true },
      });

      const byHour = new Map<number, { total: number; count: number }>();

      posts.forEach((entry) => {
        if (!entry.postedAt || !entry.analytics) return;
        const analytics = entry.analytics;
        const engagement =
          (analytics.instagramLikes || 0) +
          (analytics.instagramComments || 0) +
          (analytics.instagramShares || 0) +
          (analytics.instagramSaves || 0) +
          (analytics.tiktokLikes || 0) +
          (analytics.tiktokComments || 0) +
          (analytics.tiktokShares || 0) +
          (analytics.linkedinLikes || 0) +
          (analytics.linkedinComments || 0) +
          (analytics.twitterLikes || 0) +
          (analytics.twitterRetweets || 0) +
          (analytics.twitterReplies || 0) +
          (analytics.facebookLikes || 0) +
          (analytics.facebookComments || 0) +
          (analytics.facebookShares || 0);

        if (engagement <= 0) return;

        const hour = entry.postedAt.getHours();
        const current = byHour.get(hour) || { total: 0, count: 0 };
        byHour.set(hour, {
          total: current.total + engagement,
          count: current.count + 1,
        });
      });

      if (!byHour.size) {
        return res.json([]);
      }

      const averages = Array.from(byHour.entries()).map(([hour, stats]) => ({
        hour,
        avg: stats.total / stats.count,
      }));
      const maxAvg = Math.max(...averages.map((item) => item.avg));
      if (!Number.isFinite(maxAvg) || maxAvg <= 0) {
        return res.json([]);
      }

      const topHours = averages
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3);

      const formatHour = (hour: number) => {
        const hours12 = ((hour + 11) % 12) + 1;
        const suffix = hour >= 12 ? "PM" : "AM";
        return `${hours12}:00 ${suffix}`;
      };

      const options: Array<{ time: string; date: string; score: number }> = [];
      const base = new Date();

      for (let i = 1; i <= safeDaysAhead; i += 1) {
        const day = new Date(base);
        day.setDate(base.getDate() + i);
        const dateLabel = day.toISOString().split("T")[0];
        topHours.forEach((slot) => {
          const score = Math.max(
            1,
            Math.min(100, Math.round((slot.avg / maxAvg) * 100))
          );
          options.push({
            time: formatHour(slot.hour),
            date: dateLabel,
            score,
          });
        });
      }

      res.json(options);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/post-now
router.post(
  "/:id/post-now",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.APPROVED, scheduledAt: null },
      });

      const jobId = await addPostToQueue(post.id, null);

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_now",
          status: "success",
          response: { jobId },
        });
      }

      res.json({ success: true, message: "Queued", jobId });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/schedule
router.post(
  "/:id/schedule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { scheduledAt } = req.body as { scheduledAt?: string };
      const scheduledDate = parseDate(scheduledAt);
      if (!scheduledDate) {
        return res.status(400).json({ error: "Invalid schedule date" });
      }
      if (scheduledDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Schedule must be in the future" });
      }

      const existing = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!existing) {
        return res.status(404).json({ error: "Post not found" });
      }

      const post = await prisma.post.update({
        where: { id: existing.id },
        data: { scheduledAt: scheduledDate, status: PostStatus.SCHEDULED },
      });

      const jobId = await addPostToQueue(post.id, scheduledDate);

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_scheduled",
          status: "success",
          response: { jobId, scheduledAt: scheduledDate.toISOString() },
        });
      }

      res.json({ ...post, jobId });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/cancel
router.post(
  "/:id/cancel",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      await removePostJobs(post.id, post.scheduledAt);

      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.APPROVED, scheduledAt: null },
      });

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_cancelled",
          status: "success",
          response: { postId: post.id },
        });
      }

      res.json({ success: true, post: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// DELETE /api/posts/:id
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      await removePostJobs(post.id, post.scheduledAt);

      const firstIntegration = await getFirstIntegration(post.id);
      await prisma.post.delete({ where: { id: post.id } });

      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_deleted",
          status: "success",
          response: { postId: post.id },
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/retry
router.post(
  "/:id/retry",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      const jobId = await retryFailedPost(post.id);
      const integrations = await prisma.postIntegration.findMany({
        where: { postId: post.id },
      });

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_retry",
          status: "success",
          response: { jobId },
        });
      }

      res.json({ jobId, integrations });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/posts/:id/status
router.get(
  "/:id/status",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
        include: {
          platformIntegrations: {
            include: { userIntegration: { include: { integration: true } } },
          },
        },
      });

      if (!post) return res.status(404).json({ error: "Post not found" });

      const platformStatuses = buildPlatformStatuses(post);
      const overallStatus = platformStatuses.every(
        (status: any) => status.status === PostPlatformStatus.POSTED
      )
        ? "POSTED"
        : platformStatuses.some(
            (status: any) => status.status === PostPlatformStatus.FAILED
          )
          ? "FAILED"
          : "PENDING";

      res.json({ post, platformStatuses, overallStatus });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;


