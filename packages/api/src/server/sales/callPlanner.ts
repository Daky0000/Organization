// ─────────────────────────────────────────────────────────────────────────────
// The call planner — what a call is for, and which number to dial.
//
// Before a call is queued, two things are worked out from the lead and the
// reason the user (or the main assistant) gave:
//
//   1. Purpose. A sales pitch, a follow-up, a meeting reminder, a payment
//      reminder, a scheduled follow-up, or a notice (important information).
//      The note wins when it says what the call is about; otherwise the lead's
//      own data decides — an amount or due date in the sheet row, a meeting
//      date, an open reminder, a previous conversation.
//
//   2. Number. The contact's phone, or a phone-looking sheet column (Tel,
//      Mobile, WhatsApp…) when that is empty or invalid. Each candidate is
//      parsed for its country and line type, so an invalid or premium-rate
//      number is refused before anything dials and a toll-free one is flagged.
//
// It is deterministic on purpose: the same lead and note always plan the same
// call, every decision comes with a plain reason the user can check, and a
// planner that cannot be argued with by a prompt cannot be talked into
// dialling the wrong person.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import type { CountryCode } from 'libphonenumber-js/max';
import { getLeadSheetContext, type LeadSheetContext, type SheetColumn } from './leadSheetContext.ts';
import { describePhone, toCountryCode, type PhoneInfo } from './orgAgent.ts';
import { CALL_TYPES, type CallType } from './types.ts';

export type CallTypeChoice = CallType | 'auto';
export const isCallTypeChoice = (v: unknown): v is CallTypeChoice =>
  v === 'auto' || (typeof v === 'string' && (CALL_TYPES as readonly string[]).includes(v));

export interface PurposeDecision {
  callType: CallType;
  /** One sentence the user can check: why this purpose. */
  reason: string;
  /** True when the planner chose; false when the caller named the type. */
  autoDetected: boolean;
}

// ─── Purpose ────────────────────────────────────────────────────────────────

// English and French (West Africa) wording, matched at the start of a word
// (so "payments", "reminding", "rappeler" count). Unicode-aware, because \b
// does not see a word boundary before "é".
const words = (alternatives: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(${alternatives})`, 'iu');

const PAYMENT = words('pay|paid|owe|owing|balance|outstanding|arrears|invoice|fees?|tuition|deadline|instal?lments?|deposit|debt|ghs|cedis?|naira|fcfa|paiement|payer|solde|facture|frais|échéance|dette');
const REMIND = words("remind|reminder|don't forget|do not forget|rappel|n'oubliez");
const MEETING_STRONG = words('meeting|appointment|rsvp|attend|attendance|zoom|google meet|teams link|interview|réunion|rendez-vous|rdv');
const EVENT = words('session|class|webinar|event|masterclass|workshop|training|cohort|sprint|programme|program|formation|atelier|séance|événement');
const WHEN = words('\\d{1,2}(:\\d{2})?\\s?(am|pm|h)|tomorrow|today|tonight|this (morning|afternoon|evening|week)|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche');
const CHANGE = words('cancel|postpon|reschedul|moved to|changed|change of|new date|new venue|new time|annul|report');
const NOTICE = words('notice|notify|inform|announce|update|important|alert|closure|closed|holiday|avis|annonce|informer');
const SCHEDULED_FOLLOW = words('scheduled follow|as promised|promised to call|call (them |him |her )?back|callback|ring back|rappeler');
const FOLLOW_UP = words('follow[\\s-]?up|following up|check[\\s-]?in|checking in|last (call|time|week|conversation)|we spoke|they asked|as discussed|relance|suite à');
const SALES = words('introduce|pitch|offer|sell|promote|demo|interested|prospect|book a (call|consultation|demo)|consultation|présenter|proposer|découvrir');

const COLUMN_HINTS: Array<{ type: CallType; label: RegExp }> = [
  { type: 'reminder_payment', label: /(amount|balance|owed|owing|due|outstanding|fee|invoice|payment|paid|arrears|montant|solde)/i },
  { type: 'reminder_meeting', label: /(meeting|appointment|session date|event date|class date|attend|venue|réunion|rendez)/i },
];

function filled(col: SheetColumn): boolean {
  const v = col.value;
  return v !== null && v !== undefined && v !== '' && v !== false;
}

const quote = (re: RegExp, text: string) => (text.match(re)?.[1] ?? '').trim();

/**
 * Decide what the call is for. An explicit type is kept as given; 'auto' (or
 * nothing) is decided from the note first, then the lead's data.
 */
export function detectCallPurpose(input: {
  requested?: CallTypeChoice | null;
  note?: string | null;
  sheet?: Pick<LeadSheetContext, 'columns' | 'openReminders'> | null;
  stage?: string | null;
  hasPriorConversation?: boolean;
}): PurposeDecision {
  if (input.requested && input.requested !== 'auto') {
    return { callType: input.requested, reason: 'You chose this type of call.', autoDetected: false };
  }
  const note = (input.note ?? '').trim();
  const said = (re: RegExp) => `The reason mentions "${quote(re, note)}".`;
  const decide = (callType: CallType, reason: string): PurposeDecision => ({ callType, reason, autoDetected: true });

  if (note) {
    // Most specific first. Something that changed is news, whatever it is about.
    if (CHANGE.test(note) && (EVENT.test(note) || MEETING_STRONG.test(note) || NOTICE.test(note))) {
      return decide('notice', `The reason says something changed ("${quote(CHANGE, note)}"), so the call delivers a notice.`);
    }
    if (PAYMENT.test(note)) return decide('reminder_payment', said(PAYMENT));
    if (MEETING_STRONG.test(note)) return decide('reminder_meeting', said(MEETING_STRONG));
    // "Masterclass" alone is a product being sold; with "remind" or a day/time it is an appointment.
    if (EVENT.test(note) && (REMIND.test(note) || WHEN.test(note)) && !SALES.test(note)) {
      return decide('reminder_meeting', `The reason mentions "${quote(EVENT, note)}" with a reminder or a time.`);
    }
    if (NOTICE.test(note)) return decide('notice', said(NOTICE));
    if (SCHEDULED_FOLLOW.test(note)) return decide('reminder_followup', said(SCHEDULED_FOLLOW));
    if (FOLLOW_UP.test(note)) return decide('follow_up', said(FOLLOW_UP));
    if (SALES.test(note) || EVENT.test(note)) return decide('sales', said(SALES.test(note) ? SALES : EVENT));
    if (REMIND.test(note)) return decide('reminder_followup', said(REMIND));
  }

  const cols = (input.sheet?.columns ?? []).filter(filled);
  for (const hint of COLUMN_HINTS) {
    const col = cols.find((c) => hint.label.test(c.label) || (hint.type === 'reminder_payment' && c.type === 'currency'));
    if (col) return decide(hint.type, `The lead's sheet row has "${col.label}" filled in.`);
  }
  if (input.sheet?.openReminders?.length) return decide('reminder_followup', 'The lead has an open follow-up reminder.');
  if (input.hasPriorConversation) return decide('follow_up', 'There is a previous conversation with this lead.');
  if (note) return decide('notice', 'The reason is a message to pass on and does not read like a sale or a reminder.');
  return decide('sales', 'No reason given and nothing in the lead data points elsewhere, so it is a first sales call.');
}

// ─── Number ─────────────────────────────────────────────────────────────────

export interface PhoneCandidate { source: string; raw: string; info: PhoneInfo }

export interface PhoneResolution {
  /** The number to dial, when there is one that may be called. */
  phone: PhoneInfo | null;
  /** Where it came from: "Phone", or a sheet column label. */
  source: string | null;
  callable: boolean;
  /** Why it cannot be called, or a caution about the number that will be. */
  warning: string | null;
  candidates: PhoneCandidate[];
}

const PHONE_LABEL = /(phone|tel|mobile|cell|whatsapp|contact|number|momo|téléphone|portable|numéro)/i;
// A person answers a mobile; then a number that may be one; then a landline.
const TYPE_RANK: Record<string, number> = { MOBILE: 0, FIXED_LINE_OR_MOBILE: 1, FIXED_LINE: 2 };

const TYPE_WORDS: Record<string, string> = {
  MOBILE: 'mobile', FIXED_LINE: 'landline', FIXED_LINE_OR_MOBILE: 'mobile or landline', TOLL_FREE: 'toll-free',
  PREMIUM_RATE: 'premium-rate', SHARED_COST: 'shared-cost', VOIP: 'internet (VoIP)', PERSONAL_NUMBER: 'personal number',
  PAGER: 'pager', UAN: 'company number', VOICEMAIL: 'voicemail',
};
export const phoneTypeLabel = (type: string | null | undefined) => (type ? TYPE_WORDS[type] ?? type.toLowerCase() : 'number');

/**
 * Pick the number to dial. The contact's phone first; a phone column from the
 * sheet when that is missing or invalid; then any other cell that parses as a
 * valid phone. A mobile or landline beats any other line type.
 */
export function resolveLeadPhone(input: {
  contactPhone?: string | null;
  sheet?: Pick<LeadSheetContext, 'columns'> | null;
  localCountry: CountryCode;
}): PhoneResolution {
  const raws: Array<{ source: string; raw: string }> = [];
  if (input.contactPhone?.trim()) raws.push({ source: 'Phone', raw: input.contactPhone.trim() });
  const cols = (input.sheet?.columns ?? []).filter(filled);
  for (const c of cols) {
    if (c.type === 'phone' || PHONE_LABEL.test(c.label)) raws.push({ source: c.label, raw: String(c.value) });
  }
  // Last resort: a number typed into some other text column.
  for (const c of cols) {
    if (c.type === 'text' && !PHONE_LABEL.test(c.label) && /^\+?[\d\s\-().]{8,20}$/.test(String(c.value))) {
      raws.push({ source: c.label, raw: String(c.value) });
    }
  }

  const seen = new Set<string>();
  const candidates: PhoneCandidate[] = [];
  for (const r of raws) {
    // A cell can hold two numbers: "0244 123456 / 0501 234567".
    for (const part of r.raw.split(/\s*[/,;|]\s*|\s+or\s+/i).filter(Boolean)) {
      const info = describePhone(part, input.localCountry);
      const key = info.e164 ?? `${r.source}:${part}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ source: r.source, raw: part, info });
    }
  }

  const valid = candidates.filter((c) => c.info.valid);
  // Best line type first; among equals, the order found (contact phone, then sheet).
  const rank = (c: PhoneCandidate) => TYPE_RANK[c.info.type ?? ''] ?? (c.info.type === 'PREMIUM_RATE' ? 9 : 5);
  const best = [...valid].sort((a, b) => rank(a) - rank(b))[0];

  if (!best) {
    const typed = candidates[0];
    return {
      phone: null, source: null, callable: false, candidates,
      warning: typed
        ? `"${typed.raw}" (${typed.source}) is not a valid phone number. Add the country code, e.g. +228 for Togo.`
        : 'This lead has no phone number.',
    };
  }
  if (best.info.type === 'PREMIUM_RATE') {
    return { phone: best.info, source: best.source, callable: false, candidates,
      warning: `${best.info.e164} is a premium-rate number; it is not called because it charges per minute.` };
  }
  const caution =
    best.info.type === 'TOLL_FREE' ? 'This is a toll-free number; many cannot be reached from another country.'
    : best.info.type === 'VOIP' ? 'This is an internet (VoIP) number; it may not ring a phone.'
    : best.source !== 'Phone' ? `Using the number from the "${best.source}" column.`
    : null;
  return { phone: best.info, source: best.source, callable: true, warning: caution, candidates };
}

// ─── The whole plan, from the database ──────────────────────────────────────

export interface CallPlan {
  contactId: string;
  leadName: string;
  purpose: PurposeDecision;
  number: PhoneResolution;
  /** The country a local "0…" number was read in. */
  localCountry: string;
}

export async function planCall(
  pool: Pool,
  params: { userId: string; contactId: string; requested?: CallTypeChoice | null; note?: string | null; defaultCountry: string },
): Promise<CallPlan | null> {
  const [contactRes, profileRes, convRes, sheet] = await Promise.all([
    pool.query(`SELECT first_name, last_name, phone FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [params.contactId, params.userId]),
    pool.query(`SELECT stage FROM sales_lead_profiles WHERE contact_id=$1 AND user_id=$2`, [params.contactId, params.userId]),
    pool.query(`SELECT 1 FROM sales_conversations WHERE contact_id=$1 AND user_id=$2 LIMIT 1`, [params.contactId, params.userId]),
    getLeadSheetContext(pool, params.userId, params.contactId).catch(() => null),
  ]);
  const contact = contactRes.rows[0];
  if (!contact) return null;

  const localCountry = (toCountryCode(sheet?.company?.country) ?? toCountryCode(params.defaultCountry) ?? 'GH') as CountryCode;
  return {
    contactId: params.contactId,
    leadName: [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || 'this lead',
    purpose: detectCallPurpose({
      requested: params.requested,
      note: params.note,
      sheet,
      stage: profileRes.rows[0]?.stage ?? null,
      hasPriorConversation: (convRes.rowCount ?? 0) > 0,
    }),
    number: resolveLeadPhone({ contactPhone: contact.phone, sheet, localCountry }),
    localCountry,
  };
}
