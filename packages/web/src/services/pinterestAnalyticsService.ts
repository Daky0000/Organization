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

export type PinterestPin = {
  id: string;
  user_id: string;
  social_account_id: string;
  platform_post_id: string;

  impressions: number;
  clicks: number;
  saves: number;
  likes: number;
  comments: number;
  engagement: number;

  posted_at: string | null;
  fetched_at: string;

  account_name: string | null;
  handle: string | null;

  // Enriched from raw pin object
  pin_id: string;
  title: string | null;
  description: string | null;
  link: string | null;
  board_id: string | null;
  creative_type: string | null;
  media_url: string | null;
  pin_clicks: number | null;
  outbound_clicks: number | null;
  saves_count: number | null;
  created_at: string | null;
};

export type PinterestPinsSummary = {
  total_pins: number;
  total_impressions: number;
  total_outbound_clicks: number;
  total_saves: number;
  total_reactions: number;
  total_comments: number;
  total_engagement: number;
  total_pin_clicks: number;
  avg_engagement_rate: number;
};

export type PinterestPinsResponse = {
  success: boolean;
  pins: PinterestPin[];
  total: number;
  summary: PinterestPinsSummary;
  days: number;
};

export type PinterestSyncResult = {
  synced: number;
  errors?: string[];
};

export type PinterestBoard = {
  id: string;
  name: string;
};

export type PinterestBoardsResponse = {
  success: boolean;
  boards: PinterestBoard[];
};

export type PinterestCreateBoardResponse = {
  success: boolean;
  board: PinterestBoard;
};

export type PinterestBoardPerformance = {
  board_id: string;
  board_name: string | null;
  total_pins: number;
  total_impressions: number;
  total_outbound_clicks: number;
  total_saves: number;
  total_reactions: number;
  total_comments: number;
  total_engagement: number;
  engagement_rate: number;
  last_activity: string | null;
};

export type PinterestBoardsPerformanceResponse = {
  success: boolean;
  boards: PinterestBoardPerformance[];
  days: number;
};

export type PinterestDefaultBoard = {
  id: string;
  name?: string | null;
};

export type PinterestProfileResponse = {
  hasData: boolean;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  bio: string | null;
  account_name: string | null;
  handle: string | null;
  picture_url: string | null;
  website: string | null;
  monthly_views: number | null;
  synced_at: string | null;
};

export const pinterestAnalyticsService = {
  async sync(): Promise<PinterestSyncResult> {
    const result = await apiFetch<{ success: boolean; synced: number; errors?: string[] }>(
      '/api/social/pinterest/sync',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return { synced: result.synced, errors: result.errors };
  },

  async getProfile(): Promise<PinterestProfileResponse> {
    return apiFetch('/api/social/pinterest/profile');
  },

  async getBoards(): Promise<PinterestBoardsResponse> {
    return apiFetch('/api/pinterest/boards');
  },

  async createBoard(payload: {
    name: string;
    description?: string;
    privacy?: 'PUBLIC' | 'SECRET';
  }): Promise<PinterestBoard> {
    const result = await apiFetch<PinterestCreateBoardResponse>('/api/pinterest/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return result.board;
  },

  async getBoardsPerformance(days = 90): Promise<PinterestBoardsPerformanceResponse> {
    const params = new URLSearchParams();
    params.set('days', String(days));
    return apiFetch(`/api/social/pinterest/boards-performance?${params.toString()}`);
  },

  async getDefaultBoard(): Promise<PinterestDefaultBoard | null> {
    const result = await apiFetch<{ success: boolean; value: any }>(
      '/api/user-settings/pinterest.default_board'
    );
    const value = result?.value;
    if (!value) return null;
    if (typeof value === 'string') {
      const id = value.trim();
      return id ? { id } : null;
    }
    if (typeof value === 'object') {
      const id = String((value as any)?.id || (value as any)?.board_id || '').trim();
      if (!id) return null;
      const nameRaw = (value as any)?.name;
      const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : null;
      return { id, name };
    }
    return null;
  },

  async setDefaultBoard(board: PinterestDefaultBoard | null): Promise<void> {
    await apiFetch<{ success: boolean }>(
      '/api/user-settings/pinterest.default_board',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: board }) }
    );
  },

  async getPins(
    options: { days?: number; limit?: number; offset?: number; accountId?: string; boardId?: string } = {}
  ): Promise<PinterestPinsResponse> {
    const params = new URLSearchParams();
    if (options.days) params.set('days', String(options.days));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.accountId) params.set('account_id', options.accountId);
    if (options.boardId) params.set('board_id', options.boardId);
    return apiFetch(`/api/social/pinterest/pins?${params.toString()}`);
  },
};
