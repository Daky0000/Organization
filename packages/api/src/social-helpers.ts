import { config } from './config.ts';
import { logger } from './logger.ts';
import { pool, dbQuery, hasDatabase } from './db.ts';

// ── LinkedIn scope helpers (also used by linkedinRoutes + platformConfigRoutes) ──

export const LINKEDIN_DEFAULT_OAUTH_SCOPES = [
  'r_liteprofile', 'r_emailaddress', 'w_member_social',
  'r_organization_admin', 'rw_organization_admin',
  'r_organization_social', 'w_organization_social',
];

export const LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS = ['r_organization_admin', 'rw_organization_admin'];

export function getLinkedInOAuthScopeString(): string {
  return String(process.env.LINKEDIN_OAUTH_SCOPES || LINKEDIN_DEFAULT_OAUTH_SCOPES.join(' ')).trim();
}

export function parseLinkedInScopeList(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (err) { logger.error('Unhandled error:', err); decoded = raw; }
  return Array.from(new Set(decoded.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean)));
}

export function getLinkedInScopeSet(tokenData: any): Set<string> {
  const fromString = parseLinkedInScopeList(tokenData?.scope);
  const fromArray = Array.isArray(tokenData?.scopes)
    ? tokenData.scopes.map((scope: unknown) => String(scope || '').trim()).filter(Boolean)
    : [];
  return new Set([...fromString, ...fromArray]);
}

export function hasAnyLinkedInScope(tokenData: any, scopes: string[]): boolean {
  const granted = getLinkedInScopeSet(tokenData);
  return scopes.some((scope) => granted.has(scope));
}

export function hasAllLinkedInScopes(tokenData: any, scopes: string[]): boolean {
  const granted = getLinkedInScopeSet(tokenData);
  return scopes.every((scope) => granted.has(scope));
}

export function getLinkedInOrganizationScopeError(
  tokenData: any,
  options?: { requireSocialRead?: boolean; requireSocialWrite?: boolean },
): string | null {
  const granted = getLinkedInScopeSet(tokenData);
  if (granted.size === 0) return null;
  if (!LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS.some((scope) => granted.has(scope))) {
    return 'LinkedIn connection is missing organization admin scopes — reconnect LinkedIn and approve company page access';
  }
  if (options?.requireSocialRead && !granted.has('r_organization_social')) {
    return 'LinkedIn connection is missing r_organization_social — reconnect LinkedIn to load company page analytics';
  }
  if (options?.requireSocialWrite && !granted.has('w_organization_social')) {
    return 'LinkedIn connection is missing w_organization_social — reconnect LinkedIn to publish to company pages';
  }
  return null;
}

export function shouldEnableLinkedInExtendedLogin(): boolean {
  const raw = String(process.env.LINKEDIN_ENABLE_EXTENDED_LOGIN || 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
}

export function computeIsoFromTtlSeconds(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

// ── Notification & task helpers ────────────────────────────────────────────────

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data: Record<string, any> = {},
  pinned = false,
): Promise<void> {
  if (!pool) return;
  try {
    await dbQuery(
      `INSERT INTO notifications (user_id, type, title, message, data, pinned) VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, title, message, data, pinned],
    );
  } catch (e) {
    logger.error('createNotification error:', e);
  }
}

export async function logTaskActivity(
  projectId: string, userId: string, action: string, taskId?: string, metadata?: Record<string, unknown>
) {
  try {
    await dbQuery(
      `INSERT INTO task_activity (project_id, user_id, action, task_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
      [projectId, userId, action, taskId ?? null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (_err) { /* non-fatal */ }
}

export async function checkTaskActions(
  userId: string,
  actionType: string,
): Promise<Array<{ task_id: string; title: string; new_status: string; progress: string }>> {
  if (!hasDatabase()) return [];
  const progressed: Array<{ task_id: string; title: string; new_status: string; progress: string }> = [];
  try {
    const { rows } = await dbQuery(
      `SELECT DISTINCT ta.id, ta.current_count, ta.target_count, ta.task_id, t.project_id, t.status, t.title
       FROM task_actions ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.action_type = $2
         AND ta.current_count < ta.target_count
         AND t.status != 'done'
         AND (
           EXISTS (SELECT 1 FROM task_assignees tass WHERE tass.task_id = t.id AND tass.user_id = $1)
           OR t.supervisor_id = $1
         )`,
      [userId, actionType]
    );
    for (const row of rows) {
      const r = row as any;
      const newCount = r.current_count + 1;
      await dbQuery(`UPDATE task_actions SET current_count = $1 WHERE id = $2`, [newCount, r.id]);
      const { rows: totals } = await dbQuery(
        `SELECT COALESCE(SUM(target_count),0) AS tgt, COALESCE(SUM(LEAST(current_count, target_count)),0) AS cur FROM task_actions WHERE task_id = $1`,
        [r.task_id]
      );
      const t0 = totals[0] as any;
      const isDone = Number(t0.cur) >= Number(t0.tgt);
      if (isDone) {
        await dbQuery(`UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1`, [r.task_id]);
        void logTaskActivity(r.project_id, userId, 'status_changed', r.task_id, { from: r.status, to: 'done' });
        createNotification(userId, 'agent_activity',
          `Task completed: "${r.title}"`,
          `Your action automatically completed the task "${r.title}".`,
          { taskId: r.task_id },
        ).catch(() => undefined);
      }
      progressed.push({
        task_id: r.task_id,
        title: r.title,
        new_status: isDone ? 'done' : r.status,
        progress: `${newCount}/${r.target_count}`,
      });
    }
  } catch (err) {
    logger.error('[checkTaskActions] error:', err);
  }
  return progressed;
}
