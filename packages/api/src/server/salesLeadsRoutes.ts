// ─────────────────────────────────────────────────────────────────────────────
// Sales → Lead workspace API: activity log, human reminders, reminder settings.
//
// Mounted at /api/sales BEFORE registerSalesRoutes, so literal paths here win
// over that router's /leads/:contactId. Paths are relative to the mount — never
// include '/api/' in them.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import type { Response, Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';

import { isValidIanaTimezone } from './timezones.ts';
import { REMINDER_CHANNELS } from './sales/activityReader.ts';
import {
  ACTIVITY_TYPES,
  ActivityError,
  assertOwnedContact,
  cancelReminder,
  confirmReminder,
  createLeadActivity,
  listLeadActivity,
  referenceTimezone,
  rescheduleReminder,
  RESPONSE_STATUSES,
} from './sales/leadActivities.ts';
import {
  bulkLeads,
  changeListMembers,
  createLeadList,
  createWorkspaceLead,
  deleteLeadList,
  FIELD_TYPES,
  getLeadFields,
  getWorkspaceLead,
  LIST_SOURCE_TYPES,
  listLeadLists,
  putLeadFields,
  queryLeads,
  updateLeadList,
  updateWorkspaceLead,
  type LeadQuery,
} from './sales/leadWorkspace.ts';
import { analyzeImport, commitImport, type ColumnTarget } from './sales/salesSheetImport.ts';
import { leadOverview } from './sales/leadOverview.ts';
import {
  generateDailyPlan,
  getStoredPlan,
  MAX_DAILY_CALL_TARGET,
  retryActivityReads,
  setDailyCallTarget,
  setPlanTaskDone,
  todaySnapshot,
} from './sales/dailyPlan.ts';

interface Deps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool;
}

const dueLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use YYYY-MM-DDTHH:mm');
const timezone = z.string().max(64).refine(isValidIanaTimezone, 'Not a valid IANA timezone');

const createActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  body: z.string().max(5000).nullish(),
  follow_up_round: z.number().int().min(1).max(50).nullish(),
  response_status: z.enum(RESPONSE_STATUSES).nullish(),
  outcome: z.string().max(500).nullish(),
  occurred_at: z.string().datetime({ offset: true }).nullish(),
  manual_followup: z.object({
    due_local: dueLocal,
    due_tz: timezone.nullish(),
    channel: z.enum(REMINDER_CHANNELS).nullish(),
    reason: z.string().max(500).nullish(),
  }).nullish(),
  completes_followup_id: z.string().max(64).nullish(),
  /** false = store only (used by import); default runs the AI reader. */
  run_ai: z.boolean().optional(),
});

const updateActivitySchema = z.object({
  body: z.string().max(5000).nullish(),
  follow_up_round: z.number().int().min(1).max(50).nullish(),
  response_status: z.enum(RESPONSE_STATUSES).nullish(),
  outcome: z.string().max(500).nullish(),
});

const rescheduleSchema = z.object({
  due_local: dueLocal,
  due_tz: timezone.nullish(),
  channel: z.enum(REMINDER_CHANNELS).nullish(),
  reason: z.string().max(500).nullish(),
});

const leadPatchSchema = z.object({
  first_name: z.string().max(120).nullish(),
  last_name: z.string().max(120).nullish(),
  email: z.string().max(254).nullish(),
  phone: z.string().max(40).nullish(),
  stage: z.string().max(40).nullish(),
  custom_data: z.record(z.unknown()).optional(),
});

const createLeadSchema = leadPatchSchema.extend({
  list_ids: z.array(z.string().max(64)).max(20).optional(),
});

const bulkSchema = z.object({
  contactIds: z.array(z.string().max(64)).min(1).max(1000),
  action: z.enum(['set_stage', 'add_to_list', 'remove_from_list', 'delete']),
  value: z.string().max(64).nullish(),
});

const listSchema = z.object({
  name: z.string().min(1).max(120),
  source_type: z.enum(LIST_SOURCE_TYPES).optional(),
  color: z.string().max(20).nullish(),
});

const listPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  source_type: z.enum(LIST_SOURCE_TYPES).optional(),
  color: z.string().max(20).nullish(),
  archived: z.boolean().optional(),
});

const membersSchema = z.object({
  add: z.array(z.string().max(64)).max(1000).optional(),
  remove: z.array(z.string().max(64)).max(1000).optional(),
});

const fieldsSchema = z.object({
  fields: z.array(z.object({
    key: z.string().max(60).nullish(),
    label: z.string().max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().max(80)).max(50).nullish(),
    width: z.number().int().min(60).max(800).nullish(),
    hidden: z.boolean().optional(),
  })).max(80),
});

const importFileSchema = z.object({
  fileBase64: z.string().min(1).max(17_000_000),
  fileName: z.string().min(1).max(200),
});

const columnTarget = z.string().regex(/^(full_name|first_name|last_name|email|phone|skip|custom:[a-z_][a-z0-9_]{0,39}|round:\d{1,2})$/);

const importCommitSchema = importFileSchema.extend({
  blocks: z.array(z.object({
    index: z.number().int().min(0),
    include: z.boolean(),
    listName: z.string().max(120),
    sourceType: z.enum(LIST_SOURCE_TYPES),
    mapping: z.record(z.string().regex(/^\d{1,2}$/), columnTarget),
    // The section as analyse returned it (AI readings are not repeatable).
    sheet: z.string().max(200).optional(),
    rows: z.array(z.number().int().min(0).max(100_000)).max(5_000).optional(),
    headers: z.record(z.string().regex(/^\d{1,2}$/), z.string().max(200)).optional(),
  })).min(1).max(100),
});

const importAnalyzeSchema = importFileSchema.extend({
  useAi: z.boolean().optional(),
  sheets: z.array(z.string().max(200)).max(100).optional(),
});

const settingsSchema = z.object({
  timezone: timezone.nullish(),
  lead_digest_enabled: z.boolean().optional(),
});

/** Same 400 shape as middleware/validate.ts; inline so Express keeps the route's param types. */
function parseBody<T>(schema: z.ZodType<T>, req: { body: unknown }, res: Response): T | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  res.status(400).json({
    success: false,
    error: 'Validation failed',
    issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
  return null;
}

export function registerSalesLeadsRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();
  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });
  const handle = (res: Response, err: unknown, logKey: string, message: string) => {
    if (err instanceof ActivityError) return fail(res, err.status, err.message);
    logger.error({ err }, logKey);
    return fail(res, 500, message);
  };

  // ─── Activities ───────────────────────────────────────────────────────────

  router.get('/leads/:contactId/activities', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const data = await listLeadActivity(pool, auth.userId, req.params.contactId);
      const tz = await referenceTimezone(pool, auth.userId, req.params.contactId);
      res.json({ success: true, timezone: tz, ...data });
    } catch (err) {
      handle(res, err, 'sales_activities_list_failed', 'Failed to load activity');
    }
  });

  router.post('/leads/:contactId/activities', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(createActivitySchema, req, res);
    if (!b) return;
    try {
      const result = await createLeadActivity(pool, auth.userId, req.params.contactId, {
        type: b.type,
        body: b.body ?? null,
        followUpRound: b.follow_up_round ?? null,
        responseStatus: b.response_status ?? null,
        outcome: b.outcome ?? null,
        occurredAt: b.occurred_at ?? null,
        manualFollowup: b.manual_followup
          ? { dueLocal: b.manual_followup.due_local, dueTz: b.manual_followup.due_tz ?? null, channel: b.manual_followup.channel ?? null, reason: b.manual_followup.reason ?? null }
          : null,
        completesFollowupId: b.completes_followup_id ?? null,
      }, { runReader: b.run_ai !== false });
      res.json({ success: true, ...result });
    } catch (err) {
      handle(res, err, 'sales_activity_create_failed', 'Failed to save activity');
    }
  });

  router.patch('/activities/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(updateActivitySchema, req, res);
    if (!b) return;
    try {
      // Editing a note does not re-run the reader: the reminder card is the
      // place to change a reminder, and re-reading would surprise the user.
      const { rows } = await pool.query(
        `UPDATE crm_activities
            SET body = CASE WHEN $3::boolean THEN $4 ELSE body END,
                follow_up_round = CASE WHEN $5::boolean THEN $6 ELSE follow_up_round END,
                response_status = CASE WHEN $7::boolean THEN $8 ELSE response_status END,
                outcome = CASE WHEN $9::boolean THEN $10 ELSE outcome END,
                updated_at = NOW()
          WHERE id=$1 AND user_id=$2 AND contact_id IS NOT NULL
          RETURNING id, type, title, body, outcome, follow_up_round, response_status, ai_status, completed_at, created_at`,
        [
          req.params.id, auth.userId,
          'body' in b, b.body?.trim() || null,
          'follow_up_round' in b, b.follow_up_round ?? null,
          'response_status' in b, b.response_status ?? null,
          'outcome' in b, b.outcome?.trim() || null,
        ],
      );
      if (!rows[0]) return fail(res, 404, 'Activity not found');
      res.json({ success: true, activity: rows[0] });
    } catch (err) {
      handle(res, err, 'sales_activity_update_failed', 'Failed to update activity');
    }
  });

  router.delete('/activities/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      // A reminder the note created stays (source_activity_id → NULL) unless it
      // has not fired yet, in which case it goes with the note.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE sales_followups SET status='cancelled', updated_at=NOW()
            WHERE source_activity_id=$1 AND user_id=$2 AND mode='human' AND status='scheduled'`,
          [req.params.id, auth.userId],
        );
        const del = await client.query(`DELETE FROM crm_activities WHERE id=$1 AND user_id=$2 AND contact_id IS NOT NULL`, [req.params.id, auth.userId]);
        if (!del.rowCount) {
          await client.query('ROLLBACK');
          return fail(res, 404, 'Activity not found');
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      res.json({ success: true });
    } catch (err) {
      handle(res, err, 'sales_activity_delete_failed', 'Failed to delete activity');
    }
  });

  // ─── Human reminders ──────────────────────────────────────────────────────

  router.post('/followups/:id/confirm', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, reminder: await confirmReminder(pool, auth.userId, req.params.id) });
    } catch (err) {
      handle(res, err, 'sales_reminder_confirm_failed', 'Failed to confirm reminder');
    }
  });

  router.post('/followups/:id/cancel', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, reminder: await cancelReminder(pool, auth.userId, req.params.id) });
    } catch (err) {
      handle(res, err, 'sales_reminder_cancel_failed', 'Failed to remove reminder');
    }
  });

  router.post('/followups/:id/reschedule', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(rescheduleSchema, req, res);
    if (!b) return;
    try {
      const reminder = await rescheduleReminder(pool, auth.userId, req.params.id, {
        dueLocal: b.due_local, dueTz: b.due_tz ?? null, channel: b.channel ?? null, reason: b.reason ?? null,
      });
      res.json({ success: true, reminder });
    } catch (err) {
      handle(res, err, 'sales_reminder_reschedule_failed', 'Failed to reschedule reminder');
    }
  });

  /** A reminder created by hand for a lead, without logging an activity. */
  router.post('/leads/:contactId/reminders', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(rescheduleSchema, req, res);
    if (!b) return;
    try {
      await assertOwnedContact(pool, auth.userId, req.params.contactId);
      const result = await createLeadActivity(pool, auth.userId, req.params.contactId, {
        type: 'task',
        body: b.reason ?? 'Follow-up scheduled',
        manualFollowup: { dueLocal: b.due_local, dueTz: b.due_tz ?? null, channel: b.channel ?? null, reason: b.reason ?? null },
      }, { runReader: false });
      res.json({ success: true, reminder: result.reminder, activity: result.activity });
    } catch (err) {
      handle(res, err, 'sales_reminder_create_failed', 'Failed to create reminder');
    }
  });

  // ─── Workspace: leads ─────────────────────────────────────────────────────

  router.get('/workspace/leads', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const q = req.query as Record<string, string | undefined>;
    try {
      const due = ['today', 'overdue', 'week', 'needs_confirmation'].includes(q.due ?? '') ? q.due as LeadQuery['due'] : null;
      const sort = ['recent', 'name', 'next_followup', 'last_contacted'].includes(q.sort ?? '') ? q.sort as LeadQuery['sort'] : null;
      const result = await queryLeads(pool, auth.userId, {
        listId: q.listId || null,
        search: q.search?.slice(0, 120) || null,
        stage: q.stage || null,
        responseStatus: q.responseStatus || null,
        due,
        neverContacted: q.neverContacted === 'true',
        sort,
        limit: Number(q.limit) || 100,
        offset: Number(q.offset) || 0,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      handle(res, err, 'sales_workspace_leads_failed', 'Failed to load leads');
    }
  });

  router.post('/workspace/leads/bulk', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(bulkSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, ...(await bulkLeads(pool, auth.userId, b.contactIds, b.action, b.value ?? null)) });
    } catch (err) {
      handle(res, err, 'sales_workspace_bulk_failed', 'Bulk action failed');
    }
  });

  router.post('/workspace/leads', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(createLeadSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, lead: await createWorkspaceLead(pool, auth.userId, b) });
    } catch (err) {
      handle(res, err, 'sales_workspace_lead_create_failed', 'Failed to create lead');
    }
  });

  router.get('/workspace/leads/:contactId', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, lead: await getWorkspaceLead(pool, auth.userId, req.params.contactId) });
    } catch (err) {
      handle(res, err, 'sales_workspace_lead_failed', 'Failed to load lead');
    }
  });

  router.patch('/workspace/leads/:contactId', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(leadPatchSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, lead: await updateWorkspaceLead(pool, auth.userId, req.params.contactId, b) });
    } catch (err) {
      handle(res, err, 'sales_workspace_lead_update_failed', 'Failed to update lead');
    }
  });

  // ─── Lists ────────────────────────────────────────────────────────────────

  router.get('/lists', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, lists: await listLeadLists(pool, auth.userId) });
    } catch (err) {
      handle(res, err, 'sales_lists_failed', 'Failed to load lists');
    }
  });

  router.post('/lists', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(listSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, list: await createLeadList(pool, auth.userId, b) });
    } catch (err) {
      handle(res, err, 'sales_list_create_failed', 'Failed to create list');
    }
  });

  router.patch('/lists/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(listPatchSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, list: await updateLeadList(pool, auth.userId, req.params.id, b) });
    } catch (err) {
      handle(res, err, 'sales_list_update_failed', 'Failed to update list');
    }
  });

  router.delete('/lists/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await deleteLeadList(pool, auth.userId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      handle(res, err, 'sales_list_delete_failed', 'Failed to delete list');
    }
  });

  router.post('/lists/:id/members', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(membersSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, ...(await changeListMembers(pool, auth.userId, req.params.id, b.add ?? [], b.remove ?? [])) });
    } catch (err) {
      handle(res, err, 'sales_list_members_failed', 'Failed to update list');
    }
  });

  // ─── Columns ──────────────────────────────────────────────────────────────

  router.get('/fields', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, fields: await getLeadFields(pool, auth.userId) });
    } catch (err) {
      handle(res, err, 'sales_fields_failed', 'Failed to load columns');
    }
  });

  router.put('/fields', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(fieldsSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, fields: await putLeadFields(pool, auth.userId, b.fields) });
    } catch (err) {
      handle(res, err, 'sales_fields_update_failed', 'Failed to save columns');
    }
  });

  // ─── Import + overview ────────────────────────────────────────────────────

  router.post('/import/analyze', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(importAnalyzeSchema, req, res);
    if (!b) return;
    try {
      res.json({ success: true, ...(await analyzeImport(b.fileBase64, b.fileName, { userId: auth.userId, useAi: b.useAi, sheets: b.sheets })) });
    } catch (err) {
      handle(res, err, 'sales_import_analyze_failed', 'Could not read that file');
    }
  });

  router.post('/import/commit', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(importCommitSchema, req, res);
    if (!b) return;
    try {
      const summary = await commitImport(pool, auth.userId, {
        fileBase64: b.fileBase64,
        fileName: b.fileName,
        blocks: b.blocks.map((x) => ({ ...x, mapping: x.mapping as Record<string, ColumnTarget> })),
      });
      res.json({ success: true, ...summary });
    } catch (err) {
      handle(res, err, 'sales_import_commit_failed', 'Import failed');
    }
  });

  router.get('/workspace/overview', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, ...(await leadOverview(pool, auth.userId)) });
    } catch (err) {
      handle(res, err, 'sales_overview_failed', 'Failed to load overview');
    }
  });

  // ─── Today: call queue, call target, AI to-do list ────────────────────────

  router.get('/workspace/today', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const snapshot = await todaySnapshot(pool, auth.userId);
      const plan = await getStoredPlan(pool, auth.userId, snapshot.date);
      res.json({ success: true, ...snapshot, plan });
    } catch (err) {
      handle(res, err, 'sales_today_failed', "Failed to load today's plan");
    }
  });

  router.post('/workspace/today/plan', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, plan: await generateDailyPlan(pool, auth.userId) });
    } catch (err) {
      handle(res, err, 'sales_today_plan_failed', 'Failed to write the plan');
    }
  });

  router.patch('/workspace/today/plan/tasks/:index', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: z.boolean() }), req, res);
    if (!b) return;
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index > 50) return fail(res, 400, 'Invalid task');
    try {
      const plan = await setPlanTaskDone(pool, auth.userId, b.date, index, b.done);
      if (!plan) return fail(res, 404, 'Task not found');
      res.json({ success: true, plan });
    } catch (err) {
      handle(res, err, 'sales_today_task_failed', 'Failed to update the task');
    }
  });

  router.put('/workspace/today/target', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(z.object({ target: z.number().int().min(1).max(MAX_DAILY_CALL_TARGET) }), req, res);
    if (!b) return;
    try {
      res.json({ success: true, target: await setDailyCallTarget(pool, auth.userId, b.target) });
    } catch (err) {
      handle(res, err, 'sales_today_target_failed', 'Failed to save the call target');
    }
  });

  router.post('/workspace/today/retry-ai', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, queued: await retryActivityReads(pool, auth.userId) });
    } catch (err) {
      handle(res, err, 'sales_today_retry_ai_failed', 'Failed to queue the notes');
    }
  });

  // ─── Reminder settings (timezone + daily digest) ──────────────────────────

  router.get('/reminder-settings', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await pool.query(`SELECT timezone, lead_digest_enabled FROM users WHERE id=$1`, [auth.userId]);
      res.json({ success: true, timezone: rows[0]?.timezone ?? null, lead_digest_enabled: rows[0]?.lead_digest_enabled ?? true });
    } catch (err) {
      handle(res, err, 'sales_reminder_settings_failed', 'Failed to load settings');
    }
  });

  router.put('/reminder-settings', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const b = parseBody(settingsSchema, req, res);
    if (!b) return;
    try {
      const { rows } = await pool.query(
        `UPDATE users
            SET timezone = CASE WHEN $2::boolean THEN $3 ELSE timezone END,
                lead_digest_enabled = COALESCE($4, lead_digest_enabled)
          WHERE id=$1
          RETURNING timezone, lead_digest_enabled`,
        [auth.userId, 'timezone' in b, b.timezone ?? null, b.lead_digest_enabled ?? null],
      );
      res.json({ success: true, ...rows[0] });
    } catch (err) {
      handle(res, err, 'sales_reminder_settings_update_failed', 'Failed to save settings');
    }
  });

  return router;
}
