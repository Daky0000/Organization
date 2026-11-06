import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; email?: string } | null;

type LeadsDeps = {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  frontendUrl: string;
  gsClientId: string;
  gsClientSecret: string;
  gsRedirect: string;
};

// In-memory OAuth state store for Google Sheets (keyed by state token, expires after 10min)
const gsOAuthState = new Map<string, { userId: string; expiry: number }>();

async function gsRefreshToken(pool: Pool, userId: string, clientId: string, clientSecret: string): Promise<string> {
  const { rows } = await pool.query(`SELECT * FROM google_sheets_tokens WHERE user_id=$1`, [userId]);
  if (!rows.length) throw new Error('Google Sheets not connected');
  const tok = rows[0];
  if (new Date(tok.token_expiry).getTime() - Date.now() > 60_000) return tok.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }).toString(),
  });
  const data = await r.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error('Token refresh failed: ' + (data.error || 'unknown'));
  const expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await pool.query(`UPDATE google_sheets_tokens SET access_token=$1, token_expiry=$2, updated_at=NOW() WHERE user_id=$3`, [data.access_token, expiry, userId]);
  return data.access_token;
}

export function registerLeadsRoutes({ requireAuth, pool, frontendUrl, gsClientId, gsClientSecret, gsRedirect }: LeadsDeps): Router {
  const router = express.Router();

  // POST /api/leads/parse-excel
  router.post('/parse-excel', express.raw({ type: ['application/octet-stream', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'], limit: '20mb' }), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const buf = req.body as Buffer;
      if (!buf || !buf.length) return res.status(400).json({ success: false, error: 'No file data received' });
      const { parseWorkbook }=await import('./leads/services/spreadsheet.ts');
      const filename=String(req.headers['x-file-name'] || (buf[0]===80 && buf[1]===75 ? 'upload.xlsx' : 'upload.csv'));
      const grids=await parseWorkbook(buf,filename);
      const sheets=grids.map(grid => {
        const fields=grid.rows[0] || [];
        if (fields.some(field => ['__proto__','prototype','constructor'].includes(field))) throw new Error('Invalid column name');
        const leads=grid.rows.slice(1).map(row => Object.fromEntries(fields.map((field,index) => [field,row[index] || ''])));
        return { name: grid.name,fields,leads };
      }).filter(sheet => sheet.leads.length);
      return res.json({ success: true, sheets });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Parse failed' }); }
  });

  // GET /api/leads/groups
  router.get('/groups', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT lg.*, (SELECT COUNT(*) FROM leads l WHERE l.group_id = lg.id)::int AS lead_count
         FROM lead_groups lg WHERE lg.user_id=$1 ORDER BY lg.created_at DESC`, [auth.userId]
      );
      return res.json({ success: true, groups: rows });
    } catch (err) { logger.error('Failed to fetch lead groups', err); return res.status(500).json({ success: false, error: 'Failed to fetch lead groups' }); }
  });

  // POST /api/leads/groups
  router.post('/groups', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'name required' });
      const { rows } = await pool.query(
        `INSERT INTO lead_groups (user_id, name) VALUES ($1,$2) RETURNING *`, [auth.userId, name]
      );
      return res.json({ success: true, group: rows[0] });
    } catch (err) { logger.error('Failed to create group', err); return res.status(500).json({ success: false, error: 'Failed to create group' }); }
  });

  // DELETE /api/leads/groups/:id
  router.delete('/groups/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query(`DELETE FROM lead_groups WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete group', err); return res.status(500).json({ success: false, error: 'Failed to delete group' }); }
  });

  // GET /api/leads/groups/:id/leads
  router.get('/groups/:id/leads', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: [grp] } = await pool.query(`SELECT * FROM lead_groups WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!grp) return res.status(404).json({ success: false, error: 'Not found' });
      const { rows } = await pool.query(`SELECT * FROM leads WHERE group_id=$1 ORDER BY created_at DESC`, [req.params.id]);
      return res.json({ success: true, group: grp, leads: rows });
    } catch (err) { logger.error('Failed to fetch leads', err); return res.status(500).json({ success: false, error: 'Failed to fetch leads' }); }
  });

  // POST /api/leads/groups/:id/leads — single lead
  router.post('/groups/:id/leads', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: [grp] } = await pool.query(`SELECT * FROM lead_groups WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!grp) return res.status(404).json({ success: false, error: 'Not found' });
      const { data } = req.body;
      if (!data || typeof data !== 'object') return res.status(400).json({ success: false, error: 'data object required' });
      const fields: string[] = Array.from(new Set([...(grp.fields || []), ...Object.keys(data)]));
      await pool.query(`UPDATE lead_groups SET fields=$1 WHERE id=$2`, [fields, req.params.id]);
      const { rows } = await pool.query(
        `INSERT INTO leads (group_id, user_id, data) VALUES ($1,$2,$3) RETURNING *`,
        [req.params.id, auth.userId, JSON.stringify(data)]
      );
      return res.json({ success: true, lead: rows[0] });
    } catch (err) { logger.error('Failed to add lead', err); return res.status(500).json({ success: false, error: 'Failed to add lead' }); }
  });

  // POST /api/leads/groups/:id/import — bulk CSV import
  router.post('/groups/:id/import', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: [grp] } = await pool.query(`SELECT * FROM lead_groups WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!grp) return res.status(404).json({ success: false, error: 'Not found' });
      const { leads } = req.body;
      if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ success: false, error: 'leads array required' });
      const allFields: string[] = Array.from(new Set([...(grp.fields || []), ...leads.flatMap((l: Record<string, unknown>) => Object.keys(l))]));
      await pool.query(`UPDATE lead_groups SET fields=$1 WHERE id=$2`, [allFields, req.params.id]);
      let imported = 0;
      for (const lead of leads.slice(0, 10000)) {
        await pool.query(`INSERT INTO leads (group_id, user_id, data) VALUES ($1,$2,$3)`, [req.params.id, auth.userId, JSON.stringify(lead)]);
        imported++;
      }
      return res.json({ success: true, imported });
    } catch (err) { logger.error('Import failed', err); return res.status(500).json({ success: false, error: 'Import failed' }); }
  });

  // POST /api/leads/groups/:id/sync — upsert by sync_key
  router.post('/groups/:id/sync', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: [grp] } = await pool.query(`SELECT * FROM lead_groups WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!grp) return res.status(404).json({ success: false, error: 'Not found' });
      const { leads, keyField } = req.body;
      if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ success: false, error: 'leads array required' });
      const allFields: string[] = Array.from(new Set([...(grp.fields || []), ...leads.flatMap((l: Record<string, unknown>) => Object.keys(l))]));
      await pool.query(`UPDATE lead_groups SET fields=$1 WHERE id=$2`, [allFields, req.params.id]);
      let updated = 0, added = 0;
      for (const lead of leads.slice(0, 10000)) {
        const syncKey = keyField && lead[keyField] ? String(lead[keyField]) : null;
        if (syncKey) {
          const { rows: existing } = await pool.query(`SELECT id FROM leads WHERE group_id=$1 AND sync_key=$2`, [req.params.id, syncKey]);
          if (existing.length) {
            await pool.query(`UPDATE leads SET data=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(lead), existing[0].id]);
            updated++; continue;
          }
        }
        await pool.query(`INSERT INTO leads (group_id, user_id, data, sync_key) VALUES ($1,$2,$3,$4)`, [req.params.id, auth.userId, JSON.stringify(lead), syncKey]);
        added++;
      }
      return res.json({ success: true, updated, added });
    } catch (err) { logger.error('Sync failed', err); return res.status(500).json({ success: false, error: 'Sync failed' }); }
  });

  // POST /api/leads/bulk-import — multi-sheet Excel import (creates groups)
  router.post('/bulk-import', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { sheets } = req.body;
      if (!Array.isArray(sheets) || !sheets.length) return res.status(400).json({ success: false, error: 'sheets array required' });
      const results: { groupId: string; name: string; imported: number }[] = [];
      for (const sheet of sheets.slice(0, 50)) {
        if (!sheet.name || !Array.isArray(sheet.leads)) continue;
        const { rows: [grp] } = await pool.query(
          `INSERT INTO lead_groups (user_id, name, fields) VALUES ($1,$2,$3) RETURNING *`,
          [auth.userId, sheet.name, sheet.fields || []]
        );
        let imported = 0;
        for (const lead of (sheet.leads as Record<string, string>[]).slice(0, 10000)) {
          await pool.query(`INSERT INTO leads (group_id, user_id, data) VALUES ($1,$2,$3)`, [grp.id, auth.userId, JSON.stringify(lead)]);
          imported++;
        }
        results.push({ groupId: grp.id, name: grp.name, imported });
      }
      return res.json({ success: true, results });
    } catch (err) { logger.error('Bulk import failed', err); return res.status(500).json({ success: false, error: 'Bulk import failed' }); }
  });

  // DELETE /api/leads/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query(`DELETE FROM leads WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete lead', err); return res.status(500).json({ success: false, error: 'Failed to delete lead' }); }
  });

  // ─── Google Sheets Integration ────────────────────────────────────────────────

  // GET /api/leads/google-sheets/connect
  router.get('/google-sheets/connect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      if (!gsClientId || !gsClientSecret) return res.status(500).json({ success: false, error: 'Google Sheets OAuth not configured. Set GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET.' });
      const state = randomBytes(20).toString('hex');
      gsOAuthState.set(state, { userId: auth.userId, expiry: Date.now() + 600_000 });
      const params = new URLSearchParams({
        client_id: gsClientId,
        redirect_uri: gsRedirect,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly email profile',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return res.json({ success: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    } catch (err) { logger.error('Failed to initiate OAuth', err); return res.status(500).json({ success: false, error: 'Failed to initiate OAuth' }); }
  });

  // GET /api/leads/google-sheets/callback
  router.get('/google-sheets/callback', async (req: Request, res: Response) => {
    const popupHtml = (type: 'success' | 'error', payload: string) => `<!DOCTYPE html><html><head><title>Google Sheets</title></head><body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'gs_${type}', payload: ${JSON.stringify(payload)} }, '*');
      window.close();
    } else {
      window.location.href = '${frontendUrl}';
    }
  } catch(e) { window.close(); }
</script>
<p style="font-family:sans-serif;text-align:center;padding:40px;color:#666">${type === 'success' ? '✓ Connected! Closing…' : '✗ ' + payload}</p>
</body></html>`;

    try {
      const { code, state, error } = req.query as Record<string, string>;
      if (error) return res.send(popupHtml('error', error));
      const stored = gsOAuthState.get(state);
      if (!stored || stored.expiry < Date.now()) return res.send(popupHtml('error', 'Invalid or expired session. Please try again.'));
      gsOAuthState.delete(state);
      const tokRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: gsClientId, client_secret: gsClientSecret, redirect_uri: gsRedirect, grant_type: 'authorization_code' }).toString(),
      });
      const tok = await tokRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
      if (!tok.access_token || !tok.refresh_token) return res.send(popupHtml('error', tok.error || 'Authorization failed'));
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const info = await infoRes.json() as { email?: string };
      const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
      await pool.query(
        `INSERT INTO google_sheets_tokens (user_id, access_token, refresh_token, token_expiry, google_email)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO UPDATE SET access_token=$2, refresh_token=$3, token_expiry=$4, google_email=$5, updated_at=NOW()`,
        [stored.userId, tok.access_token, tok.refresh_token, expiry, info.email || null]
      );
      return res.send(popupHtml('success', info.email || 'connected'));
    } catch (_err) { return res.send(popupHtml('error', 'Server error. Please try again.')); }
  });

  // GET /api/leads/google-sheets/status
  router.get('/google-sheets/status', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(`SELECT google_email, updated_at FROM google_sheets_tokens WHERE user_id=$1`, [auth.userId]);
      if (!rows.length) return res.json({ success: true, connected: false });
      return res.json({ success: true, connected: true, email: rows[0].google_email, connectedAt: rows[0].updated_at });
    } catch (err) { logger.error('Failed', err); return res.status(500).json({ success: false, error: 'Failed' }); }
  });

  // DELETE /api/leads/google-sheets/disconnect
  router.delete('/google-sheets/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query(`DELETE FROM google_sheets_tokens WHERE user_id=$1`, [auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed', err); return res.status(500).json({ success: false, error: 'Failed' }); }
  });

  // GET /api/leads/google-sheets/files
  router.get('/google-sheets/files', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const token = await gsRefreshToken(pool, auth.userId, gsClientId, gsClientSecret);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc&pageSize=50`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { files?: { id: string; name: string; modifiedTime: string }[] };
      return res.json({ success: true, files: data.files || [] });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Failed' }); }
  });

  // GET /api/leads/google-sheets/files/:fileId/sheets
  router.get('/google-sheets/files/:fileId/sheets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const token = await gsRefreshToken(pool, auth.userId, gsClientId, gsClientSecret);
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${req.params.fileId}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { sheets?: { properties: { sheetId: number; title: string } }[] };
      return res.json({ success: true, sheets: (data.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title })) });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Failed' }); }
  });

  // POST /api/leads/groups/:id/link-sheet
  router.post('/groups/:id/link-sheet', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { sheetId, sheetTab, sheetName, keyField } = req.body;
      if (!sheetId || !sheetTab) return res.status(400).json({ success: false, error: 'sheetId and sheetTab required' });
      await pool.query(
        `UPDATE lead_groups SET linked_sheet_id=$1, linked_sheet_tab=$2, linked_sheet_name=$3, sheet_key_field=$4 WHERE id=$5 AND user_id=$6`,
        [sheetId, sheetTab, sheetName || sheetTab, keyField || null, req.params.id, auth.userId]
      );
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to link sheet', err); return res.status(500).json({ success: false, error: 'Failed to link sheet' }); }
  });

  // POST /api/leads/groups/:id/sync-sheet
  router.post('/groups/:id/sync-sheet', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: [grp] } = await pool.query(`SELECT * FROM lead_groups WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!grp) return res.status(404).json({ success: false, error: 'Group not found' });
      if (!grp.linked_sheet_id || !grp.linked_sheet_tab) return res.status(400).json({ success: false, error: 'No Google Sheet linked to this group' });
      const token = await gsRefreshToken(pool, auth.userId, gsClientId, gsClientSecret);
      const range = encodeURIComponent(grp.linked_sheet_tab);
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${grp.linked_sheet_id}/values/${range}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { values?: string[][]; error?: { message: string } };
      if (data.error) return res.status(400).json({ success: false, error: data.error.message });
      if (!data.values || data.values.length < 2) return res.json({ success: true, updated: 0, added: 0 });
      const headers = data.values[0].map(h => String(h).trim());
      const rows: Record<string, string>[] = data.values.slice(1).map(row =>
        Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '')]))
      ).filter(r => Object.values(r).some(v => v));
      const allFields: string[] = Array.from(new Set([...(grp.fields || []), ...headers]));
      await pool.query(`UPDATE lead_groups SET fields=$1 WHERE id=$2`, [allFields, req.params.id]);
      const keyField = grp.sheet_key_field || req.body.keyField || null;
      let updated = 0, added = 0;
      for (const row of rows.slice(0, 50000)) {
        const syncKey = keyField && row[keyField] ? String(row[keyField]) : null;
        if (syncKey) {
          const { rows: ex } = await pool.query(`SELECT id FROM leads WHERE group_id=$1 AND sync_key=$2`, [req.params.id, syncKey]);
          if (ex.length) { await pool.query(`UPDATE leads SET data=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(row), ex[0].id]); updated++; continue; }
        }
        await pool.query(`INSERT INTO leads (group_id, user_id, data, sync_key) VALUES ($1,$2,$3,$4)`, [req.params.id, auth.userId, JSON.stringify(row), syncKey]);
        added++;
      }
      await pool.query(`UPDATE lead_groups SET last_synced_at=NOW() WHERE id=$1`, [req.params.id]);
      return res.json({ success: true, updated, added, total: rows.length });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Sync failed' }); }
  });

  return router;
}

// Separate router for /api/google-sheets/* (legacy URL prefix)
export function registerGoogleSheetsRoutes({ requireAuth, pool, frontendUrl, gsClientId, gsClientSecret, gsRedirect }: LeadsDeps): Router {
  const router = express.Router();

  router.get('/connect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      if (!gsClientId || !gsClientSecret) return res.status(500).json({ success: false, error: 'Google Sheets OAuth not configured. Set GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET.' });
      const state = randomBytes(20).toString('hex');
      gsOAuthState.set(state, { userId: auth.userId, expiry: Date.now() + 600_000 });
      const params = new URLSearchParams({
        client_id: gsClientId,
        redirect_uri: gsRedirect,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly email profile',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return res.json({ success: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    } catch (err) { logger.error('Failed to initiate OAuth', err); return res.status(500).json({ success: false, error: 'Failed to initiate OAuth' }); }
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const popupHtml = (type: 'success' | 'error', payload: string) => `<!DOCTYPE html><html><head><title>Google Sheets</title></head><body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'gs_${type}', payload: ${JSON.stringify(payload)} }, '*');
      window.close();
    } else {
      window.location.href = '${frontendUrl}';
    }
  } catch(e) { window.close(); }
</script>
<p style="font-family:sans-serif;text-align:center;padding:40px;color:#666">${type === 'success' ? '✓ Connected! Closing…' : '✗ ' + payload}</p>
</body></html>`;

    try {
      const { code, state, error } = req.query as Record<string, string>;
      if (error) return res.send(popupHtml('error', error));
      const stored = gsOAuthState.get(state);
      if (!stored || stored.expiry < Date.now()) return res.send(popupHtml('error', 'Invalid or expired session. Please try again.'));
      gsOAuthState.delete(state);
      const tokRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: gsClientId, client_secret: gsClientSecret, redirect_uri: gsRedirect, grant_type: 'authorization_code' }).toString(),
      });
      const tok = await tokRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
      if (!tok.access_token || !tok.refresh_token) return res.send(popupHtml('error', tok.error || 'Authorization failed'));
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const info = await infoRes.json() as { email?: string };
      const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
      await pool.query(
        `INSERT INTO google_sheets_tokens (user_id, access_token, refresh_token, token_expiry, google_email)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO UPDATE SET access_token=$2, refresh_token=$3, token_expiry=$4, google_email=$5, updated_at=NOW()`,
        [stored.userId, tok.access_token, tok.refresh_token, expiry, info.email || null]
      );
      return res.send(popupHtml('success', info.email || 'connected'));
    } catch (_err) { return res.send(popupHtml('error', 'Server error. Please try again.')); }
  });

  router.get('/status', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(`SELECT google_email, updated_at FROM google_sheets_tokens WHERE user_id=$1`, [auth.userId]);
      if (!rows.length) return res.json({ success: true, connected: false });
      return res.json({ success: true, connected: true, email: rows[0].google_email, connectedAt: rows[0].updated_at });
    } catch (err) { logger.error('Failed', err); return res.status(500).json({ success: false, error: 'Failed' }); }
  });

  router.delete('/disconnect', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query(`DELETE FROM google_sheets_tokens WHERE user_id=$1`, [auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed', err); return res.status(500).json({ success: false, error: 'Failed' }); }
  });

  router.get('/files', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const token = await gsRefreshToken(pool, auth.userId, gsClientId, gsClientSecret);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc&pageSize=50`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { files?: { id: string; name: string; modifiedTime: string }[] };
      return res.json({ success: true, files: data.files || [] });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Failed' }); }
  });

  router.get('/files/:fileId/sheets', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const token = await gsRefreshToken(pool, auth.userId, gsClientId, gsClientSecret);
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${req.params.fileId}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { sheets?: { properties: { sheetId: number; title: string } }[] };
      return res.json({ success: true, sheets: (data.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title })) });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Failed' }); }
  });

  return router;
}
