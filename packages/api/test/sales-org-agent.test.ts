import test from 'node:test';
import assert from 'node:assert/strict';
import { AFRICON_DEFAULT_AGENT, fillTemplate, resolveOrgAgent } from '../src/server/sales/orgAgent.ts';
import { applyDisclosures } from '../src/server/sales/callBrief.ts';
import { VapiProvider } from '../src/server/sales/providers/vapi.ts';

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
