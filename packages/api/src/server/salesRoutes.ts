// ─────────────────────────────────────────────────────────────────────────────
// AI Sales OS — REST API.
//
// Paths here are RELATIVE to the mount prefix (app.use('/api/sales', …)).
// Including '/api/' in a route path doubles the prefix and silently 404s every
// endpoint — that has bitten this codebase before.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import express from 'express';
import type { Response, Router } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { buildSalesEngine, type SalesEngine } from './sales/salesEngine.ts';
import { scoreCallWindows } from './sales/callTiming.ts';
import { runInsightAgent } from './sales/insightAgent.ts';
import {
  LEAD_STAGES,
  OBJECTION_LABELS,
  isLeadStage,
  type LeadStage,
} from './sales/types.ts';

interface Deps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool;
  salesEngine: SalesEngine;
}

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function registerSalesRoutes({ requireAuth, pool, salesEngine }: Deps): Router {
  const router = express.Router();

  const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });

  // ─── Leads ────────────────────────────────────────────────────────────────

  router.get('/leads', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { search, stage, limit = '50', offset = '0' } = req.query as Record<string, string>;
      const params: unknown[] = [auth.userId];
      let where = 'c.user_id=$1';
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
      }
      if (stage && isLeadStage(stage)) {
        params.push(stage);
        where += ` AND p.stage = $${params.length}`;
      }
      const [listRes, countRes] = await Promise.all([
        pool.query(
          `SELECT c.id AS contact_id, c.first_name, c.last_name, c.email, c.phone,
                  p.id AS profile_id, p.stage, p.do_not_call, p.consent_at, p.timezone,
                  p.human_handling, p.is_decision_maker, p.role_title, p.last_contacted_at,
                  p.next_action, p.next_action_at, p.attempt_count, p.consecutive_no_answer, p.summary,
                  (SELECT COUNT(*)::int FROM sales_conversations sc WHERE sc.contact_id=c.id) AS conversation_count,
                  (SELECT COUNT(*)::int FROM sales_conversation_objections o WHERE o.contact_id=c.id AND o.resolved=false) AS open_objections
             FROM mailing_contacts c
             LEFT JOIN sales_lead_profiles p ON p.contact_id = c.id
            WHERE ${where}
            ORDER BY p.next_action_at ASC NULLS LAST, c.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, Math.min(200, parseInt(limit, 10) || 50), parseInt(offset, 10) || 0],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS n FROM mailing_contacts c
             LEFT JOIN sales_lead_profiles p ON p.contact_id = c.id WHERE ${where}`,
          params,
        ),
      ]);
      res.json({ success: true, leads: listRes.rows, total: countRes.rows[0]?.n ?? 0 });
    } catch (err) {
      logger.error({ err }, 'sales_leads_list_failed');
      fail(res, 500, 'Failed to load leads');
    }
  });

  router.get('/leads/:contactId', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { contactId } = req.params;
      await salesEngine.ensureLeadProfile(auth.userId, contactId);
      const [leadRes, convRes, followUpRes, objectionRes, attemptRes] = await Promise.all([
        pool.query(
          `SELECT c.id AS contact_id, c.first_name, c.last_name, c.email, c.phone, c.custom_data,
                  p.*
             FROM mailing_contacts c
             LEFT JOIN sales_lead_profiles p ON p.contact_id = c.id
            WHERE c.id=$1 AND c.user_id=$2`,
          [contactId, auth.userId],
        ),
        pool.query(
          `SELECT id, channel, direction, started_at, duration_sec, summary, sentiment, intent,
                  recommended_action, analyst_confidence, analysis_status, analysis_error,
                  recording_url, commitments, promises, questions, buying_signals
             FROM sales_conversations WHERE contact_id=$1 AND user_id=$2
            ORDER BY started_at DESC LIMIT 50`,
          [contactId, auth.userId],
        ),
        pool.query(
          `SELECT * FROM sales_followups WHERE contact_id=$1 AND user_id=$2 ORDER BY scheduled_for DESC LIMIT 20`,
          [contactId, auth.userId],
        ),
        pool.query(
          `SELECT * FROM sales_conversation_objections WHERE contact_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30`,
          [contactId, auth.userId],
        ),
        pool.query(
          `SELECT id, provider, status, outcome, run_at, started_at, duration_sec, block_reason,
                  local_weekday, local_hour, last_error
             FROM sales_call_attempts WHERE contact_id=$1 AND user_id=$2
            ORDER BY created_at DESC LIMIT 30`,
          [contactId, auth.userId],
        ),
      ]);
      if (!leadRes.rows[0]) return fail(res, 404, 'Lead not found');
      res.json({
        success: true,
        lead: leadRes.rows[0],
        conversations: convRes.rows,
        followUps: followUpRes.rows,
        objections: objectionRes.rows,
        attempts: attemptRes.rows,
      });
    } catch (err) {
      logger.error({ err }, 'sales_lead_detail_failed');
      fail(res, 500, 'Failed to load lead');
    }
  });

  /** Create a lead. Phone-only is valid — that is why email is nullable. */
  router.post('/leads', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { first_name, last_name, email, phone, role_title, timezone, consent_source } = req.body ?? {};
      if (!phone && !email) return fail(res, 400, 'A lead needs at least a phone number or an email');

      const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
      const { rows } = await pool.query(
        `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source, subscribed)
         VALUES ($1,$2,$3,$4,$5,$6,'sales',true)
         ON CONFLICT (user_id, email) WHERE email IS NOT NULL
         DO UPDATE SET first_name=COALESCE(EXCLUDED.first_name, mailing_contacts.first_name),
                       phone=COALESCE(EXCLUDED.phone, mailing_contacts.phone), updated_at=NOW()
         RETURNING id`,
        [randomUUID(), auth.userId, normalizedEmail, first_name ?? null, last_name ?? null, phone ?? null],
      );
      const contactId = rows[0].id;
      await salesEngine.ensureLeadProfile(auth.userId, contactId);
      if (role_title || timezone || consent_source) {
        await pool.query(
          `UPDATE sales_lead_profiles
              SET role_title=COALESCE($1, role_title), timezone=COALESCE($2, timezone),
                  consent_source=COALESCE($3, consent_source),
                  consent_at=CASE WHEN $3::text IS NOT NULL THEN NOW() ELSE consent_at END,
                  updated_at=NOW()
            WHERE contact_id=$4 AND user_id=$5`,
          [role_title ?? null, timezone ?? null, consent_source ?? null, contactId, auth.userId],
        );
      }
      res.json({ success: true, contactId });
    } catch (err) {
      logger.error({ err }, 'sales_lead_create_failed');
      fail(res, 500, 'Failed to create lead');
    }
  });

  router.put('/leads/:contactId', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { stage, timezone, role_title, is_decision_maker, human_handling, consent_source } = req.body ?? {};
      if (stage && !isLeadStage(stage)) return fail(res, 400, `Unknown stage "${stage}"`);
      await salesEngine.ensureLeadProfile(auth.userId, req.params.contactId);
      await pool.query(
        `UPDATE sales_lead_profiles
            SET stage=COALESCE($1, stage), timezone=COALESCE($2, timezone),
                role_title=COALESCE($3, role_title), is_decision_maker=COALESCE($4, is_decision_maker),
                human_handling=COALESCE($5, human_handling),
                consent_source=COALESCE($6, consent_source),
                consent_at=CASE WHEN $6::text IS NOT NULL AND consent_at IS NULL THEN NOW() ELSE consent_at END,
                updated_at=NOW()
          WHERE contact_id=$7 AND user_id=$8`,
        [
          stage ?? null, timezone ?? null, role_title ?? null,
          typeof is_decision_maker === 'boolean' ? is_decision_maker : null,
          typeof human_handling === 'boolean' ? human_handling : null,
          consent_source ?? null, req.params.contactId, auth.userId,
        ],
      );
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'sales_lead_update_failed');
      fail(res, 500, 'Failed to update lead');
    }
  });

  /** Do-not-call is one-way through the API — cancelling queued work matters. */
  router.post('/leads/:contactId/dnc', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const reason = String(req.body?.reason ?? 'Marked by a user');
      await salesEngine.ensureLeadProfile(auth.userId, req.params.contactId);
      await pool.query(
        `UPDATE sales_lead_profiles SET do_not_call=true, do_not_call_reason=$1, do_not_call_at=NOW(), updated_at=NOW()
          WHERE contact_id=$2 AND user_id=$3`,
        [reason, req.params.contactId, auth.userId],
      );
      await pool.query(
        `UPDATE sales_followups SET status='cancelled', updated_at=NOW()
          WHERE contact_id=$1 AND user_id=$2 AND status IN ('scheduled','due')`,
        [req.params.contactId, auth.userId],
      );
      await pool.query(
        `UPDATE sales_call_attempts SET status='cancelled', block_reason='do_not_call', updated_at=NOW()
          WHERE contact_id=$1 AND user_id=$2 AND status='queued'`,
        [req.params.contactId, auth.userId],
      );
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'sales_dnc_failed');
      fail(res, 500, 'Failed to set do-not-call');
    }
  });

  // ─── Conversations ────────────────────────────────────────────────────────

  router.get('/conversations', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { limit = '50', offset = '0', intent } = req.query as Record<string, string>;
      const params: unknown[] = [auth.userId];
      let where = 'sc.user_id=$1';
      if (intent) {
        params.push(intent);
        where += ` AND sc.intent = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT sc.id, sc.contact_id, sc.channel, sc.started_at, sc.duration_sec, sc.summary,
                sc.sentiment, sc.intent, sc.recommended_action, sc.analyst_confidence,
                sc.analysis_status, sc.recording_url, sc.created_by,
                c.first_name, c.last_name, c.phone
           FROM sales_conversations sc
           LEFT JOIN mailing_contacts c ON c.id = sc.contact_id
          WHERE ${where}
          ORDER BY sc.started_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Math.min(200, parseInt(limit, 10) || 50), parseInt(offset, 10) || 0],
      );
      res.json({ success: true, conversations: rows });
    } catch (err) {
      logger.error({ err }, 'sales_conversations_list_failed');
      fail(res, 500, 'Failed to load conversations');
    }
  });

  router.get('/conversations/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const [convRes, objRes] = await Promise.all([
        pool.query(
          `SELECT sc.*, c.first_name, c.last_name, c.phone
             FROM sales_conversations sc
             LEFT JOIN mailing_contacts c ON c.id = sc.contact_id
            WHERE sc.id=$1 AND sc.user_id=$2`,
          [req.params.id, auth.userId],
        ),
        pool.query(
          `SELECT * FROM sales_conversation_objections WHERE conversation_id=$1 AND user_id=$2`,
          [req.params.id, auth.userId],
        ),
      ]);
      if (!convRes.rows[0]) return fail(res, 404, 'Conversation not found');
      res.json({ success: true, conversation: convRes.rows[0], objections: objRes.rows });
    } catch (err) {
      logger.error({ err }, 'sales_conversation_detail_failed');
      fail(res, 500, 'Failed to load conversation');
    }
  });

  /**
   * Log a call a human made. This is the doorway that lets the whole brain run
   * — analysis, objections, follow-ups — before any AI dials anyone.
   */
  router.post('/conversations', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { contact_id, transcript, channel, duration_sec, started_at, recording_url } = req.body ?? {};
      if (!contact_id) return fail(res, 400, 'contact_id is required');
      if (!transcript || !String(transcript).trim()) return fail(res, 400, 'A transcript is required');

      const owned = await pool.query(`SELECT 1 FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [
        contact_id,
        auth.userId,
      ]);
      if (!owned.rowCount) return fail(res, 404, 'Contact not found');

      const id = await salesEngine.recordManualConversation({
        userId: auth.userId,
        contactId: contact_id,
        transcript: String(transcript),
        channel,
        durationSec: duration_sec ? Number(duration_sec) : null,
        startedAt: started_at ? new Date(started_at) : undefined,
        recordingUrl: recording_url ?? null,
      });
      // Analysis runs on the worker within a minute; don't block the request.
      void salesEngine.processPendingAnalyses().catch(() => undefined);
      res.json({ success: true, conversationId: id });
    } catch (err) {
      logger.error({ err }, 'sales_conversation_create_failed');
      fail(res, 500, 'Failed to log conversation');
    }
  });

  router.post('/conversations/:id/reanalyze', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rowCount } = await pool.query(
        `UPDATE sales_conversations SET analysis_status='pending', analysis_attempts=0, analysis_error=NULL, updated_at=NOW()
          WHERE id=$1 AND user_id=$2`,
        [req.params.id, auth.userId],
      );
      if (!rowCount) return fail(res, 404, 'Conversation not found');
      void salesEngine.processPendingAnalyses().catch(() => undefined);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'sales_reanalyze_failed');
      fail(res, 500, 'Failed to queue re-analysis');
    }
  });

  // ─── Follow-ups ───────────────────────────────────────────────────────────

  router.get('/followups', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { status = 'scheduled,due' } = req.query as Record<string, string>;
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      const { rows } = await pool.query(
        `SELECT f.*, c.first_name, c.last_name, c.phone
           FROM sales_followups f
           LEFT JOIN mailing_contacts c ON c.id = f.contact_id
          WHERE f.user_id=$1 AND f.status = ANY($2::text[])
          ORDER BY f.scheduled_for ASC LIMIT 200`,
        [auth.userId, statuses],
      );
      res.json({ success: true, followUps: rows });
    } catch (err) {
      logger.error({ err }, 'sales_followups_list_failed');
      fail(res, 500, 'Failed to load follow-ups');
    }
  });

  router.post('/followups', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { contact_id, type, scheduled_for, reason, objective, exact_time_requested } = req.body ?? {};
      if (!contact_id || !scheduled_for) return fail(res, 400, 'contact_id and scheduled_for are required');
      const at = new Date(scheduled_for);
      if (Number.isNaN(at.getTime())) return fail(res, 400, 'scheduled_for is not a valid date');
      const leadProfileId = await salesEngine.ensureLeadProfile(auth.userId, contact_id);
      const { rows } = await pool.query(
        `INSERT INTO sales_followups
           (id, user_id, contact_id, lead_profile_id, type, requested_by, scheduled_for, exact_time_requested, reason, objective)
         VALUES ($1,$2,$3,$4,$5,'human',$6,$7,$8,$9) RETURNING id`,
        [
          randomUUID(), auth.userId, contact_id, leadProfileId, type || 'phone_call',
          at, exact_time_requested === true, reason ?? null, objective ?? null,
        ],
      );
      res.json({ success: true, followUpId: rows[0].id });
    } catch (err) {
      logger.error({ err }, 'sales_followup_create_failed');
      fail(res, 500, 'Failed to create follow-up');
    }
  });

  router.put('/followups/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { status, scheduled_for } = req.body ?? {};
      const { rowCount } = await pool.query(
        `UPDATE sales_followups
            SET status=COALESCE($1, status), scheduled_for=COALESCE($2, scheduled_for), updated_at=NOW()
          WHERE id=$3 AND user_id=$4`,
        [status ?? null, scheduled_for ? new Date(scheduled_for) : null, req.params.id, auth.userId],
      );
      if (!rowCount) return fail(res, 404, 'Follow-up not found');
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'sales_followup_update_failed');
      fail(res, 500, 'Failed to update follow-up');
    }
  });

  // ─── Calls ────────────────────────────────────────────────────────────────

  /**
   * What would happen if we called this lead right now — without dialing.
   * The trust-building endpoint: it shows the gate's verdict and the ranked
   * windows side by side, so "why didn't it call?" always has an answer.
   */
  router.get('/calls/preview/:contactId', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const ctx = await salesEngine.evaluateGate(auth.userId, req.params.contactId);
      const [userStats, leadStats] = await Promise.all([
        pool.query(`SELECT weekday, hour, attempts, answered FROM sales_call_stats WHERE user_id=$1`, [auth.userId]),
        pool.query(
          `SELECT local_weekday AS weekday, local_hour AS hour,
                  COUNT(*)::int AS attempts,
                  COUNT(*) FILTER (WHERE outcome='answered')::int AS answered
             FROM sales_call_attempts
            WHERE contact_id=$1 AND user_id=$2 AND outcome IS NOT NULL AND local_weekday IS NOT NULL
            GROUP BY 1,2`,
          [req.params.contactId, auth.userId],
        ),
      ]);
      const timing = scoreCallWindows({
        leadStats: leadStats.rows.map((r: any) => ({
          weekday: Number(r.weekday), hour: Number(r.hour),
          attempts: Number(r.attempts), answered: Number(r.answered),
        })),
        userStats: userStats.rows.map((r: any) => ({
          weekday: Number(r.weekday), hour: Number(r.hour),
          attempts: Number(r.attempts), answered: Number(r.answered),
        })),
        policy: ctx.policy,
      });
      res.json({
        success: true,
        decision: ctx.decision,
        timezone: ctx.timezone,
        timing: {
          status: timing.status,
          totalAttempts: timing.totalAttempts,
          windows: timing.windows.map((w) => ({
            ...w,
            label: `${WEEKDAY_NAMES[w.weekday]} ${String(w.hour).padStart(2, '0')}:00`,
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'sales_call_preview_failed');
      fail(res, 500, 'Failed to preview call');
    }
  });

  router.post('/calls/queue', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { contact_id, objective } = req.body ?? {};
      if (!contact_id) return fail(res, 400, 'contact_id is required');
      const result = await salesEngine.queueCall({ userId: auth.userId, contactId: contact_id, objective });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error({ err }, 'sales_call_queue_failed');
      fail(res, 500, 'Failed to queue call');
    }
  });

  router.get('/calls', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT a.id, a.status, a.outcome, a.provider, a.run_at, a.started_at, a.duration_sec,
                a.block_reason, a.last_error, a.objective, c.first_name, c.last_name, c.phone
           FROM sales_call_attempts a
           LEFT JOIN mailing_contacts c ON c.id = a.contact_id
          WHERE a.user_id=$1
          ORDER BY a.created_at DESC LIMIT 100`,
        [auth.userId],
      );
      res.json({ success: true, calls: rows });
    } catch (err) {
      logger.error({ err }, 'sales_calls_list_failed');
      fail(res, 500, 'Failed to load calls');
    }
  });

  // ─── Vapi setup + developer test calls ────────────────────────────────────

  /**
   * Whether Vapi is actually reachable with the configured keys, and which
   * phone numbers the private key can see. Returns no key material.
   */
  router.get('/vapi/status', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, status: await salesEngine.getVapiStatus() });
    } catch (err) {
      logger.error({ err }, 'sales_vapi_status_failed');
      fail(res, 500, 'Failed to check Vapi credentials');
    }
  });

  /** Prefill a test with the exact brief a real lead would get. */
  router.get('/test-call/brief/:contactId', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const owned = await pool.query(`SELECT 1 FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [
        req.params.contactId, auth.userId,
      ]);
      if (!owned.rowCount) return fail(res, 404, 'Contact not found');
      const brief = await salesEngine.buildCallBriefFor(auth.userId, req.params.contactId);
      res.json({ success: true, brief });
    } catch (err) {
      logger.error({ err }, 'sales_test_brief_failed');
      fail(res, 500, 'Failed to build the call brief');
    }
  });

  /**
   * Config for an in-browser test call: the PUBLIC key plus the assistant
   * definition. The private key is never returned to a client.
   */
  router.post('/test-call/web', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { context, first_message, voice_id } = req.body ?? {};
      if (!context || !String(context).trim()) return fail(res, 400, 'A context for the agent is required');
      const config = await salesEngine.getWebTestConfig({
        userId: auth.userId,
        context: String(context).slice(0, 20_000),
        firstMessage: first_message ?? null,
        voiceId: voice_id ?? null,
      });
      res.json({ success: true, ...config });
    } catch (err) {
      logger.warn({ err }, 'sales_web_test_config_failed');
      fail(res, 400, err instanceof Error ? err.message : 'Failed to prepare the browser test call');
    }
  });

  /** Place a real outbound test call. Rate-limited; always discloses the AI. */
  router.post('/test-call/phone', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { to_number, context, first_message, voice_id } = req.body ?? {};
      if (!to_number || !/^\+?[0-9\s\-()]{7,20}$/.test(String(to_number))) {
        return fail(res, 400, 'A valid phone number in E.164 format is required (e.g. +233201234567)');
      }
      if (!context || !String(context).trim()) return fail(res, 400, 'A context for the agent is required');

      const result = await salesEngine.placeTestCall({
        userId: auth.userId,
        toNumber: String(to_number).replace(/[\s\-()]/g, ''),
        context: String(context).slice(0, 20_000),
        firstMessage: first_message ?? null,
        voiceId: voice_id ?? null,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.warn({ err }, 'sales_test_call_failed');
      fail(res, 400, err instanceof Error ? err.message : 'Failed to place the test call');
    }
  });

  router.get('/test-call/history', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      res.json({ success: true, calls: await salesEngine.listTestCalls(auth.userId) });
    } catch (err) {
      logger.error({ err }, 'sales_test_history_failed');
      fail(res, 500, 'Failed to load test calls');
    }
  });

  // ─── Policy ───────────────────────────────────────────────────────────────

  router.get('/policy', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const policy = await salesEngine.getPolicy(auth.userId);
      res.json({ success: true, policy });
    } catch (err) {
      logger.error({ err }, 'sales_policy_get_failed');
      fail(res, 500, 'Failed to load calling policy');
    }
  });

  router.put('/policy', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const b = req.body ?? {};
      await salesEngine.getPolicy(auth.userId); // ensures the row exists
      const days = Array.isArray(b.allowedDays)
        ? b.allowedDays.map(Number).filter((d: number) => d >= 1 && d <= 7)
        : null;
      await pool.query(
        `UPDATE sales_call_policies SET
           enabled=COALESCE($1, enabled),
           require_consent=COALESCE($2, require_consent),
           allowed_days=COALESCE($3::smallint[], allowed_days),
           window_start=COALESCE($4, window_start),
           window_end=COALESCE($5, window_end),
           default_timezone=COALESCE($6, default_timezone),
           max_attempts_per_lead_per_week=COALESCE($7, max_attempts_per_lead_per_week),
           max_consecutive_no_answer=COALESCE($8, max_consecutive_no_answer),
           min_hours_between_attempts=COALESCE($9, min_hours_between_attempts),
           daily_call_cap=COALESCE($10, daily_call_cap),
           ai_disclosure_required=COALESCE($11, ai_disclosure_required),
           ai_disclosure_text=COALESCE($12, ai_disclosure_text),
           recording_disclosure_required=COALESCE($13, recording_disclosure_required),
           provider=COALESCE($14, provider),
           from_number=COALESCE($15, from_number),
           voice_id=COALESCE($16, voice_id),
           max_call_duration_sec=COALESCE($17, max_call_duration_sec),
           blackout_dates=COALESCE($18::text[], blackout_dates),
           updated_at=NOW()
         WHERE user_id=$19`,
        [
          typeof b.enabled === 'boolean' ? b.enabled : null,
          typeof b.requireConsent === 'boolean' ? b.requireConsent : null,
          days && days.length ? days : null,
          b.windowStart ?? null, b.windowEnd ?? null, b.defaultTimezone ?? null,
          b.maxAttemptsPerLeadPerWeek ?? null, b.maxConsecutiveNoAnswer ?? null,
          b.minHoursBetweenAttempts ?? null, b.dailyCallCap ?? null,
          typeof b.aiDisclosureRequired === 'boolean' ? b.aiDisclosureRequired : null,
          b.aiDisclosureText ?? null,
          typeof b.recordingDisclosureRequired === 'boolean' ? b.recordingDisclosureRequired : null,
          b.provider ?? null, b.fromNumber ?? null, b.voiceId ?? null, b.maxCallDurationSec ?? null,
          Array.isArray(b.blackoutDates) ? b.blackoutDates.map(String) : null,
          auth.userId,
        ],
      );
      const policy = await salesEngine.getPolicy(auth.userId);
      res.json({ success: true, policy });
    } catch (err) {
      logger.error({ err }, 'sales_policy_update_failed');
      fail(res, 500, 'Failed to save calling policy');
    }
  });

  // ─── Intelligence dashboard ───────────────────────────────────────────────

  router.get('/intelligence', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const [funnelRes, objectionRes, windowRes, trendRes, insightRes, policy] = await Promise.all([
        pool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM sales_call_attempts WHERE user_id=$1 AND status<>'blocked' AND created_at >= NOW() - INTERVAL '30 days') AS calls,
             (SELECT COUNT(*)::int FROM sales_call_attempts WHERE user_id=$1 AND outcome='answered' AND created_at >= NOW() - INTERVAL '30 days') AS answered,
             (SELECT COUNT(*)::int FROM sales_conversations WHERE user_id=$1 AND intent='interested' AND started_at >= NOW() - INTERVAL '30 days') AS interested,
             (SELECT COUNT(*)::int FROM sales_conversations WHERE user_id=$1 AND intent='meeting_booked' AND started_at >= NOW() - INTERVAL '30 days') AS meetings,
             (SELECT COUNT(*)::int FROM sales_lead_profiles WHERE user_id=$1 AND stage='won') AS won,
             (SELECT COUNT(*)::int FROM sales_conversations WHERE user_id=$1 AND started_at >= NOW() - INTERVAL '30 days') AS conversations`,
          [auth.userId],
        ),
        pool.query(
          `SELECT objection_code, COUNT(*)::int AS n FROM sales_conversation_objections
            WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '90 days'
            GROUP BY objection_code ORDER BY n DESC LIMIT 8`,
          [auth.userId],
        ),
        pool.query(
          `SELECT weekday, hour, attempts, answered FROM sales_call_stats WHERE user_id=$1 AND attempts >= 5
            ORDER BY answered::numeric / NULLIF(attempts,0) DESC LIMIT 5`,
          [auth.userId],
        ),
        pool.query(
          `SELECT TO_CHAR(DATE(started_at), 'Mon DD') AS label, DATE(started_at) AS d,
                  COUNT(*)::int AS conversations,
                  COUNT(*) FILTER (WHERE intent IN ('interested','meeting_booked'))::int AS positive
             FROM sales_conversations
            WHERE user_id=$1 AND started_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(started_at) ORDER BY d`,
          [auth.userId],
        ),
        pool.query(
          `SELECT id, kind, title, body, confidence, sample_size, status, created_at
             FROM sales_insights WHERE user_id=$1 AND status='new'
            ORDER BY confidence DESC NULLS LAST, created_at DESC LIMIT 6`,
          [auth.userId],
        ),
        salesEngine.getPolicy(auth.userId),
      ]);

      const funnel = funnelRes.rows[0] ?? {};
      const totalObjections = objectionRes.rows.reduce((s: number, r: any) => s + Number(r.n), 0);

      res.json({
        success: true,
        funnel,
        objections: objectionRes.rows.map((r: any) => ({
          code: r.objection_code,
          label: OBJECTION_LABELS[r.objection_code as keyof typeof OBJECTION_LABELS] ?? r.objection_code,
          count: Number(r.n),
          share: totalObjections ? Number(r.n) / totalObjections : 0,
        })),
        bestWindows: windowRes.rows.map((r: any) => ({
          label: `${WEEKDAY_NAMES[Number(r.weekday)]} ${String(r.hour).padStart(2, '0')}:00`,
          rate: Number(r.attempts) ? Number(r.answered) / Number(r.attempts) : 0,
          attempts: Number(r.attempts),
        })),
        trend: trendRes.rows,
        insights: insightRes.rows,
        policyEnabled: policy.enabled,
      });
    } catch (err) {
      logger.error({ err }, 'sales_intelligence_failed');
      fail(res, 500, 'Failed to load sales intelligence');
    }
  });

  // ─── Insights ─────────────────────────────────────────────────────────────

  router.get('/insights', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM sales_insights WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [auth.userId],
      );
      res.json({ success: true, insights: rows });
    } catch (err) {
      logger.error({ err }, 'sales_insights_list_failed');
      fail(res, 500, 'Failed to load insights');
    }
  });

  /**
   * Accepting an insight is what turns a proposal into knowledge the caller
   * uses. Nothing here happens without this explicit human step.
   */
  // Two explicit paths rather than a ":action(accept|reject)" pattern —
  // Express 5's path-to-regexp no longer supports inline regex params and
  // throws at router construction, taking the whole server down at boot.
  const reviewInsight = (accepted: boolean) => async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await pool.query(
        `UPDATE sales_insights SET status=$1, reviewed_by=$2, reviewed_at=NOW()
          WHERE id=$3 AND user_id=$4 AND status='new' RETURNING *`,
        [accepted ? 'accepted' : 'rejected', auth.userId, req.params.id, auth.userId],
      );
      const insight = rows[0];
      if (!insight) return fail(res, 404, 'Insight not found or already reviewed');

      if (accepted && insight.proposed_change?.type === 'playbook' && insight.proposed_change?.content) {
        await pool.query(
          `INSERT INTO sales_playbooks (id, user_id, kind, objection_code, title, content, source)
           VALUES ($1,$2,'objection_response',$3,$4,$5,'ai_accepted')`,
          [
            randomUUID(), auth.userId,
            insight.proposed_change.objection_code ?? null,
            insight.proposed_change.title || insight.title,
            insight.proposed_change.content,
          ],
        );
        await pool.query(`UPDATE sales_insights SET status='applied' WHERE id=$1`, [insight.id]);
      }
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'sales_insight_review_failed');
      fail(res, 500, 'Failed to review insight');
    }
  };

  router.post('/insights/:id/accept', reviewInsight(true));
  router.post('/insights/:id/reject', reviewInsight(false));

  router.post('/insights/generate', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const written = await runInsightAgent(pool, auth.userId);
      res.json({ success: true, written });
    } catch (err) {
      logger.error({ err }, 'sales_insight_generate_failed');
      fail(res, 500, 'Failed to generate insights');
    }
  });

  // ─── Playbooks ────────────────────────────────────────────────────────────

  router.get('/playbooks', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM sales_playbooks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [auth.userId],
      );
      res.json({ success: true, playbooks: rows });
    } catch (err) {
      logger.error({ err }, 'sales_playbooks_list_failed');
      fail(res, 500, 'Failed to load playbooks');
    }
  });

  router.post('/playbooks', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { kind, objection_code, title, content } = req.body ?? {};
      if (!content || !String(content).trim()) return fail(res, 400, 'content is required');
      const { rows } = await pool.query(
        `INSERT INTO sales_playbooks (id, user_id, kind, objection_code, title, content, source)
         VALUES ($1,$2,$3,$4,$5,$6,'human') RETURNING id`,
        [randomUUID(), auth.userId, kind || 'objection_response', objection_code ?? null, title ?? null, content],
      );
      res.json({ success: true, playbookId: rows[0].id });
    } catch (err) {
      logger.error({ err }, 'sales_playbook_create_failed');
      fail(res, 500, 'Failed to create playbook entry');
    }
  });

  router.delete('/playbooks/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await pool.query(`DELETE FROM sales_playbooks WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'sales_playbook_delete_failed');
      fail(res, 500, 'Failed to delete playbook entry');
    }
  });

  // ─── Reference data ───────────────────────────────────────────────────────

  router.get('/meta', (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    res.json({
      success: true,
      stages: LEAD_STAGES,
      objectionLabels: OBJECTION_LABELS,
    });
  });

  return router;
}

export { buildSalesEngine };
export type { LeadStage };
