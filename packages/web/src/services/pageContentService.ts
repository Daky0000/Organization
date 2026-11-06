import { API_BASE_URL } from '../utils/apiBase';

export async function fetchPageContent<T>(slug: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/pages/${slug}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { success: boolean; content: T | null };
    return data.content ?? null;
  } catch {
    return null;
  }
}

export async function savePageContent(slug: string, content: unknown): Promise<boolean> {
  try {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`${API_BASE_URL}/api/pages/${slug}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return data.success;
  } catch {
    return false;
  }
}
