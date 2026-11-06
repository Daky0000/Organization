import axios from 'axios';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import type { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { logger } from '../logger.ts';
import { safeAxios } from '../ssrf-guard.ts';
import {
  encryptPlatformConfig, decryptPlatformConfig, isMaskedSecretValue, maskPlatformConfigSecrets, mergeMaskedSecrets,
  normalizeWordPressSiteUrl, resolveMailchimpServerPrefix,
} from '../integration-helpers.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { buildOAuthAuthorizeUrl, generatePkcePair, isInstagramDirectLogin, resolveInstagramAppConfig } from '../platform-helpers.ts';
import { computeConnectionHealth, getRefreshMode, isSoftReapprovalReason, PUBLISHING_TOKEN_PLATFORMS as PUBLISHING_TOKEN_SLUGS, type ConnectionHealth } from '../social-token-policy.ts';

// ─── Local helpers ─────────────────────────────────────────────────────────────

function normalizePlatformId(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter / x' || raw === 'twitter/x' || raw === 'x') return 'twitter';
  if (raw === 'twitter') return 'twitter';
  if (['linkedin', 'facebook', 'instagram', 'pinterest', 'tiktok', 'threads', 'mailchimp', 'wordpress'].includes(raw)) return raw;
  return raw;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface PlatformConfigDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  inMemoryPlatformConfigs: Map<string, any>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getIntegrationRowBySlug: (slug: string) => Promise<{ id: number; slug: string; name: string | null; type: string | null } | null>;
  getResendConfig: () => Promise<{ apiKey: string; fromEmail: string; fromName: string }>;
  oauthAuthUrls: Record<string, { authUrl: string; scopes: string; idField: 'appId' | 'clientId' | 'clientKey' }>;
  resolveOAuthRedirectUri: (platform: string, redirectUri?: string, req?: Request) => string;
  isOAuthClientSecretRequired: (platform: string) => boolean;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerPlatformConfigRoutes(deps: PlatformConfigDeps): Router {
  const {
    requireAuth, requireAdmin, hasDatabase, dbQuery, pool,
    inMemoryPlatformConfigs, getPlatformConfig, getIntegrationRowBySlug,
    getResendConfig,
    oauthAuthUrls, resolveOAuthRedirectUri, isOAuthClientSecretRequired,
  } = deps;

  const router = Router();

  // ── Platform Configs ─────────────────────────────────────────────────────────

  router.get('/admin/platform-configs', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      // Secrets go out masked; a mask sent back on save means "unchanged".
      const maskConfig = (cfg: Record<string, any>) => maskPlatformConfigSecrets(decryptPlatformConfig(cfg));

      if (hasDatabase()) {
        const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs ORDER BY platform');
        return res.json({ success: true, configs: result.rows.map((r: any) => ({ ...r, config: maskConfig(r.config) })) });
      }
      return res.json({
        success: true,
        configs: Array.from(inMemoryPlatformConfigs.values()).map((r) => ({ ...r, config: maskConfig(r.config) })),
      });
    } catch (error) {
      logger.error('Get platform configs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch platform configs' });
    }
  });

  router.get('/admin/platform-configs/:platform', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { platform } = req.params;
      if (hasDatabase()) {
        const result = await dbQuery('SELECT platform, config, enabled, updated_at FROM platform_configs WHERE platform = $1', [platform]);
        if (result.rows.length === 0) return res.json({ success: true, config: null });
        const row: any = result.rows[0];
        return res.json({ success: true, config: { ...row, config: maskPlatformConfigSecrets(decryptPlatformConfig(row.config)) } });
      }
      const memRow = inMemoryPlatformConfigs.get(platform);
      return res.json({ success: true, config: memRow ? { ...memRow, config: maskPlatformConfigSecrets(decryptPlatformConfig(memRow.config)) } : null });
    } catch (error) {
      logger.error('Get platform config error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch platform config' });
    }
  });

  router.put('/admin/platform-configs/:platform', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const platform = String(req.params.platform || '').trim().toLowerCase();
      const { config, enabled } = req.body as { config: Record<string, string>; enabled: boolean };
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ success: false, error: 'config object is required' });
      }


      const now = new Date().toISOString();
      const existingRow = hasDatabase()
        ? ((await dbQuery('SELECT config, enabled FROM platform_configs WHERE platform = $1', [platform])).rows[0] as { config: Record<string, any>; enabled: boolean } | undefined)
        : inMemoryPlatformConfigs.get(platform);
      const existingConfig = existingRow ? decryptPlatformConfig(existingRow.config) : {};
      // The admin UI is sent masked secrets; a mask coming back keeps the stored value.
      const normalizedConfig: Record<string, string> = mergeMaskedSecrets(existingConfig, { ...(config as any) });
      if (platform === 'stripe') return res.status(410).json({ success: false, error: 'Use Paystack in Payments.' });
      if (platform === 'paystack') {
        const { resolvePaystackConfig } = await import('./paystackService.ts');
        for (const mode of ['test', 'live'] as const) resolvePaystackConfig(normalizedConfig, mode);
        if (!resolvePaystackConfig(normalizedConfig)) return res.status(400).json({ success: false, error: 'The selected payment mode needs credentials.' });
      }
      if (platform === 'paystack' && hasDatabase()) {
        const old=await getPlatformConfig('paystack');
        if(old.currency!==normalizedConfig.currency || old.fxRate!==normalizedConfig.fxRate) await dbQuery("UPDATE credit_recharge_agreements SET enabled=false,pause_reason='Currency or conversion changed. Renew consent.',updated_at=NOW()");
      }
      const meta = oauthAuthUrls[platform];
      if (meta) {
        const incomingRedirect = typeof normalizedConfig.redirectUri === 'string' ? normalizedConfig.redirectUri : '';
        normalizedConfig.redirectUri = resolveOAuthRedirectUri(platform, incomingRedirect, req);
      }

      // The admin's toggle wins, except that the save which first completes an
      // OAuth app's credentials switches it on.
      let finalEnabled = typeof enabled === 'boolean' ? enabled : Boolean(existingRow?.enabled);
      if (meta) {
        const isComplete = (cfg: Record<string, any>) => {
          const clientId = String(cfg[meta.idField] || '').trim();
          const secretValue = String(cfg.clientSecret || cfg.appSecret || '').trim();
          return Boolean(clientId && (!isOAuthClientSecretRequired(platform) || secretValue));
        };
        if (isComplete(normalizedConfig) && !isComplete(existingConfig)) finalEnabled = true;
      }

      // Secret fields are encrypted at rest; reads decrypt transparently
      const storedConfig = encryptPlatformConfig(normalizedConfig);

      if (hasDatabase()) {
        const updateRes = await dbQuery(
          `UPDATE platform_configs SET config = $2, enabled = $3, updated_at = NOW() WHERE platform = $1`,
          [platform, JSON.stringify(storedConfig), finalEnabled]
        );
        if (updateRes.rowCount === 0) {
          await dbQuery(
            `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2, $3, NOW())`,
            [platform, JSON.stringify(storedConfig), finalEnabled]
          );
        }
      } else {
        inMemoryPlatformConfigs.set(platform, { platform, config: storedConfig as Record<string, string>, enabled: finalEnabled, updated_at: now });
      }

      // Audit the change (field names only — never values)
      void recordAuditLog(admin.id, 'admin_platform_config_updated', [], {
        platform, enabled: finalEnabled, fields: Object.keys(normalizedConfig),
      });

      return res.json({ success: true, message: 'Platform config saved' });
    } catch (error) {
      logger.error('Save platform config error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save platform config' });
    }
  });

  router.post('/admin/platform-configs/resend/test', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const saved = await getResendConfig();
      const incomingKey = isMaskedSecretValue(req.body.apiKey) ? '' : req.body.apiKey;
      const resendKey = String(incomingKey || saved.apiKey || '').trim();
      const fromEmail = String(req.body.fromEmail || saved.fromEmail || '').trim();
      const fromName = String(req.body.fromName || saved.fromName || '').trim();
      if (!resendKey) return res.status(400).json({ success: false, error: 'No Resend API key configured — save your key first' });
      if (!fromEmail) return res.status(400).json({ success: false, error: 'From Email is required — enter it in the form above' });
      const toEmail = String(req.body.to || '').trim();
      if (!toEmail) return res.status(400).json({ success: false, error: 'Recipient email required' });
      const resend = new Resend(resendKey);
      const fromField = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
      const { error: sendError } = await resend.emails.send({
        from: fromField, to: toEmail,
        subject: 'Resend configuration test ✓',
        html: `<p>Your Resend integration is working correctly.</p><p>From: <strong>${fromField}</strong></p>`,
      });
      if (sendError) throw new Error(sendError.message);
      return res.json({ success: true, message: `Test email sent to ${toEmail}` });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message || 'Failed to send test email' });
    }
  });

  router.get('/admin/audit-logs', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const limit = Math.min(Number(req.query.limit ?? 200), 500);
      const offset = Number(req.query.offset ?? 0);
      const type = String(req.query.type ?? '').trim();
      if (type === 'integration') {
        const { rows, rowCount } = await dbQuery(
          `SELECT il.id, il.event_type, il.status, il.response, il.created_at,
                  i.slug AS integration, u.email AS user_email
           FROM integration_logs il
           LEFT JOIN integrations i ON i.id = il.integration_id
           LEFT JOIN users u ON u.id = il.user_id
           ORDER BY il.created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        return res.json({ success: true, logs: rows, total: rowCount });
      }
      const { rows, rowCount } = await dbQuery(
        `SELECT al.id, al.action, al.post_ids, al.changes, al.created_at,
                u.email AS user_email, u.full_name AS user_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return res.json({ success: true, logs: rows, total: rowCount });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── OAuth / Integrations ─────────────────────────────────────────────────────

  router.get('/oauth/:platform/configured', async (req: Request, res: Response) => {
    try {
      const platform = req.params.platform.toLowerCase();
      if (platform === 'stripe') return res.status(410).json({ success: false, error: 'Use Paystack in Payments.' });
      const meta = oauthAuthUrls[platform];
      if (!meta) return res.json({ success: true, configured: false });
      let cfg = await getPlatformConfig(platform);
      if (platform === 'instagram' && (!cfg.appId || !cfg.appSecret)) {
        const fbCfg = await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>));
        if (fbCfg.appId && fbCfg.appSecret) {
          cfg = { ...fbCfg, ...cfg, appId: cfg.appId || fbCfg.appId, appSecret: cfg.appSecret || fbCfg.appSecret };
        }
      }
      const clientId = cfg[meta.idField];
      const secretRequired = isOAuthClientSecretRequired(platform);
      const secretValue = platform === 'instagram' || platform === 'facebook' || platform === 'threads' ? cfg.appSecret : cfg.clientSecret;
      const redirectUri = resolveOAuthRedirectUri(platform, cfg.redirectUri, req);
      return res.json({ success: true, configured: Boolean(clientId && redirectUri && (!secretRequired || secretValue)) });
    } catch (e) {
      logger.warn({ e }, 'integration_config_check_failed');
      return res.json({ success: true, configured: false });
    }
  });

  // Deauthorize / data-deletion callbacks live in complianceRoutes.ts.

  // Redirect URI Validator endpoint for Admin Integrations & Auth Providers
  router.post('/admin/platform-configs/:platform/validate-redirect-uri', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const platform = String(req.params.platform || '').trim().toLowerCase();
      const candidateUri = String(req.body?.redirectUri || '').trim();
      const expectedPath = platform === 'google_calendar'
        ? '/api/calendar/google/callback'
        : platform === 'hubtel'
          ? '/api/payments/hubtel/callback'
          : platform === 'vapi'
            ? '/webhooks/vapi'
            : `/auth/${platform}/callback`;

      const canonicalUri = platform === 'google_calendar' || platform === 'hubtel' || platform === 'vapi'
        ? `${resolveOAuthRedirectUri('facebook', '', req).replace(/\/auth\/facebook\/callback$/, '')}${expectedPath}`
        : resolveOAuthRedirectUri(platform, '', req);

      const cfg = await getPlatformConfig(platform).catch(() => ({} as Record<string, string>));
      const savedUri = String(cfg.redirectUri || cfg.calendarRedirectUri || '').trim();

      return res.json({
        success: true,
        platform,
        candidateUri,
        expectedPath,
        canonicalUri,
        savedUri: savedUri || null,
        matchesSaved: Boolean(savedUri && savedUri === candidateUri),
        matchesCanonical: candidateUri === canonicalUri,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e?.message || 'Validation failed' });
    }
  });

  router.post('/integrations/validate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { platform, credentials: rawCredentials } = req.body as { platform: string; credentials: Record<string, string> };
      const credentials: Record<string, string> = rawCredentials && typeof rawCredentials === 'object' ? rawCredentials : {};
      switch (platform) {
        case 'wordpress': {
          const { siteUrl, username, applicationPassword } = credentials;
          if (!siteUrl || !username || !applicationPassword) throw new Error('Site URL, username and application password are required');
          // User-supplied host: fetched through the SSRF guard.
          const resp = await safeAxios({
            method: 'GET',
            url: `${normalizeWordPressSiteUrl(siteUrl)}/wp-json/wp/v2/users/me`,
            auth: { username, password: applicationPassword }, validateStatus: () => true, timeout: 8000, maxContentLength: 2 * 1024 * 1024,
          });
          if (resp.status === 200) return res.json({ success: true, handle: (resp.data as any)?.name || username });
          if (resp.status === 401) throw new Error('Invalid WordPress credentials');
          throw new Error(`WordPress site returned ${resp.status}`);
        }
        case 'mailchimp': {
          const { apiKey, serverPrefix } = credentials;
          const prefix = resolveMailchimpServerPrefix(apiKey, serverPrefix);
          if (!apiKey || !prefix) throw new Error('Enter a Mailchimp API key ending in its data center (e.g. "-us6")');
          const resp = await axios.get(`https://${prefix}.api.mailchimp.com/3.0/`, {
            auth: { username: 'anystring', password: apiKey }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid Mailchimp API key or server prefix');
        }
        case 'chatgpt': {
          const { apiKey } = credentials;
          const resp = await axios.get('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid OpenAI API key');
        }
        case 'webflow': {
          const { apiToken } = credentials;
          const resp = await axios.get('https://api.webflow.com/v2/sites', {
            headers: { Authorization: `Bearer ${apiToken}` }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid Webflow API token');
        }

        case 'linear': {
          const { apiKey } = credentials;
          const resp = await axios.post(
            'https://api.linear.app/graphql',
            { query: '{ viewer { id name } }' },
            { headers: { Authorization: apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 8000 }
          );
          if (resp.status === 200 && !resp.data?.errors) return res.json({ success: true });
          throw new Error('Invalid Linear API key');
        }
        case 'square': {
          const { accessToken } = credentials;
          const resp = await axios.get('https://connect.squareup.com/v2/locations', {
            headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2024-01-18' },
            validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true });
          throw new Error('Invalid Square access token');
        }
        case 'zapier': {
          const { webhookUrl } = credentials;
          if (!webhookUrl?.startsWith('https://')) throw new Error('Invalid webhook URL');
          const resp = await safeAxios({ method: 'POST', url: webhookUrl, data: { test: true, source: 'ContentFlow' }, validateStatus: () => true, timeout: 8000 });
          if (resp.status < 400) return res.json({ success: true });
          throw new Error(`Webhook returned status ${resp.status}`);
        }
        case 'apify': {
          const apiToken = String(credentials.apiToken || credentials.token || '').trim();
          if (!apiToken) throw new Error('Missing Apify API token');
          const resp = await axios.get('https://api.apify.com/v2/users/me', {
            headers: { Authorization: `Bearer ${apiToken}` }, validateStatus: () => true, timeout: 8000,
          });
          if (resp.status === 200) return res.json({ success: true, handle: resp.data?.data?.username || resp.data?.data?.email || 'Apify' });
          if (resp.status === 401 || resp.status === 403) throw new Error('Invalid Apify API token');
          throw new Error(`Apify returned ${resp.status}`);
        }
        default:
          return res.status(400).json({ success: false, error: `Credential validation is not available for "${String(platform || '')}"` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      return res.status(400).json({ success: false, error: message });
    }
  });

  router.get('/integrations/enabled', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) {
        return res.json({
          success: true,
          enabled: Array.from(inMemoryPlatformConfigs.values())
            .filter((r) => r.enabled)
            .map((r) => String(r.platform || '').toLowerCase())
            .filter(Boolean),
        });
      }
      const platformResult = await dbQuery(`SELECT platform FROM platform_configs WHERE enabled = true`);
      const providerResult = await dbQuery(`SELECT provider FROM auth_providers WHERE enabled = true`);
      const enabled = Array.from(new Set<string>([
        ...platformResult.rows.map((r: any) => String(r.platform || '').toLowerCase()).filter(Boolean),
        ...providerResult.rows.map((r: any) => String(r.provider || '').toLowerCase()).filter(Boolean),
      ]));
      return res.json({ success: true, enabled });
    } catch (error) {
      logger.error('Get enabled integrations error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch enabled integrations' });
    }
  });

  router.get('/integrations/catalog', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const SUPPORTED_SLUGS = ['wordpress', 'facebook', 'instagram', 'linkedin', 'twitter', 'pinterest', 'mailchimp', 'tiktok', 'threads', 'gmail', 'slack', 'whatsapp', 'zoom', 'google_calendar'] as const;
      const integrations: Array<{
        slug: string; name: string; type: 'cms' | 'social' | 'marketing' | 'messaging' | 'other';
        adminEnabled: boolean; configured: boolean; connected: boolean; connection: Record<string, any> | null;
        health?: ConnectionHealth | null;
      }> = [];

      if (!pool) {
        for (const slug of SUPPORTED_SLUGS) {
          const configRow = inMemoryPlatformConfigs.get(slug);
          const item = {
            slug,
            name: slug === 'twitter' ? 'X (Twitter)' : slug === 'wordpress' ? 'WordPress' : slug[0].toUpperCase() + slug.slice(1),
            type: (slug === 'wordpress' ? 'cms' : slug === 'mailchimp' ? 'marketing' : 'social') as 'cms' | 'social' | 'marketing' | 'other',
            adminEnabled: configRow ? Boolean(configRow.enabled) : false,
            configured: slug === 'wordpress' || slug === 'mailchimp' ? true : Boolean(configRow?.config && Object.keys(configRow.config || {}).length > 0),
            connected: false, connection: null,
          };
          if (item.adminEnabled && item.configured) integrations.push(item);
        }
        return res.json({ success: true, integrations });
      }

      const configRows = await pool.query('SELECT platform, config, enabled FROM platform_configs').catch(() => ({ rows: [] as any[] }));
      const cfgMap = new Map<string, { config: Record<string, any>; enabled: boolean }>();
      for (const r of configRows.rows as any[]) {
        cfgMap.set(String(r.platform || '').toLowerCase(), { config: r.config || {}, enabled: Boolean(r.enabled) });
      }
      const facebookPlatformConfig = cfgMap.get('facebook')?.config || {};

      const wpConnRows = await pool.query('SELECT site_url, username, created_at FROM wordpress_connections WHERE user_id=$1 LIMIT 1', [auth.userId]).catch(() => ({ rows: [] as any[] }));
      const wpConn = wpConnRows.rows[0] || null;

      const socialRows = await pool.query(
        `SELECT platform, account_type, account_id, account_name, handle, connected, created_at,
                COALESCE(needs_reapproval, false) AS needs_reapproval,
                COALESCE(token_expires_at, expires_at) AS expires_at,
                token_data->>'reason' AS reason,
                token_data->>'login_method' AS login_method,
                token_data->>'graph_host' AS graph_host,
                token_data->>'pageId' AS page_id,
                (refresh_token_encrypted IS NOT NULL OR refresh_token IS NOT NULL) AS has_refresh,
                (access_token_encrypted IS NOT NULL OR access_token IS NOT NULL) AS has_access
         FROM social_accounts WHERE user_id=$1 AND connected=true`,
        [auth.userId]
      ).catch(() => ({ rows: [] as any[] }));

      const userIntegrationRows = await pool.query(
        `SELECT i.slug, ui.status, ui.account_id, ui.account_name, ui.created_at
         FROM user_integrations ui
         JOIN integrations i ON i.id = ui.integration_id
         WHERE ui.user_id = $1`,
        [auth.userId]
      ).catch(() => ({ rows: [] as any[] }));
      const userIntegrationMap = new Map<string, any>();
      for (const r of userIntegrationRows.rows as any[]) {
        userIntegrationMap.set(String(r.slug || '').toLowerCase(), r);
      }

      const hasPlatformProfile = (slug: string) =>
        (socialRows.rows as any[]).some(
          (r) =>
            normalizePlatformId(r.platform) === slug &&
            (r.account_type === 'profile' || r.account_type === 'page' || !r.account_type),
        );

      const getPrimaryAccount = (slug: string) => {
        const matches = (socialRows.rows as any[]).filter((r) => normalizePlatformId(r.platform) === slug);
        if (matches.length === 0) return null;
        const pageRows = matches.filter((r) => String(r.account_type || '').toLowerCase() === 'page');
        if (slug === 'facebook' && pageRows.length > 0) {
          const primaryPage = pageRows[0];
          const pageNames = pageRows.map((p) => String(p.account_name || '').trim()).filter(Boolean);
          return {
            accountType: 'page',
            accountId: primaryPage.account_id || null,
            accountName: pageNames.length > 1 ? `${pageNames[0]} (+${pageNames.length - 1} more)` : (primaryPage.account_name || null),
            username: primaryPage.handle || null,
            connectedAt: primaryPage.created_at || null,
          };
        }
        const match = matches.find((r) => r.account_type === 'profile' || !r.account_type) || matches[0];
        return { accountType: match.account_type || 'profile', accountId: match.account_id || null, accountName: match.account_name || null, username: match.handle || null, connectedAt: match.created_at || null };
      };

      // Connection state the user can act on. Only publishing tokens are
      // lifecycle-managed here; other providers report an explicit flag only.
      const getHealth = (slug: string): ConnectionHealth | null => {
        const rows = (socialRows.rows as any[]).filter((r) => normalizePlatformId(r.platform) === slug);
        const profile = rows.find((r) => r.account_type === 'profile' || !r.account_type);
        if (!profile) return null;
        const publishing = PUBLISHING_TOKEN_SLUGS.has(slug);
        const refreshable = getRefreshMode(slug, {
          hasRefreshToken: Boolean(profile.has_refresh),
          isInstagramDirect: slug === 'instagram' && isInstagramDirectLogin({ tokenData: { login_method: profile.login_method, graph_host: profile.graph_host, pageId: profile.page_id } }),
        }) !== 'none';
        const health = computeConnectionHealth({
          // Older scans soft-flagged Gmail/Calendar/Zoom tokens that renew
          // themselves; only a hard flag (revoked, inactive) means anything there.
          needsReapproval: Boolean(profile.needs_reapproval) && (publishing || !isSoftReapprovalReason(profile.reason)),
          reason: profile.reason,
          expiresAt: publishing ? profile.expires_at : null,
          refreshable: publishing ? refreshable : true,
        });
        // Page tokens outlive the Facebook user token, so a lapsed login only
        // stops Page discovery, not publishing.
        if (
          slug === 'facebook' && health.status === 'reconnect_required' &&
          ['token_expired', 'token_refresh_failed'].includes(String(health.reason)) &&
          rows.some((r) => r.account_type === 'page' && r.has_access)
        ) {
          return {
            status: 'expiring',
            reason: 'user_token_expired',
            message: 'Publishing to your saved Pages continues. Reconnect Facebook to refresh Page access and your Page list.',
            expiresAt: health.expiresAt,
          };
        }
        return health;
      };

      for (const slug of SUPPORTED_SLUGS) {
        const registry = await getIntegrationRowBySlug(slug).catch(() => null);
        const nameMap: Record<string, string> = { twitter: 'X (Twitter)', wordpress: 'WordPress', google_calendar: 'Google Calendar' };
        const name = registry?.name || nameMap[slug] || (slug[0].toUpperCase() + slug.slice(1));
        const typeMap: Record<string, string> = { wordpress: 'cms', mailchimp: 'marketing', gmail: 'messaging', slack: 'messaging', zoom: 'messaging', whatsapp: 'messaging', google_calendar: 'messaging' };
        const type = (registry?.type as any) || typeMap[slug] || 'social';
        const cfg = cfgMap.get(slug)?.config || {};
        const manualSlug = slug === 'wordpress' || slug === 'mailchimp' || slug === 'whatsapp';
        const adminEnabled = cfgMap.has(slug) ? Boolean(cfgMap.get(slug)?.enabled) : manualSlug;

        let configured = false;
        if (manualSlug) {
          configured = true;
        } else if (slug === 'instagram') {
          const metaConfig = Object.keys(cfg || {}).length > 0 ? cfg : facebookPlatformConfig;
          const clientId = String((metaConfig as any).appId || '').trim();
          const redirectUri = resolveOAuthRedirectUri('facebook', String((facebookPlatformConfig as any).redirectUri || (metaConfig as any).redirectUri || ''), req);
          const secretValue = String((metaConfig as any).appSecret || (facebookPlatformConfig as any).appSecret || '').trim();
          configured = Boolean(clientId && redirectUri && secretValue);
        } else if (slug === 'google_calendar') {
          // Reuse Gmail credentials if no dedicated google_calendar config is set
          const calCfg = Object.keys(cfg || {}).length > 0 ? cfg : cfgMap.get('gmail')?.config || {};
          const clientId = String((calCfg as any).clientId || '').trim();
          const clientSecret = String((calCfg as any).clientSecret || '').trim();
          configured = Boolean(clientId && clientSecret);
        } else {
          const meta = oauthAuthUrls[slug];
          if (meta) {
            const clientId = String((cfg as any)[meta.idField] || '').trim();
            const redirectUri = resolveOAuthRedirectUri(slug, String((cfg as any).redirectUri || ''), req);
            const secretRequired = isOAuthClientSecretRequired(slug);
            const secretValue = String((cfg as any).clientSecret || (cfg as any).appSecret || '').trim();
            configured = Boolean(clientId && redirectUri && (!secretRequired || secretValue));
          }
        }

        const isUserIntegrationSlug = (s: string) => s === 'mailchimp' || s === 'whatsapp';
        const connected = slug === 'wordpress' ? Boolean(wpConn)
          : isUserIntegrationSlug(slug) ? String(userIntegrationMap.get(slug)?.status || '').toLowerCase() === 'connected'
          : slug === 'instagram' ? Boolean(getPrimaryAccount('instagram'))
          : hasPlatformProfile(slug);

        const getUserIntegrationConnection = (s: string) => {
          const row = userIntegrationMap.get(s);
          return row ? { accountId: row.account_id ?? null, accountName: row.account_name ?? null, connectedAt: row.created_at ?? null } : null;
        };

        const connection = slug === 'wordpress'
          ? (wpConn ? { siteUrl: wpConn.site_url, username: wpConn.username, connectedAt: wpConn.created_at } : null)
          : isUserIntegrationSlug(slug)
            ? getUserIntegrationConnection(slug)
            : getPrimaryAccount(slug);

        if (adminEnabled && configured) {
          integrations.push({ slug, name, type, adminEnabled, configured, connected, connection, health: connected ? getHealth(slug) : null });
        }
      }

      return res.json({ success: true, integrations });
    } catch (error) {
      logger.error('Get integration catalog error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch integrations' });
    }
  });

  // ─── Frontend-compat integration adapter routes ───────────────────────────

  const PLATFORM_NAMES: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn',
    twitter: 'X (Twitter)', pinterest: 'Pinterest', tiktok: 'TikTok',
    threads: 'Threads', wordpress: 'WordPress', mailchimp: 'Mailchimp',
  };

  // GET /integrations — returns Integration[] (bare array for frontend hook compatibility)
  router.get('/integrations', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const type = String(req.query.type || '').trim().toLowerCase() || null;

      const all = [
        { id: 'facebook', slug: 'facebook', name: 'Facebook', type: 'social' },
        { id: 'instagram', slug: 'instagram', name: 'Instagram', type: 'social' },
        { id: 'linkedin', slug: 'linkedin', name: 'LinkedIn', type: 'social' },
        { id: 'twitter', slug: 'twitter', name: 'X (Twitter)', type: 'social' },
        { id: 'pinterest', slug: 'pinterest', name: 'Pinterest', type: 'social' },
        { id: 'tiktok', slug: 'tiktok', name: 'TikTok', type: 'social' },
        { id: 'threads', slug: 'threads', name: 'Threads', type: 'social' },
        { id: 'wordpress', slug: 'wordpress', name: 'WordPress', type: 'cms' },
        { id: 'mailchimp', slug: 'mailchimp', name: 'Mailchimp', type: 'marketing' },
      ];

      if (hasDatabase()) {
        try {
          const result = await dbQuery('SELECT platform FROM platform_configs WHERE enabled = true');
          const enabled = new Set((result.rows as any[]).map((r) => String(r.platform || '').toLowerCase()));
          if (enabled.size > 0) {
            const filtered = all.filter((i) => enabled.has(i.slug) || i.slug === 'wordpress' || i.slug === 'mailchimp');
            return res.json(type ? filtered.filter((i) => i.type === type) : filtered);
          }
        } catch (_err) { /* fall through */ }
      }

      return res.json(type ? all.filter((i) => i.type === type) : all);
    } catch (error) {
      logger.error('Get integrations list error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch integrations' });
    }
  });

  // GET /my-integrations — returns UserIntegration[] (bare array for frontend hook compatibility)
  router.get('/my-integrations', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json([]);

      const socialRes = await pool.query(
        `SELECT id, platform, account_id, account_name, handle, connected, created_at FROM social_accounts WHERE user_id=$1`,
        [auth.userId]
      );

      const uiRes = await pool.query(
        `SELECT ui.id, i.slug, i.name, i.type, ui.account_id, ui.account_name, ui.status, ui.created_at
         FROM user_integrations ui JOIN integrations i ON i.id = ui.integration_id WHERE ui.user_id=$1`,
        [auth.userId]
      ).catch(() => ({ rows: [] as any[] }));

      const socialItems = (socialRes.rows as any[]).map((r) => ({
        id: r.id,
        integrationId: r.platform,
        accountId: r.account_id || null,
        accountName: r.account_name || r.handle || null,
        accountEmail: null,
        status: r.connected ? 'CONNECTED' : 'DISCONNECTED',
        createdAt: r.created_at,
        integration: { id: r.platform, name: PLATFORM_NAMES[r.platform] || r.platform, slug: r.platform, type: 'social' },
      }));

      const uiItems = (uiRes.rows as any[]).map((r) => ({
        id: r.id,
        integrationId: r.slug,
        accountId: r.account_id || null,
        accountName: r.account_name || null,
        accountEmail: null,
        status: String(r.status || '').toLowerCase() === 'connected' ? 'CONNECTED' : String(r.status || '').toLowerCase() === 'error' ? 'ERROR' : 'DISCONNECTED',
        createdAt: r.created_at,
        integration: { id: r.slug, name: r.name || PLATFORM_NAMES[r.slug] || r.slug, slug: r.slug, type: r.type || 'other' },
      }));

      return res.json([...socialItems, ...uiItems]);
    } catch (error) {
      logger.error('Get my-integrations error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch user integrations' });
    }
  });

  // GET /integrations/logs/:integrationId — must be registered before /:slug routes
  router.get('/integrations/logs/:integrationId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json([]);

      const { integrationId } = req.params;

      const logsRes = await pool.query(
        `SELECT il.id, il.event_type, il.status, il.created_at, il.response, il.response->>'error' AS error_message
         FROM integration_logs il
         JOIN integrations i ON i.id = il.integration_id
         WHERE il.user_id=$1 AND (i.slug=$2 OR il.integration_id::text=$2)
         ORDER BY il.created_at DESC LIMIT 20`,
        [auth.userId, integrationId]
      ).catch(() => ({ rows: [] as any[] }));

      if (logsRes.rows.length > 0) {
        return res.json((logsRes.rows as any[]).map((r) => ({
          id: r.id, eventType: r.event_type, status: r.status,
          createdAt: r.created_at, response: r.response, errorMessage: r.error_message,
        })));
      }

      const pubRes = await pool.query(
        `SELECT id, platform as event_type, status, created_at FROM publishing_logs
         WHERE user_id=$1 AND (platform=$2 OR id=$2) ORDER BY created_at DESC LIMIT 20`,
        [auth.userId, integrationId]
      ).catch(() => ({ rows: [] as any[] }));

      return res.json((pubRes.rows as any[]).map((r) => ({
        id: r.id, eventType: r.event_type || 'publish', status: r.status, createdAt: r.created_at,
      })));
    } catch (error) {
      logger.error('Get integration logs error:', error);
      return res.json([]);
    }
  });

  // GET /integrations/:slug/auth-url
  router.get('/integrations/:slug/auth-url', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const slug = String(req.params.slug || '').trim().toLowerCase();
      const meta = oauthAuthUrls[slug];
      if (!meta) return res.status(404).json({ success: false, error: `Platform "${slug}" does not support OAuth` });

      const ownCfg = await getPlatformConfig(slug).catch(() => ({} as Record<string, string>));
      const fbCfg = slug === 'instagram' ? await getPlatformConfig('facebook').catch(() => ({} as Record<string, string>)) : {};
      const { cfg, inheritedFromFacebook } = slug === 'instagram' ? resolveInstagramAppConfig(ownCfg, fbCfg) : { cfg: ownCfg, inheritedFromFacebook: false };
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const redirectUri = resolveOAuthRedirectUri(slug, String((cfg as any).redirectUri || ''), req);
      const state = randomBytes(16).toString('hex');
      // X requires PKCE and TikTok accepts it; this flow keeps the verifier
      // server-side with the state.
      const pkce = slug === 'twitter' || slug === 'tiktok' ? generatePkcePair() : null;
      const built = buildOAuthAuthorizeUrl({
        platform: slug,
        cfg,
        facebookCfg: fbCfg,
        inheritedFromFacebook,
        redirectUri,
        state,
        method: typeof req.query.method === 'string' ? req.query.method : undefined,
        codeChallenge: pkce?.codeChallenge,
        codeChallengeMethod: pkce ? 'S256' : undefined,
      });
      if (!built.ok) {
        const error = built.status === 400 && /not configured/i.test(built.error) ? `${PLATFORM_NAMES[slug] || slug} is not configured by admin` : built.error;
        return res.status(built.status).json({ success: false, error });
      }

      await pool.query(
        `INSERT INTO oauth_states (state, user_id, platform, return_to, code_verifier, expires_at)
         VALUES ($1, $2, $3, '/integrations', $4, NOW() + INTERVAL '15 minutes')`,
        [state, auth.userId, slug, pkce?.codeVerifier ?? null]
      );

      return res.json({ authUrl: built.url, state });
    } catch (error) {
      logger.error('Get integration auth URL error:', error);
      return res.status(500).json({ success: false, error: 'Failed to generate auth URL' });
    }
  });

  // POST /integrations/:integrationId/disconnect
  router.post('/integrations/:integrationId/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

      const { integrationId } = req.params;

      const accountRes = await pool.query(
        `SELECT id, platform FROM social_accounts WHERE user_id=$1 AND (id=$2 OR LOWER(platform)=LOWER($2)) LIMIT 1`,
        [auth.userId, integrationId]
      );

      if (accountRes.rows.length > 0) {
        const row = accountRes.rows[0] as any;
        // A platform name removes every row of that platform (a Facebook
        // profile and its Pages); a row id removes just that account.
        const byPlatform = String(row.platform || '').toLowerCase() === String(integrationId || '').toLowerCase();
        if (byPlatform) {
          await pool.query(`DELETE FROM social_accounts WHERE user_id=$1 AND LOWER(platform)=LOWER($2)`, [auth.userId, row.platform]);
        } else {
          await pool.query(`DELETE FROM social_accounts WHERE user_id=$1 AND id=$2`, [auth.userId, row.id]);
        }
        const remaining = await pool.query(`SELECT 1 FROM social_accounts WHERE user_id=$1 AND LOWER(platform)=LOWER($2) LIMIT 1`, [auth.userId, row.platform]);
        if (remaining.rows.length === 0) {
          await dbQuery(
            `UPDATE user_integrations SET status='disconnected', access_token=NULL, refresh_token=NULL, token_expiry=NULL
             WHERE user_id=$1 AND integration_id IN (SELECT id FROM integrations WHERE slug=LOWER($2))`,
            [auth.userId, row.platform]
          ).catch(() => undefined);
        }
        return res.json({ success: true });
      }

      await pool.query(
        `UPDATE user_integrations SET status='disconnected' WHERE user_id=$1 AND id=$2`,
        [auth.userId, integrationId]
      ).catch(() => undefined);

      return res.json({ success: true });
    } catch (error) {
      logger.error('Disconnect integration error:', error);
      return res.status(500).json({ success: false, error: 'Failed to disconnect' });
    }
  });

  // GET /integrations/:integrationId/accounts
  router.get('/integrations/:integrationId/accounts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.json([]);

      const { integrationId } = req.params;

      const result = await pool.query(
        `SELECT id, platform, account_id, account_name, handle, connected, created_at
         FROM social_accounts WHERE user_id=$1 AND (LOWER(platform)=LOWER($2) OR id=$2)`,
        [auth.userId, integrationId]
      );

      return res.json((result.rows as any[]).map((r) => ({
        id: r.id,
        integrationId: r.platform,
        accountId: r.account_id || null,
        accountName: r.account_name || r.handle || null,
        accountEmail: null,
        status: r.connected ? 'CONNECTED' : 'DISCONNECTED',
        createdAt: r.created_at,
        integration: { id: r.platform, name: PLATFORM_NAMES[r.platform] || r.platform, slug: r.platform, type: 'social' },
      })));
    } catch (error) {
      logger.error('Get integration accounts error:', error);
      return res.json([]);
    }
  });

  return router;
}
