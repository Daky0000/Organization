import test from 'node:test';
import assert from 'node:assert/strict';

// config.ts validates env at import time and these modules transitively
// import the logger, so env must be set before the dynamic imports.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const { AFRICON_DEFAULT_AGENT, fillTemplate, resolveOrgAgent } = await import('../src/server/sales/orgAgent.ts');
const { applyDisclosures } = await import('../src/server/sales/callBrief.ts');
const { VapiProvider } = await import('../src/server/sales/providers/vapi.ts');

const policy = { aiDisclosureRequired: true, aiDisclosureText: null, recordingDisclosureRequired: true };

test('nothing saved → the Africon defaults', () => {
  const agent = resolveOrgAgent({});
  assert.equal(agent.businessName, 'Africon');
  assert.match(agent.knowledge, /Africa AI Consult/);
  assert.equal(agent.provider, 'vapi');
});

test('saved fields override, blanks fall back, numbers are clamped', () => {
  const agent = resolveOrgAgent({ agentName: 'Kofi', persona: '   ', maxCallDurationSec: '99999', temperature: 'x', voiceId: '' });
  assert.equal(agent.agentName, 'Kofi');
  assert.equal(agent.persona, AFRICON_DEFAULT_AGENT.persona);
  assert.equal(agent.maxCallDurationSec, 1800);
  assert.equal(agent.temperature, AFRICON_DEFAULT_AGENT.temperature);
  assert.equal(agent.voiceId, '');
});

test('templates fill agent, business and lead names', () => {
  assert.equal(fillTemplate('{agentName} at {businessName} for {firstName}', AFRICON_DEFAULT_AGENT, 'Esi'), 'Ama at Africon for Esi');
});

test('the AI disclosure uses the org wording and is never dropped', () => {
  const opening = applyDisclosures('Do you have a minute?', policy, null, AFRICON_DEFAULT_AGENT);
  assert.match(opening, /^Hello, this is Ama, an AI assistant calling from Africon/);
  assert.match(opening, /This call is being recorded\./);
  assert.match(opening, /Do you have a minute\?$/);
});

test('a per-user disclosure wording still wins over the org default', () => {
  const opening = applyDisclosures('Hi', { ...policy, aiDisclosureText: 'Custom AI notice.' }, null, AFRICON_DEFAULT_AGENT);
  assert.match(opening, /^Custom AI notice\./);
});

test('with disclosure off the agent still introduces itself', () => {
  const opening = applyDisclosures('Hi', { ...policy, aiDisclosureRequired: false, recordingDisclosureRequired: false }, null, AFRICON_DEFAULT_AGENT);
  assert.match(opening, /^Hello, this is Ama from Africon/);
});

test('org voice, model and voicemail settings reach the Vapi assistant', () => {
  const provider = new VapiProvider(
    { apiKey: 'k', publicKey: null, phoneNumberId: 'p', webhookSecret: 's' },
    { voiceProvider: 'cartesia', model: 'm-1', modelProvider: 'openai', voicemailMessage: 'Call us back', silenceTimeoutSec: 20 },
  );
  const a = provider.buildAssistant({ firstMessage: 'Hi', systemPrompt: 'x', voiceId: 'v1', maxDurationSec: 60, recordingEnabled: true }) as any;
  assert.deepEqual(a.voice, { provider: 'cartesia', voiceId: 'v1' });
  assert.equal(a.model.model, 'm-1');
  assert.equal(a.model.provider, 'openai');
  assert.equal(a.voicemailMessage, 'Call us back');
  assert.equal(a.silenceTimeoutSeconds, 20);
});

test('the inbound brief carries the Africon knowledge and an incoming-call script', async () => {
  const { buildInboundSystemPrompt } = await import('../src/server/sales/orgAgent.ts');
  const prompt = buildInboundSystemPrompt(AFRICON_DEFAULT_AGENT);
  assert.match(prompt, /CALL TYPE: Incoming call/);
  assert.match(prompt, /Africa AI Consult Ltd/);
  assert.match(prompt, /Never mention an event whose date has already passed/);
  assert.doesNotMatch(prompt, /\{agentName\}|\{businessName\}/);
});

test('earlier defaults Vapi rejected are replaced on read', () => {
  const agent = resolveOrgAgent({ modelProvider: 'anthropic', model: 'claude-haiku-4-5', voiceProvider: '11labs', voiceId: 'EXAVITQu4vr4xnAyMBLR' });
  assert.equal(agent.model, AFRICON_DEFAULT_AGENT.model);
  assert.equal(agent.modelProvider, AFRICON_DEFAULT_AGENT.modelProvider);
  assert.equal(agent.voiceProvider, 'vapi');
  assert.equal(agent.voiceId, AFRICON_DEFAULT_AGENT.voiceId);
});

test('the assistant posts reports to our webhook with the shared secret', () => {
  const provider = new VapiProvider(
    { apiKey: 'k', publicKey: null, phoneNumberId: 'p', webhookSecret: 's' },
    { serverUrl: 'https://example.com/webhooks/vapi', serverSecret: 'sekret' },
  );
  const a = provider.buildAssistant({ firstMessage: 'Hi', systemPrompt: 'x', voiceId: null, maxDurationSec: 60, recordingEnabled: true }) as any;
  assert.equal(a.server.url, 'https://example.com/webhooks/vapi');
  assert.equal(a.server.headers['x-vapi-secret'], 'sekret');
});

test('local Ghana numbers become E.164', async () => {
  const { toE164 } = await import('../src/server/sales/orgAgent.ts');
  assert.equal(toE164('0244123456'), '+233244123456');
  assert.equal(toE164('024 412 3456'), '+233244123456');
  assert.equal(toE164('+233244123456'), '+233244123456');
  assert.equal(toE164('233244123456'), '+233244123456');
  assert.equal(toE164('00447911123456'), '+447911123456');
  assert.equal(toE164('12'), null);
});

test('an OpenAI model Vapi does not accept falls back to the default', () => {
  assert.equal(resolveOrgAgent({ modelProvider: 'openai', model: 'gpt-4.1-mini ' }).model, 'gpt-4.1-mini');
  assert.equal(resolveOrgAgent({ modelProvider: 'openai', model: 'claude-sonnet-4-5' }).model, AFRICON_DEFAULT_AGENT.model);
  assert.equal(resolveOrgAgent({ modelProvider: 'openai', model: 'gpt-5-mini' }).model, 'gpt-5-mini');
});

test('international numbers written without + are not given +233', async () => {
  const { toE164 } = await import('../src/server/sales/orgAgent.ts');
  assert.equal(toE164('14155550123'), '+14155550123');
  assert.equal(toE164('+1 (415) 555-0123'), '+14155550123');
  assert.equal(toE164('244123456'), '+233244123456');
});

test('numbers from any country are detected, local ones read in the given country', async () => {
  const { describePhone, toCountryCode } = await import('../src/server/sales/orgAgent.ts');
  const togo = describePhone('+228 90 12 34 56');
  assert.equal(togo.country, 'TG');
  assert.equal(togo.e164, '+22890123456');
  assert.equal(describePhone('22890123456').country, 'TG'); // no "+"
  assert.equal(describePhone('0803 123 4567', 'NG').e164, '+2348031234567');
  assert.equal(describePhone('+33 6 12 34 56 78').country, 'FR');
  assert.equal(describePhone('0244123456').country, 'GH');
  assert.equal(describePhone('0244123456').type, 'MOBILE');
  assert.equal(describePhone('not a number').valid, false);
  assert.equal(toCountryCode('Togo'), 'TG');
  assert.equal(toCountryCode("Côte d'Ivoire"), 'CI');
  assert.equal(toCountryCode('bj'), 'BJ');
  assert.equal(toCountryCode('Narnia'), null);
});

test('test numbers default, and parse from a list or lines', async () => {
  const { parseNumberList } = await import('../src/server/sales/orgAgent.ts');
  assert.deepEqual(resolveOrgAgent({}).testNumbers, []);
  assert.deepEqual(resolveOrgAgent({ testNumbers: '["0201234567"," 0244 123 456 "]' }).testNumbers, ['0201234567', '0244 123 456']);
  assert.deepEqual(parseNumberList('0201234567\n\n0501234567, 0201234567'), ['0201234567', '0501234567']);
  assert.deepEqual(resolveOrgAgent({ testNumbers: '[]' }).testNumbers, []);
});
