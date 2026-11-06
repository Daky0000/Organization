import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getAIConfig, resolveActiveKey, callAINonStreaming } from '../ai-helpers.ts';
import { dispatchOutboundWebhooks } from '../middleware/planQuotaMiddleware.ts';
import { logger } from '../logger.ts';
import { checkInboxReplyable, deliverInboxReply, resolveReplyCredentials } from './socialInboxDelivery.ts';

type AuthResult = { userId: string } | null;

interface SocialInboxDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  fireAutomationTrigger?: (userId: string, triggerType: string, contact: { id?: string | null; email?: string; first_name?: string }) => Promise<void>;
  getPublishableSocialConnection?: (userId: string, platformId: string) => Promise<any>;
  decryptIntegrationSecret?: (encrypted: string) => string;
}

const MAX_REPLY_LENGTH = 2000;

const SAMPLE_SEED_THREADS = [
  {
    platform: 'instagram',
    sender_name: 'Elena Vance',
    sender_handle: '@elenavance.studio',
    subject_or_post_preview: 'Reels: 5 AI Workflows Saving Agencies 12h/Week',
    channel_type: 'comment',
    sentiment: 'question',
    status: 'open',
    unread_count: 1,
    last_message_preview: 'Do you offer white-label client approval links on the Growth plan? Looking to switch our 8 clients over!',
    messages: [
      {
        direction: 'inbound',
        sender_name: 'Elena Vance',
        body: 'Do you offer white-label client approval links on the Growth plan? Looking to switch our 8 clients over!',
      },
    ],
  },
  {
    platform: 'linkedin',
    sender_name: 'Marcus Sterling',
    sender_handle: 'Marcus Sterling • VP Growth @ FinScale',
    subject_or_post_preview: 'Post: How Multi-Channel Attribution Cuts CAC by 31%',
    channel_type: 'dm',
    sentiment: 'positive',
    status: 'open',
    unread_count: 1,
    last_message_preview: 'Loved your post on UTM attribution. Can we book a quick 15-min demo for our growth team this week?',
    messages: [
      {
        direction: 'inbound',
        sender_name: 'Marcus Sterling',
        body: 'Loved your post on UTM attribution. Can we book a quick 15-min demo for our growth team this week?',
      },
    ],
  },
  {
    platform: 'x',
    sender_name: 'Devon Brooks',
    sender_handle: '@devonbuilds',
    subject_or_post_preview: 'Mention in thread: SaaS Marketing Stack 2026',
    channel_type: 'mention',
    sentiment: 'positive',
    status: 'open',
    unread_count: 0,
    last_message_preview: 'Honestly @DakyworldHub replaced 4 separate subscriptions for our content calendar + CRM pipeline.',
    messages: [
      {
        direction: 'inbound',
        sender_name: 'Devon Brooks',
        body: 'Honestly @DakyworldHub replaced 4 separate subscriptions for our content calendar + CRM pipeline.',
      },
    ],
  },
  {
    platform: 'facebook',
    sender_name: 'Sarah Mensah',
    sender_handle: 'Sarah Mensah • E-Commerce Founder',
    subject_or_post_preview: 'Page Post: Automated Email Sequences Guide',
    channel_type: 'comment',
    sentiment: 'urgent',
    status: 'open',
    unread_count: 1,
    last_message_preview: 'Hi team, I connected our WordPress blog and want to auto-publish to Facebook & LinkedIn simultaneously. Where do I enable that?',
    messages: [
      {
        direction: 'inbound',
        sender_name: 'Sarah Mensah',
        body: 'Hi team, I connected our WordPress blog and want to auto-publish to Facebook & LinkedIn simultaneously. Where do I enable that?',
      },
    ],
  },
];

async function ensureSeedInboxForUser(pool: Pool, userId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM social_inbox_threads WHERE user_id = $1`,
    [userId]
  );
  if (Number(rows[0]?.cnt || 0) > 0) return;

  for (const item of SAMPLE_SEED_THREADS) {
    const threadId = randomUUID();
    await pool.query(
      `INSERT INTO social_inbox_threads (
        id, user_id, platform, sender_name, sender_handle, subject_or_post_preview,
        channel_type, sentiment, status, unread_count, last_message_preview, last_message_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [
        threadId,
        userId,
        item.platform,
        item.sender_name,
        item.sender_handle,
        item.subject_or_post_preview,
        item.channel_type,
        item.sentiment,
        item.status,
        item.unread_count,
        item.last_message_preview,
      ]
    );

    for (const msg of item.messages) {
      await pool.query(
        `INSERT INTO social_inbox_messages (id, thread_id, user_id, direction, sender_name, body, ai_generated)
         VALUES ($1,$2,$3,$4,$5,$6,false)`,
        [randomUUID(), threadId, userId, msg.direction, msg.sender_name, msg.body]
      );
    }
  }
}

export function registerSocialInboxRoutes({
  requireAuth,
  pool,
  fireAutomationTrigger,
  getPublishableSocialConnection,
  decryptIntegrationSecret,
}: SocialInboxDeps): Router {
  const router = express.Router();

  // GET /api/social-inbox/threads
  router.get('/social-inbox/threads', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      if (process.env.ALLOW_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production') await ensureSeedInboxForUser(pool, auth.userId);

      const platform = String(req.query.platform || 'all').toLowerCase();
      const status = String(req.query.status || 'all').toLowerCase();
      const params: unknown[] = [auth.userId];
      const filters: string[] = [`user_id = $1`];

      if (platform !== 'all') {
        params.push(platform);
        filters.push(`platform = $${params.length}`);
      }
      if (status !== 'all') {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }

      const { rows } = await pool.query(
        `SELECT * FROM social_inbox_threads
         WHERE ${filters.join(' AND ')}
         ORDER BY last_message_at DESC
         LIMIT 100`,
        params
      );

      return res.json({ success: true, threads: rows });
    } catch (err: any) {
      logger.error({ err }, 'social_inbox_threads_failed');
      return res.status(500).json({ success: false, error: 'Failed to load social inbox threads' });
    }
  });

  // GET /api/social-inbox/threads/:id/messages
  router.get('/social-inbox/threads/:id/messages', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const threadId = String(req.params.id);
      const { rows: threadRows } = await pool.query(
        `SELECT * FROM social_inbox_threads WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId]
      );
      if (!threadRows[0]) {
        return res.status(404).json({ success: false, error: 'Thread not found' });
      }

      await pool.query(
        `UPDATE social_inbox_threads SET unread_count = 0, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId]
      );

      const { rows: messages } = await pool.query(
        `SELECT * FROM social_inbox_messages WHERE thread_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
        [threadId, auth.userId]
      );

      return res.json({ success: true, thread: threadRows[0], messages });
    } catch (err: any) {
      logger.error({ err }, 'social_inbox_messages_failed');
      return res.status(500).json({ success: false, error: 'Failed to load messages' });
    }
  });

  // POST /api/social-inbox/threads/:id/reply
  router.post('/social-inbox/threads/:id/reply', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const text = String(req.body?.body || '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'Reply text is required' });
      if (text.length > MAX_REPLY_LENGTH) return res.status(400).json({ success: false, error: `Replies are limited to ${MAX_REPLY_LENGTH} characters` });

      const threadId = String(req.params.id);
      const { rows: threadRows } = await pool.query(
        `SELECT * FROM social_inbox_threads WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId]
      );
      const thread = threadRows[0];
      if (!thread) return res.status(404).json({ success: false, error: 'Thread not found' });
      const blocked = checkInboxReplyable(thread);
      if (blocked) return res.status(blocked.status).json({ success: false, error: blocked.error });
      if (!getPublishableSocialConnection || !decryptIntegrationSecret) {
        return res.status(501).json({ success: false, error: 'Provider delivery is not configured. No message was sent.' });
      }

      const creds = await resolveReplyCredentials(thread, {
        query: (sql, params) => pool.query(sql, params as any[]),
        decrypt: decryptIntegrationSecret,
        getPublishableSocialConnection,
      });
      if (!('accessToken' in creds)) {
        return res.status(creds.status).json({ success: false, error: creds.error, reconnect: creds.reconnect });
      }

      // Nothing is recorded unless the platform accepted the reply.
      const delivery = await deliverInboxReply(thread, creds, text);
      if (!delivery.ok) {
        logger.warn({ threadId, platform: thread.platform, status: delivery.status }, 'social_inbox_reply_rejected');
        return res.status(delivery.status).json({ success: false, error: delivery.error, reconnect: delivery.reconnect });
      }

      const { rows: messageRows } = await pool.query(
        `INSERT INTO social_inbox_messages (id, thread_id, user_id, direction, sender_name, body, ai_generated)
         VALUES ($1,$2,$3,'outbound','You',$4,$5)
         RETURNING *`,
        [randomUUID(), threadId, auth.userId, text, Boolean(req.body?.aiGenerated)]
      );
      await pool.query(
        `UPDATE social_inbox_threads
            SET last_message_preview = $3, last_message_at = NOW(), updated_at = NOW(), unread_count = 0,
                status = CASE WHEN $4 THEN 'resolved' ELSE status END
          WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId, text.slice(0, 160), Boolean(req.body?.markResolved)]
      );

      return res.json({ success: true, message: messageRows[0], externalMessageId: delivery.externalMessageId });
    } catch (err: any) {
      logger.error({ err }, 'social_inbox_reply_failed');
      return res.status(500).json({ success: false, error: 'Failed to send reply' });
    }
  });

  // POST /api/social-inbox/threads/:id/status
  router.post('/social-inbox/threads/:id/status', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const threadId = String(req.params.id);
      const status = String(req.body?.status || 'open');
      if (!['open', 'resolved', 'snoozed'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid thread status' });
      }

      const { rows } = await pool.query(
        `UPDATE social_inbox_threads SET status = $3, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [threadId, auth.userId, status]
      );
      return res.json({ success: true, thread: rows[0] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update status' });
    }
  });

  // POST /api/social-inbox/threads/:id/ai-draft
  router.post('/social-inbox/threads/:id/ai-draft', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const threadId = String(req.params.id);
      const tone = String(req.body?.tone || 'helpful, warm, and conversion-focused');

      const { rows: threadRows } = await pool.query(
        `SELECT * FROM social_inbox_threads WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId]
      );
      if (!threadRows[0]) {
        return res.status(404).json({ success: false, error: 'Thread not found' });
      }
      const thread = threadRows[0];

      const { rows: messages } = await pool.query(
        `SELECT direction, sender_name, body FROM social_inbox_messages
         WHERE thread_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 10`,
        [threadId, auth.userId]
      );

      const transcript = messages
        .map((m) => `${m.direction === 'inbound' ? thread.sender_name : 'Brand'}: ${m.body}`)
        .join('\n');

      const prompt = `Draft a concise, natural social media ${thread.channel_type} reply for ${thread.platform}.
Sender: ${thread.sender_name} (${thread.sender_handle})
Context: ${thread.subject_or_post_preview || 'Direct interaction'}
Tone: ${tone}
Recent conversation:
${transcript}

Return ONLY the reply text ready to send (2-3 sentences max, no quotation marks).`;

      const cfg=await getAIConfig();const key=resolveActiveKey(cfg);
      if (!key) return res.status(503).json({ success: false,error: 'Configure an AI provider to draft replies.' });
      const draft=await callAINonStreaming(cfg.provider,key,cfg.model,'Draft a truthful social reply. Never claim an action already occurred.',prompt,300,{ userId: auth.userId,feature: 'social_reply' });

      return res.json({ success: true, draft: draft.trim() });
    } catch (err: any) {
      logger.error({ err }, 'social_inbox_ai_draft_failed');
      return res.status(500).json({ success: false, error: 'Failed to generate AI reply draft' });
    }
  });

  // POST /api/social-inbox/threads/:id/convert-lead
  // Bridges Social Inbox -> Marketing Contacts + CRM Deals + Outbound Webhooks
  router.post('/social-inbox/threads/:id/convert-lead', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const threadId = String(req.params.id);
      const { rows: threadRows } = await pool.query(
        `SELECT * FROM social_inbox_threads WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId]
      );
      if (!threadRows[0]) {
        return res.status(404).json({ success: false, error: 'Thread not found' });
      }
      const thread = threadRows[0];

      const rawName = String(thread.sender_name || 'Social Lead').trim();
      const [firstName, ...restName] = rawName.split(' ');
      const lastName = restName.join(' ') || '';
      const cleanHandle = String(thread.sender_handle || 'lead')
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .toLowerCase();
      const email = String(req.body?.email || `${cleanHandle || 'prospect'}@social-${thread.platform}.lead`).toLowerCase();

      const contactId = randomUUID();
      const { rows: contactRows } = await pool.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, tags, source, lead_score)
         VALUES ($1,$2,$3,$4,$5,$6,'social_inbox',65)
         ON CONFLICT (user_id, email) DO UPDATE
           SET first_name = COALESCE(EXCLUDED.first_name, mailing_contacts.first_name),
               lead_score = GREATEST(mailing_contacts.lead_score, 65)
         RETURNING id, email, first_name, last_name`,
        [contactId, auth.userId, email, firstName, lastName, [thread.platform, 'social-inbox', thread.sentiment]]
      );

      const savedContact = contactRows[0] || { id: contactId, email, first_name: firstName, last_name: lastName };

      // Also create a CRM deal in qualification stage
      const dealId = randomUUID();
      await pool.query(
        `INSERT INTO crm_deals (id, user_id, title, value, currency, stage, contact_id, notes)
         VALUES ($1,$2,$3,$4,'USD','qualified',$5,$6)`,
        [
          dealId,
          auth.userId,
          `${rawName} (${thread.platform.toUpperCase()} Inbound)`,
          Number(req.body?.dealValue || 1200),
          savedContact.id,
          `Converted from ${thread.platform} ${thread.channel_type}: "${thread.last_message_preview}"`,
        ]
      ).catch(() => undefined);

      await pool.query(
        `UPDATE social_inbox_threads SET linked_contact_id = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
        [threadId, auth.userId, savedContact.id]
      );

      if (fireAutomationTrigger) {
        await fireAutomationTrigger(auth.userId, 'social_comment_received', savedContact).catch(() => undefined);
      }

      await dispatchOutboundWebhooks(pool, auth.userId, 'lead.created', {
        source: `social_inbox:${thread.platform}`,
        contact: savedContact,
        deal_id: dealId,
        thread_id: threadId,
      });

      return res.json({
        success: true,
        contact: savedContact,
        dealId,
        message: `Converted ${rawName} into a CRM Contact & Qualified Deal!`,
      });
    } catch (err: any) {
      logger.error({ err }, 'social_inbox_convert_lead_failed');
      return res.status(500).json({ success: false, error: 'Failed to convert thread to lead' });
    }
  });

  return router;
}
