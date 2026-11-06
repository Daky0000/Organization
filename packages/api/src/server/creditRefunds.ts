import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { CreditError, ledger, lockWallet, transaction, walletTable, type CreditMode } from './creditAccounting.ts';
import { creditFeature } from './creditCatalog.ts';

export async function reserveRefund(pool: Pool, reference: string, adminId: string, reason: string) {
  return transaction(pool,async client=>{
    const order = (await client.query("SELECT * FROM paystack_orders WHERE reference=$1 AND kind='credits' FOR UPDATE",[reference])).rows[0];
    if (!order?.fulfilled_at) throw new CreditError('A verified credit purchase is required',409);
    if (!creditFeature('refunds',order.mode)) throw new CreditError('Refunds are disabled for this payment mode',503);
    await lockWallet(client,order.user_id,order.mode);
    const existing = (await client.query('SELECT * FROM credit_refunds WHERE order_reference=$1',[reference])).rows[0];
    if (existing) return existing;
    const lot = (await client.query('SELECT * FROM credit_lots WHERE order_reference=$1 FOR UPDATE',[reference])).rows[0];
    if (!lot || lot.legacy || lot.remaining !== lot.quantity || lot.reserved) throw new CreditError('Only completely unused purchases can be refunded',409);
    const id = randomUUID();
    await client.query('UPDATE credit_lots SET reserved=true WHERE id=$1',[lot.id]);
    await client.query(`UPDATE ${walletTable(order.mode)} SET reserved_credits=reserved_credits+$2 WHERE user_id=$1`,[order.user_id,lot.remaining]);
    const { rows } = await client.query('INSERT INTO credit_refunds(id,order_reference,mode,admin_id,reason) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,reference,order.mode,adminId,reason]);
    await client.query("INSERT INTO audit_logs(id,user_id,action,changes) VALUES($1,$2,'admin_credit_refund_requested',$3::jsonb)",[randomUUID(),adminId,JSON.stringify({ reference,mode:order.mode,reason })]);
    await ledger(client,order.user_id,order.mode,0,(await client.query(`SELECT credits FROM ${walletTable(order.mode)} WHERE user_id=$1`,[order.user_id])).rows[0].credits,'refund_reserved',{ reference,reason,adminId });
    return rows[0];
  });
}
export async function applyRefund(pool: Pool, reference: string, mode: CreditMode, status: string, providerId?: string, external = false) {
  if (!['pending','processing','needs-attention','failed','processed','dispute'].includes(status)) throw new CreditError('Invalid refund status');
  return transaction(pool,async client=>{
    const order = (await client.query('SELECT * FROM paystack_orders WHERE reference=$1 FOR UPDATE',[reference])).rows[0];
    if (!order?.fulfilled_at || order.kind !== 'credits' || order.mode !== mode) throw new CreditError('Refund purchase not found',404);
    const wallet = await lockWallet(client,order.user_id,mode);
    const lot = (await client.query('SELECT * FROM credit_lots WHERE order_reference=$1 FOR UPDATE',[reference])).rows[0];
    let refund = (await client.query('SELECT * FROM credit_refunds WHERE order_reference=$1 FOR UPDATE',[reference])).rows[0];
    if (refund?.status === 'processed') return;
    if (!refund) {
      await client.query(`INSERT INTO credit_refunds(id,order_reference,mode,reason,status) VALUES($1,$2,$3,'External provider reversal','pending')`,[randomUUID(),reference,mode]);
      refund = { status:'pending' };
    }
    const consumed = !lot || lot.remaining !== lot.quantity || lot.legacy;
    if (external || status === 'dispute' || consumed) {
      await client.query(`INSERT INTO credit_incidents(id,user_id,mode,reference,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(mode,reference,reason) DO NOTHING`,[randomUUID(),order.user_id,mode,reference,status === 'dispute' ? 'Payment disputed' : 'External refund reconciliation']);
    }
    if (consumed || status === 'dispute') {
      await client.query(`UPDATE ${walletTable(mode)} SET spending_blocked=true WHERE user_id=$1`,[order.user_id]);
      if (lot && !lot.reserved && lot.remaining>0) {
        await client.query('UPDATE credit_lots SET reserved=true WHERE id=$1',[lot.id]);
        await client.query(`UPDATE ${walletTable(mode)} SET reserved_credits=reserved_credits+$2 WHERE user_id=$1`,[order.user_id,lot.remaining]);
      }
      await client.query('UPDATE credit_refunds SET status=$2,provider_refund_id=COALESCE($3,provider_refund_id),updated_at=NOW() WHERE order_reference=$1',[reference,status,providerId || null]);
      return;
    }
    let reserved = lot.reserved;
    if (status !== 'failed' && !reserved) {
      await client.query('UPDATE credit_lots SET reserved=true WHERE id=$1',[lot.id]);
      await client.query(`UPDATE ${walletTable(mode)} SET reserved_credits=reserved_credits+$2 WHERE user_id=$1`,[order.user_id,lot.quantity]);
      reserved = true;
    }
    if (status === 'processed') {
      await client.query('UPDATE credit_lots SET remaining=0,reserved=false WHERE id=$1',[lot.id]);
      await client.query(`UPDATE ${walletTable(mode)} SET credits=credits-$2,purchased_credits=purchased_credits-$2,reserved_credits=reserved_credits-$2 WHERE user_id=$1`,[order.user_id,lot.quantity]);
      await ledger(client,order.user_id,mode,-lot.quantity,Number(wallet.credits)-lot.quantity,'refund_processed',{ reference,refundId:providerId });
      await client.query("UPDATE paystack_orders SET status='refunded' WHERE reference=$1",[reference]);
      if(mode==='live') await client.query("UPDATE billing_invoices SET status='refunded' WHERE paystack_reference=$1",[reference]);
    } else if(status === 'failed' && reserved) {
      await client.query('UPDATE credit_lots SET reserved=false WHERE id=$1',[lot.id]);
      await client.query(`UPDATE ${walletTable(mode)} SET reserved_credits=reserved_credits-$2 WHERE user_id=$1`,[order.user_id,lot.quantity]);
      await ledger(client,order.user_id,mode,0,Number(wallet.credits),'refund_failed',{ reference });
    }
    await client.query('UPDATE credit_refunds SET status=$2,provider_refund_id=COALESCE($3,provider_refund_id),updated_at=NOW() WHERE order_reference=$1',[reference,status,providerId || null]);
  });
}
