// ─────────────────────────────────────────────────────────────────────────────
// Sales tools for the main AI assistant.
//
// The voice agent and the user's main assistant work as one team: the user
// can ask the assistant "remind Kofi about his balance" or "how did the calls
// go today?", and the assistant finds the lead, has the call planned (purpose
// and number detected), queues it, and later reads back what happened.
//
// Calls the assistant starts are AI-initiated, so they follow the same rule as
// calls the AI books itself: with "Approve each AI call" on (the default) they
// wait in "Calls to approve" on the Leads page. The calling policy — hours,
// caps, consent, do-not-call — runs again at dial time either way.
// ─────────────────────────────────────────────────────────────────────────────

import type Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import type { SalesEngine } from './salesEngine.ts';
import { phoneTypeLabel } from './callPlanner.ts';
import { CALL_TYPES } from './types.ts';

export const SALES_TOOL_NAMES = ['find_sales_leads', 'call_sales_lead', 'get_sales_call_results'] as const;
export type SalesToolName = (typeof SALES_TOOL_NAMES)[number];
export const isSalesTool = (name: string): name is SalesToolName => (SALES_TOOL_NAMES as readonly string[]).includes(name);

const PURPOSES = ['auto', ...CALL_TYPES] as const;

export const SALES_TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_sales_leads',
    description:
      "Search the user's sales leads (Sales → Leads) by name, phone, email, company or list. Returns contact_id, phone number details (country, mobile/landline, whether it can be called), stage and lists. Use before call_sales_lead, or when asked about a lead.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, phone, email, company or list name. Omit to list recent leads.' },
        limit: { type: 'number', description: 'Max results, up to 20 (default 8).' },
      },
    },
  },
  {
    name: 'call_sales_lead',
    description:
      "Have the AI voice agent phone one lead. Give the reason in plain words (what to say, remind or ask). The purpose is detected from the reason and the lead's data — sales, follow_up, reminder_meeting, reminder_payment, reminder_followup or notice (important information) — unless you set it. The number is detected too (country, line type); invalid numbers are refused. Unless the user turned approval off, the call waits in 'Calls to approve' on the Leads page — tell the user that. Only call when the user asked for it.",
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'From find_sales_leads.' },
        reason: { type: 'string', description: 'What the call is for and what the agent must say, e.g. "Remind her the GHS 500 balance for the June cohort is due Friday."' },
        purpose: { type: 'string', enum: [...PURPOSES], description: 'Leave as auto unless the user named the kind of call.' },
      },
      required: ['contact_id', 'reason'],
    },
  },
  {
    name: 'get_sales_call_results',
    description:
      "What happened on recent AI sales calls: status, outcome, duration, the analysed summary and the lead's intent. Use when asked how calls went, whether someone was reached, or what a lead said.",
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Only this lead. Omit for the latest calls across all leads.' },
        limit: { type: 'number', description: 'Up to 15 (default 8).' },
      },
    },
  },
];

export function salesToolLabel(name: string, input: any): string | null {
  switch (name) {
    case 'find_sales_leads': return input?.query ? `Looking up leads: "${String(input.query).slice(0, 40)}"…` : 'Looking up your leads…';
    case 'call_sales_lead': return 'Preparing an AI call…';
    case 'get_sales_call_results': return 'Checking call results…';
    default: return null;
  }
}

export async function runSalesTool(
  deps: { pool: Pool; salesEngine: SalesEngine },
  name: SalesToolName,
  input: any,
  userId: string,
): Promise<unknown> {
  const { pool, salesEngine } = deps;

  if (name === 'find_sales_leads') {
    const limit = Math.min(20, Math.max(1, Number(input?.limit) || 8));
    const q = String(input?.query ?? '').trim().slice(0, 100);
    const params: unknown[] = [userId];
    let where = 'c.user_id=$1';
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where += ` AND (c.first_name ILIKE ${p} OR c.last_name ILIKE ${p} OR (c.first_name || ' ' || COALESCE(c.last_name,'')) ILIKE ${p}
        OR c.email ILIKE ${p} OR c.phone ILIKE ${p}
        OR EXISTS (SELECT 1 FROM crm_contact_companies cc JOIN crm_companies co ON co.id=cc.company_id WHERE cc.contact_id=c.id AND co.name ILIKE ${p})
        OR EXISTS (SELECT 1 FROM sales_lead_list_members m JOIN sales_lead_lists l ON l.id=m.list_id WHERE m.contact_id=c.id AND l.name ILIKE ${p}))`;
    }
    const { rows } = await pool.query(
      `SELECT c.id AS contact_id, c.first_name, c.last_name, c.email, p.stage, p.do_not_call, p.last_contacted_at,
              COALESCE((SELECT json_agg(l.name ORDER BY l.name) FROM sales_lead_list_members m
                         JOIN sales_lead_lists l ON l.id=m.list_id WHERE m.contact_id=c.id), '[]'::json) AS lists
         FROM mailing_contacts c LEFT JOIN sales_lead_profiles p ON p.contact_id=c.id
        WHERE ${where}
        ORDER BY p.last_contacted_at DESC NULLS LAST, c.created_at DESC
        LIMIT ${limit}`,
      params,
    );
    const leads = await Promise.all(rows.map(async (r: any) => {
      const plan = await salesEngine.previewCall({ userId, contactId: r.contact_id, callType: 'auto' }).catch(() => null);
      const n = plan?.number;
      return {
        contact_id: r.contact_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '(no name)',
        email: r.email ?? null,
        stage: r.stage ?? 'new',
        lists: r.lists,
        do_not_call: r.do_not_call === true,
        phone: n?.phone
          ? { number: n.phone.e164, country: n.phone.countryName, kind: phoneTypeLabel(n.phone.type), from: n.source, can_call: n.callable }
          : { number: null, can_call: false },
        phone_note: n?.warning ?? null,
        calling_allowed_now: plan ? plan.decision.action : 'unknown',
        not_callable_reason: plan?.decision.action === 'stop' ? plan.decision.reason : null,
      };
    }));
    return { leads, total_shown: leads.length };
  }

  if (name === 'call_sales_lead') {
    const contactId = String(input?.contact_id ?? '').trim();
    const reason = String(input?.reason ?? '').trim().slice(0, 2000);
    if (!contactId) throw new Error('contact_id is required — use find_sales_leads first.');
    if (!reason) throw new Error('Say what the call is for in "reason".');
    const purpose = (PURPOSES as readonly string[]).includes(input?.purpose) ? input.purpose : 'auto';
    const owned = await pool.query(`SELECT first_name, last_name FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [contactId, userId]);
    if (!owned.rowCount) throw new Error('No lead with that contact_id in this account.');
    const lead = [owned.rows[0].first_name, owned.rows[0].last_name].filter(Boolean).join(' ') || 'the lead';

    const policy = await salesEngine.getPolicy(userId);
    const r = await salesEngine.queueCall({
      userId, contactId, callType: purpose, note: reason,
      // AI-initiated: same approval rule as calls the AI books itself.
      awaitApproval: policy.requireCallApproval,
    });
    const number = r.number?.phone
      ? { number: r.number.phone.e164, country: r.number.phone.countryName, kind: phoneTypeLabel(r.number.phone.type), from: r.number.source }
      : null;
    if (!r.queued) {
      return {
        status: 'not_called', lead,
        why: r.decision.action === 'stop' ? r.decision.reason : 'The call could not be queued.',
        number, number_note: r.number?.warning ?? null,
      };
    }
    return {
      status: r.awaitingApproval ? 'awaiting_approval' : 'queued',
      lead,
      purpose: r.purpose?.callType ?? purpose,
      purpose_reason: r.purpose?.reason ?? null,
      number,
      number_note: r.number?.warning ?? null,
      dials_at: r.decision.action === 'reschedule' ? r.decision.runAt : 'within the calling hours, shortly',
      next_step: r.awaitingApproval
        ? 'Tell the user the call is waiting in "Calls to approve" on Sales → Leads, and dials once approved.'
        : 'The voice agent will dial within the calling hours.',
      calling_enabled: policy.enabled,
      ...(policy.enabled ? {} : { warning: 'Automated calling is switched off in Sales → Settings, so nothing will dial until it is turned on.' }),
    };
  }

  // get_sales_call_results
  const limit = Math.min(15, Math.max(1, Number(input?.limit) || 8));
  const params: unknown[] = [userId];
  let where = 'a.user_id=$1 AND a.is_test=false';
  if (input?.contact_id) {
    params.push(String(input.contact_id));
    where += ` AND a.contact_id=$${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT a.id, a.call_type, a.call_note, a.status, a.outcome, a.block_reason, a.last_error,
            a.started_at, a.ended_at, a.duration_sec, a.to_number, a.created_at,
            c.first_name, c.last_name,
            sc.summary, sc.intent
       FROM sales_call_attempts a
       LEFT JOIN mailing_contacts c ON c.id = a.contact_id
       LEFT JOIN LATERAL (
         SELECT summary, intent FROM sales_conversations s
          WHERE s.attempt_id = a.id ORDER BY s.started_at DESC LIMIT 1
       ) sc ON true
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  return {
    calls: rows.map((r: any) => ({
      lead: [r.first_name, r.last_name].filter(Boolean).join(' ') || '(unknown)',
      purpose: r.call_type ?? 'sales',
      reason_given: r.call_note ? String(r.call_note).slice(0, 200) : null,
      status: r.status,
      outcome: r.outcome ?? null,
      number: r.to_number ?? null,
      when: r.started_at ?? r.created_at,
      duration_sec: r.duration_sec ?? null,
      summary: r.summary ?? null,
      lead_intent: r.intent ?? null,
      problem: r.block_reason || r.last_error || null,
    })),
  };
}
