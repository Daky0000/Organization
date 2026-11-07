// Company context API — mounted at /api/company-context. Owner-scoped.

import express from 'express';
import type { Response, Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';
import {
  CONTEXT_KINDS,
  createContextItem,
  deleteContextItem,
  listContextItems,
  seedAfriconContext,
  updateContextItem,
} from './companyContext.ts';

interface Deps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullish();
const list = z.array(z.string().max(120)).max(60).optional();

const dataSchema = z.object({
  start_date: day, end_date: day, booking_deadline: day,
  time: z.string().max(120).nullish(),
  venue: z.string().max(300).nullish(),
  format: z.string().max(120).nullish(),
  price: z.string().max(120).nullish(),
  early_bird: z.string().max(160).nullish(),
  capacity: z.number().int().min(0).max(100000).nullish(),
  url: z.string().max(500).nullish(),
  target_roles: list,
  target_industries: list,
  keywords: list,
}).passthrough();

const itemSchema = z.object({
  kind: z.enum(CONTEXT_KINDS),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(1000).nullish(),
  body: z.string().max(20000).nullish(),
  data: dataSchema.optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  position: z.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
});

export function registerCompanyContextRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();
  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });

  router.get('/', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      // An admin who never had the Africon defaults gets them on first open.
      const { rows } = await pool.query(
        `SELECT role, EXISTS (SELECT 1 FROM company_context_seeds WHERE user_id=$1 AND seed='africon') AS seeded FROM users WHERE id=$1`,
        [auth.userId],
      );
      if (rows[0]?.role === 'admin' && !rows[0]?.seeded) await seedAfriconContext(pool, auth.userId);
      res.json({ success: true, items: await listContextItems(pool, auth.userId) });
    } catch (err) {
      logger.error({ err }, 'company_context_list_failed');
      fail(res, 500, 'Failed to load company context');
    }
  });

  router.post('/', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const parsed = itemSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid item');
    try {
      res.json({ success: true, item: await createContextItem(pool, auth.userId, parsed.data as any) });
    } catch (err) {
      logger.error({ err }, 'company_context_create_failed');
      fail(res, 500, 'Failed to save');
    }
  });

  router.patch('/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const parsed = itemSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid item');
    try {
      const item = await updateContextItem(pool, auth.userId, req.params.id, parsed.data as any);
      if (!item) return fail(res, 404, 'Not found');
      res.json({ success: true, item });
    } catch (err) {
      logger.error({ err }, 'company_context_update_failed');
      fail(res, 500, 'Failed to save');
    }
  });

  router.delete('/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      if (!(await deleteContextItem(pool, auth.userId, req.params.id))) return fail(res, 404, 'Not found');
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'company_context_delete_failed');
      fail(res, 500, 'Failed to delete');
    }
  });

  /** Re-adds any Africon default the user deleted. Never overwrites edits. */
  router.post('/restore-defaults', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const added = await seedAfriconContext(pool, auth.userId);
      res.json({ success: true, added, items: await listContextItems(pool, auth.userId) });
    } catch (err) {
      logger.error({ err }, 'company_context_restore_failed');
      fail(res, 500, 'Failed to restore defaults');
    }
  });

  return router;
}
