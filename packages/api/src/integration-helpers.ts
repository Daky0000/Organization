import type NodeFormData from 'form-data';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, randomUUID } from 'crypto';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { pool, dbQuery } from './db.ts';
import { safeAxios } from './ssrf-guard.ts';

const INTEGRATIONS_ENCRYPTION_KEY = scryptSync(config.integrationsEncryptionKey, 'integrations', 32);
const WORDPRESS_ENCRYPTION_KEY = scryptSync(config.wordpressEncryptionKey, 'wordpress', 32);

// --- Integrations: encryption + logs ---
export function encryptIntegrationSecret(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', INTEGRATIONS_ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

export function decryptIntegrationSecret(encrypted: string): string {
  const buf = Buffer.from(String(encrypted || ''), 'base64');
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', INTEGRATIONS_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

// ── Platform-config secrets at rest ──────────────────────────────────────────
// Secret-looking fields in platform_configs.config are AES-encrypted with a
// version marker. Reads decrypt transparently; values without the marker
// (rows saved before encryption shipped) pass through unchanged, so existing
// configs keep working until re-saved.
const PLATFORM_SECRET_PREFIX = 'encv1:';
const PLATFORM_SECRET_FIELD = /(secret|token|password|api_?key|access_?key|signing_?key)/i;

export function isSecretPlatformField(key: string): boolean {
  return PLATFORM_SECRET_FIELD.test(String(key || ''));
}

export function encryptPlatformConfig(config: Record<string, any> | null | undefined): Record<string, any> {
  if (!config || typeof config !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && v && isSecretPlatformField(k) && !v.startsWith(PLATFORM_SECRET_PREFIX)) {
      out[k] = PLATFORM_SECRET_PREFIX + encryptIntegrationSecret(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function decryptPlatformConfig(config: Record<string, any> | null | undefined): Record<string, any> {
  if (!config || typeof config !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && v.startsWith(PLATFORM_SECRET_PREFIX)) {
      try {
        out[k] = decryptIntegrationSecret(v.slice(PLATFORM_SECRET_PREFIX.length));
      } catch (err) {
        // Encrypted under a different INTEGRATIONS_ENCRYPTION_KEY — surface as
        // unconfigured rather than passing ciphertext to a provider API.
        logger.warn({ field: k, err: err instanceof Error ? err.message : String(err) }, 'platform_config_decrypt_failed');
        out[k] = '';
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Admin config reads show secrets masked; a masked value coming back on save
// means "unchanged". Real secrets never contain the bullet character.
const SECRET_MASK_CHAR = '•';

export function maskSecretValue(value: unknown): string {
  const v = String(value ?? '');
  if (!v) return '';
  return v.length > 4 ? `${SECRET_MASK_CHAR.repeat(4)}${v.slice(-4)}` : SECRET_MASK_CHAR.repeat(4);
}

export function isMaskedSecretValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes(SECRET_MASK_CHAR);
}

export function maskPlatformConfigSecrets(config: Record<string, any> | null | undefined): Record<string, any> {
  if (!config || typeof config !== 'object') return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = isSecretPlatformField(k) && typeof v === 'string' && v ? maskSecretValue(v) : v;
  }
  return out;
}

// Restores the stored secret wherever the incoming (decrypted-space) config
// still carries the mask the admin UI was shown.
export function mergeMaskedSecrets(
  existing: Record<string, any> | null | undefined,
  incoming: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = { ...incoming };
  for (const [k, v] of Object.entries(incoming)) {
    if (isSecretPlatformField(k) && isMaskedSecretValue(v)) {
      const previous = existing && typeof existing[k] === 'string' ? existing[k] : '';
      if (previous) out[k] = previous;
      else delete out[k];
    }
  }
  return out;
}

// Mailchimp keys end in "-<datacenter>" (e.g. "...-us6"); the datacenter is
// the API host prefix. Validated strictly because it becomes part of a hostname.
export function resolveMailchimpServerPrefix(apiKey: string, serverPrefix?: string | null): string | null {
  const key = String(apiKey || '').trim();
  const fromKey = key.includes('-') ? key.slice(key.lastIndexOf('-') + 1) : '';
  const candidate = String(serverPrefix || '').trim().toLowerCase() || fromKey.toLowerCase();
  return /^[a-z]{2,4}\d{1,3}$/.test(candidate) ? candidate : null;
}

export async function getIntegrationRowBySlug(slug: string): Promise<{ id: number; slug: string; name: string | null; type: string | null } | null> {
  if (!pool) return null;
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  const result = await dbQuery<{ id: number; slug: string; name: string | null; type: string | null }>(
    `SELECT id, slug, name, type FROM integrations WHERE slug = $1 LIMIT 1`,
    [s]
  ).catch(() => ({ rows: [] } as any));
  return result.rows[0] ?? null;
}

export async function logIntegrationEvent(params: {
  userId: string | null;
  integrationSlug: string | null;
  eventType: string;
  status: 'success' | 'failed' | 'info';
  response?: any;
}) {
  if (!pool) return;
  const integration = params.integrationSlug ? await getIntegrationRowBySlug(params.integrationSlug) : null;
  await dbQuery(
    `INSERT INTO integration_logs (id, user_id, integration_id, event_type, status, response, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
    [
      randomUUID(),
      params.userId,
      integration?.id ?? null,
      String(params.eventType || '').slice(0, 80),
      params.status,
      JSON.stringify(params.response ?? {}),
    ]
  ).catch(() => undefined);
}

export async function upsertUserIntegration(params: {
  userId: string;
  integrationSlug: string;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  tokenExpiry?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  status: 'connected' | 'disconnected' | 'error';
}) {
  if (!pool) return;
  const integration = await getIntegrationRowBySlug(params.integrationSlug);
  if (!integration) return;
  await dbQuery(
    `INSERT INTO user_integrations
      (id, user_id, integration_id, access_token, refresh_token, token_expiry, account_id, account_name, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (user_id, integration_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expiry = EXCLUDED.token_expiry,
           account_id = EXCLUDED.account_id,
           account_name = EXCLUDED.account_name,
           status = EXCLUDED.status`,
    [
      randomUUID(),
      params.userId,
      integration.id,
      params.accessTokenEncrypted ?? null,
      params.refreshTokenEncrypted ?? null,
      params.tokenExpiry ?? null,
      params.accountId ?? null,
      params.accountName ?? null,
      params.status,
    ]
  ).catch(() => undefined);
}

// --- WordPress: encryption and storage (credentials never logged) ---
export function encryptWordPressPassword(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', WORDPRESS_ENCRYPTION_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

export function decryptWordPressPassword(encrypted: string): string {
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', WORDPRESS_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

// Media sent to WordPress as a data URL (or bare base64). The declared type
// and the file extension must match the bytes: WordPress checks uploads
// against both, and a PNG sent as "image/jpeg ... .jpg" can be rejected.
const UPLOAD_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
};

export function decodeWordPressUpload(
  input: string,
  requestedName: string | undefined,
  defaultName: string,
): { buffer: Buffer; contentType: string; filename: string } {
  const raw = String(input || '').trim();
  const match = raw.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.*)$/is);
  const contentType = match ? match[1].toLowerCase() : 'image/jpeg';
  const buffer = Buffer.from(match ? match[2] : raw, 'base64');
  const base = String(requestedName || '').split(/[\\/]/).pop()!.replace(/[\x00-\x1f"]/g, '').trim() || defaultName;
  const extension = UPLOAD_EXTENSIONS[contentType];
  const stem = base.replace(/\.[a-z0-9]{1,5}$/i, '');
  const filename = extension ? `${stem || 'upload'}.${extension}` : base;
  return { buffer, contentType, filename };
}

export function normalizeWordPressSiteUrl(url: string): string {
  const u = String(url || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export interface WordPressConnection {
  id: string;
  userId: string;
  siteUrl: string;
  username: string;
  appPasswordEncrypted: string;
}

export async function getWordPressConnection(userId: string): Promise<WordPressConnection | null> {
  if (!pool) return null;
  const result = await dbQuery<{
    id: string;
    user_id: string;
    site_url: string;
    username: string;
    app_password_encrypted: string;
  }>('SELECT id, user_id, site_url, username, app_password_encrypted FROM wordpress_connections WHERE user_id = $1', [
    userId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    siteUrl: row.site_url,
    username: row.username,
    appPasswordEncrypted: row.app_password_encrypted,
  };
}

// --- Make webhook connection (store webhook URL encrypted; never log URL) ---
export async function getMakeWebhookConnection(userId: string): Promise<{ webhookUrlEncrypted: string } | null> {
  if (!pool) return null;
  const result = await dbQuery<{ webhook_url_encrypted: string }>(
    'SELECT webhook_url_encrypted FROM make_webhook_connections WHERE user_id = $1',
    [userId]
  );
  const row = result.rows[0];
  return row ? { webhookUrlEncrypted: row.webhook_url_encrypted } : null;
}

export async function ensureWordPressSocialAccount(userId: string) {
  if (!pool) return;
  const conn = await getWordPressConnection(userId);
  const webhookConn = await getMakeWebhookConnection(userId);
  if (!conn && !webhookConn) return;

  const accountId = conn?.siteUrl ? String(conn.siteUrl).trim() : 'wordpress';
  const accountName = conn?.username ? String(conn.username).trim() : 'WordPress';

  const updateRes = await dbQuery(
    `UPDATE social_accounts
     SET account_name = $3,
         connected = true,
         connected_at = NOW()
     WHERE user_id = $1 AND platform = 'wordpress' AND account_type = 'site' AND account_id = $2`,
    [userId, accountId, accountName]
  );
  if (updateRes.rowCount === 0) {
    await dbQuery(
      `INSERT INTO social_accounts (id, user_id, platform, platform_id, account_type, account_id, account_name, connected, connected_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW())`,
      [randomUUID(), userId, 'wordpress', null, 'site', accountId, accountName]
    );
  }
}

export async function removeWordPressSocialAccount(userId: string) {
  if (!pool) return;
  await dbQuery('DELETE FROM social_accounts WHERE user_id = $1 AND platform = $2', [userId, 'wordpress']);
}

export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(String(url || '').trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

const WORDPRESS_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

// The site URL is user-supplied, so every call goes through the SSRF guard
// (validated up front and pinned to public IPs at connect time, including on
// redirects), with bounded response sizes and a timeout.
export async function wpRequest(
  siteUrl: string,
  username: string,
  appPassword: string,
  method: string,
  path: string,
  options: { data?: any; formData?: FormData | NodeFormData; responseType?: 'json' } = {}
): Promise<{ data?: any; status: number; error?: string }> {
  const base = normalizeWordPressSiteUrl(siteUrl);
  const url = `${base.replace(/\/+$/, '')}/wp-json${path.startsWith('/') ? path : `/${path}`}`;
  const auth = Buffer.from(`${username}:${appPassword}`, 'utf8').toString('base64');
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
  };
  const isUpload = Boolean(options.formData);
  if (options.formData && 'getHeaders' in options.formData) Object.assign(headers, options.formData.getHeaders());
  if (!isUpload && options.data !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await safeAxios<any>({
      method,
      url,
      data: isUpload ? options.formData : options.data,
      headers,
      maxRedirects: 2,
      validateStatus: () => true,
      timeout: isUpload ? 60_000 : 20_000,
      maxBodyLength: isUpload ? WORDPRESS_UPLOAD_LIMIT_BYTES : 10 * 1024 * 1024,
      maxContentLength: 10 * 1024 * 1024,
    });
    const error = res.status >= 400 ? (res.data?.message || res.data?.code || res.statusText) : undefined;
    return { data: res.data, status: res.status, error };
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || 'Request failed';
    return { status: err?.response?.status || 502, error: msg };
  }
}

// POST /api/wordpress/connect — validate and store connection (tries Application Password first, then login password)
