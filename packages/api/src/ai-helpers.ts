import { account, spend, grant, creditAllowance } from './server/creditAccounting.ts';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPlatformConfig } from './user-auth.ts';
import { decryptIntegrationSecret } from './integration-helpers.ts';
import { pool, dbQuery, hasDatabase } from './db.ts';
import { logger } from './logger.ts';
import { randomUUID, createHash } from 'crypto';
import { FREE_MODELS, NvidiaError, getNvidiaConfig, jobForModel, nvidiaChat } from './server/nvidiaModels.ts';
import { PROFIT_MULTIPLIER, creditsForUsd } from './server/aiPricing.ts';
import { UNTRUSTED_RULE, checkOutput, scanForInjection } from './server/aiGuard.ts';
import { startSpan } from './server/aiTrace.ts';
import { classifyTask, routePaidModel, routingMode } from './server/aiRouting.ts';

export const AI_CONFIG_PLATFORM = 'ai_assistant';

// ─────────────────────────────────────────────────────────────────────────────
// Model registry — the single source of truth for model IDs across the API.
// ─────────────────────────────────────────────────────────────────────────────

export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Most capable · best for the assistant' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Near-Opus quality · lower cost' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest · lowest cost' },
] as const;

export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8';
export const FAST_MODEL = 'claude-haiku-4-5';

export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

export const ANTHROPIC_TO_GEMINI: Record<string, string> = {
  'claude-opus-5-5': 'gemini-2.5-pro',
  'claude-opus-4-8': 'gemini-2.5-pro',
  'claude-sonnet-5': 'gemini-2.5-pro',
  'claude-sonnet-4-6': 'gemini-2.5-flash',
  'claude-haiku-4-5': 'gemini-2.0-flash',
  'claude-haiku-4-5-20251001': 'gemini-2.0-flash',
  'claude-opus-4-7': 'gemini-2.5-pro',
};

export function resolveGeminiModel(model: string): string {
  return GEMINI_MODELS.includes(model) ? model : (ANTHROPIC_TO_GEMINI[model] ?? 'gemini-2.0-flash');
}

export async function getAIConfig(): Promise<{
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
  /** Free NVIDIA models are configured and switched on (Admin → NVIDIA). */
  nvidiaReady: boolean;
}> {
  const [cfg, nvidia] = await Promise.all([getPlatformConfig(AI_CONFIG_PLATFORM), getNvidiaConfig().catch(() => null)]);
  return {
    model: String(cfg.model || DEFAULT_CHAT_MODEL),
    provider: (cfg.provider as 'anthropic' | 'google') || 'anthropic',
    encryptedKey: cfg.apiKeyEncrypted ? String(cfg.apiKeyEncrypted) : null,
    googleEncryptedKey: cfg.googleApiKeyEncrypted ? String(cfg.googleApiKeyEncrypted) : null,
    systemPrompt: cfg.systemPrompt ? String(cfg.systemPrompt) : null,
    nvidiaReady: Boolean(nvidia?.enabled && nvidia.apiKey),
  };
}

/** The paid vendor's key. Agent, tool and streaming paths use this: they need Claude or Gemini. */
export function resolveActiveKey(config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }): string {
  if (config.provider === 'google') {
    return (config.googleEncryptedKey ? decryptAIKey(config.googleEncryptedKey) : null) || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
  }
  return (config.encryptedKey ? decryptAIKey(config.encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
}

/**
 * Stands in for a paid key when only the free NVIDIA models are configured.
 * Only callAINonStreaming understands it; never hand it to a vendor SDK.
 */
export const NVIDIA_FREE_ONLY = 'nvidia-free-only';

/**
 * The key for one-shot generation through callAINonStreaming: the paid key,
 * or NVIDIA_FREE_ONLY when there is none but the free models are on — so
 * content can be generated with no paid vendor at all.
 */
/** A real vendor key (not empty, not the free-only stand-in). */
export function isPaidKey(key: string | null | undefined): key is string {
  return Boolean(key) && key !== NVIDIA_FREE_ONLY;
}

/**
 * For agents that call a vendor SDK directly: the free NVIDIA ladder first
 * (three models, one try each), then `paid` — the agent's own Claude/Gemini
 * call — only when all three failed. `paid` is null when no paid key exists.
 */
export async function freeFirst(
  req: { system: string; user: string; maxTokens: number; job?: 'text' | 'fast' | 'agent'; userId: string | null; feature: string; accept?: (text: string) => boolean },
  paid: (() => Promise<string>) | null,
): Promise<string> {
  const nvidia = await getNvidiaConfig().catch(() => null);
  const system = withUntrustedRule(req.system, req.user);
  let attempts: Array<{ model: string; error: string }> = [];
  if (nvidia?.enabled && nvidia.apiKey) {
    const span = startSpan({ feature: req.feature, userId: req.userId });
    try {
      const r = await nvidiaChat({ system, user: req.user, maxTokens: req.maxTokens, job: req.job ?? 'text', config: nvidia, accept: req.accept });
      void recordAIUsage({ userId: req.userId, feature: req.feature, provider: 'nvidia', model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
      const out = checkOutput(r.text);
      span.end({ status: 'ok', provider: 'nvidia', model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, attempts: r.attempts, guard: out.ok ? null : { outputIssues: out.issues } });
      return out.text;
    } catch (err) {
      attempts = err instanceof NvidiaError ? err.attempts : [];
      span.end({ status: 'error', provider: 'nvidia', model: 'ladder', attempts, error: err instanceof Error ? err.message : String(err) });
      if (!paid) throw new AIUnavailableError(`${err instanceof Error ? err.message : 'Free NVIDIA models failed'} — and no paid AI key is set in Admin → AI Assistant to fall back to.`);
      logger.warn({ err: err instanceof Error ? err.message : err, feature: req.feature }, 'nvidia_free_failed_using_paid');
    }
  }
  if (!paid) throw new AIUnavailableError('No AI is configured — add the free NVIDIA key in Admin → NVIDIA, or a paid key in Admin → AI Assistant.');
  const span = startSpan({ feature: req.feature, userId: req.userId });
  try {
    const text = await paid();
    const out = checkOutput(text);
    // The agent's own call records its usage; this trace is for latency and failures.
    span.end({ status: 'ok', provider: 'paid', model: 'agent-call', attempts, guard: out.ok ? null : { outputIssues: out.issues } });
    return out.text;
  } catch (err) {
    span.end({ status: 'error', provider: 'paid', model: 'agent-call', attempts, error: aiErrorDetail(err) });
    throw err;
  }
}

/** Adds the untrusted-content rule to a system prompt whenever the call carries a fenced block. */
export function withUntrustedRule(system: string, ...parts: string[]): string {
  const fenced = [system, ...parts].some((p) => /<untrusted-[0-9a-f]{8}/.test(p));
  return fenced && !system.includes(UNTRUSTED_RULE) ? `${system}\n\n${UNTRUSTED_RULE}` : system;
}

export function resolveTextKey(config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null; nvidiaReady?: boolean }): string {
  return resolveActiveKey(config) || (config.nvidiaReady ? NVIDIA_FREE_ONLY : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit economics & Monetization Top-Up Packs
// ─────────────────────────────────────────────────────────────────────────────

/** Nominal retail value of one credit (display only). Charges use the cheapest pack's real value — see server/aiPricing.ts. */
export const CREDIT_USD = 0.01;
/** Every AI cost is charged at 1.54× what the provider bills us. */
export const AI_PROFIT_MULTIPLIER = PROFIT_MULTIPLIER;

export const MODEL_COSTS: Record<string, { in: number; out: number; cacheRead?: number }> = {
  'claude-opus-5-5':           { in: 4,    out: 20,   cacheRead: 0.2 },
  'claude-opus-4-8':           { in: 5,    out: 25,   cacheRead: 0.5 },
  'claude-opus-4-7':           { in: 5,    out: 25,   cacheRead: 0.5 },
  'claude-sonnet-5':           { in: 3,    out: 15,   cacheRead: 0.3 },
  'claude-sonnet-4-6':         { in: 3,    out: 15,   cacheRead: 0.3 },
  'claude-haiku-4-5':          { in: 1,    out: 5,    cacheRead: 0.1 },
  'claude-haiku-4-5-20251001': { in: 1,    out: 5,    cacheRead: 0.1 },
  'gemini-2.5-pro':            { in: 1.25, out: 10 },
  'gemini-2.5-flash':          { in: 0.30, out: 2.5 },
  'gemini-2.0-flash':          { in: 0.10, out: 0.4 },
  'gemini-1.5-pro':            { in: 1.25, out: 5 },
  'gemini-1.5-flash':          { in: 0.075, out: 0.3 },
  // Free NVIDIA models cost nothing. Without these rows they would price at
  // FALLBACK_COST (Sonnet rates) and a free day would read as an expensive one.
  ...Object.fromEntries(FREE_MODELS.map((m) => [m.id, { in: 0, out: 0, cacheRead: 0 }])),
};
const FALLBACK_COST = { in: 3, out: 15, cacheRead: 0.3 };

export function computeAICostUsd(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0): number {
  const c = MODEL_COSTS[model] ?? FALLBACK_COST;
  const cacheRate = c.cacheRead ?? c.in * 0.1;
  return (
    (Math.max(0, inputTokens) * c.in +
     Math.max(0, outputTokens) * c.out +
     Math.max(0, cacheReadTokens) * cacheRate) / 1_000_000
  );
}

export function creditsForCostUsd(costUsd: number): number {
  return creditsForUsd(costUsd);
}





// ─────────────────────────────────────────────────────────────────────────────
// Deterministic AI Response Cache & Token Efficiency Telemetry
// Prevents wasted LLM tokens on identical prompts, repeated skill compilations,
// and rapid dashboard refreshes.
// ─────────────────────────────────────────────────────────────────────────────

interface CachedAIResponse {
  text: string;
  expiresAt: number;
  estimatedTokens: number;
  model: string;
}

const aiResponseCache = new Map<string, CachedAIResponse>();
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const tokenEfficiencyStats = {
  totalCalls: 0,
  cacheHits: 0,
  promptCacheReadTokens: 0,
  estimatedTokensSaved: 0,
  estimatedUsdSaved: 0,
  batchedCompilationsSaved: 0,
  fastPathOrchestrationsSaved: 0,
};

export function recordFastPathSavings(estimatedTokens = 450) {
  tokenEfficiencyStats.fastPathOrchestrationsSaved += 1;
  tokenEfficiencyStats.estimatedTokensSaved += estimatedTokens;
  tokenEfficiencyStats.estimatedUsdSaved += (estimatedTokens / 1_000_000) * 1.5;
}

export function recordBatchCompilationSavings(callsSaved = 20, estimatedTokens = 12000) {
  tokenEfficiencyStats.batchedCompilationsSaved += callsSaved;
  tokenEfficiencyStats.estimatedTokensSaved += estimatedTokens;
  tokenEfficiencyStats.estimatedUsdSaved += (estimatedTokens / 1_000_000) * 1.5;
}

export function getTokenEfficiencyTelemetry() {
  const totalDecisions =
    tokenEfficiencyStats.totalCalls +
    tokenEfficiencyStats.cacheHits +
    tokenEfficiencyStats.fastPathOrchestrationsSaved +
    tokenEfficiencyStats.batchedCompilationsSaved;
  const hitRatePct = totalDecisions > 0
    ? Math.min(99, Math.round(((tokenEfficiencyStats.cacheHits + tokenEfficiencyStats.fastPathOrchestrationsSaved + tokenEfficiencyStats.batchedCompilationsSaved) / totalDecisions) * 100))
    : 0;
  return {
    ...tokenEfficiencyStats,
    hitRatePct,
    activeCachedResponses: aiResponseCache.size,
  };
}

export async function ensureCreditAccount(userId: string) {
  return account(pool,userId,await creditAllowance(pool,userId));
}

export async function hasAICredits(userId: string): Promise<boolean> {
  const { credits,spendingBlocked } = await ensureCreditAccount(userId);
  return credits > 0 && !spendingBlocked;
}

export async function chargeAICredits(userId: string, credits: number, reason: string, meta: Record<string, unknown> = {}): Promise<void> {
  if (credits <= 0) return;
  await ensureCreditAccount(userId);
  await spend(pool,userId,credits,reason,meta);
}

export async function grantCredits(userId: string, credits: number, reason: string, meta: Record<string, unknown> = {}): Promise<number | null> {
  return grant(pool,userId,credits,reason,meta);
}

export async function recordAIUsage(params: {
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}): Promise<void> {
  const inputTokens = Math.max(0, Math.round(params.inputTokens || 0));
  const outputTokens = Math.max(0, Math.round(params.outputTokens || 0));
  const cacheReadTokens = Math.max(0, Math.round(params.cacheReadTokens || 0));
  if (cacheReadTokens > 0) {
    tokenEfficiencyStats.promptCacheReadTokens += cacheReadTokens;
    tokenEfficiencyStats.estimatedTokensSaved += Math.round(cacheReadTokens * 0.9);
  }
  const costUsd = computeAICostUsd(params.model, inputTokens, outputTokens, cacheReadTokens);
  const credits = creditsForCostUsd(costUsd);
  await dbQuery(
    `INSERT INTO ai_usage_log (id, user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, credits_charged)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(), params.userId, params.feature.slice(0, 60), params.provider, params.model,
      inputTokens, outputTokens, cacheReadTokens, costUsd.toFixed(6), credits,
    ]
  ).catch((err) => logger.warn({ err }, 'ai_usage_record_failed'));
  if (params.userId) {
    await chargeAICredits(params.userId, credits, `ai_${params.feature}`.slice(0, 60), {
      model: params.model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: Number(costUsd.toFixed(6)),
    });
  }
}

export interface CallUsageMeta {
  userId: string | null;
  feature: string;
  skipCache?: boolean;
  cacheTtlMs?: number;
  /** Which free NVIDIA ladder; defaults from the model tier. */
  nvidiaJob?: 'text' | 'fast';
  /** Already inside a free-first fallback: go straight to the paid vendor. */
  skipFree?: boolean;
  /** The answer must be a JSON object: a free rung that returns anything else counts as a failed try, and the trace records format_ok. */
  expectJson?: boolean;
  /** Keep the configured paid model for this call, whatever its size. */
  noRouting?: boolean;
}

// Identical calls already in flight share one request instead of paying twice
// (a double-clicked button, two tabs, a retry that overlaps the original).
const inflight = new Map<string, Promise<string>>();

export function looksLikeJsonObject(text: string): boolean {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return false;
  try { return typeof JSON.parse(text.slice(start, end + 1)) === 'object'; } catch { return false; }
}

async function readDurableCache(key: string): Promise<CachedAIResponse | null> {
  if (!hasDatabase()) return null;
  const { rows } = await dbQuery(
    `SELECT text, model, tokens, expires_at FROM ai_response_cache WHERE key=$1 AND expires_at > NOW()`, [key],
  ).catch(() => ({ rows: [] as any[] }));
  const r = rows[0];
  return r ? { text: String(r.text), model: String(r.model), estimatedTokens: Number(r.tokens) || 0, expiresAt: new Date(r.expires_at).getTime() } : null;
}

function writeCache(key: string, entry: CachedAIResponse): void {
  aiResponseCache.set(key, entry);
  if (aiResponseCache.size > 1500) {
    const now = Date.now();
    for (const [k, v] of aiResponseCache) if (v.expiresAt < now) aiResponseCache.delete(k);
  }
  // Survives a restart and is shared across instances; short TTLs are not worth the write.
  if (hasDatabase() && entry.expiresAt - Date.now() >= 5 * 60 * 1000) {
    void dbQuery(
      `INSERT INTO ai_response_cache (key, text, model, tokens, expires_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (key) DO UPDATE SET text=EXCLUDED.text, model=EXCLUDED.model, tokens=EXCLUDED.tokens, expires_at=EXCLUDED.expires_at`,
      [key, entry.text, entry.model, entry.estimatedTokens, new Date(entry.expiresAt).toISOString()],
    ).catch(() => undefined);
  }
}

export async function pruneAIResponseCache(): Promise<void> {
  const now = Date.now();
  for (const [k, v] of aiResponseCache) if (v.expiresAt < now) aiResponseCache.delete(k);
  if (hasDatabase()) await dbQuery(`DELETE FROM ai_response_cache WHERE expires_at < NOW()`).catch(() => undefined);
}

export async function callAINonStreaming(
  provider: 'anthropic' | 'google',
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 400,
  usageMeta?: CallUsageMeta,
): Promise<string> {
  const cacheKey = createHash('sha256')
    .update(`${provider}:${model}:${maxTokens}:${systemPrompt}:${userMessage}`)
    .digest('hex');
  const feature = usageMeta?.feature ?? 'unlabelled';
  const userId = usageMeta?.userId ?? null;

  if (!usageMeta?.skipCache) {
    const cached = aiResponseCache.get(cacheKey) ?? await readDurableCache(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      aiResponseCache.set(cacheKey, cached);
      tokenEfficiencyStats.cacheHits += 1;
      tokenEfficiencyStats.estimatedTokensSaved += cached.estimatedTokens;
      const savedCost = computeAICostUsd(cached.model, cached.estimatedTokens, Math.round(cached.estimatedTokens * 0.3));
      tokenEfficiencyStats.estimatedUsdSaved += savedCost;
      startSpan({ feature, userId }).end({ status: 'cache_hit', provider: 'cache', model: cached.model });
      return cached.text;
    }
    const pending = inflight.get(cacheKey);
    if (pending) return pending;
  }

  const run = generateUncached(provider, apiKey, model, systemPrompt, userMessage, maxTokens, usageMeta, cacheKey);
  if (usageMeta?.skipCache) return run;
  inflight.set(cacheKey, run);
  try { return await run; } finally { inflight.delete(cacheKey); }
}

async function generateUncached(
  provider: 'anthropic' | 'google',
  apiKey: string,
  model: string,
  rawSystemPrompt: string,
  userMessage: string,
  maxTokens: number,
  usageMeta: CallUsageMeta | undefined,
  cacheKey: string,
): Promise<string> {
  const feature = usageMeta?.feature ?? 'unlabelled';
  const userId = usageMeta?.userId ?? null;
  const ttl = usageMeta?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const systemPrompt = withUntrustedRule(rawSystemPrompt, userMessage);
  // Signals only: a match is recorded on the trace, never refused here — the
  // fence and the system rule do the defending.
  const scan = scanForInjection(userMessage);
  const inputGuard = scan.suspicious ? { suspicious: true, signals: scan.signals.map((s) => s.id) } : null;
  const quality = (text: string) => (usageMeta?.expectJson ? { format_ok: looksLikeJsonObject(text), chars: text.length } : { chars: text.length });
  const guardFor = (issues: string[]) => (inputGuard || issues.length ? { ...inputGuard, ...(issues.length ? { outputIssues: issues } : {}) } : null);

  tokenEfficiencyStats.totalCalls += 1;

  // Free first, as in Dakyworld OS: the job's ladder of free NVIDIA models,
  // then the paid vendor below only if every rung failed.
  let attempts: Array<{ model: string; error: string }> = [];
  const nvidia = usageMeta?.skipFree ? null : await getNvidiaConfig().catch(() => null);
  if (nvidia?.enabled && nvidia.apiKey) {
    const span = startSpan({ feature, userId });
    try {
      const r = await nvidiaChat({
        system: systemPrompt, user: userMessage, maxTokens, job: usageMeta?.nvidiaJob ?? jobForModel(model), config: nvidia,
        accept: usageMeta?.expectJson ? looksLikeJsonObject : undefined,
      });
      if (usageMeta) {
        void recordAIUsage({ userId, feature, provider: 'nvidia', model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
      }
      const out = checkOutput(r.text);
      span.end({
        status: 'ok', provider: 'nvidia', model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        attempts: r.attempts, quality: quality(out.text), guard: guardFor(out.issues),
      });
      writeCache(cacheKey, { text: out.text, expiresAt: Date.now() + ttl, estimatedTokens: r.inputTokens + r.outputTokens, model: r.model });
      return out.text;
    } catch (err) {
      attempts = err instanceof NvidiaError ? err.attempts : [{ model: 'ladder', error: err instanceof Error ? err.message : String(err) }];
      span.end({ status: 'error', provider: 'nvidia', model: 'ladder', attempts, guard: inputGuard, error: err instanceof Error ? err.message : String(err) });
      if (!apiKey || apiKey === NVIDIA_FREE_ONLY) {
        throw new AIUnavailableError(`${err instanceof Error ? err.message : 'Free NVIDIA models failed'} — and no paid AI key is set in Admin → AI Assistant to fall back to.`);
      }
      logger.warn({ err: err instanceof Error ? err.message : err, feature: usageMeta?.feature }, 'nvidia_free_failed_using_paid');
    }
  }
  if (apiKey === NVIDIA_FREE_ONLY) {
    throw new AIUnavailableError('The free NVIDIA models are switched off and no paid AI key is set — configure one in Admin → NVIDIA or Admin → AI Assistant.');
  }

  // Size the call and pick the cheapest paid model that fits it.
  const configured = provider === 'google' ? resolveGeminiModel(model) : model;
  const tier = classifyTask({ feature, maxTokens, promptChars: systemPrompt.length + userMessage.length });
  const route = usageMeta?.noRouting ? { model: configured, routedFrom: null } : routePaidModel(provider, configured, tier, await routingMode());
  const paidModel = route.model;

  const span = startSpan({ feature, userId });
  try {
    let text: string;
    let inTok: number;
    let outTok: number;
    let cacheRead = 0;
    if (provider === 'google') {
      const genAI = new GoogleGenerativeAI(apiKey);
      const gModel = genAI.getGenerativeModel({ model: paidModel, systemInstruction: systemPrompt });
      const result = await gModel.generateContent(userMessage);
      text = result.response.text();
      inTok = result.response.usageMetadata?.promptTokenCount ?? Math.ceil((systemPrompt.length + userMessage.length) / 4);
      outTok = result.response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
    } else {
      const client = new Anthropic({ apiKey });
      // Use Anthropic ephemeral prompt caching automatically on large system prompts
      const systemParam: any = systemPrompt.length >= 1500
        ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
        : systemPrompt;
      const resp = await client.messages.create({
        model: paidModel,
        max_tokens: maxTokens,
        system: systemParam,
        messages: [{ role: 'user', content: userMessage }],
      });
      const first = resp.content.find((b) => b.type === 'text');
      text = first && first.type === 'text' ? first.text : '';
      inTok = resp.usage.input_tokens;
      outTok = resp.usage.output_tokens;
      cacheRead = resp.usage.cache_read_input_tokens ?? 0;
    }
    if (usageMeta) {
      void recordAIUsage({ userId, feature, provider, model: paidModel, inputTokens: inTok, outputTokens: outTok, cacheReadTokens: cacheRead });
    }
    const out = checkOutput(text);
    span.end({
      status: 'ok', provider, model: paidModel, inputTokens: inTok, outputTokens: outTok, cacheReadTokens: cacheRead,
      costUsd: computeAICostUsd(paidModel, inTok, outTok, cacheRead), routedFrom: route.routedFrom, attempts,
      quality: quality(out.text), guard: guardFor(out.issues),
    });
    writeCache(cacheKey, { text: out.text, expiresAt: Date.now() + ttl, estimatedTokens: inTok + outTok, model: paidModel });
    return out.text;
  } catch (err: any) {
    const classified = classifyAIProviderError(provider, paidModel, err);
    span.end({ status: 'error', provider, model: paidModel, routedFrom: route.routedFrom, attempts, guard: inputGuard, error: classified.detail });
    throw classified;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What a customer sees when the AI cannot answer. Setup problems (no key, an
// empty vendor account, a retired model) are ours to fix, not theirs: the
// message says only that the assistant is unavailable, and the operator's
// detail travels on `detail` — logs, traces, Sentry and admin screens read it
// with aiErrorDetail(). Any route that returns err.message is therefore safe.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_UNAVAILABLE_MESSAGE = 'The AI assistant is temporarily unavailable. Please try again in a few minutes.';
export const AI_BUSY_MESSAGE = 'The AI assistant is busy right now. Please try again in a moment.';

export class AIUnavailableError extends Error {
  readonly code = 'AI_UNAVAILABLE';
  constructor(readonly detail: string, publicMessage = AI_UNAVAILABLE_MESSAGE) {
    super(publicMessage);
    this.name = 'AIUnavailableError';
  }
}

/** The operator-facing explanation of an AI failure. Only for logs and admins. */
export function aiErrorDetail(err: unknown): string {
  if (err instanceof AIUnavailableError) return err.detail;
  return err instanceof Error ? err.message : String(err);
}

/** The message to show this person: the full detail for an admin, the safe one for everyone else. */
export function aiErrorFor(err: unknown, role: string | undefined): string {
  if (role === 'admin') return aiErrorDetail(err);
  return err instanceof AIUnavailableError ? err.message : AI_UNAVAILABLE_MESSAGE;
}

export function classifyAIProviderError(provider: 'anthropic' | 'google', model: string, err: any): AIUnavailableError {
  if (err instanceof AIUnavailableError) return err;
  const status: number | undefined = typeof err?.status === 'number' ? err.status : undefined;
  const msg: string = err?.message || String(err);
  const lower = msg.toLowerCase();
  const providerName = provider === 'google' ? 'Google' : 'Anthropic';
  const unavailable = (detail: string) => new AIUnavailableError(detail);

  if (status === 429 || lower.includes('quota') || lower.includes('rate limit') || lower.includes('too many requests')) {
    if (provider === 'google') {
      return unavailable('Google API quota exceeded. The free tier has a limit of 0 for this project — enable billing at aistudio.google.com to use Gemini.');
    }
    return new AIUnavailableError('Anthropic rate limit exceeded. Check your usage limits at console.anthropic.com.', AI_BUSY_MESSAGE);
  }
  if (lower.includes('credit balance')) {
    return unavailable('The Anthropic account is out of credits (the key itself is fine). Add credits at console.anthropic.com → Billing, or paste the free NVIDIA key in Admin → NVIDIA so the free models answer first.');
  }
  if (status === 401 || lower.includes('authentication_error') || lower.includes('api key not valid') || lower.includes('invalid x-api-key') || lower.includes('unauthorized')) {
    return unavailable(`Invalid ${providerName} API key. Please check your key and try again.`);
  }
  if (status === 403 || lower.includes('permission_error')) {
    return unavailable(`The ${providerName} API key is valid but lacks permission for model "${model}". Check the key's workspace/model access.`);
  }
  if (status === 404 || lower.includes('not_found_error') || lower.includes('is not found')) {
    return unavailable(`Model "${model}" is not available on ${providerName} — pick a different model in Admin → AI Assistant → Configuration.`);
  }
  if (status === 529 || lower.includes('overloaded')) {
    return new AIUnavailableError(`${providerName} is temporarily overloaded — try again in a moment.`, AI_BUSY_MESSAGE);
  }
  // Unrecognised: the vendor's own text (often raw JSON) is kept for the operator.
  return unavailable(msg);
}

export function decryptAIKey(encryptedKey: string): string {
  try { return decryptIntegrationSecret(encryptedKey); } catch (_err) { return ''; }
}
