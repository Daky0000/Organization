import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers || {}) },
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error('Invalid server response'); }
  if (!res.ok) throw new Error(json?.error || json?.message || 'Request failed');
  return json as T;
}

export type FacebookPost = {
  id: string;
  user_id: string;
  social_account_id: string;
  post_id: string;
  message: string | null;
  picture: string | null;
  story: string | null;
  type: string | null;
  permalink_url: string | null;
  shares: number;
  likes_count: number;
  comments_count: number;
  engagement: number;
  created_at: string | null;
  fetched_at: string;
  account_name: string | null;
};

export type FacebookPostSummary = {
  total_posts: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  total_engagement: number;
  avg_engagement_per_post: number;
};

export type FacebookPostsResponse = {
  success: boolean;
  posts: FacebookPost[];
  total: number;
  summary: FacebookPostSummary;
  days: number;
};

export type FacebookSyncResult = {
  synced: number;
  errors?: string[];
};

export type FacebookStatsResponse = {
  hasData: boolean;
  followers: number | null;
  page_likes: number | null;
  posts_count: number | null;
  engagement_rate: number | null;
  bio: string | null;
  picture_url: string | null;
  account_name: string | null;
  synced_at: string | null;
};

export type FacebookAccount = {
  id: string;
  account_id: string;
  name: string;
  type: 'page' | 'group';
  followers?: number;
  likes?: number;
  members?: number;
  picture_url?: string;
};

export type FacebookAccountsResponse = {
  success: boolean;
  pages: FacebookAccount[];
  groups: FacebookAccount[];
  total_pages: number;
  total_groups: number;
};

export const facebookAnalyticsService = {
  async sync(): Promise<FacebookSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/facebook/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getAccounts(): Promise<FacebookAccountsResponse> {
    return apiFetch('/api/social/facebook/accounts');
  },

  async getPosts(options: { days?: number; limit?: number; offset?: number; accountId?: string } = {}): Promise<FacebookPostsResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    return apiFetch(`/api/social/facebook/posts?${params.toString()}`);
  },

  async getStats(): Promise<FacebookStatsResponse> {
    return apiFetch('/api/social/facebook/stats');
  },
};
