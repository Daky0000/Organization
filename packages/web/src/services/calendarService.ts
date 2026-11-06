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

export type CalendarPostStatus = 'draft' | 'scheduled' | 'published';

export type CalendarPost = {
  id: string;
  title: string;
  scheduled_at: string | null;
  published_at?: string | null;
  calendar_at?: string | null;
  status: CalendarPostStatus | string;
  created_at?: string;
  updated_at?: string;
};

export type CalendarResponse = {
  success?: boolean;
  month: number;
  year: number;
  posts_by_date: Record<string, CalendarPost[]>;
  total_posts: number;
};

export type CalendarPostPayload = {
  title: string;
  content?: string;
  scheduled_at?: string | null;
  status?: CalendarPostStatus;
};

export const calendarService = {
  async getCalendar(year: number, month: number): Promise<CalendarResponse> {
    const res = await fetch(`${API_BASE_URL}/api/v1/calendar?year=${year}&month=${month}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<CalendarResponse & { error?: string }>(res);
    return data;
  },

  async listPosts(status = 'draft'): Promise<CalendarPost[]> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts?status=${encodeURIComponent(status)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ posts?: CalendarPost[] }>(res);
    return data.posts ?? [];
  },

  async createPost(payload: CalendarPostPayload): Promise<CalendarPost> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse<{ post?: CalendarPost; error?: string }>(res);
    if (!data.post) throw new Error(data.error || 'Failed to create post');
    return data.post;
  },

  async updatePost(id: string, payload: Partial<CalendarPostPayload>): Promise<CalendarPost> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse<{ post?: CalendarPost; error?: string }>(res);
    if (!data.post) throw new Error(data.error || 'Failed to update post');
    return data.post;
  },

  async deletePost(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    await parseApiResponse(res);
  },
};
