import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

function findUpDirContainingAny(startDir: string, candidateNames: string[]) {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const name of candidateNames) {
      if (existsSync(path.join(dir, name))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadDotEnv() {
  // Only load local env files in non-production contexts. In production, env vars should be injected.
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') return;

  // In a workspace, the process CWD is often `packages/api`, while `.env` lives at repo root.
  // Search upwards from this file’s directory so running `npm --workspace ...` still picks up root env files.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envDir = findUpDirContainingAny(here, ['.env', '.env.local']);
  if (!envDir) return;

  // Load `.env` first, then `.env.local` to override without requiring `.env.local` to be complete.
  const envPath = path.join(envDir, '.env');
  if (existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
  const envLocalPath = path.join(envDir, '.env.local');
  if (existsSync(envLocalPath)) dotenv.config({ path: envLocalPath, override: false, quiet: true });
}

loadDotEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().optional(),
  // Common provider aliases for Postgres URLs
  POSTGRES_URL: z.string().optional(),
  POSTGRES_URL_NON_POOLING: z.string().optional(),
  POSTGRES_PRISMA_URL: z.string().optional(),
  // pg-style discrete connection vars (some hosts expose these instead of a single URL)
  PGHOST: z.string().optional(),
  PGPORT: z.coerce.number().int().positive().optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().optional(),
  PGSSLMODE: z.string().optional(),
  JWT_SECRET: z.string().min(1),
  INTEGRATIONS_ENCRYPTION_KEY: z.string().min(1),
  WORDPRESS_ENCRYPTION_KEY: z.string().min(1),
  FRONTEND_ORIGINS: z.string().optional(),
  // App URL used in password-reset / email-verification links
  VITE_APP_URL: z.string().optional(),
  // Redis
  REDIS_URL: z.string().optional(),
  BULLMQ_REDIS_URL: z.string().optional(),
  // Social rate-limit config
  TWITTER_MONTHLY_WRITE_LIMIT: z.coerce.number().default(0),
  X_MONTHLY_WRITE_LIMIT: z.coerce.number().default(0),
  SOCIAL_TOKEN_SAFETY_MARGIN_DAYS: z.coerce.number().default(10),
  // Serving static assets (e.g. on Railway combined deploy)
  SERVE_STATIC: z.string().optional(),
  // Error monitoring — when unset, Sentry is a no-op
  SENTRY_DSN: z.string().optional(),
  // Facebook / Meta webhook
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  FACEBOOK_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
});

function assertProductionDatabase(nodeEnv: string, databaseUrl: string | undefined) {
  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error(
      'A Postgres connection must be configured in production. Set DATABASE_URL (preferred), or POSTGRES_URL/POSTGRES_URL_NON_POOLING, or PGHOST/PGUSER/PGPASSWORD/PGDATABASE.'
    );
  }
}

function assertStrongSecret(name: string, value: string, nodeEnv: string) {
  if (nodeEnv !== 'production') return;
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters in production`);
  }
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment:\n${message}`);
}

const env = parsed.data;

function buildPgUrlFromParts(e: typeof env) {
  const host = e.PGHOST;
  const user = e.PGUSER;
  const password = e.PGPASSWORD;
  const database = e.PGDATABASE;
  if (!host || !user || !database) return undefined;

  const port = e.PGPORT ?? 5432;
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  const url = `postgresql://${auth}@${host}:${port}/${database}`;
  const sslmode = e.PGSSLMODE ? `?sslmode=${encodeURIComponent(e.PGSSLMODE)}` : '';
  return `${url}${sslmode}`;
}

const resolvedDatabaseUrl =
  env.DATABASE_URL ||
  env.POSTGRES_URL_NON_POOLING ||
  env.POSTGRES_URL ||
  env.POSTGRES_PRISMA_URL ||
  buildPgUrlFromParts(env);

assertStrongSecret('JWT_SECRET', env.JWT_SECRET, env.NODE_ENV);
assertStrongSecret('INTEGRATIONS_ENCRYPTION_KEY', env.INTEGRATIONS_ENCRYPTION_KEY, env.NODE_ENV);
assertStrongSecret('WORDPRESS_ENCRYPTION_KEY', env.WORDPRESS_ENCRYPTION_KEY, env.NODE_ENV);
assertProductionDatabase(env.NODE_ENV, resolvedDatabaseUrl);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: resolvedDatabaseUrl,
  jwtSecret: env.JWT_SECRET,
  integrationsEncryptionKey: env.INTEGRATIONS_ENCRYPTION_KEY,
  wordpressEncryptionKey: env.WORDPRESS_ENCRYPTION_KEY,
  frontendOrigins: env.FRONTEND_ORIGINS
    ? env.FRONTEND_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : undefined,
  appUrl: (env.VITE_APP_URL ?? 'https://marketing.dakyx.com').replace(/\/$/, ''),
  redisUrl: env.REDIS_URL ?? env.BULLMQ_REDIS_URL ?? '',
  twitterMonthlyWriteLimit: Math.max(env.TWITTER_MONTHLY_WRITE_LIMIT, env.X_MONTHLY_WRITE_LIMIT),
  socialTokenSafetyMarginDays: env.SOCIAL_TOKEN_SAFETY_MARGIN_DAYS,
  serveStatic: env.SERVE_STATIC === 'true',
  sentryDsn: env.SENTRY_DSN ?? '',
  metaWebhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN ?? env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ?? 'dakyworld_hub_meta_verify_2026_token',
  facebookAppSecret: env.FACEBOOK_APP_SECRET ?? env.META_APP_SECRET ?? '',
} as const;
