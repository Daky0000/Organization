import type { Response, NextFunction } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { createHmac, randomUUID } from 'crypto';
import { safeAxios } from '../ssrf-guard.ts';
import { isValidWebhookUrl } from '../integration-helpers.ts';
import { logger } from '../logger.ts';

export type QuotaResourceType =
  | 'social_accounts'
  | 'automations'
  | 'agent_schedules'
  | 'outbound_webhooks'
  | 'approval_links';

export interface PlanQuotaLimits {
  social_accounts: number;
  automations: number;
  agent_schedules: number;
  outbound_webhooks: number;
  approval_links: number;
}

export const PLAN_QUOTA_BY_TIER: Record<string, PlanQuotaLimits> = {
  free: {
    social_accounts: 2,
    automations: 3,
    agent_schedules: 2,
    outbound_webhooks: 2,
    approval_links: 5,
  },
  starter: {
    social_accounts: 10,
    automations: 15,
    agent_schedules: 10,
    outbound_webhooks: 10,
    approval_links: 50,
  },
  growth: {
    social_accounts: 25,
    automations: 50,
    agent_schedules: 30,
    outbound_webhooks: 25,
    approval_links: 250,
  },
  pro: {
    // Was 8 — fewer than Starter's 10, so "upgrading" to Pro took accounts away,
    // and a DakyX retainer granting Pro would have been a downgrade.
    social_accounts: 50,
    automations: 100,
    agent_schedules: 75,
    outbound_webhooks: 50,
    approval_links: 1000,
  },
  agency: {
    social_accounts: 9999,
    automations: 9999,
    agent_schedules: 9999,
    outbound_webhooks: 9999,
    approval_links: 9999,
  },
};

export type PlanTierKey = keyof typeof PLAN_QUOTA_BY_TIER;

/** Lowest first. A grant from DakyX names one of these keys, never a display name. */
export const PLAN_TIER_ORDER: PlanTierKey[] = ['free', 'starter', 'growth', 'pro', 'agency'];
export const PLAN_TIER_NAMES: Record<PlanTierKey, string> = { free: 'Free', starter: 'Starter', growth: 'Growth', pro: 'Pro', agency: 'Agency' };

export function isPlanTierKey(value: unknown): value is PlanTierKey {
  return typeof value === 'string' && (PLAN_TIER_ORDER as string[]).includes(value);
}

/**
 * A locally sold plan's tier, guessed from its name. Only for `pricing_plans`
 * rows, which have no tier column yet; a canonical name ('Pro', 'Agency' …)
 * resolves exactly before any guessing happens.
 */
export function resolvePlanTierKey(planName: string | null | undefined): PlanTierKey {
  const normalized = String(planName || 'starter').trim().toLowerCase();
  if ((PLAN_TIER_ORDER as string[]).includes(normalized)) return normalized as PlanTierKey;
  if (normalized.includes('agency') || normalized.includes('enterprise')) return 'agency';
  if (normalized.includes('pro') || normalized.includes('scale')) return 'pro';
  if (normalized.includes('growth') || normalized.includes('business')) return 'growth';
  if (normalized.includes('free') || normalized.includes('trial')) return 'free';
  return 'starter';
}

export function resolvePlanQuotaLimits(planName: string | null | undefined): PlanQuotaLimits {
  return PLAN_QUOTA_BY_TIER[resolvePlanTierKey(planName)];
}

export async function checkPlanQuota(
  pool: Pool | null,
  userId: string,
  resource: QuotaResourceType,
  userPlanName?: string
): Promise<{
  allowed: boolean;
  currentCount: number;
  limit: number;
  planName: string;
  resource: QuotaResourceType;
}> {
  const planName = userPlanName || 'Starter';
  const limits = resolvePlanQuotaLimits(planName);
  const limit = limits[resource] ?? 10;

  if (!pool) {
    return { allowed: false, currentCount: 0, limit, planName, resource };
  }

  let querySql = '';
  switch (resource) {
    case 'social_accounts':
      querySql = `SELECT COUNT(*)::int AS cnt FROM social_accounts WHERE user_id = $1`;
      break;
    case 'automations':
      querySql = `SELECT COUNT(*)::int AS cnt FROM mailing_automations WHERE user_id = $1 AND status = 'active'`;
      break;
    case 'agent_schedules':
      querySql = `SELECT COUNT(*)::int AS cnt FROM agent_schedules WHERE user_id = $1 AND is_active = true`;
      break;
    case 'outbound_webhooks':
      querySql = `SELECT COUNT(*)::int AS cnt FROM outbound_webhooks WHERE user_id = $1 AND is_active = true`;
      break;
    case 'approval_links':
      querySql = `SELECT COUNT(*)::int AS cnt FROM client_approval_links WHERE user_id = $1`;
      break;
  }

  try {
    const { rows } = await pool.query(querySql, [userId]);
    const currentCount = Number(rows[0]?.cnt || 0);
    return {
      allowed: currentCount < limit,
      currentCount,
      limit,
      planName,
      resource,
    };
  } catch {
    return { allowed: false, currentCount: 0, limit, planName, resource };
  }
}

export function createPlanQuotaGuard(
  pool: Pool | null,
  requireAuth: (req: Request, res: Response) => { userId: string } | null,
  getUserPlanName: (userId: string) => Promise<string>,
  resource: QuotaResourceType
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const planName = await getUserPlanName(auth.userId).catch(() => 'Starter');
    const result = await checkPlanQuota(pool, auth.userId, resource, planName);
    if (!result.allowed) {
      return res.status(402).json({
        success: false,
        code: 'PLAN_QUOTA_EXCEEDED',
        error: `You have reached the ${resource.replace(/_/g, ' ')} limit (${result.currentCount}/${result.limit}) for your ${result.planName} plan. Upgrade your plan to unlock higher limits.`,
        resource: result.resource,
        currentCount: result.currentCount,
        limit: result.limit,
        currentPlan: result.planName,
      });
    }
    return next();
  };
}

// ── Outbound Webhook Signing & Dispatch ──────────────────────────────────────

export function computeWebhookSignature(secret: string, timestamp: number | string, rawBody: string): string {
  return `t=${timestamp},v1=` + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export async function dispatchOutboundWebhooks(pool: Pool | null,userId: string,eventName: string,data: Record<string,unknown>): Promise<{ dispatched: number }> {
  if (!pool) throw new Error('Webhook queue is unavailable');
  const { rows }=await pool.query(`SELECT id FROM outbound_webhooks WHERE user_id=$1 AND is_active=true AND ($2=ANY(events) OR '*'=ANY(events))`,[userId,eventName]);
  for (const hook of rows) {
    const id=randomUUID();
    await pool.query('INSERT INTO webhook_outbox(id,webhook_id,user_id,event_name,payload) VALUES($1,$2,$3,$4,$5::jsonb)',
      [id,hook.id,userId,eventName,JSON.stringify({ id,event: eventName,created_at: new Date().toISOString(),data })]);
  }
  return { dispatched: rows.length };
}

export async function processOutboundWebhookJobs(pool: Pool): Promise<void> {
  const { rows }=await pool.query(`WITH due AS (SELECT id FROM webhook_outbox WHERE status IN ('pending','processing') AND run_at<=NOW()
    ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 10)
    UPDATE webhook_outbox o SET status='processing',run_at=NOW()+INTERVAL '5 minutes' FROM due WHERE o.id=due.id RETURNING o.*`);
  for (const job of rows) {
    const started=Date.now();let code=599;let excerpt='';
    try {
      const hook=(await pool.query('SELECT target_url,signing_secret,is_active FROM outbound_webhooks WHERE id=$1 AND user_id=$2',[job.webhook_id,job.user_id])).rows[0];
      if (!hook?.is_active) { await pool.query("UPDATE webhook_outbox SET status='canceled' WHERE id=$1",[job.id]);continue; }
      if (!isValidWebhookUrl(hook.target_url)) throw new Error('Invalid webhook target');
      const payload=JSON.stringify(job.payload);
      const response=await safeAxios({ method: 'POST',url: hook.target_url,data: payload,timeout: 8000,maxRedirects: 0,
        maxContentLength: 65536,headers: { 'Content-Type': 'application/json','X-ContentFlow-Event': job.event_name,
        'X-ContentFlow-Signature': computeWebhookSignature(hook.signing_secret,Math.floor(Date.now()/1000),payload) },validateStatus: () => true });
      code=response.status;excerpt=typeof response.data==='string' ? response.data.slice(0,300) : JSON.stringify(response.data).slice(0,300);
      if (code<200 || code>=300) throw new Error(`Target returned HTTP ${code}`);
      await pool.query("UPDATE webhook_outbox SET status='completed',attempts=attempts+1,last_error=NULL WHERE id=$1",[job.id]);
    } catch(error) {
      const message=error instanceof Error ? error.message : 'Delivery failed';
      const retryMinutes=Math.min(60,2 ** Number(job.attempts));
      await pool.query(`UPDATE webhook_outbox SET status=CASE WHEN attempts>=7 THEN 'failed' ELSE 'pending' END,
        attempts=attempts+1,run_at=NOW()+$2::int*INTERVAL '1 minute',last_error=$3 WHERE id=$1`,[job.id,retryMinutes,message.slice(0,300)]);
      excerpt=message.slice(0,300);
    }
    await pool.query(`INSERT INTO outbound_webhook_deliveries(id,webhook_id,user_id,event_name,payload,status_code,response_excerpt,duration_ms)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,[randomUUID(),job.webhook_id,job.user_id,job.event_name,JSON.stringify(job.payload),code,excerpt,Date.now()-started]);
    await pool.query('UPDATE outbound_webhooks SET last_triggered_at=NOW(),last_status_code=$2,failure_count=CASE WHEN $2>=200 AND $2<300 THEN 0 ELSE failure_count+1 END WHERE id=$1',[job.webhook_id,code]);
  }
}
