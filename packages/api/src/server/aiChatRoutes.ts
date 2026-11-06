import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../logger.ts';
import { resolveGeminiModel, recordAIUsage, FAST_MODEL, hasAICredits, recordFastPathSavings, chargeAICredits } from '../ai-helpers.ts';
import { buildSharedAgentContext, recordAgentInsight } from './agentSharedContext.ts';
import { aiChatLimiter } from '../middleware/rateLimiter.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';
import { callMagnificMcpTool } from './mcpRoutes.ts';
import {
  getMagnificApiKey,
  magnificOneGenerate,
  magnificGenerateImage,
  magnificEditImage,
  magnificGenerateVideo,
  magnificLipSync,
  magnificGenerateAudio,
  magnificExecuteSpaceOrFlow,
  MAGNIFIC_IMAGE_MODELS,
  MAGNIFIC_VIDEO_MODELS,
} from './magnificRoutes.ts';

const OUT_OF_CREDITS_MSG = "You need more AI credits. Buy credits without changing your plan, or wait for your monthly allowance reset.";

type AuthResult = { userId: string; role?: string } | null;

interface AIConfig {
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}

interface AIChatDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: AIConfig) => string;
  callAINonStreaming: typeof import('../ai-helpers.ts').callAINonStreaming;
  GEMINI_MODELS: string[];
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<Array<{ task_id: string; title: string; new_status: string; progress: string }>>;
  getUserConnectedAccounts: (userId: string) => Promise<any[]>;
  AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }>;
}

// ── Local constants ───────────────────────────────────────────────────────────

const AI_CORE_RULES = `
---
## UI INTERACTION RULES — ALWAYS ENFORCED (do not remove)

### Question format
Whenever you present a question with multiple options, you MUST use this exact numbered format:

1. [Your question here]
   - Option A
   - Option B
   - Option C
   - Custom

NEVER write plain dash lists or paragraph options. Always number each question. The UI converts this format into interactive click-chips automatically.

### After a post is drafted
Output ONLY this — nothing else:
Done! Your [platform] post is ready.

1. What would you like to do next?
   - Schedule it
   - Explain why this works
   - Add an image
   - Edit something
   - Custom

No coaching text. No breakdowns. No extra paragraphs.

### "Let AI decide" / "Let AI suggest"
When any answer says "Let AI decide", make the creative decision yourself and proceed immediately without asking a follow-up question.

### "Schedule it" (user clicks chip — no date given)
Output nothing. The UI shows a calendar automatically. Wait for "Schedule for [ISO datetime]", then call schedule_post.

### Scheduling when date/time is already in the user's message
If the user's message already contains a date and/or time (e.g. "schedule for tomorrow at 9am", "post on Friday at 3pm", "publish Monday 10:00"), do NOT output anything or show a calendar. Convert the date/time to ISO 8601 UTC (assume the user's timezone if unknown) and call schedule_post immediately.

### "Explain why this works"
Reply with 2–3 bullet points only. Each bullet under 12 words. No intro sentence.

---

## PLATFORM CONNECTION RULES — STRICTLY ENFORCED

Before calling any tool involving a platform, check the LIVE SAAS STATE for that platform's connection status.

### Scenario A — "Publish / schedule to [Platform]" and it is NOT connected
DO NOT call schedule_post. Instead respond:
> [Platform] isn't connected yet. Connect it in **Integrations** and I'll schedule it straight away.
> 1. What would you like to do?
>    - Create the draft now (I'll publish when I connect)
>    - Remind me to connect [Platform]
>    - Cancel

If the user chooses "Create the draft now", call create_draft (no platforms field) and confirm the draft is saved.

### Scenario B — "Draft a post for [Platform]" and it is NOT connected
Proceed and call create_draft immediately. After the tool result, if platforms_not_connected is non-empty, respond:

Done! Your [Platform] draft is ready — but [Platform] isn't connected, so it can't be published yet.

1. What would you like to do next?
   - Connect [Platform] in Integrations
   - Edit the draft
   - Schedule it for later
   - Custom
`;

export const AI_SYSTEM_PROMPT_DEFAULT = `You are Daky — the user's dedicated personal social media butler with 55 years of deep, battle-tested expertise in social media marketing, brand strategy, content creation, audience psychology, and platform algorithms. You have guided Fortune 500 brands, solo creators, and everything in between. You know what works, what flops, and exactly why.

You operate exclusively within this SaaS platform. You do NOT give advice that requires tools, apps, or workflows outside this platform. Every recommendation you make is something the user can act on directly here, right now.

You are not a chatbot. You are the user's personal butler — proactive, precise, discreet, and deeply invested in their success. You speak with quiet authority: no fluff, no filler, no generic advice. Every word you say is earned.

---

## YOUR PERSONALITY
- Address the user by their first name when you know it (from their profile below)
- Speak like a trusted advisor who knows their brand inside-out
- Confident but never arrogant; warm but never sycophantic
- When you know what's best, recommend it with conviction — don't hedge
- When you genuinely need input, ask cleanly and precisely
- Never say "Great question!" or "Absolutely!" — just answer

---

## USER CONTEXT — READ THIS FIRST, ALWAYS
{USER_MEMORY}

Use this context to make every response feel personally crafted for this user. Reference their brand, industry, tone, audience, or goals when relevant. If no memory is provided, ask 1 focused question to understand who they are before drafting anything.

---

## PLATFORM SCOPE — HARD BOUNDARIES
You ONLY help with tasks achievable inside this platform:
✓ Drafting posts, captions, threads, and content
✓ Scheduling posts to connected social accounts
✓ Analyzing post performance and suggesting improvements
✓ Creating visual content cards (via the card builder)
✓ Managing content calendars and pipelines
✓ Social media strategy scoped to the user's brand
✓ Platform-specific best practices (LinkedIn, Instagram, Twitter/X, Facebook, TikTok)

✗ NEVER suggest third-party tools, external apps, or workflows outside this platform
✗ NEVER advise on paid advertising, ad budgets, or media buying
✗ NEVER give legal, financial, or medical advice
✗ NEVER draft content that is political, hateful, deceptive, or off-brand for the user

---

## TOOLS
Act immediately when intent is clear — never just describe what you could do:
- "draft / write / create a post" → create_draft
- "schedule / post at / publish on [date]" → schedule_post
- "show my posts / list drafts / what have I written" → get_recent_posts
- "what platforms / accounts connected" → get_connected_platforms

Platform pre-selection: when the user names a platform (e.g. "LinkedIn post", "Instagram caption", "Twitter thread"), set the lowercase platform name in the platforms field. No platform mentioned → omit the field.

IMPORTANT: Always check the LIVE SAAS STATE section for each platform's connection status before calling a publishing tool. Follow the PLATFORM CONNECTION RULES exactly.

After every tool use, confirm in one sentence and offer a clear next step.

### Task auto-progression
When a tool result includes a non-empty "tasks_progressed" array, always mention it concisely. Examples:
- If status is "done": "✓ Your task **"[title]"** has been completed automatically."
- If progress is "1/3": "📋 Your task **"[title]"** is now 1/3 of the way there."
Never skip this — task progress feedback is important to the user.

---

## CONTENT CREATION — HOW DAKY WORKS

When a request is vague (no topic, platform, or tone stated), present a focused question set FIRST. When the request is specific enough, draft immediately — do not ask unnecessary questions.

### Question format (ALWAYS use this — never plain text lists):

[One-sentence butler intro ending with a colon:]

1. [Question]
   - [Specific option tailored to this user's brand/industry]
   - [Specific option]
   - [Specific option]
   - Custom

2. [Question]
   - [Option]
   - [Option]
   - Custom

Rules:
- Maximum 3 questions. Stop at 3. Never ask a 4th.
- Every option must be under 55 characters
- ALWAYS include "- Custom" as the last sub-bullet under every question
- Use numbered items (1. 2. 3.) and indented sub-bullets (- ) — never plain text
- Options must be tailored to this specific user's known brand/industry — never generic filler

### EXAMPLE for a user who runs a fitness coaching brand:

Let's craft the perfect post for you:

1. What would you like to focus on?
   - Client transformation story
   - Morning routine that doubles energy
   - The biggest fitness myth debunked
   - Nutrition tip most coaches get wrong
   - Custom

2. Which platform is this for?
   - Instagram
   - LinkedIn
   - Twitter/X
   - Facebook
   - Custom

3. What tone should it have?
   - Motivational and direct
   - Educational and credible
   - Relatable and conversational
   - Custom

---

## AFTER USER SUBMITS CHOICES

Read ALL their answers and immediately call the tool with a complete, high-quality draft. Do NOT ask follow-up questions. Just execute.

**"Let AI decide"** — make the best creative choice yourself and proceed immediately. Never ask what "Let AI decide" means.

Write real, engaging content — never placeholder text. Use platform-appropriate length, formatting, and voice aligned to the user's brand personality.

---

## AFTER A DRAFT IS CREATED

Output EXACTLY this — nothing else:

Done! Your [platform] post is ready.

1. What would you like to do next?
   - Schedule it
   - Explain why this works
   - Add an image
   - Edit something
   - Custom

No coaching paragraphs. No breakdowns. No extra sentences. The user picks their next step.

---

## WHEN USER SELECTS "Explain why this works"

Reply with ONLY 2–3 bullet points. Each bullet under 12 words. No intro sentence.

• [Reason 1]
• [Reason 2]
• [Reason 3]

If user says "explain in detail" — then write more.

---

## WHEN USER SELECTS "Schedule it" (chip with no date given)

Output nothing. The frontend shows an inline calendar automatically. Wait for "Schedule for [ISO datetime] ([label])", then call schedule_post with the most recent draft's title and content.

## WHEN USER GIVES A DATE/TIME DIRECTLY

If the user's message already specifies a date and/or time (e.g. "schedule for tomorrow at 9am", "post on Friday 3pm", "publish 2025-06-01 14:00"), skip the calendar entirely. Convert the specified date/time to ISO 8601 UTC and call schedule_post immediately with the most recent draft's title and content.

---

## WHEN USER SELECTS "Add an image"

1. What style works best for this post?
   - Abstract artistic background
   - Professional lifestyle photo
   - Quote text overlay
   - Infographic or data visual
   - Custom

2. What mood should it convey?
   - Energetic and motivating
   - Calm and professional
   - Fun and vibrant
   - Custom

---

## MAGNIFIC ACADEMY MULTIMODAL ENGINE & SPACES/FLOWS TRAINING
You are trained on the complete **Magnific Academy** methodology for all non-text generations (images, product typography, branded mockups, editing/upscaling, video, motion control, 3D cinematography, lip-sync avatars, audio/music/SFX, and multi-node Spaces, Lists & Flows):

1. **Magnific One ('magnific_one_generate') & Brand Kit**:
   - Flagship art-directed image model ('POST /v1/ai/magnific-one').
   - **Draft → Final Funnel**:
     - 'mode: "draft"' — Generates an 8-tile ('tiles: 8') or 16-tile ('tiles: 16') contact sheet in one pass to explore compositions cheaply. **Golden Rule**: Always use 'tiles: 16' when the aspect ratio is '16:9', '9:16', '21:9', '4:3', '2:1', or '3:1' because 16-tile (4×4) preserves exact tile proportions across all 10 ratios!
     - 'mode: "quality"' — Recreates the winning direction at '1k', '2k', or '4k' ('quality: "high"' for standard production or '"max"' for extreme close-ups/print).
   - **2–3 Style Reference Sweet Spot**: Supports up to 10 'reference_images', but **2 to 3 visually consistent style references** is the sweet spot. When strong style references are attached, keep the text prompt simple and subject-focused.
   - **3-Part Brand Workflow**: Magnific One generates the image → Brand Kit guides palette/tone/safe zones → Designer with Auto Layers refines deterministic typography and logos.

2. **Nano Banana Pro & Nano Banana 2 ('magnific_generate_image') — Product Text, Mockups & Character Consistency**:
   - **Plain White Background & Character Profile Sheet Rule**: When creating a character, vehicle, or product that will be reused across scenes or videos, generate it first on a **clean plain white studio background** using 'nano-banana-2' in '4k' ('3:4' or '4:3'). Combine front, side, back, and passport face views into a single **Character Profile Sheet** to use as a master consistency anchor. Keep Character, Location, and Object nodes separate!
   - **Nano Banana Pro ('nano-banana-pro') 7-Part Product Typography Hierarchy**: To keep small product text/logos tack-sharp without warped glyphs, structure prompts in this exact priority order:
     1) **Composition First** (e.g. diagonal editorial still life + controlled directional lighting)
     2) **Exact Product Identity** (lock proportions, silhouette, stitching, panel geometry to studio references)
     3) **Dedicated Typography Block** (quote exact words, location, alignment, and state: "no misspellings, no extra letters, no warped glyphs")
     4) **True Color Accuracy** (specific color names like "deep cobalt blue upper, neon lime laces" instead of "blue shoe")
     5) **Lighting & Harmony**
     6) **Optical Control** ("shallow depth of field, tack-sharp focus on the product and its typography, no oversaturation")
     7) **Negative Constraints** ("no extra logos, no duplicated text, no invented branding, no distorted lettering").
   - **Branded Surface Mockups ('nano-banana-2' in '4k')**: Chain unbranded base product shots via references so lighting matches the same photoshoot → connect a black logo on a white background → specify physical surface integration: **deboss effect** (glass/bottles), **emboss finish** (packaging boxes), or **embroidered thread matching fabric color** (towels/apparel), respecting edge margins, contact shadows, and surface texture.
   - **Sketches to Modular Interiors ('nano-banana-pro')**: Turn Sketch 1 into a realistic standalone object ('@img2') and Sketch 2 into a realistic room ('@img1'), then combine '@img1' + '@img2' with a minimal prompt defining **only their spatial relationship** (do not re-describe materials or lighting).
   - **Other Image Models**: 'mystic' (ultra-realistic editorial), 'flux-kontext-pro' (context-aware editing), 'flux-2-pro', 'seedream-v4-5', 'z-image', 'runway-t2i'.

3. **Magnific Image Editing ('magnific_edit_image') & Variations**:
   - 'upscale' (Creative Upscaler up to 16x), 'upscale-precision' (Precision Upscaler up to 16x for clean designs, logos, and split variation grids), 'relight', 'style-transfer', 'remove-background', 'image-expand' (Flux Pro outpainting), 'seedream-edit'.
   - **Variations Grid Rule**: A 4K Variations grid ('Reframe' / 'Storyboard') applies 4K to the whole grid container; always split the grid into a List and run the selected frame through 'upscale-precision' or 'upscale'.

4. **Magnific Video Generation ('magnific_generate_video') — Seedance 2.5 & Kling 3.0 Mastery**:
   - **Start/End Images vs. Image References**: Use 'image_url' (Start Image) and 'end_image_url' (End Image) when locking exact first/last visual states (e.g. closed cabin door → reveal frame, or continuing from an extracted last frame). Use 'reference_images' (Character Profile Sheet + Location + Product refs without a rigid Start Image) in 'seedance-2-5' or 'kling-3-0-omni' for natural multi-shot movement and camera cuts.
   - **Seedance 2.5 ('seedance-2-5')**: Up to 30s, 50 references, multi-shot cuts, and 3D Scene motion transfer ('reference_video_url'). **15-Second Chunking Rule**: Build 1-minute films in four 15s sections at '1080p' (or '480p'/'720p' for fast exploration) to prevent reference drift, then upscale the final cut to 4K. **Multi-Clip Audio Rule**: Enable 'generate_audio: true' for synchronized dialogue/foley, **but set 'exclude_music: true' (or write "no music" in the prompt)** so separate clips don't generate clashing soundtracks! **Surgical Corrections**: Fix visual errors either via Media Extractor (Manual frame selection) → 'nano-banana-pro' single-detail fix → 2–3s replacement clip, or via Seedance 2.5 Clip Editor 'Modify' mode.
   - **Kling 3.0 ('kling-3-0' / 'kling-3-pro')**:
     - *Single-Shot without Start Image*: Follow the **7-Part Video Prompt Formula**: (1) Environment & Lighting → (2) Shot Type/Framing → (3) Specific Character Traits → (4) Main Physical Action → (5) Cinematic Camera Move ('slow dolly-in', 'handheld tracking') → (6) Visual Detail ('sweat, turf stains, motion blur') → (7) Ambient Sound.
     - *Single-Shot with Start Image*: Do **NOT** re-describe the visible environment or character; prompt **only the physical action and camera movement**.
     - *Multi-Shot Mode ('shot_mode: "multi"', 'shots')*: Up to 6 distinct scene cuts inside one ≤15s generation; **each shot prompt must be ≤512 characters** (supports Start Image, no End Image).
   - **Kling 3.0 Omni ('kling-3-0-omni')**: Best for multi-character dialogue lip-sync using 'reference_images', mid-shot object swaps (e.g. touching a hat to switch between two referenced hats), and keeping small product typography tack-sharp in motion (pass clean white studio product references).
   - **Kling 2.6 Motion Control ('kling-motion')**: Transfers real biomechanics from 'reference_video_url' onto 'image_url' (720p–1080p max). **CRITICAL RULE**: **NEVER describe the physical action in the prompt!** (e.g. do NOT write "boxing"). Describing the action interferes with motion transfer—use the prompt **only for camera framing and camera movement**. Swap backgrounds in 'nano-banana-pro' *before* running Motion Control.
   - **Other Video Models**: 'kling-v2-6-pro', 'ltx-2-pro' (up to 4K 50fps with audio), 'wan-2-6-1080p', 'minimax-hailuo-2-3-1080p', 'runway-gen4-turbo', 'runway-act-two', 'seedance-pro-1080p', 'pixverse-v5'.

5. **Magnific Lip Sync & UGC Influencers ('magnific_lip_sync')**:
   - **OmniHuman 1.5** ('POST /v1/ai/video/omni-human-1-5') & MCP 'video_speak': Animates any portrait or full-body image ('image_url') with voiceover audio ('audio_url') at '1080p' or '720p'. For UGC product review videos: generate character on white ('nano-banana-2') → build Profile Sheet → place in car/studio ('9:16', '4k') → add product in hands → animate with Voiceover + 'kling-3-0-omni' or 'omni-human-1-5'.

6. **Magnific Audio ('magnific_generate_audio')**:
   - **3-Layer Audio Mixing**: (1) Native video audio carries dialogue/action foley; (2) 'sound-effects' (0.5–22s, 'loop: true') adds clean ambient atmosphere; (3) 'music-generation' (ElevenLabs Music) scores the emotional arc across sections; plus 'audio-isolation' (SAM Audio stem extraction).

7. **Magnific Spaces, Lists & Flows ('magnific_space_or_flow')**:
   - Always run 'action: "simulate_cost"' first (free pre-flight credit estimation).
   - Use Assistant 'Export as List' + 'List' nodes ('Keep items' vs. 'Replace items') to batch-localize ads into 20+ languages or batch-upscale grouped images.
   - Package repeatable Spaces into parameterized **Flows** ('action: "create_flow"' / '"run_flow"').`;

const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_draft',
    description: 'Create a new blog/content post saved as a draft. Use when user asks to draft, write, or create a post/article.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Full post content (can be markdown or plain text)' },
        excerpt: { type: 'string', description: 'Short summary (1-2 sentences)' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Lowercase social platform names to pre-select for automation (e.g. ["linkedin","instagram"]). Only include when user explicitly mentions specific platforms.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'schedule_post',
    description: 'Create a post and schedule it to publish at a specific date/time. Use when user specifies a date or time to publish.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Full post content' },
        scheduled_at: { type: 'string', description: 'ISO 8601 datetime string (e.g. "2025-06-01T09:00:00Z"). Convert relative times like "tomorrow at 9am" to absolute UTC.' },
        excerpt: { type: 'string', description: 'Short summary' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Lowercase social platform names to pre-select for automation (e.g. ["linkedin","twitter"]). Only include when user explicitly mentions specific platforms.' },
      },
      required: ['title', 'content', 'scheduled_at'],
    },
  },
  {
    name: 'get_recent_posts',
    description: "Fetch the user's recent posts to show them or reference them.",
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number to return (default 5, max 10)' },
        status: { type: 'string', description: 'Filter: draft | published | scheduled | all' },
      },
    },
  },
  {
    name: 'get_connected_platforms',
    description: "Get which social media platforms the user has connected so you can give relevant advice.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_my_tasks',
    description: "Fetch the user's tasks. Use when asked about tasks, to-dos, what to work on next, or to check task status. The live state already shows open tasks — call this for filtered/complete lists.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: todo | in_progress | review | done | open (default, all non-done) | all' },
      },
    },
  },
  {
    name: 'update_task_status',
    description: "Update a task's status. Use when user says 'mark done', 'complete', 'move to review', 'start working on', etc. Requires task_id from the live state or get_my_tasks.",
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'UUID of the task (shown in live state as [task_id:…])' },
        status: { type: 'string', description: 'New status: todo | in_progress | review | done' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'create_task',
    description: "Create a new task and assign it to the user. Use when asked to add, create, or log a task or to-do item.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Optional detail or notes' },
        priority: { type: 'string', description: 'low | medium | high | urgent (default: medium)' },
        due_date: { type: 'string', description: 'YYYY-MM-DD if a date was mentioned' },
        project_id: { type: 'string', description: 'Optional: specific project UUID from live state. If omitted, uses the first project.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_my_projects',
    description: "List the user's projects and workspaces with open task counts. Use when asked about projects, workspaces, or to pick a project for a task.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'magnific_one_generate',
    description: 'Generate art-directed images or multi-tile contact sheets using Magnific One (POST /v1/ai/magnific-one). Use mode="draft" with tiles=16 to explore 16 directions in one pass (exact for all 10 aspect ratios), or mode="quality" at 1k/2k/4k for final hero renders. Supports up to 10 reference_images (sweet spot: 2-3 consistent style references).',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Creative-director intent prompt (subject, lighting, lens, mood). Keep concise when 2-3 style references are attached.' },
        mode: { type: 'string', description: 'draft (8/16-tile contact sheet) | quality (single hero image, default)' },
        quality: { type: 'string', description: 'high (default) | normal (only in quality mode)' },
        resolution: { type: 'string', description: '1k | 2k (default) | 4k (only in quality mode)' },
        aspect_ratio: { type: 'string', description: '1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 2:3 | 3:2 | 21:9 | 2:1 | 3:1' },
        tiles: { type: 'number', description: '8 or 16 (only in draft mode; use 16 for exact aspect ratios across all 10 ratios)' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Up to 10 reference image URLs or base64 strings (sweet spot: 2-3 consistent style references)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'magnific_generate_image',
    description: 'Generate an image using a specialized Magnific model: nano-banana-pro (7-part product micro-typography hierarchy, sketches-to-modular interiors, surgical frame/background edits), nano-banana-2 (4K white-background Character Profile Sheets & deboss/emboss/embroidered branded mockups), mystic, flux-kontext-pro, flux-2-pro, seedream-v4-5, z-image, runway-t2i.',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'nano-banana-pro | nano-banana-2 | nano-banana-pro-flash | magnific-one | mystic | flux-kontext-pro | flux-2-pro | seedream-v4-5 | z-image | runway-t2i' },
        prompt: { type: 'string', description: 'Detailed visual prompt (use 7-part hierarchy for product text in nano-banana-pro; specify plain white background for reusable characters in nano-banana-2)' },
        aspect_ratio: { type: 'string', description: '1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 21:9' },
        resolution: { type: 'string', description: '1k | 2k | 4k (use 4k for nano-banana-2 character sheets and branded mockups)' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Optional reference image URLs (e.g. Character Profile Sheet, studio product angles, or black-on-white logo for mockups)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'magnific_edit_image',
    description: 'Upscale (up to 16x via Creative or Precision Upscaler), relight, transfer style, remove background, or outpaint/expand an image using Magnific AI editing tools.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'upscale | upscale-precision | relight | style-transfer | remove-background | image-expand | seedream-edit' },
        image_url: { type: 'string', description: 'Source image URL or base64' },
        prompt: { type: 'string', description: 'Guidance prompt for upscale, relight, style-transfer, image-expand, or seedream-edit' },
        scale_factor: { type: 'string', description: '2x | 4x | 8x | 16x (for upscale / upscale-precision)' },
        reference_image: { type: 'string', description: 'Reference image URL/base64 for style-transfer or relight' },
        left: { type: 'number', description: 'Pixels to expand left (for image-expand, 0-2048)' },
        right: { type: 'number', description: 'Pixels to expand right (for image-expand, 0-2048)' },
        top: { type: 'number', description: 'Pixels to expand top (for image-expand, 0-2048)' },
        bottom: { type: 'number', description: 'Pixels to expand bottom (for image-expand, 0-2048)' },
      },
      required: ['type', 'image_url'],
    },
  },
  {
    name: 'magnific_generate_video',
    description: 'Generate cinematic AI video using Magnific Video models: seedance-2-5 (up to 30s in 15s chunks, 50 refs, multi-shot, 3D motion transfer), kling-3-0-omni (multi-ref dialogue lip-sync, mid-shot object swap, product text stability), kling-3-0 (7-part single-shot or 6-cut multi-shot <=512 chars/shot), kling-motion (biomechanics transfer—prompt ONLY camera movement, never action!), kling-v2-6-pro, ltx-2-pro (4K 50fps).',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'seedance-2-5 | seedance-2-0 | kling-3-0-omni | kling-3-0 | kling-motion | kling-v2-6-pro | ltx-2-pro | wan-2-6-1080p | minimax-hailuo-2-3-1080p | runway-gen4-turbo | seedance-pro-1080p | pixverse-v5' },
        prompt: { type: 'string', description: 'Video prompt. Rules: (1) With Start Image, describe ONLY action & camera, not environment; (2) Without Start Image, use 7-part formula; (3) For kling-motion, describe ONLY camera movement, NEVER physical action!' },
        image_url: { type: 'string', description: 'Optional Start Image URL (locks exact first frame)' },
        end_image_url: { type: 'string', description: 'Optional End Image URL (locks final reveal frame; not supported in kling-3-0 multi-shot)' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Character Profile Sheet, Location, and Product reference image URLs (up to 50 for seedance-2-5, up to 10 for kling-3-0-omni)' },
        reference_video_url: { type: 'string', description: 'Reference video URL for 3D Scene motion transfer (seedance-2-5) or live performance transfer (kling-motion / kling-3-0-omni)' },
        shot_mode: { type: 'string', description: 'single (default) | multi (up to 6 independent shot cuts in kling-3-0)' },
        shots: {
          type: 'array',
          description: 'For kling-3-0 multi-shot mode: up to 6 shots, each with { prompt (max 512 chars), duration } totaling <=15s',
          items: { type: 'object' },
        },
        exclude_music: { type: 'boolean', description: 'Set true for multi-clip sequences so native dialogue/SFX are generated without clashing background music' },
        duration: { type: 'number', description: 'Duration in seconds (15 recommended for seedance-2-5 up to 30; 5-15 for kling-3-0; 5/10 for kling-v2-6-pro; 6/8/10 for ltx-2-pro)' },
        aspect_ratio: { type: 'string', description: '16:9 | 9:16 | 1:1' },
        resolution: { type: 'string', description: '480p | 720p | 1080p (default balance) | 1440p | 2160p | 4k' },
        generate_audio: { type: 'boolean', description: 'Generate synchronized native dialogue/SFX/audio' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'magnific_lip_sync',
    description: 'Generate a realistic talking avatar / lip-sync video from a portrait or full-body human image and an audio URL using Magnific OmniHuman 1.5 (POST /v1/ai/video/omni-human-1-5).',
    input_schema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'Public URL of the human portrait or full-body image' },
        audio_url: { type: 'string', description: 'Public URL of the voiceover or speech audio file (WAV/MP3/M4A, <30s)' },
        prompt: { type: 'string', description: 'Optional scene, expression, and camera movement guidance' },
        resolution: { type: 'string', description: '1080p (default) | 720p' },
        turbo_mode: { type: 'boolean', description: 'Set true for faster generation' },
      },
      required: ['image_url', 'audio_url'],
    },
  },
  {
    name: 'magnific_generate_audio',
    description: 'Generate Sound Effects (SFX), AI Music, or isolate specific sounds/voices from audio/video using SAM Audio via Magnific Audio APIs.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'sound-effects | music-generation | audio-isolation' },
        prompt: { type: 'string', description: 'Text description of the SFX, music style, or target sound to isolate (e.g. "human speech", "acoustic guitar")' },
        duration_seconds: { type: 'number', description: 'Duration in seconds (0.5 to 22 for SFX; 5 to 180 for music)' },
        loop: { type: 'boolean', description: 'Whether to create a seamless loop (for sound-effects)' },
        audio: { type: 'string', description: 'Source audio URL/base64 (required for audio-isolation if video not provided)' },
        video: { type: 'string', description: 'Source video URL/base64 (for audio-isolation)' },
      },
      required: ['type', 'prompt'],
    },
  },
  {
    name: 'magnific_space_or_flow',
    description: 'Create, simulate cost for, or execute a multi-node Magnific Space or reusable Flow (or invoke a native Magnific MCP tool on https://mcp.magnific.com). Always use action="simulate_cost" first for large pipelines.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'simulate_cost | create_space | run_space | create_flow | run_flow | mcp_tool' },
        name: { type: 'string', description: 'Name of the Space or Flow' },
        goal: { type: 'string', description: 'Creative campaign goal or prompt' },
        aspect_ratio: { type: 'string', description: 'Target aspect ratio (e.g. 16:9, 9:16, 1:1)' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Brand/character reference image URLs' },
        nodes: {
          type: 'array',
          description: 'Optional explicit node graph (left-to-right). Each node has { id, type: "magnific-one"|"image"|"edit"|"video"|"lip-sync"|"audio", params, inputsFrom }',
          items: { type: 'object' },
        },
        mcp_tool_name: { type: 'string', description: 'When action="mcp_tool", the exact Magnific MCP tool name (e.g. "magnific_one", "video_speak", "audio_tts")' },
        mcp_tool_args: { type: 'object', description: 'Arguments for the Magnific MCP tool' },
      },
      required: ['action'],
    },
  },
];

// ── Local helpers ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function inferTaskActions(title: string): Array<{ action_type: string; label: string; target_count: number }> {
  const t = title.toLowerCase();
  const results: Array<{ action_type: string; label: string; target_count: number }> = [];
  const numMatch = t.match(/\b(\d+)\b/);
  const n = numMatch ? Math.min(parseInt(numMatch[1], 10), 50) : 1;
  const check = (actionType: string, label: string, verbs: RegExp, nouns: RegExp) => {
    if (verbs.test(t) && nouns.test(t)) results.push({ action_type: actionType, label, target_count: n });
  };
  check('create_post',    'Create a post',              /create|write|draft|make|compose|produce/,    /post|content|article|caption|blog|copy|update|tweet|thread/);
  check('schedule_post',  'Schedule a post',            /schedule|publish|queue|plan/,                /post|content|article|caption|update|tweet/);
  check('publish_post',   'Publish / go live',          /publish|go\slive|launch|release|push\slive/, /post|content|article|update/);
  check('connect_social', 'Connect a social account',   /connect|add|link|integrate|set\sup/,         /social|account|platform|twitter|linkedin|instagram|facebook|tiktok|youtube/);
  check('create_card',    'Create a design card',       /create|design|make|build|produce/,           /card|graphic|visual|banner|image|poster|flyer/);
  check('save_memory',    'Save a memory / brand item', /add|save|update|fill|set/,                   /memory|brand|profile|personal|about|niche|tone/);
  return results;
}

function aiToolLabel(name: string, input: any): string {
  switch (name) {
    case 'create_draft': return `Creating draft: "${input?.title || 'untitled'}"`;
    case 'schedule_post': return `Scheduling post: "${input?.title || 'untitled'}"`;
    case 'get_recent_posts': return 'Fetching your posts…';
    case 'get_connected_platforms': return 'Checking connected platforms…';
    case 'get_my_tasks': return 'Fetching your tasks…';
    case 'update_task_status': return `Marking task as ${input?.status ?? 'updated'}…`;
    case 'create_task': return `Creating task: "${input?.title || 'untitled'}"…`;
    case 'get_my_projects': return 'Fetching your projects…';
    case 'magnific_one_generate': return `Generating with Magnific One (${input?.mode || 'quality'} mode)…`;
    case 'magnific_generate_image': return `Generating image with Magnific (${input?.model || 'magnific-one'})…`;
    case 'magnific_edit_image': return `Editing image with Magnific (${input?.type || 'upscale'})…`;
    case 'magnific_generate_video': return `Generating video with Magnific (${input?.model || 'kling-v2-6-pro'})…`;
    case 'magnific_lip_sync': return 'Animating lip-sync avatar with OmniHuman 1.5…';
    case 'magnific_generate_audio': return `Generating audio with Magnific (${input?.type || 'sound-effects'})…`;
    case 'magnific_space_or_flow': return `Running Magnific Space/Flow (${input?.action || 'run_space'})…`;
    default: return `Running ${name}…`;
  }
}

export function registerAIChatRoutes({
  requireAuth,
  getAIConfig,
  resolveActiveKey,
  callAINonStreaming,
  GEMINI_MODELS,
  pool,
  dbQuery,
  createNotification,
  checkTaskActions,
  getUserConnectedAccounts,
  AGENT_DEFS,
}: AIChatDeps): Router {
  const router = express.Router();

  // ── Module-scoped helpers that close over deps ──────────────────────────────

  async function logTaskActivity(
    projectId: string, userId: string, action: string, taskId?: string, metadata?: Record<string, unknown>
  ) {
    try {
      await dbQuery(
        `INSERT INTO task_activity (project_id, user_id, action, task_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
        [projectId, userId, action, taskId ?? null, metadata ? JSON.stringify(metadata) : null]
      );
    } catch (_err) { /* non-fatal */ }
  }

  async function getUserSaaSContext(userId: string): Promise<string> {
    if (!pool) return '';
    const parts: string[] = [];
    try {
      const { rows: socials } = await dbQuery(
        `SELECT platform, account_name, handle, followers, connected FROM social_accounts WHERE user_id = $1 ORDER BY platform`,
        [userId]
      );
      if (socials.length > 0) {
        const lines = (socials as any[]).map((s) => {
          const label = s.account_name || s.handle || s.platform;
          const fol = s.followers ? ` (${s.followers.toLocaleString()} followers)` : '';
          return `  ${s.connected ? '✅' : '❌'} ${s.platform}: ${label}${fol}${s.connected ? '' : ' — DISCONNECTED'}`;
        });
        parts.push(`### Social Accounts\n${lines.join('\n')}`);
      } else {
        parts.push('### Social Accounts\nNone connected yet.');
      }

      const { rows: projects } = await dbQuery(
        `SELECT p.id, p.name AS project_name, o.name AS org_name, om.role
         FROM projects p
         JOIN organizations o ON o.id = p.org_id
         JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
         ORDER BY p.created_at`,
        [userId]
      );
      if (projects.length > 0) {
        const lines = (projects as any[]).map((p) => `  • ${p.org_name} / ${p.project_name} (${p.role}) [project_id:${p.id}]`);
        parts.push(`### Workspaces & Projects\n${lines.join('\n')}`);
      } else {
        parts.push('### Workspaces & Projects\nNo projects yet.');
      }

      const { rows: tasks } = await dbQuery(
        `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name
         FROM tasks t
         JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1
         JOIN projects p ON p.id = t.project_id
         WHERE t.status != 'done'
         ORDER BY t.due_date ASC NULLS LAST, t.priority DESC LIMIT 20`,
        [userId]
      );
      if (tasks.length > 0) {
        const lines = (tasks as any[]).map((t) => {
          const due = t.due_date ? ` due:${new Date(t.due_date).toLocaleDateString('en-GB')}` : '';
          return `  • [${t.status.toUpperCase()}][${t.priority}]${due} "${t.title}" — ${t.project_name} [task_id:${t.id}]`;
        });
        parts.push(`### My Open Tasks (${tasks.length})\n${lines.join('\n')}`);
      } else {
        parts.push('### My Open Tasks\nNo open tasks assigned.');
      }

      const { rows: scheduled } = await dbQuery(
        `SELECT title, scheduled_at FROM blog_posts WHERE user_id = $1 AND status = 'scheduled' AND scheduled_at > NOW() ORDER BY scheduled_at ASC LIMIT 5`,
        [userId]
      );
      if (scheduled.length > 0) {
        const lines = (scheduled as any[]).map((p) => `  • "${p.title}" — ${new Date(p.scheduled_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
        parts.push(`### Upcoming Scheduled Posts\n${lines.join('\n')}`);
      }

      const { rows: draftCount } = await dbQuery(
        `SELECT COUNT(*)::int AS n FROM blog_posts WHERE user_id=$1 AND status='draft'`,
        [userId]
      );
      if ((draftCount[0] as any)?.n > 0) {
        parts.push(`### Drafts\n  ${(draftCount[0] as any).n} draft(s) saved.`);
      }
    } catch (e) {
      logger.error('getUserSaaSContext error:', e);
    }
    if (parts.length === 0) return '';
    return `## YOUR LIVE SAAS STATE (as of this message)\n${parts.join('\n\n')}`;
  }

  async function getSkillsPromptForScope(page: string): Promise<string> {
    try {
      const { rows } = await dbQuery(
        `SELECT system_prompt FROM ai_skills WHERE enabled = true AND (scope = 'all' OR scope = $1) ORDER BY sort_order ASC`,
        [page || 'all']
      );
      return (rows as any[]).map((r) => r.system_prompt).filter(Boolean).join('\n\n');
    } catch (_err) { return ''; }
  }

  async function preselectPlatformsForPost(
    postId: string,
    userId: string,
    platforms: string[],
  ): Promise<{ connected: string[]; missing: string[] }> {
    const result = { connected: [] as string[], missing: [] as string[] };
    if (!pool || platforms.length === 0) return result;
    try {
      const normalized = platforms.map((p) => p.toLowerCase().trim());
      const expanded = Array.from(new Set(normalized.flatMap((p) =>
        p === 'x' ? ['twitter', 'x'] : p === 'twitter' ? ['twitter', 'x'] : [p]
      )));
      const { rows: accounts } = await dbQuery(
        `SELECT id, LOWER(platform) AS platform FROM social_accounts WHERE user_id=$1 AND LOWER(platform) = ANY($2::text[]) AND connected = true`,
        [userId, expanded]
      );
      const foundPlatforms = new Set((accounts as any[]).map((a) => a.platform as string));
      for (const p of normalized) {
        const aliases = p === 'x' ? ['x', 'twitter'] : p === 'twitter' ? ['twitter', 'x'] : [p];
        if (aliases.some((a) => foundPlatforms.has(a))) {
          result.connected.push(p);
        } else {
          result.missing.push(p);
        }
      }
      if ((accounts as any[]).length === 0) return result;
      const settingId = randomUUID();
      const existing = await dbQuery('SELECT id FROM social_post_settings WHERE post_id=$1', [postId]);
      const settId: string = (existing.rows[0] as any)?.id ? String((existing.rows[0] as any).id) : settingId;
      if (!existing.rows.length) {
        await dbQuery(
          `INSERT INTO social_post_settings (id, post_id, template, publish_type, scheduled_at) VALUES ($1,$2,'','immediate',NULL)`,
          [settId, postId]
        );
      }
      for (const acc of accounts as any[]) {
        await dbQuery(
          `INSERT INTO social_post_targets (id, social_post_id, social_account_id, enabled) VALUES ($1,$2,$3,true)`,
          [randomUUID(), settId, acc.id]
        );
      }
    } catch (e) {
      logger.error('preselectPlatformsForPost error:', e);
    }
    return result;
  }

  async function executeAITool(name: string, input: any, userId: string): Promise<any> {
    switch (name) {
      case 'create_draft': {
        const title = String(input?.title || 'Untitled').slice(0, 255);
        const content = String(input?.content || '');
        const excerpt = String(input?.excerpt || '').slice(0, 500);
        const platforms: string[] = Array.isArray(input?.platforms) ? input.platforms.map(String) : [];
        const id = randomUUID();
        const slug = slugify(title) || id;
        const { rows } = await dbQuery(
          `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW(), NOW()) RETURNING id, title, status`,
          [id, userId, title, slug, content, excerpt]
        );
        const platformResult = await preselectPlatformsForPost(id, userId, platforms);
        createNotification(userId, 'draft_created', 'Draft created', `"${title}" has been saved as a draft.`, { postId: id }).catch(() => undefined);
        const tasksProgressed = await checkTaskActions(userId, 'create_post');
        return { success: true, action: 'created_draft', post: (rows as any[])[0], platforms_connected: platformResult.connected, platforms_not_connected: platformResult.missing, tasks_progressed: tasksProgressed };
      }
      case 'schedule_post': {
        const title = String(input?.title || 'Untitled').slice(0, 255);
        const content = String(input?.content || '');
        const excerpt = String(input?.excerpt || '').slice(0, 500);
        const scheduled_at = input?.scheduled_at ? new Date(input.scheduled_at).toISOString() : null;
        if (!scheduled_at) throw new Error('Invalid scheduled_at datetime');
        const platforms: string[] = Array.isArray(input?.platforms) ? input.platforms.map(String) : [];
        const id = randomUUID();
        const slug = slugify(title) || id;
        const { rows } = await dbQuery(
          `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, scheduled_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7, NOW(), NOW()) RETURNING id, title, status, scheduled_at`,
          [id, userId, title, slug, content, excerpt, scheduled_at]
        );
        const platformResult = await preselectPlatformsForPost(id, userId, platforms);
        const schedDate = scheduled_at ? new Date(scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        createNotification(userId, 'post_scheduled', 'Post scheduled', `"${title}" is scheduled for ${schedDate}.`, { postId: id, scheduled_at }).catch(() => undefined);
        const tasksProgressed = await Promise.all([checkTaskActions(userId, 'create_post'), checkTaskActions(userId, 'schedule_post')]).then(([a, b]) => [...a, ...b]);
        return { success: true, action: 'scheduled_post', post: (rows as any[])[0], platforms_connected: platformResult.connected, platforms_not_connected: platformResult.missing, tasks_progressed: tasksProgressed };
      }
      case 'get_recent_posts': {
        const limit = Math.min(Number(input?.limit) || 5, 10);
        const status = String(input?.status || '').trim().toLowerCase();
        const params: any[] = [userId];
        let q = `SELECT id, title, status, scheduled_at, published_at, updated_at FROM blog_posts WHERE user_id = $1`;
        if (status && status !== 'all') {
          params.push(status);
          q += ` AND status = $${params.length}`;
        } else {
          q += ` AND status NOT IN ('archived','deleted')`;
        }
        q += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const { rows } = await dbQuery(q, params);
        return { posts: rows };
      }
      case 'get_connected_platforms': {
        const accounts = await getUserConnectedAccounts(userId);
        const connected = (accounts as any[]).filter((a) => a.connected !== false).map((a) => ({
          platform: a.platform,
          name: a.accountName || a.handle || a.platform,
        }));
        return { connected };
      }
      case 'get_my_tasks': {
        const sf = String(input?.status || 'open').toLowerCase();
        let cond = '';
        if (sf === 'open') cond = `AND t.status != 'done'`;
        else if (sf !== 'all') cond = `AND t.status = '${sf.replace(/'/g, "''")}'`;
        const { rows } = await dbQuery(
          `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name, o.name AS org_name
           FROM tasks t
           JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1
           JOIN projects p ON p.id = t.project_id
           JOIN organizations o ON o.id = p.org_id
           WHERE 1=1 ${cond}
           ORDER BY t.due_date ASC NULLS LAST, t.updated_at DESC LIMIT 25`,
          [userId]
        );
        return { tasks: rows };
      }
      case 'update_task_status': {
        const taskId = String(input?.task_id || '');
        const newStatus = String(input?.status || '').toLowerCase();
        if (!['todo', 'in_progress', 'review', 'done'].includes(newStatus)) {
          throw new Error('Invalid status. Use: todo | in_progress | review | done');
        }
        const { rows: check } = await dbQuery(
          `SELECT t.id, t.title, t.status, t.project_id
           FROM tasks t
           WHERE t.id = $1 AND (
             EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $2)
             OR EXISTS (
               SELECT 1 FROM organization_memberships om
               JOIN projects p ON p.org_id = om.org_id
               WHERE p.id = t.project_id AND om.user_id = $2 AND om.role IN ('owner','admin')
             )
           )`,
          [taskId, userId]
        );
        if (!(check as any[]).length) throw new Error('Task not found or you do not have permission to update it');
        const task = (check as any[])[0];
        const { rows: newPos } = await dbQuery(
          `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status=$2`,
          [task.project_id, newStatus]
        );
        await dbQuery(`UPDATE tasks SET status=$1, position=$2, updated_at=NOW() WHERE id=$3`, [newStatus, (newPos as any[])[0].next, taskId]);
        void logTaskActivity(task.project_id, userId, 'status_changed', taskId, { from: task.status, to: newStatus });
        if (newStatus === 'done') {
          createNotification(userId, 'agent_activity', 'Task completed ✓', `"${task.title}" marked as done.`, { taskId }).catch(() => undefined);
        }
        return { success: true, task_id: taskId, title: task.title, old_status: task.status, new_status: newStatus };
      }
      case 'create_task': {
        const title = String(input?.title || '').trim().slice(0, 255);
        if (!title) throw new Error('Task title is required');
        const description = String(input?.description || '');
        const priority = ['low', 'medium', 'high', 'urgent'].includes(input?.priority) ? input.priority : 'medium';
        const dueDate = input?.due_date || null;
        let projectId = input?.project_id ? String(input.project_id) : null;
        if (!projectId) {
          const { rows: projs } = await dbQuery(
            `SELECT p.id FROM projects p JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1 ORDER BY p.created_at ASC LIMIT 1`,
            [userId]
          );
          if (!(projs as any[]).length) throw new Error('No project found. Create a project first.');
          projectId = (projs as any[])[0].id;
        }
        const { rows: posRows } = await dbQuery(
          `SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE project_id=$1 AND status='todo'`,
          [projectId]
        );
        const taskId = randomUUID();
        const { rows } = await dbQuery(
          `INSERT INTO tasks (id, project_id, title, description, status, priority, position, due_date, created_by)
           VALUES ($1,$2,$3,$4,'todo',$5,$6,$7,$8) RETURNING id, title, status, priority`,
          [taskId, projectId, title, description, priority, (posRows as any[])[0].next, dueDate, userId]
        );
        await dbQuery(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, userId]);
        const inferred = inferTaskActions(title);
        if (inferred.length) {
          await Promise.all(inferred.map((a) =>
            dbQuery(
              `INSERT INTO task_actions (id, task_id, action_type, label, target_count, current_count) VALUES ($1,$2,$3,$4,$5,0)`,
              [randomUUID(), taskId, a.action_type, a.label, a.target_count]
            )
          ));
        }
        if (projectId) void logTaskActivity(projectId, userId, 'created', taskId, { title });
        return { success: true, task: (rows as any[])[0] };
      }
      case 'get_my_projects': {
        const { rows } = await dbQuery(
          `SELECT p.id, p.name AS project_name, o.name AS org_name, om.role,
             (SELECT COUNT(*)::int FROM tasks t JOIN task_assignees ta ON ta.task_id=t.id WHERE ta.user_id=$1 AND t.project_id=p.id AND t.status!='done') AS my_open_tasks
           FROM projects p
           JOIN organizations o ON o.id = p.org_id
           JOIN organization_memberships om ON om.org_id = p.org_id AND om.user_id = $1
           ORDER BY p.created_at`,
          [userId]
        );
        return { projects: rows };
      }
      case 'magnific_one_generate': {
        const magnificKey = await getMagnificApiKey(pool as any);
        if (!magnificKey) return { success: false, error: 'Magnific API key is not configured in Admin → Magnific AI.' };
        const creditCost = input?.mode === 'draft' ? 4 : (input?.resolution === '4k' ? 8 : 6);
        const r = await magnificOneGenerate(
          {
            prompt: String(input?.prompt || ''),
            mode: input?.mode === 'draft' ? 'draft' : 'quality',
            quality: input?.quality === 'normal' ? 'normal' : 'high',
            resolution: ['1k', '2k', '4k'].includes(input?.resolution) ? input.resolution : '2k',
            aspect_ratio: input?.aspect_ratio || '1:1',
            tiles: input?.tiles,
            reference_images: Array.isArray(input?.reference_images) ? input.reference_images : undefined,
          },
          magnificKey
        );
        if (r.error || !r.url) return { success: false, error: r.error || 'Magnific One returned no URL' };
        const genId = randomUUID();
        await dbQuery(
          `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, task_id, result_url, completed_at)
           VALUES ($1, $2, 'image', 'magnific-one', $3, $4, 'completed', $5, $6, NOW())`,
          [genId, userId, String(input?.prompt || ''), JSON.stringify(input ?? {}), r.taskId, r.url]
        ).catch(() => undefined);
        await chargeAICredits(userId, creditCost, 'chat_magnific_one', { gen_id: genId });
        return { success: true, model: 'magnific-one', mode: input?.mode || 'quality', url: r.url, urls: r.urls, gen_id: genId, credits_used: creditCost };
      }
      case 'magnific_generate_image': {
        const magnificKey = await getMagnificApiKey(pool as any);
        if (!magnificKey) return { success: false, error: 'Magnific API key is not configured in Admin → Magnific AI.' };
        const modelKey = input?.model && MAGNIFIC_IMAGE_MODELS[input.model] ? input.model : 'magnific-one';
        const creditCost = MAGNIFIC_IMAGE_MODELS[modelKey]?.credits ?? 5;
        const r = await magnificGenerateImage(
          modelKey,
          String(input?.prompt || ''),
          String(input?.aspect_ratio || '1:1'),
          magnificKey,
          undefined,
          {
            resolution: input?.resolution,
            reference_images: Array.isArray(input?.reference_images) ? input.reference_images : undefined,
          }
        );
        if (r.error || !r.url) return { success: false, error: r.error || 'Magnific image generation failed' };
        const genId = randomUUID();
        await dbQuery(
          `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, result_url, completed_at)
           VALUES ($1, $2, 'image', $3, $4, $5, 'completed', $6, NOW())`,
          [genId, userId, modelKey, String(input?.prompt || ''), JSON.stringify(input ?? {}), r.url]
        ).catch(() => undefined);
        await chargeAICredits(userId, creditCost, `chat_magnific_image_${modelKey}`, { gen_id: genId });
        return { success: true, model: modelKey, url: r.url, urls: r.urls ?? [r.url], gen_id: genId, credits_used: creditCost };
      }
      case 'magnific_edit_image': {
        const magnificKey = await getMagnificApiKey(pool as any);
        if (!magnificKey) return { success: false, error: 'Magnific API key is not configured in Admin → Magnific AI.' };
        const editType = input?.type || 'upscale';
        const creditCost = editType === 'remove-background' ? 1 : 5;
        const r = await magnificEditImage({ ...input, type: editType }, magnificKey);
        if (r.error || !r.url) return { success: false, error: r.error || 'Magnific image edit failed' };
        const genId = randomUUID();
        await dbQuery(
          `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, task_id, result_url, completed_at)
           VALUES ($1, $2, $3, $3, $4, $5, 'completed', $6, $7, NOW())`,
          [genId, userId, editType, String(input?.prompt || ''), JSON.stringify(input ?? {}), r.taskId, r.url]
        ).catch(() => undefined);
        await chargeAICredits(userId, creditCost, `chat_magnific_edit_${editType}`, { gen_id: genId });
        return { success: true, type: editType, url: r.url, gen_id: genId, credits_used: creditCost };
      }
      case 'magnific_generate_video': {
        const magnificKey = await getMagnificApiKey(pool as any);
        if (!magnificKey) return { success: false, error: 'Magnific API key is not configured in Admin → Magnific AI.' };
        const modelKey = input?.model && MAGNIFIC_VIDEO_MODELS[input.model] ? input.model : (input?.image_url ? 'kling-v2-6-pro' : 'ltx-2-pro');
        const creditCost = MAGNIFIC_VIDEO_MODELS[modelKey]?.credits ?? 25;
        const r = await magnificGenerateVideo({ ...input, model: modelKey }, magnificKey);
        if (r.error || !r.url) return { success: false, error: r.error || 'Magnific video generation failed' };
        const genId = randomUUID();
        await dbQuery(
          `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, task_id, result_url, completed_at)
           VALUES ($1, $2, 'video', $3, $4, $5, 'completed', $6, $7, NOW())`,
          [genId, userId, r.model, String(input?.prompt || ''), JSON.stringify(input ?? {}), r.taskId, r.url]
        ).catch(() => undefined);
        await chargeAICredits(userId, creditCost, `chat_magnific_video_${r.model}`, { gen_id: genId });
        return { success: true, model: r.model, url: r.url, gen_id: genId, credits_used: creditCost };
      }
      case 'magnific_lip_sync': {
        const magnificKey = await getMagnificApiKey(pool as any);
        if (!magnificKey) return { success: false, error: 'Magnific API key is not configured in Admin → Magnific AI.' };
        const creditCost = 30;
        const r = await magnificLipSync(
          {
            image_url: String(input?.image_url || ''),
            audio_url: String(input?.audio_url || ''),
            prompt: input?.prompt,
            resolution: input?.resolution === '720p' ? '720p' : '1080p',
            turbo_mode: Boolean(input?.turbo_mode),
          },
          magnificKey
        );
        if (r.error || !r.url) return { success: false, error: r.error || 'OmniHuman 1.5 lip-sync failed' };
        const genId = randomUUID();
        await dbQuery(
          `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, task_id, result_url, completed_at)
           VALUES ($1, $2, 'lip-sync', 'omni-human-1-5', $3, $4, 'completed', $5, $6, NOW())`,
          [genId, userId, String(input?.prompt || 'OmniHuman 1.5 Lip Sync'), JSON.stringify(input ?? {}), r.taskId, r.url]
        ).catch(() => undefined);
        await chargeAICredits(userId, creditCost, 'chat_magnific_lipsync', { gen_id: genId });
        return { success: true, model: 'omni-human-1-5', url: r.url, gen_id: genId, credits_used: creditCost };
      }
      case 'magnific_generate_audio': {
        const magnificKey = await getMagnificApiKey(pool as any);
        if (!magnificKey) return { success: false, error: 'Magnific API key is not configured in Admin → Magnific AI.' };
        const audioType = input?.type || 'sound-effects';
        const creditCost = audioType === 'music-generation' ? 6 : 4;
        const r = await magnificGenerateAudio(
          {
            type: audioType,
            text: input?.prompt,
            prompt: input?.prompt,
            description: input?.prompt,
            duration_seconds: input?.duration_seconds,
            loop: input?.loop,
            audio: input?.audio,
            video: input?.video,
          },
          magnificKey
        );
        if (r.error || !r.url) return { success: false, error: r.error || 'Magnific audio generation failed' };
        const genId = randomUUID();
        await dbQuery(
          `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, task_id, result_url, completed_at)
           VALUES ($1, $2, 'audio', $3, $4, $5, 'completed', $6, $7, NOW())`,
          [genId, userId, r.type, String(input?.prompt || ''), JSON.stringify(input ?? {}), r.taskId, r.url]
        ).catch(() => undefined);
        await chargeAICredits(userId, creditCost, `chat_magnific_audio_${r.type}`, { gen_id: genId });
        return { success: true, type: r.type, url: r.url, gen_id: genId, credits_used: creditCost };
      }
      case 'magnific_space_or_flow': {
        const magnificKey = await getMagnificApiKey(pool as any);
        const mcpCaller = (toolName: string, toolArgs: Record<string, unknown>) =>
          callMagnificMcpTool(pool as any, toolName, toolArgs, (val: unknown) => {
            const dec = decryptPlatformConfig(val as any);
            return typeof dec === 'string' ? dec : (dec as any)?.value ?? '';
          });
        const action = input?.action || 'run_space';
        const r = await magnificExecuteSpaceOrFlow({ ...input, action }, magnificKey, mcpCaller);
        if (r.success && r.final_url && (action === 'run_space' || action === 'run_flow')) {
          const genId = randomUUID();
          await dbQuery(
            `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status, result_url, completed_at)
             VALUES ($1, $2, 'space', $3, $4, $5, 'completed', $6, NOW())`,
            [genId, userId, action, String(input?.goal || input?.name || 'Magnific Space'), JSON.stringify(r.node_results ?? []), r.final_url]
          ).catch(() => undefined);
          await chargeAICredits(userId, r.estimated_credits ?? 10, `chat_magnific_${action}`, { gen_id: genId });
        }
        return r;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ── POST /api/ai/chat ─────────────────────────────────────────────────────
  router.post('/ai/chat', aiChatLimiter, async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { messages, page } = req.body as {
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        page?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: 'messages array is required' });
      }

      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) {
        // Local dev Butler fallback so SSE chat works out of the box even before an API key is configured
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const lastMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
        const butlerReply = `Good day. I am **Daky**, your social media & marketing butler.\n\nRegarding "${lastMsg.slice(0, 80)}": I am ready to draft, schedule, or orchestrate this across your connected channels. (Tip: Add your Anthropic or Google Gemini key in **Admin → AI Assistant** for live LLM streaming, or connect via **/api/v1/os/agents/invoke**.)\n\n1. How would you like to proceed?\n   - Draft a high-converting post now\n   - Schedule to connected platforms\n   - Run Multi-Agent Strategy Plan\n   - Custom`;
        res.write(`data: ${JSON.stringify({ type: 'text', text: butlerReply })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (!(await hasAICredits(auth.userId))) {
        return res.status(402).json({ success: false, error: OUT_OF_CREDITS_MSG });
      }

      const skillsPrompt = await getSkillsPromptForScope(page || '');

      let userMemoryBlock = '';
      if (pool) {
        try {
          const { rows: memRows } = await dbQuery(
            `SELECT category, title, content FROM user_memories WHERE user_id = $1 AND title != '🌐 Full Scraped Memory' ORDER BY category, sort_order, created_at LIMIT 60`,
            [auth.userId]
          );
          if ((memRows as any[]).length > 0) {
            const grouped: Record<string, string[]> = {};
            for (const row of memRows as any[]) {
              if (!grouped[row.category]) grouped[row.category] = [];
              grouped[row.category].push(`  • ${row.title}: ${row.content}`);
            }
            const sections = Object.entries(grouped)
              .map(([cat, lines]) => `### ${cat}\n${lines.join('\n')}`)
              .join('\n\n');
            userMemoryBlock = `## ABOUT THIS USER\n${sections}`;
          } else {
            userMemoryBlock = '## ABOUT THIS USER\nNo personalization data yet. Ask one focused question to understand their brand before drafting.';
          }
        } catch (_err) { /* non-fatal */ }
      }

      const saasContext = await getUserSaaSContext(auth.userId);

      const stablePrompt = [
        (aiCfg.systemPrompt || AI_SYSTEM_PROMPT_DEFAULT).replace('{USER_MEMORY}', '(See the ABOUT THIS USER section at the end of this prompt.)'),
        AI_CORE_RULES,
      ].join('\n\n');
      const dynamicPrompt = [userMemoryBlock, saasContext, skillsPrompt].filter(Boolean).join('\n\n');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      // ── Google Gemini path — streaming + function calling ───────────────────
      if (aiCfg.provider === 'google') {
        const effectiveModel = resolveGeminiModel(aiCfg.model);
        const genAI = new GoogleGenerativeAI(apiKey);
        const geminiTools = [{
          functionDeclarations: AI_TOOLS.map((t: any) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        }];
        const gModel = genAI.getGenerativeModel({
          model: effectiveModel,
          systemInstruction: `${stablePrompt}\n\n${dynamicPrompt}`,
          tools: geminiTools as any,
        });

        const allMessages = messages.slice(-16).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content || '').slice(0, 3500) }],
        }));
        const history = allMessages.slice(0, -1);
        const lastPart = allMessages[allMessages.length - 1]?.parts[0]?.text ?? '';

        const chat = gModel.startChat({ history });
        const stream = await chat.sendMessageStream(lastPart);
        for await (const chunk of stream.stream) {
          const text = chunk.text();
          if (text) send({ type: 'text', text });
        }
        const agg = await stream.response;
        const fnCalls = typeof (agg as any).functionCalls === 'function' ? (agg as any).functionCalls() : [];
        if (Array.isArray(fnCalls) && fnCalls.length > 0) {
          for (const fc of fnCalls) {
            send({ type: 'tool_start', name: fc.name, label: aiToolLabel(fc.name, fc.args) });
            try {
              const result = await executeAITool(fc.name, fc.args, auth.userId);
              send({ type: 'tool_done', name: fc.name, success: true, result });
            } catch (err: any) {
              send({ type: 'tool_done', name: fc.name, success: false, error: err?.message || 'Tool failed' });
            }
          }
        }
        void recordAIUsage({
          userId: auth.userId, feature: 'chat', provider: 'google', model: effectiveModel,
          inputTokens: agg.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: agg.usageMetadata?.candidatesTokenCount ?? 0,
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // ── Anthropic path — streaming agentic loop with tools ──────────────────
      const client = new Anthropic({ apiKey });

      const systemBlocks: Anthropic.TextBlockParam[] = [
        { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
        ...(dynamicPrompt ? [{ type: 'text' as const, text: dynamicPrompt }] : []),
      ];

      const conversationMessages: Anthropic.MessageParam[] = messages.slice(-16).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || '').slice(0, 3500),
      }));

      let loopMessages = [...conversationMessages];
      const usage = { input: 0, output: 0, cacheRead: 0 };

      for (let iteration = 0; iteration < 5; iteration++) {
        const isLastIteration = iteration >= 4;

        const stream = client.messages.stream({
          model: aiCfg.model,
          max_tokens: 4096,
          system: systemBlocks,
          tools: AI_TOOLS,
          ...(isLastIteration ? { tool_choice: { type: 'none' as const } } : {}),
          messages: loopMessages,
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send({ type: 'text', text: chunk.delta.text });
          }
        }
        const response = await stream.finalMessage();
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

        if (response.stop_reason !== 'tool_use' || isLastIteration) break;

        const toolResultContents: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          send({ type: 'tool_start', name: block.name, label: aiToolLabel(block.name, block.input) });
          try {
            const result = await executeAITool(block.name, block.input, auth.userId);
            send({ type: 'tool_done', name: block.name, success: true, result });
            toolResultContents.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err: any) {
            const errMsg = err?.message || 'Tool failed';
            send({ type: 'tool_done', name: block.name, success: false, error: errMsg });
            toolResultContents.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${errMsg}`, is_error: true });
          }
        }

        loopMessages = [
          ...loopMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResultContents },
        ];
      }

      void recordAIUsage({
        userId: auth.userId, feature: 'chat', provider: 'anthropic', model: aiCfg.model,
        inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead,
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      logger.error('AI chat error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: error?.message || 'AI request failed' });
      }
      res.write(`data: ${JSON.stringify({ error: error?.message || 'AI request failed' })}\n\n`);
      res.end();
    }
  });

  // ── POST /api/ai/orchestrate ───────────────────────────────────────────────
  router.post('/ai/orchestrate', aiChatLimiter, async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { messages } = req.body as { messages: Array<{ role: 'user' | 'assistant'; content: string }> };
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: 'messages required' });
      }

      const lastUserMsg = String([...messages].reverse().find((m) => m.role === 'user')?.content || '').trim();

      // ── ZERO-TOKEN FAST-PATH PRE-FILTER ────────────────────────────────────
      // Skip calling the LLM router when the user is clicking option chips,
      // sending a short message, or asking for a direct single-action task.
      const lowerMsg = lastUserMsg.toLowerCase();
      const isSimpleOrChip =
        lastUserMsg.length < 75 ||
        /^\d+\.\s/.test(lastUserMsg) ||
        /^-\s/.test(lastUserMsg) ||
        /^(schedule|draft|write|post|show|list|connect|explain|edit|cancel|hi|hello|hey|thanks)\b/i.test(lowerMsg) ||
        !/(strategy|campaign|multi|funnel|competitor|audit|roadmap|launch plan)/i.test(lowerMsg);

      if (isSimpleOrChip) {
        recordFastPathSavings(450);
        return res.json({ type: 'direct', fastPath: true });
      }

      const aiCfgOrch = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfgOrch);
      if (!apiKey) return res.json({ type: 'direct' });
      if (!(await hasAICredits(auth.userId))) return res.json({ type: 'direct' });

      const orchFastModel = aiCfgOrch.provider === 'google' ? resolveGeminiModel(aiCfgOrch.model) : FAST_MODEL;

      const orchSystemPrompt = `You are a routing assistant for a marketing AI team. Decide if a user message requires a coordinated multi-agent response from specialist agents (Nova=creative director, Sage=strategy analyst, Aria=analytics, Flux=automation) or can be handled directly by the main assistant.

Return ONLY valid JSON. No markdown fences, no explanation.

If single agent: {"type":"direct"}

If multi-agent (complex campaign, brand strategy, platform automation, multi-domain analysis): {"type":"plan","summary":"one sentence describing the overall task","agents":[{"key":"nova","name":"Nova","icon":"◉","color":"#EC4899","task":"what Nova should focus on"},{"key":"sage","name":"Sage","icon":"◈","color":"#10B981","task":"..."}]}

Rules:
- Include only genuinely relevant agents (2-4 max)
- Simple post requests, quick questions, single-domain tasks → direct
- Brand + strategy + analytics + automation tasks → plan`;

      const raw = await callAINonStreaming(
        aiCfgOrch.provider,
        apiKey,
        orchFastModel,
        orchSystemPrompt,
        `User request: "${lastUserMsg.slice(0, 600)}"`,
        350,
        { userId: auth.userId, feature: 'orchestrate_router' }
      );
      try {
        const parsed = JSON.parse(raw);
        if (parsed.type === 'plan' && Array.isArray(parsed.agents) && parsed.agents.length >= 2) {
          return res.json(parsed);
        }
      } catch (_err) { /* fall through */ }
      return res.json({ type: 'direct' });
    } catch (err) {
      logger.error('Unhandled error:', err);
      return res.json({ type: 'direct' });
    }
  });

  // ── POST /api/ai/execute-plan ──────────────────────────────────────────────
  router.post('/ai/execute-plan', aiChatLimiter, async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { messages, plan } = req.body as {
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        plan: { summary: string; agents: Array<{ key: string; name: string; icon: string; color: string; task: string; enabled: boolean }> };
      };

      if (!Array.isArray(messages) || !plan?.agents) {
        return res.status(400).json({ success: false, error: 'messages and plan required' });
      }

      const aiCfg = await getAIConfig();
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });
      if (!(await hasAICredits(auth.userId))) {
        return res.status(402).json({ success: false, error: OUT_OF_CREDITS_MSG });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      const enabledAgents = plan.agents.filter((a) => a.enabled);
      const conversationHistory = messages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content || '').slice(0, 3000),
      }));
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

      let allMemory: any[] = [];
      if (pool) {
        const { rows } = await dbQuery(
          `SELECT category, title, content FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order, created_at LIMIT 60`,
          [auth.userId]
        );
        allMemory = rows as any[];
      }

      const [{ rows: agentRows }, { rows: templateRows }, sharedContext] = await Promise.all([
        dbQuery(`SELECT agent_key, compiled_skill FROM user_agents WHERE user_id=$1`, [auth.userId]),
        dbQuery(`SELECT agent_key, base_prompt FROM agent_templates WHERE agent_key = ANY($1)`, [enabledAgents.map((a) => a.key)]),
        buildSharedAgentContext(auth.userId).catch(() => ''),
      ]);
      const skillMap: Record<string, string> = {};
      for (const r of agentRows as any[]) skillMap[r.agent_key] = r.compiled_skill;
      const templateMap: Record<string, string> = {};
      for (const r of templateRows as any[]) templateMap[r.agent_key] = r.base_prompt;

      send({ type: 'agents_start', count: enabledAgents.length });
      const agentResults: Array<{ key: string; name: string; icon: string; color: string; task: string; analysis: string }> = [];

      const agentFastModel = aiCfg.provider === 'google' ? resolveGeminiModel(aiCfg.model) : FAST_MODEL;

      await Promise.all(enabledAgents.map(async (agent) => {
        send({ type: 'agent_start', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color });
        try {
          const def = AGENT_DEFS[agent.key];
          const basePrompt = templateMap[agent.key] || (def ? `You are ${def.name}, ${def.role} on the Dakyworld Hub marketing team.` : `You are ${agent.name}.`);
          const skill = skillMap[agent.key] || '';
          const agentSystem = `${basePrompt}${skill ? `\n\nWhat you know about this user:\n${skill}` : ''}${sharedContext ? `\n\nLive workspace context (shared with the whole team):\n${sharedContext}` : ''}\n\nYour specific task: ${agent.task}\n\nGive a concise expert analysis (3-5 sentences or a brief bullet list). No intros or sign-offs. Pure insight.`;

          const analysis = await callAINonStreaming(
            aiCfg.provider,
            apiKey,
            agentFastModel,
            agentSystem,
            lastUserMsg.slice(0, 1000),
            350,
            { userId: auth.userId, feature: `team_agent_${agent.key}` }
          );
          agentResults.push({ key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, task: agent.task, analysis });
          send({ type: 'agent_done', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, analysis });
        } catch (err) {
          logger.error('Unhandled error:', err);
          send({ type: 'agent_done', key: agent.key, name: agent.name, icon: agent.icon, color: agent.color, analysis: '' });
        }
      }));

      send({ type: 'synthesis_start' });
      const userMemBlock = allMemory.length > 0
        ? '## ABOUT THIS USER\n' + allMemory.map((r: any) => `[${r.category}] ${r.title}: ${r.content}`).slice(0, 30).join('\n')
        : '## ABOUT THIS USER\nNo personalization data yet.';

      const teamContext = agentResults
        .filter((r) => r.analysis)
        .map((r) => `**${r.name}:** ${r.analysis}`)
        .join('\n\n');

      const synthSystem = `${AI_SYSTEM_PROMPT_DEFAULT.replace('{USER_MEMORY}', userMemBlock)}${sharedContext ? `\n\n## LIVE WORKSPACE\n${sharedContext}` : ''}\n\n${AI_CORE_RULES}`;
      const synthPrompt = `${lastUserMsg}\n\n---\nYour specialist team has analyzed this:\n\n${teamContext}\n\nSynthesize their insights into one unified, decisive recommendation. Be the orchestrator — build on their analyses, don't just repeat them.`;

      let synthesisText = '';
      if (aiCfg.provider === 'google') {
        const effectiveModel = resolveGeminiModel(aiCfg.model);
        const genAI = new GoogleGenerativeAI(apiKey);
        const gModel = genAI.getGenerativeModel({ model: effectiveModel, systemInstruction: synthSystem });
        const gStream = await gModel.generateContentStream(synthPrompt);
        for await (const chunk of gStream.stream) {
          const text = chunk.text();
          if (text) { synthesisText += text; send({ type: 'text', text }); }
        }
      } else {
        const anthropicClient = new Anthropic({ apiKey });
        const synthMessages: Anthropic.MessageParam[] = [
          ...conversationHistory.slice(0, -1),
          { role: 'user', content: synthPrompt },
        ];
        const finalStream = await anthropicClient.messages.stream({
          model: aiCfg.model,
          max_tokens: 1024,
          system: synthSystem,
          messages: synthMessages,
        });
        for await (const chunk of finalStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            synthesisText += chunk.delta.text;
            send({ type: 'text', text: chunk.delta.text });
          }
        }
      }

      send({ type: 'done' });
      const agentNames = enabledAgents.map((a: any) => a.name).join(', ');
      createNotification(auth.userId, 'plan_executed', 'Agent team finished', `Your marketing team (${agentNames}) completed their analysis.`, { agentCount: enabledAgents.length }).catch(() => undefined);
      // Persist the team's conclusion to the global agent memory channel so
      // scheduled agent runs (and future chat sessions) build on it.
      if (synthesisText.trim()) {
        void recordAgentInsight(
          auth.userId,
          `chat_${new Date().toISOString().slice(0, 10)}_${Date.now() % 86400000}`,
          `Team session (${agentNames}) on "${String(lastUserMsg).slice(0, 120)}": ${synthesisText.slice(0, 600)}`
        );
      }
      res.end();
    } catch (e: any) {
      if (!res.headersSent) return res.status(500).json({ success: false, error: e?.message || 'Execute plan failed' });
      res.end();
    }
  });

  return router;
}
