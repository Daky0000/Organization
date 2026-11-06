import axios from 'axios';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { config } from '../config.ts';
import { addPurchase } from './creditAccounting.ts';
import { quotedPack, creditFeature } from './creditCatalog.ts';
import { encryptIntegrationSecret } from '../integration-helpers.ts';

export type PaymentMode = 'test' | 'live';
export type ConfigReader = (platform: string) => Promise<Record<string, string>>;
export interface PaystackConfig { mode: PaymentMode; secretKey: string; publicKey: string; currency: string; fxRate: number }
export class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function resolvePaystackConfig(saved: Record<string, string>, modeOverride?: PaymentMode): PaystackConfig | null {
  const mode = modeOverride ?? (saved.mode || process.env.PAYSTACK_MODE || 'test');
  if (mode !== 'test' && mode !== 'live') throw new PaymentError('Paystack mode must be test or live');
  const prefix = mode === 'live' ? 'live' : 'test';
  const envPrefix = prefix.toUpperCase();
  const secretKey = saved[`${prefix}SecretKey`] || process.env[`PAYSTACK_${envPrefix}_SECRET_KEY`] || '';
  const publicKey = saved[`${prefix}PublicKey`] || process.env[`PAYSTACK_${envPrefix}_PUBLIC_KEY`] || '';
  if (!secretKey) return null;
  if (!secretKey.startsWith(`sk_${mode}_`)) throw new PaymentError(`The ${mode} secret key has the wrong prefix`);
  if (publicKey && !publicKey.startsWith(`pk_${mode}_`)) throw new PaymentError(`The ${mode} public key has the wrong prefix`);
  const currency = (saved.currency || process.env.PAYSTACK_CURRENCY || 'GHS').toUpperCase();
  const fxRate = Number(saved.fxRate || process.env.PAYSTACK_FX_RATE || 1);
  if (!['GHS', 'NGN', 'ZAR', 'KES', 'USD', 'XOF'].includes(currency) || !Number.isFinite(fxRate) || fxRate <= 0) {
    throw new PaymentError('Configure a supported currency and a positive conversion rate');
  }
  return { mode, secretKey, publicKey, currency, fxRate };
}

export async function getPaystackConfig(read: ConfigReader, mode?: PaymentMode) {
  return resolvePaystackConfig(await read('paystack'), mode);
}

export function verifyPaystackSignature(raw: Buffer, signature: string, secret: string): boolean {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export interface PaymentOrder {
  reference: string; user_id: string; mode: PaymentMode; kind: 'plan' | 'credits';
  plan_id: string | null; pack_id: string | null; credits: number; amount_subunits: number;
  currency: string; billing_period: string | null; customer_email: string;
  status: string; fulfilled_at: string | null;
  provider_transaction_id?: string;
  save_card?: boolean; purchase_source?: string; pack_name?: string;
}

export function validateVerifiedCharge(order: PaymentOrder, data: Record<string, any>) {
  if (data.reference !== order.reference || data.domain !== order.mode || data.currency !== order.currency ||
      Number(data.amount) !== Number(order.amount_subunits) || !Number.isSafeInteger(Number(data.amount)) ||
      String(data.customer?.email || '').toLowerCase() !== order.customer_email.toLowerCase()) {
    throw new PaymentError('Payment verification does not match the stored order');
  }
  if (data.status !== 'success') throw new PaymentError('Payment has not succeeded', 409);
  if (!data.id || !data.paid_at || !Number.isFinite(Date.parse(data.paid_at))) throw new PaymentError('Incomplete payment confirmation');
}

export function buildPaystackService({ pool, readConfig, http = axios }: { pool: Pool; readConfig: ConfigReader; http?: Pick<typeof axios, 'get' | 'post'> }) {
  async function orderByReference(reference: string, userId?: string): Promise<PaymentOrder> {
    const { rows } = await pool.query<PaymentOrder>('SELECT * FROM paystack_orders WHERE reference=$1' + (userId ? ' AND user_id=$2' : ''), userId ? [reference, userId] : [reference]);
    if (!rows[0]) throw new PaymentError('Payment order not found', 404);
    return rows[0];
  }

  async function checkout(userId: string, kind: 'plan' | 'credits', productId: string, options: { catalogVersion?: string; saveCard?: boolean } = {}) {
    const saved = await readConfig('paystack');
    if (saved._enabled === 'false') throw new PaymentError('Paystack checkout is disabled', 503);
    const cfg = resolvePaystackConfig(saved);
    if (!cfg) throw new PaymentError('Configure Paystack credentials in Admin > Payments', 503);
    const { rows: users } = await pool.query<{ email: string; role: string; status: string }>('SELECT email, role, status FROM users WHERE id=$1', [userId]);
    const user = users[0];
    if (!user || user.status !== 'active') throw new PaymentError('Account is not active', 403);
    if (cfg.mode === 'test' && user.role !== 'admin') throw new PaymentError('Test checkout is available to administrators only. Live checkout is not yet enabled.', 503);
    let price: number; let period: string | null = null; let credits = 0; let packName: string | null = null; let catalogVersion: string | null = null;
    if (kind === 'plan') {
      const { rows } = await pool.query<{ price: string; billing_period: string; discount_percentage: string; is_on_sale: boolean }>('SELECT price, billing_period, discount_percentage, is_on_sale FROM pricing_plans WHERE id=$1 AND is_active=true', [productId]);
      if (!rows[0]) throw new PaymentError('Plan not found', 404);
      period = rows[0].billing_period;
      price = Number(rows[0].price);
      if (rows[0].is_on_sale) price *= 1 - Number(rows[0].discount_percentage || 0) / 100;
    } else {
      if (!creditFeature('manual',cfg.mode)) throw new PaymentError('Credit checkout is disabled',503);
      const quote = await quotedPack(pool,async()=>saved,productId,options.catalogVersion);
      productId = quote.pack.id; price = quote.pack.priceUsd; credits = quote.pack.credits;
      packName = quote.pack.name; catalogVersion = quote.catalog.version;
    }
    const amount = Math.round(price * cfg.fxRate * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_000_000_000) throw new PaymentError('Invalid checkout amount');
    const reference = `dw-${cfg.mode}-${randomUUID().replaceAll('-', '')}`;
    // Persist the price and ownership before contacting the provider. Provider metadata is never the source of entitlements.
    await pool.query(`INSERT INTO paystack_orders (reference,user_id,mode,kind,plan_id,pack_id,credits,amount_subunits,currency,billing_period,customer_email,pack_name,price_usd,fx_rate,catalog_version,save_card)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [reference,userId,cfg.mode,kind,kind === 'plan' ? productId : null,kind === 'credits' ? productId : null,credits,amount,cfg.currency,period,user.email,packName,price,cfg.fxRate,catalogVersion,kind === 'credits' && options.saveCard === true]);
    let response;
    try { response = await http.post('https://api.paystack.co/transaction/initialize', {
      email: user.email, amount, currency: cfg.currency, reference,
      callback_url: `${config.appUrl}/${kind === 'credits' ? 'credits' : 'billing'}?paystack_reference=${reference}`,
      metadata: { order_reference: reference },
      ...(options.saveCard && kind === 'credits' ? { channels: ['card'] } : {}),
    }, { headers: { Authorization: `Bearer ${cfg.secretKey}` }, timeout: 15_000 }); }
    catch(error) {
      const definitive = axios.isAxiosError(error) && error.response && error.response.status>=400 && error.response.status<500;
      await pool.query('UPDATE paystack_orders SET status=$2 WHERE reference=$1',[reference,definitive?'failed':'unknown']);
      if(kind==='credits' && !definitive) return { url:null,checkoutUrl:null,reference,mode:cfg.mode,amount:amount/100,currency:cfg.currency,status:'pending' };
      throw new PaymentError('Checkout unavailable. Check payment history before retrying.',502);
    }
    const data = response.data?.data;
    if (!response.data?.status || data?.reference !== reference || !data.authorization_url) throw new PaymentError('Paystack could not initialize checkout', 502);
    const url = new URL(data.authorization_url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.paystack.com') throw new PaymentError('Paystack returned an invalid checkout URL', 502);
    await pool.query('UPDATE paystack_orders SET checkout_url=$2, updated_at=NOW() WHERE reference=$1', [reference, url.toString()]);
    return { url: url.toString(), checkoutUrl: url.toString(), reference, mode: cfg.mode, amount: amount / 100, currency: cfg.currency };
  }

  async function fulfill(order: PaymentOrder, data: Record<string, any>) {
    validateVerifiedCharge(order, data);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<PaymentOrder>('SELECT * FROM paystack_orders WHERE reference=$1 FOR UPDATE', [order.reference]);
      const locked = rows[0];
      if (!locked) throw new PaymentError('Payment order not found', 404);
      validateVerifiedCharge(locked, data);
      if (locked.fulfilled_at) { await client.query('COMMIT'); return { fulfilled: true, replay: true, mode: locked.mode }; }
      // A provider transaction can fulfill only one order; the unique index also protects concurrent deliveries.
      await client.query(`UPDATE paystack_orders SET provider_transaction_id=$2, status='successful', paid_at=$3, updated_at=NOW() WHERE reference=$1`, [locked.reference, String(data.id), data.paid_at]);
      if (locked.kind === 'credits') {
        await addPurchase(client,locked);
      } else if (locked.mode === 'test') {
        await client.query(`INSERT INTO paystack_sandbox_accounts(user_id,plan_id,current_period_end)
          VALUES ($1,$2,NOW()+$3::interval) ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,current_period_end=EXCLUDED.current_period_end`,
          [locked.user_id,locked.plan_id,locked.billing_period === 'yearly' ? '1 year' : '1 month']);
      } else {
        await activatePlan(client,locked);
      }
      if (locked.kind === 'credits' && locked.save_card && data.authorization?.reusable === true && data.authorization?.authorization_code && data.authorization?.signature) {
        const auth = data.authorization;
        await client.query(`INSERT INTO credit_payment_methods(id,user_id,mode,signature,email,authorization_encrypted,brand,last4,exp_month,exp_year)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,mode,signature) DO UPDATE SET authorization_encrypted=EXCLUDED.authorization_encrypted,
          email=EXCLUDED.email,active=true,brand=EXCLUDED.brand,last4=EXCLUDED.last4,exp_month=EXCLUDED.exp_month,exp_year=EXCLUDED.exp_year`,
          [randomUUID(),locked.user_id,locked.mode,auth.signature,locked.customer_email,encryptIntegrationSecret(JSON.stringify(auth)),auth.card_type,auth.last4,auth.exp_month,auth.exp_year]);
      }
      if (locked.mode === 'live') {
        await client.query(`INSERT INTO billing_invoices(id,user_id,status,subtotal_cents,total_cents,currency,paid_at,paystack_reference)
          VALUES($1,$2,'paid',$3,$3,$4,$5,$6)`, [randomUUID(), locked.user_id, locked.amount_subunits, locked.currency.toLowerCase(), data.paid_at, locked.reference]);
      }
      await client.query('UPDATE paystack_orders SET fulfilled_at=NOW(),updated_at=NOW() WHERE reference=$1', [locked.reference]);
      await client.query("UPDATE credit_recharge_jobs SET status='successful' WHERE order_reference=$1",[locked.reference]);
      await client.query('COMMIT');
      return { fulfilled: true, replay: false, mode: locked.mode };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async function verify(reference: string, userId?: string) {
    const order = await orderByReference(reference, userId);
    if(order.fulfilled_at) return { fulfilled:order.status!=='refunded',status:order.status,mode:order.mode,replay:true };
    const cfg = await getPaystackConfig(readConfig, order.mode);
    if (!cfg) throw new PaymentError(`Configure Paystack ${order.mode} credentials to verify this order`, 503);
    const response = await http.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${cfg.secretKey}` }, timeout: 15_000 });
    if (!response.data?.status || !response.data.data) throw new PaymentError('Payment verification is unavailable', 502);
    const data = response.data.data;
    if (data.status !== 'success') {
      const status = ['failed','abandoned','reversed'].includes(data.status) ? data.status : 'pending';
      await pool.query('UPDATE paystack_orders SET status=$2,last_checked_at=NOW() WHERE reference=$1 AND fulfilled_at IS NULL',[reference,status]);
      return { fulfilled: false,status,mode: order.mode };
    }
    return { ...await fulfill(order, data), status: 'successful' };
  }
  return { checkout, verify, fulfill, orderByReference };
}

async function activatePlan(client: PoolClient, order: PaymentOrder) {
  // Plans are prepaid periods. Renewal requires another verified checkout; no recurring debit is implied.
  await client.query(`INSERT INTO subscriptions(id,user_id,plan_id,status,current_period_start,current_period_end,updated_at)
    VALUES($1,$2,$3,'active',NOW(),NOW()+$4::interval,NOW())
    ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status='active',current_period_start=NOW(),
      current_period_end=(CASE WHEN subscriptions.plan_id=EXCLUDED.plan_id AND subscriptions.current_period_end>NOW()
      THEN subscriptions.current_period_end ELSE NOW() END)+$4::interval,cancel_at_period_end=false,canceled_at=NULL,updated_at=NOW()`,
    [randomUUID(),order.user_id,order.plan_id,order.billing_period === 'yearly' ? '1 year' : '1 month']);
  await client.query('UPDATE users SET plan_id=$1 WHERE id=$2', [order.plan_id,order.user_id]);
}
