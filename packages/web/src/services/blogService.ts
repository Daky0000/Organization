import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : null;
  if (!res.ok) {
    const errorMessage = parsed?.error || parsed?.message || text || 'Request failed';
    throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed');
  }
  if (text && parsed === null) {
    throw new Error('Invalid server response');
  }
  return (parsed ?? {}) as T;
}

export interface BlogCategory {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface BlogTag {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface BlogPost {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  featured_image: string;
  status: 'draft' | 'published' | 'scheduled' | 'archived' | 'deleted';
  category_id: string | null;
  category_name?: string;
  tag_ids?: string[];
  tag_names?: string[];
  meta_title: string;
  meta_description: string;
  focus_keyword: string;
  social_title: string;
  social_description: string;
  social_image: string;
  social_automation?: any;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPostPayload {
  title?: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  featured_image?: string;
  status?: 'draft' | 'published' | 'scheduled' | 'archived' | 'deleted';
  category_id?: string | null;
  meta_title?: string;
  meta_description?: string;
  focus_keyword?: string;
  social_title?: string;
  social_description?: string;
  social_image?: string;
  social_automation?: any;
  scheduled_at?: string | null;
  tag_ids?: string[];
}

export const blogService = {
  // Categories
  async listCategories(): Promise<BlogCategory[]> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/categories`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ categories?: BlogCategory[] }>(res);
    return data.categories ?? [];
  },

  async createCategory(name: string): Promise<BlogCategory> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/categories`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await parseApiResponse<{ success?: boolean; category?: BlogCategory; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create category');
    return data.category!;
  },

  async updateCategory(id: string, name: string): Promise<BlogCategory> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/categories/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await parseApiResponse<{ success?: boolean; category?: BlogCategory; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update category');
    return data.category!;
  },

  async deleteCategory(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    await parseApiResponse(res);
  },

  // Tags
  async listTags(): Promise<BlogTag[]> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/tags`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ tags?: BlogTag[] }>(res);
    return data.tags ?? [];
  },

  async createTag(name: string): Promise<BlogTag> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/tags`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await parseApiResponse<{ success?: boolean; tag?: BlogTag; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create tag');
    return data.tag!;
  },

  async deleteTag(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/tags/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    await parseApiResponse(res);
  },

  // Posts
  async listPosts(params?: { status?: string; search?: string }): Promise<BlogPost[]> {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts?${qs}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ posts?: BlogPost[] }>(res);
    return data.posts ?? [];
  },

  async getPost(id: string): Promise<BlogPost> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/${id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ success?: boolean; post?: BlogPost; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Not found');
    return data.post!;
  },

  async createPost(payload: BlogPostPayload): Promise<BlogPost> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse<{ success?: boolean; post?: BlogPost; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create post');
    return data.post!;
  },

  async updatePost(id: string, payload: BlogPostPayload): Promise<BlogPost> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse<{ success?: boolean; post?: BlogPost; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update post');
    return data.post!;
  },

  async deletePost(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    await parseApiResponse(res);
  },

  async duplicatePost(id: string): Promise<BlogPost> {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/${id}/duplicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ success?: boolean; post?: BlogPost; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to duplicate post');
    return data.post!;
  },

  async repostToConnectedPlatforms(id: string, accountIds?: string[]): Promise<{ queued: number; skipped?: string[] }> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts/${id}/social-repost`, {
      method: 'POST',
      headers: authHeaders(),
      body: accountIds?.length ? JSON.stringify({ accountIds }) : undefined,
    });
    return parseApiResponse<{ success?: boolean; queued: number; skipped?: string[]; error?: string }>(res);
  },

  async getDistributionStatus(postId: string): Promise<{ logs: Array<{ id: string; platform: string; status: string; error_message?: string; platform_post_id?: string; created_at: string }> }> {
    const res = await fetch(`${API_BASE_URL}/api/distribution/status/${encodeURIComponent(postId)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    return parseApiResponse(res);
  },

  async batchReschedule(postIds: string[], scheduledAt: string) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/reschedule`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ postIds, scheduled_at: scheduledAt }),
    });
    return parseApiResponse<{ updated: number }>(res);
  },

  async batchTag(postIds: string[], tagIds: string[]) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/tag`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ postIds, tagIds }),
    });
    return parseApiResponse<{ updated: number }>(res);
  },

  async batchArchive(postIds: string[]) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/archive`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ postIds }),
    });
    return parseApiResponse<{ updated: number }>(res);
  },

  async batchDelete(postIds: string[]) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/delete`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ postIds }),
    });
    return parseApiResponse<{ updated: number }>(res);
  },

  async batchDuplicate(postIds: string[]) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/duplicate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ postIds }),
    });
    return parseApiResponse<{ created: number }>(res);
  },

  async batchExport(postIds: string[]): Promise<string> {
    const qs = new URLSearchParams();
    postIds.forEach((id) => qs.append('postIds', id));
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/export?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Export failed');
    }
    return res.text();
  },

  async batchUpdatePlatforms(postIds: string[], accountIds: string[]) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/platforms`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ postIds, accountIds }),
    });
    return parseApiResponse<{ updated: number }>(res);
  },

  async batchRestore(previousState: BlogPost[]) {
    const res = await fetch(`${API_BASE_URL}/api/v1/blog/posts/batch/restore`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ previousState }),
    });
    return parseApiResponse<{ restored: number }>(res);
  },
};
