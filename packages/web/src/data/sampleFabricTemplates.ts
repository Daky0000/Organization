/**
 * Sample Fabric.js card templates — ready to import via Admin → Import JSON.
 *
 * Each object follows the FabricDesignData shape:
 *   { fabricVersion: true, canvasWidth, canvasHeight, fabricJson }
 *
 * To import: Admin → Card Templates → "Import JSON" → paste the
 * JSON export of this array (see the exported `SAMPLE_TEMPLATES_JSON` below).
 */

export interface SampleTemplate {
  name: string;
  description: string;
  designData: {
    fabricVersion: true;
    canvasWidth: number;
    canvasHeight: number;
    fabricJson: Record<string, unknown>;
  };
}

// ── Helper to build a linear-gradient background object ───────────────────────
function linearGradBg(c1: string, c2: string, angle = 135, w = 1080, h = 1080) {
  const rad = (angle * Math.PI) / 180;
  const sinA = Math.sin(rad);
  const cosA = Math.cos(rad);
  return {
    type: 'linear',
    coords: {
      x1: (0.5 - 0.5 * sinA) * w,
      y1: (0.5 + 0.5 * cosA) * h,
      x2: (0.5 + 0.5 * sinA) * w,
      y2: (0.5 - 0.5 * cosA) * h,
    },
    colorStops: [
      { offset: 0, color: c1 },
      { offset: 1, color: c2 },
    ],
    gradientUnits: 'pixels',
    gradientTransform: null,
    offsetX: 0,
    offsetY: 0,
  };
}

function textObj(overrides: Record<string, unknown>) {
  return {
    type: 'textbox',
    version: '5.3.0',
    originX: 'left',
    originY: 'top',
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    flipX: false,
    flipY: false,
    opacity: 1,
    visible: true,
    editable: true,
    selectable: true,
    evented: true,
    stroke: null,
    strokeWidth: 1,
    strokeDashArray: null,
    strokeLineCap: 'butt',
    strokeDashOffset: 0,
    strokeLineJoin: 'miter',
    strokeUniform: false,
    strokeMiterLimit: 4,
    shadow: null,
    fontFamily: 'Inter',
    fontWeight: 'normal',
    fontSize: 40,
    text: 'Text',
    underline: false,
    overline: false,
    linethrough: false,
    textAlign: 'left',
    fontStyle: 'normal',
    lineHeight: 1.16,
    textBackgroundColor: '',
    charSpacing: 0,
    styles: {},
    direction: 'ltr',
    path: null,
    pathStartOffset: 0,
    pathSide: 'left',
    pathAlign: 'baseline',
    minWidth: 20,
    splitByGrapheme: false,
    fill: '#ffffff',
    ...overrides,
  };
}

function rectObj(overrides: Record<string, unknown>) {
  return {
    type: 'rect',
    version: '5.3.0',
    originX: 'left',
    originY: 'top',
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    flipX: false,
    flipY: false,
    opacity: 1,
    visible: true,
    selectable: true,
    evented: true,
    strokeWidth: 0,
    stroke: null,
    rx: 0,
    ry: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export const SAMPLE_TEMPLATES: SampleTemplate[] = [
  // 1 ── Marketing Strategy ───────────────────────────────────────────────────
  {
    name: 'Marketing Strategy',
    description: 'Dark purple gradient with bold headline — ideal for LinkedIn and Instagram strategy posts.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#2d1b69', '#1a0a3d', 150),
        objects: [
          // accent top strip
          rectObj({ left: 0, top: 0, width: 1080, height: 8, fill: '#7c3aed', rx: 0, ry: 0 }),
          // sub-label
          textObj({ left: 80, top: 80, width: 920, text: 'WHY EVERY', fontSize: 28, fontWeight: '700', fill: '#a78bfa', charSpacing: 200, textAlign: 'left' }),
          // headline
          textObj({ left: 80, top: 130, width: 920, text: 'BRAND\nNeeds a Strategy,\nNot Just Posts.', fontSize: 96, fontWeight: '900', fill: '#ffffff', lineHeight: 1.05, textAlign: 'left' }),
          // body
          textObj({ left: 80, top: 520, width: 780, text: 'Random posting = random results.\nBuild systems, not chaos.', fontSize: 36, fontWeight: '400', fill: '#c4b5fd', lineHeight: 1.4, textAlign: 'left' }),
          // CTA button bg
          rectObj({ left: 80, top: 680, width: 360, height: 80, fill: '#7c3aed', rx: 40, ry: 40 }),
          // CTA text
          textObj({ left: 80, top: 694, width: 360, text: 'Build My Strategy', fontSize: 28, fontWeight: '700', fill: '#ffffff', textAlign: 'center' }),
          // website
          textObj({ left: 80, top: 980, width: 600, text: 'www.yourbrand.com', fontSize: 24, fontWeight: '400', fill: '#7c3aed' }),
        ],
      },
    },
  },

  // 2 ── Design Starts With Strategy ─────────────────────────────────────────
  {
    name: 'Design Starts With Strategy',
    description: 'Minimal dark background with bold headline and a subtle breadcrumb path.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1350,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#0a0a12', '#1a1a2e', 160, 1080, 1350),
        objects: [
          // breadcrumb badge
          rectObj({ left: 80, top: 220, width: 460, height: 60, fill: 'rgba(255,255,255,0.08)', rx: 30, ry: 30 }),
          textObj({ left: 80, top: 234, width: 460, text: 'Strategy  →  Design  →  Impact', fontSize: 22, fontWeight: '500', fill: '#94a3b8', textAlign: 'center' }),
          // headline
          textObj({ left: 80, top: 340, width: 920, text: 'Design Starts\nWith Strategy', fontSize: 110, fontWeight: '900', fill: '#ffffff', lineHeight: 1.05 }),
          // italic accent
          textObj({ left: 490, top: 530, width: 510, text: 'Strategy', fontSize: 110, fontWeight: '900', fill: '#f59e0b', fontStyle: 'italic', lineHeight: 1.05 }),
          // body copy
          textObj({ left: 80, top: 760, width: 780, text: 'Before colors and layouts, design needs direction.\nWithout clarity and direction, even beautiful design fails.', fontSize: 34, fontWeight: '400', fill: '#64748b', lineHeight: 1.5 }),
          // CTA button
          rectObj({ left: 80, top: 1000, width: 380, height: 80, fill: '#ffffff', rx: 40, ry: 40 }),
          textObj({ left: 80, top: 1014, width: 380, text: 'Want to work with Us  ↗', fontSize: 26, fontWeight: '700', fill: '#0a0a12', textAlign: 'center' }),
          // footer
          textObj({ left: 80, top: 1290, width: 400, text: 'Email: hello@agency.com', fontSize: 22, fontWeight: '400', fill: '#475569' }),
          textObj({ left: 600, top: 1290, width: 400, text: 'Website: www.agency.com', fontSize: 22, fontWeight: '400', fill: '#475569', textAlign: 'right' }),
        ],
      },
    },
  },

  // 3 ── Clarity Is Everything ────────────────────────────────────────────────
  {
    name: 'Clarity Is Everything',
    description: 'Dark listicle card with a bold headline and numbered bullet points.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: '#0d0d0d',
        objects: [
          // grid lines (decorative)
          ...Array.from({ length: 6 }, (_, i) => rectObj({ left: i * 180, top: 0, width: 1, height: 1080, fill: 'rgba(255,255,255,0.04)', rx: 0 })),
          ...Array.from({ length: 6 }, (_, i) => rectObj({ left: 0, top: i * 180, width: 1080, height: 1, fill: 'rgba(255,255,255,0.04)', rx: 0 })),
          // number
          textObj({ left: 80, top: 70, width: 200, text: '1.', fontSize: 60, fontWeight: '900', fill: '#3b82f6' }),
          // headline
          textObj({ left: 80, top: 150, width: 920, text: 'Clarity Is\nEverything', fontSize: 108, fontWeight: '900', fill: '#ffffff', lineHeight: 1.0 }),
          // In Design section
          textObj({ left: 80, top: 440, width: 920, text: 'In Design:', fontSize: 36, fontWeight: '700', fill: '#ffffff' }),
          textObj({ left: 80, top: 495, width: 920, text: '→  Confusing layouts = lost users\n→  Messy visuals = no action taken', fontSize: 30, fontWeight: '400', fill: '#94a3b8', lineHeight: 1.5 }),
          // In Relationships section
          textObj({ left: 80, top: 620, width: 920, text: 'In Relationships:', fontSize: 36, fontWeight: '700', fill: '#ffffff' }),
          textObj({ left: 80, top: 675, width: 920, text: '→  Vague communication = mixed signals\n→  Hidden emotions = unnecessary conflict', fontSize: 30, fontWeight: '400', fill: '#94a3b8', lineHeight: 1.5 }),
          // CTA box
          rectObj({ left: 80, top: 810, width: 920, height: 90, fill: 'rgba(59,130,246,0.15)', rx: 12, ry: 12 }),
          textObj({ left: 80, top: 832, width: 920, text: 'Clarity Builds Confidence.', fontSize: 34, fontWeight: '700', fill: '#93c5fd', textAlign: 'center' }),
          // footer text
          textObj({ left: 80, top: 960, width: 920, text: 'Whether you\'re showing a product or sharing feelings,\nmake it clear, not clever.', fontSize: 26, fontWeight: '400', fill: '#475569', lineHeight: 1.4, textAlign: 'center' }),
        ],
      },
    },
  },

  // 4 ── Simplicity Wins ──────────────────────────────────────────────────────
  {
    name: 'Simplicity Wins',
    description: 'Deep blue-to-black gradient with minimal centered typography.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1350,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#0ea5e9', '#020617', 180, 1080, 1350),
        objects: [
          // logo placeholder
          textObj({ left: 400, top: 80, width: 280, text: 'in', fontSize: 64, fontWeight: '900', fill: '#ffffff', textAlign: 'center' }),
          // headline
          textObj({ left: 80, top: 460, width: 920, text: 'Why simplicity\nwins in design', fontSize: 96, fontWeight: '300', fill: '#ffffff', lineHeight: 1.1, textAlign: 'center' }),
          // italic accent
          textObj({ left: 80, top: 560, width: 920, text: 'simplicity\nwins in design', fontSize: 96, fontWeight: '300', fill: '#f0f9ff', fontStyle: 'italic', lineHeight: 1.1, textAlign: 'center' }),
          // sub text
          textObj({ left: 80, top: 810, width: 920, text: '(and it\'s not for the reason you think)', fontSize: 28, fontWeight: '300', fill: 'rgba(255,255,255,0.5)', textAlign: 'center' }),
          // circle button
          rectObj({ left: 440, top: 920, width: 200, height: 80, fill: 'rgba(255,255,255,0.1)', rx: 40, ry: 40 }),
          textObj({ left: 440, top: 934, width: 200, text: '→', fontSize: 36, fontWeight: '400', fill: '#ffffff', textAlign: 'center' }),
          // footer
          textObj({ left: 80, top: 1290, width: 400, text: 'IZAZ MAHAMMAD', fontSize: 22, fontWeight: '700', fill: 'rgba(255,255,255,0.4)' }),
          textObj({ left: 600, top: 1290, width: 400, text: 'BRAND & DESIGN STRATEGIST', fontSize: 22, fontWeight: '400', fill: 'rgba(255,255,255,0.4)', textAlign: 'right' }),
        ],
      },
    },
  },

  // 5 ── 5 Content Pillars ────────────────────────────────────────────────────
  {
    name: '5 Content Pillars',
    description: 'Numbered list carousel card — great for sharing frameworks and top tips.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#1e3a5f', '#0f172a', 145),
        objects: [
          rectObj({ left: 0, top: 0, width: 1080, height: 10, fill: '#f59e0b', rx: 0 }),
          textObj({ left: 80, top: 60, width: 920, text: '5 CONTENT PILLARS', fontSize: 28, fontWeight: '800', fill: '#f59e0b', charSpacing: 200 }),
          textObj({ left: 80, top: 110, width: 920, text: 'Every Brand Needs', fontSize: 88, fontWeight: '900', fill: '#ffffff', lineHeight: 1.05 }),
          // pillar rows
          ...(['Education', 'Entertainment', 'Inspiration', 'Promotion', 'Connection'] as const).flatMap((label, i) => [
            rectObj({ left: 80, top: 310 + i * 130, width: 920, height: 110, fill: 'rgba(255,255,255,0.05)', rx: 16, ry: 16 }),
            textObj({ left: 110, top: 325 + i * 130, width: 80, text: `0${i + 1}`, fontSize: 32, fontWeight: '800', fill: '#f59e0b' }),
            textObj({ left: 210, top: 335 + i * 130, width: 760, text: label, fontSize: 38, fontWeight: '700', fill: '#ffffff' }),
          ]),
        ].filter(Boolean),
      },
    },
  },

  // 6 ── Brand Building Basics ────────────────────────────────────────────────
  {
    name: 'Brand Building Basics',
    description: 'Red brand-color gradient card for motivational quotes and key brand messages.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#e6332a', '#7f1d1d', 135),
        objects: [
          // large quote mark
          textObj({ left: 60, top: 60, width: 200, text: '\u201c', fontSize: 200, fontWeight: '900', fill: 'rgba(255,255,255,0.15)' }),
          // quote text
          textObj({ left: 80, top: 220, width: 920, text: 'Your brand is\nwhat people say\nabout you when\nyou\'re not in\nthe room.', fontSize: 76, fontWeight: '800', fill: '#ffffff', lineHeight: 1.1 }),
          // attribution
          textObj({ left: 80, top: 830, width: 920, text: '— Jeff Bezos', fontSize: 36, fontWeight: '400', fill: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }),
          // divider
          rectObj({ left: 80, top: 900, width: 920, height: 2, fill: 'rgba(255,255,255,0.2)', rx: 1 }),
          // brand
          textObj({ left: 80, top: 940, width: 920, text: 'BRAND BUILDING BASICS', fontSize: 24, fontWeight: '700', fill: 'rgba(255,255,255,0.5)', charSpacing: 180, textAlign: 'center' }),
        ],
      },
    },
  },

  // 7 ── Social Media Tip ─────────────────────────────────────────────────────
  {
    name: 'Social Media Tip of the Day',
    description: 'Dark teal gradient with a bold "Tip #" format for daily social media advice.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#0f4c5c', '#031926', 150),
        objects: [
          rectObj({ left: 80, top: 80, width: 300, height: 60, fill: '#14b8a6', rx: 30, ry: 30 }),
          textObj({ left: 80, top: 94, width: 300, text: 'TIP #7', fontSize: 26, fontWeight: '800', fill: '#ffffff', textAlign: 'center', charSpacing: 150 }),
          textObj({ left: 80, top: 200, width: 920, text: 'Post at the\nRight Time,\nNot Just Often.', fontSize: 96, fontWeight: '900', fill: '#ffffff', lineHeight: 1.05 }),
          textObj({ left: 80, top: 590, width: 920, text: 'Consistency matters — but timing is everything.\nAnalyze when your audience is most active and\nschedule your posts around those windows.', fontSize: 34, fontWeight: '400', fill: '#94a3b8', lineHeight: 1.5 }),
          rectObj({ left: 80, top: 880, width: 920, height: 2, fill: 'rgba(20,184,166,0.3)', rx: 1 }),
          textObj({ left: 80, top: 910, width: 920, text: 'Follow for daily marketing tips', fontSize: 28, fontWeight: '500', fill: '#14b8a6', textAlign: 'center' }),
        ],
      },
    },
  },

  // 8 ── Content Creation Framework ──────────────────────────────────────────
  {
    name: 'Content Creation Framework',
    description: 'Sophisticated dark gradient with a 3-step visual framework layout.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#18181b', '#09090b', 180),
        objects: [
          textObj({ left: 80, top: 80, width: 920, text: 'CONTENT CREATION', fontSize: 24, fontWeight: '700', fill: '#52525b', charSpacing: 200 }),
          textObj({ left: 80, top: 130, width: 920, text: 'The 3-Step\nFramework', fontSize: 100, fontWeight: '900', fill: '#ffffff', lineHeight: 1.0 }),
          // step cards
          rectObj({ left: 80, top: 390, width: 260, height: 500, fill: 'rgba(255,255,255,0.04)', rx: 20, ry: 20 }),
          rectObj({ left: 400, top: 390, width: 260, height: 500, fill: 'rgba(99,102,241,0.15)', rx: 20, ry: 20 }),
          rectObj({ left: 720, top: 390, width: 260, height: 500, fill: 'rgba(255,255,255,0.04)', rx: 20, ry: 20 }),
          // step numbers
          textObj({ left: 80, top: 420, width: 260, text: '01', fontSize: 56, fontWeight: '900', fill: '#3f3f46', textAlign: 'center' }),
          textObj({ left: 400, top: 420, width: 260, text: '02', fontSize: 56, fontWeight: '900', fill: '#6366f1', textAlign: 'center' }),
          textObj({ left: 720, top: 420, width: 260, text: '03', fontSize: 56, fontWeight: '900', fill: '#3f3f46', textAlign: 'center' }),
          // step labels
          textObj({ left: 80, top: 510, width: 260, text: 'Ideate', fontSize: 36, fontWeight: '700', fill: '#71717a', textAlign: 'center' }),
          textObj({ left: 400, top: 510, width: 260, text: 'Create', fontSize: 36, fontWeight: '700', fill: '#a5b4fc', textAlign: 'center' }),
          textObj({ left: 720, top: 510, width: 260, text: 'Distribute', fontSize: 36, fontWeight: '700', fill: '#71717a', textAlign: 'center' }),
          // descriptions
          textObj({ left: 80, top: 570, width: 260, text: 'Research your audience and map pain points', fontSize: 22, fontWeight: '400', fill: '#52525b', textAlign: 'center', lineHeight: 1.4 }),
          textObj({ left: 400, top: 570, width: 260, text: 'Write, design, and edit high-quality content', fontSize: 22, fontWeight: '400', fill: '#818cf8', textAlign: 'center', lineHeight: 1.4 }),
          textObj({ left: 720, top: 570, width: 260, text: 'Schedule across channels at optimal times', fontSize: 22, fontWeight: '400', fill: '#52525b', textAlign: 'center', lineHeight: 1.4 }),
          // footer
          textObj({ left: 80, top: 960, width: 920, text: 'Repeat. Refine. Grow.', fontSize: 30, fontWeight: '700', fill: '#6366f1', textAlign: 'center' }),
        ],
      },
    },
  },

  // 9 ── Business Growth Mindset ──────────────────────────────────────────────
  {
    name: 'Business Growth Mindset',
    description: 'Emerald green accent on dark — a powerful quote-style card for entrepreneurs.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#052e16', '#020617', 160),
        objects: [
          // glow circle (decorative)
          {
            type: 'circle', version: '5.3.0', originX: 'center', originY: 'center',
            left: 840, top: 200, radius: 300, fill: 'rgba(16,185,129,0.06)',
            stroke: null, strokeWidth: 0, opacity: 1, selectable: true, evented: true,
            angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, visible: true,
          },
          rectObj({ left: 0, top: 0, width: 10, height: 1080, fill: '#10b981', rx: 0 }),
          textObj({ left: 80, top: 100, width: 920, text: 'GROWTH\nMINDSET', fontSize: 108, fontWeight: '900', fill: '#ffffff', lineHeight: 1.0, charSpacing: -20 }),
          textObj({ left: 80, top: 430, width: 920, text: 'Success isn\'t about working harder —\nit\'s about working with clarity,\npurpose, and the right strategy.', fontSize: 40, fontWeight: '300', fill: '#6ee7b7', lineHeight: 1.5 }),
          rectObj({ left: 80, top: 720, width: 920, height: 2, fill: 'rgba(16,185,129,0.3)', rx: 1 }),
          textObj({ left: 80, top: 760, width: 250, text: '3x', fontSize: 72, fontWeight: '900', fill: '#10b981' }),
          textObj({ left: 80, top: 844, width: 250, text: 'Revenue\nGrowth', fontSize: 26, fontWeight: '500', fill: '#6ee7b7', lineHeight: 1.3 }),
          textObj({ left: 400, top: 760, width: 250, text: '10x', fontSize: 72, fontWeight: '900', fill: '#10b981' }),
          textObj({ left: 400, top: 844, width: 250, text: 'Audience\nReach', fontSize: 26, fontWeight: '500', fill: '#6ee7b7', lineHeight: 1.3 }),
          textObj({ left: 730, top: 760, width: 250, text: '#1', fontSize: 72, fontWeight: '900', fill: '#10b981' }),
          textObj({ left: 730, top: 844, width: 250, text: 'Brand\nPositioning', fontSize: 26, fontWeight: '500', fill: '#6ee7b7', lineHeight: 1.3 }),
          textObj({ left: 80, top: 1010, width: 920, text: 'Start your journey today', fontSize: 28, fontWeight: '400', fill: '#047857', textAlign: 'center' }),
        ],
      },
    },
  },

  // 10 ── Professional Profile Card ──────────────────────────────────────────
  {
    name: 'Professional Profile Card',
    description: 'Clean dark card for personal branding — name, title, and contact details.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: linearGradBg('#1c1c27', '#0d0d14', 180),
        objects: [
          // top accent
          rectObj({ left: 0, top: 0, width: 1080, height: 6, fill: '#6366f1', rx: 0 }),
          // avatar circle placeholder
          {
            type: 'circle', version: '5.3.0', originX: 'center', originY: 'center',
            left: 540, top: 240, radius: 130, fill: '#1e1e2e',
            stroke: '#6366f1', strokeWidth: 4, opacity: 1, selectable: true, evented: true,
            angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, visible: true,
          },
          textObj({ left: 390, top: 174, width: 300, text: 'JD', fontSize: 72, fontWeight: '700', fill: '#a5b4fc', textAlign: 'center' }),
          // name
          textObj({ left: 80, top: 420, width: 920, text: 'Jane Doe', fontSize: 72, fontWeight: '900', fill: '#ffffff', textAlign: 'center' }),
          // title
          textObj({ left: 80, top: 510, width: 920, text: 'Brand & Content Strategist', fontSize: 34, fontWeight: '400', fill: '#a78bfa', textAlign: 'center' }),
          // divider
          rectObj({ left: 340, top: 590, width: 400, height: 2, fill: 'rgba(99,102,241,0.3)', rx: 1 }),
          // stats
          textObj({ left: 80, top: 640, width: 260, text: '5+', fontSize: 60, fontWeight: '900', fill: '#6366f1', textAlign: 'center' }),
          textObj({ left: 80, top: 710, width: 260, text: 'Years\nExperience', fontSize: 24, fontWeight: '400', fill: '#94a3b8', textAlign: 'center', lineHeight: 1.3 }),
          textObj({ left: 400, top: 640, width: 260, text: '200+', fontSize: 60, fontWeight: '900', fill: '#6366f1', textAlign: 'center' }),
          textObj({ left: 400, top: 710, width: 260, text: 'Brands\nHelped', fontSize: 24, fontWeight: '400', fill: '#94a3b8', textAlign: 'center', lineHeight: 1.3 }),
          textObj({ left: 720, top: 640, width: 260, text: '2M+', fontSize: 60, fontWeight: '900', fill: '#6366f1', textAlign: 'center' }),
          textObj({ left: 720, top: 710, width: 260, text: 'Content\nViews', fontSize: 24, fontWeight: '400', fill: '#94a3b8', textAlign: 'center', lineHeight: 1.3 }),
          // contact
          rectObj({ left: 80, top: 840, width: 920, height: 90, fill: 'rgba(99,102,241,0.1)', rx: 20, ry: 20 }),
          textObj({ left: 80, top: 862, width: 920, text: 'hello@janedoe.com  ·  @janedoe  ·  janedoe.com', fontSize: 26, fontWeight: '500', fill: '#a5b4fc', textAlign: 'center' }),
          // tagline
          textObj({ left: 80, top: 975, width: 920, text: 'Building brands that people remember.', fontSize: 28, fontWeight: '300', fill: '#52525b', textAlign: 'center', fontStyle: 'italic' }),
        ],
      },
    },
  },

  // 11 ── The 80/20 Rule ─────────────────────────────────────────────────────
  {
    name: 'The 80/20 Content Rule',
    description: 'Bold orange accent card explaining the content value vs promotion ratio.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: '#111111',
        objects: [
          // large background number
          textObj({ left: -40, top: 200, width: 700, text: '80', fontSize: 600, fontWeight: '900', fill: 'rgba(249,115,22,0.06)', textAlign: 'left' }),
          rectObj({ left: 0, top: 0, width: 8, height: 1080, fill: '#f97316', rx: 0 }),
          textObj({ left: 80, top: 80, width: 920, text: 'THE CONTENT RULE', fontSize: 26, fontWeight: '700', fill: '#f97316', charSpacing: 200 }),
          textObj({ left: 80, top: 140, width: 920, text: '80/20', fontSize: 180, fontWeight: '900', fill: '#ffffff', lineHeight: 1.0 }),
          // split explanation
          rectObj({ left: 80, top: 380, width: 440, height: 220, fill: 'rgba(249,115,22,0.1)', rx: 16, ry: 16 }),
          textObj({ left: 80, top: 400, width: 440, text: '80%', fontSize: 64, fontWeight: '900', fill: '#f97316', textAlign: 'center' }),
          textObj({ left: 80, top: 475, width: 440, text: 'VALUE\nEDUCATE & ENTERTAIN', fontSize: 26, fontWeight: '600', fill: '#fdba74', textAlign: 'center', lineHeight: 1.3 }),
          rectObj({ left: 560, top: 380, width: 440, height: 220, fill: 'rgba(255,255,255,0.04)', rx: 16, ry: 16 }),
          textObj({ left: 560, top: 400, width: 440, text: '20%', fontSize: 64, fontWeight: '900', fill: '#64748b', textAlign: 'center' }),
          textObj({ left: 560, top: 475, width: 440, text: 'PROMOTION\nSELL & CONVERT', fontSize: 26, fontWeight: '600', fill: '#475569', textAlign: 'center', lineHeight: 1.3 }),
          // body
          textObj({ left: 80, top: 650, width: 920, text: 'Most brands do the opposite.\nFlip the ratio — watch your engagement soar.', fontSize: 36, fontWeight: '400', fill: '#94a3b8', lineHeight: 1.5 }),
          // divider
          rectObj({ left: 80, top: 860, width: 920, height: 2, fill: 'rgba(249,115,22,0.2)', rx: 1 }),
          textObj({ left: 80, top: 900, width: 920, text: 'FOLLOW FOR CONTENT STRATEGY', fontSize: 24, fontWeight: '700', fill: '#f97316', textAlign: 'center', charSpacing: 150 }),
        ],
      },
    },
  },

  // 12 ── Aesthetic Minimal Quote ─────────────────────────────────────────────
  {
    name: 'Aesthetic Minimal Quote',
    description: 'Clean beige/cream minimal quote card perfect for lifestyle and wellness brands.',
    designData: {
      fabricVersion: true,
      canvasWidth: 1080,
      canvasHeight: 1080,
      fabricJson: {
        version: '5.3.0',
        background: '#faf9f6',
        objects: [
          rectObj({ left: 80, top: 80, width: 920, height: 920, fill: 'rgba(0,0,0,0)', rx: 0, stroke: '#d4c5a9', strokeWidth: 2 }),
          textObj({ left: 120, top: 160, width: 840, text: '\u201c', fontSize: 160, fontWeight: '300', fill: '#d4c5a9' }),
          textObj({ left: 120, top: 260, width: 840, text: 'The best marketing\ndoesn\'t feel like\nmarketing.', fontSize: 68, fontWeight: '300', fill: '#1a1a1a', lineHeight: 1.2, textAlign: 'center', fontStyle: 'italic' }),
          textObj({ left: 120, top: 700, width: 840, text: '— Tom Fishburne', fontSize: 32, fontWeight: '400', fill: '#a89070', textAlign: 'center' }),
          rectObj({ left: 340, top: 790, width: 400, height: 1, fill: '#d4c5a9', rx: 0 }),
          textObj({ left: 120, top: 830, width: 840, text: 'CREATIVE MINDS COLLECTIVE', fontSize: 20, fontWeight: '700', fill: '#c8b59a', textAlign: 'center', charSpacing: 250 }),
        ],
      },
    },
  },
];

// ── JSON export (paste this into the Import JSON modal) ────────────────────────
export const SAMPLE_TEMPLATES_JSON = JSON.stringify(
  SAMPLE_TEMPLATES,
  null,
  2,
);
