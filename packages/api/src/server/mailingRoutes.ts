import { config } from '../config.ts';
import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { z } from 'zod';
import { logger } from '../logger.ts';
import { validateBody } from '../middleware/validate.ts';
import { recalcLeadScore } from './leadScoring.ts';
import { personalize } from './automationEngine.ts';

const contactCreateSchema = z.object({
  email: z.string().email('Valid email required'),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  phone: z.string().nullish(),
  source: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  email_marketing_consent: z.boolean().nullish(),
  custom_data: z.record(z.unknown()).nullish(),
}).passthrough();

const contactImportSchema = z.object({
  contacts: z.array(z.record(z.unknown())).min(1, 'contacts array required'),
}).passthrough();

const contactBulkSchema = z.object({
  action: z.enum(['delete', 'archive', 'tag']),
  ids: z.array(z.string()).min(1, 'No contacts selected'),
  tag: z.string().nullish(),
}).passthrough();

const tagSchema = z.object({ tag: z.string().trim().min(1, 'Tag required') }).passthrough();

const sendEmailSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required'),
  html: z.string().default(''),
  include_unsubscribe_footer: z.boolean().nullish(),
}).passthrough();

const segmentCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name required'),
  rules: z.record(z.unknown()).nullish(),
}).passthrough();

const campaignCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name required'),
  subject: z.string().trim().min(1, 'Subject required'),
  preview_text: z.string().nullish(),
  content: z.string().nullish(),
  segment_id: z.string().nullish(),
  status: z.string().nullish(),
  scheduled_at: z.string().nullish(),
}).passthrough();

const automationCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name required'),
  trigger_type: z.string().trim().min(1, 'trigger_type required'),
  conditions: z.array(z.unknown()).nullish(),
  actions: z.array(z.unknown()).nullish(),
  status: z.string().nullish(),
}).passthrough();

type AuthResult = { userId: string; email?: string } | null;

interface MailingDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  getResendConfig: () => Promise<{ apiKey: string; fromEmail: string; fromName: string }>;
  fireAutomationTrigger: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}

interface _SegCond { field: string; op: string; value: string }
interface _SegRules { match?: 'all' | 'any'; conditions?: _SegCond[] }

function buildSegmentWhere(rules: _SegRules, params: unknown[]): string {
  const conds = rules?.conditions;
  if (!conds?.length) return 'TRUE';
  const clauses = conds.map(({ field, op, value }) => {
    if (field === 'subscribed') return op === 'is_true' ? 'mc.subscribed=TRUE' : op === 'is_false' ? 'mc.subscribed=FALSE' : 'TRUE';
    if (field === 'tags') {
      params.push(String(value ?? '').trim().toLowerCase());
      const ex = `EXISTS(SELECT 1 FROM mailing_contact_tags mct WHERE mct.contact_id=mc.id AND LOWER(mct.tag)=$${params.length})`;
      return op === 'not_has_tag' ? `NOT ${ex}` : ex;
    }
    const cols: Record<string, string> = { email: 'mc.email', first_name: 'mc.first_name', last_name: 'mc.last_name', phone: 'mc.phone' };
    const col = cols[field]; if (!col) return 'TRUE';
    if (op === 'is_set') return `(${col} IS NOT NULL AND ${col}<>'')`;
    if (op === 'is_not_set') return `(${col} IS NULL OR ${col}='')`;
    const v = String(value ?? '');
    const p = (s: string) => { params.push(s); return params.length; };
    if (op === 'contains') return `${col} ILIKE $${p('%' + v + '%')}`;
    if (op === 'not_contains') return `${col} NOT ILIKE $${p('%' + v + '%')}`;
    if (op === 'is') return `LOWER(${col})=$${p(v.toLowerCase())}`;
    if (op === 'is_not') return `LOWER(${col})<>$${p(v.toLowerCase())}`;
    if (op === 'starts_with') return `${col} ILIKE $${p(v + '%')}`;
    if (op === 'ends_with') return `${col} ILIKE $${p('%' + v)}`;
    return 'TRUE';
  });
  return '(' + clauses.join(rules.match === 'any' ? ' OR ' : ' AND ') + ')';
}

export function registerMailingRoutes({ requireAuth, pool, getResendConfig, fireAutomationTrigger }: MailingDeps): Router {
  const router = express.Router();

  // GET /api/mailing/contacts
  router.get('/contacts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const search = String(req.query.search || '').trim();
      const tag = String(req.query.tag || '').trim();
      let q = `SELECT c.*, COALESCE(array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
               FROM mailing_contacts c
               LEFT JOIN mailing_contact_tags t ON t.contact_id = c.id
               WHERE c.user_id = $1`;
      const params: unknown[] = [auth.userId];
      if (search) { params.push(`%${search}%`); q += ` AND (c.email ILIKE $${params.length} OR c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length})`; }
      if (tag) { params.push(tag); q += ` AND c.id IN (SELECT contact_id FROM mailing_contact_tags WHERE tag = $${params.length} AND user_id = $1)`; }
      q += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`;
      const { rows } = await pool.query(q, params);
      return res.json({ success: true, contacts: rows });
    } catch (err) { logger.error('Failed to fetch contacts', err); return res.status(500).json({ success: false, error: 'Failed to fetch contacts' }); }
  });

  // GET /api/mailing/contacts/analytics
  router.get('/contacts/analytics', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const uid = auth.userId;
      const [totals, overTime, bySource] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, SUM(CASE WHEN subscribed THEN 1 ELSE 0 END) AS subscribed, SUM(CASE WHEN NOT subscribed AND unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed, SUM(CASE WHEN NOT subscribed AND unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS non_subscribed FROM mailing_contacts WHERE user_id=$1`, [uid]),
        pool.query(`SELECT TO_CHAR(DATE(created_at), 'Mon DD') AS label, DATE(created_at) AS d, COUNT(*) AS new_contacts, SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) AS cumulative FROM mailing_contacts WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY d`, [uid]),
        pool.query(`SELECT COALESCE(source,'unknown') AS source, COUNT(*) AS total, SUM(CASE WHEN subscribed THEN 1 ELSE 0 END) AS subscribed, SUM(CASE WHEN NOT subscribed THEN 1 ELSE 0 END) AS unsubscribed FROM mailing_contacts WHERE user_id=$1 GROUP BY source ORDER BY total DESC`, [uid]),
      ]);
      const t = totals.rows[0];
      return res.json({
        success: true,
        overview: { total: +t.total, subscribed: +t.subscribed, unsubscribed: +t.unsubscribed, non_subscribed: +t.non_subscribed },
        over_time: overTime.rows.map(r => ({ label: r.label, new_contacts: +r.new_contacts, cumulative: +r.cumulative })),
        by_source: bySource.rows.map(r => ({ source: r.source, total: +r.total, subscribed: +r.subscribed, unsubscribed: +r.unsubscribed })),
      });
    } catch (err) { logger.error(err); return res.status(500).json({ success: false, error: 'Failed to fetch analytics' }); }
  });

  // GET /api/mailing/contacts/tags
  router.get('/contacts/tags', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(`SELECT DISTINCT tag FROM mailing_contact_tags WHERE user_id=$1 ORDER BY tag`, [auth.userId]);
      return res.json({ success: true, tags: rows.map((r: { tag: string }) => r.tag) });
    } catch (err) { logger.error('Failed to fetch tags', err); return res.status(500).json({ success: false, error: 'Failed to fetch tags' }); }
  });

  // POST /api/mailing/contacts/import
  router.post('/contacts/import', validateBody(contactImportSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { contacts } = req.body;
      let imported = 0, skipped = 0;
      for (const c of contacts.slice(0, 5000)) {
        if (!c.email || !String(c.email).includes('@')) { skipped++; continue; }
        await pool.query(
          `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, unsubscribe_token) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, email) DO NOTHING`,
          [randomUUID(), auth.userId, String(c.email).toLowerCase().trim(), c.first_name || null, c.last_name || null, randomUUID()]
        ).then(() => imported++).catch(() => { skipped++; });
      }
      return res.json({ success: true, imported, skipped });
    } catch (err) { logger.error('Import failed', err); return res.status(500).json({ success: false, error: 'Import failed' }); }
  });

  // POST /api/mailing/contacts/bulk
  router.post('/contacts/bulk', validateBody(contactBulkSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { action, ids, tag } = req.body as { action: string; ids: string[]; tag?: string };
      const ph = ids.map((_, i) => `$${i + 2}`).join(',');
      if (action === 'delete') {
        await pool.query(`DELETE FROM mailing_contacts WHERE user_id=$1 AND id IN (${ph})`, [auth.userId, ...ids]);
      } else if (action === 'archive') {
        await pool.query(`UPDATE mailing_contacts SET subscribed=false,unsubscribed_at=NOW(),updated_at=NOW() WHERE user_id=$1 AND id IN (${ph})`, [auth.userId, ...ids]);
        for (const id of ids) void recalcLeadScore(pool, auth.userId, id);
      } else if (action === 'tag' && tag) {
        for (const id of ids) {
          await pool.query('INSERT INTO mailing_contact_tags (id,contact_id,user_id,tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [randomUUID(), id, auth.userId, String(tag).trim()]).catch(() => undefined);
          void fireAutomationTrigger(auth.userId, 'tag_added', { id })
            .catch((err) => logger.warn({ err }, 'automation_tag_trigger_failed'));
          void recalcLeadScore(pool, auth.userId, id);
        }
      } else { return res.status(400).json({ success: false, error: 'Invalid action' }); }
      return res.json({ success: true });
    } catch (err) { logger.error('Bulk action failed', err); return res.status(500).json({ success: false, error: 'Bulk action failed' }); }
  });

  // POST /api/mailing/contacts
  router.post('/contacts', validateBody(contactCreateSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { email, first_name, last_name, phone, source, tags, email_marketing_consent, custom_data } = req.body;
      const id = randomUUID();
      const customDataJson = (custom_data && typeof custom_data === 'object') ? JSON.stringify(custom_data) : '{}';
      const { rows } = await pool.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source, email_marketing_consent, custom_data, unsubscribe_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (user_id, email) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, phone=EXCLUDED.phone, custom_data=EXCLUDED.custom_data, updated_at=NOW()
         RETURNING *`,
        [id, auth.userId, String(email).toLowerCase().trim(), first_name || null, last_name || null, phone || null, source || 'manual', !!email_marketing_consent, customDataJson, randomUUID()]
      );
      const contact = rows[0];
      if (Array.isArray(tags) && tags.length) {
        for (const tag of tags) {
          await pool.query(
            `INSERT INTO mailing_contact_tags (id, contact_id, user_id, tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [randomUUID(), contact.id, auth.userId, String(tag).trim()]
          ).catch(() => undefined);
        }
      }
      void recalcLeadScore(pool, auth.userId, contact.id);
      // 'email_signup' also matches legacy 'signup' automations (engine aliases them)
      void fireAutomationTrigger(auth.userId, 'email_signup', { id: contact.id, email: contact.email })
        .catch((err) => logger.warn({ err }, 'automation_signup_trigger_failed'));
      if (Array.isArray(tags) && tags.length) {
        void fireAutomationTrigger(auth.userId, 'tag_added', { id: contact.id, email: contact.email })
          .catch((err) => logger.warn({ err }, 'automation_tag_trigger_failed'));
      }
      return res.json({ success: true, contact });
    } catch (err) { logger.error('Failed to create contact', err); return res.status(500).json({ success: false, error: 'Failed to create contact' }); }
  });

  // PATCH /api/mailing/contacts/:id
  router.patch('/contacts/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { first_name, last_name, phone, subscribed, email_marketing_consent, custom_data } = req.body;
      const customDataJson = (custom_data && typeof custom_data === 'object') ? JSON.stringify(custom_data) : undefined;
      const { rows } = await pool.query(
        `UPDATE mailing_contacts SET first_name=$1, last_name=$2, phone=$3, subscribed=$4, email_marketing_consent=$5,
         custom_data=COALESCE($6::jsonb, custom_data),
         unsubscribed_at = CASE WHEN $4=false THEN NOW() ELSE NULL END, updated_at=NOW()
         WHERE id=$7 AND user_id=$8 RETURNING *`,
        [first_name || null, last_name || null, phone || null, subscribed !== false, !!email_marketing_consent, customDataJson ?? null, req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Contact not found' });
      void recalcLeadScore(pool, auth.userId, req.params.id);
      return res.json({ success: true, contact: rows[0] });
    } catch (err) { logger.error('Failed to update contact', err); return res.status(500).json({ success: false, error: 'Failed to update contact' }); }
  });

  // DELETE /api/mailing/contacts/:id
  router.delete('/contacts/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM mailing_contacts WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete contact', err); return res.status(500).json({ success: false, error: 'Failed to delete contact' }); }
  });

  // GET /api/mailing/contacts/:id/timeline — unified activity feed for one contact
  router.get('/contacts/:id/timeline', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const contactId = req.params.id;
      const [contact, emailEvents, tagEvents, automationRuns, pageViews] = await Promise.all([
        pool.query(`SELECT created_at, source FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [contactId, auth.userId]),
        pool.query(
          `SELECT e.event_type, e.created_at, e.metadata, c.name AS campaign_name
           FROM mailing_email_events e LEFT JOIN mailing_campaigns c ON c.id = e.campaign_id
           WHERE e.contact_id=$1 AND e.user_id=$2 ORDER BY e.created_at DESC LIMIT 100`,
          [contactId, auth.userId]
        ),
        pool.query(
          `SELECT tag, created_at FROM mailing_contact_tags WHERE contact_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50`,
          [contactId, auth.userId]
        ),
        pool.query(
          `SELECT j.status, j.run_at, j.created_at, a.name AS automation_name
           FROM mailing_automation_jobs j LEFT JOIN mailing_automations a ON a.id = j.automation_id
           WHERE j.contact_id=$1 AND j.user_id=$2 ORDER BY j.created_at DESC LIMIT 50`,
          [contactId, auth.userId]
        ).catch(() => ({ rows: [] as any[] })),
        pool.query(
          `SELECT url, referrer, created_at FROM page_view_events
           WHERE contact_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50`,
          [contactId, auth.userId]
        ).catch(() => ({ rows: [] as any[] })),
      ]);
      if (!contact.rows.length) return res.status(404).json({ success: false, error: 'Contact not found' });

      type TimelineItem = { type: string; label: string; detail?: string | null; at: string };
      const items: TimelineItem[] = [
        { type: 'created', label: 'Added to audience', detail: contact.rows[0].source ? `via ${contact.rows[0].source}` : null, at: contact.rows[0].created_at },
        ...emailEvents.rows.map((e: any): TimelineItem => ({
          type: `email_${e.event_type}`,
          label: {
            delivered: 'Email sent', open: 'Opened email', click: 'Clicked a link',
            bounced: 'Email bounced', complained: 'Marked as spam',
          }[e.event_type as string] ?? `Email ${e.event_type}`,
          detail: e.campaign_name || (e.metadata?.link ? String(e.metadata.link) : null),
          at: e.created_at,
        })),
        ...tagEvents.rows.map((t: any): TimelineItem => ({
          type: 'tag', label: `Tagged "${t.tag}"`, at: t.created_at,
        })),
        ...automationRuns.rows.map((j: any): TimelineItem => ({
          type: 'automation',
          label: `Automation: ${j.automation_name || 'flow'}`,
          detail: j.status === 'waiting' ? 'waiting for trigger' : j.status === 'pending' ? 'scheduled' : j.status,
          at: j.created_at,
        })),
        ...pageViews.rows.map((v: any): TimelineItem => ({
          type: 'page_view',
          label: 'Visited your website',
          detail: v.url ? String(v.url).replace(/^https?:\/\//, '').slice(0, 80) : null,
          at: v.created_at,
        })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      return res.json({ success: true, timeline: items.slice(0, 150) });
    } catch (err) {
      logger.error('Failed to fetch contact timeline', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch timeline' });
    }
  });

  // GET /api/mailing/contacts/:id
  router.get('/contacts/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT mc.*, COALESCE(array_agg(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL), ARRAY[]::text[]) AS tags
         FROM mailing_contacts mc LEFT JOIN mailing_contact_tags t ON t.contact_id = mc.id
         WHERE mc.id = $1 AND mc.user_id = $2 GROUP BY mc.id`,
        [req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Contact not found' });
      return res.json({ success: true, contact: rows[0] });
    } catch (err) { logger.error('Failed to fetch contact', err); return res.status(500).json({ success: false, error: 'Failed to fetch contact' }); }
  });

  // POST /api/mailing/contacts/:id/tags
  router.post('/contacts/:id/tags', validateBody(tagSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const tag = String(req.body.tag).trim();
      await pool.query('INSERT INTO mailing_contact_tags (id, contact_id, user_id, tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [randomUUID(), req.params.id, auth.userId, tag]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to add tag', err); return res.status(500).json({ success: false, error: 'Failed to add tag' }); }
  });

  // DELETE /api/mailing/contacts/:id/tags/:tag
  router.delete('/contacts/:id/tags/:tag', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM mailing_contact_tags WHERE contact_id=$1 AND user_id=$2 AND tag=$3', [req.params.id, auth.userId, req.params.tag]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to remove tag', err); return res.status(500).json({ success: false, error: 'Failed to remove tag' }); }
  });

  // POST /api/mailing/contacts/:id/send-email
  router.post('/contacts/:id/send-email', validateBody(sendEmailSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { subject, html, include_unsubscribe_footer } = req.body as { subject: string; html: string; include_unsubscribe_footer?: boolean };
      const { rows } = await pool.query('SELECT * FROM mailing_contacts WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Contact not found' });
      const contact = rows[0];
      const { apiKey: resendKey, fromEmail, fromName } = await getResendConfig();
      if (!resendKey) return res.status(503).json({ success: false, error: 'Email sending is not configured — add your Resend API key in Admin → Platform Settings' });
      const unsubUrl = contact.unsubscribe_token ? `${process.env.API_URL || ''}/api/mailing/unsubscribe/${contact.unsubscribe_token}` : null;
      const unsubFooter = include_unsubscribe_footer && unsubUrl
        ? `<br><br><hr style="border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#999">You received this email because you are subscribed. <a href="${unsubUrl}">Unsubscribe</a></p>`
        : '';
      const resolvedHtml = String(html).replaceAll('{{unsubscribe_url}}', unsubUrl ?? '#');
      const resend = new Resend(resendKey);
      const { error: sendErr } = await resend.emails.send({ from: fromName ? `${fromName} <${fromEmail}>` : fromEmail, to: contact.email, subject: subject.trim(), html: `${resolvedHtml}${unsubFooter}` });
      if (sendErr) throw new Error(sendErr.message);
      await pool.query(`INSERT INTO mailing_email_events (id, user_id, campaign_id, contact_id, event_type, created_at) VALUES ($1,$2,NULL,$3,'delivered',NOW())`, [randomUUID(), auth.userId, contact.id]).catch(() => undefined);
      return res.json({ success: true });
    } catch (err) { logger.error(err); return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Send failed' }); }
  });

  // GET /api/mailing/segments
  router.get('/segments', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM mailing_segments WHERE user_id=$1 ORDER BY created_at DESC', [auth.userId]);
      const segments = await Promise.all(rows.map(async seg => {
        try {
          const params: unknown[] = [auth.userId];
          const where = buildSegmentWhere(seg.rules as _SegRules, params);
          const { rows: cr } = await pool.query(`SELECT COUNT(*) c FROM mailing_contacts mc WHERE mc.user_id=$1 AND ${where}`, params);
          return { ...seg, contact_count: parseInt(String(cr[0].c), 10) };
        } catch (_err) { return { ...seg, contact_count: 0 }; }
      }));
      return res.json({ success: true, segments });
    } catch (err) { logger.error('Failed to fetch segments', err); return res.status(500).json({ success: false, error: 'Failed to fetch segments' }); }
  });

  // POST /api/mailing/segments/preview
  router.post('/segments/preview', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const rules = (req.body?.rules ?? {}) as _SegRules;
      const params: unknown[] = [auth.userId];
      const where = buildSegmentWhere(rules, params);
      const [{ rows: cr }, { rows: sr }] = await Promise.all([
        pool.query(`SELECT COUNT(*) c FROM mailing_contacts mc WHERE mc.user_id=$1 AND ${where}`, params),
        pool.query(`SELECT email,first_name,last_name FROM mailing_contacts mc WHERE mc.user_id=$1 AND ${where} LIMIT 5`, params),
      ]);
      return res.json({ success: true, count: parseInt(String(cr[0].c), 10), sample: sr });
    } catch (err) { logger.error('Preview failed', err); return res.status(500).json({ success: false, error: 'Preview failed' }); }
  });

  // POST /api/mailing/segments
  router.post('/segments', validateBody(segmentCreateSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, rules } = req.body;
      const id = randomUUID();
      const rulesJson = JSON.stringify(rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : { match: 'all', conditions: [] });
      const { rows } = await pool.query(`INSERT INTO mailing_segments (id, user_id, name, rules) VALUES ($1,$2,$3,$4) RETURNING *`, [id, auth.userId, name, rulesJson]);
      return res.json({ success: true, segment: rows[0] });
    } catch (err) { logger.error('Failed to create segment', err); return res.status(500).json({ success: false, error: 'Failed to create segment' }); }
  });

  // PATCH /api/mailing/segments/:id
  router.patch('/segments/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, rules } = req.body;
      const rulesJson = (rules && typeof rules === 'object') ? JSON.stringify(rules) : null;
      const { rows } = await pool.query(
        `UPDATE mailing_segments SET name=COALESCE($1,name), rules=COALESCE($2::jsonb,rules), updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`,
        [name || null, rulesJson, req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Segment not found' });
      return res.json({ success: true, segment: rows[0] });
    } catch (err) { logger.error('Failed to update segment', err); return res.status(500).json({ success: false, error: 'Failed to update segment' }); }
  });

  // DELETE /api/mailing/segments/:id
  router.delete('/segments/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM mailing_segments WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete segment', err); return res.status(500).json({ success: false, error: 'Failed to delete segment' }); }
  });

  // GET /api/mailing/segments/:id/contacts
  router.get('/segments/:id/contacts', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: segs } = await pool.query('SELECT * FROM mailing_segments WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!segs.length) return res.status(404).json({ success: false, error: 'Segment not found' });
      const params: unknown[] = [auth.userId];
      const where = buildSegmentWhere(segs[0].rules as _SegRules, params);
      const { rows } = await pool.query(
        `SELECT mc.id, mc.email, mc.first_name, mc.last_name, mc.phone, mc.source, mc.subscribed,
                mc.email_marketing_consent, mc.unsubscribed_at, mc.created_at, mc.updated_at,
                COALESCE(mc.custom_data, '{}'::jsonb) as custom_data,
                COALESCE(array_agg(mct.tag ORDER BY mct.tag) FILTER (WHERE mct.tag IS NOT NULL), ARRAY[]::text[]) as tags
         FROM mailing_contacts mc
         LEFT JOIN mailing_contact_tags mct ON mct.contact_id = mc.id
         WHERE mc.user_id = $1 AND ${where}
         GROUP BY mc.id, mc.email, mc.first_name, mc.last_name, mc.phone, mc.source, mc.subscribed,
                  mc.email_marketing_consent, mc.unsubscribed_at, mc.created_at, mc.updated_at, mc.custom_data
         ORDER BY mc.created_at DESC`,
        params
      );
      return res.json({ success: true, contacts: rows });
    } catch (err) {
      logger.error('[segment contacts]', err);
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch contacts' });
    }
  });

  // GET /api/mailing/campaigns
  router.get('/campaigns', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT c.*, s.name as segment_name FROM mailing_campaigns c LEFT JOIN mailing_segments s ON s.id = c.segment_id WHERE c.user_id=$1 ORDER BY c.created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, campaigns: rows });
    } catch (err) { logger.error('Failed to fetch campaigns', err); return res.status(500).json({ success: false, error: 'Failed to fetch campaigns' }); }
  });

  // POST /api/mailing/campaigns
  router.post('/campaigns', validateBody(campaignCreateSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, subject, preview_text, content, segment_id, status, scheduled_at } = req.body;
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO mailing_campaigns (id, user_id, name, subject, preview_text, content, segment_id, status, scheduled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, auth.userId, name, subject, preview_text || null, content || '', segment_id || null, status || 'draft', scheduled_at || null]
      );
      return res.json({ success: true, campaign: rows[0] });
    } catch (err) { logger.error('Failed to create campaign', err); return res.status(500).json({ success: false, error: 'Failed to create campaign' }); }
  });

  // PATCH /api/mailing/campaigns/:id
  router.patch('/campaigns/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, subject, preview_text, content, segment_id, status, scheduled_at } = req.body;
      const { rows } = await pool.query(
        `UPDATE mailing_campaigns SET name=COALESCE($1,name), subject=COALESCE($2,subject), preview_text=$3, content=COALESCE($4,content), segment_id=$5, status=COALESCE($6,status), scheduled_at=$7, updated_at=NOW() WHERE id=$8 AND user_id=$9 RETURNING *`,
        [name || null, subject || null, preview_text || null, content || null, segment_id || null, status || null, scheduled_at || null, req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
      return res.json({ success: true, campaign: rows[0] });
    } catch (err) { logger.error('Failed to update campaign', err); return res.status(500).json({ success: false, error: 'Failed to update campaign' }); }
  });

  // DELETE /api/mailing/campaigns/:id
  router.delete('/campaigns/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM mailing_campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete campaign', err); return res.status(500).json({ success: false, error: 'Failed to delete campaign' }); }
  });

  // POST /api/mailing/campaigns/:id/send
  router.post('/campaigns/:id/send', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { apiKey: resendKey } = await getResendConfig();
      if (!resendKey) return res.status(503).json({ success: false, error: 'Email sending is not configured — add your Resend API key in Admin → Platform Settings' });
      const { rows: campaignRows } = await pool.query(
        `SELECT c.*, ms.name AS segment_name FROM mailing_campaigns c LEFT JOIN mailing_segments ms ON ms.id = c.segment_id WHERE c.id = $1 AND c.user_id = $2`,
        [req.params.id, auth.userId]
      );
      if (!campaignRows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
      const campaign = campaignRows[0];
      if (campaign.status === 'sent') return res.status(400).json({ success: false, error: 'Campaign already sent' });
      let contacts: any[];
      if (campaign.segment_id) {
        const { rows: segs } = await pool.query('SELECT * FROM mailing_segments WHERE id=$1 AND user_id=$2', [campaign.segment_id, auth.userId]);
        if (!segs.length) return res.status(400).json({ success: false, error: 'Segment not found' });
        const segParams: unknown[] = [auth.userId];
        const segWhere = buildSegmentWhere(segs[0].rules as _SegRules, segParams);
        const { rows } = await pool.query(
          `SELECT mc.* FROM mailing_contacts mc LEFT JOIN mailing_contact_tags mct ON mct.contact_id = mc.id WHERE mc.user_id = $1 AND mc.subscribed = true AND mc.email IS NOT NULL AND ${segWhere} GROUP BY mc.id`,
          segParams
        );
        contacts = rows;
      } else {
        // email IS NOT NULL: sales leads may be phone-only since the sales
        // module made the column nullable, and they are not email recipients.
        const { rows } = await pool.query('SELECT * FROM mailing_contacts WHERE user_id = $1 AND subscribed = true AND email IS NOT NULL', [auth.userId]);
        contacts = rows;
      }
      if (!contacts.length) return res.status(400).json({ success: false, error: 'No subscribed contacts found' });
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const claimed=await client.query("UPDATE mailing_campaigns SET status='queued' WHERE id=$1 AND user_id=$2 AND status NOT IN ('sent','queued') RETURNING id",[campaign.id,auth.userId]);
        if (!claimed.rows.length) { await client.query('ROLLBACK');return res.status(409).json({ error: 'Campaign is already queued or sent' }); }
        for (const contact of contacts) {
          const token=contact.unsubscribe_token || randomUUID();
          if (!contact.unsubscribe_token) await client.query('UPDATE mailing_contacts SET unsubscribe_token=$2 WHERE id=$1',[contact.id,token]);
          const unsubscribeUrl=`${config.appUrl}/api/mailing/unsubscribe/${encodeURIComponent(token)}`;
          const raw=String(campaign.content || '');
          const html=personalize(raw.replaceAll('{{unsubscribe_url}}',unsubscribeUrl),contact);
          const body=html.includes('<') ? html : html.replace(/\n/g,'<br>');
          const footer=raw.includes('{{unsubscribe_url}}') ? '' : `<p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
          await client.query(`INSERT INTO campaign_email_jobs(id,user_id,campaign_id,contact_id,recipient,subject,html,unsubscribe_url)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(campaign_id,contact_id) DO NOTHING`,
            [randomUUID(),auth.userId,campaign.id,contact.id,contact.email,personalize(String(campaign.subject || ''),contact),body+footer,unsubscribeUrl]);
        }
        await client.query('COMMIT');
        return res.status(202).json({ success: true,queued: contacts.length,sent: 0,failed: 0 });
      } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }

    } catch (err: unknown) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Send failed' });
    }
  });

  // GET /api/mailing/automations
  router.get('/automations', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM mailing_automations WHERE user_id=$1 ORDER BY created_at DESC', [auth.userId]);
      return res.json({ success: true, automations: rows });
    } catch (err) { logger.error('Failed to fetch automations', err); return res.status(500).json({ success: false, error: 'Failed to fetch automations' }); }
  });

  // POST /api/mailing/automations
  router.post('/automations', validateBody(automationCreateSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, trigger_type, conditions, actions, status } = req.body;
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO mailing_automations (id, user_id, name, trigger_type, conditions, actions, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, auth.userId, name, trigger_type, JSON.stringify(conditions || []), JSON.stringify(actions || []), status || 'draft']
      );
      return res.json({ success: true, automation: rows[0] });
    } catch (err) { logger.error('Failed to create automation', err); return res.status(500).json({ success: false, error: 'Failed to create automation' }); }
  });

  // PATCH /api/mailing/automations/:id
  router.patch('/automations/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, trigger_type, conditions, actions, status } = req.body;
      const { rows } = await pool.query(
        `UPDATE mailing_automations SET name=COALESCE($1,name), trigger_type=COALESCE($2,trigger_type), conditions=COALESCE($3::jsonb,conditions), actions=COALESCE($4::jsonb,actions), status=COALESCE($5,status), updated_at=NOW() WHERE id=$6 AND user_id=$7 RETURNING *`,
        [name || null, trigger_type || null, conditions ? JSON.stringify(conditions) : null, actions ? JSON.stringify(actions) : null, status || null, req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Automation not found' });
      return res.json({ success: true, automation: rows[0] });
    } catch (err) { logger.error('Failed to update automation', err); return res.status(500).json({ success: false, error: 'Failed to update automation' }); }
  });

  // DELETE /api/mailing/automations/:id
  router.delete('/automations/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM mailing_automations WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete automation', err); return res.status(500).json({ success: false, error: 'Failed to delete automation' }); }
  });

  // GET /api/mailing/analytics
  router.get('/analytics', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const [contactsRes, campaignsRes, eventsRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE subscribed=true) as subscribed, COUNT(*) FILTER (WHERE subscribed=false) as unsubscribed FROM mailing_contacts WHERE user_id=$1`, [auth.userId]),
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='sent') as sent, COUNT(*) FILTER (WHERE status='draft') as draft, COUNT(*) FILTER (WHERE status='scheduled') as scheduled FROM mailing_campaigns WHERE user_id=$1`, [auth.userId]),
        pool.query(`SELECT event_type, COUNT(*) as count FROM mailing_email_events WHERE user_id=$1 GROUP BY event_type`, [auth.userId]),
      ]);
      const eventCounts: Record<string, number> = {};
      for (const row of eventsRes.rows) eventCounts[row.event_type] = Number(row.count);
      const delivered = eventCounts['delivered'] || 0;
      return res.json({
        success: true,
        contacts: { total: Number(contactsRes.rows[0].total), subscribed: Number(contactsRes.rows[0].subscribed), unsubscribed: Number(contactsRes.rows[0].unsubscribed) },
        campaigns: { total: Number(campaignsRes.rows[0].total), sent: Number(campaignsRes.rows[0].sent), draft: Number(campaignsRes.rows[0].draft), scheduled: Number(campaignsRes.rows[0].scheduled) },
        events: eventCounts,
        rates: {
          openRate: delivered > 0 ? Math.round(((eventCounts['open'] || 0) / delivered) * 100) : 0,
          clickRate: delivered > 0 ? Math.round(((eventCounts['click'] || 0) / delivered) * 100) : 0,
          bounceRate: delivered > 0 ? Math.round(((eventCounts['bounced'] || 0) / delivered) * 100) : 0,
        },
      });
    } catch (err) { logger.error('Failed to fetch mailing analytics', err); return res.status(500).json({ success: false, error: 'Failed to fetch analytics' }); }
  });

  // GET /api/mailing/analytics/campaigns — per-campaign open/click/unsub breakdown
  router.get('/analytics/campaigns', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT
           mc.id AS campaign_id,
           mc.name,
           mc.sent_at,
           COALESCE(SUM(CASE WHEN me.event_type = 'delivered' THEN 1 ELSE 0 END), 0)::int AS delivered,
           COALESCE(SUM(CASE WHEN me.event_type = 'open'      THEN 1 ELSE 0 END), 0)::int AS opens,
           COALESCE(SUM(CASE WHEN me.event_type = 'click'     THEN 1 ELSE 0 END), 0)::int AS clicks,
           COALESCE(SUM(CASE WHEN me.event_type = 'unsubscribe' THEN 1 ELSE 0 END), 0)::int AS unsubscribes,
           CASE WHEN SUM(CASE WHEN me.event_type = 'delivered' THEN 1 ELSE 0 END) > 0
             THEN ROUND(SUM(CASE WHEN me.event_type = 'open' THEN 1 ELSE 0 END)::numeric
               / SUM(CASE WHEN me.event_type = 'delivered' THEN 1 ELSE 0 END) * 100, 1)
             ELSE 0
           END AS open_rate,
           CASE WHEN SUM(CASE WHEN me.event_type = 'delivered' THEN 1 ELSE 0 END) > 0
             THEN ROUND(SUM(CASE WHEN me.event_type = 'click' THEN 1 ELSE 0 END)::numeric
               / SUM(CASE WHEN me.event_type = 'delivered' THEN 1 ELSE 0 END) * 100, 1)
             ELSE 0
           END AS click_rate
         FROM mailing_campaigns mc
         LEFT JOIN mailing_email_events me ON me.campaign_id = mc.id
         WHERE mc.user_id = $1 AND mc.status = 'sent'
         GROUP BY mc.id, mc.name, mc.sent_at
         ORDER BY mc.sent_at DESC NULLS LAST
         LIMIT 50`,
        [auth.userId]
      );
      return res.json({ success: true, rows: rows.map(r => ({ ...r, delivered: Number(r.delivered), opens: Number(r.opens), clicks: Number(r.clicks), unsubscribes: Number(r.unsubscribes), open_rate: Number(r.open_rate), click_rate: Number(r.click_rate) })) });
    } catch (err) { logger.error('Failed to fetch campaign analytics', err); return res.status(500).json({ success: false, error: 'Failed to fetch campaign analytics' }); }
  });

  // GET /api/mailing/unsubscribe/:token — public unsubscribe link
  router.get('/unsubscribe/:token', async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `UPDATE mailing_contacts SET subscribed = false, unsubscribed_at = NOW() WHERE unsubscribe_token = $1 RETURNING id, user_id, email`,
        [req.params.token]
      );
      if (!rows.length) return res.status(404).send('Invalid unsubscribe link.');
      void recalcLeadScore(pool, rows[0].user_id, rows[0].id);
      // Escape — the email is user-controlled and this page is public (XSS).
      const safeEmail = String(rows[0].email).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Unsubscribed</h2><p>${safeEmail} has been unsubscribed.</p></body></html>`);
    } catch (err) {
      logger.error('Unsubscribe error:', err);
      return res.status(500).send('Something went wrong.');
    }
  });

  return router;
}
