import { getPlatformConfig } from '../user-auth.ts';
import { logger } from '../logger.ts';
import { capToolResult } from './aiGuard.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Free NVIDIA models — the same catalogue, ladders and wire rules as Dakyworld
// OS (`server/src/lib/models/registry.ts` + `call.ts`), carried over so both
// products ask the same verified models for the same kinds of work.
//
// Free first, paid behind: every one-shot generation here tries the job's
// ladder of free models in order, one attempt each, and only then the paid
// vendor configured in Admin → AI Assistant.
//
// Facts below were each a live request in the OS on 1 Sep 2026:
//  - Chat: https://integrate.api.nvidia.com/v1, OpenAI chat-completions shape.
//    `max_tokens` (not max_completion_tokens) caps reasoning AND reply, so
//    reasoning models get headroom on top of the answer or come back empty.
//  - `reasoning_effort` is low|medium|high only, and only for models that
//    reason: gpt-oss answers 400 to anything else.
//  - One key reaches every model; the free allowance is per account.
//  - gemma-4-31b-it (504s) and mistral-nemotron (hangs) are listed but in no
//    shipped ladder: a first rung that times out costs every call a minute.
//  - Images are NVIDIA Cloud Functions on api.nvcf.nvidia.com, addressed by
//    function id. Body is {prompt,width,height} and nothing else (anything
//    more is a 422 "Inference error"). 202 means queued: poll nvcf-reqid.
//    A declined prompt is 200 with finishReason != SUCCESS. Bytes are JPEG.
//    Only flux.2-klein-4b serves; the other three are ACTIVE but 504/hang.
// ─────────────────────────────────────────────────────────────────────────────

export const NVIDIA_CHAT_BASE = () => (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
export const NVCF_BASE = () => (process.env.NVCF_BASE_URL || 'https://api.nvcf.nvidia.com').replace(/\/$/, '');

export interface FreeModel { id: string; name: string; reasoning: boolean; vision: boolean; down?: string }

export const FREE_MODELS: FreeModel[] = [
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', reasoning: true, vision: true },
  { id: 'deepseek-ai/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', reasoning: true, vision: false },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', name: 'Nemotron 3 Ultra 550B', reasoning: true, vision: false },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning 30B', reasoning: true, vision: false },
  { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', name: 'Nemotron 3.5 Super VL 120B', reasoning: true, vision: true },
  { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', reasoning: true, vision: false },
  { id: 'minimaxai/minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', reasoning: true, vision: false },
  { id: 'mistralai/mistral-large-4-1t-a52b', name: 'Mistral Large 4', reasoning: false, vision: false },
  { id: 'nvidia/nemotron-nano-3-30b-a3b', name: 'Nemotron Nano 3 30B', reasoning: true, vision: false },
  { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B', reasoning: true, vision: false, down: '404 "Function not found for account" on 2 Nov 2026' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', name: 'Nemotron 3 Nano Omni', reasoning: true, vision: true },
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', reasoning: true, vision: false, down: 'timed out after 60 s on 2 Nov 2026' },
  { id: 'google/diffusiongemma-26b-a4b-it', name: 'DiffusionGemma 26B', reasoning: false, vision: true },
  { id: 'meta/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 90B Vision', reasoning: false, vision: true },
  { id: 'google/gemma-4-31b-it', name: 'Gemma 4 31B', reasoning: true, vision: true, down: '504 on every request when last checked' },
  { id: 'mistralai/mistral-nemotron', name: 'Mistral Nemotron', reasoning: false, vision: false, down: 'gone from the NVIDIA catalogue (/v1/models) on 2 Nov 2026' },
  // Discovery fallbacks: listed in /v1/models on 2 Nov 2026, not yet in a
  // default ladder. Flags here stop a wasted 400 on reasoning_effort.
  { id: 'writer/palmyra-creative-122b', name: 'Palmyra Creative 122B', reasoning: false, vision: false },
  { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', name: 'Llama 3.1 Nemotron Ultra 253B', reasoning: false, vision: false },
  { id: 'google/gemma-3-12b-it', name: 'Gemma 3 12B', reasoning: false, vision: true },
  { id: 'nvidia/nemotron-3.5-bolt-e4b', name: 'Nemotron 3.5 Bolt E4B', reasoning: true, vision: false },
];

export interface ImageModel { id: string; name: string; functionId: string; down?: string }

export const IMAGE_MODELS: ImageModel[] = [
  { id: 'black-forest-labs/flux.2-klein-4b', name: 'FLUX.2 Klein 4B', functionId: 'f67e96d8-1c4e-422e-a913-90f00e19aa9a' },
  { id: 'black-forest-labs/flux.1-schnell', name: 'FLUX.1 Schnell', functionId: '105fe02c-924b-4dfa-9797-92d89c3936ad', down: '504 after a minute when last checked' },
  { id: 'black-forest-labs/flux.1-dev', name: 'FLUX.1 Dev', functionId: '0c474133-6fd2-42f6-be29-8ebbbaeaaeb2', down: '504 after a minute when last checked' },
  { id: 'nvidia/cosmos3-super-text2image', name: 'Cosmos 3 Super', functionId: 'f65a2585-3b67-46ce-a431-af764d93e954', down: 'never answered when last checked' },
];

/**
 * The jobs here, mapped onto the OS ladders. `text` is the OS `text` ladder
 * (prose a customer reads: posts, captions, campaign copy). `fast` is the OS
 * `organise`/`triage` ladder (classification, extraction, short structured
 * answers) — the small fast model first, which buys latency, not money.
 */
export type NvidiaJob = 'text' | 'fast' | 'agent';

export const DEFAULT_LADDERS: Record<NvidiaJob | 'image', string[]> = {
  // kimi-k3 and gpt-oss-120b were retired by NVIDIA (Oct/Sep 2026); discovery
  // (below) replaces any rung that stops answering, so these are a starting point.
  text: ['moonshotai/kimi-k2.6', 'deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b'],
  fast: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'z-ai/glm-5.3-flash', 'minimaxai/minimax-m3.1-flash'],
  // The OS workforce ladder: every rung a verified tool-caller that holds a
  // long conversation, confirmed by discovery's tool-call probe.
  agent: ['moonshotai/kimi-k2.6', 'deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b'],
  image: ['black-forest-labs/flux.2-klein-4b'],
};

export const LADDER_MAX = 3;
const FREE_TIMEOUT_MS = 60_000;
const REASONING_HEADROOM = { low: 2_000, medium: 8_000 } as const;
const MAX_TOKENS_CEILING = 32_000;

export interface NvidiaConfig {
  apiKey: string;
  /** 'os': no key here, so chat goes through Dakyworld OS, which holds the key. */
  source: 'admin' | 'env' | 'os' | null;
  enabled: boolean;
  ladders: Record<NvidiaJob | 'image', string[]>;
  /** Where chat completions are sent; NVIDIA itself unless source is 'os'. */
  chatBase?: string;
}

/**
 * Dakyworld OS proxies the free chat models for this app over the partner
 * link (DAKYX_BASE_URL + DAKYX_PARTNER_KEY), so the Marketing SaaS can use
 * them without its own NVIDIA key. Images (NVCF) are not proxied.
 */
export function osNvidiaProxy(env: NodeJS.ProcessEnv = process.env): { base: string; key: string } | null {
  const base = env.DAKYX_BASE_URL?.trim().replace(/\/$/, '');
  const key = env.DAKYX_PARTNER_KEY?.trim();
  return base && key ? { base: `${base}/api/partner/v1/nvidia`, key } : null;
}

function parseLadder(raw: unknown, fallback: string[]): string[] {
  const list = String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? [...new Set(list)].slice(0, LADDER_MAX) : fallback;
}

let cached: { at: number; value: NvidiaConfig } | null = null;

/** Admin → NVIDIA (platform_configs.nvidia) first, NVIDIA_API_KEY next, then Dakyworld OS's key through its proxy. Cached 30 s. */
export async function getNvidiaConfig(fresh = false): Promise<NvidiaConfig> {
  if (!fresh && cached && Date.now() - cached.at < 30_000) return cached.value;
  const cfg = await getPlatformConfig('nvidia').catch(() => ({} as Record<string, string>));
  const adminKey = String(cfg.apiKey || '').trim();
  const envKey = String(process.env.NVIDIA_API_KEY || '').trim();
  const proxy = adminKey || envKey ? null : osNvidiaProxy();
  const value: NvidiaConfig = {
    apiKey: adminKey || envKey || proxy?.key || '',
    source: adminKey ? 'admin' : envKey ? 'env' : proxy ? 'os' : null,
    ...(proxy ? { chatBase: proxy.base } : {}),
    // On by default once a key exists; Admin can switch the free tier off.
    enabled: String(cfg.enabled ?? 'true') !== 'false',
    ladders: {
      text: parseLadder(cfg.textModels, DEFAULT_LADDERS.text),
      fast: parseLadder(cfg.fastModels, DEFAULT_LADDERS.fast),
      agent: parseLadder(cfg.agentModels, DEFAULT_LADDERS.agent),
      image: parseLadder(cfg.imageModels, DEFAULT_LADDERS.image),
    },
  };
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateNvidiaConfig(): void { cached = null; }

export async function nvidiaReady(): Promise<boolean> {
  const c = await getNvidiaConfig();
  return c.enabled && Boolean(c.apiKey);
}

/** Which ladder a caller's model choice maps to: the small/fast tiers go to `fast`. */
export function jobForModel(model: string): NvidiaJob {
  return /haiku|flash|mini|nano|gpt-oss-20b/i.test(model) ? 'fast' : 'text';
}

export class NvidiaError extends Error {
  constructor(message: string, readonly attempts: Array<{ model: string; error: string }>) {
    super(message);
    this.name = 'NvidiaError';
  }
}

function assistantText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join('');
  return '';
}

/** The display name for a model id, e.g. "Kimi K2.6". */
export function modelName(id: string): string {
  return FREE_MODELS.find((m) => m.id === id)?.name ?? id.split('/').pop() ?? id;
}

/** Reasoning models put their thinking in `reasoning_content` (or `reasoning`) beside the answer. */
export function reasoningText(message: any): string {
  const r = message?.reasoning_content ?? message?.reasoning;
  return typeof r === 'string' ? r.trim() : '';
}

function describeHttp(status: number, body: string): string {
  let detail = body;
  try { const j = JSON.parse(body); detail = j?.error?.message || j?.detail || j?.message || j?.title || body; } catch { /* raw text */ }
  const short = String(detail).replace(/\s+/g, ' ').slice(0, 200);
  if (status === 401 || status === 403) return `NVIDIA refused the key (${status}). Keys expire — check build.nvidia.com/settings/api-keys.`;
  if (status === 429) return `NVIDIA rate limit (429): ${short}`;
  return `NVIDIA returned ${status}: ${short}`;
}

export interface NvidiaChatResult { text: string; model: string; inputTokens: number; outputTokens: number; attempts: Array<{ model: string; error: string }> }

/**
 * One prompt down the job's ladder. Each rung gets one attempt with a 60 s
 * cap; an empty answer counts as a failure (a reasoning model that spent its
 * whole budget thinking). A refused key stops the climb: every rung shares it.
 */
export async function nvidiaChat(params: {
  system: string; user: string; maxTokens: number; job: NvidiaJob;
  config?: NvidiaConfig; fetchImpl?: typeof fetch;
  /** Rejects an answer the caller cannot use (e.g. unparseable JSON); the next rung is tried. */
  accept?: (text: string) => boolean;
}): Promise<NvidiaChatResult> {
  const config = params.config ?? await getNvidiaConfig();
  if (!config.apiKey) throw new NvidiaError('No NVIDIA key is set (Admin → NVIDIA).', []);
  const doFetch = params.fetchImpl ?? fetch;
  const effort = params.job === 'fast' ? 'low' : 'medium';
  const attempts: Array<{ model: string; error: string }> = [];
  for (const model of liveLadder(config, params.job)) {
    const turn = await completeOnce(doFetch, config, model, effort, params.maxTokens,
      [{ role: 'system', content: params.system }, { role: 'user', content: params.user }]);
    if (!turn.ok) {
      attempts.push({ model, error: turn.error });
      if (turn.keyRefused) break;
      continue;
    }
    const text = assistantText(turn.message).trim();
    if (!text) { attempts.push({ model, error: `empty answer (finish_reason ${turn.finishReason ?? 'unknown'})` }); continue; }
    if (params.accept && !params.accept(text)) { attempts.push({ model, error: 'answer was not in the required format' }); continue; }
    return {
      text,
      model,
      inputTokens: turn.inputTokens || Math.ceil((params.system.length + params.user.length) / 4),
      outputTokens: turn.outputTokens || Math.ceil(text.length / 4),
      attempts,
    };
  }
  throw new NvidiaError(`Free NVIDIA models did not answer: ${attempts.map((a) => `${a.model} — ${a.error}`).join('; ') || 'no models in the ladder'}`, attempts);
}

type TurnResult =
  | { ok: true; message: any; finishReason?: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; keyRefused: boolean; status?: number };

// ── What the models told us at runtime ───────────────────────────────────────
//
// NVIDIA retires free models on its own schedule (kimi-k3 on 15 Oct 2026,
// gpt-oss-120b on 3 Sep) and an account can lose a listed model (404 "Function
// not found for account"). Neither comes back, so a model that answers 410 or
// 404 is skipped for a day instead of costing every call a failed rung. And a
// model that rejects `reasoning_effort` is re-asked without it, once, and
// remembered — new models arrive with no record of whether they reason.

const DEAD_FOR_MS = 24 * 60 * 60 * 1000;
const dead = new Map<string, { until: number; reason: string }>();
const noReasoningEffort = new Set<string>();

export function markModelDead(model: string, reason: string, now = Date.now()): void {
  dead.set(model, { until: now + DEAD_FOR_MS, reason });
}

export function deadModels(now = Date.now()): Array<{ model: string; reason: string }> {
  return [...dead].filter(([, d]) => d.until > now).map(([model, d]) => ({ model, reason: d.reason }));
}

function isDead(model: string, now = Date.now()): boolean {
  const d = dead.get(model);
  if (d && d.until <= now) dead.delete(model);
  return Boolean(d && d.until > now);
}

/** One chat-completions request to one model, with the OS wire rules. Never throws. */
async function completeOnce(
  doFetch: typeof fetch, config: Pick<NvidiaConfig, 'apiKey' | 'chatBase'>, model: string, effort: 'low' | 'medium', maxTokens: number,
  messages: any[], tools?: any[], timeoutMs = FREE_TIMEOUT_MS,
): Promise<TurnResult> {
  const known = FREE_MODELS.find((m) => m.id === model);
  const reasons = !noReasoningEffort.has(model) && (known ? known.reasoning : true);
  const body = {
    model,
    max_tokens: Math.min(maxTokens + (reasons ? REASONING_HEADROOM[effort] : 0), MAX_TOKENS_CEILING),
    messages,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    ...(reasons ? { reasoning_effort: effort } : {}),
  };
  try {
    const res = await doFetch(`${config.chatBase ?? NVIDIA_CHAT_BASE()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await res.text();
    if (!res.ok) {
      if (res.status === 400 && reasons && /reasoning/i.test(raw)) {
        noReasoningEffort.add(model);
        return completeOnce(doFetch, config, model, effort, maxTokens, messages, tools, timeoutMs);
      }
      const error = describeHttp(res.status, raw);
      if (res.status === 410 || res.status === 404) markModelDead(model, error);
      return { ok: false, error, keyRefused: res.status === 401 || res.status === 403, status: res.status };
    }
    const json = JSON.parse(raw);
    return {
      ok: true,
      message: json?.choices?.[0]?.message ?? {},
      finishReason: json?.choices?.[0]?.finish_reason,
      inputTokens: Number(json?.usage?.prompt_tokens) || 0,
      outputTokens: Number(json?.usage?.completion_tokens) || 0,
    };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'TimeoutError' ? `timed out after ${Math.round(timeoutMs / 1000)} s` : (err?.message || 'network error'), keyRefused: false };
  }
}

// ── Discovery: which free models answer this account today ───────────────────
//
// Candidates per job, best first. Only the ones that answer a probe — and, for
// agents, actually call a tool — are used, so a retired or withdrawn model
// drops out on the next check without a deploy. Checked at boot, every six
// hours, and from Admin → NVIDIA → Test every model.

export const CANDIDATES: Record<NvidiaJob, string[]> = {
  text: [
    'moonshotai/kimi-k2.6', 'deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-4-1t-a52b',
    'writer/palmyra-creative-122b', 'z-ai/glm-5.3-flash', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'google/gemma-4-31b-it',
  ],
  fast: [
    'nvidia/nemotron-3.5-lightning-30b-a3b', 'z-ai/glm-5.3-flash', 'minimaxai/minimax-m3.1-flash', 'deepseek-ai/deepseek-v4.1-flash',
    'nvidia/nemotron-nano-3-30b-a3b', 'openai/gpt-oss-20b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'google/gemma-3-12b-it',
    'nvidia/nemotron-3.5-bolt-e4b',
  ],
  agent: [
    'moonshotai/kimi-k2.6', 'deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b', 'z-ai/glm-5.3-flash',
    'minimaxai/minimax-m3.1-flash', 'mistralai/mistral-large-4-1t-a52b', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3-super-120b-a12b',
  ],
};

export interface ProbeResult { model: string; ok: boolean; ms: number; reply?: string; error?: string; tools?: boolean; toolError?: string }
export interface Discovery { at: number; ladders: Record<NvidiaJob, string[]>; results: ProbeResult[] }

let discovery: Discovery | null = null;

export function lastDiscovery(): Discovery | null { return discovery; }

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_TOOL = { type: 'function', function: { name: 'get_time', description: 'Returns the current time.', parameters: { type: 'object', properties: {}, additionalProperties: false } } };

/** Probes every candidate (and the configured ladders) once; builds the ladders from what answered. */
export async function discoverModels(params: { config?: NvidiaConfig; fetchImpl?: typeof fetch } = {}): Promise<Discovery> {
  const config = params.config ?? await getNvidiaConfig();
  const doFetch = params.fetchImpl ?? fetch;
  if (!config.apiKey) throw new NvidiaError('No NVIDIA key is set (Admin → NVIDIA).', []);
  const models = [...new Set([...config.ladders.text, ...config.ladders.fast, ...config.ladders.agent, ...CANDIDATES.text, ...CANDIDATES.fast, ...CANDIDATES.agent])];
  const agentCandidates = new Set([...config.ladders.agent, ...CANDIDATES.agent]);

  const results = await Promise.all(models.map(async (model): Promise<ProbeResult> => {
    const started = Date.now();
    const r = await completeOnce(doFetch, config, model, 'low', 32,
      [{ role: 'system', content: 'Answer with the single word OK.' }, { role: 'user', content: 'Reply OK.' }], undefined, PROBE_TIMEOUT_MS);
    if (!r.ok) return { model, ok: false, ms: Date.now() - started, error: r.error };
    const text = assistantText(r.message).trim();
    if (!text) return { model, ok: false, ms: Date.now() - started, error: `empty answer (finish_reason ${r.finishReason ?? 'unknown'})` };
    const result: ProbeResult = { model, ok: true, ms: Date.now() - started, reply: text.slice(0, 40) };
    if (agentCandidates.has(model)) {
      const t = await completeOnce(doFetch, config, model, 'low', 128,
        [{ role: 'system', content: 'You test tool calling. Call the get_time tool.' }, { role: 'user', content: 'What time is it? Use the tool.' }],
        [PROBE_TOOL], PROBE_TIMEOUT_MS);
      result.tools = t.ok && Array.isArray(t.message?.tool_calls) && t.message.tool_calls.length > 0;
      if (!result.tools) result.toolError = t.ok ? 'answered without calling the tool' : t.error;
    }
    return result;
  }));

  const ok = (id: string) => results.find((r) => r.model === id)?.ok;
  const tools = (id: string) => results.find((r) => r.model === id)?.tools;
  // The admin's own order first, where those models still answer; then the candidates.
  const pick = (job: NvidiaJob, good: (id: string) => boolean | undefined) =>
    [...new Set([...config.ladders[job], ...CANDIDATES[job]])].filter((id) => good(id)).slice(0, LADDER_MAX);
  discovery = {
    at: Date.now(),
    ladders: { text: pick('text', ok), fast: pick('fast', ok), agent: pick('agent', tools) },
    results,
  };
  logger.info({ ladders: discovery.ladders, failed: results.filter((r) => !r.ok).map((r) => r.model) }, 'nvidia_models_discovered');
  return discovery;
}

/** Discovery on a schedule; never throws. */
export async function refreshNvidiaModels(): Promise<void> {
  try {
    const config = await getNvidiaConfig(true);
    if (config.enabled && config.apiKey) await discoverModels({ config });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'nvidia_discovery_failed');
  }
}

/**
 * The rungs a call actually climbs: the configured ladder minus models known
 * to be gone, topped up from the last discovery to three.
 */
export function liveLadder(config: Pick<NvidiaConfig, 'ladders'>, job: NvidiaJob): string[] {
  const out = config.ladders[job].filter((m) => !isDead(m));
  for (const m of discovery?.ladders[job] ?? []) {
    if (out.length >= LADDER_MAX) break;
    if (!out.includes(m) && !isDead(m)) out.push(m);
  }
  return out;
}

export function resetModelHealthForTests(): void {
  dead.clear();
  noReasoningEffort.clear();
  discovery = null;
}

export interface AgentTool { name: string; description?: string; input_schema: unknown }

export type AgentLoopResult =
  | { ok: true; model: string; inputTokens: number; outputTokens: number; attempts: Array<{ model: string; error: string }> }
  | { ok: false; error: string; attempts: Array<{ model: string; error: string }>; brief: string; inputTokens: number; outputTokens: number };

/**
 * A tool-calling agent turn on the free `agent` ladder (OpenAI tool-call shape).
 *
 * A rung that fails — HTTP error, timeout, or an answer with neither text nor
 * a tool call — hands the conversation so far to the next rung, which
 * continues from it rather than starting again (the OS's handover rule).
 * After the third failure it returns `ok: false` with a `brief` of what was
 * already shown and which tools already ran, for the paid model to continue
 * from without repeating them. Text is only emitted from completed turns, so
 * a failure never leaves half a sentence on screen.
 */
export async function nvidiaAgentLoop(params: {
  system: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: AgentTool[];
  executeTool: (name: string, args: any) => Promise<unknown>;
  onText?: (text: string) => void;
  onToolStart?: (name: string, args: any) => void;
  onToolDone?: (name: string, ok: boolean, resultOrError: unknown) => void;
  /** A rung is about to be asked; `previousError` is set when the one before it failed. */
  onModel?: (model: string, name: string, previousError?: string) => void;
  /** The model's own reasoning for a completed turn, when it returns one. */
  onReasoning?: (text: string) => void;
  maxIterations?: number;
  maxTokens?: number;
  config?: NvidiaConfig;
  fetchImpl?: typeof fetch;
}): Promise<AgentLoopResult> {
  const config = params.config ?? await getNvidiaConfig();
  const doFetch = params.fetchImpl ?? fetch;
  const ladder = liveLadder(config, 'agent');
  const tools = params.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }));
  const messages: any[] = [{ role: 'system', content: params.system }, ...params.history];
  const attempts: Array<{ model: string; error: string }> = [];
  const shown: string[] = [];
  const toolLog: string[] = [];
  let rung = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const maxIterations = params.maxIterations ?? 5;

  const fail = (error: string): AgentLoopResult => ({
    ok: false, error, attempts, inputTokens, outputTokens,
    brief: (shown.length || toolLog.length)
      ? [
        'Another model began this reply and stopped. Continue from where it stopped; do not repeat its text and do not call these tools again.',
        shown.length ? `Already shown to the user:\n${shown.join('\n').slice(0, 3000)}` : '',
        toolLog.length ? `Tools already run, with their results:\n${toolLog.join('\n').slice(0, 4000)}` : '',
      ].filter(Boolean).join('\n\n')
      : '',
  });

  if (!config.apiKey) return fail('No NVIDIA key is set (Admin → NVIDIA).');

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const last = iteration === maxIterations - 1;
    let turn: Extract<TurnResult, { ok: true }> | null = null;
    let model = '';
    let previousError: string | undefined;
    while (!turn) {
      if (rung >= ladder.length) return fail(`Free NVIDIA models did not answer: ${attempts.map((a) => `${a.model} — ${a.error}`).join('; ')}`);
      model = ladder[rung];
      params.onModel?.(model, modelName(model), previousError);
      const r = await completeOnce(doFetch, config, model, 'medium', params.maxTokens ?? 4096, messages, last ? undefined : tools);
      if (!r.ok) {
        attempts.push({ model, error: r.error });
        previousError = r.error;
        if (r.keyRefused) rung = ladder.length; else rung++;
        continue;
      }
      const hasText = Boolean(assistantText(r.message).trim());
      const hasCalls = Array.isArray(r.message?.tool_calls) && r.message.tool_calls.length > 0;
      if (!hasText && !hasCalls) {
        attempts.push({ model, error: `empty answer (finish_reason ${r.finishReason ?? 'unknown'})` });
        previousError = 'empty answer';
        rung++;
        continue;
      }
      turn = r;
    }
    inputTokens += turn.inputTokens;
    outputTokens += turn.outputTokens;
    const text = assistantText(turn.message).trim();
    const calls: any[] = Array.isArray(turn.message?.tool_calls) ? turn.message.tool_calls : [];
    const reasoning = reasoningText(turn.message);
    if (reasoning) params.onReasoning?.(reasoning);
    if (text) { shown.push(text); params.onText?.(text); }
    messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { ok: true, model, inputTokens, outputTokens, attempts };

    for (const call of calls) {
      const name = String(call?.function?.name ?? '');
      let args: any = {};
      let parseError = '';
      const rawArgs = call?.function?.arguments;
      if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try { args = JSON.parse(rawArgs); } catch { parseError = 'The tool arguments were not valid JSON.'; }
      } else if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs;
      }
      let content: string;
      if (parseError) {
        content = `Error: ${parseError}`;
      } else {
        params.onToolStart?.(name, args);
        try {
          const result = await params.executeTool(name, args);
          params.onToolDone?.(name, true, result);
          // Capped: every later turn re-sends it.
          content = capToolResult(result);
        } catch (err: any) {
          const message = err?.message || 'Tool failed';
          params.onToolDone?.(name, false, message);
          content = `Error: ${message}`;
        }
      }
      toolLog.push(`- ${name}(${JSON.stringify(args).slice(0, 300)}) → ${content.slice(0, 600)}`);
      messages.push({ role: 'tool', tool_call_id: String(call?.id ?? name), content });
    }
  }
  const model = ladder[Math.min(rung, ladder.length - 1)];
  return { ok: true, model, inputTokens, outputTokens, attempts };
}

const NVCF_POLL_ATTEMPTS = 12;
const NVCF_POLL_MS = 5000;

/** width/height the image functions honour: multiples of 64 within 512..1536. */
export function nvidiaImageSize(width = 1024, height = 1024): { width: number; height: number } {
  const clamp = (v: number) => Math.min(Math.max(Math.round(v / 64) * 64, 512), 1536);
  return { width: clamp(width), height: clamp(height) };
}

/** One picture down the image ladder. Returns JPEG bytes. */
export async function nvidiaImage(params: {
  prompt: string; width?: number; height?: number;
  config?: NvidiaConfig; fetchImpl?: typeof fetch; pollMs?: number;
}): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  const config = params.config ?? await getNvidiaConfig();
  if (!config.apiKey) throw new NvidiaError('No NVIDIA key is set (Admin → NVIDIA).', []);
  if (config.source === 'os') throw new NvidiaError('Free NVIDIA images need a key in Admin → NVIDIA; Dakyworld OS only shares the chat models.', []);
  const doFetch = params.fetchImpl ?? fetch;
  const { width, height } = nvidiaImageSize(params.width, params.height);
  const attempts: Array<{ model: string; error: string }> = [];
  for (const model of config.ladders.image) {
    const known = IMAGE_MODELS.find((m) => m.id === model);
    // The address is a function UUID nobody can guess, so an unknown id is refused, not tried.
    if (!known) { attempts.push({ model, error: 'not an NVIDIA image model this app knows how to reach' }); continue; }
    const headers = {
      authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json',
      'nvcf-poll-seconds': '60',
    };
    try {
      let res = await doFetch(`${NVCF_BASE()}/v2/nvcf/pexec/functions/${known.functionId}`, {
        method: 'POST', headers, body: JSON.stringify({ prompt: params.prompt.slice(0, 2000), width, height }),
        signal: AbortSignal.timeout(180_000),
      });
      const requestId = res.headers.get('nvcf-reqid');
      for (let i = 0; res.status === 202 && requestId && i < NVCF_POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, params.pollMs ?? NVCF_POLL_MS));
        res = await doFetch(`${NVCF_BASE()}/v2/nvcf/pexec/status/${requestId}`, { headers, signal: AbortSignal.timeout(180_000) });
      }
      const raw = await res.text();
      if (!res.ok) {
        attempts.push({ model, error: res.status === 422 ? 'NVIDIA could not draw that (422 "Inference error" — usually the prompt was declined)' : describeHttp(res.status, raw) });
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const artifact = JSON.parse(raw)?.artifacts?.[0];
      const finish = typeof artifact?.finishReason === 'string' ? artifact.finishReason : 'SUCCESS';
      if (finish !== 'SUCCESS') { attempts.push({ model, error: `declined (${finish}) — rephrase the prompt` }); continue; }
      if (typeof artifact?.base64 !== 'string' || !artifact.base64) { attempts.push({ model, error: 'no image in the answer' }); continue; }
      return { bytes: Buffer.from(artifact.base64, 'base64'), mimeType: 'image/jpeg', model };
    } catch (err: any) {
      attempts.push({ model, error: err?.name === 'TimeoutError' ? 'timed out' : (err?.message || 'network error') });
    }
  }
  logger.warn({ attempts }, 'nvidia_image_failed');
  throw new NvidiaError(`Free NVIDIA image models did not answer: ${attempts.map((a) => `${a.model} — ${a.error}`).join('; ')}`, attempts);
}

/** Vision-capable free models, best first, for describing images. */
export const VISION_LADDER = ['moonshotai/kimi-k2.6', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'meta/llama-3.2-90b-vision-instruct'];

/**
 * Asks a vision model about a set of images (OpenAI image_url content parts).
 * Used to sum up the style of a user's example designs. Throws NvidiaError
 * when no vision model answers.
 */
export async function nvidiaDescribeImages(params: {
  system: string; prompt: string; imageUrls: string[]; maxTokens?: number;
  config?: NvidiaConfig; fetchImpl?: typeof fetch;
}): Promise<{ text: string; model: string }> {
  const config = params.config ?? await getNvidiaConfig();
  if (!config.apiKey) throw new NvidiaError('No NVIDIA key is set (Admin → NVIDIA).', []);
  const doFetch = params.fetchImpl ?? fetch;
  const content = [
    { type: 'text', text: params.prompt },
    ...params.imageUrls.slice(0, 8).map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
  const attempts: Array<{ model: string; error: string }> = [];
  for (const model of VISION_LADDER.filter((m) => !isDead(m))) {
    const turn = await completeOnce(doFetch, config, model, 'low', params.maxTokens ?? 700,
      [{ role: 'system', content: params.system }, { role: 'user', content }]);
    if (!turn.ok) { attempts.push({ model, error: turn.error }); if (turn.keyRefused) break; continue; }
    const text = assistantText(turn.message).trim();
    if (text) return { text, model };
    attempts.push({ model, error: 'empty answer' });
  }
  throw new NvidiaError(`No vision model answered: ${attempts.map((a) => `${a.model} — ${a.error}`).join('; ')}`, attempts);
}
