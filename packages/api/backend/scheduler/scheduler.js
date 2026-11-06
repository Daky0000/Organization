// Scheduler Engine — BullMQ + rate limiting + exponential backoff
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
const QUEUE_NAME = 'social-publish';
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 30_000; // 30s base; doubles per attempt

// Per-platform rate limits (posts per second)
const PLATFORM_RATE_LIMITS = {
  facebook:  { max: 5, intervalMs: 1000 },
  instagram: { max: 3, intervalMs: 1000 },
  twitter:   { max: 2, intervalMs: 1000 },
  linkedin:  { max: 3, intervalMs: 1000 },
  default:   { max: 5, intervalMs: 1000 },
};

// In-memory per-platform rate limit windows
const rateLimitWindows = {};

function getRateLimit(platform) {
  return PLATFORM_RATE_LIMITS[platform] || PLATFORM_RATE_LIMITS.default;
}

// Simple token-bucket rate limiter
async function withRateLimit(platform, fn) {
  const { max, intervalMs } = getRateLimit(platform);
  const now = Date.now();

  if (!rateLimitWindows[platform]) {
    rateLimitWindows[platform] = { count: 0, windowStart: now };
  }

  const window = rateLimitWindows[platform];
  if (now - window.windowStart >= intervalMs) {
    window.count = 0;
    window.windowStart = now;
  }

  if (window.count >= max) {
    const waitMs = intervalMs - (now - window.windowStart) + 50;
    await new Promise(r => setTimeout(r, waitMs));
    window.count = 0;
    window.windowStart = Date.now();
  }

  window.count++;
  return fn();
}

function getRetryDelayMs(attemptNumber) {
  const n = Math.max(1, Number(attemptNumber || 1));
  return BASE_DELAY_MS * Math.pow(2, n - 1);
}

let postQueue = null;
let postWorker = null;
let connection = null;

function createQueue(platformRegistry) {
  if (!REDIS_URL) {
    console.warn('[Scheduler] REDIS_URL not set; BullMQ scheduler disabled.');
    return null;
  }

  connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  postQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: BASE_DELAY_MS },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });

  postWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { platformName, postObject, ctx } = job.data;
      const platform = platformRegistry[platformName];

      if (!platform) {
        throw new Error(`Unknown platform: ${platformName}`);
      }

      // Pre-flight validation
      const validation = platform.validate(postObject);
      if (!validation.ok) {
        // Validation failures are permanent — don't retry
        const err = new Error(validation.error);
        err.name = 'ValidationError';
        throw err;
      }

      const result = await withRateLimit(platformName, () => platform.post(postObject, ctx));

      if (result.status === 'failed') {
        if (!result.retryable) {
          // Permanent failure — stop retrying
          const err = new Error(result.error || 'Post failed (permanent)');
          err.name = 'PermanentError';
          throw err;
        }
        // Retryable — BullMQ will retry with backoff
        throw new Error(result.error || 'Post failed (retryable)');
      }

      return result;
    },
    {
      connection,
      concurrency: 5,
    }
  );

  postWorker.on('completed', (job, result) => {
    console.log(`[Scheduler] Job ${job.id} completed on ${job.data.platformName}:`, result?.platformPostId || 'ok');
  });

  postWorker.on('failed', (job, err) => {
    const isPermanent = err?.name === 'PermanentError' || err?.name === 'ValidationError';
    console.error(`[Scheduler] Job ${job?.id} failed (${isPermanent ? 'permanent' : 'retryable'}):`, err?.message);
  });

  console.log('[Scheduler] BullMQ queue started:', QUEUE_NAME);
  return { postQueue, postWorker };
}

async function schedulePost(platformName, postObject, ctx, scheduledAt) {
  if (!postQueue) {
    console.warn('[Scheduler] Queue not initialized; post dropped.');
    return null;
  }
  const delay = scheduledAt ? Math.max(0, new Date(scheduledAt).getTime() - Date.now()) : 0;
  const job = await postQueue.add(
    'publish',
    { platformName, postObject, ctx },
    { delay }
  );
  return job.id;
}

async function retryJob(jobId) {
  if (!postQueue) return false;
  const job = await postQueue.getJob(jobId);
  if (!job) return false;
  await job.retry();
  return true;
}

module.exports = { createQueue, schedulePost, retryJob, getRetryDelayMs };
