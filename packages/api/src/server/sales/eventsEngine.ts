// ─────────────────────────────────────────────────────────────────────────────
// Sales → Events engine: read Africon's events, take in bookings, plan calls.
//
//   syncEvents()        reads africon.ai (through Apify when it is connected,
//                       else a plain HTTP fetch), records what changed, marks
//                       events that disappeared, re-segments bookings, and
//                       pulls bookings from Africon's API when one is set.
//   ingestBookings()    turns booking records (webhook, API pull, a linked
//                       lead list) into leads on the owner's account, one
//                       booking row per person per event, each in a segment.
//   processDueEventCalls()
//                       when auto-calling is on, queues the calls the plan
//                       says are due — through the same queueCall as every
//                       other AI call, so call hours, caps, consent, DNC and
//                       the approval queue all still apply.
//
// The supervisor here is ordinary code, like salesEngine: no model decides
// who gets called or when. The model only rewords strategies (eventStrategy).
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, randomUUID } from 'crypto';
import axios from 'axios';
import type { Pool, PoolClient } from 'pg';
import { logger } from '../../logger.ts';
import { encryptPlatformConfig, decryptPlatformConfig } from '../../integration-helpers.ts';
import {
  AFRICON_SITE_URL, applyAvailability, diffEvent, eventFingerprint, extractEventLinks, isPastEvent, mergeEvents, pgDay,
  parseEventsFromHtml, type AvailabilityEntry, type SiteEvent,
} from './eventSource.ts';
import {
  CALL_SEGMENTS, SEGMENT_LABELS, bookingList, isCallSegment, mergeStatus, normalizeBooking, segmentFor,
  type BookingRecord, type BookingSegment, type BookingStatus, type CallSegment,
} from './eventBookings.ts';
import { SEGMENT_CALL_TYPE, firstCallAt, resolveStrategy, retryCallAt } from './eventStrategy.ts';
import { invalidateLiveEvents } from './eventContext.ts';
import { describePhone } from './orgAgent.ts';
import { findOrCreateLeadList } from './leadWorkspace.ts';
import type { SalesEngine } from './salesEngine.ts';

export const EVENTS_PLATFORM = 'africon_events';

export interface EventsConfig {
  /** Read the site on a schedule. */
  enabled: boolean;
  siteUrl: string;
  /** auto = Apify when connected, else a direct fetch. */
  source: 'auto' | 'apify' | 'direct';
  intervalHours: number;
  apifyActor: string;
  /** The sales account bookings become leads on. */
  ownerUserId: string | null;
  /** Queue calls automatically when the plan says they are due. */
  autoCall: boolean;
  /** Which segments auto-calling covers. */
  callSegments: CallSegment[];
  /** A booking (or booking attempt) counts as consent to be called about that booking. */
  bookingConsent: boolean;
  /** An interest record counts as consent. Off by default: looking is not asking to be called. */
  interestConsent: boolean;
  /** Most calls per person per segment (first call + retries). */
  maxCallsPerSegment: number;
  webhookSecret: string;
  /** Africon's bookings API, polled on each sync. GET {url}?since=ISO → { bookings: [...] }. */
  bookingsApiUrl: string;
  bookingsApiKey: string;
  bookingsCursor: string;
}

export const DEFAULT_EVENTS_CONFIG: EventsConfig = {
  enabled: true,
  siteUrl: AFRICON_SITE_URL,
  source: 'auto',
  intervalHours: 6,
  apifyActor: 'apify/cheerio-scraper',
  ownerUserId: null,
  autoCall: false,
  callSegments: [...CALL_SEGMENTS],
  bookingConsent: true,
  interestConsent: false,
  maxCallsPerSegment: 2,
  webhookSecret: '',
  bookingsApiUrl: '',
  bookingsApiKey: '',
  bookingsCursor: '',
};

const bool = (v: unknown, fallback: boolean) =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback;

export function resolveEventsConfig(stored: Record<string, unknown> | null | undefined): EventsConfig {
  const s = stored ?? {};
  const d = DEFAULT_EVENTS_CONFIG;
  const segs = Array.isArray(s.callSegments)
    ? s.callSegments
    : typeof s.callSegments === 'string'
      ? (() => { try { return JSON.parse(s.callSegments as string); } catch { return null; } })()
      : null;
  const site = typeof s.siteUrl === 'string' && /^https:\/\/[^\s/]+/.test(s.siteUrl.trim()) ? s.siteUrl.trim().replace(/\/+$/, '') : d.siteUrl;
  const hours = Number(s.intervalHours);
  const maxCalls = Number(s.maxCallsPerSegment);
  return {
    enabled: bool(s.enabled, d.enabled),
    siteUrl: site,
    source: s.source === 'apify' || s.source === 'direct' ? s.source : 'auto',
    intervalHours: Number.isFinite(hours) && hours >= 1 ? Math.min(48, Math.round(hours)) : d.intervalHours,
    apifyActor: typeof s.apifyActor === 'string' && /^[\w.-]+[/~][\w.-]+$/.test(s.apifyActor.trim()) ? s.apifyActor.trim() : d.apifyActor,
    ownerUserId: typeof s.ownerUserId === 'string' && s.ownerUserId.trim() ? s.ownerUserId.trim() : null,
    autoCall: bool(s.autoCall, d.autoCall),
    callSegments: Array.isArray(segs) ? (segs.filter(isCallSegment) as CallSegment[]) : d.callSegments,
    bookingConsent: bool(s.bookingConsent, d.bookingConsent),
    interestConsent: bool(s.interestConsent, d.interestConsent),
    maxCallsPerSegment: Number.isFinite(maxCalls) && maxCalls >= 1 ? Math.min(4, Math.round(maxCalls)) : d.maxCallsPerSegment,
    webhookSecret: typeof s.webhookSecret === 'string' ? s.webhookSecret : '',
    bookingsApiUrl: typeof s.bookingsApiUrl === 'string' && /^https:\/\//.test(s.bookingsApiUrl.trim()) ? s.bookingsApiUrl.trim() : '',
    bookingsApiKey: typeof s.bookingsApiKey === 'string' ? s.bookingsApiKey : '',
    bookingsCursor: typeof s.bookingsCursor === 'string' ? s.bookingsCursor : '',
  };
}

// ─── Fetching the site ───────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; AfriconSalesOS/1.0; +https://africon.ai)';

/** Apify's Cheerio Scraper: the listing plus every /events/<slug> page it links to, raw HTML back. */
export function apifyInput(siteUrl: string) {
  return {
    startUrls: [{ url: `${siteUrl}/events` }],
    globs: [{ glob: `${siteUrl}/events/*` }],
    linkSelector: 'a[href*="/events/"]',
    maxCrawlingDepth: 1,
    maxRequestsPerCrawl: 40,
    proxyConfiguration: { useApifyProxy: true },
    pageFunction: `async function pageFunction(context) {
  const { request, body } = context;
  return { url: request.url, html: typeof body === 'string' ? body : String(body) };
}`,
  };
}

interface FetchResult { events: SiteEvent[]; source: 'apify' | 'direct'; pages: number; warnings: string[] }

async function fetchDirect(siteUrl: string): Promise<FetchResult> {
  const get = async (url: string) => {
    const r = await axios.get<string>(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, timeout: 20_000, responseType: 'text', validateStatus: () => true });
    if (r.status !== 200) throw new Error(`${url} answered ${r.status}`);
    return String(r.data);
  };
  const warnings: string[] = [];
  const listing = await get(`${siteUrl}/events`);
  const groups = [parseEventsFromHtml(listing, siteUrl)];
  const slugs = [...new Set([...extractEventLinks(listing), ...groups[0].map((e) => e.slug)])].slice(0, 30);
  let pages = 1;
  for (const slug of slugs) {
    try {
      groups.push(parseEventsFromHtml(await get(`${siteUrl}/events/${slug}`), siteUrl));
      pages++;
    } catch (err) {
      warnings.push(`Could not read /events/${slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { events: mergeEvents(groups), source: 'direct', pages, warnings };
}

async function fetchApify(siteUrl: string, token: string, actor: string): Promise<FetchResult> {
  const r = await axios.post(
    `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items`,
    apifyInput(siteUrl),
    {
      params: { timeout: 180, format: 'json', clean: true },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 200_000,
      maxContentLength: 60 * 1024 * 1024,
      validateStatus: () => true,
    },
  );
  if (r.status >= 400) {
    const msg = r.data?.error?.message || r.data?.error?.type || `HTTP ${r.status}`;
    throw new Error(`Apify: ${msg}`);
  }
  const items = Array.isArray(r.data) ? r.data : [];
  const groups = items
    .filter((i: any) => typeof i?.html === 'string')
    .map((i: any) => parseEventsFromHtml(i.html, siteUrl));
  return { events: mergeEvents(groups), source: 'apify', pages: items.length, warnings: [] };
}

/** Live seats and today's per-session price, from the site's public availability endpoint. */
async function addAvailability(siteUrl: string, events: SiteEvent[], warnings: string[]): Promise<void> {
  const queue = events.filter((e) => e.externalId !== e.slug && e.sessions.length);
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        const r = await axios.get(`${siteUrl}/api/event-bookings/availability`, {
          params: { eventId: e.externalId }, headers: { 'User-Agent': UA, Accept: 'application/json' },
          timeout: 10_000, validateStatus: () => true,
        });
        const entries = r.status === 200 && r.data?.success ? r.data?.data?.dateEntries : null;
        if (Array.isArray(entries)) applyAvailability(e, entries as AvailabilityEntry[]);
      } catch (err) {
        warnings.push(`Seat counts for ${e.slug} unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

// ─── The engine ──────────────────────────────────────────────────────────────

export interface EventsEngineDeps {
  pool: Pool;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  salesEngine: SalesEngine;
  /** Called after a sync that changed something, e.g. to refresh the inbound assistant. */
  onEventsChanged?: () => Promise<unknown>;
}

export interface SyncSummary {
  runId: string | null;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  source: string | null;
  found: number;
  created: number;
  changed: number;
  removed: number;
  bookingsPulled: number;
  warnings: string[];
  error?: string;
}

export interface IngestSummary {
  received: number;
  accepted: number;
  created: number;
  updated: number;
  rejected: { index: number; error: string }[];
}

type BookingRow = Record<string, any>;

export function buildEventsEngine({ pool, getPlatformConfig, salesEngine, onEventsChanged }: EventsEngineDeps) {
  // ─── Config ─────────────────────────────────────────────────────────────

  async function readStored(): Promise<Record<string, any>> {
    const { rows } = await pool.query(`SELECT config FROM platform_configs WHERE platform=$1 LIMIT 1`, [EVENTS_PLATFORM]);
    return decryptPlatformConfig(rows[0]?.config) ?? {};
  }

  async function writeStored(config: Record<string, any>): Promise<void> {
    await pool.query(
      `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1,$2,true,NOW())
       ON CONFLICT (platform) DO UPDATE SET config=$2, updated_at=NOW()`,
      [EVENTS_PLATFORM, JSON.stringify(encryptPlatformConfig(config))],
    );
  }

  async function getConfig(): Promise<EventsConfig> {
    return resolveEventsConfig(await readStored().catch(() => ({})));
  }

  /** Save a partial config. A webhook secret is created on first save and kept after. */
  async function saveConfig(patch: Partial<EventsConfig>): Promise<EventsConfig> {
    const stored = await readStored().catch(() => ({}));
    const next = { ...stored, ...patch };
    if (!next.webhookSecret) next.webhookSecret = randomBytes(24).toString('hex');
    await writeStored(next);
    return resolveEventsConfig(next);
  }

  async function rotateWebhookSecret(): Promise<string> {
    const secret = randomBytes(24).toString('hex');
    await writeStored({ ...(await readStored().catch(() => ({}))), webhookSecret: secret });
    return secret;
  }

  async function apifyToken(): Promise<string | null> {
    const cfg = await getPlatformConfig('apify').catch(() => ({} as Record<string, string>));
    return cfg.apiKey || cfg.token || process.env.APIFY_TOKEN || null;
  }

  // ─── Sync ───────────────────────────────────────────────────────────────

  async function fetchEvents(cfg: EventsConfig): Promise<FetchResult> {
    const token = cfg.source === 'direct' ? null : await apifyToken();
    if (cfg.source === 'apify' && !token) throw new Error('Apify is not connected (Admin → Integrations → Apify).');
    let result: FetchResult;
    if (token) {
      try {
        result = await fetchApify(cfg.siteUrl, token, cfg.apifyActor);
        if (!result.events.length) throw new Error('Apify returned no events');
      } catch (err) {
        if (cfg.source === 'apify') throw err;
        const why = err instanceof Error ? err.message : String(err);
        result = await fetchDirect(cfg.siteUrl);
        result.warnings.unshift(`Apify run failed (${why}); read the site directly instead.`);
      }
    } else {
      result = await fetchDirect(cfg.siteUrl);
    }
    await addAvailability(cfg.siteUrl, result.events, result.warnings);
    return result;
  }

  /**
   * One sync. Never runs twice at once (an advisory lock, so a second app
   * instance or a click during a scheduled run just returns "skipped").
   */
  async function syncEvents(trigger: 'schedule' | 'manual' = 'manual', now = new Date()): Promise<SyncSummary> {
    const client = await pool.connect();
    const summary: SyncSummary = { runId: null, status: 'ok', source: null, found: 0, created: 0, changed: 0, removed: 0, bookingsPulled: 0, warnings: [] };
    let locked = false;
    try {
      const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext('sales_event_sync')) AS ok`);
      locked = lock.rows[0]?.ok === true;
      if (!locked) return { ...summary, status: 'skipped', error: 'A sync is already running.' };

      const cfg = await getConfig();
      const run = await client.query(`INSERT INTO sales_event_sync_runs (id, trigger) VALUES ($1,$2) RETURNING id`, [randomUUID(), trigger]);
      summary.runId = run.rows[0].id;

      try {
        const fetched = await fetchEvents(cfg);
        summary.source = fetched.source;
        summary.warnings.push(...fetched.warnings);
        summary.found = fetched.events.length;
        // An empty page is a broken read, not a site with no events: never
        // mark everything removed because one fetch came back blank.
        if (!fetched.events.length) throw new Error('No events found on the site — the page layout may have changed.');

        const seen: string[] = [];
        for (const e of fetched.events) {
          const { rows } = await client.query(
            `SELECT id, data FROM sales_events WHERE source='africon' AND (external_id=$1 OR slug=$2)
              ORDER BY (external_id=$1) DESC LIMIT 1`,
            [e.externalId, e.slug],
          );
          const prev = rows[0];
          const material = diffEvent(prev ? (prev.data as SiteEvent) : null, e, now);
          let id: string;
          if (prev) {
            id = prev.id;
            await client.query(
              `UPDATE sales_events SET external_id=$2, slug=$3, title=$4, url=$5, status=$6, start_date=$7, end_date=$8,
                      data=$9, fingerprint=$10, last_seen_at=NOW(), removed_at=NULL, updated_at=NOW(),
                      last_changed_at = CASE WHEN $11 THEN NOW() ELSE last_changed_at END
                WHERE id=$1`,
              [id, e.externalId, e.slug, e.title, e.url, e.status, e.startDate, e.endDate, JSON.stringify(e), eventFingerprint(e), material.length > 0],
            );
            if (material.length) summary.changed++;
          } else {
            const ins = await client.query(
              `INSERT INTO sales_events (id, source, external_id, slug, title, url, status, start_date, end_date, data, fingerprint)
               VALUES ($1,'africon',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
              [randomUUID(), e.externalId, e.slug, e.title, e.url, e.status, e.startDate, e.endDate, JSON.stringify(e), eventFingerprint(e)],
            );
            id = ins.rows[0].id;
            summary.created++;
          }
          for (const c of material) {
            await client.query(`INSERT INTO sales_event_changes (event_id, kind, summary) VALUES ($1,$2,$3)`, [id, c.kind, c.summary.slice(0, 500)]);
          }
          seen.push(id);
        }

        const gone = await client.query(
          `UPDATE sales_events SET removed_at=NOW(), updated_at=NOW()
            WHERE source='africon' AND removed_at IS NULL AND NOT (id = ANY($1::text[])) RETURNING id, title`,
          [seen],
        );
        for (const g of gone.rows) {
          await client.query(`INSERT INTO sales_event_changes (event_id, kind, summary) VALUES ($1,'removed',$2)`, [g.id, `No longer listed on the site: ${g.title}`]);
        }
        summary.removed = gone.rowCount ?? 0;

        await relinkBookings(client, now);
        await resegmentBookings(client, now);
        invalidateLiveEvents();

        if (cfg.bookingsApiUrl) {
          try {
            summary.bookingsPulled = await pullBookings(cfg);
          } catch (err) {
            summary.warnings.push(`Bookings API: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        summary.status = summary.warnings.length ? 'partial' : 'ok';
      } catch (err) {
        summary.status = 'failed';
        summary.error = err instanceof Error ? err.message : String(err);
        logger.warn({ err: summary.error }, 'sales_event_sync_failed');
      }

      await client.query(
        `UPDATE sales_event_sync_runs
            SET status=$2, source=$3, events_found=$4, events_new=$5, events_changed=$6, bookings_pulled=$7,
                warnings=$8, error=$9, finished_at=NOW()
          WHERE id=$1`,
        [summary.runId, summary.status, summary.source, summary.found, summary.created, summary.changed,
         summary.bookingsPulled, JSON.stringify(summary.warnings.slice(0, 30)), summary.error ?? null],
      );
      if ((summary.created || summary.changed || summary.removed) && onEventsChanged) {
        void onEventsChanged().catch((err) => logger.warn({ err }, 'sales_events_changed_hook_failed'));
      }
      return summary;
    } finally {
      if (locked) await client.query(`SELECT pg_advisory_unlock(hashtext('sales_event_sync'))`).catch(() => undefined);
      client.release();
    }
  }

  /** Run a scheduled sync when the last one is older than the interval. */
  async function runScheduledSync(): Promise<void> {
    try {
      const cfg = await getConfig();
      if (!cfg.enabled) return;
      const { rows } = await pool.query(
        `SELECT started_at FROM sales_event_sync_runs WHERE trigger='schedule' OR status IN ('ok','partial')
          ORDER BY started_at DESC LIMIT 1`,
      );
      const last = rows[0]?.started_at ? new Date(rows[0].started_at).getTime() : 0;
      if (Date.now() - last < cfg.intervalHours * 3_600_000) return;
      await syncEvents('schedule');
    } catch (err) {
      logger.warn({ err }, 'sales_event_scheduled_sync_failed');
    }
  }

  /**
   * Bookings that arrived before their event was synced get linked once it
   * is, and only then get a segment that knows the dates and a planned call.
   */
  async function relinkBookings(db: Pool | PoolClient, now: Date): Promise<void> {
    const { rows } = await db.query(
      `UPDATE sales_event_bookings b SET event_id=e.id, updated_at=NOW()
         FROM sales_events e
        WHERE b.event_id IS NULL AND e.source='africon' AND (e.external_id=b.event_ref OR e.slug=b.event_ref)
        RETURNING b.id, b.status, b.booked_at, b.last_event_at, b.payment_due_at, b.created_at, b.session_date, e.data AS event_data`,
    );
    for (const r of rows) {
      const event = r.event_data as SiteEvent;
      const segment = segmentFor(r.status as BookingStatus, event, now);
      const nextAt = planNext(segment, {
        booked_at: r.booked_at ? new Date(r.booked_at) : null,
        last_event_at: r.last_event_at ? new Date(r.last_event_at) : null,
        payment_due_at: r.payment_due_at ? new Date(r.payment_due_at) : null,
        created_at: new Date(r.created_at),
        session_date: pgDay(r.session_date),
      }, event, now);
      await db.query(`UPDATE sales_event_bookings SET segment=$2, next_call_at=$3 WHERE id=$1`, [r.id, segment, nextAt]);
    }
  }

  /** Recompute every live booking's segment: an event ending moves its people to "past". */
  async function resegmentBookings(db: Pool | PoolClient, now: Date): Promise<void> {
    const { rows } = await db.query(
      `SELECT b.id, b.status, b.segment, e.data AS event_data
         FROM sales_event_bookings b JOIN sales_events e ON e.id=b.event_id
        WHERE b.segment NOT IN ('past','cancelled')`,
    );
    for (const r of rows) {
      const seg = segmentFor(r.status as BookingStatus, r.event_data as SiteEvent, now);
      if (seg !== r.segment) {
        await db.query(
          `UPDATE sales_event_bookings SET segment=$2, next_call_at=NULL, call_segment=NULL, calls_made=0, updated_at=NOW() WHERE id=$1`,
          [r.id, seg],
        );
        await cancelPendingCalls(db, r.id, `booking is now: ${SEGMENT_LABELS[seg]}`);
      }
    }
  }

  async function cancelPendingCalls(db: Pool | PoolClient, bookingId: string, reason: string): Promise<void> {
    await db.query(
      `UPDATE sales_call_attempts SET status='cancelled', block_reason=$2, updated_at=NOW()
        WHERE event_booking_id=$1 AND status IN ('queued','awaiting_approval')`,
      [bookingId, reason.slice(0, 300)],
    );
  }

  // ─── Bookings ───────────────────────────────────────────────────────────

  async function pullBookings(cfg: EventsConfig): Promise<number> {
    const since = cfg.bookingsCursor || new Date(Date.now() - 30 * 86_400_000).toISOString();
    const startedAt = new Date().toISOString();
    const r = await axios.get(cfg.bookingsApiUrl, {
      params: { since },
      headers: { Accept: 'application/json', ...(cfg.bookingsApiKey ? { Authorization: `Bearer ${cfg.bookingsApiKey}` } : {}) },
      timeout: 30_000,
      validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`answered ${r.status}`);
    const result = await ingestBookings(bookingList(r.data), 'api');
    await writeStored({ ...(await readStored().catch(() => ({}))), bookingsCursor: startedAt });
    return result.accepted;
  }

  async function loadEventIndex(): Promise<Map<string, { id: string; externalId: string; data: SiteEvent }>> {
    const { rows } = await pool.query(`SELECT id, external_id, slug, data FROM sales_events WHERE source='africon'`);
    const map = new Map<string, { id: string; externalId: string; data: SiteEvent }>();
    for (const r of rows) {
      const v = { id: r.id, externalId: r.external_id, data: r.data as SiteEvent };
      map.set(String(r.external_id), v);
      map.set(String(r.slug), v);
    }
    return map;
  }

  /** Find the owner's contact by email, then phone (as given or as E.164); create it when new. */
  async function upsertContact(client: PoolClient, userId: string, rec: BookingRecord): Promise<{ id: string; created: boolean }> {
    const e164 = rec.phone ? describePhone(rec.phone, 'GH').e164 : null;
    const phone = e164 ?? rec.phone;
    const find = () => client.query(
      `SELECT id, first_name, last_name, email, phone FROM mailing_contacts
        WHERE user_id=$1 AND (($2::text IS NOT NULL AND lower(email)=$2) OR ($3::text IS NOT NULL AND phone IN ($3, $4)))
        ORDER BY ($2::text IS NOT NULL AND lower(email)=$2) DESC LIMIT 1`,
      [userId, rec.email, phone, rec.phone],
    );
    let found = (await find()).rows[0];
    if (!found) {
      try {
        await client.query('SAVEPOINT contact_insert');
        const ins = await client.query(
          `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source)
           VALUES ($1,$2,$3,$4,$5,$6,'africon_events') RETURNING id`,
          [randomUUID(), userId, rec.email, rec.firstName, rec.lastName, phone],
        );
        await client.query('RELEASE SAVEPOINT contact_insert');
        return { id: ins.rows[0].id, created: true };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT contact_insert');
        if ((err as { code?: string })?.code !== '23505') throw err;
        found = (await find()).rows[0];
        if (!found) throw err;
      }
    }
    // Fill gaps only: never overwrite what the team already typed.
    await client.query(
      `UPDATE mailing_contacts
          SET first_name=COALESCE(first_name,$3), last_name=COALESCE(last_name,$4),
              email=CASE WHEN email IS NULL AND $5::text IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM mailing_contacts o WHERE o.user_id=$2 AND lower(o.email)=$5)
                         THEN $5 ELSE email END,
              phone=COALESCE(phone,$6), updated_at=NOW()
        WHERE id=$1 AND user_id=$2`,
      [found.id, userId, rec.firstName, rec.lastName, rec.email, phone],
    ).catch(() => undefined);
    return { id: found.id, created: false };
  }

  function planNext(segment: BookingSegment, row: { booked_at: Date | null; last_event_at: Date | null; payment_due_at: Date | null; created_at: Date; session_date: string | null }, event: SiteEvent | null, now: Date): Date | null {
    if (!event || !isCallSegment(segment)) return null;
    return firstCallAt(segment, {
      bookedAt: row.booked_at, lastEventAt: row.last_event_at, paymentDueAt: row.payment_due_at,
      createdAt: row.created_at, sessionDate: row.session_date,
    }, event, now);
  }

  const RESPONSE_STATUS: Partial<Record<BookingStatus, string>> = {
    confirmed: 'paid', attended: 'paid', pay_later: 'registered', pending_review: 'registered', interested: 'interested',
  };
  const STATUS_NOTE: Record<BookingStatus, string> = {
    interested: 'showed interest in', started: 'started booking', payment_failed: 'tried to pay for',
    pay_later: 'booked (pay later)', pending_review: 'registered for (awaiting review)', confirmed: 'booked and paid for',
    attended: 'attended', no_show: 'did not attend', cancelled: 'cancelled their booking for',
  };

  /**
   * Take in booking records. Each becomes (or updates) a lead on the owner's
   * account, joins the event's lead list, and gets one booking row with its
   * segment and next planned call.
   */
  async function ingestBookings(input: unknown[], via: 'webhook' | 'api' | 'list' | 'manual', now = new Date()): Promise<IngestSummary> {
    const cfg = await getConfig();
    const ownerId = cfg.ownerUserId;
    if (!ownerId) throw new Error('No owner account is set for event bookings (Admin → Sales Events).');
    const events = await loadEventIndex();
    const summary: IngestSummary = { received: input.length, accepted: 0, created: 0, updated: 0, rejected: [] };

    for (let index = 0; index < input.length; index++) {
      const { record, error } = normalizeBooking(input[index]);
      if (!record) { summary.rejected.push({ index, error: error ?? 'invalid' }); continue; }
      const event = events.get(record.eventRef) ?? null;
      const eventRef = event?.externalId ?? record.eventRef;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const contact = await upsertContact(client, ownerId, record);
        await client.query(
          `INSERT INTO sales_lead_profiles (id, user_id, contact_id, role_title) VALUES ($1,$2,$3,$4)
           ON CONFLICT (contact_id) DO UPDATE SET role_title=COALESCE(sales_lead_profiles.role_title, EXCLUDED.role_title), updated_at=NOW()`,
          [randomUUID(), ownerId, contact.id, record.role],
        );
        const consentAllowed = record.consent !== false
          && (record.consent === true || (record.status === 'interested' ? cfg.interestConsent : cfg.bookingConsent));
        if (consentAllowed) {
          await client.query(
            `UPDATE sales_lead_profiles SET consent_source=$3, consent_at=$4, updated_at=NOW()
              WHERE contact_id=$1 AND user_id=$2 AND consent_at IS NULL AND do_not_call=false`,
            [contact.id, ownerId, record.consent === true ? 'africon_event_opt_in' : `africon_event_${record.status === 'interested' ? 'interest' : 'booking'}`, record.bookedAt ?? record.occurredAt ?? now],
          );
        }
        if (event) {
          const list = await findOrCreateLeadList(client, ownerId, `Event · ${event.data.title}`.slice(0, 120), 'event');
          await client.query(`INSERT INTO sales_lead_list_members (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [list.id, contact.id]);
        }

        const existing = (await client.query(
          `SELECT * FROM sales_event_bookings WHERE user_id=$1 AND event_ref=$2 AND contact_id=$3 FOR UPDATE`,
          [ownerId, eventRef, contact.id],
        )).rows[0] as BookingRow | undefined;
        const status = mergeStatus(
          existing ? { status: existing.status, lastEventAt: existing.last_event_at ? new Date(existing.last_event_at) : null } : null,
          { status: record.status, occurredAt: record.occurredAt },
        );
        const segment = segmentFor(status, event?.data ?? null, now);
        const occurred = record.occurredAt ?? now;

        if (!existing) {
          const createdAt = now;
          const nextAt = planNext(segment, {
            booked_at: record.bookedAt, last_event_at: occurred, payment_due_at: record.paymentDueAt,
            created_at: createdAt, session_date: record.sessionDate,
          }, event?.data ?? null, now);
          await client.query(
            `INSERT INTO sales_event_bookings
               (id, user_id, event_id, event_ref, contact_id, external_id, status, raw_status, segment, cohort_id, cohort_label,
                session_date, attendees, amount, currency, source, via, notes, answers, booked_at, last_event_at, payment_due_at,
                next_call_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
            [randomUUID(), ownerId, event?.id ?? null, eventRef, contact.id, record.externalId, status, record.rawStatus, segment,
             record.cohortId, record.cohortLabel, record.sessionDate, record.attendees, record.amount, record.currency,
             record.source, via, record.notes, JSON.stringify(record.answers), record.bookedAt ?? occurred, occurred,
             record.paymentDueAt, nextAt, createdAt],
          );
          summary.created++;
        } else {
          const segmentChanged = segment !== existing.segment;
          const merged = {
            booked_at: existing.booked_at ? new Date(existing.booked_at) : record.bookedAt,
            last_event_at: occurred,
            payment_due_at: record.paymentDueAt ?? (existing.payment_due_at ? new Date(existing.payment_due_at) : null),
            created_at: new Date(existing.created_at),
            session_date: record.sessionDate ?? (pgDay(existing.session_date)),
          };
          const nextAt = segmentChanged ? planNext(segment, merged, event?.data ?? null, now) : null;
          await client.query(
            `UPDATE sales_event_bookings
                SET event_id=COALESCE($2, event_id), external_id=COALESCE($3, external_id), status=$4, raw_status=COALESCE($5, raw_status),
                    segment=$6, cohort_id=COALESCE($7, cohort_id), cohort_label=COALESCE($8, cohort_label),
                    session_date=COALESCE($9, session_date), attendees=COALESCE($10, attendees), amount=COALESCE($11, amount),
                    currency=COALESCE($12, currency), source=COALESCE(source, $13), notes=COALESCE($14, notes),
                    answers=answers || $15::jsonb, payment_due_at=COALESCE($16, payment_due_at),
                    last_event_at=GREATEST(COALESCE(last_event_at, $17), $17),
                    next_call_at = CASE WHEN $18 THEN $19 ELSE next_call_at END,
                    call_segment = CASE WHEN $18 THEN NULL ELSE call_segment END,
                    calls_made   = CASE WHEN $18 THEN 0 ELSE calls_made END,
                    updated_at=NOW()
              WHERE id=$1`,
            [existing.id, event?.id ?? null, record.externalId, status, record.rawStatus, segment, record.cohortId, record.cohortLabel,
             record.sessionDate, record.attendees, record.amount, record.currency, record.source, record.notes,
             JSON.stringify(record.answers), record.paymentDueAt, occurred, segmentChanged, nextAt],
          );
          if (segmentChanged) await cancelPendingCalls(client, existing.id, `booking is now: ${SEGMENT_LABELS[segment]}`);
          summary.updated++;
        }

        // The lead's timeline shows the booking, once per status.
        if (!existing || existing.status !== status) {
          const title = event?.data.title ?? record.eventRef;
          await client.query(
            `INSERT INTO crm_activities (id, user_id, contact_id, type, title, body, response_status, completed_at)
             VALUES ($1,$2,$3,'note',$4,$5,$6,$7)`,
            [randomUUID(), ownerId, contact.id, `Africon event: ${title}`.slice(0, 200),
             `${[record.firstName, record.lastName].filter(Boolean).join(' ') || 'This lead'} ${STATUS_NOTE[status]} ${title}` +
               `${record.cohortLabel ? ` (${record.cohortLabel})` : ''}${record.amount !== null ? ` — ${record.currency ?? event?.data.currency ?? ''} ${record.amount}` : ''}.`,
             RESPONSE_STATUS[status] ?? null, occurred],
          );
        }
        await client.query('COMMIT');
        summary.accepted++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        logger.warn({ err, index }, 'sales_event_booking_ingest_failed');
        summary.rejected.push({ index, error: err instanceof Error ? err.message.slice(0, 200) : 'failed' });
      } finally {
        client.release();
      }
    }
    return summary;
  }

  /**
   * Treat every lead on one of the user's lists as a booking for an event —
   * for a spreadsheet exported from Africon's dashboard and imported through
   * Sales → Leads → Import.
   */
  async function linkListToEvent(userId: string, eventId: string, listId: string, status: BookingStatus): Promise<IngestSummary> {
    const cfg = await getConfig();
    if (cfg.ownerUserId !== userId) throw new Error('Only the account that owns event bookings can link lists.');
    const ev = (await pool.query(`SELECT external_id FROM sales_events WHERE id=$1`, [eventId])).rows[0];
    if (!ev) throw new Error('Event not found');
    const { rows } = await pool.query(
      `SELECT c.first_name, c.last_name, c.email, c.phone, m.added_at
         FROM sales_lead_list_members m
         JOIN sales_lead_lists l ON l.id=m.list_id AND l.user_id=$1
         JOIN mailing_contacts c ON c.id=m.contact_id
        WHERE m.list_id=$2 LIMIT 2000`,
      [userId, listId],
    );
    return ingestBookings(rows.map((r) => ({
      eventId: ev.external_id, firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone,
      status, source: 'import', createdAt: r.added_at ? new Date(r.added_at).toISOString() : undefined,
    })), 'list');
  }

  // ─── Calls ──────────────────────────────────────────────────────────────

  /** Queue the call for one booking now, through the normal gate. */
  async function queueBookingCall(booking: BookingRow, opts: { awaitApproval: boolean; now?: Date }) {
    const now = opts.now ?? new Date();
    const segment = booking.segment as BookingSegment;
    if (!isCallSegment(segment)) return { queued: false, reason: `${SEGMENT_LABELS[segment]} — nobody is called in this group.` };
    const ev = (await pool.query(`SELECT data, strategy FROM sales_events WHERE id=$1`, [booking.event_id])).rows[0];
    if (!ev) return { queued: false, reason: 'The event is not synced.' };
    const event = ev.data as SiteEvent;
    if (isPastEvent(event, now)) return { queued: false, reason: 'The event is over.' };
    // The same rule that planned the call decides whether its moment has gone
    // (the class has started, registration has closed).
    const stillDue = planNext(segment, {
      booked_at: booking.booked_at ? new Date(booking.booked_at) : null,
      last_event_at: booking.last_event_at ? new Date(booking.last_event_at) : null,
      payment_due_at: booking.payment_due_at ? new Date(booking.payment_due_at) : null,
      created_at: new Date(booking.created_at),
      session_date: pgDay(booking.session_date),
    }, event, now);
    if (!stillDue) {
      return { queued: false, reason: segment === 'failed_booking' || segment === 'interested' ? 'Registration has closed.' : 'The class has already started.' };
    }
    const plan = resolveStrategy(ev.strategy, event, now).segments[segment];
    const note = `Africon event call — ${SEGMENT_LABELS[segment]}: ${event.title}. ${plan.goal}`;
    const res = await salesEngine.queueCall({
      userId: booking.user_id,
      contactId: booking.contact_id,
      callType: SEGMENT_CALL_TYPE[segment],
      objective: plan.goal,
      note,
      awaitApproval: opts.awaitApproval,
      eventBookingId: booking.id,
      now,
    });
    await pool.query(
      `UPDATE sales_event_bookings
          SET calls_made = CASE WHEN NOT $5 THEN calls_made WHEN call_segment=$2 THEN calls_made + 1 ELSE 1 END,
              call_segment = CASE WHEN $5 THEN $2 ELSE call_segment END,
              last_attempt_id=$3, last_call_at=$4, next_call_at=NULL, updated_at=NOW()
        WHERE id=$1`,
      // A call the gate refused is recorded (its reason shows on the person)
      // but is not a call made: it never counts against the retry budget.
      [booking.id, segment, res.attemptId, now, res.queued],
    );
    return {
      queued: res.queued,
      awaitingApproval: res.awaitingApproval,
      attemptId: res.attemptId,
      reason: res.queued ? null : res.decision.action === 'stop' ? res.decision.reason : null,
    };
  }

  /** Queue calls for chosen bookings (or a whole segment) of one event. */
  async function queueEventCalls(userId: string, eventId: string, filter: { segment?: CallSegment; bookingIds?: string[] }) {
    const params: unknown[] = [userId, eventId];
    let where = `b.user_id=$1 AND b.event_id=$2`;
    if (filter.bookingIds?.length) { params.push(filter.bookingIds.slice(0, 500)); where += ` AND b.id = ANY($${params.length}::text[])`; }
    if (filter.segment) { params.push(filter.segment); where += ` AND b.segment=$${params.length}`; }
    // Skip people who already have a call waiting.
    where += ` AND NOT EXISTS (SELECT 1 FROM sales_call_attempts a WHERE a.event_booking_id=b.id AND a.status IN ('queued','awaiting_approval','dialing','in_progress'))`;
    const { rows } = await pool.query(`SELECT b.* FROM sales_event_bookings b WHERE ${where} LIMIT 500`, params);
    const policy = await salesEngine.getPolicy(userId);
    const out = { considered: rows.length, queued: 0, awaitingApproval: 0, blocked: [] as { bookingId: string; reason: string }[] };
    for (const b of rows) {
      const r = await queueBookingCall(b, { awaitApproval: policy.requireCallApproval });
      if (r.queued && r.awaitingApproval) out.awaitingApproval++;
      else if (r.queued) out.queued++;
      else out.blocked.push({ bookingId: b.id, reason: r.reason ?? 'blocked' });
    }
    return out;
  }

  /**
   * The planner tick. Schedules second tries after unanswered calls, then —
   * only when auto-calling is on — queues every call whose time has come.
   */
  async function processDueEventCalls(now = new Date()): Promise<void> {
    try {
      const cfg = await getConfig();
      if (!cfg.ownerUserId) return;

      // Retries: the last call for this segment ended without a conversation.
      const { rows: retry } = await pool.query(
        `SELECT b.id, b.last_call_at, b.session_date, e.data AS event_data
           FROM sales_event_bookings b
           JOIN sales_events e ON e.id=b.event_id
           JOIN sales_call_attempts a ON a.id=b.last_attempt_id
          WHERE b.user_id=$1 AND b.next_call_at IS NULL AND b.call_segment=b.segment
            AND b.calls_made < $2 AND a.status IN ('completed','failed','blocked')
            AND COALESCE(a.outcome,'failed') IN ('no_answer','busy','voicemail','failed')
            AND (a.block_reason IS NULL OR a.block_reason NOT LIKE 'no_consent%')
          LIMIT 200`,
        [cfg.ownerUserId, cfg.maxCallsPerSegment],
      );
      for (const r of retry) {
        const at = retryCallAt(new Date(r.last_call_at), r.event_data as SiteEvent,
          pgDay(r.session_date), now);
        if (at) await pool.query(`UPDATE sales_event_bookings SET next_call_at=$2 WHERE id=$1 AND next_call_at IS NULL`, [r.id, at]);
      }

      if (!cfg.autoCall || !cfg.callSegments.length) return;
      const policy = await salesEngine.getPolicy(cfg.ownerUserId);
      const { rows } = await pool.query(
        `UPDATE sales_event_bookings SET next_call_at=NULL, updated_at=NOW()
          WHERE id IN (
            SELECT id FROM sales_event_bookings
             WHERE user_id=$1 AND next_call_at <= $2 AND segment = ANY($3::text[]) AND event_id IS NOT NULL
             ORDER BY next_call_at LIMIT 25 FOR UPDATE SKIP LOCKED)
          RETURNING *`,
        [cfg.ownerUserId, now, cfg.callSegments],
      );
      for (const b of rows) {
        await queueBookingCall(b, { awaitApproval: policy.requireCallApproval, now }).catch((err) =>
          logger.warn({ err, bookingId: b.id }, 'sales_event_call_queue_failed'));
      }
    } catch (err) {
      logger.warn({ err }, 'sales_event_planner_failed');
    }
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  async function listEvents(userId: string, now = new Date()) {
    const { rows } = await pool.query(
      `SELECT e.id, e.slug, e.title, e.url, e.status, e.start_date, e.end_date, e.data, e.strategy, e.last_seen_at,
              e.last_changed_at, e.removed_at,
              COALESCE((SELECT jsonb_object_agg(segment, n) FROM (
                 SELECT segment, COUNT(*)::int AS n FROM sales_event_bookings b
                  WHERE b.event_id=e.id AND b.user_id=$1 GROUP BY segment) s), '{}'::jsonb) AS segment_counts,
              (SELECT COUNT(*)::int FROM sales_event_changes c WHERE c.event_id=e.id AND c.kind <> 'new' AND c.created_at > NOW() - INTERVAL '7 days') AS recent_changes
         FROM sales_events e
        ORDER BY e.removed_at NULLS FIRST, e.start_date NULLS LAST`,
      [userId],
    );
    return rows.map((r) => {
      const event = r.data as SiteEvent;
      const strategy = resolveStrategy(r.strategy, event, now);
      return {
        id: r.id, slug: r.slug, title: r.title, url: r.url, status: r.status,
        startDate: pgDay(r.start_date), endDate: pgDay(r.end_date), event, lastSeenAt: r.last_seen_at,
        lastChangedAt: r.last_changed_at, removedAt: r.removed_at, past: isPastEvent(event, now),
        segmentCounts: r.segment_counts as Record<string, number>, recentChanges: r.recent_changes,
        strategySource: strategy.source,
        strategyStale: strategy.source !== 'default' && strategy.fingerprint !== eventFingerprint(event),
      };
    });
  }

  async function getEventDetail(userId: string, eventId: string, now = new Date()) {
    const { rows } = await pool.query(`SELECT * FROM sales_events WHERE id=$1`, [eventId]);
    const r = rows[0];
    if (!r) return null;
    const event = r.data as SiteEvent;
    const [changes, bookings] = await Promise.all([
      pool.query(`SELECT kind, summary, created_at FROM sales_event_changes WHERE event_id=$1 ORDER BY created_at DESC LIMIT 30`, [eventId]),
      pool.query(
        `SELECT b.id, b.contact_id, b.status, b.raw_status, b.segment, b.cohort_label, b.session_date, b.amount, b.currency,
                b.source, b.via, b.booked_at, b.last_event_at, b.payment_due_at, b.next_call_at, b.calls_made, b.last_call_at,
                c.first_name, c.last_name, c.email, c.phone, p.consent_at, p.do_not_call,
                a.status AS last_call_status, a.outcome AS last_call_outcome, a.block_reason AS last_call_block
           FROM sales_event_bookings b
           JOIN mailing_contacts c ON c.id=b.contact_id
           LEFT JOIN sales_lead_profiles p ON p.contact_id=b.contact_id
           LEFT JOIN sales_call_attempts a ON a.id=b.last_attempt_id
          WHERE b.event_id=$1 AND b.user_id=$2
          ORDER BY b.last_event_at DESC NULLS LAST LIMIT 1000`,
        [eventId, userId],
      ),
    ]);
    const strategy = resolveStrategy(r.strategy, event, now);
    return {
      id: r.id, event, lastSeenAt: r.last_seen_at, removedAt: r.removed_at, past: isPastEvent(event, now),
      strategy, strategyStale: strategy.source !== 'default' && strategy.fingerprint !== eventFingerprint(event),
      changes: changes.rows, bookings: bookings.rows,
    };
  }

  async function saveStrategy(eventId: string, strategy: unknown, source: 'ai' | 'edited' | 'default') {
    if (source === 'default') {
      await pool.query(`UPDATE sales_events SET strategy=NULL, updated_at=NOW() WHERE id=$1`, [eventId]);
      return;
    }
    await pool.query(`UPDATE sales_events SET strategy=$2, updated_at=NOW() WHERE id=$1`, [eventId, JSON.stringify(strategy)]);
  }

  async function listRuns(limit = 20) {
    const { rows } = await pool.query(`SELECT * FROM sales_event_sync_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
    return rows;
  }

  return {
    getConfig, saveConfig, rotateWebhookSecret, apifyToken,
    syncEvents, runScheduledSync,
    ingestBookings, linkListToEvent,
    queueEventCalls, processDueEventCalls,
    listEvents, getEventDetail, saveStrategy, listRuns,
  };
}

export type EventsEngine = ReturnType<typeof buildEventsEngine>;
