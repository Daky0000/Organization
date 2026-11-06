import axios from 'axios';
import { logger } from '../logger.ts';
import express from 'express';
import type { Pool } from 'pg';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { account, CreditError, ledger, lockWallet, transaction, walletTable, type CreditMode } from './creditAccounting.ts';
import { creditCatalog, creditFeature } from './creditCatalog.ts';
import { buildPaystackService, PaymentError, type ConfigReader } from './paystackService.ts';
import { buildCreditJobs, creditAllowance } from './creditJobs.ts';
import { reserveRefund } from './creditRefunds.ts';

type Auth = { userId:string;role?:string };
interface Deps { http?:Pick<typeof axios,'get'|'post'>;pool:Pool;getPlatformConfig:ConfigReader;requireAuth:(req:Request,res:Response)=>Auth|null;
  requireAdmin:(req:Request,res:Response)=>Promise<Auth|null>;hasDatabase:()=>boolean }
const packSchema=z.object({ id:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),name:z.string().trim().min(1).max(80),description:z.string().trim().max(300),
  credits:z.number().int().min(1).max(1000000),priceUsd:z.number().positive().max(10000).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-6),displayOrder:z.number().int().min(0).max(1000),active:z.boolean() });
function cursor(value: unknown) {
  if(!value) return null;
  try { const parsed=JSON.parse(Buffer.from(String(value),'base64url').toString());if(!Number.isFinite(Date.parse(parsed.at)) || typeof parsed.id!=='string') throw new Error();return parsed; }
  catch { throw new CreditError('Invalid history cursor'); }
}
function page(rows:any[],limit:number,idField='id') {
  const items=rows.slice(0,limit);const last=items.at(-1);
  return { items,nextCursor:rows.length>limit && last ? Buffer.from(JSON.stringify({ at:new Date(last.created_at).toISOString(),id:last[idField] })).toString('base64url') : null };
}
export function registerCreditStoreRoutes(deps:Deps) {
  const { pool,getPlatformConfig:read,requireAuth,requireAdmin,hasDatabase }=deps;
  const router=express.Router();const payments=buildPaystackService({ pool,readConfig:read,http:deps.http });const jobs=buildCreditJobs(pool,read,deps.http);
  function route(method:'get'|'post'|'put'|'delete',path:string,admin:boolean,fn:(req:Request,res:Response,auth:Auth)=>Promise<unknown>) {
    router[method](path,async(req:Request,res:Response)=>{
      const auth=admin?await requireAdmin(req,res):requireAuth(req,res);if(!auth)return;
      if(!hasDatabase())return res.status(503).json({ success:false,error:'Credit service unavailable' });
      try { return await fn(req,res,auth); }
      catch(error) {
        const status=error instanceof CreditError || error instanceof PaymentError ? error.status : error instanceof z.ZodError ? 400 : 500;
        if(status>=500)logger.error({err:error,path,userId:auth.userId},'credit_operation_failed');
        const pricing=status===409 && path==='/credits/purchase' ? await creditCatalog(pool,read).then(({ cfg,...catalog })=>catalog).catch(()=>undefined) : undefined;
        return res.status(status).json({ success:false,error:status===500?'Credit operation failed. Please retry.':error instanceof z.ZodError?`Invalid ${error.issues[0]?.path.join('.') || 'request'}: ${error.issues[0]?.message}`:error instanceof Error?error.message:'Invalid request',catalog:pricing });
      }
    });
  }
  async function currentMode(auth:Auth):Promise<CreditMode> {
    const catalog=await creditCatalog(pool,read);
    return catalog.mode==='test' && auth.role!=='admin' ? 'live' : catalog.mode;
  }
  route('get','/credits/packs',false,async(_req,res,auth)=>{
    const { cfg,...catalog }=await creditCatalog(pool,read);
    return res.json({ success:true,...catalog,paymentAvailable:catalog.paymentAvailable && (catalog.mode==='live'||auth.role==='admin'),rechargeAvailable:catalog.rechargeAvailable && (catalog.mode==='live'||auth.role==='admin') });
  });
  route('get','/credits/balance',false,async(_req,res,auth)=>{
    const catalog=await creditCatalog(pool,read);const mode=catalog.mode==='test'&&auth.role==='admin'?'test':'live';
    const balance=await account(pool,auth.userId,mode==='live'?await creditAllowance(pool,auth.userId):0,mode);
    const agreement=(await pool.query('SELECT * FROM credit_recharge_agreements WHERE user_id=$1 AND mode=$2',[auth.userId,mode])).rows[0];
    return res.json({ success:true,...balance,mode,reset_date:balance.resetDate,auto_recharge:agreement?.enabled||false,auto_recharge_pack:agreement?.pack_id||'starter',
      autoRecharge:{ ...(agreement || { enabled:false,threshold:50,monthly_limit:3 }),packId:agreement?.pack_id||'starter' } });
  });
  route('post','/credits/purchase',false,async(req,res,auth)=>{
    if(!req.get('Idempotency-Key'))throw new CreditError('Idempotency-Key is required');
    const body=z.object({ packId:z.string().min(1),catalogVersion:z.string().min(1),saveCard:z.boolean().optional() }).strict().parse(req.body);
    return res.json({ success:true,...await payments.checkout(auth.userId,'credits',body.packId,{ catalogVersion:body.catalogVersion,saveCard:body.saveCard }) });
  });
  route('get','/credits/purchases',false,async(req,res,auth)=>{
    const catalog=await creditCatalog(pool,read);const mode=catalog.mode==='test'&&auth.role==='admin'?'test':'live';
    const before=cursor(req.query.cursor);const limit=25;
    const { rows }=await pool.query(`SELECT o.reference AS id,o.reference,o.pack_name,o.credits,o.amount_subunits/100.0 AS amount,o.currency,o.mode,o.purchase_source,o.status,o.created_at,
      o.fulfilled_at,r.status AS refund_status,i.id AS receipt_id FROM paystack_orders o LEFT JOIN credit_refunds r ON r.order_reference=o.reference
      LEFT JOIN billing_invoices i ON i.paystack_reference=o.reference WHERE o.user_id=$1 AND o.mode=$2 AND o.kind='credits'
      ${before?'AND (o.created_at,o.reference)<($3::timestamptz,$4)':''} ORDER BY o.created_at DESC,o.reference DESC LIMIT ${limit+1}`,[auth.userId,mode,...(before?[before.at,before.id]:[])]);
    return res.json({ success:true,...page(rows,limit) });
  });
  route('get','/credits/history',false,async(req,res,auth)=>{
    const catalog=await creditCatalog(pool,read);const mode=catalog.mode==='test'&&auth.role==='admin'?'test':'live';const before=cursor(req.query.cursor);const limit=25;
    const { rows }=await pool.query(`SELECT * FROM credit_events WHERE user_id=$1 AND mode=$2 ${before?'AND (created_at,id)<($3::timestamptz,$4)':''} ORDER BY created_at DESC,id DESC LIMIT ${limit+1}`,[auth.userId,mode,...(before?[before.at,before.id]:[])]);
    const result=page(rows,limit);return res.json({ success:true,...result,entries:result.items });
  });
  route('get','/credits/receipts/:reference',false,async(req,res,auth)=>{
    const order=await payments.orderByReference(req.params.reference,auth.userId);
    if(order.kind!=='credits'||!order.fulfilled_at)throw new CreditError('Receipt unavailable',404);
    return res.json({ success:true,receipt:order });
  });
  route('get','/credits/payment-methods',false,async(_req,res,auth)=>{
    const mode=await currentMode(auth);
    const { rows }=await pool.query('SELECT id,brand,last4,exp_month,exp_year,mode FROM credit_payment_methods WHERE user_id=$1 AND mode=$2 AND active ORDER BY created_at DESC',[auth.userId,mode]);
    return res.json({ success:true,methods:rows });
  });
  route('delete','/credits/payment-methods/:id',false,async(req,res,auth)=>{
    const mode=await currentMode(auth);
    await transaction(pool,async client=>{
      // Agreement lock precedes method mutation, matching the recharge worker's order.
      await client.query("UPDATE credit_recharge_agreements SET enabled=false,pause_reason='Payment method removed',updated_at=NOW() WHERE user_id=$1 AND mode=$2 AND method_id=$3",[auth.userId,mode,req.params.id]);
      const result=await client.query('UPDATE credit_payment_methods SET active=false WHERE id=$1 AND user_id=$2 AND mode=$3',[req.params.id,auth.userId,mode]);
      if(!result.rowCount)throw new CreditError('Payment method not found',404);
    });
    return res.json({ success:true });
  });
  route('get','/credits/auto-recharge',false,async(_req,res,auth)=>{
    const catalog=await creditCatalog(pool,read);const mode=catalog.mode==='test'&&auth.role==='admin'?'test':'live';
    const agreement=(await pool.query('SELECT * FROM credit_recharge_agreements WHERE user_id=$1 AND mode=$2',[auth.userId,mode])).rows[0];
    const attempts=(await pool.query('SELECT id,status,order_reference,last_error,created_at FROM credit_recharge_jobs WHERE user_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 20',[auth.userId,mode])).rows;
    return res.json({ success:true,agreement:agreement || { enabled:false,threshold:50,monthly_limit:3 },attempts,available:catalog.rechargeAvailable });
  });
  route('put','/credits/auto-recharge',false,async(req,res,auth)=>{
    const mode=await currentMode(auth);
    const body=z.object({ enabled:z.boolean(),packId:z.string().optional(),methodId:z.string().optional(),threshold:z.number().int().positive().optional(),monthlyLimit:z.number().int().min(1).max(10).optional(),catalogVersion:z.string().optional(),consent:z.literal(true).optional() }).strict().parse(req.body);
    if(!body.enabled) {
      await pool.query('UPDATE credit_recharge_agreements SET enabled=false,updated_at=NOW() WHERE user_id=$1 AND mode=$2',[auth.userId,mode]);
      return res.json({ success:true,message:'Recharge disabled. A submitted charge may still settle.' });
    }
    if(!creditFeature('recharge',mode))throw new CreditError('Automatic recharge is not enabled for this payment mode',503);
    const catalog=await creditCatalog(pool,read,mode);const pack=catalog.packs.find(p=>p.id===body.packId);
    if((await creditCatalog(pool,read)).mode!==mode)throw new CreditError('Recharge is unavailable in the current payment mode',503);
    if(!catalog.rechargeAvailable || !pack || body.catalogVersion!==catalog.version || !body.consent)throw new CreditError('Review current pricing and explicitly consent to automatic recharge',409);
    const threshold=body.threshold??50;const monthlyLimit=body.monthlyLimit??3;
    if(threshold>=pack.credits)throw new CreditError('Threshold must be below the selected pack quantity');
    await transaction(pool,async client=>{
      await client.query('INSERT INTO credit_recharge_agreements(user_id,mode) VALUES($1,$2) ON CONFLICT DO NOTHING',[auth.userId,mode]);
      await client.query('SELECT user_id FROM credit_recharge_agreements WHERE user_id=$1 AND mode=$2 FOR UPDATE',[auth.userId,mode]);
      const method=(await client.query('SELECT id FROM credit_payment_methods WHERE id=$1 AND user_id=$2 AND mode=$3 AND active FOR UPDATE',[body.methodId,auth.userId,mode])).rows[0];
      if(!method)throw new CreditError('Choose a reusable saved card');
      await client.query(`INSERT INTO credit_recharge_agreements(user_id,mode,enabled,pack_id,method_id,threshold,monthly_limit,catalog_version,amount_subunits,currency,consented_at)
        VALUES($1,$2,true,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT(user_id,mode) DO UPDATE SET enabled=true,pack_id=EXCLUDED.pack_id,method_id=EXCLUDED.method_id,
        threshold=EXCLUDED.threshold,monthly_limit=EXCLUDED.monthly_limit,catalog_version=EXCLUDED.catalog_version,amount_subunits=EXCLUDED.amount_subunits,currency=EXCLUDED.currency,
        consented_at=NOW(),pause_reason=NULL,updated_at=NOW()`,[auth.userId,mode,pack.id,body.methodId,threshold,monthlyLimit,pack.termsVersion,pack.amountSubunits,catalog.currency]);
    });
    return res.json({ success:true,maximumMonthlySpend:Number(pack.amount)*monthlyLimit,currency:catalog.currency });
  });
  route('get','/admin/credit-packs',true,async(_req,res)=>{
    const { cfg,...catalog }=await creditCatalog(pool,read,undefined,true);return res.json({ success:true,...catalog });
  });
  for(const method of ['post','put'] as const) route(method,method==='post'?'/admin/credit-packs':'/admin/credit-packs/:id',true,async(req,res,auth)=>{
    const body=packSchema.parse(req.body);const id=method==='post'?(body.id||randomUUID()):req.params.id;
    if(id==='agency')throw new CreditError('The agency identifier is reserved as a Power pack compatibility alias');
    await transaction(pool,async client=>{
      const old=(await client.query('SELECT * FROM credit_packs WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(method==='post'&&old)throw new CreditError('Pack already exists',409);
      if(method==='put'&&!old)throw new CreditError('Pack not found',404);
      await client.query(`INSERT INTO credit_packs(id,name,description,credits,price_usd,display_order,active) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,credits=EXCLUDED.credits,price_usd=EXCLUDED.price_usd,
        display_order=EXCLUDED.display_order,active=EXCLUDED.active,version=credit_packs.version+1,updated_at=NOW()`,[id,body.name,body.description,body.credits,body.priceUsd,body.displayOrder,body.active]);
      if(old && (Number(old.price_usd)!==body.priceUsd || old.credits!==body.credits || !body.active)) await client.query("UPDATE credit_recharge_agreements SET enabled=false,pause_reason='Pack changed. Renew consent.' WHERE pack_id=$1",[id]);

      await client.query(`INSERT INTO audit_logs(id,user_id,action,changes) VALUES($1,$2,'admin_credit_pack_updated',$3::jsonb)`,[randomUUID(),auth.userId,JSON.stringify({ packId:id,...body })]);
    });
    return res.json({ success:true,id });
  });
  route('get','/admin/credit-purchases',true,async(req,res)=>{
    const mode=req.query.mode==='test'?'test':'live';
    const { rows }=await pool.query(`SELECT o.*,r.status AS refund_status,l.remaining,l.reserved,l.legacy FROM paystack_orders o LEFT JOIN credit_lots l ON l.order_reference=o.reference
      LEFT JOIN credit_refunds r ON r.order_reference=o.reference WHERE o.kind='credits' AND o.mode=$1 ORDER BY o.created_at DESC LIMIT 100`,[mode]);
    return res.json({ success:true,items:rows,refundsAvailable:creditFeature('refunds',mode) });
  });
  route('post','/admin/credit-purchases/:reference/refund',true,async(req,res,auth)=>{
    const { reason }=z.object({ reason:z.string().trim().min(3).max(300) }).parse(req.body);
    const refund=await reserveRefund(pool,req.params.reference,auth.userId,reason);
    await jobs.submitRefund(req.params.reference);
    return res.status(202).json({ success:true,refund:(await pool.query('SELECT * FROM credit_refunds WHERE id=$1',[refund.id])).rows[0] });
  });
  route('get','/admin/credits/monitoring',true,async(_req,res)=>{
    const { rows }=await pool.query(`SELECT
      (SELECT COUNT(*) FROM paystack_orders WHERE fulfilled_at IS NULL AND status='pending' AND created_at<NOW()-INTERVAL '30 minutes') AS stale_payments,
      (SELECT COUNT(*) FROM credit_recharge_jobs WHERE status='unknown') AS unresolved_recharges,
      (SELECT COUNT(*) FROM credit_refunds WHERE status NOT IN ('processed','failed')) AS open_refunds,
      (SELECT COUNT(*) FROM paystack_event_inbox WHERE status='failed') AS failed_events,
      (SELECT COUNT(*) FROM credit_incidents WHERE NOT resolved) AS incidents`);
    const incidents=(await pool.query('SELECT * FROM credit_incidents WHERE NOT resolved ORDER BY created_at LIMIT 100')).rows;
    return res.json({ success:true,metrics:rows[0],incidents });
  });
  route('post','/admin/credits/incidents/:id/resolve',true,async(req,res,auth)=>{
    const body=z.object({ action:z.enum(['unblock','write_off']),reason:z.string().trim().min(5).max(300) }).parse(req.body);
    await transaction(pool,async client=>{
      let incident=(await client.query('SELECT * FROM credit_incidents WHERE id=$1',[req.params.id])).rows[0];
      if(!incident)throw new CreditError('Incident not found',404);
      if(incident.reference)await client.query('SELECT reference FROM paystack_orders WHERE reference=$1 FOR UPDATE',[incident.reference]);
      const wallet=await lockWallet(client,incident.user_id,incident.mode);
      incident=(await client.query('SELECT * FROM credit_incidents WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(incident.resolved)return;
      if(body.action==='write_off') {
        const refund=(await client.query("SELECT * FROM credit_refunds WHERE order_reference=$1 AND mode=$2 AND status='processed'",[incident.reference,incident.mode])).rows[0];
        if(!refund)throw new CreditError('A confirmed processed external refund is required',409);
        const lot=(await client.query('SELECT * FROM credit_lots WHERE order_reference=$1 FOR UPDATE',[incident.reference])).rows[0];
        if(lot?.remaining>0) {
          await client.query('UPDATE credit_lots SET remaining=0,reserved=false WHERE id=$1',[lot.id]);
          await client.query(`UPDATE ${walletTable(incident.mode)} SET credits=credits-$2,purchased_credits=purchased_credits-$2,reserved_credits=reserved_credits-$3 WHERE user_id=$1`,[incident.user_id,lot.remaining,lot.reserved?lot.remaining:0]);
          await ledger(client,incident.user_id,incident.mode,-lot.remaining,Number(wallet.credits)-lot.remaining,'refund_reconciliation_writeoff',{reference:incident.reference,adminId:auth.userId,reason:body.reason});
        }
        await client.query("UPDATE paystack_orders SET status='refunded' WHERE reference=$1",[incident.reference]);
        if(incident.mode==='live')await client.query("UPDATE billing_invoices SET status='refunded' WHERE paystack_reference=$1",[incident.reference]);
      } else if(incident.reference) {
        const refund=(await client.query('SELECT status FROM credit_refunds WHERE order_reference=$1',[incident.reference])).rows[0];
        if(refund && refund.status!=='failed')throw new CreditError('Resolve the provider refund/dispute before unblocking',409);
        const lot=(await client.query('SELECT * FROM credit_lots WHERE order_reference=$1 FOR UPDATE',[incident.reference])).rows[0];
        if(lot?.reserved) {
          await client.query('UPDATE credit_lots SET reserved=false WHERE id=$1',[lot.id]);
          await client.query(`UPDATE ${walletTable(incident.mode)} SET reserved_credits=reserved_credits-$2 WHERE user_id=$1`,[incident.user_id,lot.remaining]);
        }
      }
      const total=(await client.query('SELECT COALESCE(SUM(remaining),0)::int AS remaining FROM credit_lots WHERE user_id=$1 AND mode=$2',[incident.user_id,incident.mode])).rows[0].remaining;
      const current=(await client.query(`SELECT credits,purchased_credits FROM ${walletTable(incident.mode)} WHERE user_id=$1`,[incident.user_id])).rows[0];
      if(total!==current.purchased_credits || current.credits<total)throw new CreditError('Balance mismatch must be reconciled before unblocking',409);
      const last=(await client.query('SELECT balance_after FROM credit_events WHERE user_id=$1 AND mode=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[incident.user_id,incident.mode])).rows[0];
      await ledger(client,incident.user_id,incident.mode,current.credits-(last?.balance_after??current.credits),current.credits,'admin_reconciliation',{incidentId:incident.id,adminId:auth.userId,reason:body.reason});
      await client.query('UPDATE credit_incidents SET resolved=true WHERE id=$1',[incident.id]);
      await client.query(`UPDATE ${walletTable(incident.mode)} SET spending_blocked=EXISTS(SELECT 1 FROM credit_incidents WHERE user_id=$1 AND mode=$2 AND NOT resolved) WHERE user_id=$1`,[incident.user_id,incident.mode]);
      await client.query("INSERT INTO audit_logs(id,user_id,action,changes) VALUES($1,$2,'admin_credit_incident_resolved',$3::jsonb)",[randomUUID(),auth.userId,JSON.stringify({incidentId:incident.id,...body})]);
    });
    return res.json({success:true});
  });
  return router;
}
