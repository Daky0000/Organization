import { createHash } from 'crypto';
import { pool, dbQuery } from './db.ts';
import { getAIConfig, resolveActiveKey, callAINonStreaming, GEMINI_MODELS, FAST_MODEL, recordBatchCompilationSavings } from './ai-helpers.ts';

export const AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }> = {
  daky:             { name: 'Daky',    role: 'Content Writer',        icon: '✦', color: '#5B6CF9', memoryKeywords: [] },
  nova:             { name: 'Nova',    role: 'Creative Director',     icon: '◉', color: '#EC4899', memoryKeywords: ['brand','voice','visual','content','product','audience'] },
  sage:             { name: 'Sage',    role: 'Strategy Analyst',      icon: '◈', color: '#10B981', memoryKeywords: ['goal','competit','strategy','industry','market','target','campaign'] },
  aria:             { name: 'Aria',    role: 'Analytics & Perf.',     icon: '⊕', color: '#F59E0B', memoryKeywords: ['analytic','performance','kpi','metric','business'] },
  flux:             { name: 'Flux',    role: 'Automation',            icon: '⟳', color: '#8B5CF6', memoryKeywords: ['automat','workflow','platform','social','schedule'] },
  trend_research:   { name: 'Trend',   role: 'Trend Research',        icon: '◎', color: '#06B6D4', memoryKeywords: ['trend','viral','niche','topic','content','platform'] },
  audience_research:{ name: 'Persona', role: 'Audience Research',     icon: '◑', color: '#7C3AED', memoryKeywords: ['audience','persona','pain','objection','customer','demographic'] },
  seo_research:     { name: 'SEO',     role: 'SEO Keyword Research',  icon: '⊗', color: '#059669', memoryKeywords: ['seo','keyword','search','organic','traffic','content'] },
  hook_writing:     { name: 'Hook',    role: 'Hook Writing',          icon: '⚡', color: '#D97706', memoryKeywords: ['hook','headline','attention','opening','subject','ad'] },
  social_caption:   { name: 'Caption', role: 'Social Caption',        icon: '✎', color: '#DB2777', memoryKeywords: ['caption','social','instagram','tiktok','linkedin','hashtag'] },
  video_script:     { name: 'Script',  role: 'Video Script',          icon: '▶', color: '#DC2626', memoryKeywords: ['video','script','youtube','reels','tiktok','short','long'] },
  ad_copy:          { name: 'Ads',     role: 'Ad Copy',               icon: '◆', color: '#EA580C', memoryKeywords: ['ad','copy','meta','google','facebook','conversion','cta'] },
  thumbnail_design: { name: 'Thumb',   role: 'Thumbnail Design',      icon: '▣', color: '#9333EA', memoryKeywords: ['thumbnail','youtube','visual','design','creative','click'] },
  meta_ads:         { name: 'Meta',    role: 'Paid Social Manager',   icon: '⊛', color: '#1877F2', memoryKeywords: ['meta','facebook','instagram','paid','campaign','budget','roas'] },
  campaign_brief:   { name: 'Brief',   role: 'Campaign Brief Builder',icon: '◫', color: '#0EA5E9', memoryKeywords: ['campaign','brief','funnel','channel','launch','kpi'] },
  promo:            { name: 'Promo',   role: 'Promotion & Media',     icon: '✹', color: '#E11D48', memoryKeywords: ['promo','promotion','offer','launch','visual','image','brand','campaign'] },
  quality:          { name: 'Vetta',   role: 'Quality Control',       icon: '✓', color: '#0891B2', memoryKeywords: ['brand','voice','tone','audience','goal'] },
  planner:          { name: 'Atlas',   role: 'Content Planner',       icon: '▤', color: '#4F46E5', memoryKeywords: ['plan','schedule','campaign','goal','platform','content'] },
  calculator:       { name: 'Ledger',  role: 'Credit Calculator',     icon: '∑', color: '#65A30D', memoryKeywords: [] },
  sales_analyst:    { name: 'Echo',    role: 'Conversation Analyst',  icon: '◐', color: '#0EA5E9', memoryKeywords: ['objection','pricing','service','product','audience','offer'] },
  sales_caller:     { name: 'Rune',    role: 'Sales Caller',          icon: '☎', color: '#5B6CF9', memoryKeywords: ['service','product','pricing','offer','case study','faq','audience'] },
  sales_insight:    { name: 'Prism',   role: 'Sales Intelligence',    icon: '◭', color: '#F97316', memoryKeywords: ['sales','objection','conversion','goal','pricing','competit'] },
};

// Track memory content hashes per user so unchanged memories consume 0 tokens
const userCompilationHashes = new Map<string, string>();
const userCompilationTimers = new Map<string, NodeJS.Timeout>();

export async function provisionUserAgents(userId: string): Promise<void> {
  if (!pool) return;
  for (const key of Object.keys(AGENT_DEFS)) {
    await dbQuery(
      `INSERT INTO user_agents (user_id, agent_key, compiled_skill) VALUES ($1, $2, '') ON CONFLICT (user_id, agent_key) DO NOTHING`,
      [userId, key]
    ).catch(() => undefined);
  }
}

async function fetchUserMemoryContext(userId: string): Promise<{ memText: string; hash: string }> {
  const { rows: memoryRows } = await dbQuery(
    `SELECT category, title, content FROM user_memories WHERE user_id=$1 ORDER BY category, sort_order, created_at LIMIT 60`,
    [userId]
  ).catch(() => ({ rows: [] as any[] }));

  let brandLine = '';
  try {
    const { rows: brandRows } = await dbQuery(
      `SELECT brand_name, niche, tone, audience, goals, website FROM brand_profiles WHERE user_id=$1`,
      [userId]
    );
    const b = brandRows[0];
    if (b && (b.brand_name || b.niche)) {
      brandLine = `[brand] Profile: ${b.brand_name || 'unnamed'}${b.niche ? ` — ${b.niche}` : ''}${b.tone ? `, tone ${b.tone}` : ''}${b.audience ? `, audience: ${b.audience}` : ''}${Array.isArray(b.goals) && b.goals.length ? `, goals: ${b.goals.join('; ')}` : ''}${b.website ? `, ${b.website}` : ''}`;
    }
  } catch { /* brand profile optional */ }

  const memText = [brandLine, ...memoryRows.map((r: any) => `[${r.category}] ${r.title}: ${r.content}`)].filter(Boolean).join('\n');
  const hash = createHash('sha256').update(memText).digest('hex');
  return { memText, hash };
}

export const MAGNIFIC_AGENT_TRAINING_SUMMARY =
  'Magnific Academy Multimodal Engine: (1) Images: Magnific One (draft 16-tile contact sheets -> 2K/4K quality renders + 2-3 consistent style references + Brand Kit + Auto Layers), Nano Banana Pro (7-part hierarchy for tack-sharp product micro-typography, sketches-to-modular interiors @img1+@img2, surgical frame/background edits), Nano Banana 2 (4K full-body Character Profile Sheets on plain white studio backgrounds & physical surface mockups: deboss, emboss, embroidery), Mystic; (2) Video: Seedance 2.5 (up to 30s in 15s chunks, 50 refs, 480p->1080p->4K upscale funnel, "no music" prompt rule for multi-clip stories, surgical frame-extract fix or Modify), Kling 3.0 (7-part single-shot formula or action-only with Start Image; multi-shot up to 6 cuts <=512 chars/shot), Kling 3.0 Omni (multi-ref dialogue lip-sync, mid-shot object swap, product text stability in motion), Kling 2.6 Motion Control (camera-only prompt rule—never describe the physical action), LTX 2 Pro (4K 50fps), 3D Scenes motion transfer, OmniHuman 1.5 lip-sync; (3) Audio & Spaces: ElevenLabs Music, looping SFX, SAM Audio Isolation, Assistant Export-as-List batching, Variations Split-Grid + Upscaler, and pre-flight simulate_cost Spaces/Flows.';

export async function compileAgentSkill(userId: string, agentKey: string): Promise<void> {
  if (!pool) return;
  const def = AGENT_DEFS[agentKey];
  if (!def) return;
  try {
    const { memText, hash } = await fetchUserMemoryContext(userId);
    if (!memText) {
      await dbQuery(`UPDATE user_agents SET compiled_skill='', last_compiled_at=NOW() WHERE user_id=$1 AND agent_key=$2`, [userId, agentKey]);
      return;
    }

    const aiCfg = await getAIConfig();
    const apiKey = resolveActiveKey(aiCfg);
    if (!apiKey) {
      // Zero-token deterministic fallback brief when no provider API key is set yet
      const fallbackBrief = `${def.name} (${def.role}) context: ${memText.slice(0, 300)} | ${MAGNIFIC_AGENT_TRAINING_SUMMARY}`;
      await dbQuery(`UPDATE user_agents SET compiled_skill=$1, last_compiled_at=NOW() WHERE user_id=$2 AND agent_key=$3`, [fallbackBrief, userId, agentKey]);
      return;
    }

    const compileFastModel = aiCfg.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
      : FAST_MODEL;
    const skill = await callAINonStreaming(
      aiCfg.provider, apiKey, compileFastModel,
      `You are ${def.name} (${def.role}) on a marketing team equipped with ${MAGNIFIC_AGENT_TRAINING_SUMMARY}`,
      `Below is the user's brand/business memory. Write a concise 2-3 sentence "agent skill brief" summarizing what you know about this user that is most relevant to your specialty and how to apply Magnific One, Video, Lip Sync, Audio, or Spaces/Flows for their brand.\n\nUser memory:\n${memText}\n\nSkill brief:`,
      320,
      { userId, feature: 'agent_skill_compile' }
    );
    await dbQuery(`UPDATE user_agents SET compiled_skill=$1, last_compiled_at=NOW() WHERE user_id=$2 AND agent_key=$3`, [skill, userId, agentKey]);
    userCompilationHashes.set(`${userId}:${agentKey}`, hash);
  } catch (_err) { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batched & Deduplicated Agent Compilation (21 calls → 1 call, ~90% token savings)
// ─────────────────────────────────────────────────────────────────────────────
async function executeBatchedAgentCompilation(userId: string): Promise<void> {
  if (!pool) return;
  try {
    const { memText, hash } = await fetchUserMemoryContext(userId);
    if (!memText) return;

    // Skip if this exact memory state was already compiled for this user
    if (userCompilationHashes.get(userId) === hash) {
      recordBatchCompilationSavings(21, 14000);
      return;
    }

    const aiCfg = await getAIConfig();
    const apiKey = resolveActiveKey(aiCfg);
    const agentEntries = Object.entries(AGENT_DEFS).filter(([, d]) => d.role !== 'Credit Calculator');

    if (!apiKey) {
      for (const [key, def] of agentEntries) {
        const brief = `${def.name} (${def.role}): Focus on ${memText.slice(0, 220)} | ${MAGNIFIC_AGENT_TRAINING_SUMMARY}`;
        await dbQuery(`UPDATE user_agents SET compiled_skill=$1, last_compiled_at=NOW() WHERE user_id=$2 AND agent_key=$3`, [brief, userId, key]).catch(() => undefined);
      }
      userCompilationHashes.set(userId, hash);
      return;
    }

    const compileFastModel = aiCfg.provider === 'google'
      ? (GEMINI_MODELS.includes(aiCfg.model) ? aiCfg.model : 'gemini-2.0-flash')
      : FAST_MODEL;

    const rolesList = agentEntries.map(([k, d]) => `- "${k}": ${d.name} (${d.role})`).join('\n');
    const batchSystemPrompt = `You are the Chief AI Architect for Dakyworld Hub. Compile concise, high-signal 2-sentence skill briefs for each specialist agent based on the user's brand memory and our Magnific Multimodal Engine (${MAGNIFIC_AGENT_TRAINING_SUMMARY}). Respond ONLY with a valid JSON object mapping each agent_key to its brief string.`;
    const batchUserPrompt = `User Brand & Business Memory:\n${memText}\n\nSpecialist Agents:\n${rolesList}\n\nReturn JSON object: {"daky": "...", "nova": "...", ...}`;

    const raw = await callAINonStreaming(
      aiCfg.provider,
      apiKey,
      compileFastModel,
      batchSystemPrompt,
      batchUserPrompt,
      1400,
      { userId, feature: 'agent_skill_batch_compile' }
    );

    // Record that we saved 20 separate LLM calls + 20x duplicate input context tokens!
    recordBatchCompilationSavings(agentEntries.length - 1, Math.max(4000, memText.length * 5));

    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Record<string, string>;
      for (const [key, brief] of Object.entries(parsed)) {
        if (typeof brief === 'string' && AGENT_DEFS[key]) {
          await dbQuery(
            `UPDATE user_agents SET compiled_skill=$1, last_compiled_at=NOW() WHERE user_id=$2 AND agent_key=$3`,
            [brief.trim().slice(0, 600), userId, key]
          ).catch(() => undefined);
        }
      }
      userCompilationHashes.set(userId, hash);
    }
  } catch (_err) { /* non-fatal */ }
}

export async function triggerAgentCompilation(userId: string): Promise<void> {
  // Debounce rapid memory/profile saves (e.g. onboarding wizard or bulk edits) into 1 batched run
  const existing = userCompilationTimers.get(userId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    userCompilationTimers.delete(userId);
    void executeBatchedAgentCompilation(userId);
  }, 1500);
  userCompilationTimers.set(userId, timer);
}
