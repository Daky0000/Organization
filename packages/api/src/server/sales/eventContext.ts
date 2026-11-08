// ─────────────────────────────────────────────────────────────────────────────
// Event context for call briefs.
//
// Two reads the brief builder makes:
//   - the live events block every call carries, so the agent quotes today's
//     dates, prices and seats rather than whatever was typed into the agent's
//     knowledge weeks ago (cached briefly: it is the same for every call);
//   - for a call placed about a booking, that event in full, the person's
//     booking, and the strategy for their segment.
//
// Kept apart from eventsEngine.ts so the brief can import it without pulling
// in the sync and the dial engine.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import { money, pgDay, renderEventFacts, renderLiveEvents, type SiteEvent } from './eventSource.ts';
import { SEGMENT_LABELS, isCallSegment, type BookingSegment } from './eventBookings.ts';
import { renderSegmentStrategy, resolveStrategy } from './eventStrategy.ts';

let liveCache: { at: number; text: string } | null = null;
const LIVE_TTL_MS = 5 * 60 * 1000;

/** Forget the cached live-events block (after a sync). */
export function invalidateLiveEvents(): void {
  liveCache = null;
}

/** The LIVE EVENTS block, or '' when no events have been synced. */
export async function getLiveEventsText(pool: Pool, now = new Date()): Promise<string> {
  if (liveCache && now.getTime() - liveCache.at < LIVE_TTL_MS) return liveCache.text;
  const { rows } = await pool.query(
    `SELECT data, last_seen_at FROM sales_events WHERE removed_at IS NULL ORDER BY start_date NULLS LAST LIMIT 30`,
  );
  const events = rows.map((r) => r.data as SiteEvent);
  const checked = rows.reduce<Date | null>((m, r) => {
    const t = r.last_seen_at ? new Date(r.last_seen_at) : null;
    return t && (!m || t > m) ? t : m;
  }, null);
  const text = renderLiveEvents(events, now, checked);
  liveCache = { at: now.getTime(), text };
  return text;
}

const STATUS_WORDS: Record<string, string> = {
  interested: 'They showed interest but have not booked.',
  started: 'They started booking or paying on the website and did not finish.',
  payment_failed: 'They tried to pay on the website and the payment did not go through.',
  pay_later: 'They booked with "pay later" and have not paid yet.',
  pending_review: 'They registered; Africon is reviewing the registration.',
  confirmed: 'They booked and are confirmed.',
  attended: 'They attended.',
  no_show: 'They booked but did not attend.',
  cancelled: 'They cancelled.',
};

/**
 * The event section of a brief for a call about one booking. '' when the
 * booking or its event is gone, so the brief simply falls back to a normal call.
 */
export async function getEventCallContext(pool: Pool, userId: string, bookingId: string, now = new Date()): Promise<string> {
  const { rows } = await pool.query(
    `SELECT b.*, e.data AS event_data, e.strategy
       FROM sales_event_bookings b
       JOIN sales_events e ON e.id = b.event_id
      WHERE b.id=$1 AND b.user_id=$2`,
    [bookingId, userId],
  );
  const b = rows[0];
  if (!b) return '';
  const event = b.event_data as SiteEvent;
  const segment = b.segment as BookingSegment;
  const when = (d: Date) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: event.timezone || 'Africa/Accra' }).format(d);
  // A pay-later booking without a stated deadline is due within the site's window.
  const payBy = b.payment_due_at
    ? new Date(b.payment_due_at)
    : b.status === 'pay_later' && b.booked_at
      ? new Date(new Date(b.booked_at).getTime() + (event.payLaterDeadlineHours ?? 24) * 3_600_000)
      : null;
  const booking = [
    `- Where they are: ${SEGMENT_LABELS[segment]}. ${STATUS_WORDS[b.status] ?? b.status}`,
    b.cohort_label || b.session_date ? `- Date they chose: ${[b.cohort_label, pgDay(b.session_date)].filter(Boolean).join(', ')}` : '',
    b.attendees && Number(b.attendees) > 1 ? `- Seats in their booking: ${b.attendees}` : '',
    b.amount !== null && b.amount !== undefined ? `- Amount on their booking: ${money(Number(b.amount), b.currency || event.currency)}` : '',
    payBy ? `- Pay by: ${when(payBy)}${b.payment_due_at ? '' : ` (the site's ${event.payLaterDeadlineHours ?? 24}-hour pay-later window)`}` : '',
    b.booked_at ? `- Booked: ${when(new Date(b.booked_at))}` : '',
    b.source ? `- How they came in: ${b.source}` : '',
    b.notes ? `- What they wrote: "${String(b.notes).slice(0, 300)}"` : '',
    ...Object.entries((b.answers ?? {}) as Record<string, string>).slice(0, 6).map(([k, v]) => `- ${k}: ${v}`),
  ].filter(Boolean);

  const strategy = isCallSegment(segment) ? resolveStrategy(b.strategy, event, now).segments[segment] : null;
  return [
    'THE EVENT THIS CALL IS ABOUT (from africon.ai — quote only these facts)',
    renderEventFacts(event, now, { full: true }),
    '',
    'THEIR BOOKING',
    booking.join('\n'),
    strategy ? `\n${renderSegmentStrategy(strategy)}` : '',
  ].filter((l) => l !== '').join('\n');
}
