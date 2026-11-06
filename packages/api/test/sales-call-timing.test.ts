import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { scoreCallWindows, shrinkageEstimate, permittedBuckets, MIN_ATTEMPTS_FOR_MODEL, K_LEAD, K_BUCKET } =
  await import('../src/server/sales/callTiming.ts');
const { DEFAULT_CALL_POLICY } = await import('../src/server/sales/types.ts');

const policy = { ...DEFAULT_CALL_POLICY, enabled: true, allowedDays: [1, 2, 3, 4, 5] };

/** Spread `attempts` evenly across the permitted buckets to clear the floor. */
function filler(attempts: number, answered: number) {
  return [{ weekday: 1, hour: 9, attempts, answered }];
}

test('below the evidence floor the model refuses to rank', () => {
  const model = scoreCallWindows({
    leadStats: [],
    userStats: filler(MIN_ATTEMPTS_FOR_MODEL - 1, 5),
    policy,
  });
  assert.equal(model.status, 'learning');
  assert.deepEqual(model.windows, []);
});

test('at the evidence floor the model starts ranking', () => {
  const model = scoreCallWindows({
    leadStats: [],
    userStats: filler(MIN_ATTEMPTS_FOR_MODEL, 6),
    policy,
  });
  assert.equal(model.status, 'ready');
  assert.ok(model.windows.length > 0);
});

test('a 1-for-1 bucket does not outrank a well-sampled bucket', () => {
  // The naive rate says the lucky Tuesday bucket is 100% and Thursday is 60%.
  // Shrinkage must put the 50-sample bucket first.
  const model = scoreCallWindows({
    leadStats: [{ weekday: 2, hour: 10, attempts: 1, answered: 1 }],
    userStats: [
      { weekday: 2, hour: 10, attempts: 1, answered: 1 },
      { weekday: 4, hour: 14, attempts: 50, answered: 30 },
      { weekday: 1, hour: 9, attempts: 40, answered: 4 },
    ],
    policy,
  });
  assert.equal(model.status, 'ready');
  const top = model.windows[0];
  assert.equal(top.weekday, 4);
  assert.equal(top.hour, 14);
});

test('confidence reflects evidence, not the point estimate', () => {
  const sparse = shrinkageEstimate({
    leadAttempts: 1, leadAnswered: 1, bucketAttempts: 1, bucketAnswered: 1, globalRate: 0.2,
  });
  const dense = shrinkageEstimate({
    leadAttempts: 20, leadAnswered: 10, bucketAttempts: 200, bucketAnswered: 100, globalRate: 0.2,
  });
  // The sparse bucket has a perfect raw rate but almost no confidence.
  assert.ok(sparse.confidence < 0.2, `sparse confidence was ${sparse.confidence}`);
  assert.ok(dense.confidence > 0.9, `dense confidence was ${dense.confidence}`);
});

test('an unobserved bucket falls back to the global rate, not to zero', () => {
  const est = shrinkageEstimate({
    leadAttempts: 0, leadAnswered: 0, bucketAttempts: 0, bucketAnswered: 0, globalRate: 0.35,
  });
  assert.ok(Math.abs(est.probability - 0.35) < 1e-9);
  assert.equal(est.confidence, 0);
  assert.equal(est.sampleSize, 0);
});

test('the lead\'s own history overtakes the account prior once it has weight', () => {
  // Account says this bucket is bad (10%), the lead answers there every time.
  const withoutLead = shrinkageEstimate({
    leadAttempts: 0, leadAnswered: 0, bucketAttempts: 100, bucketAnswered: 10, globalRate: 0.1,
  });
  const withLead = shrinkageEstimate({
    leadAttempts: 12, leadAnswered: 12, bucketAttempts: 100, bucketAnswered: 10, globalRate: 0.1,
  });
  assert.ok(withLead.probability > withoutLead.probability * 3);
  // K_LEAD pseudo-observations still hold it well below a naive 100%.
  assert.ok(withLead.probability < 1);
});

test('a single lead observation is a nudge, not a driver', () => {
  // The regression this pins: at K_LEAD = 3 one answer moved the estimate by
  // +0.14 and flipped the ranking against a 50-sample bucket.
  const base = shrinkageEstimate({
    leadAttempts: 0, leadAnswered: 0, bucketAttempts: 20, bucketAnswered: 8, globalRate: 0.4,
  });
  const oneAnswer = shrinkageEstimate({
    leadAttempts: 1, leadAnswered: 1, bucketAttempts: 20, bucketAnswered: 8, globalRate: 0.4,
  });
  assert.ok(oneAnswer.probability > base.probability, 'one answer should still move it');
  assert.ok(
    oneAnswer.probability - base.probability < 0.08,
    `one observation moved the estimate by ${oneAnswer.probability - base.probability}`,
  );
});

test('prior strengths are the documented pseudo-observation counts', () => {
  // A bucket with exactly K_BUCKET attempts should sit halfway between its own
  // rate and the global rate.
  const est = shrinkageEstimate({
    leadAttempts: 0, leadAnswered: 0,
    bucketAttempts: K_BUCKET, bucketAnswered: K_BUCKET, globalRate: 0,
  });
  assert.ok(Math.abs(est.probability - 0.5) < 1e-9);
  assert.equal(K_LEAD, 8);
  assert.equal(K_BUCKET, 10);
});

test('only policy-permitted buckets are ranked', () => {
  const model = scoreCallWindows({
    leadStats: [],
    // A superb Sunday 03:00 bucket the policy forbids.
    userStats: [
      { weekday: 7, hour: 3, attempts: 100, answered: 95 },
      { weekday: 1, hour: 9, attempts: 40, answered: 8 },
    ],
    policy,
  });
  assert.equal(model.status, 'ready');
  assert.ok(model.windows.every((w) => w.weekday !== 7));
  assert.ok(model.windows.every((w) => w.hour >= 9 && w.hour < 17));
});

test('permittedBuckets covers the window and excludes the closing hour', () => {
  const buckets = permittedBuckets({ ...policy, windowStart: '09:00', windowEnd: '17:00', allowedDays: [1] });
  const hours = buckets.map((b) => b.hour);
  assert.equal(Math.min(...hours), 9);
  assert.equal(Math.max(...hours), 16); // a call started at 17:00 is outside
  assert.equal(buckets.length, 8);
});

test('a window ending mid-hour includes that hour', () => {
  const buckets = permittedBuckets({ ...policy, windowStart: '09:00', windowEnd: '17:30', allowedDays: [1] });
  assert.ok(buckets.some((b) => b.hour === 17));
});

test('ranking is deterministic for identical inputs', () => {
  const args = {
    leadStats: [],
    userStats: [
      { weekday: 2, hour: 10, attempts: 30, answered: 9 },
      { weekday: 3, hour: 11, attempts: 30, answered: 9 },
    ],
    policy,
  };
  const a = scoreCallWindows(args);
  const b = scoreCallWindows(args);
  assert.deepEqual(a.windows, b.windows);
});
