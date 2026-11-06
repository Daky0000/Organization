import { createHash, randomBytes } from 'crypto';
import type { Request } from './types/http.ts';
import { logger } from './logger.ts';
import { pool, dbQuery } from './db.ts';
import { getPlatformConfig } from './user-auth.ts';
import { getLinkedInOAuthScopeString } from './social-helpers.ts';
import { INSTAGRAM_GRAPH_BASE, META_GRAPH_BASE, META_OAUTH_DIALOG_URL } from './meta-graph.ts';

// normalizePlatformId is defined locally in platformConfigRoutes.ts.
// resolveBackendRedirectUri is defined here to avoid the broken declare pattern.
function normalizePlatformId(platform: string): string {
  const raw = String(platform || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter / x' || raw === 'twitter/x' || raw === 'x') return 'twitter';
  return raw;
}

function getBackendPublicUrl(req?: Request): string {
  const fromEnv = String(
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.VITE_API_BASE_URL ||
    ''
  ).trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (!req) return '';
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoHeader || req.protocol || 'http';
  const hostHeader = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return hostHeader ? `${proto}://${hostHeader}` : '';
}

export function resolveBackendRedirectUri(raw: string, req?: Request): string {
  const r = String(raw || '').trim();
  if (!r) return '';
  if (r.startsWith('http://') || r.startsWith('https://')) return r;
  const base = getBackendPublicUrl(req);
  if (!base) return r.startsWith('/') ? r : `/${r}`;
  return r.startsWith('/') ? `${base}${r}` : `${base}/${r}`;
}

export async function getUserSaaSContext(userId: string): Promise<string> {
  if (!pool) return '';
  const parts: string[] = [];
  try {
    const { rows: socials } = await dbQuery(
      `SELECT platform, account_name, handle, followers, connected
       FROM social_accounts WHERE user_id = $1 ORDER BY platform`,
      [userId]
    );
    if (socials.length > 0) {
      parts.push('Connected social accounts: ' + socials.map((s: any) => `${s.platform}${s.handle ? ` (@${s.handle})` : ''}${s.followers ? ` — ${Number(s.followers).toLocaleString()} followers` : ''}`).join(', '));
    }

    const { rows: planRows } = await dbQuery(
      `SELECT pp.name FROM subscriptions s JOIN pricing_plans pp ON pp.id = s.plan_id WHERE s.user_id = $1 AND s.status IN ('active','trialing') ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );
    if (planRows[0]) parts.push(`Subscription plan: ${(planRows[0] as any).name}`);

    const { rows: creditRows } = await dbQuery(
      `SELECT balance FROM user_credits WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (creditRows[0]) parts.push(`AI credits remaining: ${(creditRows[0] as any).balance}`);
  } catch (e) {
    logger.error('getUserSaaSContext error:', e);
  }
  return parts.join('\n');
}

export async function getEnabledPlatformSlugs(): Promise<string[]> {
  if (!pool) return [];
  const result = await dbQuery(`SELECT platform FROM platform_configs WHERE enabled = true`);
  return result.rows.map((row: any) => String(row.platform || '').toLowerCase()).filter(Boolean);
}

export function isOAuthClientSecretRequired(platform: string): boolean {
  const slug = String(platform || '').trim().toLowerCase();
  return slug === 'instagram' || slug === 'facebook' || slug === 'threads' || slug === 'linkedin' || slug === 'tiktok' || slug === 'pinterest' || slug === 'gmail' || slug === 'slack' || slug === 'zoom';
}

// A platform is offered to users only when an admin has both configured it and
// left it enabled — the admin "Disable for users" toggle must actually hide it.
export async function getVisibleUserPlatformSlugs(): Promise<string[]> {
  if (!pool) return ['wordpress', 'mailchimp'];
  const result = await dbQuery(`SELECT platform, config, enabled FROM platform_configs`);
  const visible = new Set<string>(['wordpress', 'mailchimp']);
  for (const row of result.rows as any[]) {
    const slug = String(row.platform || '').toLowerCase();
    if (!slug || !row.enabled) continue;
    const cfg = row.config || {};
    const meta = OAUTH_AUTH_URLS[slug];
    if (!meta) {
      visible.add(slug);
      continue;
    }
    const clientId = String(cfg?.[meta.idField] || '').trim();
    const secretRequired = isOAuthClientSecretRequired(slug);
    const secretValue = String(cfg?.clientSecret || cfg?.appSecret || '').trim();
    if (clientId && (!secretRequired || secretValue)) visible.add(slug);
  }
  return Array.from(visible);
}

export function formatSocialAccountLabel(
  platform: string,
  accountType?: string | null,
  accountName?: string | null,
  accountId?: string | null,
) {
  const platformId = normalizePlatformId(platform);
  const type = String(accountType || '').trim().toLowerCase();
  const name = String(accountName || '').trim();
  const id = String(accountId || '').trim();

  if (platformId === 'facebook') {
    if (type === 'group') return name ? `Group: ${name}` : (id ? `Group: ${id}` : null);
    if (type === 'page') return name ? `Page: ${name}` : (id ? `Page: ${id}` : null);
    return 'Profile';
  }
  if (platformId === 'linkedin') {
    if (type === 'page') return name ? `Page: ${name}` : (id ? `Page: ${id}` : 'LinkedIn Page');
    return name ? `Profile: ${name}` : 'Profile';
  }
  if (platformId === 'pinterest') {
    if (type === 'board') return name ? `Board: ${name}` : (id ? `Board: ${id}` : 'Board');
    return name ? `Profile: ${name}` : 'Profile';
  }
  if (platformId === 'wordpress') return name ? `Site: ${name}` : 'WordPress';
  if (type === 'profile' || !type) return name ? `Profile: ${name}` : 'Profile';
  return name ? `${type}: ${name}` : (id ? `${type}: ${id}` : type || null);
}

export async function getUserConnectedAccounts(userId: string): Promise<any[]> {
  if (!pool) return [];
  const visiblePlatforms = await getVisibleUserPlatformSlugs();
  // token_data is deliberately not selected: this feeds API responses and AI
  // context, and it is not a place for anything a client should see.
  let query = `
    SELECT id, user_id AS "userId", platform, handle, account_name AS "accountName",
           account_type AS "accountType", followers::text AS followers, connected, connected_at AS "connectedAt",
           COALESCE(token_expires_at, expires_at) AS "expiresAt",
           COALESCE(needs_reapproval, false) AS "needsReapproval"
    FROM social_accounts WHERE user_id = $1`;
  const params: any[] = [userId];
  if (visiblePlatforms.length > 0) {
    query += ` AND LOWER(platform) = ANY($2)`;
    params.push(visiblePlatforms);
  }
  query += ` ORDER BY platform;`;
  const result = await dbQuery(query, params);
  return result.rows;
}

const META_BASE_SCOPES = ['public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
export const META_INSTAGRAM_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'instagram_manage_messages',
];
export const INSTAGRAM_BUSINESS_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];
export const INSTAGRAM_BUSINESS_ONBOARDING_EXTRAS = JSON.stringify({
  setup: { channel: 'IG_API_ONBOARDING' },
});

export function isInstagramDirectLogin(input?: { accessToken?: string | null; tokenData?: any } | null): boolean {
  const td = input?.tokenData && typeof input.tokenData === 'object' ? input.tokenData : {};
  const graphHost = String(td.graph_host || td.graphHost || '').trim().toLowerCase();
  const loginMethod = String(td.login_method || td.loginMethod || '').trim().toLowerCase();
  if (graphHost === 'graph.instagram.com' || loginMethod === 'instagram' || loginMethod === 'instagram_direct') {
    return true;
  }
  if (graphHost === 'graph.facebook.com' || loginMethod === 'facebook' || Boolean(td.pageId)) {
    return false;
  }
  const tok = String(input?.accessToken || td.access_token || '').trim();
  return tok.startsWith('IG');
}

export function resolveInstagramGraphBase(input?: { accessToken?: string | null; tokenData?: any } | null): string {
  return isInstagramDirectLogin(input) ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;
}

export function getMetaOAuthScopeString(extraScopes: string[] = []): string {
  return Array.from(new Set([...META_BASE_SCOPES, ...extraScopes])).join(',');
}

export const OAUTH_AUTH_URLS: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }> = {
  instagram: { authUrl: 'https://www.instagram.com/oauth/authorize', scopes: INSTAGRAM_BUSINESS_SCOPES.join(','), idField: 'appId' },
  facebook:  { authUrl: META_OAUTH_DIALOG_URL, scopes: META_BASE_SCOPES.join(','), idField: 'appId' },
  linkedin:  {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scopes: getLinkedInOAuthScopeString(),
    idField: 'clientId',
  },
  // media.write is required by the v2 media upload endpoints; without it image
  // and video attachments are rejected and posts go out text-only.
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize', scopes: 'tweet.read tweet.write users.read media.write offline.access', idField: 'clientId' },
  pinterest: { authUrl: 'https://www.pinterest.com/oauth/', scopes: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read', idField: 'clientId' },
  tiktok:    { authUrl: 'https://www.tiktok.com/v2/auth/authorize/', scopes: 'user.info.basic,user.info.profile,user.info.stats,video.list,video.upload,video.publish', idField: 'clientKey' },
  threads:   { authUrl: 'https://www.threads.net/oauth/authorize', scopes: 'threads_basic,threads_content_publish,threads_manage_insights,threads_read_replies,threads_manage_replies,threads_location_tagging', idField: 'appId' },
  gmail:     { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', scopes: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile', idField: 'clientId' },
  slack:     { authUrl: 'https://slack.com/oauth/v2/authorize', scopes: 'chat:write,channels:read,users:read,team:read', idField: 'clientId' },
  zoom:      { authUrl: 'https://zoom.us/oauth/authorize', scopes: 'meeting:read:list_meetings meeting:write:meeting user:read:user', idField: 'clientId' },
};

const DEFAULT_OAUTH_REDIRECTS: Record<string, string> = {
  instagram: '/auth/instagram/callback',
  facebook: '/auth/facebook/callback',
  linkedin: '/auth/linkedin/callback',
  twitter: '/auth/twitter/callback',
  pinterest: '/auth/pinterest/callback',
  tiktok: '/auth/tiktok/callback',
  threads: '/auth/threads/callback',
  gmail: '/auth/gmail/callback',
  slack: '/auth/slack/callback',
  zoom: '/auth/zoom/callback',
};

function getDefaultOAuthRedirectPath(platform: string): string {
  const key = String(platform || '').trim().toLowerCase();
  return DEFAULT_OAUTH_REDIRECTS[key] || `/auth/${key}/callback`;
}

export function resolveOAuthRedirectUri(platform: string, redirectUri?: string, req?: Request): string {
  if (!OAUTH_AUTH_URLS[platform]) return '';
  const raw = String(redirectUri || '').trim() || getDefaultOAuthRedirectPath(platform);
  return resolveBackendRedirectUri(raw, req);
}

// ── OAuth authorize URL ──────────────────────────────────────────────────────

const base64Url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

// RFC 7636 S256 pair, for flows where the server holds the verifier.
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

// Instagram can ride on the Facebook app's credentials when it has none of its own.
export function resolveInstagramAppConfig(
  cfg: Record<string, string>,
  facebookCfg: Record<string, string>,
): { cfg: Record<string, string>; inheritedFromFacebook: boolean } {
  if ((!cfg.appId || !cfg.appSecret) && facebookCfg.appId && facebookCfg.appSecret) {
    return {
      cfg: { ...facebookCfg, ...cfg, appId: cfg.appId || facebookCfg.appId, appSecret: cfg.appSecret || facebookCfg.appSecret },
      inheritedFromFacebook: true,
    };
  }
  return { cfg, inheritedFromFacebook: false };
}

// X needs offline.access to keep a refresh token and media.write to attach
// images; admin-customised scope lists that publish get both.
function ensureTwitterScopes(scopes: string): string {
  const list = scopes.split(/\s+/).filter(Boolean);
  if (!list.includes('tweet.write')) return scopes;
  for (const required of ['media.write', 'offline.access']) if (!list.includes(required)) list.push(required);
  return list.join(' ');
}

export type BuildAuthorizeUrlInput = {
  platform: string;
  cfg: Record<string, string>;
  facebookCfg?: Record<string, string>;
  inheritedFromFacebook?: boolean;
  redirectUri: string;
  state: string;
  method?: string;
  extraScopes?: string;
  rerequest?: boolean;
  forceReauth?: boolean;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  enableLinkedInExtendedLogin?: boolean;
};

export type BuildAuthorizeUrlResult = { ok: true; url: string } | { ok: false; status: number; error: string };

export function buildOAuthAuthorizeUrl(input: BuildAuthorizeUrlInput): BuildAuthorizeUrlResult {
  const platform = String(input.platform || '').trim().toLowerCase();
  const meta = OAUTH_AUTH_URLS[platform];
  if (!meta) return { ok: false, status: 400, error: 'Unsupported platform' };
  const state = String(input.state || '').trim();
  if (!state) return { ok: false, status: 400, error: 'Missing state' };

  const cfg = input.cfg || {};
  const fbCfg = input.facebookCfg || {};
  const requestedMethod = String(input.method || cfg.loginType || '').toLowerCase();
  const isFbInstagramMethod = platform === 'instagram' && (
    requestedMethod === 'facebook' ||
    (requestedMethod !== 'instagram' && (
      Boolean(input.inheritedFromFacebook) ||
      Boolean(cfg.authUrl && cfg.authUrl.includes('facebook.com')) ||
      Boolean(cfg.configId && String(cfg.configId).trim()) ||
      Boolean(cfg.scopes && (cfg.scopes.includes('pages_show_list') || (cfg.scopes.includes('instagram_basic') && !cfg.scopes.includes('instagram_business_basic'))))
    ))
  );

  const clientId = String(
    isFbInstagramMethod ? (cfg.facebookAppId || fbCfg.appId || cfg.appId || '') : (cfg[meta.idField] || ''),
  ).trim();
  const redirectUri = String(input.redirectUri || '').trim();
  if (!clientId || !redirectUri) return { ok: false, status: 400, error: 'Platform credentials not configured by admin' };

  let authUrl = meta.authUrl;
  let scopeParam = String(cfg.scopes || meta.scopes || '').trim();
  if (isFbInstagramMethod) {
    authUrl = META_OAUTH_DIALOG_URL;
    if (!cfg.scopes || cfg.scopes.includes('instagram_business_')) scopeParam = META_INSTAGRAM_SCOPES.join(',');
  } else if (platform === 'instagram') {
    if (!cfg.scopes || !cfg.scopes.includes('instagram_business_')) scopeParam = INSTAGRAM_BUSINESS_SCOPES.join(',');
  } else if (platform === 'twitter') {
    scopeParam = ensureTwitterScopes(scopeParam);
  }

  const extraScopesRaw = String(input.extraScopes || '').trim();
  if (extraScopesRaw) {
    const separator = scopeParam.includes(' ') && !scopeParam.includes(',') ? ' ' : ',';
    const existing = scopeParam.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const extra = extraScopesRaw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^[a-z0-9_.:-]+$/i.test(s));
    scopeParam = Array.from(new Set([...existing, ...extra])).join(separator);
  }

  const params = new URLSearchParams({
    // TikTok names the client parameter client_key.
    [platform === 'tiktok' ? 'client_key' : 'client_id']: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: scopeParam,
  });

  if (isFbInstagramMethod) {
    // Business Login for Instagram: display=page plus the IG_API_ONBOARDING
    // extras launch the professional-account + Page onboarding flow.
    params.set('display', 'page');
    params.set('extras', INSTAGRAM_BUSINESS_ONBOARDING_EXTRAS);
    const configId = String(cfg.configId || '').trim();
    if (configId) params.set('config_id', configId);
  }
  if (platform === 'facebook' || isFbInstagramMethod || (platform !== 'instagram' && input.rerequest)) {
    params.set('auth_type', 'rerequest');
  }
  if (platform === 'instagram' && !isFbInstagramMethod) {
    params.set('enable_fb_login', String(cfg.enableFbLogin ?? '1'));
    if (input.rerequest || input.forceReauth || cfg.forceReauth === 'true') params.set('force_reauth', 'true');
  }

  const challenge = String(input.codeChallenge || '').trim();
  if (platform === 'twitter' && !challenge) return { ok: false, status: 400, error: 'Missing code_challenge (PKCE) for Twitter' };
  if ((platform === 'twitter' || platform === 'tiktok') && challenge) {
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', String(input.codeChallengeMethod || 'S256').trim() || 'S256');
  }
  if (platform === 'linkedin' && input.enableLinkedInExtendedLogin) params.set('enable_extended_login', 'true');
  if (platform === 'gmail') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  return { ok: true, url: `${authUrl}?${params.toString()}` };
}
