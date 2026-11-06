import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import { Redis as IORedis } from 'ioredis';

// ── Redis-backed store for express-rate-limit ──────────────────────────────
// Falls back to the default in-memory store if Redis is not configured.

function buildRedisStore(redis: InstanceType<typeof IORedis>, prefix: string, windowMs: number): Store {
  return {
    async increment(key: string): Promise<IncrementResponse> {
      const redisKey = `${prefix}:${key}`;
      const pipeline = redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.pttl(redisKey);
      const results = await pipeline.exec();
      const totalHits = (results?.[0]?.[1] as number) ?? 1;
      const ttl = (results?.[1]?.[1] as number) ?? -1;
      if (ttl < 0) await redis.pexpire(redisKey, windowMs);
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : windowMs));
      return { totalHits, resetTime };
    },
    async decrement(key: string): Promise<void> {
      await redis.decr(`${prefix}:${key}`);
    },
    async resetKey(key: string): Promise<void> {
      await redis.del(`${prefix}:${key}`);
    },
  };
}

function makeStore(prefix: string, windowMs: number): Partial<Options> {
  const redisUrl = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
  if (!redisUrl) return {};
  try {
    const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
    redis.connect().catch(() => undefined);
    return { store: buildRedisStore(redis, prefix, windowMs) };
  } catch {
    return {};
  }
}

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const PWD_WINDOW_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: 15,
  standardHeaders: true,
  legacyHeaders: true,
  message: { success: false, error: 'Too many attempts, please try again later' },
  skipSuccessfulRequests: false,
  ...makeStore('rl:auth', AUTH_WINDOW_MS),
});

export const passwordLimiter = rateLimit({
  windowMs: PWD_WINDOW_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: true,
  message: { success: false, error: 'Too many password change attempts, please try again in an hour' },
  ...makeStore('rl:pwd', PWD_WINDOW_MS),
});

// Inbound public API (POST /api/v1/trigger) — keyed by API key when present
export const publicApiLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: 120,
  standardHeaders: true,
  legacyHeaders: true,
  keyGenerator: (req) => String(req.headers.authorization || '').trim() || ipKeyGenerator(req.ip ?? ''),
  message: { success: false, error: 'Rate limit exceeded — max 120 requests per minute' },
  ...makeStore('rl:pubapi', ONE_MINUTE_MS),
});

// AI Chat & Agent Orchestration Rate Limiter — protects token budgets against rapid spam
export const aiChatLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: true,
  keyGenerator: (req) => String(req.headers.authorization || '').slice(-32) || ipKeyGenerator(req.ip ?? ''),
  message: { success: false, error: 'AI rate limit reached (30 requests/min). Please wait a few seconds before sending another message.' },
  ...makeStore('rl:aichat', ONE_MINUTE_MS),
});

// Image & Video Generation Rate Limiter — protects GPU generation endpoints
export const generationLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: 12,
  standardHeaders: true,
  legacyHeaders: true,
  keyGenerator: (req) => String(req.headers.authorization || '').slice(-32) || ipKeyGenerator(req.ip ?? ''),
  message: { success: false, error: 'Generation rate limit reached (12/min). Please allow current renders to complete.' },
  ...makeStore('rl:gen', ONE_MINUTE_MS),
});

// Dakyworld OS Bridge Rate Limiter — high-throughput API with standard RateLimit headers
export const osApiLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  max: 300,
  standardHeaders: true,
  legacyHeaders: true,
  keyGenerator: (req) => String(req.headers.authorization || req.headers['x-dakyworld-os-key'] || '').trim() || ipKeyGenerator(req.ip ?? ''),
  message: { success: false, error: 'Dakyworld OS Bridge rate limit exceeded (300 req/min).' },
  ...makeStore('rl:osapi', ONE_MINUTE_MS),
});

// ─────────────────────────────────────────────────────────────────────────────
// SaaS Idempotency-Key Middleware
// Guarantees that retried POST/PUT requests carrying `Idempotency-Key` return
// the exact original response without double-charging credits or duplicating posts.
// ─────────────────────────────────────────────────────────────────────────────

export { idempotencyMiddleware } from './idempotency.ts';
