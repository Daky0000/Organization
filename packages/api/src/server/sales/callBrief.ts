// ─────────────────────────────────────────────────────────────────────────────
// The call brief — compiled context handed to the Call Agent.
//
// The standard mistake here is dumping every prior transcript into the prompt.
// It blows the token budget, and worse, the model re-asks questions that were
// already answered because the relevant answer is buried in 8,000 tokens of
// small talk. So the brief is *compiled*: one paragraph of what happened last
// time, the objections that are still open, and the promises we actually owe.
//
// The DO NOT section is not decoration. "Do not claim a promise was delivered"
// is the guard against the worst failure mode of a follow-up caller: opening
// with "did you get the pricing I sent?" when nobody ever sent it.
//
// The AI disclosure is prepended to firstMessage server-side by the caller, not
// requested here — a prompt instruction can be talked out of mid-conversation,
// a string concatenation cannot.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import { buildSharedAgentContext } from '../agentSharedContext.ts';
import { OBJECTION_LABELS, type ObjectionCode } from './types.ts';

export interface CallBrief {
  /** The system prompt for the voice agent. */
  systemPrompt: string;
  /** The agent's opening line, before any disclosure is prepended. */
  firstMessage: string;
  objective: string;
}

const DEFAULT_OBJECTIVES: Record<string, string> = {
  new: 'Introduce us briefly, find out whether they have the problem we solve, and qualify.',
  contacted: 'Re-establish the conversation and find out whether there is a real need.',
  qualified: 'Understand their requirements in enough detail to propose something specific.',
  interested: 'Move toward a booked meeting with the decision maker.',
  proposal: 'Confirm they reviewed the proposal and surface any remaining objection.',
  negotiation: 'Resolve the outstanding objection and agree next steps.',
  unreachable: 'Confirm this is the right contact and whether they want to be reached at all.',
};

function bullets(items: string[], empty: string): string {
  const clean = items.map((i) => String(i).trim()).filter(Boolean);
  if (!clean.length) return empty;
  return clean.map((i) => `- ${i}`).join('\n');
}

/**
 * Assemble the brief for one lead. Reads the last conversation, unresolved
 * objections, open promises, and the account's business knowledge (which lives
 * in user_memories from the onboarding wizard — it is not duplicated here).
 */
export async function buildCallBrief(
  pool: Pool,
  params: {
    userId: string;
    contactId: string;
    objective?: string | null;
    followUpReason?: string | null;
    businessName?: string | null;
  },
): Promise<CallBrief> {
  const { userId, contactId } = params;

  const [contactRes, profileRes, lastConvRes, objectionsRes, promisesRes, playbookRes] = await Promise.all([
    pool.query(
      `SELECT first_name, last_name, phone, email FROM mailing_contacts WHERE id=$1 AND user_id=$2`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT stage, role_title, is_decision_maker, summary, timezone FROM sales_lead_profiles WHERE contact_id=$1 AND user_id=$2`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT summary, intent, started_at, promises FROM sales_conversations
        WHERE contact_id=$1 AND user_id=$2 AND analysis_status='done'
        ORDER BY started_at DESC LIMIT 1`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT objection_code, raw_text FROM sales_conversation_objections
        WHERE contact_id=$1 AND user_id=$2 AND resolved=false
        ORDER BY created_at DESC LIMIT 6`,
      [contactId, userId],
    ),
    // Open promises = task activities we created from a prior call that nobody
    // has completed. Whether they were actually delivered changes what the
    // agent is allowed to claim on this call.
    pool.query(
      `SELECT title, completed_at FROM crm_activities
        WHERE contact_id=$1 AND user_id=$2 AND type='task'
        ORDER BY created_at DESC LIMIT 8`,
      [contactId, userId],
    ),
    pool.query(
      `SELECT objection_code, content FROM sales_playbooks
        WHERE user_id=$1 AND active=true AND kind='objection_response'`,
      [userId],
    ),
  ]);

  const contact = contactRes.rows[0] ?? {};
  const profile = profileRes.rows[0] ?? {};
  const lastConv = lastConvRes.rows[0] ?? null;
  const stage = String(profile.stage || 'new');

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  const objective =
    params.objective?.trim() || DEFAULT_OBJECTIVES[stage] || DEFAULT_OBJECTIVES.new;

  const playbookByCode = new Map<string, string>();
  for (const row of playbookRes.rows) {
    if (row.objection_code && !playbookByCode.has(row.objection_code)) {
      playbookByCode.set(String(row.objection_code), String(row.content));
    }
  }

  const openObjections = objectionsRes.rows.map((r: any) => {
    const code = String(r.objection_code) as ObjectionCode;
    const label = OBJECTION_LABELS[code] ?? code;
    const response = playbookByCode.get(code);
    const quoted = r.raw_text ? ` — they said: "${String(r.raw_text).slice(0, 200)}"` : '';
    return response
      ? `${label}${quoted}\n  How we handle it: ${response}`
      : `${label}${quoted}`;
  });

  const delivered: string[] = [];
  const undelivered: string[] = [];
  for (const row of promisesRes.rows) {
    (row.completed_at ? delivered : undelivered).push(String(row.title));
  }

  const business = await buildSharedAgentContext(userId).catch(() => '');

  const whoParts = [
    name || 'Name unknown',
    profile.role_title ? String(profile.role_title) : null,
    profile.is_decision_maker === true
      ? 'Decision maker'
      : profile.is_decision_maker === false
        ? 'Not the decision maker — there is someone else to convince'
        : null,
    `Pipeline stage: ${stage}`,
  ].filter(Boolean);

  const lastTime = lastConv
    ? `${new Date(lastConv.started_at).toISOString().slice(0, 10)} — ${lastConv.summary || 'no summary recorded'} (read as: ${lastConv.intent || 'unclear'})`
    : 'No previous conversation on record. This is a first contact.';

  const systemPrompt = [
    `You are a sales representative${params.businessName ? ` for ${params.businessName}` : ''} making a phone call. You are speaking out loud on a live call, so keep replies short and conversational — one or two sentences, then let them talk.`,
    '',
    'CALL OBJECTIVE',
    objective,
    params.followUpReason ? `\nWhy we are calling now: ${params.followUpReason}` : '',
    '',
    'WHO YOU ARE CALLING',
    whoParts.map((p) => `- ${p}`).join('\n'),
    profile.summary ? `\nWhat we know about them: ${profile.summary}` : '',
    '',
    'WHAT HAPPENED LAST TIME',
    lastTime,
    '',
    'OPEN OBJECTIONS',
    bullets(openObjections, '- None recorded.'),
    '',
    'WHAT WE PROMISED THEM',
    undelivered.length
      ? `NOT YET DELIVERED — do not imply these were done:\n${bullets(undelivered, '')}`
      : '- Nothing outstanding.',
    delivered.length ? `\nAlready delivered:\n${bullets(delivered, '')}` : '',
    '',
    business ? `ABOUT OUR BUSINESS\n${business}` : '',
    '',
    'DO NOT',
    '- Pressure the lead or push after a clear no.',
    '- Re-ask anything already answered in "what happened last time".',
    '- Claim a promise was delivered if it is listed as not yet delivered.',
    '- Invent pricing, features, timelines, or customer names. If you do not know, say you will find out.',
    '- Argue. If they object, acknowledge it and ask a question.',
    '',
    'HOW TO END',
    'If they want a follow-up, ask for a specific day and time and repeat it back. If they ask not to be called again, acknowledge it warmly and end the call. Always thank them for their time.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const firstMessage = name
    ? `Hi ${String(contact.first_name || name).split(' ')[0]}, do you have a quick minute?`
    : 'Hi, do you have a quick minute?';

  return { systemPrompt, firstMessage, objective };
}

/**
 * Prepend the mandatory disclosures to the opening line. Done in code rather
 * than in the prompt so it cannot be negotiated away mid-call.
 */
export function applyDisclosures(
  firstMessage: string,
  policy: { aiDisclosureRequired: boolean; aiDisclosureText: string | null; recordingDisclosureRequired: boolean },
  businessName?: string | null,
): string {
  const prefixes: string[] = [];
  if (policy.aiDisclosureRequired) {
    prefixes.push(
      policy.aiDisclosureText?.trim() ||
        `Hi, this is an AI assistant calling${businessName ? ` on behalf of ${businessName}` : ''}.`,
    );
  }
  if (policy.recordingDisclosureRequired) {
    prefixes.push('This call is being recorded.');
  }
  return [...prefixes, firstMessage].join(' ');
}
