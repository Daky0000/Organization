# Magnific Academy — Spaces, Lists, Flows & Agent/MCP Orchestration Masterclass

This reference distills the official **Magnific Academy** architecture for building modular **Spaces**, scaling batch operations with **Lists**, packaging repeatable **Flows**, and directing **Agents** (in-app and via **Magnific MCP** `https://mcp.magnific.com`).

---

## 1. Core Architecture of Magnific Spaces

### A. Nodes, Typed Ports & Modular Separation
- Every step in a pipeline lives in its own **Node** (`Text`, `Assistant`, `Add Reference`, `Image Generator`, `Edit Image`, `Variations`, `Image Upscaler`, `Designer`, `Video Generator`, `Speak`, `Media Extractor`, `Video Combiner`, `Video Upscaler`, `Music Generator`, `Voiceover`, `Sound Effects`, `List`, `Group`).
- **Typed Ports**: Connections only succeed when output and input port types match (`Text`, `Image`, `Video`, `Audio`, `SVG`, `Reference`).
- **Why Separate Prompts into `Text` / `Assistant` Nodes?**:
  - Writing prompts in standalone `Text` or `Assistant` nodes instead of directly inside generator nodes allows one prompt to feed multiple generators, or to be swapped/reconnected without losing downstream history.
  - **Quick Tip**: Pasting copied text directly onto the Spaces canvas automatically creates a `Text` node.
- **Color-Coded `Group` Organization**:
  - As a Space grows, group related nodes into color-coded sections: e.g., **`Character`**, **`Product / Object`**, **`Location / Environment`**, **`Scene Stills`**, **`Video Clips`**, and **`Audio & Final Assembly`**.

### B. The `Assistant` Node: `Export as Text` vs. `Export as List`
- Accepts natural language instructions plus multimodal context (**Audio, Video, Text, and Reference Images**).
- Has two tabs: **`Prompt`** (your rough idea or instructions) and **`Result`** (the structured production prompt).
- **Two Export Modes**:
  1. **`Export as Text` (Default)**: Outputs a single polished prompt → triggers **1 execution** in the connected downstream node.
  2. **`Export as List` (Batch Multiplier)**: Generates multiple structured prompt items and automatically spawns a **`List` node** to the right → triggers **N executions** (1 per list item) in any connected downstream generator!

---

## 2. Scaling Workflows with `List` Nodes

A **`List` node** is a structural container (supports Text, Images, Video, Audio, SVGs) that multiplies downstream execution without manual repetition.

### A. `Keep Items` vs. `Replace Items`
- **`Keep items`**: Appends newly generated items to the existing list when upstream nodes re-run (e.g., running a 20-item Assistant twice yields 40 items).
- **`Replace items`**: Clears previous entries and replaces them with only the latest run's items.

### B. Canonical `List` Batch Patterns
1. **Multilingual Ad / Poster Localization**:
   - `Assistant` (*"Generate a list of the top 20 European languages / greetings"*, set to **`Export as List`**, renamed to `languages`) + Uploaded Ad/Poster Mockup → `Image Generator` (`Nano Banana 2`).
   - Prompt: *"Keep the exact same mockup, preserve proportions, layout, and typography style, and translate/replace the text in the ad with `languages`. Keep the brand name intact."*
   - Output: Automatically creates a new image `List` node with 20 full-resolution localized ads that can be downloaded as a named `.zip` archive.
2. **Visual Group → `List` → Batch `Image Upscaler`**:
   - Visually grouped images on the canvas **cannot** connect directly to an `Image Upscaler` node.
   - **Solution**: Connect the visual `Group`'s image output → `List` node's image input (gathers all images into a structured sequence) → single `Image Upscaler` node. One click upscales the entire batch into a new high-res output `List`!
3. **Briefing-to-Characters & Outfits Pipeline**:
   - Single `Text` node (master project briefing describing characters + multiple outfits) → `Assistant 1` (Concept Designer role, `Export as List` of character physical traits) → `Image Generator` (`Nano Banana 2`, `4K`, `3:4`).
   - Parallel branch: Master Briefing `Text` node → `Assistant 2` (Costume Designer role, `Export as List` of all outfits) → `Image Generator` (`Nano Banana 2`, `4K`, `3:4`).

---

## 3. Packaging Spaces into Reusable `Flows`

When a Space workflow will be reused across campaigns or teammates:
1. Click the **Flows** icon in the top-right corner of Spaces → **Create Flow**.
2. **Select Input Node(s)**: Choose the starting node(s) (e.g., the master Briefing `Text` node or Product Upload node).
3. **Select Output Node(s)**: Choose the final result node(s) (e.g., the Character `List` and Outfit `List` nodes, or final `Video Combiner`).
4. Add a cover image, name, and description → **Create Flow**.
5. **3 Ways to Run a Flow**:
   - **Open Standalone**: Run via a clean form UI outside Spaces; outputs go directly to your Gallery.
   - **Add Node to Spaces**: Inserts the entire multi-step pipeline as a single collapsed Flow node inside any Space (note: if a Flow outputs multiple Lists, they stack on top of each other—drag the top List aside to reveal the second).
   - **Copy Link to Share**: Share the parameterized tool with clients or team members.

---

## 4. Directing Agents & Magnific MCP (`https://mcp.magnific.com`)

Whether using **Magnific In-App Agents**, **Custom Agents**, or external assistants (**Claude, ChatGPT, Cursor, Antigravity**) via **Magnific MCP**:

### A. Golden Rules for Commanding Agents
1. **Always Specify Model & Settings Explicitly**:
   - Never give vague generation commands like *"Generate a character."*
   - Always state:
     - **Exact Model**: e.g., `Nano Banana 2`, `Nano Banana Pro`, `Magnific One`, `Seedance 2.5`, `Kling 3.0 Omni`, `Kling 2.6 Motion Control`.
     - **Format / Aspect Ratio**: e.g., `3:4`, `4:3`, `16:9`, `9:16`.
     - **Resolution / Mode**: e.g., `4K`, `1080p`, `720p`, or `Draft mode with 16 tiles`.
     - **Background Rule**: e.g., *"Full body on a plain white background"* for reusable characters/vehicles/products.
2. **Explicit Partial Execution**:
   - When adding a second branch to an existing Space (e.g., adding a vehicle after already generating the character), explicitly instruct the agent: **"Run ONLY this new section/node"** so it does not re-execute earlier nodes and waste credits.
3. **Native Audio vs. Separate Audio Node Instruction**:
   - For video models with built-in audio (`Seedance 2.0 / 2.5`, `Kling 3.0`, `Kling 2.6 Pro`), explicitly tell the agent whether to generate audio/music **directly inside the video node** (fast single-clip tests) OR **exclude music in the video prompt and create a separate Audio node** (multi-clip narrative films).
4. **Custom Agents with Brand Knowledge**:
   - Create specialized Custom Agents with locked default instructions (e.g., *"Always use Nano Banana 2, 4:3 format, 4K resolution, plain white background, Mad Max post-apocalyptic aesthetic"*) and attach **Knowledge files** (Brand Book PDFs, TV Show Bibles, Campaign Guidelines, Color Palettes).

### B. The "Behind Candela" 6-Folder Production Structure
When managing a full production via MCP or Agents, always initialize the project with this **6-folder hierarchy**:
1. `character` — Clean white-background character portraits and unified **Character Profile Sheets**.
2. `locations` — Environment/set references (including multi-era film stock variations if needed, e.g., 35mm 1970s vs. present day).
3. `still frames` — Key narrative anchor frames combining Character Sheets + Locations + Props.
4. `videos` — Generated video shots (`Seedance 2.5` / `Kling 3.0 Omni`).
5. `audio` — Generated `ElevenLabs Music` tracks, `Voiceover` stems, and `Sound Effects` loops.
6. `final edit` — Trimmed `Media Extractor` clips assembled in `Video Combiner` and upscaled to `4K` via `Video Upscaler`.

---

## 5. Magnific in ComfyUI Local/Cloud Hybrid Workflows

- **Plugin**: `magnific.com/plugins/comfyui` (requires ComfyUI 0.3+; extract to `custom_nodes` and sign in).
- **Mandatory `Save To` Node**: Every Magnific generation/edit node in ComfyUI requires a connected **`Magnific Save To`** node specifying the target Magnific Project and Folder (press `R` to refresh node definitions after creating a new project).
- **Credit Visibility**: Each ComfyUI node displays its estimated credit cost directly on the node before execution.
- **Upscaler Modes in ComfyUI**: Choose `2x` to `16x` scale factor, `Creative` vs. `Precision`, and intensity presets (`Subtle`, `Vivid`, `Wild`).
