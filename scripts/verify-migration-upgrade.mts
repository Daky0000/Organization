// Upgrade-path check: run a previous release's migrations, write representative
// rows, then run this tree's migrations on the same database and confirm the
// rows survive and the new columns are populated with their defaults.
//
//   git worktree add .wt-base <previous-release-sha>
//   TEST_DATABASE_URL=postgres://... node --import tsx scripts/verify-migration-upgrade.mts .wt-base
//
// Exits non-zero on any failure. Prints the schema fingerprint after upgrade.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const baseDir = process.argv[2];
const url = process.env.TEST_DATABASE_URL;
if (!baseDir || !url) {
  console.error('usage: TEST_DATABASE_URL=... node --import tsx scripts/verify-migration-upgrade.mts <previous-release-worktree>');
  process.exit(2);
}
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

const load = (root: string, rel: string) => import(pathToFileURL(path.resolve(root, rel)).href);
const pool = new pg.Pool({ connectionString: url });
const fail = (msg: string) => { console.error(`UPGRADE CHECK FAILED: ${msg}`); process.exitCode = 1; };

try {
  const oldMig = await load(baseDir, 'packages/api/src/db-migrations.ts');
  const oldPay = await load(baseDir, 'packages/api/src/payment-migrations.ts');
  await oldMig.runDatabaseMigrations(pool);
  await oldPay.runPaymentMigrations(pool);
  console.log('previous release migrated');

  const userId = randomUUID();
  const tenant = `user:${userId}`;
  const itemId = randomUUID();
  const pubId = randomUUID();
  const resId = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash, role, status) VALUES ($1,$2,'h','user','active')`, [userId, `upgrade-${userId}@example.com`]);
  await pool.query(`INSERT INTO autopilot_content_items (id, tenant_id, owner_user_id, title, media_assets, created_by) VALUES ($1,$2,$3,'Legacy item','[{"url":"https://cdn.contentflow.local/autopilot/x/reel-master.mp4","type":"video"}]'::jsonb,$3)`, [itemId, tenant, userId]);
  await pool.query(`INSERT INTO autopilot_publications (id, tenant_id, content_item_id, channel, status, scheduled_at) VALUES ($1,$2,$3,'instagram','scheduled',NOW())`, [pubId, tenant, itemId]);
  await pool.query(`INSERT INTO autopilot_budget_reservations (id, tenant_id, user_id, content_item_id, idempotency_key, status, estimated_provider_cost_usd, reserved_credits) VALUES ($1,$2,$3,$4,'wf:legacy:att:1','reserved',0.12,8)`, [resId, tenant, userId, itemId]);
  console.log('representative rows written');

  const newMig = await load(process.cwd(), 'packages/api/src/db-migrations.ts');
  const newPay = await load(process.cwd(), 'packages/api/src/payment-migrations.ts');
  await newMig.runDatabaseMigrations(pool);
  await newPay.runPaymentMigrations(pool);
  console.log('upgraded to this tree');

  const item = await pool.query(`SELECT title, media_assets FROM autopilot_content_items WHERE id = $1`, [itemId]);
  if (item.rows[0]?.title !== 'Legacy item') fail('content item lost');
  const pub = await pool.query(`SELECT status, attempt_count, version, provider_container_id FROM autopilot_publications WHERE id = $1`, [pubId]);
  if (pub.rows[0]?.status !== 'scheduled' || pub.rows[0]?.attempt_count !== 0 || pub.rows[0]?.version !== 1) fail(`publication not upgraded cleanly: ${JSON.stringify(pub.rows[0])}`);
  const res = await pool.query(`SELECT status, estimated_provider_cost_usd, credits_held, units, cost_status FROM autopilot_budget_reservations WHERE id = $1`, [resId]);
  if (res.rows[0]?.status !== 'reserved' || Number(res.rows[0]?.estimated_provider_cost_usd) !== 0.12 || res.rows[0]?.cost_status !== 'estimated') fail(`reservation not upgraded cleanly: ${JSON.stringify(res.rows[0])}`);
  const mig = await pool.query(`SELECT version, checksum FROM schema_migrations ORDER BY version`);
  if (!mig.rows.some((r: any) => r.version === newMig.AUTOPILOT_P0_SCHEMA_VERSION && /^[0-9a-f]{64}$/.test(r.checksum))) fail('P0 migration not recorded with a checksum');
  const fp = await newMig.computeLiveSchemaFingerprint(pool);
  console.log(`schema_fingerprint=${fp.fingerprint} tables=${fp.tables} columns=${fp.columns} indexes=${fp.indexes}`);
  console.log(`migrations: ${mig.rows.map((r: any) => r.version).join(', ')}`);

  // Legacy media URLs stay visible to QA as non-durable; nothing rewrote them into something publishable.
  const { evaluateMediaPublishability } = await load(process.cwd(), 'packages/api/src/server/autopilot/mediaQa.ts');
  const codes = evaluateMediaPublishability({ item: { ...item.rows[0], tenant_id: tenant, workflow_type: 'short_form_video', format: 'short_video', channel_variants: {}, target_channels: ['instagram'] }, assets: new Map(), channels: ['instagram'] }).map((i: any) => i.code);
  if (!codes.includes('MEDIA_NOT_DURABLE')) fail(`legacy fake URL was not blocked: ${codes.join(',')}`);
  if (!process.exitCode) console.log('UPGRADE CHECK PASSED');
} catch (err) {
  fail(String((err as Error)?.stack || err));
} finally {
  await pool.end();
}
