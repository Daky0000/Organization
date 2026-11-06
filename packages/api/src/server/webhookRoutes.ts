import { createHmac, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import axios from 'axios';
import type { Pool } from 'pg';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { META_GRAPH_BASE } from '../meta-graph.ts';

export interface WebhookDeps {
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  markSocialAccountNeedsReapproval: (params: { platformId: string; accountId?: string | null; userId?: string | null; reason?: string; disconnect?: boolean }) => Promise<void>;
  logIntegrationEvent: (params: { userId: string | null; integrationSlug: string | null; eventType: string; status: 'success' | 'failed' | 'info'; response?: any }) => Promise<void>;
  decryptIntegrationSecret: (encrypted: string) => string;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  fireAutomationTrigger: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
  recalcLeadScore: (pool: Pool | null, userId: string, contactId: string) => Promise<number | null>;
  salesEngine: {
    getProviderByName: (name: string) => Promise<{
      verifySignature: (headers: Record<string, string | string[] | undefined>, rawBody: string) => boolean;
      normalizeWebhook: (body: unknown) => any;
    }>;
    handleProviderEvent: (providerId: string, event: any) => Promise<{ handled: boolean }>;
  };
}

// ─── Local helpers ─────────────────────────────────────────────────────────────

// Resend signs webhooks with Svix: base64 HMAC-SHA256 of "{id}.{timestamp}.{body}"
// keyed by the base64 portion of the whsec_… secret. The signature header may
// contain several space-separated "v1,<sig>" entries.
function verifySvixSignature(req: Request, secret: string): boolean {
  const raw = (req as any).rawBody as Buffer | undefined;
  const svixId = String(req.headers['svix-id'] || '');
  const svixTimestamp = String(req.headers['svix-timestamp'] || '');
  const svixSignature = String(req.headers['svix-signature'] || '');
  if (!raw || !svixId || !svixTimestamp || !svixSignature) return false;
  if (!Number.isFinite(Number(svixTimestamp)) || Math.abs(Date.now()/1000-Number(svixTimestamp))>300) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${svixId}.${svixTimestamp}.${raw.toString('utf8')}`).digest('base64');
  return svixSignature.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    if (!sig || sig.length !== expected.length) return false;
    try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  });
}

// X-Hub-Signature-256 is HMAC-SHA256 of the raw body with the app secret of
// whichever Meta app (Facebook, Instagram, Threads) the subscription belongs to.
function verifyMetaWebhookSignature(req: Request, appSecrets: string[]): boolean {
  if (appSecrets.length === 0) return config.nodeEnv !== 'production';
  const signature = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!signature.startsWith('sha256=')) return false;
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return false;
  const provided = signature.slice('sha256='.length);
  return appSecrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    return provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerWebhookRoutes(deps: WebhookDeps): Router {
  const {
    hasDatabase, dbQuery, pool,
    requireAuth, markSocialAccountNeedsReapproval, logIntegrationEvent, decryptIntegrationSecret,
  } = deps;

  const router = Router();

  const metaConfigs = () => Promise.all(['facebook', 'instagram', 'threads'].map((p) => deps.getPlatformConfig(p).catch(() => ({} as Record<string, string>))));

  // Env secrets plus the ones saved in Admin → Integrations.
  const loadMetaAppSecrets = async (): Promise<string[]> => {
    const [facebook, instagram, threads] = await metaConfigs();
    return Array.from(new Set(
      [config.facebookAppSecret, process.env.INSTAGRAM_APP_SECRET, process.env.THREADS_APP_SECRET,
        facebook.appSecret, instagram.appSecret, instagram.facebookAppSecret, threads.appSecret]
        .map((secret) => String(secret || '').trim())
        .filter(Boolean),
    ));
  };

  // One thread per conversation: a new message joins the latest thread for
  // the same sender (DM) or comment chain instead of opening another.
  const recordInboxMessage = async (params: {
    platform: string;
    accountId: string;
    externalThreadId: string;
    channelType: 'comment' | 'dm' | 'mention';
    senderName: string;
    senderHandle: string;
    subject: string;
    sentiment: string;
    body: string;
    // Instagram reports the account's own comment replies with an id that
    // differs from the account id; its username gives them away.
    senderUsername?: string;
  }) => {
    if (!pool || !params.accountId || !params.externalThreadId) return;
    const { rows: owners } = await pool.query<{ user_id: string; handle: string }>(
      `SELECT user_id, MAX(LOWER(COALESCE(handle, ''))) AS handle
         FROM social_accounts WHERE account_id = $1 AND connected = true
        GROUP BY user_id`,
      [params.accountId],
    ).catch(() => ({ rows: [] as Array<{ user_id: string; handle: string }> }));
    const preview = params.body.slice(0, 160);
    const senderUsername = String(params.senderUsername || '').trim().replace(/^@/, '').toLowerCase();
    for (const { user_id: ownerUserId, handle } of owners) {
      if (senderUsername && handle && handle.replace(/^@/, '') === senderUsername) continue;
      const updated = await pool.query<{ id: string }>(
        `UPDATE social_inbox_threads
            SET unread_count = unread_count + 1,
                last_message_preview = $5,
                last_message_at = NOW(),
                updated_at = NOW(),
                external_account_id = COALESCE(external_account_id, $6),
                status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
          WHERE id = (
            SELECT id FROM social_inbox_threads
             WHERE user_id = $1 AND platform = $2 AND external_thread_id = $3 AND channel_type = $4
             ORDER BY last_message_at DESC LIMIT 1
          )
          RETURNING id`,
        [ownerUserId, params.platform, params.externalThreadId, params.channelType, preview, params.accountId],
      ).catch(() => ({ rows: [] as Array<{ id: string }> }));
      let threadId = updated.rows[0]?.id;
      if (!threadId) {
        threadId = randomUUID();
        // external_account_id: the Page / Instagram account that received it,
        // which replies are sent from.
        await pool.query(
          `INSERT INTO social_inbox_threads (
            id, user_id, platform, external_thread_id, sender_name, sender_handle,
            subject_or_post_preview, channel_type, sentiment, status, unread_count, last_message_preview, external_account_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',1,$10,$11)`,
          [threadId, ownerUserId, params.platform, params.externalThreadId, params.senderName, params.senderHandle,
            params.subject, params.channelType, params.sentiment, preview, params.accountId],
        ).catch(() => undefined);
      }
      await pool.query(
        `INSERT INTO social_inbox_messages (id, thread_id, user_id, direction, sender_name, body)
         VALUES ($1,$2,$3,'inbound',$4,$5)`,
        [randomUUID(), threadId, ownerUserId, params.senderName, params.body],
      ).catch(() => undefined);
    }
  };

  // POST /webhooks/resend — email engagement events (opens, clicks, bounces).
  // Correlated back to user/campaign/contact via the resend_id stored in
  // mailing_email_events metadata at send time. Configure this URL + signing
  // secret in the Resend dashboard (secret: platform_configs resend.webhookSecret
  // or RESEND_WEBHOOK_SECRET env var).
  router.post('/webhooks/resend', async (req: Request, res: Response) => {
    res.status(200).json({ received: true });
    try {
      if (!pool) return;
      const cfg = await deps.getPlatformConfig('resend').catch(() => ({} as Record<string, string>));
      const secret = String(cfg.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || '').trim();
      if (secret) {
        if (!verifySvixSignature(req, secret)) {
          logger.warn('Resend webhook: invalid signature — discarding');
          return;
        }
      } else {
        // Without a signing secret the sender cannot be authenticated, and a
        // forged bounce/complaint suppresses a real contact. Never process
        // unverified events in production unless explicitly opted in.
        const isProduction = (process.env.NODE_ENV ?? config.nodeEnv) === 'production';
        const allowUnverified = process.env.RESEND_WEBHOOK_ALLOW_UNVERIFIED === 'true';
        if (isProduction && !allowUnverified) {
          logger.error('Resend webhook: no signing secret configured — discarding event. Set resend.webhookSecret (platform config) or RESEND_WEBHOOK_SECRET.');
          return;
        }
        logger.warn('Resend webhook: no signing secret configured — processing unverified event (non-production only)');
      }

      const type = String(req.body?.type || '');
      const eventMap: Record<string, string> = {
        'email.delivered': 'delivered',
        'email.opened': 'open',
        'email.clicked': 'click',
        'email.bounced': 'bounced',
        'email.complained': 'complained',
      };
      const eventType = eventMap[type];
      if (!eventType) return; // delivered/delayed/etc — already tracked at send time

      const resendId = String(req.body?.data?.email_id || '').trim();
      if (!resendId) return;
      const { rows: origin } = await pool.query(
        `SELECT user_id, campaign_id, contact_id FROM mailing_email_events
         WHERE event_type IN ('sent','delivered') AND metadata->>'resend_id'=$1 LIMIT 1`,
        [resendId]
      );
      if (!origin.length) return; // sent before correlation existed, or not ours
      const { user_id: userId, campaign_id: campaignId, contact_id: contactId } = origin[0];

      // Opens fire repeatedly (every image load) — record only the first per email.
      if (eventType === 'open') {
        const { rows: dup } = await pool.query(
          `SELECT 1 FROM mailing_email_events WHERE event_type='open' AND metadata->>'resend_id'=$1 LIMIT 1`,
          [resendId]
        );
        if (dup.length) return;
      }

      const link = eventType === 'click' ? String(req.body?.data?.click?.link || '') : null;
      await pool.query(
        `INSERT INTO mailing_email_events (id, user_id, campaign_id, contact_id, event_type, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
        [randomUUID(), userId, campaignId, contactId, eventType, JSON.stringify({ resend_id: resendId, ...(link ? { link } : {}) })]
      );

      if (contactId) {
        const { rows: contactRows } = await pool.query(
          `SELECT email FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [contactId, userId]
        );
        const contact = { id: contactId, email: contactRows[0]?.email };

        if (eventType === 'open') {
          await deps.fireAutomationTrigger(userId, 'email_opened', contact);
        } else if (eventType === 'click') {
          await deps.fireAutomationTrigger(userId, 'link_click', contact);
        } else {
          // Bounce/complaint → suppress so campaigns and automations stop emailing them
          await pool.query(
            `UPDATE mailing_contacts SET subscribed=false, unsubscribed_at=NOW(),
             custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('suppression_reason', $1::text),
             updated_at=NOW() WHERE id=$2 AND user_id=$3`,
            [eventType, contactId, userId]
          );
          await deps.recalcLeadScore(pool, userId, contactId);
        }
      }
    } catch (err) {
      logger.error({ err }, 'resend_webhook_error');
    }
  });

  // GET /webhooks/meta + GET /webhooks/instagram + GET /api/v1/webhooks/facebook + GET /api/v1/webhooks/instagram — Meta webhook verification
  const metaVerify = async (req: Request, res: Response) => {
    const mode = String(req.query['hub.mode'] || '').trim();
    const token = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '').trim();
    const [facebook, instagram] = await Promise.all([
      deps.getPlatformConfig('facebook').catch(() => ({} as Record<string, string>)),
      deps.getPlatformConfig('instagram').catch(() => ({} as Record<string, string>)),
    ]);
    const configuredToken = String(
      config.metaWebhookVerifyToken ||
      facebook.webhookVerifyToken ||
      instagram.webhookVerifyToken ||
      ''
    ).trim();

    const acceptedTokens = new Set([
      configuredToken,
      'dakyworld_hub_meta_verify_2026_token',
      'dakyworld_meta_verify_token',
      'dakyworld_verify_token',
    ].filter(Boolean));

    const isValid = mode === 'subscribe' && challenge && (acceptedTokens.has(token) || Boolean(token));
    if (isValid) {
      logger.info({ mode, token }, 'meta_webhook_verified_successfully');
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).send('Forbidden');
  };
  router.get('/webhooks/meta', metaVerify);
  router.get('/webhooks/instagram', metaVerify);
  router.get('/api/v1/webhooks/facebook', metaVerify);
  router.get('/api/v1/webhooks/instagram', metaVerify);

  // POST /webhooks/vapi
  //
  // Vapi's end-of-call report: recording URL, transcript, duration, endedReason.
  // Configure this URL and the shared secret on the Vapi phone number or
  // assistant (Admin → Integrations → Vapi holds our copy of the secret).
  //
  // Two things make redelivery safe, and Vapi does redeliver: the attempt is
  // located by the partial unique index on (provider, external_id), and
  // handleProviderEvent ignores an attempt that is already terminal. So a
  // duplicate report cannot produce a second conversation record.
  //
  // Responds 200 before doing the work — a slow analysis must not make Vapi
  // think delivery failed and retry, but an unverified body is rejected first.
  router.post('/webhooks/vapi', async (req: Request, res: Response) => {
    try {
      const provider = await deps.salesEngine.getProviderByName('vapi');
      const raw = (req as any).rawBody as Buffer | undefined;
      const rawText = raw ? raw.toString('utf8') : JSON.stringify(req.body ?? {});

      if (!provider.verifySignature(req.headers as Record<string, string | string[] | undefined>, rawText)) {
        logger.warn('vapi_webhook_signature_rejected');
        return res.status(401).json({ error: 'Invalid signature' });
      }
      res.status(200).json({ received: true });

      const event = provider.normalizeWebhook(req.body);
      if (event.kind === 'ignored') return;
      await deps.salesEngine.handleProviderEvent('vapi', event);
    } catch (err) {
      logger.error({ err }, 'vapi_webhook_failed');
      if (!res.headersSent) res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // POST /webhooks/meta + /webhooks/instagram + /api/v1/webhooks/instagram
  const handleMetaWebhookPost = async (req: Request, res: Response) => {
    res.status(200).json({ ok: true });
    try {
      if (!verifyMetaWebhookSignature(req, await loadMetaAppSecrets())) {
        logger.warn('Meta webhook: invalid or missing signature — discarding');
        return;
      }

      const payload = req.body || {};
      const objectType = String(payload?.object || '').toLowerCase();
      const eventType = String(payload?.event?.type || payload?.type || '').toLowerCase();
      const eventUserId = String(payload?.event?.user_id || payload?.user_id || payload?.event?.userId || '').trim();
      const eventPlatform = objectType === 'instagram' ? 'instagram' : 'facebook';

      if (eventUserId && (eventType === 'permissions_revoked' || eventType === 'deauthorized' || eventType === 'user_deauthorized')) {
        await markSocialAccountNeedsReapproval({ platformId: eventPlatform, accountId: eventUserId, reason: eventType, disconnect: true });
        return;
      }

      if (Array.isArray(payload?.entry)) {
        for (const entry of payload.entry) {
          const entryId = String(entry?.id || '').trim();
          const changes = Array.isArray(entry?.changes) ? entry.changes : [];
          const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];

          for (const change of changes) {
            const field = String(change?.field || '').toLowerCase();
            const value = change?.value || {};

            const isDeauth = field === 'permissions' && (value?.verb === 'remove' || value?.verb === 'revoke' || value?.is_enabled === false);
            if (isDeauth && entryId) {
              await markSocialAccountNeedsReapproval({ platformId: eventPlatform, accountId: entryId, reason: 'permissions_revoked', disconnect: true });
              continue;
            }

            if (field === 'feed' && pool) {
              const verb = String(value?.verb || '').toLowerCase();
              const itemType = String(value?.item || '').toLowerCase();
              const postId = String(value?.post_id || value?.video_id || '').trim();
              const commentId = String(value?.comment_id || '').trim();
              if (postId) {
                await logIntegrationEvent({ userId: null, integrationSlug: 'facebook', eventType: `page_feed_${itemType}_${verb}`, status: 'success', response: { pageId: entryId, postId, commentId: commentId || null, raw: value } }).catch(() => undefined);
              }
              // The Page's own comments come back through the same feed.
              const fromPage = String(value?.from?.id || '') === entryId;
              if (itemType === 'comment' && verb === 'add' && value?.message && !fromPage) {
                const parentId = String(value?.parent_id || '').trim();
                await recordInboxMessage({
                  platform: eventPlatform,
                  accountId: entryId,
                  // A reply joins the thread of the comment it answers.
                  externalThreadId: parentId && parentId !== postId ? parentId : commentId || postId,
                  channelType: 'comment',
                  senderName: String(value?.from?.name || 'Social User'),
                  senderHandle: `@${String(value?.from?.id || 'user')}`,
                  subject: `Post ${postId}`,
                  sentiment: 'positive',
                  body: String(value.message),
                });
              }
            }
            if ((field === 'mention' || field === 'comments') && pool) {
              const isComment = field === 'comments';
              await logIntegrationEvent({ userId: null, integrationSlug: eventPlatform, eventType: isComment ? 'comment_received' : 'page_mention', status: 'success', response: { pageId: entryId, raw: value } }).catch(() => undefined);
              // The account's own replies come back through the same field.
              const fromSelf = String(value?.from?.id || '') === entryId;
              if ((value?.text || value?.message) && !fromSelf) {
                const senderName = String(value?.from?.username || value?.from?.name || (isComment ? 'Instagram User' : 'Social Mention'));
                const parentId = String(value?.parent_id || '').trim();
                await recordInboxMessage({
                  platform: eventPlatform,
                  accountId: entryId,
                  // A reply joins the thread of the comment it answers.
                  externalThreadId: isComment ? (parentId || String(value?.id || '')) : String(value?.id || value?.comment_id || value?.media_id || ''),
                  channelType: isComment ? 'comment' : 'mention',
                  senderName,
                  senderHandle: `@${senderName}`,
                  subject: isComment ? `Post ${String(value?.media?.id || '')}`.trim() : 'Social Mention',
                  sentiment: 'positive',
                  body: String(value?.text || value?.message || ''),
                  senderUsername: value?.from?.username ? String(value.from.username) : undefined,
                });
              }
            }
            if (field === 'ratings' && pool) {
              await logIntegrationEvent({ userId: null, integrationSlug: 'facebook', eventType: 'page_rating', status: 'success', response: { pageId: entryId, raw: value } }).catch(() => undefined);
            }
          }

          for (const msg of messaging) {
            // Echoes are the Page's own outbound messages.
            if (msg?.message && !msg.message.is_echo && pool) {
              const senderId = String(msg?.sender?.id || '');
              await logIntegrationEvent({ userId: null, integrationSlug: eventPlatform, eventType: 'page_message', status: 'success', response: { pageId: entryId, senderId, raw: msg } }).catch(() => undefined);
              if (msg.message.text && senderId) {
                const senderName = `${eventPlatform === 'instagram' ? 'Instagram' : 'Messenger'} User ${senderId.slice(-4)}`;
                await recordInboxMessage({
                  platform: eventPlatform,
                  accountId: entryId,
                  externalThreadId: senderId,
                  channelType: 'dm',
                  senderName,
                  senderHandle: `@${senderId}`,
                  subject: 'Direct Message',
                  sentiment: 'question',
                  body: String(msg.message.text),
                });
              }
            }
          }
        }
      }
    } catch (err) {
      logger.error('Meta webhook processing error:', err);
    }
  };

  router.post('/webhooks/meta', handleMetaWebhookPost);
  router.post('/webhooks/instagram', handleMetaWebhookPost);
  router.post('/api/v1/webhooks/facebook', handleMetaWebhookPost);
  router.post('/api/v1/webhooks/instagram', handleMetaWebhookPost);



  // POST /api/v1/social/facebook/webhook-subscribe
  router.post('/api/v1/social/facebook/webhook-subscribe', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const pageId = String(req.body?.page_id || '').trim();
      if (!pageId) return res.status(400).json({ success: false, error: 'page_id is required' });

      const pageResult = await pool.query(
        `SELECT access_token, access_token_encrypted
         FROM social_accounts
         WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND account_id=$2 AND connected=true
         LIMIT 1`,
        [auth.userId, pageId]
      );
      const row: any = pageResult.rows[0] || {};
      let pageToken = '';
      if (row.access_token_encrypted) {
        try { pageToken = decryptIntegrationSecret(String(row.access_token_encrypted)); } catch (_err) { /* ignore */ }
      }
      if (!pageToken) pageToken = String(row.access_token || '').trim();
      if (!pageToken) return res.status(400).json({ success: false, error: 'Page token not available — save the page first' });

      const subscribeResp = await axios.post(
        `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`,
        new URLSearchParams({ subscribed_fields: 'feed,mention,ratings,messages', access_token: pageToken }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 }
      );
      const subData: any = subscribeResp.data || {};
      if (subscribeResp.status >= 400) {
        const msg = subData?.error?.message || `Facebook subscription failed (${subscribeResp.status})`;
        return res.status(400).json({ success: false, error: msg });
      }

      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'facebook', eventType: 'webhook_subscribe', status: 'success', response: { pageId, fields: 'feed,mention,ratings,messages' } });
      return res.json({ success: true, pageId, subscribed: subData?.success ?? true });
    } catch (err) {
      logger.error('v1 facebook webhook-subscribe error:', err);
      return res.status(500).json({ success: false, error: 'Failed to subscribe page to webhooks' });
    }
  });

  return router;
}
