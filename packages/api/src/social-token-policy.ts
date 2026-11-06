// Token lifecycle policy for social publishing connections: how early each
// platform's token is renewed, which platforms this subsystem owns, and how a
// stored connection's state is presented to the user.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Platforms whose tokens getPublishableSocialConnection resolves, refreshes
// and flags for reconnection.
export const PUBLISHING_TOKEN_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'pinterest',
  'tiktok',
  'threads',
]);

export type RefreshMode = 'none' | 'refresh_token' | 'threads_access_token' | 'instagram_access_token' | 'instagram_fb_exchange';

export function getRefreshMode(
  platformId: string,
  options: { hasRefreshToken: boolean; isInstagramDirect: boolean; hasFbAppCredentials?: boolean },
): RefreshMode {
  if (platformId === 'threads') return 'threads_access_token';
  if (platformId === 'instagram') return options.isInstagramDirect ? 'instagram_access_token' : (options.hasFbAppCredentials ? 'instagram_fb_exchange' : 'none');
  if (platformId === 'twitter' || platformId === 'tiktok') return 'refresh_token';
  if ((platformId === 'linkedin' || platformId === 'pinterest') && options.hasRefreshToken) return 'refresh_token';
  return 'none';
}

// How long before expiry a token is renewed. A fixed multi-day margin is wrong
// for short-lived tokens: X access tokens live two hours and TikTok's one day,
// so a ten-day margin renewed them on every single use (and raced rotating
// refresh tokens). Long-lived tokens keep the configured safety margin.
export function getRefreshMarginMs(platformId: string, safetyMarginDays: number): number {
  switch (platformId) {
    case 'twitter':
      return 10 * MINUTE;
    case 'tiktok':
      return 2 * HOUR;
    case 'pinterest':
      return 3 * DAY;
    default:
      return Math.max(1, Number(safetyMarginDays) || 1) * DAY;
  }
}

// Reasons a later successful refresh can clear. Anything else (revoked access,
// undecryptable credentials, expired refresh token) needs the user.
export const SOFT_REAPPROVAL_REASONS = new Set(['token_expiring', 'token_expired', 'token_refresh_failed']);

export function isSoftReapprovalReason(reason: unknown): boolean {
  return SOFT_REAPPROVAL_REASONS.has(String(reason || '').trim().toLowerCase());
}

export type ConnectionHealthStatus = 'healthy' | 'expiring' | 'reconnect_required';

export type ConnectionHealth = {
  status: ConnectionHealthStatus;
  reason: string | null;
  message: string | null;
  expiresAt: string | null;
};

const REASON_MESSAGES: Record<string, string> = {
  deauthorized: 'Access was removed on the platform. Reconnect to resume publishing.',
  user_deauthorized: 'Access was removed on the platform. Reconnect to resume publishing.',
  permissions_revoked: 'Permissions were revoked on the platform. Reconnect to resume publishing.',
  token_expired: 'The access token expired. Reconnect to resume publishing.',
  token_refresh_failed: 'Access could not be renewed automatically. Reconnect to resume publishing.',
  refresh_token_expired: 'The long-term authorization expired. Reconnect to continue.',
  token_missing_refresh: 'This connection cannot renew itself. Reconnect to continue.',
  token_inactive: 'The platform reports this token is no longer active. Reconnect to continue.',
  stored_token_decrypt_failed: 'Stored credentials can no longer be read. Reconnect this account.',
};

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// `refreshable` means the server renews the token on its own, so an
// approaching expiry is not something to warn the user about.
export function computeConnectionHealth(input: {
  needsReapproval: boolean;
  reason?: string | null;
  expiresAt?: string | Date | null;
  refreshable: boolean;
  warnWithinMs?: number;
  now?: number;
}): ConnectionHealth {
  const now = input.now ?? Date.now();
  const expiresMs = input.expiresAt ? new Date(input.expiresAt).getTime() : NaN;
  const expiresAt = Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null;
  const reason = String(input.reason || '').trim().toLowerCase() || null;
  const warnWithinMs = input.warnWithinMs ?? 10 * DAY;
  const expired = Number.isFinite(expiresMs) && expiresMs <= now;

  if (input.needsReapproval) {
    if (reason === 'token_expiring') {
      // A warning, not a failure. Older scans set it on tokens the server
      // renews itself and on rows with no known expiry; neither needs the user.
      if (input.refreshable || !Number.isFinite(expiresMs)) {
        return { status: 'healthy', reason: null, message: null, expiresAt };
      }
      if (!expired) {
        return {
          status: 'expiring',
          reason,
          message: `Access expires on ${formatDay(expiresMs)}. Reconnect before then to avoid interruptions.`,
          expiresAt,
        };
      }
    }
    const key = reason === 'token_expiring' ? 'token_expired' : reason || 'token_expired';
    return {
      status: 'reconnect_required',
      reason: key,
      message: REASON_MESSAGES[key] || 'This connection needs to be reconnected.',
      expiresAt,
    };
  }

  if (!input.refreshable && Number.isFinite(expiresMs)) {
    if (expired) {
      return { status: 'reconnect_required', reason: 'token_expired', message: REASON_MESSAGES.token_expired, expiresAt };
    }
    if (expiresMs - now <= warnWithinMs) {
      return {
        status: 'expiring',
        reason: 'token_expiring',
        message: `Access expires on ${formatDay(expiresMs)}. Reconnect before then to avoid interruptions.`,
        expiresAt,
      };
    }
  }
  return { status: 'healthy', reason: null, message: null, expiresAt };
}
