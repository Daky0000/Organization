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

export type InstagramMedia = {
  id: string;
  user_id: string;
  social_account_id: string;
  media_id: string;
  caption: string | null;
  media_type: string | null;
  media_product_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  impressions: number;
  reach: number;
  engagement: number;
  posted_at: string | null;
  fetched_at: string;
  account_name: string | null;
  handle: string | null;
  instagram_username: string | null;
};

export type InstagramPostsSummary = {
  total_posts: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  total_saves: number;
  total_impressions: number;
  total_reach: number;
  total_engagement: number;
  avg_engagement_rate: number;
};

export type InstagramPostsResponse = {
  success: boolean;
  posts: InstagramMedia[];
  total: number;
  summary: InstagramPostsSummary;
  days: number;
};

export type InstagramSyncResult = {
  synced: number;
  errors?: string[];
};

export type InstagramProfileResponse = {
  hasData: boolean;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  bio: string | null;
  is_verified: boolean | null;
  account_name: string | null;
  handle: string | null;
  picture_url: string | null;
  account_type: string | null;
  page_name: string | null;
  page_id: string | null;
  website: string | null;
  synced_at: string | null;
};

export const instagramAnalyticsService = {
  async sync(): Promise<InstagramSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/instagram/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getProfile(): Promise<InstagramProfileResponse> {
    return apiFetch('/api/social/instagram/profile');
  },

  async getPosts(options: { days?: number; limit?: number; offset?: number; accountId?: string } = {}): Promise<InstagramPostsResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    return apiFetch(`/api/social/instagram/posts?${params.toString()}`);
  },
};
