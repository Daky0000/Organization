function resolveApiBase(): string {
  // 1. Explicit env var (set in .env or deployment config) — highest priority
  const envBase = ((import.meta.env.VITE_API_BASE_URL as string) || '').trim().replace(/\/$/, '');
  if (envBase) return envBase;

  // 2. Runtime injection (set via window.__API_BASE_URL__ before app boots)
  if (typeof window !== 'undefined' && (window as any).__API_BASE_URL__) {
    return String((window as any).__API_BASE_URL__).trim().replace(/\/$/, '');
  }

  // 3. Use relative paths — works for both dev (Vite proxy) and production (same-origin)
  return '';
}

export const getApiBaseUrl = resolveApiBase;
export const API_BASE_URL = resolveApiBase();
