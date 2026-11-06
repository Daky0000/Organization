import axios from 'axios';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { buildPaystackService, getPaystackConfig, type ConfigReader, type PaymentMode } from './paystackService.ts';
import { account, creditAllowance, CreditError, lockWallet, transaction, walletTable } from './creditAccounting.ts';
import { creditCatalog, creditFeature } from './creditCatalog.ts';
import { applyRefund } from './creditRefunds.ts';
import { decryptIntegrationSecret } from '../integration-helpers.ts';
import { logger } from '../logger.ts';

type Http = Pick<typeof axios,'get'|'post'>;
export { creditAllowance } from './creditAccounting.ts';
export async function acceptPaystackEvent(pool: Pool,mode: PaymentMode,raw: Buffer,payload: any) {
  const id=createHash('sha256').update(mode).update(raw).digest('hex');
  await pool.query('INSERT INTO paystack_event_inbox(id,mode,event_name,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING',[id,mode,String(payload.event || ''),JSON.stringify(payload)]);
}
export function buildCreditJobs(pool: Pool,read: ConfigReader,http: Http=axios) {
  const payments=buildPaystackService({ pool,readConfig:read,http });
  const requestOptions=(secret: string)=>({ headers:{ Authorization:`Bearer ${secret}` },timeout:15000 });

  async function reconcileRefund(reference: string,mode: PaymentMode) {
    const order=await payments.orderByReference(reference);
    if(order.mode!==mode) throw new CreditError('Refund mode mismatch');
    const cfg=await getPaystackConfig(read,mode); if(!cfg) throw new CreditError('Refund credentials unavailable',503);
    const result=await http.get('https://api.paystack.co/refund',{ ...requestOptions(cfg.secretKey),params:{ transaction:order.provider_transaction_id,perPage:100 } });
    if(!result.data?.status || !Array.isArray(result.data.data)) throw new CreditError('Refund verification unavailable',502);
    const refunds=result.data.data.filter((r:any)=>String(r.transaction?.id || r.transaction)===String(order.provider_transaction_id) && r.domain===mode && r.currency===order.currency);
    for(const refund of refunds) {
      const internal=(await pool.query('SELECT admin_id FROM credit_refunds WHERE order_reference=$1',[reference])).rows[0]?.admin_id;
      await applyRefund(pool,reference,mode,Number(refund.amount)===Number(order.amount_subunits) ? refund.status : 'dispute',String(refund.id),!internal);
    }
    return refunds.length;
  }
  async function submitRefund(reference: string) {
    const claim=await pool.query("UPDATE credit_refunds SET status='submitting',updated_at=NOW() WHERE order_reference=$1 AND status='reserved' RETURNING *",[reference]);
    if(!claim.rows[0]) return;
    const refund=claim.rows[0]; const order=await payments.orderByReference(reference);
    try {
      const cfg=await getPaystackConfig(read,order.mode); if(!cfg) throw new CreditError('Refund credentials unavailable',503);
      const result=await http.post('https://api.paystack.co/refund',{ transaction:order.provider_transaction_id,amount:order.amount_subunits,currency:order.currency,merchant_note:refund.reason },requestOptions(cfg.secretKey));
      if(!result.data?.status || !result.data?.data?.id) throw new CreditError('Refund submission needs reconciliation',502);
      await pool.query("UPDATE credit_refunds SET provider_refund_id=$2,status='pending',updated_at=NOW() WHERE order_reference=$1 AND status='submitting'",[reference,String(result.data.data.id)]);
      await reconcileRefund(reference,order.mode);
    } catch(error) {
      // A network or provider failure is ambiguous. Never create a second refund blindly.
      await pool.query("UPDATE credit_refunds SET status='unknown',last_error=$2,updated_at=NOW() WHERE order_reference=$1 AND status='submitting'",[reference,error instanceof Error ? error.message.slice(0,200) : 'Refund request failed']);
    }
  }
  async function events() {
    const { rows }=await pool.query(`WITH due AS (SELECT id FROM paystack_event_inbox WHERE status IN ('pending','processing') AND run_at<=NOW() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      UPDATE paystack_event_inbox e SET status='processing',attempts=attempts+1,run_at=NOW()+INTERVAL '5 minutes' FROM due WHERE e.id=due.id RETURNING e.*`);
    for(const event of rows) {
      try {
        const data=event.payload.data || {};
        const reference=String(data.reference || data.transaction_reference || data.transaction?.reference || '');
        let order;
        if(reference) order=(await pool.query('SELECT * FROM paystack_orders WHERE reference=$1',[reference])).rows[0];
        if(!order && data.transaction?.id) order=(await pool.query('SELECT * FROM paystack_orders WHERE provider_transaction_id=$1 AND mode=$2',[String(data.transaction.id),event.mode])).rows[0];
        if(order && order.mode!==event.mode) throw new CreditError('Webhook mode mismatch');
        if(order && event.event_name==='charge.success') await payments.verify(order.reference);
        else if(order && event.event_name.startsWith('refund.')) await reconcileRefund(order.reference,event.mode);
        else if(order && event.event_name.startsWith('charge.dispute.')) await applyRefund(pool,order.reference,event.mode,'dispute',undefined,true);
        await pool.query("UPDATE paystack_event_inbox SET status='completed',last_error=NULL WHERE id=$1",[event.id]);
      } catch(error) {
        await pool.query('UPDATE paystack_event_inbox SET status=$2,last_error=$3 WHERE id=$1',[event.id,event.attempts>=8?'failed':'pending',error instanceof Error ? error.message.slice(0,200) : 'Event processing failed']);
      }
    }
  }
  async function pause(userId: string,mode: PaymentMode,reason: string) {
    const result=await pool.query('UPDATE credit_recharge_agreements SET enabled=false,pause_reason=$3,updated_at=NOW() WHERE user_id=$1 AND mode=$2 AND enabled RETURNING user_id',[userId,mode,reason]);
    if(result.rowCount) await pool.query("INSERT INTO notifications(user_id,type,title,message,data) VALUES($1,'info','Automatic recharge paused',$2,$3::jsonb)",[userId,reason,JSON.stringify({ mode,url:'/credits' })]);
  }
  async function sweep() {
    const { rows }=await pool.query('SELECT * FROM credit_recharge_agreements WHERE enabled');
    const configured=await read('paystack');
    for(const agreement of rows) {
      if((configured.mode || process.env.PAYSTACK_MODE || 'test')!==agreement.mode)continue;
      if(!creditFeature('recharge',agreement.mode)) continue;
      const balance=await account(pool,agreement.user_id,agreement.mode==='live'?await creditAllowance(pool,agreement.user_id):0,agreement.mode);
      if(balance.credits<agreement.threshold && !balance.spendingBlocked) await pool.query(`INSERT INTO credit_recharge_jobs(id,user_id,mode) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[randomUUID(),agreement.user_id,agreement.mode]);
    }
  }
  async function recharge() {
    const { rows: jobs }=await pool.query(`WITH due AS (SELECT id FROM credit_recharge_jobs WHERE status IN ('pending','processing') AND run_at<=NOW() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      UPDATE credit_recharge_jobs j SET status='processing',run_at=NOW()+INTERVAL '5 minutes' FROM due WHERE j.id=due.id RETURNING j.*`);
    for(const job of jobs) {
      try {
        const prepared=await transaction(pool,async client=>{
          const agreement=(await client.query('SELECT * FROM credit_recharge_agreements WHERE user_id=$1 AND mode=$2 FOR UPDATE',[job.user_id,job.mode])).rows[0];
          const jobRow=(await client.query('SELECT * FROM credit_recharge_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
          if(jobRow.order_reference) return null;
          const wallet=await lockWallet(client,job.user_id,job.mode);
          const user=(await client.query('SELECT email,status,role FROM users WHERE id=$1',[job.user_id])).rows[0];
          const method=(await client.query('SELECT * FROM credit_payment_methods WHERE id=$1 AND user_id=$2 AND mode=$3 AND active',[agreement?.method_id,job.user_id,job.mode])).rows[0];
          if(!agreement?.enabled || !creditFeature('recharge',job.mode) || user?.status!=='active' || (job.mode==='test' && user.role!=='admin') || wallet.spending_blocked || !method || Number(wallet.credits)-Number(wallet.reserved_credits)>=agreement.threshold) {
            await client.query("UPDATE credit_recharge_jobs SET status='cancelled' WHERE id=$1",[job.id]);return null;
          }
          const catalog=await creditCatalog(pool,read,job.mode);
          const pack=catalog.packs.find(p=>p.id===agreement.pack_id);
          const configured=await read('paystack');
          if((configured.mode || process.env.PAYSTACK_MODE || 'test')!==job.mode) {
            await client.query("UPDATE credit_recharge_jobs SET status='cancelled' WHERE id=$1",[job.id]);return null;
          }
          if(!catalog.cfg || !catalog.rechargeAvailable || !pack || pack.termsVersion!==agreement.catalog_version || pack.amountSubunits!==agreement.amount_subunits || catalog.currency!==agreement.currency) {
            await client.query("UPDATE credit_recharge_agreements SET enabled=false,pause_reason='Pricing changed. Renew consent.' WHERE user_id=$1 AND mode=$2",[job.user_id,job.mode]);
            await client.query("UPDATE credit_recharge_jobs SET status='cancelled' WHERE id=$1",[job.id]);return null;
          }
          const counts=(await client.query(`SELECT COUNT(*) FILTER(WHERE submitted_at>=date_trunc('month',NOW()) AND status NOT IN ('failed','cancelled'))::int AS monthly,
            COUNT(*) FILTER(WHERE submitted_at>NOW()-INTERVAL '24 hours')::int AS recent FROM credit_recharge_jobs WHERE user_id=$1 AND mode=$2`,[job.user_id,job.mode])).rows[0];
          if(counts.monthly>=agreement.monthly_limit || counts.recent>0) {
            await client.query("UPDATE credit_recharge_jobs SET status='pending',run_at=NOW()+INTERVAL '1 hour' WHERE id=$1",[job.id]);return null;
          }
          const authorization=JSON.parse(decryptIntegrationSecret(method.authorization_encrypted));
          const month=Number(method.exp_month),year=Number(method.exp_year);const expiry=Date.UTC(year,month,1);
          if(!authorization.reusable || !authorization.authorization_code || !Number.isInteger(month) || month<1 || month>12 || !Number.isInteger(year) || year<2000 || !Number.isFinite(expiry) || expiry<=Date.now()) {
            await client.query("UPDATE credit_recharge_agreements SET enabled=false,pause_reason='Card expired or unavailable' WHERE user_id=$1 AND mode=$2",[job.user_id,job.mode]);
            await client.query("INSERT INTO notifications(user_id,type,title,message,data) VALUES($1,'info','Automatic recharge paused','Card expired or unavailable. Update your card and renew consent.',$2::jsonb)",[job.user_id,JSON.stringify({ mode:job.mode,url:'/credits' })]);
            await client.query("UPDATE credit_recharge_jobs SET status='failed' WHERE id=$1",[job.id]);return null;
          }
          const reference=`dw-${job.mode}-${randomUUID().replaceAll('-','')}`;
          await client.query(`INSERT INTO paystack_orders(reference,user_id,mode,kind,pack_id,credits,amount_subunits,currency,customer_email,pack_name,price_usd,fx_rate,catalog_version,purchase_source)
            VALUES($1,$2,$3,'credits',$4,$5,$6,$7,$8,$9,$10,$11,$12,'recharge')`,[reference,job.user_id,job.mode,pack.id,pack.credits,pack.amountSubunits,catalog.currency,method.email,pack.name,pack.priceUsd,catalog.cfg.fxRate,catalog.version]);
          await client.query("UPDATE credit_recharge_jobs SET order_reference=$2,status='submitted',submitted_at=NOW() WHERE id=$1",[job.id,reference]);
          return { reference,cfg:catalog.cfg,method,authorization,amount:pack.amountSubunits };
        });
        if(!prepared) continue;
        // The order reference is durable before the outbound charge. Crash recovery only verifies it.
        const result=await http.post('https://api.paystack.co/transaction/charge_authorization',{ reference:prepared.reference,email:prepared.method.email,amount:prepared.amount,currency:prepared.cfg.currency,authorization_code:prepared.authorization.authorization_code },requestOptions(prepared.cfg.secretKey));
        if(result.data?.status && result.data?.data?.status==='success') await payments.verify(prepared.reference);
        else if(result.data?.data?.status==='failed') {
          await pool.query("UPDATE credit_recharge_jobs SET status='failed',last_error='Payment declined' WHERE id=$1",[job.id]);
          await pool.query("UPDATE paystack_orders SET status='failed' WHERE reference=$1",[prepared.reference]);
          await pause(job.user_id,job.mode,'Payment declined. Update your card and enable recharge again.');
        } else await pool.query("UPDATE credit_recharge_jobs SET status='unknown',last_error='Awaiting payment verification' WHERE id=$1 AND status<>'successful'",[job.id]);
      } catch(error) {
        await pool.query("UPDATE credit_recharge_jobs SET status=CASE WHEN order_reference IS NULL THEN 'pending' ELSE 'unknown' END,last_error=$2,run_at=NOW()+INTERVAL '5 minutes' WHERE id=$1 AND status<>'successful'",[job.id,error instanceof Error ? error.message.slice(0,200) : 'Recharge unavailable']);
      }
    }
  }
  async function reconcile() {
    const { rows }=await pool.query(`SELECT * FROM paystack_orders WHERE fulfilled_at IS NULL AND status IN ('pending','unknown')
      AND created_at<NOW()-INTERVAL '1 minute' AND (last_checked_at IS NULL OR last_checked_at<NOW()-INTERVAL '5 minutes') ORDER BY created_at LIMIT 50`);
    for(const order of rows) {
      await pool.query('UPDATE paystack_orders SET last_checked_at=NOW() WHERE reference=$1',[order.reference]);
      try {
        const result=await payments.verify(order.reference);
        if(!result.fulfilled && ['failed','abandoned','reversed'].includes(result.status)) {
          await pool.query("UPDATE credit_recharge_jobs SET status='failed',last_error='Payment failed' WHERE order_reference=$1 AND status<>'successful'",[order.reference]);
          if(order.purchase_source==='recharge') await pause(order.user_id,order.mode,'Payment failed. Renew consent to resume.');
        }
      } catch { /* Keep ambiguous transactions unresolved; monitoring exposes their age. */ }
    }
    const refunds=(await pool.query("SELECT * FROM credit_refunds WHERE status NOT IN ('processed','failed','dispute') ORDER BY updated_at LIMIT 50")).rows;
    for(const refund of refunds) {
      if(refund.status==='reserved') await submitRefund(refund.order_reference);
      else try { await reconcileRefund(refund.order_reference,refund.mode); } catch { /* Reservations remain until confirmed. */ }
    }
  }
  async function run() {
    await events(); await reconcile(); await sweep(); await recharge();
    await pool.query(`WITH wallets AS (
      SELECT user_id,'live' AS mode,credits,purchased_credits FROM user_credits
      UNION ALL SELECT user_id,'test',credits,purchased_credits FROM paystack_sandbox_accounts
    ), mismatches AS (
      SELECT w.* FROM wallets w LEFT JOIN LATERAL (SELECT SUM(remaining)::int AS remaining FROM credit_lots WHERE user_id=w.user_id AND mode=w.mode) l ON true
      LEFT JOIN LATERAL (SELECT balance_after FROM credit_events WHERE user_id=w.user_id AND mode=w.mode ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
      WHERE w.purchased_credits<>COALESCE(l.remaining,0) OR w.credits<w.purchased_credits OR (e.balance_after IS NOT NULL AND e.balance_after<>w.credits)
    ) INSERT INTO credit_incidents(id,user_id,mode,reason)
      SELECT 'balance-'||mode||'-'||user_id,user_id,mode,'Credit balance reconciliation required' FROM mismatches ON CONFLICT(id) DO UPDATE SET resolved=false`);
    await pool.query(`UPDATE user_credits u SET spending_blocked=true WHERE EXISTS(SELECT 1 FROM credit_incidents i WHERE i.user_id=u.user_id AND i.mode='live' AND NOT i.resolved)`);
    await pool.query(`UPDATE paystack_sandbox_accounts u SET spending_blocked=true WHERE EXISTS(SELECT 1 FROM credit_incidents i WHERE i.user_id=u.user_id AND i.mode='test' AND NOT i.resolved)`);
    const { rows }=await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM paystack_orders WHERE status IN ('pending','unknown') AND created_at<NOW()-INTERVAL '30 minutes') AS stale_payments,
      (SELECT COUNT(*)::int FROM credit_refunds WHERE status NOT IN ('processed','failed') AND created_at<NOW()-INTERVAL '1 day') AS stale_refunds,
      (SELECT COUNT(*)::int FROM paystack_event_inbox WHERE status='failed') AS failed_events,
      (SELECT COUNT(*)::int FROM credit_incidents WHERE NOT resolved) AS incidents`);
    if(Object.values(rows[0]).some(value=>Number(value)>0)) logger.warn(rows[0],'credit_operations_attention');
  }
  return { run,events,recharge,sweep,reconcile,reconcileRefund,submitRefund };
}
