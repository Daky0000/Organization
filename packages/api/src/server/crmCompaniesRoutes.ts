import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

export function registerCRMCompaniesRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── List companies ────────────────────────────────────────────────────────────
  router.get('/companies', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { search, source, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    let where = 'user_id=$1';
    if (search) { params.push(`%${search}%`); where += ` AND (name ILIKE $${params.length} OR domain ILIKE $${params.length} OR email ILIKE $${params.length})`; }
    if (source === 'manual') { where += ` AND custom_data->>'source' = 'manual'`; }
    // root_domain() strips subdomains: updates.hostinger.com → hostinger.com
    const rootDomainExpr = `regexp_replace(LOWER(c.domain), '^(?:.*\\.)?([^.]+\\.[^.]+)$', '\\1')`;
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (COALESCE(${rootDomainExpr}, c.id))
           c.*,
           (SELECT COUNT(*) FROM crm_contact_companies cc WHERE cc.company_id=c.id) AS contact_count,
           (SELECT COUNT(*) FROM crm_deals d WHERE d.company_id=c.id AND d.status='open') AS open_deals_count,
           (SELECT COALESCE(SUM(d.value),0) FROM crm_deals d WHERE d.company_id=c.id AND d.status='open') AS open_deals_value
         FROM crm_companies c WHERE ${where}
         ORDER BY COALESCE(${rootDomainExpr}, c.id),
                  CASE WHEN c.custom_data->>'source' = 'manual' THEN 0 ELSE 1 END,
                  c.created_at ASC
       ) deduped
       ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const rootDomainExprCount = `regexp_replace(LOWER(domain), '^(?:.*\\.)?([^.]+\\.[^.]+)$', '\\1')`;
    const countWhere = source === 'manual'
      ? `user_id=$1 AND custom_data->>'source' = 'manual'`
      : 'user_id=$1';
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*) FROM (
         SELECT DISTINCT ON (COALESCE(${rootDomainExprCount}, id)) id
         FROM crm_companies WHERE ${countWhere}
         ORDER BY COALESCE(${rootDomainExprCount}, id)
       ) deduped`,
      [auth.userId]
    );
    res.json({ companies: rows, total: parseInt(count) });
  });

  // ── Get single company ────────────────────────────────────────────────────────
  router.get('/companies/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(`SELECT * FROM crm_companies WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    // Normalise to root domain so subdomains all group together
    const rawDomain = (rows[0].domain || '').toLowerCase().trim();
    const rootMatch = rawDomain.match(/(?:.*\.)?([^.]+\.[^.]+)$/);
    const companyRootDomain = rootMatch ? rootMatch[1] : rawDomain;
    const { rows: contacts } = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (mc.id)
           mc.id, mc.email, mc.first_name, mc.last_name, mc.phone,
           cc.role,
           COALESCE(cc.is_primary, false) AS is_primary
         FROM mailing_contacts mc
         LEFT JOIN crm_contact_companies cc ON cc.contact_id=mc.id AND cc.company_id=$1
         WHERE mc.user_id=$3 AND (
           cc.company_id = $1
           OR (
             $2 <> '' AND POSITION('@' IN mc.email) > 0
             AND (
               -- exact match
               LOWER(SUBSTRING(mc.email FROM POSITION('@' IN mc.email) + 1)) = $2
               -- email is a subdomain of the company root (e.g. updates.hostinger.com)
               OR LOWER(SUBSTRING(mc.email FROM POSITION('@' IN mc.email) + 1)) LIKE '%.' || $2
               -- both sides share the same root domain (handles old subdomain-stored companies)
               OR regexp_replace(LOWER(SUBSTRING(mc.email FROM POSITION('@' IN mc.email) + 1)),
                    '^(?:.*\\.)?([^.]+\\.[^.]+)$', '\\1') = $2
             )
           )
         )
         ORDER BY mc.id, (cc.is_primary IS TRUE) DESC NULLS LAST
       ) c
       ORDER BY (is_primary IS TRUE) DESC NULLS LAST, first_name, email`,
      [req.params.id, companyRootDomain, auth.userId]
    );
    const { rows: deals } = await pool.query(
      `SELECT d.id, d.title, d.value, d.currency, d.status, d.priority, d.close_date, s.name AS stage_name, s.color AS stage_color
       FROM crm_deals d LEFT JOIN crm_pipeline_stages s ON s.id=d.stage_id
       WHERE d.company_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC LIMIT 10`,
      [req.params.id, auth.userId]
    );
    res.json({ ...rows[0], contacts, deals });
  });

  // ── Create company ────────────────────────────────────────────────────────────
  router.post('/companies', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, domain, industry, size, website, phone, email, address, city, country, description, logo_url, custom_data } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    const id = randomUUID();
    const mergedData = { ...(custom_data || {}), source: 'manual' };
    const { rows } = await pool.query(
      `INSERT INTO crm_companies (id,user_id,name,domain,industry,size,website,phone,email,address,city,country,description,logo_url,custom_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, auth.userId, name.trim(), domain||null, industry||null, size||null, website||null, phone||null, email||null, address||null, city||null, country||null, description||null, logo_url||null, JSON.stringify(mergedData)]
    );
    res.status(201).json(rows[0]);
  });

  // ── Update company ────────────────────────────────────────────────────────────
  router.patch('/companies/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const fields = ['name','domain','industry','size','website','phone','email','address','city','country','description','logo_url','custom_data'];
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    for (const f of fields) {
      if (req.body[f] !== undefined) { params.push(f === 'custom_data' ? JSON.stringify(req.body[f]) : req.body[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(`UPDATE crm_companies SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  // ── Delete company ────────────────────────────────────────────────────────────
  router.delete('/companies/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_companies WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Link / unlink contact ─────────────────────────────────────────────────────
  router.post('/companies/:id/contacts', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { contact_id, role, is_primary } = req.body;
    if (!contact_id) return void res.status(400).json({ error: 'contact_id required' });
    if (is_primary) await pool.query(`UPDATE crm_contact_companies SET is_primary=false WHERE company_id=$1`, [req.params.id]);
    await pool.query(
      `INSERT INTO crm_contact_companies (contact_id,company_id,role,is_primary) VALUES ($1,$2,$3,$4)
       ON CONFLICT (contact_id,company_id) DO UPDATE SET role=$3, is_primary=$4`,
      [contact_id, req.params.id, role||null, !!is_primary]
    );
    res.json({ ok: true });
  });

  router.delete('/companies/:id/contacts/:contactId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_contact_companies WHERE company_id=$1 AND contact_id=$2`, [req.params.id, req.params.contactId]);
    res.json({ ok: true });
  });

  return router;
}
