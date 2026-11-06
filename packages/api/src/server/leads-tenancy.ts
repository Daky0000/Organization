// ---------------------------------------------------------------------------
// Tenancy for the vendored leads module.
//
// The module in src/server/leads has no concept of a user: it was extracted
// from a single-tenant app, so every one of its queries reads "all leads". This
// host is multi-tenant, so something has to add "…belonging to the person who
// asked" to each one.
//
// That something is here rather than in the module, for two reasons: patching
// ~1,600 lines of query code by hand is where cross-tenant leaks come from, and
// a patched module can no longer take an upstream update. Instead a Prisma
// client extension intercepts every operation on the module's five models and
// injects `userId` — into `where` when reading, into `data` when writing. The
// module's own source stays untouched and cannot opt out.
//
// The user for the current request comes from an AsyncLocalStorage store that
// `withLeadsTenant` populates before the routers run. If it is empty, queries
// throw rather than falling back to unscoped — a missing context is a bug in
// the mounting code, and the safe failure is a 500, not somebody else's leads.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import type { NextFunction, Response } from 'express';
import type { Request } from '../types/http.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

type LeadsTenant = { userId: string; email?: string };

const tenantStore = new AsyncLocalStorage<LeadsTenant>();

/** The five models the module owns. Anything else passes through untouched. */
const TENANT_MODELS = new Set(['Lead', 'LeadGroup', 'LeadField', 'LeadActivity', 'LeadImport']);

/** Operations whose `where` is a plain filter. */
const FILTERED_READS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/**
 * Operations whose `where` is a unique input. Prisma 5's extendedWhereUnique
 * allows non-unique fields alongside the unique one, so the same injection
 * works — and turns a cross-tenant id guess into a not-found.
 */
const UNIQUE_READS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

export function currentLeadsUserId(): string {
  const tenant = tenantStore.getStore();
  if (!tenant) {
    throw new Error('Leads query ran outside a tenant context. Mount withLeadsTenant before the leads routers.');
  }
  return tenant.userId;
}

/** The acting user, for the contact log's byline. Empty outside a request. */
export function currentLeadsActor(): LeadsTenant | undefined {
  return tenantStore.getStore();
}

/** Writes that carry rows in `data` and so need `userId` stamped onto them. */
const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

function scopedWhere(where: unknown, userId: string): Record<string, unknown> {
  if (!where || typeof where !== 'object') return { userId };
  return { ...(where as Record<string, unknown>), userId };
}

function withUserId(row: unknown, userId: string): Record<string, unknown> {
  return { ...(row as Record<string, unknown>), userId };
}

/**
 * Prisma opens its own pool, on top of the 20-connection `pg` pool the host
 * already holds against the same database. Left at Prisma's default
 * (num_cpus * 2 + 1) that is how a small Postgres runs out of connections — so
 * this one is capped, since it serves a single feature.
 */
function cappedUrl(url: string, limit: number): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', String(limit));
    }
    return parsed.toString();
  } catch {
    // A connection string Node's URL can't parse is one to leave alone.
    return url;
  }
}

function buildClient(): PrismaClient | null {
  if (!config.databaseUrl) return null;
  const base = new PrismaClient({
    datasources: { db: { url: cappedUrl(config.databaseUrl, 5) } },
    log: config.nodeEnv === 'production' ? ['error'] : ['error', 'warn'],
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          const userId = currentLeadsUserId();
          const next = { ...(args as Record<string, unknown>) };

          const filtered = FILTERED_READS.has(operation) || UNIQUE_READS.has(operation);
          const written = WRITES.has(operation);

          // Fail closed. An operation nobody has taught this extension to scope
          // would otherwise run across every tenant, and silently — so a new
          // one has to be added here deliberately before it can be used.
          if (!filtered && !written) {
            throw new Error(
              `Leads tenancy: don't know how to scope "${operation}" on ${model}. Add it to leads-tenancy.ts before using it.`,
            );
          }

          if (filtered) next.where = scopedWhere(next.where, userId);

          if (operation === 'create') next.data = withUserId(next.data, userId);
          if (operation === 'upsert') next.create = withUserId(next.create, userId);

          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const data = (next as { data?: unknown }).data;
            next.data = Array.isArray(data) ? data.map((row) => withUserId(row, userId)) : withUserId(data, userId);
          }

          return query(next);
        },
      },
    },
  }) as unknown as PrismaClient;
}

let client: PrismaClient | null | undefined;

/**
 * The module's Prisma client, or null when the host is running without a
 * database. Built on first use so importing this file never opens a connection.
 */
export function leadsPrisma(): PrismaClient | null {
  if (client === undefined) {
    try {
      client = buildClient();
    } catch (err) {
      logger.error({ err }, 'Failed to create the leads Prisma client');
      client = null;
    }
  }
  return client;
}

/**
 * Express middleware: authenticate, then run the rest of the request inside a
 * tenant context. Everything downstream — including the module's routers — sees
 * only this user's rows.
 */
export function withLeadsTenant(requireAuth: (req: Request, res: Response) => { userId: string; email?: string } | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = requireAuth(req, res);
    if (!auth) return; // requireAuth has already answered 401
    if (!leadsPrisma()) {
      res.status(503).json({ error: 'Lead generation needs a database connection.' });
      return;
    }
    tenantStore.run({ userId: auth.userId, email: auth.email }, () => next());
  };
}
