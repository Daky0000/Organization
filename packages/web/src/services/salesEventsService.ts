import { api } from './apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Sales → Events API client.
//
// Mirrors packages/api/src/server/sales/eventSource.ts, eventBookings.ts and
// eventStrategy.ts. No shared types package exists, so the vocabularies are
// duplicated deliberately — change both sides together.
// ─────────────────────────────────────────────────────────────────────────────

export const CALL_SEGMENTS = ['failed_booking', 'unpaid', 'upcoming', 'interested'] as const;
export type CallSegment = (typeof CALL_SEGMENTS)[number];
export type BookingSegment = CallSegment | 'awaiting_review' | 'past' | 'cancelled';

export const SEGMENT_LABELS: Record<BookingSegment, string> = {
  failed_booking: 'Tried to book, did not finish',
  unpaid: 'Booked, payment outstanding',
  upcoming: 'Booked, class coming up',
  interested: 'Showed interest',
  awaiting_review: 'Waiting for Africon review',
  past: 'Event over',
  cancelled: 'Cancelled',
};

export const SEGMENT_SHORT: Record<BookingSegment, string> = {
  failed_booking: 'Failed booking',
  unpaid: 'Unpaid',
  upcoming: 'Upcoming',
  interested: 'Interested',
  awaiting_review: 'In review',
  past: 'Past',
  cancelled: 'Cancelled',
};

export const SEGMENT_COLORS: Record<BookingSegment, string> = {
  failed_booking: 'bg-rose-50 text-rose-700 border-rose-200',
  unpaid: 'bg-amber-50 text-amber-700 border-amber-200',
  upcoming: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  interested: 'bg-sky-50 text-sky-700 border-sky-200',
  awaiting_review: 'bg-violet-50 text-violet-700 border-violet-200',
  past: 'bg-slate-50 text-slate-500 border-slate-200',
  cancelled: 'bg-slate-50 text-slate-400 border-slate-200',
};

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  interested: 'Showed interest',
  started: 'Started booking',
  payment_failed: 'Payment failed',
  pay_later: 'Pay later',
  pending_review: 'Pending review',
  confirmed: 'Paid / confirmed',
  attended: 'Attended',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export interface EventSession {
  id: string | null; label: string | null; startDate: string; endDate: string | null;
  startTime: string | null; endTime: string | null; venue: string | null; address: string | null;
  capacity: number | null; registered: number | null; available: number | null; isFull: boolean;
  currentPrice: number | null; activeTier: string | null;
}

export interface SiteEvent {
  externalId: string; slug: string; title: string; url: string; category: string | null; format: string | null;
  status: string | null; timezone: string; sessions: EventSession[]; startDate: string | null; endDate: string | null;
  venue: string | null; address: string | null; price: number | null; currency: string;
  earlyBirdPrice: number | null; earlyBirdDeadline: string | null;
  pricingTiers: { label: string; price: number; deadline: string | null }[];
  registrationDeadline: string | null; capacity: number | null; registered: number | null;
  allowPayLater: boolean; payLaterDeadlineHours: number | null; certificate: boolean;
  instructor: { name: string; title: string | null } | null; coHost: string | null; summary: string;
  audience: string[]; outcomes: string[]; inclusions: string[]; prerequisites: string[];
  agenda: { time: string | null; title: string }[]; faqs: { question: string; answer: string }[];
  cancellationPolicy: string | null; image: string | null;
}

export interface SegmentStrategy {
  segment: CallSegment; goal: string; opener: string; talkingPoints: string[]; offer: string;
  objections: { scenario: string; response: string }[]; close: string; avoid: string[]; timing: string;
}

export interface EventStrategy {
  segments: Record<CallSegment, SegmentStrategy>;
  source: 'default' | 'ai' | 'edited';
  angle: string; generatedAt: string; fingerprint: string; model?: string;
}

export interface EventSummary {
  id: string; slug: string; title: string; url: string; status: string | null;
  startDate: string | null; endDate: string | null; event: SiteEvent; lastSeenAt: string | null;
  lastChangedAt: string | null; removedAt: string | null; past: boolean;
  segmentCounts: Partial<Record<BookingSegment, number>>; recentChanges: number;
  strategySource: EventStrategy['source']; strategyStale: boolean;
}

export interface SyncRun {
  id: string; trigger: string; source: string | null; status: 'running' | 'ok' | 'partial' | 'failed';
  events_found: number; events_new: number; events_changed: number; bookings_pulled: number;
  warnings: string[]; error: string | null; started_at: string; finished_at: string | null;
}

export interface EventBooking {
  id: string; contact_id: string; status: string; raw_status: string | null; segment: BookingSegment;
  cohort_label: string | null; session_date: string | null; amount: string | number | null; currency: string | null;
  source: string | null; via: string; booked_at: string | null; last_event_at: string | null;
  payment_due_at: string | null; next_call_at: string | null; calls_made: number; last_call_at: string | null;
  first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
  consent_at: string | null; do_not_call: boolean | null;
  last_call_status: string | null; last_call_outcome: string | null; last_call_block: string | null;
}

export interface EventDetail {
  id: string; event: SiteEvent; lastSeenAt: string | null; removedAt: string | null; past: boolean;
  strategy: EventStrategy; strategyStale: boolean;
  changes: { kind: string; summary: string; created_at: string }[];
  bookings: EventBooking[];
}

export interface EventsConfigView {
  config: {
    enabled: boolean; siteUrl: string; source: 'auto' | 'apify' | 'direct'; intervalHours: number; apifyActor: string;
    ownerUserId: string | null; autoCall: boolean; callSegments: CallSegment[]; bookingConsent: boolean;
    interestConsent: boolean; maxCallsPerSegment: number; bookingsApiUrl: string; hasBookingsApiKey: boolean;
    bookingsCursor: string;
  };
  webhook: { url: string; secret: string | null };
  owner: { id: string; email: string; name: string } | null;
  apifyConnected: boolean;
  runs: SyncRun[];
}

type Ok<T> = T & { success: boolean; error?: string };
function ok<T extends { success: boolean; error?: string }>(d: T): T {
  if (!d.success) throw new Error(d.error || 'Request failed');
  return d;
}

/** Today's price for an event, as the server would quote it (same rules as eventSource.priceNow). */
export function priceToday(e: SiteEvent, now = new Date()): { price: number | null; tier: string | null; until: string | null } {
  const today = now.toISOString().slice(0, 10);
  const session = e.sessions.find((s) => (s.endDate ?? s.startDate) >= today) ?? null;
  const offers = [
    ...(e.earlyBirdPrice !== null && e.earlyBirdDeadline ? [{ label: 'Early bird', price: e.earlyBirdPrice, deadline: e.earlyBirdDeadline }] : []),
    ...e.pricingTiers,
  ].filter((t) => !t.deadline || t.deadline >= today).sort((a, b) => a.price - b.price);
  if (session?.currentPrice != null) {
    const m = offers.find((t) => t.price === session.currentPrice);
    return { price: session.currentPrice, tier: session.activeTier ?? m?.label ?? null, until: m?.deadline ?? null };
  }
  const best = offers[0];
  if (best && (e.price === null || best.price < e.price)) return { price: best.price, tier: best.label, until: best.deadline };
  return { price: e.price, tier: null, until: null };
}

export function nextSessionOf(e: SiteEvent, now = new Date()): EventSession | null {
  const today = now.toISOString().slice(0, 10);
  return e.sessions.find((s) => (s.endDate ?? s.startDate) >= today) ?? null;
}

export function money(amount: number | string | null | undefined, currency = 'GHS'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return `${currency} ${Number(amount).toLocaleString('en-GB')}`;
}

export function dayLabel(d: string | null | undefined): string {
  if (!d) return '—';
  const t = Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t)
    ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t)
    : d;
}

export const salesEventsService = {
  async listEvents() {
    return ok(await api.get<Ok<{ events: EventSummary[]; isOwner: boolean; hasOwner: boolean; autoCall: boolean; lastRun: SyncRun | null }>>('/api/sales/events'));
  },
  async getEvent(id: string) {
    return ok(await api.get<Ok<EventDetail>>(`/api/sales/events/${encodeURIComponent(id)}`));
  },
  async queueCalls(id: string, payload: { segment?: CallSegment; bookingIds?: string[] }) {
    return ok(await api.post<Ok<{ considered: number; queued: number; awaitingApproval: number; blocked: { bookingId: string; reason: string }[] }>>(
      `/api/sales/events/${encodeURIComponent(id)}/calls`, payload));
  },
  async linkList(id: string, listId: string, status: string) {
    return ok(await api.post<Ok<{ received: number; accepted: number; created: number; updated: number; rejected: { index: number; error: string }[] }>>(
      `/api/sales/events/${encodeURIComponent(id)}/link-list`, { listId, status }));
  },
  async generateStrategy(id: string) {
    return ok(await api.post<Ok<{ strategy: EventStrategy }>>(`/api/sales/events/${encodeURIComponent(id)}/strategy/generate`)).strategy;
  },
  async saveStrategy(id: string, strategy: Partial<EventStrategy>) {
    return ok(await api.put<Ok<{ strategy: EventStrategy }>>(`/api/sales/events/${encodeURIComponent(id)}/strategy`, { strategy })).strategy;
  },
  async resetStrategy(id: string) {
    return ok(await api.put<Ok<{ strategy: EventStrategy }>>(`/api/sales/events/${encodeURIComponent(id)}/strategy`, { reset: true })).strategy;
  },

  // Admin
  async getConfig() {
    return ok(await api.get<Ok<EventsConfigView>>('/api/admin/sales-events/config'));
  },
  async saveConfig(patch: Record<string, unknown>) {
    return ok(await api.put<Ok<EventsConfigView>>('/api/admin/sales-events/config', patch));
  },
  async rotateSecret() {
    return ok(await api.post<Ok<EventsConfigView>>('/api/admin/sales-events/rotate-secret'));
  },
  async syncNow() {
    const d = await api.post<Ok<{ summary: { status: string; found: number; created: number; changed: number; removed: number; bookingsPulled: number; warnings: string[]; error?: string; source: string | null } }>>('/api/admin/sales-events/sync');
    return d.summary;
  },
};
