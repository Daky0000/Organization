import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type CreditMode = 'test' | 'live';
export class CreditError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const walletTable = (mode: CreditMode) => mode === 'live' ? 'user_credits' : 'paystack_sandbox_accounts';
export async function creditAllowance(connection: Pool | PoolClient,userId: string) {
  const { rows }=await connection.query(`SELECT lower(p.name) AS name FROM subscriptions s JOIN pricing_plans p ON p.id=s.plan_id
    WHERE s.user_id=$1 AND s.status IN ('active','trialing') AND (s.current_period_end IS NULL OR s.current_period_end>NOW()) LIMIT 1`,[userId]);
  const name=rows[0]?.name || 'free';
  return name.includes('enterprise') || name.includes('os pro') ? 25000 : name.includes('agency') ? 6000 : name.includes('pro') ? 2000 : 100;
}
export async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function lockWallet(client: PoolClient, userId: string, mode: CreditMode, allowance = 0) {
  const table = walletTable(mode);
  const created=await client.query(`INSERT INTO ${table}(user_id,credits,reset_date) VALUES($1,$2,date_trunc('month',NOW())+INTERVAL '1 month') ON CONFLICT(user_id) DO NOTHING RETURNING user_id`, [userId, allowance]);
  if(created.rowCount && allowance>0) await ledger(client,userId,mode,allowance,allowance,'monthly_allowance_grant');
  const { rows } = await client.query(`SELECT *,reset_date<=NOW() AS reset_due FROM ${table} WHERE user_id=$1 FOR UPDATE`, [userId]);
  return rows[0];
}
export async function ledger(client: PoolClient, userId: string, mode: CreditMode, delta: number, balance: number, reason: string, meta: Record<string, unknown> = {}) {
  const id = randomUUID();
  await client.query('INSERT INTO credit_events(id,user_id,mode,delta,balance_after,reason,meta,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,clock_timestamp())', [id,userId,mode,delta,balance,reason,JSON.stringify(meta)]);
  if (mode === 'live') await client.query('INSERT INTO credit_ledger(id,user_id,delta,balance_after,reason,meta) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [id,userId,delta,balance,reason.slice(0,60),JSON.stringify(meta)]);
  return id;
}
export async function account(pool: Pool, userId: string, allowance: number, mode: CreditMode = 'live') {
  return transaction(pool, async client => {
    let row = await lockWallet(client,userId,mode,allowance);
    if (row.reset_due) {
      const total = Number(row.purchased_credits) + allowance;
      await client.query(`UPDATE ${walletTable(mode)} SET credits=$2,reset_date=date_trunc('month',NOW())+INTERVAL '1 month' WHERE user_id=$1`, [userId,total]);
      await ledger(client,userId,mode,total-Number(row.credits),total,'monthly_reset');
      row = (await client.query(`SELECT * FROM ${walletTable(mode)} WHERE user_id=$1`,[userId])).rows[0];
    }
    return { credits: Number(row.credits)-Number(row.reserved_credits),totalCredits: Number(row.credits),purchasedCredits: Number(row.purchased_credits),
      allowanceRemaining: Number(row.credits)-Number(row.purchased_credits),reservedCredits: Number(row.reserved_credits),
      resetDate: row.reset_date,spendingBlocked: Boolean(row.spending_blocked),autoRecharge: Boolean(row.auto_recharge),autoRechargePack: row.auto_recharge_pack || 'starter' };
  });
}
export async function addPurchase(client: PoolClient, order: { reference: string; user_id: string; mode: CreditMode; credits: number; pack_id: string | null }) {
  const wallet = await lockWallet(client,order.user_id,order.mode,order.mode==='live'?await creditAllowance(client,order.user_id):0);
  await client.query('INSERT INTO credit_lots(id,user_id,mode,order_reference,quantity,remaining) VALUES($1,$2,$3,$4,$5,$5)', [randomUUID(),order.user_id,order.mode,order.reference,order.credits]);
  await client.query(`UPDATE ${walletTable(order.mode)} SET credits=credits+$2,purchased_credits=purchased_credits+$2 WHERE user_id=$1`,[order.user_id,order.credits]);
  await ledger(client,order.user_id,order.mode,order.credits,Number(wallet.credits)+order.credits,'paystack_topup',{ reference: order.reference,pack_id: order.pack_id });
}
export async function spend(pool: Pool, userId: string, quantity: number, reason: string, meta: Record<string, unknown> = {}, mode: CreditMode = 'live') {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new CreditError('Invalid credit quantity');
  return transaction(pool,async client => {
    const row = await lockWallet(client,userId,mode);
    if (row.spending_blocked) throw new CreditError('Credit account needs administrator review',403);
    if (Number(row.credits)-Number(row.reserved_credits)<quantity) throw new CreditError('Insufficient AI credits',402);
    let purchasedDebit = Math.max(0,quantity-(Number(row.credits)-Number(row.purchased_credits)));
    const eventId = await ledger(client,userId,mode,-quantity,Number(row.credits)-quantity,reason,meta);
    const originalDebit = purchasedDebit;
    if (purchasedDebit) {
      const { rows: lots } = await client.query('SELECT * FROM credit_lots WHERE user_id=$1 AND mode=$2 AND remaining>0 AND NOT reserved ORDER BY created_at,id FOR UPDATE',[userId,mode]);
      for (const lot of lots) {
        const allocated = Math.min(Number(lot.remaining),purchasedDebit); if (!allocated) break;
        await client.query('UPDATE credit_lots SET remaining=remaining-$2 WHERE id=$1',[lot.id,allocated]);
        await client.query('INSERT INTO credit_spend_allocations(event_id,lot_id,quantity) VALUES($1,$2,$3)',[eventId,lot.id,allocated]);
        purchasedDebit -= allocated;
      }
      if (purchasedDebit) throw new CreditError('Credit balance reconciliation required',409);
    }
    await client.query(`UPDATE ${walletTable(mode)} SET credits=credits-$2,purchased_credits=purchased_credits-$3 WHERE user_id=$1`,[userId,quantity,originalDebit]);
    await enqueueRecharge(client,userId,mode,Number(row.credits)-quantity-Number(row.reserved_credits));
    return Number(row.credits)-quantity-Number(row.reserved_credits);
  });
}
export async function enqueueRecharge(client: PoolClient, userId: string, mode: CreditMode, balance: number) {
  await client.query(`INSERT INTO credit_recharge_jobs(id,user_id,mode)
    SELECT $1,user_id,mode FROM credit_recharge_agreements WHERE user_id=$2 AND mode=$3 AND enabled AND threshold>$4
    ON CONFLICT DO NOTHING`,[randomUUID(),userId,mode,balance]);
}
export async function grant(pool: Pool,userId: string,quantity: number,reason: string,meta: Record<string, unknown>) {
  if (!Number.isSafeInteger(quantity) || quantity<1) throw new CreditError('Invalid credit grant');
  return transaction(pool,async client=>{
    const row=await lockWallet(client,userId,'live');
    // Administrative grants are non-expiring adjustments, not refundable purchases.
    await client.query('INSERT INTO credit_lots(id,user_id,mode,quantity,remaining,legacy) VALUES($1,$2,\'live\',$3,$3,true)',[randomUUID(),userId,quantity]);
    await client.query('UPDATE user_credits SET credits=credits+$2,purchased_credits=purchased_credits+$2 WHERE user_id=$1',[userId,quantity]);
    await ledger(client,userId,'live',quantity,Number(row.credits)+quantity,reason,meta);
    return Number(row.credits)+quantity;
  });
}
