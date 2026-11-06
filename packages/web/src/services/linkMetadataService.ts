import { API_BASE_URL } from '../utils/apiBase';
import type { LinkMetadata } from '../types/linkMetadata';

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

export const linkMetadataService = {
  async fetch(url: string, signal?: AbortSignal): Promise<LinkMetadata> {
    const res = await fetch(`${API_BASE_URL}/api/link-metadata?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal,
    });
    return parseApiResponse<LinkMetadata & { error?: string }>(res);
  },
};
