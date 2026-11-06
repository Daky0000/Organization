import axios from 'axios';
import { logger } from './logger.ts';

// Google OAuth token upkeep shared by the Gmail and Google Calendar
// integrations, which each store a refresh token on their social_accounts row.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_HTTP_TIMEOUT_MS = 15_000;

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export type GoogleRefreshResult =
  | { ok: true; accessToken: string; expiresAt: string }
  | { ok: false; revoked: boolean; error: string };

// `revoked` means Google rejected the refresh token itself (invalid_grant):
// the user withdrew access, the grant expired, or the password changed. Only
// reconnecting helps then; any other failure may pass on its own.
export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<GoogleRefreshResult> {
  if (!refreshToken || !clientId || !clientSecret) return { ok: false, revoked: false, error: 'Google OAuth client is not configured' };
  try {
    const resp = await axios.post(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: GOOGLE_HTTP_TIMEOUT_MS },
    );
    const data: any = resp.data || {};
    if (resp.status < 400 && data.access_token) {
      const ttl = Number(data.expires_in || 3600);
      return { ok: true, accessToken: String(data.access_token), expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
    }
    return {
      ok: false,
      revoked: data.error === 'invalid_grant',
      error: String(data.error_description || data.error || `HTTP ${resp.status}`),
    };
  } catch (err) {
    return { ok: false, revoked: false, error: err instanceof Error ? err.message : 'network error' };
  }
}

// Best effort: a disconnect never fails because Google is unreachable.
export async function revokeGoogleToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const resp = await axios.post(GOOGLE_REVOKE_URL, new URLSearchParams({ token }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
      timeout: GOOGLE_HTTP_TIMEOUT_MS,
    });
    return resp.status < 400;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'google_token_revoke_failed');
    return false;
  }
}

// Reasons that mean the stored grant is dead; anything else is advisory.
const DEAD_GRANT_REASONS = new Set(['token_inactive', 'deauthorized', 'user_deauthorized', 'permissions_revoked']);

export function isDeadGrantFlag(needsReapproval: unknown, reason: unknown): boolean {
  return Boolean(needsReapproval) && DEAD_GRANT_REASONS.has(String(reason || '').trim().toLowerCase());
}

// Flags the user's connection so the Integrations page asks them to reconnect.
export async function markGoogleGrantRevoked(query: Query, userId: string, platform: 'gmail' | 'google_calendar'): Promise<void> {
  await query(
    `UPDATE social_accounts
        SET needs_reapproval = true,
            token_data = COALESCE(token_data, '{}'::jsonb) || jsonb_build_object('reason', 'token_inactive', 'needs_reapproval_at', NOW())
      WHERE user_id = $1 AND LOWER(platform) = $2 AND (account_type = 'profile' OR account_type IS NULL)`,
    [userId, platform],
  ).catch((err) => logger.warn({ err, userId, platform }, 'google_grant_flag_failed'));
}
