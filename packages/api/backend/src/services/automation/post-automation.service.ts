import {
import { prisma } from "../../utils/prisma";

  PrismaClient,
  PostPlatformStatus,
  PostStatus,
  RecurringType,
} from "@prisma/client";
import { addPostToQueue, removePostJobs } from "./queue";
import { pickPlatformContent } from "../../utils/platform-helpers";
import { logIntegrationEvent } from "../../utils/integration-log";


type RecurringConfig = {
  daysOfWeek?: number[];
  dayOfMonth?: number;
  time?: string;
  timeZone?: string;
  endDate?: Date | string | null;
};

const DEFAULT_TIME = "09:00";

const parseTime = (value?: string) => {
  if (!value) return { hours: 9, minutes: 0 };
  const [h, m] = value.split(":").map((chunk) => Number.parseInt(chunk, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return { hours: 9, minutes: 0 };
  return { hours: h, minutes: m };
};

const applyTime = (date: Date, time?: string) => {
  const { hours, minutes } = parseTime(time ?? DEFAULT_TIME);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const normalizeEndDate = (value?: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const calculateNextRun = (
  pattern: RecurringType,
  config: RecurringConfig,
  from: Date = new Date()
): Date | null => {
  const now = new Date();
  const endDate = normalizeEndDate(config.endDate);
  let candidate: Date | null = null;

  if (pattern === RecurringType.DAILY) {
    const today = applyTime(from, config.time);
    candidate = today > now ? today : applyTime(addDays(from, 1), config.time);
  } else if (pattern === RecurringType.WEEKLY) {
    const days = (config.daysOfWeek ?? []).filter((d) => d >= 0 && d <= 6);
    const list = days.length ? days : [from.getDay()];
    const sorted = [...new Set(list)].sort((a, b) => a - b);
    const todayIndex = from.getDay();
    let bestDiff = 7;
    sorted.forEach((day) => {
      let diff = day - todayIndex;
      const candidateDate = applyTime(addDays(from, diff), config.time);
      if (diff < 0 || (diff === 0 && candidateDate <= now)) {
        diff += 7;
      }
      if (diff < bestDiff) bestDiff = diff;
    });
    candidate = applyTime(addDays(from, bestDiff), config.time);
  } else if (pattern === RecurringType.MONTHLY) {
    const dayOfMonth = config.dayOfMonth ?? from.getDate();
    const base = new Date(from);
    base.setDate(dayOfMonth);
    const thisMonth = applyTime(base, config.time);
    candidate = thisMonth > now ? thisMonth : applyTime(new Date(from.getFullYear(), from.getMonth() + 1, dayOfMonth), config.time);
  } else {
    const today = applyTime(from, config.time);
    candidate = today > now ? today : applyTime(addDays(from, 1), config.time);
  }

  if (endDate && candidate && candidate > endDate) {
    return null;
  }

  return candidate;
};

export class PostAutomationService {
  static async selectIntegrationsForPost(
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
      throw new Error("Select at least one integration");
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

    const created = await Promise.all(
      integrations.map((integration) =>
        prisma.postIntegration.create({
          data: {
            postId,
            userIntegrationId: integration.id,
            content: pickPlatformContent(post.content, integration.integration.slug),
            status: PostPlatformStatus.PENDING,
          },
        })
      )
    );

    return created;
  }

  static async getAvailableIntegrations(userId: string, agencyId: string) {
    const integrations = await prisma.userIntegration.findMany({
      where: { userId },
      include: {
        integration: true,
        posts: { orderBy: { createdAt: "desc" }, take: 1 },
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
        lastUsed: entry.posts[0]?.createdAt ?? null,
        platform,
      });
    });

    return grouped;
  }

  static async schedulePost(
    postId: string,
    scheduledAt: Date,
    selectedIntegrationIds: string[],
    userId: string,
    agencyId: string
  ) {
    if (scheduledAt.getTime() <= Date.now()) {
      throw new Error("Schedule must be in the future");
    }

    await this.selectIntegrationsForPost(
      postId,
      selectedIntegrationIds,
      userId,
      agencyId
    );

    const post = await prisma.post.update({
      where: { id: postId },
      data: {
        scheduledAt,
        status: PostStatus.SCHEDULED,
        nextScheduledRun: scheduledAt,
        isRecurring: false,
        recurringPattern: null,
      },
    });

    const jobId = await addPostToQueue(postId, scheduledAt);

    const firstIntegration = await prisma.postIntegration.findFirst({
      where: { postId },
      include: { userIntegration: true },
    });

    if (firstIntegration) {
      await logIntegrationEvent({
        userId,
        integrationId: firstIntegration.userIntegration.integrationId,
        userIntegrationId: firstIntegration.userIntegrationId,
        eventType: "post_scheduled",
        status: "success",
        response: { jobId, scheduledAt: scheduledAt.toISOString() },
      });
    }

    return { post, jobId };
  }

  static async setRecurringPost(
    postId: string,
    pattern: RecurringType,
    config: RecurringConfig & { selectedIntegrations: string[] },
    userId: string,
    agencyId: string
  ) {
    const nextRun = calculateNextRun(pattern, config, new Date());
    if (!nextRun) {
      throw new Error("Recurring schedule falls outside end date");
    }

    await this.selectIntegrationsForPost(
      postId,
      config.selectedIntegrations,
      userId,
      agencyId
    );

    const recurringDayOfWeek =
      pattern === RecurringType.WEEKLY
        ? (config.daysOfWeek && config.daysOfWeek[0]) ?? null
        : null;

    const post = await prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.RECURRING,
        isRecurring: true,
        recurringPattern: pattern,
        recurringDayOfWeek,
        recurringEndDate: normalizeEndDate(config.endDate),
        nextScheduledRun: nextRun,
        scheduledAt: nextRun,
      },
    });

    await addPostToQueue(postId, nextRun);

    return { post, nextRun };
  }

  static generateRecurringInstances(
    pattern: RecurringType,
    config: RecurringConfig,
    count: number
  ) {
    const instances: Array<{ date: Date }> = [];
    let cursor = new Date();

    for (let i = 0; i < count; i += 1) {
      const next = calculateNextRun(pattern, config, cursor);
      if (!next) break;
      instances.push({ date: next });
      cursor = addDays(next, 1);
    }

    return instances;
  }

  static async getAutomationRules(agencyId: string) {
    return prisma.automationRule.findMany({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
    });
  }

  static async createAutomationRule(
    agencyId: string,
    createdById: string,
    rule: {
      name: string;
      description?: string;
      triggerType: string;
      triggerCondition?: any;
      actionType: string;
      selectedIntegrations: string[];
      executeTime?: string;
      executeTimeZone?: string;
    }
  ) {
    if (!rule.name) {
      throw new Error("Rule name is required");
    }

    return prisma.automationRule.create({
      data: {
        agencyId,
        createdById,
        name: rule.name,
        description: rule.description,
        triggerType: rule.triggerType,
        triggerCondition: rule.triggerCondition ?? undefined,
        actionType: rule.actionType,
        selectedIntegrations: rule.selectedIntegrations,
        executeTime: rule.executeTime,
        executeTimeZone: rule.executeTimeZone ?? "UTC",
      },
    });
  }

  static async applyAutomationRule(
    postId: string,
    ruleId: string,
    userId: string,
    agencyId: string
  ) {
    const rule = await prisma.automationRule.findFirst({
      where: { id: ruleId, agencyId },
    });

    if (!rule) {
      throw new Error("Rule not found");
    }

    const scheduledAt = calculateNextRun(
      RecurringType.DAILY,
      { time: rule.executeTime ?? DEFAULT_TIME },
      new Date()
    );

    if (scheduledAt) {
      return this.schedulePost(
        postId,
        scheduledAt,
        rule.selectedIntegrations,
        userId,
        agencyId
      );
    }

    return this.selectIntegrationsForPost(
      postId,
      rule.selectedIntegrations,
      userId,
      agencyId
    );
  }

  static async optimizePostTiming(postId: string, agencyId: string, userId: string) {
    const metrics = await prisma.platformDailyMetrics.findMany({
      where: { agencyId, userId },
      orderBy: { date: "desc" },
      take: 60,
    });

    let suggestedTime = applyTime(addDays(new Date(), 1), DEFAULT_TIME);
    let reason = "Suggested based on default morning window.";
    let confidence = 0.4;

    if (metrics.length) {
      const dayScores = new Map<number, { total: number; count: number }>();
      metrics.forEach((entry) => {
        const day = new Date(entry.date).getDay();
        const score = entry.totalEngagement || 0;
        const prev = dayScores.get(day) ?? { total: 0, count: 0 };
        dayScores.set(day, { total: prev.total + score, count: prev.count + 1 });
      });

      let bestDay = new Date().getDay();
      let bestScore = -1;
      dayScores.forEach((value, day) => {
        const avg = value.total / Math.max(value.count, 1);
        if (avg > bestScore) {
          bestScore = avg;
          bestDay = day;
        }
      });

      const next = calculateNextRun(
        RecurringType.WEEKLY,
        { daysOfWeek: [bestDay], time: DEFAULT_TIME },
        new Date()
      );

      if (next) {
        suggestedTime = next;
        reason = "Best day of week based on recent engagement.";
        confidence = 0.7;
      }
    }

    await prisma.post.update({
      where: { id: postId },
      data: {
        bestTimeToPost: suggestedTime,
        isOptimized: true,
        optimizationNote: reason,
      },
    });

    return { suggestedTime, confidence, reason };
  }

  static async executeScheduledPost(postId: string) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new Error("Post not found");

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

    const jobId = await addPostToQueue(postId, null);

    await prisma.automationLog.create({
      data: {
        postId,
        executedAt: new Date(),
        status: "SUCCESS",
        message: "Queued for publishing",
        platformsExecuted: { jobId },
      },
    });

    return { jobId };
  }

  static async getAutomationStatus(postId: string, agencyId: string) {
    const post = await prisma.post.findFirst({
      where: { id: postId, agencyId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
        automationLogs: { orderBy: { executedAt: "desc" }, take: 20 },
      },
    });

    if (!post) throw new Error("Post not found");

    return {
      status: post.status,
      scheduledAt: post.scheduledAt,
      nextRun: post.nextScheduledRun,
      integrations: post.platformIntegrations.map((integration) => ({
        id: integration.id,
        platform: integration.userIntegration.integration.slug,
        accountName: integration.userIntegration.accountName,
        status: integration.status,
        error: integration.error,
      })),
      automationHistory: post.automationLogs,
    };
  }

  static async pauseAutomation(postId: string, agencyId: string) {
    const post = await prisma.post.findFirst({ where: { id: postId, agencyId } });
    if (!post) throw new Error("Post not found");

    await removePostJobs(post.id, post.scheduledAt);

    return prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.DRAFT, nextScheduledRun: null },
    });
  }

  static async resumeAutomation(postId: string, agencyId: string) {
    const post = await prisma.post.findFirst({ where: { id: postId, agencyId } });
    if (!post) throw new Error("Post not found");

    if (post.isRecurring && post.recurringPattern) {
      const nextRun = calculateNextRun(post.recurringPattern, { time: DEFAULT_TIME }, new Date());
      if (!nextRun) throw new Error("No upcoming run found");
      await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.RECURRING, nextScheduledRun: nextRun },
      });
      await addPostToQueue(post.id, nextRun);
      return { nextRun };
    }

    if (!post.scheduledAt) {
      throw new Error("No scheduled time found");
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.SCHEDULED },
    });

    await addPostToQueue(post.id, post.scheduledAt);

    return { scheduledAt: post.scheduledAt };
  }

  static async cancelRecurringPost(postId: string, agencyId: string) {
    const post = await prisma.post.findFirst({ where: { id: postId, agencyId } });
    if (!post) throw new Error("Post not found");

    await removePostJobs(post.id, post.nextScheduledRun ?? post.scheduledAt);

    return prisma.post.update({
      where: { id: post.id },
      data: {
        status: PostStatus.DRAFT,
        isRecurring: false,
        recurringPattern: null,
        recurringDayOfWeek: null,
        recurringEndDate: null,
        nextScheduledRun: null,
      },
    });
  }
}
