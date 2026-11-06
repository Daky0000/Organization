import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);
delete process.env.MAGNIFIC_WEBHOOK_SECRET;

const { magnificPost, MAGNIFIC_SUBMIT_MAX_ATTEMPTS } = await import('../src/server/magnificRoutes.ts');

// Instant timers so backoff waits do not slow the suite.
function fastTimers() {
  const real = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void) => real(fn, 0);
  return () => { (globalThis as any).setTimeout = real; };
}

test('magnificPost: 429 is retried with backoff, then succeeds', async () => {
  const realPost = axios.post;
  const restoreTimers = fastTimers();
  const statuses = [429, 503, 200];
  let calls = 0;
  (axios as any).post = async () => ({ status: statuses[calls++], headers: {}, data: { data: { task_id: 't1' } } });
  try {
    const res = await magnificPost('/v1/ai/mystic', { prompt: 'x' }, 'key');
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  } finally { (axios as any).post = realPost; restoreTimers(); }
});

test('magnificPost: gives up after the attempt cap and returns the last response', async () => {
  const realPost = axios.post;
  const restoreTimers = fastTimers();
  let calls = 0;
  (axios as any).post = async () => { calls++; return { status: 429, headers: { 'retry-after': '1' }, data: {} }; };
  try {
    const res = await magnificPost('/v1/ai/mystic', { prompt: 'x' }, 'key');
    assert.equal(res.status, 429);
    assert.equal(calls, MAGNIFIC_SUBMIT_MAX_ATTEMPTS);
  } finally { (axios as any).post = realPost; restoreTimers(); }
});

test('magnificPost: a 500 is not retried (the task may already exist and be billed)', async () => {
  const realPost = axios.post;
  let calls = 0;
  (axios as any).post = async () => { calls++; return { status: 500, headers: {}, data: {} }; };
  try {
    const res = await magnificPost('/v1/ai/mystic', { prompt: 'x' }, 'key');
    assert.equal(res.status, 500);
    assert.equal(calls, 1);
  } finally { (axios as any).post = realPost; }
});
