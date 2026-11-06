import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '../logger.ts';
import { validateBody } from '../middleware/validate.ts';
import { publicApiLimiter } from '../middleware/rateLimiter.ts';
import { recalcLeadScore } from './leadScoring.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Lead-capture forms.
//
// Authenticated CRUD under /api/forms; the public form is served at /f/:id as
// a self-contained no-JS HTML page (safe to embed in an iframe on any site —
// no CORS involved because the POST goes back to this origin). Submissions
// upsert the contact into the mailing audience, apply tags, recalculate the
// lead score, and fire email_signup / tag_added automation triggers.
// ─────────────────────────────────────────────────────────────────────────────

type AuthResult = { userId: string } | null;

type FormField = { key: string; label: string; type: string; required: boolean };

const STANDARD_FIELDS = new Set(['email', 'first_name', 'last_name', 'phone']);

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/i, 'Field keys must be alphanumeric/underscore'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'email', 'tel', 'textarea']).default('text'),
  required: z.boolean().default(false),
});

const formSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(120),
  fields: z.array(fieldSchema).max(12).default([]),
  settings: z.object({
    title: z.string().max(120).nullish(),
    description: z.string().max(500).nullish(),
    button_text: z.string().max(40).nullish(),
    success_message: z.string().max(300).nullish(),
    theme_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).nullish(),
  }).passthrough().default({}),
  status: z.enum(['active', 'paused']).nullish(),
});

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function normalizeFields(fields: FormField[]): FormField[] {
  // Email capture is the entire point — always present, always required.
  const rest = fields.filter((f) => f.key !== 'email');
  return [{ key: 'email', label: 'Email', type: 'email', required: true }, ...rest];
}

function renderFormPage(form: { id: string; fields: FormField[]; settings: Record<string, any> }, state?: 'success' | 'error'): string {
  const s = form.settings ?? {};
  const color = /^#[0-9a-fA-F]{6}$/.test(String(s.theme_color)) ? s.theme_color : '#5b6cf9';
  const title = escapeHtml(s.title || 'Stay in touch');
  const description = s.description ? `<p class="desc">${escapeHtml(s.description)}</p>` : '';
  const button = escapeHtml(s.button_text || 'Subscribe');
  const success = escapeHtml(s.success_message || "Thanks — you're on the list!");

  const body = state === 'success'
    ? `<div class="done">✓<br/>${success}</div>`
    : `
      ${state === 'error' ? '<p class="err">Something went wrong — please try again.</p>' : ''}
      <form method="POST" action="/f/${escapeHtml(form.id)}/submit">
        <input type="text" name="website_hp" value="" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true"/>
        ${normalizeFields(form.fields).map((f) => `
        <label>${escapeHtml(f.label)}${f.required ? ' *' : ''}
          ${f.type === 'textarea'
            ? `<textarea name="${escapeHtml(f.key)}" rows="3"${f.required ? ' required' : ''}></textarea>`
            : `<input type="${escapeHtml(f.type)}" name="${escapeHtml(f.key)}"${f.required ? ' required' : ''}/>`}
        </label>`).join('')}
        <button type="submit">${button}</button>
      </form>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:Inter,system-ui,-apple-system,sans-serif;background:transparent;padding:16px}
  .card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px}
  h1{font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-.02em}
  .desc{margin-top:6px;font-size:14px;color:#64748b;line-height:1.5}
  form{margin-top:18px;display:flex;flex-direction:column;gap:12px}
  label{font-size:12px;font-weight:700;color:#334155;display:flex;flex-direction:column;gap:5px}
  input,textarea{font:inherit;font-size:14px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;outline:none;width:100%}
  input:focus,textarea:focus{border-color:${color}}
  button{font:inherit;font-size:14px;font-weight:800;color:#fff;background:${color};border:0;border-radius:10px;padding:12px;cursor:pointer;margin-top:4px}
  button:hover{filter:brightness(.95)}
  .done{text-align:center;font-size:16px;font-weight:700;color:#0f172a;padding:24px 0;line-height:2}
  .err{margin-top:10px;font-size:13px;color:#dc2626}
</style></head>
<body><div class="card"><h1>${title}</h1>${description}${body}</div></body></html>`;
}

interface FormsDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

// Authenticated CRUD, mounted under /api
export function registerFormsRoutes({ requireAuth, pool }: FormsDeps): Router {
  const router = express.Router();

  router.get('/forms', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT id, name, fields, settings, status, submissions_count, created_at, updated_at
         FROM lead_forms WHERE user_id=$1 ORDER BY created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, forms: rows });
    } catch (err) {
      logger.error({ err }, 'forms_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to list forms' });
    }
  });

  router.post('/forms', validateBody(formSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, fields, settings, status } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO lead_forms (id, user_id, name, fields, settings, status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, fields, settings, status, submissions_count, created_at, updated_at`,
        [randomUUID(), auth.userId, name, JSON.stringify(normalizeFields(fields)), JSON.stringify(settings), status || 'active']
      );
      return res.json({ success: true, form: rows[0] });
    } catch (err) {
      logger.error({ err }, 'form_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create form' });
    }
  });

  router.put('/forms/:id', validateBody(formSchema.partial()), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, fields, settings, status } = req.body;
      const { rows } = await pool.query(
        `UPDATE lead_forms SET
           name=COALESCE($1,name),
           fields=COALESCE($2::jsonb,fields),
           settings=COALESCE($3::jsonb,settings),
           status=COALESCE($4,status),
           updated_at=NOW()
         WHERE id=$5 AND user_id=$6
         RETURNING id, name, fields, settings, status, submissions_count, created_at, updated_at`,
        [
          name ?? null,
          fields ? JSON.stringify(normalizeFields(fields)) : null,
          settings ? JSON.stringify(settings) : null,
          status ?? null,
          req.params.id, auth.userId,
        ]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Form not found' });
      return res.json({ success: true, form: rows[0] });
    } catch (err) {
      logger.error({ err }, 'form_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update form' });
    }
  });

  router.delete('/forms/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query(`DELETE FROM lead_forms WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'form_delete_failed');
      return res.status(500).json({ success: false, error: 'Failed to delete form' });
    }
  });

  return router;
}

interface PublicFormDeps {
  pool: Pool | null;
  fireAutomationTrigger: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}

// Public hosted form, mounted at /f (no auth; embeddable via iframe)
export function registerPublicFormRoutes({ pool, fireAutomationTrigger }: PublicFormDeps): Router {
  const router = express.Router();
  // Form posts are classic urlencoded submissions
  router.use(express.urlencoded({ extended: false, limit: '100kb' }));

  async function loadForm(id: string) {
    if (!pool) return null;
    const { rows } = await pool.query(
      `SELECT id, user_id, fields, settings, status FROM lead_forms WHERE id=$1 LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  }

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const form = await loadForm(req.params.id);
      if (!form || form.status !== 'active') return res.status(404).send('Form not found');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderFormPage(form));
    } catch (err) {
      logger.error({ err }, 'form_render_failed');
      return res.status(500).send('Something went wrong');
    }
  });

  router.post('/:id/submit', publicApiLimiter, async (req: Request, res: Response) => {
    try {
      const form = await loadForm(req.params.id);
      if (!form || form.status !== 'active' || !pool) return res.status(404).send('Form not found');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      // Honeypot filled → bot. Pretend success so it learns nothing.
      if (String(req.body?.website_hp || '').trim()) return res.send(renderFormPage(form, 'success'));

      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).send(renderFormPage(form, 'error'));
      }

      const fields: FormField[] = Array.isArray(form.fields) ? form.fields : [];
      const custom: Record<string, string> = {};
      for (const f of fields) {
        if (STANDARD_FIELDS.has(f.key)) continue;
        const v = String(req.body?.[f.key] ?? '').trim();
        if (v) custom[f.key] = v.slice(0, 1000);
      }

      const { rows: contactRows } = await pool.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source, email_marketing_consent, custom_data, unsubscribe_token)
         VALUES ($1,$2,$3,$4,$5,$6,'form',true,$7::jsonb,$8)
         ON CONFLICT (user_id, email) DO UPDATE SET
           first_name=COALESCE(NULLIF(EXCLUDED.first_name,''), mailing_contacts.first_name),
           last_name=COALESCE(NULLIF(EXCLUDED.last_name,''), mailing_contacts.last_name),
           phone=COALESCE(NULLIF(EXCLUDED.phone,''), mailing_contacts.phone),
           custom_data=COALESCE(mailing_contacts.custom_data,'{}'::jsonb) || EXCLUDED.custom_data,
           updated_at=NOW()
         RETURNING id, email`,
        [
          randomUUID(), form.user_id, email,
          String(req.body?.first_name ?? '').trim() || null,
          String(req.body?.last_name ?? '').trim() || null,
          String(req.body?.phone ?? '').trim() || null,
          JSON.stringify(custom), randomUUID(),
        ]
      );
      const contact = contactRows[0];

      const tags: string[] = Array.isArray(form.settings?.tags) ? form.settings.tags : [];
      for (const tag of tags) {
        await pool.query(
          `INSERT INTO mailing_contact_tags (id, contact_id, user_id, tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [randomUUID(), contact.id, form.user_id, String(tag).trim()]
        ).catch(() => undefined);
      }

      void pool.query(`UPDATE lead_forms SET submissions_count=submissions_count+1 WHERE id=$1`, [form.id]).catch(() => undefined);
      void recalcLeadScore(pool, form.user_id, contact.id);
      void fireAutomationTrigger(form.user_id, 'email_signup', { id: contact.id, email: contact.email }).catch(() => undefined);
      if (tags.length) {
        void fireAutomationTrigger(form.user_id, 'tag_added', { id: contact.id, email: contact.email }).catch(() => undefined);
      }

      return res.send(renderFormPage(form, 'success'));
    } catch (err) {
      logger.error({ err }, 'form_submit_failed');
      return res.status(500).send('Something went wrong');
    }
  });

  return router;
}
