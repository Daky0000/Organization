import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { encryptPlatformConfig, decryptPlatformConfig } from '../integration-helpers.ts';
import { chargeAICredits } from '../ai-helpers.ts';
import { callMagnificMcpTool } from './mcpRoutes.ts';

type AuthResult = { userId: string; role?: string } | null;
type Pool = import('pg').Pool;

interface MagnificDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool | null;
}

// ── Module-level constants (read from process.env at startup) ─────────────────

export const _PROXY = (() => {
  const raw = (process.env.MAGNIFIC_PROXY_URL ?? '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try { new URL(raw); return raw; }
  catch { logger.error(`[proxy] Invalid MAGNIFIC_PROXY_URL "${raw}" — must start with https://. Falling back to direct API.`); return ''; }
})();

export const MAGNIFIC_BASE = _PROXY ? `${_PROXY}/magnific` : 'https://api.magnific.com';
export const FREEPIK_BASE = _PROXY ? `${_PROXY}/freepik` : 'https://api.freepik.com';
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const ASPECT_TO_WH: Record<string, { width: number; height: number }> = {
  'square_1_1':        { width: 1024, height: 1024 },
  'widescreen_16_9':   { width: 1280, height: 720 },
  'portrait_9_16':     { width: 720,  height: 1280 },
  'social_story_9_16': { width: 720,  height: 1280 },
  'classic_4_3':       { width: 1024, height: 768 },
  'portrait_3_4':      { width: 768,  height: 1024 },
  'traditional_3_4':   { width: 768,  height: 1024 },
  'cinematic_21_9':    { width: 1024, height: 448 },
  'portrait_2_3':      { width: 768,  height: 1152 },
  'standard_3_2':      { width: 1024, height: 683 },
};

export const MAGNIFIC_ONE_ASPECT_RATIOS = new Set([
  '1:1', '2:1', '3:1', '2:3', '3:2', '3:4', '4:3', '16:9', '9:16', '21:9',
]);

// Aspect ratios that are exact in an 8-tile (2x4) draft contact sheet.
// All 10 ratios are exact in a 16-tile (4x4) contact sheet.
export const MAGNIFIC_ONE_8TILE_EXACT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4']);

export const MAGNIFIC_IMAGE_MODELS: Record<string, {
  endpoint: string;
  pollPath: (id: string) => string;
  bodyType: 'magnific_one' | 'aspect_ratio' | 'image_size' | 'width_height';
  credits: number;
  label?: string;
  tier?: 'flagship' | 'premium' | 'quality' | 'fast';
}> = {
  'magnific-one':          { endpoint: '/v1/ai/magnific-one',                                    pollPath: (id) => `/v1/ai/magnific-one/${id}`,                                    bodyType: 'magnific_one',  credits: 6, label: 'Magnific One (Art-Directed 4K & Draft Sheets)', tier: 'flagship' },
  'nano-banana-pro':       { endpoint: '/v1/ai/text-to-image/nano-banana-pro',                  pollPath: (id) => `/v1/ai/text-to-image/nano-banana-pro/${id}`,                  bodyType: 'aspect_ratio',  credits: 4, label: 'Nano Banana Pro (Product Text, Sketches & Edits)', tier: 'flagship' },
  'nano-banana-2':         { endpoint: '/v1/ai/text-to-image/nano-banana-2',                    pollPath: (id) => `/v1/ai/text-to-image/nano-banana-2/${id}`,                    bodyType: 'aspect_ratio',  credits: 4, label: 'Nano Banana 2 (4K Character Sheets & Mockups)', tier: 'flagship' },
  'nano-banana-pro-flash': { endpoint: '/v1/ai/text-to-image/nano-banana-pro-flash',            pollPath: (id) => `/v1/ai/text-to-image/nano-banana-pro-flash/${id}`,            bodyType: 'aspect_ratio',  credits: 3, label: 'Nano Banana Pro Flash',                        tier: 'fast' },
  'mystic':                { endpoint: '/v1/ai/mystic',                                          pollPath: (id) => `/v1/ai/mystic/${id}`,                                          bodyType: 'aspect_ratio',  credits: 8, label: 'Mystic (Ultra-Realistic)',                     tier: 'premium' },
  'flux-kontext-pro':      { endpoint: '/v1/ai/text-to-image/flux-kontext-pro',                 pollPath: (id) => `/v1/ai/text-to-image/flux-kontext-pro/${id}`,                 bodyType: 'aspect_ratio',  credits: 5, label: 'Flux Kontext Pro',                             tier: 'quality' },
  'flux-2-pro':            { endpoint: '/v1/ai/text-to-image/flux-2-pro',                       pollPath: (id) => `/v1/ai/text-to-image/flux-2-pro/${id}`,                       bodyType: 'width_height',  credits: 5, label: 'Flux 2 Pro',                                   tier: 'quality' },
  'flux-pro-v1-1':         { endpoint: '/v1/ai/text-to-image/flux-pro-v1-1',                    pollPath: (id) => `/v1/ai/text-to-image/flux-pro-v1-1/${id}`,                    bodyType: 'aspect_ratio',  credits: 5, label: 'Flux Pro 1.1',                                 tier: 'quality' },
  'flux-dev':              { endpoint: '/v1/ai/text-to-image/flux-dev',                         pollPath: (id) => `/v1/ai/text-to-image/flux-dev/${id}`,                         bodyType: 'aspect_ratio',  credits: 4, label: 'Flux Dev',                                     tier: 'quality' },
  'flux-2-turbo':          { endpoint: '/v1/ai/text-to-image/flux-2-turbo',                     pollPath: (id) => `/v1/ai/text-to-image/flux-2-turbo/${id}`,                     bodyType: 'image_size',    credits: 3, label: 'Flux 2 Turbo',                                 tier: 'fast' },
  'flux-2-klein':          { endpoint: '/v1/ai/text-to-image/flux-2-klein',                     pollPath: (id) => `/v1/ai/text-to-image/flux-2-klein/${id}`,                     bodyType: 'aspect_ratio',  credits: 3, label: 'Flux 2 Klein (Multi-Ref)',                     tier: 'fast' },
  'hyperflux':             { endpoint: '/v1/ai/text-to-image/hyperflux',                        pollPath: (id) => `/v1/ai/text-to-image/hyperflux/${id}`,                        bodyType: 'aspect_ratio',  credits: 3, label: 'Hyperflux',                                    tier: 'fast' },
  'seedream-v5-lite':      { endpoint: '/v1/ai/text-to-image/seedream-v5-lite',                 pollPath: (id) => `/v1/ai/text-to-image/seedream-v5-lite/${id}`,                 bodyType: 'aspect_ratio',  credits: 4, label: 'Seedream 5 Lite',                              tier: 'fast' },
  'seedream-v4-5':         { endpoint: '/v1/ai/text-to-image/seedream-v4-5',                    pollPath: (id) => `/v1/ai/text-to-image/seedream-v4-5/${id}`,                    bodyType: 'aspect_ratio',  credits: 4, label: 'Seedream 4.5',                                 tier: 'quality' },
  'seedream-v4':           { endpoint: '/v1/ai/text-to-image/seedream-v4',                      pollPath: (id) => `/v1/ai/text-to-image/seedream-v4/${id}`,                      bodyType: 'aspect_ratio',  credits: 5, label: 'Seedream 4',                                   tier: 'quality' },
  'runway-t2i':            { endpoint: '/v1/ai/text-to-image/runway',                           pollPath: (id) => `/v1/ai/text-to-image/runway/${id}`,                           bodyType: 'aspect_ratio',  credits: 5, label: 'RunWay Text-to-Image',                         tier: 'quality' },
  'gemini-flash':          { endpoint: '/v1/ai/text-to-image/gemini-2-5-flash-image-preview',   pollPath: (id) => `/v1/ai/text-to-image/gemini-2-5-flash-image-preview/${id}`,   bodyType: 'aspect_ratio',  credits: 6, label: 'Gemini 2.5 Flash Image',                       tier: 'quality' },
  'z-image':               { endpoint: '/v1/ai/text-to-image/z-image',                          pollPath: (id) => `/v1/ai/text-to-image/z-image/${id}`,                          bodyType: 'aspect_ratio',  credits: 2, label: 'Z-Image Turbo',                                tier: 'fast' },
};

export const MAGNIFIC_VIDEO_MODELS: Record<string, {
  endpoint: string;
  pollPath: (id: string) => string;
  credits: number;
  label?: string;
  supportsI2V?: boolean;
  supportsAudio?: boolean;
}> = {
  'seedance-2-5':            { endpoint: '/v1/ai/video/seedance-2-5',                     pollPath: (id) => `/v1/ai/video/seedance-2-5/${id}`,                     credits: 32, label: 'Seedance 2.5 (Up to 30s, 50 Refs, Multi-Shot & 3D Motion Transfer)', supportsI2V: true,  supportsAudio: true },
  'seedance-2-0':            { endpoint: '/v1/ai/video/seedance-2-0',                     pollPath: (id) => `/v1/ai/video/seedance-2-0/${id}`,                     credits: 28, label: 'Seedance 2.0 (Multi-Ref + Native Audio)',                            supportsI2V: true,  supportsAudio: true },
  'kling-3-0-omni':          { endpoint: '/v1/ai/video/kling-v3-omni',                    pollPath: (id) => `/v1/ai/video/kling-v3-omni/${id}`,                    credits: 35, label: 'Kling 3.0 Omni (Multi-Ref Lip-Sync, Object Swap & Product Text)',    supportsI2V: true,  supportsAudio: true },
  'kling-3-0':               { endpoint: '/v1/ai/video/kling-v3-pro',                     pollPath: (id) => `/v1/ai/video/kling-v3-pro/${id}`,                     credits: 35, label: 'Kling 3.0 (Single-Shot & 6-Cut Multi-Shot)',                         supportsI2V: true,  supportsAudio: true },
  'kling-3-pro':             { endpoint: '/v1/ai/video/kling-v3-pro',                     pollPath: (id) => `/v1/ai/video/kling-v3-pro/${id}`,                     credits: 35, label: 'Kling 3 Pro',                                                        supportsI2V: true,  supportsAudio: true },
  'kling-v2-6-pro':          { endpoint: '/v1/ai/image-to-video/kling-v2-6-pro',          pollPath: (id) => `/v1/ai/image-to-video/kling-v2-6-pro/${id}`,          credits: 30, label: 'Kling 2.6 Pro (T2V & I2V + Audio)',                                  supportsI2V: true,  supportsAudio: true },
  'kling-v2-5-pro':          { endpoint: '/v1/ai/image-to-video/kling-v2-5-pro',          pollPath: (id) => `/v1/ai/image-to-video/kling-v2-5-pro/${id}`,          credits: 25, label: 'Kling 2.5 Pro',                                                      supportsI2V: true,  supportsAudio: false },
  'kling-v2-1-pro':          { endpoint: '/v1/ai/image-to-video/kling-v2-1-pro',          pollPath: (id) => `/v1/ai/image-to-video/kling-v2-1-pro/${id}`,          credits: 22, label: 'Kling 2.1 Pro',                                                      supportsI2V: true,  supportsAudio: false },
  'kling-o1-pro':            { endpoint: '/v1/ai/image-to-video/kling-o1-pro',            pollPath: (id) => `/v1/ai/image-to-video/kling-o1-pro/${id}`,            credits: 35, label: 'Kling O1 Pro (Reasoning Video)',                                     supportsI2V: true,  supportsAudio: true },
  'kling-motion':            { endpoint: '/v1/ai/image-to-video/kling-motion',            pollPath: (id) => `/v1/ai/image-to-video/kling-motion/${id}`,            credits: 28, label: 'Kling 2.6 Motion Control (Biomechanics Transfer)',                   supportsI2V: true,  supportsAudio: false },
  'ltx-2-pro':               { endpoint: '/v1/ai/text-to-video/ltx-2-pro',                pollPath: (id) => `/v1/ai/text-to-video/ltx-2-pro/${id}`,                credits: 25, label: 'LTX Video 2.0 Pro (Up to 4K 50fps)',                                 supportsI2V: false, supportsAudio: true },
  'wan-2-6-1080p':           { endpoint: '/v1/ai/image-to-video/wan-v2-6-1080p',          pollPath: (id) => `/v1/ai/image-to-video/wan-v2-6-1080p/${id}`,          credits: 25, label: 'WAN 2.6 1080p',                                                      supportsI2V: true,  supportsAudio: true },
  'wan-2-5-t2v-1080p':       { endpoint: '/v1/ai/text-to-video/wan-2-5-t2v-1080p',        pollPath: (id) => `/v1/ai/text-to-video/wan-2-5-t2v-1080p/${id}`,        credits: 22, label: 'WAN 2.5 Text-to-Video 1080p',                                        supportsI2V: false, supportsAudio: false },
  'wan-2-5-i2v-1080p':       { endpoint: '/v1/ai/image-to-video/wan-2-5-i2v-1080p',       pollPath: (id) => `/v1/ai/image-to-video/wan-2-5-i2v-1080p/${id}`,       credits: 22, label: 'WAN 2.5 Image-to-Video 1080p',                                       supportsI2V: true,  supportsAudio: false },
  'minimax-hailuo-2-3-1080p':{ endpoint: '/v1/ai/image-to-video/minimax-hailuo-2-3-1080p',pollPath: (id) => `/v1/ai/image-to-video/minimax-hailuo-2-3-1080p/${id}`,credits: 28, label: 'MiniMax Hailuo 2.3 1080p',                                           supportsI2V: true,  supportsAudio: false },
  'minimax-hailuo-02-1080p': { endpoint: '/v1/ai/image-to-video/minimax-hailuo-02-1080p', pollPath: (id) => `/v1/ai/image-to-video/minimax-hailuo-02-1080p/${id}`, credits: 25, label: 'MiniMax Hailuo 02 1080p',                                            supportsI2V: true,  supportsAudio: false },
  'runway-gen4-turbo':       { endpoint: '/v1/ai/image-to-video/runway-gen4-turbo',       pollPath: (id) => `/v1/ai/image-to-video/runway-gen4-turbo/${id}`,       credits: 25, label: 'RunWay Gen4 Turbo',                                                  supportsI2V: true,  supportsAudio: false },
  'runway-act-two':          { endpoint: '/v1/ai/video/runway-act-two',                   pollPath: (id) => `/v1/ai/video/runway-act-two/${id}`,                   credits: 30, label: 'RunWay Act Two (Character)',                                         supportsI2V: true,  supportsAudio: true },
  'seedance-pro-1080p':      { endpoint: '/v1/ai/image-to-video/seedance-pro-1080p',      pollPath: (id) => `/v1/ai/image-to-video/seedance-pro-1080p/${id}`,      credits: 26, label: 'Seedance Pro 1080p',                                                 supportsI2V: true,  supportsAudio: false },
  'pixverse-v5':             { endpoint: '/v1/ai/image-to-video/pixverse',                pollPath: (id) => `/v1/ai/image-to-video/pixverse/${id}`,                credits: 20, label: 'PixVerse V5',                                                        supportsI2V: true,  supportsAudio: false },
  'omni-human-1-5':          { endpoint: '/v1/ai/video/omni-human-1-5',                   pollPath: (id) => `/v1/ai/video/omni-human-1-5/${id}`,                   credits: 30, label: 'OmniHuman 1.5 (Lip Sync Avatar)',                                    supportsI2V: true,  supportsAudio: true },
  'wan-2-7-t2v':             { endpoint: '/v1/ai/text-to-video/wan-2-7',                  pollPath: (id) => `/v1/ai/text-to-video/wan-2-7/${id}`,                  credits: 25, label: 'WAN 2.7 T2V',                                                        supportsI2V: false, supportsAudio: false },
  'happy-horse-i2v':         { endpoint: '/v1/ai/image-to-video/happy-horse-1',           pollPath: (id) => `/v1/ai/image-to-video/happy-horse-1/${id}`,           credits: 20, label: 'Happy Horse I2V',                                                    supportsI2V: true,  supportsAudio: false },
};

export const ASPECT_RATIO_MAP: Record<string, string> = {
  '1:1':   'square_1_1',
  '16:9':  'widescreen_16_9',
  '9:16':  'portrait_9_16',
  '4:3':   'classic_4_3',
  '3:4':   'portrait_3_4',
  '21:9':  'cinematic_21_9',
  '2:3':   'portrait_2_3',
  '3:2':   'standard_3_2',
};

export const REVERSE_ASPECT_RATIO_MAP: Record<string, string> = {
  'square_1_1':        '1:1',
  'widescreen_16_9':   '16:9',
  'portrait_9_16':     '9:16',
  'social_story_9_16': '9:16',
  'classic_4_3':       '4:3',
  'portrait_3_4':      '3:4',
  'traditional_3_4':   '3:4',
  'cinematic_21_9':    '21:9',
  'portrait_2_3':      '2:3',
  'standard_3_2':      '3:2',
};

export const FREEPIK_IMAGE_MODELS: Record<string, { credits: number; type: 'async' }> = {
  'freepik-mystic': { credits: 5, type: 'async' },
};

// ── Exported helper functions ─────────────────────────────────────────────────

export function sanitizeMagnificError(raw: string): string {
  if (raw.toLowerCase().includes('free trial') || raw.toLowerCase().includes('magnific.com/developers')) {
    logger.error('[Magnific] Account limit reached:', raw);
    return 'Generation is temporarily unavailable due to provider quota. Please try again later.';
  }
  return raw;
}

export function proxyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    'Accept': 'application/json, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };
  if (process.env.MAGNIFIC_PROXY_SECRET) h['X-Proxy-Secret'] = process.env.MAGNIFIC_PROXY_SECRET;
  return h;
}

export async function getMagnificApiKey(pool: Pool | null): Promise<string> {
  // Admin-configured key (AI Assistant → Magnific AI) wins; env is fallback only
  try {
    const cfg = await pool!.query(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`);
    const dbKey: string = decryptPlatformConfig(cfg.rows[0]?.config)?.apiKey ?? '';
    if (dbKey) return dbKey;
  } catch (_err) { /* fall through to env */ }
  return process.env.MAGNIFIC_API_KEY || '';
}

export async function getFreepikApiKey(pool: Pool | null): Promise<string> {
  // Admin-configured key wins; env fallback; Magnific key as last resort
  try {
    const cfg = await pool!.query(`SELECT config FROM platform_configs WHERE platform = 'freepik' LIMIT 1`);
    const dbKey: string = decryptPlatformConfig(cfg.rows[0]?.config)?.apiKey ?? '';
    if (dbKey) return dbKey;
  } catch (_err) { /* ignore */ }
  if (process.env.FREEPIK_API_KEY) return process.env.FREEPIK_API_KEY;
  return getMagnificApiKey(pool);
}

export async function magnificPost(path: string, body: object, apiKey: string) {
  return axios.post(`${MAGNIFIC_BASE}${path}`, body, {
    headers: proxyHeaders({
      'x-magnific-api-key': apiKey,
      'Content-Type': 'application/json',
      'Origin': 'https://app.magnific.com',
      'Referer': 'https://app.magnific.com/',
    }),
    validateStatus: () => true,
    timeout: 20000,
  });
}

export async function pollMagnificTask(
  taskPath: string,
  apiKey: string,
  maxSeconds = 120,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; urls?: string[]; error: string | null }> {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await axios.get(`${MAGNIFIC_BASE}${taskPath}`, {
      headers: proxyHeaders({
        'x-magnific-api-key': apiKey,
        'Origin': 'https://app.magnific.com',
        'Referer': 'https://app.magnific.com/',
      }),
      validateStatus: () => true,
      timeout: 12000,
    });
    const data = r.data?.data ?? r.data;
    const status: string = String(data?.status ?? '').toUpperCase();
    onProgress?.(status);
    if (status === 'COMPLETED' || status === 'SUCCEEDED' || status === 'DONE') {
      const rawGen = data?.generated ?? data?.output ?? (data?.output_url ? [data.output_url] : data?.url ? [data.url] : data?.audio_url ? [data.audio_url] : []);
      const urls: string[] = (Array.isArray(rawGen) ? rawGen : [rawGen])
        .map((item: any) => (typeof item === 'string' ? item : item?.url ?? item?.audio_url ?? item?.video_url ?? ''))
        .filter(Boolean);
      return { url: urls[0] ?? null, urls, error: null };
    }
    if (status === 'FAILED' || status === 'ERROR') {
      return { url: null, urls: [], error: data?.error ?? data?.message ?? 'Generation failed' };
    }
  }
  return { url: null, urls: [], error: 'Timeout: generation took too long' };
}

export interface MagnificOneOptions {
  prompt: string;
  mode?: 'quality' | 'draft';
  quality?: 'normal' | 'medium' | 'high';
  resolution?: '1k' | '2k' | '4k';
  aspect_ratio?: string;
  tiles?: 8 | 16;
  reference_images?: string[];
  webhook_url?: string;
}

/**
 * Generate art-directed imagery or 8/16-tile draft contact sheets with Magnific One (POST /v1/ai/magnific-one).
 * Follows Magnific One best practices:
 * - In "draft" mode, automatically upgrades tiles to 16 when using an aspect ratio that 8-tile (2x4) cannot render exactly.
 * - Supports 1..10 reference_images in both draft and quality modes.
 */
export async function magnificOneGenerate(
  opts: MagnificOneOptions,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{
  url: string | null;
  urls: string[];
  mode: 'quality' | 'draft';
  tiles?: 8 | 16;
  resolution?: string;
  aspectRatio: string;
  taskId: string | null;
  error: string | null;
}> {
  const mode: 'quality' | 'draft' = opts.mode === 'draft' ? 'draft' : 'quality';
  const rawRatio = String(opts.aspect_ratio || '1:1').trim();
  const normalizedRatio = REVERSE_ASPECT_RATIO_MAP[rawRatio] ?? (MAGNIFIC_ONE_ASPECT_RATIOS.has(rawRatio) ? rawRatio : '1:1');

  const body: Record<string, unknown> = {
    prompt: String(opts.prompt || '').trim().slice(0, 2000),
    mode,
    aspect_ratio: normalizedRatio,
  };

  let effectiveTiles: 8 | 16 | undefined;
  if (mode === 'draft') {
    // 16 tiles (4x4 grid) honors all 10 aspect ratios; 8 tiles (2x4) is only exact for 1:1, 2:3, 3:2, 3:4
    if (opts.tiles === 16 || !MAGNIFIC_ONE_8TILE_EXACT_RATIOS.has(normalizedRatio)) {
      effectiveTiles = 16;
    } else {
      effectiveTiles = 8;
    }
    body.tiles = effectiveTiles;
  } else {
    body.quality = opts.quality === 'medium' || opts.quality === 'normal' ? 'medium' : 'high';
    body.resolution = opts.resolution && ['1k', '2k', '4k'].includes(opts.resolution) ? opts.resolution : '2k';
  }

  if (Array.isArray(opts.reference_images) && opts.reference_images.length > 0) {
    const refs = opts.reference_images
      .map((u) => String(u || '').trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 10);
    if (refs.length > 0) body.reference_images = refs;
  }
  if (opts.webhook_url) body.webhook_url = opts.webhook_url;

  const submitResp = await magnificPost('/v1/ai/magnific-one', body, apiKey);
  logger.info(`[MagnificOne] mode=${mode} ratio=${normalizedRatio} → HTTP ${submitResp.status}`, JSON.stringify(submitResp.data)?.slice(0, 300));
  if (submitResp.status >= 400) {
    const isHtml = typeof submitResp.data === 'string' && submitResp.data.trimStart().startsWith('<');
    const msg = isHtml
      ? `Magnific One service blocked (HTTP ${submitResp.status})`
      : (submitResp.data?.message ?? submitResp.data?.problem?.message ?? submitResp.data?.error ?? JSON.stringify(submitResp.data));
    return {
      url: null,
      urls: [],
      mode,
      tiles: effectiveTiles,
      resolution: body.resolution as string | undefined,
      aspectRatio: normalizedRatio,
      taskId: null,
      error: sanitizeMagnificError(`HTTP ${submitResp.status}: ${msg}`),
    };
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
  if (!taskId) {
    return {
      url: null,
      urls: [],
      mode,
      tiles: effectiveTiles,
      resolution: body.resolution as string | undefined,
      aspectRatio: normalizedRatio,
      taskId: null,
      error: 'No task_id in Magnific One response',
    };
  }

  const poll = await pollMagnificTask(`/v1/ai/magnific-one/${taskId}`, apiKey, 150, onProgress);
  return {
    url: poll.url,
    urls: poll.urls ?? (poll.url ? [poll.url] : []),
    mode,
    tiles: effectiveTiles,
    resolution: body.resolution as string | undefined,
    aspectRatio: normalizedRatio,
    taskId,
    error: poll.error,
  };
}

export async function magnificGenerateImage(
  modelId: string,
  prompt: string,
  aspectRatio: string,
  apiKey: string,
  onProgress?: (status: string) => void,
  extraOpts?: Partial<MagnificOneOptions>
): Promise<{ url: string | null; urls?: string[]; taskId: string | null; error: string | null }> {
  if (modelId === 'magnific-one' || extraOpts?.mode) {
    const res = await magnificOneGenerate(
      {
        prompt,
        aspect_ratio: aspectRatio,
        mode: extraOpts?.mode,
        quality: extraOpts?.quality,
        resolution: extraOpts?.resolution,
        tiles: extraOpts?.tiles,
        reference_images: extraOpts?.reference_images,
      },
      apiKey,
      onProgress
    );
    return { url: res.url, urls: res.urls, taskId: res.taskId, error: res.error };
  }

  const cfg = MAGNIFIC_IMAGE_MODELS[modelId] ?? MAGNIFIC_IMAGE_MODELS['magnific-one'] ?? MAGNIFIC_IMAGE_MODELS['flux-2-turbo'];
  if (cfg.bodyType === 'magnific_one') {
    const res = await magnificOneGenerate({ prompt, aspect_ratio: aspectRatio, reference_images: extraOpts?.reference_images, resolution: extraOpts?.resolution }, apiKey, onProgress);
    return { url: res.url, urls: res.urls, taskId: res.taskId, error: res.error };
  }

  const mappedAspect = ASPECT_RATIO_MAP[aspectRatio] ?? aspectRatio ?? 'square_1_1';
  let body: Record<string, any>;
  if (cfg.bodyType === 'image_size') {
    const wh = ASPECT_TO_WH[mappedAspect] ?? { width: 1024, height: 1024 };
    body = { prompt, image_size: wh, guidance_scale: 2.5, output_format: 'jpeg' };
  } else if (cfg.bodyType === 'width_height') {
    const wh = ASPECT_TO_WH[mappedAspect] ?? { width: 1024, height: 768 };
    body = { prompt, width: wh.width, height: wh.height };
  } else {
    body = { prompt, aspect_ratio: mappedAspect };
  }
  if (Array.isArray(extraOpts?.reference_images) && extraOpts.reference_images.length > 0) {
    body.reference_images = extraOpts.reference_images.slice(0, 10);
  }
  if (extraOpts?.resolution) {
    body.resolution = extraOpts.resolution;
  }

  const submitResp = await magnificPost(cfg.endpoint, body, apiKey);
  logger.info(`[Magnific] ${modelId} ${cfg.endpoint} → HTTP ${submitResp.status}`, JSON.stringify(submitResp.data)?.slice(0, 300));
  if (submitResp.status >= 400) {
    const isHtml = typeof submitResp.data === 'string' && submitResp.data.trimStart().startsWith('<');
    const msg = isHtml
      ? `Image generation service blocked (HTTP ${submitResp.status}) — API key may be invalid or service is unavailable from this server`
      : (submitResp.data?.message ?? submitResp.data?.error ?? submitResp.data?.detail ?? JSON.stringify(submitResp.data) ?? `Magnific API error`);
    return { url: null, urls: [], taskId: null, error: sanitizeMagnificError(`HTTP ${submitResp.status}: ${msg}`) };
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
  if (!taskId) {
    logger.error('[Magnific] response missing task_id:', JSON.stringify(submitResp.data)?.slice(0, 500));
    return { url: null, urls: [], taskId: null, error: 'No task_id in Magnific response' };
  }
  const poll = await pollMagnificTask(cfg.pollPath(taskId), apiKey, 120, onProgress);
  return { url: poll.url, urls: poll.urls, taskId, error: poll.error };
}

/**
 * Helper to fetch an image URL as raw base64 if an edit endpoint requires base64 input.
 */
async function ensureBase64Image(imageOrUrl?: string): Promise<string | null> {
  if (!imageOrUrl) return null;
  const trimmed = imageOrUrl.trim();
  if (trimmed.startsWith('data:image/')) {
    const idx = trimmed.indexOf('base64,');
    return idx >= 0 ? trimmed.slice(idx + 7) : trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const resp = await axios.get<ArrayBuffer>(trimmed, { responseType: 'arraybuffer', timeout: 20000 });
      return Buffer.from(resp.data).toString('base64');
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export interface MagnificEditOptions {
  type: 'upscale' | 'upscale-precision' | 'relight' | 'style-transfer' | 'remove-background' | 'image-expand' | 'seedream-edit';
  image?: string;
  image_url?: string;
  reference_image?: string;
  prompt?: string;
  scale_factor?: '2x' | '4x' | '8x' | '16x';
  optimized_for?: string;
  creativity?: number;
  hdr?: number;
  resemblance?: number;
  fractality?: number;
  style?: string;
  change_background?: boolean;
  style_strength?: number;
  structure_strength?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export async function magnificEditImage(
  opts: MagnificEditOptions,
  apiKey: string
): Promise<{ url: string | null; taskId: string | null; error: string | null }> {
  const { type } = opts;
  if (type === 'remove-background') {
    const imageUrl = opts.image_url || opts.image;
    if (!imageUrl) return { url: null, taskId: null, error: 'image_url is required for remove-background' };
    const r = await axios.post(
      `${MAGNIFIC_BASE}/v1/ai/beta/remove-background`,
      { image_url: imageUrl },
      { headers: proxyHeaders({ 'x-magnific-api-key': apiKey, 'Content-Type': 'application/json' }), validateStatus: () => true, timeout: 30000 }
    );
    if (r.status >= 400) return { url: null, taskId: null, error: r.data?.message ?? `Remove background failed (HTTP ${r.status})` };
    const resultUrl: string | null = r.data?.high_resolution ?? r.data?.url ?? r.data?.data?.url ?? null;
    return { url: resultUrl, taskId: null, error: resultUrl ? null : 'No URL returned from remove-background' };
  }

  const base64Img = await ensureBase64Image(opts.image || opts.image_url);
  if (!base64Img) return { url: null, taskId: null, error: `image or image_url is required for ${type}` };

  let endpoint = '';
  let pollBase = '';
  const body: Record<string, any> = { image: base64Img };

  if (type === 'upscale' || type === 'upscale-precision') {
    endpoint = type === 'upscale-precision' ? '/v1/ai/image-upscaler-precision' : '/v1/ai/image-upscaler';
    pollBase = endpoint;
    body.scale_factor = opts.scale_factor ?? '2x';
    if (opts.optimized_for) body.optimized_for = opts.optimized_for;
    if (opts.creativity != null) body.creativity = opts.creativity;
    if (opts.hdr != null) body.hdr = opts.hdr;
    if (opts.resemblance != null) body.resemblance = opts.resemblance;
    if (opts.fractality != null) body.fractality = opts.fractality;
    if (opts.prompt) body.prompt = opts.prompt;
  } else if (type === 'relight') {
    endpoint = '/v1/ai/image-relight';
    pollBase = endpoint;
    if (opts.prompt) body.prompt = opts.prompt;
    if (opts.style) body.style = opts.style;
    if (opts.change_background != null) body.change_background = opts.change_background;
  } else if (type === 'style-transfer') {
    const refBase64 = await ensureBase64Image(opts.reference_image);
    if (!refBase64) return { url: null, taskId: null, error: 'reference_image is required for style-transfer' };
    endpoint = '/v1/ai/image-style-transfer';
    pollBase = endpoint;
    body.reference_image = refBase64;
    if (opts.style_strength != null) body.style_strength = opts.style_strength;
    if (opts.structure_strength != null) body.structure_strength = opts.structure_strength;
    if (opts.prompt) body.prompt = opts.prompt;
  } else if (type === 'image-expand') {
    endpoint = '/v1/ai/image-expand/flux-pro';
    pollBase = endpoint;
    if (opts.prompt) body.prompt = opts.prompt;
    body.left = opts.left ?? 512;
    body.right = opts.right ?? 512;
    body.top = opts.top ?? 256;
    body.bottom = opts.bottom ?? 256;
  } else if (type === 'seedream-edit') {
    endpoint = '/v1/ai/image-editing/seedream-v4-5-edit';
    pollBase = endpoint;
    body.prompt = opts.prompt || 'Enhance image quality and composition';
  } else {
    return { url: null, taskId: null, error: `Unknown edit type: ${type}` };
  }

  const r = await magnificPost(endpoint, body, apiKey);
  if (r.status >= 400) {
    return { url: null, taskId: null, error: sanitizeMagnificError(r.data?.message ?? r.data?.problem?.message ?? `${type} failed (HTTP ${r.status})`) };
  }
  const taskId: string = r.data?.data?.task_id ?? r.data?.task_id ?? r.data?.data?.id ?? r.data?.id;
  if (!taskId) return { url: null, taskId: null, error: `No task_id returned from ${type}` };

  const poll = await pollMagnificTask(`${pollBase}/${taskId}`, apiKey, 150);
  return { url: poll.url, taskId, error: poll.error };
}

export interface MagnificVideoShot {
  prompt: string;
  duration: number;
}

export interface MagnificVideoOptions {
  model?: string;
  prompt: string;
  image_url?: string;
  end_image_url?: string;
  reference_images?: string[];
  reference_video_url?: string;
  shot_mode?: 'single' | 'multi';
  shots?: MagnificVideoShot[];
  exclude_music?: boolean;
  scene_source?: 'video' | 'image';
  aspect_ratio?: string;
  duration?: string | number;
  resolution?: '480p' | '720p' | '1080p' | '1440p' | '2160p' | '4k';
  fps?: 25 | 50;
  generate_audio?: boolean;
  negative_prompt?: string;
  cfg_scale?: number;
}

export async function magnificGenerateVideo(
  opts: MagnificVideoOptions,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; taskId: string | null; model: string; error: string | null }> {
  const modelKey = opts.model && MAGNIFIC_VIDEO_MODELS[opts.model]
    ? opts.model
    : (opts.reference_video_url ? 'seedance-2-5' : opts.reference_images?.length ? 'kling-3-0-omni' : opts.image_url ? 'kling-v2-6-pro' : 'ltx-2-pro');
  const cfg = MAGNIFIC_VIDEO_MODELS[modelKey] ?? MAGNIFIC_VIDEO_MODELS['kling-v2-6-pro'];

  let finalPrompt = String(opts.prompt || '').trim().slice(0, 2500);
  // Magnific Academy Multi-Clip Rule: when exclude_music is true, explicitly append "no music"
  // so multi-clip sequences generate synchronized dialogue/foley without clashing soundtracks.
  if (opts.exclude_music && !/\bno music\b/i.test(finalPrompt)) {
    finalPrompt = `${finalPrompt.replace(/[.\s]+$/, '')}. No music.`;
  }

  const body: Record<string, any> = {
    prompt: finalPrompt,
  };

  if (modelKey === 'ltx-2-pro') {
    body.resolution = opts.resolution && ['1080p', '1440p', '2160p'].includes(opts.resolution) ? opts.resolution : '1080p';
    const durNum = Number(opts.duration) || 6;
    body.duration = [6, 8, 10].includes(durNum) ? durNum : 6;
    body.fps = opts.fps === 50 ? 50 : 25;
    if (opts.generate_audio != null) body.generate_audio = Boolean(opts.generate_audio);
  } else if (modelKey === 'seedance-2-5' || modelKey === 'seedance-2-0') {
    // Seedance 2.5 supports up to 30s (15s recommended chunks), 480p/720p/1080p/4k, up to 50 reference_images, start/end images, and 3D motion transfer
    const durNum = Math.min(30, Math.max(3, Number(opts.duration) || 15));
    body.duration = String(durNum);
    body.resolution = opts.resolution && ['480p', '720p', '1080p', '4k', '2160p'].includes(opts.resolution) ? opts.resolution : '1080p';
    if (opts.aspect_ratio) body.aspect_ratio = REVERSE_ASPECT_RATIO_MAP[opts.aspect_ratio] ?? opts.aspect_ratio;
    if (opts.generate_audio != null) body.generate_audio = Boolean(opts.generate_audio);
    if (opts.image_url) body.image = opts.image_url;
    if (opts.end_image_url) body.end_image = opts.end_image_url;
    if (Array.isArray(opts.reference_images) && opts.reference_images.length > 0) {
      body.reference_images = opts.reference_images.slice(0, 50);
    }
    if (opts.reference_video_url) body.reference_video = opts.reference_video_url;
  } else if (modelKey === 'kling-motion') {
    // Kling 2.6 Motion Control: 720p-1080p max, transfers biomechanics from reference_video onto start image
    body.resolution = opts.resolution === '720p' ? '720p' : '1080p';
    if (opts.image_url) body.image = opts.image_url;
    if (opts.reference_video_url) body.reference_video = opts.reference_video_url;
    if (opts.scene_source) body.scene_source = opts.scene_source;
  } else if (modelKey === 'kling-3-0' || modelKey === 'kling-3-pro' || modelKey === 'kling-3-0-omni') {
    // Kling 3.0 & Kling 3.0 Omni: up to 15s, supports Single-Shot or Multi-Shot (up to 6 shots, <=512 chars per shot, no end_image in multi-shot)
    const isMultiShot = opts.shot_mode === 'multi' || (Array.isArray(opts.shots) && opts.shots.length > 0);
    if (isMultiShot && Array.isArray(opts.shots) && opts.shots.length > 0) {
      body.shot_mode = 'multi';
      body.shots = opts.shots.slice(0, 6).map((s) => ({
        prompt: String(s.prompt || '').trim().slice(0, 512),
        duration: Math.max(1, Math.min(15, Number(s.duration) || 3)),
      }));
      const totalDur = body.shots.reduce((acc: number, s: { duration: number }) => acc + s.duration, 0);
      body.duration = String(Math.min(15, totalDur));
    } else {
      body.duration = String(Math.min(15, Math.max(3, Number(opts.duration) || 5)));
      if (opts.end_image_url) body.end_image = opts.end_image_url;
    }
    if (opts.aspect_ratio) body.aspect_ratio = REVERSE_ASPECT_RATIO_MAP[opts.aspect_ratio] ?? opts.aspect_ratio;
    if (opts.resolution) body.resolution = opts.resolution;
    if (opts.generate_audio != null) body.generate_audio = Boolean(opts.generate_audio);
    if (opts.image_url) body.image = opts.image_url;
    if (Array.isArray(opts.reference_images) && opts.reference_images.length > 0) {
      body.reference_images = opts.reference_images.slice(0, 10);
    }
    if (opts.reference_video_url) body.reference_video = opts.reference_video_url;
  } else if (modelKey.startsWith('kling-')) {
    body.duration = String(opts.duration === 10 || opts.duration === '10' ? '10' : '5');
    if (opts.aspect_ratio) body.aspect_ratio = REVERSE_ASPECT_RATIO_MAP[opts.aspect_ratio] ?? opts.aspect_ratio;
    if (opts.negative_prompt) body.negative_prompt = opts.negative_prompt;
    if (opts.cfg_scale != null) body.cfg_scale = opts.cfg_scale;
    if (opts.generate_audio != null) body.generate_audio = Boolean(opts.generate_audio);
    if (opts.image_url) body.image = opts.image_url;
    if (opts.end_image_url) body.image_tail = opts.end_image_url;
  } else {
    if (opts.image_url) {
      body.image = opts.image_url;
      body.image_url = opts.image_url;
    }
    if (opts.duration) body.duration = String(opts.duration);
    if (opts.aspect_ratio) body.aspect_ratio = REVERSE_ASPECT_RATIO_MAP[opts.aspect_ratio] ?? opts.aspect_ratio;
  }

  const submitResp = await magnificPost(cfg.endpoint, body, apiKey);
  logger.info(`[Magnific Video] ${modelKey} ${cfg.endpoint} → HTTP ${submitResp.status}`, JSON.stringify(submitResp.data)?.slice(0, 300));
  if (submitResp.status >= 400) {
    const isHtml = typeof submitResp.data === 'string' && submitResp.data.trimStart().startsWith('<');
    const msg = isHtml
      ? `Video generation service blocked (HTTP ${submitResp.status})`
      : (submitResp.data?.message ?? submitResp.data?.problem?.message ?? submitResp.data?.error ?? JSON.stringify(submitResp.data));
    return { url: null, taskId: null, model: modelKey, error: sanitizeMagnificError(`HTTP ${submitResp.status}: ${msg}`) };
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
  if (!taskId) return { url: null, taskId: null, model: modelKey, error: 'No task_id in Magnific video response' };

  const poll = await pollMagnificTask(cfg.pollPath(taskId), apiKey, 240, onProgress);
  return { url: poll.url, taskId, model: modelKey, error: poll.error };
}

export interface MagnificLipSyncOptions {
  image_url: string;
  audio_url: string;
  prompt?: string;
  resolution?: '720p' | '1080p';
  turbo_mode?: boolean;
  webhook_url?: string;
}

/**
 * Generate a talking-avatar / lip-sync video driven by audio using Magnific OmniHuman 1.5
 * (POST /v1/ai/video/omni-human-1-5).
 */
export async function magnificLipSync(
  opts: MagnificLipSyncOptions,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; taskId: string | null; error: string | null }> {
  if (!opts.image_url?.trim() || !opts.audio_url?.trim()) {
    return { url: null, taskId: null, error: 'Both image_url (human figure) and audio_url (voiceover/audio) are required for OmniHuman 1.5 lip-sync' };
  }
  const body: Record<string, unknown> = {
    image_url: opts.image_url.trim(),
    audio_url: opts.audio_url.trim(),
    resolution: opts.resolution === '720p' ? '720p' : '1080p',
    turbo_mode: Boolean(opts.turbo_mode),
  };
  if (opts.prompt?.trim()) body.prompt = opts.prompt.trim().slice(0, 2000);
  if (opts.webhook_url) body.webhook_url = opts.webhook_url;

  const submitResp = await magnificPost('/v1/ai/video/omni-human-1-5', body, apiKey);
  logger.info(`[Magnific LipSync] OmniHuman 1.5 → HTTP ${submitResp.status}`, JSON.stringify(submitResp.data)?.slice(0, 300));
  if (submitResp.status >= 400) {
    const msg = submitResp.data?.message ?? submitResp.data?.problem?.message ?? submitResp.data?.error ?? `HTTP ${submitResp.status}`;
    return { url: null, taskId: null, error: sanitizeMagnificError(`OmniHuman 1.5 Lip Sync error: ${msg}`) };
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
  if (!taskId) return { url: null, taskId: null, error: 'No task_id returned from OmniHuman 1.5' };

  const poll = await pollMagnificTask(`/v1/ai/video/omni-human-1-5/${taskId}`, apiKey, 240, onProgress);
  return { url: poll.url, taskId, error: poll.error };
}

export interface MagnificAudioOptions {
  type: 'sound-effects' | 'sfx' | 'music' | 'music-generation' | 'audio-isolation' | 'isolate';
  text?: string;
  prompt?: string;
  description?: string;
  duration_seconds?: number;
  loop?: boolean;
  prompt_influence?: number;
  audio?: string;
  video?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  sample_fps?: number;
  reranking_candidates?: number;
  predict_spans?: boolean;
  webhook_url?: string;
}

/**
 * Generate sound effects, music, or isolate target sounds from audio/video via Magnific Audio APIs:
 * - POST /v1/ai/sound-effects
 * - POST /v1/ai/music-generation
 * - POST /v1/ai/audio-isolation (SAM Audio)
 */
export async function magnificGenerateAudio(
  opts: MagnificAudioOptions,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; taskId: string | null; type: string; error: string | null }> {
  const kind = opts.type === 'sfx' ? 'sound-effects'
    : opts.type === 'music' ? 'music-generation'
    : opts.type === 'isolate' ? 'audio-isolation'
    : opts.type;

  let endpoint = '';
  const body: Record<string, unknown> = {};

  if (kind === 'sound-effects') {
    endpoint = '/v1/ai/sound-effects';
    const text = String(opts.text || opts.prompt || opts.description || '').trim().slice(0, 2500);
    if (!text) return { url: null, taskId: null, type: kind, error: 'text/prompt is required for sound-effects' };
    body.text = text;
    body.duration_seconds = Math.min(22, Math.max(0.5, Number(opts.duration_seconds) || 5));
    if (opts.loop != null) body.loop = Boolean(opts.loop);
    if (opts.prompt_influence != null) body.prompt_influence = Math.min(1, Math.max(0, Number(opts.prompt_influence)));
  } else if (kind === 'music-generation') {
    endpoint = '/v1/ai/music-generation';
    const prompt = String(opts.prompt || opts.text || opts.description || '').trim().slice(0, 2500);
    if (!prompt) return { url: null, taskId: null, type: kind, error: 'prompt is required for music-generation' };
    body.prompt = prompt;
    body.text = prompt;
    if (opts.duration_seconds != null) body.duration_seconds = Math.min(180, Math.max(5, Number(opts.duration_seconds) || 30));
  } else if (kind === 'audio-isolation') {
    endpoint = '/v1/ai/audio-isolation';
    const description = String(opts.description || opts.prompt || opts.text || '').trim().slice(0, 2500);
    if (!description) return { url: null, taskId: null, type: kind, error: 'description of the sound to isolate is required for audio-isolation' };
    if (!opts.audio && !opts.video) return { url: null, taskId: null, type: kind, error: 'Either audio or video URL/base64 is required for audio-isolation' };
    body.description = description;
    if (opts.audio) body.audio = opts.audio;
    else if (opts.video) body.video = opts.video;
    if (opts.x1 != null) body.x1 = opts.x1;
    if (opts.y1 != null) body.y1 = opts.y1;
    if (opts.x2 != null) body.x2 = opts.x2;
    if (opts.y2 != null) body.y2 = opts.y2;
    if (opts.sample_fps != null) body.sample_fps = opts.sample_fps;
    if (opts.reranking_candidates != null) body.reranking_candidates = opts.reranking_candidates;
    if (opts.predict_spans != null) body.predict_spans = Boolean(opts.predict_spans);
  } else {
    return { url: null, taskId: null, type: kind, error: `Unsupported audio type: ${opts.type}` };
  }

  if (opts.webhook_url) body.webhook_url = opts.webhook_url;

  const submitResp = await magnificPost(endpoint, body, apiKey);
  logger.info(`[Magnific Audio] ${kind} ${endpoint} → HTTP ${submitResp.status}`, JSON.stringify(submitResp.data)?.slice(0, 300));
  if (submitResp.status >= 400) {
    const msg = submitResp.data?.message ?? submitResp.data?.problem?.message ?? submitResp.data?.error ?? `HTTP ${submitResp.status}`;
    return { url: null, taskId: null, type: kind, error: sanitizeMagnificError(`Magnific ${kind} error: ${msg}`) };
  }

  const taskId: string = submitResp.data?.data?.task_id ?? submitResp.data?.task_id ?? submitResp.data?.data?.id ?? submitResp.data?.id;
  if (!taskId) return { url: null, taskId: null, type: kind, error: `No task_id returned from ${kind}` };

  const poll = await pollMagnificTask(`${endpoint}/${taskId}`, apiKey, 150, onProgress);
  return { url: poll.url, taskId, type: kind, error: poll.error };
}

export interface MagnificSpaceNode {
  id: string;
  type: 'magnific-one' | 'image' | 'edit' | 'video' | 'lip-sync' | 'audio';
  label?: string;
  params: Record<string, any>;
  inputsFrom?: string[];
}

export interface MagnificSpaceOrFlowRequest {
  action: 'simulate_cost' | 'create_space' | 'run_space' | 'create_flow' | 'run_flow' | 'mcp_tool';
  name?: string;
  description?: string;
  goal?: string;
  nodes?: MagnificSpaceNode[];
  flow_id?: string;
  space_id?: string;
  mcp_tool_name?: string;
  mcp_tool_args?: Record<string, unknown>;
  reference_images?: string[];
  aspect_ratio?: string;
}

/**
 * Orchestrates Magnific Spaces and Flows:
 * 1. Can estimate credit cost pre-flight (`simulate_cost`) before running nodes.
 * 2. Can invoke native Magnific MCP tools (`spaces_*`, `flows_*`, `simulate_*`) if connected.
 * 3. Executes multi-node Magnific Space/Flow graphs deterministically over the Magnific API
 *    (passing upstream node output URLs as `reference_images`, `image_url`, or `audio_url` into downstream nodes).
 */
export async function magnificExecuteSpaceOrFlow(
  req: MagnificSpaceOrFlowRequest,
  apiKey: string,
  mcpCaller?: (toolName: string, args: Record<string, unknown>) => Promise<{ ok: boolean; payload: unknown; error?: string }>
): Promise<{
  success: boolean;
  action: string;
  estimated_credits?: number;
  space_id?: string;
  flow_id?: string;
  node_results?: Array<{ id: string; type: string; status: string; url?: string | null; urls?: string[]; error?: string | null }>;
  final_url?: string | null;
  mcp_result?: unknown;
  error?: string;
}> {
  const defaultNodes: MagnificSpaceNode[] = Array.isArray(req.nodes) && req.nodes.length > 0
    ? req.nodes
    : [
        {
          id: 'node_draft_sheet',
          type: 'magnific-one',
          label: 'Magnific One 16-Tile Draft Contact Sheet',
          params: {
            prompt: req.goal || req.description || 'Editorial luxury brand visual campaign',
            mode: 'draft',
            tiles: 16,
            aspect_ratio: req.aspect_ratio || '16:9',
            reference_images: req.reference_images,
          },
        },
        {
          id: 'node_hero_4k',
          type: 'magnific-one',
          label: 'Magnific One 4K Quality Hero Render',
          inputsFrom: ['node_draft_sheet'],
          params: {
            prompt: req.goal || req.description || 'Editorial luxury brand visual campaign',
            mode: 'quality',
            quality: 'high',
            resolution: '4k',
            aspect_ratio: req.aspect_ratio || '16:9',
          },
        },
      ];

  // Cost simulation (free pre-flight estimation)
  const estimateNodeCredits = (n: MagnificSpaceNode): number => {
    if (n.type === 'magnific-one') return n.params?.mode === 'draft' ? 4 : (n.params?.resolution === '4k' ? 8 : 6);
    if (n.type === 'image') return MAGNIFIC_IMAGE_MODELS[n.params?.model || 'magnific-one']?.credits ?? 5;
    if (n.type === 'edit') return n.params?.type === 'remove-background' ? 1 : 5;
    if (n.type === 'video') return MAGNIFIC_VIDEO_MODELS[n.params?.model || 'kling-v2-6-pro']?.credits ?? 25;
    if (n.type === 'lip-sync') return 30;
    if (n.type === 'audio') return 5;
    return 5;
  };
  const estimatedCredits = defaultNodes.reduce((sum, n) => sum + estimateNodeCredits(n), 0);

  if (req.action === 'simulate_cost') {
    if (mcpCaller) {
      const mcpSim = await mcpCaller('simulate_cost', { nodes: defaultNodes }).catch(() => null);
      if (mcpSim?.ok && mcpSim.payload) {
        return { success: true, action: 'simulate_cost', estimated_credits: estimatedCredits, mcp_result: mcpSim.payload };
      }
    }
    return {
      success: true,
      action: 'simulate_cost',
      estimated_credits: estimatedCredits,
      node_results: defaultNodes.map((n) => ({ id: n.id, type: n.type, status: `estimated (${estimateNodeCredits(n)} credits)` })),
    };
  }

  if (req.action === 'mcp_tool' && req.mcp_tool_name && mcpCaller) {
    const res = await mcpCaller(req.mcp_tool_name, req.mcp_tool_args ?? {});
    return { success: res.ok, action: 'mcp_tool', mcp_result: res.payload, error: res.error };
  }

  const spaceId = req.space_id || `space_${randomUUID().slice(0, 8)}`;
  const flowId = req.flow_id || (req.action === 'create_flow' || req.action === 'run_flow' ? `flow_${randomUUID().slice(0, 8)}` : undefined);

  if (req.action === 'create_space' || req.action === 'create_flow') {
    return {
      success: true,
      action: req.action,
      space_id: spaceId,
      flow_id: flowId,
      estimated_credits: estimatedCredits,
      node_results: defaultNodes.map((n) => ({ id: n.id, type: n.type, status: 'configured' })),
    };
  }

  // Execute the Space or Flow graph left-to-right
  if (!apiKey) {
    return { success: false, action: req.action, error: 'Magnific API key not configured' };
  }

  const outputsById = new Map<string, { url: string | null; urls: string[] }>();
  const nodeResults: Array<{ id: string; type: string; status: string; url?: string | null; urls?: string[]; error?: string | null }> = [];
  let lastUrl: string | null = null;

  for (const node of defaultNodes) {
    const upstreamUrls: string[] = [];
    for (const upId of node.inputsFrom ?? []) {
      const up = outputsById.get(upId);
      if (up?.url) upstreamUrls.push(up.url);
    }

    if (node.type === 'magnific-one') {
      const refs = [
        ...(Array.isArray(node.params?.reference_images) ? node.params.reference_images : []),
        ...upstreamUrls,
      ].filter(Boolean);
      const r = await magnificOneGenerate(
        {
          prompt: node.params?.prompt || req.goal || 'Brand visual',
          mode: node.params?.mode || 'quality',
          quality: node.params?.quality || 'high',
          resolution: node.params?.resolution || '2k',
          aspect_ratio: node.params?.aspect_ratio || req.aspect_ratio || '1:1',
          tiles: node.params?.tiles,
          reference_images: refs.length ? refs : undefined,
        },
        apiKey
      );
      outputsById.set(node.id, { url: r.url, urls: r.urls });
      if (r.url) lastUrl = r.url;
      nodeResults.push({ id: node.id, type: node.type, status: r.error ? 'failed' : 'completed', url: r.url, urls: r.urls, error: r.error });
      if (r.error) break;
    } else if (node.type === 'image') {
      const r = await magnificGenerateImage(
        node.params?.model || 'magnific-one',
        node.params?.prompt || req.goal || 'Brand visual',
        node.params?.aspect_ratio || req.aspect_ratio || '1:1',
        apiKey
      );
      outputsById.set(node.id, { url: r.url, urls: r.urls ?? (r.url ? [r.url] : []) });
      if (r.url) lastUrl = r.url;
      nodeResults.push({ id: node.id, type: node.type, status: r.error ? 'failed' : 'completed', url: r.url, urls: r.urls, error: r.error });
      if (r.error) break;
    } else if (node.type === 'edit') {
      const inputImg = node.params?.image || node.params?.image_url || upstreamUrls[0] || lastUrl;
      const r = await magnificEditImage({ ...node.params, type: node.params?.type || 'upscale', image_url: inputImg }, apiKey);
      outputsById.set(node.id, { url: r.url, urls: r.url ? [r.url] : [] });
      if (r.url) lastUrl = r.url;
      nodeResults.push({ id: node.id, type: node.type, status: r.error ? 'failed' : 'completed', url: r.url, error: r.error });
      if (r.error) break;
    } else if (node.type === 'video') {
      const inputImg = node.params?.image_url || upstreamUrls[0];
      const r = await magnificGenerateVideo(
        {
          model: node.params?.model || (inputImg ? 'kling-v2-6-pro' : 'ltx-2-pro'),
          prompt: node.params?.prompt || req.goal || 'Subtle cinematic camera motion',
          image_url: inputImg,
          duration: node.params?.duration,
          resolution: node.params?.resolution,
          aspect_ratio: node.params?.aspect_ratio || req.aspect_ratio,
          generate_audio: node.params?.generate_audio,
        },
        apiKey
      );
      outputsById.set(node.id, { url: r.url, urls: r.url ? [r.url] : [] });
      if (r.url) lastUrl = r.url;
      nodeResults.push({ id: node.id, type: node.type, status: r.error ? 'failed' : 'completed', url: r.url, error: r.error });
      if (r.error) break;
    } else if (node.type === 'lip-sync') {
      const imgUrl = node.params?.image_url || upstreamUrls[0];
      const audUrl = node.params?.audio_url || upstreamUrls[1];
      const r = await magnificLipSync(
        {
          image_url: imgUrl,
          audio_url: audUrl,
          prompt: node.params?.prompt,
          resolution: node.params?.resolution || '1080p',
          turbo_mode: node.params?.turbo_mode,
        },
        apiKey
      );
      outputsById.set(node.id, { url: r.url, urls: r.url ? [r.url] : [] });
      if (r.url) lastUrl = r.url;
      nodeResults.push({ id: node.id, type: node.type, status: r.error ? 'failed' : 'completed', url: r.url, error: r.error });
      if (r.error) break;
    } else if (node.type === 'audio') {
      const r = await magnificGenerateAudio(
        {
          type: node.params?.type || 'sound-effects',
          text: node.params?.text || node.params?.prompt || req.goal,
          prompt: node.params?.prompt || req.goal,
          description: node.params?.description,
          duration_seconds: node.params?.duration_seconds,
          loop: node.params?.loop,
          audio: node.params?.audio || upstreamUrls[0],
          video: node.params?.video,
        },
        apiKey
      );
      outputsById.set(node.id, { url: r.url, urls: r.url ? [r.url] : [] });
      if (r.url) lastUrl = r.url;
      nodeResults.push({ id: node.id, type: node.type, status: r.error ? 'failed' : 'completed', url: r.url, error: r.error });
      if (r.error) break;
    }
  }

  const anyFailed = nodeResults.some((n) => n.status === 'failed');
  return {
    success: !anyFailed && Boolean(lastUrl),
    action: req.action,
    space_id: spaceId,
    flow_id: flowId,
    estimated_credits: estimatedCredits,
    node_results: nodeResults,
    final_url: lastUrl,
    error: anyFailed ? nodeResults.find((n) => n.error)?.error ?? 'Space/Flow execution failed' : undefined,
  };
}

export async function freepikGenerateImage(
  _model: string,
  prompt: string,
  aspectRatio: string,
  apiKey: string,
  onProgress?: (status: string) => void
): Promise<{ url: string | null; error: string | null }> {
  const freepikHeaders = proxyHeaders({
    'x-freepik-api-key': apiKey,
    'Content-Type': 'application/json',
    'Origin': 'https://www.freepik.com',
    'Referer': 'https://www.freepik.com/',
  });
  const submitResp = await axios.post(
    `${FREEPIK_BASE}/v1/ai/mystic`,
    { prompt, negative_prompt: '', image: { size: aspectRatio }, output_format: 'jpeg', num_images: 1, filter_nsfw: true },
    { headers: freepikHeaders, validateStatus: () => true, timeout: 20000 }
  );
  if (submitResp.status >= 400) {
    const isHtml = typeof submitResp.data === 'string' && submitResp.data.trimStart().startsWith('<');
    return { url: null, error: isHtml ? `Service blocked (HTTP ${submitResp.status})` : (submitResp.data?.message ?? `Freepik mystic error ${submitResp.status}`) };
  }
  const taskId = submitResp.data?.data?.task_id ?? submitResp.data?.task_id;
  if (!taskId) return { url: null, error: 'No task_id returned from Freepik mystic' };

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const pollResp = await axios.get(`${FREEPIK_BASE}/v1/ai/mystic/${taskId}`, {
      headers: proxyHeaders({
        'x-freepik-api-key': apiKey,
        'Origin': 'https://www.freepik.com',
        'Referer': 'https://www.freepik.com/',
      }),
      validateStatus: () => true,
      timeout: 10000,
    });
    const data = pollResp.data?.data ?? pollResp.data;
    const status: string = data?.status ?? '';
    onProgress?.(status);
    if (status === 'COMPLETED') {
      const imgs: string[] = data?.generated ?? [];
      return { url: imgs[0] ?? null, error: imgs[0] ? null : 'No image URL in Freepik response' };
    }
    if (status === 'FAILED') return { url: null, error: data?.error ?? 'Freepik generation failed' };
  }
  return { url: null, error: 'Timeout: Freepik generation took too long' };
}

// ── Route factory ─────────────────────────────────────────────────────────────

export function registerMagnificRoutes({ requireAuth, requireAdmin, hasDatabase, pool }: MagnificDeps): Router {
  const router = express.Router();

  // GET /api/admin/magnific/config
  router.get('/admin/magnific/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const r = await pool!.query(`SELECT config FROM platform_configs WHERE platform='magnific' LIMIT 1`);
      const key: string = decryptPlatformConfig(r.rows[0]?.config)?.apiKey ?? '';
      const masked = key.length > 8 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : (key ? '****' : '');
      return res.json({ success: true, hasKey: !!key, maskedKey: masked });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/admin/magnific/config
  router.put('/admin/magnific/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at)
         VALUES ('magnific', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify(encryptPlatformConfig({ apiKey: apiKey.trim() }))]
      );
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'magnific' });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/magnific/test
  router.get('/admin/magnific/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ success: false, error: 'No API key configured' });
    try {
      const reqBody = { prompt: 'a red apple on a white table', image: { size: 'square_1_1' }, num_images: 1, filter_nsfw: true };
      const r = await axios.post(
        `${MAGNIFIC_BASE}/v1/ai/text-to-image`,
        reqBody,
        { headers: { 'x-magnific-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 30000 }
      );
      const keyHint = apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '(short key)';
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: `Invalid API key (HTTP ${r.status})`, keyHint, magnific_response: r.data });
      }
      if (r.status >= 400) {
        return res.json({ success: false, error: `Magnific returned HTTP ${r.status}`, keyHint, magnific_response: r.data });
      }
      const hasImage = !!(r.data?.data?.[0]?.base64);
      return res.json({ success: true, status: r.status, keyHint, has_image: hasImage, magnific_response: hasImage ? '(base64 omitted)' : r.data });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/admin/magnific/generations
  router.get('/admin/magnific/generations', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const typeFilter = typeof req.query.type === 'string' && req.query.type !== 'all' ? req.query.type : null;
      const { rows } = await pool!.query(
        `SELECT mg.*, u.email AS user_email, u.full_name AS user_full_name, u.username AS user_username, u.avatar_url AS user_avatar, df.id AS discover_id
         FROM magnific_generations mg
         LEFT JOIN users u ON u.id = mg.user_id
         LEFT JOIN discover_feed df ON df.generation_id = mg.id
         WHERE mg.status = 'completed' AND mg.result_url IS NOT NULL
           AND ($1::text IS NULL OR mg.type = $1)
         ORDER BY mg.created_at DESC LIMIT 300`,
        [typeFilter]
      );
      return res.json({ success: true, generations: rows });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/freepik/config
  router.get('/admin/freepik/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      // Mirror getFreepikApiKey resolution: DB config first, env fallback
      const r = await pool!.query(`SELECT config FROM platform_configs WHERE platform='freepik' LIMIT 1`);
      const key: string = decryptPlatformConfig(r.rows[0]?.config)?.apiKey ?? '';
      if (key) {
        const masked = key.length > 8 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : '****';
        return res.json({ success: true, hasKey: true, maskedKey: masked, source: 'db' });
      }
      const envKey: string = process.env.FREEPIK_API_KEY ?? '';
      const masked = envKey.length > 8 ? `${'*'.repeat(envKey.length - 4)}${envKey.slice(-4)}` : (envKey ? '****' : '');
      return res.json({ success: true, hasKey: !!envKey, maskedKey: masked, source: envKey ? 'env' : 'db' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/admin/freepik/config
  router.put('/admin/freepik/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at)
         VALUES ('freepik', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify(encryptPlatformConfig({ apiKey: apiKey.trim() }))]
      );
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'freepik' });
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/freepik/test
  router.get('/admin/freepik/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const apiKey = await getFreepikApiKey(pool);
    if (!apiKey) return res.status(400).json({ success: false, error: 'No API key configured — set up Magnific in Admin.' });
    try {
      const keyHint = apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '(short key)';
      const r = await axios.post(
        `${FREEPIK_BASE}/v1/ai/mystic`,
        { prompt: 'a red apple', negative_prompt: '', image: { size: 'square_1_1' }, output_format: 'jpeg', num_images: 1 },
        { headers: { 'x-freepik-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 20000 }
      );
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: `Invalid API key (HTTP ${r.status})`, keyHint });
      }
      if (r.status >= 400) {
        return res.json({ success: false, error: `Freepik returned HTTP ${r.status}`, keyHint, response: r.data });
      }
      return res.json({ success: true, status: r.status, keyHint, note: 'Key accepted — mystic task submitted' });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/magnific/models — list all Magnific models, capabilities, and credit costs
  router.get('/magnific/models', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return res.json({
      success: true,
      image_models: Object.entries(MAGNIFIC_IMAGE_MODELS).map(([id, cfg]) => ({
        id,
        label: cfg.label || id,
        endpoint: cfg.endpoint,
        credits: cfg.credits,
      })),
      video_models: Object.entries(MAGNIFIC_VIDEO_MODELS).map(([id, cfg]) => ({
        id,
        label: cfg.label,
        endpoint: cfg.endpoint,
        credits: cfg.credits,
        supportsImageInput: Boolean((cfg as any).supportsI2V ?? (cfg as any).supportsImageInput ?? true),
        supportsTextInput: Boolean((cfg as any).supportsTextInput ?? true),
        supportsAudio: cfg.supportsAudio ?? false,
      })),
      edit_tools: [
        { id: 'upscale', label: 'Creative Upscaler (up to 16x)', credits: 5 },
        { id: 'upscale-precision', label: 'Precision Upscaler V2 (up to 16x)', credits: 5 },
        { id: 'relight', label: 'Image Relight', credits: 4 },
        { id: 'style-transfer', label: 'Image Style Transfer', credits: 5 },
        { id: 'remove-background', label: 'Remove Background', credits: 1 },
        { id: 'image-expand', label: 'Image Expand / Outpaint (Flux Pro)', credits: 5 },
        { id: 'seedream-edit', label: 'Seedream V4 Edit', credits: 5 },
      ],
      lipsync_models: [
        { id: 'omni-human-1-5', label: 'OmniHuman 1.5 (Audio-Driven Lip Sync & Full-Body Avatar)', credits: 30 },
      ],
      audio_tools: [
        { id: 'sound-effects', label: 'Sound Effects (SFX up to 22s)', credits: 4 },
        { id: 'music-generation', label: 'AI Music Generation', credits: 6 },
        { id: 'audio-isolation', label: 'SAM Audio Sound Isolation', credits: 5 },
      ],
    });
  });

  // GET /api/magnific/task/:id
  router.get('/magnific/task/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows } = await pool!.query(
        `SELECT status, result_url, error, type, model, params, created_at FROM magnific_generations WHERE id=$1 AND user_id=$2 LIMIT 1`,
        [req.params.id, auth.userId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      return res.json({ success: true, ...rows[0] });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/improve-prompt
  router.post('/magnific/improve-prompt', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured' });
    try {
      const r = await axios.post(
        `${MAGNIFIC_BASE}/v1/ai/improve-prompt`,
        { prompt: prompt.trim() },
        { headers: { 'x-magnific-api-key': apiKey, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 12000 }
      );
      const improved: string = r.data?.data?.prompt ?? r.data?.prompt ?? '';
      if (!improved || r.status >= 400) {
        return res.status(400).json({ error: r.data?.message ?? 'Failed to improve prompt' });
      }
      return res.json({ success: true, prompt: improved });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/magnific-one — Magnific One flagship art-directed generation (draft 8/16 tiles or quality 1k/2k/4k + up to 10 reference images)
  router.post('/magnific/magnific-one', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { prompt, mode, quality, resolution, aspect_ratio, tiles, reference_images, webhook_url } = req.body as MagnificOneOptions;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

    const creditCost = mode === 'draft' ? 4 : (resolution === '4k' ? 8 : 6);
    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'image', 'magnific-one', $3, $4, 'pending')`,
      [genId, auth.userId, prompt.trim(), JSON.stringify({ mode: mode || 'quality', quality, resolution, aspect_ratio, tiles, reference_count: reference_images?.length || 0 })]
    ).catch(() => undefined);

    try {
      const result = await magnificOneGenerate(
        { prompt, mode, quality, resolution, aspect_ratio, tiles, reference_images, webhook_url },
        apiKey
      );
      if (result.error || !result.url) {
        const errMsg = result.error || 'Magnific One returned no image URL';
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }

      await pool!.query(
        `UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`,
        [result.taskId, result.url, genId]
      ).catch(() => undefined);

      await chargeAICredits(auth.userId, creditCost, `magnific_one_${mode || 'quality'}`, { gen_id: genId, resolution: resolution || '2k' });

      return res.json({
        success: true,
        url: result.url,
        urls: result.urls,
        task_id: result.taskId,
        gen_id: genId,
        credits_used: creditCost,
      });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/generate-image — Unified image generation across all Magnific models (magnific-one, mystic, flux-kontext-pro, seedream-v4-5, etc.)
  router.post('/magnific/generate-image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { model = 'magnific-one', prompt, aspect_ratio = '1:1', mode, quality, resolution, tiles, reference_images } = req.body as Record<string, any>;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

    const modelKey = MAGNIFIC_IMAGE_MODELS[model] ? model : 'magnific-one';
    const creditCost = MAGNIFIC_IMAGE_MODELS[modelKey]?.credits ?? 5;

    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'image', $3, $4, $5, 'pending')`,
      [genId, auth.userId, modelKey, prompt.trim(), JSON.stringify({ aspect_ratio, mode, quality, resolution })]
    ).catch(() => undefined);

    try {
      const result = await magnificGenerateImage(
        modelKey,
        prompt.trim(),
        aspect_ratio,
        apiKey,
        undefined,
        { mode, quality, resolution, tiles, reference_images }
      );
      if (result.error || !result.url) {
        const errMsg = result.error || 'Image generation returned no URL';
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }

      await pool!.query(
        `UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`,
        [result.url, genId]
      ).catch(() => undefined);

      await chargeAICredits(auth.userId, creditCost, `magnific_image_${modelKey}`, { gen_id: genId });

      return res.json({
        success: true,
        url: result.url,
        urls: result.urls ?? [result.url],
        model: modelKey,
        gen_id: genId,
        credits_used: creditCost,
      });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/edit — image editing tools (upscale, upscale-precision, relight, style-transfer, remove-background, image-expand, seedream-edit)
  router.post('/magnific/edit', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const body = req.body as MagnificEditOptions;
    const { type } = body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const editCreditCosts: Record<string, number> = {
      'upscale': 5,
      'upscale-precision': 5,
      'relight': 4,
      'style-transfer': 5,
      'remove-background': 1,
      'image-expand': 5,
      'seedream-edit': 5,
    };
    const creditCost = editCreditCosts[type] ?? 5;

    const credRow = await pool!.query<{ credits: number }>(
      'SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]
    ).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [genId, auth.userId, type, type, body.prompt ?? '', JSON.stringify({ type, scale_factor: body.scale_factor, optimized_for: body.optimized_for, style: body.style })]
    ).catch(() => undefined);

    try {
      const editResult = await magnificEditImage(body, apiKey);
      if (editResult.error || !editResult.url) {
        const errMsg = editResult.error || 'No result URL returned';
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }

      await pool!.query(
        `UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`,
        [editResult.taskId, editResult.url, genId]
      ).catch(() => undefined);

      await chargeAICredits(auth.userId, creditCost, `image_edit_${type}`, { gen_id: genId });

      return res.json({ success: true, url: editResult.url, task_id: editResult.taskId, gen_id: genId, credits_used: creditCost });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/generate-video — Video generation across Kling 2.6 Pro, LTX 2 Pro, WAN 2.6, Hailuo 2.3, Runway Gen4, Seedance, PixVerse
  router.post('/magnific/generate-video', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const opts = req.body as MagnificVideoOptions;
    if (!opts.prompt?.trim() && !opts.image_url?.trim()) {
      return res.status(400).json({ error: 'prompt or image_url is required for video generation' });
    }

    const modelKey = opts.model && MAGNIFIC_VIDEO_MODELS[opts.model] ? opts.model : (opts.image_url ? 'kling-v2-6-pro' : 'ltx-2-pro');
    const creditCost = MAGNIFIC_VIDEO_MODELS[modelKey]?.credits ?? 25;

    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'video', $3, $4, $5, 'pending')`,
      [genId, auth.userId, modelKey, opts.prompt ?? '', JSON.stringify({ duration: opts.duration, resolution: opts.resolution, aspect_ratio: opts.aspect_ratio, generate_audio: opts.generate_audio })]
    ).catch(() => undefined);

    try {
      const result = await magnificGenerateVideo({ ...opts, model: modelKey }, apiKey);
      if (result.error || !result.url) {
        const errMsg = result.error || 'Video generation returned no URL';
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }

      await pool!.query(
        `UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`,
        [result.taskId, result.url, genId]
      ).catch(() => undefined);

      await chargeAICredits(auth.userId, creditCost, `magnific_video_${modelKey}`, { gen_id: genId });

      return res.json({
        success: true,
        url: result.url,
        task_id: result.taskId,
        model: result.model,
        gen_id: genId,
        credits_used: creditCost,
      });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/lip-sync — OmniHuman 1.5 audio-driven lip sync & talking avatar generation
  router.post('/magnific/lip-sync', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const opts = req.body as MagnificLipSyncOptions;
    if (!opts.image_url?.trim() || !opts.audio_url?.trim()) {
      return res.status(400).json({ error: 'image_url and audio_url are required for OmniHuman 1.5 lip-sync' });
    }

    const creditCost = 30;
    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'lip-sync', 'omni-human-1-5', $3, $4, 'pending')`,
      [genId, auth.userId, opts.prompt ?? 'OmniHuman 1.5 Lip Sync', JSON.stringify({ resolution: opts.resolution || '1080p', turbo_mode: opts.turbo_mode })]
    ).catch(() => undefined);

    try {
      const result = await magnificLipSync(opts, apiKey);
      if (result.error || !result.url) {
        const errMsg = result.error || 'OmniHuman 1.5 returned no video URL';
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }

      await pool!.query(
        `UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`,
        [result.taskId, result.url, genId]
      ).catch(() => undefined);

      await chargeAICredits(auth.userId, creditCost, 'magnific_lipsync_omnihuman', { gen_id: genId });

      return res.json({
        success: true,
        url: result.url,
        task_id: result.taskId,
        model: 'omni-human-1-5',
        gen_id: genId,
        credits_used: creditCost,
      });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/audio — Sound Effects, Music Generation, and SAM Audio Isolation
  router.post('/magnific/audio', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const opts = req.body as MagnificAudioOptions;
    if (!opts.type) return res.status(400).json({ error: 'type (sound-effects, music-generation, or audio-isolation) is required' });

    const creditCost = opts.type === 'music' || opts.type === 'music-generation' ? 6 : opts.type === 'audio-isolation' || opts.type === 'isolate' ? 5 : 4;
    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) {
      return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    }

    const apiKey = await getMagnificApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Magnific not configured — set up in Admin → Magnific AI.' });

    const genId = randomUUID();
    await pool!.query(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'audio', $3, $4, $5, 'pending')`,
      [genId, auth.userId, opts.type, opts.text || opts.prompt || opts.description || '', JSON.stringify({ duration_seconds: opts.duration_seconds, loop: opts.loop })]
    ).catch(() => undefined);

    try {
      const result = await magnificGenerateAudio(opts, apiKey);
      if (result.error || !result.url) {
        const errMsg = result.error || 'Magnific Audio returned no URL';
        await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
        return res.status(400).json({ error: errMsg });
      }

      await pool!.query(
        `UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`,
        [result.taskId, result.url, genId]
      ).catch(() => undefined);

      await chargeAICredits(auth.userId, creditCost, `magnific_audio_${result.type}`, { gen_id: genId });

      return res.json({
        success: true,
        url: result.url,
        task_id: result.taskId,
        type: result.type,
        gen_id: genId,
        credits_used: creditCost,
      });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/magnific/spaces & POST /api/magnific/flows — Multi-node Magnific Spaces & Flows + Pre-flight Cost Simulation + MCP bridge
  const handleSpacesOrFlows = async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const body = req.body as MagnificSpaceOrFlowRequest;
    const action = body.action || (req.path.endsWith('/flows') ? 'run_flow' : 'run_space');

    const apiKey = await getMagnificApiKey(pool);
    const mcpCaller = (toolName: string, toolArgs: Record<string, unknown>) =>
      callMagnificMcpTool(pool, toolName, toolArgs, (val: unknown) => {
        const dec = decryptPlatformConfig(val as any);
        return typeof dec === 'string' ? dec : (dec as any)?.value ?? '';
      });

    // Free pre-flight simulation or configuration actions do not deduct credits
    if (action === 'simulate_cost' || action === 'create_space' || action === 'create_flow') {
      const sim = await magnificExecuteSpaceOrFlow({ ...body, action }, apiKey, mcpCaller);
      return res.json(sim);
    }

    // For run_space / run_flow / mcp_tool, pre-check estimated credits first
    const simPreview = await magnificExecuteSpaceOrFlow({ ...body, action: 'simulate_cost' }, apiKey);
    const requiredCredits = simPreview.estimated_credits ?? 10;

    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < requiredCredits) {
      return res.status(402).json({ error: 'Insufficient credits for Space/Flow execution', credits: currentCredits, required: requiredCredits });
    }

    const result = await magnificExecuteSpaceOrFlow({ ...body, action }, apiKey, mcpCaller);
    if (!result.success) {
      return res.status(400).json(result);
    }

    if (result.final_url) {
      const genId = randomUUID();
      await pool!.query(
        `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, result_url, completed_at)
         VALUES ($1, $2, 'space', $3, $4, $5, 'completed', $6, NOW())`,
        [genId, auth.userId, action, body.goal || body.name || 'Magnific Space/Flow', JSON.stringify({ space_id: result.space_id, flow_id: result.flow_id, nodes: result.node_results }), result.final_url]
      ).catch(() => undefined);
    }

    await chargeAICredits(auth.userId, requiredCredits, `magnific_${action}`, { space_id: result.space_id, flow_id: result.flow_id });
    return res.json({ ...result, credits_used: requiredCredits });
  };

  router.post('/magnific/spaces', handleSpacesOrFlows);
  router.post('/magnific/flows', handleSpacesOrFlows);

  return router;
}
