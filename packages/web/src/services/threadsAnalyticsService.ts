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
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Invalid server response');
  }
  if (!res.ok) throw new Error(json?.error || json?.message || 'Request failed');
  return json as T;
}

export type ThreadsPost = {
  id: string;
  user_id: string;
  social_account_id: string;
  platform_post_id: string;

  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;

  posted_at: string | null;
  fetched_at: string;

  account_name: string | null;
  handle: string | null;

  // Enriched from raw thread object (stored in social_metrics.raw_data)
  thread_id: string;
  text: string | null;
  permalink: string | null;
  username: string | null;
  media_product_type?: string | null;
  media_type: string | null;
  media_url: string | null;
  gif_url?: string | null;
  thumbnail_url: string | null;
  alt_text?: string | null;
  link_attachment_url: string | null;
  poll_attachment?: unknown;
  location_id?: string | null;
  topic_tag?: string | null;
  is_quote_post: boolean;
  has_replies: boolean;

  // Convenience analytics fields
  views: number;
  replies: number;
  reposts: number;
  quotes: number;
};

export type ThreadsPostsSummary = {
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_replies: number;
  total_reposts: number;
  total_quotes: number;
  total_shares: number;
  total_engagement: number;
  avg_engagement_rate: number;
};

export type ThreadsPostsResponse = {
  success: boolean;
  posts: ThreadsPost[];
  total: number;
  summary: ThreadsPostsSummary;
  days: number;
};

export type ThreadsSyncResult = {
  synced: number;
  errors?: string[];
};

export type ThreadsProfileResponse = {
  hasData: boolean;
  followers: number | null;
  posts_count: number | null;
  total_likes: number | null;
  total_views: number | null;
  total_replies: number | null;
  total_reposts: number | null;
  total_quotes: number | null;
  total_clicks: number | null;
  follower_demographics: Partial<Record<'country' | 'city' | 'age' | 'gender', unknown>> | null;
  bio: string | null;
  is_verified: boolean | null;
  account_name: string | null;
  handle: string | null;
  picture_url: string | null;
  synced_at: string | null;
};

export const threadsAnalyticsService = {
  async sync(): Promise<ThreadsSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/threads/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getProfile(): Promise<ThreadsProfileResponse> {
    return apiFetch('/api/social/threads/profile');
  },

  async getPosts(options: { days?: number; limit?: number; offset?: number; accountId?: string } = {}): Promise<ThreadsPostsResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    return apiFetch(`/api/social/threads/posts?${params.toString()}`);
  },

  async debugToken(): Promise<{ success: boolean; data: unknown }> {
    return apiFetch('/api/social/threads/debug-token');
  },

  async getReplies(
    threadId: string,
    options: { limit?: number; after?: string; reverse?: boolean; fields?: string } = {}
  ): Promise<{ success: boolean; data: unknown }> {
    const id = String(threadId || '').trim();
    if (!id) throw new Error('threadId is required');
    const params = new URLSearchParams({ thread_id: id });
    if (options.limit) params.set('limit', String(options.limit));
    if (options.after) params.set('after', String(options.after));
    if (options.fields) params.set('fields', String(options.fields));
    if (typeof options.reverse === 'boolean') params.set('reverse', options.reverse ? 'true' : 'false');
    return apiFetch(`/api/social/threads/replies?${params.toString()}`);
  },

  async hideReply(replyId: string, hide = true): Promise<{ success: boolean; data: unknown }> {
    const rid = String(replyId || '').trim();
    if (!rid) throw new Error('replyId is required');
    return apiFetch('/api/social/threads/replies/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyId: rid, hide: Boolean(hide) }),
    });
  },

  async respondToReply(replyToId: string, text: string): Promise<{ success: boolean; platformPostId?: string }> {
    const rid = String(replyToId || '').trim();
    const bodyText = String(text || '').trim();
    if (!rid || !bodyText) throw new Error('replyToId and text are required');
    return apiFetch('/api/social/threads/replies/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyToId: rid, text: bodyText }),
    });
  },

  async searchLocations(
    query: string,
    options: { latitude?: string | number; longitude?: string | number; fields?: string } = {}
  ): Promise<{ success: boolean; data: unknown }> {
    const q = String(query || '').trim();
    if (!q) throw new Error('query is required');
    const params = new URLSearchParams({ q });
    if (options.latitude !== undefined) params.set('latitude', String(options.latitude));
    if (options.longitude !== undefined) params.set('longitude', String(options.longitude));
    if (options.fields) params.set('fields', String(options.fields));
    return apiFetch(`/api/social/threads/locations/search?${params.toString()}`);
  },

  async getLocation(locationId: string, options: { fields?: string } = {}): Promise<{ success: boolean; data: unknown }> {
    const id = String(locationId || '').trim();
    if (!id) throw new Error('locationId is required');
    const params = new URLSearchParams();
    if (options.fields) params.set('fields', String(options.fields));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return apiFetch(`/api/social/threads/locations/${encodeURIComponent(id)}${suffix}`);
  },
};

