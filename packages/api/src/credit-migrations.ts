import type { Pool } from 'pg';

export async function runCreditMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_packs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      credits INTEGER NOT NULL CHECK(credits>0), price_usd NUMERIC(12,2) NOT NULL CHECK(price_usd>0),
      display_order INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
      version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO credit_packs(id,name,description,credits,price_usd,display_order) VALUES
      ('mini','Mini','250 never-expiring AI credits.',250,3,0),
      ('starter','Starter','1,000 never-expiring AI credits.',1000,12,1),
      ('growth','Growth','5,000 never-expiring AI credits.',5000,49,2),
      ('power','Power','20,000 never-expiring AI credits.',20000,149,3)
      ON CONFLICT(id) DO NOTHING;
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS pack_name TEXT;
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS price_usd NUMERIC(12,2);
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS catalog_version TEXT;
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS purchase_source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS save_card BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE paystack_orders ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS reserved_credits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS spending_blocked BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE paystack_sandbox_accounts ADD COLUMN IF NOT EXISTS purchased_credits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE paystack_sandbox_accounts ADD COLUMN IF NOT EXISTS reserved_credits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE paystack_sandbox_accounts ADD COLUMN IF NOT EXISTS spending_blocked BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE paystack_sandbox_accounts ADD COLUMN IF NOT EXISTS reset_date TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS credit_lots (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL CHECK(mode IN ('live','test')),
      order_reference TEXT UNIQUE REFERENCES paystack_orders(reference),quantity INTEGER NOT NULL CHECK(quantity>0),
      remaining INTEGER NOT NULL CHECK(remaining>=0 AND remaining<=quantity),reserved BOOLEAN NOT NULL DEFAULT false,
      legacy BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS credit_lots_account ON credit_lots(user_id,mode,created_at,id);
    CREATE TABLE IF NOT EXISTS credit_events (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,
      delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,reason TEXT NOT NULL,meta JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS credit_events_account ON credit_events(user_id,mode,created_at DESC,id);
    INSERT INTO credit_events(id,user_id,mode,delta,balance_after,reason,meta,created_at)
      SELECT id,user_id,'live',delta,balance_after,reason,COALESCE(meta,'{}'::jsonb),created_at FROM credit_ledger ON CONFLICT(id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS credit_spend_allocations (
      event_id TEXT NOT NULL REFERENCES credit_events(id),lot_id TEXT NOT NULL REFERENCES credit_lots(id),
      quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(event_id,lot_id)
    );
    CREATE TABLE IF NOT EXISTS credit_payment_methods (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,
      signature TEXT NOT NULL,email TEXT NOT NULL,authorization_encrypted TEXT NOT NULL,
      brand TEXT,last4 TEXT,exp_month TEXT,exp_year TEXT,active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,mode,signature)
    );
    CREATE TABLE IF NOT EXISTS credit_recharge_agreements (
      user_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT false,
      pack_id TEXT REFERENCES credit_packs(id),method_id TEXT REFERENCES credit_payment_methods(id),
      threshold INTEGER NOT NULL DEFAULT 50,monthly_limit INTEGER NOT NULL DEFAULT 3 CHECK(monthly_limit BETWEEN 1 AND 10),
      catalog_version TEXT,amount_subunits INTEGER,currency TEXT,consented_at TIMESTAMPTZ,pause_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,mode)
    );
    CREATE TABLE IF NOT EXISTS credit_recharge_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,mode TEXT NOT NULL,order_reference TEXT UNIQUE REFERENCES paystack_orders(reference),
      status TEXT NOT NULL DEFAULT 'pending',run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS credit_recharge_unresolved ON credit_recharge_jobs(user_id,mode)
      WHERE status IN ('pending','processing','submitted','unknown');
    CREATE TABLE IF NOT EXISTS credit_refunds (
      id TEXT PRIMARY KEY,order_reference TEXT NOT NULL UNIQUE REFERENCES paystack_orders(reference),
      mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',provider_refund_id TEXT,
      admin_id TEXT,reason TEXT NOT NULL,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS paystack_event_inbox (
      id TEXT PRIMARY KEY,mode TEXT NOT NULL,event_name TEXT NOT NULL,payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS credit_incidents (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,mode TEXT NOT NULL,reference TEXT,reason TEXT NOT NULL,
      resolved BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(mode,reference,reason)
    );
    INSERT INTO credit_lots(id,user_id,mode,quantity,remaining,legacy)
      SELECT 'legacy-live-'||u.user_id,u.user_id,'live',u.purchased_credits,u.purchased_credits,true FROM user_credits u
      WHERE u.purchased_credits>0 AND NOT EXISTS(SELECT 1 FROM credit_lots l WHERE l.user_id=u.user_id AND l.mode='live')
      ON CONFLICT(id) DO NOTHING;
    UPDATE paystack_sandbox_accounts a SET purchased_credits=a.credits WHERE a.credits>0
      AND NOT EXISTS(SELECT 1 FROM credit_lots l WHERE l.user_id=a.user_id AND l.mode='test');
    INSERT INTO credit_lots(id,user_id,mode,quantity,remaining,legacy)
      SELECT 'legacy-test-'||a.user_id,a.user_id,'test',a.purchased_credits,a.purchased_credits,true FROM paystack_sandbox_accounts a
      WHERE a.purchased_credits>0 AND NOT EXISTS(SELECT 1 FROM credit_lots l WHERE l.user_id=a.user_id AND l.mode='test')
      ON CONFLICT(id) DO NOTHING;
    INSERT INTO credit_incidents(id,user_id,mode,reason)
      SELECT 'migration-'||u.user_id,u.user_id,'live','Purchased balance exceeds total balance' FROM user_credits u
      WHERE u.purchased_credits>u.credits ON CONFLICT DO NOTHING;
    UPDATE user_credits SET spending_blocked=true WHERE purchased_credits>credits;
  `);
}
