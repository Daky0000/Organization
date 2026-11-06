// ---------------------------------------------------------------------------
// Marketing → Lead Generation.
//
// Mounts the vendored leads module (src/server/leads) and supplies the host
// side of its configuration. Everything the module deliberately doesn't know —
// who is logged in, what a customer is, how to read a remote drive — arrives
// through configureLeads rather than being imported by it.
//
// Mounted at /api/leadgen, not /api/leads: that path already belongs to the
// Contacts feature's lead groups (server/leadsRoutes.ts), which is a different
// thing with a live UI.
// ---------------------------------------------------------------------------

import express from 'express';
import type { Response, Router } from 'express';
import type { Request } from '../types/http.ts';
import { configureLeads } from './leads/index.ts';
import { importsRouter } from './leads/routes/imports.ts';
import { leadsRouter } from './leads/routes/leads.ts';
import { currentLeadsActor, leadsPrisma, withLeadsTenant } from './leads-tenancy.ts';
import { logger } from '../logger.ts';

type LeadgenDeps = {
  requireAuth: (req: Request, res: Response) => { userId: string; email?: string } | null;
};

let configured = false;

export function registerLeadgenRoutes({ requireAuth }: LeadgenDeps): Router {
  const router = express.Router();

  const prisma = leadsPrisma();
  if (prisma && !configured) {
    configureLeads({
      prisma,

      // The byline on a logged call or email. The module asks per-request; the
      // tenant context already holds who it is, so `req` goes unused.
      resolveActor: () => {
        const actor = currentLeadsActor();
        return actor ? { id: actor.userId, name: actor.email } : undefined;
      },

      // Branding for the generated .xlsx and .pdf.
      export: {
        brandName: 'ContentFlow',
        ink: '#0f172a',
        accent: '#5b6cf9',
        muted: '#64748b',
        hairline: '#e2e8f0',
      },
    });
    configured = true;
    logger.info('[leadgen] leads module configured');
  }

  // Every route below is authenticated and runs inside a tenant context, so the
  // module's unscoped queries only ever see the caller's own rows.
  router.use(withLeadsTenant(requireAuth));

  // Imports first: the leads router's `GET /:id` would otherwise swallow
  // /imports as a lead id.
  router.use('/imports', importsRouter);
  router.use('/leads', leadsRouter);

  // The module's routes hand errors to `next`. Without a handler here they
  // reach the app-level one, which reports a generic 500 — fine for a bug, but
  // it loses zod's message on a bad request body.
  router.use((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const name = (err as { name?: string })?.name;
    if (name === 'ZodError') {
      res.status(400).json({ error: 'That request was not valid.', details: (err as { issues?: unknown }).issues });
      return;
    }
    logger.error({ err }, '[leadgen] request failed');
    res.status(500).json({ error: 'Lead generation hit an unexpected error.' });
  });

  return router;
}
