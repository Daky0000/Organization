import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { BUILD_COMMIT_SHA, BUILD_COMMIT_SOURCE, BUILD_TIME } from '../../build-info.ts';
import { SCHEMA_SOURCE_HASH } from '../../schema-fingerprint.ts';
import { computeLiveSchemaFingerprint } from '../../db-migrations.ts';
import { checkProviderHealth, getAutopilotProviderStatus, type ProviderBridgeDeps } from './autopilotProviderBridge.ts';
import { listSelectableModels } from './creativeBriefAndRouter.ts';
import type { AssetStorageDriver, StorageResolution } from './assetStorage.ts';
import { isGlobalGenerationKilled, isGlobalPublishingKilled } from './billingAndBudgetService.ts';
import { logger } from '../../logger.ts';

// Release-owner view: which code and schema are running, whether media can be
// stored and fetched, which providers are merely configured versus checked,
// and how much work is stuck. Holds no credentials, environment dumps,
// network internals or customer content.

export async function buildAutopilotDiagnostics(opts: {
  pool: Pick<Pool, 'query'> | null;
  storage: StorageResolution;
  providerDeps: ProviderBridgeDeps;
  checkStorageWrite?: boolean;
  forceProviderCheck?: boolean;
}) {
  const out: Record<string, any> = {
    generated_at: new Date().toISOString(),
    build: { commit_sha: BUILD_COMMIT_SHA, sha_source: BUILD_COMMIT_SOURCE, built_at: BUILD_TIME },
    deploy: { railway_commit_sha: process.env.RAILWAY_GIT_COMMIT_SHA || null },
    revision_match: process.env.RAILWAY_GIT_COMMIT_SHA ? process.env.RAILWAY_GIT_COMMIT_SHA === BUILD_COMMIT_SHA : null,
    kill_switches: { generation: isGlobalGenerationKilled(), publishing: isGlobalPublishingKilled() },
  };

  if (opts.pool) {
    try {
      const live = await computeLiveSchemaFingerprint(opts.pool);
      const migrations = await opts.pool.query(`SELECT version, checksum, applied_at FROM schema_migrations ORDER BY applied_at ASC, version ASC`);
      out.schema = {
        migration_source_hash: SCHEMA_SOURCE_HASH,
        live_fingerprint: live.fingerprint,
        tables: live.tables,
        columns: live.columns,
        indexes: live.indexes,
        applied_migrations: migrations.rows.map((r: any) => ({ version: r.version, checksum: r.checksum, applied_at: r.applied_at })),
      };
    } catch (err: any) {
      out.schema = { error: 'schema read failed' };
      logger.warn({ err: err?.message }, 'diagnostics_schema_failed');
    }
  } else {
    out.schema = { error: 'no database' };
  }

  const status = await getAutopilotProviderStatus(opts.pool as any);
  out.execution = {
    mode: status.executionMode,
    sandbox_enabled: status.sandboxEnabled,
    selectable_models: listSelectableModels().filter((m) => m.selectable).map((m) => m.id),
    unselectable_models: listSelectableModels().filter((m) => !m.selectable).map((m) => ({ id: m.id, reason: m.unavailable_reason })),
  };
  out.providers = {
    configured: { openai: status.openai, magnific: status.magnific, llm: status.llm },
    health: await checkProviderHealth(opts.providerDeps, Boolean(opts.forceProviderCheck)).catch(() => ({ error: 'health check failed' })),
  };

  out.storage = await storageHealth(opts.storage, Boolean(opts.checkStorageWrite));

  if (opts.pool) {
    try {
      const pubs = await opts.pool.query(
        `SELECT status, COUNT(*)::int AS n,
                EXTRACT(EPOCH FROM (NOW() - MIN(COALESCE(next_attempt_at, scheduled_at))))::int AS oldest_due_age_s
         FROM autopilot_publications
         WHERE status NOT IN ('published', 'cancelled')
         GROUP BY status`,
      );
      const res = await opts.pool.query(
        `SELECT status, COUNT(*)::int AS n, EXTRACT(EPOCH FROM (NOW() - MIN(updated_at)))::int AS oldest_age_s
         FROM autopilot_budget_reservations WHERE status IN ('reserved', 'submitted', 'reconciliation_required') GROUP BY status`,
      );
      const assets = await opts.pool.query(
        `SELECT COUNT(*) FILTER (WHERE delivery_verified_at IS NULL AND deleted_at IS NULL)::int AS unverified,
                COUNT(*) FILTER (WHERE is_demo AND deleted_at IS NULL)::int AS demo
         FROM autopilot_assets`,
      );
      out.queues = {
        publications: pubs.rows,
        reservations_open: res.rows,
        assets: assets.rows[0] ?? {},
      };
    } catch (err: any) {
      out.queues = { error: 'queue read failed' };
      logger.warn({ err: err?.message }, 'diagnostics_queue_failed');
    }
  }
  return out;
}

async function storageHealth(storage: StorageResolution, writeProbe: boolean) {
  if (!storage.driver) return { configured: false, description: storage.description };
  const result: Record<string, any> = { configured: true, driver: storage.driver.name, description: storage.description };
  if (!writeProbe) return { ...result, probe: 'skipped (pass ?probe=storage to write, read and delete a probe object)' };
  const key = `autopilot/_probe/${randomUUID()}.png`;
  // Smallest valid PNG: 1x1 transparent pixel.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const t0 = Date.now();
  try {
    await storage.driver.put(key, png, 'image/png', { sha256: 'probe', tenantId: '_probe' });
    const head = await storage.driver.head(key);
    const body = await storage.driver.get(key);
    await storage.driver.delete(key);
    return { ...result, probe: head && body && body.equals(png) ? 'ok' : 'mismatch', latency_ms: Date.now() - t0 };
  } catch (err: any) {
    return { ...result, probe: 'failed', error: err?.code || 'storage error', latency_ms: Date.now() - t0 };
  }
}

/** Removes expired temporary (demo) assets: stored object first, then marks the record deleted. */
export async function sweepExpiredAssets(pool: Pick<Pool, 'query'>, storage: AssetStorageDriver | null, limit = 100) {
  if (!storage) return { deleted: 0 };
  const { rows } = await pool.query(
    `SELECT id, tenant_id, storage_key, storage_driver FROM autopilot_assets
     WHERE expires_at IS NOT NULL AND expires_at < NOW() AND deleted_at IS NULL AND retention_class = 'temporary'
     ORDER BY expires_at ASC LIMIT $1`,
    [limit],
  );
  let deleted = 0;
  for (const r of rows) {
    if (r.storage_driver !== storage.name) continue;
    try {
      await storage.delete(r.storage_key);
      await pool.query(`UPDATE autopilot_assets SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2`, [r.id, r.tenant_id]);
      deleted++;
    } catch (err: any) {
      logger.warn({ err: err?.message, assetId: r.id }, 'autopilot_asset_expiry_failed');
    }
  }
  return { deleted };
}
