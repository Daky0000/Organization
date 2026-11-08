// ─────────────────────────────────────────────────────────────────────────────
// Sales → Events — REST API. Mounted at '/api'.
//
//   Admin (connection settings, sync, strategies — organisation wide):
//     GET  /admin/sales-events/config         settings, webhook URL + secret, last runs
//     PUT  /admin/sales-events/config         partial update
//     POST /admin/sales-events/rotate-secret  new bookings webhook secret
//     POST /admin/sales-events/sync           read africon.ai now
//     POST /sales/events/:id/strategy/generate  AI rewording of the call strategies
//     PUT  /sales/events/:id/strategy           save an edited strategy, or { reset: true }
//
//   Sales users (their own bookings):
//     GET  /sales/events                      events with per-segment counts
//     GET  /sales/events/:id                  one event: facts, changes, people, strategy
//     POST /sales/events/:id/calls            queue calls for a segment or chosen people
//     POST /sales/events/:id/link-list        treat a lead list as bookings for this event
//
//   Africon's backend (no login; shared secret):
//     POST /integrations/africon/bookings     one booking, an array, or { bookings: [...] }
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import type { Response, Router } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { BOOKING_STATUSES, CALL_SEGMENTS, bookingList, isCallSegment, verifyBookingRequest, type BookingStatus } from './sales/eventBookings.ts';
import { generateEventStrategy, mergeSegmentStrategy, resolveStrategy } from './sales/eventStrategy.ts';
import { eventFingerprint, type SiteEvent } from './sales/eventSource.ts';
import type { EventsConfig, EventsEngine } from './sales/eventsEngine.ts';

interface Deps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  pool: Pool;
  eventsEngine: EventsEngine;
}

const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });

function publicBase(): string | null {
  const base = (process.env.PUBLIC_API_URL || process.env.VITE_APP_URL || '').replace(/\/$/, '');
  return /^https?:\/\//.test(base) ? base : null;
}

export function registerSalesEventsRoutes({ requireAuth, requireAdmin, pool, eventsEngine }: Deps): Router {
  const router = express.Router();

  async function configView(cfg: EventsConfig) {
    const [runs, owner, apify] = await Promise.all([
      eventsEngine.listRuns(10),
      cfg.ownerUserId
        ? pool.query(`SELECT id, email, COALESCE(NULLIF(TRIM(full_name),''), username, email) AS name FROM users WHERE id=$1`, [cfg.ownerUserId]).then((r) => r.rows[0] ?? null).catch(() => null)
        : Promise.resolve(null),
      eventsEngine.apifyToken(),
    ]);
    const base = publicBase();
    return {
      success: true,
      config: {
        enabled: cfg.enabled, siteUrl: cfg.siteUrl, source: cfg.source, intervalHours: cfg.intervalHours,
        apifyActor: cfg.apifyActor, ownerUserId: cfg.ownerUserId, autoCall: cfg.autoCall, callSegments: cfg.callSegments,
        bookingConsent: cfg.bookingConsent, interestConsent: cfg.interestConsent, maxCallsPerSegment: cfg.maxCallsPerSegment,
        bookingsApiUrl: cfg.bookingsApiUrl, hasBookingsApiKey: Boolean(cfg.bookingsApiKey), bookingsCursor: cfg.bookingsCursor,
      },
      // The admin hands these to whoever builds the Africon side.
      webhook: {
        url: base ? `${base}/api/integrations/africon/bookings` : '/api/integrations/africon/bookings',
        secret: cfg.webhookSecret || null,
      },
      owner,
      apifyConnected: Boolean(apify),
      runs,
    };
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  router.get('/admin/sales-events/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      let cfg = await eventsEngine.getConfig();
      // First visit: bookings go to the admin who opened it, and a secret exists.
      if (!cfg.ownerUserId || !cfg.webhookSecret) {
        cfg = await eventsEngine.saveConfig({ ownerUserId: cfg.ownerUserId ?? (admin.id ?? admin.userId) });
      }
      return res.json(await configView(cfg));
    } catch (err) {
      logger.error({ err }, 'sales_events_config_get_failed');
      return fail(res, 500, 'Failed to load the events settings');
    }
  });

  router.put('/admin/sales-events/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const patch: Record<string, unknown> = {};
      for (const k of ['enabled', 'autoCall', 'bookingConsent', 'interestConsent'] as const) {
        if (typeof b[k] === 'boolean') patch[k] = b[k];
      }
      for (const k of ['siteUrl', 'source', 'apifyActor', 'bookingsApiUrl'] as const) {
        if (typeof b[k] === 'string') patch[k] = (b[k] as string).trim().slice(0, 500);
      }
      for (const k of ['intervalHours', 'maxCallsPerSegment'] as const) {
        if (b[k] !== undefined && Number.isFinite(Number(b[k]))) patch[k] = Number(b[k]);
      }
      if (Array.isArray(b.callSegments)) patch.callSegments = b.callSegments.filter(isCallSegment);
      if (typeof b.bookingsApiKey === 'string' && b.bookingsApiKey.trim()) patch.bookingsApiKey = b.bookingsApiKey.trim().slice(0, 500);
      if (b.clearBookingsApiKey === true) patch.bookingsApiKey = '';
      if (b.resetBookingsCursor === true) patch.bookingsCursor = '';
      if (typeof b.ownerEmail === 'string' && b.ownerEmail.trim()) {
        const { rows } = await pool.query(`SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1`, [b.ownerEmail.trim()]);
        if (!rows[0]) return fail(res, 400, `No account with the email ${b.ownerEmail.trim()}`);
        patch.ownerUserId = rows[0].id;
      }
      if (b.ownerIsMe === true) patch.ownerUserId = admin.id ?? admin.userId;
      const cfg = await eventsEngine.saveConfig(patch as Partial<EventsConfig>);
      void recordAuditLog(admin.id ?? admin.userId, 'admin_sales_events_updated', [], { fields: Object.keys(patch).filter((k) => k !== 'bookingsApiKey') });
      return res.json(await configView(cfg));
    } catch (err: any) {
      logger.error({ err }, 'sales_events_config_save_failed');
      return fail(res, 500, err?.message || 'Save failed');
    }
  });

  router.post('/admin/sales-events/rotate-secret', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      await eventsEngine.rotateWebhookSecret();
      void recordAuditLog(admin.id ?? admin.userId, 'admin_sales_events_secret_rotated', [], {});
      return res.json(await configView(await eventsEngine.getConfig()));
    } catch (err) {
      logger.error({ err }, 'sales_events_rotate_failed');
      return fail(res, 500, 'Could not rotate the secret');
    }
  });

  router.post('/admin/sales-events/sync', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const summary = await eventsEngine.syncEvents('manual');
      return res.json({ success: summary.status !== 'failed', summary, error: summary.error });
    } catch (err: any) {
      logger.error({ err }, 'sales_events_sync_failed');
      return fail(res, 500, err?.message || 'Sync failed');
    }
  });

  router.post('/sales/events/:id/strategy/generate', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT data FROM sales_events WHERE id=$1`, [req.params.id]);
      if (!rows[0]) return fail(res, 404, 'Event not found');
      const strategy = await generateEventStrategy(admin.id ?? admin.userId, rows[0].data as SiteEvent);
      await eventsEngine.saveStrategy(String(req.params.id), strategy, 'ai');
      return res.json({ success: true, strategy });
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'sales_event_strategy_generate_failed');
      return fail(res, 502, err?.message || 'The AI could not write a strategy');
    }
  });

  router.put('/sales/events/:id/strategy', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT data, strategy FROM sales_events WHERE id=$1`, [req.params.id]);
      if (!rows[0]) return fail(res, 404, 'Event not found');
      const event = rows[0].data as SiteEvent;
      if (req.body?.reset === true) {
        await eventsEngine.saveStrategy(String(req.params.id), null, 'default');
        return res.json({ success: true, strategy: resolveStrategy(null, event) });
      }
      const current = resolveStrategy(rows[0].strategy, event);
      const input = (req.body?.strategy ?? {}) as Record<string, any>;
      const segments = Object.fromEntries(CALL_SEGMENTS.map((seg) => [seg, mergeSegmentStrategy(current.segments[seg], input.segments?.[seg])]));
      const strategy = {
        ...current,
        segments,
        angle: typeof input.angle === 'string' && input.angle.trim() ? input.angle.trim().slice(0, 600) : current.angle,
        source: 'edited' as const,
        generatedAt: new Date().toISOString(),
        fingerprint: eventFingerprint(event),
      };
      await eventsEngine.saveStrategy(String(req.params.id), strategy, 'edited');
      return res.json({ success: true, strategy: resolveStrategy(strategy, event) });
    } catch (err: any) {
      logger.error({ err }, 'sales_event_strategy_save_failed');
      return fail(res, 500, 'Could not save the strategy');
    }
  });

  // ─── Sales users ──────────────────────────────────────────────────────────

  router.get('/sales/events', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const [events, cfg, runs] = await Promise.all([
        eventsEngine.listEvents(auth.userId), eventsEngine.getConfig(), eventsEngine.listRuns(1),
      ]);
      return res.json({
        success: true,
        events,
        isOwner: cfg.ownerUserId === auth.userId,
        hasOwner: Boolean(cfg.ownerUserId),
        autoCall: cfg.autoCall,
        lastRun: runs[0] ?? null,
      });
    } catch (err) {
      logger.error({ err }, 'sales_events_list_failed');
      return fail(res, 500, 'Failed to load events');
    }
  });

  router.get('/sales/events/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const detail = await eventsEngine.getEventDetail(auth.userId, String(req.params.id));
      if (!detail) return fail(res, 404, 'Event not found');
      return res.json({ success: true, ...detail });
    } catch (err) {
      logger.error({ err }, 'sales_event_detail_failed');
      return fail(res, 500, 'Failed to load the event');
    }
  });

  router.post('/sales/events/:id/calls', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const segment = req.body?.segment;
    const bookingIds = Array.isArray(req.body?.bookingIds) ? req.body.bookingIds.map(String) : undefined;
    if (segment !== undefined && !isCallSegment(segment)) return fail(res, 400, 'Unknown segment');
    if (!segment && !bookingIds?.length) return fail(res, 400, 'Choose a group or some people to call');
    try {
      const result = await eventsEngine.queueEventCalls(auth.userId, String(req.params.id), { segment, bookingIds });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      logger.error({ err }, 'sales_event_calls_failed');
      return fail(res, 500, err?.message || 'Could not queue the calls');
    }
  });

  router.post('/sales/events/:id/link-list', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const listId = typeof req.body?.listId === 'string' ? req.body.listId : '';
    const status = req.body?.status as BookingStatus;
    if (!listId) return fail(res, 400, 'Choose a list');
    if (!(BOOKING_STATUSES as readonly string[]).includes(status)) return fail(res, 400, 'Choose what the people on the list did');
    try {
      const result = await eventsEngine.linkListToEvent(auth.userId, String(req.params.id), listId, status);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return fail(res, 400, err?.message || 'Could not link the list');
    }
  });

  // ─── Africon's backend ────────────────────────────────────────────────────

  router.post('/integrations/africon/bookings', async (req: Request, res: Response) => {
    try {
      const cfg = await eventsEngine.getConfig();
      if (!cfg.webhookSecret) return fail(res, 503, 'Bookings are not set up yet (Admin → Sales Events).');
      const raw = (req as any).rawBody as Buffer | undefined;
      const rawText = raw ? raw.toString('utf8') : JSON.stringify(req.body ?? {});
      if (!verifyBookingRequest(req.headers as Record<string, string | string[] | undefined>, rawText, cfg.webhookSecret)) {
        logger.warn('africon_bookings_signature_rejected');
        return fail(res, 401, 'Invalid signature');
      }
      const records = bookingList(req.body);
      if (!records.length) return fail(res, 400, 'No bookings in the body');
      const summary = await eventsEngine.ingestBookings(records, 'webhook');
      return res.json({ success: true, ...summary });
    } catch (err: any) {
      logger.error({ err }, 'africon_bookings_ingest_failed');
      return fail(res, 500, err?.message || 'Could not take the bookings');
    }
  });

  return router;
}
