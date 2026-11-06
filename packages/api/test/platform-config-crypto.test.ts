import test from 'node:test';
import assert from 'node:assert/strict';

// Locks the platform_configs at-rest encryption: secret fields are ciphertext
// in the DB, reads decrypt transparently, and pre-encryption plaintext rows
// keep working until re-saved.

async function loadHelpers() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/integration-helpers.ts');
  return mod;
}

const SAMPLE = {
  secretKey: 'sk_live_abc123',
  webhookSecret: 'whsec_xyz',
  apiKey: 're_key_777',
  api_key: 'AIza-google',
  accessKey: 'kling-ak',
  clientSecret: 'oauth-cs',
  appSecret: 'meta-as',
  verifyToken: 'meta-vt',
  // non-secrets — must stay plaintext
  publishableKey: 'pk_live_public',
  fromEmail: 'noreply@example.com',
  redirectUri: 'https://example.com/cb',
  provider: 'resend',
};

test('platform crypto: round-trip restores every value exactly', async () => {
  const { encryptPlatformConfig, decryptPlatformConfig } = await loadHelpers();
  const stored = encryptPlatformConfig(SAMPLE);
  assert.deepEqual(decryptPlatformConfig(stored), SAMPLE);
});

test('platform crypto: secret fields are ciphertext at rest, non-secrets stay readable', async () => {
  const { encryptPlatformConfig } = await loadHelpers();
  const stored = encryptPlatformConfig(SAMPLE);
  for (const field of ['secretKey', 'webhookSecret', 'apiKey', 'api_key', 'accessKey', 'clientSecret', 'appSecret', 'verifyToken']) {
    assert.ok(String(stored[field]).startsWith('encv1:'), `${field} must be encrypted`);
    assert.notEqual(stored[field], (SAMPLE as any)[field]);
  }
  for (const field of ['publishableKey', 'fromEmail', 'redirectUri', 'provider']) {
    assert.equal(stored[field], (SAMPLE as any)[field], `${field} must stay plaintext`);
  }
});

test('platform crypto: legacy plaintext rows pass through decrypt unchanged', async () => {
  const { decryptPlatformConfig } = await loadHelpers();
  const legacy = { secretKey: 'sk_live_plain_old_row', fromEmail: 'a@b.c' };
  assert.deepEqual(decryptPlatformConfig(legacy), legacy);
});

test('platform crypto: encrypt is idempotent (no double encryption)', async () => {
  const { encryptPlatformConfig, decryptPlatformConfig } = await loadHelpers();
  const once = encryptPlatformConfig(SAMPLE);
  const twice = encryptPlatformConfig(once);
  assert.deepEqual(twice, once);
  assert.deepEqual(decryptPlatformConfig(twice), SAMPLE);
});

test('platform crypto: corrupted ciphertext decrypts to empty string, never throws', async () => {
  const { decryptPlatformConfig } = await loadHelpers();
  const out = decryptPlatformConfig({ secretKey: 'encv1:not-real-ciphertext' });
  assert.equal(out.secretKey, '');
});

test('platform crypto: null/undefined config yields empty object', async () => {
  const { decryptPlatformConfig, encryptPlatformConfig } = await loadHelpers();
  assert.deepEqual(decryptPlatformConfig(null), {});
  assert.deepEqual(decryptPlatformConfig(undefined), {});
  assert.deepEqual(encryptPlatformConfig(null), {});
});
