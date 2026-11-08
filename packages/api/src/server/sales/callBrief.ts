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
import { OBJECTION_LABELS, isCallType, type CallType, type ObjectionCode } from './types.ts';
import { getLeadSheetContext, renderLeadSheet } from './leadSheetContext.ts';
import { fillTemplate, renderPlaybook, type OrgAgentConfig } from './orgAgent.ts';

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

/**
 * What each kind of call is for. A reminder call is short and specific; it is
 * not a sales pitch, and the agent is told so.
 */
export const CALL_TYPE_BRIEFS: Record<CallType, { label: string; objective: string; guidance: string }> = {
  sales: {
    label: 'Sales call',
    objective: '',
    guidance: 'This is a sales call. Find out whether they have the need we solve, and move toward the next step.',
  },
  follow_up: {
    label: 'Follow-up call',
    objective: 'Pick up where the last conversation left off and agree the next step.',
    guidance: 'This is a follow-up. Refer to the last conversation and the recent activity below. Do not start the pitch from scratch.',
  },
  reminder_meeting: {
    label: 'Meeting reminder',
    objective: 'Remind them of their upcoming meeting or appointment and confirm they will attend.',
    guidance: 'This is a short reminder call, not a sales pitch. State the meeting or appointment (date, time, place or link, from the notes and sheet row below), ask them to confirm they can attend, and offer to note a new time if they cannot. Keep it under two minutes.',
  },
  reminder_payment: {
    label: 'Payment / deadline reminder',
    objective: 'Remind them of the amount or deadline that is due and find out when they will settle it.',
    guidance: 'This is a short, polite reminder call about a payment or deadline. Use only the amount, due date and details in the notes and sheet row below; never guess an amount. Ask when they expect to pay or complete it, and repeat that date back. Never threaten or pressure.',
  },
  reminder_followup: {
    label: 'Follow-up reminder',
    objective: 'Make the follow-up call that was scheduled for this lead.',
    guidance: 'You are making a follow-up call that was scheduled earlier (see the open reminders and recent activity below). Say why you are calling back and move the conversation to the next step.',
  },
  notice: {
    label: 'Notice / important information',
    objective: 'Deliver the message in the notes clearly and make sure they understood it.',
    guidance: 'This is a short call to pass on important information, not a sales pitch. Say the message from the notes plainly, in your own words, near the start. Then check they understood, and answer questions only from the notes and the details below — if something is not written there, say the team will confirm. Repeat any date, time, place or amount exactly as written. Keep it under two minutes.',
  },
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
    callType?: string | null;
    /** The user's own instructions for this call. */
    note?: string | null;
    /** The organisation's agent (Admin → Sales Voice Agent): identity, knowledge, opening line. */
    agent?: OrgAgentConfig | null;
  },
): Promise<CallBrief> {
  const { userId, contactId } = params;
  const callType: CallType = isCallType(params.callType) ? params.callType : 'sales';
  const typeBrief = CALL_TYPE_BRIEFS[callType];
  const sheet = await getLeadSheetContext(pool, userId, contactId).catch(() => null);

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
  const agent = params.agent ?? null;
  const businessName = agent?.businessName || params.businessName || null;
  // The org's default objective is for first contacts; later stages keep their own.
  const stageObjective = stage === 'new' && agent?.defaultObjective ? agent.defaultObjective : DEFAULT_OBJECTIVES[stage];
  const objective =
    params.objective?.trim() || typeBrief.objective || stageObjective || DEFAULT_OBJECTIVES.new;
  const sheetText = sheet ? renderLeadSheet(sheet) : '';

  // The org playbook (Admin → Sales Voice Agent) answers first; responses the
  // Insight agent learned into sales_playbooks fill any code it does not cover.
  const playbookByCode = new Map<string, string>();
  for (const e of agent?.playbook ?? []) {
    if (e.code !== 'other' && !playbookByCode.has(e.code)) playbookByCode.set(e.code, e.response);
  }
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

  const sharedContext = await buildSharedAgentContext(userId).catch(() => '');
  const business = [agent?.knowledge?.trim(), sharedContext].filter(Boolean).join('\n\n');
  const objectionGuide = agent ? renderPlaybook(agent, OBJECTION_LABELS) : '';
  const extraRules = (agent?.extraRules || '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean)
    .map((l) => `- ${l}`);

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
    agent?.persona
      ? fillTemplate(agent.persona, agent)
      : `You are a sales representative${businessName ? ` for ${businessName}` : ''}.`,
    'You are making a phone call and speaking out loud on a live call, so keep replies short and conversational — one or two sentences, then let them talk. Never read lists, links or symbols aloud; say web addresses simply, like "africon dot A I".',
    '',
    `CALL TYPE: ${typeBrief.label}`,
    typeBrief.guidance,
    '',
    'CALL OBJECTIVE',
    objective,
    params.followUpReason ? `\nWhy we are calling now: ${params.followUpReason}` : '',
    params.note?.trim() ? `\nNOTES FROM THE TEAM FOR THIS CALL (follow these):\n${params.note.trim().slice(0, 2000)}` : '',
    '',
    'WHO YOU ARE CALLING',
    whoParts.map((p) => `- ${p}`).join('\n'),
    profile.summary ? `\nWhat we know about them: ${profile.summary}` : '',
    sheetText ? `\n${sheetText}` : '',
    '',
    'WHAT HAPPENED LAST TIME',
    lastTime,
    '',
    sheet?.recentActivity.length ? `RECENT ACTIVITY (newest first)\n${bullets(sheet.recentActivity, '')}\n` : '',
    sheet?.openReminders.length ? `OPEN REMINDERS FOR THIS LEAD\n${bullets(sheet.openReminders, '')}\n` : '',
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
    objectionGuide ? `OBJECTION PLAYBOOK — how to handle what people say\n${objectionGuide}\n` : '',
    'DO NOT',
    '- Pressure the lead or push after a clear no.',
    '- Re-ask anything already answered in "what happened last time".',
    '- Claim a promise was delivered if it is listed as not yet delivered.',
    '- Invent pricing, features, timelines, or customer names. If you do not know, say you will find out.',
    '- Read the sheet row aloud like a list, or mention details that are not relevant to this call.',
    '- Quote an amount, date or meeting detail that is not written above.',
    '- Argue. If they object, acknowledge it and ask a question.',
    ...extraRules,
    '',
    'HOW TO END',
    'If they give you new or corrected details (a new email, an amount paid, a date they will pay, whether they will attend), repeat them back to confirm. If they want a follow-up, ask for a specific day and time and repeat it back. If they ask not to be called again, acknowledge it warmly and end the call. Always thank them for their time.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const firstName = name ? String(contact.first_name || name).split(' ')[0] : '';
  const firstMessage = agent
    ? fillTemplate(firstName ? agent.firstMessage : agent.firstMessageNoName, agent, firstName)
    : firstName
      ? `Hi ${firstName}, do you have a quick minute?`
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
  agent?: OrgAgentConfig | null,
): string {
  const prefixes: string[] = [];
  const name = agent?.businessName || businessName;
  if (policy.aiDisclosureRequired) {
    const custom = policy.aiDisclosureText?.trim() || agent?.disclosureText?.trim();
    prefixes.push(
      custom
        ? (agent ? fillTemplate(custom, agent) : custom)
        : `Hi, this is an AI assistant calling${name ? ` on behalf of ${name}` : ''}.`,
    );
  } else if (agent?.greetingText?.trim()) {
    // No AI disclosure, but the agent still says who it is and who it calls for.
    prefixes.push(fillTemplate(agent.greetingText, agent));
  }
  if (policy.recordingDisclosureRequired) {
    prefixes.push('This call is being recorded.');
  }
  return [...prefixes, firstMessage].join(' ');
}
