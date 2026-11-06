import axios from 'axios';
import { logger } from './logger.ts';
import { META_GRAPH_BASE } from './meta-graph.ts';

// ── Client-credential verification ───────────────────────────────────────────
// Admin "Test" for an OAuth app. Without a user there is no code to exchange,
// so each provider is asked to redeem an invalid authorization code (or issue
// an app-only token where one exists). Providers authenticate the client
// before looking at the code, so "bad client" and "bad code" errors tell a
// wrong secret apart from a working one. Anything unrecognised is reported as
// unconfirmed with the provider's own words, never as a pass.

export type CredentialCheck = { status: 'valid' | 'invalid' | 'unknown'; message: string };

type ProbeResponse = { status: number; data: any };

const PROBE_CODE = 'contentflow-credential-check';
const PROBE_TIMEOUT_MS = 10_000;
const BAD_CLIENT_ERRORS = new Set(['invalid_client', 'unauthorized_client', 'invalid_client_id', 'bad_client_secret']);
const BAD_CODE_ERRORS = new Set(['invalid_grant', 'invalid_code']);

function describe(data: any): string {
  if (!data || typeof data !== 'object') return String(data || '').slice(0, 300);
  return String(
    data.error_description || data.reason || data.error_message || data.message || data.error?.message ||
    (typeof data.error === 'string' ? data.error : '') || '',
  ).slice(0, 300);
}

export function classifyOAuthProbe(response: ProbeResponse): CredentialCheck {
  const data = response.data;
  if (data && typeof data === 'object' && data.access_token) {
    return { status: 'valid', message: 'Client ID and secret accepted by the provider.' };
  }
  const error = String((data && typeof data === 'object' && typeof data.error === 'string' ? data.error : '') || '').toLowerCase();
  const detail = describe(data);
  const clientRejected =
    response.status === 401 ||
    BAD_CLIENT_ERRORS.has(error) ||
    /client authentication|invalid client|client secret|client_secret|client id|client_id|invalid platform app|error validating application|error validating client/i.test(detail);
  if (clientRejected) {
    return { status: 'invalid', message: `The provider rejected the client credentials${detail ? `: ${detail}` : '.'}` };
  }
  if (BAD_CODE_ERRORS.has(error) || /authori[sz]ation code|verification code|auth code|malformed|code (has|was|is) (expired|invalid|used)/i.test(detail)) {
    return { status: 'valid', message: 'Client ID and secret accepted by the provider.' };
  }
  if (/redirect/i.test(`${error} ${detail}`)) {
    return { status: 'invalid', message: `The provider rejected the redirect URL${detail ? `: ${detail}` : '.'}` };
  }
  return {
    status: 'unknown',
    message: `Could not confirm the credentials (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
  };
}

async function probe(
  url: string,
  options: { method?: 'GET' | 'POST'; form?: Record<string, string>; params?: Record<string, string>; basic?: [string, string] },
): Promise<ProbeResponse> {
  const resp = await axios.request({
    url,
    method: options.method || 'POST',
    params: options.params,
    data: options.form ? new URLSearchParams(options.form).toString() : undefined,
    headers: options.form ? { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } : { Accept: 'application/json' },
    auth: options.basic ? { username: options.basic[0], password: options.basic[1] } : undefined,
    validateStatus: () => true,
    timeout: PROBE_TIMEOUT_MS,
  });
  return { status: resp.status, data: resp.data };
}

export async function verifyOAuthClientCredentials(
  platform: string,
  cfg: Record<string, string>,
  redirectUri: string,
): Promise<CredentialCheck> {
  const slug = String(platform || '').trim().toLowerCase();
  const usesAppFields = slug === 'facebook' || slug === 'instagram' || slug === 'threads';
  const clientId = String((usesAppFields ? cfg.appId : slug === 'tiktok' ? cfg.clientKey : cfg.clientId) || '').trim();
  const clientSecret = String((usesAppFields ? cfg.appSecret : cfg.clientSecret) || '').trim();
  if (!clientId) return { status: 'invalid', message: 'Client ID is not configured.' };
  if (!clientSecret && slug !== 'twitter') return { status: 'invalid', message: 'Client secret is not configured.' };

  try {
    switch (slug) {
      case 'facebook':
        return classifyOAuthProbe(await probe(`${META_GRAPH_BASE}/oauth/access_token`, {
          method: 'GET',
          params: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
        }));
      case 'instagram':
        return classifyOAuthProbe(await probe('https://api.instagram.com/oauth/access_token', {
          form: { client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: PROBE_CODE },
        }));
      case 'threads':
        return classifyOAuthProbe(await probe('https://graph.threads.net/oauth/access_token', {
          form: { client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: PROBE_CODE },
        }));
      case 'linkedin':
        return classifyOAuthProbe(await probe('https://www.linkedin.com/oauth/v2/accessToken', {
          form: { grant_type: 'authorization_code', code: PROBE_CODE, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri },
        }));
      case 'twitter':
        return classifyOAuthProbe(await probe('https://api.x.com/2/oauth2/token', {
          form: {
            grant_type: 'authorization_code',
            code: PROBE_CODE,
            redirect_uri: redirectUri,
            code_verifier: 'a'.repeat(43),
            ...(clientSecret ? {} : { client_id: clientId }),
          },
          basic: clientSecret ? [clientId, clientSecret] : undefined,
        }));
      case 'pinterest': {
        const response = await probe('https://api.pinterest.com/v5/oauth/token', {
          form: { grant_type: 'authorization_code', code: PROBE_CODE, redirect_uri: redirectUri },
          basic: [clientId, clientSecret],
        });
        if (response.status === 401 || response.status === 403) {
          return { status: 'invalid', message: `The provider rejected the client credentials: ${describe(response.data) || `HTTP ${response.status}`}` };
        }
        return classifyOAuthProbe(response);
      }
      case 'tiktok':
        return classifyOAuthProbe(await probe('https://open.tiktokapis.com/v2/oauth/token/', {
          form: { client_key: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
        }));
      case 'gmail':
      case 'google_calendar':
        return classifyOAuthProbe(await probe('https://oauth2.googleapis.com/token', {
          form: { code: PROBE_CODE, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' },
        }));
      case 'slack':
        return classifyOAuthProbe(await probe('https://slack.com/api/oauth.v2.access', {
          form: { code: PROBE_CODE, redirect_uri: redirectUri },
          basic: [clientId, clientSecret],
        }));
      case 'zoom':
        return classifyOAuthProbe(await probe('https://zoom.us/oauth/token', {
          form: { grant_type: 'authorization_code', code: PROBE_CODE, redirect_uri: redirectUri },
          basic: [clientId, clientSecret],
        }));
      default:
        return { status: 'unknown', message: 'Live credential checks are not available for this platform.' };
    }
  } catch (err) {
    return { status: 'unknown', message: `Could not reach the provider: ${err instanceof Error ? err.message : 'network error'}` };
  }
}

// ── Token revocation on disconnect ───────────────────────────────────────────
// Best effort: a disconnect must never fail because the provider is down, but
// where the provider offers revocation the grant should not outlive the
// connection. Meta is deliberately excluded: revoking the user grant would
// also invalidate Page tokens other connections (Instagram via Facebook) use.

const REVOKE_TIMEOUT_MS = 8_000;

export async function revokeProviderAccess(
  platform: string,
  tokens: { accessToken?: string | null; refreshToken?: string | null },
  cfg: Record<string, string>,
): Promise<boolean> {
  const slug = String(platform || '').trim().toLowerCase();
  const accessToken = String(tokens.accessToken || '').trim();
  const refreshToken = String(tokens.refreshToken || '').trim();
  const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
  const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  try {
    switch (slug) {
      case 'twitter': {
        const token = refreshToken || accessToken;
        const clientId = String(cfg.clientId || '').trim();
        const clientSecret = String(cfg.clientSecret || '').trim();
        if (!token || !clientId) return false;
        const resp = await axios.post('https://api.x.com/2/oauth2/revoke', form({
          token,
          token_type_hint: refreshToken ? 'refresh_token' : 'access_token',
          ...(clientSecret ? {} : { client_id: clientId }),
        }), {
          headers: formHeaders,
          auth: clientSecret ? { username: clientId, password: clientSecret } : undefined,
          validateStatus: () => true,
          timeout: REVOKE_TIMEOUT_MS,
        });
        return resp.status < 400;
      }
      case 'tiktok': {
        const clientKey = String(cfg.clientKey || '').trim();
        const clientSecret = String(cfg.clientSecret || '').trim();
        if (!accessToken || !clientKey || !clientSecret) return false;
        const resp = await axios.post('https://open.tiktokapis.com/v2/oauth/revoke/', form({
          client_key: clientKey, client_secret: clientSecret, token: accessToken,
        }), { headers: formHeaders, validateStatus: () => true, timeout: REVOKE_TIMEOUT_MS });
        return resp.status < 400 && !(resp.data as any)?.error;
      }
      case 'gmail': {
        const token = refreshToken || accessToken;
        if (!token) return false;
        const resp = await axios.post('https://oauth2.googleapis.com/revoke', form({ token }), {
          headers: formHeaders, validateStatus: () => true, timeout: REVOKE_TIMEOUT_MS,
        });
        return resp.status < 400;
      }
      case 'slack': {
        if (!accessToken) return false;
        const resp = await axios.post('https://slack.com/api/auth.revoke', '', {
          headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true, timeout: REVOKE_TIMEOUT_MS,
        });
        return resp.status < 400 && (resp.data as any)?.ok !== false;
      }
      case 'zoom': {
        const clientId = String(cfg.clientId || '').trim();
        const clientSecret = String(cfg.clientSecret || '').trim();
        if (!accessToken || !clientId || !clientSecret) return false;
        const resp = await axios.post('https://zoom.us/oauth/revoke', form({ token: accessToken }), {
          headers: formHeaders,
          auth: { username: clientId, password: clientSecret },
          validateStatus: () => true,
          timeout: REVOKE_TIMEOUT_MS,
        });
        return resp.status < 400;
      }
      default:
        return false;
    }
  } catch (err) {
    logger.warn({ platform: slug, err: err instanceof Error ? err.message : String(err) }, 'provider_token_revoke_failed');
    return false;
  }
}
