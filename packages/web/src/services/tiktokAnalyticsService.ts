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

export type TikTokVideo = {
  id: string;
  user_id: string;
  social_account_id: string;
  video_id: string;
  title: string | null;
  cover_url: string | null;
  share_url: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagement: number;
  duration_seconds: number;
  posted_at: string | null;
  fetched_at: string;
  account_name: string | null;
  handle: string | null;
  // Enriched via video/query API
  video_description: string | null;
  embed_html: string | null;
  embed_link: string | null;
  height: number | null;
  width: number | null;
};

export type TikTokVideoSummary = {
  total_videos: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  total_views: number;
  total_engagement: number;
  avg_engagement_rate: number;
};

export type TikTokVideosResponse = {
  success: boolean;
  videos: TikTokVideo[];
  total: number;
  summary: TikTokVideoSummary;
  days: number;
};

export type TikTokSyncResult = {
  synced: number;
  errors?: string[];
};

export type TikTokFollowersResponse = {
  hasData: boolean;
  followers:    number | null;
  following:    number | null;
  posts_count:  number | null;
  total_likes:  number | null;
  bio:          string | null;
  is_verified:  boolean | null;
  display_name: string | null;
  handle:       string | null;
  synced_at:    string | null;
};

export const tiktokAnalyticsService = {
  async sync(): Promise<TikTokSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/tiktok/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getVideos(options: { days?: number; limit?: number; offset?: number; accountId?: string } = {}): Promise<TikTokVideosResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    return apiFetch(`/api/social/tiktok/videos?${params.toString()}`);
  },

  async getFollowers(): Promise<TikTokFollowersResponse> {
    return apiFetch('/api/social/tiktok/followers');
  },
};
