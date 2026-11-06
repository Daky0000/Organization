// ─────────────────────────────────────────────────────────────────────────────
// The sales engine — supervisor and workers.
//
// The supervisor is deliberately NOT an LLM. It decides which agent runs on
// what, whether approval is required, and what happens next, and all of that is
// ordinary code. Putting model judgment on the execution path is exactly what
// the module's governing principle forbids: the intelligence belongs in the
// agents, the routing belongs here.
//
// Every worker follows the house pattern from automationEngine: claim rows with
// FOR UPDATE SKIP LOCKED, do the work, write the result. These run as in-process
// setInterval timers with no leader election, so the claim is what makes a
// second instance safe.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../../logger.ts';
import { applyDisclosures, buildCallBrief } from './callBrief.ts';
import { decideCallAction, localBucket, nextPermittedSlot, type CallDecision } from './callPolicy.ts';
import { runAnalyst } from './analystAgent.ts';
import { runInsightAgent } from './insightAgent.ts';
import { applySalesOps, recordAgentRun, validateSalesOps } from './salesOps.ts';
import { policyFromRow, type LeadStage, type SalesCallPolicy } from './types.ts';
import { SimulatorProvider } from './providers/simulator.ts';
import { VapiProvider } from './providers/vapi.ts';
import type { CallEvent, CallProvider } from './providers/index.ts';

export interface SalesEngineDeps {
  pool: Pool;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
}

const ANALYSIS_BATCH = 5;
const CALL_BATCH = 10;
const MAX_ANALYSIS_ATTEMPTS = 3;

export function buildSalesEngine({ pool, getPlatformConfig }: SalesEngineDeps) {
  // ─── Policy + provider resolution ──────────────────────────────────────────

  /** Read a user's policy, creating the conservative default row on first use. */
  async function getPolicy(userId: string): Promise<SalesCallPolicy> {
    const { rows } = await pool.query(`SELECT * FROM sales_call_policies WHERE user_id=$1`, [userId]);
    if (rows[0]) return policyFromRow(rows[0]);
    await pool
      .query(`INSERT INTO sales_call_policies (id, user_id) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`, [
        randomUUID(),
        userId,
      ])
      .catch(() => undefined);
    return policyFromRow(null);
  }

  async function buildVapiProvider(): Promise<VapiProvider> {
    const cfg = await getPlatformConfig('vapi').catch(() => ({}) as Record<string, string>);
    return new VapiProvider({
      // apiKey is the PRIVATE key — server-side only.
      apiKey: cfg.apiKey || cfg.privateKey || process.env.VAPI_API_KEY || '',
      // publicKey is browser-safe and is the only one ever sent to a client.
      publicKey: cfg.publicKey || process.env.VAPI_PUBLIC_KEY || null,
      phoneNumberId: cfg.phoneNumberId || process.env.VAPI_PHONE_NUMBER_ID || null,
      webhookSecret: cfg.webhookSecret || process.env.VAPI_WEBHOOK_SECRET || null,
    });
  }

  async function getProvider(policy: SalesCallPolicy): Promise<CallProvider> {
    if (policy.provider !== 'vapi') return new SimulatorProvider();
    return buildVapiProvider();
  }

  /** Exposed for the webhook, which must pick a provider without a user id. */
  async function getProviderByName(name: string): Promise<CallProvider> {
    return getProvider({ ...policyFromRow(null), provider: name });
  }

  // ─── Lead profiles ─────────────────────────────────────────────────────────

  async function ensureLeadProfile(userId: string, contactId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `INSERT INTO sales_lead_profiles (id, user_id, contact_id)
       VALUES ($1,$2,$3) ON CONFLICT (contact_id) DO UPDATE SET updated_at=NOW()
       RETURNING id`,
      [randomUUID(), userId, contactId],
    );
    return rows[0]?.id ?? null;
  }

  // ─── The gate, with everything it needs loaded ─────────────────────────────

  interface GateContext {
    decision: CallDecision;
    policy: SalesCallPolicy;
    timezone: string;
    phone: string | null;
    leadProfileId: string | null;
    stage: LeadStage | null;
  }

  async function evaluateGate(userId: string, contactId: string, now = new Date()): Promise<GateContext> {
    const policy = await getPolicy(userId);

    const [leadRes, attemptsRes, todayRes, followUpRes] = await Promise.all([
      pool.query(
        `SELECT p.id, p.stage, p.do_not_call, p.consent_at, p.timezone, p.human_handling,
                p.consecutive_no_answer, c.phone
           FROM mailing_contacts c
           LEFT JOIN sales_lead_profiles p ON p.contact_id = c.id
          WHERE c.id=$1 AND c.user_id=$2`,
        [contactId, userId],
      ),
      pool.query(
        `SELECT COALESCE(started_at, created_at) AS started_at, outcome
           FROM sales_call_attempts
          WHERE contact_id=$1 AND user_id=$2 AND status IN ('completed','failed','dialing','in_progress')
            AND COALESCE(started_at, created_at) >= NOW() - INTERVAL '7 days'`,
        [contactId, userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM sales_call_attempts
          WHERE user_id=$1 AND created_at >= date_trunc('day', NOW())
            AND status <> 'blocked' AND is_test = false`,
        [userId],
      ),
      pool.query(
        `SELECT scheduled_for, exact_time_requested FROM sales_followups
          WHERE contact_id=$1 AND user_id=$2 AND status IN ('scheduled','due')
          ORDER BY scheduled_for ASC LIMIT 1`,
        [contactId, userId],
      ),
    ]);

    const lead = leadRes.rows[0];
    if (!lead) {
      return {
        decision: { action: 'stop', code: 'no_phone', reason: 'Contact not found' },
        policy,
        timezone: policy.defaultTimezone,
        phone: null,
        leadProfileId: null,
        stage: null,
      };
    }

    const timezone = lead.timezone || policy.defaultTimezone;
    const followUp = followUpRes.rows[0];

    const decision = decideCallAction({
      now,
      policy,
      lead: {
        phone: lead.phone ?? null,
        doNotCall: lead.do_not_call === true,
        consentAt: lead.consent_at ? new Date(lead.consent_at) : null,
        timezone: lead.timezone ?? null,
        humanHandling: lead.human_handling === true,
        consecutiveNoAnswer: Number(lead.consecutive_no_answer ?? 0),
      },
      recentAttempts: attemptsRes.rows.map((r: any) => ({
        startedAt: new Date(r.started_at),
        outcome: r.outcome ?? null,
      })),
      callsMadeToday: Number(todayRes.rows[0]?.n ?? 0),
      pendingFollowUp: followUp
        ? { scheduledFor: new Date(followUp.scheduled_for), exactTimeRequested: followUp.exact_time_requested === true }
        : null,
    });

    return {
      decision,
      policy,
      timezone,
      phone: lead.phone ?? null,
      leadProfileId: lead.id ?? null,
      stage: (lead.stage as LeadStage) ?? null,
    };
  }

  // ─── Queueing a call ───────────────────────────────────────────────────────

  /**
   * Put a call in the queue, or record why it could not be queued. A blocked
   * attempt is written as a row too — a call that never happened is itself
   * information, and silently skipping makes "why did nobody call this lead?"
   * unanswerable.
   */
  async function queueCall(params: {
    userId: string;
    contactId: string;
    objective?: string | null;
    followUpId?: string | null;
    now?: Date;
  }): Promise<{ queued: boolean; attemptId: string | null; decision: CallDecision }> {
    const now = params.now ?? new Date();
    const ctx = await evaluateGate(params.userId, params.contactId, now);
    const leadProfileId = ctx.leadProfileId ?? (await ensureLeadProfile(params.userId, params.contactId));

    if (ctx.decision.action === 'stop') {
      const { rows } = await pool.query(
        `INSERT INTO sales_call_attempts
           (id, user_id, contact_id, lead_profile_id, followup_id, provider, objective,
            status, outcome, block_reason, run_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'blocked','blocked',$8,NOW()) RETURNING id`,
        [
          randomUUID(), params.userId, params.contactId, leadProfileId, params.followUpId ?? null,
          ctx.policy.provider, params.objective ?? null, `${ctx.decision.code}: ${ctx.decision.reason}`,
        ],
      );
      return { queued: false, attemptId: rows[0]?.id ?? null, decision: ctx.decision };
    }

    const runAt = ctx.decision.action === 'reschedule' ? ctx.decision.runAt : now;
    const { rows } = await pool.query(
      `INSERT INTO sales_call_attempts
         (id, user_id, contact_id, lead_profile_id, followup_id, provider, to_number, objective, status, run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9) RETURNING id`,
      [
        randomUUID(), params.userId, params.contactId, leadProfileId, params.followUpId ?? null,
        ctx.policy.provider, ctx.phone, params.objective ?? null, runAt,
      ],
    );
    return { queued: true, attemptId: rows[0]?.id ?? null, decision: ctx.decision };
  }

  // ─── Worker: dial due attempts ─────────────────────────────────────────────

  async function processDueCallAttempts(): Promise<void> {
    let claimed: any[] = [];
    try {
      const { rows } = await pool.query(
        `UPDATE sales_call_attempts SET status='dialing', attempts=attempts+1, updated_at=NOW()
          WHERE id IN (
            SELECT id FROM sales_call_attempts
             WHERE status='queued' AND run_at <= NOW()
             ORDER BY run_at LIMIT ${CALL_BATCH} FOR UPDATE SKIP LOCKED
          )
          RETURNING id, user_id, contact_id, followup_id, objective, to_number`,
        [],
      );
      claimed = rows;
    } catch (err) {
      logger.error({ err }, 'sales_dial_claim_failed');
      return;
    }

    for (const attempt of claimed) {
      try {
        // Re-run the gate: hours pass between queueing and dialing, and a lead
        // can go DNC in that window. The queue is a plan, not a permission.
        const ctx = await evaluateGate(attempt.user_id, attempt.contact_id);
        if (ctx.decision.action !== 'call') {
          const blocked = ctx.decision.action === 'stop';
          await pool.query(
            `UPDATE sales_call_attempts
                SET status=$1, block_reason=$2, run_at=$3, updated_at=NOW()
              WHERE id=$4`,
            [
              blocked ? 'blocked' : 'queued',
              ctx.decision.action === 'stop' ? `${ctx.decision.code}: ${ctx.decision.reason}` : ctx.decision.reason,
              ctx.decision.action === 'reschedule' ? ctx.decision.runAt : new Date(),
              attempt.id,
            ],
          );
          continue;
        }

        const provider = await getProvider(ctx.policy);
        if (!provider.isConfigured()) {
          await pool.query(
            `UPDATE sales_call_attempts SET status='failed', last_error=$1, updated_at=NOW() WHERE id=$2`,
            [`${provider.id} is not configured`, attempt.id],
          );
          continue;
        }

        const brief = await buildCallBrief(pool, {
          userId: attempt.user_id,
          contactId: attempt.contact_id,
          objective: attempt.objective,
        });
        const firstMessage = applyDisclosures(brief.firstMessage, ctx.policy);
        const bucket = localBucket(new Date(), ctx.timezone);

        const { externalId } = await provider.placeCall({
          toNumber: attempt.to_number || ctx.phone || '',
          fromNumber: ctx.policy.fromNumber,
          firstMessage,
          systemPrompt: brief.systemPrompt,
          voiceId: ctx.policy.voiceId,
          maxDurationSec: ctx.policy.maxCallDurationSec,
          recordingEnabled: true,
          metadata: { attemptId: attempt.id, userId: attempt.user_id, contactId: attempt.contact_id },
        });

        await pool.query(
          `UPDATE sales_call_attempts
              SET status='in_progress', provider=$1, external_id=$2, brief=$3, started_at=NOW(),
                  local_weekday=$4, local_hour=$5, updated_at=NOW()
            WHERE id=$6`,
          [provider.id, externalId, brief.systemPrompt, bucket.weekday, bucket.hour, attempt.id],
        );

        if (attempt.followup_id) {
          await pool.query(`UPDATE sales_followups SET status='in_progress', updated_at=NOW() WHERE id=$1`, [
            attempt.followup_id,
          ]);
        }
      } catch (err: any) {
        logger.error({ err, attemptId: attempt.id }, 'sales_dial_failed');
        await pool
          .query(`UPDATE sales_call_attempts SET status='failed', outcome='failed', last_error=$1, updated_at=NOW() WHERE id=$2`, [
            String(err?.message || err).slice(0, 500),
            attempt.id,
          ])
          .catch(() => undefined);
      }
    }
  }

  // ─── Provider events ───────────────────────────────────────────────────────

  /**
   * Apply a normalized provider event. Idempotent by construction: the attempt
   * is looked up by (provider, external_id) and a terminal attempt is ignored,
   * so a redelivered end-of-call report cannot create a second conversation.
   */
  async function handleProviderEvent(providerId: string, event: CallEvent): Promise<{ handled: boolean }> {
    if (event.kind === 'ignored') return { handled: false };

    const { rows } = await pool.query(
      `SELECT id, user_id, contact_id, lead_profile_id, followup_id, status, is_test
         FROM sales_call_attempts WHERE provider=$1 AND external_id=$2 LIMIT 1`,
      [providerId, event.externalId],
    );
    const attempt = rows[0];
    if (!attempt) {
      logger.warn({ providerId, externalId: event.externalId }, 'sales_webhook_unknown_attempt');
      return { handled: false };
    }

    if (event.kind === 'started') {
      await pool.query(
        `UPDATE sales_call_attempts SET status='in_progress', started_at=COALESCE(started_at, NOW()), updated_at=NOW()
          WHERE id=$1 AND status IN ('dialing','queued')`,
        [attempt.id],
      );
      return { handled: true };
    }

    if (event.kind === 'failed') {
      await pool.query(
        `UPDATE sales_call_attempts SET status='failed', outcome='failed', last_error=$1, ended_at=NOW(), updated_at=NOW()
          WHERE id=$2 AND status NOT IN ('completed','blocked')`,
        [event.error.slice(0, 500), attempt.id],
      );
      return { handled: true };
    }

    // Terminal already — this is a redelivery.
    if (attempt.status === 'completed') return { handled: true };

    const engaged = event.outcome === 'answered' || event.outcome === 'rejected';

    const { rowCount } = await pool.query(
      `UPDATE sales_call_attempts
          SET status='completed', outcome=$1, ended_at=$2, duration_sec=$3,
              recording_url=$4, transcript=$5, ended_reason=$6, updated_at=NOW()
        WHERE id=$7 AND status <> 'completed'`,
      [
        event.outcome, event.at, event.durationSec, event.recordingUrl ?? null,
        event.transcript ?? null, event.endedReason ?? null, attempt.id,
      ],
    );
    if (!rowCount) return { handled: true };

    // A test call stops here. It has no lead, so there is nothing to update and
    // no conversation to create — and critically it must not feed the timing
    // model, or a developer testing at 2am teaches the scheduler that 2am works.
    if (attempt.is_test || !attempt.contact_id) {
      return { handled: true };
    }

    // $1 is cast explicitly: a bare parameter inside CASE WHEN gives Postgres
    // nothing to infer a type from and errors with "could not determine data
    // type of parameter $1".
    await pool.query(
      `UPDATE sales_lead_profiles
          SET attempt_count = attempt_count + 1,
              consecutive_no_answer = CASE WHEN $1::boolean THEN 0 ELSE consecutive_no_answer + 1 END,
              last_contacted_at = CASE WHEN $1::boolean THEN NOW() ELSE last_contacted_at END,
              updated_at = NOW()
        WHERE contact_id=$2 AND user_id=$3`,
      [engaged, attempt.contact_id, attempt.user_id],
    );

    // Only a conversation that actually happened gets a record and an analysis.
    if (engaged && event.transcript && event.transcript.trim()) {
      const { rows: convRows } = await pool.query(
        `INSERT INTO sales_conversations
           (id, user_id, contact_id, lead_profile_id, attempt_id, channel, direction,
            started_at, ended_at, duration_sec, recording_url, transcript, analysis_status, created_by)
         VALUES ($1,$2,$3,$4,$5,'phone','outbound',$6,$7,$8,$9,$10,'pending','agent')
         RETURNING id`,
        [
          randomUUID(), attempt.user_id, attempt.contact_id, attempt.lead_profile_id, attempt.id,
          new Date(event.at.getTime() - event.durationSec * 1000), event.at, event.durationSec,
          event.recordingUrl ?? null, event.transcript,
        ],
      );
      const conversationId = convRows[0]?.id;
      if (conversationId) {
        await pool.query(`UPDATE sales_call_attempts SET conversation_id=$1 WHERE id=$2`, [conversationId, attempt.id]);
      }
    }

    if (attempt.followup_id) {
      await pool.query(
        `UPDATE sales_followups SET status=$1, attempts=attempts+1, updated_at=NOW() WHERE id=$2`,
        [engaged ? 'completed' : 'missed', attempt.followup_id],
      );
    }

    return { handled: true };
  }

  // ─── Worker: analyse completed conversations ───────────────────────────────

  async function processPendingAnalyses(): Promise<void> {
    let claimed: any[] = [];
    try {
      const { rows } = await pool.query(
        `UPDATE sales_conversations SET analysis_status='analyzing', analysis_attempts=analysis_attempts+1, updated_at=NOW()
          WHERE id IN (
            SELECT id FROM sales_conversations
             WHERE analysis_status='pending' AND transcript IS NOT NULL AND transcript <> ''
               AND analysis_attempts < ${MAX_ANALYSIS_ATTEMPTS}
             ORDER BY created_at LIMIT ${ANALYSIS_BATCH} FOR UPDATE SKIP LOCKED
          )
          RETURNING id, user_id, contact_id, lead_profile_id, transcript, duration_sec, channel`,
        [],
      );
      claimed = rows;
    } catch (err) {
      logger.error({ err }, 'sales_analysis_claim_failed');
      return;
    }

    for (const conv of claimed) {
      const startedAt = Date.now();
      try {
        const [policy, profileRes, contactRes] = await Promise.all([
          getPolicy(conv.user_id),
          pool.query(`SELECT stage, role_title FROM sales_lead_profiles WHERE contact_id=$1 AND user_id=$2`, [
            conv.contact_id,
            conv.user_id,
          ]),
          pool.query(`SELECT first_name, last_name FROM mailing_contacts WHERE id=$1`, [conv.contact_id]),
        ]);
        const profile = profileRes.rows[0] ?? {};
        const contact = contactRes.rows[0] ?? {};
        const leadContext = [
          [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown name',
          profile.role_title ? `Role: ${profile.role_title}` : null,
          `Current stage: ${profile.stage ?? 'new'}`,
        ]
          .filter(Boolean)
          .join('\n');

        const outcome = await runAnalyst({
          pool,
          userId: conv.user_id,
          transcript: conv.transcript,
          leadContext,
          durationSec: conv.duration_sec,
          channel: conv.channel,
          currentStage: (profile.stage as LeadStage) ?? null,
        });

        if (!outcome.record) throw new Error('Analyst returned no parsable record');
        const record = outcome.record;

        const validation = validateSalesOps(outcome.ops, {
          now: new Date(),
          requireApprovalFor: policy.requireApprovalFor,
        });
        const applied = await applySalesOps(pool, validation.ok, {
          userId: conv.user_id,
          contactId: conv.contact_id,
          leadProfileId: conv.lead_profile_id,
          conversationId: conv.id,
        });

        await pool.query(
          `UPDATE sales_conversations
              SET summary=$1, sentiment=$2, intent=$3, lead_stage_before=$4, lead_stage_after=$5,
                  commitments=$6::jsonb, promises=$7::jsonb, questions=$8::jsonb, buying_signals=$9::jsonb,
                  recommended_action=$10, analyst_confidence=$11, analysis_status='done',
                  analysis_error=NULL, updated_at=NOW()
            WHERE id=$12`,
          [
            record.summary, record.sentiment, record.intent, profile.stage ?? null,
            record.suggested_stage ?? profile.stage ?? null,
            JSON.stringify(record.commitments), JSON.stringify(record.promises),
            JSON.stringify(record.questions), JSON.stringify(record.buying_signals),
            record.recommended_action, record.confidence, conv.id,
          ],
        );

        // Mirror onto the CRM timeline so Companies/Pipeline light up without a
        // sync job — the whole reason this module extends the CRM contact.
        const { rows: actRows } = await pool.query(
          `INSERT INTO crm_activities (id, user_id, contact_id, type, title, body, outcome, duration, completed_at)
           VALUES ($1,$2,$3,'call',$4,$5,$6,$7,NOW()) RETURNING id`,
          [
            randomUUID(), conv.user_id, conv.contact_id,
            `Call — ${record.intent.replace(/_/g, ' ')}`,
            record.summary, record.recommended_action,
            conv.duration_sec ? Math.round(conv.duration_sec / 60) : null,
          ],
        );
        await pool.query(
          `UPDATE sales_conversations SET crm_activity_id=$1 WHERE id=$2`,
          [actRows[0]?.id ?? null, conv.id],
        );

        await pool.query(
          `UPDATE sales_lead_profiles SET summary=$1, last_contacted_at=NOW(), updated_at=NOW()
            WHERE contact_id=$2 AND user_id=$3`,
          [record.summary, conv.contact_id, conv.user_id],
        );

        await recordAgentRun(pool, {
          userId: conv.user_id,
          agent: 'sales_analyst',
          subjectType: 'conversation',
          subjectId: conv.id,
          model: outcome.model,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          proposed: outcome.ops,
          applied: applied.applied,
          rejected: [...validation.rejected, ...applied.failed, ...validation.pending.map((op) => ({ raw: op, reason: 'awaiting approval' }))],
          durationMs: Date.now() - startedAt,
        });
      } catch (err: any) {
        const message = String(err?.message || err).slice(0, 500);
        logger.error({ err, conversationId: conv.id }, 'sales_analysis_failed');
        await pool
          .query(
            `UPDATE sales_conversations
                SET analysis_status = CASE WHEN analysis_attempts >= ${MAX_ANALYSIS_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
                    analysis_error=$1, updated_at=NOW()
              WHERE id=$2`,
            [message, conv.id],
          )
          .catch(() => undefined);
        await recordAgentRun(pool, {
          userId: conv.user_id,
          agent: 'sales_analyst',
          subjectType: 'conversation',
          subjectId: conv.id,
          error: message,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }

  // ─── Worker: due follow-ups ────────────────────────────────────────────────

  async function processDueFollowUps(): Promise<void> {
    let claimed: any[] = [];
    try {
      const { rows } = await pool.query(
        `UPDATE sales_followups SET status='due', updated_at=NOW()
          WHERE id IN (
            SELECT id FROM sales_followups
             WHERE status='scheduled' AND scheduled_for <= NOW()
             ORDER BY scheduled_for LIMIT 50 FOR UPDATE SKIP LOCKED
          )
          RETURNING id, user_id, contact_id, type, objective`,
        [],
      );
      claimed = rows;
    } catch (err) {
      logger.error({ err }, 'sales_followup_claim_failed');
      return;
    }

    for (const followUp of claimed) {
      try {
        // Only phone follow-ups auto-dial. Email/SMS/task follow-ups become a
        // human's problem on the Follow-ups page — sending on someone's behalf
        // is a different consent question and is not in scope here.
        if (followUp.type !== 'phone_call') continue;

        const result = await queueCall({
          userId: followUp.user_id,
          contactId: followUp.contact_id,
          objective: followUp.objective,
          followUpId: followUp.id,
        });
        if (!result.queued) {
          const decision = result.decision;
          await pool.query(
            `UPDATE sales_followups SET status='cancelled', last_error=$1, updated_at=NOW() WHERE id=$2`,
            [decision.action === 'stop' ? `${decision.code}: ${decision.reason}` : 'blocked', followUp.id],
          );
        }
      } catch (err) {
        logger.error({ err, followUpId: followUp.id }, 'sales_followup_failed');
        await pool
          .query(`UPDATE sales_followups SET status='scheduled', last_error=$1, updated_at=NOW() WHERE id=$2`, [
            String((err as any)?.message || err).slice(0, 500),
            followUp.id,
          ])
          .catch(() => undefined);
      }
    }
  }

  // ─── Worker: stats rollup ──────────────────────────────────────────────────

  /**
   * Recompute the account-level (weekday, hour) answer rates that per-lead
   * timing shrinks toward. A single GROUP BY over the denormalized bucket
   * columns — which is exactly why they are denormalized.
   */
  async function rollupCallStats(): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO sales_call_stats (id, user_id, weekday, hour, attempts, answered, updated_at)
         SELECT gen_random_uuid()::text, user_id, local_weekday, local_hour,
                COUNT(*)::int,
                COUNT(*) FILTER (WHERE outcome='answered')::int,
                NOW()
           FROM sales_call_attempts
          WHERE outcome IS NOT NULL
            AND outcome IN ('answered','no_answer','busy','voicemail','rejected')
            AND local_weekday IS NOT NULL AND local_hour IS NOT NULL
            AND is_test = false
            AND created_at >= NOW() - INTERVAL '90 days'
          GROUP BY user_id, local_weekday, local_hour
         ON CONFLICT (user_id, weekday, hour)
         DO UPDATE SET attempts=EXCLUDED.attempts, answered=EXCLUDED.answered, updated_at=NOW()`,
      );
    } catch (err) {
      logger.error({ err }, 'sales_stats_rollup_failed');
    }
  }

  // ─── Worker: weekly insights ───────────────────────────────────────────────

  async function runWeeklyInsights(): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT user_id FROM sales_conversations
          WHERE created_at >= NOW() - INTERVAL '7 days' LIMIT 200`,
      );
      for (const row of rows) {
        await runInsightAgent(pool, row.user_id).catch((err) =>
          logger.warn({ err, userId: row.user_id }, 'sales_insight_run_failed'),
        );
      }
    } catch (err) {
      logger.error({ err }, 'sales_weekly_insights_failed');
    }
  }

  // ─── Developer test calls ──────────────────────────────────────────────────
  //
  // A test call has no lead behind it, so it deliberately does NOT run the
  // compliance gate — there is no consent record or do-not-call flag for a
  // number you are typing in to hear your own agent. What replaces the gate:
  //
  //   - a low hourly cap, so this cannot become an open dialing relay
  //   - the AI disclosure is still prepended, always, regardless of policy
  //   - a short hard duration cap
  //   - every test is recorded in sales_call_attempts with is_test = true
  //
  // It also never touches a lead profile, never creates a conversation record,
  // and never feeds the timing model. Test data must not contaminate the
  // statistics the real system learns from.

  const TEST_CALLS_PER_HOUR = 5;
  const TEST_CALL_MAX_DURATION_SEC = 180;

  async function testCallsInLastHour(userId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sales_call_attempts
        WHERE user_id=$1 AND is_test=true AND created_at >= NOW() - INTERVAL '1 hour'`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Compose the assistant a test will run. Shared by phone and browser tests. */
  async function buildTestAssistant(params: {
    userId: string;
    context: string;
    firstMessage?: string | null;
    voiceId?: string | null;
  }): Promise<{ provider: VapiProvider; assistant: Record<string, unknown>; firstMessage: string }> {
    const provider = await buildVapiProvider();
    const policy = await getPolicy(params.userId);
    // Disclosure is forced on for tests: aiDisclosureRequired: true regardless
    // of the account policy, because a test dials a real human's phone.
    const firstMessage = applyDisclosures(
      (params.firstMessage || '').trim() || 'This is a test call. Can you hear me?',
      { ...policy, aiDisclosureRequired: true },
    );
    const assistant = provider.buildAssistant({
      firstMessage,
      systemPrompt: params.context,
      voiceId: params.voiceId ?? policy.voiceId,
      maxDurationSec: TEST_CALL_MAX_DURATION_SEC,
      recordingEnabled: true,
    });
    return { provider, assistant, firstMessage };
  }

  /** Place a real outbound test call to an arbitrary number. */
  async function placeTestCall(params: {
    userId: string;
    toNumber: string;
    context: string;
    firstMessage?: string | null;
    voiceId?: string | null;
  }): Promise<{ attemptId: string; externalId: string }> {
    const used = await testCallsInLastHour(params.userId);
    if (used >= TEST_CALLS_PER_HOUR) {
      throw new Error(`Test call limit reached (${TEST_CALLS_PER_HOUR} per hour). Try again later.`);
    }

    const { provider, assistant, firstMessage } = await buildTestAssistant(params);
    if (!provider.isConfigured()) {
      throw new Error('Vapi is not configured — add a private API key and phone number ID under Admin → Integrations.');
    }

    const { rows } = await pool.query(
      `INSERT INTO sales_call_attempts
         (id, user_id, provider, to_number, objective, brief, status, run_at, is_test)
       VALUES ($1,$2,'vapi',$3,$4,$5,'dialing',NOW(),true) RETURNING id`,
      [randomUUID(), params.userId, params.toNumber, 'Developer test call', params.context],
    );
    const attemptId = rows[0].id;

    try {
      const { externalId } = await provider.placeCallWithAssistant({
        toNumber: params.toNumber,
        assistant,
        metadata: { attemptId, userId: params.userId, contactId: '' },
      });
      await pool.query(
        `UPDATE sales_call_attempts SET external_id=$1, started_at=NOW(), updated_at=NOW() WHERE id=$2`,
        [externalId, attemptId],
      );
      logger.info({ userId: params.userId, attemptId, firstMessage }, 'sales_test_call_placed');
      return { attemptId, externalId };
    } catch (err: any) {
      await pool
        .query(`UPDATE sales_call_attempts SET status='failed', outcome='failed', last_error=$1 WHERE id=$2`, [
          String(err?.message || err).slice(0, 500),
          attemptId,
        ])
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Everything the browser needs to run an in-mic test call: the PUBLIC key
   * and the assistant definition. The private key never leaves the server.
   */
  async function getWebTestConfig(params: {
    userId: string;
    context: string;
    firstMessage?: string | null;
    voiceId?: string | null;
  }): Promise<{ publicKey: string; assistant: Record<string, unknown> }> {
    const { provider, assistant } = await buildTestAssistant(params);
    const publicKey = provider.getPublicKey();
    if (!publicKey) {
      throw new Error('No Vapi public key configured. Add it under Admin → Integrations → Vapi to test in the browser.');
    }
    return { publicKey, assistant };
  }

  async function getVapiStatus() {
    const provider = await buildVapiProvider();
    return provider.checkCredentials();
  }

  async function listTestCalls(userId: string) {
    const { rows } = await pool.query(
      `SELECT id, to_number, status, outcome, started_at, duration_sec, transcript,
              recording_url, ended_reason, last_error, objective
         FROM sales_call_attempts
        WHERE user_id=$1 AND is_test=true
        ORDER BY created_at DESC LIMIT 20`,
      [userId],
    );
    return rows;
  }

  // ─── Manual conversation entry (the Phase 1 doorway) ───────────────────────

  /** Log a call a human made. The analysis path is identical to an AI call. */
  async function recordManualConversation(params: {
    userId: string;
    contactId: string;
    transcript: string;
    channel?: string;
    durationSec?: number | null;
    startedAt?: Date;
    recordingUrl?: string | null;
  }): Promise<string> {
    const leadProfileId = await ensureLeadProfile(params.userId, params.contactId);
    const { rows } = await pool.query(
      `INSERT INTO sales_conversations
         (id, user_id, contact_id, lead_profile_id, channel, direction, started_at, duration_sec,
          transcript, recording_url, analysis_status, created_by)
       VALUES ($1,$2,$3,$4,$5,'outbound',$6,$7,$8,$9,'pending','human')
       RETURNING id`,
      [
        randomUUID(), params.userId, params.contactId, leadProfileId, params.channel || 'phone',
        params.startedAt ?? new Date(), params.durationSec ?? null, params.transcript,
        params.recordingUrl ?? null,
      ],
    );
    return rows[0].id;
  }

  return {
    getPolicy,
    getProvider,
    getProviderByName,
    placeTestCall,
    getWebTestConfig,
    getVapiStatus,
    listTestCalls,
    buildCallBriefFor: (userId: string, contactId: string) => buildCallBrief(pool, { userId, contactId }),
    ensureLeadProfile,
    evaluateGate,
    queueCall,
    handleProviderEvent,
    processDueCallAttempts,
    processPendingAnalyses,
    processDueFollowUps,
    rollupCallStats,
    runWeeklyInsights,
    recordManualConversation,
    nextPermittedSlot,
  };
}

export type SalesEngine = ReturnType<typeof buildSalesEngine>;
