import { randomUUID } from 'node:crypto';
import axios from 'axios';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import type { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { FacebookPagesPlatform } from '../../backend/platforms/facebook_pages.ts';
import { InstagramBusinessPlatform } from '../../backend/platforms/instagram_business.ts';
import { LinkedInPlatform } from '../../backend/platforms/linkedin.ts';
import { TwitterXPlatform } from '../../backend/platforms/twitter_x.ts';
import type { PostObject } from '../../backend/platforms/types.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { decodeHtmlEntities } from '../link-metadata.ts';
import { hasDatabase } from '../db.ts';
import { encryptIntegrationSecret, upsertUserIntegration } from '../integration-helpers.ts';
import { formatSocialAccountLabel, getVisibleUserPlatformSlugs, isInstagramDirectLogin, resolveInstagramGraphBase, resolveOAuthRedirectUri } from '../platform-helpers.ts';
import { getLinkedInScopeSet, parseLinkedInScopeList, computeIsoFromTtlSeconds } from '../social-helpers.ts';
import { META_GRAPH_BASE } from '../meta-graph.ts';
import { sanitizeTokenData, TOKEN_DATA_SECRET_KEYS } from '../token-data.ts';
import { getRefreshMarginMs, getRefreshMode, isSoftReapprovalReason, PUBLISHING_TOKEN_PLATFORMS } from '../social-token-policy.ts';
import { getLinkedInOAuthCredentials as credentialsImpl, postLinkedInOAuthForm, enrichLinkedInTokenData as enrichImpl } from './socialConnectRoutes.ts';
import type { MediaModule } from './mediaRoutes.ts';
import {
  getLinkedInRestHeaders,
  parseLinkedInOrganizationId as _parseLinkedInOrganizationId,
  fetchLinkedInOrganizationsByIds,
  fetchLinkedInOrganizationNetworkSize,
  fetchLinkedInPostsByAuthor,
  fetchLinkedInSocialMetadataBatch,
  sumLinkedInReactionCounts,
  fetchLinkedInShareStatisticsForPosts,
  listLinkedInAdminOrganizations,
  resolveLinkedInProfileIdentity,
  extractLinkedInOrganizationDescription,
  extractLinkedInPostText,
  extractLinkedInPostMediaType,
} from './distribution/linkedinHelpers.ts';

const SOCIAL_TOKEN_SAFETY_MARGIN_DAYS = config.socialTokenSafetyMarginDays;
const TWITTER_MONTHLY_WRITE_LIMIT = config.twitterMonthlyWriteLimit;
const X_OAUTH_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const SOCIAL_AUTOMATION_MAX_ATTEMPTS = 3;
const SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS = 30_000;
const SOCIAL_AUTOMATION_QUEUE_NAME = 'social-publish';
let socialAutomationQueue: Queue | null = null;
let socialAutomationWorker: Worker | null = null;
let socialAutomationRedis: IORedis | null = null;

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface DistributionDeps {
  ensureMediaRecordForSource: MediaModule['ensureMediaRecordForSource'];
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>;
  decryptIntegrationSecret: (encrypted: string) => string;
  getIntegrationRowBySlug: (slug: string) => Promise<{ id: number; slug: string; name: string | null; type: string | null } | null>;
  logIntegrationEvent: (params: { userId: string | null; integrationSlug: string | null; eventType: string; status: 'success' | 'failed' | 'info'; response?: any }) => Promise<void>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getWordPressConnection: (userId: string) => Promise<any>;
  decryptWordPressPassword: (encrypted: string) => string;
  wpRequest: (siteUrl: string, username: string, password: string, method: string, path: string, opts?: any) => Promise<any>;
}

export type PublishableSocialConnection = {
  platform: string;
  access_token: string;
  refresh_token?: string | null;
  token_data: any;
  account_id?: string | null;
  account_name?: string | null;
  needs_reapproval?: boolean;
  token_expires_at?: string | null;
};

// ─── Platform instances (singletons) ─────────────────────────────────────────

const facebookPagesPlatform = new FacebookPagesPlatform();
const instagramBusinessPlatform = new InstagramBusinessPlatform();
const linkedInPlatform = new LinkedInPlatform();
const twitterXPlatform = new TwitterXPlatform();

const REDIS_URL = config.redisUrl;
function isBullMqEnabled() {
  return Boolean(REDIS_URL && REDIS_URL.trim());
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface DistributionModule {
  queueSocialAutomationForPublishedPost: (userId: string, post: any) => Promise<void>;
  publishToplatform: (userId: string, post: any, platformId: string, options?: any) => Promise<any>;
  router: Router;
  getPublishableSocialConnection: (userId: string, platformId: string, options?: { refreshWithinMs?: number }) => Promise<PublishableSocialConnection | null>;
  markSocialAccountNeedsReapproval: (params: { platformId: string; accountId?: string | null; userId?: string | null; reason?: string; disconnect?: boolean }) => Promise<void>;
  listLinkedInAdminOrganizations: (accessToken: string, personId: string, options?: { allowedRoles?: string[] }) => Promise<{ organizations: Array<{ id: string; name: string; picture_url?: string | null; roles?: string[] }>; warning: string | null }>;
  fetchLinkedInOrganizationNetworkSize: (accessToken: string, organizationUrn: string) => Promise<number | null>;
  refreshLinkedInAccessToken: (refreshToken: string, req?: Request) => Promise<any>;
  fetchLinkedInSocialMetadataBatch: (accessToken: string, entityUrns: string[]) => Promise<Record<string, any>>;
  fetchLinkedInShareStatisticsForPosts: (accessToken: string, authorUrn: string, postIds: string[]) => Promise<Map<string, any>>;
  sumLinkedInReactionCounts: (metadata: any) => number;
  startSocialAutomationProcessor: () => void;
  startTokenHealthMonitor: () => void;
  normalizePlatformId: (value: string) => string;
  getSocialTemplateDefaults: (platformId: string) => any;
  mergeSocialTemplateSettings: (platformId: string, input: any) => any;
  renderSocialTemplatePreview: (userId: string, post: any, settings: any) => Promise<any>;
  loadSocialTemplateSettings: (userId: string, platformId: string) => Promise<any>;
  enqueueSocialAutomationTask: (params: any) => Promise<void>;
  syncSocialAutomationForPost: (userId: string, postId: string) => Promise<void>;
}

export function buildDistributionModule(deps: DistributionDeps): DistributionModule {
  const {
    requireAuth, pool, dbQuery, ensureMediaRecordForSource,
    decryptIntegrationSecret, getIntegrationRowBySlug, logIntegrationEvent,
    getPlatformConfig, getWordPressConnection, decryptWordPressPassword, wpRequest,
  } = deps;
  const router = Router();
  const getLinkedInOAuthCredentials = (req?: Request) => credentialsImpl(getPlatformConfig,resolveOAuthRedirectUri,req);
  const enrichLinkedInTokenData = (data: unknown,req?: Request) => enrichImpl(getPlatformConfig,resolveOAuthRedirectUri,parseLinkedInScopeList,computeIsoFromTtlSeconds,data,req);
  const getMediaServerBase = () => (process.env.BACKEND_PUBLIC_URL || config.appUrl).replace(/\/$/,'');
  const buildMediaServeUrl = (id: string,name: string) => `${getMediaServerBase()}/media/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
  const getSocialAutomationMaxAttempts = (platform?: string) => normalizePlatformId(platform || '') === 'twitter' ? 6 : SOCIAL_AUTOMATION_MAX_ATTEMPTS;
  const getRetryDelayMs = (attempt: number,platform?: string) => (normalizePlatformId(platform || '') === 'twitter' ? 60_000 : SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS) * 2 ** Math.max(0,attempt-1);



function normalizePlatformId(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter / x' || raw === 'twitter/x' || raw === 'x') return 'twitter';
  if (raw === 'twitter') return 'twitter';
  if (raw === 'linkedin') return 'linkedin';
  if (raw === 'facebook') return 'facebook';
  if (raw === 'instagram') return 'instagram';
  if (raw === 'pinterest') return 'pinterest';
  if (raw === 'tiktok') return 'tiktok';
  if (raw === 'threads') return 'threads';
  if (raw === 'wordpress') return 'wordpress';
  return raw;
}

function toHashtags(tags: unknown): string {
  const list = Array.isArray(tags) ? tags : [];
  const tagsText = list
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .map((t) => `#${t.replace(/\s+/g, '').replace(/^#/, '')}`);
  return tagsText.join(' ');
}

function buildPostUrl(post: Record<string, any>): string {
  const base = (process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyx.com').replace(/\/$/, '');
  const slug = String(post.slug || '').trim();
  if (!slug) return base;
  return `${base}/blog/${encodeURIComponent(slug)}`;
}

type SocialTemplateContentSource = 'EXCERPT' | 'CONTENT';
type SocialTemplateFacebookContentType = 'STATUS' | 'LINK' | 'STATUS_PLUS_LINK';

type SocialTemplateSettings = {
  platform: string;
  content_source: SocialTemplateContentSource;
  template_string: string;
  status_limit: number;
  max_status_limit: number;
  share_limit_per_post: number;
  add_categories_as_tags: boolean;
  remove_css: boolean;
  show_thumbnail: boolean;
  add_image_link: boolean;
  content_type: SocialTemplateFacebookContentType | null;
  enabled: boolean;
};

const SOCIAL_TEMPLATE_DEFAULTS: Record<string, SocialTemplateSettings> = {
  facebook: {
    platform: 'facebook',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{url}\n\n{tags}',
    status_limit: 5000,
    max_status_limit: 63206,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: false,
    show_thumbnail: false,
    add_image_link: false,
    content_type: 'STATUS_PLUS_LINK',
    enabled: true,
  },
  twitter: {
    platform: 'twitter',
    content_source: 'EXCERPT',
    template_string: '{title} {url} {tags}',
    status_limit: 280,
    max_status_limit: 280,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: false,
    show_thumbnail: true,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  instagram: {
    platform: 'instagram',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{tags}',
    status_limit: 2200,
    max_status_limit: 2200,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  linkedin: {
    platform: 'linkedin',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{url}\n\n{tags}',
    status_limit: 3000,
    max_status_limit: 3000,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: false,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  pinterest: {
    platform: 'pinterest',
    content_source: 'EXCERPT',
    template_string: '{title}: {url} {tags}',
    status_limit: 500,
    max_status_limit: 500,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: true,
    content_type: null,
    enabled: true,
  },
  threads: {
    platform: 'threads',
    content_source: 'EXCERPT',
    template_string: '{title} {url} {tags}',
    status_limit: 500,
    max_status_limit: 500,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  tiktok: {
    platform: 'tiktok',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{tags}',
    status_limit: 2200,
    max_status_limit: 2200,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
  wordpress: {
    platform: 'wordpress',
    content_source: 'EXCERPT',
    template_string: '{title}\n\n{content}\n\n{url}',
    status_limit: 5000,
    max_status_limit: 10000,
    share_limit_per_post: 0,
    add_categories_as_tags: false,
    remove_css: true,
    show_thumbnail: false,
    add_image_link: false,
    content_type: null,
    enabled: true,
  },
};

function getSocialTemplateDefaults(platformId: string): SocialTemplateSettings | null {
  const normalized = normalizePlatformId(platformId);
  const defaults = SOCIAL_TEMPLATE_DEFAULTS[normalized];
  if (!defaults) return null;
  return { ...defaults };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseFacebookContentType(
  value: unknown
): SocialTemplateFacebookContentType | null {
  const candidate = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (
    candidate === 'STATUS' ||
    candidate === 'LINK' ||
    candidate === 'STATUS_PLUS_LINK'
  ) {
    return candidate as SocialTemplateFacebookContentType;
  }
  return null;
}

function mergeSocialTemplateSettings(platformId: string, input: any): SocialTemplateSettings {
  const defaults = getSocialTemplateDefaults(platformId);
  if (!defaults) {
    throw new Error(`Unsupported platform: ${platformId}`);
  }

  const content_source: SocialTemplateContentSource =
    input?.content_source === 'CONTENT' ? 'CONTENT' : 'EXCERPT';
  const template_string =
    typeof input?.template_string === 'string'
      ? String(input.template_string)
      : defaults.template_string;

  const status_limit = clampInt(
    input?.status_limit,
    defaults.status_limit,
    1,
    defaults.max_status_limit
  );

  const share_limit_per_post = clampInt(
    input?.share_limit_per_post,
    defaults.share_limit_per_post,
    0,
    1_000_000
  );

  const add_categories_as_tags =
    typeof input?.add_categories_as_tags === 'boolean'
      ? input.add_categories_as_tags
      : defaults.add_categories_as_tags;

  const remove_css =
    typeof input?.remove_css === 'boolean' ? input.remove_css : defaults.remove_css;

  const show_thumbnail =
    typeof input?.show_thumbnail === 'boolean'
      ? input.show_thumbnail
      : defaults.show_thumbnail;

  const add_image_link =
    typeof input?.add_image_link === 'boolean'
      ? input.add_image_link
      : defaults.add_image_link;

  const enabled =
    typeof input?.enabled === 'boolean' ? input.enabled : defaults.enabled;

  const content_type =
    platformId === 'facebook'
      ? parseFacebookContentType(input?.content_type) ?? defaults.content_type
      : null;

  return {
    platform: defaults.platform,
    content_source,
    template_string,
    status_limit,
    max_status_limit: defaults.max_status_limit,
    share_limit_per_post,
    add_categories_as_tags,
    remove_css,
    show_thumbnail,
    add_image_link,
    content_type,
    enabled,
  };
}

async function loadSocialTemplateSettings(userId: string, platformId: string): Promise<SocialTemplateSettings | null> {
  if (!pool) return null;
  const defaults = getSocialTemplateDefaults(platformId);
  if (!defaults) return null;

  const { rows } = await pool.query(
    `SELECT content_source, template_string, status_limit, max_status_limit, share_limit_per_post,
            add_categories_as_tags, remove_css, show_thumbnail, add_image_link, content_type, enabled
     FROM social_template_settings
     WHERE user_id=$1 AND platform=$2
     LIMIT 1`,
    [userId, defaults.platform]
  );

  if (!rows.length) return defaults;
  return mergeSocialTemplateSettings(platformId, rows[0]);
}

function stripHtmlContent(html: string) {
  if (!html) return '';
  const stripped = String(html)
    // Remove script/style blocks entirely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Replace tags with spaces so words don't glue together
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return decodeHtmlEntities(stripped);
}

function safeTruncateToLimit(text: string, limit: number): { text: string; truncated: boolean; originalLength: number } {
  const original = String(text || '');
  const originalLength = original.length;
  const max = Math.max(0, Math.floor(limit));

  if (originalLength <= max) return { text: original, truncated: false, originalLength };
  if (max === 0) return { text: '', truncated: true, originalLength };
  if (max <= 3) {
    let slice = original.slice(0, max);
    const last = slice.charCodeAt(slice.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) slice = slice.slice(0, -1);
    return { text: slice, truncated: true, originalLength };
  }

  let slice = original.slice(0, max - 3);
  const last = slice.charCodeAt(slice.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) slice = slice.slice(0, -1);
  return { text: `${slice}...`, truncated: true, originalLength };
}

async function resolveBlogPostFeaturedImageUrl(userId: string, post: Record<string, any>): Promise<string> {
  const postId = String(post?.id || '').trim();
  const rawSocialImage = String(post?.social_image || '').trim();
  const rawFeaturedImage = String(post?.featured_image || '').trim();
  const chosen = rawSocialImage || rawFeaturedImage;
  if (!chosen) return '';

  if (chosen.startsWith('data:image/')) {
    if (!hasDatabase() || !postId) return chosen;
    const sourceField = rawSocialImage ? 'social_image' : 'featured_image';
    const fileName = sourceField === 'social_image' ? `post-social-${postId}.jpg` : `post-featured-${postId}.jpg`;
    const tags = sourceField === 'social_image' ? ['post', 'social'] : ['post', 'featured'];
    try {
      const ensured = await ensureMediaRecordForSource({
        userId,
        sourceTable: 'blog_posts',
        sourceId: postId,
        sourceField,
        url: chosen,
        fileName,
        tags,
        category: 'user',
      });
      if (!ensured?.row) return chosen;
      return buildMediaServeUrl(ensured.row.id, ensured.row.file_name);
    } catch (err) {
      logger.error('Failed to resolve blog post featured image URL:', err);
      return chosen;
    }
  }

  if (/^https?:\/\//i.test(chosen)) return chosen;
  const base = getMediaServerBase();
  return `${base}${chosen.startsWith('/') ? '' : '/'}${chosen}`;
}

async function renderSocialTemplatePreview(userId: string, post: Record<string, any>, settings: SocialTemplateSettings) {
  const title = String(post?.title || '').trim();
  const url = buildPostUrl(post || {});
  const featuredImage = await resolveBlogPostFeaturedImageUrl(userId, post);

  let contentText = '';
  if (settings.content_source === 'CONTENT') {
    contentText = String(post?.content || '');
  } else {
    contentText = String(post?.excerpt || '');
    if (!contentText && post?.content) {
      contentText = String(post.content).slice(0, 160);
    }
  }

  const cleanContent = settings.remove_css ? stripHtmlContent(contentText) : contentText;

  const tagsList: string[] = [];
  if (settings.add_categories_as_tags) {
    const category = String(post?.category_name || '').trim();
    if (category) tagsList.push(category);
    if (Array.isArray(post?.tag_names)) tagsList.push(...post.tag_names.map((t: any) => String(t || '').trim()).filter(Boolean));
  }
  const tags = settings.add_categories_as_tags ? toHashtags(tagsList) : '';

  const raw = String(settings.template_string || '')
    .replace(/{title}/g, title)
    .replace(/{content}/g, cleanContent)
    .replace(/{url}/g, url)
    .replace(/{featured_image}/g, featuredImage)
    .replace(/{tags}/g, tags)
    .trim();

  const truncated = safeTruncateToLimit(raw, settings.status_limit);
  const warning = truncated.truncated ? `Exceeded ${settings.status_limit} characters; preview truncated.` : null;

  return {
    rendered: truncated.text,
    characterCount: truncated.text.length,
    originalCharacterCount: truncated.originalLength,
    limit: settings.status_limit,
    featuredImage,
    warning,
    truncated: truncated.truncated,
  };
}

const PLATFORM_RATE_LIMITS: Record<string, { max: number; perMs: number }> = {
  facebook: { max: 5, perMs: 1000 },
  instagram: { max: 2, perMs: 1000 },
  linkedin: { max: 1, perMs: 1000 },
  twitter: { max: 2, perMs: 1000 },
};

const platformRateHistory = new Map<string, number[]>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquirePlatformSlot(platformId: string) {
  const rule = PLATFORM_RATE_LIMITS[platformId];
  if (!rule) return;
  const now = Date.now();
  const history = platformRateHistory.get(platformId) || [];
  const cutoff = now - rule.perMs;
  const fresh = history.filter((t) => t > cutoff);
  if (fresh.length >= rule.max) {
    const wait = rule.perMs - (now - fresh[0]);
    await sleep(wait);
    return acquirePlatformSlot(platformId);
  }
  fresh.push(now);
  platformRateHistory.set(platformId, fresh);
}
function getMonthlyWindowUtc(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

async function incrementPlatformMonthlyCounter(platformId: string, limit: number) {
  if (!pool || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, remaining: null, counter: null };
  }
  const { start, end } = getMonthlyWindowUtc();
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  // One atomic statement: BEGIN/COMMIT issued through the pool can run on
  // different connections, leaving a transaction open on a pooled client that
  // unrelated queries then join.
  try {
    const { rows } = await pool.query(
      `INSERT INTO platform_rate_counters (platform, period_start, period_end, counter, updated_at)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (platform, period_start, period_end)
       DO UPDATE SET counter = platform_rate_counters.counter + 1, updated_at = NOW()
       WHERE platform_rate_counters.counter < $4
       RETURNING counter`,
      [platformId, startDate, endDate, limit]
    );
    if (!rows.length) return { allowed: false, remaining: 0, counter: limit };
    const counter = Number(rows[0].counter);
    return { allowed: true, remaining: Math.max(0, limit - counter), counter };
  } catch (err) {
    logger.error({ err, platformId }, 'platform_rate_counter_failed');
    return { allowed: true, remaining: null, counter: null };
  }
}

async function markSocialAccountNeedsReapproval(params: {
  platformId: string;
  accountId?: string | null;
  userId?: string | null;
  reason?: string;
  disconnect?: boolean;
}) {
  if (!pool) return;
  const { platformId, accountId, userId, reason, disconnect } = params;
  const meta = {
    needs_reapproval_at: new Date().toISOString(),
    reason: reason || 'needs_reapproval',
  };

  const values: any[] = [];
  const pushValue = (value: any) => {
    values.push(value);
    return `$${values.length}`;
  };

  const platformRef = pushValue(platformId);
  const metaRef = pushValue(JSON.stringify(meta));
  const updates: string[] = [
    "needs_reapproval = true",
    `token_data = COALESCE(token_data, '{}'::jsonb) || ${metaRef}::jsonb`,
  ];
  // A deauthorized grant's tokens are dead; don't keep them around.
  if (disconnect) updates.push('connected = false', 'access_token = NULL', 'refresh_token = NULL', 'access_token_encrypted = NULL', 'refresh_token_encrypted = NULL');

  const whereClauses: string[] = [`LOWER(platform)=LOWER(${platformRef})`];
  if (accountId) whereClauses.push(`account_id = ${pushValue(accountId)}`);
  // Without an account id this is about the user's own login token: Facebook
  // Page rows hold separate Page tokens that keep working, so leave them be.
  else whereClauses.push(`(account_type = 'profile' OR account_type IS NULL)`);
  if (userId) whereClauses.push(`user_id = ${pushValue(userId)}`);

  const { rows } = await pool.query(
    `UPDATE social_accounts
     SET ${updates.join(', ')}
     WHERE ${whereClauses.join(' AND ')}
     RETURNING user_id`,
    values
  );

  for (const row of rows) {
    const uid = String(row.user_id || '').trim();
    if (!uid) continue;
    await pool
      .query(
        `UPDATE user_integrations ui
         SET status='needs_reapproval'
         FROM integrations i
         WHERE ui.user_id=$1 AND ui.integration_id=i.id AND i.slug=$2`,
        [uid, platformId]
      )
      .catch(() => undefined);

    await logIntegrationEvent({
      userId: uid,
      integrationSlug: platformId,
      eventType: disconnect ? 'deauthorized' : 'token_attention',
      status: 'info',
      response: { reason: meta.reason },
    });
  }
}

async function resolveLinkedInAuthorUrn(params: { userId: string; accessToken: string }) {
  if (!pool) return null;
  // Primary: /v2/me (r_liteprofile — standard "Share on LinkedIn" scope)
  const meResp = await axios.get('https://api.linkedin.com/v2/me', {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    validateStatus: () => true,
    timeout: 15000,
  });
  let meId = '';
  if (meResp.status < 400) {
    meId = String((meResp.data as any)?.id || '').trim();
  }
  if (!meId) {
    // Fallback: /v2/userinfo (OpenID Connect, for apps with openid/profile scopes)
    const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (userinfoResp.status >= 400) return null;
    meId = String((userinfoResp.data as any)?.sub || '').trim();
  }
  if (!meId) return null;

  try {
    await pool.query(
      `UPDATE social_accounts
       SET token_data = COALESCE(token_data, '{}'::jsonb) || $3::jsonb
       WHERE user_id = $1 AND LOWER(platform) = LOWER($2)`,
      [params.userId, 'linkedin', JSON.stringify({ sub: meId })]
    );
  } catch (err) {
    logger.error('Unhandled error:', err);
    // ignore persistence errors
  }
  return `urn:li:person:${meId}`;
}

const TOKEN_HEALTH_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Renews every token the server can renew before it would lapse ahead of the
// next scan, and flags only the tokens that genuinely need the user. The old
// scan flagged anything expiring within the safety window — which, for X
// (2 h tokens) and TikTok (24 h), was every account on every run — and a
// flagged, expired account was then never refreshed again. Gmail and Google
// Calendar renew their own tokens and are left out.
async function runTokenHealthScan(): Promise<{ refreshed: number; flagged: number }> {
  if (!pool) return { refreshed: 0, flagged: 0 };
  const now = Date.now();
  const horizon = new Date(now + Math.max(1, SOCIAL_TOKEN_SAFETY_MARGIN_DAYS) * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await pool.query(
    `SELECT user_id, platform, account_id, token_data, needs_reapproval,
            COALESCE(token_expires_at, expires_at) AS expires_at,
            (COALESCE(refresh_token_encrypted, '') <> '' OR COALESCE(refresh_token, '') <> '') AS has_refresh
     FROM social_accounts
     WHERE connected = true
       AND LOWER(platform) = ANY($1::text[])
       AND (account_type = 'profile' OR account_type IS NULL)
       AND COALESCE(token_expires_at, expires_at) IS NOT NULL
       AND COALESCE(token_expires_at, expires_at) <= $2`,
    [Array.from(PUBLISHING_TOKEN_PLATFORMS), horizon]
  ).catch(() => ({ rows: [] as any[] }));

  let refreshed = 0;
  let flagged = 0;
  for (const row of rows as any[]) {
    const platformId = normalizePlatformId(String(row.platform));
    const userId = String(row.user_id || '');
    const tokenData = row.token_data && typeof row.token_data === 'object' ? row.token_data : {};
    let hasFbAppCredentials = Boolean(process.env.VITE_FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
    if (platformId === 'instagram' && !hasFbAppCredentials) {
      const igCfg = await getPlatformConfig('instagram').catch(() => ({} as Record<string, string>));
      const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
      hasFbAppCredentials = Boolean((igCfg.appId || fbCfg.appId) && (igCfg.appSecret || fbCfg.appSecret));
    }
    const mode = getRefreshMode(platformId, {
      hasRefreshToken: Boolean(row.has_refresh),
      isInstagramDirect: platformId === 'instagram' && isInstagramDirectLogin({ tokenData }),
      hasFbAppCredentials,
    });
    if (mode === 'none') {
      if (!row.needs_reapproval) {
        await markSocialAccountNeedsReapproval({ platformId, userId, reason: 'token_expiring' });
        flagged++;
      }
      continue;
    }
    if (row.needs_reapproval && !isSoftReapprovalReason(tokenData.reason)) continue;
    const msLeft = new Date(row.expires_at).getTime() - now;
    const renewWithin = Math.max(getRefreshMarginMs(platformId, SOCIAL_TOKEN_SAFETY_MARGIN_DAYS), TOKEN_HEALTH_SCAN_INTERVAL_MS + 60 * 60 * 1000);
    if (Number.isFinite(msLeft) && msLeft > renewWithin) continue;
    try {
      const conn = await getPublishableSocialConnection(userId, platformId, { refreshWithinMs: renewWithin });
      if (conn?.access_token && !conn.needs_reapproval) refreshed++;
    } catch (err) {
      logger.warn({ err, platformId, userId }, 'token_health_refresh_failed');
    }
  }
  return { refreshed, flagged };
}

function startTokenHealthMonitor() {
  if (!pool) return;
  const run = async () => {
    try {
      const result = await runTokenHealthScan();
      if (result.refreshed || result.flagged) logger.info(result, 'token_health_scan');
    } catch (err) {
      logger.warn('[SocialAutomation] Token health scan failed:', err);
    }
  };
  void run();
  setInterval(run, TOKEN_HEALTH_SCAN_INTERVAL_MS);
}

function computeExpiresAtIso(expiresInSeconds: unknown): string | null {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function decodeStoredIntegrationSecret(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decryptIntegrationSecret(raw);
  } catch (err) {
    // Deterministic data-state problem: the value was encrypted under a
    // different INTEGRATIONS_ENCRYPTION_KEY or is corrupted — it will never
    // decrypt. Warn (not error) so recurring background syncs don't page;
    // getPublishableSocialConnection flags the account for reconnection.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'stored_secret_decrypt_failed');
    return '';
  }
}

async function getUserIntegrationTokenFallback(userId: string, platformId: string) {
  if (!pool) return null;
  const integration = await getIntegrationRowBySlug(platformId);
  if (!integration) return null;

  const result = await pool.query(
    `SELECT access_token, refresh_token, token_expiry, account_id, account_name, status
     FROM user_integrations
     WHERE user_id=$1 AND integration_id=$2
     LIMIT 1`,
    [userId, integration.id]
  );
  const row = result.rows[0] as
    | {
        access_token: string | null;
        refresh_token: string | null;
        token_expiry: string | null;
        account_id: string | null;
        account_name: string | null;
        status: string | null;
      }
    | undefined;
  if (!row || String(row.status || '').toLowerCase() === 'disconnected') return null;

  const accessToken = decodeStoredIntegrationSecret(row.access_token);
  const refreshToken = decodeStoredIntegrationSecret(row.refresh_token);
  if (!accessToken && !refreshToken) return null;

  return {
    accessToken,
    refreshToken,
    tokenExpiry: row.token_expiry || null,
    accountId: row.account_id || null,
    accountName: row.account_name || null,
  };
}

function describeRefreshFailure(label: string, status: number, data: any): string {
  const detail =
    data?.error_description ||
    data?.error?.message ||
    (typeof data?.error === 'string' ? data.error : '') ||
    data?.message ||
    '';
  return `${label} token refresh failed (${status})${detail ? `: ${String(detail).slice(0, 200)}` : ''}`;
}

async function refreshTwitterAccessToken(refreshToken: string) {
  const cfg = await getPlatformConfig('twitter');
  const clientId = (cfg.clientId || process.env.VITE_TWITTER_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TWITTER_CLIENT_SECRET || '').trim();
  if (!clientId) throw new Error('Twitter client_id not configured');

  const data = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  // Confidential clients: credentials via Basic auth only (not in body)
  const axiosCfg: any = {
    auth: { username: clientId, password: clientSecret || '' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  };

  const resp = await axios.post(X_OAUTH_TOKEN_URL, data.toString(), axiosCfg);
  if (resp.status >= 400 || !(resp.data as any)?.access_token) throw new Error(describeRefreshFailure('X', resp.status, resp.data));
  return resp.data;
}

async function refreshLinkedInAccessToken(refreshToken: string, req?: Request) {
  const credentials = await getLinkedInOAuthCredentials(req);
  const resp = await postLinkedInOAuthForm(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    credentials
  );
  if (resp.status >= 400) throw new Error(describeRefreshFailure('LinkedIn', resp.status, resp.data));
  return enrichLinkedInTokenData(resp.data || {}, req);
}

async function refreshTikTokAccessToken(refreshToken: string) {
  const cfg = await getPlatformConfig('tiktok');
  const clientKey = (cfg.clientKey || process.env.VITE_TIKTOK_CLIENT_ID || '').trim();
  const clientSecret = (cfg.clientSecret || process.env.TIKTOK_CLIENT_SECRET || '').trim();
  if (!clientKey || !clientSecret) throw new Error('TikTok client credentials not configured');

  const data = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const resp = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', data.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 15000,
  });
  // TikTok can answer 200 with an OAuth error in the body.
  const body: any = resp.data || {};
  if (resp.status >= 400 || body.error || !body.access_token) throw new Error(describeRefreshFailure('TikTok', resp.status, body));
  return body;
}

// Pinterest access tokens last 30 days. Refresh tokens rotate (the response
// carries a new one), which getPublishableSocialConnection stores.
async function refreshPinterestAccessToken(refreshToken: string) {
  const cfg = await getPlatformConfig('pinterest');
  const clientId = String(cfg.clientId || process.env.VITE_PINTEREST_CLIENT_ID || '').trim();
  const clientSecret = String(cfg.clientSecret || process.env.PINTEREST_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Pinterest client credentials not configured');

  const resp = await axios.post(
    'https://api.pinterest.com/v5/oauth/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      validateStatus: () => true,
      timeout: 15000,
    }
  );
  if (resp.status >= 400 || !(resp.data as any)?.access_token) throw new Error(describeRefreshFailure('Pinterest', resp.status, resp.data));
  return resp.data;
}

async function refreshThreadsAccessToken(accessToken: string) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('Threads access token missing');

  const resp = await axios.get('https://graph.threads.net/refresh_access_token', {
    params: {
      grant_type: 'th_refresh_token',
      access_token: token,
    },
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
    timeout: 15000,
  });

  const data: any = resp.data || {};
  if (resp.status >= 400) throw new Error(describeRefreshFailure('Threads', resp.status, data));
  return data;
}

async function refreshInstagramAccessToken(accessToken: string) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('Instagram access token missing');

  const resp = await axios.get('https://graph.instagram.com/refresh_access_token', {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: token,
    },
    validateStatus: () => true,
    timeout: 15000,
  });

  const data: any = resp.data || {};
  if (resp.status >= 400) throw new Error(describeRefreshFailure('Instagram', resp.status, data));
  return data;
}

type SocialTokenRow = {
  platform: string;
  account_type: string | null;
  account_id: string | null;
  account_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_data: any;
  expires_at: string | null;
  token_expires_at: string | null;
  needs_reapproval: boolean | null;
  connected_at: string | null;
  created_at: string | null;
};

async function loadSocialTokenRow(userId: string, platformId: string): Promise<SocialTokenRow | undefined> {
  if (!pool) return undefined;
  const rows = await pool.query(
    `SELECT platform, account_type, account_id, account_name, access_token, refresh_token, access_token_encrypted, refresh_token_encrypted, token_data, expires_at, token_expires_at, needs_reapproval, connected_at, created_at
     FROM social_accounts
     WHERE user_id=$1
       AND connected=true
       AND LOWER(platform)=LOWER($2)
       AND (account_type = 'profile' OR account_type IS NULL)
     ORDER BY
       CASE WHEN account_type = 'profile' THEN 0 ELSE 1 END,
       CASE WHEN needs_reapproval THEN 1 ELSE 0 END,
       CASE WHEN COALESCE(access_token_encrypted,'') <> '' OR COALESCE(access_token,'') <> '' THEN 0 ELSE 1 END,
       COALESCE(connected_at, created_at) DESC,
       created_at DESC`,
    [userId, platformId]
  );
  return rows.rows[0] as SocialTokenRow | undefined;
}

// How long a failed refresh waits before it is attempted again.
const REFRESH_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

// One refresh per account at a time in this process: concurrent callers share
// the result instead of spending a rotating refresh token twice.
const inFlightTokenRefreshes = new Map<string, Promise<PublishableSocialConnection | null>>();

async function getPublishableSocialConnection(
  userId: string,
  platformId: string,
  options: { refreshWithinMs?: number } = {},
): Promise<PublishableSocialConnection | null> {
  if (!pool) return null;
  const match = await loadSocialTokenRow(userId, platformId);

  const integrationFallback = await getUserIntegrationTokenFallback(userId, platformId);
  if (!match && !integrationFallback) return null;

  const decryptedAccess = decodeStoredIntegrationSecret(match?.access_token_encrypted);
  const decryptedRefresh = decodeStoredIntegrationSecret(match?.refresh_token_encrypted);

  const accessToken = String(
    decryptedAccess ||
    match?.access_token ||
    integrationFallback?.accessToken ||
    ''
  ).trim();
  const refreshToken = String(
    decryptedRefresh ||
    match?.refresh_token ||
    integrationFallback?.refreshToken ||
    ''
  ).trim();

  // Stored token exists but is undecryptable (key rotation/corruption) and no
  // fallback worked: permanently unusable. Flag once so the UI prompts the
  // user to reconnect instead of every background sync failing silently.
  if (match && !match.needs_reapproval && !accessToken && match.access_token_encrypted && !decryptedAccess) {
    void markSocialAccountNeedsReapproval({
      platformId,
      accountId: match.account_id,
      userId,
      reason: 'stored_token_decrypt_failed',
    }).catch(() => undefined);
  }
  // In-memory view for callers; never written back with these credentials in it.
  let tokenData: Record<string, any> = {
    ...(match?.token_data || {}),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };
  let rawExpiry =
    match?.token_expires_at ||
    match?.expires_at ||
    String(tokenData?.access_token_expires_at || '').trim() ||
    integrationFallback?.tokenExpiry ||
    null;

  const base = {
    platform: match?.platform || platformId,
    account_id: match?.account_id || integrationFallback?.accountId || null,
    account_name: match?.account_name || integrationFallback?.accountName || null,
  };
  const unusable = (overrides: Partial<PublishableSocialConnection> = {}): PublishableSocialConnection => ({
    ...base,
    access_token: '',
    refresh_token: refreshToken || null,
    token_data: tokenData,
    needs_reapproval: true,
    token_expires_at: rawExpiry,
    ...overrides,
  });

  if (platformId === 'linkedin' && accessToken) {
    const needsMetadataHydration =
      getLinkedInScopeSet(tokenData).size === 0 ||
      !String(tokenData?.access_token_expires_at || '').trim() ||
      (refreshToken && !String(tokenData?.refresh_token_expires_at || '').trim());

    if (needsMetadataHydration) {
      try {
        const enrichedTokenData = await enrichLinkedInTokenData(
          {
            ...tokenData,
            access_token: accessToken,
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
          }
        );
        const enrichedExpiry =
          String(enrichedTokenData?.access_token_expires_at || '').trim() ||
          rawExpiry;

        tokenData = enrichedTokenData;
        rawExpiry = enrichedExpiry;

        await pool.query(
          `UPDATE social_accounts
           SET token_data = COALESCE(token_data, '{}'::jsonb) || $3::jsonb,
               expires_at = COALESCE($4, expires_at),
               token_expires_at = COALESCE($4, token_expires_at)
           WHERE user_id=$1 AND LOWER(platform)=LOWER($2) AND (account_type = 'profile' OR account_type IS NULL)`,
          [userId, platformId, JSON.stringify(sanitizeTokenData(enrichedTokenData)), enrichedExpiry]
        );

        if (enrichedTokenData?.access_token_active === false) {
          await markSocialAccountNeedsReapproval({
            platformId,
            userId,
            reason: 'token_inactive',
            disconnect: false,
          });
          return unusable({ token_expires_at: enrichedExpiry });
        }
      } catch (err) {
        logger.error('Unhandled error:', err);
        // Metadata hydration is best-effort; keep the token usable if LinkedIn inspection fails.
      }
    }
  }

  const now = Date.now();
  const expiresAtMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
  const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= now;
  const hasUsableToken = Boolean(accessToken) && !isExpired;
  const flaggedReason = String(match?.token_data?.reason || '').trim().toLowerCase();
  let hasFbAppCredentials = Boolean(process.env.VITE_FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
  if (platformId === 'instagram' && !hasFbAppCredentials) {
    const igCfg = await getPlatformConfig('instagram').catch(() => ({} as Record<string, string>));
    const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
    hasFbAppCredentials = Boolean((igCfg.appId || fbCfg.appId) && (igCfg.appSecret || fbCfg.appSecret));
  }
  const refreshMode = getRefreshMode(platformId, {
    hasRefreshToken: Boolean(refreshToken),
    isInstagramDirect: platformId === 'instagram' && isInstagramDirectLogin({ accessToken, tokenData }),
    hasFbAppCredentials,
  });

  // A hard flag (revoked, undecryptable, expired refresh token) waits for the
  // user. A soft one (expiring/expired/refresh failed) on a refreshable
  // platform falls through so the refresh below can clear it.
  if (match?.needs_reapproval && !hasUsableToken && (refreshMode === 'none' || !isSoftReapprovalReason(flaggedReason))) {
    return unusable();
  }

  const linkedInRefreshExpiry =
    platformId === 'linkedin'
      ? String(tokenData?.refresh_token_expires_at || '').trim()
      : '';
  const linkedInRefreshExpiryMs = linkedInRefreshExpiry ? new Date(linkedInRefreshExpiry).getTime() : NaN;
  if (platformId === 'linkedin' && refreshToken && Number.isFinite(linkedInRefreshExpiryMs) && linkedInRefreshExpiryMs <= now) {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'refresh_token_expired',
      disconnect: false,
    });
    return unusable();
  }

  const refreshMarginMs = Math.max(
    getRefreshMarginMs(platformId, SOCIAL_TOKEN_SAFETY_MARGIN_DAYS),
    Number(options.refreshWithinMs) || 0,
  );
  const shouldRefreshSoon = refreshMode !== 'none' && Number.isFinite(expiresAtMs) && expiresAtMs <= now + refreshMarginMs;

  if (!Number.isFinite(expiresAtMs) || (refreshMode === 'none' && !isExpired) || (refreshMode !== 'none' && !shouldRefreshSoon)) {
    return unusable({ access_token: accessToken, needs_reapproval: false });
  }

  if (refreshMode === 'none') {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_expired',
      disconnect: false,
    });
    return unusable();
  }

  if (refreshMode === 'refresh_token' && !refreshToken) {
    await markSocialAccountNeedsReapproval({
      platformId,
      userId,
      reason: 'token_missing_refresh',
      disconnect: false,
    });
    return unusable({ refresh_token: null });
  }

  // After a failed refresh, wait before trying again; a still-valid token
  // keeps working in the meantime.
  if (match?.needs_reapproval && flaggedReason === 'token_refresh_failed') {
    const lastAttemptMs = Date.parse(String(match.token_data?.needs_reapproval_at || ''));
    if (Number.isFinite(lastAttemptMs) && now - lastAttemptMs < REFRESH_RETRY_COOLDOWN_MS) {
      return hasUsableToken ? unusable({ access_token: accessToken, needs_reapproval: false }) : unusable();
    }
  }

  const key = `${userId}:${platformId}`;
  const pending = inFlightTokenRefreshes.get(key);
  if (pending) return pending;
  const run = (async (): Promise<PublishableSocialConnection | null> => {
    let refreshed: any = null;
    try {
      if (platformId === 'threads') {
        refreshed = await refreshThreadsAccessToken(accessToken);
      } else if (platformId === 'instagram' && refreshMode === 'instagram_access_token') {
        refreshed = await refreshInstagramAccessToken(accessToken);
      } else if (platformId === 'instagram' && refreshMode === 'instagram_fb_exchange') {
        const igCfg = await getPlatformConfig('instagram').catch(() => ({} as Record<string, string>));
        const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
        const appId = String(igCfg.appId || fbCfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim();
        const appSecret = String(igCfg.appSecret || fbCfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim();
        if (appId && appSecret) {
          const fbRes = await instagramBusinessPlatform.refreshToken({ accessToken, helpers: { appId, appSecret } } as any);
          if (fbRes?.accessToken) {
            const ttlSec = fbRes.expiresAt ? Math.max(60, Math.round((fbRes.expiresAt.getTime() - Date.now()) / 1000)) : 5184000;
            refreshed = { access_token: fbRes.accessToken, expires_in: ttlSec };
          }
        }
      } else if (platformId === 'twitter') {
        refreshed = await refreshTwitterAccessToken(refreshToken);
      } else if (platformId === 'linkedin') {
        refreshed = await refreshLinkedInAccessToken(refreshToken);
      } else if (platformId === 'tiktok') {
        refreshed = await refreshTikTokAccessToken(refreshToken);
      } else if (platformId === 'pinterest') {
        refreshed = await refreshPinterestAccessToken(refreshToken);
      }
    } catch (err) {
      // X, TikTok and Pinterest rotate refresh tokens: if another process
      // refreshed first, our now-stale refresh token is rejected. Use the token
      // it stored rather than declaring the connection broken.
      const latest = await loadSocialTokenRow(userId, platformId).catch(() => undefined);
      if (latest?.access_token_encrypted && latest.access_token_encrypted !== match?.access_token_encrypted) {
        const latestAccess = decodeStoredIntegrationSecret(latest.access_token_encrypted);
        const latestExpiry = latest.token_expires_at || latest.expires_at || null;
        const latestExpiryMs = latestExpiry ? new Date(latestExpiry).getTime() : NaN;
        if (latestAccess && (!Number.isFinite(latestExpiryMs) || latestExpiryMs > Date.now())) {
          return {
            ...base,
            access_token: latestAccess,
            refresh_token: decodeStoredIntegrationSecret(latest.refresh_token_encrypted) || null,
            token_data: latest.token_data || {},
            needs_reapproval: false,
            token_expires_at: latestExpiry,
          };
        }
      }
      logger.warn({ platformId, userId, err: err instanceof Error ? err.message : String(err) }, 'social_token_refresh_failed');
      await markSocialAccountNeedsReapproval({
        platformId,
        userId,
        reason: 'token_refresh_failed',
        disconnect: false,
      });
      return hasUsableToken ? unusable({ access_token: accessToken, needs_reapproval: false }) : unusable();
    }

    const nextAccess = String(refreshed?.access_token || '').trim();
    const nextRefresh = String(refreshed?.refresh_token || refreshToken || '').trim() || null;
    const nextExpiresAt = String(refreshed?.access_token_expires_at || '').trim() || computeExpiresAtIso(refreshed?.expires_in) || rawExpiry;
    const mergedTokenData = { ...(tokenData || {}), ...(refreshed || {}) };

    if (!nextAccess) {
      await markSocialAccountNeedsReapproval({ platformId, userId, reason: 'token_refresh_failed', disconnect: false });
      return hasUsableToken ? unusable({ access_token: accessToken, needs_reapproval: false }) : unusable();
    }

    const nextAccessEncrypted = encryptIntegrationSecret(nextAccess);
    const nextRefreshEncrypted = nextRefresh ? encryptIntegrationSecret(nextRefresh) : null;
    try {
      await pool.query(
        `UPDATE social_accounts
         SET access_token=NULL,
             refresh_token=NULL,
             access_token_encrypted=$3,
             refresh_token_encrypted=$4,
             expires_at=$5,
             token_expires_at=$5,
             needs_reapproval=false,
             token_data = (COALESCE(token_data, '{}'::jsonb) - $7::text[]) || $6::jsonb
         WHERE user_id=$1 AND LOWER(platform)=LOWER($2) AND (account_type = 'profile' OR account_type IS NULL)`,
        [
          userId,
          match?.platform || platformId,
          nextAccessEncrypted,
          nextRefreshEncrypted,
          nextExpiresAt,
          JSON.stringify(sanitizeTokenData(refreshed)),
          ['reason', 'needs_reapproval_at', ...TOKEN_DATA_SECRET_KEYS],
        ]
      );
      await upsertUserIntegration({
        userId,
        integrationSlug: platformId,
        accessTokenEncrypted: nextAccessEncrypted,
        refreshTokenEncrypted: nextRefreshEncrypted,
        tokenExpiry: nextExpiresAt,
        accountId: match?.account_id ?? integrationFallback?.accountId ?? null,
        accountName: match?.account_name ?? integrationFallback?.accountName ?? null,
        status: 'connected',
      });
      await logIntegrationEvent({
        userId,
        integrationSlug: platformId,
        eventType: 'token_refresh',
        status: 'success',
        response: { expiresAt: nextExpiresAt },
      });
    } catch (err) {
      logger.error('Unhandled error:', err);
      // ignore persistence issues; still return refreshed token for this request
    }
    return {
      ...base,
      access_token: nextAccess,
      refresh_token: nextRefresh,
      token_data: mergedTokenData,
      needs_reapproval: false,
      token_expires_at: nextExpiresAt,
    };
  })().finally(() => inFlightTokenRefreshes.delete(key));
  inFlightTokenRefreshes.set(key, run);
  return run;
}

async function getUserSettingValue(userId: string, key: string): Promise<any | null> {
  if (!pool) return null;
  try {
    const result = await pool.query('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
    return result.rows[0]?.value ?? null;
  } catch (err) {
    logger.error('Unhandled error:', err);
    return null;
  }
}

function safeJsonObject(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    } catch (err) {
    logger.error('Unhandled error:', err);
      return {};
    }
  }
  return {};
}

function extractSocialAutomationSettings(post: Record<string, any>) {
  const raw = safeJsonObject((post as any).social_automation);
  const fb = raw?.platforms?.facebook ?? raw?.facebook ?? {};
  const enabled = Boolean(fb?.enabled);
  const destination = fb?.destination ?? {};
  const destType: 'page' | 'group' | 'profile' = destination?.type === 'group' ? 'group' : destination?.type === 'profile' ? 'profile' : 'page';
  const destId = String(destination?.id || '').trim();
  const destName = destination?.name ? String(destination.name) : '';
  const template = String(raw?.postFormat?.template || raw?.template || '').trim();
  const scheduling = raw?.scheduling ?? {};
  const mode: 'immediate' | 'schedule' | 'delay' =
    scheduling?.mode === 'schedule' || scheduling?.mode === 'delay' ? scheduling.mode : 'immediate';
  const scheduledFor = scheduling?.scheduledFor ? String(scheduling.scheduledFor) : null;
  const delayMinutes = typeof scheduling?.delayMinutes === 'number' ? scheduling.delayMinutes : null;
  const timezone = scheduling?.timezone ? String(scheduling.timezone) : null;
  return {
    enabled,
    template,
    scheduling: { mode, scheduledFor, delayMinutes, timezone },
    facebook: { destination: { type: destType, id: destId, name: destName } },
  };
}

async function ensureBullMqSocialAutomationQueue() {
  if (socialAutomationQueue && socialAutomationWorker && socialAutomationRedis) return;
  if (!isBullMqEnabled()) return;
  if (!pool) throw new Error('BullMQ is enabled but DATABASE_URL is not configured');

  socialAutomationRedis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  socialAutomationQueue = new Queue(SOCIAL_AUTOMATION_QUEUE_NAME, {
    connection: socialAutomationRedis as any,
    defaultJobOptions: {
      attempts: SOCIAL_AUTOMATION_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });

  socialAutomationWorker = new Worker(
    SOCIAL_AUTOMATION_QUEUE_NAME,
    async (job) => {
      const taskId = String((job.data as any)?.taskId || '');
      if (!taskId) return { ok: false, error: 'Missing taskId' };
      const attemptNumber = (job.attemptsMade || 0) + 1;
      const maxAttempts = typeof (job.opts as any)?.attempts === 'number' ? (job.opts as any).attempts : SOCIAL_AUTOMATION_MAX_ATTEMPTS;
      return await processSocialAutomationTaskById(taskId, attemptNumber, maxAttempts);
    },
    { connection: socialAutomationRedis as any, concurrency: 5 }
  );

  socialAutomationWorker.on('error', (err) => {
    logger.error('[SocialAutomation] BullMQ worker error:', err);
  });
}

async function enqueueBullMqJob(taskId: string, runAtIso: string, platform?: string) {
  if (!isBullMqEnabled()) return;
  await ensureBullMqSocialAutomationQueue();
  if (!socialAutomationQueue) return;

  const runAt = new Date(runAtIso);
  const delay = Math.max(0, runAt.getTime() - Date.now());
  const attempts = getSocialAutomationMaxAttempts(platform);
  const backoffDelay = getRetryDelayMs(1, platform);
  try {
    await socialAutomationQueue.add('social-publish', { taskId }, {
      jobId: taskId,
      delay,
      attempts,
      backoff: { type: 'exponential', delay: backoffDelay },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (/Job.*already exists/i.test(msg)) return;
    throw err;
  }
}

async function resolveSocialAccountIdForLog(userId: string, platform: string, destination: any) {
  if (!pool) return null;
  const dest = destination || {};
  const accountType = String(dest.type || '').trim().toLowerCase();
  const accountId = String(dest.id || '').trim();
  if (!accountType || !accountId) return null;
  const { rows } = await pool.query(
    `SELECT id FROM social_accounts WHERE user_id=$1 AND LOWER(platform)=LOWER($2) AND account_type=$3 AND account_id=$4 LIMIT 1`,
    [userId, platform, accountType, accountId]
  );
  return rows.length ? String(rows[0].id) : null;
}

async function cancelPendingSocialAutomationForPost(userId: string, postId: string, reason: string) {
  if (!pool) return;

  await pool
    .query(
      `UPDATE social_automation_tasks
       SET status='cancelled', last_error=$3, updated_at=NOW()
       WHERE user_id=$1 AND post_id=$2 AND status IN ('scheduled','pending')`,
      [userId, postId, reason]
    )
    .catch(() => undefined);

  await pool
    .query(
      `UPDATE publishing_logs
       SET status='cancelled', error_message=$3
       WHERE user_id=$1 AND post_id=$2 AND status IN ('scheduled','pending')`,
      [userId, postId, reason]
    )
    .catch(() => undefined);
}

async function syncSocialAutomationForPost(userId: string, postId: string) {
  if (!pool) return;

  const postRows = await pool.query(
    `SELECT p.*,
      ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
     FROM blog_posts p
     WHERE p.id=$1 AND p.user_id=$2
     LIMIT 1`,
    [postId, userId]
  );

  if (!postRows.rows.length) return;

  const post = postRows.rows[0] as any;
  const isPublished = String(post.status || '').toLowerCase() === 'published';

  await cancelPendingSocialAutomationForPost(
    userId,
    postId,
    isPublished ? 'Replaced by updated social settings' : 'Social automation disabled for this post'
  );

  if (!isPublished) return;

  await queueSocialAutomationForPublishedPost(userId, post);
}

async function insertSocialPostLog(params: {
  userId: string;
  postId: string;
  platform: string;
  destination: any;
  status: string;
  apiResponse: any;
  postedAtIso: string | null;
}) {
  if (!pool) return;
  const socialAccountId = await resolveSocialAccountIdForLog(params.userId, params.platform, params.destination).catch(() => null);
  await pool
    .query(
      `INSERT INTO social_post_logs (id, post_id, social_account_id, platform, status, api_response, posted_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        randomUUID(),
        params.postId,
        socialAccountId,
        params.platform,
        params.status,
        JSON.stringify(params.apiResponse ?? null),
        params.postedAtIso,
      ]
    )
    .catch(() => undefined);
}

async function processSocialAutomationTaskById(taskId: string, attemptNumber: number, maxAttempts: number) {
  if (!pool) throw new Error('DATABASE_URL is not configured');

  // Claim the task atomically before publishing. Without the claim, the 5 s DB
  // worker re-selected a task still in flight (publishes can take longer than
  // a tick) and a duplicate BullMQ delivery ran it again — posting twice.
  const taskRows = await pool.query(
    `UPDATE social_automation_tasks
     SET status='processing', attempts=attempts+1, updated_at=NOW()
     WHERE id=$1 AND status IN ('scheduled','pending')
     RETURNING *`,
    [taskId]
  );
  if (!taskRows.rows.length) return { ok: false, error: 'Task not found or already being processed' };
  const task = taskRows.rows[0] as any;

  const userId = String(task.user_id);
  const postId = String(task.post_id);
  const platform = String(task.platform || 'facebook');
  const logId = task.log_id ? String(task.log_id) : null;
  const payload = safeJsonObject(task.payload);
  const destination = payload?.destination || null;
  const template = payload?.template ? String(payload.template) : '';

  const scheduleRetry = async (msg: string) => {
    const retryAt = new Date(Date.now() + getRetryDelayMs(attemptNumber, platform));
    await pool
      .query(
        `UPDATE social_automation_tasks
         SET status='scheduled', run_at=$2, last_error=$3, updated_at=NOW()
         WHERE id=$1`,
        [taskId, retryAt.toISOString(), msg]
      )
      .catch(() => undefined);
    if (logId) {
      await pool
        .query(`UPDATE publishing_logs SET status='scheduled', error_message=$1 WHERE id=$2 AND user_id=$3`, [
          msg,
          logId,
          userId,
        ])
        .catch(() => undefined);
    }
    const err: any = new Error(msg);
    err.retryScheduled = true;
    throw err;
  };

  try {
    const postRows = await pool.query(
      `SELECT p.*,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p
       WHERE p.id=$1 AND p.user_id=$2`,
      [postId, userId]
    );
    if (!postRows.rows.length) throw new Error('Post not found');
    const postRow = postRows.rows[0];
    if (['pending', 'review_required', 'rejected', 'needs_changes'].includes(String(postRow.approval_status || ''))) {
      await pool.query(
        `UPDATE social_automation_tasks SET status='cancelled', last_error='Blocked: post requires approval before publishing', updated_at=NOW() WHERE id=$1`,
        [taskId]
      ).catch(() => undefined);
      return;
    }

    const result = await publishToplatform(userId, postRow, platform, {
      template,
      destination,
      mediaType: payload?.mediaType || undefined,
      mediaAssets: Array.isArray(payload?.mediaAssets) ? payload.mediaAssets : undefined,
      captionOverride: payload?.captionOverride ? String(payload.captionOverride) : undefined,
    });

    if (result.status === 'failed' && result.retryable && attemptNumber < maxAttempts) {
      await insertSocialPostLog({
        userId,
        postId,
        platform,
        destination,
        status: 'failed',
        apiResponse: result,
        postedAtIso: null,
      });
      await scheduleRetry(result.error || 'Automation failed');
    }

    // Only two outcomes are final for a task; anything else would leave it
    // selectable by the worker and publish again on the next tick.
    const finalStatus = result.status === 'published' ? 'published' : 'failed';
    await pool.query(
      `UPDATE social_automation_tasks SET status=$2, last_error=$3, updated_at=NOW() WHERE id=$1`,
      [taskId, finalStatus, result.error || null]
    );

    if (logId) {
      await pool.query(
        `UPDATE publishing_logs
         SET status=$1, platform_post_id=$2, error_message=$3, response=$4,
             posted_at = CASE WHEN $1 = 'published' THEN NOW() ELSE posted_at END
         WHERE id=$5 AND user_id=$6`,
        [finalStatus, result.platformPostId || null, result.error || null, result as any, logId, userId]
      );
    } else {
      await pool
        .query(
          'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message,response,posted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
          [randomUUID(), postId, userId, platform, finalStatus, result.platformPostId || null, result.error || null, JSON.stringify(result as any), finalStatus === 'published' ? new Date().toISOString() : null]
        )
        .catch(() => undefined);
    }

    await insertSocialPostLog({
      userId,
      postId,
      platform,
      destination,
      status: finalStatus,
      apiResponse: result,
      postedAtIso: finalStatus === 'published' ? new Date().toISOString() : null,
    });

    return { ok: finalStatus === 'published', ...result, status: finalStatus };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Automation failed';
    if ((err as any)?.retryScheduled) {
      throw err;
    }

    if (attemptNumber < maxAttempts) {
      await scheduleRetry(msg);
    }

    await pool
      .query(
        `UPDATE social_automation_tasks
         SET status='failed', last_error=$2, updated_at=NOW()
         WHERE id=$1`,
        [taskId, msg]
      )
      .catch(() => undefined);

    if (logId) {
      await pool
        .query(`UPDATE publishing_logs SET status='failed', error_message=$1 WHERE id=$2 AND user_id=$3`, [
          msg,
          logId,
          userId,
        ])
        .catch(() => undefined);
    } else {
      await pool
        .query('INSERT INTO publishing_logs (id,post_id,user_id,platform,status,error_message,response) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [
          randomUUID(),
          postId,
          userId,
          platform,
          'failed',
          msg,
          JSON.stringify({ error: msg }),
        ])
        .catch(() => undefined);
    }

    await insertSocialPostLog({
      userId,
      postId,
      platform,
      destination,
      status: 'failed',
      apiResponse: { error: msg },
      postedAtIso: null,
    });

    return { ok: false, status: 'failed', error: msg };
  }
}

async function enqueueSocialAutomationTask(params: {
  userId: string;
  postId: string;
  platform: string;
  runAt: Date;
  payload: any;
  accountLabel: string | null;
}) {
  if (!pool) return;
  const now = Date.now();
  const runAtIso = params.runAt.toISOString();
  const initialStatus = params.runAt.getTime() > (now + 2000) ? 'scheduled' : 'pending';
  const dest = safeJsonObject(params.payload)?.destination || {};
  const destId = String(dest?.id || '').trim();
  const destType = String(dest?.type || '').trim();

  const existing = await pool.query(
    `SELECT 1 FROM social_automation_tasks
     WHERE user_id=$1 AND post_id=$2 AND LOWER(platform)=LOWER($3)
       AND status IN ('scheduled','pending')
       AND COALESCE(payload->'destination'->>'id','') = $4
       AND COALESCE(payload->'destination'->>'type','') = $5
     LIMIT 1`,
    [params.userId, params.postId, params.platform, destId, destType]
  );
  if (existing.rows.length) return;

  const logId = randomUUID();
  await pool.query(
    'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,account,scheduled_for) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      logId,
      params.postId,
      params.userId,
      params.platform,
      initialStatus,
      params.accountLabel,
      initialStatus === 'scheduled' ? runAtIso : null,
    ]
  );

  const taskId = randomUUID();
  await pool.query(
    `INSERT INTO social_automation_tasks (id,user_id,post_id,platform,run_at,status,payload,log_id,attempts,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,0,NOW())`,
    [taskId, params.userId, params.postId, params.platform, runAtIso, initialStatus, JSON.stringify(params.payload || {}), logId]
  );

  await enqueueBullMqJob(taskId, runAtIso, params.platform);
}

async function queueSocialAutomationForPublishedPost(userId: string, post: Record<string, any>) {
  if (!pool) return;

  const postId = String((post as any).id);

  const v2 = await pool.query(
    `SELECT s.*, t.id AS target_id, t.enabled AS target_enabled,
      a.id AS social_account_id, a.platform AS account_platform, a.account_type, a.account_id, a.account_name
     FROM social_post_settings s
     JOIN social_post_targets t ON t.social_post_id=s.id
     JOIN social_accounts a ON a.id=t.social_account_id
     WHERE s.post_id=$1 AND t.enabled=true`,
    [postId]
  );

  if (v2.rows.length) {
    for (const row of v2.rows as any[]) {
      const publishType = String(row.publish_type || 'immediate');
      let runAt = new Date();
      if (publishType === 'scheduled' || publishType === 'delayed') {
        if (!row.scheduled_at) throw new Error(`Social Automation publish_type is '${publishType}' but scheduled_at is missing`);
        const dt = new Date(String(row.scheduled_at));
        if (Number.isNaN(dt.getTime())) throw new Error('Invalid Social Automation scheduled_at');
        runAt = dt;
      }

      const destType = String(row.account_type || 'profile').toLowerCase() || 'profile';
      const destination = { type: destType, id: String(row.account_id || ''), name: String(row.account_name || '') };
      const accountLabel = formatSocialAccountLabel(String(row.account_platform || 'facebook'), destType, destination.name, destination.id);

      await enqueueSocialAutomationTask({
        userId,
        postId,
        platform: String(row.account_platform || 'facebook'),
        runAt,
        payload: { destination, template: String(row.template || '') },
        accountLabel,
      });
    }
    return;
  }

  const s = extractSocialAutomationSettings(post);
  if (!s.enabled) return;

  const now = Date.now();
  let runAt = new Date(now);
  if (s.scheduling.mode === 'delay') {
    const mins = Math.max(1, Number(s.scheduling.delayMinutes || 10));
    runAt = new Date(now + mins * 60_000);
  } else if (s.scheduling.mode === 'schedule') {
    if (!s.scheduling.scheduledFor) throw new Error('Social Automation is set to schedule but no scheduled time was provided');
    const dt = new Date(s.scheduling.scheduledFor);
    if (Number.isNaN(dt.getTime())) throw new Error('Invalid Social Automation scheduled time');
    runAt = dt;
  }

  const accountLabel = formatSocialAccountLabel(
    'facebook',
    s.facebook.destination.type,
    s.facebook.destination.name,
    s.facebook.destination.id,
  );

  await enqueueSocialAutomationTask({
    userId,
    postId,
    platform: 'facebook',
    runAt,
    payload: { destination: s.facebook.destination, template: s.template },
    accountLabel,
  });
}

let socialAutomationWorkerStarted = false;
let socialAutomationTickRunning = false;

// A task left in 'processing' this long was interrupted mid-publish (deploy,
// crash). It may or may not have reached the platform, so it is surfaced as
// failed for a deliberate retry rather than re-sent automatically.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

async function failInterruptedSocialAutomationTasks() {
  if (!pool) return;
  const message = 'Publishing was interrupted before it finished. Check the platform, then retry if the post is missing.';
  const { rows } = await pool.query(
    `UPDATE social_automation_tasks
     SET status='failed', last_error=$2, updated_at=NOW()
     WHERE status='processing' AND updated_at < NOW() - ($1::int * INTERVAL '1 millisecond')
     RETURNING log_id, user_id`,
    [STALE_PROCESSING_MS, message]
  ).catch(() => ({ rows: [] as any[] }));
  for (const row of rows as any[]) {
    if (!row.log_id) continue;
    await pool.query(
      `UPDATE publishing_logs SET status='failed', error_message=$1 WHERE id=$2 AND user_id=$3 AND status IN ('pending','scheduled')`,
      [message, row.log_id, row.user_id]
    ).catch(() => undefined);
  }
}

async function processDueSocialAutomationTasks() {
  if (!pool) return;
  // Ticks are 5 s apart and a publish can take longer; never overlap them.
  if (socialAutomationTickRunning) return;
  socialAutomationTickRunning = true;
  try {
    await failInterruptedSocialAutomationTasks();
    const { rows: tasks } = await pool.query(
      `SELECT id, attempts, platform FROM social_automation_tasks
       WHERE status IN ('scheduled','pending') AND run_at <= NOW()
       ORDER BY run_at ASC
       LIMIT 10`
    );

    for (const task of tasks) {
      const taskId = String((task as any).id);
      try {
        const attemptNumber = Number((task as any).attempts || 0) + 1;
        // Claims the task itself; a task another worker already took is skipped.
        await processSocialAutomationTaskById(
          taskId,
          attemptNumber,
          getSocialAutomationMaxAttempts(String((task as any).platform || ''))
        );
      } catch (err) {
        void err;
      }
    }
  } finally {
    socialAutomationTickRunning = false;
  }
}

function startSocialAutomationWorker() {
  if (socialAutomationWorkerStarted) return;
  socialAutomationWorkerStarted = true;

  setInterval(() => {
    void processDueSocialAutomationTasks().catch(() => undefined);
  }, 5000);
}

function startSocialAutomationProcessor() {
  if (!pool) return;
  if (isBullMqEnabled()) {
    void (async () => {
      try {
        await ensureBullMqSocialAutomationQueue();
        await failInterruptedSocialAutomationTasks();
        const { rows } = await pool.query(
          `SELECT id, run_at, platform FROM social_automation_tasks
           WHERE status IN ('scheduled','pending')
           ORDER BY run_at ASC
           LIMIT 200`
        );
        for (const r of rows as any[]) {
          await enqueueBullMqJob(String(r.id), String(r.run_at), String(r.platform || ''));
        }
      } catch (err) {
        logger.error('[SocialAutomation] BullMQ init failed, falling back to DB worker:', err);
        startSocialAutomationWorker();
      }
    })();
    return;
  }
  startSocialAutomationWorker();
}

function renderMessageTemplate(template: string, vars: Record<string, string>) {
  const tpl = String(template || '');
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? '';
    return m;
  });
}

async function hasStoredFacebookPageToken(userId: string, destination?: { type?: string; id?: string } | null): Promise<boolean> {
  if (!pool) return false;
  const destType = String(destination?.type || '').toLowerCase();
  if (destType && destType !== 'page') return false;
  const destId = String(destination?.id || '').trim();
  const { rows } = await pool.query(
    `SELECT 1 FROM social_accounts
     WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND connected=true
       AND COALESCE(needs_reapproval, false) = false
       AND (COALESCE(access_token_encrypted, '') <> '' OR COALESCE(access_token, '') <> '')
       ${destId ? 'AND account_id=$2' : ''}
     LIMIT 1`,
    destId ? [userId, destId] : [userId]
  ).catch(() => ({ rows: [] as any[] }));
  return rows.length > 0;
}

async function resolveFacebookPageToken(params: {
  userId: string;
  userAccessToken: string;
  destination?: { type?: string; id?: string; name?: string };
}) {
  const dest = params.destination || {};
  const destType = String(dest.type || '').toLowerCase();
  if (destType && destType !== 'page') {
    return null;
  }

  let desiredId = String(dest.id || '').trim();
  const desiredName = dest.name ? String(dest.name) : '';

  if (!desiredId) {
    const settings = (await getUserSettingValue(params.userId, 'posts-automation-settings')) || {};
    const rawSelected = String(settings?.selectedAccountMap?.facebook || '').trim();
    if (rawSelected.startsWith('page:')) {
      desiredId = rawSelected.slice('page:'.length).trim();
    } else if (rawSelected && !rawSelected.startsWith('group:')) {
      desiredId = rawSelected;
    }
  }

  if (pool) {
    try {
      const stored = await pool.query(
        `SELECT account_id, account_name, access_token, access_token_encrypted
         FROM social_accounts
         WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND connected=true
         ${desiredId ? 'AND account_id=$2' : ''}
         ORDER BY created_at DESC
         LIMIT 1`,
        desiredId ? [params.userId, desiredId] : [params.userId]
      );
      const storedRow: any = stored.rows[0] || {};
      let decrypted = '';
      if (storedRow?.access_token_encrypted) {
        try {
          decrypted = decryptIntegrationSecret(String(storedRow.access_token_encrypted));
        } catch (err) {
    logger.error('Unhandled error:', err);
          decrypted = '';
        }
      }
      const pageToken = String(decrypted || storedRow?.access_token || '').trim();
      const pageId = String(storedRow?.account_id || '').trim();
      const pageName = String(storedRow?.account_name || '').trim();
      if (pageId && pageToken) {
        return { pageId, pageToken, pageName: pageName || desiredName || undefined };
      }
    } catch (err) {
    logger.error('Unhandled error:', err);
      // ignore; fallback to /me/accounts lookup
    }
  }

  if (!params.userAccessToken) return null;
  const pagesResp = await axios.get(`${META_GRAPH_BASE}/me/accounts`, {
    params: { fields: 'id,name,access_token', limit: 200, access_token: params.userAccessToken },
    validateStatus: () => true,
    timeout: 15000,
  });
  const pagesData: any = pagesResp.data || {};
  if (pagesResp.status >= 400) {
    throw new Error(pagesData?.error?.message || `Facebook API error ${pagesResp.status}`);
  }
  const pages: any[] = Array.isArray(pagesData?.data) ? pagesData.data : [];
  const page = desiredId ? pages.find((p: any) => String(p?.id || '').trim() === desiredId) : pages[0];
  const pageId = String(page?.id || '').trim();
  const pageToken = String(page?.access_token || '').trim();
  if (!pageId || !pageToken) return null;
  if (pool) {
    // Cache the Page token on the saved Page row so later posts skip this lookup.
    await pool.query(
      `UPDATE social_accounts SET access_token_encrypted = $1, access_token = NULL
       WHERE user_id = $2 AND platform = 'facebook' AND account_type = 'page' AND account_id = $3`,
      [encryptIntegrationSecret(pageToken), params.userId, pageId],
    ).catch(() => undefined);
  }
  return { pageId, pageToken, pageName: String(page?.name || '').trim() || desiredName || undefined };
}

// Polls a Threads media container until it can be published.
async function waitForThreadsContainer(
  threadsBase: string,
  containerId: string,
  accessToken: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<{ status: 'ready' | 'error' | 'timeout'; message: string }> {
  const attempts = options.attempts ?? 15;
  const intervalMs = options.intervalMs ?? 3000;
  for (let i = 0; i < attempts; i++) {
    const resp = await axios.get(`${threadsBase}/${encodeURIComponent(containerId)}`, {
      params: { fields: 'status,error_message', access_token: accessToken },
      validateStatus: () => true,
      timeout: 10000,
    }).catch(() => null);
    const status = String((resp?.data as any)?.status || '').toUpperCase();
    if (status === 'FINISHED' || status === 'PUBLISHED') return { status: 'ready', message: '' };
    if (status === 'ERROR' || status === 'EXPIRED') {
      const detail = String((resp?.data as any)?.error_message || status);
      return { status: 'error', message: `Threads could not process the media (${detail}).` };
    }
    await sleep(intervalMs);
  }
  return { status: 'timeout', message: 'Threads is still processing the media; the post will be retried.' };
}

// Helper: publish a blog post to a single platform, return result
async function publishToplatform(
  userId: string,
  post: Record<string, any>,
  platform: string,
  options?: {
    template?: string;
    destination?: any;
    mediaType?: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY';
    mediaAssets?: Array<{ url: string; type?: 'image' | 'video'; alt_text?: string }>;
    captionOverride?: string;
  }
): Promise<{ status: string; platformPostId?: string; error?: string; retryable?: boolean }> {
  try {
    const platformId = normalizePlatformId(platform);
    if (platformId === 'wordpress') {
      const conn = await getWordPressConnection(userId);
      if (!conn) throw new Error('WordPress not connected');
      const appPassword = decryptWordPressPassword(conn.appPasswordEncrypted);
      const postPayload: Record<string, any> = {
        title: post.title || '',
        content: post.content || '',
        status: post.status === 'published' ? 'publish' : 'draft',
        excerpt: post.excerpt || '',
        slug: post.slug || '',
      };
      const { data: wpData, status: wpStatus, error: wpError } = await wpRequest(
        conn.siteUrl, conn.username, appPassword, 'POST', '/wp/v2/posts', { data: postPayload }
      );
      if (wpStatus !== 201 && wpStatus !== 200) throw new Error(wpError || 'WordPress publish failed');
      const postId = wpData?.id;
      if (postId && (post.meta_title || post.meta_description || post.focus_keyword)) {
        const meta: Record<string, string> = {};
        if (post.meta_title) { meta._yoast_wpseo_title = post.meta_title; meta.rank_math_title = post.meta_title; }
        if (post.meta_description) { meta._yoast_wpseo_metadesc = post.meta_description; meta.rank_math_description = post.meta_description; }
        if (post.focus_keyword) { meta._yoast_wpseo_focuskw = post.focus_keyword; meta.rank_math_focus_keyword = post.focus_keyword; }
        await wpRequest(conn.siteUrl, conn.username, appPassword, 'POST', `/wp/v2/posts/${postId}`, { data: { meta } });
      }
      await logIntegrationEvent({
        userId,
        integrationSlug: 'wordpress',
        eventType: 'post_published',
        status: 'success',
        response: { postId: postId || null },
      });
      return { status: 'published', platformPostId: String(wpData?.id || '') };
    }

    const connection = await getPublishableSocialConnection(userId, platformId);
    // Facebook Pages publish with their own long-lived Page tokens, which keep
    // working after the user's login token lapses — don't block them on it.
    const facebookPageTokensOnly =
      platformId === 'facebook' &&
      (!connection?.access_token || Boolean(connection?.needs_reapproval)) &&
      await hasStoredFacebookPageToken(userId, options?.destination);
    if (!connection && !facebookPageTokensOnly) throw new Error(`${platform} is not connected`);
    if (!facebookPageTokensOnly && connection?.needs_reapproval) {
      return { status: 'failed', error: `${platform} connection needs re-approval. Please reconnect.`, retryable: false };
    }
    const conn: PublishableSocialConnection = facebookPageTokensOnly
      ? { platform: 'facebook', access_token: '', token_data: connection?.token_data || {}, account_id: connection?.account_id ?? null, account_name: connection?.account_name ?? null }
      : connection!;
    const { access_token, token_data } = conn;
    if (!access_token && !facebookPageTokensOnly) throw new Error(`${platform} access token missing - please reconnect`);

    const PLATFORM_NAMES: Record<string, string> = {
      linkedin: 'LinkedIn', twitter: 'Twitter / X', facebook: 'Facebook',
      instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok',
      pinterest: 'Pinterest',
    };
    const platformName = PLATFORM_NAMES[platformId] || platformId;

    const postUrl = buildPostUrl(post);
    const featuredImage = await resolveBlogPostFeaturedImageUrl(userId, post);

    let author = '';
    try {
      if (pool) {
        const u = await pool.query('SELECT full_name, username FROM users WHERE id=$1', [userId]);
        const row: any = u.rows[0] || {};
        author = String(row.full_name || row.username || '').trim();
      }
    } catch (err) {
    logger.error('Unhandled error:', err);
      author = '';
    }

    const maxLenByPlatform: Record<string, number> = {
      twitter: 280,
      instagram: 2200,
      linkedin: 3000,
      facebook: 63206,
    };
    const maxLen = maxLenByPlatform[platformId] || 3000;
    const customTemplate = String(options?.template || '').trim();
    const title = String(post.title || '').trim();
    // Truncate excerpt to a concise social-friendly length; avoid dumping the full post body
    const rawExcerpt = String(post.excerpt || '').trim();
    const socialExcerpt = rawExcerpt.length > 280
      ? rawExcerpt.slice(0, 277) + '…'
      : rawExcerpt;
    // Don't duplicate: only include excerpt if it differs from the title
    const fallbackCaption = socialExcerpt && socialExcerpt !== title ? socialExcerpt : '';
    const fallbackHashtags = toHashtags((post as any).tag_names);
    const hasCustomCaption = typeof options?.captionOverride === 'string' && options.captionOverride.trim().length > 0;
    const isSocialOnly = post.post_format === 'social_only' || !post.slug;
    const effectivePostUrl = isSocialOnly ? '' : postUrl;

    const fallbackTextParts = [
      title,
      fallbackCaption,
      fallbackHashtags,
      effectivePostUrl,
      // Note: featuredImage is passed as media, NOT embedded in the caption text
    ].filter(Boolean);

    const text = (
      hasCustomCaption
        ? (options!.captionOverride as string)
        : customTemplate
          ? renderMessageTemplate(customTemplate, {
              title: String(post.title || ''),
              excerpt: String(post.excerpt || ''),
              url: effectivePostUrl,
              featured_image: featuredImage,
              author: author,
            })
          : fallbackTextParts.join('\n\n')
    ).trim().slice(0, maxLen);

    const rawAssets: Array<{ url: string; type?: 'image' | 'video' }> = Array.isArray(options?.mediaAssets) && options!.mediaAssets!.length > 0
      ? options!.mediaAssets!
      : Array.isArray(post.media_assets) && post.media_assets.length > 0
        ? post.media_assets
        : [];

    const normalizedMedia: Array<{ url: string; type: 'image' | 'video' }> = [];
    for (const item of rawAssets) {
      const u = String(item?.url || '').trim();
      if (!u) continue;
      const isVid = item?.type === 'video' || /\.(mp4|mov|m4v)(\?|$)/i.test(u);
      normalizedMedia.push({ url: u, type: isVid ? 'video' : 'image' });
    }
    if (normalizedMedia.length === 0 && featuredImage) {
      normalizedMedia.push({ url: featuredImage, type: 'image' });
    }

    if (platformId === 'instagram') {
      const igUserId = String(conn.account_id || '').trim();
      if (!igUserId) {
        return { status: 'failed', error: 'Instagram is not connected. Select an Instagram Business account under Integrations -> Instagram.', retryable: false };
      }

      const requestedFormatRaw = String(options?.mediaType || post.post_format || 'FEED_POST').toUpperCase();
      const igFormat: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY' =
        requestedFormatRaw === 'CAROUSEL' ? 'CAROUSEL'
        : (requestedFormatRaw === 'REEL' || requestedFormatRaw === 'REELS' || requestedFormatRaw === 'SHORT_VIDEO') ? 'REEL'
        : (requestedFormatRaw === 'STORY' || requestedFormatRaw === 'STORIES') ? 'STORY'
        : 'FEED_POST';

      // Uses pre-computed normalizedMedia

      if (normalizedMedia.length === 0) {
        const videoCandidate = String(post.video_url || '').trim();
        if ((igFormat === 'REEL' || igFormat === 'STORY') && videoCandidate) {
          normalizedMedia.push({ url: videoCandidate, type: 'video' });
        } else if (featuredImage) {
          normalizedMedia.push({ url: featuredImage, type: /\.(mp4|mov|m4v)(\?|$)/i.test(featuredImage) ? 'video' : 'image' });
        }
      }

      if (normalizedMedia.length === 0 || normalizedMedia.some((m) => !/^https?:\/\//i.test(m.url))) {
        return {
          status: 'failed',
          error: `Instagram ${igFormat} publishing requires public HTTP(S) media URLs. Ensure media is uploaded and publicly fetchable.`,
          retryable: false,
        };
      }

      if (igFormat === 'CAROUSEL' && (normalizedMedia.length < 2 || normalizedMedia.length > 10)) {
        return {
          status: 'failed',
          error: `Instagram CAROUSEL requires between 2 and 10 media items (received ${normalizedMedia.length}).`,
          retryable: false,
        };
      }

      if (igFormat === 'REEL' && normalizedMedia[0].type !== 'video') {
        return {
          status: 'failed',
          error: 'Instagram REEL publishing requires a public MP4/MOV video URL.',
          retryable: false,
        };
      }

      const finalCaption = (options?.captionOverride ? String(options.captionOverride) : text).trim().slice(0, maxLen);
      const instagramPost: PostObject = {
        type: igFormat,
        content: { text: finalCaption },
        media: igFormat === 'CAROUSEL' ? normalizedMedia.slice(0, 10) : [normalizedMedia[0]],
      };
      const validation = instagramBusinessPlatform.validate(instagramPost);
      if (!validation.ok) {
        return { status: 'failed', error: validation.error, retryable: false };
      }

      await acquirePlatformSlot('instagram');
      const instagramCfg = await getPlatformConfig('instagram');
      const facebookCfg = await getPlatformConfig('facebook');
      const igGraphBase = resolveInstagramGraphBase({ accessToken: access_token, tokenData: token_data });
      const result = await instagramBusinessPlatform.post(instagramPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
        helpers: {
          graphBase: igGraphBase,
          appId: String(instagramCfg.appId || facebookCfg.appId || process.env.VITE_FACEBOOK_APP_ID || '').trim() || undefined,
          appSecret: String(instagramCfg.appSecret || facebookCfg.appSecret || process.env.FACEBOOK_APP_SECRET || '').trim() || undefined,
        },
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'instagram',
          eventType: 'post_published',
          status: 'success',
          response: {
            platformPostId: result.platformPostId || null,
            mediaType: igFormat,
            mediaCount: instagramPost.media?.length ?? 1,
            instagramId: conn.account_id || null,
            pageId: token_data?.pageId || null,
          },
        });
      }

      return {
        status: result.status,
        platformPostId: result.platformPostId,
        error: result.error,
        retryable: result.retryable,
      };
    }

    if (platformId === 'pinterest') {
      if (!featuredImage || !/^https?:\/\//i.test(featuredImage)) {
        return { status: 'failed', error: 'Pinterest publishing requires a public image URL. Set a featured image first.' };
      }

      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;

      let boardId = destination?.type === 'board' ? String(destination.id || '').trim() || null : null;

      // Preferred: user-configured default board (set from Analytics -> Pinterest)
      if (!boardId) {
        try {
          const defaultBoardSetting = await getUserSettingValue(userId, 'pinterest.default_board');
          const obj = safeJsonObject(defaultBoardSetting);
          const savedBoardId = String(obj?.id || obj?.board_id || '').trim();
          if (savedBoardId) boardId = savedBoardId;
        } catch (err) {
    logger.error('Unhandled error:', err);
          // ignore
        }
      }

      // Back-compat: previously saved boards (Integrations -> Pinterest -> Manage)
      if (!boardId && pool) {
        const boardRows = await pool.query(
          `SELECT account_id
           FROM social_accounts
           WHERE user_id=$1 AND platform='pinterest' AND account_type='board' AND connected=true
           ORDER BY created_at DESC
           LIMIT 1`,
          [userId]
        );
        boardId = boardRows.rows[0]?.account_id ? String(boardRows.rows[0].account_id).trim() : null;
      }

      // Last resort: pick the first available board from the Pinterest API (and store it as default)
      if (!boardId) {
        try {
          const boardsResp = await axios.get('https://api.pinterest.com/v5/boards', {
            headers: { Authorization: `Bearer ${access_token}` },
            params: { page_size: 1 },
            validateStatus: () => true,
            timeout: 15000,
          });
          const boardsData: any = boardsResp.data || {};
          if (boardsResp.status < 400) {
            const first = Array.isArray(boardsData?.items) ? boardsData.items[0] : null;
            const firstId = first?.id ? String(first.id).trim() : '';
            const firstName = first?.name ? String(first.name).trim() : '';
            if (firstId) {
              boardId = firstId;
              if (pool) {
                await pool
                  .query(
                    `INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
                     VALUES ($1, 'pinterest.default_board', $2::jsonb, NOW(), NOW())
                     ON CONFLICT (user_id, key) DO UPDATE SET
                       value = EXCLUDED.value,
                       updated_at = NOW()`,
                    [userId, JSON.stringify({ id: firstId, name: firstName || null })]
                  )
                  .catch(() => undefined);
              }
            }
          }
        } catch (err) {
    logger.error('Unhandled error:', err);
          // ignore
        }
      }

      if (!boardId) {
        return {
          status: 'failed',
          error: 'No Pinterest board selected. Pick a default board in Analytics → Pinterest, or create a board on Pinterest first.',
        };
      }

      const pinBody: any = {
        board_id: boardId,
        title: String(post.title || '').trim().slice(0, 100) || 'New post',
        description: String(options?.captionOverride || post.excerpt || '').trim().slice(0, 500),
        link: effectivePostUrl || undefined,
        media_source: { source_type: 'image_url', url: (normalizedMedia.find((m) => m.type === 'image')?.url || featuredImage) },
      };

      const pinResp = await axios.post('https://api.pinterest.com/v5/pins', pinBody, {
        headers: { Authorization: `Bearer ${access_token}` },
        validateStatus: () => true,
        timeout: 20000,
      });
      const pinData: any = pinResp.data || {};
      if (pinResp.status >= 400) {
        let msg = pinData?.message || pinData?.error || `Pinterest API error ${pinResp.status}`;
        if (typeof msg === 'string' && msg.includes('boards:write')) {
          msg = 'Pinterest permission missing: boards:write. Reconnect Pinterest in Integrations, then try again.';
        }
        return { status: 'failed', error: msg };
      }
      const pinId = String(pinData?.id || '').trim();
      await logIntegrationEvent({
        userId,
        integrationSlug: 'pinterest',
        eventType: 'post_published',
        status: 'success',
        response: { platformPostId: pinId || null, boardId },
      });
      return { status: 'published', platformPostId: pinId || '' };
    }

    if (platformId === 'linkedin') {
      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;
      const linkedinPost: PostObject = {
        type: 'UGC_POST',
        content: { text },
        destination: destination ? {
          type: destination.type,
          id: destination.id,
          name: destination.name,
        } : undefined,
        media: normalizedMedia.length > 0
          ? normalizedMedia
          : (featuredImage && (/^https?:\/\//i.test(featuredImage) || featuredImage.startsWith('data:'))
              ? [{ url: featuredImage, type: 'image' }]
              : undefined),
      };

      const validation = linkedInPlatform.validate(linkedinPost);
      if (!validation.ok) {
        return { status: 'failed', error: validation.error };
      }

      await acquirePlatformSlot('linkedin');
      const result = await linkedInPlatform.post(linkedinPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
        helpers: {
          resolveAuthorUrn: async (ctx: any) => {
            if (destination?.type === 'page') {
              const organizationId = String(destination.id || '').trim();
              if (!organizationId) return null;
              return `urn:li:organization:${organizationId}`;
            }
            return resolveLinkedInAuthorUrn({ userId, accessToken: ctx.accessToken });
          },
        },
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'linkedin',
          eventType: 'post_published',
          status: 'success',
          response: {
            platformPostId: result.platformPostId || null,
            destinationType: destination?.type || 'profile',
            destinationId: destination?.id || null,
          },
        });
      }

      return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
    }

    if (platformId === 'twitter') {
      if (TWITTER_MONTHLY_WRITE_LIMIT > 0) {
        const counter = await incrementPlatformMonthlyCounter('twitter', TWITTER_MONTHLY_WRITE_LIMIT);
        if (!counter.allowed) {
          return { status: 'failed', error: 'X posting paused: global monthly limit reached.', retryable: false };
        }
      }

      const twitterPost: PostObject = {
        type: 'TWEET',
        content: { text: text.slice(0, 280) },
        ...(normalizedMedia.length > 0 ? { media: normalizedMedia } : (featuredImage ? { media: [{ url: featuredImage, type: 'image' }] } : {})),
      };

      const validation = twitterXPlatform.validate(twitterPost);
      if (!validation.ok) {
        return { status: 'failed', error: validation.error };
      }

      await acquirePlatformSlot('twitter');
      const result = await twitterXPlatform.post(twitterPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'twitter',
          eventType: 'post_published',
          status: 'success',
          response: { platformPostId: result.platformPostId || null },
        });
      } else {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'twitter',
          eventType: 'post_publish_failed',
          status: 'failed',
          response: { error: result.error || 'Twitter publish failed' },
        });
      }

      return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
    }

    if (platformId === 'facebook') {
      const destination = options?.destination && typeof options.destination === 'object'
        ? (options.destination as any)
        : undefined;

      if (destination?.type && destination.type !== 'page') {
        return { status: 'failed', error: 'Facebook Pages only. Groups and profiles are not supported.', retryable: false };
      }

      const media = normalizedMedia.length > 0
        ? normalizedMedia
        : (featuredImage && (/^https?:\/\//i.test(featuredImage) || featuredImage.startsWith('data:'))
            ? [{ url: featuredImage, type: 'image' as const }]
            : undefined);

      const facebookPost: PostObject = {
        type: 'FEED_POST',
        content: { text, link: effectivePostUrl || undefined },
        destination: destination ? {
          type: destination.type,
          id: destination.id,
          name: destination.name,
        } : undefined,
        media,
      };

      await acquirePlatformSlot('facebook');
      const result = await facebookPagesPlatform.post(facebookPost, {
        accessToken: access_token,
        accountId: conn.account_id,
        accountName: conn.account_name,
        tokenData: token_data,
        helpers: {
          graphBase: META_GRAPH_BASE,
          resolvePageToken: async (dest: any) => resolveFacebookPageToken({
            userId,
            userAccessToken: access_token,
            destination: dest,
          }),
        },
      });

      if (result.status === 'published') {
        await logIntegrationEvent({
          userId,
          integrationSlug: 'facebook',
          eventType: 'post_published',
          status: 'success',
          response: { platformPostId: result.platformPostId || null },
        });
      }

      return { status: result.status, platformPostId: result.platformPostId, error: result.error, retryable: result.retryable };
    }

    if (platformId === 'threads') {
      const threadsBase = 'https://graph.threads.net/v1.0';
      let threadsUserId = String(token_data?.user_id || token_data?.userId || token_data?.id || '').trim();
      if (!threadsUserId) {
        const meResp = await axios.get(`${threadsBase}/me?fields=id&access_token=${encodeURIComponent(access_token)}`, {
          validateStatus: () => true,
          timeout: 15000,
        });
        const meData: any = meResp.data || {};
        if (meResp.status >= 400) {
          throw new Error(meData?.error?.message || `Threads profile lookup failed (${meResp.status})`);
        }
        threadsUserId = String(meData?.id || '').trim();
      }
      if (!threadsUserId) throw new Error('Threads user id not available');

      const createParams = new URLSearchParams({
        media_type: featuredImage ? 'IMAGE' : 'TEXT',
        text,
        ...(featuredImage ? { image_url: featuredImage } : {}),
        access_token: access_token,
      });
      const createResp = await axios.post(
        `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads`,
        createParams.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const createData: any = createResp.data || {};
      if (createResp.status >= 400) {
        throw new Error(createData?.error?.message || `Threads create error ${createResp.status}`);
      }
      const creationId = String(createData?.id || '').trim();
      if (!creationId) throw new Error('Threads creation id missing');

      // Media containers must finish processing before they can be published
      // (Meta suggests ~30 s); text containers are ready at once.
      if (featuredImage) {
        const readiness = await waitForThreadsContainer(threadsBase, creationId, access_token);
        if (readiness.status === 'error') return { status: 'failed', error: readiness.message, retryable: false };
        if (readiness.status === 'timeout') return { status: 'failed', error: readiness.message, retryable: true };
      }

      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: access_token,
      });
      const pubResp = await axios.post(
        `${threadsBase}/${encodeURIComponent(threadsUserId)}/threads_publish`,
        publishParams.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const pubData: any = pubResp.data || {};
      if (pubResp.status >= 400) {
        const msg = pubData?.error?.message || `Threads publish error ${pubResp.status}`;
        return { status: 'failed', error: msg, retryable: pubResp.status === 429 || pubResp.status >= 500 };
      }
      return { status: 'published', platformPostId: String(pubData?.id || '') };
    }

    if (platformId === 'tiktok') {
      const rawVideoUrl = String((post as any)?.video_url || (post as any)?.video || (post as any)?.featured_video || (options as any)?.videoUrl || '').trim();
      const mediaCandidate = rawVideoUrl || featuredImage;
      if (!mediaCandidate || !/^https?:\/\//i.test(mediaCandidate)) {
        return {
          status: 'failed',
          error: 'TikTok posts need a public image or video. Add media to publish this post to TikTok.',
          retryable: false,
        };
      }

      const isVideo = Boolean(rawVideoUrl) || /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(mediaCandidate);

      // Step 1: Query creator info to get posting capabilities
      const creatorResp = await axios.get(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        {
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );
      const creatorData: any = creatorResp.data || {};
      if (creatorResp.status >= 400) {
        const msg = creatorData?.error?.message || `TikTok creator info failed (${creatorResp.status})`;
        return { status: 'failed', error: msg, retryable: creatorResp.status >= 500 };
      }
      const creatorInfo = creatorData?.data || {};
      const privacyOptions: string[] = Array.isArray(creatorInfo?.privacy_level_options)
        ? creatorInfo.privacy_level_options
        : ['PUBLIC_TO_EVERYONE'];
      const privacyLevel = privacyOptions.includes('PUBLIC_TO_EVERYONE')
        ? 'PUBLIC_TO_EVERYONE'
        : privacyOptions[0] || 'PUBLIC_TO_EVERYONE';
      const duetDisabled  = creatorInfo?.duet_disabled  ?? false;
      const stitchDisabled = creatorInfo?.stitch_disabled ?? false;
      const commentDisabled = creatorInfo?.comment_disabled ?? false;

      const postCaption = text.slice(0, 2200);

      const postInfo = {
        title: postCaption,
        privacy_level: privacyLevel,
        disable_duet: duetDisabled,
        disable_stitch: stitchDisabled,
        disable_comment: commentDisabled,
      };

      if (isVideo) {
        // Video publishing: Support both pull_by_url (PULL_FROM_URL) and push_by_file (FILE_UPLOAD)
        let publishId = '';

        // Attempt PULL_FROM_URL first
        const pullBody = {
          post_info: postInfo,
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: mediaCandidate,
          },
        };

        const pullResp = await axios.post(
          'https://open.tiktokapis.com/v2/post/publish/video/init/',
          pullBody,
          {
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
            validateStatus: () => true,
            timeout: 20000,
          }
        );
        const pullData: any = pullResp.data || {};
        const pullErrorCode = String(pullData?.error?.code || 'ok');

        if (pullResp.status < 400 && pullErrorCode === 'ok' && pullData?.data?.publish_id) {
          publishId = String(pullData.data.publish_id).trim();
        } else {
          // If pull_by_url failed (e.g. unverified domain / ownership error), fallback to push_by_file (FILE_UPLOAD)
          logger.info(`[TikTok] PULL_FROM_URL video init returned (${pullResp.status}, ${pullErrorCode}). Falling back to push_by_file (FILE_UPLOAD)... `);

          try {
            const vidRes = await axios.get(mediaCandidate, {
              responseType: 'arraybuffer',
              timeout: 60000,
              maxContentLength: 100 * 1024 * 1024,
            });
            const videoBuf = Buffer.from(vidRes.data);
            const videoSize = videoBuf.length;

            const uploadInitResp = await axios.post(
              'https://open.tiktokapis.com/v2/post/publish/video/init/',
              {
                post_info: postInfo,
                source_info: {
                  source: 'FILE_UPLOAD',
                  video_size: videoSize,
                  chunk_size: videoSize,
                  total_chunk_count: 1,
                },
              },
              {
                headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
                validateStatus: () => true,
                timeout: 20000,
              }
            );
            const uploadInitData: any = uploadInitResp.data || {};
            const uploadInitErrorCode = String(uploadInitData?.error?.code || 'ok');
            if (uploadInitResp.status >= 400 || uploadInitErrorCode !== 'ok') {
              const errMsg = uploadInitData?.error?.message || `TikTok video FILE_UPLOAD init failed (${uploadInitResp.status})`;
              return { status: 'failed', error: errMsg, retryable: uploadInitResp.status >= 500 };
            }

            const uploadUrl = String(uploadInitData?.data?.upload_url || '').trim();
            publishId = String(uploadInitData?.data?.publish_id || '').trim();

            if (!uploadUrl || !publishId) {
              return { status: 'failed', error: 'TikTok did not return upload_url or publish_id for push_by_file' };
            }

            // Stream / PUT binary to TikTok upload_url
            const putResp = await axios.put(uploadUrl, videoBuf, {
              headers: {
                'Content-Type': 'video/mp4',
                'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
              },
              validateStatus: () => true,
              timeout: 120000,
              maxBodyLength: Infinity,
            });

            if (putResp.status >= 400) {
              return { status: 'failed', error: `TikTok video file upload PUT failed (${putResp.status})` };
            }
          } catch (fileUploadErr) {
            const uploadErrMsg = fileUploadErr instanceof Error ? fileUploadErr.message : 'Unknown upload error';
            return {
              status: 'failed',
              error: `TikTok video posting failed (PULL_FROM_URL: ${pullData?.error?.message || pullErrorCode}; FILE_UPLOAD: ${uploadErrMsg})`,
            };
          }
        }

        if (!publishId) {
          return { status: 'failed', error: 'TikTok did not return a publish_id for video' };
        }

        await logIntegrationEvent({ userId, integrationSlug: 'tiktok', eventType: 'post_published', status: 'success', response: { publishId, mediaType: 'video' } });
        return { status: 'published', platformPostId: publishId };
      }

      // Step 2: Initialize a photo post pulled from the image URL
      const initBody = {
        post_info: postInfo,
        source_info: {
          source: 'PULL_FROM_URL',
          photo_images: [mediaCandidate],
          photo_cover_index: 0,
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      };
      const initResp = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/content/init/',
        initBody,
        {
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      const initData: any = initResp.data || {};
      const initErrorCode = String(initData?.error?.code || 'ok');
      if (initResp.status >= 400 || initErrorCode !== 'ok') {
        const rawMsg = String(initData?.error?.message || '');
        const isDomainError = /domain|unverified|ownership/i.test(rawMsg) || /domain|unverified|ownership/i.test(initErrorCode);
        const msg = isDomainError
          ? `TikTok photo post requires a verified domain for PULL_FROM_URL (${rawMsg || initErrorCode}). Verify your domain in TikTok Developer Portal → Content Posting API → Domain Verification (file verification is automatically supported at https://marketing.dakyx.com/tiktok*.txt).`
          : (rawMsg || `TikTok photo post init failed (${initResp.status}${initErrorCode !== 'ok' ? `, ${initErrorCode}` : ''})`);
        return { status: 'failed', error: msg, retryable: initResp.status === 429 || initResp.status >= 500 };
      }
      const publishId = String(initData?.data?.publish_id || '').trim();
      if (!publishId) return { status: 'failed', error: 'TikTok did not return a publish_id' };
      await logIntegrationEvent({ userId, integrationSlug: 'tiktok', eventType: 'post_published', status: 'success', response: { publishId, mediaType: 'photo' } });
      return { status: 'published', platformPostId: publishId };
    }

    logger.info(`[Distribution] ${platformName}: token available, platform publishing not yet implemented`);
    return { status: 'failed', error: `${platformName} publishing is not implemented yet` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'failed', error: msg, retryable: /timeout|ECONN|network/i.test(msg) };
  }
}

// GET /api/distribution/connected (router mounted at /api — no prefix here)
router.get('/distribution/connected', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const visiblePlatforms = await getVisibleUserPlatformSlugs();

    const platforms: { id: string; name: string }[] = [];

    const wpRows = await pool!.query('SELECT id FROM wordpress_connections WHERE user_id=$1', [auth.userId]);
    if (wpRows.rows.length > 0) platforms.push({ id: 'wordpress', name: 'WordPress' });

    const socialRows = await pool!.query(
      'SELECT platform FROM social_accounts WHERE user_id=$1 AND connected=true', [auth.userId]
    );
    const SOCIAL_NAMES: Record<string, string> = {
      instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
      twitter: 'Twitter / X', tiktok: 'TikTok', threads: 'Threads',
      pinterest: 'Pinterest',
    };
    const seen = new Set<string>();
    for (const row of socialRows.rows) {
      const id = normalizePlatformId(row.platform);
      if (!id || !SOCIAL_NAMES[id] || seen.has(id)) continue;
      if (visiblePlatforms.length > 0 && !visiblePlatforms.includes(id)) continue;
      seen.add(id);
      platforms.push({ id, name: SOCIAL_NAMES[id] });
    }

    return res.json({ success: true, platforms });
  } catch (err) {
    logger.error('Unhandled error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch connected platforms' });
  }
});

// POST /api/distribution/publish
router.post('/distribution/publish', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { postId, platforms } = req.body as { postId: string; platforms: string[] };
    if (!postId || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'postId and platforms required' });
    }

    const postRows = await pool!.query(
      `SELECT p.*,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p
       WHERE p.id=$1 AND p.user_id=$2`,
      [postId, auth.userId]
    );
    if (!postRows.rows.length) return res.status(404).json({ success: false, error: 'Post not found' });
    const post = postRows.rows[0];

    const results: { platform: string; status: string; error?: string; platformPostId?: string }[] = [];
    for (const platform of platforms) {
      const platformId = normalizePlatformId(platform);
      if (!platformId) {
        results.push({ platform: String(platform), status: 'failed', error: 'Invalid platform' });
        continue;
      }
      const result = await publishToplatform(auth.userId, post, platformId);
      const logId = randomUUID();
      await pool!.query(
        'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,platform_post_id,error_message,posted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [logId, postId, auth.userId, platformId, result.status, result.platformPostId || null, result.error || null, result.status === 'published' ? new Date().toISOString() : null]
      );
      results.push({ platform: platformId, ...result });
    }

    return res.json({ success: true, results });
  } catch (err) {
    logger.error('Unhandled error:', err);
    return res.status(500).json({ success: false, error: 'Distribution failed' });
  }
});

// GET /api/distribution/status/:postId
router.get('/distribution/status/:postId', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { postId } = req.params;
    const { rows } = await pool!.query(
      'SELECT * FROM publishing_logs WHERE post_id=$1 AND user_id=$2 ORDER BY created_at DESC',
      [postId, auth.userId]
    );
    return res.json({ success: true, logs: rows });
  } catch (err) {
    logger.error('Unhandled error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch status' });
  }
});

// GET /api/automation/logs
router.get('/automation/logs', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { rows } = await pool!.query(
      `SELECT l.*, p.title as post_title FROM publishing_logs l
       LEFT JOIN blog_posts p ON p.id = l.post_id
       WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
      [auth.userId]
    );
    return res.json({ success: true, logs: rows });
  } catch (err) {
    logger.error('Unhandled error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

// POST /api/automation/retry/:logId
router.post('/automation/retry/:logId', async (req: Request, res: Response) => {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { logId } = req.params;
    // Only a failed entry is retried, and the claim makes a double click (or
    // a retry racing the automation worker) publish once.
    const claimed = await pool!.query(
      `UPDATE publishing_logs SET status='processing', error_message=NULL
       WHERE id=$1 AND user_id=$2 AND status IN ('failed','error')
       RETURNING *`,
      [logId, auth.userId]
    );
    if (!claimed.rows.length) {
      const existing = await pool!.query('SELECT status FROM publishing_logs WHERE id=$1 AND user_id=$2', [logId, auth.userId]);
      if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Log not found' });
      const status = String((existing.rows[0] as any).status || '');
      return res.status(409).json({
        success: false,
        error: status === 'published' ? 'This post was already published; retrying would post it again.' : `This post is ${status || 'in progress'} and cannot be retried now.`,
      });
    }
    const log = claimed.rows[0];
    const releaseClaim = (error: string) =>
      pool!.query(`UPDATE publishing_logs SET status='failed', error_message=$1 WHERE id=$2 AND user_id=$3`, [error, logId, auth.userId]).catch(() => undefined);

    const postRows = await pool!.query(
      `SELECT p.*,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p
       WHERE p.id=$1 AND p.user_id=$2`,
      [log.post_id, auth.userId]
    );
    if (!postRows.rows.length) {
      await releaseClaim('Post not found');
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    // Publish to the same destination (Page, company, board) with the same
    // template as the automation that produced this entry.
    const taskRows = await pool!.query(
      `SELECT id, payload FROM social_automation_tasks WHERE log_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [logId, auth.userId]
    ).catch(() => ({ rows: [] as any[] }));
    const task = taskRows.rows[0] as { id: string; payload: unknown } | undefined;
    const payload = safeJsonObject(task?.payload);
    const destination = payload?.destination || null;
    const template = payload?.template ? String(payload.template) : '';

    const platformId = normalizePlatformId(log.platform);
    let result: Awaited<ReturnType<typeof publishToplatform>>;
    try {
      result = await publishToplatform(auth.userId, postRows.rows[0], platformId, { template, destination });
    } catch (err) {
      await releaseClaim(err instanceof Error ? err.message : 'Retry failed');
      throw err;
    }
    const finalStatus = result.status === 'published' ? 'published' : 'failed';
    await pool!.query(
      `UPDATE publishing_logs
       SET status=$1, platform_post_id=$2, error_message=$3, response=$4,
           posted_at = CASE WHEN $1 = 'published' THEN NOW() ELSE posted_at END
       WHERE id=$5 AND user_id=$6`,
      [finalStatus, result.platformPostId || null, result.error || null, result as any, logId, auth.userId]
    );
    if (task) {
      await pool!.query(
        `UPDATE social_automation_tasks SET status=$2, last_error=$3, updated_at=NOW() WHERE id=$1 AND status='failed'`,
        [task.id, finalStatus, result.error || null]
      ).catch(() => undefined);
    }
    await insertSocialPostLog({
      userId: auth.userId,
      postId: String(log.post_id),
      platform: platformId,
      destination,
      status: finalStatus,
      apiResponse: result,
      postedAtIso: finalStatus === 'published' ? new Date().toISOString() : null,
    });
    return res.json({ success: true, result: { ...result, status: finalStatus } });
  } catch (err) {
    logger.error('Unhandled error:', err);
    return res.status(500).json({ success: false, error: 'Retry failed' });
  }
});

// Meta deauthorize / data-deletion callbacks live in complianceRoutes.ts.



  return {
    router, publishToplatform,
    getPublishableSocialConnection,
    markSocialAccountNeedsReapproval,
    listLinkedInAdminOrganizations,
    fetchLinkedInOrganizationNetworkSize,
    refreshLinkedInAccessToken,
    fetchLinkedInSocialMetadataBatch,
    fetchLinkedInShareStatisticsForPosts,
    sumLinkedInReactionCounts,
    startSocialAutomationProcessor,
    startTokenHealthMonitor,
    normalizePlatformId,
    getSocialTemplateDefaults,
    mergeSocialTemplateSettings,
    renderSocialTemplatePreview,
    loadSocialTemplateSettings,
    enqueueSocialAutomationTask,
    syncSocialAutomationForPost,
    queueSocialAutomationForPublishedPost,
  };
}
