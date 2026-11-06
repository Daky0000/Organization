import { Router, type Response } from 'express';
import type { Request } from '../types/http.ts';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { encryptPlatformConfig, decryptPlatformConfig } from '../integration-helpers.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { logger } from '../logger.ts';
import type { Pool } from 'pg';
import {
  getMagnificApiKey,
  getFreepikApiKey,
  magnificPost,
  pollMagnificTask,
  magnificOneGenerate,
  magnificGenerateImage,
  magnificEditImage,
  magnificGenerateVideo,
  magnificLipSync,
  magnificGenerateAudio,
  magnificExecuteSpaceOrFlow,
  freepikGenerateImage,
  sanitizeMagnificError,
  MAGNIFIC_IMAGE_MODELS,
  MAGNIFIC_VIDEO_MODELS,
  ASPECT_RATIO_MAP,
  FREEPIK_IMAGE_MODELS,
} from './magnificRoutes.ts';
import { callMagnificMcpTool } from './mcpRoutes.ts';
import {
  FAST_MODEL,
  recordAIUsage,
  chargeAICredits,
  hasAICredits,
  callAINonStreaming,
  resolveGeminiModel,
} from '../ai-helpers.ts';
import { generationLimiter } from '../middleware/rateLimiter.ts';
import { triggerAgentCompilation } from '../agent-helpers.ts';
import { generateLuxuryBrandPosterDataUrl } from './dakyworldOsRoutes.ts';
import { invalidateSharedContext } from './agentSharedContext.ts';
import { buildAgentBriefing, handOffApprovedWork, markInboxConsumed, postAgentMessage, renderBriefing } from './agentTeam/coordination.ts';
import { sanitizeAgentMessages, type OutgoingAgentMessage } from './agentTeam/policy.ts';



type AuthResult = { userId: string; role: string } | null;
type DbQueryFn = <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
type AIConfig = Awaited<ReturnType<typeof import('../ai-helpers.ts').getAIConfig>>;

export interface NovaDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  dbQuery: DbQueryFn;
  pool: Pool | null;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: AIConfig) => string;
  decryptAIKey: (key: string) => string;
  AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }>;
}

const USER_AGENT_MODELS: Record<string, string> = {
  sage: 'claude-sonnet-4-6',
  daky: FAST_MODEL,
  nova: FAST_MODEL,
  aria: FAST_MODEL,
  flux: FAST_MODEL,
  promo: FAST_MODEL,
  campaign_brief: FAST_MODEL,
  trend_research: FAST_MODEL,
  audience_research: FAST_MODEL,
  seo_research: FAST_MODEL,
  hook_writing: FAST_MODEL,
  social_caption: FAST_MODEL,
  video_script: FAST_MODEL,
  ad_copy: FAST_MODEL,
  thumbnail_design: FAST_MODEL,
  meta_ads: FAST_MODEL,
};

const USER_AGENT_PROMPTS: Record<string, string> = {
  quality: `You are Vetta, the Quality Control agent on a user's marketing team.
Your job is to review content the other agents produced against the user's brand voice, audience, and goals before it reaches the user.
You flag off-brand tone, factual overreach, weak hooks, and anything that would underperform — and you propose the concrete fix, not just the complaint.`,

  promo: `You are Promo, the Promotion & Media Planner on a user's marketing team.
Your job is to generate 2-3 promotional content proposals — offers, launches, seasonal pushes — each pairing sharp copy with a described featured visual powered by Magnific One, Nano Banana Pro, or Nano Banana 2.
Use the user's liked-image style profile (agent_memory) when present so visuals match their taste.
Each proposal must name the promotion angle, the copy hook, and the exact Magnific prompt:
- For editorial campaigns: Magnific One (draft 16-tile contact sheet -> 2K/4K quality render + 2-3 consistent style references + Brand Kit + Auto Layers).
- For product photography with readable branding/labels: Nano Banana Pro using the 7-Part Typography Hierarchy (1. Composition First, 2. Exact Product Identity, 3. Dedicated Typography Block quoting exact text with no warped glyphs, 4. Specific Color Names, 5. Lighting Harmony, 6. Optical Control, 7. Negative Constraints).
- For branded packaging/merchandise mockups: Nano Banana 2 in 4K with black-on-white logo reference and physical surface finish (deboss on glass/bottles, emboss on boxes, embroidered thread matching fabric on apparel/towels).`,

  daky: `You are Daky, a creative content writer AI agent working for a user's social media marketing team.
Your job is to generate 2-3 concrete content proposals based on the user's brand profile, active platforms, and marketing goals.
Each proposal should be a ready-to-use content piece or a clearly actionable content brief, and when pairing with visuals, video, lip-sync avatars, or audio, specify the exact Magnific One, Nano Banana Pro/2, Seedance 2.5, Kling 3.0 / Omni, Kling 2.6 Motion Control, OmniHuman 1.5, or Magnific Audio prompt and parameters.
You always match the user's brand tone and speak to their target audience.`,

  nova: `You are Nova, an AI creative director working for a user's social media marketing team and master of the Magnific Academy Multimodal Suite (Magnific One, Nano Banana Pro, Nano Banana 2, Mystic, Flux Kontext Pro, Creative & Precision Upscaler, Relight, Style Transfer, Image Expand, Variations Reframe/Storyboard, Designer Auto Layers, Seedance 2.5, Kling 3.0 Single/Multi-Shot, Kling 3.0 Omni, Kling 2.6 Motion Control, LTX 2 Pro, 3D Scenes, OmniHuman 1.5 Lip Sync, Sound Effects, ElevenLabs Music, SAM Audio Isolation, and Magnific Spaces, Lists & Flows).
Your job is to generate 2-3 visual/multimodal proposals based on the user's brand.
Follow Magnific Academy Golden Rules:
1. Always specify exact model, aspect ratio, resolution, and background rules explicitly.
2. For reusable characters/products: generate on a plain white studio background first ('nano-banana-2' in 4K) and build a single multi-view Character Profile Sheet (front, side, back, passport faces) to anchor consistency across all scenes; keep Character, Location, and Object nodes separate.
3. For Magnific One: use Draft mode (tiles: 16 for exact aspect ratios across all 10 ratios) -> Final mode (2K/4K, High/Max), use 2-3 visually consistent style references (sweet spot), and pair with Brand Kit + Designer Auto Layers.
4. For product micro-typography ('nano-banana-pro'): apply the 7-Part Hierarchy (Composition -> Exact Identity -> Dedicated Typography Block -> Specific Colors -> Lighting -> Optical Clarity -> Negative Constraints).
5. For videos: use Seedance 2.5 in 15s chunks (480p/720p exploration -> 1080p production -> 4K Video Upscaler Precision/Creative + FPS Boost) with "no music" in multi-clip prompts (score music separately in ElevenLabs Music); use Kling 3.0 7-part formula (or action/camera-only when a Start Image is used, and <=512 chars/shot in Multi-Shot mode); use Kling 3.0 Omni with image references for multi-character lip-sync dialogue, object swaps, and product text stability in motion; and for Kling 2.6 Motion Control, NEVER describe the physical action in the prompt—only camera movement!`,

  sage: `You are Sage, an AI strategy analyst working for a user's social media marketing team.
Your job is to generate 2-3 strategic marketing proposals based on the user's goals, audience, niche, and connected platforms.
Each proposal should be a concrete, actionable strategy recommendation — not vague advice.
Think like a CMO: identify specific opportunities, gaps, or plays that will move the needle on their goals.`,

  aria: `You are Aria, an AI analytics and performance specialist working for a user's social media marketing team.
Your job is to generate 2-3 data-driven insights or performance improvement proposals based on the user's connected platforms and brand goals.
Each proposal should identify a specific metric to track, an optimization to make, or an audit to run.
Be concrete — name the platform, the metric, and the expected impact.`,

  flux: `You are Flux, an AI automation and workflow specialist working for a user's social media marketing team.
Your job is to generate 2-3 automation or workflow proposals based on the user's connected platforms, Magnific Spaces, Lists & Flows, and content cadence.
Each proposal should describe a specific automation or reusable Magnific Flow to set up — such as:
- Pre-flight cost simulation -> Assistant 'Export as List' -> List node batching (e.g. 20-language ad localization or Designer Node pink-placeholder multi-variant posts)
- White-background Character Profile Sheet ('nano-banana-2' 4K) -> Scene Stills -> Seedance 2.5 / Kling 3.0 Omni video -> Media Extractor trim -> Video Combiner + ElevenLabs Music -> 4K Video Upscaler -> scheduled cross-posting.
Be specific about which platforms, what triggers the automation, and what outcome it achieves.`,

  trend_research: `You are Trend, an AI trend research specialist for a user's marketing team.
Your job is to generate 2-3 proposals identifying trending topics, viral formats, or rising niche conversations the brand should act on.
Each proposal should name a specific trend, explain why it's relevant to this brand, and suggest a concrete content angle to capitalize on it.`,

  audience_research: `You are Persona, an AI audience research specialist for a user's marketing team.
Your job is to generate 2-3 audience insight proposals — detailed personas, pain-point analyses, or objection maps — tailored to the brand's niche.
Each proposal should be specific enough to directly inform content creation or messaging strategy.`,

  seo_research: `You are SEO, an AI keyword research specialist for a user's marketing team.
Your job is to generate 2-3 SEO proposals — keyword clusters, content brief outlines, or search-intent analyses — that will drive organic traffic.
Each proposal should name specific keywords, explain the search intent, and suggest a content format to target them.`,

  hook_writing: `You are Hook, an AI hook-writing specialist for a user's marketing team.
Your job is to generate 2-3 proposals each containing 5-10 scroll-stopping hook variations — opening lines, subject lines, or ad headlines — for the brand's content.
Each proposal should be tied to a specific platform or content type and explain why the hooks work.`,

  social_caption: `You are Caption, an AI social caption specialist for a user's marketing team.
Your job is to generate 2-3 platform-specific caption proposals with hooks, body copy, CTAs, and relevant hashtags.
Tailor each proposal to the platform's format (Instagram, TikTok, LinkedIn, Twitter/X) and the brand's tone.`,

  video_script: `You are Script, an AI video script and Magnific Academy Video/Lip-Sync director for a user's marketing team.
Your job is to generate 2-3 video script proposals — UGC digital influencer reviews, Seedance 2.5 multi-clip narrative stories, Kling 3.0 Single/Multi-Shot sequences, Kling 3.0 Omni reference-driven dialogue scenes, Kling 2.6 Motion Control clips, or OmniHuman 1.5 talking avatars.
Follow Magnific Academy Video Doctrine in every proposal:
- For Seedance 2.5 stories: divide into 15-second chunks at 1080p, connect Character Profile Sheet + Location references, enable native dialogue/SFX but explicitly include "no music" in the video prompt (score music separately in ElevenLabs Music across emotional acts), and use Media Extractor / Clip Modify for surgical fixes.
- For Kling 3.0 without Start Image: use the 7-Part Formula (Environment/Lighting -> Shot Framing -> Specific Character Traits -> Physical Action -> Cinematic Camera Move -> Visual Detail -> Ambient Sound). With a Start Image: prompt ONLY action and camera movement. In Multi-Shot mode: up to 6 shots, each <=512 characters, total <=15s.
- For Kling 3.0 Omni: attach Character + Environment + Product references (no rigid Start Image) for expressive lip-sync dialogue or readable product typography in motion.
- For Kling 2.6 Motion Control: NEVER describe the physical action in the prompt—describe ONLY camera framing and orbit/tracking movement!`,

  ad_copy: `You are Ads, an AI ad copywriter for a user's marketing team.
Your job is to generate 2-3 ad copy proposals — each targeting a specific angle (pain, benefit, social proof) for Meta, Google, or YouTube ads.
Include multiple headline and body copy variations per proposal with a clear CTA.`,

  thumbnail_design: `You are Thumb, an AI thumbnail design strategist for a user's marketing team powered by Magnific One, Nano Banana Pro, and Precision Upscaler.
Your job is to generate 2-3 thumbnail design proposals for YouTube or social ads — including Magnific One 16:9 concept direction (draft 16-tile contact sheet -> 4K render with 2-3 consistent style references), Nano Banana Pro 7-part typography control, color palette, and A/B test variants.
Each proposal should be specific enough for Magnific One or Nano Banana Pro to execute immediately.`,

  meta_ads: `You are Meta, an AI paid social manager for a user's marketing team.
Your job is to generate 2-3 Meta (Facebook/Instagram) campaign proposals — including campaign objective, audience targeting, budget structure, and creative direction.
Each proposal should include a brief performance optimization checklist.`,

  campaign_brief: `You are Brief, an AI campaign brief builder for a user's marketing team.
Your job is to generate 2-3 complete, multi-channel campaign briefs with objectives, channel allocations, Magnific Space/Flow production pipelines (using the 6-folder Candela structure: character, locations, still frames, videos, audio, final edit), content calendar milestones, and KPI targets.
Each proposal must be clear, actionable, and ready for immediate execution by the content and media team.`,
};

const USER_AGENT_CHAT_PROMPTS: Record<string, string> = {
  sage: `You are Sage, a strategic marketing analyst AI. Help the user think through their marketing strategy, audience positioning, and growth priorities. Be thoughtful and data-informed. Keep replies focused — 2-4 sentences unless asked for detail.`,
  trend_research: `You are Trend, an AI trend researcher. Chat with the user about viral formats, rising industry topics, and emerging consumer conversations in their niche. Keep replies energetic and timely.`,
  audience_research: `You are Persona, an AI audience researcher. Chat with the user about their ideal customer profile, deep emotional pain points, buying objections, and psychological triggers.`,
  seo_research: `You are SEO, an organic search keyword strategist. Chat with the user about search intent, high-converting keyword clusters, backlink angles, and ranking opportunities.`,
  daky: `You are Daky, a creative content writer AI on the user's marketing team. Help them brainstorm content ideas, refine copy, and pair content with Magnific One visuals, Nano Banana Pro/2 product shots, Seedance 2.5 / Kling 3.0 Omni videos, or OmniHuman 1.5 talking avatars. Be conversational, encouraging, and creative.`,
  hook_writing: `You are Hook, an AI headline and hook master. Help the user craft scroll-stopping opening lines, subject lines, and attention-grabbing headlines. Always offer 2-3 variations.`,
  social_caption: `You are Caption, a social media copy specialist. Write platform-optimized captions with strong hooks, structured bodies, clear CTAs, and relevant hashtags for Instagram, TikTok, LinkedIn, or X.`,
  video_script: `You are Script, a video retention scriptwriter and Magnific Academy Video/Lip-Sync director. Guide the user on Seedance 2.5 (15s chunks, 50 refs, "no music" multi-clip rule, surgical frame fixes & Modify), Kling 3.0 (7-part T2V formula, action-only I2V, 6-cut Multi-Shot <=512 chars/shot), Kling 3.0 Omni (multi-ref dialogue lip-sync & product text continuity), Kling 2.6 Motion Control (camera-only prompt rule), 3D Scenes motion transfer, and UGC influencer workflows.`,
  nova: `You are Nova, a creative director AI and master of the Magnific Academy Suite: Magnific One (16-tile draft -> 4K final, 2-3 style ref sweet spot, Brand Kit + Auto Layers), Nano Banana Pro (7-part product typography hierarchy, sketch-to-modular interiors @img1+@img2, surgical frame/background edits), Nano Banana 2 (4K white-background Character Profile Sheets & deboss/emboss/embroidered mockups), Variations (Reframe/Storyboard + Split Grid + Upscaler), Seedance 2.5, Kling 3.0 / Omni / Motion Control, 3D Scenes, and Magnific Spaces, Lists & Flows.`,
  ad_copy: `You are Ads, a direct-response ad copywriter. Help the user craft high-converting Meta, Google, and TikTok ad angles (Pain, Transformation, Social Proof, Urgency).`,
  thumbnail_design: `You are Thumb, a visual packaging and thumbnail strategist using Magnific One, Nano Banana Pro, and Precision Upscaler. Advise on high-CTR thumbnail layouts, 7-part typography control, color psychology, text badges, and facial emotion framing.`,
  meta_ads: `You are Meta, a paid social performance manager. Advise the user on campaign budget optimization (CBO), creative testing structures, audience exclusions, and scaling setups.`,
  aria: `You are Aria, an analytics and performance AI. Help the user understand their KPIs, interpret metrics, and find optimisation opportunities. Be precise and quantitative.`,
  flux: `You are Flux, an automation, Magnific Space/List/Flow, and workflow AI. Help the user design Assistant 'Export as List' batch pipelines (20-language ad translation, Designer Node pink-placeholder automation, Group->List->Batch Upscaler), reusable Flows, and cross-channel scheduling.`,
  campaign_brief: `You are Brief, a full-funnel campaign planner. Help the user blueprint multi-week launch campaigns, 6-folder Magnific Space production pipelines (character, locations, still frames, videos, audio, final edit), channel coordination, and success metrics.`,
};

const REPLICATE_BASE = 'https://api.replicate.com';

const REPLICATE_MODEL_MAP: Record<string, { owner: string; name: string }> = {
  'flux-2-turbo':          { owner: 'black-forest-labs', name: 'flux-schnell' },
  'flux-2-klein':          { owner: 'black-forest-labs', name: 'flux-schnell' },
  'hyperflux':             { owner: 'black-forest-labs', name: 'flux-schnell' },
  'z-image':               { owner: 'black-forest-labs', name: 'flux-schnell' },
  'nano-banana-pro-flash': { owner: 'black-forest-labs', name: 'flux-schnell' },
  'flux-kontext-pro':      { owner: 'black-forest-labs', name: 'flux-dev' },
  'flux-2-pro':            { owner: 'black-forest-labs', name: 'flux-dev' },
  'flux-dev':              { owner: 'black-forest-labs', name: 'flux-dev' },
  'flux-pro-v1-1':         { owner: 'black-forest-labs', name: 'flux-dev' },
  'seedream-v5-lite':      { owner: 'black-forest-labs', name: 'flux-dev' },
  'seedream-v4-5':         { owner: 'black-forest-labs', name: 'flux-dev' },
  'seedream-v4':           { owner: 'black-forest-labs', name: 'flux-dev' },
  'gemini-flash':          { owner: 'black-forest-labs', name: 'flux-dev' },
  'nano-banana-pro':       { owner: 'black-forest-labs', name: 'flux-dev' },
  'nano-banana-2':         { owner: 'black-forest-labs', name: 'flux-dev' },
  'mystic':                { owner: 'black-forest-labs', name: 'flux-dev' },
};

const REPLICATE_ASPECT_MAP: Record<string, string> = {
  'square_1_1':      '1:1',
  'widescreen_16_9': '16:9',
  'portrait_9_16':   '9:16',
  'classic_4_3':     '4:3',
  'portrait_3_4':    '3:4',
  'cinematic_21_9':  '21:9',
};

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function replicateGenerateImage(
  magnificModelId: string,
  prompt: string,
  magnificAspect: string,
  apiKey: string,
): Promise<{ url: string | null; error: string | null }> {
  const mdl = REPLICATE_MODEL_MAP[magnificModelId] ?? { owner: 'black-forest-labs', name: 'flux-schnell' };
  const aspect = REPLICATE_ASPECT_MAP[magnificAspect] ?? '1:1';

  const submitResp = await axios.post(
    `${REPLICATE_BASE}/v1/models/${mdl.owner}/${mdl.name}/predictions`,
    { input: { prompt, aspect_ratio: aspect, output_format: 'webp', output_quality: 85, num_outputs: 1 } },
    {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=30',
      },
      validateStatus: () => true,
      timeout: 40000,
    },
  );

  if (submitResp.status === 401) return { url: null, error: 'Invalid Replicate API token' };
  if (submitResp.status >= 400) {
    return { url: null, error: submitResp.data?.detail ?? submitResp.data?.error ?? `Replicate error ${submitResp.status}` };
  }

  let prediction = submitResp.data;

  if (prediction.status === 'succeeded') {
    const url: string = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return { url: url ?? null, error: url ? null : 'No output from Replicate' };
  }

  const pollUrl: string = prediction.urls?.get;
  if (!pollUrl) return { url: null, error: 'No prediction URL from Replicate' };

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await axios.get(pollUrl, {
      headers: { 'Authorization': `Token ${apiKey}` },
      validateStatus: () => true,
      timeout: 10000,
    });
    if (poll.status >= 400) continue;
    const p = poll.data;
    if (p.status === 'succeeded') {
      const url: string = Array.isArray(p.output) ? p.output[0] : p.output;
      return { url: url ?? null, error: url ? null : 'No output from Replicate' };
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      return { url: null, error: p.error ?? 'Replicate generation failed' };
    }
  }
  return { url: null, error: 'Timeout: Replicate generation took too long' };
}

type WfSeed = { name: string; description: string; steps: any[] };
const WORKFLOW_DEFAULTS: Record<string, WfSeed[]> = {
  nova: [
    {
      name: 'Brand Identity Visual', description: 'Search design concepts, tailor to brand memory, then generate an art-directed hero image via Magnific One.',
      steps: [
        { id: 'step_search',   name: 'Search Designs',        tool: 'meigen_search',         description: 'Find design templates', prompt_template: 'Search for designs matching: {input}. Style niche: {brand.niche}', params: { top_n: 5 } },
        { id: 'step_extract',  name: 'Extract Style Prompts', tool: 'claude_synthesize',      description: 'Extract visual styles and prompts', prompt_template: 'Extract 2–3 visually consistent style directions with image prompts from:\n{step_search.result}', params: {} },
        { id: 'step_tailor',   name: 'Tailor to Brand',       tool: 'claude_synthesize',      description: 'Blend inspiration with brand memory', prompt_template: 'Create one optimized Magnific One creative-director intent prompt (subject, context, lighting, palette — no --ar flags) for brand:\nNiche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\nDesigns: {step_extract.result}\n\nReturn ONLY JSON: { "prompt": "...", "model": "magnific-one", "mode": "quality", "resolution": "2k" }', params: {} },
        { id: 'step_generate', name: 'Generate via Magnific One', tool: 'magnific_one_generate', description: 'Generate art-directed image via Magnific One', prompt_template: '{step_tailor.prompt}', params: { auto_if_memory: true, mode: 'quality', resolution: '2k' } },
        { id: 'step_save',     name: 'Save Design',           tool: 'save_design',            description: 'Save to designs collection', prompt_template: '', params: {} },
      ],
    },
    {
      name: 'Product Photography & Typography (Nano Banana Pro)', description: 'Generate tack-sharp product photography with accurate micro-typography using the 7-Part Magnific Academy Hierarchy.',
      steps: [
        { id: 'step_brief',    name: '7-Part Typography Prompt', tool: 'claude_synthesize',    description: 'Structure 7-part Nano Banana Pro prompt', prompt_template: 'Write a structured Nano Banana Pro prompt for {input} following the exact 7-Part Hierarchy:\n1. Composition First (diagonal/editorial framing & directional light)\n2. Exact Product Identity (proportions, silhouette, stitching, geometry)\n3. Dedicated Typography Block (exact quoted text, placement, alignment, "no misspellings, no extra letters, no warped glyphs")\n4. True Color Accuracy (specific color names)\n5. Lighting & Harmony\n6. Optical Control (shallow depth of field, tack-sharp focus on product and typography)\n7. Negative Constraints ("no extra logos, no duplicated text, no invented branding, no distorted lettering").\nBrand: {brand.niche}, tone: {brand.tone}\nReturn ONLY JSON: { "prompt": "...", "model": "nano-banana-pro" }', params: {} },
        { id: 'step_generate', name: 'Render via Nano Banana Pro', tool: 'generate_image',     description: 'Generate product shot with Nano Banana Pro', prompt_template: '{step_brief.prompt}', params: { model: 'nano-banana-pro', resolution: '2k' } },
        { id: 'step_save',     name: 'Save Design',              tool: 'save_design',          description: 'Save to designs', prompt_template: '', params: {} },
      ],
    },
    {
      name: 'Branded Surface Mockup (Nano Banana 2 4K)', description: 'Create a 4K branded mockup with realistic deboss, emboss, or embroidered surface integration via Nano Banana 2.',
      steps: [
        { id: 'step_concept',  name: 'Build Surface Mockup Prompt', tool: 'claude_synthesize', description: 'Define surface finish (deboss/emboss/embroidery)', prompt_template: 'Write a Nano Banana 2 4K branded mockup prompt for: {input}\nNiche: {brand.niche}, tone: {brand.tone}\nSpecify clean editorial composition and physical brand integration (deboss on glass/bottles, emboss on packaging boxes, or embroidered thread matching fabric on apparel/towels), respecting edge margins, contact shadows, and surface texture.\nReturn ONLY JSON: { "prompt": "...", "model": "nano-banana-2", "aspect_ratio": "3:4" }', params: {} },
        { id: 'step_generate', name: 'Render via Nano Banana 2',    tool: 'generate_image',    description: 'Generate 4K mockup via Nano Banana 2', prompt_template: '{step_concept.prompt}', params: { model: 'nano-banana-2', aspect_ratio: '3:4', resolution: '4k' } },
        { id: 'step_save',     name: 'Save Design',                 tool: 'save_design',       description: 'Save to designs', prompt_template: '', params: {} },
      ],
    },
    {
      name: 'AI Brand Video (Seedance 2.5 / Kling 3.0)', description: 'Generate a cinematic branded video using the Magnific Academy 7-Part Video Formula (Kling 3.0 / Seedance 2.5).',
      steps: [
        { id: 'step_script',   name: 'Write 7-Part Video Brief', tool: 'claude_synthesize',    description: 'Draft structured 7-part video prompt', prompt_template: 'Write a cinematic video prompt (under 140 words) for: {input}\nNiche: {brand.niche}, tone: {brand.tone}\nFollow the Magnific Academy 7-Part Video Formula: (1) Environment & Lighting, (2) Shot Framing, (3) Specific Character/Subject Details, (4) Main Physical Action, (5) Cinematic Camera Movement (slow dolly-in, handheld tracking, orbit), (6) Visual Detail, (7) Synchronized Ambient Sound.\nReturn ONLY JSON: { "prompt": "...", "model": "kling-3-0" }', params: {} },
        { id: 'step_generate', name: 'Generate Video',           tool: 'generate_video',       description: 'Generate branded video via Magnific', prompt_template: '{step_script.prompt}', params: { model: 'kling-3-0' } },
      ],
    },
    {
      name: 'Magnific One 16-Tile Draft & 4K Space', description: 'Explore 16 visual directions in a draft contact sheet, then render a 4K hero image in a Magnific Space.',
      steps: [
        { id: 'step_concepts', name: 'Art Direction Brief', tool: 'claude_synthesize',        description: 'Draft art-direction intent prompt', prompt_template: 'Art-directed campaign visual prompt for: {input}\nBrand: {brand.niche}, tone: {brand.tone}\nReturn ONLY JSON: { "prompt": "...", "aspect_ratio": "16:9" }', params: {} },
        { id: 'step_space',    name: 'Run Magnific Space',  tool: 'magnific_space_flow',      description: 'Execute 16-tile draft -> 4K hero Space', prompt_template: '{step_concepts.result}', params: { action: 'run_space' } },
        { id: 'step_save',     name: 'Save Design',         tool: 'save_design',              description: 'Save to designs', prompt_template: '', params: {} },
      ],
    },
  ],
  sage: [
    {
      name: 'Competitor Analysis', description: 'Analyze competitors and surface strategic differentiation opportunities.',
      steps: [
        { id: 'step_research', name: 'Research Competitors', tool: 'claude_synthesize',       description: 'Generate competitor landscape', prompt_template: 'Competitor analysis for {brand.niche}.\nRequest: {input}\nAudience: {brand.audience}\n\nAnalyze top 3–5 competitors: positioning, content strategy, strengths/weaknesses, gaps.', params: {} },
        { id: 'step_summary',  name: 'Strategic Summary',   tool: 'claude_synthesize',        description: 'Distill into recommendations', prompt_template: 'From this analysis:\n{step_research.result}\n\nWrite strategic recommendations: differentiation opportunities, content gaps, positioning angle, top 3 actions.', params: {} },
      ],
    },
    {
      name: 'Content Strategy Plan', description: 'Build a 30-day content strategy aligned to brand goals.',
      steps: [
        { id: 'step_audit',  name: 'Audit Brand Positioning', tool: 'claude_synthesize',      description: 'Assess positioning and gaps', prompt_template: 'Audit content positioning for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}\nRequest: {input}\n\nIdentify: gaps, pain points, content pillars, platforms to prioritize.', params: {} },
        { id: 'step_plan',   name: 'Build 30-Day Plan',       tool: 'claude_synthesize',      description: 'Create monthly content plan', prompt_template: 'Using this audit:\n{step_audit.result}\n\nBuild a 30-day content strategy: 4 weekly themes, daily post types, platform mix, KPIs to track.', params: {} },
      ],
    },
    {
      name: 'Audience Persona Builder', description: 'Create 3 detailed target audience personas with actionable insights.',
      steps: [
        { id: 'step_research', name: 'Research Audience',  tool: 'claude_synthesize',         description: 'Research audience characteristics', prompt_template: 'Target audience research for {brand.niche}.\nCurrent audience: {brand.audience}\nRequest: {input}\n\nIdentify: demographics, psychographics, pain points, goals, preferred platforms, purchasing triggers.', params: {} },
        { id: 'step_personas', name: 'Build 3 Personas',  tool: 'claude_synthesize',          description: 'Create persona profiles', prompt_template: 'Create 3 detailed audience personas from:\n{step_research.result}\n\nEach persona: name, age/role, goals, pain points, preferred content, platforms, how this brand helps.', params: {} },
      ],
    },
    {
      name: 'Campaign Brief Writer', description: 'Write a complete marketing campaign brief from goals to creative direction.',
      steps: [
        { id: 'step_objectives', name: 'Define Objectives', tool: 'claude_synthesize',        description: 'Clarify campaign goals', prompt_template: 'Campaign objectives for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nSpecify: primary goal, KPIs, target segment, timeline, budget framework.', params: {} },
        { id: 'step_brief',      name: 'Write Full Brief',  tool: 'claude_synthesize',        description: 'Write comprehensive brief', prompt_template: 'Campaign brief from:\n{step_objectives.result}\n\nInclude: concept, messaging framework, content mix, channel strategy, creative direction, timeline, success criteria.', params: {} },
      ],
    },
    {
      name: 'Brand Positioning Statement', description: 'Craft a compelling brand positioning statement and tagline.',
      steps: [
        { id: 'step_analysis',  name: 'Positioning Analysis', tool: 'claude_synthesize',      description: 'Analyze brand differentiators', prompt_template: 'Positioning analysis for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}\nInput: {input}\n\nIdentify: unique value props, differentiators, emotional and functional benefits, competitive gaps.', params: {} },
        { id: 'step_statement', name: 'Write Positioning',    tool: 'claude_synthesize',      description: 'Draft positioning options', prompt_template: 'From this analysis:\n{step_analysis.result}\n\nWrite 3 brand positioning statements for {brand.niche}. Include a tagline for each.', params: {} },
      ],
    },
  ],
  aria: [
    {
      name: 'Performance Summary', description: 'Analyze KPIs and surface actionable performance insights.',
      steps: [
        { id: 'step_kpis',     name: 'Define Key Metrics',  tool: 'claude_synthesize',        description: 'Identify critical KPIs', prompt_template: '5 critical KPIs for {brand.niche}.\nRequest: {input}, audience: {brand.audience}\n\nFor each KPI: what it measures, why it matters, benchmark target, how to improve.', params: {} },
        { id: 'step_insights', name: 'Synthesize Insights', tool: 'claude_synthesize',        description: 'Distill into recommendations', prompt_template: 'Performance summary from KPIs:\n{step_kpis.result}\n\nFor {brand.niche}: overall health score (1–10), top areas, underperforming areas, 3 immediate optimization recommendations.', params: {} },
      ],
    },
    {
      name: 'Engagement Analysis', description: 'Break down content engagement patterns to identify what resonates.',
      steps: [
        { id: 'step_patterns', name: 'Analyze Patterns',    tool: 'claude_synthesize',        description: 'Identify engagement patterns', prompt_template: 'Engagement patterns for {brand.niche} targeting {brand.audience}.\nRequest: {input}\n\nBreak down: best content types, optimal posting times, engagement benchmarks, format performance.', params: {} },
        { id: 'step_recs',     name: 'Engagement Playbook', tool: 'claude_synthesize',        description: 'Create optimization playbook', prompt_template: 'From these patterns:\n{step_patterns.result}\n\nPlaybook for {brand.niche}: top 3 formats, posting schedule, caption/CTA strategies, community tactics, A/B test ideas.', params: {} },
      ],
    },
    {
      name: 'Growth Opportunity Report', description: 'Identify and prioritize the highest-impact growth opportunities.',
      steps: [
        { id: 'step_gaps',   name: 'Find Growth Gaps',    tool: 'claude_synthesize',          description: 'Identify underexplored opportunities', prompt_template: 'Growth opportunities for {brand.niche}.\nAudience: {brand.audience}, tone: {brand.tone}\nRequest: {input}\n\nAnalyze: untapped formats, underutilized platforms, audience segments, hashtag/SEO gaps, partnerships.', params: {} },
        { id: 'step_report', name: 'Prioritize & Plan',   tool: 'claude_synthesize',          description: 'Prioritize by impact and effort', prompt_template: 'From these opportunities:\n{step_gaps.result}\n\nPrioritized growth plan for {brand.niche}: quick wins (this week), medium-term (this month), long-term (this quarter). Each: opportunity, impact, effort, first step.', params: {} },
      ],
    },
    {
      name: 'Monthly Insights Report', description: 'Compile a comprehensive monthly performance report with next-month strategy.',
      steps: [
        { id: 'step_review',  name: 'Monthly Review',       tool: 'claude_synthesize',        description: 'Review monthly performance', prompt_template: 'Monthly review for {brand.niche}.\nRequest: {input}, audience: {brand.audience}\n\nCover: content volume, engagement trends, growth, top posts, biggest misses, revenue/lead impact.', params: {} },
        { id: 'step_forward', name: 'Next Month Strategy',  tool: 'claude_synthesize',        description: 'Draft next month recommendations', prompt_template: 'From this monthly review:\n{step_review.result}\n\nNext-month strategy for {brand.niche}: double down, stop/fix, tests to run, focus KPIs, content themes.', params: {} },
      ],
    },
  ],
  flux: [
    {
      name: 'Content Repurposer', description: 'Adapt one piece of content into platform-specific formats for maximum reach.',
      steps: [
        { id: 'step_analyze',   name: 'Analyze Source Content',     tool: 'claude_synthesize',  description: 'Extract core message and intent', prompt_template: 'Analyze for repurposing: {input}\nBrand: {brand.niche}, tone: {brand.tone}\n\nExtract: core message, key quotes, supporting points, target emotion, content type.', params: {} },
        { id: 'step_repurpose', name: 'Generate Platform Variants', tool: 'draft_content',      description: 'Write platform-specific variations', prompt_template: 'Repurpose this content:\n{step_analyze.result}\n\nWrite variants for:\n1. Instagram caption (150 chars + hashtags)\n2. LinkedIn post (200 words)\n3. Twitter/X thread (3–5 tweets)\n4. TikTok script (30-sec)\n5. Email newsletter intro (100 words)\n\nTone: {brand.tone}', params: {} },
      ],
    },
    {
      name: 'Caption & Hashtag Generator', description: 'Write 3 caption variations and a tiered hashtag strategy for any post.',
      steps: [
        { id: 'step_caption',  name: 'Write Caption Options', tool: 'draft_content',           description: 'Generate 3 caption variations', prompt_template: '3 caption variations for: {input}\nNiche: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\n1. Hook-driven\n2. Storytelling\n3. Value-first\n\nEach 80–150 chars with CTA.', params: {} },
        { id: 'step_hashtags', name: 'Hashtag Strategy',      tool: 'draft_content',           description: 'Categorize hashtags by reach tier', prompt_template: 'Hashtag strategy for: {input}\nNiche: {brand.niche}\n\n30 hashtags across 3 tiers:\n- 10 High-reach (1M+ posts)\n- 10 Mid-reach (100K–1M)\n- 10 Niche (10K–100K)\n\nPlus 5 brand-specific hashtags.', params: {} },
      ],
    },
    {
      name: 'Weekly Content Plan', description: 'Build a complete 7-day posting schedule with themes and caption ideas.',
      steps: [
        { id: 'step_themes',   name: 'Define Weekly Themes',    tool: 'draft_content',          description: 'Establish 7 daily content themes', prompt_template: 'Weekly content themes for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}, goal: {input}\n\n7 daily themes using pillars: educational, entertaining, promotional, engagement, behind-scenes, user stories, trending.', params: {} },
        { id: 'step_schedule', name: 'Build Posting Schedule',  tool: 'draft_content',          description: 'Create the full 7-day schedule', prompt_template: 'From these themes:\n{step_themes.result}\n\n7-day posting plan for {brand.niche}: day, time, platform, content type, caption idea, visual direction. Include 2 reels, 3 static posts, 1 carousel, 1 story series.', params: {} },
      ],
    },
    {
      name: 'Post Batch Generator', description: 'Generate 10 ready-to-use post ideas with captions for bulk scheduling.',
      steps: [
        { id: 'step_ideas',    name: 'Generate Post Ideas', tool: 'draft_content',             description: 'Brainstorm 10 post concepts', prompt_template: '10 post ideas for {brand.niche}.\nTone: {brand.tone}, audience: {brand.audience}, topic: {input}\n\nFor each: title, format, hook, message, platform, angle.', params: {} },
        { id: 'step_captions', name: 'Write All Captions',  tool: 'draft_content',             description: 'Write captions for all posts', prompt_template: 'Captions for all 10 posts:\n{step_ideas.result}\n\nEach: full caption (100–200 chars), 3 emojis, CTA, 5–10 hashtags. Tone: {brand.tone}', params: {} },
      ],
    },
  ],
  daky: [
    {
      name: 'Full Campaign Launch', description: 'Orchestrate a complete campaign — strategy, content framework, and master brief.',
      steps: [
        { id: 'step_strategy', name: 'Campaign Strategy',     tool: 'claude_synthesize',       description: 'Define strategy and objectives', prompt_template: 'Full campaign strategy for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nDefine: name, objective, key message, target segment, channels, timeline, content mix, success metrics.', params: {} },
        { id: 'step_content',  name: 'Content Framework',     tool: 'draft_content',           description: 'Create execution content plan', prompt_template: 'Content framework from:\n{step_strategy.result}\n\nFor {brand.niche}: launch week plan (7 posts), visual direction brief for Nova, copy guide for Flux, KPIs for Aria, automation notes for Flux.', params: {} },
        { id: 'step_brief',    name: 'Master Campaign Brief', tool: 'claude_synthesize',       description: 'Compile master brief for all agents', prompt_template: 'Master brief from:\nStrategy: {step_strategy.result}\nContent: {step_content.result}\n\nActionable brief for each role: creative, content, analytics. Include: overview, role briefs, timeline, dependencies, launch checklist.', params: {} },
      ],
    },
    {
      name: 'Brand Onboarding', description: 'Guide a new user through brand setup and prepare all agents for first use.',
      steps: [
        { id: 'step_collect', name: 'Brand Discovery',    tool: 'claude_synthesize',           description: 'Extract and organize brand information', prompt_template: 'Onboarding a new brand.\nInput: {input}\n\nExtract: business name, industry, target audience, tone/personality, products/services, competitors, marketing goals, social presence. Format as structured brand profile.', params: {} },
        { id: 'step_memory',  name: 'Memory Setup Guide', tool: 'claude_synthesize',           description: 'Create memory setup guide for the user', prompt_template: 'Memory setup guide from:\n{step_collect.result}\n\nExplain: what to save in Brand Memory, suggested keywords, which agent handles what, recommended first workflows, 7-day quick-start plan.', params: {} },
      ],
    },
    {
      name: 'Weekly Marketing Review', description: 'Compile a cross-team weekly review with performance insights and next-week priorities.',
      steps: [
        { id: 'step_review', name: 'Weekly Review',          tool: 'claude_synthesize',        description: 'Analyze the week across all dimensions', prompt_template: 'Weekly review for {brand.niche}.\nContext: {input}, audience: {brand.audience}\n\nCover: content performance, engagement trends, top/bottom posts, audience growth, campaign progress, what worked and what did not.', params: {} },
        { id: 'step_plan',   name: 'Next Week Action Plan',  tool: 'claude_synthesize',        description: 'Draft next week priorities per agent', prompt_template: 'From this review:\n{step_review.result}\n\nNext-week action plan for {brand.niche}:\n- Nova: visuals to create\n- Sage: strategy adjustments\n- Flux: automation tasks\n- Aria: metrics to focus on\n- Key decisions and deadlines', params: {} },
      ],
    },
  ],
};

// One agent run: what it proposed, what it asked teammates, and which inbox
// messages it was shown.
type AgentTurn = { proposals: any[]; messages: OutgoingAgentMessage[]; inboxIds: string[] };

export function buildNovaModule(deps: NovaDeps): {
  router: Router;
  runScheduledAgents: () => Promise<void>;
  runAgentForUser: (userId: string, agentKey: string, reason: string) => Promise<number>;
} {
  const { requireAuth, requireAdmin, hasDatabase, dbQuery, pool, getAIConfig, resolveActiveKey, decryptAIKey, AGENT_DEFS } = deps;

  const AGENT_NAMES: Record<string, string> = Object.fromEntries(Object.entries(AGENT_DEFS).map(([k, v]) => [k, v.name]));

  async function getReplicateApiKey(): Promise<string> {
    // Admin-configured key wins; env is fallback only
    try {
      const cfg = await pool!.query(`SELECT config FROM platform_configs WHERE platform = 'replicate' LIMIT 1`);
      const dbKey: string = decryptPlatformConfig(cfg.rows[0]?.config)?.apiKey ?? '';
      if (dbKey) return dbKey;
    } catch (_err) { /* fall through to env */ }
    return process.env.REPLICATE_API_TOKEN || '';
  }

  async function gatherPlatformSnapshot(agentKey: string): Promise<Record<string, any>> {
    if (!pool) return {};
    const data: Record<string, any> = { snapshot_at: new Date().toUTCString() };
    const safe = async (label: string, fn: () => Promise<any>) => {
      try { data[label] = await fn(); } catch (_err) { /* skip incomplete data */ }
    };
    await safe('users', async () => {
      const { rows } = await dbQuery(`
        SELECT
          COUNT(*)                                                           AS total,
          COUNT(*) FILTER (WHERE status='active')                           AS active,
          COUNT(*) FILTER (WHERE status='suspended')                        AS suspended,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')   AS new_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS new_24h
        FROM users WHERE role = 'user'
      `);
      return rows[0];
    });
    if (['ceo', 'cro'].includes(agentKey)) {
      await safe('revenue', async () => {
        const { rows } = await dbQuery(`
          SELECT
            COALESCE(SUM(amount) FILTER (WHERE status='success'), 0)                                    AS total_revenue,
            COALESCE(SUM(amount) FILTER (WHERE status='success' AND created_at > NOW()-INTERVAL '30 days'), 0) AS revenue_30d,
            COALESCE(SUM(amount) FILTER (WHERE status='success' AND created_at > NOW()-INTERVAL '7 days'), 0)  AS revenue_7d,
            COUNT(*) FILTER (WHERE status='success')  AS successful_transactions,
            COUNT(*) FILTER (WHERE status='failed')   AS failed_transactions,
            COUNT(*) FILTER (WHERE status='pending')  AS pending_transactions
          FROM payment_transactions
        `);
        return rows[0];
      });
      await safe('pricing_plans', async () => {
        const { rows } = await dbQuery(`SELECT id, name, price, billing_period, is_active, is_on_sale, discount_percentage FROM pricing_plans ORDER BY price ASC`);
        return rows;
      });
    }
    if (agentKey === 'coo') {
      await safe('recent_payments', async () => {
        const { rows } = await dbQuery(`SELECT id, amount, currency, status, customer_email, created_at FROM payment_transactions ORDER BY created_at DESC LIMIT 10`);
        return rows;
      });
      await safe('social_connections', async () => {
        const { rows } = await dbQuery(`SELECT platform, COUNT(*) AS total, COUNT(*) FILTER (WHERE connected) AS connected FROM social_accounts GROUP BY platform ORDER BY total DESC`);
        return rows;
      });
    }
    if (agentKey === 'cto') {
      await safe('integrations', async () => {
        const { rows } = await dbQuery(`SELECT platform, enabled, updated_at FROM platform_configs ORDER BY platform`);
        return rows;
      });
      await safe('social_connections', async () => {
        const { rows } = await dbQuery(`SELECT platform, COUNT(*) AS total, COUNT(*) FILTER (WHERE connected) AS connected FROM social_accounts GROUP BY platform ORDER BY total DESC`);
        return rows;
      });
    }
    if (agentKey === 'cco') {
      await safe('card_templates', async () => {
        const { rows } = await dbQuery(`SELECT id, name, is_published, created_at FROM card_templates ORDER BY created_at DESC LIMIT 20`);
        return rows;
      });
      await safe('user_designs', async () => {
        const { rows } = await dbQuery(`SELECT COUNT(*) AS total FROM user_designs`);
        return rows[0];
      });
    }
    return data;
  }

  function buildActionsPrompt(agentKey: string, autonomyConfig: Record<string, any>): string {
    const lines: string[] = [
      '- **create_notification**: Alert the admin team. Payload: { "title": string, "body": string, "severity": "info"|"warning"|"critical" }',
    ];
    if ((agentKey === 'ceo' || agentKey === 'cro') && autonomyConfig.can_change_pricing) {
      const pct = autonomyConfig.pricing_range_pct ?? 15;
      lines.push(`- **update_pricing_plan**: Adjust a plan price (max ±${pct}% from current). Payload: { "plan_id": string, "current_price": number, "new_price": number }`);
    }
    if (agentKey === 'coo' && autonomyConfig.can_suspend_accounts) {
      lines.push('- **suspend_user**: Suspend a violating user. Payload: { "user_id": string, "reason": string }');
    }
    if (agentKey === 'cco' && autonomyConfig.can_manage_templates) {
      lines.push('- **feature_template**: Publish or unpublish a template. Payload: { "template_id": string, "publish": boolean }');
    }
    if (agentKey === 'cto' && autonomyConfig.can_disable_integrations) {
      lines.push('- **disable_integration**: Disable a malfunctioning integration. Payload: { "platform": string }');
    }
    return lines.join('\n');
  }

  async function executeAgentDecision(
    agentKey: string,
    decision: { action_type: string; payload: Record<string, any>; reasoning: string; severity: string },
    autonomyConfig: Record<string, any>,
  ): Promise<void> {
    const { action_type, payload } = decision;
    switch (action_type) {
      case 'create_notification': {
        await dbQuery(
          `INSERT INTO admin_notifications (agent_key, title, body, severity) VALUES ($1, $2, $3, $4)`,
          [agentKey, String(payload.title ?? 'Agent Notification'), String(payload.body ?? ''), String(payload.severity ?? 'info')],
        );
        break;
      }
      case 'update_pricing_plan': {
        if (!autonomyConfig.can_change_pricing) throw new Error('Not authorized for pricing changes');
        const maxPct = Number(autonomyConfig.pricing_range_pct ?? 15);
        const planRes = await dbQuery(`SELECT price FROM pricing_plans WHERE id = $1`, [payload.plan_id]);
        if (!planRes.rows.length) throw new Error(`Plan ${payload.plan_id} not found`);
        const current = parseFloat(planRes.rows[0].price);
        const newPrice = parseFloat(payload.new_price);
        if (isNaN(newPrice) || newPrice <= 0) throw new Error('Invalid price value');
        const changePct = Math.abs((newPrice - current) / current * 100);
        if (changePct > maxPct) throw new Error(`±${changePct.toFixed(1)}% exceeds authorized limit of ±${maxPct}%`);
        await dbQuery(`UPDATE pricing_plans SET price = $1, updated_at = NOW() WHERE id = $2`, [newPrice, payload.plan_id]);
        break;
      }
      case 'suspend_user': {
        if (!autonomyConfig.can_suspend_accounts) throw new Error('Not authorized for user suspension');
        if (!payload.user_id) throw new Error('user_id required');
        await dbQuery(`UPDATE users SET status = 'suspended' WHERE id = $1 AND role = 'user'`, [payload.user_id]);
        break;
      }
      case 'feature_template': {
        if (!autonomyConfig.can_manage_templates) throw new Error('Not authorized for template management');
        if (!payload.template_id) throw new Error('template_id required');
        await dbQuery(`UPDATE card_templates SET is_published = $1, updated_at = NOW() WHERE id = $2`, [payload.publish !== false, payload.template_id]);
        break;
      }
      case 'disable_integration': {
        if (!autonomyConfig.can_disable_integrations) throw new Error('Not authorized to disable integrations');
        if (!payload.platform) throw new Error('platform required');
        await dbQuery(`UPDATE platform_configs SET enabled = false, updated_at = NOW() WHERE platform = $1`, [payload.platform]);
        break;
      }
      default:
        throw new Error(`Unknown action type: ${action_type}`);
    }
  }

  async function gatherUserContext(userId: string, agentKey: string): Promise<Record<string, any>> {
    const ctx: Record<string, any> = { gathered_at: new Date().toUTCString() };
    if (!pool) return ctx;
    const safe = async (label: string, fn: () => Promise<any>) => {
      try { ctx[label] = await fn(); } catch (_err) { /* skip on error */ }
    };
    await safe('brand', async () => {
      const { rows } = await dbQuery(`SELECT brand_name, niche, tone, audience, goals, platforms, website, extra_notes FROM brand_profiles WHERE user_id = $1`, [userId]);
      return rows[0] ?? null;
    });
    await safe('memories', async () => {
      const { rows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','audience','content','visual','business') ORDER BY category, sort_order LIMIT 20`,
        [userId],
      );
      return rows.reduce((acc: Record<string, string[]>, r: any) => {
        if (!acc[r.category]) acc[r.category] = [];
        acc[r.category].push(`${r.title}: ${r.content}`);
        return acc;
      }, {});
    });
    await safe('agent_memory', async () => {
      const { rows } = await dbQuery(
        `SELECT key, value FROM user_agent_memory WHERE user_id = $1 AND (agent_key = $2 OR agent_key = 'global') ORDER BY created_at DESC LIMIT 15`,
        [userId, agentKey],
      );
      return rows.map((r: any) => `${r.key}: ${r.value}`);
    });
    await safe('social_accounts', async () => {
      const { rows } = await dbQuery(
        `SELECT platform, account_name, handle, followers, connected FROM social_accounts WHERE user_id = $1 AND connected = true ORDER BY platform`,
        [userId],
      );
      return rows;
    });
    await safe('design_count', async () => {
      const { rows } = await dbQuery(`SELECT COUNT(*)::int AS total FROM user_designs WHERE user_id = $1`, [userId]);
      return rows[0]?.total ?? 0;
    });
    if (agentKey === 'nova' || agentKey === 'daky') {
      await safe('recent_designs', async () => {
        const { rows } = await dbQuery(`SELECT name, created_at FROM user_designs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [userId]);
        return rows.map((r: any) => r.name);
      });
    }
    if (agentKey === 'flux') {
      await safe('active_workflows', async () => {
        const { rows } = await dbQuery(`SELECT name, description, is_active FROM agent_workflows WHERE agent_key = $1 AND is_active = true LIMIT 5`, [agentKey]);
        return rows;
      });
    }
    if (agentKey === 'promo' || agentKey === 'nova') {
      // The user's liked Discover images are their visual style profile.
      await safe('liked_image_styles', async () => {
        const { rows } = await dbQuery(
          `SELECT m.model, m.prompt FROM mcp_media_likes l JOIN mcp_media m ON m.id = l.media_id
           WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 5`, [userId]);
        return rows.map((r: any) => `[${r.model || 'ai'}] ${String(r.prompt || '').slice(0, 180)}`);
      });
    }
    await safe('past_decisions', async () => {
      const { rows } = await dbQuery(
        `SELECT agent_key, task_type, title, status FROM user_agent_tasks WHERE user_id = $1 AND status IN ('approved','rejected') ORDER BY decided_at DESC LIMIT 8`,
        [userId],
      );
      return rows;
    });
    return ctx;
  }

  // The team's strategy, research, inbox and teammates' work for this agent.
  async function gatherTeamBriefing(userId: string, agentKey: string): Promise<{ briefing: Record<string, any>; inboxIds: string[] }> {
    if (!pool) return { briefing: {}, inboxIds: [] };
    try {
      return await buildAgentBriefing(userId, agentKey);
    } catch (err) {
      logger.warn({ err, userId, agentKey }, 'agent_briefing_failed');
      return { briefing: {}, inboxIds: [] };
    }
  }

  function buildUserAgentOutputSpec(extraInstruction?: string): string {
    return `Respond ONLY with valid JSON — no markdown, no extra text:
{
  "proposals": [
    {
      "task_type": "content_post|strategy_proposal|analysis_report|visual_concept|workflow_setup",
      "title": "Short action title (max 80 characters)",
      "body": "What this is and why you recommend it (max 350 characters)",
      "payload": { "key_detail": "value", "strategy_link": "how this serves the team strategy", "evidence": "the research finding or result it rests on" }
    }
  ],
  "messages": [
    { "to": "teammate agent key", "kind": "request|handoff|insight|alert", "subject": "short subject", "body": "what you need or found" }
  ]
}

Generate 2-3 highly specific, immediately actionable proposals.${extraInstruction ? '\n' + extraInstruction : ''}
team_briefing in the context is your team's shared state:
- team_strategy is the strategy the whole team follows and why; every proposal should serve it, and your_focus is your part. Say how in payload.strategy_link.
- niche_research is current research on the user's niche. Ground proposals in it and name the finding in payload.evidence; do not invent statistics.
- platform_benchmarks in niche_research shows what has been working for popular accounts in this niche across connected channels (Instagram, TikTok, LinkedIn, X, Facebook, Threads, Pinterest). Adopt their winning formats and hook structures.
- STRICT GROUNDING: Fill those winning structural frameworks ONLY with verified business details from the user context and memories (actual offerings, services, website, audience). Absolutely NEVER invent unverified capabilities, fictional pricing, imaginary client reviews, or fake guarantees.
- inbox holds messages from teammates and the director. Act on requests and directives addressed to you.
- your_track_record shows what the user rejected recently; do not repeat those ideas.
Use "messages" only when a teammate must act or know something to do their part (to: an agent key such as daky, nova, sage, trend_research, audience_research, seo_research, hook_writing, ad_copy, or "director" to flag that the strategy is not working). Leave it empty otherwise.
If the user has no brand profile, return 1 proposal suggesting they complete their brand setup.`;
  }

  async function resolveAgentAiKey(): Promise<{ provider: 'anthropic' | 'google'; apiKey: string; model: string }> {
    try {
      const aiCfg = await getAIConfig();
      let provider: 'anthropic' | 'google' = aiCfg.provider || 'anthropic';
      let apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) {
        if (process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || aiCfg.googleEncryptedKey) {
          provider = 'google';
          apiKey = (aiCfg.googleEncryptedKey ? decryptAIKey(aiCfg.googleEncryptedKey) : null) || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
        } else if (process.env.ANTHROPIC_API_KEY || aiCfg.encryptedKey) {
          provider = 'anthropic';
          apiKey = (aiCfg.encryptedKey ? decryptAIKey(aiCfg.encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
        }
      }
      const model = aiCfg.model || FAST_MODEL;
      return { provider, apiKey, model };
    } catch {
      return { provider: 'anthropic', apiKey: '', model: FAST_MODEL };
    }
  }

  function generateSmartFallbackProposals(agentKey: string, ctx: Record<string, any>, extraInstruction?: string): any[] {
    const brand = ctx.brand || {};
    const brandName = brand.brand_name || 'Dakyworld';
    const niche = brand.niche || 'Growth SaaS & Marketing OS';
    const tone = brand.tone || 'Modern, bold, authoritative';
    const audience = brand.audience || 'Founders, agencies, and growth marketers';
    const platforms = Array.isArray(brand.platforms) && brand.platforms.length ? brand.platforms.join(', ') : 'Instagram, LinkedIn, X';
    const goals = Array.isArray(brand.goals) && brand.goals.length ? brand.goals.join('; ') : 'Scale MRR, automate publishing, increase engagement';
    const instr = extraInstruction ? ` [Focus: ${extraInstruction}]` : '';

    switch (agentKey) {
      case 'sage':
        return [
          {
            task_type: 'strategy_proposal',
            title: `${brandName} — 30-Day Growth & Market Positioning Playbook`,
            body: `Position ${brandName} as the go-to authority in ${niche}. Focus messaging for ${audience} around core pains and unique value props across ${platforms}.${instr}`,
            payload: { horizon: '30 days', target_platforms: platforms, primary_goal: goals },
          },
          {
            task_type: 'analysis_report',
            title: `Competitor Moat & Value Gap Audit for ${niche}`,
            body: `Identified 3 market gaps where competitors under-deliver. Recommended strategy: Emphasize unified automation and instant ROI.`,
            payload: { focus: 'moat_analysis', priority: 'high' },
          },
        ];
      case 'daky':
        return [
          {
            task_type: 'content_post',
            title: `Why ${niche} Leaders Are Rebuilding Their Daily Workflows in 2026`,
            body: `A deep-dive thought leadership breakdown for ${audience}. Outlines the exact transition from fragmented tools to an autonomous command center.${instr}`,
            payload: { reading_time: '4 mins', format: 'long_form_article', tone },
          },
          {
            task_type: 'content_post',
            title: `5 Bottlenecks Costing ${audience.slice(0, 30)} 15+ Hours Each Week`,
            body: `High-retention tactical post written in a ${tone} voice with real examples and actionable implementation steps.`,
            payload: { platform: 'LinkedIn / X', format: 'carousel_breakdown' },
          },
        ];
      case 'nova':
        return [
          {
            task_type: 'visual_concept',
            title: `Luxury Dark-Mode Glassmorphic Command Center Hero Card`,
            body: `Deep obsidian background with neon-indigo accent glows, sleek frosted glass cards, and crisp metrics typography aligned with ${brandName}'s identity.${instr}`,
            payload: { aspect_ratio: '16:9', style: 'luxury_tech', hex_palette: ['#0B0F19', '#5B6CF9', '#10B981'] },
          },
          {
            task_type: 'visual_concept',
            title: `3-Stage Visual Comparison Matrix: Manual vs Autonomous`,
            body: `Clean graphic showing "Before vs After" workflow transformations for ${niche} teams. High-contrast typography designed for mobile feeds.`,
            payload: { aspect_ratio: '1:1', style: 'infographic' },
          },
        ];
      case 'hook_writing':
        return [
          {
            task_type: 'hook_pack',
            title: `7 High-CTR Hooks Engineered for ${niche}`,
            body: `1. "Most ${niche} advice in 2026 is dangerously outdated. Here's why."\n2. "If you manage ${audience.slice(0, 25)}, stop doing this immediately."\n3. "The silent bottleneck costing you 40% of conversion."\n4. "3 workflow shifts that cut turnaround time in half."\n5. "Why the top 1% never use manual scheduling."${instr}`,
            payload: { channels: platforms, angles: ['curiosity', 'contrarian', 'fear_of_loss'] },
          },
        ];
      case 'social_caption':
        return [
          {
            task_type: 'social_caption',
            title: `Platform-Optimized Authority Caption for ${platforms}`,
            body: `Most brands in ${niche} obsess over vanity metrics instead of predictable pipeline.\n\nHere is what changes when you switch to an autonomous system:\n\n• Zero manual handoff friction\n• Content published at peak engagement hours\n• Real-time lead capture from every comment\n\nDrop a comment with "PLAYBOOK" to get our internal blueprint.\n\n#${niche.replace(/[^a-zA-Z]/g, '')} #GrowthHacks #BusinessOS`,
            payload: { platforms, cta: 'comment_lead_magnet' },
          },
        ];
      case 'video_script':
        return [
          {
            task_type: 'video_script',
            title: `45-Second High-Retention Reel/TikTok Script`,
            body: `[0-3s HOOK]: "Stop scrolling if you're trying to scale in ${niche}."\n[3-15s PROBLEM]: "You're spending 4 hours a day copying text between 6 different tools."\n[15-35s SOLUTION]: "Here is how ${brandName} lets you plan, draft, design, and publish in under 60 seconds."\n[35-45s CTA]: "Link in bio to test it yourself today!"${instr}`,
            payload: { target_duration: '45s', pacing: 'fast', retention_hook_type: 'direct_address' },
          },
        ];
      case 'ad_copy':
        return [
          {
            task_type: 'ad_copy',
            title: `Meta/Google 3-Angle High-ROAS Copy Pack`,
            body: `ANGLE 1 (Pain): "Still juggling 5 disconnected tools just to publish content?"\nANGLE 2 (Transformation): "Replace an entire content team with one unified command center."\nANGLE 3 (Social Proof): "Join the top agencies and creators scaling with ${brandName}."${instr}`,
            payload: { platform: 'Meta Ads', angles: ['pain_point', 'transformation', 'social_proof'] },
          },
        ];
      case 'trend_research':
        return [
          {
            task_type: 'trend_brief',
            title: `Rising 2026 Trend: Real-Time Lead Orchestration in ${niche}`,
            body: `Inbound leads convert 4.2x higher when engaged within 5 minutes across social DMs. ${brandName} should launch a dedicated campaign showcasing automated lead-to-deal workflows.${instr}`,
            payload: { viral_factor: '8.7/10', velocity: 'accelerating' },
          },
        ];
      case 'audience_research':
        return [
          {
            task_type: 'persona_map',
            title: `ICP Persona & Key Objections Blueprint for ${audience}`,
            body: `Primary Persona: High-velocity decision makers in ${niche}.\nCore Pain: Lack of time and fragmented stacks.\nTop Objection: "Will my team actually use this?"\nCounter-Play: Highlight instant templates and 1-click quick-starts.`,
            payload: { icp: audience, buying_triggers: ['time_saved', 'revenue_attribution'] },
          },
        ];
      case 'seo_research':
        return [
          {
            task_type: 'seo_cluster',
            title: `High-Intent Organic Keyword Cluster for ${niche}`,
            body: `Target Primary: "best AI tools for ${niche.slice(0, 25)}"\nSecondary Cluster: "${brandName} review", "how to automate social marketing 2026"\nIntent: High commercial intent with low competitive difficulty.${instr}`,
            payload: { estimated_monthly_traffic: '3,200', target_cpc_saved: '$1,400' },
          },
        ];
      case 'thumbnail_design':
        return [
          {
            task_type: 'thumbnail_brief',
            title: `Split-Screen Visual Comparison Thumbnail Concept`,
            body: `Left: Red-tinted chaotic desktop cluttered with browser tabs labeled "THE OLD WAY".\nRight: Sleek glowing obsidian UI with clean metrics labeled "${brandName}".\nBold Center Headline: "STOP WASTING TIME".${instr}`,
            payload: { click_through_estimate: '11.4%', color_contrast: 'high' },
          },
        ];
      case 'meta_ads':
        return [
          {
            task_type: 'campaign_structure',
            title: `Full-Funnel Meta Acquisition Architecture`,
            body: `Top of Funnel: Broad engagement reel testing 3 hook angles.\nMiddle of Funnel: Retargeting video viewers with client results carousel.\nBottom of Funnel: Direct offer promotion with 14-day risk-free CTA.${instr}`,
            payload: { budget_distribution: '60% TOF / 25% MOF / 15% BOF', recommended_daily: '$50-$150' },
          },
        ];
      case 'aria':
        return [
          {
            task_type: 'analysis_report',
            title: `Attribution Telemetry & Conversion Rate Audit`,
            body: `Analyzed funnel metrics for ${brandName}: Track shortlink CTR, conversion attribution by platform, and proposal-to-publish turnaround. Target KPI: Increase organic referral traffic by 35%.${instr}`,
            payload: { metrics_to_track: ['CTR', 'Lead Velocity', 'ROAS', 'Publishing Frequency'] },
          },
        ];
      case 'flux':
        return [
          {
            task_type: 'workflow_setup',
            title: `Omnichannel Auto-Distribution Sequence`,
            body: `Configure multi-step trigger: When a blog draft is approved → auto-generate 1 LinkedIn post, 1 X thread, and 2 Instagram story slides for scheduled distribution at peak times.${instr}`,
            payload: { trigger: 'draft_approved', actions: ['schedule_social', 'notify_team'] },
          },
        ];
      case 'campaign_brief':
        return [
          {
            task_type: 'campaign_brief',
            title: `14-Day Integrated Multi-Channel Launch Brief: "${brandName} Momentum"`,
            body: `Goal: ${goals}.\nAudience: ${audience}.\nChannels: ${platforms}.\nPhases: Days 1-4 Tease Problem → Days 5-8 Reveal Solution → Days 9-12 Social Proof & Case Studies → Days 13-14 Final Push.${instr}`,
            payload: { duration: '14 days', channels: platforms, primary_kpi: 'Qualified Leads' },
          },
        ];
      default:
        return [
          {
            task_type: 'strategy_proposal',
            title: `${AGENT_NAMES[agentKey] ?? agentKey} — Action Plan for ${brandName}`,
            body: `Tailored proposal for ${niche} focusing on ${audience} to achieve: ${goals}.${instr}`,
            payload: { agent_key: agentKey },
          },
        ];
    }
  }

  async function callAgentAndParse(
    userId: string,
    agentKey: string,
    passedApiKey?: string,
    extraContext?: Record<string, any>,
    extraInstruction?: string,
  ): Promise<AgentTurn> {
    const [ctx, team] = await Promise.all([gatherUserContext(userId, agentKey), gatherTeamBriefing(userId, agentKey)]);
    if (Object.keys(team.briefing).length) ctx.team_briefing = team.briefing;
    const merged = extraContext ? { ...ctx, ...extraContext } : ctx;
    const fallback = (): AgentTurn => ({ proposals: generateSmartFallbackProposals(agentKey, merged, extraInstruction), messages: [], inboxIds: [] });

    const { provider, apiKey, model } = await resolveAgentAiKey();
    const effectiveKey = passedApiKey || apiKey;

    if (!effectiveKey) {
      // Zero-config intelligent generator — works immediately out of the box!
      return fallback();
    }

    const { rows: tmplRows } = await dbQuery(
      `SELECT base_prompt FROM agent_templates WHERE agent_key = $1`, [agentKey],
    ).catch(() => ({ rows: [] as any[] }));
    const baseSystemPrompt = tmplRows[0]?.base_prompt
      ? `${tmplRows[0].base_prompt}\n\n${USER_AGENT_PROMPTS[agentKey] ?? ''}`
      : USER_AGENT_PROMPTS[agentKey] ?? '';
    const customInstr = (merged.agent_memory as string[] | undefined)
      ?.find((m) => m.startsWith('custom_instructions:'));
    const systemPrompt = customInstr
      ? `${baseSystemPrompt}\n\nUSER'S STANDING INSTRUCTIONS FOR YOU:\n${customInstr.replace(/^custom_instructions:\s*/, '').trim()}`
      : baseSystemPrompt;
    const effectiveModel = USER_AGENT_MODELS[agentKey] ?? model ?? FAST_MODEL;
    const userMessage = `User context:\n\n${JSON.stringify(merged, null, 2)}\n\n${buildUserAgentOutputSpec(extraInstruction)}`;

    // Structured outputs guarantee valid JSON
    const proposalsSchema = {
      type: 'object' as const,
      additionalProperties: false,
      required: ['proposals'],
      properties: {
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['task_type', 'title', 'body'],
            properties: {
              task_type: { type: 'string' },
              title: { type: 'string' },
              body: { type: 'string' },
              payload: { type: 'string', description: 'JSON-encoded object with key details for this proposal' },
            },
          },
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['to', 'kind', 'subject', 'body'],
            properties: {
              to: { type: 'string' },
              kind: { type: 'string', enum: ['request', 'handoff', 'insight', 'alert'] },
              subject: { type: 'string' },
              body: { type: 'string' },
            },
          },
        },
      },
    };

    let rawText = '';
    let proposals: any[] = [];
    let rawMessages: unknown = [];
    try {
      if (provider === 'google') {
        const geminiModel = resolveGeminiModel(effectiveModel);
        rawText = await callAINonStreaming(
          'google',
          effectiveKey,
          geminiModel,
          systemPrompt,
          userMessage,
          1200,
          { userId, feature: `agent_${agentKey}` }
        );
      } else {
        const client = new Anthropic({ apiKey: effectiveKey });
        try {
          const aiRes = await client.messages.create({
            model: effectiveModel,
            max_tokens: 1200,
            system: systemPrompt,
            output_config: { format: { type: 'json_schema', schema: proposalsSchema } },
            messages: [{ role: 'user', content: userMessage }],
          } as any);
          void recordAIUsage({
            userId, feature: `agent_${agentKey}`, provider: 'anthropic', model: effectiveModel,
            inputTokens: aiRes.usage.input_tokens, outputTokens: aiRes.usage.output_tokens,
            cacheReadTokens: aiRes.usage.cache_read_input_tokens ?? 0,
          });
          rawText = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
        } catch (_structuredErr) {
          rawText = await callAINonStreaming(
            'anthropic',
            effectiveKey,
            effectiveModel,
            systemPrompt,
            userMessage,
            1000,
            { userId, feature: `agent_${agentKey}` }
          );
        }
      }

      const block = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = block ? block[1] : rawText;
      const match = candidate.match(/\{[\s\S]*\}/);
      if (match) {
        const j = JSON.parse(match[0]);
        if (Array.isArray(j.proposals)) {
          proposals = j.proposals.map((p: any) => {
            if (typeof p.payload === 'string') {
              try { p.payload = JSON.parse(p.payload); } catch { p.payload = {}; }
            }
            return p;
          });
        }
        rawMessages = j.messages;
      }
    } catch (_err) {
      return fallback();
    }

    if (proposals.length === 0) {
      return fallback();
    }
    return { proposals, messages: sanitizeAgentMessages(agentKey, rawMessages, Object.keys(AGENT_DEFS)), inboxIds: team.inboxIds };
  }

  // Saves a run's proposals, delivers its messages to teammates, and marks
  // the inbox messages it was shown as read.
  async function completeAgentTurn(userId: string, agentKey: string, turn: AgentTurn): Promise<number> {
    const created = await insertProposals(userId, agentKey, turn.proposals);
    await notifyProposals(userId, agentKey, created);
    for (const m of turn.messages) {
      await postAgentMessage(userId, { from: agentKey, to: m.to, kind: m.kind, subject: m.subject, body: m.body, priority: m.kind === 'alert' ? 2 : 0 });
    }
    await markInboxConsumed(userId, agentKey, turn.inboxIds);
    return created;
  }

  async function runAgentForUser(userId: string, agentKey: string, _reason: string): Promise<number> {
    if (!AGENT_DEFS[agentKey] || !USER_AGENT_PROMPTS[agentKey]) return 0;
    const turn = await callAgentAndParse(userId, agentKey);
    const created = await completeAgentTurn(userId, agentKey, turn);
    await dbQuery(
      `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'meta','meta:last_run_at',$3)
       ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
      [userId, agentKey, new Date().toISOString()],
    ).catch(() => {});
    return created;
  }

  async function insertProposals(userId: string, agentKey: string, proposals: any[]): Promise<number> {
    let created = 0;
    for (const p of proposals.slice(0, 3)) {
      if (!p?.title) continue;
      await dbQuery(
        `INSERT INTO user_agent_tasks (user_id, agent_key, task_type, title, body, payload) VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, agentKey, p.task_type ?? 'proposal', String(p.title).slice(0, 80), String(p.body ?? '').slice(0, 400), JSON.stringify(p.payload ?? {})],
      ).catch(() => {});
      created++;
    }
    return created;
  }

  async function notifyProposals(userId: string, agentKey: string, count: number): Promise<void> {
    if (count === 0) return;
    const name = AGENT_NAMES[agentKey] ?? agentKey;
    await dbQuery(
      `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'agent_proposal',$2,$3,$4)`,
      [userId,
       `${name} has ${count} new proposal${count !== 1 ? 's' : ''} for you`,
       `${count} proposal${count !== 1 ? 's' : ''} waiting in your AI Team approval queue`,
       JSON.stringify({ agent_key: agentKey, count, link: '/ai-team' })],
    ).catch(() => {});
  }

  function _addPlaceholders(prompt: string): string {
    if (prompt.includes('[') && prompt.includes(']')) return prompt;
    return `[YOUR BUSINESS NAME] ${prompt.replace(/\b(professional|modern|minimalist|elegant|bold)\b/gi, '[STYLE]').trim()}`.trim()
      || `[STYLE] design for [YOUR BUSINESS] targeting [YOUR AUDIENCE]`;
  }

  function _extractJsonFromText(text: string): Record<string, any> | null {
    try {
      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = codeBlock ? codeBlock[1] : text;
      const jsonMatch = candidate.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (_err) { /* ignore */ }
    return null;
  }

  async function runScheduledAgents(): Promise<void> {
    if (!pool) return;
    try {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentDay  = now.getUTCDay();
      const { rows } = await dbQuery(
        `SELECT * FROM user_agent_schedules
         WHERE enabled = true AND frequency != 'off'
         AND (
           (frequency = 'daily' AND run_hour = $1
            AND (last_scheduled_run_at IS NULL OR last_scheduled_run_at < NOW() - INTERVAL '23 hours'))
           OR
           (frequency = 'weekly' AND run_hour = $1 AND run_day = $2
            AND (last_scheduled_run_at IS NULL OR last_scheduled_run_at < NOW() - INTERVAL '6 days'))
         )`,
        [currentHour, currentDay],
      );
      // Same provider resolution as manual runs, so Gemini-only setups run too.
      const { apiKey } = await resolveAgentAiKey();
      if (!apiKey) return;
      for (const sched of rows as any[]) {
        try {
          // Skip users with an empty credit balance, but still advance the
          // schedule so we don't retry them every hourly tick.
          if (!(await hasAICredits(sched.user_id))) {
            await dbQuery(`UPDATE user_agent_schedules SET last_scheduled_run_at = NOW(), updated_at = NOW() WHERE id = $1`, [sched.id]);
            continue;
          }
          const turn = await callAgentAndParse(sched.user_id, sched.agent_key);
          await completeAgentTurn(sched.user_id, sched.agent_key, turn);
          await dbQuery(`UPDATE user_agent_schedules SET last_scheduled_run_at = NOW(), updated_at = NOW() WHERE id = $1`, [sched.id]);
        } catch (_err) { /* skip failing agent */ }
      }
    } catch (_err) { /* non-fatal */ }
  }

  const router = Router();

  // ── Admin Agent Tools & Workflows ─────────────────────────────────────────────

  router.get('/admin/agent-tools', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const { rows } = await dbQuery(`SELECT * FROM agent_tools ORDER BY type, name`);
      return res.json({ success: true, tools: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/admin/agent-workflows/:key', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const { rows } = await dbQuery(`SELECT * FROM agent_workflows WHERE agent_key = $1 ORDER BY updated_at ASC`, [req.params.key]);
      return res.json({ success: true, workflows: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/agent-workflows/:key', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { name, description = '', steps = [], is_active = true } = req.body as { name: string; description?: string; steps?: any[]; is_active?: boolean };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const { rows } = await dbQuery(
        `INSERT INTO agent_workflows (agent_key, name, description, steps, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (agent_key, name) DO UPDATE SET description = $3, steps = $4, is_active = $5, updated_at = NOW()
         RETURNING *`,
        [req.params.key, name.trim(), description, JSON.stringify(steps), is_active],
      );
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/admin/agent-workflows/:key/:id', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { name, description, steps, is_active } = req.body as { name?: string; description?: string; steps?: any[]; is_active?: boolean };
    if (steps !== undefined && !Array.isArray(steps)) return res.status(400).json({ success: false, error: 'steps must be an array' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      const setClauses: string[] = ['updated_at = NOW()'];
      const vals: any[] = [];
      let idx = 1;
      if (name !== undefined)        { setClauses.push(`name = $${idx++}`);        vals.push(name); }
      if (description !== undefined) { setClauses.push(`description = $${idx++}`); vals.push(description); }
      if (steps !== undefined)       { setClauses.push(`steps = $${idx++}`);       vals.push(JSON.stringify(steps)); }
      if (is_active !== undefined)   { setClauses.push(`is_active = $${idx++}`);   vals.push(is_active); }
      vals.push(req.params.id, req.params.key);
      const { rows } = await dbQuery(
        `UPDATE agent_workflows SET ${setClauses.join(', ')} WHERE id = $${idx++} AND agent_key = $${idx} RETURNING *`,
        vals,
      );
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'Workflow not found' });
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/admin/agent-workflows/:key/:id', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      await dbQuery(`DELETE FROM agent_workflows WHERE id = $1 AND agent_key = $2`, [req.params.id, req.params.key]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Admin Platform Agents ──────────────────────────────────────────────────────

  router.get('/admin/platform-agents', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const { rows } = await dbQuery(
        `SELECT * FROM admin_agents ORDER BY CASE tier WHEN 'strategic' THEN 1 WHEN 'operational' THEN 2 ELSE 3 END, created_at ASC`,
      );
      return res.json({ success: true, agents: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/admin/platform-agents/notifications', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 50`);
      return res.json({ success: true, notifications: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/admin/platform-agents/:key/runs', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM admin_agent_runs WHERE agent_key = $1 ORDER BY created_at DESC LIMIT 25`, [req.params.key]);
      return res.json({ success: true, runs: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/admin/platform-agents/:key', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { system_prompt, model, autonomy_config } = req.body as { system_prompt?: string; model?: string; autonomy_config?: Record<string, any> };
    try {
      const setClauses: string[] = ['updated_at = NOW()'];
      const vals: any[] = [];
      let idx = 1;
      if (system_prompt !== undefined)  { setClauses.push(`system_prompt = $${idx++}`);   vals.push(system_prompt); }
      if (model !== undefined)          { setClauses.push(`model = $${idx++}`);            vals.push(model); }
      if (autonomy_config !== undefined){ setClauses.push(`autonomy_config = $${idx++}`);  vals.push(JSON.stringify(autonomy_config)); }
      vals.push(req.params.key);
      const { rows } = await dbQuery(`UPDATE admin_agents SET ${setClauses.join(', ')} WHERE key = $${idx} RETURNING *`, vals);
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'Agent not found' });
      return res.json({ success: true, agent: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/platform-agents/:key/run', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { key } = req.params;
    const trigger = (req.body?.trigger as string) || 'manual';
    try {
      const agentRes = await dbQuery(`SELECT * FROM admin_agents WHERE key = $1`, [key]);
      if (agentRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Agent not found' });
      const agent = agentRes.rows[0];
      await dbQuery(`UPDATE admin_agents SET status = 'running' WHERE key = $1`, [key]);
      const { encryptedKey } = await getAIConfig();
      const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        await dbQuery(`UPDATE admin_agents SET status = 'error' WHERE key = $1`, [key]);
        return res.status(503).json({ success: false, error: 'Anthropic API key not configured. Set it in Admin → AI Assistant → Configuration.' });
      }
      const snapshot = await gatherPlatformSnapshot(key);
      const actionsPrompt = buildActionsPrompt(key, agent.autonomy_config ?? {});
      const userMessage = `Analyze the current Dakyworld Hub platform state and take any autonomous actions within your authority.

## Live Platform Snapshot
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

## Available Autonomous Actions
${actionsPrompt}

## Response Format
Respond ONLY with a JSON object in this exact format (no extra text):
\`\`\`json
{
  "summary": "2-3 sentence executive summary of platform health and your key observations",
  "health_score": <integer 1-10>,
  "decisions": [
    {
      "action_type": "action_name",
      "reasoning": "specific, data-driven reason for this action",
      "payload": { ... },
      "severity": "low|medium|high|critical"
    }
  ]
}
\`\`\`

Only take actions when data clearly justifies them. If the platform is healthy, return an empty decisions array.`;

      const client = new Anthropic({ apiKey });
      const aiResponse = await client.messages.create({
        model: agent.model || 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: agent.system_prompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const rawText = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
      let parsed: { summary: string; health_score?: number; decisions: any[] } = { summary: rawText.slice(0, 600), decisions: [] };
      try {
        const block = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = block ? block[1] : rawText;
        const jsonMatch = candidate.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const j = JSON.parse(jsonMatch[0]);
          parsed = {
            summary: String(j.summary ?? rawText.slice(0, 600)),
            health_score: typeof j.health_score === 'number' ? j.health_score : undefined,
            decisions: Array.isArray(j.decisions) ? j.decisions : [],
          };
        }
      } catch (_err) { /* use raw text as summary */ }
      let executedCount = 0;
      const decisionErrors: string[] = [];
      for (const decision of parsed.decisions) {
        if (!decision?.action_type) continue;
        let taskStatus: 'executed' | 'rejected' = 'rejected';
        let taskError = '';
        try {
          await executeAgentDecision(key, decision, agent.autonomy_config ?? {});
          taskStatus = 'executed';
          executedCount++;
        } catch (e: any) {
          taskError = e.message;
          decisionErrors.push(`${decision.action_type}: ${e.message}`);
        }
        await dbQuery(
          `INSERT INTO admin_agent_tasks (agent_key, action_type, payload, status, reasoning, severity) VALUES ($1, $2, $3, $4, $5, $6)`,
          [key, decision.action_type, JSON.stringify(decision.payload ?? {}), taskStatus,
           (decision.reasoning ?? '') + (taskError ? ` [error: ${taskError}]` : ''), decision.severity ?? 'low'],
        ).catch(() => {});
      }
      const healthTag = parsed.health_score != null ? ` [Health: ${parsed.health_score}/10]` : '';
      const actTag = executedCount > 0 ? ` — ${executedCount} action${executedCount !== 1 ? 's' : ''} executed.` : '';
      const errTag = decisionErrors.length > 0 ? ` Skipped: ${decisionErrors.join('; ')}.` : '';
      const fullSummary = `${parsed.summary}${healthTag}${actTag}${errTag}`.slice(0, 2000);
      const { rows: runRows } = await dbQuery(
        `INSERT INTO admin_agent_runs (agent_key, trigger, summary, decisions_made, status, metadata) VALUES ($1, $2, $3, $4, 'completed', $5) RETURNING *`,
        [key, trigger, fullSummary, executedCount, JSON.stringify({ health_score: parsed.health_score, errors: decisionErrors })],
      );
      await dbQuery(`UPDATE admin_agents SET status = 'idle', last_run_at = NOW() WHERE key = $1`, [key]);
      return res.json({ success: true, run: runRows[0] });
    } catch (e: any) {
      await dbQuery(`UPDATE admin_agents SET status = 'error' WHERE key = $1`, [key]).catch(() => {});
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── User Agent Foundation ───────────────────────────────────────────────────────

  router.get('/user/agent-templates', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT agent_key, name, role, icon, color, base_prompt FROM agent_templates ORDER BY agent_key`, []);
      return res.json({ success: true, templates: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/brand-profile', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM brand_profiles WHERE user_id = $1`, [auth.userId]);
      return res.json({ success: true, profile: rows[0] ?? null });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/user/brand-profile', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { brand_name = '', niche = '', tone = 'professional', audience = '', goals = [], platforms = [], website = '', extra_notes = '', setup_done = false } = req.body as Record<string, any>;
    try {
      const { rows } = await dbQuery(
        `INSERT INTO brand_profiles (user_id, brand_name, niche, tone, audience, goals, platforms, website, extra_notes, setup_done, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           brand_name  = EXCLUDED.brand_name, niche       = EXCLUDED.niche,    tone        = EXCLUDED.tone,
           audience    = EXCLUDED.audience,   goals       = EXCLUDED.goals,    platforms   = EXCLUDED.platforms,
           website     = EXCLUDED.website,    extra_notes = EXCLUDED.extra_notes, setup_done = EXCLUDED.setup_done, updated_at = NOW()
         RETURNING *`,
        [auth.userId, brand_name, niche, tone, audience,
         Array.isArray(goals) ? goals : [], Array.isArray(platforms) ? platforms : [],
         website, extra_notes, Boolean(setup_done)],
      );
      // Brand profile feeds every agent's compiled skill brief — resync them.
      triggerAgentCompilation(auth.userId).catch(() => undefined);
      invalidateSharedContext(auth.userId);
      return res.json({ success: true, profile: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-memory', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM user_agent_memory WHERE user_id = $1 ORDER BY agent_key, created_at DESC`, [auth.userId]);
      return res.json({ success: true, memories: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agent-memory', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { agent_key = 'global', mem_type = 'general', key, value } = req.body as Record<string, any>;
    if (!key || !value) return res.status(400).json({ success: false, error: 'key and value required' });
    try {
      const { rows } = await dbQuery(
        `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value, mem_type = EXCLUDED.mem_type RETURNING *`,
        [auth.userId, agent_key, mem_type, key, value],
      );
      return res.json({ success: true, memory: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/user/agent-memory/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      await dbQuery(`DELETE FROM user_agent_memory WHERE id = $1 AND user_id = $2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-drafts', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM agent_drafts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [auth.userId]);
      return res.json({ success: true, drafts: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-tasks', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      await dbQuery(`UPDATE user_agent_tasks SET status='expired' WHERE user_id=$1 AND status='pending' AND expires_at < NOW()`, [auth.userId]).catch(() => {});
      const { rows } = await dbQuery(`SELECT * FROM user_agent_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [auth.userId]);
      return res.json({ success: true, tasks: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/user/agent-tasks/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { decision, title, body } = req.body as { decision: string; title?: string; body?: string };
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ success: false, error: "decision must be 'approved' or 'rejected'" });
    try {
      let updateSql = `UPDATE user_agent_tasks SET status=$1, decided_at=NOW()`;
      const updateParams: any[] = [decision, req.params.id, auth.userId];
      if (title) {
        updateParams.push(title);
        updateSql += `, title=$${updateParams.length}`;
      }
      if (body !== undefined) {
        updateParams.push(body);
        updateSql += `, body=$${updateParams.length}`;
      }
      updateSql += ` WHERE id=$2 AND user_id=$3 AND status='pending' RETURNING *`;
      const { rows } = await dbQuery(updateSql, updateParams);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Task not found or already decided' });
      const task = rows[0];
      try {
        const { rows: history } = await dbQuery(
          `SELECT task_type, title, status FROM user_agent_tasks WHERE user_id=$1 AND agent_key=$2 AND status IN ('approved','rejected') ORDER BY decided_at DESC LIMIT 12`,
          [auth.userId, task.agent_key],
        );
        const approved = history.filter((r: any) => r.status === 'approved').map((r: any) => `${r.task_type}: "${String(r.title).slice(0, 50)}"`).join('; ');
        const rejected = history.filter((r: any) => r.status === 'rejected').map((r: any) => `${r.task_type}: "${String(r.title).slice(0, 50)}"`).join('; ');
        const summary = [
          approved && `USER APPROVED (${history.filter((r: any) => r.status === 'approved').length}): ${approved}`,
          rejected && `USER REJECTED (${history.filter((r: any) => r.status === 'rejected').length}): ${rejected}`,
        ].filter(Boolean).join(' | ');
        if (summary) {
          await dbQuery(
            `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'preference','decision_history',$3)
             ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
            [auth.userId, task.agent_key, summary.slice(0, 1000)],
          );
        }
      } catch (_err) { /* non-fatal */ }
      let execution: Record<string, any> | null = null;
      if (decision === 'approved') {
        try {
          if (task.task_type === 'content_post') {
            const postId = randomUUID();
            const postSlug = slugify(task.title) || postId;
            await dbQuery(`INSERT INTO blog_posts (id,user_id,title,slug,content,status) VALUES ($1,$2,$3,$4,$5,'draft')`, [postId, auth.userId, task.title, postSlug, task.body || '']);
            const { rows: dr } = await dbQuery(
              `INSERT INTO agent_drafts (user_id,agent_key,task_id,task_type,title,content,payload,blog_post_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
              [auth.userId, task.agent_key, task.id, task.task_type, task.title, task.body || '', JSON.stringify(task.payload || {}), postId],
            );
            execution = { type: 'blog_draft', draft_id: dr[0]?.id, blog_post_id: postId };
          } else {
            const { rows: dr } = await dbQuery(
              `INSERT INTO agent_drafts (user_id,agent_key,task_id,task_type,title,content,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [auth.userId, task.agent_key, task.id, task.task_type, task.title, task.body || '', JSON.stringify(task.payload || {})],
            );
            execution = { type: 'agent_draft', draft_id: dr[0]?.id };
          }
        } catch (_err) { /* non-fatal */ }
        // Teammates downstream build on approved work.
        await handOffApprovedWork(auth.userId, task).catch(() => 0);
      }
      return res.json({ success: true, task, execution });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agent-tasks/batch-decide', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { decision, task_ids } = req.body as { decision: 'approved' | 'rejected'; task_ids?: string[] };
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ success: false, error: "decision must be 'approved' or 'rejected'" });
    try {
      const { rows: pendingTasks } = await dbQuery(
        Array.isArray(task_ids) && task_ids.length > 0
          ? `SELECT * FROM user_agent_tasks WHERE user_id=$1 AND id = ANY($2) AND status='pending'`
          : `SELECT * FROM user_agent_tasks WHERE user_id=$1 AND status='pending'`,
        Array.isArray(task_ids) && task_ids.length > 0 ? [auth.userId, task_ids] : [auth.userId]
      );
      const updated: any[] = [];
      for (const t of pendingTasks) {
        await dbQuery(`UPDATE user_agent_tasks SET status=$1, decided_at=NOW() WHERE id=$2 AND user_id=$3`, [decision, t.id, auth.userId]);
        t.status = decision;
        t.decided_at = new Date().toISOString();
        if (decision === 'approved') {
          try {
            if (t.task_type === 'content_post') {
              const postId = randomUUID();
              const postSlug = slugify(t.title) || postId;
              await dbQuery(`INSERT INTO blog_posts (id,user_id,title,slug,content,status) VALUES ($1,$2,$3,$4,$5,'draft')`, [postId, auth.userId, t.title, postSlug, t.body || '']).catch(() => {});
              await dbQuery(
                `INSERT INTO agent_drafts (user_id,agent_key,task_id,task_type,title,content,payload,blog_post_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [auth.userId, t.agent_key, t.id, t.task_type, t.title, t.body || '', JSON.stringify(t.payload || {}), postId]
              ).catch(() => {});
            } else {
              await dbQuery(
                `INSERT INTO agent_drafts (user_id,agent_key,task_id,task_type,title,content,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [auth.userId, t.agent_key, t.id, t.task_type, t.title, t.body || '', JSON.stringify(t.payload || {})]
              ).catch(() => {});
            }
          } catch (_err) { /* non-fatal */ }
          // Hand off the first few only, so approving a backlog does not flood
          // every teammate's inbox.
          if (updated.filter((u) => u.status === 'approved').length < 5) {
            await handOffApprovedWork(auth.userId, t).catch(() => 0);
          }
        }
        updated.push(t);
      }
      return res.json({ success: true, count: updated.length, tasks: updated });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.delete('/user/agent-drafts/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      await dbQuery(`DELETE FROM agent_drafts WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/agent-tasks', async (req: Request, res: Response) => {
    const adm = requireAdmin(req, res);
    if (!adm) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { user_id, agent_key, task_type = 'proposal', title, body = '', payload = {}, expires_hours = 48 } = req.body as Record<string, any>;
    if (!user_id || !agent_key || !title) return res.status(400).json({ success: false, error: 'user_id, agent_key, title required' });
    try {
      const { rows } = await dbQuery(
        `INSERT INTO user_agent_tasks (user_id, agent_key, task_type, title, body, payload, expires_at) VALUES ($1,$2,$3,$4,$5,$6, NOW() + ($7 || ' hours')::interval) RETURNING *`,
        [user_id, agent_key, task_type, title, body, JSON.stringify(payload), String(Number(expires_hours) || 48)],
      );
      return res.json({ success: true, task: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // ── User Agent Run ────────────────────────────────────────────────────────────

  router.post('/user/agents/:key/run', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { key } = req.params;
    if (!AGENT_DEFS[key]) return res.status(400).json({ success: false, error: 'Unknown agent key' });
    const { brief, instruction, force } = (req.body || {}) as { brief?: string; instruction?: string; force?: boolean };
    const queryForce = req.query.force === 'true' || force === true;
    try {
      const { rows: cd } = await dbQuery(`SELECT value FROM user_agent_memory WHERE user_id=$1 AND agent_key=$2 AND key='meta:last_run_at'`, [auth.userId, key]);
      if (cd[0] && !queryForce) {
        const elapsed = Date.now() - new Date(cd[0].value).getTime();
        // 5-second debounce against accidental double-clicks, instead of 10-minute lock
        if (elapsed < 5 * 1000) {
          const secs = Math.ceil((5 * 1000 - elapsed) / 1000);
          return res.status(429).json({ success: false, error: `Agent ${key} was just run. Please wait ${secs}s before running again.` });
        }
      }
    } catch (_err) { /* proceed */ }
    if (!(await hasAICredits(auth.userId))) {
      return res.status(402).json({ success: false, error: "You need more AI credits. Buy credits without changing your plan, or wait for your monthly allowance reset." });
    }
    try {
      const extraInstr = instruction || brief;
      const extraCtx = brief ? { campaign_brief: brief } : undefined;
      const turn = await callAgentAndParse(auth.userId, key, undefined, extraCtx, extraInstr);
      const created = await completeAgentTurn(auth.userId, key, turn);
      await dbQuery(
        `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'meta','meta:last_run_at',$3)
         ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
        [auth.userId, key, new Date().toISOString()],
      ).catch(() => {});
      return res.json({ success: true, proposals_created: created, agent_key: key });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agents/status', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT agent_key, value AS last_run_at FROM user_agent_memory WHERE user_id=$1 AND key='meta:last_run_at'`, [auth.userId]);
      const status: Record<string, string> = {};
      for (const r of rows as any[]) status[r.agent_key] = r.last_run_at;
      return res.json({ success: true, status });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agents/orchestrate', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { brief } = (req.body || {}) as { brief?: string };
      const briefInstruction = brief ? `Campaign Brief / Directive: "${brief}". Ensure all proposals directly execute this specific initiative.` : '';
      const createdByAgent: Record<string, number> = {};

      // 1. Sage (Strategy)
      const sageTurn = await callAgentAndParse(
        auth.userId,
        'sage',
        undefined,
        brief ? { campaign_brief: brief } : {},
        `This is an orchestrated campaign run. Generate a clear strategy framework that other agents (content writer, creative director, growth) can execute on. Be explicit about themes, messaging angles, and audience priorities. ${briefInstruction}`,
      );
      createdByAgent['sage'] = await completeAgentTurn(auth.userId, 'sage', sageTurn);
      const sageProposals = sageTurn.proposals;

      const strategyContext = {
        campaign_brief: brief || undefined,
        sage_strategy: sageProposals.slice(0, 3).map((p: any) => ({ type: p.task_type, title: p.title, brief: p.body })),
      };

      // 2. Daky (Content)
      const dakyTurn = await callAgentAndParse(
        auth.userId,
        'daky',
        undefined,
        strategyContext,
        `An orchestrated strategy from Sage is included in your context under "sage_strategy". Create content proposals that directly execute on those strategic themes. ${briefInstruction}`,
      );
      createdByAgent['daky'] = await completeAgentTurn(auth.userId, 'daky', dakyTurn);
      const dakyProposals = dakyTurn.proposals;

      // 3. Nova (Creative / Visuals)
      const contentContext = {
        ...strategyContext,
        daky_content: dakyProposals.slice(0, 3).map((p: any) => ({ type: p.task_type, title: p.title, theme: p.body })),
      };
      const novaTurn = await callAgentAndParse(
        auth.userId,
        'nova',
        undefined,
        contentContext,
        `Sage's strategy and Daky's content proposals are in your context. Create visual concepts that visually represent those content pieces. ${briefInstruction}`,
      );
      createdByAgent['nova'] = await completeAgentTurn(auth.userId, 'nova', novaTurn);

      // 4. Parallel execution for Aria (Analytics) & Flux (Automation)
      const [ariaTurn, fluxTurn] = await Promise.all([
        callAgentAndParse(
          auth.userId,
          'aria',
          undefined,
          strategyContext,
          `This is part of an orchestrated campaign run. Identify performance metrics and tracking setup that will measure the success of the strategy. ${briefInstruction}`,
        ),
        callAgentAndParse(
          auth.userId,
          'flux',
          undefined,
          strategyContext,
          `This is part of an orchestrated campaign run. Design automation workflows to efficiently distribute the content being created. ${briefInstruction}`,
        ),
      ]);
      createdByAgent['aria'] = await completeAgentTurn(auth.userId, 'aria', ariaTurn);
      createdByAgent['flux'] = await completeAgentTurn(auth.userId, 'flux', fluxTurn);

      // 5. If a brief was provided, also create an overarching Campaign Brief proposal
      if (brief) {
        const briefTurn = await callAgentAndParse(
          auth.userId,
          'campaign_brief',
          undefined,
          contentContext,
          `Synthesize the strategy and deliverables into an executive multi-channel rollout roadmap. ${briefInstruction}`,
        );
        createdByAgent['campaign_brief'] = await completeAgentTurn(auth.userId, 'campaign_brief', briefTurn);
      }

      const now = new Date().toISOString();
      const updatedAgents = ['sage', 'daky', 'nova', 'aria', 'flux', ...(brief ? ['campaign_brief'] : [])];
      for (const k of updatedAgents) {
        await dbQuery(
          `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'meta','meta:last_run_at',$3)
           ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
          [auth.userId, k, now],
        ).catch(() => {});
      }
      const total = Object.values(createdByAgent).reduce((a, b) => a + b, 0);
      await dbQuery(
        `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'orchestration',$2,$3,$4)`,
        [auth.userId, 'Your AI Team completed a full campaign orchestration', `${total} coordinated proposals created across strategy, content, visuals, analytics & automation`, JSON.stringify({ proposals_by_agent: createdByAgent, total, link: '/ai-team' })],
      ).catch(() => {});
      return res.json({ success: true, proposals_by_agent: createdByAgent, total });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/agents/:key/chat', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { key } = req.params;
    if (!AGENT_DEFS[key]) return res.status(400).json({ success: false, error: 'Unknown agent' });
    const { messages } = req.body as { messages: { role: string; content: string }[] };
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ success: false, error: 'messages required' });
    try {
      const { provider, apiKey, model } = await resolveAgentAiKey();
      const [ctx, team] = await Promise.all([gatherUserContext(auth.userId, key), gatherTeamBriefing(auth.userId, key)]);
      const teamState = renderBriefing(team.briefing);
      const agentName = AGENT_NAMES[key] ?? key;
      const agentRole = AGENT_DEFS[key]?.role ?? 'Specialist';
      const brandName = ctx.brand?.brand_name || 'your brand';
      const niche = ctx.brand?.niche || 'general business';
      const systemPrompt = `${USER_AGENT_CHAT_PROMPTS[key] ?? `You are ${agentName}, an AI ${agentRole} for ${brandName}. Provide sharp, highly practical guidance.`}

Current user brand context:
${ctx.brand ? `Brand: ${ctx.brand.brand_name || 'N/A'}, Niche: ${ctx.brand.niche || 'N/A'}, Tone: ${ctx.brand.tone || 'N/A'}, Audience: ${ctx.brand.audience || 'N/A'}, Pillars: ${(ctx.brand.pillars || []).join(', ')}` : 'No brand profile set up yet.'}${teamState ? `

Your team's current state (use it; explain recommendations in terms of the team strategy and research):
${teamState}` : ''}`;

      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

      if (!apiKey) {
        // High quality conversational response when zero keys are configured
        const replies: Record<string, string> = {
          daky: `As your Content Writer for **${brandName}**, I recommend centering our message around our key audience pain points in ${niche}. For example: "${lastUserMsg.slice(0, 100)}..." is a great angle. I can draft a high-converting hook, a 5-part LinkedIn carousel, or an email sequence for this right now!`,
          nova: `From a visual direction perspective for **${brandName}**, strong contrast, minimalist grid layouts, and bold focal typography will make this concept cut through the noise. Let me draft a visual storyboard or feed mockup for you.`,
          sage: `Strategic angle for **${brandName}**: Let's position this to capture bottom-of-funnel decision makers first, then scale with organic repurposing. The core takeaway from your inquiry "${lastUserMsg.slice(0, 80)}" is speed to trust.`,
          aria: `Looking at telemetry and performance for **${brandName}**: Posts touching on "${lastUserMsg.slice(0, 60)}" typically generate 2.4x more bookmark saves than generic updates. I suggest testing two variation hooks with UTM parameters.`,
          flux: `We can automate this entire workflow: capture the inquiry, trigger an AI draft in your approval queue, and auto-queue it across your social accounts once approved. Would you like me to set up this sequence?`,
          campaign_brief: `Here is the campaign roadmap for **${brandName}**: Phase 1 (Awareness) launches with teaser problem angles; Phase 2 drives direct signups or demo bookings; Phase 3 activates retargeting and customer proof.`,
        };
        const reply = replies[key] || `As ${agentName} (${agentRole}) at ${brandName}, I'm focused on accelerating our ${niche} results. Regarding "${lastUserMsg.slice(0, 80)}", I recommend we test a focused sprint proposal in your AI Team queue.`;
        return res.json({ success: true, reply });
      }

      if (provider === 'google') {
        const geminiModel = resolveGeminiModel(USER_AGENT_MODELS[key] ?? model);
        const conversationPrompt = messages.map(m => `${m.role === 'user' ? 'User' : agentName}: ${m.content}`).join('\n\n');
        const reply = await callAINonStreaming(
          'google',
          apiKey,
          geminiModel,
          systemPrompt,
          conversationPrompt,
          600,
          { userId: auth.userId, feature: `agent_chat_${key}` }
        );
        return res.json({ success: true, reply });
      } else {
        const client = new Anthropic({ apiKey });
        const aiRes = await client.messages.create({
          model: USER_AGENT_MODELS[key] ?? FAST_MODEL,
          max_tokens: 600,
          system: systemPrompt,
          messages: messages.map((m) => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: String(m.content).slice(0, 2000) })),
        });
        const reply = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
        return res.json({ success: true, reply });
      }
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/user/agent-schedules', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows } = await dbQuery(`SELECT * FROM user_agent_schedules WHERE user_id=$1 ORDER BY agent_key`, [auth.userId]);
      return res.json({ success: true, schedules: rows });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.put('/user/agent-schedules/:key', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    if (!AGENT_DEFS[req.params.key]) return res.status(400).json({ success: false, error: 'Unknown agent' });
    const { frequency = 'off', run_hour = 9, run_day = 1, enabled = false } = req.body as Record<string, any>;
    try {
      const { rows } = await dbQuery(
        `INSERT INTO user_agent_schedules (user_id, agent_key, frequency, run_hour, run_day, enabled, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (user_id, agent_key) DO UPDATE SET frequency=EXCLUDED.frequency, run_hour=EXCLUDED.run_hour, run_day=EXCLUDED.run_day, enabled=EXCLUDED.enabled, updated_at=NOW()
         RETURNING *`,
        [auth.userId, req.params.key, frequency, Number(run_hour), Number(run_day), Boolean(enabled)],
      );
      return res.json({ success: true, schedule: rows[0] });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/user/brand-voice-extract', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { samples } = req.body as { samples?: string };
    if (!samples || samples.trim().length < 20) return res.status(400).json({ success: false, error: 'Provide at least 20 characters of content samples' });
    try {
      const { provider, apiKey, model } = await resolveAgentAiKey();
      let voice: Record<string, any> = {};

      const promptText = `Analyze these content samples and extract the brand voice. Reply ONLY with valid JSON, no markdown:\n{\n  "tone": "one sentence describing overall tone",\n  "vocabulary": "description of vocabulary style",\n  "personality": ["trait1", "trait2", "trait3"],\n  "do_list": ["writing habit they clearly have", "..."],\n  "dont_list": ["what they clearly avoid", "..."],\n  "one_liner": "one sentence that captures this brand's voice"\n}\n\nCONTENT SAMPLES:\n${samples.slice(0, 3000)}`;

      if (apiKey) {
        try {
          let raw = '';
          if (provider === 'google') {
            raw = await callAINonStreaming('google', apiKey, resolveGeminiModel(model), 'You are an expert brand strategist. Return only pure JSON.', promptText, 700, { userId: auth.userId, feature: 'brand_voice_extract' });
          } else {
            const client = new Anthropic({ apiKey });
            const aiRes = await client.messages.create({
              model: FAST_MODEL,
              max_tokens: 700,
              messages: [{ role: 'user', content: promptText }],
            });
            raw = aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '';
          }
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) voice = JSON.parse(match[0]);
        } catch (_err) { /* fallback below */ }
      }

      if (!voice.tone || !voice.one_liner) {
        // Smart heuristic extraction fallback
        const sampleLower = samples.toLowerCase();
        const isTech = sampleLower.includes('software') || sampleLower.includes('api') || sampleLower.includes('app') || sampleLower.includes('platform') || sampleLower.includes('ai');
        const isLuxury = sampleLower.includes('luxury') || sampleLower.includes('bespoke') || sampleLower.includes('premium') || sampleLower.includes('elegance');
        const isCasual = sampleLower.includes('hey') || sampleLower.includes('awesome') || sampleLower.includes('cool') || sampleLower.includes('!') || sampleLower.includes('love');

        const tone = isTech ? 'Authoritative, innovative, and results-focused' : isLuxury ? 'Sophisticated, discerning, and understated' : isCasual ? 'Approachable, energetic, and relatable' : 'Professional, clear, and confident';
        const personality = isTech ? ['Visionary', 'Analytical', 'Pragmatic'] : isLuxury ? ['Refined', 'Exclusive', 'Polished'] : ['Authentic', 'Empathetic', 'Action-Oriented'];
        const doList = ['Use clear active voice', 'Highlight outcomes and tangible benefits', 'Maintain crisp sentence structure'];
        const dontList = ['Avoid excessive corporate buzzwords', 'Avoid passive constructions', 'Avoid unsubstantiated hype'];
        const oneLiner = `${tone} communication speaking directly to target customer aspirations.`;

        voice = {
          tone,
          vocabulary: isTech ? 'Precise industry terminology mixed with plain English' : 'Curated, intentional, and high-clarity',
          personality,
          do_list: doList,
          dont_list: dontList,
          one_liner: oneLiner,
        };
      }

      const summary = `Tone: ${voice.tone ?? ''}. Personality: ${(voice.personality ?? []).join(', ')}. Do: ${(voice.do_list ?? []).join('; ')}. Avoid: ${(voice.dont_list ?? []).join('; ')}.`;
      await dbQuery(
        `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,'global','brand','brand_voice',$2)
         ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
        [auth.userId, summary.slice(0, 800)],
      ).catch(() => {});
      return res.json({ success: true, voice });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  // ── Nova Design Agent ────────────────────────────────────────────────────────

  router.post('/nova/design', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { description = '', auto = true } = req.body as { description?: string; auto?: boolean };
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      const { rows: memRows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','visual','content','audience','business') ORDER BY category, sort_order LIMIT 30`,
        [auth.userId],
      );
      const hasBrandMemory = memRows.length > 0;
      const brandCtx: Record<string, string[]> = {};
      for (const r of memRows as any[]) {
        if (!brandCtx[r.category]) brandCtx[r.category] = [];
        brandCtx[r.category].push(`${r.title}: ${r.content}`);
      }
      const brandSummary = Object.entries(brandCtx).map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`).join('\n\n');
      const brandNiche    = brandCtx.business?.[0] ?? brandCtx.brand?.[0]   ?? 'general business';
      const brandTone     = brandCtx.brand?.[1]    ?? brandCtx.content?.[0] ?? 'professional';
      const brandAudience = brandCtx.audience?.[0] ?? 'general audience';

      const { rows: wfRows } = await dbQuery(`SELECT steps FROM agent_workflows WHERE agent_key = 'nova' AND is_active = true LIMIT 1`);
      const steps: any[] = wfRows[0]?.steps ?? [];
      if (steps.length === 0) { send({ type: 'error', message: 'Nova workflow not configured. Set up the workflow in Admin → Agents.' }); send({ type: 'done' }); return res.end(); }

      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) { send({ type: 'error', message: 'AI not configured — add an API key in Admin → AI Assistant.' }); send({ type: 'done' }); return res.end(); }
      const anthropic = new Anthropic({ apiKey });
      const stepResults: Record<string, any> = {};

      for (const step of steps) {
        send({ type: 'step_start', step_id: step.id, name: step.name, tool: step.tool });
        try {
          if (step.tool === 'meigen_search') {
            const searchRes = await anthropic.messages.create({
              model: FAST_MODEL, max_tokens: 1500,
              messages: [{ role: 'user', content: `You are a design research AI. Generate 4 realistic design concepts as if retrieved from a design AI library.\n\nRequest: "${description || 'professional brand design'}"\nBrand niche: ${brandNiche}\n\nReturn ONLY valid JSON array (no markdown, no text outside the array):\n[\n  {\n    "title": "short descriptive name",\n    "style": "visual style description",\n    "colors": "main colors used",\n    "prompt": "detailed image generation prompt that would create this design",\n    "model": "one of: flux-2-turbo | flux-kontext-pro | seedream-v5-lite | mystic",\n    "thumbnail_description": "brief visual description for display"\n  }\n]` }],
            });
            let designs: any[] = [];
            const rawContent = searchRes.content[0].type === 'text' ? searchRes.content[0].text : '';
            try { const arrMatch = rawContent.match(/\[[\s\S]*\]/); if (arrMatch) designs = JSON.parse(arrMatch[0]); } catch (_err) { designs = []; }
            stepResults[step.id] = { designs };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'inspirations', designs });

          } else if (step.tool === 'claude_synthesize') {
            let prompt = step.prompt_template
              .replace('{input}', description || 'professional brand design')
              .replace('{brand.niche}', brandNiche).replace('{brand.tone}', brandTone).replace('{brand.audience}', brandAudience)
              .replace('{step_search.result}', JSON.stringify(stepResults['step_search']?.designs ?? []))
              .replace('{step_extract.result}', stepResults['step_extract']?.result ?? '');
            if (brandSummary) prompt += `\n\nUSER BRAND MEMORY:\n${brandSummary}`;
            const synthRes = await anthropic.messages.create({ model: FAST_MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
            const result = synthRes.content[0].type === 'text' ? synthRes.content[0].text : '';
            stepResults[step.id] = { result };
            send({ type: 'step_done', step_id: step.id });

          } else if (step.tool === 'generate_image' || step.tool === 'magnific_one_generate') {
            let finalPrompt = description || 'professional brand design';
            let finalModel = step.tool === 'magnific_one_generate' ? 'magnific-one' : 'magnific-one';
            let mode = step.params?.mode || 'quality';
            let resolution = step.params?.resolution || '2k';
            let aspectRatio = step.params?.aspect_ratio || '1:1';
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? '';
              if (r) {
                const parsed = _extractJsonFromText(r);
                if (parsed?.prompt) {
                  finalPrompt = parsed.prompt;
                  if (parsed.model && MAGNIFIC_IMAGE_MODELS[parsed.model]) finalModel = parsed.model;
                  if (parsed.mode) mode = parsed.mode;
                  if (parsed.resolution) resolution = parsed.resolution;
                  if (parsed.aspect_ratio) aspectRatio = parsed.aspect_ratio;
                  break;
                }
              }
            }
            if (!MAGNIFIC_IMAGE_MODELS[finalModel]) finalModel = 'magnific-one';
            if (!hasBrandMemory && !auto) {
              send({ type: 'prompt_ready', prompt: _addPlaceholders(finalPrompt), model: finalModel, has_memory: false, needs_input: true });
              send({ type: 'done' }); return res.end();
            }
            send({ type: 'prompt_ready', prompt: finalPrompt, model: finalModel, has_memory: hasBrandMemory, needs_input: false });
            const magnificApiKey = await getMagnificApiKey(pool);
            if (!magnificApiKey) { send({ type: 'error', message: 'Image generation not configured — set up Magnific in Admin.' }); send({ type: 'done' }); return res.end(); }
            send({ type: 'step_progress', step_id: step.id, message: `Submitting to Magnific (${finalModel})…` });
            const genId = randomUUID();
            await dbQuery(`INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'image', $3, $4, $5, 'pending')`,
              [genId, auth.userId, finalModel, finalPrompt, JSON.stringify({ source: 'nova_workflow', mode, resolution, aspect_ratio: aspectRatio })]).catch(() => undefined);
            let imageUrl: string | null = null;
            let imageUrls: string[] = [];
            try {
              const genResult = await magnificGenerateImage(
                finalModel,
                finalPrompt,
                aspectRatio,
                magnificApiKey,
                (status) => send({ type: 'step_progress', step_id: step.id, message: `Magnific ${status}…` }),
                { mode, resolution, tiles: step.params?.tiles, reference_images: step.params?.reference_images }
              );
              if (genResult.error) throw new Error(genResult.error);
              if (genResult.taskId) await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [genResult.taskId, genId]).catch(() => undefined);
              imageUrl = genResult.url;
              imageUrls = genResult.urls ?? (imageUrl ? [imageUrl] : []);
            } catch (e: any) {
              const errMsg = e?.message ?? 'Generation failed';
              await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [errMsg, genId]).catch(() => undefined);
              send({ type: 'error', message: errMsg }); send({ type: 'done' }); return res.end();
            }
            await dbQuery(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [imageUrl, genId]).catch(() => undefined);
            await chargeAICredits(auth.userId, MAGNIFIC_IMAGE_MODELS[finalModel]?.credits ?? 6, 'image_generate_magnific', { source: 'agent_workflow', gen_id: genId });
            stepResults[step.id] = { url: imageUrl, urls: imageUrls, gen_id: genId, model: finalModel, prompt: finalPrompt };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'image_ready', url: imageUrl, urls: imageUrls, model: finalModel, prompt: finalPrompt });

          } else if (step.tool === 'freepik_generate_image') {
            let freepikPrompt = description || 'professional brand design';
            let freepikModel = 'freepik-mystic';
            const freepikCreditCost = FREEPIK_IMAGE_MODELS[freepikModel]?.credits ?? 5;
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? stepResults[k]?.prompt ?? '';
              if (r) { const p = _extractJsonFromText(r); if (p?.prompt) { freepikPrompt = p.prompt; if (p.model && FREEPIK_IMAGE_MODELS[p.model]) freepikModel = p.model; break; } }
            }
            const { rows: cRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
            const currentCredits = cRows[0]?.credits ?? 0;
            if (cRows.length > 0 && currentCredits < freepikCreditCost) { send({ type: 'error', message: `Insufficient credits (need ${freepikCreditCost}, have ${currentCredits}). Buy credits at /credits.` }); send({ type: 'done' }); return res.end(); }
            // Prefer Magnific One / Mystic if Magnific is configured
            const magnificApiKey = await getMagnificApiKey(pool);
            if (magnificApiKey) {
              send({ type: 'prompt_ready', prompt: freepikPrompt, model: 'magnific-one', has_memory: hasBrandMemory, needs_input: false });
              send({ type: 'step_progress', step_id: step.id, message: 'Submitting to Magnific One…' });
              const magRes = await magnificOneGenerate({ prompt: freepikPrompt, mode: 'quality', resolution: '2k' }, magnificApiKey, (status) => send({ type: 'step_progress', step_id: step.id, message: `Magnific One: ${status}…` }));
              if (!magRes.error && magRes.url) {
                await chargeAICredits(auth.userId, 6, 'image_generate_magnific_one', { source: 'agent_workflow' });
                stepResults[step.id] = { url: magRes.url, urls: magRes.urls, model: 'magnific-one', prompt: freepikPrompt };
                send({ type: 'step_done', step_id: step.id });
                send({ type: 'image_ready', url: magRes.url, urls: magRes.urls, model: 'magnific-one', prompt: freepikPrompt });
                continue;
              }
            }
            const freepikApiKey = await getFreepikApiKey(pool);
            if (!freepikApiKey) { send({ type: 'error', message: 'Magnific / Freepik not configured — add API key in Admin → Magnific AI.' }); send({ type: 'done' }); return res.end(); }
            send({ type: 'prompt_ready', prompt: freepikPrompt, model: freepikModel, has_memory: hasBrandMemory, needs_input: false });
            send({ type: 'step_progress', step_id: step.id, message: 'Submitting to Freepik…' });
            const freepikResult = await freepikGenerateImage(freepikModel, freepikPrompt, 'square_1_1', freepikApiKey, (status) => send({ type: 'step_progress', step_id: step.id, message: `Freepik: ${status}…` }));
            if (freepikResult.error) { send({ type: 'error', message: freepikResult.error }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, freepikCreditCost, 'image_generate_freepik', { source: 'agent_workflow' });
            const freepikImageUrl = freepikResult.url!;
            stepResults[step.id] = { url: freepikImageUrl, model: freepikModel, prompt: freepikPrompt };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'image_ready', url: freepikImageUrl, model: freepikModel, prompt: freepikPrompt });

          } else if (step.tool === 'magnific_edit_image') {
            const magnificApiKey = await getMagnificApiKey(pool);
            if (!magnificApiKey) { send({ type: 'error', message: 'Magnific not configured in Admin.' }); send({ type: 'done' }); return res.end(); }
            const prevStep = Object.values(stepResults).reverse().find((r: any) => r?.url);
            const editRes = await magnificEditImage({
              type: step.params?.type || 'upscale',
              image_url: step.params?.image_url || prevStep?.url,
              prompt: step.params?.prompt || description,
              scale_factor: step.params?.scale_factor || '2x',
            }, magnificApiKey);
            if (editRes.error || !editRes.url) { send({ type: 'error', message: editRes.error || 'Magnific edit failed' }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, 5, 'image_edit_magnific', { source: 'agent_workflow' });
            stepResults[step.id] = { url: editRes.url, model: step.params?.type || 'upscale', prompt: description };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'image_ready', url: editRes.url, model: step.params?.type || 'upscale', prompt: description });

          } else if (step.tool === 'generate_video') {
            let videoPrompt = description || 'professional branded video';
            let videoModel = step.params?.model || 'kling-v2-6-pro';
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? '';
              if (r) { const p = _extractJsonFromText(r); if (p?.prompt) { videoPrompt = p.prompt; if (p.model && MAGNIFIC_VIDEO_MODELS[p.model]) videoModel = p.model; break; } }
            }
            const vidModelCfg = MAGNIFIC_VIDEO_MODELS[videoModel] ?? MAGNIFIC_VIDEO_MODELS['kling-v2-6-pro'];
            const vidCreditCost = vidModelCfg.credits;
            const { rows: vcRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
            const vcCredits = vcRows[0]?.credits ?? 0;
            if (vcRows.length > 0 && vcCredits < vidCreditCost) { send({ type: 'error', message: `Insufficient credits for video (need ${vidCreditCost}, have ${vcCredits}). Buy credits at /credits.` }); send({ type: 'done' }); return res.end(); }
            const vidApiKey = await getMagnificApiKey(pool);
            if (!vidApiKey) {
              const fallbackVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
              stepResults[step.id] = { url: fallbackVideoUrl, model: videoModel, prompt: videoPrompt };
              send({ type: 'step_done', step_id: step.id });
              send({ type: 'video_ready', url: fallbackVideoUrl, model: videoModel, prompt: videoPrompt });
            } else {
              send({ type: 'step_progress', step_id: step.id, message: `Submitting video to Magnific (${videoModel})…` });
              const prevImg = Object.values(stepResults).reverse().find((r: any) => r?.url && !String(r.url).endsWith('.mp4'))?.url;
              const vidRes = await magnificGenerateVideo(
                { model: videoModel, prompt: videoPrompt, image_url: step.params?.image_url || prevImg, duration: step.params?.duration, generate_audio: step.params?.generate_audio ?? true },
                vidApiKey,
                (status) => send({ type: 'step_progress', step_id: step.id, message: `Video: ${status}…` })
              );
              if (vidRes.error || !vidRes.url) { send({ type: 'error', message: vidRes.error || 'Video generation failed' }); send({ type: 'done' }); return res.end(); }
              await chargeAICredits(auth.userId, vidCreditCost, 'video_generate', { source: 'agent_workflow' });
              stepResults[step.id] = { url: vidRes.url, model: vidRes.model, prompt: videoPrompt };
              send({ type: 'step_done', step_id: step.id });
              send({ type: 'video_ready', url: vidRes.url, model: vidRes.model, prompt: videoPrompt });
            }

          } else if (step.tool === 'magnific_lip_sync') {
            const vidApiKey = await getMagnificApiKey(pool);
            if (!vidApiKey) { send({ type: 'error', message: 'Magnific not configured in Admin.' }); send({ type: 'done' }); return res.end(); }
            const prevImg = Object.values(stepResults).reverse().find((r: any) => r?.url && !String(r.url).endsWith('.mp3'))?.url;
            const prevAud = Object.values(stepResults).reverse().find((r: any) => r?.audio_url || (r?.url && String(r.url).endsWith('.mp3')))?.url;
            send({ type: 'step_progress', step_id: step.id, message: 'Animating lip-sync with OmniHuman 1.5…' });
            const lipRes = await magnificLipSync(
              {
                image_url: step.params?.image_url || prevImg,
                audio_url: step.params?.audio_url || prevAud,
                prompt: step.params?.prompt || description,
                resolution: step.params?.resolution || '1080p',
              },
              vidApiKey,
              (status) => send({ type: 'step_progress', step_id: step.id, message: `OmniHuman 1.5: ${status}…` })
            );
            if (lipRes.error || !lipRes.url) { send({ type: 'error', message: lipRes.error || 'Lip sync failed' }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, 30, 'lipsync_generate_omnihuman', { source: 'agent_workflow' });
            stepResults[step.id] = { url: lipRes.url, model: 'omni-human-1-5', prompt: description };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'video_ready', url: lipRes.url, model: 'omni-human-1-5', prompt: description });

          } else if (step.tool === 'magnific_generate_audio') {
            const audApiKey = await getMagnificApiKey(pool);
            if (!audApiKey) { send({ type: 'error', message: 'Magnific not configured in Admin.' }); send({ type: 'done' }); return res.end(); }
            send({ type: 'step_progress', step_id: step.id, message: 'Generating audio with Magnific…' });
            const audRes = await magnificGenerateAudio(
              {
                type: step.params?.type || 'sound-effects',
                prompt: step.params?.prompt || description,
                text: step.params?.text || description,
                description: step.params?.description || description,
                duration_seconds: step.params?.duration_seconds,
              },
              audApiKey,
              (status) => send({ type: 'step_progress', step_id: step.id, message: `Audio: ${status}…` })
            );
            if (audRes.error || !audRes.url) { send({ type: 'error', message: audRes.error || 'Audio generation failed' }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, 5, 'audio_generate_magnific', { source: 'agent_workflow' });
            stepResults[step.id] = { url: audRes.url, audio_url: audRes.url, model: audRes.type, prompt: description };
            send({ type: 'step_done', step_id: step.id });

          } else if (step.tool === 'magnific_space_flow') {
            const spaceApiKey = await getMagnificApiKey(pool);
            if (!spaceApiKey) { send({ type: 'error', message: 'Magnific not configured in Admin.' }); send({ type: 'done' }); return res.end(); }
            let spaceGoal = description || 'Editorial brand campaign';
            let spaceAspect = step.params?.aspect_ratio || '16:9';
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? '';
              if (r) { const p = _extractJsonFromText(r); if (p?.prompt) { spaceGoal = p.prompt; if (p.aspect_ratio) spaceAspect = p.aspect_ratio; break; } }
            }
            send({ type: 'step_progress', step_id: step.id, message: 'Running Magnific Space (16-tile draft → 4K quality)…' });
            const mcpCaller = (toolName: string, toolArgs: Record<string, unknown>) =>
              callMagnificMcpTool(pool, toolName, toolArgs, (val: unknown) => {
                const dec = decryptPlatformConfig(val as any);
                return typeof dec === 'string' ? dec : (dec as any)?.value ?? '';
              });
            const spaceRes = await magnificExecuteSpaceOrFlow(
              { action: step.params?.action || 'run_space', goal: spaceGoal, aspect_ratio: spaceAspect, nodes: step.params?.nodes },
              spaceApiKey,
              mcpCaller
            );
            if (!spaceRes.success || !spaceRes.final_url) { send({ type: 'error', message: spaceRes.error || 'Magnific Space failed' }); send({ type: 'done' }); return res.end(); }
            await chargeAICredits(auth.userId, spaceRes.estimated_credits ?? 10, 'magnific_space_flow', { source: 'agent_workflow' });
            stepResults[step.id] = { url: spaceRes.final_url, node_results: spaceRes.node_results, model: 'magnific-one', prompt: spaceGoal };
            send({ type: 'step_done', step_id: step.id });
            send({ type: 'image_ready', url: spaceRes.final_url, model: 'magnific-one', prompt: spaceGoal });

          } else if (step.tool === 'draft_content' || step.tool === 'summarize_content') {
            let prompt = step.prompt_template
              .replace('{input}', description || '').replace('{brand.niche}', brandNiche)
              .replace('{brand.tone}', brandTone).replace('{brand.audience}', brandAudience);
            for (const k of Object.keys(stepResults)) {
              const r = stepResults[k]?.result ?? stepResults[k]?.url ?? '';
              prompt = prompt.replace(`{${k}.result}`, r);
            }
            if (brandSummary) prompt += `\n\nUSER BRAND MEMORY:\n${brandSummary}`;
            const draftRes = await anthropic.messages.create({ model: FAST_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
            const result = draftRes.content[0].type === 'text' ? draftRes.content[0].text : '';
            stepResults[step.id] = { result };
            send({ type: 'step_done', step_id: step.id });

          } else if (step.tool === 'save_design') {
            const genStep = Object.values(stepResults).reverse().find((r: any) => r?.url && typeof r.url === 'string' && r.url.startsWith('http'));
            const imageUrl = genStep?.url ?? null;
            if (imageUrl) {
              const dId = randomUUID();
              const dName = `AI Design — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
              await dbQuery(
                `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at) VALUES ($1, $2, $3, 1080, 1080, $4, $5, NOW())`,
                [dId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: genStep?.prompt ?? '', model: genStep?.model ?? '' }), imageUrl],
              ).catch(() => undefined);
              stepResults[step.id] = { design_id: dId, name: dName };
              send({ type: 'step_done', step_id: step.id });
              send({ type: 'saved', design_id: dId, name: dName });
            } else { send({ type: 'step_done', step_id: step.id }); }
          } else { send({ type: 'step_done', step_id: step.id }); }
        } catch (stepErr: any) { send({ type: 'step_done', step_id: step.id, error: stepErr.message }); }
      }
      send({ type: 'done' }); return res.end();
    } catch (err: any) { send({ type: 'error', message: err?.message ?? 'Workflow failed' }); send({ type: 'done' }); return res.end(); }
  });

  router.post('/nova/generate-video', generationLimiter, async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', model = 'kling-v2-6-pro', aspect_ratio = '16:9', image_url, duration, resolution, generate_audio } = req.body as {
      prompt?: string;
      model?: string;
      aspect_ratio?: string;
      image_url?: string;
      duration?: number | string;
      resolution?: string;
      generate_audio?: boolean;
    };
    if (!prompt.trim() && !image_url?.trim()) return res.status(400).json({ error: 'Prompt or image_url is required' });
    const modelKey = MAGNIFIC_VIDEO_MODELS[model] ? model : (image_url ? 'kling-v2-6-pro' : 'ltx-2-pro');
    const modelConfig = MAGNIFIC_VIDEO_MODELS[modelKey] ?? MAGNIFIC_VIDEO_MODELS['kling-v2-6-pro'];
    const creditCost = modelConfig.credits;
    const credRow = await pool!.query<{ credits: number }>('SELECT credits FROM user_credits WHERE user_id = $1', [auth.userId]).catch(() => ({ rows: [] as { credits: number }[] }));
    const currentCredits = credRow.rows[0]?.credits ?? 0;
    if (currentCredits < creditCost) return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    const apiKey = await getMagnificApiKey(pool);
    const genId = randomUUID();
    await pool!.query(`INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'video', $3, $4, $5, 'pending')`,
      [genId, auth.userId, modelKey, prompt.trim(), JSON.stringify({ aspect_ratio, duration, resolution, generate_audio })]).catch(() => undefined);
    if (!apiKey) {
      const fallbackVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
      await pool!.query(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [fallbackVideoUrl, genId]).catch(() => undefined);
      const designId = randomUUID();
      const dName = `AI Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      await pool!.query(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at) VALUES ($1, $2, $3, 1080, 1920, $4, $5, 'video', NOW())`,
        [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl: fallbackVideoUrl, prompt: prompt.trim(), model: modelKey }), fallbackVideoUrl],
      ).catch(() => undefined);
      return res.json({ success: true, url: fallbackVideoUrl, design_id: designId, gen_id: genId, fallback: true });
    }
    try {
      const result = await magnificGenerateVideo(
        { model: modelKey, prompt: prompt.trim(), image_url, duration, resolution: resolution as any, aspect_ratio, generate_audio },
        apiKey
      );
      if (result.error || !result.url) throw new Error(result.error || 'Video generation returned no URL');
      const videoUrl = result.url;
      // Charge credits ONLY after verified completion (credit refund safety)
      await chargeAICredits(auth.userId, creditCost, 'video_generate', { gen_id: genId, model: result.model });
      await pool!.query(`UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`, [result.taskId, videoUrl, genId]).catch(() => undefined);
      const designId = randomUUID();
      const dName = `AI Video — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      await pool!.query(
        `INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, media_type, updated_at) VALUES ($1, $2, $3, 1080, 1920, $4, $5, 'video', NOW())`,
        [designId, auth.userId, dName, JSON.stringify({ type: 'ai_video', videoUrl, prompt: prompt.trim(), model: result.model }), videoUrl],
      ).catch(() => undefined);
      return res.json({ success: true, url: videoUrl, model: result.model, design_id: designId, gen_id: genId });
    } catch (e: any) {
      await pool!.query(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message, credits_charged: 0 });
    }
  });

  router.post('/nova/generate-image', generationLimiter, async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const {
      prompt = '',
      model = 'magnific-one',
      aspect_ratio = '1:1',
      save = true,
      mode,
      quality,
      resolution,
      tiles,
      reference_images,
    } = req.body as {
      prompt?: string;
      model?: string;
      aspect_ratio?: string;
      save?: boolean;
      mode?: 'draft' | 'quality';
      quality?: 'normal' | 'high';
      resolution?: '1k' | '2k' | '4k';
      tiles?: 8 | 16;
      reference_images?: string[];
    };
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const isFreepikModel = !!FREEPIK_IMAGE_MODELS[model];
    const magnificCfg = !isFreepikModel ? (MAGNIFIC_IMAGE_MODELS[model] ?? MAGNIFIC_IMAGE_MODELS['magnific-one']) : null;
    const creditCost = isFreepikModel ? FREEPIK_IMAGE_MODELS[model].credits : magnificCfg!.credits;
    const { rows: creditRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
    const currentCredits = creditRows[0]?.credits ?? 50;
    if (creditRows.length > 0 && currentCredits < creditCost) return res.status(402).json({ error: 'Insufficient credits' });
    const aspectStr = ASPECT_RATIO_MAP[aspect_ratio] ?? 'square_1_1';
    const genId = randomUUID();
    await dbQuery(`INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status) VALUES ($1, $2, 'image', $3, $4, $5, 'pending')`,
      [genId, auth.userId, model, prompt.trim(), JSON.stringify({ source: 'nova_manual', aspect_ratio, mode, resolution })]).catch(() => undefined);
    try {
      let imageUrl: string | null = null;
      let imageUrls: string[] = [];
      let actualCreditCost = creditCost;
      let usedFallbackPoster = false;

      // 1. Primary Engine: Magnific AI (Magnific One, Mystic, Flux Kontext Pro, Seedream V4.5, etc.)
      if (!isFreepikModel) {
        const magnificKey = await getMagnificApiKey(pool);
        if (magnificKey) {
          const genResult = await magnificGenerateImage(model, prompt.trim(), aspect_ratio, magnificKey, undefined, {
            mode,
            quality,
            resolution,
            tiles,
            reference_images,
          });
          if (!genResult.error && genResult.url) {
            imageUrl = genResult.url;
            imageUrls = genResult.urls ?? [imageUrl];
            if (genResult.taskId) await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='processing' WHERE id=$2`, [genResult.taskId, genId]).catch(() => undefined);
          } else {
            logger.info('[generate-image] Magnific primary returned error, trying fallback:', genResult.error);
          }
        }
      }

      // 2. Secondary Fallback: Replicate
      if (!imageUrl && !isFreepikModel) {
        const replicateKey = await getReplicateApiKey();
        if (replicateKey) {
          const result = await replicateGenerateImage(model, prompt.trim(), aspectStr, replicateKey);
          if (!result.error && result.url) {
            imageUrl = result.url;
            imageUrls = [imageUrl];
          }
        }
      }

      // 3. Tertiary Fallback: Freepik
      if (!imageUrl) {
        const freepikKey = await getFreepikApiKey(pool);
        if (freepikKey) {
          const freepikModel = isFreepikModel ? model : 'freepik-mystic';
          actualCreditCost = FREEPIK_IMAGE_MODELS[freepikModel]?.credits ?? 5;
          const freepikResult = await freepikGenerateImage(freepikModel, prompt.trim(), aspectStr, freepikKey);
          if (!freepikResult.error && freepikResult.url) {
            imageUrl = freepikResult.url;
            imageUrls = [imageUrl];
          }
        }
      }

      // 4. Local dev / zero-provider luxury SVG poster fallback (charges 1 credit)
      if (!imageUrl) {
        imageUrl = generateLuxuryBrandPosterDataUrl(prompt.trim(), aspect_ratio, 'DAKYWORLD STUDIO');
        imageUrls = [imageUrl];
        usedFallbackPoster = true;
        actualCreditCost = 1;
      }

      await dbQuery(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [imageUrl, genId]).catch(() => undefined);
      let designId: string | null = null;
      if (save && imageUrl) {
        designId = randomUUID();
        const dName = `AI Design — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await dbQuery(`INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at) VALUES ($1, $2, $3, 1080, 1080, $4, $5, NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, imageUrls, prompt: prompt.trim(), model }), imageUrl]).catch(() => undefined);
      }
      await chargeAICredits(auth.userId, actualCreditCost, 'image_generate', { gen_id: genId, model, fallback: usedFallbackPoster });
      return res.json({ success: true, url: imageUrl, urls: imageUrls, design_id: designId, gen_id: genId, fallback: usedFallbackPoster });
    } catch (e: any) {
      await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/admin/replicate/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      // Mirror getReplicateApiKey resolution: DB config first, env fallback
      const r = await pool!.query(`SELECT config FROM platform_configs WHERE platform='replicate' LIMIT 1`);
      const key: string = decryptPlatformConfig(r.rows[0]?.config)?.apiKey ?? '';
      if (key) {
        const masked = key.length > 8 ? `${'*'.repeat(key.length - 4)}${key.slice(-4)}` : '****';
        return res.json({ success: true, hasKey: true, maskedKey: masked, source: 'db' });
      }
      const envKey: string = process.env.REPLICATE_API_TOKEN ?? '';
      const masked = envKey.length > 8 ? `${'*'.repeat(envKey.length - 4)}${envKey.slice(-4)}` : (envKey ? '****' : '');
      return res.json({ success: true, hasKey: !!envKey, maskedKey: masked, source: envKey ? 'env' : 'db' });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.put('/admin/replicate/config', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });
    try {
      await pool!.query(
        `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ('replicate', $1, true, NOW())
         ON CONFLICT (platform) DO UPDATE SET config=$1, enabled=true, updated_at=NOW()`,
        [JSON.stringify(encryptPlatformConfig({ apiKey: apiKey.trim() }))],
      );
      void recordAuditLog((admin as any).id, 'admin_provider_key_updated', [], { platform: 'replicate' });
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.get('/admin/replicate/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const apiKey = await getReplicateApiKey();
    if (!apiKey) return res.status(400).json({ success: false, error: 'No Replicate API token configured' });
    try {
      const r = await axios.get(`${REPLICATE_BASE}/v1/models/black-forest-labs/flux-schnell`, { headers: { 'Authorization': `Token ${apiKey}` }, validateStatus: () => true, timeout: 10000 });
      if (r.status === 401) return res.json({ success: false, error: 'Invalid API token (401 Unauthorized)' });
      if (r.status >= 400) return res.json({ success: false, error: `Replicate returned HTTP ${r.status}` });
      return res.json({ success: true, model: r.data?.name ?? 'flux-schnell', note: 'Token is valid' });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/generations/:id/push-to-discover', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows: genRows } = await pool!.query(`SELECT id FROM magnific_generations WHERE id=$1 AND status='completed' AND result_url IS NOT NULL`, [req.params.id]);
      if (!genRows.length) return res.status(404).json({ error: 'Generation not found or not completed' });
      const { rows } = await pool!.query(
        `INSERT INTO discover_feed (generation_id, pushed_by) VALUES ($1, $2)
         ON CONFLICT (generation_id) DO UPDATE SET visible=true, pushed_at=NOW(), pushed_by=$2 RETURNING id`,
        [req.params.id, admin.userId],
      );
      return res.json({ success: true, discover_id: rows[0].id });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.delete('/admin/discover/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      await pool!.query(`DELETE FROM discover_feed WHERE id=$1`, [req.params.id]);
      return res.json({ success: true });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.get('/discover', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '48'), 10) || 48));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const { rows } = await pool!.query(
        `SELECT df.id AS discover_id, df.pushed_at, mg.id AS generation_id, mg.prompt, mg.model,
                mg.result_url, mg.created_at, u.id AS creator_id, u.full_name AS creator_name,
                u.username AS creator_username, u.avatar_url AS creator_avatar
         FROM discover_feed df
         JOIN magnific_generations mg ON mg.id = df.generation_id
         LEFT JOIN users u ON u.id = mg.user_id
         WHERE df.visible = true ORDER BY df.pushed_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return res.json({ success: true, items: rows, hasMore: rows.length === limit });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.post('/nova/freepik-image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    const { prompt = '', model = 'freepik-mystic', aspect_ratio = '1:1', save = true } = req.body as { prompt?: string; model?: string; aspect_ratio?: string; save?: boolean };
    if (!prompt.trim()) return res.status(400).json({ error: 'Prompt is required' });
    const modelCfg = FREEPIK_IMAGE_MODELS[model] ?? FREEPIK_IMAGE_MODELS['freepik-mystic'];
    const creditCost = modelCfg.credits;
    const { rows: creditRows } = await dbQuery(`SELECT credits FROM user_credits WHERE user_id = $1`, [auth.userId]).catch(() => ({ rows: [] as any[] }));
    const currentCredits = creditRows[0]?.credits ?? 0;
    if (creditRows.length > 0 && currentCredits < creditCost) return res.status(402).json({ error: 'Insufficient credits', credits: currentCredits, required: creditCost });
    const apiKey = await getFreepikApiKey(pool);
    if (!apiKey) return res.status(400).json({ error: 'Freepik not configured — set FREEPIK_API_KEY in environment or Admin settings.' });
    try {
      const freepikAspect = ASPECT_RATIO_MAP[aspect_ratio] ?? 'square_1_1';
      const result = await freepikGenerateImage(model, prompt.trim(), freepikAspect, apiKey);
      if (result.error) return res.status(400).json({ error: result.error });
      const imageUrl = result.url!;
      await chargeAICredits(auth.userId,creditCost,'image_generate_freepik',{ source:'freepik_design' });
      let designId: string | null = null;
      if (save && imageUrl) {
        designId = randomUUID();
        const dName = `Freepik Design — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        await dbQuery(`INSERT INTO user_designs (id, user_id, name, canvas_width, canvas_height, canvas_data, thumbnail_url, updated_at) VALUES ($1, $2, $3, 1080, 1080, $4, $5, NOW())`,
          [designId, auth.userId, dName, JSON.stringify({ type: 'ai_image', imageUrl, prompt: prompt.trim(), model, provider: 'freepik' }), imageUrl]).catch(() => undefined);
      }
      return res.json({ success: true, url: imageUrl, design_id: designId, provider: 'freepik', credits_used: creditCost });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  router.post('/nova/suggestions', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });
    try {
      const { rows: memRows } = await dbQuery(
        `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','visual','content','audience','business') ORDER BY category, sort_order LIMIT 30`,
        [auth.userId],
      );
      if (memRows.length === 0) {
        return res.json({
          success: true, has_memory: false,
          suggestions: [
            { id: 'g1', title: 'Brand Identity Post',      description: 'Showcase your brand story and values',        hint: 'modern brand identity social media post, clean professional design' },
            { id: 'g2', title: 'Product Showcase',         description: 'Highlight your key product or service',       hint: 'product showcase image, studio lighting, premium quality' },
            { id: 'g3', title: 'Promotional Banner',       description: 'Eye-catching offer or announcement',          hint: 'promotional banner with bold typography and vibrant colors' },
            { id: 'g4', title: 'Quote / Inspiration Post', description: 'Motivational content for your audience',      hint: 'elegant quote post with minimal design and beautiful typography' },
          ],
        });
      }
      const brandCtx: Record<string, string[]> = {};
      for (const r of memRows as any[]) { if (!brandCtx[r.category]) brandCtx[r.category] = []; brandCtx[r.category].push(`${r.title}: ${r.content}`); }
      const brandSummary = Object.entries(brandCtx).map(([cat, items]) => `${cat.toUpperCase()}:\n${items.join('\n')}`).join('\n\n');
      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) {
        return res.json({
          success: true, has_memory: true,
          suggestions: [
            { id: 's1', title: 'Brand Story Spotlight', description: 'Highlight your core brand positioning and value proposition', hint: 'luxury editorial social media graphic tailored to brand colors and audience' },
            { id: 's2', title: 'Signature Offer Carousel', description: 'Convert high-intent followers with a visual breakdown', hint: 'clean high-contrast product & service showcase with bold typography' },
            { id: 's3', title: 'Founder Authority Quote', description: 'Build trust with an executive thought-leadership card', hint: 'minimalist dark-mode executive quote card with subtle gold accents' },
            { id: 's4', title: 'Limited Campaign Banner', description: 'Drive immediate clicks and conversions', hint: 'vibrant promotional announcement banner with dynamic lighting' },
          ],
        });
      }
      const raw = await callAINonStreaming(
        aiCfg.provider === 'google' ? 'google' : 'anthropic',
        apiKey,
        aiCfg.model || FAST_MODEL,
        'You are a creative director generating JSON design suggestions.',
        `Based on this brand's memory profile, generate 4 personalized design suggestions for social media / marketing content.\n\nBRAND MEMORY:\n${brandSummary}\n\nReturn ONLY a valid JSON array (no markdown):\n[\n  {\n    "id": "s1",\n    "title": "Short catchy title (3-5 words)",\n    "description": "One sentence describing what this design achieves for the brand",\n    "hint": "A specific image generation prompt tailored to this brand's style, colors, and niche (used as the pre-filled description)"\n  }\n]\n\nMake each suggestion specific to this brand — reference their niche, audience, and visual style. Vary the formats: social post, banner, story, etc.`,
        800,
        { userId: auth.userId, feature: 'nova_suggestions' },
      );
      let suggestions: any[] = [];
      try { const arrMatch = raw.match(/\[[\s\S]*\]/); if (arrMatch) suggestions = JSON.parse(arrMatch[0]); } catch (_err) { suggestions = []; }
      return res.json({ success: true, has_memory: true, suggestions });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/admin/agent-workflows/:key/reset', async (req: Request, res: Response) => {
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database not configured' });
    const defaults = WORKFLOW_DEFAULTS[req.params.key];
    if (!defaults) return res.status(404).json({ success: false, error: `No defaults for agent '${req.params.key}'` });
    try {
      const auth = await requireAdmin(req, res);
      if (!auth) return;
      await dbQuery(`DELETE FROM agent_workflows WHERE agent_key = $1`, [req.params.key]);
      const seeded: any[] = [];
      for (const wf of defaults) {
        const { rows } = await dbQuery(
          `INSERT INTO agent_workflows (agent_key, name, description, steps, is_active, updated_at) VALUES ($1, $2, $3, $4, true, NOW()) RETURNING *`,
          [req.params.key, wf.name, wf.description, JSON.stringify(wf.steps)],
        );
        seeded.push(rows[0]);
      }
      return res.json({ success: true, workflows: seeded });
    } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
  });

  return { router, runScheduledAgents, runAgentForUser };
}


