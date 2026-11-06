import test from 'node:test';
import assert from 'node:assert/strict';

// Locks the AI provider error classifier: a valid key must never be reported
// as invalid. The old logic matched the bare word "invalid", so Anthropic's
// "invalid_request_error" (billing, validation) produced "Invalid API key".

async function loadClassifier() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/ai-helpers.ts');
  return mod.classifyAIProviderError;
}

function apiError(status: number, message: string) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

test('ai errors: real 401 maps to invalid-key message', async () => {
  const classify = await loadClassifier();
  const out = classify('anthropic', 'claude-opus-4-8', apiError(401, '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'));
  assert.match(out.message, /Invalid Anthropic API key/);
});

test('ai errors: billing invalid_request_error is NOT reported as a bad key', async () => {
  const classify = await loadClassifier();
  const out = classify('anthropic', 'claude-opus-4-8', apiError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'));
  assert.doesNotMatch(out.message, /Invalid Anthropic API key/);
  assert.match(out.message, /insufficient credits/i);
});

test('ai errors: unknown model maps to model message, not key message', async () => {
  const classify = await loadClassifier();
  const out = classify('anthropic', 'claude-nonexistent-9', apiError(404, '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nonexistent-9"}}'));
  assert.doesNotMatch(out.message, /API key/);
  assert.match(out.message, /Model "claude-nonexistent-9" is not available/);
});

test('ai errors: generic 400 validation passes through unmangled', async () => {
  const classify = await loadClassifier();
  const original = apiError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be positive"}}');
  const out = classify('anthropic', 'claude-opus-4-8', original);
  assert.equal(out, original, 'unclassified errors must surface their real message');
});

test('ai errors: google bad-key message maps to invalid-key', async () => {
  const classify = await loadClassifier();
  const out = classify('google', 'gemini-2.5-pro', new Error('[GoogleGenerativeAI Error] [400 Bad Request] API key not valid. Please pass a valid API key.'));
  assert.match(out.message, /Invalid Google API key/);
});

test('ai errors: 429 maps to rate-limit guidance', async () => {
  const classify = await loadClassifier();
  const out = classify('anthropic', 'claude-opus-4-8', apiError(429, '429 rate_limit_error'));
  assert.match(out.message, /rate limit/i);
});
