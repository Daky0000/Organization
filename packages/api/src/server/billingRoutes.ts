import express from 'express';
import type { Pool } from 'pg';
import { buildPaystackService, getPaystackConfig, type ConfigReader, PaymentError } from './paystackService.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '../logger.ts';
import { validateBody } from '../middleware/validate.ts';

const checkoutSchema = z.object({
  planId: z.string().min(1, 'planId is required'),
  period: z.enum(['monthly', 'yearly']).default('monthly'),
}).passthrough();

const adminPlanSchema = z.object({
  planId: z.string().min(1).nullish(),
}).passthrough();

type AuthResult = { userId: string; email?: string; role?: string } | null;
type RequireAuthFn = (req: Request, res: Response) => AuthResult;
type RequireAdminFn = (req: Request, res: Response) => Promise<AuthResult>;
type DbQueryFn = <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;

type BillingDeps = {
  requireAuth: RequireAuthFn;
  hasDatabase: () => boolean;
  dbQuery: DbQueryFn;
  pool: Pool;
  getPlatformConfig: ConfigReader;
};

/**
 * Registers all billing routes and returns the Express Router.
 * Mount at canonical + compat paths:
 *   app.use('/api/v1/billing', billingRouter);
 *   app.use('/api/billing', deprecate(), billingRouter);
 */
export function registerBillingRoutes({
  requireAuth,
  hasDatabase,
  dbQuery,
  pool,
  getPlatformConfig,
}: BillingDeps): Router {
  const router = express.Router();
  const payments = buildPaystackService({ pool, readConfig: getPlatformConfig });

  // GET /subscription — current plan + usage + subscription status
  router.get('/subscription', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, subscription: null, plan: null, usage: null });
    try {
      const { rows: subRows } = await dbQuery(
        `SELECT s.*, p.name AS plan_name, p.price, p.billing_period, p.features, p.post_limit, p.user_limit
         FROM subscriptions s
         LEFT JOIN pricing_plans p ON p.id = s.plan_id
         WHERE s.user_id = $1`,
        [auth.userId],
      );
      const { rows: userRows } = await dbQuery(
        `SELECT u.id, p.name AS plan_name, p.price, p.billing_period, p.features, p.post_limit, p.user_limit, p.id AS plan_id
         FROM users u LEFT JOIN pricing_plans p ON p.id = u.plan_id WHERE u.id=$1`,
        [auth.userId],
      );
      const user = (userRows as any[])[0];
      const sub = (subRows as any[])[0] || null;
      const expired = Boolean(sub?.current_period_end && new Date(sub.current_period_end).getTime() <= Date.now());
      if (expired && sub.status === 'active') sub.status = 'expired';
      const entitled = Boolean(sub && ['active', 'trialing'].includes(sub.status) && !expired);
      const freePlan = (!entitled ? (await dbQuery("SELECT * FROM pricing_plans WHERE LOWER(name)='free' AND is_active=true LIMIT 1")).rows[0] : null) as any;

      const { rows: usageRows } = await dbQuery(
        `SELECT COUNT(*)::int AS posts_this_period FROM publishing_logs WHERE user_id=$1 AND status='published' AND created_at >= date_trunc('month', NOW())`,
        [auth.userId],
      ).catch(() => ({ rows: [{ posts_this_period: 0 }] }));

      const postLimit = entitled ? sub.post_limit : freePlan?.post_limit ?? null;
      const usage = {
        posts_this_period: (usageRows as any[])[0]?.posts_this_period ?? 0,
        posts_limit: postLimit,
      };

      res.json({
        success: true,
        subscription: sub,
        plan: entitled
          ? { id: sub.plan_id, name: sub.plan_name, price: sub.price, billing_period: sub.billing_period, features: sub.features, post_limit: sub.post_limit, user_limit: sub.user_limit }
          : (freePlan ? { id: freePlan.id, name: freePlan.name, price: freePlan.price, billing_period: freePlan.billing_period, features: freePlan.features, post_limit: freePlan.post_limit, user_limit: freePlan.user_limit } : null),
        usage,
        paystackConfigured: Boolean(await getPaystackConfig(getPlatformConfig)),
        paymentMode: (await getPaystackConfig(getPlatformConfig))?.mode || 'test',
        renewalType: 'prepaid',
        sandbox: (await dbQuery('SELECT * FROM paystack_sandbox_accounts WHERE user_id=$1', [auth.userId])).rows[0] || null,
      });
    } catch (_e) {
      res.status(500).json({ success: false, error: 'Failed to load subscription' });
    }
  });

  // GET /invoices
  router.get('/invoices', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, invoices: [] });
    try {
      const { rows } = await dbQuery(
        `SELECT id, paystack_reference, invoice_number, status, total_cents, currency, hosted_invoice_url, invoice_pdf, paid_at, period_start, period_end, created_at
         FROM billing_invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [auth.userId],
      );
      res.json({ success: true, invoices: rows });
    } catch (_e) {
      res.status(500).json({ success: false, error: 'Failed to load invoices' });
    }
  });

  // POST /checkout: server-priced Paystack checkout.
  router.post('/checkout', validateBody(checkoutSchema), async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { planId, period = 'monthly' } = req.body as { planId: string; period?: 'monthly' | 'yearly' };
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows: planRows } = await dbQuery(
        `SELECT * FROM pricing_plans WHERE id=$1 AND is_active=true`,
        [planId],
      );
      if (!(planRows as any[]).length) return res.status(404).json({ success: false, error: 'Plan not found' });
      const plan = (planRows as any[])[0];

      const { rows: userRows } = await dbQuery(`SELECT email, full_name FROM users WHERE id=$1`, [auth.userId]);
      if (!(userRows as any[]).length) return res.status(404).json({ success: false, error: 'User not found' });
      const userRow = (userRows as any[])[0];

      if (plan.billing_period !== period) return res.status(400).json({ success: false, error: 'Select the plan for the requested billing period.' });
      return res.json({ success: true, provider: 'paystack', ...await payments.checkout(auth.userId, 'plan', planId) });
    } catch (e: any) {
      logger.error({ err: e }, 'checkout_error');
      res.status(e instanceof PaymentError ? e.status : 502).json({ success: false, error: e instanceof PaymentError ? e.message : 'Failed to create checkout session' });
    }
  });

  // Prepaid plans renew through a new checkout; this route opens the plan selection page.
  router.post('/portal', async (req, res) => {
    if (!requireAuth(req,res)) return;
    return res.json({ success: true, url: '/pricing' });
  });
  for (const [route, canceled] of [['cancel', true], ['reactivate', false]] as const) {
    router.post(`/${route}`, async (req,res) => {
      const user = requireAuth(req,res); if (!user) return;
      if (!hasDatabase()) return res.status(503).json({ success: false,error: 'Database unavailable' });
      const result = await dbQuery("UPDATE subscriptions SET cancel_at_period_end=$2,updated_at=NOW() WHERE user_id=$1 AND status='active' AND current_period_end>NOW() RETURNING id", [user.userId,canceled]);
      if (!result.rows.length) return res.status(404).json({ success: false,error: 'No active paid period found' });
      return res.json({ success: true });
    });
  }

  return router;
}

type AdminBillingDeps = {
  requireAdmin: RequireAdminFn;
  hasDatabase: () => boolean;
  dbQuery: DbQueryFn;
};

export function registerAdminBillingRoutes({ requireAdmin, hasDatabase, dbQuery }: AdminBillingDeps): Router {
  const router = express.Router();

  // GET /api/admin/billing/metrics — MRR, ARR, customer counts
  router.get('/admin/billing/metrics', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true, metrics: {} });
    try {
      const { rows: subStats } = await dbQuery(`
        SELECT
          COUNT(*)::int AS total_subscriptions,
          COUNT(*) FILTER (WHERE s.status = 'active')::int AS active_subscriptions,
          COUNT(*) FILTER (WHERE s.status = 'past_due')::int AS past_due_subscriptions,
          COUNT(*) FILTER (WHERE s.status = 'canceled')::int AS canceled_subscriptions,
          COUNT(*) FILTER (WHERE s.created_at >= date_trunc('month', NOW()))::int AS new_this_month,
          COUNT(*) FILTER (WHERE s.status = 'canceled' AND s.canceled_at >= date_trunc('month', NOW()))::int AS canceled_this_month,
          SUM(p.price) FILTER (WHERE s.status = 'active' AND p.billing_period = 'monthly') AS monthly_revenue,
          SUM(p.price / 12) FILTER (WHERE s.status = 'active' AND p.billing_period = 'yearly') AS yearly_revenue_monthly
        FROM subscriptions s
        LEFT JOIN pricing_plans p ON p.id = s.plan_id
      `);
      const { rows: totalUsers } = await dbQuery(`SELECT COUNT(*)::int AS cnt FROM users`);
      const { rows: planBreakdown } = await dbQuery(`
        SELECT p.name AS plan_name, p.price, p.billing_period,
          COUNT(s.id)::int AS subscriber_count,
          SUM(CASE WHEN p.billing_period='monthly' THEN p.price WHEN p.billing_period='yearly' THEN p.price/12 ELSE 0 END) AS mrr_contribution
        FROM subscriptions s
        JOIN pricing_plans p ON p.id = s.plan_id
        WHERE s.status = 'active'
        GROUP BY p.id, p.name, p.price, p.billing_period
        ORDER BY mrr_contribution DESC NULLS LAST
      `);
      const { rows: recentTxn } = await dbQuery(`
        SELECT bi.id, bi.invoice_number, bi.total_cents, bi.currency, bi.paid_at, bi.status,
               bi.hosted_invoice_url, bi.created_at, u.email
        FROM billing_invoices bi JOIN users u ON u.id=bi.user_id
        ORDER BY bi.created_at DESC LIMIT 10
      `);
      const s = subStats[0] || {};
      const monthlyMRR = parseFloat(s.monthly_revenue || '0');
      const yearlyMRR = parseFloat(s.yearly_revenue_monthly || '0');
      const mrr = monthlyMRR + yearlyMRR;
      const arr = mrr * 12;
      const activeCount = s.active_subscriptions || 0;
      const arpu = activeCount > 0 ? mrr / activeCount : 0;
      res.json({
        success: true,
        metrics: {
          mrr: Math.round(mrr * 100) / 100,
          arr: Math.round(arr * 100) / 100,
          arpu: Math.round(arpu * 100) / 100,
          total_users: totalUsers[0]?.cnt || 0,
          active_subscriptions: activeCount,
          past_due: s.past_due_subscriptions || 0,
          canceled: s.canceled_subscriptions || 0,
          new_this_month: s.new_this_month || 0,
          canceled_this_month: s.canceled_this_month || 0,
        },
        plan_breakdown: planBreakdown,
        recent_invoices: recentTxn,
        payment_provider: 'paystack',
      });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load billing metrics' });
    }
  });

  // GET /api/admin/billing/customers — paginated customer list with billing info
  router.get('/admin/billing/customers', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true, customers: [], total: 0 });
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 100);
    const offset = parseInt(String(req.query.offset || '0'));
    const search = String(req.query.search || '').trim();
    try {
      const searchClause = search ? `AND (u.email ILIKE $3 OR u.full_name ILIKE $3)` : '';
      const params: unknown[] = [limit, offset];
      if (search) params.push(`%${search}%`);
      const { rows: customers } = await dbQuery(
        `SELECT u.id, u.email, u.full_name, u.created_at, u.plan_id,
          p.name AS plan_name, p.price, p.billing_period,
          s.status AS subscription_status, s.current_period_end, s.cancel_at_period_end
         FROM users u
         LEFT JOIN pricing_plans p ON p.id = u.plan_id
         LEFT JOIN subscriptions s ON s.user_id = u.id
         WHERE u.role != 'admin' ${searchClause}
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      );
      const { rows: countRow } = await dbQuery(
        `SELECT COUNT(*)::int AS total FROM users u WHERE u.role != 'admin' ${search ? "AND (u.email ILIKE $1 OR u.full_name ILIKE $1)" : ''}`,
        search ? [`%${search}%`] : []
      );
      res.json({ success: true, customers, total: countRow[0]?.total || 0 });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to load customers' });
    }
  });

  // PUT /api/admin/billing/customers/:userId/plan — manually assign plan
  router.put('/admin/billing/customers/:userId/plan', validateBody(adminPlanSchema), async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { userId } = req.params;
    const { planId } = req.body as { planId: string | null };
    try {
      await dbQuery(`UPDATE users SET plan_id=$1 WHERE id=$2`, [planId || null, userId]);
      if (planId) {
        await dbQuery(
          `INSERT INTO subscriptions (id, user_id, plan_id, status, updated_at) VALUES ($1,$2,$3,'active',NOW())
           ON CONFLICT (user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id, status='active', updated_at=NOW()`,
          [randomUUID(), userId, planId]
        );
      } else {
        await dbQuery(`UPDATE subscriptions SET status='canceled', canceled_at=NOW(), updated_at=NOW() WHERE user_id=$1`, [userId]);
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  });

  return router;
}
