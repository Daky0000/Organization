import { Router, Response } from "express";
import { RecurringType } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { PostAutomationService } from "../services/automation/post-automation.service";
import { prisma } from "../utils/prisma";

const router = Router();

const parseDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

router.get(
  "/integrations",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await PostAutomationService.getAvailableIntegrations(
        req.userId!,
        req.agencyId!
      );
      res.json(data);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/schedule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { scheduledAt, integrationIds } = req.body as {
        scheduledAt?: string;
        integrationIds?: string[];
      };

      const date = parseDate(scheduledAt);
      if (!date) {
        return res.status(400).json({ error: "Invalid schedule date" });
      }

      if (!integrationIds || !integrationIds.length) {
        return res
          .status(400)
          .json({ error: "Select at least one integration" });
      }

      const result = await PostAutomationService.schedulePost(
        req.params.id,
        date,
        integrationIds,
        req.userId!,
        req.agencyId!
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/recurring",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        pattern,
        dayOfWeek,
        time,
        timeZone,
        endDate,
        integrationIds,
      } = req.body as {
        pattern?: RecurringType;
        dayOfWeek?: number[];
        time?: string;
        timeZone?: string;
        endDate?: string;
        integrationIds?: string[];
      };

      if (!pattern) {
        return res.status(400).json({ error: "Pattern is required" });
      }

      if (!integrationIds || !integrationIds.length) {
        return res
          .status(400)
          .json({ error: "Select at least one integration" });
      }

      const result = await PostAutomationService.setRecurringPost(
        req.params.id,
        pattern,
        {
          daysOfWeek: dayOfWeek,
          time,
          timeZone,
          endDate: endDate ? new Date(endDate) : null,
          selectedIntegrations: integrationIds,
        },
        req.userId!,
        req.agencyId!
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/posts/:id/upcoming-instances",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const count = Number(req.query.count ?? 5);
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });

      if (!post || !post.recurringPattern) {
        return res.status(404).json({ error: "Recurring post not found" });
      }

      const instances = PostAutomationService.generateRecurringInstances(
        post.recurringPattern,
        {
          daysOfWeek:
            post.recurringDayOfWeek != null
              ? [post.recurringDayOfWeek]
              : undefined,
          endDate: post.recurringEndDate ?? undefined,
          time: post.nextScheduledRun
            ? `${post.nextScheduledRun.getHours()}`.padStart(2, "0") +
              ":" +
              `${post.nextScheduledRun.getMinutes()}`.padStart(2, "0")
            : undefined,
        },
        Number.isFinite(count) ? count : 5
      );

      res.json(instances);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/posts/:id/status",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const status = await PostAutomationService.getAutomationStatus(
        req.params.id,
        req.agencyId!
      );
      res.json(status);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/pause",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await PostAutomationService.pauseAutomation(
        req.params.id,
        req.agencyId!
      );
      res.json({ success: true, post });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/resume",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await PostAutomationService.resumeAutomation(
        req.params.id,
        req.agencyId!
      );
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.delete(
  "/posts/:id/cancel-recurring",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await PostAutomationService.cancelRecurringPost(
        req.params.id,
        req.agencyId!
      );
      res.json({ success: true, post });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/optimize-timing",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await PostAutomationService.optimizePostTiming(
        req.params.id,
        req.agencyId!,
        req.userId!
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/rules",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const rules = await PostAutomationService.getAutomationRules(req.agencyId!);
      res.json(rules);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/rules",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const rule = await PostAutomationService.createAutomationRule(
        req.agencyId!,
        req.userId!,
        req.body
      );
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/apply-rule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { ruleId } = req.body as { ruleId?: string };
      if (!ruleId) {
        return res.status(400).json({ error: "ruleId is required" });
      }

      const result = await PostAutomationService.applyAutomationRule(
        req.params.id,
        ruleId,
        req.userId!,
        req.agencyId!
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/logs/:postId",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const logs = await prisma.automationLog.findMany({
        where: { postId: req.params.postId },
        orderBy: { executedAt: "desc" },
      });
      res.json(logs);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/batch-schedule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { postIds, integrationIds, scheduledAt } = req.body as {
        postIds?: string[];
        integrationIds?: string[];
        scheduledAt?: string;
      };

      if (!postIds || !postIds.length) {
        return res.status(400).json({ error: "postIds is required" });
      }

      if (!integrationIds || !integrationIds.length) {
        return res.status(400).json({ error: "integrationIds is required" });
      }

      const date = parseDate(scheduledAt);
      if (!date) {
        return res.status(400).json({ error: "Invalid schedule date" });
      }

      const results = [] as any[];
      for (const postId of postIds) {
        const result = await PostAutomationService.schedulePost(
          postId,
          date,
          integrationIds,
          req.userId!,
          req.agencyId!
        );
        results.push(result);
      }

      res.json({ success: true, results });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;
