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

export type LinkedInPost = {
  id: string;
  user_id: string;
  social_account_id: string;
  post_id: string;
  text: string | null;
  post_url: string | null;
  media_type: string | null;
  created_at: string | null;
  fetched_at: string;
  account_name: string | null;
};

export type LinkedInPostSummary = {
  total_posts: number;
};

export type LinkedInPostsResponse = {
  success: boolean;
  posts: LinkedInPost[];
  total: number;
  summary: LinkedInPostSummary;
};

export type LinkedInSyncResult = {
  synced: number;
  errors?: string[];
};

export type LinkedInProfileResponse = {
  hasData: boolean;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  connections_count: number;
  profile_picture_url: string | null;
  account_name: string | null;
  synced_at: string | null;
};

// Company Page types
export type LinkedInCompanyPost = {
  id: string;
  user_id: string;
  social_account_id: string;
  post_id: string;
  organization_id: string;
  text: string | null;
  media_type: string | null;
  impressions: number;
  likes: number;
  comments: number;
  reposts: number;
  clicks: number;
  engagement_rate: number;
  created_at: string | null;
  fetched_at: string;
  account_name: string | null;
};

export type LinkedInCompanyPostSummary = {
  total_posts: number;
  total_impressions: number;
  total_likes: number;
  total_comments: number;
  total_clicks: number;
  avg_engagement_rate: number;
};

export type LinkedInCompanyPostsResponse = {
  success: boolean;
  posts: LinkedInCompanyPost[];
  total: number;
  summary: LinkedInCompanyPostSummary;
};

export type LinkedInCompanyStatsResponse = {
  hasData: boolean;
  organization_id: string;
  organization_name: string | null;
  follower_count: number;
  posts_created: number;
  engagement_rate: number;
  logo_url: string | null;
  synced_at: string | null;
};

export type LinkedInOrganization = {
  id: string;
  name: string;
  picture_url?: string | null;
};

export const linkedInAnalyticsService = {
  async sync(): Promise<LinkedInSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/linkedin/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async listOrganizations(): Promise<{ success: boolean; organizations: LinkedInOrganization[] }> {
    return apiFetch('/api/social/linkedin/organizations');
  },

  async getProfile(): Promise<LinkedInProfileResponse> {
    return apiFetch('/api/social/linkedin/profile');
  },

  async getPosts(options: { limit?: number; offset?: number } = {}): Promise<LinkedInPostsResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    return apiFetch(`/api/social/linkedin/posts?${params.toString()}`);
  },

  async syncCompany(organizationId: string): Promise<LinkedInSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/linkedin/company-sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getCompanyStats(organizationId: string): Promise<LinkedInCompanyStatsResponse> {
    const params = new URLSearchParams();
    params.set('organization_id', organizationId);
    return apiFetch(`/api/social/linkedin/company-stats?${params.toString()}`);
  },

  async getCompanyPosts(organizationId: string, options: { limit?: number; offset?: number } = {}): Promise<LinkedInCompanyPostsResponse> {
    const params = new URLSearchParams();
    params.set('organization_id', organizationId);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    return apiFetch(`/api/social/linkedin/company-posts?${params.toString()}`);
  },
};

