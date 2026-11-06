import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.NODE_ENV='test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);
const { registerOrgRoutes }=await import('../src/server/orgRoutes.ts');
const { registerClientApprovalAndWebhookRoutes }=await import('../src/server/clientApprovalRoutes.ts');
const { registerDakyworldOsRoutes }=await import('../src/server/dakyworldOsRoutes.ts');
const { idempotencyMiddleware }=await import('../src/middleware/idempotency.ts');
const { validateRasterDataUrl }=await import('../src/server/mediaValidation.ts');
const { ownedCrmReferences }=await import('../src/server/ownership.ts');
const auth=()=>({ userId: 'u' });
const appFor=(router: express.Router)=>{ const app=express();app.use(express.json());app.use(router);return app; };
const base={ requireAuth: auth,hasDatabase: ()=>true,requireOrgMembership: async()=>({ userId: 'u',role: 'viewer' }),createNotification: async()=>{},checkTaskActions: async()=>[],logTaskActivity: async()=>{} };

test('viewer cannot edit task details',async()=>{
  let writes=0;
  const app=appFor(registerOrgRoutes({ ...base,dbQuery: async(sql:string)=>{ if(sql.includes('SELECT om.role')) return { rows: [{ role: 'viewer' }] };writes++;return { rows: [] }; } } as any));
  assert.equal((await request(app).put('/projects/p/tasks/t').send({ title: 'changed' })).status,403);assert.equal(writes,0);
});
test('task status lookup and write both include authorized project',async()=>{
  const queries:string[]=[];
  const app=appFor(registerOrgRoutes({ ...base,dbQuery: async(sql:string)=>{ queries.push(sql);if(sql.includes('SELECT om.role'))return { rows: [{ role: 'admin' }] };if(sql.includes('SELECT status'))return { rows: [] };return { rows: [] }; } } as any));
  assert.equal((await request(app).patch('/projects/p/tasks/foreign/status').send({ status: 'done' })).status,404);
  assert.ok(queries.find(sql=>sql.includes('SELECT status'))?.includes('project_id=$2'),JSON.stringify(queries));
  assert.ok(!queries.some(sql=>sql.includes('UPDATE tasks')));
});
test('nested task attachments and subtasks require organization membership',async()=>{
  const app=appFor(registerOrgRoutes({ ...base,dbQuery: async()=>({ rows: [] }) } as any));
  assert.equal((await request(app).post('/tasks/foreign/subtasks').send({ title: 'bad' })).status,403);
  assert.equal((await request(app).delete('/tasks/foreign/attachments/asset')).status,403);
});
test('read-only OS key cannot mutate webhook registry',async()=>{
  const pool={ query: async(sql:string)=>({ rows: sql.includes('FROM api_keys') ? [{ user_id: 'u',id: 'k',scopes: ['analytics:read'] }] : [] }) };
  const app=appFor(registerDakyworldOsRoutes({ pool: pool as any,requireAuth: auth }));
  assert.equal((await request(app).post('/webhooks').set('Authorization','Bearer cf_live_fixture').send({ target_url: 'https://example.com' })).status,403);
});
test('expired review cannot accept a decision',async()=>{
  let predicate='';
  const pool={ query: async(sql:string)=>{ predicate=sql;return { rows: [] }; } };
  const app=appFor(registerClientApprovalAndWebhookRoutes({ pool: pool as any,requireAuth: auth,getUserPlanName: async()=>'Free' }));
  assert.equal((await request(app).post('/public/review/expired/decision').send({ decision: 'approved' })).status,404);
  assert.ok(predicate.includes('expires_at > NOW()'));
});
test('concurrent idempotency keys execute once and conflicting bodies are rejected',async()=>{
  const app=express();app.use(express.json());let executions=0;
  app.post('/test',idempotencyMiddleware,async(_req,res)=>{ executions++;await new Promise(resolve=>setTimeout(resolve,25));res.json({ success: true }); });
  const make=(body: object)=>request(app).post('/test').set('Idempotency-Key','security-fixture').set('Authorization','Bearer fixture').send(body);
  const results=await Promise.all([make({ amount: 1 }),make({ amount: 1 })]);
  assert.equal(executions,1);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await make({ amount: 2 })).status,409);
  assert.equal((await make({ amount: 1 })).status,200);assert.equal(executions,1);
});
test('media validation rejects HTML, SVG, mismatched MIME, and invalid image bytes',()=>{
  for(const url of ['data:text/html;base64,PHNjcmlwdD4=','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PHNjcmlwdD4='])assert.throws(()=>validateRasterDataUrl(url,'image/png'));
});
test('CRM relations reject records owned by another user',async()=>{
  assert.equal(await ownedCrmReferences({ query: async()=>({ rows: [] }) } as any,'u',{ company_id: 'foreign' }),false);
  assert.equal(await ownedCrmReferences({ query: async()=>({ rows: [{ id: 'owned' }] }) } as any,'u',{ company_id: 'owned' }),true);
});
