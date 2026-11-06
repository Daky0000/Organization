import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

export interface DbDesign {
  id: string;
  user_id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  canvas_data: object;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface UserDesignDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>;
  syncUserDesignMedia: (userId: string, design: DbDesign) => Promise<number>;
  checkTaskActions: (userId: string, actionType: string) => Promise<unknown[]>;
}

const inMemoryDesigns = new Map<string, DbDesign>();

export function registerUserDesignRoutes({ requireAuth, hasDatabase, dbQuery, syncUserDesignMedia, checkTaskActions }: UserDesignDeps): Router {
  const router = express.Router();

  // GET /api/designs
  router.get('/designs', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      if (hasDatabase()) {
        const result = await dbQuery('SELECT * FROM user_designs WHERE user_id = $1 ORDER BY updated_at DESC', [auth.userId]);
        return res.json({ success: true, designs: result.rows });
      } else {
        const designs = Array.from(inMemoryDesigns.values())
          .filter((d) => d.user_id === auth.userId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return res.json({ success: true, designs });
      }
    } catch (error) {
      logger.error('Get designs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch designs' });
    }
  });

  // GET /api/designs/:id
  router.get('/designs/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { id } = req.params;

      if (hasDatabase()) {
        const result = await dbQuery('SELECT * FROM user_designs WHERE id = $1 AND user_id = $2', [id, auth.userId]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Design not found' });
        return res.json({ success: true, design: result.rows[0] });
      } else {
        const design = inMemoryDesigns.get(id);
        if (!design || design.user_id !== auth.userId) return res.status(404).json({ success: false, error: 'Design not found' });
        return res.json({ success: true, design });
      }
    } catch (error) {
      logger.error('Get design error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch design' });
    }
  });

  // POST /api/designs
  router.post('/designs', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { name, canvas_width, canvas_height, canvas_data, thumbnail_url } = req.body;
      const id = randomUUID();
      const now = new Date().toISOString();

      const design: DbDesign = {
        id,
        user_id: auth.userId,
        name: name || 'Untitled Design',
        canvas_width: canvas_width || 1080,
        canvas_height: canvas_height || 1080,
        canvas_data: canvas_data || {},
        thumbnail_url: thumbnail_url || null,
        created_at: now,
        updated_at: now,
      };

      if (hasDatabase()) {
        await dbQuery(
          `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [id, auth.userId, design.name, design.canvas_width, design.canvas_height, JSON.stringify(design.canvas_data), design.thumbnail_url, now],
        );
      } else {
        inMemoryDesigns.set(id, design);
      }

      await syncUserDesignMedia(auth.userId, design).catch((error) => {
        logger.error('Design media sync error:', error);
      });

      void checkTaskActions(auth.userId, 'create_card');

      return res.status(201).json({ success: true, design });
    } catch (error) {
      logger.error('Create design error:', error);
      return res.status(500).json({ success: false, error: 'Failed to create design' });
    }
  });

  // PUT /api/designs/:id
  router.put('/designs/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { id } = req.params;
      const { name, canvas_width, canvas_height, canvas_data, thumbnail_url } = req.body;
      const now = new Date().toISOString();

      if (hasDatabase()) {
        const result = await dbQuery(
          `UPDATE user_designs
           SET name = COALESCE($1, name),
               canvas_width = COALESCE($2, canvas_width),
               canvas_height = COALESCE($3, canvas_height),
               canvas_data = COALESCE($4, canvas_data),
               thumbnail_url = COALESCE($5, thumbnail_url),
               updated_at = $6
           WHERE id = $7 AND user_id = $8
           RETURNING *`,
          [name, canvas_width, canvas_height, canvas_data ? JSON.stringify(canvas_data) : null, thumbnail_url, now, id, auth.userId],
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Design not found' });
        await syncUserDesignMedia(auth.userId, result.rows[0] as DbDesign).catch((error) => {
          logger.error('Design media sync error:', error);
        });
        return res.json({ success: true, design: result.rows[0] });
      } else {
        const design = inMemoryDesigns.get(id);
        if (!design || design.user_id !== auth.userId) return res.status(404).json({ success: false, error: 'Design not found' });
        const updated: DbDesign = {
          ...design,
          ...(name !== undefined && { name }),
          ...(canvas_width !== undefined && { canvas_width }),
          ...(canvas_height !== undefined && { canvas_height }),
          ...(canvas_data !== undefined && { canvas_data }),
          ...(thumbnail_url !== undefined && { thumbnail_url }),
          updated_at: now,
        };
        inMemoryDesigns.set(id, updated);
        await syncUserDesignMedia(auth.userId, updated).catch((error) => {
          logger.error('Design media sync error:', error);
        });
        return res.json({ success: true, design: updated });
      }
    } catch (error) {
      logger.error('Update design error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update design' });
    }
  });

  // DELETE /api/designs — clear the user's entire history
  router.delete('/designs', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (hasDatabase()) {
        const result = await dbQuery('DELETE FROM user_designs WHERE user_id = $1', [auth.userId]);
        return res.json({ success: true, deleted: result.rowCount ?? 0 });
      }
      let deleted = 0;
      for (const [id, design] of inMemoryDesigns) {
        if (design.user_id === auth.userId) { inMemoryDesigns.delete(id); deleted++; }
      }
      return res.json({ success: true, deleted });
    } catch (error) {
      logger.error('Clear designs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to clear history' });
    }
  });

  // DELETE /api/designs/:id
  router.delete('/designs/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { id } = req.params;

      if (hasDatabase()) {
        await dbQuery('DELETE FROM user_designs WHERE id = $1 AND user_id = $2', [id, auth.userId]);
      } else {
        const design = inMemoryDesigns.get(id);
        if (design && design.user_id === auth.userId) inMemoryDesigns.delete(id);
      }
      return res.json({ success: true });
    } catch (error) {
      logger.error('Delete design error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete design' });
    }
  });

  return router;
}
