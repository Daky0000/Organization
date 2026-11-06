# Magnific Academy — Video Generation, Motion Control, 3D Scenes & Audio Masterclass

This reference distills the official **Magnific Academy** video production workflows across **Seedance 2.5**, **Kling 3.0**, **Kling 3.0 Omni**, **Kling 2.6 Motion Control**, **3D Scenes**, **Media Extractor**, **Video Combiner**, **Video Upscaler**, and **Audio Nodes**.

---

## 1. Video Model Selection Matrix

| Use Case | Recommended Model | Key Capabilities & Limits |
| :--- | :--- | :--- |
| **Animated Short Films, Multi-Reference Storytelling & 3D Motion Transfer** | `seedance-2-5` (`Seedance 2.5`) | Up to **30s** (sweet spot: **15s chunks**), up to **50 reference assets**, multi-shot cuts inside one generation, native dialogue/SFX/ambience, 3D Scene motion transfer, and targeted clip **`Modify`** edits. |
| **Multi-Character Dialogue Lip-Sync, Mid-Shot Object Swaps & Product Typography in Motion** | `kling-3-0-omni` (`Kling 3.0 Omni`) | Reference-driven consistency (Character + Environment + Product/Object refs without locking a rigid start frame), expressive native lip-sync, smooth mid-shot prop transitions, and stable product lettering in motion. |
| **Hyper-Realistic Cinematic Action (Single-Shot or Multi-Shot)** | `kling-3-0` / `kling-3-pro` (`Kling 3.0`) | Up to **15s** in **Single-Shot** (continuous take) or **Multi-Shot** (up to 6 independent shot tabs, **≤512 chars per shot**). Understands precise film camera terminology (`slow dolly-in`, `handheld tracking`, `lateral movement`). |
| **Real Human Performance / Biomechanics Transfer** | `kling-motion` (`Kling 2.6 Motion Control`) | Applies real movement from a Reference Video onto a Start Image character (`720p`–`1080p` max). **Rule**: Never describe the physical action in the prompt—only describe camera movement! |
| **Fast Fashion / Social Clips with Built-in Audio** | `seedance-2-0` / `kling-v2-6-pro` | 5s–15s I2V & T2V with synchronized native audio/music. |
| **Ultra-High-Res 4K 50fps Text-to-Video** | `ltx-2-pro` (`LTX Video 2.0 Pro`) | Native `1080p` / `1440p` / `2160p (4K)` at `25` or `50` fps with audio. |
| **Audio-Driven Talking Avatars & Presenter Videos** | `omni-human-1-5` (`OmniHuman 1.5`) & `video_speak` | Drives any portrait or full-body image (`image_url`) with voiceover (`audio_url`) up to 30s (`1080p`) or 60s (`720p`). |

---

## 2. Start/End Images vs. Image References in Video

Understanding the difference between **Start/End Images** and **Image References** is critical for natural movement:
- **Start Image (+ optional End Image)**:
  - Locks the exact first visual state (and final visual state when `End Image` is connected).
  - **When to use**:
    - Continuing seamlessly from the extracted last frame of a previous clip.
    - Executing a choreographed reveal (e.g., `Start Image`: closed cabin door with no character → `End Image`: girl standing outside cabin holding surfboard).
    - Replacing a short 2–3 second section after fixing a visual error in an extracted frame.
- **Image References (Character Sheet + Location + Hero Object, NO Start Image)**:
  - Defines *who* appears, *where* the action takes place, and *what* props look like across the generation without locking the first pixel frame.
  - **When to use**:
    - Multi-shot storytelling in `Seedance 2.5` or `Kling 3.0 Omni`.
    - Natural movement and multi-angle cuts (wide shot → close-up face → garment/product detail) where locking a single Start Image would restrict camera freedom.
    - Keeping small product typography sharp across shifting perspectives (`Kling 3.0 Omni` with clean white studio product references).

---

## 3. Seedance 2.5 Short-Film Production Doctrine

1. **The 15-Second Chunking Rule**:
   - Even though Seedance 2.5 supports 30-second clips, **divide a 1-minute film into four 15-second sections** (or 5–10s clips for fast cuts).
   - Longer generations give the model more time to drift from character references or introduce visual artifacts. 15-second chunks provide the optimal balance of scene development, visual continuity, and cheap iteration.
2. **Resolution & Cost Funnel (`480p` → `720p/1080p` → `4K` Upscale)**:
   - Use **`480p` or `720p`** during early prompt, blocking, and action exploration to save credits and generate rapidly.
   - Use **`1080p`** for main multi-option production takes (set **Outputs = 4** to compare 4 interpretations and watch every candidate **from start to finish**, checking character stability after shot cuts).
   - Only upscale the final assembled edit to **`4K`** using the **Video Upscaler** node (`Precision` mode for clean sources where structure must stay faithful; `Creative` mode for artifact repair/reconstruction; enable `FPS Boost` for smoother motion).
3. **The `"No Music"` Multi-Clip Audio Rule**:
   - Enable native sound on `Seedance 2.5` so dialogue, footsteps, and environmental foley are generated in sync with the action.
   - **CRITICAL**: Always explicitly write **`"no music"`** (exclude music) in the video prompt when building a multi-clip sequence! If each of the 4 video clips generates its own music, the final edit will have 4 clashing soundtracks. Generate music separately in a **Music Generator** node (`ElevenLabs Music`) and layer it underneath.
4. **Two Surgical Correction Workflows (Never Regenerate a Full Clip for One Error!)**:
   - **Workflow A — Frame Extraction + `Nano Banana Pro` + Short Replacement Shot**:
     - *Scenario*: In Clip 1 the door handle is on the left; in Clip 2 it flips to the right.
     - *Fix*: Connect the clip to **Media Extractor (`Manual selection`)** → extract a clear frame of the door → connect to **Image Generator (`Nano Banana Pro`)** with a surgical prompt (*"Move the door handle to the right while keeping the rest of the image unchanged"*) → feed the corrected image as the **Start Image** into a new Video Generator and generate **only the 2–3 second moment** needed to splice over the error.
   - **Workflow B — Direct Video `Modify` in Clip Editor (`Seedance 2.5`)**:
     - *Scenario*: The witch's magical smoke around the dog is blue, but needs to be green while keeping the entire performance intact.
     - *Fix*: Open the video → **Edit Clip → Modify** (`Seedance 2.5`) → prompt with exact timestamp and lock constraints: *"Around the 2-second mark, change only the magical smoke surrounding the dog from blue to green. Keep the characters, movement, camera, lighting, composition, and timing unchanged. Preserve the smoke's original shape, density, motion, transparency, and glow."* Attach the original references for extra guidance.

---

## 4. Kling 3.0 & Kling 3.0 Omni Prompting Rules

### A. Kling 3.0 Single-Shot Without Start Image (The 7-Part Formula)
When generating Text-to-Video without a Start Image, the prompt carries 100% of the visual responsibility. Structure it in this exact order:
1. **Environment & Lighting**: e.g., *"A night rugby match under powerful white stadium lights creating dramatic highlights and strong contrast."*
2. **Type of Shot / Framing**: e.g., *"A fast, aggressive close-up tracking shot."*
3. **Clear Character Description**: Specific physical traits (*"An All Blacks player with Māori features, long dreadlocks, traditional tattoos, and two black face-paint lines"*).
4. **Main Physical Action**: e.g., *"He sprints aggressively with the ball while defenders dive unsuccessfully behind him."*
5. **Cinematic Camera Movement**: Use film terminology (*"slow dolly-in"*, *"handheld tracking alongside him"*, *"lateral movement across the cliff"*).
6. **Cinematic Visual Detail**: Surface realism (*"sweat, turf stains, and subtle motion blur reinforcing momentum"*).
7. **Ambient Sound**: When audio is enabled, explicitly describe the soundscape (*"roaring stadium crowd and pounding boots on grass"*).

### B. Kling 3.0 With a Start Image (Action & Camera Only!)
- When a **Start Image** is attached, composition, character appearance, color tones, and lighting are already defined visually.
- **Rule**: Do **NOT** re-describe the environment or character appearance. Keep the prompt short and focused **strictly on the physical action and camera movement** that follows the first frame.

### C. Kling 3.0 Multi-Shot Mode (Up to 6 Shots in One Generation)
- Switch to **Multi-Shot Mode** to direct up to **6 distinct scene cuts** inside a single generation (`≤15 seconds` total combined duration).
- **Hard Limit**: Each shot tab prompt **cannot exceed 512 characters**.
- Assign longer durations (e.g., 4–5s) to emotional climax shots and shorter durations (e.g., 2s) to transitional action cuts.
- Note: Multi-shot mode supports a **Start Image** (plus character/object references), **but does NOT support an End Image**.

### D. Kling 3.0 Omni (`kling-3-0-omni`) Advanced Reference Patterns
1. **Multi-Character Dialogue & Lip-Sync**: Connect Environment Ref + Character 1 Ref + Character 2 Ref (no Start Image), reference each image directly in the prompt, include the exact spoken dialogue lines in quotes, and enable audio.
2. **Mid-Shot Object Transformation**: Connect Character Ref + Object Version A + Object Version B, and specify the trigger in the prompt (*"Every time the character touches his cowboy hat with his hand, the hat transitions naturally to the alternate referenced hat"*).
3. **Product Typography Continuity**: Connect clean white studio product references directly into `Kling 3.0 Omni` so small heel/label lettering stays legible across camera movement.

---

## 5. Kling 2.6 Motion Control (`kling-motion`) — The Camera-Only Prompt Rule

When transferring real human biomechanics from a **Reference Video** onto a character **Start Image**:
1. **Inputs**:
   - `Start Image`: The character you want to animate.
   - `Video Reference`: The live-action performance clip driving the rhythm and biomechanics.
   - `Resolution`: `720p` minimum to `1080p` maximum (cannot exceed Full HD).
   - `Scene Source`: Choose whether the final aspect ratio follows the Reference Video or the Character Image.
2. **CRITICAL PROMPT RULE — NEVER DESCRIBE THE ACTION**:
   - **Do NOT write the physical action** (e.g., do NOT write *"boxing"*, *"throwing punches"*, or *"dancing"*) in the prompt!
   - The movement comes 100% from the reference video. Describing the action in the prompt interferes with the biomechanics transfer.
   - Use the prompt **exclusively to direct camera framing and camera movement** (e.g., *"Medium-tight framing from mid-thigh upward, slightly low angle to emphasize monumentality. The camera performs a slow, controlled orbit around the statue at waist height with smooth engineered motion"*).
3. **Environment Changes Before Motion Transfer**:
   - Do not ask `Kling 2.6 Motion Control` to rebuild complex backgrounds.
   - Instead, first pass the character image into **`Nano Banana Pro`** to replace the environment with realistic contact shadows and lighting integration, then use that new image as the `Start Image` in `Kling 2.6 Motion Control`.

---

## 6. Directing Videos with 3D Generator (`Tripo v3.1`) & 3D Scenes

Instead of guessing complex camera trajectories via text prompts, block them out visually in **3D Scenes**:
1. **Reconstruct the Hero Object in `3D Generator`**:
   - Choose **Image** mode and select **`Tripo v3.1`** when reconstructing a product/vehicle from multiple angles (supports Front, Left, Right, and Back views).
   - Set **Texture Quality** to **`Detailed`** and increase **Face Limit** up to **`1,000,000`** for curved surfaces/vehicles. (When using a single character image, `Rig for animation` is also available).
2. **Build & Keyframe Camera Motion in `3D Scenes`**:
   - Start from **Virtual Scene** (prompt, image, video, or `None` empty space) or **Real Environment** (photo, Google Maps `Place`, or uploaded 3D file).
   - In **Compose**, add your 3D object, characters, shapes, or 2D planes.
   - In **Motion**, either:
     - **Manual Keyframing**: Double-click the timeline to add camera keyframes, click **Enter Camera**, adjust lens focal length, aperture (e.g., `f/2.8`), exact **Focus Point** in 3D space, and keyframe easing (`Smooth`, `Linear`, `Ease In`, `Ease Out`, `Ease In-Out`).
     - **Agent Motion (`Ask`)**: Describe a continuous camera path in natural language (e.g., *"A continuous drone shot starting wide, flying through the pine forest, ascending the mountain face, and orbiting the climbers at the summit with no cuts"*).
3. **Send to `Seedance 2.5` as Motion Transfer**:
   - Click **Use Video** to send the rendered 3D viewport pass into the Video Generator as a **Motion Transfer reference** with **`Seedance 2.5`**.
   - Attach real character/environment **Image References**.
   - **Prompt Rule**: Instruct `Seedance 2.5` to follow the 3D motion transfer reference for camera trajectory, pacing, and geometry **without carrying over its placeholder 3D textures or flat lighting**, while describing the photorealistic materials, water/weather, character actions, and audio. (If the video duration is set longer than the 3D reference clip, describe how the shot should continue after the 3D path ends).

---

## 7. UGC Digital Influencer & Audio Production Pipeline

### A. UGC Influencer Product Review Workflow
1. **Character Creation**: 3 Reference Images → Assistant → `Nano Banana 2` full-body portrait on a **plain white background**.
2. **Profile Sheet**: Generate side view, back view, front face, and profile face → combine with layout template into a single **Character Profile Sheet**.
3. **Environment Placement**: Connect Profile Sheet + Environment Prompt/Refs → `Nano Banana 2` (`9:16`, `4K`) to place the influencer in a relatable setting (car interior, podcast studio, bathroom, cafe).
4. **Product Integration**: Connect Influencer-in-Setting + Product Reference → `Nano Banana 2` (`9:16`, `4K`) prompting her to hold the packaging/bottle naturally.
5. **Performance & Lip-Sync**:
   - *Option A (Voiceover Node Locked)*: Write exact script in **Voiceover** node → select Voice (e.g., *Kendra Blake*) → connect Voiceover audio + Influencer Image + Product Reference into Video Generator, prompting her to present the product synced to the audio.
   - *Option B (Kling 3.0 / Omni Native)*: Connect the base image + action/dialogue prompt into **`Kling 3.0`** or **`Kling 3.0 Omni`** with native audio enabled.

### B. Post-Production Nodes (`Media Extractor`, `Video Combiner`, `Audio`)
- **Media Extractor (5 Modes)**:
  1. `Clips`: Trim only the best 1–3 second usable ranges from generated clips into a List.
  2. `Extract all frames`: Export every frame into a List.
  3. `Custom frame rate`: Sample 1 fps to 24 fps at fixed intervals.
  4. `Manual selection`: Pick the exact **last frame** of Clip 1 to feed into Clip 2's `Start Image` (extending sequences beyond single-clip duration limits) or isolate a flawed frame for `Nano Banana Pro` repair.
  5. `Extract audio clips`: Rip audio segments from a video timeline.
- **3-Layer Audio Mixing Rule**:
  1. **Native Video Audio**: Carries synchronized dialogue and immediate physical interaction foley (with `"no music"` specified in the video prompt).
  2. **Sound Effects Node**: Dedicated ambient layers (e.g., *"relaxing beach ambience, gentle waves, soft wind, distant seagulls, no voices, no music, clean field recording, seamless loop"*) with `Loop` enabled.
  3. **Music Generator Node (`ElevenLabs Music`)**: Scored in emotional sections (e.g., 30s tracks with matching musical identity across Act 1 urgency → Act 2 tension → Act 3 resolution) or combined with the silent/foley video inside **Video Combiner**.
