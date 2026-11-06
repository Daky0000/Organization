import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { resolvePaystackConfig, type ConfigReader, type PaymentMode } from './paystackService.ts';
import { CreditError } from './creditAccounting.ts';

export function creditFeature(name: 'manual' | 'recharge' | 'refunds', mode: PaymentMode) {
  const key = `CREDITS_${name.toUpperCase()}_${mode.toUpperCase()}_ENABLED`;
  return process.env[key] === 'true' || (name === 'manual' && process.env[key] !== 'false');
}
export async function creditCatalog(pool: Pool, read: ConfigReader, modeOverride?: PaymentMode, includeInactive = false) {
  const saved = await read('paystack');
  const cfg = resolvePaystackConfig(saved,modeOverride);
  const mode = cfg?.mode || modeOverride || (saved.mode || process.env.PAYSTACK_MODE || 'test') as PaymentMode;
  const { rows } = await pool.query('SELECT * FROM credit_packs' + (includeInactive ? '' : ' WHERE active') + ' ORDER BY display_order,id');
  const version = createHash('sha256').update(JSON.stringify({ mode,packs: rows.map(p=>[p.id,p.version]),currency: cfg?.currency,fxRate: cfg?.fxRate })).digest('hex');
  return { version,mode,currency: cfg?.currency || null,paymentAvailable: Boolean(cfg && saved._enabled !== 'false' && creditFeature('manual',mode)),
    rechargeAvailable: Boolean(cfg && saved._enabled !== 'false' && creditFeature('recharge',mode)),refundsAvailable: creditFeature('refunds',mode),
    packs: rows.map(p=>({ id:p.id,name:p.name,description:p.description,credits:Number(p.credits),priceUsd:Number(p.price_usd),active:p.active,
      displayOrder:p.display_order,version:p.version,amount:cfg ? Math.round(Number(p.price_usd)*cfg.fxRate*100)/100 : null,
      termsVersion:createHash('sha256').update(JSON.stringify([p.id,p.credits,p.price_usd,cfg?.currency,cfg?.fxRate])).digest('hex'),
      amountSubunits:cfg ? Math.round(Number(p.price_usd)*cfg.fxRate*100) : null,currency:cfg?.currency || null })),cfg };
}
export async function quotedPack(pool: Pool,read: ConfigReader,id: string,version?: string,mode?: PaymentMode) {
  const catalog = await creditCatalog(pool,read,mode);
  if (version !== undefined && version !== catalog.version) throw new CreditError('Prices changed. Refresh the packs before purchasing.',409);
  const pack = catalog.packs.find(p=>p.id === (id==='agency'?'power':id));
  if (!pack) throw new CreditError('Credit pack not found',404);
  if (!catalog.cfg || !catalog.paymentAvailable) throw new CreditError('Credit checkout is currently unavailable',503);
  return { pack,catalog };
}
