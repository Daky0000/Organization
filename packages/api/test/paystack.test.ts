import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);
const { buildPaystackService, resolvePaystackConfig, validateVerifiedCharge, verifyPaystackSignature } = await import('../src/server/paystackService.ts');
const saved = { mode: 'test', testSecretKey: 'sk_test_fixture', testPublicKey: 'pk_test_fixture', liveSecretKey: 'sk_live_fixture', livePublicKey: 'pk_live_fixture', currency: 'GHS', fxRate: '15' };

test('Paystack isolates credentials and rejects mixed key modes', () => {
  assert.equal(resolvePaystackConfig(saved)?.secretKey,'sk_test_fixture');
  assert.equal(resolvePaystackConfig(saved,'live')?.secretKey,'sk_live_fixture');
  assert.throws(() => resolvePaystackConfig({ ...saved,testSecretKey: 'sk_live_wrong' }));
  assert.throws(() => resolvePaystackConfig({ ...saved,fxRate: 'Infinity' }));
});
test('Paystack signature authenticates exact bytes and rejects malformed or altered signatures', () => {
  const raw = Buffer.from('{"event":"charge.success"}');
  const signature = createHmac('sha512','sk_test_fixture').update(raw).digest('hex');
  assert.equal(verifyPaystackSignature(raw,signature,'sk_test_fixture'),true);
  assert.equal(verifyPaystackSignature(Buffer.from('{}'),signature,'sk_test_fixture'),false);
  assert.equal(verifyPaystackSignature(raw,'bad','sk_test_fixture'),false);
});
test('Verified charges must match stored mode, amount, currency, ownership, and reference', () => {
  const order = { reference: 'dw_test_1',user_id: 'u',mode: 'test' as const,kind: 'credits' as const,plan_id: null,pack_id: 'starter',credits: 1000,amount_subunits: 1500,currency: 'GHS',billing_period: null,customer_email: 'buyer@example.com',status: 'pending',fulfilled_at: null };
  const data = { id: 123,reference: order.reference,domain: 'test',status: 'success',amount: 1500,currency: 'GHS',paid_at: new Date().toISOString(),customer: { email: order.customer_email } };
  assert.doesNotThrow(() => validateVerifiedCharge(order,data));
  for (const patch of [{ amount: 1499 },{ currency: 'NGN' },{ domain: 'live' },{ reference: 'other' },{ customer: { email: 'other@example.com' } },{ status: 'pending' }]) assert.throws(() => validateVerifiedCharge(order,{ ...data,...patch }));
});

test('Paystack PostgreSQL integration: purchases, isolation, ownership, concurrency, and rollback', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const { runDatabaseMigrations } = await import('../src/db-migrations.ts');
    const { runPaymentMigrations } = await import('../src/payment-migrations.ts');
    await runDatabaseMigrations(pool);
    await runPaymentMigrations(pool);
    await runDatabaseMigrations(pool); // The upgrade path must also run successfully.
    await pool.query(`INSERT INTO pricing_plans(id,name,description,price,billing_period,features,is_active) VALUES('paystack-test-plan','Pro','Integration test',29,'monthly','{}',true) ON CONFLICT(id) DO NOTHING`);
    async function fixture(mode: 'test' | 'live', role = 'admin') {
      const userId = randomUUID(); const email = `${userId}@example.com`;
      await pool.query("INSERT INTO users(id,email,password_hash,role,status) VALUES($1,$2,'fixture',$3,'active')",[userId,email,role]);
      let initialized: any; let verifyCalls = 0;
      const http = {
        post: async (_url: string,body: any) => { initialized = body; return { data: { status: true,data: { reference: body.reference,authorization_url: `https://checkout.paystack.com/${body.reference}` } } }; },
        get: async () => { verifyCalls++; return { data: { status: true,data: { id: randomUUID(),reference: initialized.reference,domain: mode,status: 'success',amount: initialized.amount,currency: initialized.currency,customer: { email },paid_at: new Date().toISOString() } } }; },
      };
      // Stable provider ID reproduces retries of the same provider transaction.
      const providerId = randomUUID();
      const originalGet = http.get;
      http.get = async () => { const response = await originalGet();response.data.data.id=providerId;return response; };
      const service = buildPaystackService({ pool,readConfig: async () => ({ ...saved,mode }),http: http as any });
      return { userId,email,service,http,verifyCalls: () => verifyCalls };
    }
    await t.test('test credit purchases never change live credits or invoices',async () => {
      const f = await fixture('test'); const checkout = await f.service.checkout(f.userId,'credits','starter');
      assert.equal(checkout.mode,'test'); await f.service.verify(checkout.reference,f.userId);
      const sandbox = await pool.query('SELECT credits FROM paystack_sandbox_accounts WHERE user_id=$1',[f.userId]);
      assert.equal(sandbox.rows[0].credits,1000);
      assert.equal((await pool.query('SELECT * FROM user_credits WHERE user_id=$1',[f.userId])).rows.length,0);
      assert.equal((await pool.query('SELECT * FROM billing_invoices WHERE user_id=$1',[f.userId])).rows.length,0);
    });
    await t.test('live credits fulfill exactly once across concurrent verify calls',async () => {
      const f = await fixture('live'); const checkout = await f.service.checkout(f.userId,'credits','starter');
      await Promise.all([f.service.verify(checkout.reference,f.userId),f.service.verify(checkout.reference,f.userId)]);
      const balance = await pool.query('SELECT credits,purchased_credits FROM user_credits WHERE user_id=$1',[f.userId]);
      assert.equal(balance.rows[0].credits,1100);assert.equal(balance.rows[0].purchased_credits,1000);
      assert.equal((await pool.query('SELECT * FROM credit_ledger WHERE user_id=$1',[f.userId])).rows.length,2);
      assert.equal((await pool.query('SELECT * FROM billing_invoices WHERE user_id=$1',[f.userId])).rows.length,1);
    });
    await t.test('foreign references are rejected before contacting Paystack',async () => {
      const f=await fixture('live');const checkout=await f.service.checkout(f.userId,'credits','starter');
      await assert.rejects(f.service.verify(checkout.reference,'another-user'),/not found/);assert.equal(f.verifyCalls(),0);
    });
    await t.test('unknown references cannot fulfill values',async () => {
      const f=await fixture('live');await assert.rejects(f.service.verify('unknown-reference'),/not found/);
    });
    await t.test('non-admin accounts cannot initialize test checkout',async () => {
      const f=await fixture('test','user');await assert.rejects(f.service.checkout(f.userId,'credits','starter'),/administrators only/);
    });
    await t.test('live plan verification grants the stored paid period only once',async () => {
      const f=await fixture('live');const checkout=await f.service.checkout(f.userId,'plan','paystack-test-plan');
      await f.service.verify(checkout.reference,f.userId);const before=(await pool.query('SELECT current_period_end FROM subscriptions WHERE user_id=$1',[f.userId])).rows[0];
      await f.service.verify(checkout.reference,f.userId);const after=(await pool.query('SELECT current_period_end FROM subscriptions WHERE user_id=$1',[f.userId])).rows[0];
      assert.equal(before.current_period_end.toISOString(),after.current_period_end.toISOString());
      assert.equal((await pool.query('SELECT plan_id FROM users WHERE id=$1',[f.userId])).rows[0].plan_id,'paystack-test-plan');
    });
    await t.test('a failed ledger write rolls back the balance and fulfillment marker',async () => {
      const f=await fixture('live');const checkout=await f.service.checkout(f.userId,'credits','starter');
      const brokenPool = { query: pool.query.bind(pool),connect: async () => { const client=await pool.connect();return { release: () => client.release(),query: (sql: string,params?: any[]) => sql.includes('INSERT INTO credit_ledger') ? Promise.reject(new Error('Injected ledger failure')) : client.query(sql,params) }; } };
      const broken=buildPaystackService({ pool: brokenPool as any,readConfig: async () => ({ ...saved,mode: 'live' }),http: f.http as any });
      await assert.rejects(broken.verify(checkout.reference,f.userId),/Injected ledger failure/);
      assert.equal((await pool.query('SELECT * FROM user_credits WHERE user_id=$1',[f.userId])).rows.length,0);
      assert.equal((await pool.query('SELECT fulfilled_at FROM paystack_orders WHERE reference=$1',[checkout.reference])).rows[0].fulfilled_at,null);
    });
    await t.test('signed webhooks verify and fulfill once; bad signatures are rejected',async()=>{
      const { default: express }=await import('express');
      const { default: request }=await import('supertest');
      const { registerPaystackRoutes }=await import('../src/server/paystackRoutes.ts');
      const f=await fixture('live');const checkout=await f.service.checkout(f.userId,'credits','starter');
      const app=express();app.use(express.json({ verify: (req,_res,bytes)=>{ (req as any).rawBody=bytes; } }));
      app.use(registerPaystackRoutes({ pool,hasDatabase: ()=>true,requireAuth: ()=>({ userId: f.userId }),requireAdmin: async()=>null,getPlatformConfig: async()=>({ ...saved,mode: 'live' }),http: f.http as any }));
      const body={ event: 'charge.success',data: { reference: checkout.reference } };
      const signature=createHmac('sha512',saved.liveSecretKey).update(JSON.stringify(body)).digest('hex');
      assert.equal((await request(app).post('/payments/paystack/webhook').set('x-paystack-signature','bad').send(body)).status,401);
      assert.equal(f.verifyCalls(),0);
      for(let i=0;i<2;i++)assert.equal((await request(app).post('/payments/paystack/webhook').set('x-paystack-signature',signature).send(body)).status,200);
      assert.equal((await pool.query("SELECT status FROM paystack_event_inbox WHERE payload->'data'->>'reference'=$1",[checkout.reference])).rows[0].status,'pending');
      const { buildCreditJobs }=await import('../src/server/creditJobs.ts');
      await buildCreditJobs(pool,async()=>({ ...saved,mode:'live' }),f.http as any).events();
      assert.equal((await pool.query('SELECT credits FROM user_credits WHERE user_id=$1',[f.userId])).rows[0].credits,1100);
    });
  } finally { await pool.end(); }
});
