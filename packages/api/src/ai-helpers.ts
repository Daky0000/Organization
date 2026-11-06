import { account, spend, grant, creditAllowance } from './server/creditAccounting.ts';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPlatformConfig } from './user-auth.ts';
import { decryptIntegrationSecret } from './integration-helpers.ts';
import { pool, dbQuery } from './db.ts';
import { logger } from './logger.ts';
import { randomUUID, createHash } from 'crypto';

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
}> {
  const cfg = await getPlatformConfig(AI_CONFIG_PLATFORM);
  return {
    model: String(cfg.model || DEFAULT_CHAT_MODEL),
    provider: (cfg.provider as 'anthropic' | 'google') || 'anthropic',
    encryptedKey: cfg.apiKeyEncrypted ? String(cfg.apiKeyEncrypted) : null,
    googleEncryptedKey: cfg.googleApiKeyEncrypted ? String(cfg.googleApiKeyEncrypted) : null,
    systemPrompt: cfg.systemPrompt ? String(cfg.systemPrompt) : null,
  };
}

export function resolveActiveKey(config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }): string {
  if (config.provider === 'google') {
    return (config.googleEncryptedKey ? decryptAIKey(config.googleEncryptedKey) : null) || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
  }
  return (config.encryptedKey ? decryptAIKey(config.encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit economics & Monetization Top-Up Packs
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_USD = 0.01;          // retail value of one credit
export const AI_PROFIT_MULTIPLIER = 3;   // retail = 3× raw provider cost

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
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.ceil((costUsd * AI_PROFIT_MULTIPLIER) / CREDIT_USD));
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

export async function callAINonStreaming(
  provider: 'anthropic' | 'google',
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 400,
  usageMeta?: { userId: string | null; feature: string; skipCache?: boolean; cacheTtlMs?: number },
): Promise<string> {
  const cacheKey = createHash('sha256')
    .update(`${provider}:${model}:${maxTokens}:${systemPrompt}:${userMessage}`)
    .digest('hex');

  if (!usageMeta?.skipCache) {
    const cached = aiResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      tokenEfficiencyStats.cacheHits += 1;
      tokenEfficiencyStats.estimatedTokensSaved += cached.estimatedTokens;
      const savedCost = computeAICostUsd(cached.model, cached.estimatedTokens, Math.round(cached.estimatedTokens * 0.3));
      tokenEfficiencyStats.estimatedUsdSaved += savedCost;
      return cached.text;
    }
  }

  tokenEfficiencyStats.totalCalls += 1;

  try {
    if (provider === 'google') {
      const effectiveModel = resolveGeminiModel(model);
      const genAI = new GoogleGenerativeAI(apiKey);
      const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: systemPrompt });
      const result = await gModel.generateContent(userMessage);
      const text = result.response.text();
      const inTok = result.response.usageMetadata?.promptTokenCount ?? Math.ceil((systemPrompt.length + userMessage.length) / 4);
      const outTok = result.response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
      if (usageMeta) {
        void recordAIUsage({
          ...usageMeta, provider: 'google', model: effectiveModel,
          inputTokens: inTok, outputTokens: outTok,
        });
      }
      aiResponseCache.set(cacheKey, {
        text,
        expiresAt: Date.now() + (usageMeta?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
        estimatedTokens: inTok + outTok,
        model: effectiveModel,
      });
      return text;
    } else {
      const client = new Anthropic({ apiKey });
      // Use Anthropic ephemeral prompt caching automatically on large system prompts
      const systemParam: any = systemPrompt.length >= 1500
        ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
        : systemPrompt;
      const resp = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemParam,
        messages: [{ role: 'user', content: userMessage }],
      });
      const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
      if (usageMeta) {
        void recordAIUsage({
          ...usageMeta, provider: 'anthropic', model,
          inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens,
          cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
        });
      }
      aiResponseCache.set(cacheKey, {
        text,
        expiresAt: Date.now() + (usageMeta?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
        estimatedTokens: resp.usage.input_tokens + resp.usage.output_tokens,
        model,
      });
      if (aiResponseCache.size > 1500) {
        const now = Date.now();
        for (const [k, v] of aiResponseCache) if (v.expiresAt < now) aiResponseCache.delete(k);
      }
      return text;
    }
  } catch (err: any) {
    throw classifyAIProviderError(provider, model, err);
  }
}

export function classifyAIProviderError(provider: 'anthropic' | 'google', model: string, err: any): Error {
  const status: number | undefined = typeof err?.status === 'number' ? err.status : undefined;
  const msg: string = err?.message || String(err);
  const lower = msg.toLowerCase();
  const providerName = provider === 'google' ? 'Google' : 'Anthropic';

  if (status === 429 || lower.includes('quota') || lower.includes('rate limit') || lower.includes('too many requests')) {
    if (provider === 'google') {
      return new Error('Google API quota exceeded. The free tier has a limit of 0 for this project — enable billing at aistudio.google.com to use Gemini.');
    }
    return new Error('Anthropic rate limit exceeded. Check your usage limits at console.anthropic.com.');
  }
  if (lower.includes('credit balance')) {
    return new Error('Your Anthropic account has insufficient credits — the API key is fine. Add credits at console.anthropic.com → Billing.');
  }
  if (status === 401 || lower.includes('authentication_error') || lower.includes('api key not valid') || lower.includes('invalid x-api-key') || lower.includes('unauthorized')) {
    return new Error(`Invalid ${providerName} API key. Please check your key and try again.`);
  }
  if (status === 403 || lower.includes('permission_error')) {
    return new Error(`The ${providerName} API key is valid but lacks permission for model "${model}". Check the key's workspace/model access.`);
  }
  if (status === 404 || lower.includes('not_found_error') || lower.includes('is not found')) {
    return new Error(`Model "${model}" is not available on ${providerName} — pick a different model in Admin → AI Assistant → Configuration.`);
  }
  if (status === 529 || lower.includes('overloaded')) {
    return new Error(`${providerName} is temporarily overloaded — try again in a moment.`);
  }
  return err instanceof Error ? err : new Error(msg);
}

export function decryptAIKey(encryptedKey: string): string {
  try { return decryptIntegrationSecret(encryptedKey); } catch (_err) { return ''; }
}
