import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { publicApiLimiter } from '../middleware/rateLimiter.ts';

type AuthResult = { userId: string; email?: string } | null;

type SurveyDeps = {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
};

export function registerSurveyRoutes({ requireAuth, pool }: SurveyDeps): Router {
  const router = express.Router();

  // GET /api/surveys
  router.get('/', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT s.*, (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id=s.id) AS response_count,
                (SELECT COUNT(*) FROM survey_questions q WHERE q.survey_id=s.id) AS question_count
         FROM surveys s WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [auth.userId]);
      return res.json({ success: true, surveys: rows });
    } catch (err) { logger.error('Failed to fetch surveys', err); return res.status(500).json({ success: false, error: 'Failed to fetch surveys' }); }
  });

  // POST /api/surveys
  router.post('/', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { title, description } = req.body;
      if (!title?.trim()) return res.status(400).json({ success: false, error: 'Title required' });
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO surveys (id, user_id, title, description) VALUES ($1,$2,$3,$4) RETURNING *`,
        [id, auth.userId, title.trim(), description || null]);
      return res.json({ success: true, survey: rows[0] });
    } catch (err) { logger.error('Failed to create survey', err); return res.status(500).json({ success: false, error: 'Failed to create survey' }); }
  });

  // GET /api/surveys/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: sr } = await pool.query('SELECT * FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      const { rows: qr } = await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY order_idx ASC', [req.params.id]);
      return res.json({ success: true, survey: { ...sr[0], questions: qr } });
    } catch (err) { logger.error('Failed to fetch survey', err); return res.status(500).json({ success: false, error: 'Failed to fetch survey' }); }
  });

  // PATCH /api/surveys/:id
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { title, description, status, thank_you_message } = req.body;
      const { rows } = await pool.query(
        `UPDATE surveys SET title=COALESCE($1,title), description=COALESCE($2,description),
         status=COALESCE($3,status), thank_you_message=COALESCE($4,thank_you_message), updated_at=NOW()
         WHERE id=$5 AND user_id=$6 RETURNING *`,
        [title || null, description !== undefined ? (description || null) : null, status || null, thank_you_message || null, req.params.id, auth.userId]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      return res.json({ success: true, survey: rows[0] });
    } catch (err) { logger.error('Failed to update survey', err); return res.status(500).json({ success: false, error: 'Failed to update survey' }); }
  });

  // DELETE /api/surveys/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete survey', err); return res.status(500).json({ success: false, error: 'Failed to delete survey' }); }
  });

  // POST /api/surveys/:id/questions
  router.post('/:id/questions', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { type, question, options, required, settings } = req.body;
      const { rows: sr } = await pool.query('SELECT id FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      const { rows: last } = await pool.query('SELECT COALESCE(MAX(order_idx),0)+1 AS next FROM survey_questions WHERE survey_id=$1', [req.params.id]);
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO survey_questions (id, survey_id, type, question, options, required, order_idx, settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, req.params.id, type || 'radio', question || 'New question', JSON.stringify(options ?? []), !!required, last[0].next, JSON.stringify(settings ?? {})]);
      return res.json({ success: true, question: rows[0] });
    } catch (err) { logger.error('Failed to add question', err); return res.status(500).json({ success: false, error: 'Failed to add question' }); }
  });

  // PATCH /api/surveys/:id/questions/:qid
  router.patch('/:id/questions/:qid', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { question, options, required, settings, order_idx } = req.body;
      const { rows: sr } = await pool.query('SELECT id FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      const { rows } = await pool.query(
        `UPDATE survey_questions SET
           question=COALESCE($1,question),
           options=COALESCE($2::jsonb,options),
           required=COALESCE($3,required),
           settings=COALESCE($4::jsonb,settings),
           order_idx=COALESCE($5,order_idx)
         WHERE id=$6 AND survey_id=$7 RETURNING *`,
        [question || null, options ? JSON.stringify(options) : null, required !== undefined ? !!required : null, settings ? JSON.stringify(settings) : null, order_idx ?? null, req.params.qid, req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Question not found' });
      return res.json({ success: true, question: rows[0] });
    } catch (err) { logger.error('Failed to update question', err); return res.status(500).json({ success: false, error: 'Failed to update question' }); }
  });

  // DELETE /api/surveys/:id/questions/:qid
  router.delete('/:id/questions/:qid', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: sr } = await pool.query('SELECT id FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      await pool.query('DELETE FROM survey_questions WHERE id=$1 AND survey_id=$2', [req.params.qid, req.params.id]);
      return res.json({ success: true });
    } catch (err) { logger.error('Failed to delete question', err); return res.status(500).json({ success: false, error: 'Failed to delete question' }); }
  });

  // GET /api/surveys/:id/responses
  router.get('/:id/responses', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: sr } = await pool.query('SELECT id FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      const { rows } = await pool.query('SELECT * FROM survey_responses WHERE survey_id=$1 ORDER BY created_at DESC', [req.params.id]);
      return res.json({ success: true, responses: rows });
    } catch (err) { logger.error('Failed to fetch responses', err); return res.status(500).json({ success: false, error: 'Failed to fetch responses' }); }
  });

  // GET /api/surveys/:id/analytics
  router.get('/:id/analytics', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows: sr } = await pool.query('SELECT * FROM surveys WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found' });
      const { rows: questions } = await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY order_idx', [req.params.id]);
      const { rows: responses } = await pool.query('SELECT answers FROM survey_responses WHERE survey_id=$1', [req.params.id]);
      const totalResponses = responses.length;
      const questionsRecord: Record<string, unknown> = {};
      for (const q of questions) {
        const allAnswers = responses.map(r => {
          const a = (r.answers as { question_id: string; value: unknown }[]).find(x => x.question_id === q.id);
          return a?.value;
        }).filter(v => v !== undefined && v !== null && v !== '');
        const opts = (q.options || []) as string[];
        if (q.type === 'radio') {
          const counts: Record<string, number> = {};
          opts.forEach(o => { counts[o] = 0; });
          allAnswers.forEach(v => { if (typeof v === 'string' && counts[v] !== undefined) counts[v]++; });
          questionsRecord[q.id] = { type: q.type, counts, total: allAnswers.length };
        } else if (q.type === 'checkbox') {
          const counts: Record<string, number> = {};
          opts.forEach(o => { counts[o] = 0; });
          allAnswers.forEach(v => { if (Array.isArray(v)) v.forEach((item: string) => { if (counts[item] !== undefined) counts[item]++; }); });
          questionsRecord[q.id] = { type: q.type, counts, total: allAnswers.length };
        } else if (q.type === 'rating') {
          const dist: Record<string, number> = { '1':0,'2':0,'3':0,'4':0,'5':0 };
          allAnswers.forEach(v => { const n = Number(v); if (n >= 1 && n <= 5) dist[String(n)]++; });
          const avg = allAnswers.length ? allAnswers.reduce<number>((s, v) => s + Number(v), 0) / allAnswers.length : 0;
          questionsRecord[q.id] = { type: q.type, distribution: dist, average: Math.round(avg * 10) / 10, total: allAnswers.length };
        } else if (q.type === 'nps' || q.type === 'range') {
          const nums = allAnswers.map(v => Number(v)).filter(n => !isNaN(n) && n >= 0 && n <= 10);
          const promoters = nums.filter(n => n >= 9).length;
          const passives = nums.filter(n => n >= 7 && n <= 8).length;
          const detractors = nums.filter(n => n <= 6).length;
          const score = nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : 0;
          questionsRecord[q.id] = { type: 'nps', score, promoters, passives, detractors, total: nums.length };
        } else if (q.type === 'text') {
          questionsRecord[q.id] = { type: q.type, responses: allAnswers.slice(0, 100).map(String), total: allAnswers.length };
        } else {
          questionsRecord[q.id] = { type: q.type, total: allAnswers.length };
        }
      }
      return res.json({ success: true, total_responses: totalResponses, completion_rate: 100, questions: questionsRecord });
    } catch (err) { logger.error('Failed to fetch survey analytics', err); return res.status(500).json({ success: false, error: 'Failed to fetch analytics' }); }
  });

  return router;
}

export function registerPublicSurveyRoutes({ pool, fireAutomationTrigger }: {
  pool: Pool;
  fireAutomationTrigger?: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}): Router {
  const router = express.Router();

  // GET /api/public/surveys/:id — fetch published survey for display
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query('SELECT * FROM surveys WHERE id=$1 AND status=$2', [req.params.id, 'active']);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Survey not found or not active' });
      const { rows: questions } = await pool.query('SELECT id, type, question, options, required, order_idx, settings FROM survey_questions WHERE survey_id=$1 ORDER BY order_idx ASC', [req.params.id]);
      return res.json({ success: true, survey: { ...rows[0], questions } });
    } catch (err) { logger.error('Failed to fetch public survey', err); return res.status(500).json({ success: false, error: 'Failed to fetch survey' }); }
  });

  // POST /api/public/surveys/:id/respond — submit a response
  router.post('/:id/respond', publicApiLimiter, async (req: Request, res: Response) => {
    try {
      const { answers, email } = req.body as { answers: { question_id: string; value: unknown }[]; email?: string };
      const { rows: sr } = await pool.query('SELECT * FROM surveys WHERE id=$1 AND status=$2', [req.params.id, 'active']);
      if (!sr.length) return res.status(404).json({ success: false, error: 'Survey not found or not active' });
      const survey = sr[0];
      let contactId: string | null = null;
      if (email) {
        const { rows: cr } = await pool.query('SELECT id FROM mailing_contacts WHERE user_id=$1 AND email=$2', [survey.user_id, email.toLowerCase().trim()]);
        if (cr.length) contactId = cr[0].id;
      }
      const id = randomUUID();
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || null;
      await pool.query(
        `INSERT INTO survey_responses (id, survey_id, contact_id, respondent_email, answers, ip_address) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, req.params.id, contactId, email?.toLowerCase().trim() || null, JSON.stringify(answers), ip]);
      // Known respondents kick off survey automations (Marketing → Automations).
      if (fireAutomationTrigger && (contactId || email)) {
        const who = { id: contactId, email: email?.toLowerCase().trim() };
        void fireAutomationTrigger(survey.user_id, 'survey_response', who).catch(() => undefined);
        void fireAutomationTrigger(survey.user_id, 'survey_completed', who).catch(() => undefined);
      }
      return res.json({ success: true, thank_you_message: survey.thank_you_message });
    } catch (err) { logger.error('Failed to submit survey response', err); return res.status(500).json({ success: false, error: 'Failed to submit response' }); }
  });

  return router;
}
