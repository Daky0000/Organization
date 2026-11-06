import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error('Invalid server response'); }
  if (!res.ok) throw new Error(json?.error || json?.message || 'Request failed');
  return json as T;
}

export type SocialAccount = {
  id: string;
  platform: string;
  account_name: string;
  handle: string | null;
  followers: number;
  connected_at: string | null;
  // profile-level stats (populated from token_data after sync)
  following_count: number;
  video_count: number;
  total_likes_count: number;
  bio: string | null;
  // aggregated post metrics
  total_reach: number;
  total_impressions: number;
  total_engagement: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  posts_synced: number;
  engagement_rate: number;
  is_verified: boolean;
};

export type AccountDashboard = {
  account: {
    id: string;
    platform: string;
    account_name: string;
    handle: string | null;
    followers: number;
    following_count: number;
    video_count: number;
    total_likes_count: number;
    bio: string | null;
    is_verified: boolean;
    connected_at: string | null;
  };
  summary: {
    total_reach: number;
    total_impressions: number;
    total_engagement: number;
    total_likes: number;
    total_comments: number;
    total_shares: number;
    posts_count: number;
    engagement_rate: number;
  };
  trend: Array<{
    date: string;
    reach: number;
    impressions: number;
    engagement: number;
    likes: number;
    comments: number;
    posts: number;
    engagement_rate: number;
  }>;
  top_posts: Array<{
    platform_post_id: string;
    post_id: string | null;
    title: string;
    likes: number;
    comments: number;
    shares: number;
    impressions: number;
    reach: number;
    engagement: number;
    posted_at: string | null;
    engagement_rate: number;
  }>;
  days: number;
};

export type RankingEntry = {
  id: string;
  platform: string;
  account_name: string;
  value: number;
  rank: number;
};

export type ComparisonInsight = {
  type: string;
  title: string;
  description: string;
  winner: string;
};

export type ComparisonData = {
  accounts: SocialAccount[];
  rankings: {
    by_followers: RankingEntry[];
    by_engagement: RankingEntry[];
    by_reach: RankingEntry[];
  };
  insights: ComparisonInsight[];
  days: number;
};

export const socialAnalyticsService = {
  async getAccounts(days = 30): Promise<{ accounts: SocialAccount[]; days: number }> {
    return apiFetch(`/api/analytics/social/accounts?days=${days}`);
  },

  async getAccountDashboard(accountId: string, days = 30): Promise<AccountDashboard> {
    return apiFetch(`/api/analytics/social/account/${encodeURIComponent(accountId)}?days=${days}`);
  },

  async getComparison(days = 30): Promise<ComparisonData> {
    return apiFetch(`/api/analytics/social/comparison?days=${days}`);
  },
};
