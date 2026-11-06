import { runCreditMigrations } from './credit-migrations.ts';
import type { Pool } from 'pg';

export async function runPaymentMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS paystack_orders (
      reference TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK(mode IN ('test','live')),kind TEXT NOT NULL CHECK(kind IN ('plan','credits')),
      plan_id TEXT REFERENCES pricing_plans(id),pack_id TEXT,credits INTEGER NOT NULL DEFAULT 0,
      amount_subunits INTEGER NOT NULL CHECK(amount_subunits>0),currency TEXT NOT NULL,billing_period TEXT,
      customer_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',checkout_url TEXT,
      provider_transaction_id TEXT,paid_at TIMESTAMPTZ,fulfilled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS paystack_orders_provider_id ON paystack_orders(mode,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS paystack_orders_user_idx ON paystack_orders(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS paystack_sandbox_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,plan_id TEXT REFERENCES pricing_plans(id),
      credits INTEGER NOT NULL DEFAULT 0,current_period_end TIMESTAMPTZ
    );
    ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_paystack_reference ON billing_invoices(paystack_reference) WHERE paystack_reference IS NOT NULL;
    ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS purchased_credits INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS request_idempotency (
      scope TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,status INTEGER,body JSONB,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours',PRIMARY KEY(scope,key)
    );
    CREATE TABLE IF NOT EXISTS login_oauth_states (
      state TEXT PRIMARY KEY,provider TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_login_identities (
      provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(provider,subject)
    );
    CREATE TABLE IF NOT EXISTS publication_outbox (
      id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),distribution_enqueued BOOLEAN NOT NULL DEFAULT false,last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS publication_outbox_due ON publication_outbox(status,run_at);
    CREATE TABLE IF NOT EXISTS webhook_outbox (
      id TEXT PRIMARY KEY,webhook_id TEXT NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_name TEXT NOT NULL,payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS webhook_outbox_due ON webhook_outbox(status,run_at);
    CREATE TABLE IF NOT EXISTS campaign_email_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES mailing_campaigns(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL,subject TEXT NOT NULL,html TEXT NOT NULL,unsubscribe_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),provider_message_id TEXT,last_error TEXT,
      UNIQUE(campaign_id,contact_id)
    );
    CREATE INDEX IF NOT EXISTS campaign_email_jobs_due ON campaign_email_jobs(status,run_at);
  `);
  await runCreditMigrations(pool);
}
