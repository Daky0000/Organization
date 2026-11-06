import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface DbAuditDeps {
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  pool: Pool;
}

export function registerDbAuditRoutes({ requireAdmin, pool }: DbAuditDeps): Router {
  const router = express.Router();

  // GET /api/admin/db-audit
  router.get('/db-audit', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const tablesRes = await pool.query(`
        SELECT t.tablename,
               pg_size_pretty(pg_total_relation_size(quote_ident('public') || '.' || quote_ident(t.tablename))) AS size_pretty,
               pg_total_relation_size(quote_ident('public') || '.' || quote_ident(t.tablename)) AS size_bytes,
               COALESCE(s.n_live_tup, 0) AS row_count
        FROM pg_tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename AND s.schemaname = 'public'
        WHERE t.schemaname = 'public'
        ORDER BY size_bytes DESC
      `);

      const dupsRes = await pool.query(`
        SELECT LOWER(tablename) AS normalized_name,
               STRING_AGG(tablename, ',') AS variants,
               COUNT(*)::int AS count
        FROM pg_tables WHERE schemaname = 'public'
        GROUP BY LOWER(tablename) HAVING COUNT(*) > 1
      `);

      const emptyRes = await pool.query(`
        SELECT t.tablename
        FROM pg_tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename AND s.schemaname = 'public'
        WHERE t.schemaname = 'public' AND COALESCE(s.n_live_tup, 0) = 0
        ORDER BY t.tablename
      `);

      const idxRes = await pool.query(`
        SELECT s.relname AS table_name, s.indexrelname AS index_name,
               s.idx_scan AS scans,
               pg_size_pretty(pg_relation_size(s.indexrelid)) AS size_pretty,
               pg_relation_size(s.indexrelid) AS size_bytes
        FROM pg_stat_user_indexes s
        JOIN pg_index ix ON ix.indexrelid = s.indexrelid
        WHERE s.schemaname = 'public' AND s.idx_scan = 0 AND NOT ix.indisprimary
        ORDER BY size_bytes DESC
      `);

      const fkRes = await pool.query(`
        SELECT kcu.table_name AS child_table, kcu.column_name AS fk_column, ccu.table_name AS parent_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      `);
      const orphans: { child_table: string; fk_column: string; parent_table: string; count: number }[] = [];
      for (const fk of fkRes.rows as any[]) {
        try {
          const cnt = await pool.query(
            `SELECT COUNT(*)::int AS c FROM "${fk.child_table}"
             WHERE "${fk.fk_column}" IS NOT NULL
               AND "${fk.fk_column}" NOT IN (SELECT id FROM "${fk.parent_table}")`
          );
          if ((cnt.rows[0]?.c ?? 0) > 0)
            orphans.push({ child_table: fk.child_table, fk_column: fk.fk_column, parent_table: fk.parent_table, count: cnt.rows[0].c });
        } catch (_err) { /* skip complex FKs */ }
      }

      const cacheRes = await pool.query(`
        SELECT ROUND(SUM(heap_blks_hit)::numeric / NULLIF(SUM(heap_blks_hit)+SUM(heap_blks_read),0)*100,2) AS ratio
        FROM pg_statio_user_tables
      `);

      return res.json({
        success: true,
        issues: {
          duplicate_tables: dupsRes.rows.length,
          empty_tables: emptyRes.rows.length,
          unused_indexes: idxRes.rows.length,
          orphaned_fk_rows: orphans.length,
        },
        tables: tablesRes.rows,
        duplicates: dupsRes.rows.map((r: any) => ({ normalizedName: r.normalized_name, variants: r.variants.split(','), count: r.count })),
        empty_tables: emptyRes.rows.map((r: any) => r.tablename),
        unused_indexes: idxRes.rows,
        orphaned_records: orphans,
        cache_hit_ratio_pct: cacheRes.rows[0]?.ratio ?? null,
      });
    } catch (err: any) {
      logger.error('[db-audit]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/db-cleanup
  router.post('/db-cleanup', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { drop_empty, drop_unused_indexes, delete_orphans } = req.body as {
      drop_empty?: string[];
      drop_unused_indexes?: string[];
      delete_orphans?: { child_table: string; fk_column: string; parent_table: string }[];
    };

    const log: string[] = [];
    const errors: string[] = [];

    try {
      if (drop_empty?.length) {
        for (const t of drop_empty) {
          try {
            await pool.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
            log.push(`Dropped empty table: ${t}`);
          } catch (e: any) { errors.push(`drop ${t}: ${e.message}`); }
        }
      }

      if (drop_unused_indexes?.length) {
        for (const idx of drop_unused_indexes) {
          try {
            await pool.query(`DROP INDEX IF EXISTS "${idx}"`);
            log.push(`Dropped unused index: ${idx}`);
          } catch (e: any) { errors.push(`drop index ${idx}: ${e.message}`); }
        }
      }

      if (delete_orphans?.length) {
        for (const o of delete_orphans) {
          try {
            const r = await pool.query(
              `DELETE FROM "${o.child_table}" WHERE "${o.fk_column}" IS NOT NULL AND "${o.fk_column}" NOT IN (SELECT id FROM "${o.parent_table}")`
            );
            log.push(`Deleted ${r.rowCount} orphaned rows from ${o.child_table}.${o.fk_column}`);
          } catch (e: any) { errors.push(`orphan ${o.child_table}: ${e.message}`); }
        }
      }

      await pool.query('ANALYZE');
      log.push('ANALYZE complete');

      return res.json({ success: errors.length === 0, log, errors });
    } catch (err: any) {
      logger.error('[db-cleanup]', err);
      return res.status(500).json({ success: false, error: err.message, log, errors });
    }
  });

  return router;
}
