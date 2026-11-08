// ─────────────────────────────────────────────────────────────────────────────
// Africon events, read from the public website.
//
// africon.ai is a Next.js site. Every event page streams the full event record
// to the browser inside the React Server Components payload
// (self.__next_f.push([...]) script chunks), and the /events listing carries
// every published event in one response. Detail pages also carry a schema.org
// Event in JSON-LD with the current offer price. So one listing fetch plus one
// fetch per event gives everything a sales agent needs: dates and cohorts,
// prices, early-bird and registration deadlines, seats, venue, agenda, who it
// is for, FAQs.
//
// Bookings are not public. Who booked, who failed to pay and who chose "pay
// later" live in Africon's own backend; they arrive through the bookings
// endpoint (eventBookings.ts), never from this scraper.
//
// Everything here is pure: HTML in, normalised events out. The fetching —
// Apify or a plain HTTP request — lives in eventsEngine.ts, so both paths are
// parsed the same way and the parser is testable against saved pages.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';

export const AFRICON_SITE_URL = 'https://www.africon.ai';

/** One date the event runs on: a cohort, a session or the whole event. */
export interface EventSession {
  id: string | null;
  label: string | null;
  /** 'YYYY-MM-DD' */
  startDate: string;
  endDate: string | null;
  /** 'HH:MM' local to the event's timezone. */
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  address: string | null;
  capacity: number | null;
  registered: number | null;
  available: number | null;
  isFull: boolean;
  /** The price the site charges for this session today, when the site says. */
  currentPrice: number | null;
  /** The pricing tier in force ("Early Bird"), when the site says. */
  activeTier: string | null;
}

export interface PriceTier {
  label: string;
  price: number;
  /** 'YYYY-MM-DD' — the tier applies up to and including this day. */
  deadline: string | null;
}

export interface SiteEvent {
  /** The site's own id (Firestore document id). */
  externalId: string;
  slug: string;
  title: string;
  url: string;
  category: string | null;
  format: string | null;
  level: string | null;
  status: string | null;
  timezone: string;
  sessions: EventSession[];
  /** First session start, 'YYYY-MM-DD'. */
  startDate: string | null;
  /** Last session end, 'YYYY-MM-DD'. */
  endDate: string | null;
  timeText: string | null;
  venue: string | null;
  address: string | null;
  location: string | null;
  price: number | null;
  currency: string;
  earlyBirdPrice: number | null;
  earlyBirdDeadline: string | null;
  pricingTiers: PriceTier[];
  registrationDeadline: string | null;
  capacity: number | null;
  registered: number | null;
  allowPayLater: boolean;
  payLaterDeadlineHours: number | null;
  allowDiscountCodes: boolean;
  certificate: boolean;
  instructor: { name: string; title: string | null } | null;
  coHost: string | null;
  summary: string;
  audience: string[];
  outcomes: string[];
  inclusions: string[];
  prerequisites: string[];
  agenda: { time: string | null; title: string }[];
  faqs: { question: string; answer: string }[];
  cancellationPolicy: string | null;
  image: string | null;
  /** The site's own last-modified time for the record. */
  siteUpdatedAt: string | null;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Join the React Server Components chunks of a Next.js page into one string.
 * Each chunk is a JS string literal; JSON.parse decodes its escapes.
 */
export function extractRscText(html: string): string {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { out += JSON.parse(`"${m[1]}"`); } catch { /* a malformed chunk is skipped, not fatal */ }
  }
  return out;
}

/** The JSON object that starts at `start` (a '{'), or null. String-aware brace matching. */
function objectAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
    // Cap the scan: an event record is tens of KB, never megabytes.
    if (i - start > 400_000) return null;
  }
  return null;
}

/**
 * Every event record in a text: an object with an id, a slug and a title, and
 * something that makes it an event (dates or a price). Duplicates (the same
 * slug streamed twice) keep the richest copy.
 */
export function extractEventObjects(text: string): Record<string, any>[] {
  const bySlug = new Map<string, Record<string, any>>();
  const re = /\{"id":"[A-Za-z0-9_-]{6,64}"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const obj = objectAt(text, m.index);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const o = obj as Record<string, any>;
    if (typeof o.slug !== 'string' || typeof o.title !== 'string') continue;
    if (!('eventDates' in o) && !('date' in o) && !('price' in o)) continue;
    const prev = bySlug.get(o.slug);
    if (!prev || Object.keys(o).length > Object.keys(prev).length) bySlug.set(o.slug, o);
  }
  return [...bySlug.values()];
}

/** schema.org Event objects from JSON-LD script tags. */
export function extractJsonLdEvents(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item && typeof item === 'object' && (item as any)['@type'] === 'Event') out.push(item as Record<string, any>);
    }
  }
  return out;
}

/** Event slugs linked from a page: /events/<slug>, without query strings. */
export function extractEventLinks(html: string): string[] {
  const slugs = new Set<string>();
  const re = /href="(?:https?:\/\/(?:www\.)?africon\.ai)?\/events\/([a-z0-9][a-z0-9-]*)(?:[?#"][^"]*)?"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) slugs.add(m[1].toLowerCase());
  return [...slugs];
}

// ─── Normalisation ───────────────────────────────────────────────────────────

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null => {
  const s = str(v, 40);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const hhmm = (v: unknown): string | null => {
  const m = str(v, 10)?.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};
const textList = (v: unknown, pick: (x: any) => unknown = (x) => x, max = 20): string[] =>
  Array.isArray(v) ? v.map((x) => str(pick(x), 300)).filter((x): x is string => !!x).slice(0, max) : [];

function sessionsOf(raw: Record<string, any>): EventSession[] {
  const base = {
    venue: str(raw.venue, 200), address: str(raw.venueAddress, 300),
  };
  const list: EventSession[] = [];
  if (Array.isArray(raw.eventDates)) {
    for (const d of raw.eventDates) {
      const start = day(d?.startDate) ?? day(d?.date);
      if (!start) continue;
      list.push({
        id: str(d?.id, 100),
        label: str(d?.label, 100),
        startDate: start,
        endDate: day(d?.endDate) ?? (d?.type === 'range' ? null : start),
        startTime: hhmm(d?.startTime),
        endTime: hhmm(d?.endTime),
        venue: str(d?.venue, 200) ?? base.venue,
        address: str(d?.venueAddress, 300) ?? base.address,
        capacity: num(d?.capacity),
        registered: null,
        available: null,
        isFull: false,
        currentPrice: null,
        activeTier: null,
      });
    }
  }
  if (!list.length && Array.isArray(raw.dates)) {
    for (const d of raw.dates) {
      const start = day(d?.date);
      if (!start) continue;
      list.push({
        id: str(d?.id, 100), label: str(d?.label, 100), startDate: start, endDate: start,
        startTime: hhmm(d?.time), endTime: null, venue: str(d?.venue, 200) ?? base.venue,
        address: base.address, capacity: num(d?.capacity), registered: null, available: null,
        isFull: false, currentPrice: null, activeTier: null,
      });
    }
  }
  if (!list.length) {
    const start = day(raw.dateRange?.startDate) ?? day(raw.date) ?? day(raw.startDate);
    if (start) {
      const [t1, t2] = String(raw.time ?? '').split(/\s*[-–]\s*/);
      list.push({
        id: null, label: null, startDate: start,
        endDate: day(raw.dateRange?.endDate) ?? day(raw.endDate) ?? start,
        startTime: hhmm(t1), endTime: hhmm(t2), ...base,
        capacity: num(raw.capacity), registered: null, available: null, isFull: false,
        currentPrice: null, activeTier: null,
      });
    }
  }
  return list.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** The site's event record (from the RSC payload), as a SiteEvent. */
export function normalizeEvent(raw: Record<string, any>, siteUrl = AFRICON_SITE_URL): SiteEvent | null {
  const slug = str(raw.slug, 200);
  const title = str(raw.title, 300);
  if (!slug || !title) return null;
  const sessions = sessionsOf(raw);
  const summary = [str(raw.longDescription, 3000), str(raw.description, 3000)].filter(Boolean)[0] ?? '';
  const tiers: PriceTier[] = Array.isArray(raw.pricingTiers)
    ? raw.pricingTiers
        .map((t: any) => ({ label: str(t?.label, 80) ?? 'Offer', price: num(t?.price), deadline: day(t?.deadline) }))
        .filter((t: any): t is PriceTier => t.price !== null)
    : [];
  const instructorName = str(raw.instructor?.name, 120);
  return {
    externalId: str(raw.id, 100) ?? slug,
    slug,
    title,
    url: `${siteUrl.replace(/\/$/, '')}/events/${slug}`,
    category: str(raw.category, 60),
    format: str(raw.format, 40),
    level: str(raw.level, 40),
    status: str(raw.status, 40),
    timezone: str(raw.timezone, 60) ?? 'Africa/Accra',
    sessions,
    startDate: sessions[0]?.startDate ?? null,
    endDate: sessions.length
      ? sessions.map((s) => s.endDate ?? s.startDate).sort().at(-1) ?? null
      : null,
    timeText: str(raw.time, 60),
    venue: str(raw.venue, 200),
    address: str(raw.venueAddress, 300),
    location: str(raw.location, 120),
    price: num(raw.price),
    currency: str(raw.currency, 8) ?? 'GHS',
    earlyBirdPrice: num(raw.earlyBirdPrice),
    earlyBirdDeadline: day(raw.earlyBirdDeadline),
    pricingTiers: tiers,
    registrationDeadline: day(raw.registrationDeadline),
    capacity: num(raw.capacity),
    registered: num(raw.registered),
    allowPayLater: raw.allowPayLater === true,
    payLaterDeadlineHours: num(raw.payLaterDeadlineHours),
    allowDiscountCodes: raw.allowDiscountCodes === true,
    certificate: raw.certificateProvided === true,
    instructor: instructorName ? { name: instructorName, title: str(raw.instructor?.title, 200) } : null,
    coHost: str(raw.coHost?.name, 120),
    summary: summary.replace(/\s+\n/g, '\n').trim(),
    audience: [
      ...textList(raw.audienceCards, (x) => x?.title),
      ...textList(raw.targetAudience),
    ].slice(0, 12),
    outcomes: [...textList(raw.learningOutcomes), ...textList(raw.customerGains, (x) => (typeof x === 'string' ? x : x?.title))].slice(0, 12),
    inclusions: textList(raw.inclusions, (x) => (typeof x === 'string' ? x : x?.title)),
    prerequisites: textList(raw.prerequisites, (x) => (typeof x === 'string' ? x : x?.title)),
    agenda: Array.isArray(raw.agenda)
      ? raw.agenda
          .filter((a: any) => a && a.quiet !== true && str(a.title))
          .map((a: any) => ({ time: hhmm(a.time), title: str(a.title, 200)! }))
          .slice(0, 30)
      : [],
    faqs: Array.isArray(raw.faqs)
      ? raw.faqs
          .map((f: any) => ({ question: str(f?.question, 300), answer: str(f?.answer, 1000) }))
          .filter((f: any): f is { question: string; answer: string } => !!f.question && !!f.answer)
          .slice(0, 20)
      : [],
    cancellationPolicy: str(raw.cancellationPolicy, 1000),
    image: str(raw.shareImage, 1000) ?? (Array.isArray(raw.images) ? str(raw.images[0], 1000) : null),
    siteUpdatedAt: str(raw.updatedAt, 40),
  };
}

/** A schema.org Event, for a page that carries no RSC event record. */
export function normalizeJsonLdEvent(ld: Record<string, any>, siteUrl = AFRICON_SITE_URL): SiteEvent | null {
  const url = str(ld.url, 1000);
  const slug = url?.match(/\/events\/([a-z0-9-]+)/i)?.[1]?.toLowerCase();
  const title = str(ld.name, 300);
  if (!slug || !title) return null;
  const start = day(ld.startDate);
  const end = day(ld.endDate);
  const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const place = ld.location ?? {};
  const address = place.address ?? {};
  return normalizeEvent({
    id: slug,
    slug,
    title,
    description: ld.description,
    eventDates: start ? [{
      type: 'range', startDate: start, endDate: end ?? start,
      startTime: str(ld.startDate)?.slice(11, 16), endTime: str(ld.endDate)?.slice(11, 16),
      venue: place.name, venueAddress: address.streetAddress,
    }] : [],
    venue: place.name,
    venueAddress: address.streetAddress,
    location: address.addressLocality,
    price: offer?.price,
    currency: offer?.priceCurrency,
    format: /Online/i.test(String(ld.eventAttendanceMode ?? '')) ? 'virtual' : 'in-person',
    status: /Cancelled/i.test(String(ld.eventStatus ?? '')) ? 'cancelled' : 'published',
    images: Array.isArray(ld.image) ? ld.image : [ld.image],
  }, siteUrl);
}

/** Every event a page carries: RSC records first, JSON-LD for anything they miss. */
export function parseEventsFromHtml(html: string, siteUrl = AFRICON_SITE_URL): SiteEvent[] {
  const bySlug = new Map<string, SiteEvent>();
  for (const raw of extractEventObjects(extractRscText(html))) {
    const e = normalizeEvent(raw, siteUrl);
    if (e) bySlug.set(e.slug, e);
  }
  // JSON-LD only fills in events the RSC payload did not carry. Its offer price
  // is not tied to a session, so it never overrides the record's own prices;
  // live per-session prices come from the availability endpoint instead.
  for (const ld of extractJsonLdEvents(html)) {
    const e = normalizeJsonLdEvent(ld, siteUrl);
    if (e && !bySlug.has(e.slug)) bySlug.set(e.slug, e);
  }
  return [...bySlug.values()];
}

/**
 * Merge several pages' events (the listing plus each detail page): the
 * richest record per slug wins, and per-session prices found on any page are
 * kept.
 */
export function mergeEvents(groups: SiteEvent[][]): SiteEvent[] {
  const bySlug = new Map<string, SiteEvent>();
  const weight = (e: SiteEvent) =>
    e.sessions.length + e.agenda.length + e.faqs.length + e.audience.length + (e.externalId !== e.slug ? 5 : 0);
  for (const e of groups.flat()) {
    const prev = bySlug.get(e.slug);
    if (!prev) { bySlug.set(e.slug, e); continue; }
    const [keep, other] = weight(e) > weight(prev) ? [e, prev] : [prev, e];
    for (const s of keep.sessions) {
      if (s.currentPrice !== null) continue;
      const twin = other.sessions.find((o) => o.startDate === s.startDate && o.currentPrice !== null);
      if (twin) s.currentPrice = twin.currentPrice;
    }
    bySlug.set(e.slug, keep);
  }
  return [...bySlug.values()];
}

/** The public seat-availability answer: /api/event-bookings/availability?eventId=… */
export interface AvailabilityEntry {
  dateEntryId?: string | null; date?: string | null; endDate?: string | null; startTime?: string | null;
  label?: string | null; capacity?: number | null; registered?: number | null; available?: number | null;
  isFull?: boolean; isPast?: boolean; currentPrice?: number | null; basePrice?: number | null;
  activeTierLabel?: string | null;
}

/** Fold live seat counts and today's prices into the sessions. */
export function applyAvailability(e: SiteEvent, entries: AvailabilityEntry[]): SiteEvent {
  for (const a of entries) {
    const s = e.sessions.find((x) => (a.dateEntryId && x.id === a.dateEntryId) || (!!a.date && x.startDate === day(a.date)));
    if (!s) continue;
    if (num(a.capacity) !== null) s.capacity = num(a.capacity);
    s.registered = num(a.registered);
    s.available = num(a.available);
    s.isFull = a.isFull === true;
    if (num(a.currentPrice) !== null) s.currentPrice = num(a.currentPrice);
    s.activeTier = str(a.activeTierLabel, 80);
  }
  return e;
}

// ─── Reading an event ────────────────────────────────────────────────────────

/**
 * A Postgres DATE as 'YYYY-MM-DD'. node-pg builds DATE values as local
 * midnight, so toISOString() would shift the day on a server east of UTC.
 */
export function pgDay(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return null;
}

/** 'YYYY-MM-DD' for `now` in the event's timezone. */
export function localDay(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The first session that has not ended yet, or null when the event is over. */
export function nextSession(e: SiteEvent, now = new Date()): EventSession | null {
  const today = localDay(now, e.timezone);
  return e.sessions.find((s) => (s.endDate ?? s.startDate) >= today) ?? null;
}

/** True when every session has ended. An event with no dates is never "past". */
export function isPastEvent(e: SiteEvent, now = new Date()): boolean {
  return e.sessions.length > 0 && nextSession(e, now) === null;
}

/** Whole days from today (event timezone) to a 'YYYY-MM-DD'; negative when past. */
export function daysUntil(date: string | null, timezone: string, now = new Date()): number | null {
  if (!date) return null;
  const a = Date.parse(`${localDay(now, timezone)}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

export interface PriceNow {
  price: number | null;
  /** The label of the offer in force, e.g. "Early Bird". */
  tier: string | null;
  /** The last day that offer applies. */
  until: string | null;
  /** The full price once the offer ends. */
  fullPrice: number | null;
}

/**
 * What a seat costs today. The site's live per-session price wins; otherwise
 * an early-bird or pricing tier whose deadline has not passed; otherwise the
 * list price.
 */
export function priceNow(e: SiteEvent, now = new Date()): PriceNow {
  const today = localDay(now, e.timezone);
  const session = nextSession(e, now);
  const offers: PriceTier[] = [
    ...(e.earlyBirdPrice !== null && e.earlyBirdDeadline ? [{ label: 'Early bird', price: e.earlyBirdPrice, deadline: e.earlyBirdDeadline }] : []),
    ...e.pricingTiers,
  ].filter((t) => !t.deadline || t.deadline >= today);
  const best = offers.sort((a, b) => a.price - b.price)[0] ?? null;
  if (session?.currentPrice !== null && session?.currentPrice !== undefined) {
    const matching = offers.find((t) => t.price === session.currentPrice) ?? null;
    return {
      price: session.currentPrice,
      tier: session.activeTier ?? matching?.label ?? null,
      until: matching?.deadline ?? null,
      fullPrice: e.price,
    };
  }
  if (best && (e.price === null || best.price < e.price)) {
    return { price: best.price, tier: best.label, until: best.deadline, fullPrice: e.price };
  }
  return { price: e.price, tier: null, until: null, fullPrice: e.price };
}

/** Seats left on the next session (or the event), when the site publishes it. */
export function seatsLeft(e: SiteEvent, now = new Date()): number | null {
  const s = nextSession(e, now);
  if (s?.available !== null && s?.available !== undefined) return s.available;
  if (s?.capacity && s.registered !== null) return Math.max(0, s.capacity - s.registered);
  return null;
}

export function registrationOpen(e: SiteEvent, now = new Date()): boolean {
  if (e.status && !/^(published|active|open|scheduled)$/i.test(e.status)) return false;
  if (isPastEvent(e, now)) return false;
  if (e.registrationDeadline && e.registrationDeadline < localDay(now, e.timezone)) return false;
  return nextSession(e, now)?.isFull !== true;
}

export function money(amount: number | null, currency: string): string {
  if (amount === null) return 'price not published';
  return `${currency} ${amount.toLocaleString('en-GB')}`;
}

/** 'Friday 13 November' for '26-11-13': how a date is said on a call. */
export function spokenDate(d: string): string {
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t)) return d;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(t);
}

export function sessionText(s: EventSession): string {
  const range = s.endDate && s.endDate !== s.startDate
    ? `${spokenDate(s.startDate)} to ${spokenDate(s.endDate)}`
    : spokenDate(s.startDate);
  const time = s.startTime ? `, ${s.startTime}${s.endTime ? `–${s.endTime}` : ''}` : '';
  return `${s.label ? `${s.label}: ` : ''}${range}${time}${s.venue ? `, ${s.venue}` : ''}`;
}

/**
 * The facts a caller may quote, as brief text. Only what the site published;
 * nothing is inferred.
 */
export function renderEventFacts(e: SiteEvent, now = new Date(), opts: { full?: boolean } = {}): string {
  const p = priceNow(e, now);
  const session = nextSession(e, now);
  const seats = seatsLeft(e, now);
  const open = registrationOpen(e, now);
  const lines = [
    `${e.title}${e.coHost ? ` (with ${e.coHost})` : ''}`,
    session ? `- Next date: ${sessionText(session)}` : '- No upcoming date published.',
    ...(opts.full ? e.sessions.filter((s) => s !== session && (s.endDate ?? s.startDate) >= localDay(now, e.timezone)).map((s) => `- Also: ${sessionText(s)}`) : []),
    e.format ? `- Format: ${e.format === 'virtual' ? 'online' : e.format === 'hybrid' ? 'in person and online' : 'in person'}` : '',
    session?.address || e.address ? `- Address: ${session?.address ?? e.address}` : '',
    p.price !== null
      ? `- Price today: ${money(p.price, e.currency)}${p.tier ? ` (${p.tier}${p.until ? `, until ${spokenDate(p.until)}` : ''})` : ''}${p.fullPrice !== null && p.fullPrice !== p.price ? `; full price ${money(p.fullPrice, e.currency)}` : ''}`
      : '',
    e.registrationDeadline ? `- Registration closes: ${spokenDate(e.registrationDeadline)}` : '',
    seats !== null ? `- Seats left: ${seats}` : '',
    open ? '' : '- Registration is closed for this event.',
    e.allowPayLater ? `- "Pay later" is allowed: book now and pay within ${e.payLaterDeadlineHours ?? 24} hours.` : '',
    e.certificate ? '- A certificate is included.' : '',
    e.instructor ? `- Led by ${e.instructor.name}${e.instructor.title ? `, ${e.instructor.title}` : ''}` : '',
    e.audience.length ? `- Who it is for: ${e.audience.join('; ')}` : '',
    `- Booking page: ${e.url.replace(/^https?:\/\/(www\.)?/, '')}`,
  ];
  if (opts.full) {
    if (e.summary) lines.push(`- What it is: ${e.summary.slice(0, 900)}`);
    if (e.outcomes.length) lines.push(`- What they leave with: ${e.outcomes.slice(0, 6).join('; ')}`);
    if (e.inclusions.length) lines.push(`- Included: ${e.inclusions.join('; ')}`);
    if (e.prerequisites.length) lines.push(`- What they need: ${e.prerequisites.slice(0, 5).join('; ')}`);
    if (e.agenda.length) lines.push(`- Agenda: ${e.agenda.slice(0, 12).map((a) => `${a.time ? `${a.time} ` : ''}${a.title}`).join('; ')}`);
    if (e.cancellationPolicy) lines.push(`- Cancellation: ${e.cancellationPolicy}`);
    for (const f of e.faqs.slice(0, 8)) lines.push(`- Q: ${f.question} A: ${f.answer}`);
  }
  return lines.filter(Boolean).join('\n');
}

/** Upcoming events in one compact block, for every call's background knowledge. */
export function renderLiveEvents(events: SiteEvent[], now = new Date(), checkedAt?: Date | null): string {
  const upcoming = events
    .filter((e) => !isPastEvent(e, now) && (!e.status || /^(published|active|open|scheduled)$/i.test(e.status)))
    .sort((a, b) => (nextSession(a, now)?.startDate ?? '9999').localeCompare(nextSession(b, now)?.startDate ?? '9999'))
    .slice(0, 8);
  if (!upcoming.length) return '';
  const when = checkedAt ? ` (read from africon.ai ${checkedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : '';
  return [
    `LIVE EVENTS${when} — these dates, prices and seat counts replace any event details written elsewhere in this brief.`,
    ...upcoming.map((e) => renderEventFacts(e, now)),
  ].join('\n\n');
}

// ─── Change detection ────────────────────────────────────────────────────────

export type EventChangeKind =
  | 'new' | 'removed' | 'price' | 'early_bird' | 'dates' | 'registration_deadline' | 'status' | 'seats' | 'pay_later';

export interface EventChange {
  kind: EventChangeKind;
  summary: string;
}

/** A hash of the fields a sales call quotes; a change means strategies need a fresh look. */
export function eventFingerprint(e: SiteEvent): string {
  const material = {
    title: e.title, status: e.status, price: e.price, currency: e.currency,
    earlyBirdPrice: e.earlyBirdPrice, earlyBirdDeadline: e.earlyBirdDeadline, tiers: e.pricingTiers,
    registrationDeadline: e.registrationDeadline, allowPayLater: e.allowPayLater,
    sessions: e.sessions.map((s) => [s.id, s.startDate, s.endDate, s.startTime, s.venue, s.capacity]),
    audience: e.audience, summary: e.summary.slice(0, 500),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 32);
}

/** Seat thresholds worth telling a caller about. */
function seatBand(n: number | null): number {
  if (n === null) return -1;
  if (n <= 0) return 0;
  if (n <= 5) return 1;
  if (n <= 10) return 2;
  return 3;
}

/** What changed between two readings of the same event, in plain words. */
export function diffEvent(prev: SiteEvent | null, next: SiteEvent, now = new Date()): EventChange[] {
  if (!prev) {
    const s = nextSession(next, now);
    return [{ kind: 'new', summary: `New event on the site: ${next.title}${s ? ` — ${sessionText(s)}` : ''}` }];
  }
  const out: EventChange[] = [];
  if (prev.price !== next.price) {
    out.push({ kind: 'price', summary: `Price changed from ${money(prev.price, prev.currency)} to ${money(next.price, next.currency)}` });
  }
  if (prev.earlyBirdPrice !== next.earlyBirdPrice || prev.earlyBirdDeadline !== next.earlyBirdDeadline
    || JSON.stringify(prev.pricingTiers) !== JSON.stringify(next.pricingTiers)) {
    const p = priceNow(next, now);
    out.push({ kind: 'early_bird', summary: p.tier ? `Offer now: ${money(p.price, next.currency)} (${p.tier}${p.until ? ` until ${p.until}` : ''})` : 'The discounted offer changed or ended' });
  }
  const dates = (e: SiteEvent) => e.sessions.map((s) => `${s.startDate}|${s.endDate}|${s.startTime}|${s.venue}`).join(',');
  if (dates(prev) !== dates(next)) {
    const s = nextSession(next, now);
    out.push({ kind: 'dates', summary: `Dates or venue changed${s ? ` — next: ${sessionText(s)}` : ''}` });
  }
  if (prev.registrationDeadline !== next.registrationDeadline) {
    out.push({ kind: 'registration_deadline', summary: `Registration deadline is now ${next.registrationDeadline ?? 'not set'}` });
  }
  if (prev.status !== next.status) out.push({ kind: 'status', summary: `Status changed from ${prev.status ?? 'unknown'} to ${next.status ?? 'unknown'}` });
  if (prev.allowPayLater !== next.allowPayLater) out.push({ kind: 'pay_later', summary: next.allowPayLater ? '"Pay later" is now allowed' : '"Pay later" is no longer allowed' });
  const before = seatsLeft(prev, now);
  const after = seatsLeft(next, now);
  if (seatBand(before) !== seatBand(after) && after !== null) {
    out.push({ kind: 'seats', summary: after === 0 ? 'Sold out' : `${after} seat${after === 1 ? '' : 's'} left` });
  }
  return out;
}
