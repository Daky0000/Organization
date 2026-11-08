// ─────────────────────────────────────────────────────────────────────────────
// Event bookings — who booked, who failed, who only looked.
//
// The Africon website does not publish its bookings, so they reach the Sales
// OS from Africon's own backend: a signed POST to
// /api/integrations/africon/bookings (pushed as things happen), a bookings
// API we poll on each sync, or a spreadsheet export linked to an event.
//
// Whatever the route, a record is normalised here first. The shape accepted is
// deliberately loose: the field names Africon's booking form already sends
// (eventId, eventSlug, userInfo{name,email,phone,company}, bookingRef,
// paymentIntent: "pay_later", selectedCohortId…) are read as they are, so the
// dashboard can forward the object it already builds rather than map it.
//
// Every booking lands in one segment, and the segment decides the call:
//   failed_booking  started to book or pay and did not finish  → help them finish
//   unpaid          booked with "pay later", not paid yet       → payment reminder
//   upcoming        paid / confirmed, the class is ahead        → reminder + prep
//   interested      viewed, enquired, chatted, waitlisted       → invite to book
//   awaiting_review registration waiting on Africon's review    → no call
//   past / cancelled                                            → no call
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'crypto';
import { isPastEvent, type SiteEvent } from './eventSource.ts';

export const BOOKING_STATUSES = [
  'interested', 'started', 'payment_failed', 'pay_later', 'pending_review', 'confirmed', 'attended', 'no_show', 'cancelled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_SEGMENTS = [
  'failed_booking', 'unpaid', 'upcoming', 'interested', 'awaiting_review', 'past', 'cancelled',
] as const;
export type BookingSegment = (typeof BOOKING_SEGMENTS)[number];

/** The segments the agent calls. The others are shown, never dialled. */
export const CALL_SEGMENTS = ['failed_booking', 'unpaid', 'upcoming', 'interested'] as const;
export type CallSegment = (typeof CALL_SEGMENTS)[number];
export const isCallSegment = (v: unknown): v is CallSegment =>
  typeof v === 'string' && (CALL_SEGMENTS as readonly string[]).includes(v);

export const SEGMENT_LABELS: Record<BookingSegment, string> = {
  failed_booking: 'Tried to book, did not finish',
  unpaid: 'Booked, payment outstanding',
  upcoming: 'Booked, class coming up',
  interested: 'Showed interest',
  awaiting_review: 'Waiting for Africon review',
  past: 'Event over',
  cancelled: 'Cancelled',
};

/**
 * How far a status has got. Without timestamps, a later message never moves a
 * booking backwards (a late "payment started" after "paid" is ignored);
 * cancelled always wins.
 */
const STATUS_RANK: Record<BookingStatus, number> = {
  interested: 0, started: 1, payment_failed: 2, pay_later: 3, pending_review: 3,
  confirmed: 5, attended: 6, no_show: 6, cancelled: 9,
};

const STATUS_WORDS: Array<[RegExp, BookingStatus]> = [
  // "Not eligible" is Africon turning a registration down: never call about it.
  [/cancel|refund|void|not[\s_-]?eligible|reject/i, 'cancelled'],
  [/no[\s_-]?show|absent/i, 'no_show'],
  [/attend|checked[\s_-]?in|check[\s_-]?in|present/i, 'attended'],
  [/pay[\s_-]?later|invoice|reserved|reservation/i, 'pay_later'],
  [/fail|declin|abandon|expire|timeout|unsuccess|error/i, 'payment_failed'],
  [/(^|[^a-z])(paid|success|succeeded|complete|completed|confirm|confirmed|verified|approved|registered)([^a-z]|$)/i, 'confirmed'],
  [/review|screening|approval/i, 'pending_review'],
  [/start|initiali|initiated|checkout|pending|awaiting|unpaid|draft|in[\s_-]?progress/i, 'started'],
  [/interest|enquir|inquir|view|visit|waitlist|chat|lead|download|brochure|contact/i, 'interested'],
];

/** Read any status word Africon's systems may use. Null when it means nothing we know. */
export function parseBookingStatus(raw: unknown): BookingStatus | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim().toLowerCase();
  if ((BOOKING_STATUSES as readonly string[]).includes(v)) return v as BookingStatus;
  for (const [re, status] of STATUS_WORDS) if (re.test(v)) return status;
  return null;
}

/** Which segment a booking is in, given its event (null when the event is not synced yet). */
export function segmentFor(status: BookingStatus, event: SiteEvent | null, now = new Date()): BookingSegment {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'attended' || status === 'no_show') return 'past';
  if (event && isPastEvent(event, now)) return 'past';
  switch (status) {
    case 'started':
    case 'payment_failed':
      return 'failed_booking';
    case 'pay_later':
      return 'unpaid';
    case 'pending_review':
      return 'awaiting_review';
    case 'confirmed':
      return 'upcoming';
    default:
      return 'interested';
  }
}

/**
 * Which status to keep when a new record arrives for a booking we already
 * hold. A record with a time newer than the last one wins; otherwise the
 * furthest-along status wins, and "cancelled" always does.
 */
export function mergeStatus(
  stored: { status: BookingStatus; lastEventAt: Date | null } | null,
  incoming: { status: BookingStatus; occurredAt: Date | null },
): BookingStatus {
  if (!stored) return incoming.status;
  if (incoming.status === 'cancelled') return 'cancelled';
  if (incoming.occurredAt && stored.lastEventAt) {
    return incoming.occurredAt.getTime() >= stored.lastEventAt.getTime() ? incoming.status : stored.status;
  }
  return STATUS_RANK[incoming.status] >= STATUS_RANK[stored.status] ? incoming.status : stored.status;
}

export interface BookingRecord {
  /** Africon's booking reference, when there is one. */
  externalId: string | null;
  /** The event's site id or slug, whichever the record carried. */
  eventRef: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  status: BookingStatus;
  /** The status word as Africon sent it, kept for the record. */
  rawStatus: string | null;
  cohortId: string | null;
  cohortLabel: string | null;
  sessionDate: string | null;
  attendees: number | null;
  amount: number | null;
  currency: string | null;
  /** website, ai-chat, whatsapp, import… */
  source: string | null;
  /** When the thing this record describes happened. */
  occurredAt: Date | null;
  bookedAt: Date | null;
  /** When a pay-later booking must be paid by, if Africon sent it. */
  paymentDueAt: Date | null;
  /** An explicit yes/no to being contacted, if the record carried one. */
  consent: boolean | null;
  notes: string | null;
  /** Answers to the booking form's own questions (sector, company size…). */
  answers: Record<string, string>;
}

const s = (v: unknown, max = 300): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(x) ? x : null;
};
const when = (v: unknown): Date | null => {
  if (v && typeof v === 'object' && typeof (v as any)._seconds === 'number') return new Date((v as any)._seconds * 1000);
  if (v && typeof v === 'object' && typeof (v as any).seconds === 'number') return new Date((v as any).seconds * 1000);
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
};
const yesNo = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|y|1|opt[\s_-]?in)$/i.test(v.trim())) return true;
    if (/^(false|no|n|0|opt[\s_-]?out)$/i.test(v.trim())) return false;
  }
  return null;
};

function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? null, last: parts.slice(1).join(' ') || null };
}

/**
 * One booking from whatever Africon sends. Returns null with a reason when the
 * record cannot be used (no event, no way to reach the person).
 */
export function normalizeBooking(input: unknown): { record: BookingRecord | null; error: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { record: null, error: 'not an object' };
  // A webhook envelope ({ type, data: {...} }) or the booking itself.
  const env = input as Record<string, any>;
  const b: Record<string, any> = env.data && typeof env.data === 'object' && !Array.isArray(env.data)
    ? { ...env.data, type: env.data.type ?? env.type ?? env.event, occurredAt: env.data.occurredAt ?? env.occurredAt ?? env.timestamp }
    : env.bookingData && typeof env.bookingData === 'object'
      ? { ...env.bookingData, ...env, bookingData: undefined }
      : env;
  const who: Record<string, any> = b.userInfo && typeof b.userInfo === 'object' ? b.userInfo : (b.attendee ?? b.customer ?? b.contact ?? {});
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = who[k] ?? b[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };

  const eventRef = s(b.eventId ?? b.event_id ?? b.eventSlug ?? b.event_slug ?? b.event?.id ?? b.event?.slug ?? b.slug, 200);
  if (!eventRef) return { record: null, error: 'no eventId or eventSlug' };

  const fullName = s(pick('name', 'fullName', 'full_name'), 200);
  const split = splitName(fullName);
  const email = s(pick('email', 'emailAddress'), 200)?.toLowerCase() ?? null;
  const phone = s(pick('phone', 'phoneNumber', 'phone_number', 'mobile', 'whatsapp', 'tel'), 40);
  if (!email && !phone) return { record: null, error: 'no email or phone' };

  const rawStatus = s(b.status ?? b.bookingStatus ?? b.paymentStatus ?? b.payment_status ?? b.state, 80);
  const typeWord = s(b.type ?? b.event_type ?? b.eventType ?? b.action, 80);
  let status = parseBookingStatus(rawStatus) ?? parseBookingStatus(typeWord);
  const payLater = /pay[\s_-]?later/i.test(String(b.paymentIntent ?? b.payment_intent ?? b.paymentMethod ?? ''));
  // "pending" on a pay-later booking means "booked, not paid", not "abandoned checkout".
  if (payLater && (!status || status === 'started')) status = 'pay_later';
  if (!status) status = b.paid === true || b.isPaid === true ? 'confirmed' : 'interested';

  const answers: Record<string, string> = {};
  const rawAnswers = b.answers ?? b.questions ?? b.customAnswers ?? b.roleConfig;
  if (rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)) {
    for (const [k, v] of Object.entries(rawAnswers).slice(0, 20)) {
      const val = s(v, 200);
      if (val) answers[k.slice(0, 60)] = val;
    }
  }
  for (const k of ['sector', 'industry', 'companySize', 'executiveTitle', 'classFormat', 'attendanceMode']) {
    const val = s(b[k] ?? who[k], 200);
    if (val && !answers[k]) answers[k] = val;
  }

  return {
    error: null,
    record: {
      externalId: s(b.bookingRef ?? b.booking_ref ?? b.reference ?? b.bookingId ?? b.booking_id ?? b.id, 120),
      eventRef,
      firstName: s(pick('firstName', 'first_name'), 120) ?? split.first,
      lastName: s(pick('lastName', 'last_name'), 120) ?? split.last,
      email,
      phone,
      company: s(pick('company', 'organisation', 'organization', 'school'), 200),
      role: s(pick('role', 'jobTitle', 'title', 'position'), 120),
      status,
      rawStatus: rawStatus ?? typeWord,
      cohortId: s(b.selectedCohortId ?? b.cohortId ?? b.dateEntryId, 120),
      cohortLabel: s(b.selectedCohortLabel ?? b.cohortLabel, 120),
      sessionDate: s(b.selectedDate ?? b.sessionDate ?? b.date, 10)?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null,
      attendees: n(b.attendeeCount ?? b.attendees ?? b.quantity),
      amount: n(b.finalAmount ?? b.amount ?? b.totalAmount ?? b.originalAmount),
      currency: s(b.currency ?? b.originalCurrency, 8)?.toUpperCase() ?? null,
      source: s(b.source ?? b.channel, 40),
      occurredAt: when(b.occurredAt ?? b.updatedAt ?? b.updated_at ?? b.timestamp),
      bookedAt: when(b.createdAt ?? b.created_at ?? b.bookedAt ?? b.booked_at),
      paymentDueAt: when(b.paymentDueAt ?? b.payment_due_at ?? b.payLaterDeadline ?? b.dueAt),
      consent: yesNo(b.consent ?? b.marketingConsent ?? b.contactConsent ?? b.optIn ?? who.consent),
      notes: s(b.specialRequirements ?? b.notes ?? b.message, 1000),
      answers,
    },
  };
}

/** A body that is one booking, an array, or { bookings: [...] }. */
export function bookingList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body.slice(0, 1000);
  if (body && typeof body === 'object') {
    const b = body as Record<string, any>;
    for (const k of ['bookings', 'items', 'records', 'results']) if (Array.isArray(b[k])) return b[k].slice(0, 1000);
    return [body];
  }
  return [];
}

/**
 * Check the shared secret on an incoming bookings POST. Either an HMAC of the
 * raw body — X-Africon-Signature: sha256=<hex> — or the secret itself as a
 * bearer token, for tools that cannot sign (Zapier, Make, a quick script).
 */
export function verifyBookingRequest(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  secret: string,
): boolean {
  if (!secret) return false;
  const header = (name: string) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] ?? '' : v ?? '';
  };
  const safeEq = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const sig = header('x-africon-signature').trim();
  if (sig) {
    const given = sig.replace(/^sha256=/i, '').toLowerCase();
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEq(given, expected);
  }
  const auth = header('authorization').trim();
  const token = auth.replace(/^Bearer\s+/i, '');
  return !!token && token !== auth ? safeEq(token, secret) : false;
}
