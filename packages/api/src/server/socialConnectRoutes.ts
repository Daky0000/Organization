import { Router, type Response } from 'express';
import type { Request } from '../types/http.ts';
import { FAST_MODEL } from '../ai-helpers.ts';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { INSTAGRAM_GRAPH_BASE, META_GRAPH_BASE } from '../meta-graph.ts';
import { readUserAccessToken, sanitizeTokenData, toPublicConnectionSummary } from '../token-data.ts';
import { resolveMailchimpServerPrefix } from '../integration-helpers.ts';
import { revokeProviderAccess } from '../oauth-provider-checks.ts';
import { OAUTH_AUTH_URLS, isInstagramDirectLogin } from '../platform-helpers.ts';

// ── Local constants ────────────────────────────────────────────────────────────

const X_API_BASE = 'https://api.x.com';
const X_OAUTH_TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;
const X_USERS_ME_API = `${X_API_BASE}/2/users/me`;

const INSTAGRAM_TARGET_REQUIRED_PERMISSIONS = ['pages_show_list', 'instagram_basic'];
const INSTAGRAM_RECOMMENDED_PERMISSIONS = ['instagram_content_publish', 'instagram_manage_insights'];
const INSTAGRAM_PROFILE_FIELDS = 'id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website,is_verified';
const META_PAGE_PUBLISH_TASKS = new Set(['CREATE_CONTENT', 'MANAGE']);
const META_PERMISSION_ALIASES: Record<string, string[]> = {
  instagram_basic: ['instagram_basic', 'instagram_business_basic'],
  instagram_content_publish: ['instagram_content_publish', 'instagram_business_content_publish'],
  instagram_manage_insights: ['instagram_manage_insights', 'instagram_business_manage_insights'],
  pages_show_list: ['pages_show_list'],
  pages_read_engagement: ['pages_read_engagement'],
  pages_manage_posts: ['pages_manage_posts'],
  pages_manage_metadata: ['pages_manage_metadata'],
  read_insights: ['read_insights'],
};

// ── Deps interface ─────────────────────────────────────────────────────────────

export interface SocialConnectDeps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  hasDatabase: () => boolean;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  normalizePlatformId: (value: string) => string;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  resolveOAuthRedirectUri: (platform: string, redirectUri?: string, req?: Request) => string;
  getLinkedInOAuthScopeString: () => string;
  shouldEnableLinkedInExtendedLogin: () => boolean;
  parseLinkedInScopeList: (value: unknown) => string[];
  computeIsoFromTtlSeconds: (seconds: unknown) => string | null;
  encryptIntegrationSecret: (plain: string) => string;
  decryptIntegrationSecret?: (encrypted: string) => string;
  upsertUserIntegration: (params: {
    userId: string;
    integrationSlug: string;
    accessTokenEncrypted?: string | null;
    refreshTokenEncrypted?: string | null;
    tokenExpiry?: string | null;
    accountId?: string | null;
    accountName?: string | null;
    status: 'connected' | 'disconnected' | 'error';
  }) => Promise<void>;
  logIntegrationEvent: (params: {
    userId: string | null;
    integrationSlug: string | null;
    eventType: string;
    status: 'success' | 'failed' | 'info';
    response?: any;
  }) => Promise<void>;
  getUserConnectedAccounts: (userId: string) => Promise<any[]>;
  markSocialAccountNeedsReapproval?: (params: { platformId: string; accountId?: string | null; userId?: string | null; reason?: string; disconnect?: boolean }) => Promise<void>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<any[]>;
  getAIConfig: () => Promise<any>;
  resolveActiveKey: (cfg: any) => string | null;
  GEMINI_MODELS: string[];
  callAINonStreaming: typeof import('../ai-helpers.ts').callAINonStreaming;
  publishToplatform: (userId: string, post: any, platformId: string) => Promise<any>;
}

// ── Meta Instagram helpers ─────────────────────────────────────────────────────

function getGrantedMetaPermissionSet(permsData: any): Set<string> {
  const perms = Array.isArray(permsData?.data) ? permsData.data : [];
  return new Set(
    perms
      .filter((p: any) => String(p?.status || '').toLowerCase() === 'granted')
      .map((p: any) => String(p?.permission || '').toLowerCase())
      .filter(Boolean)
  );
}

function missingMetaPermissions(granted: Set<string>, required: string[]): string[] {
  return required.filter((permission) => {
    const aliases = META_PERMISSION_ALIASES[permission] || [permission];
    return !aliases.some((alias) => granted.has(String(alias).toLowerCase()));
  });
}

async function fetchMetaPermissionSet(accessToken: string): Promise<Set<string>> {
  if (!accessToken) return new Set();
  try {
    const permsResp = await axios.get(`${META_GRAPH_BASE}/me/permissions`, {
      params: { access_token: accessToken },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (permsResp.status >= 400) return new Set();
    return getGrantedMetaPermissionSet(permsResp.data || {});
  } catch (err) {
    logger.error('Unhandled error:', err);
    return new Set();
  }
}

function hasInstagramPagePublishAccess(tasks: unknown, hasPageToken = false): boolean {
  const values = Array.isArray(tasks)
    ? tasks.map((task) => String(task || '').trim().toUpperCase()).filter(Boolean)
    : [];
  if (values.length === 0 && hasPageToken) return true;
  return values.some((task) => META_PAGE_PUBLISH_TASKS.has(task) || task === 'MODERATE');
}

export interface DiscoveredFacebookPage {
  id: string;
  name: string;
  category?: string | null;
  picture: string | null;
  access_token: string | null;
  tasks: string[];
  can_publish: boolean;
  instagram_business_account?: any | null;
  saved?: boolean;
}

export function isFacebookPersonalProfileUrl(rawInput: string): boolean {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return false;
  return /facebook\.com\/people\//i.test(trimmed) || /profile\.php\?id=\d+/i.test(trimmed);
}

export function parseFacebookPageLookupIdentifier(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('facebook.com/')) {
      const normalizedUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      const parsed = new URL(normalizedUrl);
      const profileId = parsed.searchParams.get('id') || parsed.searchParams.get('page_id');
      if (profileId) return profileId.trim();
      const segments = parsed.pathname
        .split('/')
        .map((s) => s.trim())
        .filter((s) => Boolean(s) && !['pages', 'pg', 'p', 'people', 'profile.php'].includes(s.toLowerCase()));
      if (segments.length > 0) {
        const last = segments[segments.length - 1];
        const dashMatch = last.match(/-(\d{8,})$/);
        return dashMatch ? dashMatch[1] : last;
      }
    }
  } catch (_err) {
    // Fallback to string cleanup below
  }
  return trimmed.replace(/^@/, '').replace(/\/+$/, '').trim();
}

export async function fetchAccessibleFacebookPages(
  userAccessToken: string,
  options?: { appId?: string; appSecret?: string; lookupPageId?: string },
): Promise<{
  pages: DiscoveredFacebookPage[];
  missingPermissions: string[];
  warnings: string[];
}> {
  const token = String(userAccessToken || '').trim();
  if (!token) {
    return { pages: [], missingPermissions: ['pages_show_list', 'pages_manage_posts'], warnings: [] };
  }

  const requiredPermissions = ['pages_show_list', 'pages_manage_posts'];
  const grantedPermissions = await fetchMetaPermissionSet(token);
  const missingPermissions = missingMetaPermissions(grantedPermissions, requiredPermissions);
  const warnings: string[] = [];

  const hasIgPermission =
    grantedPermissions.has('instagram_basic') || grantedPermissions.has('instagram_business_basic');
  const igSubfields = hasIgPermission
    ? ',instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}'
    : ',instagram_business_account{id,username,name}';

  // Fields valid on `/me/accounts`, `/{user_id}/accounts`, and `/{biz_id}/owned_pages` edges (includes `tasks`)
  const accountsEdgeFieldsWithIg = `id,name,category,category_list,access_token,tasks,picture.width(128).height(128)${igSubfields}`;
  const accountsEdgeFieldsBasic = 'id,name,category,category_list,access_token,tasks,picture.width(128).height(128)';

  // Fields valid on a `/{page_id}` Page node directly (`tasks` is NOT a valid field on Page node in Graph API!)
  const pageNodeFieldsWithToken = `id,name,category,category_list,access_token,picture.width(128).height(128)${igSubfields}`;
  const pageNodeFieldsBasicToken = 'id,name,category,category_list,access_token,picture.width(128).height(128)';
  const pageNodeFieldsPublic = 'id,name,category,category_list,picture.width(128).height(128),fan_count,followers_count';

  const byId = new Map<string, DiscoveredFacebookPage>();

  const ingestRawPage = (raw: any, allowWithoutPageIndicators = false, fallbackTasks: string[] = []) => {
    const id = String(raw?.id || '').trim();
    const name = String(raw?.name || '').trim();
    if (!id || !name) return;

    const rawTasks = Array.isArray(raw?.tasks)
      ? raw.tasks.map((t: any) => String(t || '').trim().toUpperCase()).filter(Boolean)
      : [];
    const tasks = rawTasks.length > 0 ? rawTasks : fallbackTasks;
    const accessToken = String(raw?.access_token || '').trim() || null;
    const categoryFromList =
      Array.isArray(raw?.category_list) && raw.category_list[0]?.name
        ? String(raw.category_list[0].name).trim()
        : null;
    const category = raw?.category ? String(raw.category).trim() : categoryFromList;
    const hasPageIndicator = Boolean(
      accessToken ||
        tasks.length > 0 ||
        category ||
        (Array.isArray(raw?.category_list) && raw.category_list.length > 0) ||
        raw?.instagram_business_account,
    );
    if (!allowWithoutPageIndicators && !hasPageIndicator) return;

    const picture = raw?.picture?.data?.url ? String(raw.picture.data.url) : null;
    const canPublish =
      tasks.includes('CREATE_CONTENT') ||
      tasks.includes('MANAGE') ||
      tasks.includes('MODERATE') ||
      tasks.includes('ADVERTISE') ||
      Boolean(accessToken) ||
      allowWithoutPageIndicators;

    const existing = byId.get(id);
    byId.set(id, {
      id,
      name: name || existing?.name || id,
      category: category || existing?.category || null,
      picture: picture || existing?.picture || null,
      access_token: accessToken || existing?.access_token || null,
      tasks: tasks.length > 0 ? tasks : existing?.tasks || [],
      can_publish: canPublish || Boolean(existing?.can_publish),
      instagram_business_account: raw?.instagram_business_account || existing?.instagram_business_account || null,
    });
  };

  // Helper to fetch a single Page node by ID or username/handle (never passes `tasks` which fails on Page nodes)
  const fetchPageNodeByIdOrHandle = async (
    identifier: string,
    allowWithoutPageIndicators: boolean,
    fallbackTasks: string[] = [],
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    const encoded = encodeURIComponent(identifier);
    const fieldCandidates = [pageNodeFieldsWithToken, pageNodeFieldsBasicToken, pageNodeFieldsPublic];
    let lastError: string | undefined;

    for (const fields of fieldCandidates) {
      try {
        const resp = await axios.get(`${META_GRAPH_BASE}/${encoded}`, {
          params: { fields, access_token: token },
          validateStatus: () => true,
          timeout: 12000,
        });
        if (resp.status < 400 && resp.data?.id) {
          ingestRawPage(resp.data, allowWithoutPageIndicators, fallbackTasks);
          return { ok: true };
        }
        if (resp.status >= 400 && resp.data?.error?.message) {
          lastError = String(resp.data.error.message);
        }
      } catch (_err) {
        // try next field set
      }
    }
    return { ok: false, errorMessage: lastError };
  };

  // Strategy 1: Standard /me/accounts (with progressive field fallbacks per Meta Pages API docs)
  try {
    let accountsLoaded = false;
    for (const fieldsParam of [accountsEdgeFieldsWithIg, accountsEdgeFieldsBasic, undefined]) {
      const params: Record<string, any> = { limit: 200, access_token: token };
      if (fieldsParam) params.fields = fieldsParam;

      const pagesResp = await axios.get(`${META_GRAPH_BASE}/me/accounts`, {
        params,
        validateStatus: () => true,
        timeout: 15000,
      });
      if (pagesResp.status < 400 && Array.isArray(pagesResp.data?.data)) {
        accountsLoaded = true;
        for (const p of pagesResp.data.data) {
          ingestRawPage(p, true);
        }
        if (byId.size > 0) break;
      } else if (pagesResp.status >= 400 && !fieldsParam) {
        const errMsg = pagesResp.data?.error?.message;
        if (errMsg) warnings.push(String(errMsg));
      }
    }

    // Strategy 1b: /me/assigned_pages (Business Manager assigned pages)
    if (byId.size === 0 || !accountsLoaded) {
      const assignedResp = await axios.get(`${META_GRAPH_BASE}/me/assigned_pages`, {
        params: {
          fields: 'id,name,tasks,access_token,category,picture.width(128).height(128)',
          limit: 200,
          access_token: token,
        },
        validateStatus: () => true,
        timeout: 12000,
      });
      if (assignedResp.status < 400 && Array.isArray(assignedResp.data?.data)) {
        for (const p of assignedResp.data.data) {
          ingestRawPage(p, true);
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'facebook_me_accounts_lookup_failed');
  }

  // Strategy 2: Inspect granular_scopes target_ids from /debug_token
  try {
    const appId = String(options?.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
    const appSecret = String(options?.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
    const debugAccessToken = appId && appSecret ? `${appId}|${appSecret}` : token;

    const debugResp = await axios.get(`${META_GRAPH_BASE}/debug_token`, {
      params: {
        input_token: token,
        access_token: debugAccessToken,
      },
      validateStatus: () => true,
      timeout: 12000,
    });
    if (debugResp.status < 400) {
      const granularScopes: any[] = Array.isArray(debugResp.data?.data?.granular_scopes)
        ? debugResp.data.data.granular_scopes
        : [];
      const pageTargetIds = new Set<string>();
      const businessTargetIds = new Set<string>();
      let hasManagePostsScope = false;

      for (const gs of granularScopes) {
        const scopeName = String(gs?.scope || '').toLowerCase();
        if (scopeName === 'pages_manage_posts') hasManagePostsScope = true;
        const ids = Array.isArray(gs?.target_ids) ? gs.target_ids : [];
        if (scopeName.startsWith('pages_') || scopeName === 'read_insights') {
          for (const rawId of ids) {
            const cleanId = String(rawId || '').trim();
            if (cleanId && !byId.has(cleanId)) pageTargetIds.add(cleanId);
          }
        } else if (scopeName.startsWith('business_')) {
          for (const rawId of ids) {
            const cleanId = String(rawId || '').trim();
            if (cleanId && !byId.has(cleanId) && !pageTargetIds.has(cleanId)) {
              businessTargetIds.add(cleanId);
            }
          }
        }
      }

      const inferredTasks = hasManagePostsScope ? ['CREATE_CONTENT', 'MANAGE'] : ['ANALYZE'];

      if (pageTargetIds.size > 0) {
        await Promise.all(
          Array.from(pageTargetIds).slice(0, 50).map(async (targetId) => {
            await fetchPageNodeByIdOrHandle(targetId, true, inferredTasks);
          }),
        );
      }

      if (businessTargetIds.size > 0) {
        await Promise.all(
          Array.from(businessTargetIds).slice(0, 25).map(async (targetId) => {
            await fetchPageNodeByIdOrHandle(targetId, false, inferredTasks);
          }),
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, 'facebook_debug_token_granular_lookup_failed');
  }

  // Strategy 3: Check Meta Business Portfolios (/me/businesses -> owned_pages & client_pages)
  try {
    const bizResp = await axios.get(`${META_GRAPH_BASE}/me/businesses`, {
      params: {
        fields: 'id,name',
        limit: 25,
        access_token: token,
      },
      validateStatus: () => true,
      timeout: 12000,
    });
    if (bizResp.status < 400 && Array.isArray(bizResp.data?.data)) {
      const businesses: any[] = bizResp.data.data;
      await Promise.all(
        businesses.slice(0, 10).map(async (biz) => {
          const bizId = String(biz?.id || '').trim();
          if (!bizId) return;
          for (const edge of ['owned_pages', 'client_pages']) {
            try {
              const edgeResp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(bizId)}/${edge}`, {
                params: {
                  fields: accountsEdgeFieldsBasic,
                  limit: 100,
                  access_token: token,
                },
                validateStatus: () => true,
                timeout: 12000,
              });
              if (edgeResp.status < 400 && Array.isArray(edgeResp.data?.data)) {
                for (const p of edgeResp.data.data) {
                  ingestRawPage(p, true, ['CREATE_CONTENT', 'MANAGE']);
                }
              }
            } catch (_e) {
              // ignore edge error
            }
          }
        }),
      );
    }
  } catch (_err) {
    // ignore business lookup error if business_management scope is not granted
  }

  // Strategy 4: Explicit Page ID / URL / Handle lookup if requested
  const lookupIdentifier = parseFacebookPageLookupIdentifier(options?.lookupPageId || '');
  if (lookupIdentifier && !byId.has(lookupIdentifier)) {
    const lookupRes = await fetchPageNodeByIdOrHandle(lookupIdentifier, false, ['CREATE_CONTENT']);
    if (!lookupRes.ok && lookupRes.errorMessage) {
      warnings.push(lookupRes.errorMessage);
    }
  }

  return {
    pages: Array.from(byId.values()),
    missingPermissions,
    warnings,
  };
}

export async function syncFacebookPagesForUser(
  deps: Pick<SocialConnectDeps, 'pool' | 'dbQuery' | 'getPlatformConfig' | 'encryptIntegrationSecret'>,
  userId: string,
  userAccessToken: string,
): Promise<DiscoveredFacebookPage[]> {
  if (!deps.pool || !userAccessToken) return [];
  try {
    const cfg = await deps.getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
    const appId = String(cfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
    const appSecret = String(cfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();

    const { pages } = await fetchAccessibleFacebookPages(userAccessToken, { appId, appSecret });
    if (pages.length === 0) return [];

    const platRow = await deps.dbQuery<{ id: number }>('SELECT id FROM social_platforms WHERE slug=$1', ['facebook']).catch(() => ({ rows: [] } as any));
    const platformDbId = platRow?.rows?.[0]?.id ?? null;

    let savedAny = false;
    for (const page of pages) {
      if (!page.id || !page.name) continue;
      // Only a Page token can publish as the Page. Storing the user token in
      // its place made every later post fail with a permissions error; with no
      // token stored, publishing resolves the Page token at send time instead.
      const encryptedPageToken = page.access_token ? deps.encryptIntegrationSecret(page.access_token) : null;

      const updateRes = await deps.dbQuery(
        `UPDATE social_accounts
         SET account_name = $5,
             platform_id = $3,
             profile_image = COALESCE($7, profile_image),
             access_token = NULL,
             access_token_encrypted = COALESCE($8, access_token_encrypted),
             connected = true,
             connected_at = NOW(),
             needs_reapproval = false
         WHERE user_id = $1 AND platform = $2 AND account_type = $4 AND account_id = $6`,
        [userId, 'facebook', platformDbId, 'page', page.name, page.id, page.picture, encryptedPageToken],
      );

      let socialAccountId: string | null = null;
      if ((updateRes.rowCount ?? 0) === 0) {
        socialAccountId = randomUUID();
        await deps.dbQuery(
          `INSERT INTO social_accounts (id, user_id, platform, platform_id, account_type, account_id, account_name, profile_image, access_token, access_token_encrypted, connected, connected_at, created_at, needs_reapproval)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, true, NOW(), NOW(), false)`,
          [socialAccountId, userId, 'facebook', platformDbId, 'page', page.id, page.name, page.picture, encryptedPageToken],
        );
      } else {
        const existingRow = await deps.dbQuery<{ id: string }>(
          `SELECT id FROM social_accounts WHERE user_id = $1 AND platform = 'facebook' AND account_type = 'page' AND account_id = $2 LIMIT 1`,
          [userId, page.id],
        );
        socialAccountId = existingRow.rows?.[0]?.id ?? null;
      }

      if (socialAccountId) {
        const connUpdate = await deps.dbQuery(
          `UPDATE social_connections SET active = true WHERE user_id = $1 AND social_account_id = $2`,
          [userId, socialAccountId],
        );
        if ((connUpdate.rowCount ?? 0) === 0) {
          await deps.dbQuery(
            `INSERT INTO social_connections (id, user_id, social_account_id, active, created_at)
             VALUES ($1, $2, $3, true, NOW())`,
            [randomUUID(), userId, socialAccountId],
          ).catch(() => undefined);
        }
      }
      savedAny = true;
    }

    if (savedAny) {
      const existingSettings = await deps.dbQuery<{ value: any }>(
        `SELECT value FROM user_settings WHERE user_id = $1 AND key = 'posts-automation-settings'`,
        [userId],
      ).catch(() => ({ rows: [] } as any));
      const prevVal = existingSettings?.rows?.[0]?.value && typeof existingSettings.rows[0].value === 'object'
        ? existingSettings.rows[0].value
        : {};
      if (!prevVal.facebookTarget) {
        const nextVal = { ...prevVal, facebookTarget: 'page' };
        await deps.dbQuery(
          `INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
           VALUES ($1, 'posts-automation-settings', $2::jsonb, NOW(), NOW())
           ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [userId, JSON.stringify(nextVal)],
        ).catch(() => undefined);
      }
    }

    return pages;
  } catch (err) {
    logger.warn({ err }, 'syncFacebookPagesForUser_failed');
    return [];
  }
}

async function fetchInstagramBusinessProfile(igUserId: string, accessToken: string): Promise<{ profile: any | null; error?: string }> {
  try {
    const resp = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(igUserId)}`, {
      params: {
        fields: INSTAGRAM_PROFILE_FIELDS,
        access_token: accessToken,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    const data: any = resp.data || {};
    if (resp.status >= 400) {
      return { profile: null, error: data?.error?.message || `Instagram API error ${resp.status}` };
    }
    return { profile: data };
  } catch (error) {
    return { profile: null, error: error instanceof Error ? error.message : 'Instagram profile lookup failed' };
  }
}

async function listInstagramPageTargets(
  userAccessToken: string,
  options?: { appId?: string; appSecret?: string },
): Promise<{
  targets: any[];
  missingPermissions: string[];
  warnings: string[];
}> {
  const grantedPermissions = await fetchMetaPermissionSet(userAccessToken);
  const missingPermissions = missingMetaPermissions(grantedPermissions, INSTAGRAM_TARGET_REQUIRED_PERMISSIONS);
  const missingRecommended = missingMetaPermissions(grantedPermissions, INSTAGRAM_RECOMMENDED_PERMISSIONS);
  const warnings: string[] = [];

  if (missingRecommended.length > 0) {
    warnings.push(
      `Missing recommended Instagram permissions: ${missingRecommended.join(', ')}. Reconnect Meta/Facebook and approve them to enable Instagram publishing and insights.`
    );
  }

  if (missingPermissions.includes('pages_show_list')) {
    warnings.push('Meta page access is missing `pages_show_list`, so Instagram business accounts cannot be discovered yet.');
    return { targets: [], missingPermissions, warnings };
  }

  const discovered = await fetchAccessibleFacebookPages(userAccessToken, options);
  for (const w of discovered.warnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  const pages = discovered.pages;
  const targets = await Promise.all(
    pages.map(async (page: DiscoveredFacebookPage) => {
      const pageId = String(page?.id || '').trim();
      const pageName = String(page?.name || '').trim();
      const pageAccessToken = String(page?.access_token || '').trim();
      const pageTasks = Array.isArray(page?.tasks)
        ? page.tasks.map((task: any) => String(task || '').trim()).filter(Boolean)
        : [];
      const pagePicture = page?.picture ? String(page.picture) : null;
      const ig = page?.instagram_business_account || null;
      const instagramId = String(ig?.id || '').trim() || null;
      let profile: any = null;

      if (instagramId && (pageAccessToken || userAccessToken)) {
        const profileResult = await fetchInstagramBusinessProfile(instagramId, pageAccessToken || userAccessToken);
        profile = profileResult.profile;
      }

      return {
        pageId,
        pageName,
        pagePicture,
        pageTasks,
        pageAccessToken,
        instagramId,
        instagramUsername: String(profile?.username || ig?.username || '').trim() || null,
        instagramName: String(profile?.name || ig?.name || '').trim() || null,
        instagramAccountType: String(profile?.account_type || '').trim() || null,
        instagramFollowers: profile?.followers_count !== undefined ? Number(profile.followers_count) : null,
        instagramFollowing: profile?.follows_count !== undefined ? Number(profile.follows_count) : null,
        instagramMediaCount: profile?.media_count !== undefined ? Number(profile.media_count) : null,
        instagramBio: typeof profile?.biography === 'string' ? profile.biography : null,
        instagramProfilePicture: typeof profile?.profile_picture_url === 'string' ? profile.profile_picture_url : null,
        instagramWebsite: typeof profile?.website === 'string' ? profile.website : null,
        instagramVerified: profile?.is_verified === true,
        canPublish:
          Boolean(pageAccessToken) &&
          hasInstagramPagePublishAccess(pageTasks, Boolean(pageAccessToken)) &&
          missingMetaPermissions(grantedPermissions, ['instagram_content_publish']).length === 0,
        canInsights:
          Boolean(pageAccessToken) &&
          missingMetaPermissions(grantedPermissions, ['instagram_manage_insights']).length === 0,
      };
    })
  );

  return { targets: targets.filter((target) => target.pageId), missingPermissions, warnings };
}

// ── OAuth helper functions ─────────────────────────────────────────────────────

export function platformDisplayName(platformId: string) {
  switch ((platformId || '').trim().toLowerCase()) {
    case 'instagram': return 'Instagram';
    case 'facebook': return 'Facebook';
    case 'linkedin': return 'LinkedIn';
    case 'twitter': return 'Twitter';
    case 'pinterest': return 'Pinterest';
    case 'tiktok': return 'TikTok';
    case 'threads': return 'Threads';
    default: return platformId;
  }
}

// Calls the provider's "who am I" endpoint with a stored token. 401/403 (or a
// Graph OAuthException 190) means the token itself is no longer accepted.
export async function probeConnectionIdentity(
  platformId: string,
  conn: { access_token: string; account_id?: string | null; token_data?: any },
): Promise<{ status: 'ok' | 'unauthorized' | 'error'; message: string }> {
  const token = String(conn.access_token || '').trim();
  const bearer = { Authorization: `Bearer ${token}` };
  let request: { url: string; params?: Record<string, string>; headers?: Record<string, string> } | null = null;
  switch (platformId) {
    case 'facebook':
      request = { url: `${META_GRAPH_BASE}/me`, params: { fields: 'id,name', access_token: token } };
      break;
    case 'instagram':
      request = isInstagramDirectLogin({ accessToken: token, tokenData: conn.token_data })
        ? { url: `${INSTAGRAM_GRAPH_BASE}/me`, params: { fields: 'user_id,username', access_token: token } }
        : { url: `${META_GRAPH_BASE}/${encodeURIComponent(String(conn.account_id || 'me'))}`, params: { fields: 'id,username', access_token: token } };
      break;
    case 'threads':
      request = { url: 'https://graph.threads.net/v1.0/me', params: { fields: 'id,username', access_token: token } };
      break;
    case 'linkedin':
      request = { url: 'https://api.linkedin.com/v2/userinfo', headers: bearer };
      break;
    case 'twitter':
      request = { url: X_USERS_ME_API, headers: bearer };
      break;
    case 'pinterest':
      request = { url: 'https://api.pinterest.com/v5/user_account', headers: bearer };
      break;
    case 'tiktok':
      request = { url: 'https://open.tiktokapis.com/v2/user/info/', params: { fields: 'open_id,display_name' }, headers: bearer };
      break;
    default:
      return { status: 'error', message: `Live checks are not available for ${platformDisplayName(platformId)}.` };
  }
  try {
    let resp = await axios.get(request.url, { params: request.params, headers: request.headers, validateStatus: () => true, timeout: 12000 });
    // LinkedIn apps on the legacy profile product have no /userinfo.
    if (platformId === 'linkedin' && resp.status === 403) {
      resp = await axios.get('https://api.linkedin.com/v2/me', { headers: bearer, validateStatus: () => true, timeout: 12000 });
    }
    const data: any = resp.data || {};
    const tiktokError = platformId === 'tiktok' && data?.error?.code && data.error.code !== 'ok' ? String(data.error.code) : '';
    if (resp.status === 401 || resp.status === 403 || data?.error?.code === 190 || tiktokError === 'access_token_invalid') {
      return { status: 'unauthorized', message: 'The platform no longer accepts this connection. Reconnect to continue.' };
    }
    if (resp.status >= 400 || tiktokError) {
      const detail = data?.error?.message || data?.message || data?.detail || tiktokError || `HTTP ${resp.status}`;
      return { status: 'error', message: `The platform returned an error: ${String(detail).slice(0, 200)}` };
    }
    return { status: 'ok', message: `${platformDisplayName(platformId)} connection is working.` };
  } catch (err) {
    return { status: 'error', message: `Could not reach ${platformDisplayName(platformId)}: ${err instanceof Error ? err.message : 'network error'}` };
  }
}

export async function getOAuthStateRow(
  dbQuery: SocialConnectDeps['dbQuery'],
  state: string,
): Promise<{ user_id: string; platform: string; return_to?: string | null; code_verifier?: string | null } | null> {
  const result = await dbQuery<{ user_id: string; platform: string; return_to: string | null; code_verifier: string | null }>(
    'SELECT user_id, platform, return_to, code_verifier FROM oauth_states WHERE state = $1 AND expires_at > NOW()',
    [state]
  );
  return result.rows[0] ?? null;
}

function computeIsoFromUnixTimestamp(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function resolveRedirectUri(uri: string | undefined): string {
  if (!uri) return '';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  const appUrl = process.env.VITE_APP_URL || 'http://localhost:3000';
  return `${appUrl}${uri}`;
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

function resolveBackendRedirectUri(uri: string | undefined, req?: Request): string {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const base = getBackendPublicUrl(req);
  if (!base) return raw.startsWith('/') ? raw : `/${raw}`;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

// ── LinkedIn OAuth helpers ─────────────────────────────────────────────────────

export async function getLinkedInOAuthCredentials(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  req?: Request,
): Promise<{ clientId: string; redirectUri: string; clientSecrets: string[] }> {
  const cfg = await getPlatformConfig('linkedin');
  const clientId = String(cfg.clientId || process.env.VITE_LINKEDIN_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID || '').trim();
  const redirectUri = resolveOAuthRedirectUri('linkedin', cfg.redirectUri || process.env.VITE_LINKEDIN_REDIRECT_URI || process.env.LINKEDIN_REDIRECT_URI, req);
  const clientSecrets = Array.from(
    new Set(
      [
        cfg.clientSecret,
        process.env.LINKEDIN_CLIENT_SECRET,
        process.env.LINKEDIN_CLIENT_SECRET_PREVIOUS,
        process.env.LINKEDIN_CLIENT_SECRET_ALT,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  if (!clientId || !redirectUri || clientSecrets.length === 0) {
    throw new Error('LinkedIn client credentials not configured');
  }

  return { clientId, redirectUri, clientSecrets };
}

function shouldRetryLinkedInSecret(status: number, payload: any): boolean {
  const errorCode = String(payload?.error || payload?.code || '').trim().toLowerCase();
  return status === 401 || errorCode === 'invalid_client' || errorCode === 'unauthorized_client';
}

export async function postLinkedInOAuthForm(
  baseParams: Record<string, string>,
  credentials: { clientId: string; redirectUri: string; clientSecrets: string[] },
): Promise<any> {
  let lastResponse: any = null;

  for (let index = 0; index < credentials.clientSecrets.length; index += 1) {
    const clientSecret = credentials.clientSecrets[index];
    const body = new URLSearchParams({
      ...baseParams,
      client_id: credentials.clientId,
      client_secret: clientSecret,
      redirect_uri: credentials.redirectUri,
    });
    const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
      timeout: 15000,
    });

    if (response.status < 400) return response;

    lastResponse = response;
    if (index === credentials.clientSecrets.length - 1 || !shouldRetryLinkedInSecret(response.status, response.data)) {
      return response;
    }
  }

  return lastResponse;
}

async function introspectLinkedInAccessToken(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  accessToken: string,
  req?: Request,
): Promise<any | null> {
  const token = String(accessToken || '').trim();
  if (!token) return null;

  try {
    const credentials = await getLinkedInOAuthCredentials(getPlatformConfig, resolveOAuthRedirectUri, req);
    let lastResponse: any = null;

    for (let index = 0; index < credentials.clientSecrets.length; index += 1) {
      const body = new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecrets[index],
        token,
      });
      const response = await axios.post('https://www.linkedin.com/oauth/v2/introspectToken', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      });

      if (response.status < 400) return response.data || null;

      lastResponse = response;
      if (index === credentials.clientSecrets.length - 1 || !shouldRetryLinkedInSecret(response.status, response.data)) {
        break;
      }
    }

    return lastResponse?.data || null;
  } catch (err) {
    logger.error('Unhandled error:', err);
    return null;
  }
}

function mergeLinkedInTokenMetadata(
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  tokenData: any,
  introspection?: any,
) {
  const next = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};
  const scopes = parseLinkedInScopeList(next?.scope || introspection?.scope);
  if (scopes.length > 0) {
    next.scope = scopes.join(' ');
    next.scopes = scopes;
  }

  if (typeof introspection?.active === 'boolean') next.access_token_active = introspection.active;
  if (introspection?.status) next.access_token_status = String(introspection.status);
  if (introspection?.authorized_at != null) next.access_token_authorized_at = Number(introspection.authorized_at);
  if (introspection?.created_at != null) next.access_token_created_at = Number(introspection.created_at);
  if (introspection?.expires_at != null) {
    next.access_token_expires_at_unix = Number(introspection.expires_at);
    const accessTokenExpiresAt = computeIsoFromUnixTimestamp(introspection.expires_at);
    if (accessTokenExpiresAt) next.access_token_expires_at = accessTokenExpiresAt;
  }

  const refreshTokenExpiresAt = computeIsoFromTtlSeconds(next?.refresh_token_expires_in);
  if (refreshTokenExpiresAt) next.refresh_token_expires_at = refreshTokenExpiresAt;

  return next;
}

export async function enrichLinkedInTokenData(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  tokenData: any,
  req?: Request,
) {
  const accessToken = String(tokenData?.access_token || '').trim();
  let enriched = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};

  if (accessToken) {
    const introspection = await introspectLinkedInAccessToken(getPlatformConfig, resolveOAuthRedirectUri, accessToken, req);
    enriched = mergeLinkedInTokenMetadata(parseLinkedInScopeList, computeIsoFromTtlSeconds, enriched, introspection);

    try {
      let linkedInId = '';
      let fullName = '';
      const meResp = await axios.get('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data || {};
        linkedInId = String(meData?.id || '').trim();
        fullName = [String(meData?.localizedFirstName || ''), String(meData?.localizedLastName || '')].filter(Boolean).join(' ').trim();
      }
      if (!linkedInId) {
        const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (userinfoResp.status < 400) {
          const userData: any = userinfoResp.data || {};
          linkedInId = String(userData?.sub || '').trim();
          fullName = fullName || String(userData?.name || '').trim() || [String(userData?.given_name || ''), String(userData?.family_name || '')].filter(Boolean).join(' ').trim();
        }
      }
      if (linkedInId) {
        enriched.user_id = linkedInId;
        enriched.id = linkedInId;
        enriched.sub = linkedInId;
      }
      if (fullName) enriched.name = fullName;
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  return enriched;
}

// ── Exchange functions ─────────────────────────────────────────────────────────

async function exchangePinterestCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('pinterest');
  const clientId = String(cfg.clientId || process.env.VITE_PINTEREST_CLIENT_ID || '').trim();
  const clientSecret = String(cfg.clientSecret || process.env.PINTEREST_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('pinterest', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Pinterest client credentials not configured');

  // continuous_refresh opts apps created before Sept 2025 into the rotating
  // 60-day refresh token; legacy 365-day refresh tokens are no longer issued.
  const data = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    continuous_refresh: 'true',
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await axios.post('https://api.pinterest.com/v5/oauth/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) {
    const msg = (resp.data as any)?.message || (resp.data as any)?.error || `Pinterest token exchange failed (${resp.status})`;
    logger.error('Pinterest token exchange error:', { status: resp.status, body: resp.data, redirectUri });
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        if (me?.id) { tokenData.user_id = String(me.id); tokenData.id = String(me.id); }
        if (me?.username) tokenData.username = String(me.username);
        if (me?.profile_image) tokenData.avatar_url = String(me.profile_image);
        if (me?.follower_count != null) tokenData.followers_count = me.follower_count;
        if (me?.following_count != null) tokenData.following_count = me.following_count;
        if (me?.pin_count != null) tokenData.pin_count = me.pin_count;
        if (me?.board_count != null) tokenData.board_count = me.board_count;
        if (me?.monthly_views != null) tokenData.monthly_views = me.monthly_views;
        if (me?.website_url != null) tokenData.website_url = me.website_url;
        if (me?.about != null) tokenData.about = me.about;
        tokenData.name = String(me?.business_name || me?.username || tokenData?.name || '').trim() || tokenData?.name || null;
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  return tokenData;
}

async function exchangeInstagramCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cleanCode = String(code || '').replace(/#_.*$/, '').trim();
  const cfg = await getPlatformConfig('instagram').catch(() => ({} as Record<string, string>));
  const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));

  const igClientId = String(cfg.appId || fbCfg.appId || process.env.VITE_INSTAGRAM_APP_ID || process.env.VITE_FACEBOOK_APP_ID || '').trim();
  const igClientSecret = String(cfg.appSecret || fbCfg.appSecret || process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '').trim();
  const fbClientId = String(cfg.facebookAppId || fbCfg.appId || cfg.appId || process.env.VITE_FACEBOOK_APP_ID || process.env.VITE_INSTAGRAM_APP_ID || '').trim();
  const fbClientSecret = String(cfg.facebookAppSecret || fbCfg.appSecret || cfg.appSecret || process.env.FACEBOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('instagram', cfg.redirectUri || fbCfg.redirectUri, req);

  if ((!igClientId || !igClientSecret) && (!fbClientId || !fbClientSecret)) {
    throw new Error('Instagram app credentials not configured. Please add App ID and Secret under Admin → Integrations → Instagram.');
  }

  let loginMethod: 'instagram' | 'facebook' = 'instagram';
  let response: any = { status: 500, data: {} };

  // 1. First attempt: Direct Instagram OAuth token endpoint (Instagram API with Instagram Login)
  if (igClientId && igClientSecret) {
    const instagramData = new URLSearchParams({
      client_id: igClientId,
      client_secret: igClientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: cleanCode,
    });

    response = await axios.post('https://api.instagram.com/oauth/access_token', instagramData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
      timeout: 15000,
    });
  }

  // 2. Fallback: Business Login for Instagram (Instagram API with Facebook Login via graph.facebook.com)
  if (response.status >= 400 && fbClientId && fbClientSecret) {
    const fbFallback = await axios.get(`${META_GRAPH_BASE}/oauth/access_token`, {
      params: {
        client_id: fbClientId,
        client_secret: fbClientSecret,
        redirect_uri: redirectUri,
        code: cleanCode,
      },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (fbFallback.status < 400) {
      response = fbFallback;
      loginMethod = 'facebook';
    }
  }

  if (response.status >= 400) {
    const errData: any = response.data || {};
    const detail = errData?.error_message || errData?.error?.message || errData?.message || errData?.error_description || `HTTP ${response.status}`;
    logger.error('Instagram token exchange failed:', { status: response.status, body: response.data, redirectUri });
    throw new Error(`Instagram token exchange failed: ${detail}`);
  }

  const rawBody: any = response.data || {};
  const firstEntry: any = Array.isArray(rawBody?.data) && rawBody.data[0] ? rawBody.data[0] : rawBody;
  const tokenData: any = {
    ...rawBody,
    ...(firstEntry && typeof firstEntry === 'object' ? firstEntry : {}),
    login_method: loginMethod,
    graph_host: loginMethod === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com',
  };
  const shortLivedToken = String(tokenData?.access_token || '').trim();

  if (shortLivedToken) {
    if (loginMethod === 'instagram') {
      // 3a. Direct Instagram Login: Exchange short-lived token for 60-day long-lived Instagram User token
      try {
        const longRes = await axios.get('https://graph.instagram.com/access_token', {
          params: {
            grant_type: 'ig_exchange_token',
            client_secret: igClientSecret,
            access_token: shortLivedToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (longRes.status < 400 && (longRes.data as any)?.access_token) {
          tokenData.short_lived_access_token = shortLivedToken;
          tokenData.access_token = String((longRes.data as any).access_token || '').trim();
          if ((longRes.data as any)?.expires_in) {
            tokenData.expires_in = (longRes.data as any).expires_in;
          }
        }
      } catch (err) {
        logger.warn('Instagram long-lived token exchange warning:', err);
      }

      const currentToken = String(tokenData.access_token || shortLivedToken).trim();

      // 4a. Resolve Instagram professional profile via graph.instagram.com
      try {
        const meResp = await axios.get(`${INSTAGRAM_GRAPH_BASE}/me`, {
          params: {
            fields: 'user_id,id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website',
            access_token: currentToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (meResp.status < 400 && meResp.data) {
          const me: any = meResp.data;
          // The token exchange returns the app-scoped id, which is what Meta's
          // deauthorize/data-deletion callbacks carry; keep it before the
          // professional account id replaces user_id.
          if (tokenData.user_id && !tokenData.app_scoped_user_id) tokenData.app_scoped_user_id = String(tokenData.user_id);
          const uid = String(me.user_id || me.id || tokenData.user_id || '').trim();
          if (uid) {
            tokenData.user_id = uid;
            tokenData.id = uid;
            tokenData.sub = uid;
          }
          if (me.username) {
            tokenData.username = String(me.username).trim();
            tokenData.instagramUsername = tokenData.username;
          }
          if (me.name) {
            tokenData.name = String(me.name).trim();
            tokenData.instagramName = tokenData.name;
          } else if (me.username) {
            tokenData.name = String(me.username).trim();
          }
          if (me.profile_picture_url) {
            tokenData.avatar_url = String(me.profile_picture_url);
            tokenData.profilePictureUrl = String(me.profile_picture_url);
          }
          if (me.followers_count !== undefined) tokenData.followers_count = Number(me.followers_count);
          if (me.media_count !== undefined) {
            tokenData.media_count = Number(me.media_count);
            tokenData.mediaCount = Number(me.media_count);
          }
          if (me.account_type) {
            tokenData.account_type = String(me.account_type);
            tokenData.accountType = String(me.account_type);
          }
          if (me.biography) tokenData.biography = String(me.biography);
          if (me.website) tokenData.website = String(me.website);
          tokenData.canPublish = true;
          tokenData.canInsights = true;
        }
      } catch (err) {
        logger.warn('Instagram /me profile fetch error:', err);
      }
    } else {
      // 3b. Business Login for Instagram (with Facebook Login): Exchange for 60-day long-lived Facebook User token
      try {
        const fbLongRes = await axios.get(`${META_GRAPH_BASE}/oauth/access_token`, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: fbClientId,
            client_secret: fbClientSecret,
            fb_exchange_token: shortLivedToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        });
        if (fbLongRes.status < 400 && (fbLongRes.data as any)?.access_token) {
          tokenData.short_lived_access_token = shortLivedToken;
          tokenData.access_token = String((fbLongRes.data as any).access_token || '').trim();
          // Long-lived user tokens last ~60 days; Meta sometimes omits expires_in.
          tokenData.expires_in = (fbLongRes.data as any)?.expires_in || 60 * 24 * 3600;
        }
      } catch (_e) { /* ignore */ }
      const hasLongLivedUserToken = Boolean(tokenData.short_lived_access_token);

      const userAccessToken = String(tokenData.access_token || shortLivedToken).trim();
      tokenData.user_access_token = userAccessToken;
      // The Facebook user behind the grant: Meta's deauthorize callback names
      // this id, not the Instagram account's.
      try {
        const fbMe = await axios.get(`${META_GRAPH_BASE}/me`, {
          params: { fields: 'id', access_token: userAccessToken },
          validateStatus: () => true,
          timeout: 10000,
        });
        if (fbMe.status < 400 && (fbMe.data as any)?.id) tokenData.facebook_user_id = String((fbMe.data as any).id);
      } catch (_e) { /* best effort */ }

      // 4b. Discover Facebook Pages & linked Instagram Professional Accounts (supports /me/accounts, debug_token granular scopes, and Business Portfolios)
      try {
        const targetResult = await listInstagramPageTargets(userAccessToken, {
          appId: fbClientId,
          appSecret: fbClientSecret,
        });
        const matchedTarget = (targetResult.targets || []).find((t) => Boolean(t.instagramId));
        if (matchedTarget && matchedTarget.instagramId) {
          tokenData.user_id = matchedTarget.instagramId;
          tokenData.id = matchedTarget.instagramId;
          tokenData.sub = matchedTarget.instagramId;
          tokenData.username = matchedTarget.instagramUsername || matchedTarget.pageName || '';
          tokenData.instagramUsername = matchedTarget.instagramUsername || null;
          tokenData.name = matchedTarget.instagramName || matchedTarget.instagramUsername || matchedTarget.pageName || '';
          tokenData.instagramName = matchedTarget.instagramName || matchedTarget.instagramUsername || null;
          if (matchedTarget.instagramProfilePicture || matchedTarget.pagePicture) {
            tokenData.avatar_url = matchedTarget.instagramProfilePicture || matchedTarget.pagePicture;
            tokenData.profilePictureUrl = matchedTarget.instagramProfilePicture || matchedTarget.pagePicture;
          }
          if (matchedTarget.instagramFollowers != null) {
            tokenData.followers_count = Number(matchedTarget.instagramFollowers);
          }
          if (matchedTarget.instagramMediaCount != null) {
            tokenData.media_count = Number(matchedTarget.instagramMediaCount);
            tokenData.mediaCount = Number(matchedTarget.instagramMediaCount);
          }
          if (matchedTarget.instagramAccountType) {
            tokenData.account_type = matchedTarget.instagramAccountType;
            tokenData.accountType = matchedTarget.instagramAccountType;
          }
          if (matchedTarget.instagramBio) tokenData.biography = matchedTarget.instagramBio;
          if (matchedTarget.instagramWebsite) tokenData.website = matchedTarget.instagramWebsite;
          tokenData.pageId = matchedTarget.pageId;
          tokenData.pageName = matchedTarget.pageName;
          tokenData.pagePicture = matchedTarget.pagePicture || null;
          tokenData.pageTasks = matchedTarget.pageTasks || [];
          tokenData.canPublish = Boolean(matchedTarget.canPublish);
          tokenData.canInsights = Boolean(matchedTarget.canInsights);
          if (matchedTarget.pageAccessToken) {
            tokenData.pageAccessToken = matchedTarget.pageAccessToken;
            tokenData.access_token = matchedTarget.pageAccessToken;
            // A Page token minted from a long-lived user token never expires;
            // the user token's 60-day expiry must not be stamped on it.
            if (hasLongLivedUserToken) delete tokenData.expires_in;
          }
        }
      } catch (err) {
        logger.warn('Facebook Business Login for Instagram target discovery error:', err);
      }
    }
  }

  return tokenData;
}

async function exchangeTwitterCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  codeVerifier?: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('twitter');
  const clientId = (cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('twitter', cfg.redirectUri || process.env.VITE_TWITTER_REDIRECT_URI, req);

  if (!clientId) throw new Error('Twitter Client ID is not configured. Set it in Admin → Integrations → X.');
  if (!clientSecret) throw new Error('Twitter Client Secret is not configured. Set it in Admin → Integrations → X.');
  const verifier = String(codeVerifier || '').trim();
  if (!verifier) throw new Error('The X sign-in session is missing its PKCE verifier. Start the connection again.');

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const response = await axios.post(X_OAUTH_TOKEN_URL, body.toString(), {
    auth: { username: clientId, password: clientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`Twitter token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const tokenData: any = response.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get(X_USERS_ME_API, {
        params: { 'user.fields': 'id,name,username,profile_image_url' },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status >= 400) {
        const meErr: any = meResp.data || {};
        if (String(meErr?.reason || '') === 'client-not-enrolled') {
          throw new Error('X app is not attached to a Project or lacks API access. Fix it in the X developer portal, then reconnect X.');
        }
      } else {
        const u: any = meResp.data?.data || {};
        if (u.id) { tokenData.user_id = u.id; tokenData.id = u.id; tokenData.sub = u.id; }
        if (u.username) tokenData.username = u.username;
        tokenData.name = u.name || (u.username ? `@${u.username}` : null);
        if (u.profile_image_url) tokenData.avatar_url = u.profile_image_url;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('X app is not attached to a Project')) {
        throw err;
      }
    }
  }
  return tokenData;
}

async function exchangeLinkedInCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  code: string,
  req?: Request,
) {
  const credentials = await getLinkedInOAuthCredentials(getPlatformConfig, resolveOAuthRedirectUri, req);
  const response = await postLinkedInOAuthForm({ grant_type: 'authorization_code', code }, credentials);
  if (response.status >= 400) {
    const errBody: any = response.data || {};
    const detail = errBody?.error_description || errBody?.error || '';
    throw new Error(`LinkedIn token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return enrichLinkedInTokenData(getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, response.data || {}, req);
}

export async function exchangeFacebookCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  redirectUriOverride?: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('facebook');
  const appId = String(cfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
  const appSecret = String(cfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
  if (!appId || !appSecret) throw new Error('Facebook app credentials are not configured. Set them in Admin → Integrations → Facebook.');
  const redirectUri = resolveOAuthRedirectUri(
    'facebook',
    redirectUriOverride || cfg.redirectUri || process.env.VITE_FACEBOOK_REDIRECT_URI,
    req,
  );
  const response = await axios.get(`${META_GRAPH_BASE}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (response.status >= 400 || !(response.data as any)?.access_token) {
    const detail = (response.data as any)?.error?.message || `HTTP ${response.status}`;
    logger.error('Facebook token exchange failed:', { status: response.status, body: response.data, redirectUri });
    throw new Error(`Facebook token exchange failed: ${detail}`);
  }
  const tokenData: any = response.data || {};

  const shortToken = String(tokenData?.access_token || '').trim();
  if (shortToken && appId && appSecret) {
    try {
      const llResp = await axios.get(`${META_GRAPH_BASE}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        },
        validateStatus: () => true,
        timeout: 15000,
      });
      const llData: any = llResp.data || {};
      if (llResp.status < 400 && llData.access_token) {
        tokenData.short_lived_access_token = shortToken;
        tokenData.access_token = String(llData.access_token).trim();
        tokenData.expires_in = llData.expires_in || 60 * 24 * 3600;
      }
    } catch (err) {
      logger.warn({ err }, 'facebook_long_lived_token_exchange_failed');
    }
  }

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get(`${META_GRAPH_BASE}/me`, {
        params: { fields: 'id,name,picture.width(256).height(256)', access_token: accessToken },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data || {};
        if (meData?.id) tokenData.user_id = String(meData.id);
        if (meData?.id) tokenData.id = String(meData.id);
        if (meData?.name) tokenData.name = String(meData.name);
        if (meData?.picture) tokenData.picture = meData.picture;
        if (meData?.picture?.data?.url) tokenData.avatar_url = String(meData.picture.data.url);
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  return tokenData;
}

async function exchangeThreadsCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('threads');
  const clientId = cfg.appId || process.env.VITE_THREADS_APP_ID || process.env.VITE_THREADS_CLIENT_ID || process.env.VITE_INSTAGRAM_APP_ID || '';
  const clientSecret = cfg.appSecret || process.env.THREADS_APP_SECRET || process.env.VITE_THREADS_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '';
  const redirectUri = resolveOAuthRedirectUri('threads', cfg.redirectUri || process.env.VITE_THREADS_REDIRECT_URI, req);

  if (!clientId || !clientSecret || !redirectUri) throw new Error('Threads credentials not configured');

  const tokenBody = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code });
  const tokenRes = await axios.post('https://graph.threads.net/oauth/access_token', tokenBody.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    validateStatus: () => true,
    timeout: 15000,
  });

  if (tokenRes.status >= 400) {
    const detail = (tokenRes.data as any)?.error?.message || (tokenRes.data as any)?.error_message || '';
    throw new Error(`Threads token exchange failed (${tokenRes.status})${detail ? `: ${detail}` : ''}`);
  }

  const tokenData: any = tokenRes.data || {};
  const shortLived = String(tokenData?.access_token || '').trim();
  if (!shortLived) return tokenData;

  let finalTokenData: any = tokenData;

  try {
    const longRes = await axios.get('https://graph.threads.net/access_token', {
      params: { grant_type: 'th_exchange_token', client_secret: clientSecret, access_token: shortLived },
      headers: { Authorization: `Bearer ${shortLived}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (longRes.status < 400 && (longRes.data as any)?.access_token) {
      finalTokenData = { ...(tokenData || {}), ...(longRes.data || {}), short_lived_access_token: shortLived, access_token: String((longRes.data as any).access_token || '').trim() || shortLived };
    }
  } catch (err) {
    logger.error('Unhandled error:', err);
    finalTokenData = tokenData;
  }

  const accessToken = String(finalTokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://graph.threads.net/v1.0/me', {
        params: { fields: 'id,username,name,is_verified,threads_profile_picture_url,threads_biography', access_token: accessToken },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        const meId = me?.id ? String(me.id).trim() : '';
        if (meId) { finalTokenData.user_id = meId; finalTokenData.id = meId; finalTokenData.sub = meId; }
        if (me?.username) finalTokenData.username = String(me.username);
        if (me?.name) finalTokenData.name = String(me.name);
        if (me?.is_verified !== undefined) finalTokenData.is_verified = Boolean(me.is_verified);
        if (me?.threads_profile_picture_url) finalTokenData.avatar_url = String(me.threads_profile_picture_url);
        if (me?.threads_biography) finalTokenData.about = String(me.threads_biography);
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  return finalTokenData;
}

async function exchangeTikTokCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  codeVerifier?: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('tiktok');
  const clientKey = (cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET || '').trim();
  const redirectUri = resolveOAuthRedirectUri('tiktok', cfg.redirectUri || process.env.VITE_TIKTOK_REDIRECT_URI, req);
  if (!clientKey || !clientSecret) throw new Error('TikTok client credentials are not configured. Set them in Admin → Integrations → TikTok.');

  const data = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  if (codeVerifier) data.set('code_verifier', codeVerifier);
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  // TikTok can report an OAuth error in the body of a 200 response.
  const errBody: any = response.data || {};
  if (response.status >= 400 || errBody?.error || !errBody?.access_token) {
    const detail = errBody?.error_description || errBody?.error || errBody?.message || '';
    throw new Error(`TikTok token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const tokenData: any = response.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  const openId = String(tokenData?.open_id || '').trim();
  if (accessToken) {
    try {
      const userResp = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: { fields: 'open_id,union_id,avatar_url,display_name,username' },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      const u: any = userResp.data?.data?.user || {};
      let finalUser = u;
      if (userResp.status >= 400 || (!u.display_name && !u.open_id)) {
        const fallbackResp = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
          params: { fields: 'open_id,display_name' },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true,
          timeout: 10000,
        });
        finalUser = fallbackResp.data?.data?.user || u;
      }
      if (finalUser.open_id) tokenData.user_id = finalUser.open_id;
      if (finalUser.display_name) tokenData.name = finalUser.display_name;
      if (finalUser.username) tokenData.username = finalUser.username;
      if (finalUser.avatar_url) tokenData.avatar_url = finalUser.avatar_url;
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }
  if (openId && !tokenData.user_id) tokenData.user_id = openId;
  return tokenData;
}

async function exchangeGmailCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('gmail');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const redirectUri = resolveOAuthRedirectUri('gmail', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Gmail client credentials not configured');

  const data = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const resp = await axios.post('https://oauth2.googleapis.com/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) {
    const msg = (resp.data as any)?.error_description || (resp.data as any)?.error || `Gmail token exchange failed (${resp.status})`;
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        if (me?.id) tokenData.user_id = String(me.id);
        if (me?.email) { tokenData.email = String(me.email); tokenData.username = String(me.email); }
        if (me?.name) tokenData.name = String(me.name);
        if (me?.picture) tokenData.avatar_url = String(me.picture);
      }
    } catch (err) {
      logger.error('Gmail userinfo error:', err);
    }
  }

  return tokenData;
}

async function exchangeSlackCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('slack');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const redirectUri = resolveOAuthRedirectUri('slack', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Slack client credentials not configured');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = new URLSearchParams({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const resp = await axios.post('https://slack.com/api/oauth.v2.access', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400 || (resp.data as any)?.ok === false) {
    const msg = (resp.data as any)?.error || `Slack token exchange failed (${resp.status})`;
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const teamId = String(tokenData?.team?.id || '').trim();
  const teamName = String(tokenData?.team?.name || '').trim();
  const userId = String(tokenData?.authed_user?.id || '').trim();
  if (teamId) tokenData.user_id = teamId;
  if (teamName) tokenData.name = teamName;
  if (userId) tokenData.authed_user_id = userId;
  tokenData.username = teamName || teamId;

  return tokenData;
}

async function exchangeZoomCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  code: string,
  req?: Request,
) {
  const cfg = await getPlatformConfig('zoom');
  const clientId = String(cfg.clientId || '').trim();
  const clientSecret = String(cfg.clientSecret || '').trim();
  const redirectUri = resolveOAuthRedirectUri('zoom', cfg.redirectUri, req);
  if (!clientId || !clientSecret) throw new Error('Zoom client credentials not configured');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = new URLSearchParams({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const resp = await axios.post('https://zoom.us/oauth/token', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  if (resp.status >= 400) {
    const msg = (resp.data as any)?.reason || (resp.data as any)?.error || `Zoom token exchange failed (${resp.status})`;
    throw new Error(msg);
  }
  const tokenData: any = resp.data || {};

  const accessToken = String(tokenData?.access_token || '').trim();
  if (accessToken) {
    try {
      const meResp = await axios.get('https://api.zoom.us/v2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status < 400) {
        const me: any = meResp.data || {};
        if (me?.id) tokenData.user_id = String(me.id);
        if (me?.email) { tokenData.email = String(me.email); tokenData.username = String(me.email); }
        const fullName = [String(me?.first_name || ''), String(me?.last_name || '')].filter(Boolean).join(' ').trim();
        if (fullName) tokenData.name = fullName;
        if (me?.pic_url) tokenData.avatar_url = String(me.pic_url);
      }
    } catch (err) {
      logger.error('Zoom userinfo error:', err);
    }
  }

  return tokenData;
}

export async function exchangeOAuthCode(
  getPlatformConfig: SocialConnectDeps['getPlatformConfig'],
  resolveOAuthRedirectUri: SocialConnectDeps['resolveOAuthRedirectUri'],
  parseLinkedInScopeList: SocialConnectDeps['parseLinkedInScopeList'],
  computeIsoFromTtlSeconds: SocialConnectDeps['computeIsoFromTtlSeconds'],
  platformId: string,
  code: string,
  codeVerifier?: string,
  req?: Request,
) {
  switch ((platformId || '').trim().toLowerCase()) {
    case 'instagram':
      return exchangeInstagramCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'twitter':
      return exchangeTwitterCode(getPlatformConfig, resolveOAuthRedirectUri, code, codeVerifier, req);
    case 'linkedin':
      return exchangeLinkedInCode(getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, code, req);
    case 'facebook':
      return exchangeFacebookCode(getPlatformConfig, resolveOAuthRedirectUri, code, undefined, req);
    case 'pinterest':
      return exchangePinterestCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'threads':
      return exchangeThreadsCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'tiktok':
      return exchangeTikTokCode(getPlatformConfig, resolveOAuthRedirectUri, code, codeVerifier, req);
    case 'gmail':
      return exchangeGmailCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'slack':
      return exchangeSlackCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    case 'zoom':
      return exchangeZoomCode(getPlatformConfig, resolveOAuthRedirectUri, code, req);
    default:
      throw new Error('Unsupported platform');
  }
}

// ── Social connection helpers ──────────────────────────────────────────────────

async function seedSocialMemory(
  deps: Pick<SocialConnectDeps, 'dbQuery' | 'getAIConfig' | 'resolveActiveKey' | 'GEMINI_MODELS' | 'callAINonStreaming'>,
  userId: string,
  platform: string,
  profile: { handle: string; accountName: string | null; followers: number; bio?: string },
): Promise<void> {
  const { dbQuery, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming } = deps;
  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
  const handleDisplay = profile.handle && !profile.handle.includes('_account')
    ? `@${profile.handle}` : profile.accountName || platform;

  let content = '';
  try {
    const cfg = await getAIConfig();
    const apiKey = resolveActiveKey(cfg);
    if (apiKey) {
      const fastModel = cfg.provider === 'google'
        ? (GEMINI_MODELS.includes(cfg.model) ? cfg.model : 'gemini-2.0-flash')
        : FAST_MODEL;
      content = await callAINonStreaming(
        cfg.provider, apiKey, fastModel,
        'You write concise memory entries for a marketing AI assistant. Be factual and useful. 2-3 sentences max.',
        `Write a memory entry about this user's newly connected social account:\n\nPlatform: ${platformLabel}\nHandle: ${handleDisplay}\nDisplay name: ${profile.accountName || ''}\nFollowers: ${profile.followers}\n${profile.bio ? `Bio: "${profile.bio}"` : 'No bio available.'}\n\nInclude the platform, handle, audience size, and a note about what this means for their content strategy.`,
        200,
      );
    }
  } catch (_err) { /* fall through to plain text */ }

  if (!content) {
    content = `${platformLabel} account ${handleDisplay}${profile.accountName ? ` (${profile.accountName})` : ''} — ${profile.followers.toLocaleString()} followers.${profile.bio ? ` Bio: "${profile.bio}"` : ''}`;
  }

  try {
    const existing = await dbQuery(
      `SELECT id FROM user_memories WHERE user_id = $1 AND source = $2`,
      [userId, `social:${platform}`],
    );
    if (existing.rows.length > 0) {
      await dbQuery(
        `UPDATE user_memories SET category = 'social', title = $1, content = $2, updated_at = NOW() WHERE id = $3`,
        [`${platformLabel} social account`, content, (existing.rows[0] as any).id],
      );
    } else {
      await dbQuery(
        `INSERT INTO user_memories (id, user_id, category, title, content, source, created_at, updated_at)
         VALUES ($1, $2, 'social', $3, $4, $5, NOW(), NOW())`,
        [randomUUID(), userId, `${platformLabel} social account`, content, `social:${platform}`],
      );
    }
  } catch (err) {
    logger.error('seedSocialMemory DB error:', err);
  }
}

export async function storeUserConnection(deps: SocialConnectDeps, userId: string, platform: string, tokenData: any): Promise<void> {
  const { pool, dbQuery, normalizePlatformId, encryptIntegrationSecret, upsertUserIntegration, logIntegrationEvent, createNotification, checkTaskActions, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming } = deps;
  if (!pool) {
    logger.warn('DATABASE_URL not set; cannot persist social connection');
    return;
  }

  const platformId = normalizePlatformId(platform);
  const accessTokenRaw = String(tokenData?.access_token ?? tokenData?.accessToken ?? '').trim();
  const refreshTokenRaw = String(tokenData?.refresh_token ?? tokenData?.refreshToken ?? '').trim();
  let normalizedTokenData = tokenData && typeof tokenData === 'object' ? { ...tokenData } : {};

  let accountId = String(normalizedTokenData?.user_id || normalizedTokenData?.id || '').trim() || null;
  let accountName = normalizedTokenData?.name ? String(normalizedTokenData.name) : null;
  let profileImage = normalizedTokenData?.avatar_url ? String(normalizedTokenData.avatar_url) : null;

  if (platformId === 'twitter' && accessTokenRaw && (!accountId || !accountName || !profileImage)) {
    try {
      const meResp = await axios.get(X_USERS_ME_API, {
        params: { 'user.fields': 'id,name,username,profile_image_url,description,public_metrics' },
        headers: { Authorization: `Bearer ${accessTokenRaw}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (meResp.status < 400) {
        const meData: any = meResp.data?.data || {};
        accountId = String(meData?.id || accountId || '').trim() || accountId;
        accountName = meData?.name ? String(meData.name) : accountName;
        profileImage = meData?.profile_image_url ? String(meData.profile_image_url) : profileImage;
        normalizedTokenData = {
          ...normalizedTokenData,
          ...(accountId ? { user_id: accountId, id: accountId, sub: accountId } : {}),
          ...(accountName ? { name: accountName } : {}),
          ...(meData?.username ? { username: String(meData.username) } : {}),
          ...(profileImage ? { avatar_url: profileImage } : {}),
          ...(meData?.description ? { bio: String(meData.description) } : {}),
          ...(meData?.public_metrics?.followers_count != null
            ? { followers_count: Number(meData.public_metrics.followers_count) }
            : {}),
        };
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  const handle = normalizedTokenData?.username || accountId || normalizedTokenData?.handle || `${platformId}_account`;
  const followers = Number(normalizedTokenData?.followers || normalizedTokenData?.followers_count || 0);
  const expiresAt =
    (platformId === 'linkedin' && String(normalizedTokenData?.access_token_expires_at || '').trim()) ||
    (normalizedTokenData?.expires_in
      ? new Date(Date.now() + Number(normalizedTokenData.expires_in) * 1000).toISOString()
      : null);
  const tokenExpiresAt = expiresAt;

  const platRow = await dbQuery<{ id: number }>('SELECT id FROM social_platforms WHERE slug=$1', [platformId]).catch(() => ({ rows: [] } as any));
  const platformDbId = platRow?.rows?.[0]?.id ?? null;
  const accessTokenEncrypted = accessTokenRaw ? encryptIntegrationSecret(accessTokenRaw) : null;
  const refreshTokenEncrypted = refreshTokenRaw ? encryptIntegrationSecret(refreshTokenRaw) : null;

  const existingConn = await dbQuery(
    `SELECT id FROM social_accounts WHERE user_id = $1 AND platform = $2 AND account_type = 'profile'`,
    [userId, platformId],
  ).catch(() => ({ rows: [] } as any));
  const isFirstConnect = (existingConn?.rows?.length ?? 0) === 0;

  await dbQuery(
    `
    INSERT INTO social_accounts
      (id, user_id, platform, platform_id, account_type, account_id, account_name, profile_image, handle, followers, connected, connected_at, expires_at, token_expires_at, access_token, refresh_token, access_token_encrypted, refresh_token_encrypted, token_data, needs_reapproval)
    VALUES ($1, $2, $3, $4, 'profile', $5, $6, $7, $8, $9, true, NOW(), $10, $11, $12, $13, $14, $15, $16, false)
    ON CONFLICT (user_id, platform) WHERE account_type = 'profile' DO UPDATE
      SET platform_id = EXCLUDED.platform_id,
          account_id = COALESCE(EXCLUDED.account_id, social_accounts.account_id),
          account_name = COALESCE(EXCLUDED.account_name, social_accounts.account_name),
          profile_image = COALESCE(EXCLUDED.profile_image, social_accounts.profile_image),
          handle = COALESCE(NULLIF(EXCLUDED.handle, ''), social_accounts.handle),
          followers = EXCLUDED.followers,
          connected = true,
          connected_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          token_expires_at = EXCLUDED.token_expires_at,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          access_token_encrypted = EXCLUDED.access_token_encrypted,
          refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          needs_reapproval = false,
          token_data = EXCLUDED.token_data;
  `,
    [randomUUID(), userId, platformId, platformDbId, accountId, accountName, profileImage, String(handle), followers, expiresAt, tokenExpiresAt, null, null, accessTokenEncrypted, refreshTokenEncrypted, sanitizeTokenData(normalizedTokenData, encryptIntegrationSecret)]
  );

  let integrationAccountId = accountId;
  let integrationAccountName = accountName;
  if (platformId === 'facebook' && accessTokenRaw) {
    const syncedPages = await syncFacebookPagesForUser(
      { pool, dbQuery, getPlatformConfig: deps.getPlatformConfig, encryptIntegrationSecret },
      userId,
      accessTokenRaw,
    );
    if (syncedPages.length > 0 && syncedPages[0]?.id && syncedPages[0]?.name) {
      integrationAccountId = syncedPages[0].id;
      integrationAccountName = syncedPages[0].name;
    }
  } else if (platformId === 'instagram' && normalizedTokenData?.login_method === 'facebook' && normalizedTokenData?.user_access_token) {
    await syncFacebookPagesForUser(
      { pool, dbQuery, getPlatformConfig: deps.getPlatformConfig, encryptIntegrationSecret },
      userId,
      String(normalizedTokenData.user_access_token),
    ).catch(() => undefined);
  }

  await upsertUserIntegration({ userId, integrationSlug: platformId, accessTokenEncrypted, refreshTokenEncrypted, tokenExpiry: expiresAt, accountId: integrationAccountId, accountName: integrationAccountName, status: 'connected' });
  await logIntegrationEvent({ userId, integrationSlug: platformId, eventType: 'connection_attempt', status: 'success', response: { platform: platformId, accountId: integrationAccountId, accountName: integrationAccountName } });

  const platformLabel = platformId.charAt(0).toUpperCase() + platformId.slice(1);
  if (isFirstConnect) {
    seedSocialMemory({ dbQuery, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming }, userId, platformId, {
      handle: String(handle),
      accountName: accountName || null,
      followers: Number(normalizedTokenData?.followers_count ?? followers),
      bio: normalizedTokenData?.bio ? String(normalizedTokenData.bio) : undefined,
    }).catch(() => undefined);
    createNotification(userId, 'social_connected', `${platformLabel} connected`, `Your ${platformLabel} account (@${handle}) has been connected successfully.`, { platform: platformId, handle: String(handle) }).catch(() => undefined);
    void checkTaskActions(userId, 'connect_social');
  } else {
    createNotification(userId, 'social_reconnected', `${platformLabel} reconnected`, `Your ${platformLabel} account (@${handle}) token has been refreshed.`, { platform: platformId, handle: String(handle) }).catch(() => undefined);
  }
}

async function removeUserConnection(
  deps: Pick<SocialConnectDeps, 'pool' | 'dbQuery' | 'normalizePlatformId' | 'upsertUserIntegration' | 'logIntegrationEvent' | 'getPlatformConfig' | 'decryptIntegrationSecret'>,
  userId: string,
  platform: string,
): Promise<{ revoked: boolean }> {
  if (!deps.pool) return { revoked: false };
  const platformId = deps.normalizePlatformId(platform);

  // Revoke the grant at the provider (where it offers revocation) before the
  // stored credentials are deleted; a provider outage never blocks disconnect.
  let revoked = false;
  if (platformId && deps.decryptIntegrationSecret) {
    const { rows } = await deps.dbQuery<{ access_token_encrypted: string | null; refresh_token_encrypted: string | null }>(
      `SELECT access_token_encrypted, refresh_token_encrypted FROM social_accounts
       WHERE user_id = $1 AND LOWER(platform) = LOWER($2) AND account_type = 'profile' LIMIT 1`,
      [userId, platformId],
    ).catch(() => ({ rows: [] as Array<{ access_token_encrypted: string | null; refresh_token_encrypted: string | null }> }));
    const decrypt = (value: string | null) => {
      try { return value ? deps.decryptIntegrationSecret!(value) : ''; } catch { return ''; }
    };
    if (rows[0]) {
      const cfg = await deps.getPlatformConfig(platformId).catch(() => ({} as Record<string, string>));
      revoked = await revokeProviderAccess(platformId, {
        accessToken: decrypt(rows[0].access_token_encrypted),
        refreshToken: decrypt(rows[0].refresh_token_encrypted),
      }, cfg);
    }
  }

  await deps.dbQuery('DELETE FROM social_accounts WHERE user_id = $1 AND LOWER(platform) = LOWER($2)', [userId, platform]);

  if (platformId) {
    await deps.upsertUserIntegration({ userId, integrationSlug: platformId, accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiry: null, accountId: null, accountName: null, status: 'disconnected' });
    await deps.logIntegrationEvent({ userId, integrationSlug: platformId, eventType: 'disconnect', status: 'info', response: { providerRevoked: revoked } });
  }
  return { revoked };
}

// A relative in-app path only: "//host" and "/\host" are protocol-relative
// URLs the browser would follow off-site.
export function sanitizeOAuthReturnTo(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 500 || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\r\n\t]/.test(raw)) return null;
  return raw;
}

const OAUTH_STATE_PATTERN = /^[A-Za-z0-9._~-]{16,256}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

// ── Factory ────────────────────────────────────────────────────────────────────

export function registerSocialConnectRoutes(deps: SocialConnectDeps): Router {
  const router = Router();
  const { requireAuth, hasDatabase, pool, dbQuery, getPublishableSocialConnection, encryptIntegrationSecret, upsertUserIntegration, logIntegrationEvent, getUserConnectedAccounts, normalizePlatformId, getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, publishToplatform } = deps;
  const decryptToken = (value: string) => (deps.decryptIntegrationSecret ? deps.decryptIntegrationSecret(value) : '');

  // POST /api/oauth/state
  router.post('/oauth/state', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { state, platform, returnTo, codeVerifier } = req.body as { state?: string; platform?: string; returnTo?: string; codeVerifier?: string };
      const stateValue = typeof state === 'string' ? state.trim() : '';
      const platformId = String(platform || '').trim().toLowerCase();
      if (!stateValue || !platformId) return res.status(400).json({ success: false, error: 'Missing state or platform' });
      if (!OAUTH_STATE_PATTERN.test(stateValue)) return res.status(400).json({ success: false, error: 'Invalid state' });
      if (!OAUTH_AUTH_URLS[platformId]) return res.status(400).json({ success: false, error: 'Unsupported platform' });
      const verifier = typeof codeVerifier === 'string' ? codeVerifier.trim() : '';
      if (verifier && !PKCE_VERIFIER_PATTERN.test(verifier)) return res.status(400).json({ success: false, error: 'Invalid PKCE code verifier' });

      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      // Expired rows are never read again; clear this user's so the table stays small.
      await dbQuery('DELETE FROM oauth_states WHERE user_id = $1 AND expires_at < NOW()', [auth.userId]).catch(() => undefined);
      const inserted = await dbQuery(
        `INSERT INTO oauth_states (state, user_id, platform, return_to, code_verifier, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '15 minutes')
         ON CONFLICT (state) DO NOTHING`,
        [stateValue, auth.userId, platformId, sanitizeOAuthReturnTo(returnTo), verifier || null]
      );
      if (inserted.rowCount === 0) return res.status(409).json({ success: false, error: 'State already in use — start the connection again' });

      return res.json({ success: true });
    } catch (error) {
      logger.error('OAuth state error:', error);
      return res.status(500).json({ success: false, error: 'Failed to store state' });
    }
  });

  // GET /api/user-settings/:key
  router.get('/user-settings/:key', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

      const key = String(req.params.key || '').trim();
      if (!/^[a-z0-9._:-]{1,80}$/i.test(key)) return res.status(400).json({ success: false, error: 'Invalid key' });

      const result = await dbQuery<{ value: any }>('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [auth.userId, key]);
      return res.json({ success: true, value: result.rows[0]?.value ?? null });
    } catch (error) {
      logger.error('Get user setting error:', error);
      return res.status(500).json({ success: false, error: 'Failed to load setting' });
    }
  });

  const saveUserSetting = async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

      const key = String(req.params.key || '').trim();
      if (!/^[a-z0-9._:-]{1,80}$/i.test(key)) return res.status(400).json({ success: false, error: 'Invalid key' });

      const value = (req.body as any)?.value;
      if (typeof value === 'undefined') return res.status(400).json({ success: false, error: 'value is required' });

      await dbQuery(
        `INSERT INTO user_settings (user_id, key, value, created_at, updated_at) VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [auth.userId, key, JSON.stringify(value)],
      );

      return res.json({ success: true });
    } catch (error) {
      logger.error('Save user setting error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save setting' });
    }
  };

  router.put('/user-settings/:key', saveUserSetting);
  router.post('/user-settings/:key', saveUserSetting);

  // POST /api/oauth/callback
  router.post('/oauth/callback', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { platform, code, state } = req.body;

      if (!code || !state) return res.status(400).json({ success: false, error: 'Missing code or state' });

      const platformId = String(platform || '').trim().toLowerCase();
      const stateRow = await getOAuthStateRow(dbQuery, String(state));
      if (!stateRow) return res.status(400).json({ success: false, error: 'Invalid or expired state parameter' });
      if (String(stateRow.user_id) !== auth.userId) return res.status(400).json({ success: false, error: 'State does not match user' });
      if (String(stateRow.platform || '').trim().toLowerCase() !== platformId) return res.status(400).json({ success: false, error: 'State does not match platform' });

      // Claim the state before redeeming the code: a state is single-use, so a
      // replayed or double-submitted callback can't run a second exchange.
      const claimed = await dbQuery(
        'DELETE FROM oauth_states WHERE state = $1 AND user_id = $2 RETURNING state',
        [String(state), auth.userId],
      );
      if (claimed.rowCount === 0) return res.status(409).json({ success: false, error: 'This connection attempt was already completed' });

      const tokenData = await exchangeOAuthCode(getPlatformConfig, resolveOAuthRedirectUri, parseLinkedInScopeList, computeIsoFromTtlSeconds, platformId, String(code), stateRow.code_verifier || undefined, req);
      await storeUserConnection(deps, auth.userId, platformDisplayName(platformId), tokenData);

      // Tokens stay server-side; the browser only learns which account connected.
      return res.json({
        success: true,
        account: toPublicConnectionSummary(platformId, tokenData),
        returnTo: sanitizeOAuthReturnTo(stateRow.return_to),
      });
    } catch (error) {
      logger.error('OAuth callback error:', error);
      return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'OAuth callback failed' });
    }
  });

  // GET /api/accounts
  router.get('/accounts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const accounts = await getUserConnectedAccounts(auth.userId);
      return res.json({ success: true, data: accounts });
    } catch (error) {
      logger.error('Accounts error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch accounts' });
    }
  });

  // GET /api/facebook/targets
  router.get('/facebook/targets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });

      const conn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Facebook access token missing or expired — please reconnect' });

      const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
      const appId = String(fbCfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
      const appSecret = String(fbCfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();

      const discovered = await fetchAccessibleFacebookPages(accessToken, { appId, appSecret });
      if (discovered.pages.length > 0) {
        await syncFacebookPagesForUser(
          { pool, dbQuery, getPlatformConfig, encryptIntegrationSecret },
          auth.userId,
          accessToken,
        );
      }

      const byId = new Map<string, { id: string; name: string; picture: string | null; tasks: string[]; can_publish: boolean; saved?: boolean }>();
      for (const p of discovered.pages) {
        byId.set(p.id, {
          id: p.id,
          name: p.name,
          picture: p.picture,
          tasks: p.tasks,
          can_publish: p.can_publish,
          saved: true,
        });
      }

      try {
        const storedRows = await dbQuery<{ account_id: string; account_name: string; profile_image: string | null }>(
          `SELECT account_id, account_name, profile_image
           FROM social_accounts
           WHERE user_id = $1 AND platform = 'facebook' AND account_type = 'page' AND connected = true
           ORDER BY connected_at DESC NULLS LAST, created_at DESC`,
          [auth.userId],
        );
        for (const row of storedRows.rows) {
          const id = String(row.account_id || '').trim();
          const name = String(row.account_name || '').trim();
          if (!id || !name) continue;
          if (!byId.has(id)) {
            byId.set(id, {
              id,
              name,
              picture: row.profile_image || null,
              tasks: ['CREATE_CONTENT', 'MANAGE'],
              can_publish: true,
              saved: true,
            });
          }
        }
      } catch (_e) {
        // ignore stored rows lookup error
      }

      const pages = Array.from(byId.values());
      const warnings = [...discovered.warnings];

      // Meta retired the Groups API (publish_to_groups) in 2024, so there are
      // no group targets to list; the field stays for client compatibility.
      return res.json({ success: true, pages, groups: [], missingPermissions: discovered.missingPermissions, warnings });
    } catch (error) {
      logger.error('Facebook targets error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch Facebook targets' });
    }
  });

  // GET /api/instagram/targets
  router.get('/instagram/targets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const fbConn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const igConn = await getPublishableSocialConnection(auth.userId, 'instagram');
      const igTokenData = igConn?.token_data && typeof igConn.token_data === 'object' ? igConn.token_data : {};
      const igRawToken = String(igConn?.access_token || '').trim();
      const igIsDirect =
        igTokenData.graph_host === 'graph.instagram.com' ||
        igTokenData.login_method === 'instagram' ||
        (!igTokenData.pageId && igRawToken.startsWith('IG'));

      const accessToken = String(
        fbConn?.access_token ||
        readUserAccessToken(igTokenData, decryptToken) ||
        (!igIsDirect ? igRawToken : '') ||
        ''
      ).trim();

      if (!accessToken) {
        if (igConn && igIsDirect && igConn.account_id) {
          return res.json({
            success: true,
            facebookConnected: false,
            directInstagramConnected: true,
            targets: [
              {
                pageId: 'direct',
                pageName: 'Instagram Direct Login',
                pagePicture: igConn.profile_image || igTokenData.avatar_url || null,
                pageTasks: ['MANAGE', 'CREATE_CONTENT'],
                instagramId: String(igConn.account_id),
                instagramUsername: String(igConn.handle || igTokenData.username || igTokenData.instagramUsername || '').trim() || null,
                instagramName: String(igConn.account_name || igTokenData.name || igTokenData.instagramName || '').trim() || null,
                instagramAccountType: String(igTokenData.account_type || igTokenData.accountType || 'BUSINESS').trim(),
                instagramFollowers: Number(igConn.followers ?? igTokenData.followers_count ?? 0),
                instagramFollowing: null,
                instagramMediaCount: Number(igTokenData.media_count ?? igTokenData.mediaCount ?? 0),
                instagramBio: igTokenData.biography || null,
                instagramProfilePicture: igConn.profile_image || igTokenData.avatar_url || null,
                instagramWebsite: igTokenData.website || null,
                instagramVerified: false,
                canPublish: true,
                canInsights: true,
              },
            ],
            missingPermissions: [],
            warnings: [],
          });
        }

        return res.json({
          success: true,
          facebookConnected: false,
          targets: [],
          missingPermissions: ['facebook_not_connected'],
          warnings: ['Facebook is not connected yet. Connect via Facebook (Business Login for Instagram) or connect your Facebook account with Page permissions to discover linked Instagram professional accounts.'],
        });
      }

      const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
      const igCfg = await getPlatformConfig('instagram').catch(() => ({} as Record<string, string>));
      const appId = String(igCfg.facebookAppId || fbCfg.appId || igCfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
      const appSecret = String(igCfg.facebookAppSecret || fbCfg.appSecret || igCfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();

      const result = await listInstagramPageTargets(accessToken, { appId, appSecret });
      return res.json({
        success: true,
        facebookConnected: true,
        targets: result.targets.map(({ pageAccessToken, ...target }: any) => target),
        missingPermissions: result.missingPermissions,
        warnings: result.warnings,
      });
    } catch (error) {
      logger.error('Instagram targets error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch Instagram targets' });
    }
  });

  // POST /api/instagram/connect
  router.post('/instagram/connect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const { pageId, instagramId, instagramUsername } = req.body as { pageId?: string; instagramId?: string; instagramUsername?: string };
      const pid = String(pageId || '').trim();
      const igId = String(instagramId || '').trim();
      if (!pid || !igId) return res.status(400).json({ success: false, error: 'pageId and instagramId are required' });

      if (pid === 'direct') {
        return res.json({ success: true });
      }

      const fbConn = await getPublishableSocialConnection(auth.userId, 'facebook');
      const igConn = await getPublishableSocialConnection(auth.userId, 'instagram');
      const igTokenData = igConn?.token_data && typeof igConn.token_data === 'object' ? igConn.token_data : {};
      const igRawToken = String(igConn?.access_token || '').trim();
      const igIsDirect =
        igTokenData.graph_host === 'graph.instagram.com' ||
        igTokenData.login_method === 'instagram' ||
        (!igTokenData.pageId && igRawToken.startsWith('IG'));

      const accessToken = String(
        fbConn?.access_token ||
        readUserAccessToken(igTokenData, decryptToken) ||
        (!igIsDirect ? igRawToken : '') ||
        ''
      ).trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Meta access token missing or expired — reconnect via Facebook before linking Instagram' });

      const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
      const igCfg = await getPlatformConfig('instagram').catch(() => ({} as Record<string, string>));
      const appId = String(igCfg.facebookAppId || fbCfg.appId || igCfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
      const appSecret = String(igCfg.facebookAppSecret || fbCfg.appSecret || igCfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();

      const targetResult = await listInstagramPageTargets(accessToken, { appId, appSecret });
      const match = (targetResult.targets || []).find((target: any) => target.pageId === pid);
      if (!match) return res.status(400).json({ success: false, error: 'Selected Facebook Page was not found in your Meta account list' });
      if (!match.instagramId || match.instagramId !== igId) return res.status(400).json({ success: false, error: 'Selected page is not linked to the requested Instagram professional account' });

      const pageToken = String((match as any).pageAccessToken || '').trim();
      if (!pageToken) return res.status(400).json({ success: false, error: 'Facebook Page access token not available for this Instagram account. Save the Page under Facebook first or reconnect Meta.' });

      const profileResult = await fetchInstagramBusinessProfile(igId, pageToken);
      const profile = profileResult.profile || {};
      const displayName = String(profile?.name || profile?.username || instagramUsername || '').trim() || null;
      const handle = String(profile?.username || instagramUsername || '').trim() || null;
      const followers = Number(profile?.followers_count ?? 0);
      const profileImage = typeof profile?.profile_picture_url === 'string' ? profile.profile_picture_url : null;
      // A Page token minted from a long-lived user token never expires; one
      // minted from a short-lived token lapses with it.
      const sourceExpiry = (fbConn?.access_token ? fbConn?.token_expires_at : igConn?.token_expires_at) || null;
      const sourceExpiryMs = sourceExpiry ? new Date(sourceExpiry).getTime() : NaN;
      const pageTokenExpiry = Number.isFinite(sourceExpiryMs) && sourceExpiryMs - Date.now() < 24 * 3600 * 1000 ? sourceExpiry : null;

      const pageTokenEncrypted = encryptIntegrationSecret(pageToken);

      await pool.query(
        `INSERT INTO social_accounts
          (id, user_id, platform, account_type, account_id, account_name, handle, profile_image, followers, connected, connected_at, token_expires_at, access_token, access_token_encrypted, token_data, needs_reapproval, created_at)
         VALUES ($1,$2,'instagram','profile',$3,$4,$5,$6,$7,true,NOW(),$8,$9,$10,$11::jsonb,false,NOW())
         ON CONFLICT (user_id, platform) WHERE account_type = 'profile' DO UPDATE
           SET account_id=EXCLUDED.account_id, account_name=EXCLUDED.account_name, handle=EXCLUDED.handle,
               profile_image=COALESCE(EXCLUDED.profile_image, social_accounts.profile_image),
               followers=CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_accounts.followers END,
               connected=true, connected_at=NOW(),
               token_expires_at=EXCLUDED.token_expires_at, expires_at=NULL,
               access_token=EXCLUDED.access_token, access_token_encrypted=EXCLUDED.access_token_encrypted,
               token_data=EXCLUDED.token_data, needs_reapproval=false`,
        [randomUUID(), auth.userId, igId, displayName, handle, profileImage, followers, pageTokenExpiry, null, pageTokenEncrypted,
          JSON.stringify({
            login_method: 'facebook',
            graph_host: 'graph.facebook.com',
            facebook_user_id: (fbConn?.access_token ? fbConn?.account_id : igTokenData.facebook_user_id) || null,
            user_access_token_enc: encryptIntegrationSecret(accessToken),
            pageId: pid,
            pageName: (match as any).pageName || null,
            pagePicture: (match as any).pagePicture || null,
            pageTasks: (match as any).pageTasks || [],
            instagramUsername: handle,
            instagramName: displayName,
            accountType: profile?.account_type || (match as any).instagramAccountType || null,
            mediaCount: Number(profile?.media_count ?? (match as any).instagramMediaCount ?? 0),
            website: profile?.website || (match as any).instagramWebsite || null,
            biography: profile?.biography || (match as any).instagramBio || null,
            profilePictureUrl: profileImage || (match as any).instagramProfilePicture || null,
            canPublish: Boolean((match as any).canPublish),
            canInsights: Boolean((match as any).canInsights),
          })]
      );

      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'instagram', accessTokenEncrypted: pageTokenEncrypted, refreshTokenEncrypted: null, tokenExpiry: pageTokenExpiry, accountId: igId, accountName: displayName, status: 'connected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'instagram', eventType: 'connection_attempt', status: 'success', response: { pageId: pid, instagramId: igId, instagramUsername: handle, pageName: (match as any).pageName || null } });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Instagram connect error:', error);
      await logIntegrationEvent({ userId: null, integrationSlug: 'instagram', eventType: 'connection_attempt', status: 'failed', response: { error: error instanceof Error ? error.message : 'Unknown error' } });
      return res.status(500).json({ success: false, error: 'Failed to connect Instagram' });
    }
  });

  // GET /api/pinterest/boards
  router.get('/pinterest/boards', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const conn = await getPublishableSocialConnection(auth.userId, 'pinterest');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Pinterest access token missing or expired — please connect Pinterest' });

      const resp = await axios.get('https://api.pinterest.com/v5/boards?page_size=100', {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
        timeout: 15000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400) return res.status(400).json({ success: false, error: data?.message || data?.error || `Pinterest API error ${resp.status}` });
      const boards = Array.isArray(data?.items)
        ? data.items.map((b: any) => ({ id: String(b?.id || '').trim(), name: String(b?.name || '').trim() })).filter((b: any) => b.id)
        : [];

      return res.json({ success: true, boards });
    } catch (error) {
      logger.error('Pinterest boards error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch Pinterest boards' });
    }
  });

  // POST /api/pinterest/boards
  router.post('/pinterest/boards', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const conn = await getPublishableSocialConnection(auth.userId, 'pinterest');
      const accessToken = String(conn?.access_token || '').trim();
      if (!accessToken) return res.status(400).json({ success: false, error: 'Pinterest access token missing or expired — please connect Pinterest' });

      const input = (req.body || {}) as any;
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const description = typeof input?.description === 'string' ? input.description.trim() : '';
      const privacyRaw = typeof input?.privacy === 'string' ? input.privacy.trim().toUpperCase() : '';
      const privacy = privacyRaw === 'SECRET' ? 'SECRET' : 'PUBLIC';

      if (!name) return res.status(400).json({ success: false, error: 'Board name is required' });

      const createBody: any = { name, is_ads_only: false, privacy };
      if (description) createBody.description = description;

      const resp = await axios.post('https://api.pinterest.com/v5/boards', createBody, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: 15000,
      });
      const data: any = resp.data || {};
      if (resp.status >= 400) {
        let msg = data?.message || data?.error || `Pinterest API error ${resp.status}`;
        if (typeof msg === 'string' && msg.includes('boards:write')) msg = 'Pinterest permission missing: boards:write. Reconnect Pinterest in Integrations, then try again.';
        return res.status(400).json({ success: false, error: msg });
      }

      const boardId = String(data?.id || '').trim();
      const boardName = String(data?.name || '').trim() || name;
      if (!boardId) return res.status(500).json({ success: false, error: 'Pinterest returned an invalid board id' });

      return res.json({ success: true, board: { id: boardId, name: boardName } });
    } catch (error) {
      logger.error('Pinterest create board error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create Pinterest board' });
    }
  });

  // POST /api/integrations/mailchimp/connect
  router.post('/integrations/mailchimp/connect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const { apiKey, serverPrefix } = req.body as { apiKey?: string; serverPrefix?: string };
      const key = String(apiKey || '').trim();
      if (!key) return res.status(400).json({ success: false, error: 'apiKey is required' });
      // The prefix becomes part of the API hostname, so only a real datacenter
      // id ("us6") is accepted — anything else could aim the request elsewhere.
      const prefix = resolveMailchimpServerPrefix(key, serverPrefix);
      if (!prefix) return res.status(400).json({ success: false, error: 'Invalid Mailchimp server prefix — use the datacenter at the end of your API key (e.g. us6)' });

      const resp = await axios.get(`https://${prefix}.api.mailchimp.com/3.0/`, {
        auth: { username: 'anystring', password: key },
        validateStatus: () => true,
        timeout: 8000,
      });
      if (resp.status !== 200) return res.status(400).json({ success: false, error: 'Invalid Mailchimp API key or server prefix' });
      const accountName = String((resp.data as any)?.account_name || '').trim() || 'Mailchimp';

      const tokenEncrypted = encryptIntegrationSecret(JSON.stringify({ apiKey: key, serverPrefix: prefix }));
      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'mailchimp', accessTokenEncrypted: tokenEncrypted, refreshTokenEncrypted: null, tokenExpiry: null, accountId: prefix, accountName, status: 'connected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'mailchimp', eventType: 'connection_attempt', status: 'success', response: { serverPrefix: prefix } });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Mailchimp connect error:', error);
      await logIntegrationEvent({ userId: null, integrationSlug: 'mailchimp', eventType: 'connection_attempt', status: 'failed', response: { error: error instanceof Error ? error.message : 'Connect failed' } });
      return res.status(500).json({ success: false, error: 'Failed to connect Mailchimp' });
    }
  });

  // DELETE /api/integrations/mailchimp/disconnect
  router.delete('/integrations/mailchimp/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ success: true });

      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'mailchimp', accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiry: null, accountId: null, accountName: null, status: 'disconnected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'mailchimp', eventType: 'disconnect', status: 'info', response: {} });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Mailchimp disconnect error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect Mailchimp' });
    }
  });

  // POST /api/integrations/whatsapp/connect — manual WhatsApp Business Cloud API connection
  router.post('/integrations/whatsapp/connect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const { phoneNumberId, accessToken, displayName } = req.body as { phoneNumberId?: string; accessToken?: string; displayName?: string };
      const pid = String(phoneNumberId || '').trim();
      const tok = String(accessToken || '').trim();
      if (!pid || !tok) return res.status(400).json({ success: false, error: 'phoneNumberId and accessToken are required' });
      if (!/^\d{5,30}$/.test(pid)) return res.status(400).json({ success: false, error: 'phoneNumberId must be the numeric Phone Number ID from WhatsApp Manager' });

      const verifyResp = await axios.get(`${META_GRAPH_BASE}/${pid}?fields=id,display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${tok}` },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (verifyResp.status >= 400) {
        const msg = (verifyResp.data as any)?.error?.message || `WhatsApp API error (${verifyResp.status}). Check phone number ID and access token.`;
        return res.status(400).json({ success: false, error: msg });
      }
      const waData: any = verifyResp.data || {};
      const verifiedName = String(waData?.verified_name || displayName || 'WhatsApp Business').trim();
      const phoneDisplay = String(waData?.display_phone_number || pid).trim();

      const tokenEncrypted = encryptIntegrationSecret(JSON.stringify({ phoneNumberId: pid, accessToken: tok }));
      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'whatsapp', accessTokenEncrypted: tokenEncrypted, refreshTokenEncrypted: null, tokenExpiry: null, accountId: pid, accountName: `${verifiedName} (${phoneDisplay})`, status: 'connected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'whatsapp', eventType: 'connection_attempt', status: 'success', response: { phoneNumberId: pid, verifiedName } });

      return res.json({ success: true, accountName: `${verifiedName} (${phoneDisplay})` });
    } catch (error) {
      logger.error('WhatsApp connect error:', error);
      await logIntegrationEvent({ userId: null, integrationSlug: 'whatsapp', eventType: 'connection_attempt', status: 'failed', response: { error: error instanceof Error ? error.message : 'Connect failed' } });
      return res.status(500).json({ success: false, error: 'Failed to connect WhatsApp' });
    }
  });

  // DELETE /api/integrations/whatsapp/disconnect
  router.delete('/integrations/whatsapp/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json({ success: true });

      await upsertUserIntegration({ userId: auth.userId, integrationSlug: 'whatsapp', accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiry: null, accountId: null, accountName: null, status: 'disconnected' });
      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'whatsapp', eventType: 'disconnect', status: 'info', response: {} });

      return res.json({ success: true });
    } catch (error) {
      logger.error('WhatsApp disconnect error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect WhatsApp' });
    }
  });

  // DELETE /api/accounts/:platform
  router.delete('/accounts/:platform', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { revoked } = await removeUserConnection(
        { pool, dbQuery, normalizePlatformId, upsertUserIntegration, logIntegrationEvent, getPlatformConfig, decryptIntegrationSecret: deps.decryptIntegrationSecret },
        auth.userId,
        req.params.platform,
      );
      return res.json({ success: true, providerRevoked: revoked });
    } catch (error) {
      logger.error('Disconnect error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect' });
    }
  });

  // GET /api/accounts/:platform/test — live check that the stored credentials
  // still work, using each provider's cheapest identity endpoint.
  router.get('/accounts/:platform/test', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const platformId = normalizePlatformId(req.params.platform);

      const conn = await getPublishableSocialConnection(auth.userId, platformId);
      if (!conn) return res.status(404).json({ success: false, error: `${platformDisplayName(platformId)} is not connected` });
      if (conn.needs_reapproval || !conn.access_token) {
        return res.json({ success: true, data: { platform: platformId, status: 'reconnect_required', message: 'Access has expired or was revoked. Reconnect this account.' } });
      }

      const result = await probeConnectionIdentity(platformId, conn);
      if (result.status === 'unauthorized' && deps.markSocialAccountNeedsReapproval) {
        await deps.markSocialAccountNeedsReapproval({ platformId, userId: auth.userId, reason: 'token_inactive' }).catch(() => undefined);
      }
      return res.json({
        success: true,
        data: {
          platform: platformId,
          status: result.status === 'ok' ? 'ok' : result.status === 'unauthorized' ? 'reconnect_required' : 'error',
          message: result.message,
          tokenExpiresAt: conn.token_expires_at || null,
        },
      });
    } catch (error) {
      logger.error('Test connection error:', error);
      return res.status(500).json({ success: false, error: 'Connection test failed' });
    }
  });

  // POST /api/posts/:platform/publish
  router.post('/posts/:platform/publish', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { platform } = req.params;
      const { text, media, hashtags } = req.body;
      const platformId = normalizePlatformId(platform);
      const fakePost = { id: randomUUID(), title: text || '', content: text || '', excerpt: text || '', tag_names: hashtags || [] };
      const result = await publishToplatform(auth.userId, fakePost, platformId);
      return res.json({ success: true, data: { postId: result.platformPostId || 'unknown', platform, status: result.status, error: result.error } });
    } catch (error) {
      logger.error('Publish error:', error);
      return res.status(500).json({ success: false, error: 'Failed to publish post' });
    }
  });

  // GET /api/analytics/:platform (deprecated 410 stub)
  router.get('/analytics/:platform', (_req: Request, res: Response) => {
    return res.status(410).json({ success: false, error: 'Use /api/analytics/social/accounts or /api/blog/analytics/dashboard' });
  });

  return router;
}
