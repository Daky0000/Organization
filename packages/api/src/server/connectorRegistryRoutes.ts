import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

export function registerConnectorRegistryRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── List all domains ──────────────────────────────────────────────────────────
  router.get('/domains', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: domains } = await pool.query(
      `SELECT d.*,
        (SELECT COUNT(*) FROM connector_provider_catalog p WHERE p.domain_slug=d.slug AND p.available=true) AS provider_count
       FROM connector_domains d ORDER BY d.position`
    );
    res.json(domains);
  });

  // ── Get providers for a domain (with user availability check) ─────────────────
  router.get('/domains/:slug/providers', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: providers } = await pool.query(
      `SELECT p.*,
        CASE
          WHEN p.is_native THEN true
          WHEN p.requires_integration_slug IS NULL THEN true
          ELSE EXISTS(
            SELECT 1 FROM user_integrations ui
            JOIN integrations i ON i.id=ui.integration_id
            WHERE ui.user_id=$1 AND i.slug=p.requires_integration_slug AND ui.status='connected'
          )
        END AS user_has_access,
        (
          SELECT row_to_json(pref.*) FROM connector_user_prefs pref
          WHERE pref.user_id=$1 AND pref.domain_slug=$2 AND pref.provider_slug=p.slug
          LIMIT 1
        ) AS user_config
       FROM connector_provider_catalog p
       WHERE p.domain_slug=$2 AND p.available=true
       ORDER BY p.position`,
      [auth.userId, req.params.slug]
    );
    if (!providers.length) {
      const { rows: [domain] } = await pool.query(`SELECT id FROM connector_domains WHERE slug=$1`, [req.params.slug]);
      if (!domain) return void res.status(404).json({ error: 'Domain not found' });
    }
    res.json(providers);
  });

  // ── Full registry overview: all domains + active provider per domain ───────────
  router.get('/overview', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: domains } = await pool.query(`SELECT * FROM connector_domains ORDER BY position`);
    const { rows: prefs } = await pool.query(
      `SELECT * FROM connector_user_prefs WHERE user_id=$1`, [auth.userId]
    );
    const { rows: connected } = await pool.query(
      `SELECT i.slug AS integration_slug, ui.status, ui.account_name
       FROM user_integrations ui JOIN integrations i ON i.id=ui.integration_id
       WHERE ui.user_id=$1 AND ui.status='connected'`,
      [auth.userId]
    );
    const prefMap = Object.fromEntries(prefs.map((p: any) => [p.domain_slug, p]));
    const connectedSlugs = new Set(connected.map((c: any) => c.integration_slug));

    const result = await Promise.all(domains.map(async (d: any) => {
      const { rows: providers } = await pool.query(
        `SELECT p.slug, p.name, p.is_native, p.requires_integration_slug, p.capabilities, p.position
         FROM connector_provider_catalog p WHERE p.domain_slug=$1 AND p.available=true ORDER BY p.position`,
        [d.slug]
      );
      const activePref = prefMap[d.slug];
      const activeSlug = activePref?.provider_slug || 'native';
      const activeProvider = providers.find((p: any) => p.slug === activeSlug) || providers.find((p: any) => p.is_native);
      const availableProviders = providers.map((p: any) => ({
        ...p,
        user_has_access: p.is_native || !p.requires_integration_slug || connectedSlugs.has(p.requires_integration_slug),
      }));
      return {
        ...d,
        active_provider: activeProvider || null,
        active_provider_slug: activeSlug,
        providers: availableProviders,
        connected_count: availableProviders.filter((p: any) => p.user_has_access && !p.is_native).length,
      };
    }));

    res.json(result);
  });

  // ── Check if a specific capability is available for user ───────────────────────
  router.get('/capability/:capability', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const cap = req.params.capability;
    const { rows } = await pool.query(
      `SELECT p.slug AS provider_slug, p.name AS provider_name, p.domain_slug,
        p.is_native, p.requires_integration_slug,
        CASE
          WHEN p.is_native THEN true
          WHEN p.requires_integration_slug IS NULL THEN true
          ELSE EXISTS(
            SELECT 1 FROM user_integrations ui
            JOIN integrations i ON i.id=ui.integration_id
            WHERE ui.user_id=$1 AND i.slug=p.requires_integration_slug AND ui.status='connected'
          )
        END AS available
       FROM connector_provider_catalog p
       WHERE p.capabilities @> $2::jsonb AND p.available=true`,
      [auth.userId, JSON.stringify([cap])]
    );
    res.json({ capability: cap, providers: rows });
  });

  return router;
}
