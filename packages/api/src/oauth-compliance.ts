import { createHmac, timingSafeEqual } from 'crypto';

// Signature checks for the provider callbacks that remove a user's
// connection (deauthorize / data deletion). These endpoints are public, so a
// request is acted on only when the provider's signature proves who sent it;
// an unsigned request must never disconnect or delete anyone's account.

const MAX_CLOCK_SKEW_SECONDS = 300;

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string {
  const value = headers[name.toLowerCase()] ?? headers[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function hexEqual(providedHex: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  return safeEqual(Buffer.from(providedHex.toLowerCase(), 'hex'), Buffer.from(expectedHex, 'hex'));
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '='), 'base64');
}

function freshTimestamp(seconds: number, nowMs: number): boolean {
  return Number.isFinite(seconds) && Math.abs(nowMs / 1000 - seconds) <= MAX_CLOCK_SKEW_SECONDS;
}

// Meta (Facebook Login, Instagram Login, Threads): signed_request is
// base64url(HMAC-SHA256(payload, appSecret)) + "." + base64url(JSON payload).
// Several secrets may be valid (Facebook app vs Instagram app secret).
export function parseMetaSignedRequest(signedRequest: string, secrets: string[]): Record<string, unknown> | null {
  const parts = String(signedRequest || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedSig, encodedPayload] = parts;
  const provided = base64UrlDecode(encodedSig);
  const valid = secrets
    .map((secret) => String(secret || '').trim())
    .filter(Boolean)
    .some((secret) => safeEqual(provided, createHmac('sha256', secret).update(encodedPayload).digest()));
  if (!valid) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Slack: X-Slack-Signature = "v0=" + hex(HMAC-SHA256(signingSecret, "v0:{ts}:{body}")).
export function verifySlackSignature(headers: Headers, rawBody: string, signingSecret: string, nowMs = Date.now()): boolean {
  const secret = String(signingSecret || '').trim();
  const timestamp = header(headers, 'x-slack-request-timestamp');
  const signature = header(headers, 'x-slack-signature');
  if (!secret || !timestamp || !signature.startsWith('v0=')) return false;
  if (!freshTimestamp(Number(timestamp), nowMs)) return false;
  const expected = createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return hexEqual(signature.slice(3), expected);
}

// Zoom: x-zm-signature = "v0=" + hex(HMAC-SHA256(secretToken, "v0:{ts}:{body}")).
export function verifyZoomSignature(headers: Headers, rawBody: string, secretToken: string, nowMs = Date.now()): boolean {
  const secret = String(secretToken || '').trim();
  const timestamp = header(headers, 'x-zm-request-timestamp');
  const signature = header(headers, 'x-zm-signature');
  if (!secret || !timestamp || !signature.startsWith('v0=')) return false;
  if (!freshTimestamp(Number(timestamp), nowMs)) return false;
  const expected = createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return hexEqual(signature.slice(3), expected);
}

// Zoom checks a new webhook URL by sending a plainToken it expects back hashed.
export function zoomUrlValidationResponse(plainToken: string, secretToken: string): { plainToken: string; encryptedToken: string } {
  return {
    plainToken,
    encryptedToken: createHmac('sha256', String(secretToken || '').trim()).update(plainToken).digest('hex'),
  };
}

// TikTok: TikTok-Signature = "t={unix},s={hex(HMAC-SHA256(clientSecret, "{t}.{body}"))}".
export function verifyTikTokSignature(headers: Headers, rawBody: string, clientSecret: string, nowMs = Date.now()): boolean {
  const secret = String(clientSecret || '').trim();
  const raw = header(headers, 'tiktok-signature');
  if (!secret || !raw) return false;
  const fields = Object.fromEntries(
    raw.split(',').map((part) => {
      const index = part.indexOf('=');
      return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : [part.trim(), ''];
    }),
  );
  const timestamp = String(fields.t || '');
  const signature = String(fields.s || '');
  if (!timestamp || !signature || !freshTimestamp(Number(timestamp), nowMs)) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return hexEqual(signature, expected);
}

// The platform account ids a verified callback says were disconnected, as
// stored in social_accounts.account_id for that platform.
export function extractRevokedAccountIds(platform: string, body: any, metaPayload?: Record<string, unknown> | null): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value ?? '').trim();
    if (id) ids.add(id);
  };
  switch (platform) {
    case 'facebook':
    case 'instagram':
    case 'threads':
      add(metaPayload?.user_id);
      break;
    case 'slack':
      // The stored Slack token is the workspace bot token; a revoked user
      // token alone leaves it working.
      if (
        body?.event?.type === 'app_uninstalled' ||
        (body?.event?.type === 'tokens_revoked' && Array.isArray(body?.event?.tokens?.bot) && body.event.tokens.bot.length > 0)
      ) add(body?.team_id);
      break;
    case 'zoom':
      if (body?.event === 'app_deauthorized') add(body?.payload?.user_id);
      break;
    case 'tiktok':
      if (body?.event === 'authorization.removed') add(body?.user_openid);
      break;
    default:
      break;
  }
  return Array.from(ids);
}

export const SIGNED_COMPLIANCE_PLATFORMS = new Set(['facebook', 'instagram', 'threads', 'slack', 'zoom', 'tiktok']);
