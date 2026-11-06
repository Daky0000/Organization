// ─────────────────────────────────────────────────────────────────────────────
// The whitelisted operation layer — the enforcement point for the whole module.
//
// The governing principle of the sales OS is that AI interprets meaning and the
// application decides what happens. This file is where that stops being a
// slogan: there is no code path from model output to the database except
// validateSalesOps → applySalesOps. The Analyst proposes a closed set of typed
// operations; anything it invents is rejected and recorded, never guessed at.
//
// Rejections are stored rather than dropped. A systematically rejected op means
// a broken prompt, and silently discarding it hides that for weeks.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { logger } from '../../logger.ts';
import {
  isFollowUpType,
  isLeadStage,
  isObjectionCode,
  type FollowUpType,
  type LeadStage,
  type ObjectionCode,
} from './types.ts';

export type SalesOp =
  | { op: 'update_lead_stage'; stage: LeadStage; reason: string }
  | { op: 'add_note'; body: string }
  | { op: 'record_objection'; code: ObjectionCode; raw_text: string }
  | {
      op: 'create_followup';
      type: FollowUpType;
      scheduled_for: string;
      exact_time_requested: boolean;
      reason: string;
      objective: string;
    }
  | { op: 'create_task'; title: string; due_date: string | null }
  | { op: 'update_lead_field'; field: 'role_title' | 'timezone' | 'is_decision_maker'; value: string }
  | { op: 'set_do_not_call'; reason: string }
  | { op: 'request_human_handoff'; reason: string }
  | { op: 'link_deal'; deal_id: string; probability: number };

export type SalesOpName = SalesOp['op'];

export interface RejectedOp {
  raw: unknown;
  reason: string;
}

export interface ValidationResult {
  ok: SalesOp[];
  /** Valid, but the policy demands a human confirm before it is applied. */
  pending: SalesOp[];
  rejected: RejectedOp[];
}

export interface ValidationCtx {
  now: Date;
  /** Op names listed in sales_call_policies.require_approval_for. */
  requireApprovalFor: string[];
}

const MAX_TEXT = 2000;
const MAX_TITLE = 200;
/** A follow-up further out than this is almost certainly a parsing error. */
const MAX_FUTURE_DAYS = 180;
const UPDATABLE_FIELDS = new Set(['role_title', 'timezone', 'is_decision_maker']);

function str(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Validate a batch of proposed operations. Pure — no DB, no clock of its own.
 * Ownership checks that genuinely need the database (does this deal belong to
 * this user?) are enforced in applySalesOps by the WHERE clause instead.
 */
export function validateSalesOps(raw: unknown, ctx: ValidationCtx): ValidationResult {
  const result: ValidationResult = { ok: [], pending: [], rejected: [] };
  if (!Array.isArray(raw)) {
    if (raw != null) result.rejected.push({ raw, reason: 'ops payload was not an array' });
    return result;
  }

  const approval = new Set(ctx.requireApprovalFor ?? []);
  const reject = (item: unknown, reason: string) => result.rejected.push({ raw: item, reason });

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      reject(item, 'op was not an object');
      continue;
    }
    const o = item as Record<string, unknown>;
    const name = o.op;

    let parsed: SalesOp | null = null;

    switch (name) {
      case 'update_lead_stage': {
        if (!isLeadStage(o.stage)) { reject(item, `unknown stage "${String(o.stage)}"`); break; }
        parsed = { op: 'update_lead_stage', stage: o.stage, reason: str(o.reason) ?? '' };
        break;
      }
      case 'add_note': {
        const body = str(o.body);
        if (!body) { reject(item, 'add_note requires a non-empty body'); break; }
        parsed = { op: 'add_note', body };
        break;
      }
      case 'record_objection': {
        if (!isObjectionCode(o.code)) { reject(item, `unknown objection code "${String(o.code)}"`); break; }
        parsed = { op: 'record_objection', code: o.code, raw_text: str(o.raw_text) ?? '' };
        break;
      }
      case 'create_followup': {
        const type = isFollowUpType(o.type) ? o.type : 'phone_call';
        const when = str(o.scheduled_for, 40);
        if (!when) { reject(item, 'create_followup requires scheduled_for'); break; }
        const at = new Date(when);
        if (Number.isNaN(at.getTime())) { reject(item, `scheduled_for "${when}" is not a date`); break; }
        if (at.getTime() <= ctx.now.getTime()) { reject(item, 'scheduled_for is in the past'); break; }
        const horizon = ctx.now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000;
        if (at.getTime() > horizon) { reject(item, `scheduled_for is more than ${MAX_FUTURE_DAYS} days out`); break; }
        parsed = {
          op: 'create_followup',
          type,
          scheduled_for: at.toISOString(),
          exact_time_requested: o.exact_time_requested === true,
          reason: str(o.reason) ?? '',
          objective: str(o.objective) ?? '',
        };
        break;
      }
      case 'create_task': {
        const title = str(o.title, MAX_TITLE);
        if (!title) { reject(item, 'create_task requires a title'); break; }
        let due: string | null = null;
        const rawDue = str(o.due_date, 40);
        if (rawDue) {
          const d = new Date(rawDue);
          if (Number.isNaN(d.getTime())) { reject(item, `due_date "${rawDue}" is not a date`); break; }
          due = d.toISOString();
        }
        parsed = { op: 'create_task', title, due_date: due };
        break;
      }
      case 'update_lead_field': {
        const field = typeof o.field === 'string' ? o.field : '';
        if (!UPDATABLE_FIELDS.has(field)) { reject(item, `field "${field}" is not updatable`); break; }
        const value = str(o.value, MAX_TITLE);
        if (value == null) { reject(item, 'update_lead_field requires a value'); break; }
        parsed = { op: 'update_lead_field', field: field as 'role_title' | 'timezone' | 'is_decision_maker', value };
        break;
      }
      case 'set_do_not_call': {
        parsed = { op: 'set_do_not_call', reason: str(o.reason) ?? 'Requested on a call' };
        break;
      }
      case 'request_human_handoff': {
        parsed = { op: 'request_human_handoff', reason: str(o.reason) ?? '' };
        break;
      }
      case 'link_deal': {
        const dealId = str(o.deal_id, 64);
        if (!dealId) { reject(item, 'link_deal requires deal_id'); break; }
        const probability = Number(o.probability);
        if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
          reject(item, 'probability must be between 0 and 100');
          break;
        }
        parsed = { op: 'link_deal', deal_id: dealId, probability: Math.round(probability) };
        break;
      }
      default:
        reject(item, `unknown op "${String(name)}"`);
    }

    if (!parsed) continue;
    if (approval.has(parsed.op)) result.pending.push(parsed);
    else result.ok.push(parsed);
  }

  return result;
}

export interface ApplyCtx {
  userId: string;
  contactId: string;
  leadProfileId: string | null;
  conversationId: string | null;
}

export interface ApplyResult {
  applied: SalesOp[];
  failed: { op: SalesOp; error: string }[];
}

/**
 * Execute validated operations in one transaction. Every statement is
 * parameterized and scoped by user_id — an op referencing another tenant's row
 * simply matches nothing and is reported as failed.
 */
export async function applySalesOps(
  pool: Pool,
  ops: SalesOp[],
  ctx: ApplyCtx,
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], failed: [] };
  if (!ops.length) return result;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const op of ops) {
      try {
        await applyOne(client, op, ctx);
        result.applied.push(op);
      } catch (err: any) {
        // One bad op must not discard the rest of a good analysis, so failures
        // are collected rather than thrown. Genuine transaction-level faults
        // still surface from COMMIT.
        result.failed.push({ op, error: err?.message || String(err) });
        logger.warn({ err, op: op.op, contactId: ctx.contactId }, 'sales_op_failed');
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return result;
}

async function applyOne(client: PoolClient, op: SalesOp, ctx: ApplyCtx): Promise<void> {
  const { userId, contactId, leadProfileId, conversationId } = ctx;

  switch (op.op) {
    case 'update_lead_stage': {
      const { rowCount } = await client.query(
        `UPDATE sales_lead_profiles SET stage=$1, updated_at=NOW() WHERE contact_id=$2 AND user_id=$3`,
        [op.stage, contactId, userId],
      );
      if (!rowCount) throw new Error('lead profile not found');
      return;
    }

    case 'add_note': {
      // Notes land in crm_activities so they show on the existing CRM contact
      // timeline rather than in a sales-only silo.
      await client.query(
        `INSERT INTO crm_activities (id, user_id, contact_id, type, title, body, completed_at)
         VALUES ($1,$2,$3,'note',$4,$5,NOW())`,
        [randomUUID(), userId, contactId, 'Call note (AI)', op.body],
      );
      return;
    }

    case 'record_objection': {
      if (!conversationId) throw new Error('record_objection needs a conversation');
      await client.query(
        `INSERT INTO sales_conversation_objections (id, user_id, conversation_id, contact_id, objection_code, raw_text)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), userId, conversationId, contactId, op.code, op.raw_text || null],
      );
      return;
    }

    case 'create_followup': {
      await client.query(
        `INSERT INTO sales_followups
           (id, user_id, contact_id, lead_profile_id, type, requested_by, scheduled_for,
            exact_time_requested, reason, objective, source_conversation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(), userId, contactId, leadProfileId, op.type,
          op.exact_time_requested ? 'lead' : 'agent',
          op.scheduled_for, op.exact_time_requested, op.reason || null, op.objective || null,
          conversationId,
        ],
      );
      await client.query(
        `UPDATE sales_lead_profiles SET next_action=$1, next_action_at=$2, updated_at=NOW()
         WHERE contact_id=$3 AND user_id=$4`,
        [op.type, op.scheduled_for, contactId, userId],
      );
      return;
    }

    case 'create_task': {
      await client.query(
        `INSERT INTO crm_activities (id, user_id, contact_id, type, title, scheduled_at)
         VALUES ($1,$2,$3,'task',$4,$5)`,
        [randomUUID(), userId, contactId, op.title, op.due_date],
      );
      return;
    }

    case 'update_lead_field': {
      if (op.field === 'is_decision_maker') {
        const truthy = /^(true|yes|1)$/i.test(op.value);
        await client.query(
          `UPDATE sales_lead_profiles SET is_decision_maker=$1, updated_at=NOW() WHERE contact_id=$2 AND user_id=$3`,
          [truthy, contactId, userId],
        );
        return;
      }
      // Column name comes from UPDATABLE_FIELDS, never from model output.
      const column = op.field === 'timezone' ? 'timezone' : 'role_title';
      await client.query(
        `UPDATE sales_lead_profiles SET ${column}=$1, updated_at=NOW() WHERE contact_id=$2 AND user_id=$3`,
        [op.value, contactId, userId],
      );
      return;
    }

    case 'set_do_not_call': {
      await client.query(
        `UPDATE sales_lead_profiles
            SET do_not_call=true, do_not_call_reason=$1, do_not_call_at=NOW(), updated_at=NOW()
          WHERE contact_id=$2 AND user_id=$3`,
        [op.reason, contactId, userId],
      );
      // Cancel anything already queued for them — a DNC that leaves a dial in
      // the queue is not a DNC.
      await client.query(
        `UPDATE sales_followups SET status='cancelled', updated_at=NOW()
          WHERE contact_id=$1 AND user_id=$2 AND status IN ('scheduled','due')`,
        [contactId, userId],
      );
      await client.query(
        `UPDATE sales_call_attempts SET status='cancelled', block_reason='do_not_call', updated_at=NOW()
          WHERE contact_id=$1 AND user_id=$2 AND status='queued'`,
        [contactId, userId],
      );
      return;
    }

    case 'request_human_handoff': {
      await client.query(
        `UPDATE sales_lead_profiles SET human_handling=true, next_action='human_handoff', updated_at=NOW()
          WHERE contact_id=$1 AND user_id=$2`,
        [contactId, userId],
      );
      await client.query(
        `INSERT INTO crm_activities (id, user_id, contact_id, type, title, body)
         VALUES ($1,$2,$3,'task',$4,$5)`,
        [randomUUID(), userId, contactId, 'Human handoff requested', op.reason || null],
      );
      return;
    }

    case 'link_deal': {
      const { rowCount } = await client.query(
        `UPDATE crm_deals SET contact_id=$1, probability=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4`,
        [contactId, op.probability, op.deal_id, userId],
      );
      if (!rowCount) throw new Error('deal not found for this user');
      return;
    }
  }
}

/** Record what an agent proposed, what was applied, and what was refused. */
export async function recordAgentRun(
  pool: Pool,
  params: {
    userId: string;
    agent: string;
    subjectType: string;
    subjectId: string;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    proposed?: unknown;
    applied?: unknown;
    rejected?: unknown;
    error?: string | null;
    durationMs?: number;
  },
): Promise<void> {
  await pool
    .query(
      `INSERT INTO sales_agent_runs
         (id, user_id, agent, subject_type, subject_id, model, input_tokens, output_tokens,
          proposed, applied, rejected, error, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)`,
      [
        randomUUID(), params.userId, params.agent, params.subjectType, params.subjectId,
        params.model ?? null, params.inputTokens ?? 0, params.outputTokens ?? 0,
        JSON.stringify(params.proposed ?? null), JSON.stringify(params.applied ?? null),
        JSON.stringify(params.rejected ?? null), params.error ?? null, params.durationMs ?? null,
      ],
    )
    .catch((err) => logger.warn({ err }, 'sales_agent_run_record_failed'));
}
