import { API_BASE_URL } from './apiBase';

const DEFAULT_TIMEOUT_MS = 15000;

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem('auth_token') ?? '';
  return { Authorization: `Bearer ${token}`, ...extra };
}

export async function apiFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;

  return fetch(`${API_BASE_URL}${path}`, { ...rest, signal });
}

export async function apiGet<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const r = await apiFetch(path, {
    headers: authHeaders(),
    timeoutMs,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Request failed: ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const r = await apiFetch(path, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    timeoutMs,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Request failed: ${r.status}`);
  }
  return r.json() as Promise<T>;
}
