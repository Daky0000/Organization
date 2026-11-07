// ─────────────────────────────────────────────────────────────────────────────
// Lead activity log + human reminders.
//
// An activity is a crm_activities row (call / whatsapp / note …) with an
// optional follow-up round and response status. After it is saved, the
// activity reader looks at the note; when it implies a next step, a HUMAN
// reminder (sales_followups.mode='human', type='task') is created. Human
// reminders are never dialled — processDueFollowUps only claims mode='ai_agent'.
//
// The reader runs inline with a short timeout so the salesperson sees the
// reminder card straight away. If it is slow or fails, the activity is left
// 'pending' and processPendingActivityReads() retries it. The unique index on
// sales_followups.source_activity_id makes a second reminder for the same note
// impossible, whichever path gets there first.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { logger } from '../../logger.ts';
import { isValidIanaTimezone, resolveZonedLocal } from '../timezones.ts';
import {
  buildReaderUserMessage,
  NoAIProviderError,
  REMINDER_CHANNELS,
  resolveReminder,
  runActivityReader,
  runActivityReaderWithTimeout,
  type ReaderRun,
  type ReminderChannel,
} from './activityReader.ts';

export const ACTIVITY_TYPES = ['note', 'call', 'whatsapp', 'sms', 'email', 'meeting', 'task'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Replaces the colour coding of the client's sheet. Mirrored in web salesService.ts. */
export const RESPONSE_STATUSES = [
  'no_answer', 'unreachable', 'call_back', 'interested', 'not_interested', 'registered', 'paid',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export const DEFAULT_TIMEZONE = 'Africa/Accra';
export const INLINE_READER_TIMEOUT_MS = 8000;
export const MAX_READER_ATTEMPTS = 3;

/** Activity types that count as reaching out (update last_contacted_at). */
const CONTACT_TYPES = new Set<ActivityType>(['call', 'whatsapp', 'sms', 'email', 'meeting']);

export class ActivityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface CreateActivityInput {
  type: ActivityType;
  body: string | null;
  followUpRound?: number | null;
  responseStatus?: ResponseStatus | null;
  outcome?: string | null;
  occurredAt?: string | null;
  manualFollowup?: { dueLocal: string; dueTz?: string | null; channel?: ReminderChannel | null; reason?: string | null } | null;
  completesFollowupId?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export async function assertOwnedContact(pool: Pool | PoolClient, userId: string, contactId: string): Promise<void> {
  const { rowCount } = await pool.query(`SELECT 1 FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [contactId, userId]);
  if (!rowCount) throw new ActivityError(404, 'Lead not found');
}

/** Lead's zone → user's zone → call-policy default → Africa/Accra. */
export async function referenceTimezone(pool: Pool | PoolClient, userId: string, contactId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT (SELECT timezone FROM sales_lead_profiles WHERE contact_id=$2 AND user_id=$1) AS lead_tz,
            (SELECT timezone FROM users WHERE id=$1) AS user_tz,
            (SELECT default_timezone FROM sales_call_policies WHERE user_id=$1) AS policy_tz`,
    [userId, contactId],
  );
  const r = rows[0] ?? {};
  for (const tz of [r.lead_tz, r.user_tz, r.policy_tz]) {
    if (typeof tz === 'string' && isValidIanaTimezone(tz)) return tz;
  }
  return DEFAULT_TIMEZONE;
}

async function leadProfileId(client: Pool | PoolClient, userId: string, contactId: string): Promise<string | null> {
  const { rows } = await client.query(
    `INSERT INTO sales_lead_profiles (id, user_id, contact_id)
     VALUES ($1,$2,$3) ON CONFLICT (contact_id) DO UPDATE SET updated_at=NOW()
     RETURNING id`,
    [randomUUID(), userId, contactId],
  );
  return rows[0]?.id ?? null;
}

const FOLLOWUP_COLUMNS = `id, contact_id, status, mode, channel, scheduled_for, due_tz, reason, requested_by,
  needs_confirmation, ai_confidence, exact_time_requested, source_activity_id, completed_activity_id, notified_at, created_at`;

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listLeadActivity(pool: Pool, userId: string, contactId: string) {
  await assertOwnedContact(pool, userId, contactId);
  const [activities, followups] = await Promise.all([
    pool.query(
      `SELECT id, type, title, body, outcome, follow_up_round, response_status, ai_status,
              completed_at, created_at
         FROM crm_activities
        WHERE user_id=$1 AND contact_id=$2
        ORDER BY COALESCE(completed_at, created_at) DESC
        LIMIT 200`,
      [userId, contactId],
    ),
    pool.query(
      `SELECT ${FOLLOWUP_COLUMNS} FROM sales_followups
        WHERE user_id=$1 AND contact_id=$2 AND mode='human'
        ORDER BY (status='scheduled') DESC, scheduled_for ASC
        LIMIT 100`,
      [userId, contactId],
    ),
  ]);
  return { activities: activities.rows, followups: followups.rows };
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Inserts a human reminder. Returns the row, or null when this activity
 * already produced one (unique source_activity_id).
 */
async function insertHumanReminder(client: Pool | PoolClient, p: {
  userId: string; contactId: string; activityId: string | null;
  dueAt: string; dueTz: string; channel: ReminderChannel; reason: string;
  requestedBy: 'agent' | 'human'; exactTime: boolean; confidence: number | null; needsConfirmation: boolean;
}) {
  const profileId = await leadProfileId(client, p.userId, p.contactId);
  const { rows } = await client.query(
    `INSERT INTO sales_followups
       (id, user_id, contact_id, lead_profile_id, type, mode, channel, requested_by, scheduled_for,
        exact_time_requested, reason, source_activity_id, due_tz, ai_confidence, needs_confirmation)
     VALUES ($1,$2,$3,$4,'task','human',$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (source_activity_id) WHERE source_activity_id IS NOT NULL DO NOTHING
     RETURNING ${FOLLOWUP_COLUMNS}`,
    [
      randomUUID(), p.userId, p.contactId, profileId, p.channel, p.requestedBy, p.dueAt,
      p.exactTime, p.reason.slice(0, 500), p.activityId, p.dueTz, p.confidence, p.needsConfirmation,
    ],
  );
  return rows[0] ?? null;
}

export function parseDueLocal(dueLocal: string, tz: string): string {
  const r = resolveZonedLocal(dueLocal, tz);
  if (r.ok) return r.iso;
  if (r.reason === 'invalid_timezone') throw new ActivityError(400, `"${tz}" is not a valid timezone`);
  if (r.reason === 'dst_gap') throw new ActivityError(400, `${dueLocal} does not exist in ${tz} (daylight-saving change)`);
  throw new ActivityError(400, 'Follow-up time must be YYYY-MM-DDTHH:mm');
}

/**
 * Saves an activity and, unless the user scheduled the follow-up by hand, asks
 * the reader whether the note implies one.
 */
export async function createLeadActivity(pool: Pool, userId: string, contactId: string, input: CreateActivityInput, opts: {
  runReader?: boolean; inlineTimeoutMs?: number; now?: () => number;
} = {}) {
  await assertOwnedContact(pool, userId, contactId);
  const now = opts.now ?? Date.now;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) throw new ActivityError(400, 'occurred_at is not a valid date');

  const body = input.body?.trim() || null;
  const manual = input.manualFollowup ?? null;
  const readerWanted = opts.runReader !== false && !manual && !!body;

  const client = await pool.connect();
  let activity: any;
  let reminder: any = null;
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO crm_activities
         (id, user_id, contact_id, type, body, outcome, follow_up_round, response_status, completed_at, ai_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, NOW()),$10)
       RETURNING id, type, title, body, outcome, follow_up_round, response_status, ai_status, completed_at, created_at`,
      [
        randomUUID(), userId, contactId, input.type, body, input.outcome?.trim() || null,
        input.followUpRound ?? null, input.responseStatus ?? null, occurredAt,
        readerWanted ? 'processing' : 'none',
      ],
    );
    activity = ins.rows[0];

    if (CONTACT_TYPES.has(input.type)) {
      await leadProfileId(client, userId, contactId);
      await client.query(
        `UPDATE sales_lead_profiles
            SET last_contacted_at = GREATEST(COALESCE(last_contacted_at, 'epoch'), $3), updated_at=NOW()
          WHERE contact_id=$1 AND user_id=$2`,
        [contactId, userId, activity.completed_at],
      );
    }

    if (input.completesFollowupId) {
      const done = await client.query(
        `UPDATE sales_followups SET status='completed', completed_activity_id=$1, updated_at=NOW()
          WHERE id=$2 AND user_id=$3 AND contact_id=$4 AND mode='human' AND status='scheduled'`,
        [activity.id, input.completesFollowupId, userId, contactId],
      );
      if (!done.rowCount) throw new ActivityError(404, 'Follow-up to complete not found');
    }

    if (manual) {
      const tz = manual.dueTz && isValidIanaTimezone(manual.dueTz) ? manual.dueTz : await referenceTimezone(client, userId, contactId);
      const dueAt = parseDueLocal(manual.dueLocal, tz);
      if (Date.parse(dueAt) <= now()) throw new ActivityError(400, 'Follow-up time must be in the future');
      reminder = await insertHumanReminder(client, {
        userId, contactId, activityId: activity.id, dueAt, dueTz: tz,
        channel: manual.channel ?? 'call', reason: manual.reason?.trim() || body?.slice(0, 140) || 'Follow up',
        requestedBy: 'human', exactTime: true, confidence: null, needsConfirmation: false,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  let ai: 'done' | 'pending' | 'skipped' | 'failed' | 'none' = manual ? 'skipped' : 'none';
  if (readerWanted) {
    const result = await readActivity(pool, userId, contactId, activity.id, {
      inlineTimeoutMs: opts.inlineTimeoutMs ?? INLINE_READER_TIMEOUT_MS, now,
    });
    ai = result.status;
    reminder = result.reminder;
    activity.ai_status = result.status === 'pending' ? 'pending' : result.status;
  }
  return { activity, reminder, ai };
}

/**
 * Runs the reader for one activity and persists the outcome. Used inline (with
 * a timeout) and by the retry worker (without one).
 */
export async function readActivity(pool: Pool, userId: string, contactId: string, activityId: string, opts: {
  inlineTimeoutMs?: number; now?: () => number; reader?: typeof runActivityReader;
}): Promise<{ status: 'done' | 'pending' | 'skipped' | 'failed'; reminder: any }> {
  const now = opts.now ?? Date.now;
  const { rows } = await pool.query(
    `SELECT a.type, a.body, a.follow_up_round, a.response_status, a.ai_attempts,
            c.first_name, c.last_name
       FROM crm_activities a JOIN mailing_contacts c ON c.id=a.contact_id
      WHERE a.id=$1 AND a.user_id=$2`,
    [activityId, userId],
  );
  const act = rows[0];
  if (!act?.body) {
    await pool.query(`UPDATE crm_activities SET ai_status='skipped', ai_processed_at=NOW() WHERE id=$1`, [activityId]);
    return { status: 'skipped', reminder: null };
  }

  const refTz = await referenceTimezone(pool, userId, contactId);
  const recent = await pool.query(
    `SELECT COALESCE(completed_at, created_at) AS at, type, body FROM crm_activities
      WHERE user_id=$1 AND contact_id=$2 AND id<>$3
      ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 3`,
    [userId, contactId, activityId],
  );
  const nowMs = now();
  const message = buildReaderUserMessage({
    note: act.body, nowMs, refTz, activityType: act.type, round: act.follow_up_round,
    responseStatus: act.response_status,
    leadName: [act.first_name, act.last_name].filter(Boolean).join(' ') || null,
    recent: recent.rows.reverse().map((r) => ({ at: new Date(r.at).toISOString().slice(0, 16), type: r.type, body: r.body })),
  });

  let run: ReaderRun | null;
  try {
    if (opts.reader) run = await opts.reader({ userId, message, note: act.body });
    else if (opts.inlineTimeoutMs) run = await runActivityReaderWithTimeout({ userId, message, note: act.body }, opts.inlineTimeoutMs);
    else run = await runActivityReader({ userId, message, note: act.body });
  } catch (err) {
    if (err instanceof NoAIProviderError) {
      await pool.query(`UPDATE crm_activities SET ai_status='skipped', ai_processed_at=NOW() WHERE id=$1`, [activityId]);
      return { status: 'skipped', reminder: null };
    }
    logger.warn({ err: err instanceof Error ? err.message : err, activityId }, 'sales_activity_reader_failed');
    run = null;
  }

  if (!run) {
    // Timed out or errored: hand it to the retry worker.
    const attempts = Number(act.ai_attempts ?? 0) + 1;
    const status = attempts >= MAX_READER_ATTEMPTS ? 'failed' : 'pending';
    await pool.query(
      `UPDATE crm_activities SET ai_status=$2, ai_attempts=$3, updated_at=NOW() WHERE id=$1`,
      [activityId, status, attempts],
    );
    return { status: status === 'failed' ? 'failed' : 'pending', reminder: null };
  }

  const resolved = resolveReminder(run.output, nowMs, refTz);
  let reminder: any = null;
  if (resolved) {
    reminder = await insertHumanReminder(pool, {
      userId, contactId, activityId, dueAt: resolved.dueAt, dueTz: resolved.dueTz,
      channel: resolved.channel, reason: resolved.reason, requestedBy: 'agent',
      exactTime: resolved.exactTime, confidence: resolved.confidence,
      // An injection-looking note never gets an unconfirmed reminder.
      needsConfirmation: resolved.needsConfirmation || run.suspicious,
    });
  }
  await pool.query(
    `UPDATE crm_activities SET ai_status='done', ai_result=$2, ai_processed_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [activityId, JSON.stringify({ output: run.output, model: run.model, provider: run.provider, suspicious: run.suspicious })],
  );
  return { status: 'done', reminder };
}

/** Retry worker: picks up activities whose inline read timed out or failed. */
export async function processPendingActivityReads(pool: Pool): Promise<void> {
  let claimed: Array<{ id: string; user_id: string; contact_id: string }> = [];
  try {
    const { rows } = await pool.query(
      `UPDATE crm_activities SET ai_status='processing', updated_at=NOW()
        WHERE id IN (
          SELECT id FROM crm_activities
           WHERE (ai_status='pending'
                  -- a process that died mid-read leaves 'processing' behind
                  OR (ai_status='processing' AND updated_at < NOW() - INTERVAL '10 minutes'))
             AND contact_id IS NOT NULL
           ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING id, user_id, contact_id`,
    );
    claimed = rows;
  } catch (err) {
    logger.error({ err }, 'sales_activity_reader_claim_failed');
    return;
  }
  for (const row of claimed) {
    try {
      await readActivity(pool, row.user_id, row.contact_id, row.id, {});
    } catch (err) {
      logger.error({ err, activityId: row.id }, 'sales_activity_reader_worker_failed');
      await pool.query(`UPDATE crm_activities SET ai_status='pending' WHERE id=$1`, [row.id]).catch(() => undefined);
    }
  }
}

// ── Reminder actions ────────────────────────────────────────────────────────

export async function confirmReminder(pool: Pool, userId: string, id: string) {
  const { rows } = await pool.query(
    `UPDATE sales_followups SET needs_confirmation=false, updated_at=NOW()
      WHERE id=$1 AND user_id=$2 AND mode='human' AND status='scheduled'
      RETURNING ${FOLLOWUP_COLUMNS}`,
    [id, userId],
  );
  if (!rows[0]) throw new ActivityError(404, 'Reminder not found');
  return rows[0];
}

export async function cancelReminder(pool: Pool, userId: string, id: string) {
  const { rows } = await pool.query(
    `UPDATE sales_followups SET status='cancelled', updated_at=NOW()
      WHERE id=$1 AND user_id=$2 AND mode='human' AND status='scheduled'
      RETURNING ${FOLLOWUP_COLUMNS}`,
    [id, userId],
  );
  if (!rows[0]) throw new ActivityError(404, 'Reminder not found');
  return rows[0];
}

export async function rescheduleReminder(pool: Pool, userId: string, id: string, input: {
  dueLocal: string; dueTz?: string | null; channel?: ReminderChannel | null; reason?: string | null;
}, now: () => number = Date.now) {
  const { rows: cur } = await pool.query(
    `SELECT contact_id, due_tz FROM sales_followups WHERE id=$1 AND user_id=$2 AND mode='human' AND status='scheduled'`,
    [id, userId],
  );
  if (!cur[0]) throw new ActivityError(404, 'Reminder not found');
  const tz = input.dueTz && isValidIanaTimezone(input.dueTz)
    ? input.dueTz
    : cur[0].due_tz && isValidIanaTimezone(cur[0].due_tz) ? cur[0].due_tz : await referenceTimezone(pool, userId, cur[0].contact_id);
  const dueAt = parseDueLocal(input.dueLocal, tz);
  if (Date.parse(dueAt) <= now()) throw new ActivityError(400, 'Follow-up time must be in the future');
  if (input.channel && !REMINDER_CHANNELS.includes(input.channel)) throw new ActivityError(400, 'Unknown channel');
  const { rows } = await pool.query(
    `UPDATE sales_followups
        SET scheduled_for=$3, due_tz=$4, channel=COALESCE($5, channel), reason=COALESCE($6, reason),
            needs_confirmation=false, exact_time_requested=true, notified_at=NULL, updated_at=NOW()
      WHERE id=$1 AND user_id=$2
      RETURNING ${FOLLOWUP_COLUMNS}`,
    [id, userId, dueAt, tz, input.channel ?? null, input.reason?.trim() || null],
  );
  return rows[0];
}
