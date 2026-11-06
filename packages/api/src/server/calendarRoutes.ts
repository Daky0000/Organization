import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { randomBytes, randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { resolveBackendRedirectUri } from '../platform-helpers.ts';
import { GOOGLE_HTTP_TIMEOUT_MS, isDeadGrantFlag, markGoogleGrantRevoked, refreshGoogleAccessToken, revokeGoogleToken } from '../google-oauth.ts';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

// OAuth state is stored in the DB (oauth_states table) so it survives server restarts and multi-instance deployments.

interface CalendarDeps {
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  pool: Pool;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  encryptIntegrationSecret: (plain: string) => string;
  decryptIntegrationSecret: (enc: string) => string;
  frontendUrl: string;
}

export function registerCalendarRoutes(deps: CalendarDeps): Router {
  const router = express.Router();
  const { requireAuth, pool, getPlatformConfig, encryptIntegrationSecret, decryptIntegrationSecret, frontendUrl } = deps;
  const FRONTEND = frontendUrl.replace(/\/$/, '');

  async function getCalendarCredentials(): Promise<Record<string, string>> {
    const calCfg = await getPlatformConfig('google_calendar').catch(() => ({} as Record<string, string>));
    if (calCfg.clientId && calCfg.clientSecret) return calCfg;
    // Fallback to Gmail credentials (same Google app, different scope)
    return getPlatformConfig('gmail').catch(() => ({} as Record<string, string>));
  }

  // The default callback lives on this API; behind a proxy the request's own
  // protocol/host can differ from what Google was given.
  const defaultRedirectUri = (req: Request) => resolveBackendRedirectUri('/api/calendar/google/callback', req);

  // 409, not 401: the app treats any 401 as an expired login and signs the
  // user out, but here only the Calendar connection needs attention.
  const notConnected = (res: Response, error = 'Google Calendar is not connected or its access has expired. Reconnect it to continue.') =>
    void res.status(409).json({ error, notConnected: true });

  async function getValidToken(userId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at, needs_reapproval, token_data->>'reason' AS reason
       FROM social_accounts WHERE user_id=$1 AND platform='google_calendar' AND connected=true LIMIT 1`,
      [userId]
    );
    if (!rows.length) return null;
    const row = rows[0] as any;
    if (isDeadGrantFlag(row.needs_reapproval, row.reason)) return null;

    const decrypt = (enc: string | null) => {
      try { return enc ? decryptIntegrationSecret(enc) : null; } catch { return null; }
    };
    const accessToken = decrypt(row.access_token_encrypted);
    const refreshToken = decrypt(row.refresh_token_encrypted);
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null;

    if (!accessToken) return null;

    // Refresh if expiring within 5 minutes
    const needsRefresh = !expiresAt || expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
    if (!needsRefresh || !refreshToken) return accessToken;

    const cfg = await getCalendarCredentials();
    const refreshed = await refreshGoogleAccessToken(refreshToken, String(cfg.clientId || ''), String(cfg.clientSecret || ''));
    if (!refreshed.ok) {
      if (refreshed.revoked) {
        await markGoogleGrantRevoked((sql, params) => pool.query(sql, params as any[]), userId, 'google_calendar');
        return null;
      }
      logger.warn({ userId, error: refreshed.error }, 'calendar_token_refresh_failed');
      return accessToken;
    }
    await pool.query(
      `UPDATE social_accounts
       SET access_token_encrypted=$1, token_expires_at=$2, needs_reapproval=false,
           token_data = COALESCE(token_data, '{}'::jsonb) - 'reason' - 'needs_reapproval_at'
       WHERE user_id=$3 AND platform='google_calendar'`,
      [encryptIntegrationSecret(refreshed.accessToken), refreshed.expiresAt, userId]
    );
    return refreshed.accessToken;
  }

  // ── GET /api/calendar/google/status ──────────────────────────────────────────
  router.get('/google/status', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT needs_reapproval, token_data->>'reason' AS reason FROM social_accounts
       WHERE user_id=$1 AND platform='google_calendar' AND connected=true LIMIT 1`,
      [auth.userId]
    );
    const row = rows[0] as any;
    // A revoked grant reads as disconnected so the UI offers to connect again.
    const reconnectRequired = Boolean(row) && isDeadGrantFlag(row.needs_reapproval, row.reason);
    res.json({ connected: Boolean(row) && !reconnectRequired, reconnectRequired });
  });

  // ── POST /api/calendar/google/connect-url ─────────────────────────────────────
  router.post('/google/connect-url', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const cfg = await getCalendarCredentials();
      if (!cfg.clientId || !cfg.clientSecret) {
        return void res.status(400).json({ error: 'Google Calendar not configured. Ask your admin to set up Google OAuth credentials.' });
      }

      const state = randomBytes(16).toString('hex');
      const redirectUri = cfg.calendarRedirectUri || defaultRedirectUri(req);

      // Persist state in DB so it survives server restarts / multi-instance deployments
      await pool.query(
        `INSERT INTO oauth_states (state, user_id, platform, return_to, expires_at)
         VALUES ($1, $2, 'google_calendar', $3, NOW() + INTERVAL '15 minutes')
         ON CONFLICT (state) DO NOTHING`,
        [state, auth.userId, redirectUri]
      );

      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: CALENDAR_SCOPE,
        state,
        access_type: 'offline',
        prompt: 'consent',
      });

      res.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to generate auth URL' });
    }
  });

  // ── GET /api/calendar/google/callback ─────────────────────────────────────────
  const popupPage = (type: 'success' | 'error', detail = '') => {
    const safeDetail = detail.replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c] ?? c));
    const msg = type === 'success'
      ? { type: 'calendar_connected' }
      : { type: 'calendar_error', error: safeDetail };
    const msgJson = JSON.stringify(msg);
    const bodyText = type === 'success'
      ? 'Google Calendar connected! You can close this window.'
      : `Failed to connect Google Calendar: ${safeDetail}. You can close this window.`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${type === 'success' ? 'Connected' : 'Error'}</title></head><body>
<p style="font-family:sans-serif;padding:24px">${bodyText}</p>
<script>
try { if(window.opener) window.opener.postMessage(${msgJson},'${FRONTEND}'); } catch(e){}
window.close();
setTimeout(function(){ window.location.href='${FRONTEND}'; },1500);
</script></body></html>`;
  };

  router.get('/google/callback', async (req: Request, res: Response) => {
    const send = (type: 'success' | 'error', detail = '') =>
      res.setHeader('Content-Type', 'text/html').send(popupPage(type, detail));

    try {
      const { code, state, error: oauthError } = req.query as Record<string, string>;
      if (oauthError) return void send('error', oauthError);
      if (!code || !state) return void send('error', 'missing_params');

      // Look up and consume state from DB
      const { rows: stateRows } = await pool.query(
        `DELETE FROM oauth_states WHERE state=$1 AND platform='google_calendar' AND expires_at > NOW() RETURNING user_id, return_to`,
        [state]
      );
      if (!stateRows.length) return void send('error', 'invalid_state — please try connecting again');
      const { user_id: userId, return_to: storedRedirectUri } = stateRows[0] as { user_id: string; return_to: string };

      // Reconstruct redirectUri: use what was stored, or fall back to the same derivation as connect-url
      const cfg = await getCalendarCredentials();
      const redirectUri = storedRedirectUri || cfg.calendarRedirectUri || defaultRedirectUri(req);

      const tokenResp = await axios.post(
        GOOGLE_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: GOOGLE_HTTP_TIMEOUT_MS }
      );

      if (tokenResp.status >= 400) {
        const errMsg = (tokenResp.data as any)?.error_description || (tokenResp.data as any)?.error || 'token_exchange_failed';
        logger.error('[calendarRoutes] token exchange failed:', tokenResp.data);
        return void send('error', String(errMsg));
      }

      const { access_token, refresh_token, expires_in } = tokenResp.data as any;
      if (!access_token) return void send('error', 'no_token');

      const ttl = Number(expires_in || 3600);
      const expiry = new Date(Date.now() + ttl * 1000).toISOString();

      const encAccess = encryptIntegrationSecret(access_token);
      const encRefresh = refresh_token ? encryptIntegrationSecret(refresh_token) : null;

      // Upsert using unique index on (user_id, platform) WHERE account_type='profile'
      await pool.query(
        `INSERT INTO social_accounts (id, user_id, platform, account_type, access_token_encrypted, refresh_token_encrypted, token_expires_at, connected)
         VALUES ($1, $2, 'google_calendar', 'profile', $3, $4, $5, true)
         ON CONFLICT (user_id, platform) WHERE account_type = 'profile'
         DO UPDATE SET
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           token_expires_at = EXCLUDED.token_expires_at,
           connected = true,
           needs_reapproval = false,
           token_data = COALESCE(social_accounts.token_data, '{}'::jsonb) - 'reason' - 'needs_reapproval_at'
           ${encRefresh ? ", refresh_token_encrypted = EXCLUDED.refresh_token_encrypted" : ""}`,
        [randomUUID(), userId, encAccess, encRefresh, expiry]
      );

      send('success');
    } catch (e: any) {
      logger.error('[calendarRoutes] callback error:', e);
      send('error', String(e?.message || 'server_error'));
    }
  });

  // ── DELETE /api/calendar/google/disconnect ────────────────────────────────────
  router.delete('/google/disconnect', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    // Revoke the grant at Google too, then drop the stored credentials.
    const { rows } = await pool.query(
      `SELECT access_token_encrypted, refresh_token_encrypted FROM social_accounts WHERE user_id=$1 AND platform='google_calendar'`,
      [auth.userId]
    );
    const decrypt = (enc: string | null) => { try { return enc ? decryptIntegrationSecret(enc) : ''; } catch { return ''; } };
    const token = rows[0] ? decrypt((rows[0] as any).refresh_token_encrypted) || decrypt((rows[0] as any).access_token_encrypted) : '';
    const revoked = await revokeGoogleToken(token);
    await pool.query(
      `UPDATE social_accounts
       SET connected=false, access_token=NULL, refresh_token=NULL, access_token_encrypted=NULL, refresh_token_encrypted=NULL
       WHERE user_id=$1 AND platform='google_calendar'`,
      [auth.userId]
    );
    res.json({ ok: true, providerRevoked: revoked });
  });

  // ── GET /api/calendar/events?start=ISO&end=ISO ────────────────────────────────
  router.get('/events', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const token = await getValidToken(auth.userId);
    if (!token) return notConnected(res);

    const { start, end } = req.query as { start?: string; end?: string };
    const now = new Date();
    const timeMin = start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = end || new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

    try {
      const resp = await axios.get(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 200 },
        validateStatus: () => true,
        timeout: GOOGLE_HTTP_TIMEOUT_MS,
      });
      if (resp.status === 401) return notConnected(res);
      if (resp.status >= 400) return void res.status(500).json({ error: 'Google Calendar API error' });
      res.json({ events: (resp.data as any).items ?? [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/calendar/events — create Google Calendar event ──────────────────
  router.post('/events', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const token = await getValidToken(auth.userId);
    if (!token) return notConnected(res);

    const { summary, description, start, end, attendees, recurrence, reminders } = req.body;
    if (!summary?.trim()) return void res.status(400).json({ error: 'summary required' });
    if (!start?.dateTime) return void res.status(400).json({ error: 'start.dateTime required' });

    const eventBody: Record<string, any> = {
      summary: summary.trim(),
      description: description || '',
      start: { dateTime: start.dateTime, timeZone: start.timeZone || 'UTC' },
      end: { dateTime: end?.dateTime || start.dateTime, timeZone: end?.timeZone || 'UTC' },
    };

    if (Array.isArray(attendees) && attendees.length > 0) {
      eventBody.attendees = attendees.map((a: any) => ({ email: a.email, displayName: a.name || a.email }));
    }

    if (Array.isArray(recurrence) && recurrence.length > 0) {
      eventBody.recurrence = recurrence;
    }

    if (reminders) {
      eventBody.reminders = reminders;
    }

    try {
      const resp = await axios.post(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, eventBody, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: GOOGLE_HTTP_TIMEOUT_MS,
      });
      if (resp.status === 401) return notConnected(res);
      if (resp.status >= 400) {
        logger.error('[calendarRoutes] create event failed:', resp.data);
        return void res.status(resp.status).json({ error: 'Failed to create Google Calendar event', details: resp.data });
      }
      res.status(201).json({ event: resp.data });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/calendar/holidays?countryCode=GH&year=2026 ──────────────────────
  router.get('/holidays', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const cc = String(req.query.countryCode || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    const yr = parseInt(String(req.query.year || new Date().getFullYear()), 10);
    try {
      const resp = await axios.get(`https://date.nager.at/api/v3/publicholidays/${yr}/${cc}`, {
        timeout: 6000, validateStatus: () => true,
      });
      if (resp.status >= 400) return void res.json({ holidays: [], countryCode: cc });
      res.json({ holidays: (resp.data as any[]) || [], countryCode: cc });
    } catch {
      res.json({ holidays: [], countryCode: cc });
    }
  });

  // ── DELETE /api/calendar/events/:id ──────────────────────────────────────────
  router.delete('/events/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const token = await getValidToken(auth.userId);
    if (!token) return notConnected(res);

    try {
      const resp = await axios.delete(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(String(req.params.id || ''))}`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
        timeout: GOOGLE_HTTP_TIMEOUT_MS,
      });
      if (resp.status === 401) return notConnected(res);
      // Already gone counts as deleted.
      if (resp.status >= 400 && resp.status !== 404 && resp.status !== 410) {
        return void res.status(502).json({ error: 'Google Calendar could not delete the event' });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(502).json({ error: e?.message || 'Google Calendar could not delete the event' });
    }
  });

  return router;
}
