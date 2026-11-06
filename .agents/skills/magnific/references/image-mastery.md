# Magnific Academy — Image Generation, Consistency & Editing Masterclass

This reference distills the official **Magnific Academy** workflows for achieving studio-grade image generation, strict character/product consistency, micro-typography preservation, branded mockups, and non-destructive node editing.

---

## 1. Model Selection Matrix for Images

Always specify the exact model, aspect ratio, resolution, and background rule explicitly (never leave model selection to random defaults):

| Use Case | Recommended Model | Resolution & Format | Why This Model Wins |
| :--- | :--- | :--- | :--- |
| **Art-Directed Campaigns, Editorial Photography, 3D & Illustration** | `magnific-one` | `draft` (4/8/16 tiles) → `quality` (`2k` or `4k`, `high` or `max`) | Built-in art direction; understands natural intent without complex prompt engineering; excels with **2–3 consistent style references** and **Brand Kit**. |
| **Product Photography with Small Text / Micro-Typography** | `nano-banana-pro` | `2k` / `4k` | Preserves tiny heel/midsole/label lettering, stitching, and panel geometry without warped glyphs when paired with the **7-Part Typography Hierarchy**. |
| **Sketches to Photorealistic Products & Modular Interiors** | `nano-banana-pro` | `2k` (`16:9` or `3:4`) | Translates hand-drawn sketches into physically plausible objects and combines separate assets (`@img1` + `@img2`) with natural scale and lighting. |
| **Surgical Frame Corrections & Environment Swaps** | `nano-banana-pro` | Match source | Best for modifying a single detail (e.g., moving a door handle) or replacing a character's background while keeping the subject 100% locked. |
| **Reusable Characters, Branded Mockups & Batch Ad Translation** | `nano-banana-2` | `4k` (`3:4` or `4:3`) | Top choice for full-body character sheets on white backgrounds, realistic surface effects (**deboss, emboss, embroidery**), and multilingual text replacement. |
| **Ultra-Realistic Editorial Portraits** | `mystic` | `2k` / `4k` | Specialized photorealism engine (`realism`, `fluid`, `zen`). |

---

## 2. Magnific One (`magnific-one`) & Brand Kit Playbook

### A. The Draft → Final Funnel
1. **Explore in `Draft` Mode**:
   - Generate **4, 8, or 16 previews** at once to compare compositions, lighting, and creative directions at a fraction of the credit cost and time.
   - **Aspect Ratio Tile Rule**: Use `tiles: 16` (4×4 grid) whenever using `16:9`, `9:16`, `21:9`, `4:3`, `2:1`, or `3:1` so every tile has exact proportions (`tiles: 8` is only exact for `1:1`, `2:3`, `3:2`, `3:4`).
2. **Recreate in `Final` Mode**:
   - Select the winning draft and pass it as a reference image with the same prompt in `Final` (`quality`) mode at `2K` or `4K`.
   - Choose **`High` quality** for most production deliverables, or **`Max` quality** when extreme close-up sharpness or print resolution is required.

### B. The 2–3 Style Reference Sweet Spot
- While Magnific One accepts up to 5 style references (and up to 10 total references via API), **the sweet spot is 2 to 3 visually consistent style references**.
- **Rule**: Ensure all style references share a cohesive aesthetic. Conflicting references pull the model in opposite directions.
- When 2–3 strong style references are attached, **keep the text prompt concise** (focus only on the subject and action; let the references carry the style).

### C. The 3-Part Brand Kit + Auto Layers Pipeline
1. **Magnific One** generates the visual composition.
2. **Brand Kit** (built from brand PDFs, logo variations, product photos, lifestyle galleries, and website links) enforces brand palette, imagery style, tone, and social safe zones (Instagram, TikTok, LinkedIn).
3. **Designer with Auto Layers** (or Figma/Photoshop plugins) handles deterministic, pixel-perfect typography, exact hex colors, logo placement, and copy edits without regenerating the image.

---

## 3. Character & Asset Consistency: The White Background & Profile Sheet Doctrine

When a character, vehicle, or hero prop will be reused across multiple scenes or video clips:

1. **Always Generate on a Plain White Studio Background First**:
   - Prompt for a **full-body portrait on a clean, plain white background with soft studio lighting**.
   - *Why*: Downstream image and video models read character proportions, wardrobe, and facial features accurately when there is zero background clutter or colored ambient light contaminating the silhouette.
2. **Build a Single Character Profile Sheet**:
   - Instead of wiring 4–5 separate character images into every downstream node, generate 4 additional views from your base character:
     - Full-body side view
     - Full-body back view
     - Passport-style front face close-up
     - Passport-style side profile face close-up
   - Combine those views with a **Profile Sheet template layout** in an Image Generator node (`Nano Banana 2`) to produce **one unified Character Profile Sheet**.
   - Use this single Profile Sheet image as the master character reference across all scene stills and video nodes.
3. **Keep Character, Environment, and Object Nodes Separate**:
   - Generate the **Character** (on white), the **Environment/Location** (empty cyclorama, workshop, beach, interior), and the **Hero Object** (surfboard, vehicle, supplement bottle on white) in separate nodes.
   - Combine them downstream so you can swap locations, test new outfits, or change camera angles without rebuilding the entire setup.

---

## 4. Product Photography & Micro-Typography (`Nano Banana Pro` 7-Part Hierarchy)

Small branding text on products (e.g., running shoe heels, watch dials, cosmetic bottles) distorts easily unless the prompt follows this **strict 7-part priority order**:

1. **Composition First**: Define the visual structure before mentioning the product (e.g., *"An editorial still life with diagonal placement and controlled directional lighting"*). Anchoring composition first prevents aesthetic instability.
2. **Exact Product Identity**: Explicitly state that the product must match the studio references 100% (*"matching exact proportions, silhouette, stitching, panel geometry, sole curvature, and construction"*).
3. **Dedicated Typography Block**: Treat text as a priority anchor, not an afterthought. Explicitly quote the exact words, specify their exact location, alignment, and orientation, and command: *"no misspellings, no extra letters, no warped glyphs."*
4. **True Color Accuracy**: Use specific color nomenclature (*"deep cobalt blue upper, neon lime laces, off-white midsole, mint heel lining"*) instead of generic terms (*"blue shoe"*).
5. **Lighting & Harmony**: Describe light direction, warm highlights, and controlled shadows so the environment supports the product without competing with it.
6. **Optical Control**: Specify *"shallow depth of field, tack-sharp focus on the product and its typography, refined tonal balance, no oversaturation."*
7. **Negative Constraints**: Explicitly block improvisation: *"no extra logos, no duplicated text, no invented branding, no distorted lettering."*

---

## 5. Branded Mockups with Physical Surface Effects (`Nano Banana 2`)

To apply a brand logo seamlessly across physical packaging and textiles:
1. **Generate Clean Unbranded Base Products**:
   - Create the first unbranded editorial product shot (`Nano Banana 2`, `4K`, `3:4`, upright, no text/logos).
   - Chain subsequent product shots (e.g., product box on sand, folded beach towel corner) by connecting the previous generated images as references so lighting, color temperature, and photoshoot mood stay 100% cohesive.
2. **Prepare the Logo**:
   - Use a **clean black logo on a plain white background**.
3. **Apply Material-Specific Surface Prompts**:
   - Connect Base Image + Logo → `Nano Banana 2` (`4K`) and specify the physical finish:
     - **Glass / Bottle**: Request a **deboss effect** integrated into the surface.
     - **Cardboard / Packaging Box**: Request an **emboss finish**.
     - **Fabric / Towel / Apparel**: Request an **embroidered effect using thread in a color similar to the fabric**.
   - Always instruct: *"Respect margins from the edges and remain consistent with the surface lighting, contact shadows, and material texture."*

---

## 6. Sketches to Modular Photorealistic Design (`Nano Banana Pro`)

1. **Step 1 — Sketch to Standalone Object (`@img2`)**:
   - Upload a hand-drawn furniture/product sketch to `Nano Banana Pro` (`2K`, `16:9`).
   - Describe physical material quality, weight, curvature behavior, clean neutral background, and realistic camera angle so it reads as a manufactured piece rather than a 3D render.
2. **Step 2 — Sketch to Standalone Environment (`@img1`)**:
   - Upload an architectural/interior sketch to `Nano Banana Pro` (`2K`, `16:9`) and prompt for natural light response, human proportions, and photographic realism.
3. **Step 3 — Modular Integration (`@img1` + `@img2`)**:
   - Connect the finished interior (`@img1`) and finished chair (`@img2`) into `Nano Banana Pro`.
   - **Prompt Rule**: Keep the integration prompt minimal—**only define their spatial relationship** (e.g., *"Place the chair from @img2 naturally in the foreground of the living room from @img1"*). Do **not** re-describe materials or lighting, as both images already carry that visual information.

---

## 7. Non-Destructive Editing, Variations & Designer Automation in Spaces

- **Dedicated `Edit Image` Node vs. Direct Canvas Edit**:
  - Use a connected **Edit Image node** (`Crop` with manual or text-driven `Autocrop`, `Expand Image`, `Change Camera`, `Retouch`) so the original generation stays untouched and the edited output can branch to downstream nodes.
- **`Variations` Node (`Reframe` & `Storyboard`) + Resolution Rule**:
  - Use **Reframe** (up to 9 camera angles: `aerial`, `back view`, `long shot`, `POV`, etc.) or **Storyboard** (narrative progression from 1 source image + story prompt).
  - **CRITICAL GRID RESOLUTION RULE**: A `4K` setting on a `1x4` or `3x3` Variations grid applies `4K` to the **shared grid container**, making each individual frame smaller than 4K. Always enable **Split Images** (or click `Split Grid` afterward) to output a **List node** of separate frames, extract the winning frame, and pass it through an **Image Upscaler** node (`Precision` or `Creative`)!
- **`Designer` Node Automation**:
  - Connect a Logo + equal-length, identically ordered **List nodes** (e.g., 4 product photos, 4 claims, 4 descriptions) to a **Designer node**.
  - Inside Designer: elements added from connected nodes have a **pink outline (dynamic placeholders)** and swap automatically per list item; elements added directly inside Designer have a **blue outline (static elements)** and remain fixed across all generated variations.
