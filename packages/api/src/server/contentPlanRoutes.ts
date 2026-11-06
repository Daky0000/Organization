import express from 'express';
import { GOOGLE_IMAGE_USD, creditsForMagnific, creditsForUsd, economyImageCharge, economyImageCredits, magnificImageCost, magnificOneCost } from './aiPricing.ts';
import { designPromptHint, getDesignSystem } from './designSystem.ts';
import { generateTastefulImage, hasTaste, loadTaste, tastePromptHint } from './imageTaste.ts';
import { callMagnificMcpTool } from './mcpRoutes.ts';
import { getMediaMode, type MediaMode } from './chatActions.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';
import { dbQuery } from '../db.ts';
import { AIUnavailableError, aiErrorDetail, getAIConfig, resolveTextKey, callAINonStreaming, hasAICredits, chargeAICredits, ensureCreditAccount, FAST_MODEL, GEMINI_MODELS } from '../ai-helpers.ts';
import { buildSharedAgentContext } from './agentSharedContext.ts';
import { magnificOneGenerate, magnificGenerateImage } from './magnificRoutes.ts';
import { DEFAULT_OPENAI_IMAGE_MODEL, OPENAI_IMAGE_MODELS } from './openaiRoutes.ts';
import { durableMediaUrl, getMediaStorage, mediaStorageAvailable, storeMediaBytes } from './mediaStore.ts';
import { openCheckpoint } from './aiCheckpoints.ts';
import { fence } from './aiGuard.ts';
import { clearCalendarCacheForUser } from '../link-metadata.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-content plans.
//
// "Create image promotion content 3× a day for a month" — a plan row holds
// the cadence + topic + end date; the scheduler claims due plans, and each
// run: builds a brief from the brand profile + shared agent context + the
// user's liked-image style profile, writes the copy (Promo agent prompt),
// generates a featured image (Magnific One → Gemini → OpenAI fallback), saves a draft
// blog post, records the run, and notifies the user. Everything happens in
// the background.
// ─────────────────────────────────────────────────────────────────────────────

type AuthResult = { userId: string; role?: string } | null;

interface Deps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>) => Promise<void>;
  sendPlatformEmail?: (input: { to: string; subject: string; html: string }) => Promise<unknown>;
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `post-${Date.now()}`;
}

// Only actual social media platforms count as content targets — calendar,
// email, and other integrations must never appear as "connected socials".
export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'twitter', 'x', 'pinterest', 'tiktok', 'threads', 'youtube'];

// Internal rate card (credits). The Calculator agent prices plans against
// this; the deterministic floor below protects the platform from the agent
// underpricing a plan.
const RATE_COPY_PER_POST = 2;
const RATE_QA_PER_POST = 1;
/** A featured image, priced for planning: the lowest-cost paid model by default (Magnific Z-Image), Magnific One on "best quality" — cost × 1.54 (server/aiPricing.ts). */
const ratePerImage = (mode: MediaMode = 'economy') => mode === 'quality'
  ? creditsForMagnific(magnificOneCost({ quality: 'medium', resolution: '2k' }))
  : economyImageCredits();

// Pieces per day a plan may ask for. The DB constraint matches.
export const MAX_PLAN_PER_DAY = 48;
export const clampPerDay = (raw: unknown) => Math.min(MAX_PLAN_PER_DAY, Math.max(1, parseInt(String(raw ?? 3), 10) || 3));

// How many due plans one tick generates at once. Each run mostly waits on the
// model and image provider, so a few in parallel multiply throughput without
// tripping provider rate limits (Magnific 429s are retried with backoff).
const PLAN_RUN_CONCURRENCY = Math.max(1, Number(process.env.CONTENT_PLAN_CONCURRENCY) || 3);

// Auto-published pieces go out shortly after generation (a moment to catch
// a bad one on the calendar); reviewed pieces keep the 3-hour window.
const AUTO_PUBLISH_DELAY_MS = 10 * 60 * 1000;
const REVIEW_DELAY_MS = 3 * 60 * 60 * 1000;

// A failed piece is resumed from its checkpoint at most this many times in total.
export const MAX_RUN_ATTEMPTS = 3;

// The next slot is the missed one plus one interval, but never in the past:
// after a pause or outage a plan resumes at its cadence instead of bursting
// through every slot it missed.
export const CLAIM_DUE_PLANS_SQL = `UPDATE content_plans SET
           last_run_at=NOW(), runs_count=runs_count+1, updated_at=NOW(),
           next_run_at = GREATEST(
             COALESCE(next_run_at, NOW()) + make_interval(secs => 86400.0 / GREATEST(per_day, 1)),
             NOW() + make_interval(secs => 60)
           )
         WHERE id IN (
           SELECT id FROM content_plans
           WHERE status='active' AND next_run_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
           ORDER BY next_run_at LIMIT 20 FOR UPDATE SKIP LOCKED
         )
         RETURNING *`;

export function planCreditFloor(totalPosts: number, totalImages: number): number {
  return Math.max(1, totalPosts) * (RATE_COPY_PER_POST + RATE_QA_PER_POST) + Math.max(0, totalImages) * ratePerImage();
}

// Fallback pricing when the agents are unavailable.
export function estimatePlanCredits(perDay: number, durationDays: number, imageMode: string): number {
  const pieces = Math.max(1, perDay) * Math.max(1, durationDays);
  const images = imageMode === 'always' ? pieces : imageMode === 'never' ? 0 : Math.ceil(pieces * 0.66);
  return planCreditFloor(pieces, images);
}

// ── Featured image generation (Magnific One first, Gemini & OpenAI fallback) ──

async function getPlatformKey(platform: string, field = 'api_key'): Promise<string | null> {
  try {
    const r = await dbQuery<{ config: Record<string, string> }>(`SELECT config FROM platform_configs WHERE platform=$1`, [platform]);
    const cfg = decryptPlatformConfig(r.rows[0]?.config);
    return cfg?.[field] ?? cfg?.apiKey ?? null;
  } catch { return null; }
}

async function storeGeneratedImage(base64Data: string, mimeType: string): Promise<string> {
  // Object storage first (R2 in production): a stable, platform-fetchable URL.
  if (mediaStorageAvailable()) {
    try {
      return await storeMediaBytes(Buffer.from(base64Data, 'base64'), mimeType, 'content-plan', { jpeg: true });
    } catch (e) { logger.warn({ e: e instanceof Error ? e.message : e }, 'content_plan_storage_upload_failed'); }
  }
  try {
    const imgbbKey = (await getPlatformKey('google', 'imgbb_api_key')) || process.env.IMGBB_API_KEY;
    if (imgbbKey) {
      const params = new URLSearchParams({ key: imgbbKey, image: base64Data });
      const resp = await axios.post('https://api.imgbb.com/1/upload', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20_000,
      });
      const url: string = resp.data?.data?.display_url ?? resp.data?.data?.url ?? '';
      if (url) return url;
    }
  } catch (e) { logger.warn({ e }, 'content_plan_imgbb_upload_failed'); }
  return `data:${mimeType};base64,${base64Data}`;
}

/**
 * A featured image and the credits it costs (provider price × 1.54).
 * 'economy' (the default) starts with Magnific Nano Banana Pro; 'quality'
 * starts with Magnific One.
 */
export async function generateFeaturedImage(rawPrompt: string, mode: MediaMode = 'economy', ctx: { userId?: string; pool?: Pool | null } = {}): Promise<{ url: string; credits: number; model: string } | null> {
  // The user's design system: Magnific One gets it as the saved Brand Kit; other models get a palette/type hint.
  const design = ctx.userId ? await getDesignSystem((sql, p) => dbQuery(sql, p as any[]), ctx.userId) : null;
  let prompt = [rawPrompt, designPromptHint(design)].filter(Boolean).join(' ');
  const magnificKey = (await getPlatformKey('magnific', 'apiKey')) || (await getPlatformKey('freepik', 'apiKey')) || process.env.MAGNIFIC_API_KEY || process.env.FREEPIK_API_KEY;
  const googleKey = (await getPlatformKey('google')) || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const openaiKey = (await getPlatformKey('openai')) || process.env.OPENAI_API_KEY;
  type Attempt = { model: string; run: () => Promise<string | null>; credits: () => number };

  const magnific = (model: string, opts: Record<string, unknown> = {}): Attempt => ({
    model: `magnific:${model}`,
    credits: () => creditsForMagnific(magnificImageCost(model, opts as any)),
    run: async () => {
      if (!magnificKey) return null;
      // Magnific links expire; the piece keeps a copy in object storage.
      const r = model === 'magnific-one'
        ? await magnificOneGenerate({ prompt, mode: 'quality', quality: 'medium', resolution: '2k', aspect_ratio: '1:1' }, magnificKey)
        : await magnificGenerateImage(model, prompt, '1:1', magnificKey, undefined, opts as any);
      return r.url && !r.error ? durableMediaUrl(r.url, 'content-plan', { jpeg: true }) : null;
    },
  });
  const gemini: Attempt = {
    model: 'google:gemini-2.5-flash-image',
    credits: () => creditsForUsd(GOOGLE_IMAGE_USD['google-gemini-flash']),
    run: async () => {
      if (!googleKey) return null;
      const resp = await axios.post(
        `${GOOGLE_BASE}/models/gemini-2.5-flash-image:generateContent`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } },
        { headers: { 'x-goog-api-key': googleKey, 'Content-Type': 'application/json' }, timeout: 60_000 }
      );
      const parts: any[] = resp.data?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      return imgPart ? storeGeneratedImage(imgPart.inlineData.data, imgPart.inlineData.mimeType) : null;
    },
  };
  const openai: Attempt = {
    model: `openai:${DEFAULT_OPENAI_IMAGE_MODEL}`,
    credits: () => creditsForUsd(OPENAI_IMAGE_MODELS[DEFAULT_OPENAI_IMAGE_MODEL]?.providerCostUsd ?? 0.129),
    run: async () => {
      if (!openaiKey) return null;
      const resp = await axios.post(
        'https://api.openai.com/v1/images/generations',
        { model: DEFAULT_OPENAI_IMAGE_MODEL, prompt: prompt.slice(0, 3800), n: 1, size: '1024x1024', quality: 'auto' },
        { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 90_000 }
      );
      const b64: string = resp.data?.data?.[0]?.b64_json ?? '';
      return b64 ? storeGeneratedImage(b64, 'image/png') : null;
    },
  };

  // Lowest cost: Nano Banana Pro ($0.075) → Z-Image ($0.005) → Flux.1 ($0.01) → Gemini ($0.039) → OpenAI ($0.129) → Magnific One ($0.18).
  // The free NVIDIA model is not used for published images: its results were not good enough.
  // What the user taught (Brand Kit, example designs, rules, saved items) — tried first when there is any.
  let taughtCredits = 0;
  const taught: Attempt = {
    model: 'magnific:taught-style',
    credits: () => taughtCredits,
    run: async () => {
      if (!ctx.userId || !magnificKey) return null;
      const t = await loadTaste((sql, p) => dbQuery(sql, p as any[]), ctx.userId);
      if (mode !== 'quality' && !hasTaste(t)) return null;
      const mcp = (tool: string, args: Record<string, unknown>) => callMagnificMcpTool(ctx.pool ?? null, tool, args, (val: unknown) => {
        const dec = decryptPlatformConfig(val as any);
        return typeof dec === 'string' ? dec : (dec as any)?.value ?? '';
      });
      const r = await generateTastefulImage({ query: (sql, p) => dbQuery(sql, p as any[]), userId: ctx.userId, mcp, prompt: rawPrompt, aspectRatio: '1:1', mode, channel: 'social', taste: t });
      if (!r) return null;
      taughtCredits = mode === 'quality' ? creditsForMagnific(magnificOneCost({ quality: 'medium', resolution: '2k' })) : creditsForMagnific(r.magnificCredits);
      return durableMediaUrl(r.url, 'content-plan', { jpeg: true });
    },
  };
  // Models that cannot use references get the learned style and bans in the prompt.
  const taste = ctx.userId ? await loadTaste((sql, p) => dbQuery(sql, p as any[]), ctx.userId) : null;
  const tasteHint = taste ? tastePromptHint(taste) : '';
  prompt = [prompt, tasteHint].filter(Boolean).join(' ');
  const order: Attempt[] = mode === 'quality'
    ? [taught, magnific('magnific-one', { quality: 'medium', resolution: '2k' }), magnific('nano-banana-pro', { resolution: '2K' }), magnific('mystic'), gemini, openai]
    : [taught, magnific('nano-banana-pro', { resolution: '2K' }), magnific('z-image'), magnific('flux-dev'), gemini, openai, magnific('magnific-one', { quality: 'medium', resolution: '2k' })];
  for (const a of order) {
    try {
      const url = await a.run();
      // Lowest cost: half the Best-quality price for any model that draws it (never below that model's cost × 1.54).
      if (url) return { url, credits: mode === 'quality' ? a.credits() : economyImageCharge(a.credits()), model: a.model };
    } catch (e) {
      logger.warn({ e: e instanceof Error ? e.message : e, model: a.model }, 'content_plan_image_attempt_failed');
    }
  }
  return null;
}

// ── The engine ────────────────────────────────────────────────────────────────

export function buildContentPlanEngine({ pool, createNotification, sendPlatformEmail }: Pick<Deps, 'pool' | 'createNotification' | 'sendPlatformEmail'>) {

  async function likedStyleProfile(userId: string): Promise<string> {
    try {
      const { rows } = await pool.query(
        `SELECT m.model, m.prompt FROM mcp_media_likes l JOIN mcp_media m ON m.id=l.media_id
         WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 5`, [userId]
      );
      if (!rows.length) return '';
      return `Visual style the user likes (from their saved images — imitate the aesthetic, not the subject):\n${rows.map((r: any) => `- [${r.model || 'ai'}] ${String(r.prompt || '').slice(0, 200)}`).join('\n')}`;
    } catch { return ''; }
  }

  // A piece that failed in the last day resumes from its checkpoint before a
  // new one starts: the steps it finished (copy, review, image) are not paid
  // for again. Three attempts, then it stays failed.
  async function findResumableRun(planId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT r.id FROM content_plan_runs r
       JOIN generation_checkpoints c ON c.id = 'content_plan_run:' || r.id
       WHERE r.plan_id=$1 AND r.status='failed' AND r.created_at > NOW() - INTERVAL '24 hours'
         AND c.status <> 'done' AND c.attempts < $2
       ORDER BY r.created_at LIMIT 1`,
      [planId, MAX_RUN_ATTEMPTS]
    ).catch(() => ({ rows: [] as any[] }));
    return rows[0]?.id ?? null;
  }

  async function runPlanOnce(plan: any, resumeRunId?: string): Promise<void> {
    const resumeId = resumeRunId ?? await findResumableRun(plan.id);
    const runId = resumeId ?? randomUUID();
    // Recorded as 'running' immediately so the Activity log shows progress
    // while the piece is being generated.
    if (resumeId) {
      await pool.query(`UPDATE content_plan_runs SET status='running', error=NULL WHERE id=$1`, [runId]).catch(() => undefined);
    } else {
      await pool.query(
        `INSERT INTO content_plan_runs (id, plan_id, user_id, status) VALUES ($1,$2,$3,'running')`,
        [runId, plan.id, plan.user_id]
      ).catch(() => undefined);
    }
    const cp = await openCheckpoint({ kind: 'content_plan_run', ref: runId, userId: plan.user_id });
    if (cp.resumedSteps.length) logger.info({ planId: plan.id, runId, resumed: cp.resumedSteps, attempt: cp.state.attempts }, 'content_plan_run_resumed');
    try {
      if (!(await hasAICredits(plan.user_id))) {
        await pool.query(
          `UPDATE content_plan_runs SET status='skipped', error='Out of AI credits' WHERE id=$1`,
          [runId]
        );
        await cp.fail('Out of AI credits');
        return;
      }
      const aiCfg = await getAIConfig();
      const apiKey = resolveTextKey(aiCfg);
      if (!apiKey) throw new AIUnavailableError('AI not configured — add the free NVIDIA key in Admin → NVIDIA, or a paid key in Admin → AI Assistant → Configuration');

      const [sharedCtx, styleProfile, socials] = await Promise.all([
        buildSharedAgentContext(plan.user_id).catch(() => ''),
        plan.use_liked_style ? likedStyleProfile(plan.user_id) : Promise.resolve(''),
        pool.query(`SELECT DISTINCT platform FROM social_accounts WHERE user_id=$1 AND connected=true AND platform = ANY($2)`, [plan.user_id, SOCIAL_PLATFORMS])
          .then(r => r.rows.map((x: any) => String(x.platform))).catch(() => [] as string[]),
      ]);
      // Memories can come from a scraped website, so the workspace context is
      // fenced as data; the plan's own instructions are the customer's and stay plain.
      const ctxBlock = sharedCtx ? fence('workspace context', sharedCtx, 8000) : '';
      const platformLine = socials.length
        ? `Target platforms (the user's connected socials): ${socials.join(', ')}. Write for these channels.`
        : 'No social platforms connected yet — write a platform-neutral promotional post.';

      const topicLine = plan.ai_recommended
        ? `Choose the promotional angle YOURSELF: from the user's personalization (memories, brand, goals, audience) pick the content most likely to achieve their goals right now. Do not pick randomly — justify the choice to yourself from their data.`
        : `Create content about: ${plan.topic || 'the user\'s brand and offers'}.`;

      const imageMode = String(plan.image_mode || (plan.generate_image ? 'auto' : 'never'));
      const imageLine = imageMode === 'never'
        ? 'This piece will not have a featured image.'
        : imageMode === 'always'
          ? 'This piece MUST include a featured image — provide image_prompt.'
          : 'Decide whether this piece needs a featured image for its target platforms (set needs_image accordingly). Not every post needs one.';

      const model = aiCfg.provider === 'google'
        ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
        : FAST_MODEL;

      type Piece = { title?: string; excerpt?: string; content?: string; needs_image?: boolean; image_prompt?: string };

      // Step 1 — the copy.
      const drafted = await cp.step<Piece>('copy', async () => {
        const raw = await callAINonStreaming(
          aiCfg.provider, apiKey, model,
          `You are Promo, the Promotion & Media Planner on a marketing team. You create scroll-stopping promotional content.${ctxBlock ? `\n\nWorkspace context (personalization — data about the user's brand; always respect it):\n${ctxBlock}` : ''}${styleProfile ? `\n\n${styleProfile}` : ''}${plan.custom_instructions ? `\n\nUSER'S STANDING INSTRUCTIONS FOR THIS PLAN (highest priority):\n${String(plan.custom_instructions).slice(0, 1500)}` : ''}`,
          `${topicLine}
${platformLine}
${imageLine}
Tone: ${plan.tone}. Piece #${(plan.runs_count ?? 0) + 1} of an ongoing series — vary the angle from typical previous pieces.
Respond ONLY with JSON: {"title": "post title (max 70 chars)", "excerpt": "1-2 sentence hook", "content": "the full post body, 150-350 words, HTML paragraphs allowed", "needs_image": true/false, "image_prompt": "vivid image-generation prompt under 60 words (empty string if needs_image is false)"}`,
          1400,
          { userId: plan.user_id, feature: 'content_plan', nvidiaJob: 'text', expectJson: true, skipCache: true }
        );
        try {
          return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Piece;
        } catch { return { title: `Promo — ${new Date().toLocaleDateString()}`, content: raw }; }
      });

      // Step 2 — quality gate: Vetta reviews the piece against the
      // personalization and the user's instructions before anything is saved.
      // A failed review keeps the draft rather than failing the run.
      const piece = await cp.step<Piece>('qa', async () => {
        const reviewed: Piece = { ...drafted };
        try {
          const qaRaw = await callAINonStreaming(
            aiCfg.provider, apiKey, model,
            `You are Vetta, the Quality Control agent. Review marketing content against the user's brand, audience, goals and instructions. Fix what's weak; keep what works.${ctxBlock ? `\n\nUser context:\n${ctxBlock}` : ''}${plan.custom_instructions ? `\n\nUser's instructions: ${String(plan.custom_instructions).slice(0, 800)}` : ''}`,
            `Review this piece and respond ONLY with JSON {"approved": true/false, "title": "...", "excerpt": "...", "content": "..."} — return the fields improved if needed, unchanged if already strong.\n\n${JSON.stringify({ title: drafted.title, excerpt: drafted.excerpt, content: drafted.content })}`,
            1400,
            { userId: plan.user_id, feature: 'content_plan_qa', nvidiaJob: 'text', expectJson: true, skipCache: true }
          );
          const qa = JSON.parse(qaRaw.slice(qaRaw.indexOf('{'), qaRaw.lastIndexOf('}') + 1));
          if (qa && typeof qa === 'object') {
            if (typeof qa.title === 'string' && qa.title.trim()) reviewed.title = qa.title;
            if (typeof qa.excerpt === 'string' && qa.excerpt.trim()) reviewed.excerpt = qa.excerpt;
            if (typeof qa.content === 'string' && qa.content.trim()) reviewed.content = qa.content;
          }
        } catch (err) { logger.warn({ err, planId: plan.id }, 'content_plan_qa_skipped'); }
        return reviewed;
      });

      const title = String(piece.title || 'Promotional post').slice(0, 200);

      // Step 3 — the image. Charged in its own step, so a resume after the
      // image was drawn neither draws nor charges it again.
      const wantsImage = imageMode === 'always' || (imageMode === 'auto' && piece.needs_image !== false && Boolean(piece.image_prompt));
      const mediaMode = await getMediaMode(dbQuery, plan.user_id);
      const drawnImage = wantsImage && piece.image_prompt
        ? await cp.step<{ url: string; credits: number; model: string } | string | null>('image', () => generateFeaturedImage(String(piece.image_prompt), mediaMode, { userId: plan.user_id, pool }))
        : null;
      // (A run resumed from before this change stored just the URL; it was a Magnific One image.)
      const imageUrl = typeof drawnImage === 'string' ? drawnImage : drawnImage?.url ?? null;
      const imageCredits = typeof drawnImage === 'string' ? ratePerImage('quality') : drawnImage?.credits ?? 0;
      if (imageUrl && imageCredits > 0) {
        await cp.step('image_charged', () => chargeAICredits(plan.user_id, imageCredits, 'content_plan_image', { plan_id: plan.id, model: typeof drawnImage === 'string' ? 'magnific:magnific-one' : drawnImage?.model }).then(() => true).catch(() => false));
      }

      // Step 4 — the post. Scheduled (not draft) so the piece shows on the
      // calendar. Reviewed plans hold it 3 hours as the review window;
      // auto-publish plans send it out at the next publisher tick after a
      // short buffer. The id is saved first, so a crash after the insert
      // cannot create the post twice.
      const autoPublish = Boolean(plan.auto_publish);
      const postId = await cp.step('post_id', async () => randomUUID());
      const scheduledAt = new Date(Date.now() + (autoPublish ? AUTO_PUBLISH_DELAY_MS : REVIEW_DELAY_MS));
      await pool.query(
        `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, featured_image, status, scheduled_at, source, approval_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,'content_plan',$9)
         ON CONFLICT (id) DO NOTHING`,
        [postId, plan.user_id, title, `${slugify(title)}-${postId.slice(0, 6)}`,
         String(piece.content || ''), String(piece.excerpt || '').slice(0, 500), imageUrl || '', scheduledAt.toISOString(),
         autoPublish ? 'not_required' : 'review_required']
      );
      clearCalendarCacheForUser(plan.user_id);
      await pool.query(
        `UPDATE content_plan_runs SET status='done', blog_post_id=$2, title=$3, image_url=$4, error=NULL WHERE id=$1`,
        [runId, postId, title, imageUrl]
      );
      await cp.complete();
      await createNotification(
        plan.user_id, 'content_generated',
        `New promo content ready: ${title}`,
        `"${plan.name}" created a post${imageUrl ? ' with a featured image' : ''}, scheduled for ${scheduledAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} — it's on your calendar. ${autoPublish ? 'It publishes automatically; edit or unschedule it in Content → Posts before then to stop it.' : 'Review or reschedule it in Content → Posts.'}`,
        { plan_id: plan.id, blog_post_id: postId }
      );
    } catch (err) {
      // The run's error is shown to the customer: never a setup detail or a raw database message.
      const message = err instanceof AIUnavailableError ? err.message : 'This piece could not be generated';
      logger.warn({ err, detail: aiErrorDetail(err), planId: plan.id, runId, finished: Object.keys(cp.state.steps) }, 'content_plan_run_failed');
      await cp.fail(new Error(aiErrorDetail(err)));
      const resumable = cp.state.attempts < MAX_RUN_ATTEMPTS;
      await pool.query(
        `UPDATE content_plan_runs SET status='failed', error=$2 WHERE id=$1`,
        [runId, `${message}${resumable ? ' — will resume from the last finished step' : ''}`.slice(0, 300)]
      ).catch(() => undefined);
    }
  }

  // A run left 'running' by a process that died mid-generation (deploy,
  // crash) is marked failed, which makes it resumable on the plan's next slot.
  async function releaseInterruptedRuns(): Promise<void> {
    await pool.query(
      `UPDATE content_plan_runs SET status='failed', error='Interrupted (server restarted) — will resume from the last finished step'
       WHERE status='running' AND created_at < NOW() - INTERVAL '20 minutes'`
    ).catch(() => undefined);
  }

  // Pricing pipeline (background, after the user clicks Proceed):
  // 1. Atlas (Planner) turns the form into a concrete blueprint — total
  //    posts, which get images, platform mix.
  // 2. Ledger (Calculator) prices the blueprint against the internal rate
  //    card. The deterministic floor is enforced afterwards so the agent can
  //    never underprice a plan below platform cost.
  // The user is notified with the total and can then start the plan.
  async function pricePlan(plan: any): Promise<void> {
    const totalPosts = Math.max(1, Number(plan.per_day) || 1) * Math.max(1, Number(plan.duration_days) || 30);
    let blueprint: Record<string, any> = { total_posts: totalPosts };
    let breakdown: Record<string, any> = {};
    let credits = 0;
    try {
      const aiCfg = await getAIConfig();
      const apiKey = resolveTextKey(aiCfg);
      if (!apiKey) throw new Error('AI not configured');
      const model = aiCfg.provider === 'google'
        ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
        : FAST_MODEL;

      const [sharedCtx, socials] = await Promise.all([
        buildSharedAgentContext(plan.user_id).catch(() => ''),
        pool.query(`SELECT DISTINCT platform FROM social_accounts WHERE user_id=$1 AND connected=true AND platform = ANY($2)`, [plan.user_id, SOCIAL_PLATFORMS])
          .then(r => r.rows.map((x: any) => String(x.platform))).catch(() => [] as string[]),
      ]);

      // 1. Atlas — the blueprint
      const imageRule = plan.image_mode === 'always'
        ? `Every post gets a featured image (posts_with_images = ${totalPosts}).`
        : plan.image_mode === 'never'
          ? 'No post gets an image (posts_with_images = 0).'
          : 'Decide per post whether an image is worth it for the platforms and content mix.';
      const planRaw = await callAINonStreaming(
        aiCfg.provider, apiKey, model,
        `You are Atlas, the Content Planner on a marketing team. You turn a campaign request into a precise production blueprint.${sharedCtx ? `\n\nUser context:\n${sharedCtx}` : ''}`,
        `Plan this content campaign:
- Cadence: ${plan.per_day} posts/day for ${plan.duration_days} days = exactly ${totalPosts} posts total.
- Topic: ${plan.ai_recommended ? 'AI-chosen from the user\'s personalization' : (plan.topic || 'brand promotion')}
- Tone: ${plan.tone}. Target platforms: ${socials.join(', ') || 'none connected (platform-neutral)'}
- ${imageRule}
${plan.custom_instructions ? `- User's instructions: ${String(plan.custom_instructions).slice(0, 1000)}` : ''}
Respond ONLY with JSON: {"total_posts": ${totalPosts}, "posts_with_images": <int 0-${totalPosts}>, "total_images": <int>, "platforms": [...], "content_mix": ["3-6 short angle descriptions"], "notes": "one line for the calculator about anything unusually heavy (long instructions, many platforms, image-heavy)"}`,
        900,
        { userId: plan.user_id, feature: 'content_plan_planning' }
      );
      try { blueprint = JSON.parse(planRaw.slice(planRaw.indexOf('{'), planRaw.lastIndexOf('}') + 1)); } catch { /* keep default */ }
      blueprint.total_posts = totalPosts; // never trust drift on the fixed number
      const totalImages = plan.image_mode === 'always' ? totalPosts
        : plan.image_mode === 'never' ? 0
        : Math.min(totalPosts, Math.max(0, Number(blueprint.total_images ?? blueprint.posts_with_images) || Math.ceil(totalPosts * 0.66)));
      blueprint.total_images = totalImages;

      // 2. Ledger — the price
      const calcRaw = await callAINonStreaming(
        aiCfg.provider, apiKey, model,
        `You are Ledger, the Credit Calculator. You price content production plans in platform credits so the platform never generates at a loss. Internal rate card: copy generation ${RATE_COPY_PER_POST} credits per post, quality review ${RATE_QA_PER_POST} credit per post, featured image ${ratePerImage()} credits per image. Long custom instructions, many platforms, or unusually long content justify a surcharge of up to 25%. Never price below the rate card.`,
        `Price this blueprint and respond ONLY with JSON {"total_credits": <int>, "breakdown": {"copy": <int>, "quality_review": <int>, "images": <int>, "surcharge": <int>}, "reason": "one line"}:\n${JSON.stringify({ ...blueprint, custom_instructions_length: String(plan.custom_instructions || '').length, platforms: blueprint.platforms ?? socials })}`,
        500,
        { userId: plan.user_id, feature: 'content_plan_pricing' }
      );
      try {
        const calc = JSON.parse(calcRaw.slice(calcRaw.indexOf('{'), calcRaw.lastIndexOf('}') + 1));
        credits = Math.round(Number(calc.total_credits) || 0);
        breakdown = calc.breakdown && typeof calc.breakdown === 'object' ? calc.breakdown : {};
        if (calc.reason) breakdown.reason = String(calc.reason).slice(0, 200);
      } catch { /* floor below */ }

      // Guardrails: never below cost, never more than double the floor.
      const floor = planCreditFloor(totalPosts, totalImages);
      credits = Math.min(Math.max(credits, floor), floor * 2);
      breakdown.floor = floor;
    } catch (err) {
      logger.warn({ err, planId: plan.id }, 'content_plan_pricing_agents_failed');
      credits = estimatePlanCredits(plan.per_day, plan.duration_days, plan.image_mode || 'auto');
      breakdown = { fallback: true };
    }

    await pool.query(
      `UPDATE content_plans SET status='priced', estimated_credits=$2, plan_blueprint=$3::jsonb, pricing_breakdown=$4::jsonb, updated_at=NOW()
       WHERE id=$1 AND status='pricing'`,
      [plan.id, credits, JSON.stringify(blueprint).slice(0, 8000), JSON.stringify(breakdown).slice(0, 4000)]
    ).catch(() => undefined);
    await createNotification(
      plan.user_id, 'content_plan_priced',
      `Plan priced: "${plan.name}" — ✦${credits} credits`,
      `Atlas planned ${blueprint.total_posts} posts (${blueprint.total_images ?? 0} with images) and Ledger calculated ✦${credits} credits total. Open Post Automation → Auto-Content to start it.`,
      { plan_id: plan.id, estimated_credits: credits }
    ).catch(() => undefined);
  }

  // Scheduler tick: complete expired plans (with a wrap-up notification +
  // email), then claim and run due ones. The claim atomically advances
  // next_run_at by exactly 24h / per_day from the slot it was due at (not
  // from when the tick noticed it, which drifted 20/day down to ~18), so
  // concurrent instances can't double-run. A tick that finds the previous one
  // still generating skips; claimed plans run a few at a time.
  let tickRunning = false;
  async function processDueContentPlans(): Promise<void> {
    if (!pool || tickRunning) return;
    tickRunning = true;
    try {
      const { rows: finished } = await pool.query(
        `UPDATE content_plans SET status='completed', updated_at=NOW()
         WHERE status='active' AND ends_at IS NOT NULL AND ends_at <= NOW() RETURNING *`
      );
      for (const plan of finished) {
        await createNotification(
          plan.user_id, 'content_plan_completed',
          `Content plan finished: ${plan.name}`,
          `All done — ${plan.runs_count} pieces were created. Review your drafts in Content → Posts.`,
          { plan_id: plan.id }
        ).catch(() => undefined);
        if (sendPlatformEmail) {
          try {
            const { rows: u } = await pool.query(`SELECT email FROM users WHERE id=$1`, [plan.user_id]);
            if (u[0]?.email) {
              await sendPlatformEmail({
                to: u[0].email,
                subject: `Your content plan "${plan.name}" is complete`,
                html: `<p>Hi,</p><p>Your automated content plan <b>${plan.name}</b> has finished — <b>${plan.runs_count}</b> promotional pieces were created as drafts.</p><p>Open Content → Posts to review, edit, and publish them.</p>`,
              });
            }
          } catch (err) { logger.warn({ err }, 'content_plan_completion_email_failed'); }
        }
      }

      await releaseInterruptedRuns();
      const { rows: due } = await pool.query(CLAIM_DUE_PLANS_SQL);
      for (let i = 0; i < due.length; i += PLAN_RUN_CONCURRENCY) {
        await Promise.all(due.slice(i, i + PLAN_RUN_CONCURRENCY).map((plan: any) => runPlanOnce(plan)));
      }
    } catch (err) {
      logger.error({ err }, 'content_plan_tick_failed');
    } finally {
      tickRunning = false;
    }
  }

  return { processDueContentPlans, runPlanOnce, pricePlan };
}

// ── Routes (mounted at /api) ─────────────────────────────────────────────────

export function registerContentPlanRoutes(deps: Deps & { runPlanOnce: (plan: any, resumeRunId?: string) => Promise<void>; pricePlan: (plan: any) => Promise<void> }): Router {
  const { requireAuth, pool, runPlanOnce } = deps;
  const router = express.Router();

  router.get('/content-plans', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT p.*,
           (SELECT COUNT(*) FROM content_plan_runs r WHERE r.plan_id=p.id AND r.status='done') AS pieces_created,
           (SELECT COUNT(*) FROM content_plan_runs r WHERE r.plan_id=p.id AND r.status='failed') AS pieces_failed
         FROM content_plans p WHERE p.user_id=$1 ORDER BY p.created_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, plans: rows });
    } catch (err) {
      logger.error({ err }, 'content_plans_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to load plans' });
    }
  });

  // GET /api/content-plans/estimate — credit cost + current balance for the UI
  router.get('/content-plans/estimate', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const perDay = clampPerDay(req.query.per_day);
      const durationDays = Math.min(90, Math.max(1, parseInt(String(req.query.duration_days ?? 30), 10) || 30));
      const imageMode = ['always', 'never', 'auto'].includes(String(req.query.image_mode)) ? String(req.query.image_mode) : 'auto';
      const credits = estimatePlanCredits(perDay, durationDays, imageMode);
      const { credits: balance } = await ensureCreditAccount(auth.userId);
      return res.json({ success: true, estimated_credits: credits, balance, sufficient: balance >= credits });
    } catch (err) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Estimate failed' });
    }
  });

  // POST /api/content-plans — "Proceed": creates the plan in 'pricing' state
  // and kicks off the Planner→Calculator pipeline in the background. The
  // user is notified with the real total; nothing generates yet.
  router.post('/content-plans', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const b = req.body as Record<string, any>;
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
      const perDay = clampPerDay(b.per_day);
      const durationDays = Math.min(90, Math.max(1, parseInt(String(b.duration_days ?? 30), 10) || 30));
      const imageMode = ['always', 'never', 'auto'].includes(String(b.image_mode)) ? String(b.image_mode) : 'auto';
      const aiRecommended = Boolean(b.ai_recommended);
      if (!aiRecommended && !String(b.topic || '').trim()) {
        return res.status(400).json({ success: false, error: 'Describe what to promote, or switch on AI recommended' });
      }

      const { rows } = await pool.query(
        `INSERT INTO content_plans (user_id, name, topic, tone, per_day, duration_days, use_liked_style, generate_image, image_mode, ai_recommended, custom_instructions, auto_publish, status, next_run_at, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pricing',NULL,NULL)
         RETURNING *`,
        [auth.userId, name.slice(0, 120), String(b.topic || '').slice(0, 500), String(b.tone || 'engaging').slice(0, 40),
         perDay, durationDays, b.use_liked_style !== false, imageMode !== 'never', imageMode, aiRecommended,
         String(b.custom_instructions || '').slice(0, 2000), b.auto_publish === true]
      );
      void deps.pricePlan(rows[0]).catch(() => undefined);
      return res.status(202).json({
        success: true, plan: rows[0],
        message: 'Your AI team is planning this and calculating the exact credit cost — you\'ll get a notification with the total.',
      });
    } catch (err) {
      logger.error({ err }, 'content_plan_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create plan' });
    }
  });

  // POST /api/content-plans/:id/start — only priced plans, only with enough
  // balance for the calculated total.
  router.post('/content-plans/:id/start', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM content_plans WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
      const plan = rows[0];
      if (plan.status === 'pricing') return res.status(409).json({ success: false, error: 'Still calculating the cost — wait for the notification.' });
      if (plan.status !== 'priced') return res.status(400).json({ success: false, error: `Plan is ${plan.status}` });

      const { credits: balance } = await ensureCreditAccount(auth.userId);
      if (balance < Number(plan.estimated_credits || 0)) {
        return res.status(402).json({
          success: false,
          error: `This plan costs ✦${plan.estimated_credits} but you have ✦${balance}. Top up or create a smaller plan.`,
          estimated_credits: plan.estimated_credits, balance,
        });
      }
      const { rows: updated } = await pool.query(
        `UPDATE content_plans SET status='active', next_run_at=NOW(), ends_at=NOW() + make_interval(days => duration_days), updated_at=NOW()
         WHERE id=$1 AND status='priced' RETURNING *`,
        [plan.id]
      );
      return res.json({ success: true, plan: updated[0] });
    } catch (err) {
      logger.error({ err }, 'content_plan_start_failed');
      return res.status(500).json({ success: false, error: 'Failed to start plan' });
    }
  });

  router.patch('/content-plans/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const status = body.status === undefined ? null : String(body.status);
      const autoPublish = typeof body.auto_publish === 'boolean' ? body.auto_publish : null;
      if (status !== null && !['active', 'paused'].includes(status)) return res.status(400).json({ success: false, error: 'status must be active or paused' });
      if (status === null && autoPublish === null) return res.status(400).json({ success: false, error: 'Nothing to update' });
      // Status only moves between active and paused; a plan still being priced
      // or already finished keeps its status.
      const { rows } = await pool.query(
        `UPDATE content_plans SET
           status=CASE WHEN $1::text IS NOT NULL AND status IN ('active','paused') THEN $1::text ELSE status END,
           auto_publish=COALESCE($4::boolean, auto_publish),
           updated_at=NOW(),
           next_run_at=CASE WHEN $1::text='active' AND next_run_at < NOW() THEN NOW() ELSE next_run_at END
         WHERE id=$2 AND user_id=$3 RETURNING *`,
        [status, req.params.id, auth.userId, autoPublish]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
      return res.json({ success: true, plan: rows[0] });
    } catch (err) {
      logger.error({ err }, 'content_plan_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  });

  router.delete('/content-plans/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      await pool.query(`DELETE FROM content_plans WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'content_plan_delete_failed');
      return res.status(500).json({ success: false, error: 'Failed to delete plan' });
    }
  });

  // Run one piece right now (also useful to preview quality before committing
  // to a month of output).
  router.post('/content-plans/:id/run', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM content_plans WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Plan not found' });
      if (['pricing', 'priced'].includes(rows[0].status)) return res.status(400).json({ success: false, error: 'Start the plan first — it hasn\'t begun yet.' });
      await pool.query(`UPDATE content_plans SET runs_count=runs_count+1, last_run_at=NOW(), updated_at=NOW() WHERE id=$1`, [req.params.id]);
      // Background — the notification tells the user when it's done.
      void runPlanOnce(rows[0]).catch(() => undefined);
      return res.status(202).json({ success: true, message: 'Generating in the background — you\'ll get a notification when it\'s ready.' });
    } catch (err) {
      logger.error({ err }, 'content_plan_manual_run_failed');
      return res.status(500).json({ success: false, error: 'Failed to run plan' });
    }
  });

  // Retry one failed piece. It resumes from its checkpoint: the copy, review
  // and image it already finished are reused, not generated (or paid for) again.
  router.post('/content-plans/runs/:runId/retry', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT r.status AS run_status, p.* FROM content_plan_runs r JOIN content_plans p ON p.id=r.plan_id WHERE r.id=$1 AND r.user_id=$2`,
        [req.params.runId, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Run not found' });
      const { run_status: runStatus, ...plan } = rows[0];
      if (runStatus !== 'failed') return res.status(409).json({ success: false, error: `This piece is ${runStatus}, not failed.` });
      void runPlanOnce(plan, req.params.runId).catch(() => undefined);
      return res.status(202).json({ success: true, message: 'Resuming from the last finished step — you\'ll get a notification when it\'s ready.' });
    } catch (err) {
      logger.error({ err }, 'content_plan_retry_failed');
      return res.status(500).json({ success: false, error: 'Failed to retry' });
    }
  });

  router.get('/content-plans/:id/runs', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT * FROM content_plan_runs WHERE plan_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`,
        [req.params.id, auth.userId]
      );
      return res.json({ success: true, runs: rows });
    } catch (err) {
      logger.error({ err }, 'content_plan_runs_failed');
      return res.status(500).json({ success: false, error: 'Failed to load runs' });
    }
  });

  return router;
}
