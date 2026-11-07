// One text call for the orchestrator and its skills, on whatever AI the admin
// configured: free NVIDIA first, then the paid Claude / Gemini key
// (callAINonStreaming handles the ladder, caching, usage and tracing).

import {
  callAINonStreaming,
  FAST_MODEL,
  getAIConfig,
  resolveGeminiModel,
  resolveTextKey,
} from '../../ai-helpers.ts';

export class NoAIError extends Error {
  constructor() { super('No AI is configured — add the free NVIDIA key in Admin → NVIDIA, or a paid key in Admin → AI Configuration.'); }
}

export async function aiAvailable(): Promise<boolean> {
  try { return Boolean(resolveTextKey(await getAIConfig())); } catch { return false; }
}

export async function llmText(params: {
  userId: string;
  system: string;
  user: string;
  maxTokens: number;
  feature: string;
  /** 'fast' for steps and routing, 'smart' for the final synthesis. */
  tier?: 'fast' | 'smart';
  noCache?: boolean;
}): Promise<{ text: string; model: string }> {
  const cfg = await getAIConfig();
  const apiKey = resolveTextKey(cfg);
  if (!apiKey) throw new NoAIError();
  const model = cfg.provider === 'google'
    ? resolveGeminiModel(cfg.model)
    : params.tier === 'smart' ? cfg.model : FAST_MODEL;
  const text = await callAINonStreaming(cfg.provider, apiKey, model, params.system, params.user, params.maxTokens, {
    userId: params.userId, feature: params.feature, skipCache: params.noCache,
    nvidiaJob: params.tier === 'smart' ? 'text' : 'fast',
  });
  return { text, model };
}

/** Parses the first JSON object in a model answer (fenced or bare). */
export function extractJson(raw: string): unknown {
  const s = String(raw ?? '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
