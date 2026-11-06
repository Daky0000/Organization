import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { recalcLeadScore } from './leadScoring.ts';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

export function registerCRMActivitiesRoutes({ requireAuth, pool }: Deps): Router {
  const router = express.Router();

  // ── List activities (filterable by contact/deal/company) ───────────────────
  router.get('/activities', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { contact_id, deal_id, company_id, type, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['a.user_id=$1'];
    if (contact_id) { params.push(contact_id); wheres.push(`a.contact_id=$${params.length}`); }
    if (deal_id) { params.push(deal_id); wheres.push(`a.deal_id=$${params.length}`); }
    if (company_id) { params.push(company_id); wheres.push(`a.company_id=$${params.length}`); }
    if (type) { params.push(type); wheres.push(`a.type=$${params.length}`); }
    const { rows } = await pool.query(
      `SELECT a.*,
        mc.email AS contact_email, mc.first_name AS contact_first_name, mc.last_name AS contact_last_name,
        d.title AS deal_title,
        cc.name AS company_name,
        u.full_name AS author_name
       FROM crm_activities a
       LEFT JOIN mailing_contacts mc ON mc.id=a.contact_id
       LEFT JOIN crm_deals d ON d.id=a.deal_id
       LEFT JOIN crm_companies cc ON cc.id=a.company_id
       LEFT JOIN users u ON u.id=a.user_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  });

  // ── Create activity ────────────────────────────────────────────────────────
  router.post('/activities', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const {
      type, title, body, outcome, duration, scheduled_at, completed_at,
      contact_id, deal_id, company_id,
      // meeting-specific
      end_time, recurrence, attendees, reminder_minutes, google_event_id,
    } = req.body;
    const VALID_TYPES = ['note','call','email','meeting','task','whatsapp','sms'];
    if (!type || !VALID_TYPES.includes(type)) return void res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_activities
         (id,user_id,type,title,body,outcome,duration,scheduled_at,completed_at,contact_id,deal_id,company_id,
          end_time,recurrence,attendees,reminder_minutes,google_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        id, auth.userId, type, title||null, body||null, outcome||null, duration||null,
        scheduled_at||null, completed_at||null, contact_id||null, deal_id||null, company_id||null,
        end_time||null, recurrence||null,
        attendees ? JSON.stringify(attendees) : null,
        reminder_minutes && Array.isArray(reminder_minutes) && reminder_minutes.length > 0 ? reminder_minutes : null,
        google_event_id||null,
      ]
    );

    // Create in-app reminder notifications for each reminder
    if (type === 'meeting' && scheduled_at && Array.isArray(reminder_minutes) && reminder_minutes.length > 0) {
      const meetingTime = new Date(scheduled_at);
      for (const mins of reminder_minutes) {
        const reminderMsg = `Meeting "${title || 'Untitled'}" starts ${mins < 60 ? `in ${mins} min` : `in ${Math.round(mins/60)} hour(s)`} at ${meetingTime.toLocaleString()}`;
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'meeting_reminder','Meeting Reminder',$2,$3)`,
          [auth.userId, reminderMsg, JSON.stringify({ activity_id: id, scheduled_at, reminder_minutes: mins })]
        ).catch(() => undefined);
      }
    }

    res.status(201).json(rows[0]);
  });

  // ── Update activity ────────────────────────────────────────────────────────
  router.patch('/activities/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const fields = ['title','body','outcome','duration','scheduled_at','completed_at','end_time','recurrence','google_event_id'];
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    for (const f of fields) {
      if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (req.body.attendees !== undefined) { params.push(req.body.attendees ? JSON.stringify(req.body.attendees) : null); sets.push(`attendees=$${params.length}`); }
    if (req.body.reminder_minutes !== undefined) { params.push(req.body.reminder_minutes); sets.push(`reminder_minutes=$${params.length}`); }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(`UPDATE crm_activities SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });

    // Notify commenters (excluding the editor)
    if (rows[0].type === 'note') {
      const preview = (rows[0].body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      const { rows: commenters } = await pool.query(
        `SELECT DISTINCT user_id FROM crm_note_comments WHERE note_id=$1 AND user_id != $2`,
        [req.params.id, auth.userId]
      ).catch(() => ({ rows: [] }));
      for (const { user_id } of commenters) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'note_edited','Note updated',$2,$3)`,
          [user_id, `A note you commented on was updated${preview ? `: "${preview}"` : '.'}`, JSON.stringify({ note_id: req.params.id })]
        ).catch(() => undefined);
      }
    }

    res.json(rows[0]);
  });

  // ── Delete activity ────────────────────────────────────────────────────────
  router.delete('/activities/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;

    // Gather commenters + note preview BEFORE the cascade delete wipes crm_note_comments
    const { rows: noteRows } = await pool.query(
      `SELECT type, body FROM crm_activities WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]
    ).catch(() => ({ rows: [] }));
    const isNote = noteRows[0]?.type === 'note';
    const { rows: commenters } = isNote
      ? await pool.query(
          `SELECT DISTINCT user_id FROM crm_note_comments WHERE note_id=$1 AND user_id != $2`,
          [req.params.id, auth.userId]
        ).catch(() => ({ rows: [] }))
      : { rows: [] };

    await pool.query(`DELETE FROM crm_activities WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);

    if (isNote) {
      const preview = (noteRows[0].body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      for (const { user_id } of commenters) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'note_deleted','Note deleted',$2,$3)`,
          [user_id, `A note you commented on was deleted${preview ? `: "${preview}"` : '.'}`, JSON.stringify({})]
        ).catch(() => undefined);
      }
    }

    res.json({ ok: true });
  });

  // ── Note comments ──────────────────────────────────────────────────────────
  router.get('/activities/:id/comments', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT nc.*, u.full_name AS author_name
       FROM crm_note_comments nc
       LEFT JOIN users u ON u.id = nc.user_id
       WHERE nc.note_id = $1
       ORDER BY nc.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  });

  router.post('/activities/:id/comments', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { body } = req.body;
    if (!body?.trim()) return void res.status(400).json({ error: 'body required' });
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_note_comments (id, note_id, user_id, body) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, req.params.id, auth.userId, body.trim()]
    );
    const { rows: u } = await pool.query(`SELECT full_name FROM users WHERE id=$1`, [auth.userId]);
    res.status(201).json({ ...rows[0], author_name: u[0]?.full_name ?? null });
  });

  router.delete('/activities/:id/comments/:commentId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_note_comments WHERE id=$1 AND user_id=$2`, [req.params.commentId, auth.userId]);
    res.json({ ok: true });
  });

  // ── Lead scoring rules ─────────────────────────────────────────────────────
  router.get('/scoring/rules', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT * FROM crm_lead_scoring_rules WHERE user_id=$1 ORDER BY position, created_at`,
      [auth.userId]
    );
    res.json(rows);
  });

  router.post('/scoring/rules', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, condition, points, active } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    if (!condition || typeof condition !== 'object') return void res.status(400).json({ error: 'condition required' });
    const { rows: [{ max_pos }] } = await pool.query(`SELECT COALESCE(MAX(position),0) AS max_pos FROM crm_lead_scoring_rules WHERE user_id=$1`, [auth.userId]);
    const { rows } = await pool.query(
      `INSERT INTO crm_lead_scoring_rules (id,user_id,name,condition,points,active,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomUUID(), auth.userId, name.trim(), JSON.stringify(condition), points||0, active !== false, (max_pos as number)+1]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/scoring/rules/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    const { name, condition, points, active, position } = req.body;
    if (name !== undefined) { params.push(name); sets.push(`name=$${params.length}`); }
    if (condition !== undefined) { params.push(JSON.stringify(condition)); sets.push(`condition=$${params.length}`); }
    if (points !== undefined) { params.push(points); sets.push(`points=$${params.length}`); }
    if (active !== undefined) { params.push(active); sets.push(`active=$${params.length}`); }
    if (position !== undefined) { params.push(position); sets.push(`position=$${params.length}`); }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(`UPDATE crm_lead_scoring_rules SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  router.delete('/scoring/rules/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_lead_scoring_rules WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Recalculate contact lead score ─────────────────────────────────────────
  // Shared evaluator in leadScoring.ts — also runs automatically on contact
  // state changes (tags, subscribe, consent) and from automation steps.
  router.post('/scoring/recalculate/:contactId', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const score = await recalcLeadScore(pool, auth.userId, req.params.contactId);
    if (score === null) return void res.status(404).json({ error: 'Not found' });
    res.json({ score });
  });

  return router;
}
