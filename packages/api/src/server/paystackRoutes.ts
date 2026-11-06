import { acceptPaystackEvent } from './creditJobs.ts';
import express from 'express';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import axios from 'axios';
import { buildPaystackService, getPaystackConfig, PaymentError, verifyPaystackSignature, type ConfigReader, type PaymentMode } from './paystackService.ts';
import { logger } from '../logger.ts';

export { getPaystackConfig } from './paystackService.ts';
type Auth = (req: Request, res: Response) => { userId: string } | null;
interface Deps { requireAuth: Auth; requireAdmin: (req: Request,res: Response) => Promise<unknown>; hasDatabase: () => boolean; pool: Pool; getPlatformConfig: ConfigReader; http?: Pick<typeof axios,'get' | 'post'> }

export function registerPaystackRoutes({ requireAuth, requireAdmin, hasDatabase, pool, getPlatformConfig, http = axios }: Deps) {
  const router = express.Router();
  const service = buildPaystackService({ pool, readConfig: getPlatformConfig, http });
  const ready = (res: Response) => { if (hasDatabase()) return true; res.status(503).json({ success: false,error: 'Database unavailable' }); return false; };
  const fail = (res: Response,error: unknown) => {
    logger.error({ err: error }, 'paystack_operation_failed');
    return res.status(error instanceof PaymentError ? error.status : 502).json({ success: false,error: error instanceof PaymentError ? error.message : 'Payment service unavailable. Please retry.' });
  };
  router.get('/payments/paystack/verify/:reference', async (req,res) => {
    const user = requireAuth(req,res); if (!user || !ready(res)) return;
    try { return res.json({ success: true,...await service.verify(String(req.params.reference),user.userId) }); }
    catch (error) { return fail(res,error); }
  });
  router.post('/payments/paystack/initiate', (_req,res) => res.status(410).json({ success: false,error: 'Use billing checkout or credit-pack checkout. Arbitrary client amounts are not accepted.' }));
  router.post('/payments/paystack/webhook', async (req,res) => {
    if (!ready(res)) return;
    try {
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const signature = String(req.headers['x-paystack-signature'] || '');
      if (!raw) return res.status(400).json({ received: false });
      let mode: PaymentMode | null = null;
      for (const candidate of ['test','live'] as const) {
        const cfg = await getPaystackConfig(getPlatformConfig,candidate);
        if (cfg && verifyPaystackSignature(raw,signature,cfg.secretKey)) { mode = candidate; break; }
      }
      if (!mode) return res.status(401).json({ received: false });
      const reference = String(req.body?.data?.reference || req.body?.data?.transaction_reference || '');
      if (reference) {
        const order = (await pool.query('SELECT mode FROM paystack_orders WHERE reference=$1',[reference])).rows[0];
        if (order && order.mode !== mode) return res.status(400).json({ received:false });
      }
      await acceptPaystackEvent(pool,mode,raw,req.body);
      return res.json({ received:true,queued:true });
    } catch (error) { return fail(res,error); }
  });
  router.get('/admin/paystack/orders', async (req,res) => {
    if (!await requireAdmin(req,res) || !ready(res)) return;
    const mode=req.query.mode==='test' ? 'test' : 'live';
    const { rows }=await pool.query(`SELECT reference AS id,reference AS client_reference,provider_transaction_id AS provider_reference,
      amount_subunits/100.0 AS amount,currency,kind AS description,status,'paystack' AS provider,mode,
      customer_email,created_at FROM paystack_orders WHERE mode=$1 ORDER BY created_at DESC LIMIT 200`,[mode]);
    const { rows: stats }=await pool.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='successful')::int AS successful,
      COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='failed')::int AS failed,
      COALESCE(SUM(amount_subunits/100.0) FILTER(WHERE status='successful'),0) AS revenue FROM paystack_orders WHERE mode=$1 AND currency=$2`,[mode,(await getPaystackConfig(getPlatformConfig))?.currency || 'GHS']);
    return res.json({ success: true,mode,transactions: rows,stats: stats[0] });
  });
  router.post('/admin/paystack/test', async (req,res) => {
    if (!await requireAdmin(req,res)) return;
    try {
      const mode = req.body?.mode;
      if (mode && mode !== 'test' && mode !== 'live') throw new PaymentError('Invalid mode');
      const cfg = await getPaystackConfig(getPlatformConfig,mode);
      if (!cfg) throw new PaymentError('Save credentials for this mode first');
      const response = await axios.get('https://api.paystack.co/transaction?perPage=1',{ headers: { Authorization: `Bearer ${cfg.secretKey}` },timeout: 10_000 });
      if (!response.data?.status) throw new PaymentError('Paystack rejected these credentials',502);
      return res.json({ success: true,mode: cfg.mode,currency: cfg.currency });
    } catch (error) { return fail(res,error); }
  });
  return router;
}
