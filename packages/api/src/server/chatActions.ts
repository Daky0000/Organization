import { randomUUID } from 'crypto';
import { MAGNIFIC_IMAGE_MODELS, MAGNIFIC_VIDEO_MODELS } from './magnificRoutes.ts';
import {
  ECONOMY_IMAGE_MODEL, bestSlot, seriesSlot, validTimeZone, FORMAT_LABEL, socialImageCredits, PLATFORM_LABEL, socialCopyCredits, socialVideoCredits, clampSlides, mediaPlan,
  normalizeFormat, normalizePlatform, postCredits, type SocialFormat, type SocialPlatform,
} from './socialFormats.ts';
import { creditsForMagnific, economyImageCharge, magnificAudioCost, magnificEditCost, magnificImageCost, magnificLipSyncCost, magnificOneCost, magnificVideoCost } from './aiPricing.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Chat sessions (history) and credit-gated actions.
//
// Sessions: the chat's conversations, saved per user so they survive a reload
// and can be reopened from the history list.
//
// Actions: any tool that spends credits is not run when the model calls it.
// It is priced first and parked as a pending action; the chat shows the
// estimate with Proceed / Cancel, and only Proceed runs it.
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Most posts in one batch: planned in parts of 10 and made three at a time. */
export const BATCH_MAX_POSTS = 60;

let ensured: Promise<void> | null = null;

export function ensureChatTables(query: Query): Promise<void> {
  ensured ??= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New chat',
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions(user_id, updated_at DESC)`);
    await query(`
      CREATE TABLE IF NOT EXISTS user_custom_instructions (
        user_id TEXT PRIMARY KEY,
        instructions TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS social_platform TEXT`).catch(() => undefined);
    await query(`ALTER TABLE user_custom_instructions ADD COLUMN IF NOT EXISTS media_mode TEXT NOT NULL DEFAULT 'economy'`).catch(() => undefined);
    await query(`
      CREATE TABLE IF NOT EXISTS chat_pending_actions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args JSONB NOT NULL,
        credits INTEGER NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

export interface CreditEstimate { credits: number; label: string; lines: string[] }

/**
 * What a tool call will cost, from the same rates the tools charge. Null for
 * tools that spend nothing (they run straight away).
 */
export function estimateToolCredits(name: string, input: any): CreditEstimate | null {
  switch (name) {
    case 'create_posts_batch': {
      const posts = batchPosts(input);
      const n = posts.length;
      if (!n) return null;
      const mode = normalizeMediaMode(input?.media_mode);
      // One line per kind of post, e.g. "2 × Instagram carousel (5 slides): 64".
      const groups = new Map<string, { count: number; credits: number }>();
      let credits = 0;
      let images = 0;
      let videos = 0;
      for (const p of posts) {
        const c = postCredits(p.format, p.slides, p.with_image, mode);
        const m = mediaPlan(p.format, p.slides, p.with_image);
        credits += c;
        images += m.images;
        videos += m.videos;
        const key = `${PLATFORM_LABEL[p.platform]} ${FORMAT_LABEL[p.format].toLowerCase()}${p.format === 'carousel' ? ` (${p.slides} slides)` : ''}${p.format === 'text' && p.with_image ? ' + image' : ''}`;
        const g = groups.get(key) ?? { count: 0, credits: 0 };
        g.count++;
        g.credits += c;
        groups.set(key, g);
      }
      const platforms = new Set(posts.map((p) => p.platform)).size;
      const lines = [...groups].map(([k, g]) => `${g.count} × ${k}: ${g.credits} credits`);
      lines.push(`Includes writing (${socialCopyCredits()}/post)${images ? `, ${images} image${images === 1 ? '' : 's'} (${socialImageCredits(mode)} each)` : ''}${videos ? `, ${videos} video${videos === 1 ? '' : 's'} (${socialVideoCredits(mode)} each)` : ''}. You're only charged for what is made.`);
      return {
        credits,
        label: `Create ${n} post${n === 1 ? '' : 's'}${platforms > 1 ? ` across ${platforms} platforms` : ` for ${PLATFORM_LABEL[posts[0].platform]}`}`,
        lines,
      };
    }
    // Magnific: the real price × 1.54 (server/aiPricing.ts), same as what the tool charges.
    case 'magnific_one_generate': {
      const opts = { mode: input?.mode === 'draft' ? 'draft' : 'quality', quality: input?.quality === 'normal' ? 'medium' : 'high', resolution: ['1k', '2k', '4k'].includes(input?.resolution) ? input.resolution : '2k' };
      const credits = creditsForMagnific(magnificOneCost(opts));
      return { credits, label: 'Generate an image with Magnific One', lines: [`Magnific One, ${opts.mode === 'draft' ? 'draft sheet' : `${opts.resolution} ${opts.quality === 'high' ? 'max quality' : 'standard quality'}`}: ${credits} credits`] };
    }
    case 'magnific_generate_image': {
      const model = defaultImageModel(input);
      const cost = creditsForMagnific(magnificImageCost(model, { resolution: input?.resolution }));
      // No model named on Lowest cost: half the Best-quality image price (never below the model's own cost × 1.54).
      const credits = !input?.model && normalizeMediaMode(input?.media_mode) === 'economy' ? economyImageCharge(cost) : cost;
      return { credits, label: `Generate an image (${model})`, lines: [`${model} image${input?.resolution === '4k' ? ' (4K)' : ''}: ${credits} credits`] };
    }
    case 'magnific_edit_image': {
      const type = String(input?.type || 'upscale');
      const credits = creditsForMagnific(magnificEditCost(type, input?.scale_factor));
      return { credits, label: `Edit an image (${type})`, lines: [`${type}${input?.scale_factor ? ` ${input.scale_factor}` : ''}: ${credits} credits`] };
    }
    case 'magnific_generate_video': {
      const model = defaultVideoModel(input);
      const credits = creditsForMagnific(magnificVideoCost(model, input ?? {}));
      return { credits, label: `Generate a video (${model})`, lines: [`${model}, ${Number(input?.duration) || 5} s${input?.resolution ? ` ${input.resolution}` : ''}${input?.generate_audio ? ' with audio' : ''}: ${credits} credits`] };
    }
    case 'magnific_lip_sync': {
      const credits = creditsForMagnific(magnificLipSyncCost());
      return { credits, label: 'Animate a lip-sync avatar', lines: [`OmniHuman lip-sync (audio up to 30 s): ${credits} credits`] };
    }
    case 'magnific_generate_audio': {
      const type = String(input?.type || 'sound-effects');
      const credits = creditsForMagnific(magnificAudioCost(type, input?.duration_seconds));
      return { credits, label: `Generate audio (${type})`, lines: [`${type}${input?.duration_seconds ? `, ${input.duration_seconds} s` : ''}: ${credits} credits`] };
    }
    case 'magnific_space_or_flow': {
      const action = String(input?.action || 'run_space');
      if (action !== 'run_space' && action !== 'run_flow') return null;
      // Replaced by the Space's own node-by-node estimate when the chat prices it.
      const credits = creditsForMagnific(1500);
      return { credits, label: action === 'run_flow' ? 'Run a Magnific Flow' : 'Run a Magnific Space', lines: [`Estimated ${credits} credits`] };
    }
    default:
      return null;
  }
}

/** The image model a chat call uses: the one asked for, else the cheapest (or Magnific One on "best quality"). */
export function defaultImageModel(input: any): string {
  if (input?.model && MAGNIFIC_IMAGE_MODELS[input.model]) return input.model;
  return normalizeMediaMode(input?.media_mode) === 'quality' ? 'magnific-one' : ECONOMY_IMAGE_MODEL;
}

/** The video model a chat call uses: the one asked for, else Kling 2.6 — the lowest-cost video model the Magnific API offers ($0.225 per 5 s). */
export function defaultVideoModel(input: any): string {
  if (input?.model && MAGNIFIC_VIDEO_MODELS[input.model]) return input.model;
  // Best quality: Kling 3.0; Lowest cost: Kling 2.6 (the cheapest the Magnific API offers).
  return normalizeMediaMode(input?.media_mode) === 'quality' ? 'kling-3-0' : 'kling-v2-6-pro';
}

export interface BatchPost {
  topic: string;
  platform: SocialPlatform;
  format: SocialFormat;
  /** Carousel slide count (3–10). */
  slides: number;
  /** A text post that should still carry an image. */
  with_image: boolean;
  /** Art direction for the visuals, when the planner gave one. */
  visual: string;
  scheduled_at: string;
  /** Only when the user asked for drafts: saved unscheduled. */
  as_draft: boolean;
  /** Saved products/people/places (by name) to show in the visuals. */
  assets: string[];
  /** The series' content pillar this post belongs to (from the planner). */
  pillar: string;
  /** The opening line the planner suggested. */
  hook: string;
}

/**
 * The batch tool's posts, cleaned: one native post per platform (an entry
 * naming several platforms becomes one post each), at most 30, each with a
 * format the platform supports and a date (tomorrow 09:00 UTC onwards, one
 * day apart per entry, when not given).
 */
export function batchPosts(input: any, now = new Date()): BatchPost[] {
  const raw: any[] = Array.isArray(input?.posts) ? input.posts.slice(0, BATCH_MAX_POSTS) : [];
  const tz = validTimeZone(input?.timezone);
  const out: BatchPost[] = [];
  // Two posts on one platform never share a minute.
  const taken = new Set<string>();
  const claim = (platform: SocialPlatform, at: Date): Date => {
    let t = at;
    for (let k = 0; k < 8 && taken.has(`${platform}:${t.toISOString()}`); k++) t = new Date(t.getTime() + 3 * 3_600_000);
    taken.add(`${platform}:${t.toISOString()}`);
    return t;
  };
  raw.forEach((p, i) => {
    const topic = String(p?.topic ?? p?.title ?? p?.brief ?? '').trim().slice(0, 600);
    if (!topic) return;
    const when = p?.scheduled_at ? new Date(p.scheduled_at) : null;
    const valid = when && !Number.isNaN(when.getTime()) && when.getTime() > now.getTime() + 5 * 60_000;
    const named = [p?.platform, ...(Array.isArray(p?.platforms) ? p.platforms : []), ...(p?.platform || Array.isArray(p?.platforms) ? [] : Array.isArray(input?.platforms) ? input.platforms : [])]
      .map(normalizePlatform).filter((x): x is SocialPlatform => Boolean(x));
    const platforms = [...new Set(named.length ? named : ['instagram' as SocialPlatform])];
    const day = Math.round(Number(p?.day));
    for (const platform of platforms) {
      // No format (or one the platform cannot do): the one this brief needs.
      const format = normalizeFormat(platform, p?.format, topic);
      // The planner's own time is kept; a planned day gets the platform's best time that day;
      // otherwise the platform's best slot, one entry per day from tomorrow.
      const at = valid ? when! : Number.isFinite(day) && day >= 1 ? seriesSlot(platform, day, tz, now, taken) : claim(platform, bestSlot(platform, 1 + i, tz, now));
      if (valid) taken.add(`${platform}:${at.toISOString()}`);
      out.push({
        topic, platform, format, scheduled_at: at.toISOString(), as_draft: p?.as_draft === true,
        assets: Array.isArray(p?.assets) ? p.assets.map((x: unknown) => String(x).replace(/^@/, '').trim()).filter(Boolean).slice(0, 4) : [],
        slides: format === 'carousel' ? clampSlides(p?.slides) : 0,
        with_image: format === 'text' ? Boolean(p?.with_image) : false,
        visual: String(p?.visual ?? p?.visual_direction ?? '').trim().slice(0, 600),
        pillar: String(p?.pillar ?? '').trim().slice(0, 80),
        hook: String(p?.hook ?? '').trim().slice(0, 200),
      });
    }
  });
  return out.slice(0, BATCH_MAX_POSTS);
}

export async function createPendingAction(query: Query, userId: string, tool: string, args: unknown, estimate: CreditEstimate): Promise<string> {
  await ensureChatTables(query);
  const id = randomUUID();
  await query(
    `INSERT INTO chat_pending_actions (id, user_id, tool, args, credits, label) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, userId, tool, JSON.stringify(args ?? {}), estimate.credits, estimate.label],
  );
  return id;
}

/** Claims a pending action for running; null if it is not this user's, already ran, was cancelled or is over a day old. */
export async function claimPendingAction(query: Query, userId: string, id: string): Promise<{ id: string; tool: string; args: any; credits: number; label: string } | null> {
  await ensureChatTables(query);
  const { rows } = await query(
    `UPDATE chat_pending_actions SET status='running', updated_at=NOW()
     WHERE id=$1 AND user_id=$2 AND status='pending' AND created_at > NOW() - INTERVAL '1 day'
     RETURNING id, tool, args, credits, label`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function finishPendingAction(query: Query, id: string, status: 'done' | 'failed' | 'cancelled', result?: unknown): Promise<void> {
  await query(`UPDATE chat_pending_actions SET status=$2, result=$3, updated_at=NOW() WHERE id=$1`, [id, status, result === undefined ? null : JSON.stringify(result)]).catch(() => undefined);
}

/** Session messages as saved: pasted images are dropped (they are data URLs), everything else kept. */
export function sanitizeSessionMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-200).map((m: any) => {
    if (m && typeof m === 'object' && Array.isArray(m.images)) {
      return { ...m, images: m.images.map((i: any) => ({ id: i?.id, name: i?.name, dataUrl: '' })) };
    }
    return m;
  });
}

// ── Custom instructions: the user's standing orders for every agent task ─────

export const CUSTOM_INSTRUCTIONS_MAX = 4000;

export async function getCustomInstructions(query: Query, userId: string): Promise<string> {
  try {
    await ensureChatTables(query);
    const { rows } = await query(`SELECT instructions FROM user_custom_instructions WHERE user_id=$1`, [userId]);
    return String(rows[0]?.instructions || '').trim();
  } catch {
    return '';
  }
}

export async function saveCustomInstructions(query: Query, userId: string, text: string): Promise<string> {
  await ensureChatTables(query);
  const clean = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, CUSTOM_INSTRUCTIONS_MAX);
  await query(
    `INSERT INTO user_custom_instructions (user_id, instructions, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (user_id) DO UPDATE SET instructions=EXCLUDED.instructions, updated_at=NOW()`,
    [userId, clean],
  );
  return clean;
}

/** The block every agent prompt carries: the user's own rules, above defaults (never above safety). */
export function customInstructionsBlock(text: string): string {
  if (!text) return '';
  return `## THE USER'S CUSTOM INSTRUCTIONS — check and obey on EVERY task\nThese are the user's standing orders for all work you do for them. They override your defaults and style choices (formats, images, tone, platforms, length, schedule). They never override safety rules or the credit confirmation step.\n${text}`;
}

// ── Media setting: which models make images and video by default ─────────────
//
// 'economy' (default): the lowest-cost model that does the job — free NVIDIA
// images when available, then Magnific Z-Image ($0.005); Kling 2.6 for video.
// 'quality': Magnific One for images. A model the user names always wins.

export type MediaMode = 'economy' | 'quality';

export function normalizeMediaMode(v: unknown): MediaMode {
  return v === 'quality' ? 'quality' : 'economy';
}

export async function getMediaMode(query: Query, userId: string | null | undefined): Promise<MediaMode> {
  if (!userId) return 'economy';
  try {
    await ensureChatTables(query);
    const { rows } = await query(`SELECT media_mode FROM user_custom_instructions WHERE user_id=$1`, [userId]);
    return normalizeMediaMode(rows[0]?.media_mode);
  } catch {
    return 'economy';
  }
}

export async function saveMediaMode(query: Query, userId: string, mode: MediaMode): Promise<MediaMode> {
  await ensureChatTables(query);
  await query(
    `INSERT INTO user_custom_instructions (user_id, media_mode, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (user_id) DO UPDATE SET media_mode=EXCLUDED.media_mode, updated_at=NOW()`,
    [userId, mode],
  );
  return mode;
}

export function mediaModeBlock(mode: MediaMode): string {
  return mode === 'quality'
    ? `## MEDIA SETTING: BEST QUALITY\nThe user chose best quality. Default images: Magnific One (magnific_one_generate or model "magnific-one"). Default video: magnific_generate_video with model "kling-3-0". A model the user names always wins.`
    : `## MEDIA SETTING: LOWEST COST (default)\nUse the lowest-cost model that does the job unless the user names a model. Images: magnific_generate_image with model "nano-banana-pro" (never magnific_one_generate, mystic or seedream unless asked; "z-image" only for quick drafts the user asks for). Video: magnific_generate_video with model "kling-v2-6-pro" (never seedance or kling 3 unless asked).`;
}
