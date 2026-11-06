import { getPlatformConfig } from '../user-auth.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Paid-model routing. The free NVIDIA ladder answers first; this decides which
// paid model answers when it cannot. Admin → AI Assistant picks one model
// (Opus by default), and every paid call used it — a 300-token reply draft
// cost what a long strategy answer costs.
//
// Each call is sized simple / standard / complex from its feature, its output
// budget and its prompt size. Simple work goes to the vendor's small model,
// standard to its mid model, complex to the configured one. The router only
// ever routes DOWN: if the configured model is already cheaper than the tier's
// model, the configured model is kept.
//
// Admin → AI Ops → routing "off" turns it off (every call uses the
// configured model, as before).
// ─────────────────────────────────────────────────────────────────────────────

/** Its own platform_configs row: the AI Assistant save replaces its whole config object. */
export const AI_OPS_PLATFORM = 'ai_ops';

export type Tier = 'simple' | 'standard' | 'complex';

// Short structured answers: classify, extract, summarise, price, draft a reply.
const SIMPLE_FEATURES = /(^|_)(qa|classif|extract|summary|summar|pricing|planning|tag|score|triage|social_reply|seed|memory|title|caption_short|router|eval)(_|$)/i;
// Long-horizon reasoning where the configured (best) model earns its price.
const COMPLEX_FEATURES = /(^|_)(strategy|synthesis|coordinator|team_plan|niche_research|campaign_brief|audit)(_|$)/i;

export function classifyTask(p: { feature: string; maxTokens: number; promptChars: number }): Tier {
  if (COMPLEX_FEATURES.test(p.feature) || p.maxTokens >= 3000 || p.promptChars >= 40_000) return 'complex';
  if (SIMPLE_FEATURES.test(p.feature) || (p.maxTokens <= 500 && p.promptChars <= 8000)) return 'simple';
  return 'standard';
}

/** The chat assistant: most turns are ordinary requests; long or late turns get the configured model. */
export function classifyChatTurn(messages: Array<{ role: string; content: string }>): Tier {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const total = messages.reduce((n, m) => n + String(m.content ?? '').length, 0);
  if (last.length > 1500 || total > 30_000 || /\b(strategy|plan (a|the|my)|campaign|analy[sz]e|audit|compare)\b/i.test(last)) return 'complex';
  return 'standard';
}

const TIER_MODELS: Record<'anthropic' | 'google', Record<Exclude<Tier, 'complex'>, string>> = {
  anthropic: { simple: 'claude-haiku-4-5', standard: 'claude-sonnet-5' },
  google: { simple: 'gemini-2.5-flash', standard: 'gemini-2.5-flash' },
};

// Cheapest first. A model not listed is treated as the most expensive, so
// an unknown configured model can still be routed down.
const PRICE_RANK = [
  'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash',
  'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
  'gemini-1.5-pro', 'gemini-2.5-pro',
  'claude-sonnet-4-6', 'claude-sonnet-5',
  'claude-opus-5-5', 'claude-opus-4-7', 'claude-opus-4-8',
];
const rank = (model: string) => { const i = PRICE_RANK.indexOf(model); return i < 0 ? PRICE_RANK.length : i; };

export function routePaidModel(provider: 'anthropic' | 'google', configured: string, tier: Tier, mode: 'auto' | 'off'): { model: string; routedFrom: string | null } {
  if (mode === 'off' || tier === 'complex') return { model: configured, routedFrom: null };
  const candidate = TIER_MODELS[provider][tier];
  if (rank(candidate) >= rank(configured)) return { model: configured, routedFrom: null };
  return { model: candidate, routedFrom: configured };
}

let modeCache: { at: number; value: 'auto' | 'off' } | null = null;

export async function routingMode(): Promise<'auto' | 'off'> {
  if (modeCache && Date.now() - modeCache.at < 30_000) return modeCache.value;
  const cfg = await getPlatformConfig(AI_OPS_PLATFORM).catch(() => ({} as Record<string, unknown>));
  const value = String((cfg as any).routing ?? 'auto') === 'off' ? 'off' : 'auto';
  modeCache = { at: Date.now(), value };
  return value;
}

export function invalidateRoutingMode(): void { modeCache = null; }

/**
 * Keeps the newest messages that fit a character budget (≈ 4 chars a token),
 * always keeping the last one. Older turns cost tokens on every call and are
 * rarely what the answer depends on.
 */
export function fitHistory<T extends { content: string }>(messages: T[], maxChars = 24_000, perMessage = 3500): T[] {
  const capped = messages.map((m) => ({ ...m, content: String(m.content ?? '').slice(0, perMessage) }));
  const out: T[] = [];
  let used = 0;
  for (let i = capped.length - 1; i >= 0; i--) {
    const len = capped[i].content.length;
    if (out.length && used + len > maxChars) break;
    out.unshift(capped[i]);
    used += len;
  }
  // Vendors require the conversation to open with the user.
  while (out.length > 1 && (out[0] as any).role === 'assistant') out.shift();
  return out;
}
