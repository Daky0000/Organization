---
name: magnific
description: Master guide for Magnific AI REST API (https://api.magnific.com), Magnific MCP (https://mcp.magnific.com), and official Magnific Academy production methodologies. Use for ALL non-text generations including Magnific One art-directed images & contact sheets, Nano Banana Pro / Nano Banana 2 product typography & branded surface mockups, Mystic/Flux/Seedream image generation, upscaling/relighting/expanding/editing, Seedance 2.5 / Kling 3.0 / Kling 3.0 Omni / Kling 2.6 Motion Control / LTX / WAN / Hailuo / RunWay video generation, 3D Scenes motion transfer, OmniHuman 1.5 & video_speak lip-sync talking avatars, music/SFX/SAM audio isolation/TTS, and Magnific Spaces, Lists & reusable Flows.
---

# Magnific AI — Complete Multimodal & Magnific Academy Master Skill

Magnific is the primary engine for **all non-text generation** across the platform:
1. **Magnific One** (`/v1/ai/magnific-one` & MCP `images_generate`) — Flagship art-directed image model with 4/8/16-tile draft contact sheets, **2–3 style reference sweet spot** (up to 10 total references), **Brand Kit** integration, and 2K/4K (`high` / `max`) quality renders.
2. **Nano Banana Pro & Nano Banana 2** (`nano-banana-pro`, `nano-banana-2`, `nano-banana-pro-flash`) — Specialized masters for **product micro-typography preservation** (7-Part Prompt Hierarchy), **4K physical surface mockups** (`deboss`, `emboss`, `embroidered thread`), **sketch-to-photorealistic modular interiors** (`@img1` + `@img2`), **clean white-background Character Profile Sheets**, **multilingual ad batch localization**, and **surgical frame/background corrections**.
3. **Image Generation & Editing** — Mystic, Flux Kontext Pro, Flux 2 Pro/Turbo/Klein, Seedream 4.5, Creative & Precision Upscaler (2x–16x), Relight, Style Transfer, Remove Background, Variations (`Reframe` & `Storyboard` + `Split Images`), Designer Node (`Auto Layers` & pink dynamic placeholders), and Flux Pro Image Expand.
4. **Video Generation & Motion Control** — **Seedance 2.5** (up to 30s, 50 references, multi-shot, 3D motion transfer, clip `Modify`), **Kling 3.0** (Single-Shot 7-part formula & Multi-Shot mode up to 6 cuts / ≤512 chars per shot), **Kling 3.0 Omni** (reference-driven multi-character dialogue lip-sync, mid-shot object swap, product text stability in motion), **Kling 2.6 Motion Control** (biomechanics transfer with camera-only prompt rule), Kling 2.6 Pro, LTX 2.0 Pro (up to 4K 50fps), WAN 2.6, MiniMax Hailuo 2.3, RunWay Gen4 Turbo / Act Two, and Video Upscaler (`Precision` vs. `Creative` + `FPS Boost`).
5. **3D Tools & Cinematography** — **3D Generator** (`Tripo v3.1` multi-view reconstruction up to 1M faces) + **3D Scenes** (`Compose`, `Shoot`, `Motion` camera keyframing with aperture/focus/easing) → **Seedance 2.5 Motion Transfer**.
6. **Lip Sync & Talking Avatars** — **OmniHuman 1.5** (`/v1/ai/video/omni-human-1-5`), MCP **`video_speak`**, and **Voiceover Node → Video Generator** UGC digital influencer workflows.
7. **Audio Generation & Post-Production** — **ElevenLabs Music Generation** (`/v1/ai/music-generation`), **Sound Effects** (`/v1/ai/sound-effects` with `loop`), **SAM Audio Isolation** (`/v1/ai/audio-isolation`), **Media Extractor** (5 modes: `Clips`, `Extract all frames`, `Custom frame rate`, `Manual selection`, `Extract audio clips`), and **Video Combiner**.
8. **Magnific Spaces, Lists & Flows** — Modular node-graph canvases (`spaces_*`), **`List` node batch scaling** (`Export as List`, `Keep items` vs. `Replace items`), and parameterized repeatable **Flows** (`spaces_create_flow`, `flows_run`, `flows_wait`).

### Deep-Dive Academy Reference Playbooks
For detailed step-by-step instructions, read these companion files in `references/`:
- [references/image-mastery.md](./references/image-mastery.md) — Magnific One Draft→Final & Brand Kit, Character Profile Sheets on white backgrounds, Nano Banana Pro 7-Part Product Typography Hierarchy, Nano Banana 2 Deboss/Emboss/Embroidery Mockups, Sketch-to-Modular Design, Variations & Designer Node automation.
- [references/video-mastery.md](./references/video-mastery.md) — Seedance 2.5 15s chunking & surgical corrections, Kling 3.0 Single/Multi-Shot & Kling 3.0 Omni reference mastery, Kling 2.6 Motion Control camera-only rule, 3D Scenes cinematography, UGC Influencer pipeline, Media Extractor & 3-layer Audio mixing.
- [references/spaces-flows-agents.md](./references/spaces-flows-agents.md) — Spaces modular node separation, Assistant `Export as List` batching, List node scaling patterns, Flows creation, Agent/MCP explicit instruction rules, and the Candela 6-folder production structure.

---

## 1. Golden Rules from Magnific Academy (Efficiency, Consistency & Quality)

1. **Always Pre-Flight Estimate Cost & Specify Exact Model Parameters**:
   - In Magnific MCP or Spaces, call `simulate_cost`, `simulate_spaces`, or `simulate_flows` (free, 0 credits) before running large batches, 4K upscales, or multi-node Spaces.
   - **Never rely on default agent model selection**: Always explicitly specify the **model** (`magnific-one`, `nano-banana-2`, `nano-banana-pro`, `seedance-2-5`, `kling-3-0-omni`, `kling-3-0`, `kling-motion`), **aspect ratio** (`3:4`, `4:3`, `16:9`, `9:16`), **resolution** (`480p`/`720p`/`1080p`/`2K`/`4K`), and **background rule**.
   - When adding a new branch to an existing Space, instruct the agent to **run ONLY the new section** so earlier nodes are not re-executed.

2. **Modular Separation + Plain White Background + Character Profile Sheet Rule**:
   - Keep **Characters**, **Environments/Locations**, and **Hero Objects/Products** in separate nodes (grouped and color-coded on the canvas) rather than baking everything into a single prompt from the start.
   - **White Background Rule**: Whenever a character, vehicle, or product will be reused across scenes or videos, generate it first on a **clean, plain white studio background with soft lighting** (`Nano Banana 2`, `4K`, `3:4` or `4:3`) so downstream models read its silhouette and details without background interference.
   - **Character Profile Sheet Anchor**: From the base character, generate 4 additional views (full-body side, full-body back, front passport face, side profile face) and combine them with a template into **one Character Profile Sheet**. Connect this single sheet as your master consistency reference across all scene stills and video nodes.

3. **Magnific One: Draft → Final Funnel + 2–3 Style Reference Sweet Spot + Brand Kit**:
   - **Explore in `Draft` Mode**: Generate 4, 8, or 16 previews cheaply. **Always use `tiles: 16` (4×4 grid)** when exploring `16:9`, `9:16`, `21:9`, `4:3`, `2:1`, or `3:1` because `tiles: 8` is only exact for `1:1`, `2:3`, `3:2`, and `3:4`.
   - **Recreate in `Final` (`quality`) Mode**: Pass the winning draft as a reference with the same prompt at `2k` or `4k` (`high` quality for standard use; `max` quality for close-ups/print).
   - **Style References**: While up to 5 style references (10 total API references) are supported, **2 to 3 visually consistent style references is the sweet spot**. When strong style references are attached, keep the text prompt simple and subject-focused.
   - **3-Part Brand Workflow**: **Magnific One** generates the image → **Brand Kit** guides palette/style/tone/channel safe zones → **Designer with Auto Layers** (or Designer Node) refines deterministic typography, logos, and exact colors.

4. **Nano Banana Pro: 7-Part Prompt Hierarchy for Product Micro-Typography**:
   - To keep small branding and heel/label text sharp and unwarped, write prompts in **`Nano Banana Pro`** using this exact priority order:
     1. **Composition First** (e.g., *"Editorial still life with diagonal placement and controlled directional lighting"*).
     2. **Exact Product Identity** (lock proportions, silhouette, stitching, panel geometry, and construction to the studio references).
     3. **Dedicated Typography Block** (explicitly quote exact words, location, alignment/orientation, and state *"no misspellings, no extra letters, no warped glyphs"*).
     4. **True Color Accuracy** (use specific color names like *"deep cobalt blue upper, neon lime laces, off-white midsole"* instead of *"blue shoe"*).
     5. **Lighting & Harmony** (light direction and tonal balance supporting the product).
     6. **Optical Control** (*"shallow depth of field, tack-sharp focus on the product and its typography, refined tonal balance, no oversaturation"*).
     7. **Negative Constraints** (*"no extra logos, no duplicated text, no invented branding, no distorted lettering"*).
   - **In Video (`Kling 3.0 Omni`)**: Pass the same clean white studio product references directly into `Kling 3.0 Omni` (instead of a rigid Start Image) so the typography stays legible across motion and camera shifts.

5. **Nano Banana 2: Branded Surface Mockups & Sketch-to-Modular Design**:
   - **Branded Mockups (`Nano Banana 2`, `4K`)**: Chain unbranded base product shots via references so lighting matches the same photoshoot → connect a **black logo on a white background** → prompt for physical surface integration: **`deboss effect`** (bottles/glass), **`emboss finish`** (boxes/packaging), or **`embroidered effect using thread matching the fabric color`** (towels/apparel), respecting edge margins, contact shadows, and surface texture.
   - **Sketches to Modular Interiors (`Nano Banana Pro`)**: Turn Sketch 1 into a realistic standalone object (`@img2`) and Sketch 2 into a realistic standalone room (`@img1`), then combine `@img1` + `@img2` in a final generation where the prompt **only defines their spatial relationship** (do not re-describe materials or lighting).

6. **Seedance 2.5 & Multi-Clip Video Production Doctrine**:
   - **15-Second Chunking Rule**: Even though `Seedance 2.5` generates up to 30s clips (with up to 50 references and multi-shot cuts), build 1-minute stories in **four 15-second sections** (or 5–10s clips) to prevent reference drift and iterate cheaply.
   - **Resolution Funnel (`480p`/`720p` → `1080p` → `4K` Video Upscaler)**: Explore blocking at `480p`/`720p`, generate 4 candidate outputs at `1080p` (watching each candidate **from start to finish** to verify continuity across cuts), trim the best 1–3s ranges using **Media Extractor (`Clips`)**, assemble in **Video Combiner**, and upscale the final edit to **`4K`** using **Video Upscaler** (`Precision` for clean sources, `Creative` for artifact reconstruction, plus `FPS Boost`).
   - **The `"No Music"` Rule for Multi-Clip Videos**: Enable native sound for dialogue and foley, **but explicitly include `"no music"` in the video prompt** whenever combining multiple clips so you don't get 4 clashing soundtracks. Generate music separately in **Music Generator (`ElevenLabs Music`)** across emotional sections and layer it underneath.
   - **Two Surgical Correction Methods (Never Regenerate a Good Clip from Scratch!)**:
     1. **Media Extractor (`Manual selection`) → `Nano Banana Pro` frame fix → 2–3s Replacement Clip** (using the fixed frame as `Start Image`).
     2. **Clip Editor → `Modify` (`Seedance 2.5`)**: Target a specific timestamp and element (e.g., *"Around the 2-second mark, change only the magical smoke from blue to green; keep characters, movement, camera, lighting, and timing unchanged"*).

7. **Kling 3.0, Kling 3.0 Omni & Kling 2.6 Motion Control Rules**:
   - **Kling 3.0 Single-Shot (No Start Image)**: Follow the **7-Part Video Prompt Formula**: (1) Environment & Lighting → (2) Shot Type/Framing → (3) Specific Character Traits → (4) Main Physical Action → (5) Cinematic Camera Move (`slow dolly-in`, `handheld tracking`) → (6) Visual Detail (`sweat, turf stains, motion blur`) → (7) Ambient Sound.
   - **Kling 3.0 Single-Shot (With Start Image)**: Do **NOT** re-describe the visible environment or character; prompt **only the physical action and camera movement**.
   - **Kling 3.0 Multi-Shot Mode**: Up to **6 shot tabs** in one ≤15s generation; **each shot prompt must be ≤512 characters**; supports a Start Image but **no End Image**.
   - **Kling 3.0 Omni**: Use multiple **Image References** (Character 1 + Character 2 + Environment, or Character + Object A + Object B) instead of a fixed Start Image for natural multi-character lip-sync dialogue, mid-shot prop swaps, or motion replication from a Video Reference.
   - **Kling 2.6 Motion Control (`kling-motion`, 720p–1080p max)**: **NEVER describe the physical action in the prompt!** The biomechanics come 100% from the Reference Video; describing the action interferes with transfer. Use the prompt **only for camera framing and camera movement**. If you need a new background, swap the background in `Nano Banana Pro` *before* running Motion Control.

8. **Variations Grid & List Node Scaling Rules**:
   - **Variations Node (`Reframe` / `Storyboard`)**: A `4K` grid applies `4K` to the whole container, not individual cells. Always enable **Split Images** (or `Split Grid`) to create a `List` node, extract the chosen frame, and run it through **Image Upscaler**.
   - **List Node Batching**: Use Assistant **`Export as List`** (or connect a visual Group → `List` node) to multiply downstream Image Generator, Designer Node, or Image Upscaler executions automatically (`Keep items` to append, `Replace items` to overwrite).

---

## 2. Magnific REST API Reference (`https://api.magnific.com`)

All REST endpoints authenticate with header:
```http
x-magnific-api-key: YOUR_API_KEY
Content-Type: application/json
```
Most endpoints are asynchronous: `POST` returns `{ data: { task_id, status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED", generated: [] } }`. Poll `GET /v1/ai/<endpoint>/{task-id}` until `status === "COMPLETED"`, or pass `webhook_url`.

### A. Magnific One (`POST /v1/ai/magnific-one`)
- **Poll**: `GET /v1/ai/magnific-one/{task-id}`
- **Parameters**:
  - `prompt` (string, required, max 2000 chars): Art-directed intent prompt.
  - `mode` (`"quality"` | `"draft"`, default `"quality"`): `"quality"` renders 1 finished image; `"draft"` renders a 4-, 8-, or 16-tile contact sheet billed once at `medium`/`2k` price.
  - `quality` (`"medium"` | `"high"` | `"max"`, default `"high"`): Quality mode only.
  - `resolution` (`"1k"` | `"2k"` | `"4k"`, default `"2k"`): Quality mode only.
  - `aspect_ratio` (`"1:1"` | `"2:1"` | `"3:1"` | `"2:3"` | `"3:2"` | `"3:4"` | `"4:3"` | `"16:9"` | `"9:16"` | `"21:9"`, default `"1:1"`).
  - `tiles` (`8` | `16`, default `8`): Draft mode only. Use `16` for exact aspect ratios across all 10 options.
  - `reference_images` (`string[]`, optional, 1–10 public HTTPS URLs): Guides style/composition at no extra cost (sweet spot: **2–3 consistent style references**).
  - `webhook_url` (string, optional).

### B. Specialized Image Generation Models
- **Nano Banana Pro & Nano Banana 2** (Product Typography, Branded Mockups, Sketches & Character Sheets):
  - `POST /v1/ai/text-to-image/nano-banana-pro` (`nano-banana-pro`)
  - `POST /v1/ai/text-to-image/nano-banana-2` (`nano-banana-2`)
  - `POST /v1/ai/text-to-image/nano-banana-pro-flash` (`nano-banana-pro-flash`)
- **Mystic**: `POST /v1/ai/mystic` (`prompt`, `aspect_ratio`: `square_1_1` | `widescreen_16_9` | `social_story_9_16` | `portrait_2_3` | `traditional_3_4`, `resolution`: `'2k' | '4k'`, `model`: `'realism' | 'fluid' | 'zen'`)
- **Flux Kontext Pro**: `POST /v1/ai/text-to-image/flux-kontext-pro` (`prompt`, `aspect_ratio`, optional `image` input for context-aware editing)
- **Flux 2 Pro / Turbo / Klein**:
  - `POST /v1/ai/text-to-image/flux-2-pro`
  - `POST /v1/ai/text-to-image/flux-2-turbo`
  - `POST /v1/ai/text-to-image/flux-2-klein` (sub-second generation, up to 4 reference images)
- **Seedream 4 / 4.5 / 5 Lite & Z-Image & RunWay**:
  - `POST /v1/ai/text-to-image/seedream-v4-5`
  - `POST /v1/ai/text-to-image/seedream-v5-lite`
  - `POST /v1/ai/text-to-image/z-image`
  - `POST /v1/ai/text-to-image/runway`

### C. Image Editing APIs
- **Upscaler Creative**: `POST /v1/ai/image-upscaler` (`image` base64, `scale_factor`: `'2x' | '4x' | '8x' | '16x'`, `optimized_for`: `'standard' | 'soft_portraits' | 'hard_portraits' | 'art_n_illustration' | 'videogame_assets' | 'nature_n_landscapes' | 'films_n_photography' | '3d_renders' | 'science_fiction_n_horror'`, `prompt`, `creativity`, `hdr`, `resemblance`, `fractality`)
- **Upscaler Precision**: `POST /v1/ai/image-upscaler-precision` (faithful upscaling without hallucinating new details—ideal for clean designs, typography, and split variation frames)
- **Relight**: `POST /v1/ai/image-relight` (`image` base64, `prompt`, `light_transfer_strength`: `0..100`)
- **Style Transfer**: `POST /v1/ai/image-style-transfer` (`image` base64, `reference_image` base64, `prompt`, `style_strength`: `0..100`)
- **Remove Background**: `POST /v1/ai/beta/text-to-image/remove-background` (`image_url`)
- **Image Expand (Flux Pro)**: `POST /v1/ai/image-expand/flux-pro` (`image` base64, `prompt`, `left`: `0..2048` default `512`, `right`: `0..2048` default `512`, `top`: `0..2048` default `256`, `bottom`: `0..2048` default `256`).

### D. Video Generation APIs
- **Seedance 2.5 / 2.0 / Pro**:
  - `POST /v1/ai/video/seedance-2-5` (`seedance-2-5`): Up to 30s (15s recommended chunks), `480p` / `720p` / `1080p` / `4k`, up to 50 `reference_images`, `image` (start), `end_image` (end), `reference_video` (3D motion transfer), `generate_audio: true` (add `"no music"` to prompt for multi-clip stories).
  - `POST /v1/ai/video/seedance-2-0` (`seedance-2-0`)
  - `POST /v1/ai/image-to-video/seedance-pro-1080p` (`seedance-pro-1080p`)
- **Kling 3.0 & Kling 3.0 Omni**:
  - `POST /v1/ai/video/kling-v3-omni` (`kling-3-0-omni`): Reference-driven video with `reference_images` (characters, environments, products), `reference_video`, native lip-sync dialogue, and object transitions.
  - `POST /v1/ai/video/kling-v3-pro` (`kling-3-0` / `kling-3-pro`): Supports Single-Shot (`≤15s`) and Multi-Shot (`shots`: up to 6 items, `≤512 chars` per shot, `≤15s` total) with `image` (Start Image) and native audio.
- **Kling 2.6 Pro & Kling 2.6 Motion Control**:
  - `POST /v1/ai/image-to-video/kling-v2-6-pro` (`kling-v2-6-pro`): `duration` (`"5"` | `"10"`), `image`, `image_tail`, `generate_audio`.
  - `POST /v1/ai/image-to-video/kling-motion` (`kling-motion`): Transfers biomechanics from `reference_video` onto `image` (`720p`–`1080p`). **Prompt must only describe camera movement, never the physical action!**
- **LTX Video 2.0 Pro**: `POST /v1/ai/text-to-video/ltx-2-pro` (`1080p` | `1440p` | `2160p`, `25` | `50` fps, `generate_audio`)
- **WAN 2.6 / 2.7, MiniMax Hailuo 2.3, RunWay Gen4 Turbo & Act Two, PixVerse V5**:
  - `POST /v1/ai/image-to-video/wan-v2-6-1080p`, `POST /v1/ai/text-to-video/wan-2-7`
  - `POST /v1/ai/image-to-video/minimax-hailuo-2-3-1080p`
  - `POST /v1/ai/image-to-video/runway-gen4-turbo`, `POST /v1/ai/video/runway-act-two`
  - `POST /v1/ai/image-to-video/pixverse`

### E. Lip Sync & Talking Avatars (`OmniHuman 1.5` & `video_speak`)
- **OmniHuman 1.5 REST Endpoint**: `POST /v1/ai/video/omni-human-1-5`
  - Required: `image_url` (human figure) + `audio_url` (driving voiceover, max 30s at `1080p`, max 60s at `720p`).
  - Optional: `prompt` (expression/gesture guidance), `resolution` (`"1080p"` | `"720p"`), `turbo_mode` (`boolean`).
- **MCP Lip-Sync / UGC Workflow (`video_speak`)**:
  1. Generate voiceover via `audio_voices_list` → `audio_tts` (or `Voiceover` node in Spaces).
  2. Connect Voiceover audio + Character Reference + Product Reference into Video Generator (`Kling 3.0 Omni` / `video_speak` / `OmniHuman 1.5`) for synced product review clips.

### F. Audio APIs (ElevenLabs Music, Sound Effects, SAM Audio Isolation)
- **Music Generation**: `POST /v1/ai/music-generation` (or MCP `audio_music_generate`). Describe genre, mood, energy, instrumentation, progression, and vocal exclusion (e.g., 30s sections scored per story act).
- **Sound Effects**: `POST /v1/ai/sound-effects` (`text`, `duration_seconds` `0.5`–`22`, `loop: true/false`).
- **Audio Isolation (SAM Audio)**: `POST /v1/ai/audio-isolation` (`description`, `audio` or `video` input).

---

## 3. Platform Endpoints & Agent Tools Summary (`d:\Saas`)

Within `d:\Saas`, agents and services invoke Magnific through:
- **REST Endpoints (`/api/magnific/*`)**:
  - `POST /api/magnific/magnific-one` — Dedicated Magnific One endpoint (`mode: 'draft' | 'quality'`, `tiles: 8 | 16`, `resolution: '1k' | '2k' | '4k'`, `quality: 'high' | 'medium'`, `aspect_ratio`, `reference_images`)
  - `POST /api/magnific/generate-image` — Unified image generation (`magnific-one`, `nano-banana-pro`, `nano-banana-2`, `nano-banana-pro-flash`, `mystic`, `flux-kontext-pro`, `flux-2-pro`, `seedream-v4-5`, etc.)
  - `POST /api/magnific/edit` — Image editing (`upscale`, `upscale-precision`, `relight`, `style-transfer`, `remove-background`, `image-expand`, `seedream-edit`)
  - `POST /api/magnific/generate-video` — Video generation (`seedance-2-5`, `seedance-2-0`, `kling-3-0-omni`, `kling-3-0`, `kling-3-pro`, `kling-v2-6-pro`, `kling-motion`, `ltx-2-pro`, `wan-2-6-1080p`, `minimax-hailuo-2-3-1080p`, `runway-gen4-turbo`, `seedance-pro-1080p`, etc.)
  - `POST /api/magnific/lip-sync` — Talking avatar / lip-sync generation (`omni-human-1-5` + MCP `video_speak`)
  - `POST /api/magnific/audio` — Audio generation & isolation (`music-generation`, `sound-effects`, `audio-isolation`, `tts`)
  - `POST /api/magnific/spaces` & `POST /api/magnific/flows` — Create, simulate, and run Magnific Spaces and reusable Flows
- **OS Bridge (`POST /api/v1/os/generate`)**:
  - Supports `type: 'magnific-one' | 'image' | 'edit' | 'video' | 'lip-sync' | 'audio' | 'space' | 'flow'`
- **AI Chat & Agent Workflow Tools**:
  - `magnific_one_generate`, `magnific_generate_image`, `magnific_edit_image`, `magnific_generate_video`, `magnific_lip_sync`, `magnific_generate_audio`, `magnific_space_or_flow`
