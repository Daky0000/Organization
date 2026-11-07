// ─────────────────────────────────────────────────────────────────────────────
// Lead sheet context — what the lead workspace knows about one lead, shaped for
// the call agents.
//
// The call brief reads it so the voice agent knows the row the user imported
// (amount owed, event date, role…), the lists the lead is on, their company
// and the recent activity log. The Analyst reads the same columns so it can
// write values it heard on the call back into that row.
//
// Columns follow the workspace's own rule: the custom columns linked to any of
// the lead's lists, plus any column the lead already has a value in. A lead in
// no list sees every custom column.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool, PoolClient } from 'pg';
import { getLeadFields, type FieldType, type LeadField } from './leadWorkspace.ts';

export interface SheetColumn {
  key: string;
  label: string;
  type: FieldType;
  options: string[] | null;
  value: unknown;
}

export interface LeadCompany {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  role: string | null;
}

export interface LeadSheetContext {
  lists: string[];
  columns: SheetColumn[];
  company: LeadCompany | null;
  /** Newest first, one line each. */
  recentActivity: string[];
  /** Human reminders that are still open, soonest first. */
  openReminders: string[];
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function displayValue(v: unknown): string {
  if (!hasValue(v)) return '(empty)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v).replace(/\s+/g, ' ').slice(0, 300);
}

export async function getLeadSheetContext(
  pool: Pool | PoolClient,
  userId: string,
  contactId: string,
): Promise<LeadSheetContext> {
  const [fields, profileRes, listRes, companyRes, activityRes, reminderRes] = await Promise.all([
    getLeadFields(pool, userId),
    pool.query(
      `SELECT COALESCE(custom_data, '{}'::jsonb) AS custom_data FROM sales_lead_profiles WHERE contact_id=$1 AND user_id=$2`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT l.id, l.name,
              COALESCE((SELECT array_agg(lf.field_key) FROM sales_lead_list_fields lf WHERE lf.list_id=l.id), '{}') AS keys
         FROM sales_lead_list_members m JOIN sales_lead_lists l ON l.id=m.list_id
        WHERE m.contact_id=$1 AND l.user_id=$2
        ORDER BY l.name`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT co.id, co.name, co.industry, co.website, co.city, co.country, co.description, cc.role
         FROM crm_contact_companies cc JOIN crm_companies co ON co.id=cc.company_id
        WHERE cc.contact_id=$1 AND co.user_id=$2
        ORDER BY cc.is_primary DESC NULLS LAST, cc.created_at
        LIMIT 1`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT type, title, body, response_status, COALESCE(completed_at, created_at) AS at
         FROM crm_activities
        WHERE contact_id=$1 AND user_id=$2 AND type IN ('note','call','email','meeting','whatsapp','sms')
        ORDER BY COALESCE(completed_at, created_at) DESC
        LIMIT 8`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT scheduled_for, channel, reason, objective FROM sales_followups
        WHERE contact_id=$1 AND user_id=$2 AND mode='human' AND status='scheduled'
        ORDER BY scheduled_for LIMIT 5`,
      [contactId, userId],
    ),
  ]);

  const custom = (profileRes.rows[0]?.custom_data ?? {}) as Record<string, unknown>;
  const inList = listRes.rows.length > 0;
  const linked = new Set<string>(listRes.rows.flatMap((r) => (Array.isArray(r.keys) ? r.keys : []) as string[]));

  const columns: SheetColumn[] = fields
    .filter((f: LeadField) => !f.builtin && (!inList || linked.has(f.key) || hasValue(custom[f.key])))
    .map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, value: custom[f.key] ?? null }));

  const day = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);
  const recentActivity = activityRes.rows.map((a) => {
    const text = [a.title, a.body].filter(Boolean).join(' — ').replace(/\s+/g, ' ').slice(0, 240);
    const status = a.response_status ? ` [${String(a.response_status).replace(/_/g, ' ')}]` : '';
    return `${day(a.at)} ${a.type}${status}: ${text || '(no details)'}`;
  });
  const openReminders = reminderRes.rows.map((r) => {
    const what = [r.reason, r.objective].filter(Boolean).join(' — ') || 'follow up';
    return `${new Date(r.scheduled_for).toISOString().slice(0, 16).replace('T', ' ')} UTC (${r.channel ?? 'call'}): ${what}`;
  });

  const c = companyRes.rows[0];
  return {
    lists: listRes.rows.map((r) => String(r.name)),
    columns,
    company: c
      ? {
          id: c.id, name: c.name, industry: c.industry ?? null, website: c.website ?? null, city: c.city ?? null,
          country: c.country ?? null, description: c.description ?? null, role: c.role ?? null,
        }
      : null,
    recentActivity,
    openReminders,
  };
}

/** The sheet row and company as prompt text. */
export function renderLeadSheet(ctx: LeadSheetContext): string {
  const parts: string[] = [];
  if (ctx.lists.length) parts.push(`Lists: ${ctx.lists.join(', ')}`);
  if (ctx.company) {
    const c = ctx.company;
    const where = [c.city, c.country].filter(Boolean).join(', ');
    parts.push(
      [`Company: ${c.name}`, c.role ? `(their role: ${c.role})` : null, c.industry ? `industry: ${c.industry}` : null,
        where || null, c.website || null].filter(Boolean).join(' · '),
    );
    if (c.description) parts.push(`About the company: ${c.description.slice(0, 400)}`);
  }
  const filled = ctx.columns.filter((col) => hasValue(col.value));
  if (filled.length) parts.push(`Sheet row:\n${filled.map((col) => `- ${col.label}: ${displayValue(col.value)}`).join('\n')}`);
  return parts.join('\n');
}
