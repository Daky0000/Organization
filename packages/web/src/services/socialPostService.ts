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

export type SocialAccount = {
  id: string;
  platform: string;
  platform_id?: string | null;
  account_type: string;
  account_id: string;
  account_name: string;
  profile_image?: string | null;
  connected?: boolean;
  created_at?: string;
};

export type SocialPostAccount = {
  id: string;
  enabled: boolean;
  social_account_id: string;
  platform: string;
  account_type: string;
  account_id: string;
  account_name: string;
  profile_image?: string | null;
};

export type SocialPostSettings = {
  id: string;
  post_id: string;
  template: string;
  publish_type: 'immediate' | 'scheduled' | 'delayed';
  scheduled_at: string | null;
  accounts: SocialPostAccount[];
};

export const socialPostService = {
  async listAccounts(): Promise<SocialAccount[]> {
    const res = await fetch(`${API_BASE_URL}/api/v1/social/accounts`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ success?: boolean; accounts?: SocialAccount[]; error?: string }>(res);
    if (data.success === false) throw new Error(data.error || 'Failed to load accounts');
    return data.accounts ?? [];
  },

  async deleteAccount(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/v1/social/accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any)?.error || 'Failed to remove account');
    }
  },

  async getSettings(postId: string): Promise<SocialPostSettings | null> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts/${postId}/social-settings`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ success?: boolean; settings?: SocialPostSettings | null; error?: string }>(res);
    if (data.success === false) throw new Error(data.error || 'Failed to load settings');
    return data.settings ?? null;
  },

  async saveSettings(
    postId: string,
    payload: {
      template?: string;
      publish_type?: 'immediate' | 'scheduled' | 'delayed';
      scheduled_at?: string | null;
      accounts?: string[];
    }
  ): Promise<{ success?: boolean; id?: string; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/v1/posts/${postId}/social-settings`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    return parseApiResponse(res);
  },
};
