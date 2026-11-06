import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const nv = await import('../src/server/nvidiaModels.ts');

const config = (over: Partial<import('../src/server/nvidiaModels.ts').NvidiaConfig> = {}) => ({
  apiKey: 'nvapi-test', source: 'env' as const, enabled: true, ladders: { ...nv.DEFAULT_LADDERS }, ...over,
});

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('nvidia chat: climbs the ladder past a 504 and an empty answer, sends the OS wire shape', async () => {
  const seen: any[] = [];
  const replies = [
    json(504, { detail: 'Gateway Timeout' }),
    json(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    json(200, { choices: [{ message: { content: 'Hello there' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
  ];
  const fetchImpl = (async (_url: string, init: any) => { seen.push(JSON.parse(init.body)); return replies.shift()!; }) as any;
  const r = await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 400, job: 'text', config: config(), fetchImpl });
  assert.equal(r.text, 'Hello there');
  assert.equal(r.model, nv.DEFAULT_LADDERS.text[2]);
  assert.deepEqual(seen.map((b) => b.model), nv.DEFAULT_LADDERS.text);
  assert.equal(r.attempts.length, 2);
  for (const b of seen) {
    assert.equal(b.reasoning_effort, 'medium', 'reasoning models get low|medium|high only');
    assert.equal(b.max_tokens, 400 + 8000, 'answer plus reasoning headroom');
    assert.equal(b.max_completion_tokens, undefined);
  }
});

test('nvidia chat: no reasoning_effort for a non-reasoning model; fast job uses low effort', async () => {
  const bodies: any[] = [];
  const fetchImpl = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return json(200, { choices: [{ message: { content: 'ok' } }] }); }) as any;
  await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 50, job: 'fast', config: config({ ladders: { ...nv.DEFAULT_LADDERS, fast: ['google/diffusiongemma-26b-a4b-it'] } }), fetchImpl });
  assert.equal(bodies[0].reasoning_effort, undefined);
  assert.equal(bodies[0].max_tokens, 50);
  await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 50, job: 'fast', config: config(), fetchImpl });
  assert.equal(bodies[1].model, nv.DEFAULT_LADDERS.fast[0]);
  assert.equal(bodies[1].reasoning_effort, 'low');
});

test('nvidia chat: a refused key stops the climb (every rung shares the key)', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return json(401, { detail: 'Unauthorized' }); }) as any;
  await assert.rejects(nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 10, job: 'text', config: config(), fetchImpl }), /refused the key/);
  assert.equal(calls, 1);
});

test('nvidia image: polls a queued (202) request and returns JPEG bytes', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
  const urls: string[] = [];
  const replies = [
    new Response('', { status: 202, headers: { 'nvcf-reqid': 'req-1' } }),
    new Response('', { status: 202, headers: { 'nvcf-reqid': 'req-1' } }),
    json(200, { artifacts: [{ base64: jpeg, finishReason: 'SUCCESS' }] }),
  ];
  const fetchImpl = (async (url: string, init: any) => { urls.push(url); if (init.method === 'POST') assert.deepEqual(Object.keys(JSON.parse(init.body)), ['prompt', 'width', 'height']); return replies.shift()!; }) as any;
  const r = await nv.nvidiaImage({ prompt: 'a mug', width: 1000, height: 700, config: config(), fetchImpl, pollMs: 0 });
  assert.equal(r.model, 'black-forest-labs/flux.2-klein-4b');
  assert.equal(r.mimeType, 'image/jpeg');
  assert.match(urls[0], /\/v2\/nvcf\/pexec\/functions\/f67e96d8-1c4e-422e-a913-90f00e19aa9a$/);
  assert.match(urls[1], /\/v2\/nvcf\/pexec\/status\/req-1$/);
  assert.deepEqual(nv.nvidiaImageSize(1000, 700), { width: 1024, height: 704 });
});

test('nvidia image: a declined prompt (200 with finishReason) is a failure, not an empty success', async () => {
  const fetchImpl = (async () => json(200, { artifacts: [{ base64: '', finishReason: 'CONTENT_FILTERED' }] })) as any;
  await assert.rejects(nv.nvidiaImage({ prompt: 'x', config: config(), fetchImpl }), /declined \(CONTENT_FILTERED\)/);
});

test('model tier maps to the OS ladders', () => {
  assert.equal(nv.jobForModel('claude-haiku-4-5'), 'fast');
  assert.equal(nv.jobForModel('gemini-2.0-flash'), 'fast');
  assert.equal(nv.jobForModel('claude-opus-4-8'), 'text');
});

test('agent loop: runs tools on the free model and returns its answer', async () => {
  const bodies: any[] = [];
  const replies = [
    json(200, { choices: [{ message: { content: 'Checking.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_posts', arguments: '{"limit":2}' } }] } }] }),
    json(200, { choices: [{ message: { content: 'You have 2 posts.' } }] }),
  ];
  const fetchImpl = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return replies.shift()!; }) as any;
  const shown: string[] = [];
  const ran: any[] = [];
  const r = await nv.nvidiaAgentLoop({
    system: 's', history: [{ role: 'user', content: 'how many posts?' }],
    tools: [{ name: 'list_posts', description: 'd', input_schema: { type: 'object' } }],
    executeTool: async (name, args) => { ran.push([name, args]); return { count: 2 }; },
    onText: (t) => shown.push(t), config: config(), fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(ran, [['list_posts', { limit: 2 }]]);
  assert.deepEqual(shown, ['Checking.', 'You have 2 posts.']);
  assert.equal(bodies[0].model, nv.DEFAULT_LADDERS.agent[0]);
  assert.equal(bodies[0].tools[0].function.name, 'list_posts');
  const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.equal(toolMsg.content, '{"count":2}');
});

test('agent loop: a failing rung hands the conversation to the next one, tools already run are not repeated', async () => {
  const models: string[] = [];
  const replies = [
    json(200, { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save', arguments: '{}' } }] } }] }),
    json(504, { detail: 'timeout' }),
    json(200, { choices: [{ message: { content: 'Saved.' } }] }),
  ];
  const fetchImpl = (async (_u: string, init: any) => { const b = JSON.parse(init.body); models.push(b.model); return replies.shift()!; }) as any;
  let runs = 0;
  const r = await nv.nvidiaAgentLoop({
    system: 's', history: [{ role: 'user', content: 'save it' }],
    tools: [{ name: 'save', input_schema: { type: 'object' } }],
    executeTool: async () => { runs++; return { ok: true }; }, config: config(), fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(runs, 1);
  assert.deepEqual(models, [nv.DEFAULT_LADDERS.agent[0], nv.DEFAULT_LADDERS.agent[0], nv.DEFAULT_LADDERS.agent[1]]);
});

test('agent loop: after three failed tries it stops and briefs the paid model on work already done', async () => {
  const replies = [
    json(200, { choices: [{ message: { content: 'Drafting now.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_draft', arguments: '{"title":"Hi"}' } }] } }] }),
    json(500, {}), json(503, {}), json(429, {}),
  ];
  let calls = 0;
  const fetchImpl = (async () => { calls++; return replies.shift()!; }) as any;
  const r = await nv.nvidiaAgentLoop({
    system: 's', history: [{ role: 'user', content: 'draft' }],
    tools: [{ name: 'create_draft', input_schema: { type: 'object' } }],
    executeTool: async () => ({ id: 'draft-9' }), config: config(), fetchImpl,
  });
  assert.equal(r.ok, false);
  assert.equal(calls, 4, 'one success, then one failed try on each of the three rungs');
  if (!r.ok) {
    assert.equal(r.attempts.length, 3);
    assert.match(r.brief, /Drafting now\./);
    assert.match(r.brief, /create_draft\(\{"title":"Hi"\}\) → \{"id":"draft-9"\}/);
    assert.match(r.brief, /do not call these tools again/);
  }
});

test('freeFirst: three failed free tries, then the paid call; an unusable answer counts as a failed try', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-test';
  const ai = await import('../src/ai-helpers.ts');
  nv.invalidateNvidiaConfig();
  const realFetch = globalThis.fetch;
  try {
    let freeCalls = 0;
    globalThis.fetch = (async () => { freeCalls++; return json(200, { choices: [{ message: { content: 'not json at all' } }] }); }) as any;
    let paidCalls = 0;
    const out = await ai.freeFirst(
      { system: 's', user: 'u', maxTokens: 50, job: 'agent', userId: null, feature: 't', accept: (t) => t.trim().startsWith('{') },
      async () => { paidCalls++; return '{"from":"paid"}'; },
    );
    assert.equal(out, '{"from":"paid"}');
    assert.equal(freeCalls, 3);
    assert.equal(paidCalls, 1);

    globalThis.fetch = (async () => json(200, { choices: [{ message: { content: '{"from":"free"}' } }] })) as any;
    paidCalls = 0;
    const free = await ai.freeFirst({ system: 's', user: 'u', maxTokens: 50, userId: null, feature: 't' }, async () => { paidCalls++; return 'paid'; });
    assert.equal(free, '{"from":"free"}');
    assert.equal(paidCalls, 0, 'paid is never asked when a free model answers');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NVIDIA_API_KEY;
    nv.invalidateNvidiaConfig();
  }
});

// Through the real shared call: free first, paid only when every rung failed.
test('callAINonStreaming: answers from NVIDIA when it works; free-only key fails clearly when it does not', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-test';
  const ai = await import('../src/ai-helpers.ts');
  nv.invalidateNvidiaConfig();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => json(200, { choices: [{ message: { content: 'free answer' } }] })) as any;
    const text = await ai.callAINonStreaming('anthropic', ai.NVIDIA_FREE_ONLY, ai.FAST_MODEL, 'sys-a', 'user-a', 100, { userId: null, feature: 't', skipCache: true });
    assert.equal(text, 'free answer');

    globalThis.fetch = (async () => json(503, { detail: 'busy' })) as any;
    await assert.rejects(
      ai.callAINonStreaming('anthropic', ai.NVIDIA_FREE_ONLY, ai.FAST_MODEL, 'sys-b', 'user-b', 100, { userId: null, feature: 't', skipCache: true }),
      (err: any) => err.message === ai.AI_UNAVAILABLE_MESSAGE && /no paid AI key/.test(err.detail),
    );
    assert.equal(ai.computeAICostUsd('moonshotai/kimi-k2.6', 10_000, 10_000), 0, 'free models price at zero');
    assert.equal(ai.resolveTextKey({ provider: 'anthropic', encryptedKey: null, googleEncryptedKey: null, nvidiaReady: true }), process.env.ANTHROPIC_API_KEY || ai.NVIDIA_FREE_ONLY);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NVIDIA_API_KEY;
    nv.invalidateNvidiaConfig();
  }
});

test('nvidia via Dakyworld OS: with no key here, chat goes to the OS proxy with the partner key; images refuse', async () => {
  const proxy = nv.osNvidiaProxy({ DAKYX_BASE_URL: 'https://os.example.com/', DAKYX_PARTNER_KEY: 'pk_test' } as any);
  assert.deepEqual(proxy, { base: 'https://os.example.com/api/partner/v1/nvidia', key: 'pk_test' });
  assert.equal(nv.osNvidiaProxy({ DAKYX_BASE_URL: 'https://os.example.com' } as any), null);

  const seen: Array<{ url: string; auth: string }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    seen.push({ url, auth: init.headers.authorization });
    return json(200, { choices: [{ message: { content: 'via OS' } }] });
  }) as any;
  const cfg = config({ apiKey: 'pk_test', source: 'os', chatBase: proxy!.base });
  const r = await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 100, job: 'text', config: cfg, fetchImpl });
  assert.equal(r.text, 'via OS');
  assert.deepEqual(seen, [{ url: 'https://os.example.com/api/partner/v1/nvidia/chat/completions', auth: 'Bearer pk_test' }]);
  await assert.rejects(nv.nvidiaImage({ prompt: 'x', config: cfg, fetchImpl }), /Dakyworld OS only shares the chat models/);
});

test('nvidia health: a retired (410) model is skipped on later calls; a reasoning 400 is retried without it', async () => {
  nv.resetModelHealthForTests();
  const cfg = config({ ladders: { ...nv.DEFAULT_LADDERS, text: ['retired/model', 'plain/model'] } });
  const seen: any[] = [];
  const replies: Array<() => Response> = [
    () => json(410, { detail: "The model 'retired/model' has reached its end of life" }),
    () => json(400, { error: { message: "reasoning_effort: Extra inputs are not permitted" } }),
    () => json(200, { choices: [{ message: { content: 'first' } }] }),
    () => json(200, { choices: [{ message: { content: 'second' } }] }),
  ];
  const fetchImpl = (async (_u: string, init: any) => { seen.push(JSON.parse(init.body)); return replies.shift()!(); }) as any;
  assert.equal((await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 50, job: 'text', config: cfg, fetchImpl })).text, 'first');
  assert.deepEqual(seen.map((b) => [b.model, 'reasoning_effort' in b]), [['retired/model', true], ['plain/model', true], ['plain/model', false]]);
  assert.deepEqual(nv.deadModels().map((d) => d.model), ['retired/model']);
  seen.length = 0;
  assert.equal((await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 50, job: 'text', config: cfg, fetchImpl })).text, 'second');
  assert.deepEqual(seen.map((b) => [b.model, 'reasoning_effort' in b]), [['plain/model', false]], 'dead model skipped, no-reasoning remembered');
  nv.resetModelHealthForTests();
});

test('nvidia discovery: ladders are built from models that answer (agents must call a tool), and fill gaps at call time', async () => {
  nv.resetModelHealthForTests();
  const working = new Set(['deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'nvidia/nemotron-3.5-lightning-30b-a3b']);
  const toolCallers = new Set(['deepseek-ai/deepseek-v4.1-flash']);
  const fetchImpl = (async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    if (!working.has(b.model)) return json(410, { detail: 'end of life' });
    if (b.tools) return json(200, { choices: [{ message: toolCallers.has(b.model) ? { content: '', tool_calls: [{ id: '1', function: { name: 'get_time', arguments: '{}' } }] } : { content: 'no' } }] });
    return json(200, { choices: [{ message: { content: 'OK' } }] });
  }) as any;
  const cfg = config();
  const found = await nv.discoverModels({ config: cfg, fetchImpl });
  assert.deepEqual(found.ladders.text, ['deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash']);
  assert.deepEqual(found.ladders.fast, ['nvidia/nemotron-3.5-lightning-30b-a3b', 'z-ai/glm-5.3-flash', 'deepseek-ai/deepseek-v4.1-flash']);
  assert.deepEqual(found.ladders.agent, ['deepseek-ai/deepseek-v4.1-flash']);
  // A saved ladder of retired models (marked dead by the probe) is topped up from discovery.
  const saved = config({ ladders: { ...nv.DEFAULT_LADDERS, text: ['moonshotai/kimi-k2.6', 'nvidia/nemotron-3-ultra-550b-a55b'] } });
  assert.deepEqual(nv.liveLadder(saved, 'text'), ['deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash']);
  nv.resetModelHealthForTests();
});

test('agent loop: reports each model it asks, why it moved on, and the model reasoning', async () => {
  const replies = [
    json(504, { detail: 'timeout' }),
    json(200, { choices: [{ message: { content: 'Done.', reasoning_content: 'The user wants a summary.' } }] }),
  ];
  const fetchImpl = (async () => replies.shift()!) as any;
  const models: Array<[string, string | undefined]> = [];
  const thoughts: string[] = [];
  const r = await nv.nvidiaAgentLoop({
    system: 's', history: [{ role: 'user', content: 'sum up' }], tools: [],
    executeTool: async () => ({}), config: config(), fetchImpl,
    onModel: (_id, name, previousError) => models.push([name, previousError]),
    onReasoning: (t) => thoughts.push(t),
  });
  assert.equal(r.ok, true);
  assert.equal(models.length, 2);
  assert.equal(models[0][0], nv.modelName(nv.DEFAULT_LADDERS.agent[0]));
  assert.equal(models[0][1], undefined);
  assert.match(String(models[1][1]), /504/);
  assert.deepEqual(thoughts, ['The user wants a summary.']);
});
