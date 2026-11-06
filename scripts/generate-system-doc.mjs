import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  TableLayoutType, ShadingType, PageBreak, UnderlineType
} from 'docx';
import { writeFileSync } from 'fs';

// ── Helpers ──────────────────────────────────────────────────────────────────

function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 36, color: '111827' })],
    spacing: { before: 480, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB', space: 4 } },
  });
}
function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, color: '1f2937' })],
    spacing: { before: 320, after: 160 },
  });
}
function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: '374151' })],
    spacing: { before: 200, after: 80 },
  });
}

function p(runs) {
  if (typeof runs === 'string') {
    return new Paragraph({
      children: [new TextRun({ text: runs, size: 22, color: '374151' })],
      spacing: { before: 60, after: 60 },
    });
  }
  return new Paragraph({ children: runs, spacing: { before: 60, after: 60 } });
}

function bold(text, color = '111827') {
  return new TextRun({ text, bold: true, size: 22, color });
}
function normal(text) {
  return new TextRun({ text, size: 22, color: '374151' });
}
function tag(text) {
  // simulate a pill/badge in text
  return new TextRun({ text: ` [${text}] `, size: 18, color: '5b6cf9', bold: true });
}

function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, color: '374151' })],
    bullet: { level },
    spacing: { before: 40, after: 40 },
  });
}

function blank() {
  return new Paragraph({ text: '', spacing: { before: 80, after: 80 } });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function cell(text, opts = {}) {
  const { bold: isBold = false, shade = false, header = false, color } = opts;
  const fill = header ? '5b6cf9' : shade ? 'F3F4F6' : 'FFFFFF';
  const textColor = header ? 'FFFFFF' : (color || '111827');
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold: isBold || header, size: 20, color: textColor })],
      spacing: { before: 60, after: 60 },
    })],
    shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
  });
}

function table(headers, rows) {
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map(h => cell(h, { header: true })),
        tableHeader: true,
      }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((c, ci) => cell(c, { bold: ci === 0, shade: ri % 2 === 1 })),
        })
      ),
    ],
    borders: {
      top:      { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      bottom:   { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      left:     { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      right:    { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideH:  { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideV:  { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    },
  });
}

// ── Document ─────────────────────────────────────────────────────────────────

const doc = new Document({
  sections: [{
    properties: {
      page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
    },
    children: [

      // ── Cover ───────────────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: 'Dakyworld Hub', bold: true, size: 64, color: '5b6cf9' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 800, after: 120 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Platform System Document', bold: true, size: 40, color: '111827' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Features · Workflows · Architecture · User Roles', size: 24, color: '6B7280', italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Version 1.0  |  May 2026  |  Internal', size: 20, color: '9CA3AF' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 1200 },
      }),

      // ── Table of Contents (manual) ───────────────────────────────────────
      h1('Contents'),
      p('1.  Platform Overview'),
      p('2.  Technology Stack'),
      p('3.  User Roles & Permissions'),
      p('4.  Credit System'),
      p('5.  Core Features by Module'),
      p('    5.1  Dashboard'),
      p('    5.2  Posts'),
      p('    5.3  Post Automation'),
      p('    5.4  AI Studio (Cards)'),
      p('    5.5  Media Library'),
      p('    5.6  Analytics'),
      p('    5.7  Integrations'),
      p('    5.8  Mailing'),
      p('    5.9  Campaigns'),
      p('    5.10 Workspace & Tasks'),
      p('    5.11 Memory'),
      p('    5.12 Settings & Billing'),
      p('6.  Nova Design Agent Workflow'),
      p('7.  Admin Panel'),
      p('8.  Key Workflows (step-by-step)'),
      p('9.  Authentication'),
      p('10. API Architecture Summary'),

      pageBreak(),

      // ── 1. Platform Overview ─────────────────────────────────────────────
      h1('1. Platform Overview'),
      p('Dakyworld Hub is a multi-tenant SaaS platform that combines AI-powered content creation, social media management, and design tools into a single workspace. Users manage their social accounts, create posts, generate AI images and videos, build design cards, run email campaigns, and track analytics — all from one dashboard.'),
      blank(),
      p([bold('Core value proposition: '), normal('Replace 4–6 disconnected tools (Canva + Buffer + Mailchimp + Jasper + Analytics) with one workspace, powered by Magnific AI image/video generation and a Nova AI design agent.')]),
      blank(),
      table(
        ['Dimension', 'Detail'],
        [
          ['Target users', 'Solopreneurs, social media managers, small agencies'],
          ['Deployment', 'Cloud SaaS — Railway / Render (backend), Vercel (frontend)'],
          ['Database', 'PostgreSQL (single pool, pg library)'],
          ['AI backbone', 'Magnific AI (images + video + editing) · Claude 3 (Nova agent & text)'],
          ['Auth', 'JWT (email/password) + OAuth (Google, Facebook, GitHub)'],
          ['Payments', 'Hubtel (primary), Stripe webhooks (secondary)'],
          ['Social integrations', 'Facebook, Instagram, Pinterest, WordPress, Mailchimp'],
        ]
      ),

      pageBreak(),

      // ── 2. Technology Stack ──────────────────────────────────────────────
      h1('2. Technology Stack'),

      h2('Frontend'),
      table(
        ['Layer', 'Technology'],
        [
          ['Framework', 'React 18 + TypeScript'],
          ['Build tool', 'Vite'],
          ['Styling', 'Tailwind CSS'],
          ['Routing', 'Custom pushState SPA (no React Router) — App.tsx manages all pages'],
          ['Canvas / Design', 'Fabric.js v5'],
          ['Charts', 'Recharts'],
          ['Rich text', 'Tiptap'],
          ['Screenshot / Export', 'html2canvas'],
        ]
      ),
      blank(),

      h2('Backend'),
      table(
        ['Layer', 'Technology'],
        [
          ['Runtime', 'Node.js 24'],
          ['Framework', 'Express 5'],
          ['Database', 'PostgreSQL via pg (connection pool)'],
          ['Auth tokens', 'jsonwebtoken (JWT, 7-day expiry)'],
          ['File uploads', 'Multer'],
          ['AI requests', 'axios to Magnific API & Claude API (Anthropic SDK)'],
          ['Streaming', 'SSE (Server-Sent Events) for Nova workflow'],
          ['Scheduling', 'node-cron (post automation, credit resets)'],
        ]
      ),

      pageBreak(),

      // ── 3. User Roles ────────────────────────────────────────────────────
      h1('3. User Roles & Permissions'),
      p('Every user belongs to a plan tier. Roles control which features are visible and how many credits are available.'),
      blank(),
      table(
        ['Role', 'Plan', 'Credits / mo', 'AI Models', 'Social Accounts', 'Seats'],
        [
          ['Free', 'Free', '100 cr', 'Text generation only', '2', '1'],
          ['Pro', 'Pro', '2,000 cr', '6 image models', '8', '3'],
          ['Agency', 'Agency', '6,000 cr', 'Image + Video + Editing', 'Unlimited', '10'],
          ['Admin', 'N/A', 'Unlimited', 'All', 'All', 'All'],
        ]
      ),
      blank(),
      h2('Admin Role'),
      p('Admins have a separate /admin section with full platform control — user management, billing, AI configuration, content moderation, and platform settings. Admins are identified by the role = \'admin\' field on the users table.'),

      pageBreak(),

      // ── 4. Credit System ─────────────────────────────────────────────────
      h1('4. Credit System'),
      p('Credits are the internal currency that gates AI usage. Every AI generation, edit, and text action deducts from the user\'s balance. Credits reset monthly based on the user\'s active plan.'),
      blank(),
      h2('Credit Costs'),
      table(
        ['Action', 'Credits Deducted', 'Plan Required'],
        [
          ['AI text generation (post)', '1 cr', 'Free+'],
          ['Image — Flux 2 Turbo (fast)', '3 cr', 'Pro+'],
          ['Image — Flux 2 Klein (fast)', '3 cr', 'Pro+'],
          ['Image — Seedream v5 Lite', '4 cr', 'Pro+'],
          ['Image — Flux Kontext Pro', '5 cr', 'Pro+'],
          ['Image — Flux 2 Pro', '5 cr', 'Pro+'],
          ['Image — Mystic (flagship)', '8 cr', 'Pro+'],
          ['Image editing (upscale, relight, style, remove-bg)', '1–5 cr', 'Agency'],
          ['Video — Happy Horse (image-to-video)', '20 cr', 'Agency'],
          ['Video — WAN 2.7 (text-to-video)', '25 cr', 'Agency'],
          ['Video — Kling 3 Pro (premium)', '35 cr', 'Agency'],
          ['Improve Prompt (wand button)', '1 cr', 'Pro+'],
        ]
      ),
      blank(),
      h2('Credit Lifecycle'),
      bullet('On signup: 100 credits granted (Free plan)'),
      bullet('Monthly reset: cron job resets credits to plan allowance on the 1st of each month'),
      bullet('Admin grant: admins can manually add credits to any user'),
      bullet('Insufficient credits: generation blocked, user prompted to upgrade'),

      pageBreak(),

      // ── 5. Core Features ─────────────────────────────────────────────────
      h1('5. Core Features by Module'),

      // 5.1 Dashboard
      h2('5.1  Dashboard'),
      p('The entry point after login. Shows a real-time snapshot of the user\'s activity.'),
      blank(),
      table(
        ['Widget', 'Description'],
        [
          ['Credit balance', 'Current credits remaining + plan limit — with a visual bar'],
          ['Recent posts', 'Last 5 posts with platform icons and status (published/draft/scheduled)'],
          ['Analytics summary', 'Total reach, engagement, and follower count across connected accounts'],
          ['Connected accounts', 'Quick view of linked social platforms'],
          ['Onboarding checklist', 'Step-by-step wizard for new users (connect account, create post, etc.)'],
          ['Quick actions', 'Shortcut buttons — New Post, Generate Image, Open AI Studio'],
        ]
      ),

      // 5.2 Posts
      blank(),
      h2('5.2  Posts'),
      p('The main content creation hub. Users write, design, and publish posts to connected platforms.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Rich text editor', 'Tiptap-powered editor — headings, bold, lists, links, emoji'],
          ['AI text generation', 'Generate post copy from a topic/prompt — deducts 1 credit'],
          ['Platform-specific preview', 'Live mock-up for Facebook, Instagram, Twitter/X, LinkedIn, Pinterest'],
          ['Image attachment', 'Upload from device or pick from Media Library'],
          ['Multi-platform publishing', 'Publish to all connected accounts simultaneously or selectively'],
          ['Schedule', 'Set a future date/time — cron job publishes at the right moment'],
          ['Draft manager', 'Save and resume drafts; never lose work'],
          ['SEO score badge', 'Rates post text for SEO keywords and readability'],
          ['Social repost', 'Re-publish an existing post to other platforms with one click'],
          ['Social templates', 'Pre-written templates per platform for fast posting'],
        ]
      ),

      // 5.3 Post Automation
      blank(),
      h2('5.3  Post Automation'),
      p('Rules-based automation that posts content on a recurring schedule without manual intervention.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Rule builder', 'Define: platform, frequency, content type, time window'],
          ['AI content generation', 'Each automated post can be AI-generated from a topic prompt'],
          ['Scheduling engine', 'node-cron checks for due automation rules every minute'],
          ['Pause / Resume', 'Toggle individual automations on/off'],
          ['History log', 'Full audit trail of every automated post with status'],
          ['Media rotation', 'Optionally rotate through a media library folder for images'],
        ]
      ),

      // 5.4 AI Studio
      blank(),
      h2('5.4  AI Studio  (Cards)'),
      p('The creative hub for generating and editing visual content. Built around the Magnific AI API.'),
      blank(),
      h3('Three Tabs'),
      table(
        ['Tab', 'Purpose'],
        [
          ['Studio', 'Nova Design Agent — describe a design in plain English, AI builds it step-by-step (SSE streaming)'],
          ['Discover', 'Browse and remix community card templates + inline GeneratePanel for quick generation'],
          ['History', 'All previous AI generations for the user — thumbnail grid with download/re-use'],
        ]
      ),
      blank(),
      h3('Studio Tab — Nova Design Agent'),
      p('The Nova Agent takes a plain-English design brief and executes a multi-step workflow streamed live via Server-Sent Events (SSE):'),
      blank(),
      table(
        ['Step', 'What Happens'],
        [
          ['1. understand_brief', 'Claude reads the brief and extracts design intent, audience, platform'],
          ['2. generate_concepts', 'Claude produces 3 design concepts with color palettes and typography'],
          ['3. select_best_concept', 'Claude scores each concept and picks the strongest'],
          ['4. craft_prompt', 'Claude writes a detailed Magnific image prompt from the concept'],
          ['5. generate_image', 'Magnific API call — Flux 2 Turbo (default) — async task polling'],
          ['6. finalize', 'Result assembled: image + design brief + concept rationale returned'],
        ]
      ),
      blank(),
      h3('Discover Tab — GeneratePanel'),
      table(
        ['Control', 'Description'],
        [
          ['Mode toggle', 'Generate mode (text-to-image) or Edit mode (tools on existing image)'],
          ['Prompt textarea', 'Write your own prompt or use Improve Prompt (wand icon)'],
          ['Improve Prompt', 'Calls Magnific improve-prompt API, replaces textarea with enhanced version'],
          ['Model selector', 'Grouped by tier: Fast / Quality / Premium — shows credit cost per model'],
          ['Aspect ratio', 'Square, Landscape (16:9), Portrait (9:16), Widescreen'],
          ['Reference image', 'Upload an image the model uses as a style or composition reference'],
          ['Generate button', 'Triggers async generation — live loading indicator'],
          ['Edit mode', 'Upload an image, then apply editing tools (see below)'],
        ]
      ),
      blank(),
      h3('Image Models Available'),
      table(
        ['Tier', 'Model ID', 'Label', 'Credits', 'Best For'],
        [
          ['Fast', 'flux-2-turbo', 'Flux 2 Turbo', '3 cr', 'Quick drafts'],
          ['Fast', 'flux-2-klein', 'Flux 2 Klein', '3 cr', 'Reference-based'],
          ['Fast', 'seedream-v5-lite', 'Seedream 5 Lite', '4 cr', 'High coherence'],
          ['Quality', 'flux-kontext-pro', 'Flux Kontext Pro', '5 cr', 'Context-aware edits'],
          ['Quality', 'flux-2-pro', 'Flux 2 Pro', '5 cr', 'General quality'],
          ['Premium', 'mystic', 'Mystic', '8 cr', 'Best output quality'],
        ]
      ),
      blank(),
      h3('Video Models Available'),
      table(
        ['Model ID', 'Label', 'Credits', 'Type'],
        [
          ['wan-2-7-t2v', 'WAN 2.7', '25 cr', 'Text-to-video'],
          ['happy-horse-i2v', 'Happy Horse', '20 cr', 'Image-to-video'],
          ['kling-3-pro', 'Kling 3 Pro', '35 cr', 'Premium video'],
        ]
      ),
      blank(),
      h3('Edit Tools (Edit Mode) — Agency Plan'),
      table(
        ['Tool', 'What It Does', 'Credits'],
        [
          ['Upscale', 'Increase resolution 2×/4×/8× with AI detail reconstruction', '2–5 cr'],
          ['Relight', 'Change lighting direction, style, and background via a text prompt', '3 cr'],
          ['Style Transfer', 'Apply the style of a reference image onto the source image', '4 cr'],
          ['Remove Background', 'Instantly removes background — returns transparent PNG (synchronous)', '1 cr'],
        ]
      ),
      blank(),
      h3('Card Templates (Discover Tab)'),
      p('Admin-created templates displayed in a Midjourney-style masonry grid. Each card shows a cover image, title, model badge, and like count. Users can:'),
      bullet('View full template details'),
      bullet('Open the GeneratePanel pre-seeded with the template prompt'),
      bullet('Use as a reference image for their own generation'),
      bullet('Like / save templates'),

      // 5.5 Media Library
      blank(),
      h2('5.5  Media Library'),
      p('Centralised file storage for all user-uploaded and AI-generated images and videos.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Upload', 'Drag-and-drop or file picker — images and videos'],
          ['AI auto-tagging', 'Optional: Claude Vision adds descriptive tags on upload'],
          ['Folders / categories', 'Organise media into named folders'],
          ['Search', 'Full-text search across file names and tags'],
          ['Bulk actions', 'Delete or move multiple files at once'],
          ['Post picker', 'Media appears in the attachment picker when composing a post'],
          ['Admin controls', 'Admins can view all user media, set storage quotas, delete files'],
        ]
      ),

      // 5.6 Analytics
      blank(),
      h2('5.6  Analytics'),
      p('Aggregated performance data pulled from connected social platforms.'),
      blank(),
      table(
        ['Metric', 'Source'],
        [
          ['Impressions / Reach', 'Facebook Graph API, Instagram Insights'],
          ['Engagement rate', 'Calculated: (likes + comments + shares) / reach'],
          ['Follower growth', 'Delta between current and previous stored count'],
          ['Post performance table', 'Top posts sorted by engagement'],
          ['Platform breakdown chart', 'Recharts bar/line chart per platform'],
          ['Date range filter', '7d / 30d / 90d / custom'],
        ]
      ),

      // 5.7 Integrations
      blank(),
      h2('5.7  Integrations'),
      p('Native connections to social platforms and third-party services.'),
      blank(),
      table(
        ['Integration', 'Type', 'Capabilities'],
        [
          ['Facebook', 'OAuth 2.0', 'Publish posts, page insights, post insights, token refresh'],
          ['Instagram', 'Facebook Graph', 'Publish feed posts, story previews, insights'],
          ['Pinterest', 'OAuth 2.0', 'Create pins, manage boards'],
          ['WordPress', 'REST API + Webhook', 'Publish posts, manage categories/tags/media'],
          ['Mailchimp', 'OAuth 2.0', 'Sync audiences, send campaigns'],
          ['Google (OAuth)', 'OIDC', 'Sign-in only (no posting)'],
          ['GitHub (OAuth)', 'OAuth 2.0', 'Sign-in only'],
        ]
      ),

      // 5.8 Mailing
      blank(),
      h2('5.8  Mailing'),
      p('In-app email campaign builder — drafts, sends, and tracks email newsletters.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Template editor', 'Tiptap-based rich-text email editor with placeholder variables'],
          ['Subscriber list', 'Upload CSV or sync from Mailchimp'],
          ['Send / Schedule', 'Send immediately or schedule for a future date-time'],
          ['Open & click tracking', 'Pixel tracking and link wrapping (optional)'],
          ['Campaign stats', 'Sent count, open rate, click rate per campaign'],
        ]
      ),

      // 5.9 Campaigns
      blank(),
      h2('5.9  Campaigns'),
      p('Multi-channel campaign planner linking posts, emails, and funnel steps into a single campaign object.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Campaign builder', 'Create named campaign with start/end date and goal'],
          ['Funnel steps', 'Ordered sequence of actions (post → email → wait → post)'],
          ['Step types', 'Social post, email blast, delay, webhook'],
          ['Progress tracker', 'Visual timeline of completed vs. pending steps'],
          ['Analytics roll-up', 'Combined reach and engagement across all campaign posts'],
        ]
      ),

      // 5.10 Workspace & Tasks
      blank(),
      h2('5.10  Workspace & Tasks'),
      p('Team collaboration layer for multi-seat plans.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Workspace settings', 'Rename workspace, upload logo, set default timezone'],
          ['Member invitations', 'Invite by email — accept via /accept-invite link'],
          ['Roles within workspace', 'Owner · Editor · Viewer (per-workspace)'],
          ['Task board', 'Kanban-style tasks with status: To Do / In Progress / Done'],
          ['Task assignment', 'Assign tasks to workspace members'],
          ['Project settings', 'Connect a workspace to a specific social account set'],
        ]
      ),

      // 5.11 Memory
      blank(),
      h2('5.11  Memory'),
      p('A user-facing "AI memory" store — a persistent context layer that the Nova agent can read to stay consistent across sessions.'),
      blank(),
      table(
        ['Feature', 'Description'],
        [
          ['Memory entries', 'User writes facts ("My brand tone is casual and bold")'],
          ['Nova integration', 'Nova reads memory entries before generating content'],
          ['Categories', 'Brand voice, audience, product info, style preferences'],
          ['CRUD', 'Add, edit, delete memory entries anytime'],
        ]
      ),

      // 5.12 Settings & Billing
      blank(),
      h2('5.12  Settings & Billing'),
      h3('Settings'),
      table(
        ['Setting', 'Description'],
        [
          ['Profile', 'Name, email, avatar, timezone, language'],
          ['Password change', 'Old password + new password form'],
          ['Notification preferences', 'Email alerts for post status, credit warnings'],
          ['Connected accounts', 'View and disconnect OAuth providers (Google, Facebook)'],
          ['Delete account', 'GDPR-compliant account deletion with data wipe'],
        ]
      ),
      blank(),
      h3('Billing'),
      table(
        ['Feature', 'Description'],
        [
          ['Current plan display', 'Plan name, credit usage bar, renewal date'],
          ['Upgrade / Downgrade', 'Switch plan — pro-rated credits applied'],
          ['Payment history', 'Table of all transactions with status'],
          ['Annual billing toggle', 'Switch to annual for 20% discount'],
          ['Payment via Hubtel', 'Mobile money and card payments (Ghana market)'],
        ]
      ),

      pageBreak(),

      // ── 6. Nova Design Agent ─────────────────────────────────────────────
      h1('6. Nova Design Agent Workflow'),
      p('Nova is the platform\'s flagship AI feature. It accepts a natural-language design brief and outputs a fully-reasoned image with design rationale, streamed live to the UI.'),
      blank(),
      h2('Architecture'),
      table(
        ['Component', 'Role'],
        [
          ['POST /api/nova/design', 'SSE endpoint — accepts brief, streams events, returns final result'],
          ['Claude 3 (Anthropic)', 'Reasoning engine for steps 1–5 (understand, concept, select, prompt)'],
          ['Magnific API', 'Image generation — step 6 (async task with polling)'],
          ['nova_agent_workflow table', 'Admin-editable workflow JSON (prompts for each step)'],
          ['user_memory table', 'Brand/audience context injected into step 1'],
          ['magnific_generations table', 'Logs every generation with status, model, task_id, result_url'],
        ]
      ),
      blank(),
      h2('SSE Event Stream'),
      p('The frontend subscribes to the SSE endpoint and receives events in real time:'),
      blank(),
      table(
        ['Event Type', 'Payload', 'When'],
        [
          ['step_start', '{ step, label }', 'As each workflow step begins'],
          ['step_complete', '{ step, result }', 'When Claude returns output for a step'],
          ['image_generating', '{ taskId }', 'After Magnific accepts the image task'],
          ['image_complete', '{ url }', 'When Magnific finishes the image'],
          ['design_complete', '{ imageUrl, concept, prompt, rationale }', 'Final assembled result'],
          ['error', '{ message }', 'Any failure at any step'],
        ]
      ),
      blank(),
      h2('Default Model'),
      p('Nova uses flux-2-turbo (3 credits) by default for speed. The model can be overridden by the user in the Studio panel.'),
      blank(),
      h2('Admin Workflow Editor'),
      p('Admins can edit the system prompts for each Nova step at Admin → AI Agents. This allows fine-tuning the agent\'s reasoning without a code deploy.'),

      pageBreak(),

      // ── 7. Admin Panel ───────────────────────────────────────────────────
      h1('7. Admin Panel'),
      p('Accessible at /admin — visible only to users with role = \'admin\'.'),
      blank(),
      table(
        ['Section', 'What Admins Can Do'],
        [
          ['User Management', 'List all users, filter by plan/role, edit profiles, ban, delete, grant credits, impersonate'],
          ['Subscriptions', 'View all active subscriptions, revenue stats, subscription timeline'],
          ['Payments', 'Full transaction history, manual refunds, payment stats dashboard'],
          ['Pricing Plans', 'Create / edit / disable plans — name, price, credits, features list'],
          ['AI Config', 'Set Claude API key, model selection, temperature, max tokens'],
          ['AI Skills', 'Create custom AI micro-prompts (skills) used in post generation'],
          ['AI Agents', 'Edit Nova workflow step prompts (each step has its own system prompt)'],
          ['Magnific AI', 'Set Magnific API key, test connection, view generation history'],
          ['Cards / Templates', 'Create and publish card templates using the Fabric.js builder'],
          ['Media', 'View all user uploads, delete, set category, storage stats'],
          ['Pages', 'CMS for public pages — Landing, Tools, Privacy, Terms (content blocks)'],
          ['Integrations', 'Enable/disable OAuth providers, configure API keys per integration'],
          ['Auth Providers', 'Toggle Google / Facebook / GitHub sign-in on/off'],
          ['Apify', 'Configure Apify actors for web scraping / social data enrichment'],
          ['Learn', 'Admin knowledge base / training articles for platform documentation'],
          ['Settings', 'Platform name, logo, default timezone, maintenance mode'],
          ['Audit Log', 'Immutable log of all admin actions with timestamp and actor'],
        ]
      ),

      pageBreak(),

      // ── 8. Key Workflows ─────────────────────────────────────────────────
      h1('8. Key Workflows (Step-by-Step)'),

      h2('8.1  User Signs Up and Starts Generating'),
      table(
        ['Step', 'What Happens'],
        [
          ['1', 'User visits /signup, enters name / email / password'],
          ['2', 'Server creates user row, grants 100 credits (Free plan), issues 7-day JWT'],
          ['3', 'Onboarding wizard guides: connect a social account, create first post'],
          ['4', 'User navigates to AI Studio → Discover tab → opens GeneratePanel'],
          ['5', 'User types a prompt, selects a model (e.g. Flux 2 Turbo, 3 cr)'],
          ['6', 'Client POSTs to /api/nova/generate-image with { prompt, model }'],
          ['7', 'Server calls Magnific API, stores pending row in magnific_generations'],
          ['8', 'Server polls Magnific every 3s until COMPLETED (max 120s)'],
          ['9', 'Result URL returned — image shown in panel, saved to Media Library'],
          ['10', 'Credits deducted (3 cr for Flux Turbo)'],
        ]
      ),
      blank(),

      h2('8.2  Scheduling a Post'),
      table(
        ['Step', 'What Happens'],
        [
          ['1', 'User opens Posts → New Post'],
          ['2', 'Writes or AI-generates post content'],
          ['3', 'Attaches an image from Media Library'],
          ['4', 'Selects one or more connected social accounts'],
          ['5', 'Clicks "Schedule" → sets date and time'],
          ['6', 'Post saved with status = \'scheduled\' and scheduled_at timestamp'],
          ['7', 'node-cron job runs every minute — finds posts where scheduled_at <= NOW()'],
          ['8', 'Publishes to each selected platform via their respective APIs'],
          ['9', 'Post status updated to \'published\' or \'failed\' with error detail'],
        ]
      ),
      blank(),

      h2('8.3  Nova Workflow (Full Run)'),
      table(
        ['Step', 'What Happens'],
        [
          ['1', 'User opens AI Studio → Studio tab, types design brief'],
          ['2', 'Frontend opens EventSource to POST /api/nova/design'],
          ['3', 'Server loads Nova workflow config from DB (or uses hardcoded defaults)'],
          ['4', 'Server reads user\'s memory entries (brand voice, audience)'],
          ['5', 'Claude runs step: understand_brief → extracts design intent'],
          ['6', 'step_complete event streamed → UI shows step result'],
          ['7', 'Claude runs step: generate_concepts → 3 concepts with palettes'],
          ['8', 'Claude runs step: select_best_concept → picks and scores'],
          ['9', 'Claude runs step: craft_prompt → writes detailed Magnific prompt'],
          ['10', 'Server calls Magnific generate-image (Flux 2 Turbo)'],
          ['11', 'image_generating event → UI shows spinning loader'],
          ['12', 'Server polls Magnific until COMPLETED'],
          ['13', 'design_complete event → full result object streamed to UI'],
          ['14', 'UI renders image + concept card + design rationale'],
          ['15', 'Generation logged to magnific_generations, credits deducted'],
        ]
      ),
      blank(),

      h2('8.4  Admin Configuring Magnific API Key'),
      table(
        ['Step', 'What Happens'],
        [
          ['1', 'Admin navigates to Admin → Magnific AI'],
          ['2', 'Enters API key in the masked input field'],
          ['3', 'Clicks Save → PUT /api/admin/magnific/config → stored in platform_configs table'],
          ['4', 'Clicks Test Connection → GET /api/admin/magnific/test → server makes cheap Magnific call'],
          ['5', 'Green checkmark or red error shown depending on response'],
          ['6', 'All subsequent generation calls read key from platform_configs (fallback to env var MAGNIFIC_API_KEY)'],
        ]
      ),

      pageBreak(),

      // ── 9. Authentication ────────────────────────────────────────────────
      h1('9. Authentication'),
      blank(),
      table(
        ['Method', 'Flow', 'Token Expiry'],
        [
          ['Email + Password', 'POST /api/auth/login → JWT returned in response body', '7 days'],
          ['Google OAuth', '/auth/google/start → Google consent → /auth/google/callback → JWT', '24 hours'],
          ['Facebook OAuth', '/auth/facebook/start → FB consent → callback → JWT', '24 hours'],
          ['GitHub OAuth', '/auth/github/start → GitHub consent → callback → JWT', '24 hours'],
        ]
      ),
      blank(),
      h2('Token Handling'),
      bullet('JWT stored in localStorage on the client'),
      bullet('Global fetch interceptor in App.tsx auto-logs out on any 401 response'),
      bullet('force_auth_reset key in DB invalidates all tokens on major deploys'),
      bullet('JWT_SECRET generated once by render.yaml — persists across redeployments'),
      blank(),
      h2('Security'),
      bullet('Passwords hashed with bcrypt (salt rounds: 12)'),
      bullet('OAuth states stored in oauth_states table (10-minute TTL, one-time use)'),
      bullet('Admin routes protected by role = \'admin\' check in requireAdmin middleware'),
      bullet('Credit deduction is atomic — uses DB transaction to prevent race conditions'),

      pageBreak(),

      // ── 10. API Architecture ─────────────────────────────────────────────
      h1('10. API Architecture Summary'),
      p('All backend logic lives in a single file: packages/api/src/server.ts. Routes are grouped by domain.'),
      blank(),
      table(
        ['Route Group', 'Base Path', 'Description'],
        [
          ['Auth', '/api/auth/*', 'Register, login, profile, password change, OAuth'],
          ['Social accounts', '/api/v1/social/*', 'Connect/disconnect platforms, publish, analytics'],
          ['Facebook', '/api/v1/social/facebook/*', 'FB-specific pages, insights, token refresh'],
          ['Posts', '/api/posts/*', 'CRUD, schedule, publish, repost'],
          ['Automation', '/api/automation/*', 'Rules, cron trigger'],
          ['Cards / Templates', '/api/card-templates/*', 'Template CRUD, publish, like, view'],
          ['Designs', '/api/designs/*', 'User canvas design CRUD'],
          ['Credits', '/api/credits/*', 'Balance, admin grant'],
          ['Media', '/api/media/*', 'Upload, list, delete, image transform'],
          ['Pricing', '/api/pricing/*', 'Plan list, create, update, delete'],
          ['Billing', '/api/payments/*', 'Hubtel initiate/callback/verify'],
          ['Integrations', '/api/integrations/*', 'Catalog, enable/disable, validate'],
          ['WordPress', '/api/wordpress/*', 'Connect, publish, media, CRUD'],
          ['Mailchimp', '/api/integrations/mailchimp/*', 'Connect, disconnect'],
          ['Campaign', '/api/campaign/*', 'Funnel CRUD, step management'],
          ['Nova Agent', '/api/nova/*', 'SSE design workflow, generate-image, generate-video, suggestions'],
          ['Magnific', '/api/magnific/*', 'Edit tools, improve-prompt, task polling'],
          ['Memory', '/api/memory/*', 'User memory CRUD, generate'],
          ['Pages (CMS)', '/api/pages/*', 'Public page content CRUD'],
          ['Admin', '/api/admin/*', 'Users, AI config, skills, agents, media, Magnific config'],
          ['Webhooks', '/webhooks/*', 'Stripe, Meta (Facebook), WordPress'],
        ]
      ),
      blank(),

      new Paragraph({
        children: [new TextRun({
          text: 'Dakyworld Hub — Internal System Document  |  May 2026  |  Confidential',
          italics: true, size: 18, color: '9CA3AF',
        })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      }),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync('D:/Saas/SYSTEM_OVERVIEW.docx', buf);
console.log('Created: D:/Saas/SYSTEM_OVERVIEW.docx');
