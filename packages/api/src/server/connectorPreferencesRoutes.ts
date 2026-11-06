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

export function registerConnectorPreferencesRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── Get user's active provider for a domain ───────────────────────────────────
  router.get('/prefs/:domainSlug', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [pref] } = await pool.query(
      `SELECT p.*, cat.name AS provider_name, cat.capabilities, cat.is_native
       FROM connector_user_prefs p
       JOIN connector_provider_catalog cat ON cat.domain_slug=p.domain_slug AND cat.slug=p.provider_slug
       WHERE p.user_id=$1 AND p.domain_slug=$2`,
      [auth.userId, req.params.domainSlug]
    );
    if (!pref) {
      // Return the native provider as default
      const { rows: [native] } = await pool.query(
        `SELECT * FROM connector_provider_catalog WHERE domain_slug=$1 AND is_native=true LIMIT 1`,
        [req.params.domainSlug]
      );
      return void res.json({ domain_slug: req.params.domainSlug, provider_slug: 'native', provider: native, is_default: true });
    }
    res.json(pref);
  });

  // ── Get all user prefs (one per domain) ────────────────────────────────────────
  router.get('/prefs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: domains } = await pool.query(`SELECT slug FROM connector_domains ORDER BY position`);
    const { rows: prefs } = await pool.query(
      `SELECT p.*, cat.name AS provider_name, cat.capabilities, cat.is_native, cat.logo_url
       FROM connector_user_prefs p
       JOIN connector_provider_catalog cat ON cat.domain_slug=p.domain_slug AND cat.slug=p.provider_slug
       WHERE p.user_id=$1`,
      [auth.userId]
    );
    const prefMap = Object.fromEntries(prefs.map((p: any) => [p.domain_slug, p]));
    const result = domains.map((d: any) => prefMap[d.slug] || { domain_slug: d.slug, provider_slug: 'native', is_default: true });
    res.json(result);
  });

  // ── Set active provider for a domain ──────────────────────────────────────────
  router.put('/prefs/:domainSlug', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { provider_slug, config } = req.body;
    if (!provider_slug) return void res.status(400).json({ error: 'provider_slug required' });

    // Validate domain + provider exist
    const { rows: [domain] } = await pool.query(`SELECT slug FROM connector_domains WHERE slug=$1`, [req.params.domainSlug]);
    if (!domain) return void res.status(404).json({ error: 'Domain not found' });
    const { rows: [provider] } = await pool.query(
      `SELECT * FROM connector_provider_catalog WHERE domain_slug=$1 AND slug=$2`,
      [req.params.domainSlug, provider_slug]
    );
    if (!provider) return void res.status(404).json({ error: 'Provider not found for this domain' });

    // Check user has access to this provider
    if (!provider.is_native && provider.requires_integration_slug) {
      const { rows: [conn] } = await pool.query(
        `SELECT ui.id FROM user_integrations ui JOIN integrations i ON i.id=ui.integration_id
         WHERE ui.user_id=$1 AND i.slug=$2 AND ui.status='connected'`,
        [auth.userId, provider.requires_integration_slug]
      );
      if (!conn) return void res.status(403).json({ error: `Connect ${provider.name} first to use it as your ${req.params.domainSlug} provider` });
    }

    const { rows: [upserted] } = await pool.query(
      `INSERT INTO connector_user_prefs (id,user_id,domain_slug,provider_slug,config,updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (user_id,domain_slug) DO UPDATE SET provider_slug=$4, config=$5, updated_at=NOW()
       RETURNING *`,
      [randomUUID(), auth.userId, req.params.domainSlug, provider_slug, JSON.stringify(config || {})]
    );
    res.json({ ...upserted, provider_name: provider.name, capabilities: provider.capabilities });
  });

  // ── Reset domain to native ────────────────────────────────────────────────────
  router.delete('/prefs/:domainSlug', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(
      `UPDATE connector_user_prefs SET provider_slug='native', config='{}', updated_at=NOW()
       WHERE user_id=$1 AND domain_slug=$2`,
      [auth.userId, req.params.domainSlug]
    );
    res.json({ ok: true, domain_slug: req.params.domainSlug, provider_slug: 'native' });
  });

  // ── Field mappings CRUD ───────────────────────────────────────────────────────
  router.get('/field-maps', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { domain_slug, provider_slug } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['user_id=$1'];
    if (domain_slug) { params.push(domain_slug); wheres.push(`domain_slug=$${params.length}`); }
    if (provider_slug) { params.push(provider_slug); wheres.push(`provider_slug=$${params.length}`); }
    const { rows } = await pool.query(
      `SELECT * FROM connector_field_maps WHERE ${wheres.join(' AND ')} ORDER BY domain_slug, provider_slug, external_field`,
      params
    );
    res.json(rows);
  });

  router.post('/field-maps', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { domain_slug, provider_slug, external_field, native_field, transform, direction } = req.body;
    if (!domain_slug || !provider_slug || !external_field || !native_field) {
      return void res.status(400).json({ error: 'domain_slug, provider_slug, external_field, native_field required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO connector_field_maps (id,user_id,domain_slug,provider_slug,external_field,native_field,transform,direction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id,domain_slug,provider_slug,external_field,direction) DO UPDATE
         SET native_field=$6, transform=$7
       RETURNING *`,
      [randomUUID(), auth.userId, domain_slug, provider_slug, external_field, native_field, transform||null, direction||'inbound']
    );
    res.status(201).json(rows[0]);
  });

  router.delete('/field-maps/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM connector_field_maps WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Default field maps for a provider (system-suggested) ─────────────────────
  router.get('/field-maps/defaults/:domainSlug/:providerSlug', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { domainSlug, providerSlug } = req.params;
    const defaults: Record<string, { external: string; native: string }[]> = {
      'crm:hubspot': [
        { external: 'firstname', native: 'first_name' },
        { external: 'lastname', native: 'last_name' },
        { external: 'email', native: 'email' },
        { external: 'phone', native: 'phone' },
        { external: 'company', native: 'company_name' },
        { external: 'dealname', native: 'title' },
        { external: 'amount', native: 'value' },
        { external: 'closedate', native: 'close_date' },
      ],
      'crm:salesforce': [
        { external: 'FirstName', native: 'first_name' },
        { external: 'LastName', native: 'last_name' },
        { external: 'Email', native: 'email' },
        { external: 'Phone', native: 'phone' },
        { external: 'Company', native: 'company_name' },
        { external: 'Name', native: 'title' },
        { external: 'Amount', native: 'value' },
        { external: 'CloseDate', native: 'close_date' },
      ],
      'email:mailchimp': [
        { external: 'FNAME', native: 'first_name' },
        { external: 'LNAME', native: 'last_name' },
        { external: 'EMAIL', native: 'email' },
        { external: 'PHONE', native: 'phone' },
      ],
    };
    const key = `${domainSlug}:${providerSlug}`;
    res.json(defaults[key] || []);
  });

  return router;
}
