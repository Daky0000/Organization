import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { z } from 'zod';
import { logger } from '../logger.ts';
import { validateBody } from '../middleware/validate.ts';
import { publicApiLimiter } from '../middleware/rateLimiter.ts';
import { recalcLeadScore } from './leadScoring.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Public API: per-user API keys + inbound trigger endpoint.
//
// Keys are created in Settings → API Keys (shown once, only the SHA-256 hash
// is stored). External tools call:
//
//   POST /api/v1/trigger
//   Authorization: Bearer cf_live_…
//   { "event": "api", "email": "a@b.com", "first_name": "…", "tags": ["vip"] }
//
// which upserts the contact into the audience and fires matching automations.
// ─────────────────────────────────────────────────────────────────────────────

type AuthResult = { userId: string } | null;

const KEY_PREFIX = 'cf_live_';

// Trigger names the flow builder offers; anything else is rejected so typos
// don't silently create automations that never fire.
const ALLOWED_EVENTS = new Set([
  'api', 'email_signup', 'sms_signup', 'tag_added', 'tag_removed', 'group_change',
  'page_view', 'link_click', 'manual', 'purchase', 'cart_abandonment',
  'survey_response', 'campaign_started', 'lead_score_threshold', 'utm_link_clicked',
]);

const triggerSchema = z.object({
  event: z.string().trim().min(1).optional(),
  email: z.string().email('Valid email required'),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  phone: z.string().nullish(),
  tags: z.array(z.string()).max(20).nullish(),
}).passthrough();

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

interface KeyDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

// Authenticated key management, mounted under /api
export function registerApiKeyRoutes({ requireAuth, pool }: KeyDeps): Router {
  const router = express.Router();

  // GET /api/keys — list (never returns the secret)
  router.get('/keys', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, keys: rows });
    } catch (err) {
      logger.error({ err }, 'api_keys_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to list API keys' });
    }
  });

  // POST /api/keys — create; the full key appears in this response only
  router.post('/keys', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const name = String(req.body?.name || '').trim() || 'API key';
      const { rows: existing } = await pool.query(
        `SELECT COUNT(*) AS c FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL`, [auth.userId]
      );
      if (Number(existing[0].c) >= 10) {
        return res.status(400).json({ success: false, error: 'Maximum of 10 active API keys — revoke one first' });
      }
      const allowed = ['analytics:read','agents:invoke','content:write','generations:run','memory:sync','os:full'];
      const scopes = req.body?.scopes || ['analytics:read'];
      if (!Array.isArray(scopes) || !scopes.length || scopes.some((scope: unknown) => typeof scope !== 'string' || !allowed.includes(scope))) return res.status(400).json({ error: 'Select valid API key scopes' });
      const secret = KEY_PREFIX + randomBytes(24).toString('hex');
      const prefix = secret.slice(0, KEY_PREFIX.length + 6) + '…';
      const { rows } = await pool.query(
        `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         RETURNING id, name, key_prefix, created_at`,
        [randomUUID(), auth.userId, name.slice(0, 80), prefix, hashKey(secret), JSON.stringify(scopes)]
      );
      return res.json({ success: true, key: { ...rows[0], secret } });
    } catch (err) {
      logger.error({ err }, 'api_key_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create API key' });
    }
  });

  // DELETE /api/keys/:id — revoke
  router.delete('/keys/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rowCount } = await pool.query(
        `UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
        [req.params.id, auth.userId]
      );
      if (!rowCount) return res.status(404).json({ success: false, error: 'Key not found or already revoked' });
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'api_key_revoke_failed');
      return res.status(500).json({ success: false, error: 'Failed to revoke API key' });
    }
  });

  return router;
}

interface TriggerDeps {
  pool: Pool | null;
  fireAutomationTrigger: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}

// Public inbound endpoint, mounted under /api/v1
export function registerPublicTriggerRoutes({ pool, fireAutomationTrigger }: TriggerDeps): Router {
  const router = express.Router();

  router.post('/trigger', publicApiLimiter, validateBody(triggerSchema), async (req: Request, res: Response) => {
    try {
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!bearer.startsWith(KEY_PREFIX)) {
        return res.status(401).json({ success: false, error: 'Missing or invalid API key' });
      }
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });
      const { rows: keyRows } = await pool.query(
        `SELECT k.id,k.user_id FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND u.status='active' LIMIT 1`,
        [hashKey(bearer)]
      );
      if (!keyRows.length) return res.status(401).json({ success: false, error: 'Missing or invalid API key' });
      const { id: keyId, user_id: userId } = keyRows[0];
      void pool.query(`UPDATE api_keys SET last_used_at=NOW() WHERE id=$1`, [keyId]).catch(() => undefined);

      const { event = 'api', email, first_name, last_name, phone, tags } = req.body;
      if (!ALLOWED_EVENTS.has(event)) {
        return res.status(400).json({ success: false, error: `Unknown event '${event}'. Allowed: ${[...ALLOWED_EVENTS].join(', ')}` });
      }

      const { rows: contactRows } = await pool.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source, unsubscribe_token)
         VALUES ($1,$2,$3,$4,$5,$6,'api',$7)
         ON CONFLICT (user_id, email) DO UPDATE SET
           first_name=COALESCE(EXCLUDED.first_name, mailing_contacts.first_name),
           last_name=COALESCE(EXCLUDED.last_name, mailing_contacts.last_name),
           phone=COALESCE(EXCLUDED.phone, mailing_contacts.phone),
           updated_at=NOW()
         RETURNING id, email, (xmax = 0) AS created`,
        [randomUUID(), userId, String(email).toLowerCase().trim(), first_name || null, last_name || null, phone || null, randomUUID()]
      );
      const contact = contactRows[0];

      if (Array.isArray(tags) && tags.length) {
        for (const tag of tags) {
          const t = String(tag).trim();
          if (!t) continue;
          await pool.query(
            `INSERT INTO mailing_contact_tags (id, contact_id, user_id, tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [randomUUID(), contact.id, userId, t]
          ).catch(() => undefined);
        }
        void fireAutomationTrigger(userId, 'tag_added', { id: contact.id, email: contact.email }).catch(() => undefined);
      }
      if (event === 'purchase') {
        // Recorded so the automation if_else "purchase" condition can evaluate it.
        await pool.query(
          `UPDATE mailing_contacts SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('last_purchase_at', NOW()::text), updated_at=NOW() WHERE id=$1`,
          [contact.id]
        ).catch(() => undefined);
      }
      void recalcLeadScore(pool, userId, contact.id);
      void fireAutomationTrigger(userId, event, { id: contact.id, email: contact.email }).catch(() => undefined);

      return res.json({ success: true, contact_id: contact.id, created: contact.created === true, event });
    } catch (err) {
      logger.error({ err }, 'public_trigger_failed');
      return res.status(500).json({ success: false, error: 'Failed to process trigger' });
    }
  });

  return router;
}
