import { dbQuery } from '../db.ts';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// What every AI call costs us, and what it costs the customer.
//
//   credits charged = ceil(provider cost in USD × PROFIT_MULTIPLIER ÷ USD per credit)
//
// USD per credit is what we RECEIVE per credit on the cheapest active credit
// pack (Admin can change packs, so it is read from credit_packs and cached).
// Pricing against the cheapest pack means every sale clears cost × 1.54,
// whichever pack the credits came from.
//
// Magnific bills in its own credits. Every figure below was read from
// Magnific's cost simulator on 2 Nov 2026 ("certainty: exact" unless noted).
// One Magnific credit ≈ $0.001 (Premium: $20 for 20,000 credits/month); set
// MAGNIFIC_CREDIT_USD if your Magnific plan costs more per credit.
// ─────────────────────────────────────────────────────────────────────────────

export const PROFIT_MULTIPLIER = 1.54;

/** Seeded packs: Mini $3/250, Starter $12/1,000, Growth $49/5,000, Power $149/20,000 — Power is the floor. */
const DEFAULT_CREDIT_VALUE_USD = 149 / 20_000;
const REFRESH_MS = 10 * 60 * 1000;

let creditValue = DEFAULT_CREDIT_VALUE_USD;
let refreshedAt = 0;
let refreshing: Promise<unknown> | null = null;

export function magnificCreditUsd(): number {
  const v = Number(process.env.MAGNIFIC_CREDIT_USD);
  return Number.isFinite(v) && v > 0 ? v : 0.001;
}

/** Re-reads the cheapest pack's USD per credit. Never throws. */
export async function refreshCreditValue(): Promise<number> {
  try {
    const { rows } = await dbQuery<{ v: string | null }>(
      `SELECT MIN(price_usd::numeric / NULLIF(credits, 0)) AS v FROM credit_packs WHERE active = true AND credits > 0 AND price_usd > 0`,
    );
    const v = Number(rows[0]?.v);
    if (Number.isFinite(v) && v > 0) creditValue = v;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'credit_value_refresh_failed');
  }
  refreshedAt = Date.now();
  return creditValue;
}

/** USD received per credit on the cheapest pack (cached; refreshed in the background every 10 minutes). */
export function creditValueUsd(): number {
  if (Date.now() - refreshedAt > REFRESH_MS && !refreshing) {
    refreshing = refreshCreditValue().finally(() => { refreshing = null; });
  }
  return creditValue;
}

/** Test hook: pin the credit value. */
export function setCreditValueForTests(v: number): void {
  creditValue = v;
  refreshedAt = Date.now();
}

/** Credits to charge for a provider cost in USD (cost × 1.54, rounded up; at least 1 when it costs anything). */
export function creditsForUsd(costUsd: number): number {
  if (!(costUsd > 0)) return 0;
  return Math.max(1, Math.ceil((costUsd * PROFIT_MULTIPLIER) / creditValueUsd() - 1e-9));
}

export function creditsForMagnific(magnificCredits: number): number {
  return creditsForUsd(magnificCredits * magnificCreditUsd());
}

// ── Magnific: images ─────────────────────────────────────────────────────────

/** Magnific One by mode / quality / resolution (Magnific credits). */
export function magnificOneCost(opts: { mode?: string; quality?: string; resolution?: string } = {}): number {
  if (opts.mode === 'draft') return 250;
  const medium = opts.quality === 'medium' || opts.quality === 'normal';
  const res = opts.resolution === '1k' || opts.resolution === '4k' ? opts.resolution : '2k';
  const table = medium ? { '1k': 100, '2k': 180, '4k': 250 } : { '1k': 325, '2k': 600, '4k': 1000 };
  return table[res];
}

/** Other image models at their default size (Magnific credits). 4K doubles where the model offers it. */
const IMAGE_COST: Record<string, number> = {
  'nano-banana-pro': 75,
  'nano-banana-2': 75,
  'nano-banana-pro-flash': 60,
  mystic: 50,
  'flux-kontext-pro': 100,
  'flux-2-pro': 75,
  'flux-pro-v1-1': 50,
  'flux-dev': 10,
  'flux-2-turbo': 25, // not listed in the simulator: priced as Flux.2 Klein
  'flux-2-klein': 25,
  hyperflux: 5,
  'seedream-v5-lite': 50,
  'seedream-v4-5': 50,
  'seedream-v4': 50,
  'runway-t2i': 200,
  'gemini-flash': 50,
  'z-image': 5,
};
const IMAGE_COST_UNKNOWN = 200;

export function magnificImageCost(model: string, opts: { mode?: string; quality?: string; resolution?: string } = {}): number {
  if (model === 'magnific-one' || opts.mode === 'draft') return magnificOneCost(opts);
  const base = IMAGE_COST[model] ?? IMAGE_COST_UNKNOWN;
  return String(opts.resolution ?? '').toLowerCase() === '4k' ? base * 2 : base;
}

// ── Magnific: video ──────────────────────────────────────────────────────────

/** Cost of 5 seconds at 1080p (Magnific credits). Cost scales with length. */
const VIDEO_COST_5S: Record<string, number> = {
  'seedance-2-5': 3950,
  'seedance-2-0': 3500,
  'kling-3-0-omni': 475,
  'kling-3-0': 450,
  'kling-3-pro': 450,
  'kling-v2-6-pro': 225,
  'kling-v2-5-pro': 325,
  'kling-v2-1-pro': 325, // not in the simulator: priced as Kling 2.5
  'kling-o1-pro': 500,
  'kling-motion': 375,
  'ltx-2-pro': 1000, // not in the simulator: priced conservatively
  'wan-2-6-1080p': 1500,
  'wan-2-5-t2v-1080p': 1500,
  'wan-2-5-i2v-1080p': 1500,
  'minimax-hailuo-02-1080p': 600, // 720 per 6 s
  'runway-gen4-turbo': 500,
  'runway-act-two': 500,
  'seedance-pro-1080p': 550,
  'pixverse-v5': 1000,
  'omni-human-1-5': 900, // 1,800 per 10 s
  'wan-2-7-t2v': 1000,
  'happy-horse-i2v': 1400,
};
const VIDEO_COST_UNKNOWN_5S = 1500;

export function magnificVideoCost(model: string, opts: { duration?: unknown; resolution?: string; generate_audio?: boolean } = {}): number {
  const seconds = Math.min(Math.max(Number(opts.duration) || 5, 1), 30);
  let cost = (VIDEO_COST_5S[model] ?? VIDEO_COST_UNKNOWN_5S) * (seconds / 5);
  // 4K measured at 4.2× 1080p (Kling 3.0: 1,900 vs 450).
  if (opts.resolution && /^(4k|2160p|1440p)$/i.test(opts.resolution)) cost *= 4.25;
  // Kling's native audio adds ~78% (Kling 2.6: 400 vs 225).
  if (opts.generate_audio && /^kling/.test(model)) cost *= 1.8;
  return Math.ceil(cost);
}

// ── Magnific: edits, audio, lip sync ─────────────────────────────────────────

export function magnificEditCost(type: string, scaleFactor?: string): number {
  switch (type) {
    case 'remove-background': return 3;
    case 'relight': return 75;
    case 'upscale':
    case 'upscale-precision': {
      // Upscales bill by output size: S 90, M 180, L 270, XL 1,080.
      const f = parseInt(String(scaleFactor || '2'), 10);
      return f >= 8 ? 1080 : f >= 4 ? 270 : 180;
    }
    case 'style-transfer':
    case 'image-expand':
    case 'seedream-edit':
    default: return 50;
  }
}

/** Audio by type and length (Magnific credits). */
export function magnificAudioCost(type: string, seconds?: unknown): number {
  const s = Number(seconds) || 0;
  if (type === 'music-generation' || type === 'music') return Math.ceil(Math.max(s || 60, 10) * (80 / 30)); // Lyria: 80 per 30 s
  if (type === 'audio-isolation' || type === 'isolate') return Math.ceil(Math.max(s || 60, 10) * 4); // 240 per 60 s
  return Math.ceil(Math.max(Math.min(s || 22, 22), 0.5) * 5); // sound effects: 110 per 22 s
}

/** Lip sync (OmniHuman) bills per second of audio; audio can be up to 30 s, so a request is priced at 30 s. */
export function magnificLipSyncCost(seconds = 30): number {
  return Math.ceil(Math.min(Math.max(seconds, 1), 30) * 180);
}

// ── Other providers (USD, list prices) ───────────────────────────────────────

export const GOOGLE_IMAGE_USD: Record<string, number> = {
  'google-imagen-4-fast': 0.02,
  'google-imagen-4': 0.04,
  'google-imagen-4-ultra': 0.06,
  'google-gemini-flash': 0.039,
  'google-gemini-nano-2': 0.067,
  'google-gemini-nano-pro': 0.134,
};
/** Veo bills per second of video (with audio). */
export const GOOGLE_VIDEO_USD_PER_SEC: Record<string, number> = {
  'google-veo-3-fast': 0.15,
  'google-veo-3': 0.4,
};
/** Kling's own API, per 5 seconds (10 s = double). */
export const KLING_VIDEO_USD_5S: Record<string, number> = {
  'kling-v2.6-pro': 0.49,
  'kling-v2.5-turbo': 0.35,
  'kling-v1.6-pro': 0.49,
  'kling-v1.6-standard': 0.28,
};
export const KLING_IMAGE_USD = 0.014;
/** OpenAI text-to-speech, USD per 1,000 characters. */
export const OPENAI_TTS_USD_PER_1K_CHARS: Record<string, number> = {
  'tts-1': 0.015,
  'tts-1-hd': 0.03,
  'gpt-4o-mini-tts': 0.015,
};

/** LLM writing one social post on the paid fallback, worst case (5k tokens in, 2k out on a Haiku-class model). */
export const POST_COPY_WORST_USD = (5000 * 1 + 2000 * 5) / 1_000_000;

// ── Lowest-cost images ───────────────────────────────────────────────────────
//
// An image made on the "Lowest cost" setting is charged half the Best-quality
// image price (Magnific One 2k, standard tier), whatever model actually drew
// it — even when it cost us nothing — and never less than that model's own
// cost × 1.54.

/** A Best-quality image: Magnific One 2k at its standard tier × 1.54. */
export function qualityImageCredits(): number {
  return creditsForMagnific(magnificOneCost({ quality: 'medium', resolution: '2k' }));
}

/** A Lowest-cost image: half the Best-quality price (rounded down), at least 1. */
export function economyImageCredits(): number {
  return Math.max(1, Math.floor(qualityImageCredits() / 2));
}

/** What a Lowest-cost image is charged when the model that made it cost `costCredits` at cost × 1.54. */
export function economyImageCharge(costCredits = 0): number {
  return Math.max(economyImageCredits(), costCredits);
}
