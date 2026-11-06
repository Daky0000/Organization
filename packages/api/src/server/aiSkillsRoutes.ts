import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AISkillsDeps {
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
}

export function registerAISkillsRoutes({ requireAdmin, hasDatabase, dbQuery }: AISkillsDeps): Router {
  const router = express.Router();

  // GET /api/admin/ai-skills
  router.get('/ai-skills', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!hasDatabase()) return res.json({ success: true, skills: [] });
      const { rows } = await dbQuery(
        `SELECT id, name, description, system_prompt, scope, enabled, sort_order, created_at, updated_at
         FROM ai_skills ORDER BY sort_order ASC, created_at ASC`,
        []
      );
      return res.json({ success: true, skills: rows });
    } catch (err) {
      logger.error('ai-skills GET error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch skills' });
    }
  });

  // POST /api/admin/ai-skills
  router.post('/ai-skills', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
      const { name, description, system_prompt, scope, enabled, sort_order } = req.body as {
        name: string; description?: string; system_prompt: string; scope?: string; enabled?: boolean; sort_order?: number;
      };
      if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' });
      if (!system_prompt?.trim()) return res.status(400).json({ success: false, error: 'system_prompt is required' });
      const id = randomUUID();
      const { rows } = await dbQuery(
        `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, description, system_prompt, scope, enabled, sort_order, created_at, updated_at`,
        [id, name.trim(), (description || '').trim(), system_prompt.trim(),
         (scope || 'all').trim(), enabled !== false, Number(sort_order) || 0]
      );
      return res.status(201).json({ success: true, skill: rows[0] });
    } catch (err) {
      logger.error('ai-skills POST error:', err);
      return res.status(500).json({ success: false, error: 'Failed to create skill' });
    }
  });

  // PUT /api/admin/ai-skills/:id
  router.put('/ai-skills/:id', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
      const { id } = req.params;
      const { name, description, system_prompt, scope, enabled, sort_order } = req.body as {
        name?: string; description?: string; system_prompt?: string; scope?: string; enabled?: boolean; sort_order?: number;
      };
      const existing = await dbQuery('SELECT id FROM ai_skills WHERE id=$1', [id]);
      if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Skill not found' });
      const { rows } = await dbQuery(
        `UPDATE ai_skills SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           system_prompt = COALESCE($4, system_prompt),
           scope = COALESCE($5, scope),
           enabled = COALESCE($6, enabled),
           sort_order = COALESCE($7, sort_order),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, description, system_prompt, scope, enabled, sort_order, created_at, updated_at`,
        [id,
         name !== undefined ? name.trim() : null,
         description !== undefined ? description.trim() : null,
         system_prompt !== undefined ? system_prompt.trim() : null,
         scope !== undefined ? scope.trim() : null,
         enabled !== undefined ? enabled : null,
         sort_order !== undefined ? Number(sort_order) : null]
      );
      return res.json({ success: true, skill: rows[0] });
    } catch (err) {
      logger.error('ai-skills PUT error:', err);
      return res.status(500).json({ success: false, error: 'Failed to update skill' });
    }
  });

  // DELETE /api/admin/ai-skills/:id
  router.delete('/ai-skills/:id', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
      const { id } = req.params;
      const result = await dbQuery('DELETE FROM ai_skills WHERE id=$1', [id]);
      if (!result.rowCount) return res.status(404).json({ success: false, error: 'Skill not found' });
      return res.json({ success: true });
    } catch (err) {
      logger.error('ai-skills DELETE error:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete skill' });
    }
  });

  return router;
}
