import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

type PagesDeps = {
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool;
};

export function registerPagesRoutes({ requireAdmin, hasDatabase, pool }: PagesDeps): Router {
  const router = express.Router();

  // GET /api/pages/:slug
  router.get('/:slug', async (req: Request, res: Response) => {
    const { slug } = req.params;
    if (!hasDatabase()) return res.json({ success: true, content: null });
    try {
      const { rows } = await pool.query('SELECT content FROM page_content WHERE slug = $1', [slug]);
      return res.json({ success: true, content: rows[0]?.content ?? null });
    } catch (err) {
      logger.error('page_content GET error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch page content' });
    }
  });

  // PUT /api/pages/:slug
  router.put('/:slug', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { slug } = req.params;
    const { content } = req.body as { content: unknown };
    if (!content || typeof content !== 'object') return res.status(400).json({ success: false, error: 'content must be an object' });
    if (!hasDatabase()) return res.json({ success: true });
    try {
      await pool.query(
        `INSERT INTO page_content (slug, content, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
        [slug, JSON.stringify(content)]
      );
      return res.json({ success: true });
    } catch (err) {
      logger.error('page_content PUT error:', err);
      return res.status(500).json({ success: false, error: 'Failed to save page content' });
    }
  });

  return router;
}
