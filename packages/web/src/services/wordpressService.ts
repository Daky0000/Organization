/**
 * WordPress connection and publishing via app backend (credentials never sent to frontend).
 */

import { extractApiErrorMessage, fetchApiJson } from '../utils/apiRequest';

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface WordPressConnectPayload {
  siteUrl: string;
  username: string;
  /** WordPress login password (your account password) */
  password?: string;
  /** Application Password from Users → Profile → Application Passwords (optional) */
  applicationPassword?: string;
}

export interface WordPressStatus {
  connected: boolean;
  siteUrl?: string;
  connectionType?: 'make_webhook' | 'wordpress_api';
}

export interface MakeWebhookPublishPayload {
  title: string;
  content: string;
  excerpt?: string;
  status: 'draft' | 'publish';
  featured_image?: string;
  categories?: string[];
  tags?: string[];
}

export interface WordPressPublishPayload {
  title: string;
  content: string;
  excerpt?: string;
  slug?: string;
  status: 'draft' | 'publish';
  categories?: number[];
  tags?: number[];
  author?: number;
  featuredImageBase64?: string;
  featuredImageFilename?: string;
  seoTitle?: string;
  seoDescription?: string;
  focusKeyword?: string;
}

export interface WpCategory {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface WpTag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export const wordpressService = {
  async connect(payload: WordPressConnectPayload): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await fetchApiJson<{ message?: string; error?: string }>(
      '/api/wordpress/connect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          siteUrl: payload.siteUrl.trim(),
          username: payload.username.trim(),
          password: payload.password || undefined,
          applicationPassword: payload.applicationPassword || undefined,
        }),
      },
      'WordPress connection failed'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Connection failed') };
    }
    return { success: true, message: response.payload?.message };
  },

  async getStatus(): Promise<WordPressStatus> {
    const response = await fetchApiJson<{ connected?: boolean; siteUrl?: string; connectionType?: 'make_webhook' | 'wordpress_api'; error?: string }>(
      '/api/wordpress/status',
      { headers: authHeaders() },
      'Failed to get WordPress status'
    );
    if (!response.ok) {
      throw new Error(extractApiErrorMessage(response.payload, response.text, 'Failed to get status'));
    }
    return {
      connected: Boolean(response.payload?.connected),
      siteUrl: response.payload?.siteUrl,
      connectionType: response.payload?.connectionType,
    };
  },

  async connectWebhook(webhookUrl: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await fetchApiJson<{ message?: string; error?: string }>(
      '/api/wordpress/connect-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      },
      'WordPress webhook connection failed'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Connection failed') };
    }
    return { success: true, message: response.payload?.message };
  },

  async publishViaWebhook(payload: MakeWebhookPublishPayload): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await fetchApiJson<{ message?: string; error?: string }>(
      '/api/wordpress/publish-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      },
      'Failed to publish to WordPress'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to publish to WordPress.') };
    }
    return { success: true, message: response.payload?.message || 'Post sent to WordPress successfully.' };
  },

  async disconnect(): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson<{ error?: string }>(
      '/api/wordpress/disconnect',
      {
        method: 'DELETE',
        headers: authHeaders(),
      },
      'Failed to disconnect WordPress'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to disconnect') };
    }
    return { success: true };
  },

  async getCategories(): Promise<{ success: boolean; data?: WpCategory[]; error?: string }> {
    const response = await fetchApiJson<{ data?: WpCategory[]; error?: string }>(
      '/api/wordpress/categories',
      { headers: authHeaders() },
      'Failed to fetch categories'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to fetch categories') };
    }
    return { success: true, data: response.payload?.data || [] };
  },

  async getTags(): Promise<{ success: boolean; data?: WpTag[]; error?: string }> {
    const response = await fetchApiJson<{ data?: WpTag[]; error?: string }>(
      '/api/wordpress/tags',
      { headers: authHeaders() },
      'Failed to fetch tags'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to fetch tags') };
    }
    return { success: true, data: response.payload?.data || [] };
  },

  async publish(payload: WordPressPublishPayload): Promise<{ success: boolean; message?: string; data?: { postId: number; link?: string; status: string }; error?: string }> {
    const response = await fetchApiJson<{ message?: string; data?: { postId: number; link?: string; status: string }; error?: string }>(
      '/api/wordpress/publish',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      },
      'Failed to publish to WordPress'
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to publish') };
    }
    return { success: true, message: response.payload?.message, data: response.payload?.data };
  },
};
