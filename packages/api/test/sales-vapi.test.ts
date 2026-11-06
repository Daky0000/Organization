import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);

const { VapiProvider } = await import('../src/server/sales/providers/vapi.ts');
const { SimulatorProvider, simulateOutcome } = await import('../src/server/sales/providers/simulator.ts');

const SECRET = 'whsec_test_secret';

function provider(overrides: Record<string, unknown> = {}) {
  return new VapiProvider({
    apiKey: 'priv_key',
    publicKey: 'pub_key',
    phoneNumberId: 'phone_1',
    webhookSecret: SECRET,
    ...overrides,
  } as any);
}

// ─── Key handling ────────────────────────────────────────────────────────────

test('getPublicKey returns the public key and never the private one', () => {
  const p = provider();
  assert.equal(p.getPublicKey(), 'pub_key');
  assert.notEqual(p.getPublicKey(), 'priv_key');
});

test('a missing public key reports null rather than falling back to the private key', () => {
  assert.equal(provider({ publicKey: null }).getPublicKey(), null);
});

test('placing calls requires the private key and a phone number', () => {
  assert.equal(provider().isConfigured(), true);
  assert.equal(provider({ apiKey: '' }).isConfigured(), false);
  assert.equal(provider({ phoneNumberId: null }).isConfigured(), false);
  // A public key alone must never be enough to place a call.
  assert.equal(provider({ apiKey: '', publicKey: 'pub_key' }).isConfigured(), false);
});

test('an unconfigured provider refuses to place a call', async () => {
  await assert.rejects(
    () => provider({ apiKey: '' }).placeCallWithAssistant({
      toNumber: '+233200000000', assistant: {}, metadata: { attemptId: 'a', userId: 'u', contactId: 'c' },
    }),
    /not configured/i,
  );
});

// ─── Assistant construction ──────────────────────────────────────────────────

test('the brief becomes the system message and limits are applied', () => {
  const assistant = provider().buildAssistant({
    firstMessage: 'Hi there',
    systemPrompt: 'You are a rep. Do not invent pricing.',
    voiceId: 'voice_abc',
    maxDurationSec: 180,
    recordingEnabled: true,
  }) as any;

  assert.equal(assistant.firstMessage, 'Hi there');
  assert.equal(assistant.maxDurationSeconds, 180);
  assert.equal(assistant.recordingEnabled, true);
  assert.equal(assistant.model.messages[0].role, 'system');
  assert.match(assistant.model.messages[0].content, /Do not invent pricing/);
  assert.equal(assistant.voice.voiceId, 'voice_abc');
  // Silence timeout exists so a voicemail cannot burn the full duration.
  assert.ok(assistant.silenceTimeoutSeconds > 0);
});

test('no voice is set when none is configured, leaving the Vapi default', () => {
  const assistant = provider().buildAssistant({
    firstMessage: 'Hi', systemPrompt: 'x', voiceId: null, maxDurationSec: 60, recordingEnabled: false,
  }) as any;
  assert.equal(assistant.voice, undefined);
});

// ─── Webhook signature verification ──────────────────────────────────────────
// This endpoint can write conversation records, so an unverified body must
// never be accepted.

test('a webhook is rejected when no secret is configured', () => {
  const p = provider({ webhookSecret: null });
  assert.equal(p.verifySignature({ 'x-vapi-secret': SECRET }, '{}'), false);
});

test('a matching shared secret is accepted', () => {
  assert.equal(provider().verifySignature({ 'x-vapi-secret': SECRET }, '{}'), true);
});

test('a wrong shared secret is rejected', () => {
  assert.equal(provider().verifySignature({ 'x-vapi-secret': 'nope' }, '{}'), false);
  // Same length as the real secret — guards against a length-only comparison.
  const sameLength = 'x'.repeat(SECRET.length);
  assert.equal(provider().verifySignature({ 'x-vapi-secret': sameLength }, '{}'), false);
});

test('a valid HMAC signature is accepted, a tampered body is not', () => {
  const body = JSON.stringify({ message: { type: 'end-of-call-report' } });
  const signature = createHmac('sha256', SECRET).update(body).digest('hex');

  assert.equal(provider().verifySignature({ 'x-vapi-signature': signature }, body), true);
  assert.equal(provider().verifySignature({ 'x-vapi-signature': signature }, `${body} `), false);
  assert.equal(provider().verifySignature({ 'x-vapi-signature': `sha256=${signature}` }, body), true);
});

test('a webhook with no signature header at all is rejected', () => {
  assert.equal(provider().verifySignature({}, '{}'), false);
});

// ─── Event normalization ─────────────────────────────────────────────────────

test('an end-of-call report is normalized into an ended event', () => {
  const event = provider().normalizeWebhook({
    message: {
      type: 'end-of-call-report',
      call: { id: 'call_123' },
      durationSeconds: 95,
      endedReason: 'customer-ended-call',
      artifact: { recordingUrl: 'https://example.com/r.wav', transcript: 'AI: Hi\nCustomer: Hello' },
    },
  });
  assert.equal(event.kind, 'ended');
  if (event.kind !== 'ended') return;
  assert.equal(event.externalId, 'call_123');
  assert.equal(event.outcome, 'answered');
  assert.equal(event.durationSec, 95);
  assert.equal(event.recordingUrl, 'https://example.com/r.wav');
  assert.match(event.transcript!, /Customer: Hello/);
});

test('a structured message list is flattened into readable dialogue', () => {
  const event = provider().normalizeWebhook({
    message: {
      type: 'end-of-call-report',
      call: { id: 'call_x' },
      durationSeconds: 40,
      endedReason: 'customer-ended-call',
      artifact: {
        messages: [
          { role: 'bot', message: 'Hi there' },
          { role: 'user', message: 'Not interested' },
        ],
      },
    },
  });
  if (event.kind !== 'ended') throw new Error('expected ended');
  assert.equal(event.transcript, 'AI: Hi there\nCustomer: Not interested');
});

test('unrelated webhook types are ignored rather than misapplied', () => {
  assert.equal(provider().normalizeWebhook({ message: { type: 'speech-update', call: { id: 'c' } } }).kind, 'ignored');
  assert.equal(provider().normalizeWebhook({}).kind, 'ignored');
  assert.equal(provider().normalizeWebhook({ message: { type: 'end-of-call-report' } }).kind, 'ignored');
});

test('an in-progress status update marks the call started', () => {
  const event = provider().normalizeWebhook({
    message: { type: 'status-update', status: 'in-progress', call: { id: 'call_9' } },
  });
  assert.equal(event.kind, 'started');
});

// ─── Simulator ───────────────────────────────────────────────────────────────

test('the simulator is always configured and needs no credentials', () => {
  assert.equal(new SimulatorProvider().isConfigured(), true);
});

test('simulated outcomes are deterministic per attempt', () => {
  assert.equal(simulateOutcome('attempt-abc'), simulateOutcome('attempt-abc'));
});

test('the simulator produces a transcript for an answered call', () => {
  const sim = new SimulatorProvider();
  const event = sim.normalizeWebhook({ externalId: 'sim_a1', outcome: 'answered' });
  if (event.kind !== 'ended') throw new Error('expected ended');
  assert.equal(event.outcome, 'answered');
  assert.ok(event.transcript && event.transcript.length > 0);
});

test('a simulated no-answer carries no transcript to analyse', () => {
  const event = new SimulatorProvider().normalizeWebhook({ externalId: 'sim_a2', outcome: 'no_answer' });
  if (event.kind !== 'ended') throw new Error('expected ended');
  assert.equal(event.durationSec, 0);
  assert.equal(event.transcript, null);
});
