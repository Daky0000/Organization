import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { Request } from '../../types/http.ts';
import type { Pool } from 'pg';
import { ORG_ROLE_RANK } from '../../user-auth.ts';

export type TenantRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface AutopilotTenantContext {
  tenantId: string;
  orgId: string | null;
  projectId: string | null;
  userId: string;
  userRole: TenantRole;
  canEdit: boolean;
  canApprove: boolean;
  canPublish: boolean;
  correlationId: string;
}

const SAFE_SCOPE_ID_RE = /^[a-zA-Z0-9_-]{2,128}$/;

function pickHeaderOrParam(req: Request, headerName: string, queryKey: string, bodyKey: string): string | null {
  const fromHeader = req.headers[headerName];
  const raw =
    (typeof fromHeader === 'string' ? fromHeader : Array.isArray(fromHeader) ? fromHeader[0] : '') ||
    (typeof req.query?.[queryKey] === 'string' ? (req.query[queryKey] as string) : '') ||
    (typeof (req.body as any)?.[bodyKey] === 'string' ? (req.body as any)[bodyKey] : '');
  const trimmed = String(raw || '').trim();
  return trimmed || null;
}

export function resolveRequestCorrelationId(req?: Request): string {
  const fromReq = (req as any)?.id;
  if (typeof fromReq === 'string' && fromReq.trim()) return fromReq.trim().slice(0, 96);
  const fromHeader = req?.headers?.['x-request-id'] || req?.headers?.['x-correlation-id'];
  const headerStr = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (typeof headerStr === 'string' && headerStr.trim()) {
    return headerStr.trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 96) || randomUUID();
  }
  return randomUUID();
}

/**
 * Resolves and strictly authorizes the tenant/workspace boundary for every Autopilot request.
 * - Supports both UUID and TEXT organization/project IDs (`organizations.id`, `projects.id`).
 * - If `projectId` is supplied (with or without `orgId`), resolves `projects.org_id`, verifies cross-header
 *   consistency when `orgId` is also supplied, and verifies membership/role in `organization_memberships`.
 * - If no org/project is supplied, isolates strictly to `user:<authenticatedUserId>`.
 * - Never trusts client-supplied tenant IDs without server-side ownership/membership proof.
 */
export async function resolveAutopilotTenant(
  req: Request,
  res: Response,
  requireAuth: (req: Request, res: Response) => { userId: string; role?: string } | null,
  pool: Pick<Pool, 'query'> | null,
  hasDatabase: () => boolean,
  minRole: TenantRole = 'viewer',
): Promise<AutopilotTenantContext | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;

  const correlationId = resolveRequestCorrelationId(req);
  let orgId = pickHeaderOrParam(req, 'x-organization-id', 'orgId', 'org_id');
  const projectId = pickHeaderOrParam(req, 'x-project-id', 'projectId', 'project_id');
  const explicitWorkspaceKey = pickHeaderOrParam(req, 'x-workspace-key', 'workspaceKey', 'workspace_key');

  if (orgId || projectId) {
    if (orgId && !SAFE_SCOPE_ID_RE.test(orgId)) {
      res.status(400).json({ success: false, error: 'Invalid organization ID format' });
      return null;
    }
    if (projectId && !SAFE_SCOPE_ID_RE.test(projectId)) {
      res.status(400).json({ success: false, error: 'Invalid project ID format' });
      return null;
    }
    if (!pool || !hasDatabase()) {
      res.status(503).json({ success: false, error: 'Workspace authorization requires database connectivity' });
      return null;
    }

    if (projectId) {
      const projRes = await pool.query(
        `SELECT id, org_id FROM projects WHERE id = $1 LIMIT 1`,
        [projectId],
      );
      const projRow = projRes.rows[0];
      if (!projRow) {
        res.status(403).json({ success: false, error: 'Forbidden: project not found or inaccessible' });
        return null;
      }
      if (orgId && String(projRow.org_id) !== orgId) {
        res.status(403).json({ success: false, error: 'Forbidden: project does not belong to this organization' });
        return null;
      }
      orgId = String(projRow.org_id);
    }

    const memRes = await pool.query(
      `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [orgId, auth.userId],
    );
    let memberRole = (memRes.rows[0]?.role as string | undefined) ?? null;
    if (!memberRole) {
      const ownerRes = await pool.query(
        `SELECT owner_id FROM organizations WHERE id = $1 AND owner_id = $2 LIMIT 1`,
        [orgId, auth.userId],
      ).catch(() => ({ rows: [] as any[] }));
      if (ownerRes.rows.length) memberRole = 'owner';
    }
    const normalizedRole: TenantRole | null =
      memberRole === 'owner' || memberRole === 'admin' || memberRole === 'editor' || memberRole === 'viewer'
        ? memberRole
        : memberRole === 'member'
          ? 'editor'
          : null;

    if (!normalizedRole || (ORG_ROLE_RANK[normalizedRole] ?? 0) < (ORG_ROLE_RANK[minRole] ?? 0)) {
      res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions for this organization workspace' });
      return null;
    }

    const tenantId = projectId ? `proj:${projectId}` : `org:${orgId}`;
    const rank = ORG_ROLE_RANK[normalizedRole] ?? 0;
    return {
      tenantId,
      orgId,
      projectId: projectId || null,
      userId: auth.userId,
      userRole: normalizedRole,
      canEdit: rank >= ORG_ROLE_RANK.editor,
      canApprove: rank >= ORG_ROLE_RANK.admin,
      canPublish: rank >= ORG_ROLE_RANK.admin,
      correlationId,
    };
  }

  // Solo user or sub-brand workspace owned strictly by auth.userId.
  // An optional workspaceKey is always namespaced under `user:${auth.userId}:` so
  // User A can never address User B's tenant even if they guess a workspace key.
  const safeSubKey = explicitWorkspaceKey
    ? explicitWorkspaceKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
    : '';
  const tenantId = safeSubKey ? `user:${auth.userId}:${safeSubKey}` : `user:${auth.userId}`;

  // Allow test/role simulation header ONLY if narrowing own role (never elevating!)
  const simulatedRoleHeader = String(req.headers['x-autopilot-role'] || '').toLowerCase();
  const effectiveRole: TenantRole =
    simulatedRoleHeader === 'viewer' || simulatedRoleHeader === 'editor' || simulatedRoleHeader === 'admin'
      ? (simulatedRoleHeader as TenantRole)
      : 'owner';

  if ((ORG_ROLE_RANK[effectiveRole] ?? 0) < (ORG_ROLE_RANK[minRole] ?? 0)) {
    res.status(403).json({ success: false, error: `Forbidden: requires at least ${minRole} role` });
    return null;
  }

  const rank = ORG_ROLE_RANK[effectiveRole] ?? 4;
  return {
    tenantId,
    orgId: null,
    projectId: null,
    userId: auth.userId,
    userRole: effectiveRole,
    canEdit: rank >= ORG_ROLE_RANK.editor,
    canApprove: rank >= ORG_ROLE_RANK.admin,
    canPublish: rank >= ORG_ROLE_RANK.admin,
    correlationId,
  };
}
