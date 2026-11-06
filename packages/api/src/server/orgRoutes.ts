import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID, randomBytes } from 'crypto';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;
type OrgMemberResult = { userId: string; role: string } | null;

interface OrgDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  requireOrgMembership: (req: Request, res: Response, orgId: string, minRole?: 'viewer' | 'editor' | 'admin' | 'owner') => Promise<OrgMemberResult>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<Array<{ task_id: string; title: string; new_status: string; progress: string }>>;
  logTaskActivity: (projectId: string, userId: string, action: string, taskId?: string, metadata?: Record<string, unknown>) => Promise<void>;
}

export function registerOrgRoutes(deps: OrgDeps): Router {
  const router = express.Router();
  const { requireAuth, hasDatabase, dbQuery, requireOrgMembership, createNotification, checkTaskActions, logTaskActivity } = deps;

  // ── Local helpers ────────────────────────────────────────────────────────────

  async function requireProjectAccess(
    req: Request, res: Response, projectId: string, minRole: 'viewer' | 'editor' = 'viewer'
  ): Promise<{ userId: string; orgRole: string } | null> {
    const auth = requireAuth(req, res);
    if (!auth) return null;
    if (!hasDatabase()) { res.status(503).json({ error: 'Database unavailable' }); return null; }
    const { rows } = await dbQuery(
      `SELECT om.role FROM projects p
       JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
       WHERE p.id = $2`,
      [auth.userId, projectId]
    );
    if (!rows[0]) { res.status(403).json({ error: 'Not a project member' }); return null; }
    if (minRole === 'editor' && !['owner', 'admin', 'editor'].includes((rows[0] as any).role)) { res.status(403).json({ error: 'Editor access required' }); return null; }
    return { userId: auth.userId, orgRole: (rows[0] as any).role };
  }

  function inferTaskActions(title: string): Array<{ action_type: string; label: string; target_count: number }> {
    const t = title.toLowerCase();
    const results: Array<{ action_type: string; label: string; target_count: number }> = [];
    const numMatch = t.match(/\b(\d+)\b/);
    const n = numMatch ? Math.min(parseInt(numMatch[1], 10), 50) : 1;
    const check = (actionType: string, label: string, verbs: RegExp, nouns: RegExp) => {
      if (verbs.test(t) && nouns.test(t)) results.push({ action_type: actionType, label, target_count: n });
    };
    check('create_post',    'Create a post',              /create|write|draft|make|compose|produce/,    /post|content|article|caption|blog|copy|update|tweet|thread/);
    check('schedule_post',  'Schedule a post',            /schedule|publish|queue|plan/,                /post|content|article|caption|update|tweet/);
    check('publish_post',   'Publish / go live',          /publish|go\slive|launch|release|push\slive/, /post|content|article|update/);
    check('connect_social', 'Connect a social account',   /connect|add|link|integrate|set\sup/,         /social|account|platform|twitter|linkedin|instagram|facebook|tiktok|youtube/);
    check('create_card',    'Create a design card',       /create|design|make|build|produce/,           /card|graphic|visual|banner|image|poster|flyer/);
    check('save_memory',    'Save a memory / brand item', /add|save|update|fill|set/,                   /memory|brand|profile|personal|about|niche|tone/);
    return results;
  }

  // ── Workspace / Organization Routes ─────────────────────────────────────────

  // Guard all nested task operations, including comments, attachments, and subtasks.
  router.use('/tasks/:taskId', async (req,res,next) => {
    const user=requireAuth(req,res); if (!user) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const result=await dbQuery(`SELECT t.project_id,p.org_id,om.role FROM tasks t JOIN projects p ON p.id=t.project_id
      JOIN organization_memberships om ON om.org_id=p.org_id AND om.user_id=$2 WHERE t.id=$1`,[req.params.taskId,user.userId]);
    const access=result.rows[0];
    if (!access || (req.method!=='GET' && !['owner','admin','editor'].includes(access.role))) return res.status(403).json({ error: 'Task access denied' });
    const assignee=req.body?.user_id || req.body?.supervisor_id;
    if (assignee && !(await dbQuery('SELECT user_id FROM organization_memberships WHERE org_id=$1 AND user_id=$2',[access.org_id,assignee])).rows.length) return res.status(403).json({ error: 'The assignee must belong to this organization' });
    const labelId=req.path.match(/^\/labels\/([^/]+)/)?.[1];
    if (labelId && !(await dbQuery('SELECT id FROM task_labels WHERE id=$1 AND project_id=$2',[decodeURIComponent(labelId),access.project_id])).rows.length) return res.status(403).json({ error: 'The label must belong to this project' });
    next();
  });

  // GET /api/workspace/summary
  router.get('/workspace/summary', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, organizations: [] });
    try {
      const { rows: orgs } = await dbQuery(
        `SELECT o.id, o.name, o.slug, o.description, o.logo_url, o.owner_id, o.created_at, o.updated_at, om.role,
          (SELECT COUNT(*)::int FROM organization_memberships WHERE org_id = o.id) AS member_count
         FROM organizations o
         JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1
         ORDER BY o.created_at ASC`,
        [auth.userId]
      );
      res.json({ success: true, organizations: orgs });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load workspace summary' });
    }
  });

  // POST /api/organizations
  router.post('/organizations', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { name, description = '', slug: rawSlug } = req.body as { name: string; description?: string; slug?: string };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    try {
      const orgId = randomUUID();
      const slug = rawSlug?.trim()
        ? rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').substring(0, 60)
        : `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)}-${orgId.substring(0, 6)}`;
      await dbQuery(
        `INSERT INTO organizations (id, name, slug, description, owner_id) VALUES ($1, $2, $3, $4, $5)`,
        [orgId, name.trim(), slug, description.trim(), auth.userId]
      );
      await dbQuery(
        `INSERT INTO organization_memberships (id, org_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
        [randomUUID(), orgId, auth.userId]
      );
      const { rows } = await dbQuery(
        `SELECT o.*, om.role FROM organizations o JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1 WHERE o.id = $2`,
        [auth.userId, orgId]
      );
      res.json({ success: true, organization: rows[0] });
    } catch (e: any) {
      if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Slug already taken' });
      res.status(500).json({ success: false, error: 'Failed to create organization' });
    }
  });

  // GET /api/organizations/:orgId
  router.get('/organizations/:orgId', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId);
    if (!membership) return;
    try {
      const { rows } = await dbQuery(
        `SELECT o.*, om.role, (SELECT COUNT(*)::int FROM organization_memberships WHERE org_id = o.id) AS member_count
         FROM organizations o JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1 WHERE o.id = $2`,
        [membership.userId, orgId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Organization not found' });
      res.json({ success: true, organization: rows[0] });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load organization' });
    }
  });

  // PUT /api/organizations/:orgId
  router.put('/organizations/:orgId', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    const { name, description, slug: rawSlug } = req.body as { name?: string; description?: string; slug?: string };
    try {
      const updates: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (name !== undefined) { updates.push(`name = $${i++}`); vals.push(name.trim()); }
      if (description !== undefined) { updates.push(`description = $${i++}`); vals.push(description.trim()); }
      if (rawSlug !== undefined) {
        const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
        updates.push(`slug = $${i++}`); vals.push(slug);
      }
      if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update' });
      updates.push(`updated_at = NOW()`);
      vals.push(orgId);
      await dbQuery(`UPDATE organizations SET ${updates.join(', ')} WHERE id = $${i}`, vals);
      const { rows } = await dbQuery(
        `SELECT o.*, om.role FROM organizations o JOIN organization_memberships om ON om.org_id = o.id AND om.user_id = $1 WHERE o.id = $2`,
        [membership.userId, orgId]
      );
      res.json({ success: true, organization: rows[0] });
    } catch (e: any) {
      if (e?.code === '23505') return res.status(409).json({ success: false, error: 'Slug already taken' });
      res.status(500).json({ success: false, error: 'Failed to update organization' });
    }
  });

  // DELETE /api/organizations/:orgId
  router.delete('/organizations/:orgId', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'owner');
    if (!membership) return;
    try {
      await dbQuery(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to delete organization' });
    }
  });

  // GET /api/organizations/:orgId/members
  router.get('/organizations/:orgId/members', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId);
    if (!membership) return;
    try {
      const { rows } = await dbQuery(
        `SELECT om.id, om.role, om.created_at,
          u.id AS user_id, u.full_name, u.email, u.username, u.avatar_url
         FROM organization_memberships om
         JOIN users u ON u.id = om.user_id
         WHERE om.org_id = $1
         ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, om.created_at ASC`,
        [orgId]
      );
      res.json({ success: true, members: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load members' });
    }
  });

  // PUT /api/organizations/:orgId/members/:targetUserId
  router.put('/organizations/:orgId/members/:targetUserId', async (req: Request, res: Response) => {
    const { orgId, targetUserId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    const { role } = req.body as { role: string };
    if (!['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role. Allowed: admin, editor, viewer' });
    }
    if (targetUserId === membership.userId) {
      return res.status(400).json({ success: false, error: 'Cannot change your own role' });
    }
    try {
      const { rows: target } = await dbQuery(
        `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, targetUserId]
      );
      if (!target.length) return res.status(404).json({ success: false, error: 'Member not found' });
      if ((target[0] as any).role === 'owner') return res.status(403).json({ success: false, error: 'Cannot change the owner role' });
      await dbQuery(
        `UPDATE organization_memberships SET role = $1 WHERE org_id = $2 AND user_id = $3`,
        [role, orgId, targetUserId]
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to update member role' });
    }
  });

  // DELETE /api/organizations/:orgId/members/:targetUserId
  router.delete('/organizations/:orgId/members/:targetUserId', async (req: Request, res: Response) => {
    const { orgId, targetUserId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    if (targetUserId === membership.userId) {
      return res.status(400).json({ success: false, error: 'Cannot remove yourself' });
    }
    try {
      const { rows: target } = await dbQuery(
        `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, targetUserId]
      );
      if (!target.length) return res.status(404).json({ success: false, error: 'Member not found' });
      if ((target[0] as any).role === 'owner') return res.status(403).json({ success: false, error: 'Cannot remove the owner' });
      await dbQuery(`DELETE FROM organization_memberships WHERE org_id = $1 AND user_id = $2`, [orgId, targetUserId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to remove member' });
    }
  });

  // POST /api/organizations/:orgId/invite
  router.post('/organizations/:orgId/invite', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    const { email, role = 'editor' } = req.body as { email: string; role?: string };
    if (!email?.trim()) return res.status(400).json({ success: false, error: 'Email is required' });
    if (!['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    try {
      const { rows: existing } = await dbQuery(
        `SELECT u.id FROM users u JOIN organization_memberships om ON om.user_id = u.id
         WHERE LOWER(u.email) = LOWER($1) AND om.org_id = $2`,
        [email.trim(), orgId]
      );
      if (existing.length) return res.status(409).json({ success: false, error: 'User is already a member' });
      await dbQuery(
        `DELETE FROM organization_invitations WHERE org_id = $1 AND LOWER(email) = LOWER($2) AND accepted_at IS NULL`,
        [orgId, email.trim()]
      );
      const invId = randomUUID();
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await dbQuery(
        `INSERT INTO organization_invitations (id, org_id, email, role, token, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invId, orgId, email.trim().toLowerCase(), role, token, membership.userId, expiresAt]
      );
      const { rows: orgRows } = await dbQuery(
        `SELECT o.name AS org_name, u.full_name AS inviter_name FROM organizations o, users u WHERE o.id = $1 AND u.id = $2`,
        [orgId, membership.userId]
      );
      const orgName = (orgRows[0] as any)?.org_name ?? 'an organisation';
      const inviterName = (orgRows[0] as any)?.inviter_name ?? 'Someone';
      const { rows: invitedUser } = await dbQuery(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email.trim()]
      );
      if (invitedUser.length) {
        createNotification(
          (invitedUser[0] as any).id,
          'team_invite',
          `You've been invited to ${orgName}`,
          `${inviterName} invited you to join ${orgName} as ${role}.`,
          { token, orgId, role, expiresAt },
          true,
        );
      }
      res.json({ success: true, inviteToken: token, inviteLink: `/invite/${token}` });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to send invitation' });
    }
  });

  // GET /api/organizations/:orgId/invitations
  router.get('/organizations/:orgId/invitations', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    try {
      const { rows } = await dbQuery(
        `SELECT oi.id, oi.email, oi.role, oi.expires_at, oi.created_at, oi.token,
          u.full_name AS invited_by_name
         FROM organization_invitations oi
         JOIN users u ON u.id = oi.invited_by_user_id
         WHERE oi.org_id = $1 AND oi.accepted_at IS NULL AND oi.expires_at > NOW()
         ORDER BY oi.created_at DESC`,
        [orgId]
      );
      res.json({ success: true, invitations: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load invitations' });
    }
  });

  // DELETE /api/organizations/:orgId/invitations/:invId
  router.delete('/organizations/:orgId/invitations/:invId', async (req: Request, res: Response) => {
    const { orgId, invId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    try {
      await dbQuery(`DELETE FROM organization_invitations WHERE id = $1 AND org_id = $2`, [invId, orgId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to cancel invitation' });
    }
  });

  // GET /api/invitations/:token — public
  router.get('/invitations/:token', async (req: Request, res: Response) => {
    const { token } = req.params;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(
        `SELECT oi.id, oi.email, oi.role, oi.expires_at, oi.accepted_at,
          o.name AS org_name, o.id AS org_id, u.full_name AS invited_by_name
         FROM organization_invitations oi
         JOIN organizations o ON o.id = oi.org_id
         JOIN users u ON u.id = oi.invited_by_user_id
         WHERE oi.token = $1`,
        [token]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Invitation not found' });
      const inv = rows[0] as any;
      if (inv.accepted_at) return res.status(409).json({ success: false, error: 'Invitation already accepted' });
      if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ success: false, error: 'Invitation expired' });
      res.json({ success: true, invitation: inv });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load invitation' });
    }
  });

  // POST /api/invitations/:token/accept
  router.post('/invitations/:token/accept', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { token } = req.params;
    try {
      const { rows } = await dbQuery(
        `SELECT oi.*, o.id AS org_id FROM organization_invitations oi JOIN organizations o ON o.id = oi.org_id WHERE oi.token = $1`,
        [token]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Invitation not found' });
      const inv = rows[0] as any;
      if (inv.accepted_at) return res.status(409).json({ success: false, error: 'Invitation already accepted' });
      if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ success: false, error: 'Invitation expired' });
      const { rows: userRows } = await dbQuery(`SELECT email FROM users WHERE id = $1`, [auth.userId]);
      if (!userRows.length) return res.status(401).json({ success: false, error: 'User not found' });
      if ((userRows[0] as any).email.toLowerCase() !== (inv.email as string).toLowerCase()) {
        return res.status(403).json({ success: false, error: `This invitation was sent to ${inv.email}` });
      }
      await dbQuery(
        `INSERT INTO organization_memberships (id, org_id, user_id, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [randomUUID(), inv.org_id, auth.userId, inv.role]
      );
      await dbQuery(`UPDATE organization_invitations SET accepted_at = NOW() WHERE token = $1`, [token]);
      await dbQuery(
        `DELETE FROM notifications WHERE user_id = $1 AND type = 'team_invite' AND data->>'token' = $2`,
        [auth.userId, token]
      );
      const { rows: joinedRows } = await dbQuery(`SELECT full_name, email FROM users WHERE id = $1`, [auth.userId]);
      const { rows: orgNameRows } = await dbQuery(`SELECT name FROM organizations WHERE id = $1`, [inv.org_id]);
      const joinedName = (joinedRows[0] as any)?.full_name || (joinedRows[0] as any)?.email || 'Someone';
      const orgName = (orgNameRows[0] as any)?.name ?? 'your organisation';
      createNotification(
        inv.invited_by_user_id,
        'member_joined',
        `${joinedName} joined ${orgName}`,
        `${joinedName} accepted your invitation and is now a ${inv.role} in ${orgName}.`,
        { userId: auth.userId, orgId: inv.org_id },
      );
      res.json({ success: true, orgId: inv.org_id });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to accept invitation' });
    }
  });

  // GET /api/organizations/:orgId/projects
  router.get('/organizations/:orgId/projects', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId);
    if (!membership) return;
    try {
      const { rows } = await dbQuery(
        `SELECT p.*, u.full_name AS created_by_name
         FROM projects p LEFT JOIN users u ON u.id = p.created_by_user_id
         WHERE p.org_id = $1 ORDER BY p.created_at ASC`,
        [orgId]
      );
      res.json({ success: true, projects: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load projects' });
    }
  });

  // POST /api/organizations/:orgId/projects
  router.post('/organizations/:orgId/projects', async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'editor');
    if (!membership) return;
    const { name, description = '', color = '#5b6cf9' } = req.body as { name: string; description?: string; color?: string };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    try {
      const projId = randomUUID();
      await dbQuery(
        `INSERT INTO projects (id, org_id, name, description, color, created_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [projId, orgId, name.trim(), description.trim(), color, membership.userId]
      );
      const { rows } = await dbQuery(`SELECT * FROM projects WHERE id = $1`, [projId]);
      res.json({ success: true, project: rows[0] });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to create project' });
    }
  });

  // PUT /api/organizations/:orgId/projects/:projectId
  router.put('/organizations/:orgId/projects/:projectId', async (req: Request, res: Response) => {
    const { orgId, projectId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'editor');
    if (!membership) return;
    const { name, description, color } = req.body as { name?: string; description?: string; color?: string };
    try {
      const updates: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (name !== undefined) { updates.push(`name = $${i++}`); vals.push(name.trim()); }
      if (description !== undefined) { updates.push(`description = $${i++}`); vals.push(description.trim()); }
      if (color !== undefined) { updates.push(`color = $${i++}`); vals.push(color); }
      if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update' });
      updates.push(`updated_at = NOW()`);
      vals.push(projectId, orgId);
      await dbQuery(`UPDATE projects SET ${updates.join(', ')} WHERE id = $${i} AND org_id = $${i + 1}`, vals);
      const { rows } = await dbQuery(`SELECT * FROM projects WHERE id = $1`, [projectId]);
      res.json({ success: true, project: rows[0] });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to update project' });
    }
  });

  // DELETE /api/organizations/:orgId/projects/:projectId
  router.delete('/organizations/:orgId/projects/:projectId', async (req: Request, res: Response) => {
    const { orgId, projectId } = req.params;
    const membership = await requireOrgMembership(req, res, orgId, 'admin');
    if (!membership) return;
    try {
      await dbQuery(`DELETE FROM projects WHERE id = $1 AND org_id = $2`, [projectId, orgId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to delete project' });
    }
  });

  // ── Task Management Routes ───────────────────────────────────────────────────

  // GET /api/projects/:projectId/tasks
  router.get('/projects/:projectId/tasks', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    const { status, assignee, q } = req.query as Record<string, string>;
    try {
      let sql = `
        SELECT t.*,
          COALESCE(json_agg(DISTINCT jsonb_build_object('user_id', u.id, 'name', COALESCE(u.full_name, u.username, u.email), 'avatar', u.avatar_url))
            FILTER (WHERE u.id IS NOT NULL), '[]') AS assignees,
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', tl.id, 'name', tl.name, 'color', tl.color))
            FILTER (WHERE tl.id IS NOT NULL), '[]') AS labels,
          (SELECT COUNT(*)::int FROM subtasks s WHERE s.task_id = t.id) AS subtask_count,
          (SELECT COUNT(*)::int FROM subtasks s WHERE s.task_id = t.id AND s.completed) AS subtask_done,
          (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id AND c.parent_id IS NULL) AS comment_count,
          COALESCE(su.full_name, su.username, su.email) AS supervisor_name,
          COALESCE((SELECT json_agg(a ORDER BY a.created_at) FROM task_actions a WHERE a.task_id = t.id), '[]') AS actions
        FROM tasks t
        LEFT JOIN task_assignees ta ON ta.task_id = t.id
        LEFT JOIN users u ON u.id = ta.user_id
        LEFT JOIN task_label_assignments tla ON tla.task_id = t.id
        LEFT JOIN task_labels tl ON tl.id = tla.label_id
        LEFT JOIN users su ON su.id = t.supervisor_id
        WHERE t.project_id = $1`;
      const vals: unknown[] = [projectId];
      let i = 2;
      if (status) { sql += ` AND t.status = $${i++}`; vals.push(status); }
      if (assignee) { sql += ` AND ta.user_id = $${i++}`; vals.push(assignee); }
      if (q) { sql += ` AND t.title ILIKE $${i++}`; vals.push(`%${q}%`); }
      sql += ` GROUP BY t.id, su.full_name, su.username, su.email ORDER BY t.status, t.position, t.created_at`;
      const { rows } = await dbQuery(sql, vals);
      return res.json({ tasks: rows });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load tasks' });
    }
  });

  // POST /api/projects/:projectId/tasks
  router.post('/projects/:projectId/tasks', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    const { title, description = '', status = 'todo', priority = 'medium', due_date, supervisor_id, assignee_ids = [], label_ids = [], actions = [], task_type = 'todo', reminder_at, crm_company_id } =
      req.body as { title: string; description?: string; status?: string; priority?: string; due_date?: string; supervisor_id?: string; assignee_ids?: string[]; label_ids?: string[]; actions?: { action_type: string; label: string; target_count: number }[]; task_type?: string; reminder_at?: string; crm_company_id?: string };
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    try {
      const { rows: pos } = await dbQuery(
        `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status=$2`,
        [projectId, status]
      );
      const { rows } = await dbQuery(
        `INSERT INTO tasks (project_id, title, description, status, priority, position, due_date, supervisor_id, created_by, task_type, reminder_at, crm_company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [projectId, title.trim(), description, status, priority, (pos[0] as any).next, due_date || null, supervisor_id || null, access.userId, task_type || 'todo', reminder_at || null, crm_company_id || null]
      );
      const task = rows[0] as any;
      await Promise.all([
        ...assignee_ids.map((uid) =>
          dbQuery(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [task.id, uid])
        ),
        ...label_ids.map((lid) =>
          dbQuery(`INSERT INTO task_label_assignments (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [task.id, lid])
        ),
      ]);
      const actionsToCreate = actions.length > 0 ? actions : inferTaskActions(task.title);
      let savedActions: Record<string, unknown>[] = [];
      if (actionsToCreate.length) {
        const actRows = await Promise.all(actionsToCreate.map((a) =>
          dbQuery(
            `INSERT INTO task_actions (id, task_id, action_type, label, target_count, current_count) VALUES ($1,$2,$3,$4,$5,0) RETURNING *`,
            [randomUUID(), task.id, a.action_type, a.label, Math.max(1, a.target_count || 1)]
          ).then((r) => r.rows[0])
        ));
        savedActions = actRows as Record<string, unknown>[];
      }
      await logTaskActivity(projectId, access.userId, 'task_created', task.id, { title: task.title });
      return res.json({ task: { ...task, assignees: [], labels: [], subtask_count: 0, subtask_done: 0, comment_count: 0, actions: savedActions } });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // GET /api/projects/:projectId/tasks/:taskId
  router.get('/projects/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    try {
      const { rows } = await dbQuery(
        `SELECT t.*,
          COALESCE(json_agg(DISTINCT jsonb_build_object('user_id', u.id, 'name', COALESCE(u.full_name, u.username, u.email), 'avatar', u.avatar_url))
            FILTER (WHERE u.id IS NOT NULL), '[]') AS assignees,
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', tl.id, 'name', tl.name, 'color', tl.color))
            FILTER (WHERE tl.id IS NOT NULL), '[]') AS labels,
          COALESCE(su.full_name, su.username, su.email) AS supervisor_name, su.avatar_url AS supervisor_avatar
         FROM tasks t
         LEFT JOIN task_assignees ta ON ta.task_id = t.id
         LEFT JOIN users u ON u.id = ta.user_id
         LEFT JOIN task_label_assignments tla ON tla.task_id = t.id
         LEFT JOIN task_labels tl ON tl.id = tla.label_id
         LEFT JOIN users su ON su.id = t.supervisor_id
         WHERE t.id = $1 AND t.project_id = $2
         GROUP BY t.id, su.full_name, su.username, su.email, su.avatar_url`,
        [taskId, projectId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
      const [subtasks, attachments, actionsRes] = await Promise.all([
        dbQuery(`SELECT * FROM subtasks WHERE task_id=$1 ORDER BY position, created_at`, [taskId]),
        dbQuery(`SELECT a.*, COALESCE(u.full_name, u.username) AS uploader_name FROM task_attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.task_id=$1 ORDER BY a.created_at DESC`, [taskId]),
        dbQuery(`SELECT * FROM task_actions WHERE task_id=$1 ORDER BY created_at`, [taskId]),
      ]);
      return res.json({ task: { ...rows[0], subtasks: subtasks.rows, attachments: attachments.rows, actions: actionsRes.rows } });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load task' });
    }
  });

  // PUT /api/projects/:projectId/tasks/:taskId
  router.put('/projects/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    const { title, description, priority, due_date, supervisor_id } =
      req.body as { title?: string; description?: string; priority?: string; due_date?: string | null; supervisor_id?: string | null };
    try {
      const sets: string[] = ['updated_at=NOW()'];
      const vals: unknown[] = [];
      let i = 1;
      if (title !== undefined) { sets.push(`title=$${i++}`); vals.push(title.trim()); }
      if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
      if (priority !== undefined) { sets.push(`priority=$${i++}`); vals.push(priority); }
      if (due_date !== undefined) { sets.push(`due_date=$${i++}`); vals.push(due_date || null); }
      if (supervisor_id !== undefined) { sets.push(`supervisor_id=$${i++}`); vals.push(supervisor_id || null); }
      vals.push(taskId); vals.push(projectId);
      const { rows } = await dbQuery(
        `UPDATE tasks SET ${sets.join(',')} WHERE id=$${i++} AND project_id=$${i} RETURNING *`, vals
      );
      return res.json({ task: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to update task' });
    }
  });

  // PATCH /api/projects/:projectId/tasks/:taskId/status
  router.patch('/projects/:projectId/tasks/:taskId/status', async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    const { status } = req.body as { status: string };
    const validStatuses = ['todo', 'in_progress', 'in_review', 'done'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
      const { rows: task } = await dbQuery(`SELECT status, supervisor_id FROM tasks WHERE id=$1 AND project_id=$2`, [taskId, projectId]);
      if (!task[0]) return res.status(404).json({ error: 'Task not found' });
      const isAdmin = ['owner', 'admin'].includes(access.orgRole);
      const isSupervisor = (task[0] as any).supervisor_id === access.userId;
      if (!isAdmin && !isSupervisor) return res.status(403).json({ error: 'Only admins and supervisors can change task status' });
      const { rows: pos } = await dbQuery(
        `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status=$2`,
        [projectId, status]
      );
      await dbQuery(
        `UPDATE tasks SET status=$1, position=$2, updated_at=NOW() WHERE id=$3 AND project_id=$4`,
        [status, (pos[0] as any).next, taskId, projectId]
      );
      await logTaskActivity(projectId, access.userId, 'status_changed', taskId, { from: (task[0] as any).status, to: status });
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to update status' });
    }
  });

  // PATCH /api/projects/:projectId/tasks/reorder
  router.patch('/projects/:projectId/tasks/reorder', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    const isAdmin = ['owner', 'admin'].includes(access.orgRole);
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can reorder tasks' });
    const { updates } = req.body as { updates: { id: string; status: string; position: number }[] };
    try {
      await Promise.all(updates.map(({ id, status, position }) =>
        dbQuery(`UPDATE tasks SET status=$1, position=$2, updated_at=NOW() WHERE id=$3 AND project_id=$4`, [status, position, id, projectId])
      ));
      return res.json({ success: true });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to reorder tasks' });
    }
  });

  // DELETE /api/projects/:projectId/tasks/:taskId
  router.delete('/projects/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const { projectId, taskId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    const isAdmin = ['owner', 'admin'].includes(access.orgRole);
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can delete tasks' });
    await dbQuery(`DELETE FROM tasks WHERE id=$1 AND project_id=$2`, [taskId, projectId]);
    return res.json({ success: true });
  });

  // GET /api/projects/:projectId/task-stats
  router.get('/projects/:projectId/task-stats', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    try {
      const [statusCounts, overdue, memberLoad, recent] = await Promise.all([
        dbQuery(`SELECT status, COUNT(*)::int AS count FROM tasks WHERE project_id=$1 GROUP BY status`, [projectId]),
        dbQuery(`SELECT COUNT(*)::int AS count FROM tasks WHERE project_id=$1 AND due_date < NOW() AND status != 'done'`, [projectId]),
        dbQuery(
          `SELECT COALESCE(u.full_name, u.username, u.email) AS name, u.avatar_url AS avatar, COUNT(*)::int AS task_count
           FROM task_assignees ta JOIN tasks t ON t.id=ta.task_id JOIN users u ON u.id=ta.user_id
           WHERE t.project_id=$1 AND t.status != 'done' GROUP BY u.id, u.full_name, u.username, u.email, u.avatar_url
           ORDER BY task_count DESC LIMIT 8`, [projectId]
        ),
        dbQuery(
          `SELECT a.action, a.created_at, a.metadata, COALESCE(u.full_name, u.username, u.email) AS user_name, t.title AS task_title
           FROM task_activity a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN tasks t ON t.id=a.task_id
           WHERE a.project_id=$1 ORDER BY a.created_at DESC LIMIT 10`, [projectId]
        ),
      ]);
      const byStatus = Object.fromEntries(statusCounts.rows.map((r: any) => [r.status, r.count]));
      const total = statusCounts.rows.reduce((s, r: any) => s + r.count, 0);
      return res.json({ byStatus, total, overdue: (overdue.rows[0] as any)?.count ?? 0, memberLoad: memberLoad.rows, recentActivity: recent.rows });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  // GET /api/projects/:projectId/labels
  router.get('/projects/:projectId/labels', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    const { rows } = await dbQuery(`SELECT * FROM task_labels WHERE project_id=$1 ORDER BY name`, [projectId]);
    return res.json({ labels: rows });
  });

  // POST /api/projects/:projectId/labels
  router.post('/projects/:projectId/labels', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    const { name, color = '#6366f1' } = req.body as { name: string; color?: string };
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { rows } = await dbQuery(
      `INSERT INTO task_labels (project_id, name, color) VALUES ($1,$2,$3) RETURNING *`,
      [projectId, name.trim(), color]
    );
    return res.json({ label: rows[0] });
  });

  // DELETE /api/projects/:projectId/labels/:labelId
  router.delete('/projects/:projectId/labels/:labelId', async (req: Request, res: Response) => {
    const { projectId, labelId } = req.params;
    const access = await requireProjectAccess(req, res, projectId, 'editor');
    if (!access) return;
    await dbQuery(`DELETE FROM task_labels WHERE id=$1 AND project_id=$2`, [labelId, projectId]);
    return res.json({ success: true });
  });

  // POST /api/tasks/:taskId/labels/:labelId
  router.post('/tasks/:taskId/labels/:labelId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId, labelId } = req.params;
    await dbQuery(`INSERT INTO task_label_assignments (task_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, labelId]);
    return res.json({ success: true });
  });

  // DELETE /api/tasks/:taskId/labels/:labelId
  router.delete('/tasks/:taskId/labels/:labelId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId, labelId } = req.params;
    await dbQuery(`DELETE FROM task_label_assignments WHERE task_id=$1 AND label_id=$2`, [taskId, labelId]);
    return res.json({ success: true });
  });

  // POST /api/tasks/:taskId/assignees
  router.post('/tasks/:taskId/assignees', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId } = req.params;
    const { user_id } = req.body as { user_id: string };
    await dbQuery(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, user_id]);
    return res.json({ success: true });
  });

  // DELETE /api/tasks/:taskId/assignees/:userId
  router.delete('/tasks/:taskId/assignees/:userId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId, userId } = req.params;
    await dbQuery(`DELETE FROM task_assignees WHERE task_id=$1 AND user_id=$2`, [taskId, userId]);
    return res.json({ success: true });
  });

  // POST /api/tasks/:taskId/subtasks
  router.post('/tasks/:taskId/subtasks', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId } = req.params;
    const { title } = req.body as { title: string };
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const { rows: pos } = await dbQuery(`SELECT COALESCE(MAX(position),0)+1 AS next FROM subtasks WHERE task_id=$1`, [taskId]);
    const { rows } = await dbQuery(
      `INSERT INTO subtasks (task_id, title, position, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [taskId, title.trim(), (pos[0] as any).next, auth.userId]
    );
    return res.json({ subtask: rows[0] });
  });

  // PATCH /api/tasks/:taskId/subtasks/:subtaskId
  router.patch('/tasks/:taskId/subtasks/:subtaskId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId, subtaskId } = req.params;
    const { title, completed } = req.body as { title?: string; completed?: boolean };
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (title !== undefined) { sets.push(`title=$${i++}`); vals.push(title.trim()); }
    if (completed !== undefined) { sets.push(`completed=$${i++}`); vals.push(completed); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(subtaskId); vals.push(taskId);
    const { rows } = await dbQuery(`UPDATE subtasks SET ${sets.join(',')} WHERE id=$${i++} AND task_id=$${i} RETURNING *`, vals);
    return res.json({ subtask: rows[0] });
  });

  // DELETE /api/tasks/:taskId/subtasks/:subtaskId
  router.delete('/tasks/:taskId/subtasks/:subtaskId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await dbQuery(`DELETE FROM subtasks WHERE id=$1 AND task_id=$2`, [req.params.subtaskId, req.params.taskId]);
    return res.json({ success: true });
  });

  // POST /api/tasks/:taskId/attachments
  router.post('/tasks/:taskId/attachments', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId } = req.params;
    const { name, url, size, mime_type } = req.body as { name: string; url: string; size?: number; mime_type?: string };
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const { rows } = await dbQuery(
      `INSERT INTO task_attachments (task_id, name, url, size, mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [taskId, name, url, size ?? null, mime_type ?? null, auth.userId]
    );
    return res.json({ attachment: rows[0] });
  });

  // DELETE /api/tasks/:taskId/attachments/:attachmentId
  router.delete('/tasks/:taskId/attachments/:attachmentId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await dbQuery(`DELETE FROM task_attachments WHERE id=$1 AND task_id=$2`, [req.params.attachmentId, req.params.taskId]);
    return res.json({ success: true });
  });

  // GET /api/tasks/:taskId/comments
  router.get('/tasks/:taskId/comments', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId } = req.params;
    try {
      const { rows: comments } = await dbQuery(
        `SELECT c.*, COALESCE(u.full_name, u.username, u.email) AS author_name, u.avatar_url AS author_avatar,
          COALESCE(
            (SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'reacted', r.reacted))
             FROM (
               SELECT r2.emoji, COUNT(*)::int AS cnt, MAX(CASE WHEN r2.user_id=$1 THEN 1 ELSE 0 END)::boolean AS reacted
               FROM task_comment_reactions r2 WHERE r2.comment_id=c.id GROUP BY r2.emoji
             ) r
            ), '[]'
          ) AS reactions
         FROM task_comments c JOIN users u ON u.id=c.user_id
         WHERE c.task_id=$2 AND c.parent_id IS NULL
         ORDER BY c.created_at`,
        [auth.userId, taskId]
      );
      const { rows: replies } = await dbQuery(
        `SELECT c.*, COALESCE(u.full_name, u.username, u.email) AS author_name, u.avatar_url AS author_avatar
         FROM task_comments c JOIN users u ON u.id=c.user_id
         WHERE c.task_id=$1 AND c.parent_id IS NOT NULL ORDER BY c.created_at`,
        [taskId]
      );
      const replyMap: Record<string, typeof replies> = {};
      for (const r of replies) { if (!replyMap[(r as any).parent_id]) replyMap[(r as any).parent_id] = []; replyMap[(r as any).parent_id].push(r); }
      return res.json({ comments: comments.map((c: any) => ({ ...c, replies: replyMap[c.id] ?? [] })) });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.status(500).json({ error: 'Failed to load comments' });
    }
  });

  // POST /api/tasks/:taskId/comments
  router.post('/tasks/:taskId/comments', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { taskId } = req.params;
    const { content, parent_id } = req.body as { content: string; parent_id?: string };
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    const { rows } = await dbQuery(
      `INSERT INTO task_comments (task_id, user_id, content, parent_id) VALUES ($1,$2,$3,$4)
       RETURNING *, (SELECT COALESCE(full_name, username, email) FROM users WHERE id=$2) AS author_name,
                    (SELECT avatar_url FROM users WHERE id=$2) AS author_avatar`,
      [taskId, auth.userId, content.trim(), parent_id || null]
    );
    const { rows: task } = await dbQuery(`SELECT project_id FROM tasks WHERE id=$1`, [taskId]);
    if (task?.[0]) await logTaskActivity((task[0] as any).project_id, auth.userId, 'comment_added', taskId, {});
    return res.json({ comment: { ...rows[0], reactions: [], replies: [] } });
  });

  // PUT /api/tasks/:taskId/comments/:commentId
  router.put('/tasks/:taskId/comments/:commentId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { content } = req.body as { content: string };
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    const { rows } = await dbQuery(
      `UPDATE task_comments SET content=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *`,
      [content.trim(), req.params.commentId, auth.userId]
    );
    if (!rows[0]) return res.status(403).json({ error: 'Not your comment' });
    return res.json({ comment: rows[0] });
  });

  // DELETE /api/tasks/:taskId/comments/:commentId
  router.delete('/tasks/:taskId/comments/:commentId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await dbQuery(`DELETE FROM task_comments WHERE id=$1 AND user_id=$2`, [req.params.commentId, auth.userId]);
    return res.json({ success: true });
  });

  // POST /api/tasks/:taskId/comments/:commentId/reactions
  router.post('/tasks/:taskId/comments/:commentId/reactions', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { emoji } = req.body as { emoji: string };
    if (!emoji) return res.status(400).json({ error: 'Emoji required' });
    const existing = await dbQuery(
      `SELECT 1 FROM task_comment_reactions WHERE comment_id=$1 AND user_id=$2 AND emoji=$3`,
      [req.params.commentId, auth.userId, emoji]
    );
    if (existing.rows.length) {
      await dbQuery(`DELETE FROM task_comment_reactions WHERE comment_id=$1 AND user_id=$2 AND emoji=$3`, [req.params.commentId, auth.userId, emoji]);
    } else {
      await dbQuery(`INSERT INTO task_comment_reactions (comment_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [req.params.commentId, auth.userId, emoji]);
    }
    return res.json({ success: true, toggled: !existing.rows.length });
  });

  // GET /api/projects/:projectId/activity
  router.get('/projects/:projectId/activity', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    const { rows } = await dbQuery(
      `SELECT a.*, COALESCE(u.full_name, u.username, u.email) AS user_name, u.avatar_url,
         t.title AS task_title
       FROM task_activity a
       LEFT JOIN users u ON u.id=a.user_id
       LEFT JOIN tasks t ON t.id=a.task_id
       WHERE a.project_id=$1 ORDER BY a.created_at DESC LIMIT 50`,
      [projectId]
    );
    return res.json({ activity: rows });
  });

  // GET /api/projects/:projectId/files
  router.get('/projects/:projectId/files', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    const { rows } = await dbQuery(
      `SELECT a.*, t.title AS task_title, t.id AS task_id, COALESCE(u.full_name, u.username, u.email) AS uploader_name
       FROM task_attachments a
       JOIN tasks t ON t.id=a.task_id
       LEFT JOIN users u ON u.id=a.uploaded_by
       WHERE t.project_id=$1 ORDER BY a.created_at DESC`,
      [projectId]
    );
    return res.json({ files: rows });
  });

  // GET /api/projects/:projectId/members
  router.get('/projects/:projectId/members', async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const access = await requireProjectAccess(req, res, projectId);
    if (!access) return;
    const { rows } = await dbQuery(
      `SELECT u.id, COALESCE(u.full_name, u.username, u.email) AS name, u.email, u.avatar_url, om.role,
         (SELECT COUNT(*)::int FROM task_assignees ta JOIN tasks t ON t.id=ta.task_id
          WHERE ta.user_id=u.id AND t.project_id=$1) AS task_count
       FROM projects p
       JOIN organization_memberships om ON om.org_id=p.org_id
       JOIN users u ON u.id=om.user_id
       WHERE p.id=$1 ORDER BY om.role, u.full_name`,
      [projectId]
    );
    return res.json({ members: rows });
  });

  return router;
}
