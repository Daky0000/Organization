import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// config.ts validates env at import time and the sales modules transitively
// import the logger, so env must be set before the dynamic imports.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const src = await import('../src/server/sales/eventSource.ts');
const bookings = await import('../src/server/sales/eventBookings.ts');
const strategy = await import('../src/server/sales/eventStrategy.ts');
const engine = await import('../src/server/sales/eventsEngine.ts');

// A trimmed copy of the event record africon.ai streams in its RSC payload.
const CEO_RAW = {
  id: 'pAwwlow4K3W9PxmctogN',
  title: 'Executive AI Masterclass for CEOs',
  slug: 'executive-ai-masterclass-for-ceos',
  description: 'An exclusive 2-day Masterclass for Ghanaian CEOs, MDs and Founders.',
  category: 'master_class_training',
  format: 'in-person',
  timezone: 'Africa/Accra',
  venue: 'Africon AI Training and Innovation Center',
  venueAddress: 'No. 2, 2nd Nii Kokonya Road, East Legon, Accra - Ghana',
  price: 5000,
  currency: 'GHS',
  status: 'published',
  allowPayLater: true,
  payLaterDeadlineHours: 24,
  capacity: 30,
  certificateProvided: true,
  instructor: { name: 'Gideon Asare', title: 'AI Strategy Consultant' },
  pricingTiers: [{ id: 't1', label: 'Discount Offer', price: 4250, deadline: '2026-10-20' }],
  eventDates: [
    { id: 'c4', type: 'range', startDate: '2026-07-24', endDate: '2026-07-25', startTime: '09:00', endTime: '16:45', label: 'Cohort 4', capacity: 1 },
    { id: 'c5', type: 'range', startDate: '2026-11-13', endDate: '2026-11-14', startTime: '09:00', endTime: '16:45', label: 'Cohort 5', capacity: 30 },
  ],
  registrationDeadline: '2026-11-12',
  registered: 15,
  earlyBirdDeadline: '2026-11-09',
  earlyBirdPrice: 4250,
  faqs: [{ id: 'f1', question: 'Can my company pay by invoice?', answer: 'Yes. Choose company invoice when you book.' }],
};

function pageWith(objects: object[], extra = ''): string {
  const payload = objects.map((o, i) => `${i + 8}:["$","div",null,{"event":${JSON.stringify(o)}}]`).join('\n');
  return `<html><head>${extra}</head><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>` +
    `<a href="/events/${CEO_RAW.slug}">x</a><a href="/events/${CEO_RAW.slug}?book=1">y</a></body></html>`;
}

const NOW = new Date('2026-11-08T12:00:00Z');

// ─── Reading the site ──────────────────────────────────────────────────────

test('the event record is read out of the Next.js RSC payload', () => {
  const events = src.parseEventsFromHtml(pageWith([CEO_RAW]));
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.externalId, 'pAwwlow4K3W9PxmctogN');
  assert.equal(e.url, 'https://www.africon.ai/events/executive-ai-masterclass-for-ceos');
  assert.equal(e.sessions.length, 2);
  assert.equal(e.startDate, '2026-07-24');
  assert.equal(e.endDate, '2026-11-14');
  assert.equal(e.allowPayLater, true);
  assert.deepEqual(src.extractEventLinks(pageWith([CEO_RAW])), ['executive-ai-masterclass-for-ceos']);
});

test('a JSON-LD event fills in a page with no RSC record', () => {
  const ld = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Event', name: 'Build AI Adoption into Your 2027 Plans', url: 'https://africon.ai/events/ai-adoption-2027',
    startDate: '2026-11-26T08:00:00', endDate: '2026-11-26T16:00:00',
    location: { name: 'CEIBS Africa Auditorium', address: { streetAddress: '5 Monrovia Road' } },
    offers: { price: 4000, priceCurrency: 'GHS' },
  })}</script>`;
  const events = src.parseEventsFromHtml(`<html>${ld}</html>`);
  assert.equal(events.length, 1);
  assert.equal(events[0].slug, 'ai-adoption-2027');
  assert.equal(events[0].price, 4000);
  assert.equal(events[0].sessions[0].startTime, '08:00');
});

test('the next session skips past cohorts; today\'s price prefers the live early-bird', () => {
  const e = src.normalizeEvent(CEO_RAW)!;
  assert.equal(src.nextSession(e, NOW)?.label, 'Cohort 5');
  const p = src.priceNow(e, NOW);
  assert.equal(p.price, 4250);
  assert.equal(p.until, '2026-11-09');
  assert.equal(p.fullPrice, 5000);
  // After the early-bird deadline the list price applies.
  assert.equal(src.priceNow(e, new Date('2026-11-10T12:00:00Z')).price, 5000);
});

test('live availability sets seats and the per-session price', () => {
  const e = src.applyAvailability(src.normalizeEvent(CEO_RAW)!, [
    { dateEntryId: 'c5', capacity: 30, registered: 26, available: 4, isFull: false, currentPrice: 4250, activeTierLabel: 'Early Bird' },
  ]);
  assert.equal(src.seatsLeft(e, NOW), 4);
  assert.equal(src.priceNow(e, NOW).tier, 'Early Bird');
  const facts = src.renderEventFacts(e, NOW);
  assert.match(facts, /Seats left: 4/);
  assert.match(facts, /GHS 4,250 \(Early Bird, until Monday 9 November\); full price GHS 5,000/);
  assert.match(facts, /Pay later/i);
});

test('registration closes after the deadline and when the next date is full', () => {
  const e = src.normalizeEvent(CEO_RAW)!;
  assert.equal(src.registrationOpen(e, NOW), true);
  assert.equal(src.registrationOpen(e, new Date('2026-11-12T23:30:00Z')), true);
  assert.equal(src.registrationOpen(e, new Date('2026-11-13T08:00:00Z')), false);
  src.applyAvailability(e, [{ dateEntryId: 'c5', available: 0, isFull: true }]);
  assert.equal(src.registrationOpen(e, NOW), false);
});

test('changes are described in words, and seat counts only at thresholds', () => {
  const before = src.normalizeEvent(CEO_RAW)!;
  const after = src.normalizeEvent({ ...CEO_RAW, price: 5500, registrationDeadline: '2026-11-11' })!;
  const kinds = src.diffEvent(before, after, NOW).map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['price', 'registration_deadline']);
  assert.equal(src.diffEvent(null, before, NOW)[0].kind, 'new');

  const a = src.applyAvailability(src.normalizeEvent(CEO_RAW)!, [{ dateEntryId: 'c5', available: 20 }]);
  const b = src.applyAvailability(src.normalizeEvent(CEO_RAW)!, [{ dateEntryId: 'c5', available: 18 }]);
  const c = src.applyAvailability(src.normalizeEvent(CEO_RAW)!, [{ dateEntryId: 'c5', available: 4 }]);
  assert.equal(src.diffEvent(a, b, NOW).length, 0);
  assert.deepEqual(src.diffEvent(b, c, NOW).map((x) => x.summary), ['4 seats left']);
});

test('the live events block lists only upcoming events and says it overrides older details', () => {
  const past = src.normalizeEvent({ ...CEO_RAW, id: 'old', slug: 'old', title: 'Old class', eventDates: [{ type: 'single', date: '2026-01-10' }] })!;
  const text = src.renderLiveEvents([past, src.normalizeEvent(CEO_RAW)!], NOW, NOW);
  assert.match(text, /^LIVE EVENTS/);
  assert.match(text, /replace any event details/);
  assert.match(text, /Executive AI Masterclass/);
  assert.doesNotMatch(text, /Old class/);
});

test('pgDay reads a node-pg DATE without shifting the day', () => {
  assert.equal(src.pgDay(new Date(2026, 10, 13)), '2026-11-13');
  assert.equal(src.pgDay('2026-11-13'), '2026-11-13');
  assert.equal(src.pgDay(null), null);
});

// ─── Bookings ──────────────────────────────────────────────────────────────

test('the booking object Africon\'s form already sends is read as-is', () => {
  const { record } = bookings.normalizeBooking({
    eventId: 'pAwwlow4K3W9PxmctogN', eventSlug: 'executive-ai-masterclass-for-ceos',
    userInfo: { name: 'Ama Mensah Owusu', email: 'AMA@Example.com', phone: '0244123456', company: 'Bloom Bank' },
    attendeeCount: 2, selectedCohortId: 'c5', selectedCohortLabel: 'Cohort 5', paymentIntent: 'pay_later',
    status: 'pending', source: 'website', bookingRef: 'AFR-123', createdAt: '2026-11-08T10:00:00Z',
  });
  assert.ok(record);
  assert.equal(record.firstName, 'Ama');
  assert.equal(record.lastName, 'Mensah Owusu');
  assert.equal(record.email, 'ama@example.com');
  assert.equal(record.status, 'pay_later', 'pending + pay later is a booked-unpaid seat, not an abandoned checkout');
  assert.equal(record.externalId, 'AFR-123');
  assert.equal(record.eventRef, 'pAwwlow4K3W9PxmctogN');
  assert.equal(record.attendees, 2);
  assert.equal(record.bookedAt?.toISOString(), '2026-11-08T10:00:00.000Z');
});

test('a webhook envelope and the payment-initialise shape both work; unusable records say why', () => {
  const env = bookings.normalizeBooking({ type: 'payment.failed', data: { eventSlug: 'x', email: 'a@b.co' } });
  assert.equal(env.record?.status, 'payment_failed');
  const init = bookings.normalizeBooking({ bookingData: { eventId: 'e1', userInfo: { name: 'Kofi', phone: '+233201234567' } }, status: 'initialized' });
  assert.equal(init.record?.status, 'started');
  assert.equal(bookings.normalizeBooking({ email: 'a@b.co' }).error, 'no eventId or eventSlug');
  assert.equal(bookings.normalizeBooking({ eventId: 'e1', name: 'No contact' }).error, 'no email or phone');
  assert.equal(bookings.bookingList({ bookings: [{}, {}] }).length, 2);
});

test('status words map to the right stage', () => {
  const cases: Array<[string, string]> = [
    ['paid', 'confirmed'], ['success', 'confirmed'], ['payment_failed', 'payment_failed'], ['abandoned', 'payment_failed'],
    ['awaiting_payment', 'started'], ['pending_review', 'pending_review'], ['not_eligible', 'cancelled'],
    ['refunded', 'cancelled'], ['checked_in', 'attended'], ['no-show', 'no_show'], ['waitlist', 'interested'],
    ['unpaid', 'started'], ['pay later', 'pay_later'],
  ];
  for (const [word, want] of cases) assert.equal(bookings.parseBookingStatus(word), want, word);
  assert.equal(bookings.parseBookingStatus('???'), null);
});

test('segments follow the status and the event dates', () => {
  const e = src.normalizeEvent(CEO_RAW)!;
  assert.equal(bookings.segmentFor('payment_failed', e, NOW), 'failed_booking');
  assert.equal(bookings.segmentFor('pay_later', e, NOW), 'unpaid');
  assert.equal(bookings.segmentFor('confirmed', e, NOW), 'upcoming');
  assert.equal(bookings.segmentFor('interested', e, NOW), 'interested');
  assert.equal(bookings.segmentFor('pending_review', e, NOW), 'awaiting_review');
  assert.equal(bookings.segmentFor('confirmed', e, new Date('2026-11-20T12:00:00Z')), 'past');
  assert.equal(bookings.segmentFor('cancelled', e, NOW), 'cancelled');
});

test('a late message never moves a booking backwards, unless it is newer', () => {
  const paid = { status: 'confirmed' as const, lastEventAt: null };
  assert.equal(bookings.mergeStatus(paid, { status: 'started', occurredAt: null }), 'confirmed');
  assert.equal(bookings.mergeStatus(paid, { status: 'cancelled', occurredAt: null }), 'cancelled');
  const t = new Date('2026-11-08T10:00:00Z');
  assert.equal(bookings.mergeStatus({ status: 'payment_failed', lastEventAt: t }, { status: 'started', occurredAt: new Date('2026-11-08T11:00:00Z') }), 'started');
  assert.equal(bookings.mergeStatus({ status: 'confirmed', lastEventAt: t }, { status: 'started', occurredAt: new Date('2026-11-08T09:00:00Z') }), 'confirmed');
});

test('the bookings endpoint accepts an HMAC signature or the secret as a bearer token', () => {
  const secret = 's3cret';
  const body = '{"eventId":"e1"}';
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(bookings.verifyBookingRequest({ 'x-africon-signature': `sha256=${sig}` }, body, secret), true);
  assert.equal(bookings.verifyBookingRequest({ 'x-africon-signature': `sha256=${sig}` }, `${body} `, secret), false);
  assert.equal(bookings.verifyBookingRequest({ authorization: `Bearer ${secret}` }, body, secret), true);
  assert.equal(bookings.verifyBookingRequest({ authorization: 'Bearer nope' }, body, secret), false);
  assert.equal(bookings.verifyBookingRequest({}, body, secret), false);
  assert.equal(bookings.verifyBookingRequest({ authorization: `Bearer ${secret}` }, body, ''), false);
});

// ─── Strategy and timing ────────────────────────────────────────────────────

test('default strategies are written from the event\'s own facts', () => {
  const e = src.normalizeEvent(CEO_RAW)!;
  const s = strategy.defaultEventStrategy(e, NOW);
  assert.deepEqual(Object.keys(s.segments).sort(), ['failed_booking', 'interested', 'unpaid', 'upcoming']);
  assert.match(s.segments.failed_booking.offer, /GHS 4,250/);
  assert.match(s.segments.failed_booking.offer, /pay later/i);
  // The company-invoice FAQ becomes the answer to "my company will pay".
  assert.ok(s.segments.unpaid.objections.some((o) => /invoice/i.test(o.response)));
  const text = strategy.renderSegmentStrategy(s.segments.unpaid);
  assert.match(text, /EVENT CALL PLAN — Booked, payment outstanding/);
  assert.match(text, /Never ask for or accept card numbers/);
});

test('an AI or edited strategy can change the words, never the timing', () => {
  const e = src.normalizeEvent(CEO_RAW)!;
  const base = strategy.defaultSegmentStrategy(e, 'upcoming', NOW);
  const merged = strategy.mergeSegmentStrategy(base, { goal: 'Confirm attendance', timing: 'Call at 3am', objections: [{ scenario: 'x' }] });
  assert.equal(merged.goal, 'Confirm attendance');
  assert.equal(merged.timing, base.timing);
  assert.deepEqual(merged.objections, base.objections, 'an incomplete objection is dropped');
  const stored = { source: 'edited', segments: { upcoming: { goal: 'Confirm attendance' } }, fingerprint: 'old' };
  const resolved = strategy.resolveStrategy(stored, e, NOW);
  assert.equal(resolved.segments.upcoming.goal, 'Confirm attendance');
  assert.equal(resolved.segments.unpaid.goal, strategy.defaultSegmentStrategy(e, 'unpaid', NOW).goal);
  assert.equal(strategy.strategyIsStale(resolved, e), true);
});

test('call timing: soon after a failed booking, before the pay-later deadline, two days before class', () => {
  const e = src.normalizeEvent(CEO_RAW)!;
  const H = 3_600_000;
  const booked = new Date('2026-11-08T10:00:00Z');
  const t = { bookedAt: booked, lastEventAt: booked, paymentDueAt: null, createdAt: booked, sessionDate: null };
  assert.equal(strategy.firstCallAt('failed_booking', t, e, booked)?.getTime(), booked.getTime() + 0.5 * H);
  // Pay later: 24h deadline, called 6h before it.
  assert.equal(strategy.firstCallAt('unpaid', t, e, booked)?.getTime(), booked.getTime() + 18 * H);
  // Cohort 5 starts 13 Nov 09:00 Accra (UTC+0): reminder 11 Nov 09:00.
  assert.equal(strategy.firstCallAt('upcoming', t, e, booked)?.toISOString(), '2026-11-11T09:00:00.000Z');
  // Booked late: an hour after booking.
  const late = new Date('2026-11-12T15:00:00Z');
  assert.equal(strategy.firstCallAt('upcoming', { ...t, bookedAt: late, createdAt: late }, e, late)?.getTime(), late.getTime() + H);
  // Once the class has started, nobody is called.
  const during = new Date('2026-11-13T10:00:00Z');
  assert.equal(strategy.firstCallAt('upcoming', t, e, during), null);
  // Registration closed: no recovery call.
  assert.equal(strategy.firstCallAt('failed_booking', t, e, new Date('2026-11-13T07:00:00Z')), null);
  // A retry is a day later and never inside the two hours before class.
  assert.equal(strategy.retryCallAt(new Date('2026-11-12T08:00:00Z'), e, null, new Date('2026-11-12T09:00:00Z')), null);
});

test('zonedInstant converts local class times for non-UTC timezones', () => {
  assert.equal(strategy.zonedInstant('2026-11-13', '09:00', 'Africa/Lagos').toISOString(), '2026-11-13T08:00:00.000Z');
  assert.equal(strategy.zonedInstant('2026-11-13', '09:00', 'Africa/Accra').toISOString(), '2026-11-13T09:00:00.000Z');
});

// ─── Config ─────────────────────────────────────────────────────────────────

test('the events config starts safe: sync on, auto-calling off, interest is not consent', () => {
  const c = engine.resolveEventsConfig(null);
  assert.equal(c.enabled, true);
  assert.equal(c.autoCall, false);
  assert.equal(c.bookingConsent, true);
  assert.equal(c.interestConsent, false);
  assert.equal(c.siteUrl, 'https://www.africon.ai');
  const bad = engine.resolveEventsConfig({ siteUrl: 'http://evil.test', intervalHours: '0', callSegments: '["unpaid","nope"]', autoCall: 'true' });
  assert.equal(bad.siteUrl, 'https://www.africon.ai', 'only https sites');
  assert.equal(bad.intervalHours, 6);
  assert.deepEqual(bad.callSegments, ['unpaid']);
  assert.equal(bad.autoCall, true);
});

test('the Apify run crawls the listing and each event page and returns raw HTML', () => {
  const input = engine.apifyInput('https://www.africon.ai');
  assert.equal(input.startUrls[0].url, 'https://www.africon.ai/events');
  assert.equal(input.globs[0].glob, 'https://www.africon.ai/events/*');
  assert.match(input.pageFunction, /html:/);
});
