import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// What the user likes and doesn't like, learned from what they do:
// rewriting a caption, moving a post to another time, deleting an AI post,
// rejecting or sending back Autopilot work, thumbs up / down in the chat, and
// anything they tell an agent to remember. Every agent reads the latest
// entries before it works (chat prompt + shared agent context).
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type PreferenceKind = 'like' | 'dislike' | 'change' | 'rule';
export type PreferenceSubject = 'post' | 'design' | 'strategy' | 'schedule' | 'reply' | 'general';

export interface Preference {
  id: string;
  kind: PreferenceKind;
  subject: PreferenceSubject;
  note: string;
  source: string;
  created_at: string;
}

const MAX_PER_USER = 300;

let ensured: Promise<void> | null = null;
export function ensurePreferenceTable(query: Query): Promise<void> {
  ensured ??= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS user_preference_memory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT 'general',
        note TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        ref_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`CREATE INDEX IF NOT EXISTS user_preference_memory_user_idx ON user_preference_memory(user_id, created_at DESC)`);
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

/** Called after a preference is saved (e.g. to drop cached agent context). */
let onChange: ((userId: string) => void) | null = null;
export function onPreferenceChange(fn: (userId: string) => void): void { onChange = fn; }

/** Saves one learned preference. Never throws; the same note twice in a day is kept once. */
export async function recordPreference(query: Query, userId: string | null | undefined, p: {
  kind: PreferenceKind; subject: PreferenceSubject; note: string; source: string; refId?: string | null;
}): Promise<void> {
  const note = String(p.note || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!userId || !note) return;
  try {
    await ensurePreferenceTable(query);
    const dup = await query(
      `SELECT 1 FROM user_preference_memory WHERE user_id=$1 AND note=$2 AND created_at > NOW() - INTERVAL '1 day' LIMIT 1`,
      [userId, note],
    );
    if (dup.rows.length) return;
    await query(
      `INSERT INTO user_preference_memory (id, user_id, kind, subject, note, source, ref_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), userId, p.kind, p.subject, note, p.source.slice(0, 60), p.refId ?? null],
    );
    await query(
      `DELETE FROM user_preference_memory WHERE user_id=$1 AND id IN (
         SELECT id FROM user_preference_memory WHERE user_id=$1 ORDER BY created_at DESC OFFSET $2)`,
      [userId, MAX_PER_USER],
    );
    onChange?.(userId);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'preference_record_failed');
  }
}

export async function listPreferences(query: Query, userId: string, limit = 60): Promise<Preference[]> {
  try {
    await ensurePreferenceTable(query);
    const { rows } = await query(
      `SELECT id, kind, subject, note, source, created_at FROM user_preference_memory WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), MAX_PER_USER)],
    );
    return rows as Preference[];
  } catch {
    return [];
  }
}

export async function deletePreference(query: Query, userId: string, id: string): Promise<void> {
  await ensurePreferenceTable(query);
  await query(`DELETE FROM user_preference_memory WHERE user_id=$1 AND id=$2`, [userId, id]);
  onChange?.(userId);
}

const LABEL: Record<PreferenceKind, string> = { like: 'Liked', dislike: 'Disliked', change: 'Changed', rule: 'Told us' };

/** The block agents read before every task: newest first, grouped by kind. */
export function preferencesBlock(prefs: Preference[], max = 40): string {
  if (!prefs.length) return '';
  const lines = prefs.slice(0, max).map((p) => `- ${LABEL[p.kind] ?? p.kind} (${p.subject}): ${p.note}`);
  return `## WHAT THIS USER LIKES AND DOESN'T (learned from their edits, deletions, reviews and feedback — newest first)\nApply these on every task: repeat what they liked, never repeat what they disliked or changed away from. Custom instructions still come first.\n${lines.join('\n')}`;
}

function clip(s: string, n = 220): string {
  const t = String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** A note describing how the user rewrote a post (what they kept is a like; what they changed is the lesson). */
export function describeEdit(before: string, after: string, what: string): string | null {
  const a = clip(before, 4000);
  const b = clip(after, 4000);
  if (!a || !b || a === b) return null;
  const traits: string[] = [];
  if (b.length < a.length * 0.7) traits.push('made it shorter');
  if (b.length > a.length * 1.4) traits.push('made it longer');
  const emoji = (s: string) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emoji(b) < emoji(a)) traits.push('removed emojis');
  if (emoji(b) > emoji(a)) traits.push('added emojis');
  const tags = (s: string) => (s.match(/#\w+/g) ?? []).length;
  if (tags(b) < tags(a)) traits.push('used fewer hashtags');
  if (tags(b) > tags(a)) traits.push('used more hashtags');
  if (/[!]{1}/.test(a) && !/[!]/.test(b)) traits.push('dropped exclamation marks');
  return `Rewrote ${what}${traits.length ? ` (${traits.join(', ')})` : ''}. Before: «${clip(a)}» After: «${clip(b)}»`;
}

export function describeReschedule(before: string | null, after: string | null, what: string, tz = 'UTC'): string | null {
  if (!before || !after) return null;
  const d1 = new Date(before);
  const d2 = new Date(after);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()) || Math.abs(d1.getTime() - d2.getTime()) < 60_000) return null;
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  return `Moved ${what} from ${fmt(d1)} to ${fmt(d2)} (${tz}) — prefers that posting time`;
}

const AI_SOURCES = new Set(['chat', 'content_plan', 'autopilot', 'agent', 'workflow']);
function postLabel(row: any): string {
  const platform = row?.social_platform ? String(row.social_platform) : '';
  const format = row?.post_format && row.post_format !== 'blog' ? String(row.post_format).replace('_', ' ') : '';
  return `${platform ? `a ${platform}${format ? ` ${format}` : ''} post` : 'a post'} "${clip(row?.title || '', 60)}"`;
}
function teaches(row: any): boolean {
  return Boolean(row?.social_platform) || AI_SOURCES.has(String(row?.source || ''));
}

/** Learns from a post the user changed: rewritten text, a new time. */
export async function learnFromPostUpdate(query: Query, userId: string, before: any, after: any): Promise<void> {
  if (!before || !after || !teaches(before)) return;
  const edit = describeEdit(String(before.content || ''), String(after.content || ''), postLabel(before));
  if (edit) await recordPreference(query, userId, { kind: 'change', subject: 'post', note: edit, source: 'post_edit', refId: before.id });
  if (before.scheduled_at && after.scheduled_at) {
    const moved = describeReschedule(String(before.scheduled_at), String(after.scheduled_at), postLabel(before));
    if (moved) await recordPreference(query, userId, { kind: 'change', subject: 'schedule', note: moved, source: 'post_reschedule', refId: before.id });
  }
}

/** Learns from an AI-made post the user removed before it went out. */
export async function learnFromPostDelete(query: Query, userId: string, row: any): Promise<void> {
  if (!row || !teaches(row) || row.status === 'published') return;
  await recordPreference(query, userId, {
    kind: 'dislike', subject: 'post', source: 'post_delete', refId: row.id,
    note: `Deleted ${postLabel(row)} before it was published. It said: «${clip(row.content || row.excerpt || '', 200)}»`,
  });
}
