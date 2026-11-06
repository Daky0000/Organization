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
    const errorMessage = (parsed as any)?.error || (parsed as any)?.message || text || 'Request failed';
    throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed');
  }
  if (text && parsed === null) {
    throw new Error('Invalid server response');
  }
  return (parsed ?? {}) as T;
}

export type SocialTemplateContentSource = 'EXCERPT' | 'CONTENT';
export type FacebookContentType = 'STATUS' | 'LINK' | 'STATUS_PLUS_LINK';

export type SocialTemplateSettings = {
  platform: string;
  content_source: SocialTemplateContentSource;
  template_string: string;
  status_limit: number;
  max_status_limit: number;
  share_limit_per_post: number;
  add_categories_as_tags: boolean;
  remove_css: boolean;
  show_thumbnail: boolean;
  add_image_link: boolean;
  content_type: FacebookContentType | null;
  enabled: boolean;
};

export type SocialTemplatePreview = {
  rendered: string;
  characterCount: number;
  originalCharacterCount: number;
  limit: number;
  featuredImage: string;
  warning: string | null;
  truncated: boolean;
};

export const socialTemplateService = {
  async getSettings(platform: string): Promise<SocialTemplateSettings> {
    const res = await fetch(`${API_BASE_URL}/api/social-templates/${encodeURIComponent(platform)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await parseApiResponse<{ success?: boolean; settings?: SocialTemplateSettings; error?: string }>(res);
    if (data.success === false) throw new Error(data.error || 'Failed to load template settings');
    if (!data.settings) throw new Error('Template settings missing');
    return data.settings;
  },

  async updateSettings(platform: string, settings: SocialTemplateSettings): Promise<SocialTemplateSettings> {
    const res = await fetch(`${API_BASE_URL}/api/social-templates/${encodeURIComponent(platform)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(settings),
    });
    const data = await parseApiResponse<{ success?: boolean; settings?: SocialTemplateSettings; error?: string }>(res);
    if (data.success === false) throw new Error(data.error || 'Failed to save template settings');
    if (!data.settings) throw new Error('Template settings missing');
    return data.settings;
  },

  async previewTemplate(platform: string, postId: string, settings?: SocialTemplateSettings): Promise<SocialTemplatePreview> {
    const res = await fetch(`${API_BASE_URL}/api/social-templates/${encodeURIComponent(platform)}/preview`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ postId, settings }),
    });
    const data = await parseApiResponse<
      { success?: boolean; error?: string } & Partial<SocialTemplatePreview>
    >(res);
    if (data.success === false) throw new Error(data.error || 'Failed to generate preview');
    if (typeof data.rendered !== 'string') throw new Error('Preview missing rendered text');
    return {
      rendered: data.rendered,
      characterCount: Number(data.characterCount ?? 0),
      originalCharacterCount: Number(data.originalCharacterCount ?? 0),
      limit: Number(data.limit ?? 0),
      featuredImage: typeof (data as any).featuredImage === 'string' ? String((data as any).featuredImage) : '',
      warning: typeof data.warning === 'string' ? data.warning : null,
      truncated: Boolean(data.truncated),
    };
  },
};

