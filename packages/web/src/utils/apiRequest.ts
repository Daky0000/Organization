import { API_BASE_URL } from './apiBase';


export const safeJsonParse = <T = any>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const looksLikeHtmlDocument = (text: string, contentType = '') => {
  const normalized = String(text || '').trim().toLowerCase();
  return (
    contentType.toLowerCase().includes('text/html') ||
    normalized.startsWith('<!doctype html') ||
    normalized.startsWith('<html')
  );
};

export const sanitizeApiErrorText = (
  text: string,
  fallback = 'The server returned the app shell instead of API data. Please try again.'
) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return fallback;
  return looksLikeHtmlDocument(trimmed) ? fallback : trimmed;
};

export async function fetchApiJson<T = any>(
  path: string,
  init?: RequestInit,
  fallbackMessage = 'The API is unreachable right now.'
) {
  const candidates = [API_BASE_URL];


  const bases = Array.from(new Set(candidates));
  let lastNetworkError: Error | null = null;

  for (const [index, base] of bases.entries()) {
    const isLast = index === bases.length - 1;
    try {
      const response = await fetch(`${base}${path}`, init);
      const text = await response.text();
      const payload = text ? safeJsonParse<T>(text) : null;
      const contentType = String(response.headers.get('content-type') || '');
      const html = looksLikeHtmlDocument(text, contentType);

      if (!isLast && html) {
        continue;
      }

      return {
        ok: response.ok && !html,
        status: response.status,
        base,
        payload,
        text,
        html,
      };
    } catch (error) {
      lastNetworkError = error instanceof Error ? error : new Error(fallbackMessage);
      if (isLast) throw lastNetworkError;
    }
  }

  throw lastNetworkError || new Error(fallbackMessage);
}

export const extractApiErrorMessage = (
  payload: any,
  text: string,
  fallback = 'Request failed'
) => {
  const payloadError =
    typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.message === 'string'
        ? payload.message
        : '';

  if (payloadError) {
    return sanitizeApiErrorText(payloadError, fallback);
  }

  return sanitizeApiErrorText(text, fallback);
};
