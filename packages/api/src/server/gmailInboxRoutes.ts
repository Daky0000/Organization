import { Router, type Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { isDeadGrantFlag, markGoogleGrantRevoked, refreshGoogleAccessToken } from '../google-oauth.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GmailInboxDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string } | null;
  pool: Pool | null;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  encryptIntegrationSecret: (plain: string) => string;
  decryptIntegrationSecret: (encrypted: string) => string;
  getAIConfig: () => Promise<any>;
  resolveActiveKey: (cfg: any) => string | null;
  GEMINI_MODELS: string[];
  callAINonStreaming: typeof import('../ai-helpers.ts').callAINonStreaming;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseEmailHeader(raw: string): { name: string; email: string } {
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, ''),
      email: match[2].trim().toLowerCase(),
    };
  }
  return { name: '', email: raw.trim().toLowerCase() };
}

function extractDomain(email: string): string {
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

// Strip subdomains to get the registrable root domain.
// E.g. updates.hostinger.com → hostinger.com, mail.google.com → google.com
// Handles country SLDs: hostinger.co.uk → hostinger.co.uk (3 parts)
const COUNTRY_SLDS = new Set(['co','com','org','net','gov','edu','ac','or','ne','me']);
function rootDomain(domain: string): string {
  if (!domain) return domain;
  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return domain;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (tld.length === 2 && COUNTRY_SLDS.has(sld)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function domainToCompany(domain: string): string {
  if (!domain) return '';
  const knownPersonal: Record<string, string> = {
    'gmail.com': 'Gmail (Personal)', 'yahoo.com': 'Yahoo', 'outlook.com': 'Outlook',
    'hotmail.com': 'Hotmail', 'icloud.com': 'iCloud', 'me.com': 'Apple',
    'protonmail.com': 'ProtonMail', 'aol.com': 'AOL', 'live.com': 'Microsoft',
    'msn.com': 'Microsoft', 'googlemail.com': 'Gmail (Personal)',
  };
  if (knownPersonal[domain]) return knownPersonal[domain];
  const parts = domain.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 2] : domain;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Content-Disposition for any filename: an ASCII fallback plus the exact
// UTF-8 name (RFC 6266/5987). Raw non-Latin names in a header make Node throw.
export function attachmentDisposition(filename: string): string {
  const name = String(filename || 'attachment').replace(/[\r\n]/g, ' ').trim() || 'attachment';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function base64urlDecode(str: string): string {
  try {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractBodyText(payload: any, depth = 0): string {
  if (!payload || depth > 6) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return base64urlDecode(payload.body.data);
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    // Strip HTML tags for plain-text representation
    const html = base64urlDecode(payload.body.data);
    return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractBodyText(part, depth + 1);
      if (text) return text;
    }
  }
  return '';
}

// Refresh Gmail access token if within 5 minutes of expiry. Returns null when
// Gmail is not connected or Google has revoked the grant (reconnect needed).
async function getValidGmailToken(
  pool: Pool,
  userId: string,
  getPlatformConfig: (p: string) => Promise<Record<string, string>>,
  encryptIntegrationSecret: (plain: string) => string,
  decryptIntegrationSecret: (enc: string) => string
): Promise<string | null> {
  const res = await pool.query(
    `SELECT access_token, refresh_token,
            access_token_encrypted, refresh_token_encrypted,
            token_expires_at, needs_reapproval, token_data->>'reason' AS reason
     FROM social_accounts
     WHERE user_id=$1 AND LOWER(platform)='gmail' AND connected=true
     LIMIT 1`,
    [userId]
  );
  if (!res.rows.length) return null;

  const row = res.rows[0] as any;
  if (isDeadGrantFlag(row.needs_reapproval, row.reason)) return null;

  // Tokens are stored encrypted; fall back to plain column for legacy rows
  const decrypt = (enc: string | null, plain: string | null): string => {
    if (enc) { try { return decryptIntegrationSecret(enc).trim(); } catch { /* fall through */ } }
    return String(plain || '').trim();
  };

  const accessToken = decrypt(row.access_token_encrypted, row.access_token);
  const refreshToken = decrypt(row.refresh_token_encrypted, row.refresh_token);
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;

  const needsRefresh = !expiresAt || expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  if (!needsRefresh || !refreshToken) return accessToken || null;

  const cfg = await getPlatformConfig('gmail');
  const refreshed = await refreshGoogleAccessToken(refreshToken, String(cfg.clientId || '').trim(), String(cfg.clientSecret || '').trim());
  if (!refreshed.ok) {
    if (refreshed.revoked) {
      await markGoogleGrantRevoked((sql, params) => pool.query(sql, params as any[]), userId, 'gmail');
      return null;
    }
    logger.warn({ userId, error: refreshed.error }, 'gmail_token_refresh_failed');
    return accessToken || null;
  }

  await pool.query(
    `UPDATE social_accounts
     SET access_token_encrypted=$1, access_token=NULL, token_expires_at=$2, needs_reapproval=false,
         token_data = COALESCE(token_data, '{}'::jsonb) - 'reason' - 'needs_reapproval_at'
     WHERE user_id=$3 AND LOWER(platform)='gmail'`,
    [encryptIntegrationSecret(refreshed.accessToken), refreshed.expiresAt, userId]
  );
  return refreshed.accessToken;
}

// ── CRM population ────────────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'pm.me',
]);

type CRMSyncResult = {
  receivedSenders: number;
  businessDomains: number;
  companiesCreated: number;
  contactsCreated: number;
  errors: string[];
};

async function syncToCRM(pool: Pool, userId: string): Promise<CRMSyncResult> {
  const result: CRMSyncResult = { receivedSenders: 0, businessDomains: 0, companiesCreated: 0, contactsCreated: 0, errors: [] };

  // 1. Collect all unique senders (received only) grouped by company domain
  const sendersResult = await pool.query(
    `SELECT DISTINCT ON (LOWER(from_email))
       LOWER(from_email) AS from_email,
       from_name,
       LOWER(SUBSTRING(from_email FROM POSITION('@' IN from_email) + 1)) AS domain
     FROM gmail_messages
     WHERE user_id=$1 AND NOT is_sent AND from_email <> '' AND POSITION('@' IN from_email) > 0
     ORDER BY LOWER(from_email), date DESC NULLS LAST`,
    [userId]
  );

  result.receivedSenders = sendersResult.rows.length;

  const byDomain = new Map<string, Array<{ email: string; name: string }>>();
  const personalContacts: Array<{ email: string; name: string }> = [];

  for (const row of sendersResult.rows as any[]) {
    const fullDomain = String(row.domain || '').trim();
    if (!fullDomain) continue;
    const domain = rootDomain(fullDomain); // collapse subdomains → root domain
    if (PERSONAL_DOMAINS.has(domain) || PERSONAL_DOMAINS.has(fullDomain)) {
      personalContacts.push({ email: String(row.from_email), name: String(row.from_name || '') });
    } else {
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push({ email: String(row.from_email), name: String(row.from_name || '') });
    }
  }

  result.businessDomains = byDomain.size;

  // 2. Upsert CRM company for each business domain
  for (const [domain, senders] of byDomain) {
    const companyName = domainToCompany(domain);

    let companyId: string;
    try {
      const existing = await pool.query(
        `SELECT id FROM crm_companies
         WHERE user_id=$1 AND (
           LOWER(domain)=$2
           OR (domain IS NULL AND LOWER(name)=$3)
         )
         ORDER BY CASE WHEN LOWER(domain)=$2 THEN 0 ELSE 1 END LIMIT 1`,
        [userId, domain, companyName.toLowerCase()]
      );

      if (existing.rows.length) {
        companyId = String(existing.rows[0].id);
        // Fill in domain if it was missing (e.g. manually created without domain)
        await pool.query(
          `UPDATE crm_companies SET
             domain = COALESCE(NULLIF(domain,''), $1),
             logo_url = COALESCE(logo_url, $2),
             updated_at = NOW()
           WHERE id=$3`,
          [domain, `https://logo.clearbit.com/${domain}`, companyId]
        ).catch(() => undefined);
      } else {
        const ins = await pool.query(
          `INSERT INTO crm_companies (id, user_id, name, domain, website, logo_url, custom_data, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, '{"source":"gmail_sync"}'::jsonb, NOW(), NOW())
           RETURNING id`,
          [userId, companyName, domain, `https://${domain}`, `https://logo.clearbit.com/${domain}`]
        );
        companyId = String(ins.rows[0].id);
        result.companiesCreated++;
      }
    } catch (e) {
      result.errors.push(`Company ${domain}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    // 3. Upsert contacts for this company
    for (const sender of senders) {
      const nameParts = sender.name.trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || sender.email.split('@')[0];
      const lastName = nameParts.slice(1).join(' ');

      try {
        const contactResult = await pool.query(
          `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, source, subscribed, unsubscribe_token, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'gmail', false, gen_random_uuid()::text, NOW(), NOW())
           ON CONFLICT (user_id, email) DO UPDATE SET
             first_name = CASE WHEN mailing_contacts.first_name IS NULL OR mailing_contacts.first_name = ''
                                THEN EXCLUDED.first_name ELSE mailing_contacts.first_name END,
             last_name  = CASE WHEN mailing_contacts.last_name IS NULL OR mailing_contacts.last_name = ''
                                THEN EXCLUDED.last_name ELSE mailing_contacts.last_name END,
             updated_at = NOW()
           RETURNING id`,
          [userId, sender.email, firstName, lastName]
        );

        const contactId = String(contactResult.rows[0].id);
        result.contactsCreated++;

        await pool.query(
          `INSERT INTO crm_contact_companies (contact_id, company_id, is_primary, created_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (contact_id, company_id) DO NOTHING`,
          [contactId, companyId]
        ).catch(() => undefined);

        // 4. Upsert email activities for this sender
        const msgs = await pool.query(
          `SELECT gmail_message_id, subject, snippet, date, is_sent
           FROM gmail_messages
           WHERE user_id=$1 AND (
             (NOT is_sent AND LOWER(from_email)=$2) OR
             (is_sent AND LOWER(to_email)=$2)
           )`,
          [userId, sender.email]
        );

        for (const msg of msgs.rows as any[]) {
          const msgDate = msg.date ? new Date(msg.date) : new Date();
          await pool.query(
            `INSERT INTO crm_activities
               (id, user_id, company_id, contact_id, type, title, body, gmail_message_id, created_at, updated_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, 'email', $4, $5, $6, $7, NOW())
             ON CONFLICT (gmail_message_id) WHERE gmail_message_id IS NOT NULL DO NOTHING`,
            [userId, companyId, contactId, String(msg.subject || '(No subject)'), String(msg.snippet || ''), String(msg.gmail_message_id), msgDate]
          ).catch(() => undefined);
        }
      } catch (e) {
        result.errors.push(`Contact ${sender.email}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 5. Create contacts for personal-domain senders (no company link)
  for (const sender of personalContacts) {
    const nameParts = sender.name.trim().split(/\s+/).filter(Boolean);
    await pool.query(
      `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, source, subscribed, unsubscribe_token, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'gmail', false, gen_random_uuid()::text, NOW(), NOW())
       ON CONFLICT (user_id, email) DO UPDATE SET
         first_name = CASE WHEN mailing_contacts.first_name IS NULL OR mailing_contacts.first_name = ''
                            THEN EXCLUDED.first_name ELSE mailing_contacts.first_name END,
         updated_at = NOW()`,
      [userId, sender.email, nameParts[0] || sender.email.split('@')[0], nameParts.slice(1).join(' ')]
    ).catch(() => undefined);
  }

  return result;
}

// ── Background sync ───────────────────────────────────────────────────────────

// Gmail's own 4xx (not found, forbidden) passes through; its 5xx and a 401,
// which the app would read as an expired login, do not.
function upstreamFailureStatus(status: number): number {
  return status >= 400 && status < 500 && status !== 401 ? status : 502;
}

// A run that has not reported progress for this long was cut short (deploy,
// crash) and must not block new syncs forever.
const GMAIL_SYNC_STALE_MINUTES = 30;

// Marks a run as started unless one is genuinely in progress; a 'running'
// row that stopped reporting progress was interrupted and is taken over.
async function claimGmailSync(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO gmail_sync_state(user_id, status, total_fetched, updated_at)
     VALUES($1,'running',0,NOW())
     ON CONFLICT(user_id) DO UPDATE SET status='running', total_fetched=0, error_message=NULL, updated_at=NOW()
       WHERE gmail_sync_state.status <> 'running'
          OR gmail_sync_state.updated_at < NOW() - ($2::int * INTERVAL '1 minute')
     RETURNING user_id`,
    [userId, GMAIL_SYNC_STALE_MINUTES]
  );
  return rows.length > 0;
}

// Runs a sync the caller has claimed with claimGmailSync.
async function runGmailSync(
  pool: Pool,
  userId: string,
  getPlatformConfig: (p: string) => Promise<Record<string, string>>,
  encryptIntegrationSecret: (plain: string) => string,
  decryptIntegrationSecret: (enc: string) => string
): Promise<void> {
  const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const MAX_MESSAGES = 2000;
  const BATCH_CONCURRENCY = 10;

  try {
    const token = await getValidGmailToken(pool, userId, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret);
    if (!token) throw new Error('Gmail not connected or token expired. Please reconnect Gmail.');

    // ── Collect up to MAX_MESSAGES message IDs ─────────────────────────────
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    while (messageIds.length < MAX_MESSAGES) {
      const params: Record<string, string> = { maxResults: '500' };
      if (pageToken) params.pageToken = pageToken;

      const listResp = await axios.get(`${GMAIL_API}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
        validateStatus: () => true,
        timeout: 20000,
      });

      if (listResp.status === 401) throw new Error('Gmail token expired — please reconnect Gmail from Integrations.');
      if (listResp.status === 403) throw new Error('Gmail read permission missing — disconnect Gmail in Integrations and reconnect to grant inbox access.');
      if (listResp.status >= 400) throw new Error(`Gmail API error ${listResp.status}`);

      const data = listResp.data as any;
      const msgs: Array<{ id: string }> = Array.isArray(data?.messages) ? data.messages : [];
      for (const m of msgs) {
        if (m?.id && messageIds.length < MAX_MESSAGES) messageIds.push(m.id);
      }

      pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : undefined;
      if (!pageToken || msgs.length === 0) break;
    }

    // ── Fetch metadata in parallel batches ────────────────────────────────
    let synced = 0;

    for (let i = 0; i < messageIds.length; i += BATCH_CONCURRENCY) {
      const batch = messageIds.slice(i, i + BATCH_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map((msgId) =>
          axios.get(`${GMAIL_API}/messages/${msgId}`, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              format: 'metadata',
              metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            },
            validateStatus: () => true,
            timeout: 10000,
          })
        )
      );

      const insertValues: any[][] = [];

      for (const result of results) {
        if (result.status === 'rejected') continue;
        const resp = result.value;
        if (resp.status >= 400) continue;

        const msg = resp.data as any;
        const headerMap: Record<string, string> = {};
        for (const h of (msg?.payload?.headers || [])) {
          headerMap[String(h.name || '').toLowerCase()] = String(h.value || '');
        }

        const fromParsed = parseEmailHeader(headerMap.from || '');
        const toParsed = parseEmailHeader(headerMap.to || '');
        const subject = (headerMap.subject || '(No subject)').slice(0, 500);
        const dateRaw = headerMap.date || '';
        const date = dateRaw ? new Date(dateRaw) : null;
        const validDate = date && !isNaN(date.getTime()) ? date.toISOString() : null;
        const isSent = Array.isArray(msg.labelIds) && (msg.labelIds as string[]).includes('SENT');
        const isRead = Array.isArray(msg.labelIds) && !(msg.labelIds as string[]).includes('UNREAD');
        const snippet = String(msg.snippet || '').slice(0, 500);

        insertValues.push([
          userId,
          String(msg.id || ''),
          String(msg.threadId || ''),
          subject,
          snippet,
          fromParsed.email.slice(0, 255),
          fromParsed.name.slice(0, 255),
          toParsed.email.slice(0, 255),
          validDate,
          isRead,
          isSent,
        ]);
      }

      // Bulk upsert
      for (const row of insertValues) {
        await pool.query(
          `INSERT INTO gmail_messages
             (user_id, gmail_message_id, gmail_thread_id, subject, snippet,
              from_email, from_name, to_email, date, is_read, is_sent, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
           ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET
             snippet     = EXCLUDED.snippet,
             from_email  = CASE WHEN gmail_messages.from_email = '' THEN EXCLUDED.from_email ELSE gmail_messages.from_email END,
             from_name   = CASE WHEN gmail_messages.from_name  = '' THEN EXCLUDED.from_name  ELSE gmail_messages.from_name  END,
             to_email    = CASE WHEN gmail_messages.to_email   = '' THEN EXCLUDED.to_email   ELSE gmail_messages.to_email   END,
             subject     = CASE WHEN gmail_messages.subject IN ('', '(No subject)') THEN EXCLUDED.subject ELSE gmail_messages.subject END,
             date        = COALESCE(gmail_messages.date, EXCLUDED.date),
             is_read     = EXCLUDED.is_read,
             is_sent     = EXCLUDED.is_sent,
             synced_at   = NOW()`,
          row
        ).catch(() => undefined);
        synced++;
      }

      // Update progress every batch
      await pool.query(
        `UPDATE gmail_sync_state SET total_fetched=$1, updated_at=NOW() WHERE user_id=$2`,
        [synced, userId]
      ).catch(() => undefined);
    }

    await pool.query(
      `UPDATE gmail_sync_state
       SET status='done', total_fetched=$1, last_synced_at=NOW(), error_message=NULL, updated_at=NOW()
       WHERE user_id=$2`,
      [synced, userId]
    );

    // Populate CRM companies/contacts/activities from synced emails
    const crmResult = await syncToCRM(pool, userId).catch(async (e) => {
      const crmErr = e instanceof Error ? e.message : String(e);
      logger.warn({ userId, crmErr }, 'gmail_crm_sync_error');
      await pool.query(
        `UPDATE gmail_sync_state SET error_message=$1, updated_at=NOW() WHERE user_id=$2`,
        [`CRM sync failed: ${crmErr}`, userId]
      ).catch(() => undefined);
      return null;
    });
    if (crmResult?.errors?.length) {
      logger.warn({ userId, errors: crmResult.errors }, 'gmail_crm_sync_partial_errors');
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    logger.error({ userId, err }, 'gmail_sync_error');
    await pool.query(
      `INSERT INTO gmail_sync_state(user_id, status, error_message, updated_at)
       VALUES($1,'error',$2,NOW())
       ON CONFLICT(user_id) DO UPDATE SET status='error', error_message=$2, updated_at=NOW()`,
      [userId, msg]
    ).catch(() => undefined);
  }
}

// Periodic inbox scan (server.ts scheduler): re-syncs Gmail for every user
// whose last successful sync is older than 6 hours, keeping the inbox agent
// and CRM data fresh without a manual sync click. Users who never synced or
// whose sync errored (needs reconnect) are left alone.
export function buildGmailAutoSync(deps: Pick<GmailInboxDeps, 'pool' | 'getPlatformConfig' | 'encryptIntegrationSecret' | 'decryptIntegrationSecret'>): () => Promise<void> {
  const { pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret } = deps;
  return async function runGmailAutoSync(): Promise<void> {
    if (!pool) return;
    try {
      const { rows } = await pool.query(
        `SELECT user_id FROM gmail_sync_state
         WHERE status='done' AND last_synced_at IS NOT NULL AND last_synced_at < NOW() - INTERVAL '6 hours'
         ORDER BY last_synced_at LIMIT 10`
      );
      for (const row of rows) {
        if (!(await claimGmailSync(pool, row.user_id).catch(() => false))) continue;
        await runGmailSync(pool, row.user_id, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret)
          .catch((err) => logger.warn({ err, userId: row.user_id }, 'gmail_auto_sync_user_failed'));
      }
    } catch (err) {
      logger.error({ err }, 'gmail_auto_sync_failed');
    }
  };
}

// ── Router ─────────────────────────────────────────────────────────────────────

// 409, not 401: the app treats any 401 as an expired login and signs the user
// out, but here only the Gmail connection needs attention.
const GMAIL_RECONNECT_RESPONSE = {
  success: false,
  error: 'Gmail is not connected or its access has expired. Reconnect Gmail in Integrations.',
  reconnect: 'gmail',
};

export function registerGmailInboxRoutes(deps: GmailInboxDeps): Router {
  const { requireAuth, pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret } = deps;
  // AI helpers referenced directly via `deps` inside the AI summary route
  const router = Router();

  // POST /gmail/sync — start background sync
  router.post('/gmail/sync', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    if (!(await claimGmailSync(pool, auth.userId))) {
      return res.json({ success: true, message: 'Sync already in progress' });
    }

    // Fire-and-forget
    void runGmailSync(pool, auth.userId, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret);
    return res.json({ success: true, message: 'Sync started' });
  });

  // GET /gmail/sync/status
  router.get('/gmail/sync/status', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, status: 'idle', totalFetched: 0, messageCount: 0 });

    const [stateRes, countRes] = await Promise.all([
      pool.query(
        `SELECT status, total_fetched, last_synced_at, error_message FROM gmail_sync_state WHERE user_id=$1`,
        [auth.userId]
      ).catch(() => ({ rows: [] as any[] })),
      pool.query(
        `SELECT COUNT(*)::int AS cnt FROM gmail_messages WHERE user_id=$1`,
        [auth.userId]
      ).catch(() => ({ rows: [{ cnt: 0 }] as any[] })),
    ]);

    const messageCount = Number(countRes.rows[0]?.cnt ?? 0);

    if (!stateRes.rows.length) {
      return res.json({ success: true, status: 'idle', totalFetched: 0, lastSyncedAt: null, errorMessage: null, messageCount });
    }
    const row = stateRes.rows[0] as any;
    return res.json({
      success: true,
      status: String(row.status || 'idle'),
      totalFetched: Number(row.total_fetched || 0),
      lastSyncedAt: row.last_synced_at || null,
      errorMessage: row.error_message || null,
      messageCount,
    });
  });

  // GET /gmail/contacts — personal-domain senders (public email providers)
  router.get('/gmail/contacts', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, contacts: [] });

    const result = await pool.query(
      `SELECT mc.id, mc.email, mc.first_name, mc.last_name,
              LOWER(SUBSTRING(mc.email FROM POSITION('@' IN mc.email) + 1)) AS domain
       FROM mailing_contacts mc
       WHERE mc.user_id=$1 AND mc.source='gmail'
         AND NOT EXISTS (
           SELECT 1 FROM crm_contact_companies cc WHERE cc.contact_id=mc.id
         )
       ORDER BY mc.first_name NULLS LAST, mc.email
       LIMIT 1000`,
      [auth.userId]
    ).catch(() => ({ rows: [] as any[] }));

    return res.json({ success: true, contacts: result.rows });
  });

  // POST /gmail/sync/crm — rebuild CRM from already-stored emails (no Gmail API call)
  router.post('/gmail/sync/crm', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    try {
      const result = await syncToCRM(pool, auth.userId);
      return res.json({ success: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // GET /gmail/chats — list contacts grouped as chats
  router.get('/gmail/chats', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, chats: [] });

    const result = await pool.query(
      `SELECT
         CASE WHEN is_sent THEN to_email ELSE from_email END AS contact_email,
         MAX(CASE WHEN NOT is_sent AND from_name <> '' THEN from_name END) AS contact_name,
         COUNT(*)::int AS message_count,
         SUM(CASE WHEN NOT is_read AND NOT is_sent THEN 1 ELSE 0 END)::int AS unread_count,
         MAX(date) AS last_message_at,
         (array_agg(snippet ORDER BY date DESC NULLS LAST))[1] AS last_snippet,
         (array_agg(subject ORDER BY date DESC NULLS LAST))[1] AS last_subject
       FROM gmail_messages
       WHERE user_id=$1
         AND TRIM(CASE WHEN is_sent THEN to_email ELSE from_email END) <> ''
       GROUP BY (CASE WHEN is_sent THEN to_email ELSE from_email END)
       ORDER BY MAX(date) DESC NULLS LAST
       LIMIT 500`,
      [auth.userId]
    ).catch(() => ({ rows: [] as any[] }));

    const chats = (result.rows as any[]).map((row) => {
      const email = String(row.contact_email || '').toLowerCase().trim();
      const domain = extractDomain(email);
      const company = domainToCompany(domain);
      const storedName = String(row.contact_name || '').trim();
      const name = storedName || company || (email.split('@')[0] ?? email);
      return {
        email,
        name,
        company,
        domain,
        messageCount: Number(row.message_count || 0),
        unreadCount: Number(row.unread_count || 0),
        lastMessageAt: row.last_message_at || null,
        lastSnippet: String(row.last_snippet || ''),
        lastSubject: String(row.last_subject || ''),
      };
    });

    return res.json({ success: true, chats });
  });

  // GET /gmail/chats/:email/messages — all messages in a conversation
  router.get('/gmail/chats/:email/messages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, messages: [] });

    const contactEmail = decodeURIComponent(req.params.email).toLowerCase().trim();

    const result = await pool.query(
      `SELECT gmail_message_id, gmail_thread_id, subject, snippet,
              from_email, from_name, to_email, date, is_read, is_sent, body_text
       FROM gmail_messages
       WHERE user_id=$1
         AND (
           (NOT is_sent AND LOWER(from_email)=$2)
           OR (is_sent AND LOWER(to_email)=$2)
         )
       ORDER BY date ASC NULLS LAST`,
      [auth.userId, contactEmail]
    ).catch(() => ({ rows: [] as any[] }));

    return res.json({
      success: true,
      messages: (result.rows as any[]).map((r) => ({
        id: String(r.gmail_message_id),
        threadId: String(r.gmail_thread_id || ''),
        subject: String(r.subject || ''),
        snippet: String(r.snippet || ''),
        fromEmail: String(r.from_email || ''),
        fromName: String(r.from_name || ''),
        toEmail: String(r.to_email || ''),
        date: r.date ? String(r.date) : null,
        isRead: Boolean(r.is_read),
        isSent: Boolean(r.is_sent),
        bodyText: r.body_text ? String(r.body_text) : null,
      })),
    });
  });

  // GET /gmail/messages/:id/body — fetch full body from Gmail API
  router.get('/gmail/messages/:id/body', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const gmailMessageId = req.params.id;

    // Return cached body if available
    const existing = await pool.query(
      `SELECT body_text FROM gmail_messages WHERE user_id=$1 AND gmail_message_id=$2`,
      [auth.userId, gmailMessageId]
    ).catch(() => ({ rows: [] as any[] }));

    if (existing.rows.length && existing.rows[0].body_text) {
      return res.json({ success: true, body: String(existing.rows[0].body_text), cached: true });
    }

    const token = await getValidGmailToken(pool, auth.userId, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret);
    if (!token) return res.status(409).json(GMAIL_RECONNECT_RESPONSE);

    const resp = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { format: 'full' },
        validateStatus: () => true,
        timeout: 20000,
      }
    );

    if (resp.status >= 400) {
      if (resp.status === 401) return res.status(409).json(GMAIL_RECONNECT_RESPONSE);
      return res.status(upstreamFailureStatus(resp.status)).json({ success: false, error: 'Failed to fetch message from Gmail' });
    }

    const bodyText = extractBodyText((resp.data as any)?.payload);

    await pool.query(
      `UPDATE gmail_messages SET body_text=$1 WHERE user_id=$2 AND gmail_message_id=$3`,
      [bodyText, auth.userId, gmailMessageId]
    ).catch(() => undefined);

    return res.json({ success: true, body: bodyText, cached: false });
  });

  // POST /gmail/contacts/:email/ai-summary — generate AI summary of conversation
  router.post('/gmail/contacts/:email/ai-summary', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const contactEmail = decodeURIComponent(req.params.email).toLowerCase().trim();

    // Fetch recent messages (up to 20 for context)
    const result = await pool.query(
      `SELECT subject, snippet, from_name, from_email, to_email, date, is_sent
       FROM gmail_messages
       WHERE user_id=$1
         AND ((NOT is_sent AND LOWER(from_email)=$2) OR (is_sent AND LOWER(to_email)=$2))
       ORDER BY date DESC NULLS LAST
       LIMIT 20`,
      [auth.userId, contactEmail]
    ).catch(() => ({ rows: [] as any[] }));

    if (!result.rows.length) {
      return res.json({ success: true, summary: 'No emails found for this contact.' });
    }

    const aiCfg = await deps.getAIConfig().catch(() => null);
    // Gmail Agent always uses Gemini — resolve the Google API key specifically
    const geminiKey = aiCfg
      ? deps.resolveActiveKey({ ...aiCfg, provider: 'google' })
      : (process.env.GOOGLE_AI_API_KEY || null);
    if (!geminiKey) return res.json({ success: true, summary: 'Gemini not configured — add a Google AI (Gemini) API key in Admin → AI Config.' });

    const messagesText = (result.rows as any[]).reverse().map((m) => {
      const direction = m.is_sent ? 'Sent' : 'Received';
      const date = m.date ? new Date(m.date).toLocaleDateString() : 'Unknown date';
      return `[${date}] ${direction} — Subject: "${m.subject}" — ${m.snippet}`;
    }).join('\n');

    const contactName = (result.rows as any[]).find((r) => !r.is_sent)?.from_name || contactEmail.split('@')[0];
    const domain = extractDomain(contactEmail);
    const company = domainToCompany(domain);

    const systemPrompt = `You are an AI assistant that summarizes email conversations to help sales and marketing professionals understand their relationship with a contact. Be concise, professional, and highlight key topics, action items, and relationship status. Write 2-4 sentences max.`;
    const userPrompt = `Summarize the email conversation with ${contactName} from ${company} (${contactEmail}):\n\n${messagesText}`;

    try {
      const summary = await deps.callAINonStreaming('google', geminiKey, 'gemini-2.5-flash', systemPrompt, userPrompt, 300);
      return res.json({ success: true, summary: summary.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI summary failed';
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // GET /gmail/company/:domain/messages — all messages involving a specific domain
  router.get('/gmail/company/:domain/messages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, messages: [] });

    const domain = decodeURIComponent(req.params.domain).toLowerCase().trim();
    const result = await pool.query(
      `SELECT gmail_message_id, gmail_thread_id, subject, snippet,
              from_email, from_name, to_email, date, is_read, is_sent
       FROM gmail_messages
       WHERE user_id=$1
         AND (
           (NOT is_sent AND LOWER(SUBSTRING(from_email FROM POSITION('@' IN from_email) + 1)) = $2)
           OR (is_sent AND LOWER(SUBSTRING(to_email FROM POSITION('@' IN to_email) + 1)) = $2)
         )
       ORDER BY date DESC NULLS LAST
       LIMIT 500`,
      [auth.userId, domain]
    ).catch(() => ({ rows: [] as any[] }));

    return res.json({
      success: true,
      messages: (result.rows as any[]).map((r) => ({
        id: String(r.gmail_message_id),
        threadId: String(r.gmail_thread_id || ''),
        subject: String(r.subject || ''),
        snippet: String(r.snippet || ''),
        fromEmail: String(r.from_email || ''),
        fromName: String(r.from_name || ''),
        toEmail: String(r.to_email || ''),
        date: r.date ? String(r.date) : null,
        isRead: Boolean(r.is_read),
        isSent: Boolean(r.is_sent),
      })),
    });
  });

  // POST /gmail/company/:domain/ai-summary — AI summary for all emails from a domain
  router.post('/gmail/company/:domain/ai-summary', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const domain = decodeURIComponent(req.params.domain).toLowerCase().trim();

    const result = await pool.query(
      `SELECT subject, snippet, from_name, from_email, to_email, date, is_sent
       FROM gmail_messages
       WHERE user_id=$1
         AND (
           (NOT is_sent AND LOWER(SUBSTRING(from_email FROM POSITION('@' IN from_email) + 1)) = $2)
           OR (is_sent AND LOWER(SUBSTRING(to_email FROM POSITION('@' IN to_email) + 1)) = $2)
         )
       ORDER BY date DESC NULLS LAST
       LIMIT 30`,
      [auth.userId, domain]
    ).catch(() => ({ rows: [] as any[] }));

    if (!result.rows.length) {
      return res.json({ success: true, summary: 'No emails found for this company.' });
    }

    const aiCfg = await deps.getAIConfig().catch(() => null);
    // Gmail Agent always uses Gemini — resolve the Google API key specifically
    const geminiKey = aiCfg
      ? deps.resolveActiveKey({ ...aiCfg, provider: 'google' })
      : (process.env.GOOGLE_AI_API_KEY || null);
    if (!geminiKey) return res.json({ success: true, summary: 'Gemini not configured — add a Google AI (Gemini) API key in Admin → AI Config.' });

    const companyName = domainToCompany(domain);
    const messagesText = (result.rows as any[]).reverse().map((m) => {
      const direction = m.is_sent ? 'Sent' : 'Received';
      const date = m.date ? new Date(m.date).toLocaleDateString() : 'Unknown date';
      return `[${date}] ${direction} — Subject: "${m.subject}" — ${m.snippet}`;
    }).join('\n');

    const systemPrompt = `You are an AI assistant that summarizes email relationships to help sales and marketing professionals understand their relationship with a company. Be concise, professional, and highlight key topics, themes, and relationship status. Write 3-5 sentences max.`;
    const userPrompt = `Summarize the email relationship with ${companyName} (${domain}) based on these emails:\n\n${messagesText}`;

    try {
      const summary = await deps.callAINonStreaming('google', geminiKey, 'gemini-2.5-flash', systemPrompt, userPrompt, 400);
      return res.json({ success: true, summary: summary.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI summary failed';
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // GET /gmail/messages/:id/attachments — list attachments for a message (calls Gmail API)
  router.get('/gmail/messages/:id/attachments', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const token = await getValidGmailToken(pool, auth.userId, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret);
    if (!token) return res.status(409).json(GMAIL_RECONNECT_RESPONSE);

    const resp = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(req.params.id)}`,
      { headers: { Authorization: `Bearer ${token}` }, params: { format: 'full' }, validateStatus: () => true, timeout: 15000 }
    );

    if (resp.status === 401) return res.status(409).json(GMAIL_RECONNECT_RESPONSE);
    if (resp.status >= 400) return res.status(upstreamFailureStatus(resp.status)).json({ success: false, error: 'Failed to fetch message' });

    const attachments: Array<{ id: string; filename: string; mimeType: string; size: number }> = [];
    function traverseParts(part: any): void {
      if (!part) return;
      if (part.filename && part.body?.attachmentId) {
        attachments.push({ id: String(part.body.attachmentId), filename: String(part.filename), mimeType: String(part.mimeType || 'application/octet-stream'), size: Number(part.body.size || 0) });
      }
      if (Array.isArray(part.parts)) part.parts.forEach(traverseParts);
    }
    traverseParts((resp.data as any)?.payload);

    return res.json({ success: true, attachments });
  });

  // GET /gmail/messages/:id/attachments/:attId — proxy-download an attachment
  router.get('/gmail/messages/:id/attachments/:attId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    const token = await getValidGmailToken(pool, auth.userId, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret);
    if (!token) return res.status(409).json(GMAIL_RECONNECT_RESPONSE);

    const resp = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(req.params.id)}/attachments/${encodeURIComponent(req.params.attId)}`,
      { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 30000 }
    );

    if (resp.status === 401) return res.status(409).json(GMAIL_RECONNECT_RESPONSE);
    if (resp.status >= 400) return res.status(upstreamFailureStatus(resp.status)).json({ success: false, error: 'Failed to fetch attachment' });

    const data = String((resp.data as any)?.data || '').replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(data, 'base64');
    const requestedType = String(req.query.mimeType || '').trim().toLowerCase();
    const mimeType = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(requestedType) ? requestedType : 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', attachmentDisposition(String(req.query.filename || 'attachment')));
    res.setHeader('Content-Length', buf.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buf);
  });

  // DELETE /gmail/messages — clear all synced data for the current user
  router.delete('/gmail/messages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.status(503).json({ success: false, error: 'DB not ready' });

    await pool.query(`DELETE FROM gmail_messages WHERE user_id=$1`, [auth.userId]);
    await pool.query(`DELETE FROM gmail_sync_state WHERE user_id=$1`, [auth.userId]);
    return res.json({ success: true });
  });

  return router;
}
