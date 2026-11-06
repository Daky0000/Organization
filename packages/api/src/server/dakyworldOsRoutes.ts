import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { safeAxios, assertSafePublicUrl } from '../ssrf-guard.ts';
import { computeWebhookSignature } from '../middleware/planQuotaMiddleware.ts';
import { osApiLimiter } from '../middleware/rateLimiter.ts';
import {
  getAIConfig,
  resolveActiveKey,
  callAINonStreaming,
  ensureCreditAccount,
  getTokenEfficiencyTelemetry,
  FAST_MODEL,
  GEMINI_MODELS,
  chargeAICredits,
} from '../ai-helpers.ts';
import { AGENT_DEFS, triggerAgentCompilation } from '../agent-helpers.ts';
import { buildSharedAgentContext, recordAgentInsight, invalidateSharedContext } from './agentSharedContext.ts';
import { getUserPlanName } from '../user-auth.ts';
import { dbQuery } from '../db.ts';
import { logger } from '../logger.ts';
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

export interface DakyworldOsDeps {
  pool: Pool;
  requireAuth?: (req: Request, res: Response) => { userId: string } | null;
  getAuthUser?: (req: Request) => { userId: string; email?: string } | null;
  getUserConnectedAccounts?: (userId: string) => Promise<any[]>;
  createNotification?: (userId: string, type: string, title: string, message: string, data?: Record<string, any>) => Promise<void>;
  dbQuery?: any;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateLuxuryBrandPosterDataUrl(prompt: string, aspect = '1:1', brandName = 'DAKYWORLD'): string {
  const isWide = aspect === '16:9' || aspect === '21:9';
  const isTall = aspect === '9:16' || aspect === '3:4';
  const w = isWide ? 1280 : isTall ? 720 : 1080;
  const h = isWide ? 720 : isTall ? 1280 : 1080;
  const safePrompt = prompt.replace(/[<>&"']/g, '').slice(0, 110);
  const safeBrand = brandName.replace(/[<>&"']/g, '').toUpperCase().slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0B0F19"/>
        <stop offset="50%" stop-color="#1E1B4B"/>
        <stop offset="100%" stop-color="#311042"/>
      </linearGradient>
      <radialGradient id="glow" cx="75%" cy="25%" r="55%">
        <stop offset="0%" stop-color="#5B6CF9" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#EC4899" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <rect x="48" y="48" width="${w - 96}" height="${h - 96}" rx="32" fill="none" stroke="#5B6CF9" stroke-opacity="0.35" stroke-width="2"/>
    <text x="96" y="130" fill="#818CF8" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="800" letter-spacing="4">${safeBrand} · AI STUDIO</text>
    <text x="96" y="${Math.round(h * 0.48)}" fill="#FFFFFF" font-family="Inter, system-ui, sans-serif" font-size="44" font-weight="900">${safePrompt.slice(0, 36)}</text>
    <text x="96" y="${Math.round(h * 0.48) + 58}" fill="#CBD5E1" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="600">${safePrompt.slice(36, 82)}</text>
    <rect x="96" y="${h - 140}" width="260" height="48" rx="24" fill="#5B6CF9"/>
    <text x="226" y="${h - 109}" text-anchor="middle" fill="#FFFFFF" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="800">DAKYWORLD OS READY</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function registerDakyworldOsRoutes({
  pool,
  requireAuth,
  getAuthUser,
  getUserConnectedAccounts,
  createNotification,
}: DakyworldOsDeps): Router {
  const router = express.Router();

  const resolveConnectedAccounts = async (userId: string): Promise<any[]> => {
    if (typeof getUserConnectedAccounts === 'function') {
      return getUserConnectedAccounts(userId).catch(() => []);
    }
    const { rows } = await pool.query(
      `SELECT platform, account_name, status FROM user_integrations WHERE user_id=$1`,
      [userId],
    ).catch(() => ({ rows: [] as any[] }));
    return rows;
  };

  const notifyUser = async (userId: string, type: string, title: string, message: string, data?: Record<string, any>) => {
    if (typeof createNotification === 'function') {
      await createNotification(userId, type, title, message, data).catch(() => undefined);
    }
  };

  // Apply tiered rate limiting and Idempotency-Key protection across all /api/v1/os/* routes
  router.use(osApiLimiter);


  async function authenticateOsRequest(req: Request, res: Response): Promise<{ userId: string; authMethod: 'api_key' | 'jwt' | 'os_secret'; scopes: string[] } | null> {
    // 1. Check X-Dakyworld-OS-Secret header if configured
    const osSecret = process.env.DAKYWORLD_OS_SECRET?.trim();
    const headerSecret = String(req.headers['x-dakyworld-os-secret'] || '').trim();
    if (osSecret && headerSecret && headerSecret === osSecret) {
      const targetUserId = String(req.headers['x-dakyworld-user-id'] || '').trim();
      if (!targetUserId) { res.status(400).json({ error: 'An explicit user ID is required' }); return null; }
      return { userId: targetUserId, authMethod: 'os_secret', scopes: ['os:full'] };
    }

    // 2. Check Bearer token (API key `cf_live_...` / `dwos_live_...` or JWT)
    const bearer = String(req.headers.authorization || req.headers['x-dakyworld-os-key'] || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

    if (bearer.startsWith('cf_live_') || bearer.startsWith('dwos_live_')) {
      const { rows } = await pool.query(
        `SELECT k.id,k.user_id,k.scopes FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND u.status='active' LIMIT 1`,
        [hashKey(bearer)]
      ).catch(() => ({ rows: [] as any[] }));

      if (!rows.length) {
        res.status(401).json({ success: false, error: 'Invalid or revoked Dakyworld OS API key' });
        return null;
      }
      const keyRow = rows[0];
      void pool.query(`UPDATE api_keys SET last_used_at=NOW() WHERE id=$1`, [keyRow.id]).catch(() => undefined);
      const scopes = Array.isArray(keyRow.scopes)
        ? keyRow.scopes
        : [];
      return { userId: keyRow.user_id, authMethod: 'api_key', scopes };
    }

    // 3. Fallback to standard JWT session token
    const jwtUser = typeof getAuthUser === 'function' ? getAuthUser(req) : (typeof requireAuth === 'function' ? requireAuth(req, res) : null);
    if (jwtUser?.userId) {
      return {
        userId: jwtUser.userId,
        authMethod: 'jwt',
        scopes: ['os:full', 'agents:invoke', 'content:write', 'generations:run', 'analytics:read', 'memory:sync'],
      };
    }

    if (!res.headersSent) {
      res.status(401).json({
        success: false,
        error: 'Authentication required. Pass Authorization: Bearer cf_live_... (or dwos_live_...) API key or JWT.',
      });
    }
    return null;
  }

  async function authorizeOsRequest(req: Request, res: Response) {
    const auth = await authenticateOsRequest(req,res); if (!auth) return null;
    const path = req.path;
    const required = path.startsWith('/analytics') ? 'analytics:read' : path.startsWith('/memory') ? 'memory:sync' :
      path.startsWith('/agents') ? 'agents:invoke' : path.includes('generat') ? 'generations:run' :
      req.method === 'GET' && path === '/manifest' ? null : 'content:write';
    if (required && !auth.scopes.includes('os:full') && !auth.scopes.includes(required)) {
      res.status(403).json({ success: false, error: `Missing API scope: ${required}` }); return null;
    }
    return auth;
  }

  // ── GET /api/v1/os/manifest — Zero-token Dakyworld OS capability discovery ──
  router.get('/manifest', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const [planName, creditAccount, connectedAccounts, sharedContext] = await Promise.all([
      getUserPlanName(auth.userId).catch(() => 'Pro'),
      ensureCreditAccount(auth.userId).catch(() => ({ credits: 1000, resetDate: null, autoRecharge: false })),
      resolveConnectedAccounts(auth.userId),
      buildSharedAgentContext(auth.userId).catch(() => ''),
    ]);

    return res.json({
      success: true,
      version: '1.4.0',
      credits: creditAccount.credits,
      os_protocol: 'dakyworld-os-bridge/v1.0',
      timestamp: new Date().toISOString(),
      workspace: {
        userId: auth.userId,
        authMethod: auth.authMethod,
        scopes: auth.scopes,
        plan: planName,
        credits: creditAccount,
        tokenEfficiency: getTokenEfficiencyTelemetry(),
        contextSummaryLength: sharedContext.length,
      },
      agents: Object.entries(AGENT_DEFS).map(([key, def]) => ({
        key,
        name: def.name,
        role: def.role,
        icon: def.icon,
        color: def.color,
      })),
      connectedPlatforms: connectedAccounts
        .filter((a: any) => a.connected !== false)
        .map((a: any) => ({ platform: a.platform, handle: a.handle || a.accountName || a.platform })),
      endpoints: {
        manifest: 'GET /api/v1/os/manifest',
        context: 'GET /api/v1/os/context',
        memorySync: 'POST /api/v1/os/memory/sync',
        invokeAgent: 'POST /api/v1/os/agents/invoke',
        proposals: 'GET /api/v1/os/proposals',
        proposalDecision: 'POST /api/v1/os/proposals/:id/decision',
        publish: 'POST /api/v1/os/publish',
        generate: 'POST /api/v1/os/generate',
        analytics: 'GET /api/v1/os/analytics',
        webhooks: 'GET|POST /api/v1/os/webhooks',
      },
    });
  });

  // ── GET /api/v1/os/context — Zero-token unified workspace & brand context ──
  router.get('/context', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const [context, { rows: memories }, { rows: insights }] = await Promise.all([
      buildSharedAgentContext(auth.userId),
      dbQuery(`SELECT id, category, title, content, updated_at FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order LIMIT 50`, [auth.userId]),
      dbQuery(`SELECT key, value, created_at FROM user_agent_memory WHERE user_id=$1 AND agent_key='global' ORDER BY created_at DESC LIMIT 15`, [auth.userId]),
    ]);

    return res.json({
      success: true,
      tokensUsed: 0,
      cached: true,
      context,
      memories,
      insights,
    });
  });

  // ── POST /api/v1/os/memory/sync — Bidirectional memory sync with Dakyworld OS ──
  router.post('/memory/sync', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const { memories, insight } = req.body as {
      memories?: Array<{ category?: string; title: string; content: string }>;
      insight?: { key: string; value: string };
    };

    let upserted = 0;
    if (Array.isArray(memories)) {
      for (const m of memories.slice(0, 25)) {
        if (!m?.title || !m?.content) continue;
        await dbQuery(
          `INSERT INTO user_memories (id, user_id, category, title, content, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())`,
          [randomUUID(), auth.userId, String(m.category || 'brand').slice(0, 40), String(m.title).slice(0, 120), String(m.content).slice(0, 2000)]
        ).catch(() => undefined);
        upserted++;
      }
    }

    if (insight?.key && insight?.value) {
      await recordAgentInsight(auth.userId, insight.key, insight.value);
    }

    invalidateSharedContext(auth.userId);
    if (upserted > 0) {
      void triggerAgentCompilation(auth.userId);
    }

    return res.json({
      success: true,
      upsertedMemories: upserted,
      insightRecorded: Boolean(insight?.key),
      compilationScheduled: upserted > 0,
    });
  });

  // ── POST /api/v1/os/agents/invoke — Token-efficient Agent & Team invocation ──
  router.post('/agents/invoke', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const {
      agent = 'daky',
      agents,
      prompt,
      max_tokens = 450,
      use_cache = true,
    } = req.body as {
      agent?: string;
      agents?: string[];
      prompt?: string;
      max_tokens?: number;
      use_cache?: boolean;
    };

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ success: false, error: 'prompt is required' });
    }

    const cappedMaxTokens = Math.min(2000, Math.max(64, Number(max_tokens) || 450));
    const sharedCtx = await buildSharedAgentContext(auth.userId);
    const aiCfg = await getAIConfig();
    const apiKey = resolveActiveKey(aiCfg);
    const targetAgents = Array.isArray(agents) && agents.length > 0
      ? agents.filter((k) => Boolean(AGENT_DEFS[k])).slice(0, 5)
      : [AGENT_DEFS[agent] ? agent : 'daky'];

    // Single-call multi-agent or single-agent execution (never fires N parallel calls when 1 structured call suffices)
    const agentPersonas = targetAgents
      .map((k) => `${AGENT_DEFS[k].name} (${AGENT_DEFS[k].role})`)
      .join(', ');

    const magnificDoctrine = `Magnific Academy Multimodal Engine Doctrine:
- Always specify exact model, aspect ratio, resolution, and background rules explicitly.
- For reusable characters/products: generate on a plain white studio background first ('nano-banana-2' in 4K) and build a single multi-view Character Profile Sheet (front, side, back, passport faces) to anchor consistency; keep Character, Location, and Object nodes separate.
- For art-directed images & campaigns: use Magnific One (draft mode with tiles: 16 for exact aspect ratios across all 10 ratios -> quality mode at 2k/4k with 2-3 consistent style references + Brand Kit + Designer Auto Layers).
- For product micro-typography ('nano-banana-pro'): use the 7-Part Hierarchy (Composition First -> Exact Product Identity -> Dedicated Typography Block -> Specific Color Names -> Lighting Harmony -> Optical Clarity -> Negative Constraints).
- For branded packaging/merchandise mockups ('nano-banana-2' in 4K): chain base shots via references -> attach black-on-white logo -> specify physical finish (deboss on glass/bottles, emboss on boxes, embroidered thread on fabric/towels).
- For video: Seedance 2.5 (15s chunks at 1080p -> 4K Video Upscaler, up to 50 refs, 3D Scenes motion transfer, "no music" rule in multi-clip prompts, surgical frame-extract + Nano Banana Pro fix or Clip Modify), Kling 3.0 (7-part T2V formula or action-only with Start Image; Multi-Shot up to 6 cuts <=512 chars/shot), Kling 3.0 Omni (multi-ref dialogue lip-sync, mid-shot object swap, product text stability in motion), Kling 2.6 Motion Control (camera-only prompt rule—NEVER describe physical action), LTX 2 Pro (up to 4K 50fps).
- For talking avatars & lip-sync: OmniHuman 1.5 (image_url + audio_url) & Voiceover + Kling 3.0 Omni UGC pipelines.
- For audio & Spaces/Flows: 3-layer audio mixing (native dialogue/foley + looping SFX + ElevenLabs Music), Assistant 'Export as List' batching, Variations Split-Grid + Upscaler, and pre-flight simulate_cost Spaces/Flows.`;

    const systemPrompt = targetAgents.length === 1
      ? `You are ${AGENT_DEFS[targetAgents[0]].name}, ${AGENT_DEFS[targetAgents[0]].role} on the Dakyworld OS marketing intelligence team.\n\n${magnificDoctrine}\n\nWorkspace Context:\n${sharedCtx}\n\nRespond concisely with high-signal, immediately actionable output.`
      : `You are the Dakyworld OS Multi-Agent Council (${agentPersonas}).\n\n${magnificDoctrine}\n\nWorkspace Context:\n${sharedCtx}\n\nProvide each specialist's concise recommendation followed by a unified executive action plan.`;

    if (!apiKey) {
      // Resilient local fallback when no external LLM API key is configured
      const fallbackOutput = targetAgents.length === 1
        ? `[${AGENT_DEFS[targetAgents[0]].name} · ${AGENT_DEFS[targetAgents[0]].role}] Actionable recommendation for "${String(prompt).slice(0, 90)}": Leverage your brand voice (${sharedCtx.slice(0, 140) || 'Dakyworld'}) with a high-converting hook, clear proof point, and tracked CTA.`
        : targetAgents.map((k) => `• ${AGENT_DEFS[k].name} (${AGENT_DEFS[k].role}): Execute targeted play for "${String(prompt).slice(0, 60)}".`).join('\n') + `\n\nUnified OS Action Plan: Deploy across primary connected channels and track attribution via /r/ shortlinks.`;

      return res.json({
        success: true,
        agents: targetAgents,
        provider: 'local_fallback',
        output: fallbackOutput,
        usage: { cached: true, tokensSaved: 420, creditsCharged: 0 },
        tokenEfficiency: getTokenEfficiencyTelemetry(),
      });
    }

    const model = aiCfg.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
      : FAST_MODEL;

    const output = await callAINonStreaming(
      aiCfg.provider,
      apiKey,
      model,
      systemPrompt,
      String(prompt).trim().slice(0, 3000),
      cappedMaxTokens,
      {
        userId: auth.userId,
        feature: `os_agent_${targetAgents.join('_')}`,
        skipCache: !use_cache,
      }
    );

    return res.json({
      success: true,
      agents: targetAgents,
      provider: aiCfg.provider,
      model,
      output,
      tokenEfficiency: getTokenEfficiencyTelemetry(),
    });
  });

  // ── GET /api/v1/os/proposals & POST /api/v1/os/proposals/:id/decision ──
  router.get('/proposals', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;
    const status = String(req.query.status || 'pending').toLowerCase();
    const { rows } = await dbQuery(
      `SELECT id, agent_key, task_type, title, body, payload, status, created_at
       FROM user_agent_tasks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [auth.userId]
    );
    const filtered = status === 'all' ? rows : rows.filter((r: any) => !r.status || r.status === status);
    return res.json({ success: true, proposals: filtered });
  });

  router.post('/proposals/:id/decision', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;
    const decision = String(req.body?.decision || 'approved').toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision must be approved or rejected' });
    }
    const { rows } = await dbQuery(
      `UPDATE user_agent_tasks SET status=$1, decided_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *`,
      [decision, req.params.id, auth.userId]
    );
    return res.json({ success: true, proposal: rows[0] ?? { id: req.params.id, status: decision } });
  });

  // ── POST /api/v1/os/publish — Create draft or schedule social/blog post ──
  router.post('/publish', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const { title = 'Untitled OS Post', content = '', excerpt = '', platforms = [], scheduled_at } = req.body as {
      title?: string;
      content?: string;
      excerpt?: string;
      platforms?: string[];
      scheduled_at?: string;
    };

    if (!String(content).trim()) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const postId = randomUUID();
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || postId;
    const isScheduled = Boolean(scheduled_at);
    const schedIso = isScheduled ? new Date(scheduled_at!).toISOString() : null;

    const { rows } = await dbQuery(
      isScheduled
        ? `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, scheduled_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,NOW(),NOW()) RETURNING *`
        : `INSERT INTO blog_posts (id, user_id, title, slug, content, excerpt, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',NOW(),NOW()) RETURNING *`,
      isScheduled
        ? [postId, auth.userId, title.slice(0, 255), slug, content, excerpt.slice(0, 500), schedIso]
        : [postId, auth.userId, title.slice(0, 255), slug, content, excerpt.slice(0, 500)]
    );

    void notifyUser(
      auth.userId,
      isScheduled ? 'post_scheduled' : 'draft_created',
      isScheduled ? 'OS Post Scheduled' : 'OS Draft Created',
      `"${title}" was ${isScheduled ? 'scheduled' : 'created'} via Dakyworld OS Bridge.`,
      { postId, platforms }
    ).catch(() => undefined);

    return res.status(201).json({
      success: true,
      post: rows[0] ?? { id: postId, title, status: isScheduled ? 'scheduled' : 'draft', scheduled_at: schedIso },
      platforms,
    });
  });

  // ── POST /api/v1/os/generate — Magnific Multimodal Generation via OS Bridge ──
  // Supports: type = 'magnific-one' | 'image' | 'edit' | 'video' | 'lip-sync' | 'audio' | 'space' | 'flow'
  router.post('/generate', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const body = req.body as Record<string, any>;
    const genType: string = String(body.type || (body.model === 'magnific-one' || !body.model ? 'magnific-one' : 'image')).toLowerCase();
    const prompt: string = String(body.prompt || body.text || body.description || body.goal || '').trim();
    const aspectRatio: string = String(body.aspect_ratio || '1:1');
    const model: string = String(body.model || (genType === 'video' ? 'kling-v2-6-pro' : 'magnific-one'));

    const magnificKey = await getMagnificApiKey(pool);
    if (!magnificKey) {
      return res.status(400).json({
        success: false,
        error: 'Magnific API key is not configured. Configure it in Admin → Magnific AI.',
      });
    }

    // Free pre-flight cost simulation for spaces/flows
    if ((genType === 'space' || genType === 'flow') && body.action === 'simulate_cost') {
      const sim = await magnificExecuteSpaceOrFlow({ ...body, action: 'simulate_cost' }, magnificKey);
      return res.json(sim);
    }

    // Determine credit cost
    let creditCost = 6;
    if (genType === 'magnific-one') {
      creditCost = body.mode === 'draft' ? 4 : (body.resolution === '4k' ? 8 : 6);
    } else if (genType === 'image') {
      creditCost = MAGNIFIC_IMAGE_MODELS[model]?.credits ?? 6;
    } else if (genType === 'edit') {
      creditCost = body.edit_type === 'remove-background' ? 1 : 5;
    } else if (genType === 'video') {
      creditCost = MAGNIFIC_VIDEO_MODELS[model]?.credits ?? 25;
    } else if (genType === 'lip-sync' || genType === 'lipsync') {
      creditCost = 30;
    } else if (genType === 'audio') {
      creditCost = body.audio_type === 'music-generation' ? 6 : 4;
    } else if (genType === 'space' || genType === 'flow') {
      const sim = await magnificExecuteSpaceOrFlow({ ...body, action: 'simulate_cost' }, magnificKey);
      creditCost = sim.estimated_credits ?? 10;
    }

    const acct = await ensureCreditAccount(auth.userId);
    if (acct.credits < creditCost) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits for Magnific generation',
        credits: acct.credits,
        required: creditCost,
      });
    }

    const genId = randomUUID();
    await dbQuery(
      `INSERT INTO magnific_generations (id, user_id, type, model, prompt, params, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [genId, auth.userId, genType, model, prompt, JSON.stringify({ aspect_ratio: aspectRatio, mode: body.mode, resolution: body.resolution })]
    ).catch(() => undefined);

    try {
      if (genType === 'magnific-one') {
        if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required for Magnific One' });
        const r = await magnificOneGenerate(
          {
            prompt,
            mode: body.mode || 'quality',
            quality: body.quality || 'high',
            resolution: body.resolution || '2k',
            aspect_ratio: aspectRatio,
            tiles: body.tiles,
            reference_images: body.reference_images,
          },
          magnificKey
        );
        if (r.error || !r.url) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'No URL', genId]).catch(() => undefined);
          return res.status(400).json({ success: false, error: r.error || 'Magnific One failed' });
        }
        await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`, [r.taskId, r.url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, 'os_magnific_one', { gen_id: genId });
        return res.json({ success: true, type: 'magnific-one', model: 'magnific-one', url: r.url, urls: r.urls, gen_id: genId, credits_used: creditCost });
      }

      if (genType === 'image') {
        if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });
        const modelKey = MAGNIFIC_IMAGE_MODELS[model] ? model : 'magnific-one';
        const r = await magnificGenerateImage(modelKey, prompt, aspectRatio, magnificKey, undefined, {
          mode: body.mode,
          quality: body.quality,
          resolution: body.resolution,
          tiles: body.tiles,
          reference_images: body.reference_images,
        });
        if (r.error || !r.url) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'No URL', genId]).catch(() => undefined);
          return res.status(400).json({ success: false, error: r.error || 'Magnific image generation failed' });
        }
        await dbQuery(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [r.url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, `os_magnific_image_${modelKey}`, { gen_id: genId });
        return res.json({ success: true, type: 'image', model: modelKey, url: r.url, urls: r.urls ?? [r.url], gen_id: genId, credits_used: creditCost });
      }

      if (genType === 'edit') {
        const r = await magnificEditImage({ ...body, type: body.edit_type || body.sub_type || 'upscale' }, magnificKey);
        if (r.error || !r.url) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'No URL', genId]).catch(() => undefined);
          return res.status(400).json({ success: false, error: r.error || 'Magnific image edit failed' });
        }
        await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`, [r.taskId, r.url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, `os_magnific_edit`, { gen_id: genId });
        return res.json({ success: true, type: 'edit', url: r.url, gen_id: genId, credits_used: creditCost });
      }

      if (genType === 'video') {
        const r = await magnificGenerateVideo(
          {
            model,
            prompt,
            image_url: body.image_url || body.image,
            duration: body.duration,
            resolution: body.resolution,
            aspect_ratio: aspectRatio,
            generate_audio: body.generate_audio,
          },
          magnificKey
        );
        if (r.error || !r.url) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'No URL', genId]).catch(() => undefined);
          return res.status(400).json({ success: false, error: r.error || 'Magnific video generation failed' });
        }
        await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`, [r.taskId, r.url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, `os_magnific_video_${r.model}`, { gen_id: genId });
        return res.json({ success: true, type: 'video', model: r.model, url: r.url, gen_id: genId, credits_used: creditCost });
      }

      if (genType === 'lip-sync' || genType === 'lipsync') {
        const r = await magnificLipSync(
          {
            image_url: body.image_url || body.image,
            audio_url: body.audio_url || body.audio,
            prompt,
            resolution: body.resolution || '1080p',
            turbo_mode: body.turbo_mode,
          },
          magnificKey
        );
        if (r.error || !r.url) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'No URL', genId]).catch(() => undefined);
          return res.status(400).json({ success: false, error: r.error || 'OmniHuman 1.5 lip-sync failed' });
        }
        await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`, [r.taskId, r.url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, 'os_magnific_lipsync', { gen_id: genId });
        return res.json({ success: true, type: 'lip-sync', model: 'omni-human-1-5', url: r.url, gen_id: genId, credits_used: creditCost });
      }

      if (genType === 'audio') {
        const r = await magnificGenerateAudio(
          {
            type: body.audio_type || 'sound-effects',
            text: prompt,
            prompt,
            description: body.description || prompt,
            duration_seconds: body.duration_seconds,
            loop: body.loop,
            audio: body.audio,
            video: body.video,
          },
          magnificKey
        );
        if (r.error || !r.url) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'No URL', genId]).catch(() => undefined);
          return res.status(400).json({ success: false, error: r.error || 'Magnific audio generation failed' });
        }
        await dbQuery(`UPDATE magnific_generations SET task_id=$1, status='completed', result_url=$2, completed_at=NOW() WHERE id=$3`, [r.taskId, r.url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, `os_magnific_audio_${r.type}`, { gen_id: genId });
        return res.json({ success: true, type: 'audio', audio_type: r.type, url: r.url, gen_id: genId, credits_used: creditCost });
      }

      if (genType === 'space' || genType === 'flow') {
        const mcpCaller = (toolName: string, toolArgs: Record<string, unknown>) =>
          callMagnificMcpTool(pool, toolName, toolArgs, (val: unknown) => {
            const dec = decryptPlatformConfig(val as any);
            return typeof dec === 'string' ? dec : (dec as any)?.value ?? '';
          });
        const r = await magnificExecuteSpaceOrFlow(
          {
            action: body.action || (genType === 'flow' ? 'run_flow' : 'run_space'),
            name: body.name,
            goal: prompt || body.goal,
            nodes: body.nodes,
            reference_images: body.reference_images,
            aspect_ratio: aspectRatio,
          },
          magnificKey,
          mcpCaller
        );
        if (!r.success) {
          await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [r.error || 'Failed', genId]).catch(() => undefined);
          return res.status(400).json(r);
        }
        await dbQuery(`UPDATE magnific_generations SET status='completed', result_url=$1, completed_at=NOW() WHERE id=$2`, [r.final_url, genId]).catch(() => undefined);
        await chargeAICredits(auth.userId, creditCost, `os_magnific_${genType}`, { gen_id: genId });
        return res.json({ ...r, gen_id: genId, credits_used: creditCost });
      }

      return res.status(400).json({ success: false, error: `Unsupported generation type: ${genType}` });
    } catch (e: any) {
      await dbQuery(`UPDATE magnific_generations SET status='failed', error=$1 WHERE id=$2`, [e.message, genId]).catch(() => undefined);
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── GET /api/v1/os/analytics — Unified KPI summary for Dakyworld OS widgets ──
  router.get('/analytics', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;

    const [credits, posts, contacts, proposals] = await Promise.all([
      ensureCreditAccount(auth.userId),
      dbQuery(`SELECT COUNT(*) AS n FROM blog_posts WHERE user_id=$1`, [auth.userId]),
      dbQuery(`SELECT COUNT(*) AS n FROM mailing_contacts WHERE user_id=$1`, [auth.userId]),
      dbQuery(`SELECT COUNT(*) AS n FROM user_agent_tasks WHERE user_id=$1`, [auth.userId]),
    ]);

    return res.json({
      success: true,
      kpis: {
        creditsRemaining: credits.credits,
        postsTotal: Number(posts.rows[0]?.n ?? 0),
        contactsTotal: Number(contacts.rows[0]?.n ?? 0),
        agentProposalsTotal: Number(proposals.rows[0]?.n ?? 0),
      },
      tokenEfficiency: getTokenEfficiencyTelemetry(),
    });
  });

  // ── GET / POST / DELETE /api/v1/os/webhooks — Outbound OS Webhook Registry ──
  router.get('/webhooks', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;
    const { rows } = await dbQuery(`SELECT id, name, target_url, events, active, created_at FROM os_webhooks WHERE user_id=$1 ORDER BY created_at DESC`, [auth.userId]);
    return res.json({ success: true, webhooks: rows });
  });

  router.post('/webhooks', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;
    const { name = 'Dakyworld OS Node', target_url, events = ['post.published', 'lead.captured', 'agent.proposal_ready', 'generation.completed'] } = req.body as {
      name?: string;
      target_url?: string;
      events?: string[];
    };
    if (!target_url || !/^https?:\/\//i.test(target_url)) {
      return res.status(400).json({ success: false, error: 'Valid http(s) target_url is required' });
    }
    await assertSafePublicUrl(target_url);
    const id = randomUUID();
    const signingSecret = `dwos_whsec_${randomBytes(18).toString('hex')}`;
    const { rows } = await dbQuery(
      `INSERT INTO os_webhooks (id, user_id, name, target_url, events, signing_secret) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, auth.userId, String(name).slice(0, 80), target_url.trim(), JSON.stringify(events), signingSecret]
    );
    return res.status(201).json({
      success: true,
      webhook: rows[0] ?? { id, name, target_url, events, signing_secret: signingSecret, active: true },
    });
  });

  router.delete('/webhooks/:id', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;
    await dbQuery(`DELETE FROM os_webhooks WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    return res.json({ success: true });
  });

  router.post('/webhooks/:id/test', async (req: Request, res: Response) => {
    const auth = await authorizeOsRequest(req, res);
    if (!auth) return;
    const { rows } = await dbQuery(`SELECT * FROM os_webhooks WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]);
    const wh = rows[0];
    if (!wh) return res.status(404).json({ success: false, error: 'Webhook not found' });

    const payload = JSON.stringify({
      event: 'os.webhook_test',
      timestamp: new Date().toISOString(),
      workspace_user_id: auth.userId,
      source: 'dakyworld-hub',
    });
    const signature = computeWebhookSignature(wh.signing_secret, Math.floor(Date.now()/1000), payload);

    try {
      const resp = await safeAxios({ method: 'POST', url: wh.target_url, data: payload,
        headers: {
          'Content-Type': 'application/json',
          'X-Dakyworld-OS-Signature': signature,
        },
        timeout: 5000,
        validateStatus: () => true,
      });
      return res.json({ success: true, delivered: resp.status >= 200 && resp.status < 300, status: resp.status });
    } catch (err: any) {
      logger.warn({ err }, 'os_webhook_test_delivery_failed');
      return res.json({ success: true, delivered: false, error: err?.message || 'Target unreachable', signaturePreview: signature.slice(0, 16) });
    }
  });

  return router;
}
