import { useCallback, useState } from "react";
import api from "../utils/api";
import type { Post } from "./usePosts";

export type AutomationIntegration = {
  id: string;
  platform: string;
  accountName?: string;
  accountId?: string;
  status?: string;
  lastUsed?: string | null;
  followers?: number | null;
};

export type AutomationRule = {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  triggerType: string;
  triggerCondition?: any;
  actionType: string;
  selectedIntegrations: string[];
  executeTime?: string | null;
  executeTimeZone?: string | null;
};

export type AutomationLog = {
  id: string;
  postId: string;
  executedAt: string;
  status: string;
  message?: string | null;
  platformsExecuted?: any;
};

const getErrorMessage = (error: any) =>
  error?.response?.data?.error || error?.message || "Something went wrong";

export const useAutomation = () => {
  const [availableIntegrations, setAvailableIntegrations] = useState<
    AutomationIntegration[]
  >([]);
  const [scheduledPosts, setScheduledPosts] = useState<Post[]>([]);
  const [recurringPosts, setRecurringPosts] = useState<Post[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: any) {
      const message = getErrorMessage(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getAvailableIntegrations = useCallback(async () => {
    const data = await run(async () => {
      const response = await api.get("/automation/integrations");
      return response.data as Record<string, AutomationIntegration[]>;
    });

    const flattened: AutomationIntegration[] = [];
    Object.entries(data).forEach(([platform, items]) => {
      items.forEach((item) => {
        flattened.push({ ...item, platform });
      });
    });
    setAvailableIntegrations(flattened);
    return data;
  }, [run]);

  const refreshAutomationPosts = useCallback(async () => {
    const [scheduled, recurring] = await Promise.all([
      api.get<Post[]>("/posts", { params: { status: "SCHEDULED" } }),
      api.get<Post[]>("/posts", { params: { status: "RECURRING" } }),
    ]);
    setScheduledPosts(scheduled.data);
    setRecurringPosts(recurring.data);
    return { scheduled: scheduled.data, recurring: recurring.data };
  }, []);

  const schedulePost = useCallback(
    async (postId: string, config: { scheduledAt: Date; integrationIds: string[] }) => {
      const data = await run(async () => {
        const response = await api.post(`/automation/posts/${postId}/schedule`, {
          scheduledAt: config.scheduledAt.toISOString(),
          integrationIds: config.integrationIds,
        });
        return response.data;
      });
      return data;
    },
    [run]
  );

  const createRecurringPost = useCallback(
    async (
      postId: string,
      config: {
        pattern: string;
        time?: string;
        daysOfWeek?: number[];
        endDate?: Date | null;
        integrationIds: string[];
      }
    ) => {
      const data = await run(async () => {
        const response = await api.post(`/automation/posts/${postId}/recurring`, {
          pattern: config.pattern,
          time: config.time,
          dayOfWeek: config.daysOfWeek,
          endDate: config.endDate ? config.endDate.toISOString() : undefined,
          integrationIds: config.integrationIds,
        });
        return response.data;
      });
      return data;
    },
    [run]
  );

  const getUpcomingInstances = useCallback(async (postId: string, count = 10) => {
    const data = await run(async () => {
      const response = await api.get(
        `/automation/posts/${postId}/upcoming-instances`,
        { params: { count } }
      );
      return response.data;
    });
    return data;
  }, [run]);

  const getAutomationStatus = useCallback(async (postId: string) => {
    const data = await run(async () => {
      const response = await api.get(`/automation/posts/${postId}/status`);
      return response.data;
    });
    return data;
  }, [run]);

  const pauseAutomation = useCallback(async (postId: string) => {
    const data = await run(async () => {
      const response = await api.post(`/automation/posts/${postId}/pause`);
      return response.data;
    });
    return data;
  }, [run]);

  const resumeAutomation = useCallback(async (postId: string) => {
    const data = await run(async () => {
      const response = await api.post(`/automation/posts/${postId}/resume`);
      return response.data;
    });
    return data;
  }, [run]);

  const cancelRecurring = useCallback(async (postId: string) => {
    const data = await run(async () => {
      const response = await api.delete(`/automation/posts/${postId}/cancel-recurring`);
      return response.data;
    });
    return data;
  }, [run]);

  const optimizePostTiming = useCallback(async (postId: string) => {
    const data = await run(async () => {
      const response = await api.post(`/automation/posts/${postId}/optimize-timing`);
      return response.data;
    });
    return data;
  }, [run]);

  const getAutomationRules = useCallback(async () => {
    const data = await run(async () => {
      const response = await api.get<AutomationRule[]>("/automation/rules");
      return response.data;
    });
    setAutomationRules(data);
    return data;
  }, [run]);

  const createRule = useCallback(async (rule: any) => {
    const data = await run(async () => {
      const response = await api.post<AutomationRule>("/automation/rules", rule);
      return response.data;
    });
    setAutomationRules((prev) => [data, ...prev]);
    return data;
  }, [run]);

  const applyRule = useCallback(async (postId: string, ruleId: string) => {
    const data = await run(async () => {
      const response = await api.post(`/automation/posts/${postId}/apply-rule`, {
        ruleId,
      });
      return response.data;
    });
    return data;
  }, [run]);

  const getAutomationLogs = useCallback(async (postId: string) => {
    const data = await run(async () => {
      const response = await api.get<AutomationLog[]>(`/automation/logs/${postId}`);
      return response.data;
    });
    return data;
  }, [run]);

  return {
    availableIntegrations,
    scheduledPosts,
    recurringPosts,
    automationRules,
    loading,
    error,
    getAvailableIntegrations,
    refreshAutomationPosts,
    schedulePost,
    createRecurringPost,
    getUpcomingInstances,
    getAutomationStatus,
    pauseAutomation,
    resumeAutomation,
    cancelRecurring,
    optimizePostTiming,
    getAutomationRules,
    createRule,
    applyRule,
    getAutomationLogs,
  };
};
