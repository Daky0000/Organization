import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { randomBytes, randomUUID } from 'crypto';
import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; email?: string } | null;

interface CampaignDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  redisUrl: string;
}

const CAMPAIGN_QUEUE_NAME = 'campaign-jobs';
let campaignQueue: Queue | null = null;
let campaignWorker: Worker | null = null;

function isBullMqEnabled(redisUrl: string) {
  return Boolean(redisUrl && redisUrl.trim());
}

function buildUtmUrl(base: string, utm: { source: string; medium: string; campaign: string; term?: string; content?: string }): string {
  try {
    const url = new URL(base.startsWith('http') ? base : `https://${base}`);
    url.searchParams.set('utm_source', utm.source);
    url.searchParams.set('utm_medium', utm.medium);
    url.searchParams.set('utm_campaign', utm.campaign);
    if (utm.term) url.searchParams.set('utm_term', utm.term);
    if (utm.content) url.searchParams.set('utm_content', utm.content);
    return url.toString();
  } catch (err) {
    logger.error('buildUtmUrl error:', err);
    return base;
  }
}

function campaignShortCode(): string {
  return randomBytes(4).toString('hex');
}

async function ensureCampaignQueue(pool: Pool, redisUrl: string) {
  if (campaignQueue || !isBullMqEnabled(redisUrl) || !pool) return;
  try {
    const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
    campaignQueue = new Queue(CAMPAIGN_QUEUE_NAME, {
      connection: redis as any,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
    });
    campaignWorker = new Worker(CAMPAIGN_QUEUE_NAME, async (job) => {
      const { jobRowId } = job.data as { jobRowId: string };
      if (!jobRowId || !pool) return;
      try {
        await pool.query(`UPDATE campaign_jobs SET status='running', updated_at=NOW() WHERE id=$1`, [jobRowId]);
        const jRes = await pool.query('SELECT * FROM campaign_jobs WHERE id=$1', [jobRowId]);
        const jRow: any = jRes.rows[0];
        if (!jRow) return;
        const payload: any = jRow.payload || {};
        if (jRow.job_type === 'analytics_init') {
          await pool.query(
            `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at) VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, NOW() + INTERVAL '90 days') ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
            [jRow.user_id, `campaign_created_${jRow.campaign_id}`, JSON.stringify({ campaignId: jRow.campaign_id, createdAt: new Date().toISOString(), channels: payload.channels || [], utmCount: payload.utmCount || 0 })]
          ).catch(() => undefined);
        }
        if (jRow.job_type === 'attribution_init') {
          await pool.query(`UPDATE campaigns SET attribution_model=$1, updated_at=NOW() WHERE id=$2`, [payload.model || 'last_touch', jRow.campaign_id]).catch(() => undefined);
        }
        if (jRow.job_type === 'mailing_link' && payload.mailing_campaign_id) {
          await pool.query(`UPDATE campaigns SET mailing_campaign_id=$1, updated_at=NOW() WHERE id=$2`, [payload.mailing_campaign_id, jRow.campaign_id]).catch(() => undefined);
        }
        await pool.query(`UPDATE campaign_jobs SET status='done', updated_at=NOW() WHERE id=$1`, [jobRowId]);
      } catch (err: any) {
        await pool.query(`UPDATE campaign_jobs SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`, [err?.message || 'Unknown error', jobRowId]).catch(() => undefined);
        throw err;
      }
    }, { connection: new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false }) as any, concurrency: 5 });
    campaignWorker.on('error', (err) => logger.error('[CampaignQueue] Worker error:', err));
  } catch (err) {
    logger.error('[CampaignQueue] Init failed:', err);
    campaignQueue = null;
  }
}

async function enqueueCampaignJob(pool: Pool, redisUrl: string, jobRowId: string): Promise<string | null> {
  if (!isBullMqEnabled(redisUrl)) return null;
  try {
    await ensureCampaignQueue(pool, redisUrl);
    if (!campaignQueue) return null;
    const job = await campaignQueue.add('campaign-job', { jobRowId }, { jobId: jobRowId });
    return String(job.id);
  } catch (err: any) {
    if (/Job.*already exists/i.test(String(err?.message || ''))) return jobRowId;
    logger.error('[CampaignQueue] Enqueue error:', err);
    return null;
  }
}

async function processCampaignJobInline(pool: Pool, jobRowId: string) {
  try {
    const jRes = await pool.query('SELECT * FROM campaign_jobs WHERE id=$1', [jobRowId]);
    const jRow: any = jRes.rows[0];
    if (!jRow) return;
    const payload: any = jRow.payload || {};
    await pool.query(`UPDATE campaign_jobs SET status='running', updated_at=NOW() WHERE id=$1`, [jobRowId]);
    if (jRow.job_type === 'analytics_init') {
      await pool.query(
        `INSERT INTO insights_cache (id, user_id, cache_key, data, expires_at) VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, NOW() + INTERVAL '90 days') ON CONFLICT (user_id, cache_key) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at`,
        [jRow.user_id, `campaign_created_${jRow.campaign_id}`, JSON.stringify({ campaignId: jRow.campaign_id, createdAt: new Date().toISOString(), channels: payload.channels || [], utmCount: payload.utmCount || 0 })]
      ).catch(() => undefined);
    }
    if (jRow.job_type === 'attribution_init') {
      await pool.query(`UPDATE campaigns SET attribution_model=$1, updated_at=NOW() WHERE id=$2`, [payload.model || 'last_touch', jRow.campaign_id]).catch(() => undefined);
    }
    if (jRow.job_type === 'mailing_link' && payload.mailing_campaign_id) {
      await pool.query(`UPDATE campaigns SET mailing_campaign_id=$1, updated_at=NOW() WHERE id=$2`, [payload.mailing_campaign_id, jRow.campaign_id]).catch(() => undefined);
    }
    await pool.query(`UPDATE campaign_jobs SET status='done', updated_at=NOW() WHERE id=$1`, [jobRowId]);
  } catch (err: any) {
    pool.query(`UPDATE campaign_jobs SET status='failed', error=$1, updated_at=NOW() WHERE id=$2`, [err?.message || 'Unknown', jobRowId]).catch(() => undefined);
  }
}

export function registerCampaignRoutes({ requireAuth, pool, redisUrl }: CampaignDeps): Router {
  const router = express.Router();

  // POST /api/campaign/campaigns/create — must be before /:id to avoid shadowing
  router.post('/campaigns/create', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const {
      name, description, goal, start_date, end_date, budget, currency, target_url,
      tags, channels = [], attribution_model = 'last_touch',
      create_funnel = true, funnel_name, utm_auto_generate = true,
      mailing_subject, mailing_segment_id,
    } = req.body as any;

    const validationErrors: string[] = [];
    if (!name || !String(name).trim()) validationErrors.push('Campaign name is required.');
    if (String(name || '').trim().length > 120) validationErrors.push('Campaign name must be 120 characters or fewer.');
    const validGoals = ['awareness', 'traffic', 'leads', 'engagement', 'sales'];
    if (goal && !validGoals.includes(goal)) validationErrors.push(`Goal must be one of: ${validGoals.join(', ')}.`);
    if (start_date && end_date) {
      const sd = new Date(start_date), ed = new Date(end_date);
      if (isNaN(sd.getTime())) validationErrors.push('Invalid start_date.');
      else if (isNaN(ed.getTime())) validationErrors.push('Invalid end_date.');
      else if (sd >= ed) validationErrors.push('start_date must be before end_date.');
    }
    let sanitizedTargetUrl = '';
    if (target_url) {
      try {
        const u = new URL(String(target_url).startsWith('http') ? target_url : `https://${target_url}`);
        if (!['http:', 'https:'].includes(u.protocol)) validationErrors.push('target_url must be http or https.');
        else sanitizedTargetUrl = u.toString();
      } catch (_err) { validationErrors.push('Invalid target_url.'); }
    }
    if (budget !== undefined && budget !== null && budget !== '') {
      const b = parseFloat(String(budget));
      if (isNaN(b) || b < 0) validationErrors.push('Budget must be a positive number.');
    }
    const socialChannels = (channels as string[]).filter(c => !['email', 'landing_page'].includes(c));
    if (socialChannels.length > 0) {
      const acctRes = await pool.query(
        `SELECT platform FROM social_accounts WHERE user_id=$1 AND connected=true AND platform = ANY($2::text[])`,
        [auth.userId, socialChannels]
      ).catch(() => ({ rows: [] as any[] }));
      const connectedPlatforms = acctRes.rows.map((r: any) => r.platform.toLowerCase());
      for (const ch of socialChannels) {
        if (!connectedPlatforms.includes(ch.toLowerCase()) && ch !== 'email' && ch !== 'landing_page') {
          validationErrors.push(`Channel "${ch}" is not connected. Please connect it in Integrations first.`);
        }
      }
    }
    if (validationErrors.length > 0) return res.status(400).json({ success: false, validationErrors, error: validationErrors[0] });

    const dupCheck = await pool.query('SELECT id FROM campaigns WHERE user_id=$1 AND LOWER(name)=LOWER($2)', [auth.userId, String(name).trim()]);
    if (dupCheck.rows.length > 0) return res.status(409).json({ success: false, error: `A campaign named "${name}" already exists. Choose a unique name.`, validationErrors: [`A campaign named "${name}" already exists.`] });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const campaignRes = await client.query(
        `INSERT INTO campaigns (id, user_id, name, description, goal, status, start_date, end_date, budget, currency, target_url, tags, attribution_model)
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [auth.userId, String(name).trim(), description || '', goal || 'awareness', start_date || null, end_date || null,
         budget ? parseFloat(String(budget)) : null, currency || 'USD', sanitizedTargetUrl, Array.isArray(tags) ? tags : [], attribution_model]
      );
      const campaign = campaignRes.rows[0];
      const campaignId: string = campaign.id;
      const utmCampaignSlug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

      const createdChannels: any[] = [];
      for (const ch of channels as string[]) {
        const saRes = await client.query(`SELECT id FROM social_accounts WHERE user_id=$1 AND LOWER(platform)=LOWER($2) AND connected=true LIMIT 1`, [auth.userId, ch]);
        const socialAccountId: string | null = saRes.rows[0]?.id || null;
        const chRes = await client.query(
          `INSERT INTO campaign_channels (id, campaign_id, user_id, channel_type, social_account_id, status) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,'active') RETURNING *`,
          [campaignId, auth.userId, ch, socialAccountId]
        );
        createdChannels.push(chRes.rows[0]);
      }

      let createdFunnel: any = null;
      let createdSteps: any[] = [];
      if (create_funnel) {
        const funnelRes = await client.query(
          `INSERT INTO funnels (id, campaign_id, user_id, name, description) VALUES (gen_random_uuid()::text,$1,$2,$3,$4) RETURNING *`,
          [campaignId, auth.userId, funnel_name || `${String(name).trim()} Funnel`, 'Auto-created AIDA funnel']
        );
        createdFunnel = funnelRes.rows[0];
        const defaultSteps = [
          { name: 'Impression', step_type: 'page_view', order: 0 },
          { name: 'Click', step_type: 'click', order: 1 },
          { name: 'Lead', step_type: 'form_submit', order: 2 },
          { name: 'Conversion', step_type: 'purchase', order: 3 },
        ];
        for (const s of defaultSteps) {
          const sRes = await client.query(
            `INSERT INTO funnel_steps (id, funnel_id, user_id, name, step_order, step_type, target_url) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6) RETURNING *`,
            [createdFunnel.id, auth.userId, s.name, s.order, s.step_type, sanitizedTargetUrl]
          );
          createdSteps.push(sRes.rows[0]);
        }
      }

      const createdLinks: any[] = [];
      if (utm_auto_generate && sanitizedTargetUrl && channels.length > 0) {
        const channelMediumMap: Record<string, string> = { facebook: 'social', instagram: 'social', twitter: 'social', linkedin: 'social', email: 'email', landing_page: 'referral' };
        for (const ch of channels as string[]) {
          const medium = channelMediumMap[ch] || 'social';
          const full_url = buildUtmUrl(sanitizedTargetUrl, { source: ch, medium, campaign: utmCampaignSlug });
          const short_code = campaignShortCode();
          const lRes = await client.query(
            `INSERT INTO utm_links (id, campaign_id, user_id, label, base_url, utm_source, utm_medium, utm_campaign, short_code, full_url) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (short_code) DO NOTHING RETURNING *`,
            [campaignId, auth.userId, `${ch.charAt(0).toUpperCase() + ch.slice(1)} — ${String(name).trim()}`, sanitizedTargetUrl, ch, medium, utmCampaignSlug, short_code, full_url]
          );
          if (lRes.rows[0]) createdLinks.push(lRes.rows[0]);
        }
      }

      let mailingCampaign: any = null;
      if (channels.includes('email') && mailing_subject) {
        const mcRes = await client.query(
          `INSERT INTO mailing_campaigns (id, user_id, name, subject, content, segment_id, status) VALUES (gen_random_uuid()::text, $1, $2, $3, '', $4, 'draft') RETURNING *`,
          [auth.userId, `${String(name).trim()} — Email`, mailing_subject, mailing_segment_id || null]
        ).catch(() => ({ rows: [] as any[] }));
        if (mcRes.rows[0]) {
          mailingCampaign = mcRes.rows[0];
          await client.query(`UPDATE campaigns SET mailing_campaign_id=$1 WHERE id=$2`, [mailingCampaign.id, campaignId]).catch(() => undefined);
        }
      }

      const jobsToQueue = [
        { job_type: 'analytics_init', payload: { channels, utmCount: createdLinks.length, utmCampaign: utmCampaignSlug } },
        { job_type: 'attribution_init', payload: { model: attribution_model } },
        ...(mailingCampaign ? [{ job_type: 'mailing_link', payload: { mailing_campaign_id: mailingCampaign.id } }] : []),
      ];
      const jobRows: any[] = [];
      for (const j of jobsToQueue) {
        const jRes = await client.query(
          `INSERT INTO campaign_jobs (id, campaign_id, user_id, job_type, status, payload) VALUES (gen_random_uuid()::text, $1, $2, $3, 'queued', $4::jsonb) RETURNING *`,
          [campaignId, auth.userId, j.job_type, JSON.stringify(j.payload)]
        );
        jobRows.push(jRes.rows[0]);
      }
      await client.query('COMMIT');

      const jobIds: string[] = [];
      for (const jRow of jobRows) {
        if (isBullMqEnabled(redisUrl)) {
          const jid = await enqueueCampaignJob(pool, redisUrl, jRow.id).catch(() => null);
          if (jid) {
            await pool.query(`UPDATE campaign_jobs SET job_id=$1, updated_at=NOW() WHERE id=$2`, [jid, jRow.id]).catch(() => undefined);
            jobIds.push(jid);
          }
        } else {
          processCampaignJobInline(pool, jRow.id).catch(() => undefined);
          jobIds.push(jRow.id);
        }
      }

      return res.status(201).json({
        success: true,
        campaign: { ...campaign, mailing_campaign_id: mailingCampaign?.id || null },
        channels: createdChannels, funnel: createdFunnel, funnel_steps: createdSteps,
        utm_links: createdLinks, mailing_campaign: mailingCampaign, job_ids: jobIds,
        summary: { channels_created: createdChannels.length, funnel_steps_created: createdSteps.length, utm_links_created: createdLinks.length, jobs_queued: jobIds.length },
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error('[Campaign Create] Transaction failed:', err?.message || err);
      pool.query(`INSERT INTO funnel_events (id, owner_user_id, event_type, event_name, properties) VALUES (gen_random_uuid()::text, $1, 'error', 'campaign_create_failed', $2::jsonb)`, [auth.userId, JSON.stringify({ error: err?.message, ts: new Date().toISOString() })]).catch(() => undefined);
      return res.status(500).json({ success: false, error: 'Campaign creation failed. All changes were rolled back.' });
    } finally {
      client.release();
    }
  });

  // GET /api/campaign/campaigns
  router.get('/campaigns', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT c.*, (SELECT COUNT(*) FROM campaign_channels cc WHERE cc.campaign_id=c.id) as channel_count, (SELECT COUNT(*) FROM funnels f WHERE f.campaign_id=c.id) as funnel_count, (SELECT COUNT(*) FROM utm_links ul WHERE ul.campaign_id=c.id) as link_count, (SELECT COALESCE(SUM(ul.clicks),0) FROM utm_links ul WHERE ul.campaign_id=c.id) as total_clicks, (SELECT COALESCE(SUM(ul.conversions),0) FROM utm_links ul WHERE ul.campaign_id=c.id) as total_conversions FROM campaigns c WHERE c.user_id=$1 ORDER BY c.updated_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, campaigns: rows });
    } catch (err) { logger.error('list campaigns error:', err); return res.status(500).json({ success: false, error: 'Failed to list campaigns' }); }
  });

  // POST /api/campaign/campaigns
  router.post('/campaigns', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, description, goal, status, start_date, end_date, budget, currency, target_url, tags } = req.body as any;
      if (!name) return res.status(400).json({ success: false, error: 'name is required' });
      const { rows } = await pool.query(
        `INSERT INTO campaigns (id,user_id,name,description,goal,status,start_date,end_date,budget,currency,target_url,tags) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [auth.userId, name, description || '', goal || 'awareness', status || 'draft', start_date || null, end_date || null, budget || null, currency || 'USD', target_url || '', tags || []]
      );
      return res.status(201).json({ success: true, campaign: rows[0] });
    } catch (err) { logger.error('create campaign error:', err); return res.status(500).json({ success: false, error: 'Failed to create campaign' }); }
  });

  // GET /api/campaign/campaigns/:id
  router.get('/campaigns/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, campaign: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch campaign' }); }
  });

  // PUT /api/campaign/campaigns/:id
  router.put('/campaigns/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, description, goal, status, start_date, end_date, budget, currency, target_url, tags } = req.body as any;
      const { rows } = await pool.query(
        `UPDATE campaigns SET name=COALESCE($3,name), description=COALESCE($4,description), goal=COALESCE($5,goal), status=COALESCE($6,status), start_date=COALESCE($7,start_date), end_date=COALESCE($8,end_date), budget=COALESCE($9,budget), currency=COALESCE($10,currency), target_url=COALESCE($11,target_url), tags=COALESCE($12,tags), updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
        [req.params.id, auth.userId, name || null, description || null, goal || null, status || null, start_date || null, end_date || null, budget || null, currency || null, target_url || null, tags || null]
      );
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, campaign: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update campaign' }); }
  });

  // DELETE /api/campaign/campaigns/:id
  router.delete('/campaigns/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete campaign' }); }
  });

  // GET /api/campaign/campaigns/:id/channels
  router.get('/campaigns/:id/channels', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT cc.*, sa.account_name, sa.handle, sa.profile_image, sa.followers FROM campaign_channels cc LEFT JOIN social_accounts sa ON sa.id=cc.social_account_id WHERE cc.campaign_id=$1 AND cc.user_id=$2 ORDER BY cc.created_at`,
        [req.params.id, auth.userId]
      );
      return res.json({ success: true, channels: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch channels' }); }
  });

  // POST /api/campaign/campaigns/:id/channels
  router.post('/campaigns/:id/channels', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { channel_type, social_account_id, config } = req.body as any;
      if (!channel_type) return res.status(400).json({ success: false, error: 'channel_type required' });
      const campaignCheck = await pool.query('SELECT id FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
      const { rows } = await pool.query(
        `INSERT INTO campaign_channels (id,campaign_id,user_id,channel_type,social_account_id,config) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [req.params.id, auth.userId, channel_type, social_account_id || null, JSON.stringify(config || {})]
      );
      return res.status(201).json({ success: true, channel: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to add channel' }); }
  });

  // DELETE /api/campaign/channels/:channelId
  router.delete('/channels/:channelId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM campaign_channels WHERE id=$1 AND user_id=$2', [req.params.channelId, auth.userId]);
      return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete channel' }); }
  });

  // GET /api/campaign/campaigns/:id/funnels
  router.get('/campaigns/:id/funnels', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(
        `SELECT f.*, (SELECT COUNT(*) FROM funnel_steps fs WHERE fs.funnel_id=f.id) as step_count, (SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_id=f.id) as event_count FROM funnels f WHERE f.campaign_id=$1 AND f.user_id=$2 ORDER BY f.created_at`,
        [req.params.id, auth.userId]
      );
      return res.json({ success: true, funnels: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch funnels' }); }
  });

  // POST /api/campaign/campaigns/:id/funnels
  router.post('/campaigns/:id/funnels', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, description, steps } = req.body as any;
      if (!name) return res.status(400).json({ success: false, error: 'name required' });
      const campaignCheck = await pool.query('SELECT id FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
      const { rows } = await pool.query(`INSERT INTO funnels (id,campaign_id,user_id,name,description) VALUES (gen_random_uuid()::text,$1,$2,$3,$4) RETURNING *`, [req.params.id, auth.userId, name, description || '']);
      const funnel = rows[0];
      if (Array.isArray(steps) && steps.length > 0) {
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          await pool.query(`INSERT INTO funnel_steps (id,funnel_id,user_id,name,step_order,step_type,target_url,goal_count) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7)`, [funnel.id, auth.userId, s.name || `Step ${i + 1}`, i, s.step_type || 'page_view', s.target_url || '', s.goal_count || 0]);
        }
      }
      return res.status(201).json({ success: true, funnel });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to create funnel' }); }
  });

  // GET /api/campaign/funnels/:id
  router.get('/funnels/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      const steps = await pool.query('SELECT * FROM funnel_steps WHERE funnel_id=$1 ORDER BY step_order', [req.params.id]);
      return res.json({ success: true, funnel: rows[0], steps: steps.rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch funnel' }); }
  });

  // DELETE /api/campaign/funnels/:id
  router.delete('/funnels/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete funnel' }); }
  });

  // GET /api/campaign/funnels/:id/steps
  router.get('/funnels/:id/steps', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const fCheck = await pool.query('SELECT id FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!fCheck.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      const { rows } = await pool.query(`SELECT fs.*, (SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_step_id=fs.id) as event_count FROM funnel_steps fs WHERE fs.funnel_id=$1 ORDER BY fs.step_order`, [req.params.id]);
      return res.json({ success: true, steps: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch steps' }); }
  });

  // PUT /api/campaign/funnels/:id/steps
  router.put('/funnels/:id/steps', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const fCheck = await pool.query('SELECT id FROM funnels WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!fCheck.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      const { steps } = req.body as { steps: Array<{ id?: string; name: string; step_type: string; target_url?: string; goal_count?: number }> };
      if (!Array.isArray(steps)) return res.status(400).json({ success: false, error: 'steps array required' });
      await pool.query('DELETE FROM funnel_steps WHERE funnel_id=$1', [req.params.id]);
      const inserted = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const { rows } = await pool.query(`INSERT INTO funnel_steps (id,funnel_id,user_id,name,step_order,step_type,target_url,goal_count) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.params.id, auth.userId, s.name || `Step ${i + 1}`, i, s.step_type || 'page_view', s.target_url || '', s.goal_count || 0]);
        inserted.push(rows[0]);
      }
      return res.json({ success: true, steps: inserted });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update steps' }); }
  });

  // GET /api/campaign/campaigns/:id/utmlinks
  router.get('/campaigns/:id/utmlinks', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM utm_links WHERE campaign_id=$1 AND user_id=$2 ORDER BY created_at DESC', [req.params.id, auth.userId]);
      return res.json({ success: true, links: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch UTM links' }); }
  });

  // POST /api/campaign/campaigns/:id/utmlinks
  router.post('/campaigns/:id/utmlinks', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { label, base_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content } = req.body as any;
      if (!label || !base_url || !utm_source || !utm_medium || !utm_campaign) return res.status(400).json({ success: false, error: 'label, base_url, utm_source, utm_medium, utm_campaign required' });
      const campaignCheck = await pool.query('SELECT id FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
      const full_url = buildUtmUrl(base_url, { source: utm_source, medium: utm_medium, campaign: utm_campaign, term: utm_term, content: utm_content });
      const short_code = campaignShortCode();
      const { rows } = await pool.query(
        `INSERT INTO utm_links (id,campaign_id,user_id,label,base_url,utm_source,utm_medium,utm_campaign,utm_term,utm_content,short_code,full_url) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.params.id, auth.userId, label, base_url, utm_source, utm_medium, utm_campaign, utm_term || '', utm_content || '', short_code, full_url]
      );
      return res.status(201).json({ success: true, link: rows[0] });
    } catch (err) { logger.error('create utm link error:', err); return res.status(500).json({ success: false, error: 'Failed to create UTM link' }); }
  });

  // DELETE /api/campaign/utmlinks/:linkId
  router.delete('/utmlinks/:linkId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM utm_links WHERE id=$1 AND user_id=$2', [req.params.linkId, auth.userId]);
      return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete link' }); }
  });

  // GET /api/campaign/campaigns/:id/metrics
  router.get('/campaigns/:id/metrics', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const campaignCheck = await pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]);
      if (!campaignCheck.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      const campaign = campaignCheck.rows[0];
      const [linksRes, eventsRes, channelsRes, funnelsRes] = await Promise.all([
        pool.query(`SELECT utm_source, utm_medium, SUM(clicks) as clicks, SUM(conversions) as conversions FROM utm_links WHERE campaign_id=$1 GROUP BY utm_source, utm_medium ORDER BY clicks DESC`, [req.params.id]),
        pool.query(`SELECT event_type, DATE_TRUNC('day', created_at) as day, COUNT(*) as cnt FROM funnel_events WHERE campaign_id=$1 GROUP BY event_type, day ORDER BY day`, [req.params.id]),
        pool.query(`SELECT channel_type, status FROM campaign_channels WHERE campaign_id=$1 AND user_id=$2`, [req.params.id, auth.userId]),
        pool.query(`SELECT f.id, f.name, (SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_id=f.id) as total_events FROM funnels f WHERE f.campaign_id=$1`, [req.params.id]),
      ]);
      const totalClicks = linksRes.rows.reduce((s: number, r: any) => s + parseInt(r.clicks || 0), 0);
      const totalConversions = linksRes.rows.reduce((s: number, r: any) => s + parseInt(r.conversions || 0), 0);
      const conversionRate = totalClicks > 0 ? parseFloat(((totalConversions / totalClicks) * 100).toFixed(2)) : 0;
      return res.json({ success: true, campaign, metrics: { totalClicks, totalConversions, conversionRate, clicksBySource: linksRes.rows, eventTimeline: eventsRes.rows, channels: channelsRes.rows, funnels: funnelsRes.rows } });
    } catch (err) { logger.error('campaign metrics error:', err); return res.status(500).json({ success: false, error: 'Failed to fetch metrics' }); }
  });

  // GET /api/campaign/campaigns/:id/detail
  router.get('/campaigns/:id/detail', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const [campRes, channelsRes, kpisRes, contentRes, linksRes, funnelsRes] = await Promise.all([
        pool.query('SELECT * FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, auth.userId]),
        pool.query('SELECT * FROM campaign_channels WHERE campaign_id=$1 ORDER BY created_at', [req.params.id]),
        pool.query('SELECT * FROM campaign_kpis WHERE campaign_id=$1 ORDER BY sort_order,created_at', [req.params.id]),
        pool.query('SELECT * FROM campaign_content WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id]),
        pool.query('SELECT * FROM utm_links WHERE campaign_id=$1 AND user_id=$2 ORDER BY created_at DESC', [req.params.id, auth.userId]),
        pool.query('SELECT f.id,f.name,f.status,(SELECT COUNT(*) FROM funnel_steps fs WHERE fs.funnel_id=f.id) as steps,(SELECT COUNT(*) FROM funnel_events fe WHERE fe.funnel_id=f.id) as events FROM funnels f WHERE f.campaign_id=$1', [req.params.id]),
      ]);
      if (!campRes.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      const camp = campRes.rows[0];
      const now = Date.now();
      const start = camp.start_date ? new Date(camp.start_date).getTime() : now;
      const end = camp.end_date ? new Date(camp.end_date).getTime() : now;
      const totalDays = Math.max(1, Math.round((end - start) / 86400000));
      const elapsedDays = Math.max(0, Math.round((now - start) / 86400000));
      const progressPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
      const totalClicks = linksRes.rows.reduce((s: number, r: any) => s + parseInt(r.clicks || 0), 0);
      const totalConversions = linksRes.rows.reduce((s: number, r: any) => s + parseInt(r.conversions || 0), 0);
      const kpis = kpisRes.rows;
      const kpiProgress = kpis.length > 0 ? kpis.reduce((s: number, k: any) => s + Math.min(100, k.target_value > 0 ? (parseFloat(k.current_value) / parseFloat(k.target_value)) * 100 : 0), 0) / kpis.length : 0;
      const healthScore = Math.round((progressPct > 0 ? 20 : 0) + (channelsRes.rows.length > 0 ? 20 : 0) + (kpis.length > 0 ? 20 : 0) + (totalClicks > 0 ? 20 : 0) + (kpiProgress > 50 ? 20 : kpiProgress > 0 ? 10 : 0));
      return res.json({ success: true, campaign: camp, channels: channelsRes.rows, kpis, content: contentRes.rows, links: linksRes.rows, funnels: funnelsRes.rows, stats: { totalClicks, totalConversions, progressPct, elapsedDays, totalDays, kpiProgress: Math.round(kpiProgress), healthScore } });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch detail' }); }
  });

  // GET /api/campaign/campaigns/:id/kpis
  router.get('/campaigns/:id/kpis', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM campaign_kpis WHERE campaign_id=$1 AND user_id=$2 ORDER BY sort_order,created_at', [req.params.id, auth.userId]);
      return res.json({ success: true, kpis: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch KPIs' }); }
  });

  // POST /api/campaign/campaigns/:id/kpis
  router.post('/campaigns/:id/kpis', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, metric_type = 'number', target_value = 0, current_value = 0, unit = '', source = 'manual', sort_order = 0 } = req.body as any;
      if (!name) return res.status(400).json({ success: false, error: 'name required' });
      const { rows } = await pool.query(`INSERT INTO campaign_kpis (id,campaign_id,user_id,name,metric_type,target_value,current_value,unit,source,sort_order) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.params.id, auth.userId, name, metric_type, target_value, current_value, unit, source, sort_order]);
      return res.json({ success: true, kpi: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to create KPI' }); }
  });

  // PUT /api/campaign/kpis/:kpiId
  router.put('/kpis/:kpiId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { name, metric_type, target_value, current_value, unit, source, sort_order } = req.body as any;
      const { rows } = await pool.query(`UPDATE campaign_kpis SET name=COALESCE($1,name), metric_type=COALESCE($2,metric_type), target_value=COALESCE($3,target_value), current_value=COALESCE($4,current_value), unit=COALESCE($5,unit), source=COALESCE($6,source), sort_order=COALESCE($7,sort_order), updated_at=NOW() WHERE id=$8 AND user_id=$9 RETURNING *`, [name, metric_type, target_value, current_value, unit, source, sort_order, req.params.kpiId, auth.userId]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, kpi: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to update KPI' }); }
  });

  // DELETE /api/campaign/kpis/:kpiId
  router.delete('/kpis/:kpiId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM campaign_kpis WHERE id=$1 AND user_id=$2', [req.params.kpiId, auth.userId]);
      return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete KPI' }); }
  });

  // GET /api/campaign/campaigns/:id/activity
  router.get('/campaigns/:id/activity', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const limit = Math.min(100, parseInt(String(req.query.limit) || '50'));
      const { rows } = await pool.query(
        `SELECT fe.id, fe.event_type, fe.event_name, fe.url, fe.utm_source, fe.utm_medium, fe.utm_campaign, fe.referrer, fe.created_at, fs.name as step_name, f.name as funnel_name FROM funnel_events fe LEFT JOIN funnel_steps fs ON fs.id = fe.funnel_step_id LEFT JOIN funnels f ON f.id = fe.funnel_id WHERE fe.campaign_id=$1 ORDER BY fe.created_at DESC LIMIT $2`,
        [req.params.id, limit]
      );
      return res.json({ success: true, events: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch activity' }); }
  });

  // GET /api/campaign/campaigns/:id/content
  router.get('/campaigns/:id/content', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query('SELECT * FROM campaign_content WHERE campaign_id=$1 AND user_id=$2 ORDER BY created_at DESC', [req.params.id, auth.userId]);
      return res.json({ success: true, content: rows });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to fetch content' }); }
  });

  // POST /api/campaign/campaigns/:id/content
  router.post('/campaigns/:id/content', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { content_type = 'post', title = '', description = '', status = 'draft', channel = '', external_id, metrics } = req.body as any;
      const { rows } = await pool.query(`INSERT INTO campaign_content (id,campaign_id,user_id,content_type,title,description,status,channel,external_id,metrics) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`, [req.params.id, auth.userId, content_type, title, description, status, channel, external_id || null, JSON.stringify(metrics || {})]);
      return res.json({ success: true, item: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to add content' }); }
  });

  // DELETE /api/campaign/content/:contentId
  router.delete('/content/:contentId', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      await pool.query('DELETE FROM campaign_content WHERE id=$1 AND user_id=$2', [req.params.contentId, auth.userId]);
      return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to delete content' }); }
  });

  // PUT /api/campaign/campaigns/:id/launch
  router.put('/campaigns/:id/launch', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res); if (!auth) return;
      const { rows } = await pool.query(`UPDATE campaigns SET status='active', launched_at=NOW(), updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, auth.userId]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({ success: true, campaign: rows[0] });
    } catch (err) { return res.status(500).json({ success: false, error: 'Failed to launch campaign' }); }
  });

  return router;
}

export function registerTrackingRoutes({ pool }: { pool: Pool }): Router {
  const router = express.Router();

  // POST /api/track/click — public, no auth
  router.post('/click', async (req: Request, res: Response) => {
    try {
      if (!pool) return res.json({ success: true });
      const { campaign_id, funnel_id, funnel_step_id, session_id, visitor_id, url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, properties } = req.body as any;
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      await pool.query(
        `INSERT INTO funnel_events (id,funnel_id,funnel_step_id,campaign_id,session_id,visitor_id,event_type,url,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,properties,ip,user_agent) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,'click',$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
        [funnel_id || null, funnel_step_id || null, campaign_id || null, session_id || null, visitor_id || null, url || null, referrer || null, utm_source || null, utm_medium || null, utm_campaign || null, utm_term || null, utm_content || null, JSON.stringify(properties || {}), ip, req.headers['user-agent'] || null]
      );
      return res.json({ success: true });
    } catch (_err) { return res.json({ success: true }); }
  });

  // POST /api/track/event — public
  router.post('/event', async (req: Request, res: Response) => {
    try {
      if (!pool) return res.json({ success: true });
      const { campaign_id, funnel_id, funnel_step_id, event_type, event_name, session_id, visitor_id, url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, properties } = req.body as any;
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if ((event_type === 'conversion' || event_type === 'purchase') && campaign_id && utm_campaign) {
        await pool.query(`UPDATE utm_links SET conversions=conversions+1 WHERE campaign_id=$1 AND utm_campaign=$2`, [campaign_id, utm_campaign]).catch(() => undefined);
      }
      await pool.query(
        `INSERT INTO funnel_events (id,funnel_id,funnel_step_id,campaign_id,session_id,visitor_id,event_type,event_name,url,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,properties,ip,user_agent) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
        [funnel_id || null, funnel_step_id || null, campaign_id || null, session_id || null, visitor_id || null, event_type || 'custom', event_name || null, url || null, referrer || null, utm_source || null, utm_medium || null, utm_campaign || null, utm_term || null, utm_content || null, JSON.stringify(properties || {}), ip, req.headers['user-agent'] || null]
      );
      return res.json({ success: true });
    } catch (_err) { return res.json({ success: true }); }
  });

  return router;
}

export function registerShortLinkRoutes({ pool, fireAutomationTrigger }: {
  pool: Pool;
  fireAutomationTrigger?: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
}): Router {
  const router = express.Router();

  // GET /r/:shortCode — public UTM link redirect.
  // Append ?c=<contact_id> to attribute the click to a contact and fire their
  // link-click automation triggers.
  router.get('/:shortCode', async (req: Request, res: Response) => {
    try {
      if (!pool) return res.redirect('/');
      const { rows } = await pool.query('SELECT * FROM utm_links WHERE short_code=$1 LIMIT 1', [req.params.shortCode]);
      if (!rows[0]) return res.status(404).send('Link not found');
      pool.query('UPDATE utm_links SET clicks=clicks+1 WHERE id=$1', [rows[0].id]).catch(() => undefined);
      const contactId = String(req.query.c || '').trim();
      if (contactId && rows[0].user_id && fireAutomationTrigger) {
        void fireAutomationTrigger(rows[0].user_id, 'utm_link_clicked', { id: contactId }).catch(() => undefined);
        void fireAutomationTrigger(rows[0].user_id, 'link_click', { id: contactId }).catch(() => undefined);
      }
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      pool.query(`INSERT INTO funnel_events (id,campaign_id,event_type,url,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,ip,user_agent) VALUES (gen_random_uuid()::text,$1,'click',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [rows[0].campaign_id, rows[0].full_url, req.headers.referer || null, rows[0].utm_source, rows[0].utm_medium, rows[0].utm_campaign, rows[0].utm_term || null, rows[0].utm_content || null, ip, req.headers['user-agent'] || null]).catch(() => undefined);
      // Carry the contact id to the destination so the site tracking snippet
      // (/t.js) can correlate this visitor's future page views to the contact.
      let dest = rows[0].full_url as string;
      if (contactId && /^https?:\/\//i.test(dest)) {
        try {
          const u = new URL(dest);
          u.searchParams.set('cf_cid', contactId);
          dest = u.toString();
        } catch { /* keep original url */ }
      }
      return res.redirect(302, dest);
    } catch (_err) { return res.redirect('/'); }
  });

  return router;
}
