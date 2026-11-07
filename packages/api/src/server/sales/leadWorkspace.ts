// ─────────────────────────────────────────────────────────────────────────────
// Lead workspace: lists, user-defined columns, the spreadsheet-style lead query
// and bulk actions. Builds on Sales OS — a lead is a mailing_contacts row plus
// its sales_lead_profiles row; custom column values live in
// sales_lead_profiles.custom_data under the column's key.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { isLeadStage, LEAD_STAGES } from './types.ts';
import { RESPONSE_STATUSES, ActivityError, DEFAULT_TIMEZONE } from './leadActivities.ts';
import { isValidIanaTimezone, resolveZonedLocal, zonedDateKey } from '../timezones.ts';

export const LIST_SOURCE_TYPES = ['facebook_ads', 'event', 'company', 'referral', 'import', 'manual', 'other'] as const;
export type ListSourceType = (typeof LIST_SOURCE_TYPES)[number];

export const FIELD_TYPES = ['text', 'long_text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'url', 'select'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Built-in columns: fixed in code; users may only reorder, resize and hide them. */
export const BUILTIN_FIELDS: Array<{ key: string; label: string; type: FieldType }> = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'stage', label: 'Stage', type: 'select' },
  { key: 'lists', label: 'Lists', type: 'text' },
  { key: 'last_status', label: 'Last outcome', type: 'select' },
  { key: 'last_contacted', label: 'Last contact', type: 'date' },
  { key: 'next_followup', label: 'Next follow-up', type: 'date' },
];
const BUILTIN_KEYS = new Set(BUILTIN_FIELDS.map((f) => f.key));

export interface LeadField {
  key: string;
  label: string;
  type: FieldType;
  options: string[] | null;
  builtin: boolean;
  position: number;
  width: number | null;
  hidden: boolean;
}

// ── Custom values ───────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Coerces one value to its column type; throws ActivityError(400) when it can't. */
export function coerceFieldValue(field: Pick<LeadField, 'key' | 'label' | 'type' | 'options'>, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  const bad = (why: string) => new ActivityError(400, `${field.label}: ${why}`);
  switch (field.type) {
    case 'text': {
      const s = String(value).trim();
      if (s.length > 2000) throw bad('too long');
      return s;
    }
    case 'long_text': {
      const s = String(value).trim();
      if (s.length > 10000) throw bad('too long');
      return s;
    }
    case 'number':
    case 'currency': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
      if (!Number.isFinite(n)) throw bad('must be a number');
      return n;
    }
    case 'date': {
      const s = String(value).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw bad('must be a date (YYYY-MM-DD)');
      return s;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (['true', 'yes', '1', 'y'].includes(s)) return true;
      if (['false', 'no', '0', 'n'].includes(s)) return false;
      throw bad('must be yes or no');
    }
    case 'email': {
      const s = String(value).trim().toLowerCase();
      if (!EMAIL_RE.test(s)) throw bad('is not a valid email');
      return s;
    }
    case 'phone': {
      const s = String(value).trim();
      if (!/^\+?[\d\s\-().]{5,30}$/.test(s)) throw bad('is not a valid phone number');
      return s;
    }
    case 'url': {
      const s = String(value).trim();
      try {
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
        return u.toString();
      } catch { throw bad('is not a valid link'); }
    }
    case 'select': {
      const s = String(value).trim();
      if (!field.options?.includes(s)) throw bad(`must be one of: ${(field.options ?? []).join(', ')}`);
      return s;
    }
    default:
      return value;
  }
}

/** Validates a partial custom_data patch against the user's columns. Unknown keys are rejected. */
export function validateCustomValues(fields: LeadField[], values: Record<string, unknown>): Record<string, unknown> {
  const byKey = new Map(fields.filter((f) => !f.builtin).map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    const field = byKey.get(key);
    if (!field) throw new ActivityError(400, `Unknown column "${key}"`);
    out[key] = coerceFieldValue(field, value);
  }
  return out;
}

export function slugifyKey(label: string): string {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').slice(0, 40) || 'field';
  return /^[a-z_]/.test(base) ? base : `f_${base}`;
}

// ── Columns ─────────────────────────────────────────────────────────────────

export async function getLeadFields(pool: Pool | PoolClient, userId: string): Promise<LeadField[]> {
  const { rows } = await pool.query(
    `SELECT key, label, type, options, builtin, position, width, hidden FROM sales_lead_fields WHERE user_id=$1`,
    [userId],
  );
  const stored = new Map(rows.map((r) => [r.key as string, r]));
  const fields: LeadField[] = BUILTIN_FIELDS.map((b, i) => {
    const s = stored.get(b.key);
    return {
      key: b.key, label: b.label, type: b.type, options: null, builtin: true,
      position: s?.builtin ? s.position : i, width: s?.width ?? null, hidden: s?.builtin ? s.hidden : false,
    };
  });
  for (const r of rows) {
    if (r.builtin || BUILTIN_KEYS.has(r.key)) continue;
    fields.push({
      key: r.key, label: r.label, type: r.type, options: Array.isArray(r.options) ? r.options : null,
      builtin: false, position: r.position, width: r.width, hidden: r.hidden,
    });
  }
  return fields.sort((a, b) => a.position - b.position);
}

export interface FieldInput {
  key?: string | null;
  label: string;
  type: FieldType;
  options?: string[] | null;
  width?: number | null;
  hidden?: boolean;
}

/**
 * Replaces the user's column set. Order of the input is the display order.
 * Built-in columns keep their label/type; a removed custom column's values
 * are stripped from every lead in the same transaction.
 */
export async function putLeadFields(pool: Pool, userId: string, input: FieldInput[]): Promise<LeadField[]> {
  const seen = new Set<string>();
  const normalized = input.map((f, position) => {
    const isBuiltin = !!f.key && BUILTIN_KEYS.has(f.key);
    let key = f.key && !isBuiltin ? f.key : isBuiltin ? f.key! : slugifyKey(f.label);
    if (!isBuiltin) {
      if (!/^[a-z_][a-z0-9_]{0,39}$/.test(key)) key = slugifyKey(key);
      if (BUILTIN_KEYS.has(key)) key = `${key}_custom`;
      let n = 2;
      const base = key;
      while (seen.has(key)) key = `${base}_${n++}`;
    }
    if (seen.has(key)) throw new ActivityError(400, `Column "${key}" appears twice`);
    seen.add(key);
    const label = String(f.label ?? '').trim().slice(0, 60);
    if (!isBuiltin && !label) throw new ActivityError(400, 'Every column needs a name');
    let options: string[] | null = null;
    if (!isBuiltin && f.type === 'select') {
      options = [...new Set((f.options ?? []).map((o) => String(o).trim()).filter(Boolean))].slice(0, 50);
      if (!options.length) throw new ActivityError(400, `${label}: add at least one choice`);
    }
    return { key, label, type: f.type, options, builtin: isBuiltin, position, width: f.width ?? null, hidden: !!f.hidden };
  });
  if (normalized.filter((f) => !f.builtin).length > 60) throw new ActivityError(400, 'At most 60 custom columns');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query(
      `SELECT key, type FROM sales_lead_fields WHERE user_id=$1 AND builtin=false`, [userId],
    );
    const keep = new Set(normalized.filter((f) => !f.builtin).map((f) => f.key));
    const removed = existing.map((r) => r.key as string).filter((k) => !keep.has(k));
    for (const key of removed) {
      await client.query(
        `UPDATE sales_lead_profiles SET custom_data = custom_data - $2::text WHERE user_id=$1 AND custom_data ? $2::text`,
        [userId, key],
      );
    }
    await client.query(`DELETE FROM sales_lead_fields WHERE user_id=$1`, [userId]);
    for (const f of normalized) {
      await client.query(
        `INSERT INTO sales_lead_fields (id, user_id, key, label, type, options, builtin, position, width, hidden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [randomUUID(), userId, f.key, f.builtin ? BUILTIN_FIELDS.find((b) => b.key === f.key)!.label : f.label,
         f.builtin ? BUILTIN_FIELDS.find((b) => b.key === f.key)!.type : f.type,
         f.options ? JSON.stringify(f.options) : null, f.builtin, f.position, f.width, f.hidden],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return getLeadFields(pool, userId);
}

// ── Lists ───────────────────────────────────────────────────────────────────

export async function listLeadLists(pool: Pool, userId: string) {
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.source_type, l.color, l.archived_at, l.created_at,
            (SELECT COUNT(*)::int FROM sales_lead_list_members m WHERE m.list_id=l.id) AS lead_count
       FROM sales_lead_lists l
      WHERE l.user_id=$1
      ORDER BY l.archived_at NULLS FIRST, l.created_at DESC`,
    [userId],
  );
  return rows;
}

async function assertOwnedList(pool: Pool | PoolClient, userId: string, listId: string) {
  const { rowCount } = await pool.query(`SELECT 1 FROM sales_lead_lists WHERE id=$1 AND user_id=$2`, [listId, userId]);
  if (!rowCount) throw new ActivityError(404, 'List not found');
}

function uniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export async function createLeadList(pool: Pool | PoolClient, userId: string, input: { name: string; source_type?: ListSourceType; color?: string | null }) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new ActivityError(400, 'List name is required');
  try {
    const { rows } = await pool.query(
      `INSERT INTO sales_lead_lists (id, user_id, name, source_type, color)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, source_type, color, archived_at, created_at, 0 AS lead_count`,
      [randomUUID(), userId, name, input.source_type ?? 'manual', input.color ?? null],
    );
    return rows[0];
  } catch (err) {
    if (uniqueViolation(err)) throw new ActivityError(409, `A list called "${name}" already exists`);
    throw err;
  }
}

/** Finds a list by name (case-insensitive) or creates it. Used by import. */
export async function findOrCreateLeadList(client: Pool | PoolClient, userId: string, name: string, sourceType: ListSourceType) {
  const { rows } = await client.query(
    `SELECT id, name FROM sales_lead_lists WHERE user_id=$1 AND lower(name)=lower($2)`, [userId, name.trim()],
  );
  if (rows[0]) return rows[0] as { id: string; name: string };
  return createLeadList(client, userId, { name, source_type: sourceType });
}

export async function updateLeadList(pool: Pool, userId: string, id: string, input: { name?: string; source_type?: ListSourceType; color?: string | null; archived?: boolean }) {
  try {
    const { rows } = await pool.query(
      `UPDATE sales_lead_lists
          SET name = COALESCE($3, name), source_type = COALESCE($4, source_type),
              color = CASE WHEN $5::boolean THEN $6 ELSE color END,
              archived_at = CASE WHEN $7::boolean IS NULL THEN archived_at WHEN $7 THEN COALESCE(archived_at, NOW()) ELSE NULL END,
              updated_at = NOW()
        WHERE id=$1 AND user_id=$2
        RETURNING id, name, source_type, color, archived_at, created_at`,
      [id, userId, input.name?.trim().slice(0, 120) || null, input.source_type ?? null,
       'color' in input, input.color ?? null, input.archived ?? null],
    );
    if (!rows[0]) throw new ActivityError(404, 'List not found');
    return rows[0];
  } catch (err) {
    if (uniqueViolation(err)) throw new ActivityError(409, 'Another list already has that name');
    throw err;
  }
}

export async function deleteLeadList(pool: Pool, userId: string, id: string) {
  // Leads stay; only the grouping goes.
  const { rowCount } = await pool.query(`DELETE FROM sales_lead_lists WHERE id=$1 AND user_id=$2`, [id, userId]);
  if (!rowCount) throw new ActivityError(404, 'List not found');
}

async function ownedContactIds(pool: Pool | PoolClient, userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query(`SELECT id FROM mailing_contacts WHERE user_id=$1 AND id = ANY($2::text[])`, [userId, ids]);
  return rows.map((r) => r.id);
}

export async function changeListMembers(pool: Pool | PoolClient, userId: string, listId: string, add: string[], remove: string[]) {
  await assertOwnedList(pool, userId, listId);
  const addIds = await ownedContactIds(pool, userId, add);
  if (addIds.length) {
    await pool.query(
      `INSERT INTO sales_lead_list_members (list_id, contact_id)
       SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [listId, addIds],
    );
  }
  if (remove.length) {
    await pool.query(`DELETE FROM sales_lead_list_members WHERE list_id=$1 AND contact_id = ANY($2::text[])`, [listId, remove]);
  }
  return { added: addIds.length, removed: remove.length };
}

// ── Leads ───────────────────────────────────────────────────────────────────

export interface LeadQuery {
  listId?: string | null;
  search?: string | null;
  stage?: string | null;
  responseStatus?: string | null;
  due?: 'today' | 'overdue' | 'week' | 'needs_confirmation' | null;
  neverContacted?: boolean;
  sort?: 'recent' | 'name' | 'next_followup' | 'last_contacted' | null;
  limit?: number;
  offset?: number;
}

async function userTimezone(pool: Pool, userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT (SELECT timezone FROM users WHERE id=$1) AS user_tz,
            (SELECT default_timezone FROM sales_call_policies WHERE user_id=$1) AS policy_tz`,
    [userId],
  );
  return [rows[0]?.user_tz, rows[0]?.policy_tz].find((t) => typeof t === 'string' && isValidIanaTimezone(t)) ?? DEFAULT_TIMEZONE;
}

/** End of the user's local "today", as a UTC instant. */
export function endOfLocalDay(nowMs: number, tz: string): Date {
  const day = zonedDateKey(nowMs, tz);
  const r = resolveZonedLocal(`${day}T23:59`, tz);
  return new Date(r.ok ? Date.parse(r.iso) + 59_999 : nowMs + 12 * 3600_000);
}

const LEAD_SELECT = `
  c.id AS contact_id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
  p.stage, p.do_not_call, p.timezone, p.last_contacted_at, COALESCE(p.custom_data, '{}'::jsonb) AS custom_data,
  COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY l.name)
              FROM sales_lead_list_members m JOIN sales_lead_lists l ON l.id=m.list_id
             WHERE m.contact_id=c.id), '[]'::json) AS lists,
  la.response_status AS last_response_status, la.at AS last_activity_at,
  nf.scheduled_for AS next_followup_at, nf.needs_confirmation AS next_followup_needs_confirmation,
  nf.channel AS next_followup_channel`;

const LEAD_JOINS = `
  FROM mailing_contacts c
  LEFT JOIN sales_lead_profiles p ON p.contact_id = c.id
  LEFT JOIN LATERAL (
    SELECT a.response_status, COALESCE(a.completed_at, a.created_at) AS at
      FROM crm_activities a
     WHERE a.contact_id = c.id AND a.user_id = c.user_id
     ORDER BY COALESCE(a.completed_at, a.created_at) DESC LIMIT 1
  ) la ON true
  LEFT JOIN LATERAL (
    SELECT f.scheduled_for, f.needs_confirmation, f.channel
      FROM sales_followups f
     WHERE f.contact_id = c.id AND f.user_id = c.user_id AND f.mode='human' AND f.status='scheduled'
     ORDER BY f.scheduled_for LIMIT 1
  ) nf ON true`;

export async function queryLeads(pool: Pool, userId: string, q: LeadQuery, nowMs = Date.now()) {
  const params: unknown[] = [userId];
  const where: string[] = ['c.user_id=$1'];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (q.listId) where.push(`EXISTS (SELECT 1 FROM sales_lead_list_members m WHERE m.contact_id=c.id AND m.list_id=${add(q.listId)})`);
  if (q.search) {
    const s = add(`%${q.search.trim()}%`);
    where.push(`(c.first_name ILIKE ${s} OR c.last_name ILIKE ${s} OR c.email ILIKE ${s} OR c.phone ILIKE ${s}
                 OR (coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ILIKE ${s})`);
  }
  if (q.stage && isLeadStage(q.stage)) where.push(`p.stage = ${add(q.stage)}`);
  if (q.responseStatus === 'none') where.push('la.response_status IS NULL');
  else if (q.responseStatus && (RESPONSE_STATUSES as readonly string[]).includes(q.responseStatus)) {
    where.push(`la.response_status = ${add(q.responseStatus)}`);
  }
  if (q.neverContacted) where.push('la.at IS NULL AND p.last_contacted_at IS NULL');
  if (q.due) {
    const now = new Date(nowMs);
    if (q.due === 'overdue') where.push(`nf.scheduled_for < ${add(now)}`);
    if (q.due === 'today') {
      const tz = await userTimezone(pool, userId);
      where.push(`nf.scheduled_for <= ${add(endOfLocalDay(nowMs, tz))}`);
    }
    if (q.due === 'week') where.push(`nf.scheduled_for <= ${add(new Date(nowMs + 7 * 86_400_000))}`);
    if (q.due === 'needs_confirmation') {
      where.push(`EXISTS (SELECT 1 FROM sales_followups f WHERE f.contact_id=c.id AND f.user_id=c.user_id
                   AND f.mode='human' AND f.status='scheduled' AND f.needs_confirmation)`);
    }
  }

  const order = {
    recent: 'c.created_at DESC',
    name: `lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ASC`,
    next_followup: 'nf.scheduled_for ASC NULLS LAST, c.created_at DESC',
    last_contacted: 'COALESCE(la.at, p.last_contacted_at) DESC NULLS LAST',
  }[q.sort ?? 'recent'] ?? 'c.created_at DESC';

  const whereSql = where.join(' AND ');
  const limit = Math.min(500, Math.max(1, q.limit ?? 100));
  const offset = Math.max(0, q.offset ?? 0);
  const [list, count] = await Promise.all([
    pool.query(`SELECT ${LEAD_SELECT} ${LEAD_JOINS} WHERE ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params),
    pool.query(`SELECT COUNT(*)::int AS n ${LEAD_JOINS} WHERE ${whereSql}`, params),
  ]);
  return { leads: list.rows, total: count.rows[0]?.n ?? 0 };
}

export async function getWorkspaceLead(pool: Pool, userId: string, contactId: string) {
  const { rows } = await pool.query(`SELECT ${LEAD_SELECT} ${LEAD_JOINS} WHERE c.user_id=$1 AND c.id=$2`, [userId, contactId]);
  if (!rows[0]) throw new ActivityError(404, 'Lead not found');
  return rows[0];
}

export interface LeadPatch {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string | null;
  custom_data?: Record<string, unknown>;
}

async function ensureProfile(client: Pool | PoolClient, userId: string, contactId: string) {
  await client.query(
    `INSERT INTO sales_lead_profiles (id, user_id, contact_id) VALUES ($1,$2,$3) ON CONFLICT (contact_id) DO NOTHING`,
    [randomUUID(), userId, contactId],
  );
}

function cleanContact(patch: LeadPatch) {
  const out: Record<string, string | null> = {};
  for (const k of ['first_name', 'last_name'] as const) {
    if (k in patch) out[k] = patch[k]?.trim().slice(0, 120) || null;
  }
  if ('email' in patch) {
    const e = patch.email?.trim().toLowerCase() || null;
    if (e && !EMAIL_RE.test(e)) throw new ActivityError(400, 'Email is not valid');
    out.email = e;
  }
  if ('phone' in patch) {
    const p = patch.phone?.trim() || null;
    if (p && !/^\+?[\d\s\-().]{5,30}$/.test(p)) throw new ActivityError(400, 'Phone number is not valid');
    out.phone = p;
  }
  return out;
}

export async function updateWorkspaceLead(pool: Pool, userId: string, contactId: string, patch: LeadPatch) {
  if (patch.stage && !isLeadStage(patch.stage)) throw new ActivityError(400, `Unknown stage "${patch.stage}"`);
  const contact = cleanContact(patch);
  const fields = patch.custom_data ? await getLeadFields(pool, userId) : [];
  const custom = patch.custom_data ? validateCustomValues(fields, patch.custom_data) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(`SELECT email, phone FROM mailing_contacts WHERE id=$1 AND user_id=$2 FOR UPDATE`, [contactId, userId]);
    if (!owned.rowCount) throw new ActivityError(404, 'Lead not found');
    const keys = Object.keys(contact);
    if (keys.length) {
      const nextEmail = 'email' in contact ? contact.email : owned.rows[0].email;
      const nextPhone = 'phone' in contact ? contact.phone : owned.rows[0].phone;
      if (!nextEmail && !nextPhone) throw new ActivityError(400, 'A lead needs an email or a phone number');
      const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
      try {
        await client.query(`UPDATE mailing_contacts SET ${sets}, updated_at=NOW() WHERE id=$1 AND user_id=$2`, [contactId, userId, ...keys.map((k) => contact[k])]);
      } catch (err) {
        if (uniqueViolation(err)) throw new ActivityError(409, 'Another lead already has that email or phone');
        throw err;
      }
    }
    if (patch.stage || custom) {
      await ensureProfile(client, userId, contactId);
      // null values remove the key; others are merged.
      const toSet = custom ? Object.fromEntries(Object.entries(custom).filter(([, v]) => v !== null)) : {};
      const toDrop = custom ? Object.entries(custom).filter(([, v]) => v === null).map(([k]) => k) : [];
      await client.query(
        `UPDATE sales_lead_profiles
            SET stage = COALESCE($3, stage),
                custom_data = (COALESCE(custom_data, '{}'::jsonb) || $4::jsonb) - $5::text[],
                updated_at = NOW()
          WHERE contact_id=$1 AND user_id=$2`,
        [contactId, userId, patch.stage ?? null, JSON.stringify(toSet), toDrop],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return getWorkspaceLead(pool, userId, contactId);
}

export async function createWorkspaceLead(pool: Pool, userId: string, input: LeadPatch & { list_ids?: string[] }) {
  const contact = cleanContact(input);
  if (!contact.email && !contact.phone) throw new ActivityError(400, 'A lead needs an email or a phone number');
  const fields = input.custom_data ? await getLeadFields(pool, userId) : [];
  const custom = input.custom_data ? validateCustomValues(fields, input.custom_data) : {};
  if (input.stage && !isLeadStage(input.stage)) throw new ActivityError(400, `Unknown stage "${input.stage}"`);

  const client = await pool.connect();
  let contactId: string;
  try {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source)
         VALUES ($1,$2,$3,$4,$5,$6,'sales_workspace') RETURNING id`,
        [randomUUID(), userId, contact.email ?? null, contact.first_name ?? null, contact.last_name ?? null, contact.phone ?? null],
      );
      contactId = rows[0].id;
    } catch (err) {
      if (uniqueViolation(err)) throw new ActivityError(409, 'A lead with that email or phone already exists');
      throw err;
    }
    await client.query(
      `INSERT INTO sales_lead_profiles (id, user_id, contact_id, stage, custom_data)
       VALUES ($1,$2,$3,COALESCE($4,'new'),$5) ON CONFLICT (contact_id) DO NOTHING`,
      [randomUUID(), userId, contactId, input.stage ?? null, JSON.stringify(Object.fromEntries(Object.entries(custom).filter(([, v]) => v !== null)))],
    );
    for (const listId of input.list_ids ?? []) await changeListMembers(client, userId, listId, [contactId], []);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return getWorkspaceLead(pool, userId, contactId!);
}

export type BulkAction = 'set_stage' | 'add_to_list' | 'remove_from_list' | 'delete';

export async function bulkLeads(pool: Pool, userId: string, ids: string[], action: BulkAction, value?: string | null) {
  const owned = await ownedContactIds(pool, userId, ids.slice(0, 1000));
  if (!owned.length) return { affected: 0 };
  switch (action) {
    case 'set_stage': {
      if (!value || !isLeadStage(value)) throw new ActivityError(400, `Stage must be one of: ${LEAD_STAGES.join(', ')}`);
      await pool.query(
        `INSERT INTO sales_lead_profiles (id, user_id, contact_id)
         SELECT gen_random_uuid()::text, $1, unnest($2::text[]) ON CONFLICT (contact_id) DO NOTHING`,
        [userId, owned],
      );
      const r = await pool.query(
        `UPDATE sales_lead_profiles SET stage=$3, updated_at=NOW() WHERE user_id=$1 AND contact_id = ANY($2::text[])`,
        [userId, owned, value],
      );
      return { affected: r.rowCount ?? 0 };
    }
    case 'add_to_list':
    case 'remove_from_list': {
      if (!value) throw new ActivityError(400, 'Choose a list');
      const r = await changeListMembers(pool, userId, value, action === 'add_to_list' ? owned : [], action === 'remove_from_list' ? owned : []);
      return { affected: action === 'add_to_list' ? r.added : r.removed };
    }
    case 'delete': {
      const r = await pool.query(`DELETE FROM mailing_contacts WHERE user_id=$1 AND id = ANY($2::text[])`, [userId, owned]);
      return { affected: r.rowCount ?? 0 };
    }
    default:
      throw new ActivityError(400, 'Unknown action');
  }
}
