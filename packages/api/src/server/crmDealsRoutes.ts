import { ownedCrmReferences } from './ownership.ts';
import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { dispatchOutboundWebhooks } from '../middleware/planQuotaMiddleware.ts';

type AuthResult = { userId: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  fireAutomationTrigger?: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}

const DEFAULT_STAGES = [
  { name: 'Lead',        color: '#6366f1', position: 0 },
  { name: 'Qualified',   color: '#8b5cf6', position: 1 },
  { name: 'Proposal',    color: '#f59e0b', position: 2 },
  { name: 'Negotiation', color: '#ef4444', position: 3 },
  { name: 'Closed Won',  color: '#10b981', position: 4 },
];

export function registerCRMDealsRoutes({ requireAuth, pool, fireAutomationTrigger }: Deps): Router {
  const router = express.Router();

  // ── Ensure a default pipeline + stages for a new user ─────────────────────
  async function ensureDefaults(userId: string): Promise<string> {
    let { rows: pipelines } = await pool.query(
      `SELECT id FROM crm_pipelines WHERE user_id=$1 ORDER BY created_at LIMIT 1`, [userId]
    );
    if (!pipelines.length) {
      const pid = randomUUID();
      await pool.query(
        `INSERT INTO crm_pipelines (id,user_id,name) VALUES ($1,$2,'Sales Pipeline') ON CONFLICT DO NOTHING`,
        [pid, userId]
      );
      pipelines = [{ id: pid }];
    }
    const pipelineId = pipelines[0].id as string;
    const { rows: existing } = await pool.query(
      `SELECT id FROM crm_pipeline_stages WHERE pipeline_id=$1 LIMIT 1`, [pipelineId]
    );
    if (!existing.length) {
      for (const s of DEFAULT_STAGES) {
        await pool.query(
          `INSERT INTO crm_pipeline_stages (id,user_id,pipeline_id,name,color,position) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [randomUUID(), userId, pipelineId, s.name, s.color, s.position]
        );
      }
    }
    return pipelineId;
  }

  // ── Pipelines CRUD ────────────────────────────────────────────────────────
  router.get('/pipelines', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await ensureDefaults(auth.userId);
    const { rows } = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM crm_pipeline_stages s WHERE s.pipeline_id=p.id) AS stage_count,
        (SELECT COUNT(*) FROM crm_deals d
          JOIN crm_pipeline_stages s ON s.id=d.stage_id
          WHERE s.pipeline_id=p.id AND d.status='open') AS deal_count
       FROM crm_pipelines p WHERE p.user_id=$1 ORDER BY p.created_at`,
      [auth.userId]
    );
    res.json(rows);
  });

  router.post('/pipelines', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_pipelines (id,user_id,name) VALUES ($1,$2,$3) RETURNING *`,
      [id, auth.userId, name.trim()]
    );
    for (const s of DEFAULT_STAGES) {
      await pool.query(
        `INSERT INTO crm_pipeline_stages (id,user_id,pipeline_id,name,color,position) VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), auth.userId, id, s.name, s.color, s.position]
      );
    }
    res.status(201).json(rows[0]);
  });

  router.patch('/pipelines/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    const { rows } = await pool.query(
      `UPDATE crm_pipelines SET name=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *`,
      [name.trim(), req.params.id, auth.userId]
    );
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  router.delete('/pipelines/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [{ cnt }] } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM crm_pipelines WHERE user_id=$1`, [auth.userId]
    );
    if (parseInt(String(cnt)) <= 1)
      return void res.status(400).json({ error: 'Cannot delete the last pipeline' });
    await pool.query(
      `UPDATE crm_deals SET stage_id=NULL WHERE stage_id IN (SELECT id FROM crm_pipeline_stages WHERE pipeline_id=$1)`,
      [req.params.id]
    );
    await pool.query(`DELETE FROM crm_pipelines WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  // ── Pipeline stages ────────────────────────────────────────────────────────
  router.get('/pipeline/stages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { pipeline_id } = req.query as Record<string, string>;
    await ensureDefaults(auth.userId);
    const params: unknown[] = [auth.userId];
    let pipelineClause = '';
    if (pipeline_id) { params.push(pipeline_id); pipelineClause = ` AND s.pipeline_id=$${params.length}`; }
    const { rows } = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM crm_deals d WHERE d.stage_id=s.id AND d.status='open') AS deal_count,
        (SELECT COALESCE(SUM(d.value),0) FROM crm_deals d WHERE d.stage_id=s.id AND d.status='open') AS total_value
       FROM crm_pipeline_stages s WHERE s.user_id=$1${pipelineClause} ORDER BY s.position`,
      params
    );
    res.json(rows);
  });

  router.post('/pipeline/stages', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, color, pipeline_id } = req.body;
    if (!name?.trim()) return void res.status(400).json({ error: 'name required' });
    let pid = pipeline_id as string | undefined;
    if (!pid) {
      const { rows } = await pool.query(
        `SELECT id FROM crm_pipelines WHERE user_id=$1 ORDER BY created_at LIMIT 1`, [auth.userId]
      );
      pid = rows[0]?.id;
    }
    const { rows: [{ max_pos }] } = await pool.query(
      `SELECT COALESCE(MAX(position),0) AS max_pos FROM crm_pipeline_stages WHERE user_id=$1 AND pipeline_id=$2`,
      [auth.userId, pid]
    );
    const { rows } = await pool.query(
      `INSERT INTO crm_pipeline_stages (id,user_id,pipeline_id,name,color,position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [randomUUID(), auth.userId, pid, name.trim(), color || '#6366f1', (max_pos as number) + 1]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/pipeline/stages/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { name, color, position } = req.body;
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    if (name !== undefined) { params.push(name); sets.push(`name=$${params.length}`); }
    if (color !== undefined) { params.push(color); sets.push(`color=$${params.length}`); }
    if (position !== undefined) { params.push(position); sets.push(`position=$${params.length}`); }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    const { rows } = await pool.query(
      `UPDATE crm_pipeline_stages SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params
    );
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  router.delete('/pipeline/stages/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows: [stage] } = await pool.query(
      `SELECT * FROM crm_pipeline_stages WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]
    );
    if (!stage) return void res.status(404).json({ error: 'Not found' });
    await pool.query(`UPDATE crm_deals SET stage_id=NULL WHERE stage_id=$1`, [req.params.id]);
    await pool.query(`DELETE FROM crm_pipeline_stages WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  });

  // ── Deals list ────────────────────────────────────────────────────────────
  router.get('/deals', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { stage_id, status = 'open', search, pipeline_id, limit = '100', offset = '0' } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    const wheres = ['d.user_id=$1'];
    if (stage_id)    { params.push(stage_id);    wheres.push(`d.stage_id=$${params.length}`); }
    if (status)      { params.push(status);      wheres.push(`d.status=$${params.length}`); }
    if (search)      { params.push(`%${search}%`); wheres.push(`(d.title ILIKE $${params.length} OR cc.name ILIKE $${params.length})`); }
    if (pipeline_id) { params.push(pipeline_id); wheres.push(`d.stage_id IN (SELECT id FROM crm_pipeline_stages WHERE pipeline_id=$${params.length})`); }
    const { rows } = await pool.query(
      `SELECT d.*,
        s.name AS stage_name, s.color AS stage_color,
        mc.email AS contact_email, mc.first_name AS contact_first_name, mc.last_name AS contact_last_name,
        cc.name AS company_name
       FROM crm_deals d
       LEFT JOIN crm_pipeline_stages s ON s.id=d.stage_id
       LEFT JOIN mailing_contacts mc ON mc.id=d.contact_id
       LEFT JOIN crm_companies cc ON cc.id=d.company_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY d.stage_id NULLS LAST, d.position, d.created_at DESC
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  });

  router.get('/deals/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { rows } = await pool.query(
      `SELECT d.*,
        s.name AS stage_name, s.color AS stage_color,
        mc.email AS contact_email, mc.first_name AS contact_first_name, mc.last_name AS contact_last_name,
        cc.name AS company_name
       FROM crm_deals d
       LEFT JOIN crm_pipeline_stages s ON s.id=d.stage_id
       LEFT JOIN mailing_contacts mc ON mc.id=d.contact_id
       LEFT JOIN crm_companies cc ON cc.id=d.company_id
       WHERE d.id=$1 AND d.user_id=$2`,
      [req.params.id, auth.userId]
    );
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    const { rows: activities } = await pool.query(
      `SELECT * FROM crm_activities WHERE deal_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]
    );
    res.json({ ...rows[0], activities });
  });

  router.post('/deals', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!await ownedCrmReferences(pool,auth.userId,req.body)) return res.status(403).json({ error: 'Related records must belong to your account' });
    if (!await ownedCrmReferences(pool,auth.userId,req.body)) return res.status(403).json({ error: 'Related records must belong to your account' });
    const { title, value, currency, stage_id, contact_id, company_id, close_date, priority, probability, description } = req.body;
    if (!title?.trim()) return void res.status(400).json({ error: 'title required' });
    const { rows: [{ max_pos }] } = await pool.query(
      `SELECT COALESCE(MAX(position),0) AS max_pos FROM crm_deals WHERE user_id=$1 AND stage_id IS NOT DISTINCT FROM $2`,
      [auth.userId, stage_id || null]
    );
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_deals (id,user_id,title,value,currency,stage_id,contact_id,company_id,close_date,priority,probability,description,position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, auth.userId, title.trim(), value || 0, currency || 'USD', stage_id || null, contact_id || null, company_id || null, close_date || null, priority || 'medium', probability || 0, description || null, (max_pos as number) + 1]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/deals/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!await ownedCrmReferences(pool,auth.userId,req.body)) return res.status(403).json({ error: 'Related records must belong to your account' });
    if (!await ownedCrmReferences(pool,auth.userId,req.body)) return res.status(403).json({ error: 'Related records must belong to your account' });
    const fields = ['title','value','currency','stage_id','contact_id','company_id','close_date','priority','status','probability','description','position','custom_data','close_reason'];
    const sets: string[] = []; const params: unknown[] = [req.params.id, auth.userId];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(f === 'custom_data' ? JSON.stringify(req.body[f]) : req.body[f]);
        sets.push(`${f}=$${params.length}`);
      }
    }
    if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at=NOW()`);
    const { rows } = await pool.query(
      `UPDATE crm_deals SET ${sets.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`, params
    );
    if (!rows.length) return void res.status(404).json({ error: 'Not found' });
    const updatedDeal = rows[0];

    if (req.body.stage_id !== undefined || req.body.status !== undefined) {
      await dispatchOutboundWebhooks(pool, auth.userId, 'deal.stage_changed', {
        deal_id: updatedDeal.id,
        title: updatedDeal.title,
        stage_id: updatedDeal.stage_id,
        status: updatedDeal.status,
        value: updatedDeal.value,
        contact_id: updatedDeal.contact_id,
      }).catch(() => undefined);

      if (fireAutomationTrigger && updatedDeal.contact_id) {
        await fireAutomationTrigger(auth.userId, 'deal_stage_changed', { id: updatedDeal.contact_id }).catch(() => undefined);
        if (String(updatedDeal.status || '').toLowerCase() === 'won') {
          await fireAutomationTrigger(auth.userId, 'deal_won', { id: updatedDeal.contact_id }).catch(() => undefined);
        }
      }
    }

    res.json(updatedDeal);
  });

  router.delete('/deals/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    await pool.query(`DELETE FROM crm_deals WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    res.json({ ok: true });
  });

  router.post('/deals/reorder', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { deal_id, stage_id, position } = req.body;
    if (!deal_id) return void res.status(400).json({ error: 'deal_id required' });
    await pool.query(
      `UPDATE crm_deals SET stage_id=$1, position=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4`,
      [stage_id || null, position || 0, deal_id, auth.userId]
    );
    res.json({ ok: true });
  });

  // ── Pipeline stats (with optional pipeline filter + weighted forecast) ────
  router.get('/pipeline/stats', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    const { pipeline_id } = req.query as Record<string, string>;
    const params: unknown[] = [auth.userId];
    let filter = 'd.user_id=$1';
    if (pipeline_id) {
      params.push(pipeline_id);
      filter += ` AND d.stage_id IN (SELECT id FROM crm_pipeline_stages WHERE pipeline_id=$${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status='open')  AS open_count,
        COUNT(*) FILTER (WHERE status='won')   AS won_count,
        COUNT(*) FILTER (WHERE status='lost')  AS lost_count,
        COALESCE(SUM(value) FILTER (WHERE status='open'), 0)  AS open_value,
        COALESCE(SUM(value) FILTER (WHERE status='won'),  0)  AS won_value,
        COALESCE(AVG(value) FILTER (WHERE status='won'),  0)  AS avg_deal_size,
        COALESCE(SUM(value * probability / 100.0) FILTER (WHERE status='open'), 0) AS forecast_value
       FROM crm_deals d WHERE ${filter}`,
      params
    );
    res.json(rows[0]);
  });

  return router;
}
