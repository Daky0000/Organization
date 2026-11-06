import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';

type AuthResult = { userId: string; email?: string } | null;
type RequireAuthFn = (req: Request, res: Response) => AuthResult;
type DbQueryFn = <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
type CreateNotificationFn = (
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, any>,
  pinned?: boolean,
) => Promise<void>;

type NotificationDeps = {
  pool: Pool | null;
  requireAuth: RequireAuthFn;
  dbQuery: DbQueryFn;
  hasDatabase: () => boolean;
  createNotification: CreateNotificationFn;
};

type NotificationRouters = {
  /** Mount at /api/v1/notifications (and /api/notifications for compat) */
  notifRouter: Router;
  /** Mount at /api/v1/invitations (and /api/invitations for compat) */
  inviteRouter: Router;
};

/**
 * Registers notification and invitation routes, returning two Express Routers.
 * Caller mounts each at canonical + compat paths:
 *   app.use('/api/v1/notifications', notifRouter);
 *   app.use('/api/notifications',    deprecate(), notifRouter);
 *   app.use('/api/v1/invitations',   inviteRouter);
 *   app.use('/api/invitations',      deprecate(), inviteRouter);
 */
export function registerNotificationRoutes({
  pool,
  requireAuth,
  dbQuery,
  hasDatabase,
  createNotification,
}: NotificationDeps): NotificationRouters {
  const notifRouter = express.Router();
  const inviteRouter = express.Router();

  // POST / — create an in-app notification
  notifRouter.post('/', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { type = 'marketing_alert', title, message, data } = req.body as {
      type?: string;
      title: string;
      message?: string;
      data?: Record<string, unknown>;
    };
    if (!title) return res.status(400).json({ success: false, error: 'title required' });
    try {
      await createNotification(auth.userId, type, title, message || '', data || {});
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET / — list recent notifications with unread count
  notifRouter.get('/', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!pool) return res.json({ success: true, notifications: [], unreadCount: 0 });
    try {
      const { rows } = await dbQuery(
        `SELECT id, type, title, message, data, is_read, pinned, created_at
         FROM notifications WHERE user_id = $1
         ORDER BY pinned DESC, created_at DESC LIMIT 50`,
        [auth.userId],
      );
      const unreadCount = (rows as any[]).filter((n: any) => !n.is_read).length;
      return res.json({ success: true, notifications: rows, unreadCount });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /read-all — mark all as read
  notifRouter.patch('/read-all', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await dbQuery(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [auth.userId]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /:id/read — mark one as read
  notifRouter.patch('/:id/read', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await dbQuery(
        `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.userId],
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /:id — dismiss one
  notifRouter.delete('/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await dbQuery(
        `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.userId],
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE / — clear all non-pinned
  notifRouter.delete('/', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await dbQuery(
        `DELETE FROM notifications WHERE user_id = $1 AND pinned = false`,
        [auth.userId],
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /:token/decline — decline an invitation
  inviteRouter.post('/:token/decline', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { token } = req.params;
    try {
      const { rows } = await dbQuery(
        `SELECT oi.*, o.name AS org_name FROM organization_invitations oi
         JOIN organizations o ON o.id = oi.org_id WHERE oi.token = $1`,
        [token],
      );
      if (!(rows as any[]).length) return res.status(404).json({ success: false, error: 'Invitation not found' });
      const inv = (rows as any[])[0];
      if (inv.accepted_at) return res.status(409).json({ success: false, error: 'Invitation already accepted' });
      await dbQuery(`DELETE FROM organization_invitations WHERE token = $1`, [token]);
      await dbQuery(
        `DELETE FROM notifications WHERE user_id = $1 AND type = 'team_invite' AND data->>'token' = $2`,
        [auth.userId, token],
      );
      const { rows: declinerRows } = await dbQuery(
        `SELECT full_name, email FROM users WHERE id = $1`,
        [auth.userId],
      );
      const decliner = (declinerRows as any[])[0];
      const declinerName = decliner?.full_name || decliner?.email || 'Someone';
      createNotification(
        inv.invited_by_user_id,
        'invite_declined',
        `${declinerName} declined your invitation`,
        `${declinerName} declined the invitation to join ${inv.org_name}. You can invite them again any time.`,
        { orgId: inv.org_id },
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return { notifRouter, inviteRouter };
}
