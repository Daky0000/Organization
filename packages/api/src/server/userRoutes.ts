import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';

// ─── Local types ──────────────────────────────────────────────────────────────

type AdminDbRole = 'admin' | 'user';
type AdminDbStatus = 'active' | 'suspended' | 'pending' | 'banned';

type DbUserRow = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  website: string | null;
  phone: string | null;
  country: string | null;
  role: string;
  status: string;
  avatar_url: string | null;
  cover_url: string | null;
  last_login_at: string | null;
  password_hash: string;
  token_version: number;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  created_at: string;
};

// ─── Local pure helpers ────────────────────────────────────────────────────────

function titleRole(role: string) {
  const map: Record<string, string> = { admin: 'Admin', user: 'User' };
  return map[String(role || '').toLowerCase()] || 'User';
}

function titleStatus(status: string) {
  const map: Record<string, string> = { active: 'Active', suspended: 'Suspended', pending: 'Pending', banned: 'Banned' };
  return map[String(status || '').toLowerCase()] || 'Active';
}

function parseAdminRole(role: string | undefined): AdminDbRole {
  return role === 'admin' ? 'admin' : 'user';
}

function parseAdminStatus(status: string | undefined): AdminDbStatus {
  const valid: AdminDbStatus[] = ['active', 'suspended', 'pending', 'banned'];
  const normalized = String(status || '').toLowerCase() as AdminDbStatus;
  return valid.includes(normalized) ? normalized : 'active';
}

function userToManagedUser(user: DbUserRow) {
  return {
    id: user.id,
    name: user.full_name || user.username || user.email.split('@')[0],
    email: user.email,
    username: user.username || '',
    role: titleRole(user.role),
    status: titleStatus(user.status),
    avatar: user.avatar_url || `https://ui-avatars.com/api/?background=eff6ff&color=1d4ed8&name=${encodeURIComponent(user.full_name || user.username || user.email)}`,
    dateJoined: user.created_at ? new Date(user.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    lastLogin: user.last_login_at ? new Date(user.last_login_at).toISOString().slice(0, 16).replace('T', ' ') : 'Never',
    recentActions: ['User record synced from database'],
  };
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface UserRouteDeps {
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string; id: string; role: string } | null>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getUserById: (id: string) => Promise<DbUserRow | undefined>;
  findUserByEmail: (email: string) => Promise<DbUserRow | undefined>;
  findUserByUsername: (username: string) => Promise<DbUserRow | undefined>;
  createUser: (name: string, username: string, email: string, password: string, opts?: any) => Promise<DbUserRow>;
  normalizeEmail: (value: string) => string;
  normalizeUsername: (value: string) => string;
  inMemoryUsersById: Map<string, DbUserRow>;
  inMemoryUserIdByEmail: Map<string, string>;
  inMemoryUserIdByUsername: Map<string, string>;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerUserRoutes(deps: UserRouteDeps): Router {
  const {
    requireAdmin, hasDatabase, dbQuery,
    getUserById, findUserByEmail, findUserByUsername, createUser,
    normalizeEmail, normalizeUsername,
    inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,
  } = deps;

  const router = Router();

  router.get('/users', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const search = String(req.query.search || '').trim().toLowerCase();
      const role = String(req.query.role || 'All');
      const status = String(req.query.status || 'All');
      const joined = String(req.query.joined || 'all');
      const page = Math.max(1, Number(req.query.page || 1));
      const perPage = Math.max(1, Number(req.query.perPage || 25));

      const users = hasDatabase()
        ? (await dbQuery<DbUserRow>('SELECT * FROM users ORDER BY created_at DESC')).rows
        : Array.from(inMemoryUsersById.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

      const now = Date.now();
      const filtered = users.filter((user) => {
        const matchesSearch =
          !search ||
          [user.id, user.email, user.username || '', user.full_name || ''].some((v) => v.toLowerCase().includes(search));
        const matchesRole = role === 'All' || titleRole(user.role) === role;
        const matchesStatus = status === 'All' || titleStatus(user.status) === status;
        const joinedMs = new Date(user.created_at).getTime();
        const diffDays = Math.floor((now - joinedMs) / (1000 * 60 * 60 * 24));
        const matchesJoined =
          joined === 'all' ||
          (joined === '7days' && diffDays <= 7) ||
          (joined === '30days' && diffDays <= 30) ||
          (joined === '1year' && diffDays <= 365);
        return matchesSearch && matchesRole && matchesStatus && matchesJoined;
      });

      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage).map(userToManagedUser);
      return res.json({ items, total: filtered.length, page, perPage });
    } catch (error) {
      logger.error('List users error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
  });

  router.post('/users', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const { name, email, username, password, role, status } = req.body;
      if (!name || !email || !username || !password) {
        return res.status(400).json({ success: false, error: 'Name, email, username, and password are required' });
      }

      const existingEmail = await findUserByEmail(String(email));
      if (existingEmail) return res.status(400).json({ success: false, error: 'Email is already in use' });
      const existingUsername = await findUserByUsername(String(username));
      if (existingUsername) return res.status(400).json({ success: false, error: 'Username is already in use' });

      const created = await createUser(String(name), String(username), String(email), String(password), {
        role: parseAdminRole(role),
        status: parseAdminStatus(status),
      });
      return res.status(201).json(userToManagedUser(created));
    } catch (error) {
      logger.error('Create user error:', error);
      const message = error instanceof Error ? error.message : 'Failed to create user';
      return res.status(500).json({ success: false, error: message });
    }
  });

  router.put('/users/:id', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const { id } = req.params;
      const existing = await getUserById(id);
      if (!existing) return res.status(404).json({ success: false, error: 'User not found' });

      const normEmail = normalizeEmail(String(req.body.email || existing.email));
      const normUsername = normalizeUsername(String(req.body.username || existing.username || ''));
      const dupEmail = await findUserByEmail(normEmail);
      if (dupEmail && dupEmail.id !== id) return res.status(400).json({ success: false, error: 'Email is already in use' });
      const dupUsername = await findUserByUsername(normUsername);
      if (dupUsername && dupUsername.id !== id) return res.status(400).json({ success: false, error: 'Username is already in use' });

      const nextRole = parseAdminRole(req.body.role);
      const nextStatus = parseAdminStatus(req.body.status);
      const nextAvatar = typeof req.body.avatar === 'string' ? req.body.avatar.trim() : existing.avatar_url;
      const nextName = String(req.body.name || existing.full_name || '').trim();

      let updated: DbUserRow | undefined;
      if (!hasDatabase()) {
        const nextUser: DbUserRow = {
          ...existing,
          full_name: nextName || null,
          email: normEmail,
          username: normUsername || null,
          role: nextRole,
          status: nextStatus,
          avatar_url: nextAvatar || null,
        };
        inMemoryUsersById.set(id, nextUser);
        inMemoryUserIdByEmail.set(normEmail, id);
        if (normUsername) inMemoryUserIdByUsername.set(normUsername, id);
        updated = nextUser;
      } else {
        updated = (await dbQuery<DbUserRow>(
          `UPDATE users SET full_name = $1, email = $2, username = $3, role = $4, status = $5, avatar_url = $6
           WHERE id = $7 RETURNING *`,
          [nextName || null, normEmail, normUsername || null, nextRole, nextStatus, nextAvatar || null, id],
        )).rows[0];
      }
      return res.json(userToManagedUser(updated!));
    } catch (error) {
      logger.error('Update user error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update user' });
    }
  });

  router.delete('/users/:id', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      const { id } = req.params;
      if ((admin as any).id === id) {
        return res.status(400).json({ success: false, error: 'Admin cannot delete the active admin account' });
      }
      if (!hasDatabase()) {
        const existing = inMemoryUsersById.get(id);
        if (existing?.username) inMemoryUserIdByUsername.delete(normalizeUsername(existing.username));
        if (existing) inMemoryUserIdByEmail.delete(normalizeEmail(existing.email));
        inMemoryUsersById.delete(id);
      } else {
        await dbQuery('DELETE FROM users WHERE id = $1', [id]);
      }
      void recordAuditLog((admin as any).id, 'admin_user_deleted', [], { targetUserId: id });
      void recordAuditLog((admin as any).id, 'admin_user_deleted', [], { targetUserId: id });
      return res.json({ success: true });
    } catch (error) {
      logger.error('Delete user error:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
  });

  router.patch('/users/:id/status', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { id } = req.params;
      const nextStatus = parseAdminStatus(req.body.status);
      if (!hasDatabase()) {
        const existing = inMemoryUsersById.get(id);
        if (!existing) return res.status(404).json({ success: false, error: 'User not found' });
        inMemoryUsersById.set(id, { ...existing, status: nextStatus });
      } else {
        await dbQuery('UPDATE users SET status = $1 WHERE id = $2', [nextStatus, id]);
      }
      void recordAuditLog((admin as any).id, 'admin_user_status_changed', [], { targetUserId: id, status: nextStatus });
      void recordAuditLog((admin as any).id, 'admin_user_status_changed', [], { targetUserId: id, status: nextStatus });
      return res.json({ success: true });
    } catch (error) {
      logger.error('Patch user status error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update status' });
    }
  });

  router.patch('/users/:id/role', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { id } = req.params;
      const nextRole = parseAdminRole(req.body.role);
      if (!hasDatabase()) {
        const existing = inMemoryUsersById.get(id);
        if (!existing) return res.status(404).json({ success: false, error: 'User not found' });
        inMemoryUsersById.set(id, { ...existing, role: nextRole });
      } else {
        await dbQuery('UPDATE users SET role = $1 WHERE id = $2', [nextRole, id]);
      }
      void recordAuditLog((admin as any).id, 'admin_user_role_changed', [], { targetUserId: id, role: nextRole });
      void recordAuditLog((admin as any).id, 'admin_user_role_changed', [], { targetUserId: id, role: nextRole });
      return res.json({ success: true });
    } catch (error) {
      logger.error('Patch user role error:', error);
      return res.status(500).json({ success: false, error: 'Failed to update role' });
    }
  });

  return router;
}
