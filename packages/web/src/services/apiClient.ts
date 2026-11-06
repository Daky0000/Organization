import { API_BASE_URL } from '../utils/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Shared API client.
//
// One place for the base URL, the auth header, JSON handling, and error
// extraction — instead of every service re-reading localStorage and
// hand-rolling fetch. Migrate services to this incrementally:
//
//   import { api } from './apiClient';
//   const { users } = await api.get<{ users: User[] }>('/api/users?page=1');
//   await api.post('/api/mailing/contacts', { email });
//
// Throws Error(message) on non-2xx responses, using the server's
// { error } / { message } payload when present.
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await parseJson<Record<string, unknown>>(response);
  if (!response.ok) {
    const message =
      (payload?.error as string) || (payload?.message as string) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }
  return (payload ?? {}) as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('POST', path, body, init),
  put: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('PUT', path, body, init),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('PATCH', path, body, init),
  del: <T>(path: string, init?: RequestInit) => request<T>('DELETE', path, undefined, init),
};
