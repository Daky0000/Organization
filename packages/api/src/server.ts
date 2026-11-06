import { buildCreditJobs } from './server/creditJobs.ts';
import { processCampaignEmails } from './server/campaignEmailWorker.ts';
import { processOutboundWebhookJobs } from './middleware/planQuotaMiddleware.ts';
// Sentry first: its uncaught-exception / unhandled-rejection integrations
// must register before anything else runs. No-op unless SENTRY_DSN is set.
import { Sentry, sentryEnabled } from './instrument.ts';
import { Resend } from 'resend';
import express from 'express';
import type { Response, NextFunction } from 'express';
import type { Request } from './types/http.ts';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { z } from 'zod';
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  createHmac,
  timingSafeEqual,
} from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { FacebookPagesPlatform } from '../backend/platforms/facebook_pages.ts';
import { InstagramBusinessPlatform } from '../backend/platforms/instagram_business.ts';
import { LinkedInPlatform } from '../backend/platforms/linkedin.ts';
import { TwitterXPlatform } from '../backend/platforms/twitter_x.ts';
import type { PostObject } from '../backend/platforms/types.ts';
// import { SAMPLE_TEMPLATES } from './src/data/sampleFabricTemplates.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { registerBlogRoutes } from './server/blogRoutes.ts';
import { registerBillingRoutes, registerAdminBillingRoutes } from './server/billingRoutes.ts';
import { registerSurveyRoutes, registerPublicSurveyRoutes } from './server/surveyRoutes.ts';
import { registerLeadsRoutes, registerGoogleSheetsRoutes } from './server/leadsRoutes.ts';
import { registerLeadgenRoutes } from './server/leadgenRoutes.ts';
import { registerPagesRoutes } from './server/pagesRoutes.ts';
import { registerMailingRoutes } from './server/mailingRoutes.ts';
import { registerNotificationRoutes } from './server/notificationsRoutes.ts';
import { registerCampaignRoutes, registerTrackingRoutes, registerShortLinkRoutes } from './server/campaignRoutes.ts';
import { registerOrgRoutes } from './server/orgRoutes.ts';
import { registerCRMCompaniesRoutes } from './server/crmCompaniesRoutes.ts';
import { registerCRMDealsRoutes } from './server/crmDealsRoutes.ts';
import { registerCRMActivitiesRoutes } from './server/crmActivitiesRoutes.ts';
import { registerSalesRoutes } from './server/salesRoutes.ts';
import { buildSalesEngine } from './server/sales/salesEngine.ts';
import { registerCalendarRoutes } from './server/calendarRoutes.ts';
import { registerConnectorRegistryRoutes } from './server/connectorRegistryRoutes.ts';
import { registerConnectorPreferencesRoutes } from './server/connectorPreferencesRoutes.ts';
import { registerConnectorSyncRoutes, processDueConnectorSyncJobs } from './server/connectorSyncRoutes.ts';
import { registerCreditsRoutes } from './server/creditsRoutes.ts';
import { registerApifyRoutes } from './server/apifyRoutes.ts';
import { registerHiggsfieldRoutes } from './server/higgsfieldRoutes.ts';
import { registerKlingRoutes } from './server/klingRoutes.ts';
import { registerGmailInboxRoutes, buildGmailAutoSync } from './server/gmailInboxRoutes.ts';
import { registerGoogleRoutes } from './server/googleRoutes.ts';
import { registerOpenAIRoutes } from './server/openaiRoutes.ts';
import { registerAutomationRoutes } from './server/automationRoutes.ts';
import { buildAutomationEngine } from './server/automationEngine.ts';
import { recalcLeadScore } from './server/leadScoring.ts';
import { registerApiKeyRoutes, registerPublicTriggerRoutes } from './server/publicApiRoutes.ts';
import { registerFormsRoutes, registerPublicFormRoutes } from './server/formsRoutes.ts';
import { registerSiteTrackingRoutes } from './server/trackingRoutes.ts';
import { processStaleAgentCompilations } from './server/agentSharedContext.ts';
import { registerAgentTeamRoutes } from './server/agentTeamRoutes.ts';
import { runDirectorCycle } from './server/agentTeam/coordination.ts';
import { registerMcpAdminRoutes, registerMcpMediaRoutes, seedDefaultMcpServers, processMcpMediaSync } from './server/mcpRoutes.ts';
import { buildMailer } from './server/mailer.ts';
import { buildContentPlanEngine, registerContentPlanRoutes } from './server/contentPlanRoutes.ts';
import { registerHubtelRoutes } from './server/hubtelRoutes.ts';
import { registerPaystackRoutes, getPaystackConfig } from './server/paystackRoutes.ts';
import { registerAISkillsRoutes } from './server/aiSkillsRoutes.ts';
import { registerUserDesignRoutes } from './server/userDesignRoutes.ts';
import { registerDbAuditRoutes } from './server/dbAuditRoutes.ts';
import { registerSocialAuthRoutes } from './server/socialAuthRoutes.ts';
import { registerMemoryAgentRoutes } from './server/memoryAgentRoutes.ts';
import { registerOnboardingRoutes } from './server/onboardingRoutes.ts';
import { registerDakyLearnRoutes } from './server/dakyLearnRoutes.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { requestIdMiddleware } from './middleware/requestId.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { validateBody } from './middleware/validate.ts';
import { authLimiter, passwordLimiter, idempotencyMiddleware } from './middleware/rateLimiter.ts';
import { registerDakyworldOsRoutes } from './server/dakyworldOsRoutes.ts';
import { registerSocialInboxRoutes } from './server/socialInboxRoutes.ts';
import { registerClientApprovalAndWebhookRoutes, runDueAgentSchedules } from './server/clientApprovalRoutes.ts';
import { registerAutopilotRoutes } from './server/autopilot/autopilotRoutes.ts';
import { createAutopilotRepository } from './server/autopilot/repository.ts';
import { buildAutopilotVisualAdapter, buildAutopilotCopyAdapter, getAutopilotProviderStatus } from './server/autopilot/autopilotProviderBridge.ts';
import { processDueAutopilotPublications } from './server/autopilot/lifecycleAndPublishingService.ts';
import { buildWorkflowEngine } from './server/workflowRoutes.ts';
import { registerAIChatRoutes } from './server/aiChatRoutes.ts';
import { registerMagnificRoutes, getMagnificApiKey, getFreepikApiKey, magnificPost, pollMagnificTask, magnificGenerateImage, freepikGenerateImage, MAGNIFIC_BASE, FREEPIK_BASE, ASPECT_TO_WH, MAGNIFIC_IMAGE_MODELS, MAGNIFIC_VIDEO_MODELS, ASPECT_RATIO_MAP, FREEPIK_IMAGE_MODELS, proxyHeaders, sanitizeMagnificError } from './server/magnificRoutes.ts';
import { buildNovaModule } from './server/novaRoutes.ts';
import { registerAnalyticsRoutes, buildAnalyticsAutoSync } from './server/analyticsRoutes.ts';
import { buildDistributionModule } from './server/distributionRoutes.ts';
import { registerAuthRoutes } from './server/authRoutes.ts';
import { registerDakyxRoutes, reconcileDakyxGrants, runDakyxMigrations } from './server/dakyxRoutes.ts';
import { registerUserRoutes } from './server/userRoutes.ts';
import { registerAIConfigRoutes } from './server/aiConfigRoutes.ts';
import { registerPlatformConfigRoutes } from './server/platformConfigRoutes.ts';
import { registerComplianceRoutes } from './server/complianceRoutes.ts';
import { registerWebhookRoutes } from './server/webhookRoutes.ts';
import { registerLinkedInRoutes } from './server/linkedinRoutes.ts';
import { registerSocialConnectRoutes, type SocialConnectDeps } from './server/socialConnectRoutes.ts';
import { registerSocialRoutes } from './server/socialRoutes.ts';
import { buildMediaModule } from './server/mediaRoutes.ts';
import { registerCardTemplateRoutes } from './server/cardRoutes.ts';
import { registerPricingRoutes } from './server/pricingRoutes.ts';
import { registerWordPressRoutes } from './server/wordpressRoutes.ts';
import { runPaymentMigrations } from './payment-migrations.ts';
import { runDatabaseMigrations } from './db-migrations.ts';
import { migrateLegacyTokenData } from './token-data.ts';
import { pool, dbReady, setDbReady, setDbInitError, dbInitError, hasDatabase, dbQuery, normalizeEmail, normalizeUsername } from './db.ts';
import type {
  DbUserRow, AdminDbRole, AdminDbStatus, DbPricingPlan, DbCardTemplate, PlatformConfigRow,
} from './user-auth.ts';
import {
  inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,
  inMemoryPricingPlansById, inMemoryCardTemplatesById, inMemoryPlatformConfigs,
  getPlatformConfig, isPlatformEnabled, getResendConfig,
  upsertInMemoryUser, seedInMemoryUsers,
  getUserPlanName, getEffectivePlan, userToAuthPayload, JWT_EXPIRES_IN, signToken, getAuthUser,
  findUserByEmail, findUserByUsername, findUserByIdentifier, getUserById,
  createUser, updateLastLogin, ensureSeedUser, ensureSeedUsers, ensureSeedPricingPlans,
  updateUserProfile,
  requireAuth, checkTokenVersion, requireAdmin, requireOrgMembership,
} from './user-auth.ts';
import {
  encryptIntegrationSecret, decryptIntegrationSecret, decryptPlatformConfig, getIntegrationRowBySlug,
  logIntegrationEvent, upsertUserIntegration,
  encryptWordPressPassword, decryptWordPressPassword, normalizeWordPressSiteUrl,
  getWordPressConnection, getMakeWebhookConnection,
  ensureWordPressSocialAccount, removeWordPressSocialAccount, isValidWebhookUrl, wpRequest,
} from './integration-helpers.ts';
import {
  LINKEDIN_DEFAULT_OAUTH_SCOPES, LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS,
  getLinkedInOAuthScopeString, parseLinkedInScopeList,
  getLinkedInScopeSet, hasAnyLinkedInScope, hasAllLinkedInScopes,
  getLinkedInOrganizationScopeError, shouldEnableLinkedInExtendedLogin,
  computeIsoFromTtlSeconds,
  createNotification, logTaskActivity, checkTaskActions,
} from './social-helpers.ts';
import {
  AI_CONFIG_PLATFORM, GEMINI_MODELS, ANTHROPIC_TO_GEMINI,
  getAIConfig, resolveActiveKey, callAINonStreaming, decryptAIKey,
} from './ai-helpers.ts';
import {
  AGENT_DEFS, provisionUserAgents, compileAgentSkill, triggerAgentCompilation,
} from './agent-helpers.ts';
import {
  getCalendarCache, setCalendarCache, clearCalendarCacheForUser,
  getClientIp, checkLinkMetadataRateLimit, fetchLinkMetadata,
  recordAuditLog,
} from './link-metadata.ts';
import {
  getUserSaaSContext, getEnabledPlatformSlugs, isOAuthClientSecretRequired,
  getVisibleUserPlatformSlugs, formatSocialAccountLabel, getUserConnectedAccounts,
  OAUTH_AUTH_URLS, resolveOAuthRedirectUri, buildOAuthAuthorizeUrl, resolveInstagramAppConfig,
} from './platform-helpers.ts';
import { runDueDateAlerts, publishDuePosts, runTaskReminders, runWeeklyPostScans } from './scheduler.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);



// Logged once at boot in production: flags configuration gaps that won't
// break startup but will silently degrade a live deployment.
async function runProductionReadinessChecks(): Promise<void> {
  if (config.nodeEnv !== 'production') return;
  if (!sentryEnabled) {
    logger.warn({ check: 'sentry' }, 'launch_check: SENTRY_DSN is not set — production errors will only reach the logs');
  }

  const resendCfg = await getResendConfig().catch(() => null);
  if (resendCfg?.apiKey && !(await getPlatformConfig('resend').catch(() => ({} as Record<string, string>))).webhookSecret && !process.env.RESEND_WEBHOOK_SECRET) {
    logger.warn({ check: 'resend_webhook' }, 'launch_check: Resend is configured without a webhook signing secret — engagement events (opens/clicks/bounces) will be discarded');
  }
  if (process.env.ENABLE_TEST_USER_CREDITS === 'true') {
    logger.warn({ check: 'test_credits' }, 'launch_check: ENABLE_TEST_USER_CREDITS is on — the "User One" account is granted 1,000,000 credits on every deploy');
  }
}

const app = express();
const PORT = config.port;

// Behind Railway's proxy: without this, req.ip is the proxy for every
// request, so per-IP rate limits (login, public API, pixel) would be shared
// globally instead of per client.
app.set('trust proxy', 1);

// AI Sales OS. Built before the automation engine (whose call/follow-up steps
// delegate to it) and before the webhook router (which normalizes provider call
// events through it).
const salesEngine = buildSalesEngine({ pool: pool!, getPlatformConfig });

// Automation engine executes the flows built in Marketing → Automations.
// Built before all routes so public forms, webhooks, and mailing can fire triggers.
const automationEngine = buildAutomationEngine({ pool, getResendConfig, getPlatformConfig, appUrl: config.appUrl, salesEngine });

// Unified platform mailer: switch between the hosting provider's SMTP inbox
// (Admin → Platform Settings → smtp) and Resend via the `email` config.
const mailer = buildMailer({ getPlatformConfig, getResendConfig });

// Auto-content plans: background generation of promo content + featured images.
const contentPlanEngine = buildContentPlanEngine({ pool: pool!, createNotification, sendPlatformEmail: mailer.sendPlatformEmail });


// Request IDs first so even health checks carry x-request-id
app.use(requestIdMiddleware);

// Registered BEFORE all other middleware so nothing can intercept it
app.get('/ping', (_req, res) => res.send('pong'));
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', async (_req, res) => {
  let ready = dbReady;
  let migrationVersion = '2026.10.29-autopilot-v2-production';
  if (ready && config.databaseUrl) {
    try {
      await pool.query('SELECT 1');
      const migRes = await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').catch(() => ({ rows: [] }));
      if (migRes.rows?.[0]?.version) {
        migrationVersion = migRes.rows[0].version;
      }
    }
    catch { ready = false; }
  }
  const providerStatus = await getAutopilotProviderStatus(pool);
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    timestamp: new Date().toISOString(),
    service: 'contentflow-api',
    revision: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'master',
    migrationVersion,
    db: { configured: Boolean(config.databaseUrl), ready },
    autopilot: {
      providers: providerStatus,
      status: 'operational',
    },
  });
});

// Public hosted lead-capture forms (/f/:id). Mounted BEFORE the CORS and
// helmet middleware on purpose: the page must be embeddable in iframes on
// customers' external sites (helmet's frame-ancestors/X-Frame-Options would
// block that, and cross-origin form POSTs would fail the CORS allowlist).
app.use('/f', registerPublicFormRoutes({ pool, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// Website tracking snippet (/t.js) + pixel (/px.gif). Also mounted BEFORE
// cors/helmet: both are loaded cross-origin from customers' sites and
// helmet's Cross-Origin-Resource-Policy would block them.
app.use(registerSiteTrackingRoutes({ pool, appUrl: config.appUrl, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// ── Security & parsing middleware — must be before ALL routes ─────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://connect.facebook.net',
          'https://www.googletagmanager.com',
          'https://www.google-analytics.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: [
          "'self'",
          config.appUrl,
          ...(config.frontendOrigins ?? []),
          'https://www.google-analytics.com',
        ],
        frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.facebook.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
      },
    },
  })
);
// Raw body capture for payment and messaging webhook signature verification
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/api', idempotencyMiddleware);


app.use('/api', (_req, res, next) => {
  if (config.databaseUrl && !dbReady) return res.status(503).json({ success: false, error: 'Database unavailable' });
  next();
});

// ── Admin Overview: platform KPIs + launch-readiness checks ──────────────────
// Powers the Admin → Overview tab. Every metric is queried defensively so a
// missing optional table renders as null instead of failing the whole page.
app.get('/api/admin/overview', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const count = async (sql: string): Promise<number | null> => {
    try {
      const { rows } = await dbQuery<{ n: string }>(sql);
      return rows[0] ? Number(rows[0].n) : 0;
    } catch { return null; }
  };

  const [
    usersTotal, usersNew7d, subsActive, revenueCents30d, creditsSpent7d,
    postsPublished7d, emailsSent7d, contactsTotal, designsTotal,
  ] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM users`),
    count(`SELECT COUNT(*) AS n FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`),
    count(`SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('active','trialing')`),
    count(`SELECT COALESCE(SUM(total_cents),0) AS n FROM billing_invoices WHERE status='paid' AND paid_at >= NOW() - INTERVAL '30 days'`),
    count(`SELECT COALESCE(SUM(-delta),0) AS n FROM credit_ledger WHERE delta < 0 AND created_at >= NOW() - INTERVAL '7 days'`),
    count(`SELECT COUNT(*) AS n FROM publishing_logs WHERE status='published' AND created_at >= NOW() - INTERVAL '7 days'`),
    count(`SELECT COUNT(*) AS n FROM mailing_email_events WHERE event_type='delivered' AND created_at >= NOW() - INTERVAL '7 days'`),
    count(`SELECT COUNT(*) AS n FROM mailing_contacts`),
    count(`SELECT COUNT(*) AS n FROM user_designs`),
  ]);

  const resendCfg = await getPlatformConfig('resend').catch(() => ({} as Record<string, string>));
  const resendConfigured = Boolean(resendCfg.apiKey || process.env.RESEND_API_KEY);
  const resendWebhookSecret = Boolean(resendCfg.webhookSecret || process.env.RESEND_WEBHOOK_SECRET);

  const checks = [
    { id: 'db', label: 'Database connected', ok: dbReady, detail: dbReady ? 'Postgres ready' : String(dbInitError || 'not ready') },
    { id: 'sentry', label: 'Error monitoring (Sentry)', ok: sentryEnabled, detail: sentryEnabled ? 'SENTRY_DSN configured' : 'SENTRY_DSN not set — errors only reach logs' },
    { id: 'paystack', label: 'Paystack configured', ok: Boolean(await getPaystackConfig(getPlatformConfig).catch(() => null)), detail: 'Configure test and live credentials in Payments' },
    { id: 'resend', label: 'Email sending (Resend)', ok: resendConfigured, detail: resendConfigured ? 'API key present' : 'No Resend key — campaigns and password resets disabled' },
    { id: 'resend_webhook', label: 'Resend webhook secret', ok: !resendConfigured || resendWebhookSecret, detail: !resendConfigured ? 'n/a until Resend is configured' : resendWebhookSecret ? 'Signed engagement events' : 'Missing — opens/clicks/bounces discarded in production' },
    { id: 'test_credits', label: 'Test-credit grant disabled', ok: process.env.ENABLE_TEST_USER_CREDITS !== 'true', detail: process.env.ENABLE_TEST_USER_CREDITS === 'true' ? 'ENABLE_TEST_USER_CREDITS is ON — turn off in production' : 'Off (production-safe)' },
  ];

  res.json({
    success: true,
    environment: config.nodeEnv,
    appUrl: config.appUrl,
    stats: {
      usersTotal, usersNew7d, subsActive,
      revenueCents30d, creditsSpent7d, postsPublished7d,
      emailsSent7d, contactsTotal, designsTotal,
    },
    checks,
  });
});

// Diagnostics — admin-only so deployment internals aren't public.
app.get('/api/debug/db', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.json({
    hasDatabase: hasDatabase(),
    dbReady,
    databaseUrlConfigured: Boolean(config.databaseUrl && config.databaseUrl.trim()),
  });
});

// ── Global session-revocation guard ──────────────────────────────────────────
// Every /api request carrying a JWT has its tokenVersion checked against the DB.
// This makes logout-all-devices actually revoke access on all subsequent requests.
// Skips if no auth header (public routes) or if DB is unavailable (fail-open).
app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuthUser(req);
  if (!auth) return next();
  if (config.nodeEnv === 'test' && !config.databaseUrl) return next();
  try {
    const user = await getUserById(auth.userId);
    if (!user || user.status !== 'active' || auth.tokenVersion === null || user.token_version !== auth.tokenVersion) {
      return res.status(401).json({ success: false, error: 'Account disabled or session revoked. Please log in again.' });
    }
    (req as Request & { authRole?: string }).authRole = user.role;
    next();
  } catch { res.status(503).json({ success: false,error: 'Authentication service unavailable' }); }
});

// Serve frontend static assets when built files are present (copied by Dockerfile)
const publicDir = path.join(__dirname, 'public');
const indexHtmlPath = path.join(publicDir, 'index.html');
const hasStaticFiles = existsSync(indexHtmlPath);
const indexHtmlContent = hasStaticFiles ? readFileSync(indexHtmlPath, 'utf-8') : null;
logger.info({ publicDir, hasStaticFiles }, 'static_files_check');
app.use('/assets', (req,res,next) => { if (req.path.endsWith('.map')) return res.status(404).end(); next(); });
app.use(
  express.static(publicDir, {
    setHeaders(res) {
      res.setHeader('Cache-Control', res.req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  })
);
const REDIS_URL = config.redisUrl;
const TWITTER_MONTHLY_WRITE_LIMIT = config.twitterMonthlyWriteLimit;
const SOCIAL_TOKEN_SAFETY_MARGIN_DAYS = config.socialTokenSafetyMarginDays;
const X_API_BASE = 'https://api.x.com';
const X_OAUTH_TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;
const X_USERS_ME_API = `${X_API_BASE}/2/users/me`;

const extraOrigins = config.frontendOrigins ?? [];

const allowedOrigins = new Set([
  config.appUrl,   // set VITE_APP_URL in env — defaults to https://marketing.dakyx.com
  ...extraOrigins, // set FRONTEND_ORIGINS (comma-separated) for additional frontend domains
]);
if (config.nodeEnv !== 'production') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:3001');
  allowedOrigins.add('http://127.0.0.1:3000');
  allowedOrigins.add('http://127.0.0.1:3001');
}


const SOCIAL_AUTOMATION_MAX_ATTEMPTS = 3;
const SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS = 30_000;
const TWITTER_AUTOMATION_MAX_ATTEMPTS = 6;
const TWITTER_AUTOMATION_RETRY_BASE_DELAY_MS = 60_000;
const SOCIAL_AUTOMATION_QUEUE_NAME = 'social-publish';
const facebookPagesPlatform = new FacebookPagesPlatform();
const instagramBusinessPlatform = new InstagramBusinessPlatform();
const linkedInPlatform = new LinkedInPlatform();
const twitterXPlatform = new TwitterXPlatform();

let socialAutomationQueue: Queue | null = null;
let socialAutomationWorker: Worker | null = null;
let socialAutomationRedis: IORedis | null = null;

function isBullMqEnabled() {
  return Boolean(REDIS_URL && REDIS_URL.trim());
}

function getSocialAutomationMaxAttempts(platform?: string) {
  return normalizePlatformId(String(platform || '')) === 'twitter'
    ? TWITTER_AUTOMATION_MAX_ATTEMPTS
    : SOCIAL_AUTOMATION_MAX_ATTEMPTS;
}

function getRetryDelayMs(attemptNumber: number, platform?: string) {
  const n = Math.max(1, Number(attemptNumber || 1));
  const baseDelay =
    normalizePlatformId(String(platform || '')) === 'twitter'
      ? TWITTER_AUTOMATION_RETRY_BASE_DELAY_MS
      : SOCIAL_AUTOMATION_RETRY_BASE_DELAY_MS;
  return baseDelay * Math.pow(2, n - 1);
}


type DataDeletionStatus = 'received' | 'completed' | 'unknown';
type DataDeletionRecord = {
  code: string;
  metaUserId: string | null;
  status: DataDeletionStatus;
  createdAt: string;
  completedAt: string | null;
};

const inMemoryDataDeletionRequests = new Map<string, DataDeletionRecord>();

async function ensureDatabase() {
  if (!config.databaseUrl) {
    if (config.nodeEnv === 'production') {
      logger.fatal({ event: 'db_missing_in_production' }, 'DATABASE_URL is not configured. Refusing to start in production without a database.');
      process.exit(1);
    }
    logger.warn('DATABASE_URL is not set; running in in-memory mode (development only).');
    setDbReady(false);
    seedInMemoryUsers();
    return;
  }

  await runDatabaseMigrations(pool);
  await runPaymentMigrations(pool);
  await runDakyxMigrations(pool);
  // Credentials copied into the plaintext token_data column by older code
  // move to their encrypted home.
  await migrateLegacyTokenData((sql, params) => pool!.query(sql, params as any[]), encryptIntegrationSecret)
    .then((count) => { if (count) logger.info({ count }, 'token_data_secrets_migrated'); })
    .catch((err) => logger.warn({ err }, 'token_data_secret_migration_failed'));
  setDbReady(true);

}

// ── Messaging Webhooks ──
// markSocialAccountNeedsReapproval is const from distModule (defined later) — use wrapper so it's read at call time
app.use(registerWebhookRoutes({
  hasDatabase, dbQuery, pool, requireAuth,
  markSocialAccountNeedsReapproval: (...args) => markSocialAccountNeedsReapproval(...args),
  logIntegrationEvent,
  decryptIntegrationSecret,
  getPlatformConfig,
  fireAutomationTrigger: automationEngine.fireAutomationTrigger,
  recalcLeadScore,
  salesEngine,
}));



// These are assigned after buildDistributionModule is called (synchronous, before DB resolves)
let startSocialAutomationProcessor: () => void = () => {};
let startTokenHealthMonitor: () => void = () => {};
// These are assigned after buildMediaModule is called (handlers run after startup completes)
let syncProfileMedia: (user: any) => Promise<number> = async () => 0;
let syncCardTemplateMedia: (adminId: string, template: any) => Promise<number> = async () => 0;
let syncUserDesignMedia: (userId: string, design: any) => Promise<number> = async () => 0;
// Wrappers that read the let-variable at call time so route modules get the real function after startup
const syncProfileMediaFn = (user: any) => syncProfileMedia(user);
const syncCardTemplateMediaFn = (adminId: string, template: any) => syncCardTemplateMedia(adminId, template);
const syncUserDesignMediaFn = (userId: string, design: any) => syncUserDesignMedia(userId, design);

const initialization = ensureDatabase()
  .then(() => ensureSeedUsers())
  .then(() => ensureSeedPricingPlans())
  .then(() => seedDefaultMcpServers(pool))
  .then(() => runProductionReadinessChecks())
  .then(() => { if (config.nodeEnv !== 'test') startSocialAutomationProcessor(); })
  .then(() => { if (config.nodeEnv !== 'test') startTokenHealthMonitor(); })
  .catch((err) => {
    setDbReady(false);
    setDbInitError(err);
    logger.error({ err }, 'Database initialization failed');
    if (config.nodeEnv !== 'test') throw err;
  });





// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.use('/api', registerAuthRoutes({
  requireAuth, hasDatabase, dbQuery,
  getUserById, findUserByEmail, findUserByUsername, findUserByIdentifier,
  createUser, updateUserProfile, updateLastLogin,
  getUserPlanName, getEffectivePlan, signToken, userToAuthPayload, checkTokenVersion,
  provisionUserAgents, createNotification, getResendConfig,
  jwtSecret: config.jwtSecret,
  appUrl: config.appUrl,
  syncProfileMedia: syncProfileMediaFn,
}));
// ─── User Management Routes ───────────────────────────────────────────────────
app.use('/api', registerUserRoutes({
  requireAdmin, hasDatabase, dbQuery,
  getUserById, findUserByEmail, findUserByUsername, createUser,
  normalizeEmail, normalizeUsername,
  inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,
}));

const socialConnectDeps: SocialConnectDeps = {
  requireAuth, hasDatabase, pool, dbQuery,
  getPublishableSocialConnection: (...a) => getPublishableSocialConnection(...a),
  normalizePlatformId: (...a) => normalizePlatformId(...a),
  getPlatformConfig,
  resolveOAuthRedirectUri,
  getLinkedInOAuthScopeString,
  shouldEnableLinkedInExtendedLogin,
  parseLinkedInScopeList,
  computeIsoFromTtlSeconds,
  encryptIntegrationSecret,
  decryptIntegrationSecret,
  upsertUserIntegration,
  logIntegrationEvent,
  getUserConnectedAccounts,
  markSocialAccountNeedsReapproval: (...a) => markSocialAccountNeedsReapproval(...a),
  createNotification,
  checkTaskActions,
  getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming,
  publishToplatform: (...a) => publishToplatform(...a),
};
app.use('/api', registerSocialConnectRoutes(socialConnectDeps));


// ─── WordPress Routes ────────────────────────────────────────────────────────
app.use('/api', registerWordPressRoutes({
  requireAuth, hasDatabase, dbQuery, pool,
  encryptWordPressPassword, decryptWordPressPassword, getWordPressConnection, wpRequest,
  upsertUserIntegration, logIntegrationEvent, ensureWordPressSocialAccount,
}));

// ─── Pricing Routes ──────────────────────────────────────────────────────────
app.use('/api', registerPricingRoutes({ requireAdmin, hasDatabase, dbQuery, inMemoryPricingPlansById }));

// ─── Card Template Routes ────────────────────────────────────────────────────
app.use('/api', registerCardTemplateRoutes({
  requireAuth, requireAdmin, hasDatabase, dbQuery, pool,
  inMemoryCardTemplatesById,
  syncCardTemplateMedia: syncCardTemplateMediaFn,
}));

app.use('/api', registerCreditsRoutes({ requireAuth, requireAdmin, hasDatabase, getPlatformConfig, pool: pool! }));
// ─── User Designs Routes ──────────────────────────────────────────────────────
app.use('/api', registerUserDesignRoutes({ requireAuth, hasDatabase, dbQuery, syncUserDesignMedia: syncUserDesignMediaFn, checkTaskActions }));

// ─── Hubtel Payment Routes ─────────────────────────────────────────────────────
app.use('/api', registerHubtelRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, getPlatformConfig }));
// ─── Paystack Payment Routes ───────────────────────────────────────────────────
app.use('/api', registerPaystackRoutes({ requireAuth, requireAdmin, hasDatabase, pool, getPlatformConfig }));
// GET /api/oauth/:platform/authorize-url — build OAuth URL from DB-configured credentials
app.get('/api/oauth/:platform/authorize-url', async (req: Request, res: Response) => {
  try {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const platform = req.params.platform.toLowerCase();
    const query = req.query as Record<string, string | undefined>;
    const state = String(query.state || '').trim();
    if (!state) return res.status(400).json({ success: false, error: 'Missing state' });
    if (!OAUTH_AUTH_URLS[platform]) return res.status(400).json({ success: false, error: 'Unsupported platform' });

    // The state must be one this user registered for this platform via
    // POST /api/oauth/state, so an authorize URL can't be minted for a state
    // the callback would never accept.
    if (hasDatabase()) {
      const { rows } = await dbQuery(
        'SELECT 1 FROM oauth_states WHERE state = $1 AND user_id = $2 AND platform = $3 AND expires_at > NOW() LIMIT 1',
        [state, auth.userId, platform],
      );
      if (!rows.length) return res.status(400).json({ success: false, error: 'Unknown or expired OAuth state — start the connection again' });
    }

    let cfg = await getPlatformConfig(platform);
    let facebookCfg: Record<string, string> = {};
    let inheritedFromFacebook = false;
    if (platform === 'instagram') {
      facebookCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
      ({ cfg, inheritedFromFacebook } = resolveInstagramAppConfig(cfg, facebookCfg));
    }

    const result = buildOAuthAuthorizeUrl({
      platform,
      cfg,
      facebookCfg,
      inheritedFromFacebook,
      redirectUri: resolveOAuthRedirectUri(platform, cfg.redirectUri, req),
      state,
      method: query.method,
      extraScopes: query.extra_scopes,
      rerequest: String(query.rerequest || '') === '1',
      forceReauth: String(query.force_reauth || '') === '1',
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      enableLinkedInExtendedLogin: shouldEnableLinkedInExtendedLogin(),
    });
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    return res.json({ success: true, url: result.url });
  } catch (err) {
    logger.error('Authorize URL error:', err);
    return res.status(500).json({ success: false, error: 'Failed to build authorization URL' });
  }
});

// Provider deauthorize / data-deletion callbacks (signature-verified).
app.use('/api', registerComplianceRoutes({ hasDatabase, dbQuery, getPlatformConfig }));

app.use('/api', registerPlatformConfigRoutes({
  requireAuth, requireAdmin, hasDatabase, dbQuery, pool,
  inMemoryPlatformConfigs, getPlatformConfig, getIntegrationRowBySlug,
  getResendConfig,
  oauthAuthUrls: OAUTH_AUTH_URLS,
  resolveOAuthRedirectUri,
  isOAuthClientSecretRequired,
}));


// ─── DakyX accounts: "Continue with DakyX", retainer grants, change events ──
// Above social auth on purpose: its `/api/auth/:provider/start` would take
// "dakyx" for an unknown provider and answer 404.
app.use(registerDakyxRoutes({ pool, dbQuery, hasDatabase, requireAuth, getUserById, signToken, appUrl: config.appUrl }));

// ─── Social Auth: OAuth login + auth provider management ────────────────────
app.use(registerSocialAuthRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool, jwtSecret: config.jwtSecret, jwtExpiresIn: JWT_EXPIRES_IN }));



// ─── AI Config Routes ─────────────────────────────────────────────────────────
app.use('/api', registerAIConfigRoutes({
  requireAdmin, hasDatabase, dbQuery,
  getAIConfig, encryptIntegrationSecret, decryptAIKey,
  resolveActiveKey, callAINonStreaming, inMemoryPlatformConfigs,
}));

// ─── AI Skills ────────────────────────────────────────────────────────────────
app.use('/api/admin', registerAISkillsRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ─── End AI Skills ────────────────────────────────────────────────────────────

// ─── Page Content ──────────────────────────────────────────────────────────
app.use('/api/pages', registerPagesRoutes({ requireAdmin, hasDatabase, pool: pool! }));


// ─── Media Library ─────────────────────────────────────────────────────────────
const mediaModule = buildMediaModule({ requireAuth, requireAdmin, hasDatabase, pool });
app.use('/', mediaModule.router);
syncProfileMedia = mediaModule.syncProfileMedia;
syncCardTemplateMedia = mediaModule.syncCardTemplateMedia;
syncUserDesignMedia = mediaModule.syncUserDesignMedia;
const syncBlogPostMedia = mediaModule.syncBlogPostMedia;


// ── DB Audit & Cleanup (admin-only, one-shot) ──────────────────────────────
app.use('/api/admin', registerDbAuditRoutes({ requireAdmin, pool: pool! }));

// ── Platform nav settings ──────────────────────────────────────────────────
app.get('/api/platform/nav-settings', async (req: Request, res: Response) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!hasDatabase) return res.json({ disabled: [] });
  try {
    const { rows } = await dbQuery<{ value: { disabled: string[] } }>(
      `SELECT value FROM platform_settings WHERE key='nav_disabled'`
    );
    res.json({ disabled: rows[0]?.value?.disabled ?? [] });
  } catch {
    res.json({ disabled: [] });
  }
});

app.put('/api/admin/nav-settings', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { disabled } = req.body;
  if (!Array.isArray(disabled)) return void res.status(400).json({ error: 'disabled must be array' });
  await dbQuery(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('nav_disabled', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
    [JSON.stringify({ disabled })]
  );
  res.json({ ok: true, disabled });
});
// TikTok Developer Domain Verification:
// Automatically satisfies TikTok's file verification for any /tiktok<token>.txt check requested by TikTok's validator bot.
app.get(/^\/tiktok([a-zA-Z0-9_-]+)\.txt$/, (req: Request, res: Response) => {
  const token = req.params[0];
  res.setHeader('Content-Type', 'text/plain');
  res.send(`tiktok-developers-site-verification=${token}`);
});

app.get(['/tiktok-developers-site-verification.txt', '/.well-known/tiktok-developers-site-verification.txt'], (req: Request, res: Response) => {
  const token = process.env.TIKTOK_VERIFICATION_CODE || 'GuHuKYUdxb13mmRk5PkdrDFlLEBosnIF';
  res.setHeader('Content-Type', 'text/plain');
  res.send(`tiktok-developers-site-verification=${token}`);
});

app.use(registerLinkedInRoutes({
  requireAuth, pool, encryptIntegrationSecret, computeIsoFromTtlSeconds,
  getLinkedInOrganizationScopeError, upsertUserIntegration,
  getPublishableSocialConnection: (...a) => getPublishableSocialConnection(...a),
  refreshLinkedInAccessToken: (...a) => refreshLinkedInAccessToken(...a),
  listLinkedInAdminOrganizations: (...a) => listLinkedInAdminOrganizations(...a),
  fetchLinkedInOrganizationNetworkSize: (...a) => fetchLinkedInOrganizationNetworkSize(...a),
  fetchLinkedInSocialMetadataBatch: (...a) => fetchLinkedInSocialMetadataBatch(...a),
  fetchLinkedInShareStatisticsForPosts: (...a) => fetchLinkedInShareStatisticsForPosts(...a),
  sumLinkedInReactionCounts: (m) => sumLinkedInReactionCounts(m),
  getClientIp, checkLinkMetadataRateLimit, fetchLinkMetadata,
}));


// ── API Versioning ─────────────────────────────────────────────────────────────
// All new routes live under /api/v1/. Old /api/<resource> paths are kept as
// deprecated shims (same Router, different mount point) so in-flight requests
// and older cached tabs keep working. Remove shims when launching v2.

app.use('/api/v1', (_req: Request, res: Response, next) => {
  res.setHeader('X-API-Version', '1');
  next();
});

function deprecatedApiPath(canonicalPath: string) {
  return (_req: Request, res: Response, next: () => void) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('X-Deprecated-Use', canonicalPath);
    next();
  };
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Distribution Module ─────────────────────────────────────────────────────
const distModule = buildDistributionModule({
  ensureMediaRecordForSource: mediaModule.ensureMediaRecordForSource,
  requireAuth, pool, dbQuery,
  decryptIntegrationSecret, getIntegrationRowBySlug, logIntegrationEvent,
  getPlatformConfig, getWordPressConnection, decryptWordPressPassword, wpRequest,
});
app.use('/api', distModule.router);
const getPublishableSocialConnection = distModule.getPublishableSocialConnection;
const publishToplatform = distModule.publishToplatform;
const normalizePlatformId = distModule.normalizePlatformId;
const markSocialAccountNeedsReapproval = distModule.markSocialAccountNeedsReapproval;
const listLinkedInAdminOrganizations = distModule.listLinkedInAdminOrganizations;
const fetchLinkedInOrganizationNetworkSize = distModule.fetchLinkedInOrganizationNetworkSize;
const refreshLinkedInAccessToken = distModule.refreshLinkedInAccessToken;
const fetchLinkedInSocialMetadataBatch = distModule.fetchLinkedInSocialMetadataBatch;
const fetchLinkedInShareStatisticsForPosts = distModule.fetchLinkedInShareStatisticsForPosts;
const sumLinkedInReactionCounts = distModule.sumLinkedInReactionCounts;
startSocialAutomationProcessor = distModule.startSocialAutomationProcessor;
startTokenHealthMonitor = distModule.startTokenHealthMonitor;

const { fireWorkflowTriggers, workflowRouter } = buildWorkflowEngine({ requireAuth, hasDatabase, dbQuery, enqueueSocialAutomationTask: distModule.enqueueSocialAutomationTask, getAIConfig, resolveActiveKey });

const blogRouter = registerBlogRoutes({
  app,
  pool,
  requireAuth,
  hasDatabase,
  slugify,
  clearCalendarCacheForUser,
  getCalendarCache,
  setCalendarCache,
  syncBlogPostMedia,
  checkTaskActions,
  fireWorkflowTriggers,
  queueSocialAutomationForPublishedPost: distModule.queueSocialAutomationForPublishedPost,
  recordAuditLog,
  getVisibleUserPlatformSlugs,
  syncSocialAutomationForPost: distModule.syncSocialAutomationForPost,
});
app.use('/api/v1/blog', blogRouter);
app.use('/api/blog', deprecatedApiPath('/api/v1/blog'), blogRouter);

// ── Social Routes (automation + templates) ──────────────────────────────────
app.use('/api', registerSocialRoutes({
  socialConnectDeps,
  requireAuth, requireAdmin, hasDatabase, pool, dbQuery,
  getPlatformConfig, getPublishableSocialConnection,
  normalizePlatformId: distModule.normalizePlatformId,
  getSocialTemplateDefaults: distModule.getSocialTemplateDefaults,
  mergeSocialTemplateSettings: distModule.mergeSocialTemplateSettings,
  renderSocialTemplatePreview: distModule.renderSocialTemplatePreview,
  loadSocialTemplateSettings: distModule.loadSocialTemplateSettings,
  enqueueSocialAutomationTask: distModule.enqueueSocialAutomationTask,
  syncSocialAutomationForPost: distModule.syncSocialAutomationForPost,
}));

// ─── Mailing ────────────────────────────────────────────────────────────────
app.use('/api/mailing', registerMailingRoutes({ requireAuth, pool: pool!, getResendConfig, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// ─── CRM ─────────────────────────────────────────────────────────────────────
app.use('/api/crm', registerCRMCompaniesRoutes({ requireAuth, pool: pool! }));
app.use('/api/crm', registerCRMDealsRoutes({ requireAuth, pool: pool!, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));
app.use('/api/crm', registerCRMActivitiesRoutes({ requireAuth, pool: pool! }));

// ─── Unified Social Inbox + Client Approvals + Outbound Webhooks + Agent Schedules ──
app.use('/api', registerSocialInboxRoutes({
  requireAuth, pool: pool!, fireAutomationTrigger: automationEngine.fireAutomationTrigger,
  getPublishableSocialConnection, decryptIntegrationSecret,
}));
app.use('/api', registerClientApprovalAndWebhookRoutes({ requireAuth, getUserPlanName, pool: pool! }));
const autopilotVisualAdapter = buildAutopilotVisualAdapter({ pool: pool!, hasDatabase });
const autopilotCopyAdapter = buildAutopilotCopyAdapter();
const autopilotRepo = createAutopilotRepository({ pool: pool!, hasDatabase });

const autopilotRouter = registerAutopilotRoutes({
  requireAuth,
  requireAdmin,
  pool: pool!,
  hasDatabase,
  publishToplatform,
  createNotification,
  visualAdapter: autopilotVisualAdapter,
  copyAdapter: autopilotCopyAdapter,
  repo: autopilotRepo,
});
app.use('/api/v1', autopilotRouter);
app.use('/api', autopilotRouter);

// ─── AI Sales OS ──────────────────────────────────────────────────────────────
// Built on the CRM contact rather than beside it: sales_lead_profiles hangs off
// mailing_contacts, and every analysed conversation also writes a crm_activities
// row so the Companies and Pipeline pages pick it up with no sync job.
app.use('/api/sales', registerSalesRoutes({ requireAuth, pool: pool!, salesEngine }));

// ─── Connector Abstraction Layer ──────────────────────────────────────────────
app.use('/api/connectors', registerConnectorRegistryRoutes({ requireAuth, pool: pool! }));
app.use('/api/connectors', registerConnectorPreferencesRoutes({ requireAuth, pool: pool! }));
app.use('/api/connectors', registerConnectorSyncRoutes({ requireAuth, pool: pool! }));

// ─── Surveys ──────────────────────────────────────────────────────────────────
app.use('/api/surveys', registerSurveyRoutes({ requireAuth, pool: pool! }));
app.use('/api/public/surveys', registerPublicSurveyRoutes({ pool: pool!, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));

// ─── Leads & Google Sheets ──────────────────────────────────────────────────
const GS_CLIENT_ID = process.env.GOOGLE_SHEETS_CLIENT_ID || '';
const GS_CLIENT_SECRET = process.env.GOOGLE_SHEETS_CLIENT_SECRET || '';
const GS_REDIRECT = (process.env.API_URL || config.appUrl).replace(/\/$/, '') + '/api/google-sheets/callback';
const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyx.com';
const leadsDeps = { requireAuth, pool: pool!, frontendUrl: FRONTEND_URL, gsClientId: GS_CLIENT_ID, gsClientSecret: GS_CLIENT_SECRET, gsRedirect: GS_REDIRECT };
app.use('/api/leads', registerLeadsRoutes(leadsDeps));
app.use('/api/google-sheets', registerGoogleSheetsRoutes(leadsDeps));

// ─── Marketing → Lead Generation (vendored leads module, Prisma-backed) ───────
// Uploads ride in the JSON body as base64, so the practical file ceiling is the
// global 20 MB express.json limit above (~15 MB of spreadsheet once encoded),
// not the module's own 20 MB check.
app.use('/api/leadgen', registerLeadgenRoutes({ requireAuth }));

// ─── Calendar (Google Calendar OAuth + events) ────────────────────────────────
app.use('/api/calendar', registerCalendarRoutes({ requireAuth, pool: pool!, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret, frontendUrl: FRONTEND_URL }));

// ─── Analytics Routes ───────────────────────────────────────────────────────
app.use('/api', registerAnalyticsRoutes({ requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection, getPlatformConfig }));
// ─── End Analytics & Insights Engine ─────────────────────────────────────────

// ─── Campaign & Funnel Builder ────────────────────────────────────────────────
app.use('/api/campaign', registerCampaignRoutes({ requireAuth, pool: pool!, redisUrl: REDIS_URL }));
app.use('/api/track', registerTrackingRoutes({ pool: pool! }));
app.use('/r', registerShortLinkRoutes({ pool: pool!, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));
// ─── End Campaign & Funnel Builder ────────────────────────────────────────────

// ── AI Chat & Multi-Agent Routes ───────────────────────────────────────────
app.use('/api', registerAIChatRoutes({ requireAuth, getAIConfig, resolveActiveKey, callAINonStreaming, GEMINI_MODELS, pool, dbQuery, createNotification, checkTaskActions, getUserConnectedAccounts, AGENT_DEFS }));


// ─── Billing Routes ────────────────────────────────────────────────────────────

const billingRouter = registerBillingRoutes({
  requireAuth, hasDatabase, dbQuery, pool, getPlatformConfig,
});
app.use('/api/v1/billing', billingRouter);
app.use('/api/billing', deprecatedApiPath('/api/v1/billing'), billingRouter);
app.use('/api', registerAdminBillingRoutes({ requireAdmin, hasDatabase, dbQuery }));

// ── Memory + Agent Routes ───────────────────────────────────────────────────
app.use('/api', registerMemoryAgentRoutes({ requireAuth, requireAdmin, dbQuery, hasDatabase, triggerAgentCompilation, createNotification, checkTaskActions, provisionUserAgents, AGENT_DEFS, getAIConfig, decryptAIKey }));
app.use('/api', registerOnboardingRoutes({ requireAuth, dbQuery, hasDatabase, triggerAgentCompilation, createNotification, checkTaskActions, getAIConfig, resolveActiveKey, callAINonStreaming }));


// ── Daky Learn Routes ───────────────────────────────────────────────────────
app.use('/api', registerDakyLearnRoutes({ requireAdmin, dbQuery, pool, getAIConfig, resolveActiveKey, callAINonStreaming, GEMINI_MODELS, createNotification }));


// ── Notifications ─────────────────────────────────────────────────────────────

const { notifRouter, inviteRouter } = registerNotificationRoutes({ pool, requireAuth, dbQuery, hasDatabase, createNotification });
app.use('/api/v1/notifications', notifRouter);
app.use('/api/notifications', deprecatedApiPath('/api/v1/notifications'), notifRouter);
app.use('/api/v1/invitations', inviteRouter);
app.use('/api/invitations', deprecatedApiPath('/api/v1/invitations'), inviteRouter);

// ── End Notifications ─────────────────────────────────────────────────────────

// ── End Billing Routes ─────────────────────────────────────────────────────────

// ─── Apify Admin Routes ────────────────────────────────────────────────────────
app.use('/api/admin/apify', registerApifyRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ── End Apify Admin Routes ─────────────────────────────────────────────────────

// ─── Higgsfield Admin Routes ───────────────────────────────────────────────────
app.use('/api/admin/higgsfield', registerHiggsfieldRoutes({ requireAdmin, hasDatabase, dbQuery }));
// ── End Higgsfield Admin Routes ────────────────────────────────────────────────

// ─── Magnific AI Routes ─────────────────────────────────────────────────────────
app.use('/api', registerMagnificRoutes({ requireAuth, requireAdmin, hasDatabase, pool }));

// ── Nova Design Agent Routes ───────────────────────────────────────────────────
const { router: novaRouter, runScheduledAgents, runAgentForUser } = buildNovaModule({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool, getAIConfig, resolveActiveKey, decryptAIKey, AGENT_DEFS });
app.use('/api', novaRouter);
app.use('/api', registerAgentTeamRoutes({ requireAuth, hasDatabase, runAgent: runAgentForUser }));


// ─── Kling AI Routes ───────────────────────────────────────────────────────────
app.use('/api', registerKlingRoutes({ requireAuth, requireAdmin, hasDatabase, pool: pool! }));
// ── End Kling AI Routes ────────────────────────────────────────────────────────

// ─── Gmail Inbox Routes ────────────────────────────────────────────────────────
app.use('/api', registerGmailInboxRoutes({ requireAuth, pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret, getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming }));
// ── End Gmail Inbox Routes ────────────────────────────────────────────────────

// ─── Google AI Routes ──────────────────────────────────────────────────────────
app.use('/api', registerGoogleRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool: pool! }));
// ── End Google AI Routes ──────────────────────────────────────────────────────

// ─── OpenAI Routes ─────────────────────────────────────────────────────────────
app.use('/api', registerOpenAIRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool: pool! }));
// ── End OpenAI Routes ─────────────────────────────────────────────────────────

// ─── Workspace / Organization Routes ───────────────────────────────────────────
app.use('/api', registerOrgRoutes({ requireAuth, hasDatabase, dbQuery, requireOrgMembership, createNotification, checkTaskActions, logTaskActivity }));
// ── End Task Management Routes ─────────────────────────────────────────────────

// ── Workflow Routes ─────────────────────────────────────────────────────────
app.use('/api', workflowRouter);


// ── Automation Flows API ─────────────────────────────────────────────────────
app.use('/api', registerAutomationRoutes({ requireAuth, pool: pool!, runAutomationForContact: automationEngine.runAutomationForContact }));

// ── Public API: key management (authenticated) + inbound trigger (API-key auth) ──
app.use('/api', registerApiKeyRoutes({ requireAuth, pool: pool! }));
app.use('/api/v1', registerPublicTriggerRoutes({ pool, fireAutomationTrigger: automationEngine.fireAutomationTrigger }));
app.use('/api/v1/os', registerDakyworldOsRoutes({ requireAuth, pool: pool!, dbQuery }));

// ── Lead-capture forms (authenticated CRUD; public form served at /f/:id) ──
app.use('/api', registerFormsRoutes({ requireAuth, pool: pool! }));

// ── MCP integrations: admin server management + user media feed ──
app.use('/api/admin/mcp', registerMcpAdminRoutes({ requireAdmin, pool: pool!, encryptIntegrationSecret, decryptIntegrationSecret }));
app.use('/api/mcp', registerMcpMediaRoutes({ requireAuth, pool: pool! }));

// ── Auto-content plans (background promo content generation) ──
app.use('/api', registerContentPlanRoutes({ requireAuth, pool: pool!, createNotification, runPlanOnce: contentPlanEngine.runPlanOnce, pricePlan: contentPlanEngine.pricePlan }));

app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  // Serve the SPA shell for all non-API paths (handles hard refresh / deep links)
  if (indexHtmlContent) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(indexHtmlContent);
  }
  res.status(404).json({ success: false, error: 'Not found' });
});

// Centralized error handling (must be last).
// Manual Sentry capture instead of setupExpressErrorHandler: that helper
// expects OTel instrumentation, which can't hook a bundled express (we ship
// one esbuild file) and logs a boot warning. Capture-then-forward is all we
// need for errors-only monitoring.
if (sentryEnabled) {
  app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    Sentry.captureException(err);
    next(err);
  });
}
app.use(errorHandler);

// Start server
if (config.nodeEnv !== 'test') {
  await initialization;
  const httpServer = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'api_listening');
    const creditJobs=buildCreditJobs(pool,getPlatformConfig);
    let creditJobsRunning=false;
    const processCredits=async()=>{ if(creditJobsRunning)return;creditJobsRunning=true;try{await creditJobs.run();}catch(err){logger.error({err},'credit_worker_failed');}finally{creditJobsRunning=false;} };
    void processCredits();
    setInterval(()=>void processCredits(),5*60_000);
    const deliverHooks=() => processOutboundWebhookJobs(pool).catch(err=>logger.error({ err },'webhook_worker_failed'));
    const deliverEmails=()=>processCampaignEmails(pool,getResendConfig).catch(err=>logger.error({ err },'campaign_email_worker_failed'));
    void deliverEmails();
    setInterval(()=>void deliverEmails(),60_000);
    void deliverHooks();
    setInterval(() => void deliverHooks(),60_000);
    // Run due-date alerts immediately, then every hour
    void runDueDateAlerts();
    setInterval(() => void runDueDateAlerts(), 60 * 60 * 1000);
    // Run scheduled agent auto-runs every hour
    void runScheduledAgents();
    setInterval(() => void runScheduledAgents(), 60 * 60 * 1000);
    // The performance director reviews each active team's strategy once a day
    // (checked hourly), five minutes after boot so startup stays light.
    setTimeout(() => void runDirectorCycle(runAgentForUser), 5 * 60 * 1000);
    setInterval(() => void runDirectorCycle(runAgentForUser), 60 * 60 * 1000);
    // Regular weekly post performance scan across all platforms
    setTimeout(() => void runWeeklyPostScans(), 10 * 60 * 1000);
    setInterval(() => void runWeeklyPostScans(), 6 * 60 * 60 * 1000);
    // Run autonomous multi-agent schedules & handoffs every 10 minutes
    void runDueAgentSchedules(pool);
    setInterval(() => void runDueAgentSchedules(pool), 10 * 60 * 1000);
    // Publish due scheduled posts every 2 minutes
    const schedulerDeps = { queueSocialAutomationForPublishedPost: distModule.queueSocialAutomationForPublishedPost, fireWorkflowTriggers };
    void publishDuePosts(schedulerDeps);
    setInterval(() => void publishDuePosts(schedulerDeps), 2 * 60 * 1000);

    // Run due Autopilot publications every 60 seconds
    const runAutopilotPublishing = () =>
      processDueAutopilotPublications({
        repo: autopilotRepo,
        publisherAdapter: async (input) => {
          if (!publishToplatform) throw new Error('publishToplatform not configured');
          const coverImage = input.mediaAssets.find((m) => m.type === 'image')?.url ?? null;
          const videoUrl = input.mediaAssets.find((m) => m.type === 'video')?.url ?? null;
          const res = await publishToplatform(
            input.userId,
            {
              id: input.idempotencyKey,
              title: input.title,
              excerpt: input.caption.slice(0, 260),
              content: input.caption,
              featured_image: coverImage,
              video_url: videoUrl,
              media_assets: input.mediaAssets,
              post_format: input.platformMediaType,
              approval_status: 'approved',
              status: 'published',
            },
            input.channel,
            {
              mediaType: input.platformMediaType,
              mediaAssets: input.mediaAssets,
              captionOverride: input.caption,
            },
          );
          if (res.status !== 'published') {
            const err = new Error(res.error || `Failed to publish to ${input.channel}`);
            (err as any).status = res.retryable ? 503 : 400;
            throw err;
          }
          return { remotePostId: res.platformPostId || `remote_${randomUUID().slice(0, 8)}` };
        },
      }).catch((err) => logger.error({ err }, 'autopilot_publishing_worker_failed'));

    void runAutopilotPublishing();
    setInterval(() => void runAutopilotPublishing(), 60 * 1000);

    // Fire task reminders every 2 minutes
    void runTaskReminders();
    setInterval(() => void runTaskReminders(), 2 * 60 * 1000);

    // Run due automation continuations (delay steps) every 2 minutes
    void automationEngine.processDueAutomationJobs();
    setInterval(() => void automationEngine.processDueAutomationJobs(), 2 * 60 * 1000);

    // Re-read every DakyX-linked person's grants, for any event the OS never delivered
    const reconcileDakyx = () => reconcileDakyxGrants({ dbQuery, appUrl: config.appUrl }).catch(err => logger.error({ err }, 'dakyx_reconcile_failed'));
    void reconcileDakyx();
    setInterval(() => void reconcileDakyx(), 60 * 60 * 1000);

    // Run due connector sync jobs (hourly/6h/daily/weekly schedules) every 5 minutes
    void processDueConnectorSyncJobs(pool);
    setInterval(() => void processDueConnectorSyncJobs(pool), 5 * 60 * 1000);

    // Periodic integration scans. First run is delayed so a deploy/restart
    // doesn't immediately hammer external APIs; then every 6 hours.
    const runAnalyticsAutoSync = buildAnalyticsAutoSync({ requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection, getPlatformConfig });
    const runGmailAutoSync = buildGmailAutoSync({ pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret });
    setTimeout(() => void runAnalyticsAutoSync(), 10 * 60 * 1000);
    setInterval(() => void runAnalyticsAutoSync(), 6 * 60 * 60 * 1000);
    setTimeout(() => void runGmailAutoSync(), 15 * 60 * 1000);
    setInterval(() => void runGmailAutoSync(), 6 * 60 * 60 * 1000);

    // Recompile agent skill briefs for users whose memories/brand changed
    // since the last compile — keeps the 14 agents in sync with
    // personalization edits. Daily, first run 20 minutes after boot.
    setTimeout(() => void processStaleAgentCompilations(pool, triggerAgentCompilation), 20 * 60 * 1000);
    setInterval(() => void processStaleAgentCompilations(pool, triggerAgentCompilation), 24 * 60 * 60 * 1000);

    // Pull fresh media from enabled MCP servers (MeiGen gallery) every 6 hours.
    setTimeout(() => void processMcpMediaSync(pool, decryptIntegrationSecret), 5 * 60 * 1000);
    setInterval(() => void processMcpMediaSync(pool, decryptIntegrationSecret), 6 * 60 * 60 * 1000);

    // Run due auto-content plans (e.g. 3 promo pieces/day) every 10 minutes.
    void contentPlanEngine.processDueContentPlans();
    setInterval(() => void contentPlanEngine.processDueContentPlans(), 10 * 60 * 1000);

    // ── AI Sales OS ──
    // Analyse finished conversations every minute — a rep who just logged a
    // call expects the extracted record while they still have it in mind.
    void salesEngine.processPendingAnalyses();
    setInterval(() => void salesEngine.processPendingAnalyses(), 60 * 1000);
    // Turn due follow-up obligations into queued calls every 5 minutes.
    void salesEngine.processDueFollowUps();
    setInterval(() => void salesEngine.processDueFollowUps(), 5 * 60 * 1000);
    // Dial queued attempts every minute. Each one re-runs the compliance gate
    // before it dials — the queue is a plan, not a permission.
    setInterval(() => void salesEngine.processDueCallAttempts(), 60 * 1000);
    // Recompute answer-rate priors. Delayed at boot so a restart doesn't run a
    // full-table aggregate while everything else is warming up.
    setTimeout(() => void salesEngine.rollupCallStats(), 25 * 60 * 1000);
    setInterval(() => void salesEngine.rollupCallStats(), 6 * 60 * 60 * 1000);
    // Weekly pattern mining. Proposals only — nothing is applied without a human.
    setTimeout(() => void salesEngine.runWeeklyInsights(), 45 * 60 * 1000);
    setInterval(() => void salesEngine.runWeeklyInsights(), 7 * 24 * 60 * 60 * 1000);
  });
  process.once('SIGTERM', () => {
    httpServer.close(() => { void pool.end().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

export default app;
