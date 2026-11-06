import { useCallback, useState } from "react";
import api from "../utils/api";

export type PlatformStatus = {
  platform: string;
  accountName?: string | null;
  status: string;
  platformPostId?: string | null;
  postedAt?: string | null;
  nextScheduledRun?: string | null;
  isRecurring?: boolean;
  error?: string | null;
};

export type Post = {
  id: string;
  title: string;
  content: any;
  status: string;
  scheduledAt?: string | null;
  postedAt?: string | null;
  nextScheduledRun?: string | null;
  isRecurring?: boolean;
  createdAt?: string;
  platformStatuses?: PlatformStatus[];
  analytics?: any;
};

export type PlatformSelection = {
  id: string;
  platform: string;
  accountName?: string | null;
};

export type AvailableIntegrations = Record<
  string,
  Array<{
    id: string;
    accountName?: string | null;
    accountId?: string | null;
    status?: string | null;
    lastUsed?: string | null;
    isSelectedForPost?: boolean;
  }>
>;

export type PostWithPlatformsResponse = {
  post: Post;
  selectedIntegrations: PlatformSelection[];
  availableIntegrations: AvailableIntegrations;
};

export type RescheduleOption = {
  time: string;
  date: string;
  score: number;
};

const getErrorMessage = (error: any) =>
  error?.response?.data?.error || error?.message || "Something went wrong";

export const usePosts = () => {
  const [posts, setPosts] = useState<Post[]>([]);
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

  const createPostWithIntegrations = useCallback(
    async (
      title: string,
      content: string,
      integrationIds: string[],
      scheduledAt?: Date
    ) => {
      const payload = {
        title,
        content,
        integrationIds,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : undefined,
      };
      const data = await run(async () => {
        const response = await api.post<Post>("/posts", payload);
        return response.data;
      });
      setPosts((prev) => [data, ...prev]);
      return data;
    },
    [run]
  );

  const createDraft = useCallback(
    async (title: string, content: string) => {
      const payload = { title, content, status: "DRAFT" };
      const data = await run(async () => {
        const response = await api.post<Post>("/posts", payload);
        return response.data;
      });
      setPosts((prev) => [data, ...prev]);
      return data;
    },
    [run]
  );

  const getPosts = useCallback(
    async (filters?: { status?: string; limit?: number; offset?: number }) => {
      const data = await run(async () => {
        const response = await api.get<Post[]>("/posts", {
          params: filters,
        });
        return response.data;
      });
      setPosts(data);
      return data;
    },
    [run]
  );

  const getPendingPosts = useCallback(() => {
    return getPosts({ status: "SCHEDULED" });
  }, [getPosts]);

  const getPostedPosts = useCallback(() => {
    return getPosts({ status: "POSTED" });
  }, [getPosts]);

  const getFailedPosts = useCallback(() => {
    return getPosts({ status: "FAILED" });
  }, [getPosts]);

  const getPostStatus = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.get<Post>(`/posts/${postId}/status`);
        return response.data as any;
      });
      setPosts((prev) =>
        prev.map((post) => (post.id === postId ? { ...post, ...data } : post))
      );
      return data;
    },
    [run]
  );

  const getPostWithIntegrations = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.get<PostWithPlatformsResponse>(
          `/posts/${postId}/with-platforms`
        );
        return response.data;
      });
      return data;
    },
    [run]
  );

  const savePlatformSelection = useCallback(
    async (postId: string, integrationIds: string[]) => {
      const data = await run(async () => {
        const response = await api.put(`/posts/${postId}/platform-selection`, {
          integrationIds,
        });
        return response.data;
      });
      return data;
    },
    [run]
  );

  const updatePostWithIntegrations = useCallback(
    async (
      postId: string,
      payload: {
        title?: string;
        content?: string;
        selectedIntegrationIds?: string[];
      }
    ) => {
      const data = await run(async () => {
        const response = await api.put<Post>(`/posts/${postId}`, payload);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) => (post.id === postId ? { ...post, ...data } : post))
      );
      return data;
    },
    [run]
  );

  const getAvailableIntegrationsForPost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.get<PostWithPlatformsResponse>(
          `/posts/${postId}/with-platforms`
        );
        return response.data.availableIntegrations;
      });
      return data;
    },
    [run]
  );

  const reschedulePost = useCallback(
    async (postId: string, newTime: Date) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/reschedule`, {
          scheduledAt: newTime.toISOString(),
        });
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, status: "SCHEDULED", scheduledAt: newTime.toISOString() }
            : post
        )
      );
      return data;
    },
    [run]
  );

  const getRescheduleOptions = useCallback(
    async (postId: string, daysAhead = 7) => {
      const data = await run(async () => {
        const response = await api.get<RescheduleOption[]>(
          `/posts/${postId}/reschedule-options`,
          { params: { daysAhead } }
        );
        return response.data;
      });
      return data;
    },
    [run]
  );

  const postNow = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/post-now`);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, status: "APPROVED", scheduledAt: null }
            : post
        )
      );
      return data;
    },
    [run]
  );

  const cancelPost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/cancel`);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? { ...post, status: "APPROVED", scheduledAt: null }
            : post
        )
      );
      return data;
    },
    [run]
  );

  const retryPost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.post(`/posts/${postId}/retry`);
        return response.data;
      });
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId ? { ...post, status: "APPROVED" } : post
        )
      );
      return data;
    },
    [run]
  );

  const deletePost = useCallback(
    async (postId: string) => {
      const data = await run(async () => {
        const response = await api.delete(`/posts/${postId}`);
        return response.data;
      });
      setPosts((prev) => prev.filter((post) => post.id !== postId));
      return data;
    },
    [run]
  );

  return {
    posts,
    loading,
    error,
    createPostWithIntegrations,
    createDraft,
    getPosts,
    getPendingPosts,
    getPostedPosts,
    getFailedPosts,
    getPostStatus,
    getPostWithIntegrations,
    savePlatformSelection,
    updatePostWithIntegrations,
    getAvailableIntegrationsForPost,
    reschedulePost,
    getRescheduleOptions,
    postNow,
    cancelPost,
    retryPost,
    deletePost,
  };
};
