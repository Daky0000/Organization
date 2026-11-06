import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { publicApiLimiter } from '../middleware/rateLimiter.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Website visitor tracking (page_view trigger).
//
// Customers drop one script tag on their site:
//   <script async src="https://<app>/t.js?u=<user_id>"></script>
//
// The snippet stores the visitor→contact link (cf_cid, appended to short-link
// redirects by /r/:code?c=<contact_id>) in localStorage, then reports every
// page view through GET /px.gif. Known-contact views are recorded in
// page_view_events and fire the `page_view` automation trigger.
//
// Mounted BEFORE cors/helmet in server.ts on purpose: the script and pixel are
// loaded cross-origin from customers' sites and helmet's
// Cross-Origin-Resource-Policy would block them.
// ─────────────────────────────────────────────────────────────────────────────

const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Verified tracking user ids, cached so pixel traffic doesn't hammer the DB.
const knownUsers = new Map<string, number>();
const KNOWN_USER_TTL_MS = 10 * 60 * 1000;

// Per-contact trigger debounce: a browsing session shouldn't fire the
// page_view automation on every single page. One fire per contact per hour.
const recentTriggerFires = new Map<string, number>();
const TRIGGER_DEBOUNCE_MS = 60 * 60 * 1000;

function sweep(map: Map<string, number>, ttl: number) {
  if (map.size < 5000) return;
  const cutoff = Date.now() - ttl;
  for (const [k, t] of map) if (t < cutoff) map.delete(k);
}

export function registerSiteTrackingRoutes({ pool, appUrl, fireAutomationTrigger }: {
  pool: Pool | null;
  appUrl: string;
  fireAutomationTrigger?: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}): Router {
  const router = express.Router();

  async function isKnownUser(userId: string): Promise<boolean> {
    if (!pool || !userId || userId.length > 64) return false;
    const cachedAt = knownUsers.get(userId);
    if (cachedAt && Date.now() - cachedAt < KNOWN_USER_TTL_MS) return true;
    const { rows } = await pool.query('SELECT 1 FROM users WHERE id=$1 LIMIT 1', [userId]);
    if (!rows[0]) return false;
    sweep(knownUsers, KNOWN_USER_TTL_MS);
    knownUsers.set(userId, Date.now());
    return true;
  }

  // GET /t.js?u=<user_id> — the embeddable tracking snippet.
  router.get('/t.js', async (req: Request, res: Response) => {
    const userId = String(req.query.u || '').trim();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!(await isKnownUser(userId).catch(() => false))) return res.send('/* ContentFlow: unknown site id */');
    const base = appUrl.replace(/\/+$/, '');
    return res.send(`(function(){try{
var q=new URLSearchParams(location.search),cid=q.get('cf_cid');
if(cid){try{localStorage.setItem('cf_cid',cid)}catch(e){}}
try{cid=cid||localStorage.getItem('cf_cid')||''}catch(e){cid=cid||''}
new Image(1,1).src=${JSON.stringify(base)}+'/px.gif?u='+encodeURIComponent(${JSON.stringify(userId)})+'&c='+encodeURIComponent(cid)+'&url='+encodeURIComponent(location.href.slice(0,500))+'&r='+encodeURIComponent((document.referrer||'').slice(0,300))+'&t='+Date.now();
}catch(e){}})();`);
  });

  // GET /px.gif — records the page view; always answers with the pixel.
  // Rate-limited per IP so a hostile loop can't flood page_view_events.
  router.get('/px.gif', publicApiLimiter, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, private');
    res.send(GIF_1PX);
    // Everything below is fire-and-forget — the pixel already responded.
    try {
      const userId = String(req.query.u || '').trim();
      if (!pool || !(await isKnownUser(userId))) return;
      const url = String(req.query.url || '').slice(0, 500) || null;
      const referrer = String(req.query.r || '').slice(0, 300) || null;
      let contactId: string | null = String(req.query.c || '').trim().slice(0, 64) || null;
      if (contactId) {
        const owned = await pool.query('SELECT 1 FROM mailing_contacts WHERE id=$1 AND user_id=$2 LIMIT 1', [contactId, userId]);
        if (!owned.rows[0]) contactId = null;
      }
      await pool.query(
        `INSERT INTO page_view_events (user_id, contact_id, url, referrer) VALUES ($1,$2,$3,$4)`,
        [userId, contactId, url, referrer]
      );
      if (contactId && fireAutomationTrigger) {
        const key = `${userId}:${contactId}`;
        const last = recentTriggerFires.get(key);
        if (!last || Date.now() - last > TRIGGER_DEBOUNCE_MS) {
          sweep(recentTriggerFires, TRIGGER_DEBOUNCE_MS);
          recentTriggerFires.set(key, Date.now());
          void fireAutomationTrigger(userId, 'page_view', { id: contactId }).catch(() => undefined);
        }
      }
    } catch (err) {
      logger.error({ err }, 'page_view_pixel_failed');
    }
  });

  return router;
}
