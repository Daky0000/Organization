import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { dbQuery } from '../../db.ts';
import { logger } from '../../logger.ts';
import {
  getAIConfig,
  resolveActiveKey,
  resolveGeminiModel,
  recordAIUsage,
  chargeAICredits,
  creditsForCostUsd,
  hasAICredits,
} from '../../ai-helpers.ts';
import { AGENT_DEFS } from '../../agent-helpers.ts';
import { invalidateSharedContext } from '../agentSharedContext.ts';
import {
  DIRECTOR_KEY,
  DIRECTOR_NAME,
  KPI_DEFS,
  type AgentMessageKind,
  type KpiObservation,
  type NicheFindings,
  type PerformanceSnapshot,
  type StrategyEvaluation,
  type StrategyKpi,
  type StrategyPlan,
  evaluateStrategy,
  extractJsonObject,
  formatKpiValue,
  handoffTargets,
  isStrategyKpi,
  normalizeFindings,
  normalizeStrategyPlan,
  pickPlaybook,
  resolveTarget,
  selectResearchFor,
  upstreamAgents,
} from './policy.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Agent team coordination.
//
// The user's agents work as one team instead of independent proposal
// generators:
//
//  - agent_messages is their channel. Agents leave requests, handoffs,
//    insights and alerts for each other; the director sends directives. Each
//    agent reads its inbox when it next runs.
//  - Helm, the performance director, owns one active strategy at a time. It
//    is recorded with its rationale, the KPI it is judged on, a baseline, a
//    target and an evaluation window. Reviews compare the KPI with the target
//    and replace a strategy that keeps missing, logging why.
//  - niche_research holds what the team learned about the user's niche from
//    web research; each agent gets the slice it needs.
//  - buildAgentBriefing() assembles all of this for one agent at the moment
//    it runs, so the right context reaches the right agent.
// ─────────────────────────────────────────────────────────────────────────────

export const DIRECTOR_MODEL = 'claude-opus-5-5';
const RESEARCH_MAX_AGE_DAYS = 7;
const WEB_SEARCH_USD = 0.01;
const DAY_MS = 24 * 60 * 60 * 1000;

export const KNOWN_AGENT_KEYS = Object.keys(AGENT_DEFS);

export function agentDisplayName(key: string): string {
  if (key === DIRECTOR_KEY) return DIRECTOR_NAME;
  if (key === 'user') return 'The user';
  if (key === '*') return 'Whole team';
  return AGENT_DEFS[key]?.name ?? key;
}

// ── Messages ────────────────────────────────────────────────────────────────

export type AgentMessageInput = {
  from: string;
  to: string;
  kind: AgentMessageKind;
  subject: string;
  body: string;
  context?: Record<string, unknown>;
  priority?: number;
  ttlDays?: number;
};

export async function postAgentMessage(userId: string, msg: AgentMessageInput): Promise<string | null> {
  try {
    const { rows } = await dbQuery(
      `INSERT INTO agent_messages (user_id, from_agent, to_agent, kind, subject, body, context, priority, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() + ($9::int * INTERVAL '1 day')) RETURNING id`,
      [
        userId, msg.from, msg.to, msg.kind,
        msg.subject.slice(0, 140), msg.body.slice(0, 2000),
        JSON.stringify(msg.context ?? {}), msg.priority ?? 0,
        Math.min(60, Math.max(1, Math.round(msg.ttlDays ?? 14))),
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.warn({ err, userId, from: msg.from, to: msg.to }, 'agent_message_post_failed');
    return null;
  }
}

export type InboxMessage = { id: string; from: string; kind: string; subject: string; body: string; created_at: string };

// Open messages for an agent: addressed to it or to the whole team, not yet
// read by it. Directives and alerts come first.
export async function readAgentInbox(userId: string, agentKey: string, limit = 8): Promise<InboxMessage[]> {
  const { rows } = await dbQuery(
    `SELECT id, from_agent, kind, subject, body, created_at FROM agent_messages
      WHERE user_id = $1 AND to_agent IN ($2, '*') AND status = 'open' AND expires_at > NOW()
        AND from_agent <> $2 AND NOT ($2 = ANY(consumed_by))
      ORDER BY priority DESC, created_at DESC LIMIT $3`,
    [userId, agentKey, limit],
  ).catch(() => ({ rows: [] as any[] }));
  return rows.map((r: any) => ({ id: r.id, from: r.from_agent, kind: r.kind, subject: r.subject, body: r.body, created_at: r.created_at }));
}

// Marks messages read by an agent. A message addressed to the agent alone is
// done once read; team-wide messages stay open for the others.
export async function markInboxConsumed(userId: string, agentKey: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await dbQuery(
    `UPDATE agent_messages
        SET consumed_by = CASE WHEN $2 = ANY(consumed_by) THEN consumed_by ELSE array_append(consumed_by, $2) END,
            status = CASE WHEN to_agent = $2 THEN 'consumed' ELSE status END
      WHERE user_id = $1 AND id = ANY($3::uuid[])`,
    [userId, agentKey, ids],
  ).catch((err) => logger.warn({ err, userId, agentKey }, 'agent_inbox_consume_failed'));
}

export async function listAgentMessages(userId: string, opts: { agent?: string; limit?: number } = {}): Promise<any[]> {
  const params: unknown[] = [userId];
  let filter = '';
  if (opts.agent) {
    params.push(opts.agent);
    filter = `AND (from_agent = $2 OR to_agent = $2)`;
  }
  params.push(Math.min(200, Math.max(1, opts.limit ?? 50)));
  const { rows } = await dbQuery(
    `SELECT id, from_agent, to_agent, kind, subject, body, status, consumed_by, created_at, expires_at
       FROM agent_messages WHERE user_id = $1 ${filter}
      ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r: any) => ({ ...r, from_name: agentDisplayName(r.from_agent), to_name: agentDisplayName(r.to_agent) }));
}

// Tells the agents downstream of an approved proposal to build on it.
export async function handOffApprovedWork(userId: string, task: { id: string; agent_key: string; task_type: string; title: string; body?: string }): Promise<number> {
  const targets = handoffTargets(task.agent_key).filter((k) => k === DIRECTOR_KEY || KNOWN_AGENT_KEYS.includes(k));
  let sent = 0;
  for (const to of targets) {
    const id = await postAgentMessage(userId, {
      from: task.agent_key,
      to,
      kind: 'handoff',
      subject: `Approved: ${task.title}`.slice(0, 140),
      body: `The user approved this ${task.task_type.replace(/_/g, ' ')} from ${agentDisplayName(task.agent_key)}. Build on it where it fits your role.\n\n${String(task.body ?? '').slice(0, 600)}`,
      context: { task_id: task.id },
      priority: 1,
    });
    if (id) sent++;
  }
  return sent;
}

// ── Performance ─────────────────────────────────────────────────────────────

export type AgentApproval = { agent_key: string; approved: number; rejected: number; rate: number | null };

export async function computePerformance(userId: string, since: Date): Promise<{ snapshot: PerformanceSnapshot; byAgent: AgentApproval[] }> {
  const empty: KpiObservation = { value: null, sample: 0 };
  const snapshot: PerformanceSnapshot = {
    approval_rate: { ...empty },
    engagement_rate: { ...empty },
    publish_success_rate: { ...empty },
    posts_published: { value: 0, sample: 0 },
  };
  let byAgent: AgentApproval[] = [];

  try {
    const { rows } = await dbQuery(
      `SELECT agent_key,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM user_agent_tasks
        WHERE user_id = $1 AND status IN ('approved','rejected') AND decided_at >= $2
        GROUP BY agent_key`,
      [userId, since],
    );
    byAgent = rows.map((r: any) => {
      const decided = Number(r.approved) + Number(r.rejected);
      return { agent_key: r.agent_key, approved: Number(r.approved), rejected: Number(r.rejected), rate: decided ? Number(r.approved) / decided : null };
    });
    const approved = byAgent.reduce((a, r) => a + r.approved, 0);
    const decided = byAgent.reduce((a, r) => a + r.approved + r.rejected, 0);
    snapshot.approval_rate = { value: decided ? approved / decided : null, sample: decided };
  } catch (err) { logger.warn({ err, userId }, 'agent_perf_approval_failed'); }

  try {
    const { rows } = await dbQuery(
      `SELECT COUNT(*) FILTER (WHERE reach_base > 0)::int AS posts,
              COALESCE(SUM(interactions) FILTER (WHERE reach_base > 0), 0)::float AS interactions,
              COALESCE(SUM(reach_base) FILTER (WHERE reach_base > 0), 0)::float AS reach
         FROM (
           SELECT COALESCE(NULLIF(engagement, 0), COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0) + COALESCE(saves,0)) AS interactions,
                  COALESCE(NULLIF(impressions, 0), reach, 0) AS reach_base
             FROM social_metrics
            WHERE user_id = $1 AND COALESCE(posted_at, created_at) >= $2
         ) m`,
      [userId, since],
    );
    const r = rows[0];
    if (r && Number(r.posts) > 0 && Number(r.reach) > 0) {
      snapshot.engagement_rate = { value: Number(r.interactions) / Number(r.reach), sample: Number(r.posts) };
    }
  } catch (err) { logger.warn({ err, userId }, 'agent_perf_engagement_failed'); }

  try {
    const { rows } = await dbQuery(
      `SELECT COUNT(*) FILTER (WHERE status = 'published')::int AS published,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM publishing_logs
        WHERE user_id = $1 AND COALESCE(posted_at, created_at) >= $2`,
      [userId, since],
    );
    const published = Number(rows[0]?.published ?? 0);
    const failed = Number(rows[0]?.failed ?? 0);
    snapshot.posts_published = { value: published, sample: published + failed };
    snapshot.publish_success_rate = { value: published + failed ? published / (published + failed) : null, sample: published + failed };
  } catch (err) { logger.warn({ err, userId }, 'agent_perf_publishing_failed'); }

  return { snapshot, byAgent };
}

function describeSnapshot(snapshot: PerformanceSnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(KPI_DEFS) as StrategyKpi[]) {
    out[k] = `${formatKpiValue(k, snapshot[k].value)} (${snapshot[k].sample} data points)`;
  }
  return out;
}

// ── Strategy records ────────────────────────────────────────────────────────

export type StrategyRow = {
  id: string;
  playbook: string;
  title: string;
  hypothesis: string;
  rationale: string;
  evidence: string[];
  focus: Record<string, string>;
  kpi: StrategyKpi;
  baseline: number | null;
  target: number;
  eval_window_days: number;
  status: string;
  created_by: string;
  started_at: string;
  last_evaluated_at: string | null;
  last_value: number | null;
  last_verdict: string | null;
  consecutive_misses: number;
  ended_at: string | null;
  ended_reason: string | null;
  superseded_by: string | null;
};

function mapStrategy(r: any): StrategyRow {
  return {
    ...r,
    kpi: isStrategyKpi(r.kpi) ? r.kpi : 'approval_rate',
    baseline: r.baseline === null || r.baseline === undefined ? null : Number(r.baseline),
    target: Number(r.target),
    last_value: r.last_value === null || r.last_value === undefined ? null : Number(r.last_value),
    evidence: Array.isArray(r.evidence) ? r.evidence : [],
    focus: r.focus && typeof r.focus === 'object' ? r.focus : {},
  };
}

export async function getActiveStrategy(userId: string): Promise<StrategyRow | null> {
  const { rows } = await dbQuery(`SELECT * FROM agent_strategies WHERE user_id = $1 AND status = 'active' LIMIT 1`, [userId]).catch(() => ({ rows: [] as any[] }));
  return rows[0] ? mapStrategy(rows[0]) : null;
}

export async function listStrategies(userId: string, limit = 10): Promise<StrategyRow[]> {
  const { rows } = await dbQuery(`SELECT * FROM agent_strategies WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
  return rows.map(mapStrategy);
}

export async function listStrategyReviews(userId: string, strategyId: string, limit = 20): Promise<any[]> {
  const { rows } = await dbQuery(
    `SELECT id, kpi, value, sample, verdict, notes, created_at FROM agent_strategy_reviews WHERE user_id = $1 AND strategy_id = $2 ORDER BY created_at DESC LIMIT $3`,
    [userId, strategyId, limit],
  );
  return rows;
}

function measurementStart(strategy: StrategyRow, now: Date): Date {
  const windowStart = new Date(now.getTime() - strategy.eval_window_days * DAY_MS);
  const started = new Date(strategy.started_at);
  return started > windowStart ? started : windowStart;
}

// ── Research ────────────────────────────────────────────────────────────────

export type ResearchRow = { id: string; niche: string; findings: NicheFindings; sources: Array<{ title: string; url: string }>; method: string; created_at: string };

export async function getLatestResearch(userId: string): Promise<ResearchRow | null> {
  const { rows } = await dbQuery(
    `SELECT id, niche, findings, sources, method, created_at FROM niche_research WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  return rows[0] ?? null;
}

type TeamAI = { provider: 'anthropic' | 'google'; apiKey: string };

async function resolveTeamAI(): Promise<TeamAI | null> {
  try {
    const cfg = await getAIConfig();
    const apiKey = resolveActiveKey(cfg);
    if (apiKey) return { provider: cfg.provider === 'google' ? 'google' : 'anthropic', apiKey };
  } catch { /* fall through */ }
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  const google = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  return google ? { provider: 'google', apiKey: google } : null;
}

type ModelReply = { text: string; sources: Array<{ title: string; url: string }>; searched: boolean };

// One Claude request that may search the web. Server-side fallbacks keep the
// call answering when a safety classifier declines; pause_turn continues a
// long search turn.
async function callClaude(
  apiKey: string,
  args: { system: string; user: string; maxTokens: number; webSearch: boolean; userId: string; feature: string },
): Promise<ModelReply> {
  const client = new Anthropic({ apiKey });
  const messages: any[] = [{ role: 'user', content: args.user }];
  const sources: Array<{ title: string; url: string }> = [];
  let searches = 0;
  let useFallbacks = true;
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const body: any = {
      model: DIRECTOR_MODEL,
      max_tokens: args.maxTokens,
      system: args.system,
      messages,
      output_config: { effort: 'medium' },
      ...(args.webSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }] } : {}),
    };
    let resp: any;
    try {
      resp = useFallbacks
        ? await client.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any)
        : await client.messages.create(body);
    } catch (err) {
      // An account without the fallback beta rejects the parameter; retry
      // the same turn without it.
      if (useFallbacks && err instanceof Anthropic.BadRequestError) {
        useFallbacks = false;
        turn--;
        continue;
      }
      throw err;
    }
    const usage = resp.usage ?? {};
    void recordAIUsage({
      userId: args.userId, feature: args.feature, provider: 'anthropic', model: String(resp.model || DIRECTOR_MODEL),
      inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    });
    searches += Number(usage.server_tool_use?.web_search_requests ?? 0);
    for (const block of resp.content ?? []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r?.url && !sources.some((s) => s.url === r.url)) sources.push({ title: String(r.title || r.url).slice(0, 200), url: String(r.url) });
        }
      }
    }
    if (resp.stop_reason === 'refusal') throw new Error('The model declined this request');
    if (resp.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: resp.content });
      continue;
    }
    text = (resp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    break;
  }
  if (searches > 0) {
    await chargeAICredits(args.userId, creditsForCostUsd(searches * WEB_SEARCH_USD), `ai_${args.feature}_search`.slice(0, 60), { web_searches: searches })
      .catch((err) => logger.warn({ err }, 'agent_search_charge_failed'));
  }
  return { text, sources: sources.slice(0, 20), searched: searches > 0 };
}

async function callGemini(
  apiKey: string,
  args: { system: string; user: string; webSearch: boolean; userId: string; feature: string },
): Promise<ModelReply> {
  const model = resolveGeminiModel(DIRECTOR_MODEL);
  const genAI = new GoogleGenerativeAI(apiKey);
  const gModel = genAI.getGenerativeModel({
    model,
    systemInstruction: args.system,
    ...(args.webSearch ? { tools: [{ googleSearch: {} } as any] } : {}),
  });
  const result = await gModel.generateContent(args.user);
  const text = result.response.text();
  const meta = result.response.usageMetadata;
  void recordAIUsage({
    userId: args.userId, feature: args.feature, provider: 'google', model,
    inputTokens: meta?.promptTokenCount ?? Math.ceil((args.system.length + args.user.length) / 4),
    outputTokens: meta?.candidatesTokenCount ?? Math.ceil(text.length / 4),
  });
  const chunks: any[] = (result.response.candidates?.[0] as any)?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c) => c?.web)
    .filter((w) => w?.uri)
    .map((w) => ({ title: String(w.title || w.uri).slice(0, 200), url: String(w.uri) }))
    .slice(0, 20);
  return { text, sources, searched: args.webSearch && sources.length > 0 };
}

// Asks the configured model, with web search when wanted; when search is not
// available on the account, asks again without it.
async function askModel(
  ai: TeamAI,
  args: { system: string; user: string; maxTokens: number; webSearch: boolean; userId: string; feature: string },
): Promise<ModelReply> {
  const call = (webSearch: boolean) => (ai.provider === 'google'
    ? callGemini(ai.apiKey, { ...args, webSearch })
    : callClaude(ai.apiKey, { ...args, webSearch }));
  if (!args.webSearch) return call(false);
  try {
    return await call(true);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), userId: args.userId }, 'agent_web_search_unavailable');
    return call(false);
  }
}

const RESEARCH_SYSTEM = `You are the research lead on a small business's AI marketing team.
You research the business's niche so the strategy, content and ads agents decide from evidence instead of guesses.
Search the web for what is current: rising topics and formats from roughly the last six months, how competitors position themselves, what the audience complains about and asks for, and the search terms buyers use.
Report only what your sources support or what is well-established in the niche. Do not invent statistics, follower counts or growth percentages.
Reply with one JSON object and nothing else.`;

function researchPrompt(brand: any, connectedPlatforms: string[] = [], verifiedContext: string = ''): string {
  const platforms = connectedPlatforms.length
    ? connectedPlatforms
    : (Array.isArray(brand.platforms) && brand.platforms.length ? brand.platforms : ['Instagram', 'LinkedIn', 'X']);

  return `Research this business's niche and analyze top-performing accounts across its connected social media platforms.

Business: ${brand.brand_name || 'unnamed'}
Niche: ${brand.niche}
Audience: ${brand.audience || 'not specified'}
Website: ${brand.website || 'none'}
Connected / Priority Platforms: ${platforms.join(', ')}
Goals: ${Array.isArray(brand.goals) && brand.goals.length ? brand.goals.join('; ') : 'not specified'}
${verifiedContext ? `\nVerified Business Details & Offerings (Ground Truth):\n${verifiedContext}\n` : ''}

For the connected platforms (${platforms.join(', ')}), search for popular accounts and creators in this exact niche. Look through what has been working for them (top formats, hook types, visual structures, engagement drivers) and identify what will work for this business based strictly on their verified offerings and context without assuming unverified information.

Return JSON in exactly this shape:
{
  "summary": "3-4 sentences: the state of the niche right now and what it means for this business",
  "trends": [{"name": "trend", "why": "evidence it is rising and why it matters here", "angle": "content angle this business could take"}],
  "audience": {"pains": ["specific pain in the audience's words"], "desires": ["..."], "objections": ["objection to buying"]},
  "competitors": [{"name": "competitor or competitor type", "positioning": "how they position", "gap": "what they leave open"}],
  "keywords": [{"term": "search term", "intent": "informational|commercial|transactional"}],
  "content_formats": [{"format": "format", "platform": "platform", "why": "why it works in this niche now"}],
  "opportunities": ["specific, actionable opportunity for this business"],
  "platform_benchmarks": [
    {
      "platform": "Platform name (e.g. Instagram, TikTok, LinkedIn, X, Facebook, Pinterest, Threads)",
      "top_accounts": [
        {
          "handle": "@handle or account name",
          "name": "display name or creator descriptor",
          "why_popular": "why their content wins in this niche",
          "top_formats": ["e.g. 4-slide carousels", "POV reels"],
          "winning_hooks": ["e.g. 3 subtle signs..."]
        }
      ],
      "what_works": "1-2 sentences on what format and style converts best on this platform in this niche",
      "what_to_avoid": "1 sentence on low-performing content in this niche"
    }
  ]
}
Give 3-6 items per list. Ground recommendations strictly in the verified business facts; never invent imaginary offerings or fake statistics.`;
}

export type ResearchOutcome = { ok: true; research: ResearchRow } | { ok: false; status: number; error: string };

export async function runNicheResearch(userId: string): Promise<ResearchOutcome> {
  const { rows } = await dbQuery(
    `SELECT brand_name, niche, audience, website, platforms, goals FROM brand_profiles WHERE user_id = $1`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  const brand = rows[0];
  if (!brand || !String(brand.niche || '').trim()) {
    return { ok: false, status: 422, error: 'Add your niche to the brand profile so the team knows what to research.' };
  }
  const ai = await resolveTeamAI();
  if (!ai) return { ok: false, status: 503, error: 'No AI provider is configured, so the team cannot research yet.' };
  if (!(await hasAICredits(userId))) return { ok: false, status: 402, error: 'You need more AI credits to run niche research.' };

  // Fetch connected social accounts to inspect actual active platforms
  const { rows: connectedAccounts } = await dbQuery<{ platform: string; handle: string }>(
    `SELECT platform, handle FROM social_accounts WHERE user_id = $1 AND connected = true`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));

  const connectedPlatforms = Array.from(new Set([
    ...connectedAccounts.map((a) => a.platform),
    ...(Array.isArray(brand.platforms) ? brand.platforms : []),
  ])).filter(Boolean);

  // Fetch verified memories (offerings, services, about, website snapshot)
  const { rows: memRows } = await dbQuery<{ title: string; content: string }>(
    `SELECT title, content FROM user_memories WHERE user_id = $1 AND category IN ('brand','business','website') LIMIT 10`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  const verifiedContext = memRows.map((m) => `${m.title}: ${m.content}`).join('\n');

  let reply: ModelReply;
  try {
    reply = await askModel(ai, {
      system: RESEARCH_SYSTEM,
      user: researchPrompt(brand, connectedPlatforms, verifiedContext),
      maxTokens: 6000,
      webSearch: true,
      userId,
      feature: 'agent_niche_research',
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), userId }, 'niche_research_failed');
    return { ok: false, status: 502, error: 'Research could not be completed. Try again shortly.' };
  }
  const findings = normalizeFindings(extractJsonObject(reply.text));
  if (!findings) return { ok: false, status: 502, error: 'Research came back empty. Try again shortly.' };

  const method = reply.searched ? 'web_search' : 'model_knowledge';
  const { rows: saved } = await dbQuery(
    `INSERT INTO niche_research (user_id, niche, findings, sources, method) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, niche, findings, sources, method, created_at`,
    [userId, String(brand.niche).trim(), JSON.stringify(findings), JSON.stringify(reply.sources), method],
  );
  // Keep the last ten runs; older ones are superseded.
  await dbQuery(
    `DELETE FROM niche_research WHERE user_id = $1 AND id NOT IN (SELECT id FROM niche_research WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10)`,
    [userId],
  ).catch(() => undefined);
  invalidateSharedContext(userId);

  const benchCount = findings.platform_benchmarks?.length || 0;
  await postAgentMessage(userId, {
    from: 'trend_research',
    to: '*',
    kind: 'insight',
    subject: `New ${String(brand.niche).slice(0, 50)} research & platform benchmarks in`,
    body: `${findings.summary}${benchCount > 0 ? `\nAnalyzed top accounts & winning formats across ${findings.platform_benchmarks!.map((p) => p.platform).join(', ')}.` : ''}${findings.trends[0] ? `\nTop trend: ${findings.trends[0].name}.` : ''}${method === 'model_knowledge' ? '\n(Web search was unavailable; this is from general knowledge, so treat it as a starting point.)' : ''}`,
    priority: 1,
    ttlDays: RESEARCH_MAX_AGE_DAYS,
  });
  return { ok: true, research: saved[0] };
}

function researchIsStale(research: ResearchRow | null, niche: string, now: Date): boolean {
  if (!research) return true;
  if (String(research.niche).trim().toLowerCase() !== niche.trim().toLowerCase()) return true;
  return now.getTime() - new Date(research.created_at).getTime() > RESEARCH_MAX_AGE_DAYS * DAY_MS;
}

// ── Director ────────────────────────────────────────────────────────────────

const DIRECTOR_SYSTEM = `You are ${DIRECTOR_NAME}, the performance director of a small business's AI marketing team.
You watch the team's results, choose the one strategy the whole team follows, and replace it when the numbers say it is not working.
A strategy must be specific to this business and niche, measurable on a KPI the workspace records, and justified by the evidence you are given: performance data, niche research, the user's approval history and teammates' alerts.
If you are replacing a strategy, say what failed and why the new one should do better; do not bring back a strategy that already failed unless you name what is different.
Reply with one JSON object and nothing else.`;

function directorPrompt(input: {
  brand: any;
  research: ResearchRow | null;
  perf: PerformanceSnapshot;
  byAgent: AgentApproval[];
  history: StrategyRow[];
  alerts: InboxMessage[];
  replacing: { strategy: StrategyRow; reason: string } | null;
}): string {
  const kpis = (Object.keys(KPI_DEFS) as StrategyKpi[]).map((k) => `${k} (${KPI_DEFS[k].label}${KPI_DEFS[k].isRate ? ', a 0-1 rate' : ', a count per window'})`).join('; ');
  const agents = Object.entries(AGENT_DEFS).filter(([k]) => !['calculator', 'sales_caller'].includes(k)).map(([k, v]) => `${k} (${v.role})`).join(', ');
  return `Choose the team's strategy.

Business: ${JSON.stringify({ name: input.brand.brand_name, niche: input.brand.niche, tone: input.brand.tone, audience: input.brand.audience, goals: input.brand.goals, platforms: input.brand.platforms })}

Performance over the last 14 days: ${JSON.stringify(describeSnapshot(input.perf))}
Approval by agent: ${JSON.stringify(input.byAgent.map((a) => ({ agent: a.agent_key, approved: a.approved, rejected: a.rejected })))}

Niche research${input.research ? ` (${input.research.method === 'web_search' ? 'from web search' : 'from general knowledge'}, ${new Date(input.research.created_at).toISOString().slice(0, 10)})` : ''}: ${input.research ? JSON.stringify(selectResearchFor(DIRECTOR_KEY, input.research.findings as any)) : 'none yet'}

Strategy history (newest first): ${JSON.stringify(input.history.slice(0, 5).map((s) => ({ title: s.title, kpi: s.kpi, status: s.status, last_verdict: s.last_verdict, ended_reason: s.ended_reason })))}
${input.replacing ? `\nYou are replacing "${input.replacing.strategy.title}" because: ${input.replacing.reason}\n` : ''}
Alerts from teammates: ${input.alerts.length ? JSON.stringify(input.alerts.map((a) => ({ from: a.from, subject: a.subject, body: a.body.slice(0, 300) }))) : 'none'}

Agents you can direct: ${agents}
KPIs you can judge on: ${kpis}. Prefer one with data points above.

Return JSON in exactly this shape:
{
  "title": "short strategy name",
  "hypothesis": "what we expect to happen and why",
  "rationale": "why this strategy, for this business, now, citing the specific evidence above",
  "kpi": "one KPI key",
  "target": 0.0,
  "eval_window_days": 14,
  "focus": {"agent_key": "what this agent should do differently under this strategy"},
  "evidence": ["each fact from the input that supports it"]
}
Give focus for the 3-6 agents that matter most to this strategy.`;
}

async function planStrategy(
  userId: string,
  input: Parameters<typeof directorPrompt>[0],
): Promise<StrategyPlan> {
  const ai = await resolveTeamAI();
  if (ai && (await hasAICredits(userId))) {
    try {
      const reply = await askModel(ai, { system: DIRECTOR_SYSTEM, user: directorPrompt(input), maxTokens: 4000, webSearch: false, userId, feature: 'agent_director' });
      const plan = normalizeStrategyPlan(extractJsonObject(reply.text), input.perf, KNOWN_AGENT_KEYS);
      if (plan) return plan;
      logger.warn({ userId }, 'director_plan_unusable');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), userId }, 'director_plan_failed');
    }
  }
  // Built-in playbook: never repeat one that failed in the last 60 days.
  const failed = input.history
    .filter((s) => s.status === 'superseded' && s.ended_at && Date.now() - new Date(s.ended_at).getTime() < 60 * DAY_MS)
    .map((s) => s.playbook);
  if (input.replacing) failed.push(input.replacing.strategy.playbook);
  const findings = input.research?.findings as NicheFindings | undefined;
  return pickPlaybook({
    perf: input.perf,
    niche: String(input.brand.niche || ''),
    topTrend: findings?.trends?.[0]?.name ?? null,
    topPain: findings?.audience?.pains?.[0] ?? null,
    excludedPlaybooks: failed,
  });
}

async function adoptStrategy(
  userId: string,
  plan: StrategyPlan,
  replacing: { strategy: StrategyRow; reason: string } | null,
  createdBy: string,
): Promise<StrategyRow> {
  const now = new Date();
  const { snapshot } = await computePerformance(userId, new Date(now.getTime() - plan.evalWindowDays * DAY_MS));
  const baseline = snapshot[plan.kpi].sample >= KPI_DEFS[plan.kpi].minSample ? snapshot[plan.kpi].value : null;
  const target = resolveTarget(plan.kpi, plan.evalWindowDays, baseline, plan.target);
  const rationale = replacing && plan.playbook !== 'director_plan'
    ? `Replaces "${replacing.strategy.title}": ${replacing.reason} ${plan.rationale}`
    : plan.rationale;
  const evidence = [...plan.evidence];
  if (replacing) evidence.push(`previous strategy "${replacing.strategy.title}" ended: ${replacing.reason}`);

  if (replacing) {
    await dbQuery(
      `UPDATE agent_strategies SET status = 'superseded', ended_at = NOW(), ended_reason = $3 WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [replacing.strategy.id, userId, replacing.reason.slice(0, 1000)],
    );
  }
  const { rows } = await dbQuery(
    `INSERT INTO agent_strategies (user_id, playbook, title, hypothesis, rationale, evidence, focus, kpi, baseline, target, eval_window_days, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [userId, plan.playbook, plan.title, plan.hypothesis, rationale.slice(0, 2000), JSON.stringify(evidence.slice(0, 10)), JSON.stringify(plan.focus), plan.kpi, baseline, target, plan.evalWindowDays, createdBy],
  );
  const strategy = mapStrategy(rows[0]);
  if (replacing) {
    await dbQuery(`UPDATE agent_strategies SET superseded_by = $1 WHERE id = $2`, [strategy.id, replacing.strategy.id]).catch(() => undefined);
  }

  // Directives from the old strategy no longer apply.
  await dbQuery(
    `UPDATE agent_messages SET status = 'superseded' WHERE user_id = $1 AND from_agent = $2 AND kind = 'directive' AND status = 'open'`,
    [userId, DIRECTOR_KEY],
  ).catch(() => undefined);
  const measure = `Judged on ${KPI_DEFS[strategy.kpi].label.toLowerCase()}: ${baseline === null ? 'no baseline yet' : `baseline ${formatKpiValue(strategy.kpi, baseline)}`}, target ${formatKpiValue(strategy.kpi, target)}, reviewed after ${strategy.eval_window_days} days.`;
  await postAgentMessage(userId, {
    from: DIRECTOR_KEY, to: '*', kind: 'directive', priority: 3, ttlDays: 60,
    subject: `Team strategy: ${strategy.title}`,
    body: `${strategy.hypothesis}\nWhy: ${strategy.rationale}\n${measure}`,
    context: { strategy_id: strategy.id },
  });
  for (const [agent, directive] of Object.entries(strategy.focus)) {
    await postAgentMessage(userId, {
      from: DIRECTOR_KEY, to: agent, kind: 'directive', priority: 2, ttlDays: 60,
      subject: `Your focus under "${strategy.title}"`.slice(0, 140),
      body: directive,
      context: { strategy_id: strategy.id },
    });
  }
  await dbQuery(
    `INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1,'agent_strategy',$2,$3,$4)`,
    [
      userId,
      replacing ? `${DIRECTOR_NAME} changed your team's strategy` : `${DIRECTOR_NAME} set your team's strategy`,
      replacing ? `"${replacing.strategy.title}" was not working. New strategy: ${strategy.title}.` : `Strategy: ${strategy.title}. ${measure}`,
      JSON.stringify({ strategy_id: strategy.id, replaced: replacing?.strategy.id ?? null, link: '/ai-team' }),
    ],
  ).catch(() => undefined);
  invalidateSharedContext(userId);
  return strategy;
}

export type DirectorReviewResult = {
  skipped?: string;
  research_refreshed: boolean;
  research_error?: string;
  strategy: StrategyRow | null;
  evaluation: StrategyEvaluation | null;
  switched: boolean;
  previous_strategy?: { id: string; title: string; reason: string };
  dispatched_requests: number;
};

export type AgentRunner = (userId: string, agentKey: string, reason: string) => Promise<number>;

// One review: refresh research when stale, judge the active strategy,
// replace it when it is failing, and wake agents that teammates asked for help.
export async function runDirectorReview(
  userId: string,
  opts: { force?: boolean; replace?: boolean; runAgent?: AgentRunner; now?: Date } = {},
): Promise<DirectorReviewResult> {
  const now = opts.now ?? new Date();
  const result: DirectorReviewResult = { research_refreshed: false, strategy: null, evaluation: null, switched: false, dispatched_requests: 0 };
  const { rows: brandRows } = await dbQuery(
    `SELECT brand_name, niche, tone, audience, goals, platforms FROM brand_profiles WHERE user_id = $1`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  const brand = brandRows[0];
  if (!brand || (!String(brand.niche || '').trim() && !String(brand.brand_name || '').trim())) {
    return { ...result, skipped: 'no_brand_profile' };
  }

  let research = await getLatestResearch(userId);
  if (String(brand.niche || '').trim() && researchIsStale(research, String(brand.niche), now)) {
    const outcome = await runNicheResearch(userId);
    if (outcome.ok) {
      research = outcome.research;
      result.research_refreshed = true;
    } else {
      result.research_error = outcome.error;
    }
  }

  const history = await listStrategies(userId, 10);
  let active = history.find((s) => s.status === 'active') ?? null;
  const alerts = await readAgentInbox(userId, DIRECTOR_KEY, 10);
  let replacing: { strategy: StrategyRow; reason: string } | null = null;

  if (active) {
    const { snapshot } = await computePerformance(userId, measurementStart(active, now));
    const observed = snapshot[active.kpi];
    const evaluation = evaluateStrategy({
      kpi: active.kpi,
      baseline: active.baseline,
      target: active.target,
      evalWindowDays: active.eval_window_days,
      startedAt: new Date(active.started_at),
      lastEvaluatedAt: active.last_evaluated_at ? new Date(active.last_evaluated_at) : null,
      consecutiveMisses: active.consecutive_misses,
    }, observed, now);
    result.evaluation = evaluation;
    const counted = evaluation.counted || Boolean(opts.force);
    await dbQuery(
      `UPDATE agent_strategies
          SET last_value = $3, last_verdict = $4, consecutive_misses = $5,
              last_evaluated_at = CASE WHEN $6 THEN NOW() ELSE last_evaluated_at END
        WHERE id = $1 AND user_id = $2`,
      [active.id, userId, observed.value, evaluation.verdict, evaluation.consecutiveMisses, evaluation.counted],
    );
    if (counted) {
      await dbQuery(
        `INSERT INTO agent_strategy_reviews (strategy_id, user_id, kpi, value, sample, verdict, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [active.id, userId, active.kpi, observed.value, observed.sample, evaluation.shouldSwitch ? 'switched' : evaluation.verdict, evaluation.reason],
      );
    }
    if (evaluation.shouldSwitch) {
      replacing = { strategy: active, reason: evaluation.reason };
      // Refresh niche research on pivot so new strategy is built on fresh competitor insights
      try {
        const refreshOutcome = await runNicheResearch(userId);
        if (refreshOutcome.ok) {
          research = refreshOutcome.research;
          result.research_refreshed = true;
        }
      } catch (_e) { /* non-fatal */ }
    } else if (opts.replace) {
      replacing = { strategy: active, reason: 'You asked the director for a new strategy.' };
    } else if (evaluation.verdict === 'on_track' || evaluation.verdict === 'progressing') {
      if (counted) {
        await postAgentMessage(userId, {
          from: DIRECTOR_KEY, to: '*', kind: 'directive', priority: 1, ttlDays: active.eval_window_days,
          subject: `Double Down: "${active.title}" is hitting performance targets`,
          body: `Strategy review confirms ${active.kpi} reached ${formatKpiValue(active.kpi, observed.value)}. Double down on what is working: scale the winning content pillars, spin off top-performing hooks into new formats, and maintain consistent publishing cadence.`,
          context: { strategy_id: active.id, verdict: 'doubling_down' },
        });
      }
    } else if (evaluation.verdict === 'underperforming' && evaluation.counted) {
      // Warn the team before the switch so they can adjust.
      await postAgentMessage(userId, {
        from: DIRECTOR_KEY, to: '*', kind: 'directive', priority: 2, ttlDays: active.eval_window_days,
        subject: `"${active.title}" is behind target`,
        body: `${evaluation.reason} Tighten your proposals around the strategy's focus; it will be replaced if the next review is also behind.`,
        context: { strategy_id: active.id },
      });
    }
  }

  if (!active || replacing) {
    const { snapshot, byAgent } = await computePerformance(userId, new Date(now.getTime() - 14 * DAY_MS));
    const plan = await planStrategy(userId, { brand, research, perf: snapshot, byAgent, history, alerts, replacing });
    active = await adoptStrategy(userId, plan, replacing, DIRECTOR_KEY);
    result.switched = Boolean(replacing);
    if (replacing) result.previous_strategy = { id: replacing.strategy.id, title: replacing.strategy.title, reason: replacing.reason };
  }
  result.strategy = active;
  await markInboxConsumed(userId, DIRECTOR_KEY, alerts.map((a) => a.id));

  // Requests between agents are answered when the recipient next runs; wake
  // up to two recipients that have been waiting over an hour.
  if (opts.runAgent) {
    const { rows: waiting } = await dbQuery(
      `SELECT DISTINCT ON (to_agent) to_agent FROM agent_messages
        WHERE user_id = $1 AND kind = 'request' AND status = 'open' AND to_agent NOT IN ('*', $2)
          AND expires_at > NOW() AND created_at < NOW() - INTERVAL '1 hour'
        ORDER BY to_agent, priority DESC, created_at ASC LIMIT 2`,
      [userId, DIRECTOR_KEY],
    ).catch(() => ({ rows: [] as any[] }));
    for (const w of waiting) {
      if (!(await hasAICredits(userId))) break;
      try {
        await opts.runAgent(userId, w.to_agent, 'teammate_request');
        result.dispatched_requests++;
      } catch (err) {
        logger.warn({ err, userId, agent: w.to_agent }, 'director_dispatch_failed');
      }
    }
  }

  await dbQuery(
    `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value) VALUES ($1,$2,'meta','meta:last_review_at',$3)
     ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, DIRECTOR_KEY, now.toISOString()],
  ).catch(() => undefined);
  return result;
}

// Hourly: review users whose agents are in use and who were not reviewed in
// the last day. The last review time is an ISO string, compared as text so
// no other memory value is ever cast.
export async function runDirectorCycle(runAgent?: AgentRunner, maxUsers = 20): Promise<void> {
  try {
    const { rows } = await dbQuery(
      `SELECT b.user_id FROM brand_profiles b
        WHERE (COALESCE(b.niche, '') <> '' OR COALESCE(b.brand_name, '') <> '')
          AND (
            EXISTS (SELECT 1 FROM user_agent_tasks t WHERE t.user_id = b.user_id AND t.created_at > NOW() - INTERVAL '30 days')
            OR EXISTS (SELECT 1 FROM user_agent_schedules s WHERE s.user_id = b.user_id AND s.enabled = true AND s.frequency <> 'off')
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_agent_memory m
             WHERE m.user_id = b.user_id AND m.agent_key = $1 AND m.key = 'meta:last_review_at'
               AND m.value > to_char((NOW() - INTERVAL '23 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
          )
        ORDER BY b.updated_at DESC
        LIMIT $2`,
      [DIRECTOR_KEY, maxUsers],
    );
    for (const r of rows) {
      try {
        await runDirectorReview(r.user_id, { runAgent });
      } catch (err) {
        logger.warn({ err, userId: r.user_id }, 'director_review_failed');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'director_cycle_failed');
  }
}

// ── Briefings ───────────────────────────────────────────────────────────────

export type AgentBriefing = {
  team_strategy?: {
    title: string;
    hypothesis: string;
    why: string;
    measured_by: string;
    status: string;
    your_focus?: string;
  };
  niche_research?: Record<string, unknown> & { researched_on: string; basis: string };
  inbox?: Array<{ from: string; kind: string; subject: string; body: string }>;
  your_track_record?: { approved: number; rejected: number; recently_rejected: string[] };
  teammates_approved_work?: Array<{ agent: string; title: string; summary: string }>;
};

// What one agent needs to know right now. inboxIds are the messages shown,
// so the caller can mark them read once the agent has acted on them.
export async function buildAgentBriefing(userId: string, agentKey: string): Promise<{ briefing: AgentBriefing; inboxIds: string[] }> {
  const briefing: AgentBriefing = {};
  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* section skipped */ } };
  let inboxIds: string[] = [];

  await safe(async () => {
    const s = await getActiveStrategy(userId);
    if (!s) return;
    briefing.team_strategy = {
      title: s.title,
      hypothesis: s.hypothesis,
      why: s.rationale,
      measured_by: `${KPI_DEFS[s.kpi].label}: target ${formatKpiValue(s.kpi, s.target)}${s.baseline !== null ? `, started at ${formatKpiValue(s.kpi, s.baseline)}` : ''}${s.last_value !== null ? `, latest ${formatKpiValue(s.kpi, s.last_value)}` : ''}`,
      status: s.last_verdict ?? 'warming_up',
      ...(s.focus[agentKey] ? { your_focus: s.focus[agentKey] } : {}),
    };
  });

  await safe(async () => {
    const r = await getLatestResearch(userId);
    if (!r) return;
    const slice = selectResearchFor(agentKey, r.findings as any);
    if (Object.keys(slice).length) {
      briefing.niche_research = {
        ...slice,
        researched_on: new Date(r.created_at).toISOString().slice(0, 10),
        basis: r.method === 'web_search' ? 'web research' : 'general knowledge (unverified)',
      };
    }
  });

  await safe(async () => {
    const inbox = await readAgentInbox(userId, agentKey, 8);
    if (!inbox.length) return;
    inboxIds = inbox.map((m) => m.id);
    briefing.inbox = inbox.map((m) => ({ from: agentDisplayName(m.from), kind: m.kind, subject: m.subject, body: m.body.slice(0, 600) }));
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT title, status FROM user_agent_tasks WHERE user_id = $1 AND agent_key = $2 AND status IN ('approved','rejected')
        AND decided_at > NOW() - INTERVAL '30 days' ORDER BY decided_at DESC LIMIT 20`,
      [userId, agentKey],
    );
    if (!rows.length) return;
    briefing.your_track_record = {
      approved: rows.filter((r: any) => r.status === 'approved').length,
      rejected: rows.filter((r: any) => r.status === 'rejected').length,
      recently_rejected: rows.filter((r: any) => r.status === 'rejected').slice(0, 4).map((r: any) => String(r.title).slice(0, 80)),
    };
  });

  await safe(async () => {
    const upstream = upstreamAgents(agentKey);
    if (!upstream.length) return;
    const { rows } = await dbQuery(
      `SELECT agent_key, title, body FROM user_agent_tasks
        WHERE user_id = $1 AND agent_key = ANY($2::text[]) AND status = 'approved' AND decided_at > NOW() - INTERVAL '21 days'
        ORDER BY decided_at DESC LIMIT 5`,
      [userId, upstream],
    );
    if (rows.length) {
      briefing.teammates_approved_work = rows.map((r: any) => ({ agent: agentDisplayName(r.agent_key), title: String(r.title).slice(0, 80), summary: String(r.body || '').slice(0, 240) }));
    }
  });

  return { briefing, inboxIds };
}

// Plain-text form of a briefing for chat system prompts.
export function renderBriefing(b: AgentBriefing): string {
  const lines: string[] = [];
  if (b.team_strategy) {
    lines.push(`Team strategy: ${b.team_strategy.title} (${b.team_strategy.status.replace(/_/g, ' ')}). Why: ${b.team_strategy.why} Measured by ${b.team_strategy.measured_by}.`);
    if (b.team_strategy.your_focus) lines.push(`Your focus under it: ${b.team_strategy.your_focus}`);
  }
  if (b.niche_research) {
    const r = b.niche_research as any;
    lines.push(`Niche research (${r.basis}, ${r.researched_on}): ${r.summary ?? ''}`);
    if (Array.isArray(r.trends) && r.trends.length) lines.push(`Trends: ${r.trends.slice(0, 3).map((t: any) => t.name).join('; ')}`);
    if (r.audience?.pains?.length) lines.push(`Audience pains: ${r.audience.pains.slice(0, 3).join('; ')}`);
    if (Array.isArray(r.platform_benchmarks) && r.platform_benchmarks.length) {
      lines.push(`Platform benchmarks & winning mechanics:`);
      for (const pb of r.platform_benchmarks.slice(0, 4)) {
        lines.push(`- [${pb.platform}]: What works: ${pb.what_works}${pb.what_to_avoid ? ` | Avoid: ${pb.what_to_avoid}` : ''}`);
      }
    }
  }
  lines.push(`GROUNDING PRINCIPLE: Use the winning structural frameworks above, but fill them ONLY with verified business facts. Never fabricate unlisted products, pricing, reviews, or claims.`);
  if (b.inbox?.length) lines.push(`Messages from teammates:\n${b.inbox.map((m) => `- ${m.from} (${m.kind}): ${m.subject}`).join('\n')}`);
  if (b.your_track_record) lines.push(`Your last 30 days: ${b.your_track_record.approved} approved, ${b.your_track_record.rejected} rejected${b.your_track_record.recently_rejected.length ? ` (rejected: ${b.your_track_record.recently_rejected.join('; ')})` : ''}.`);
  return lines.join('\n');
}

// A strategy the user sets themselves. It is held to the same rules: a
// rationale, a KPI, a target and an evaluation window.
export async function setStrategyFromUser(
  userId: string,
  input: { title: string; rationale: string; hypothesis?: string; kpi?: string; target?: number; eval_window_days?: number; focus?: Record<string, string> },
): Promise<StrategyRow> {
  const { snapshot } = await computePerformance(userId, new Date(Date.now() - 14 * DAY_MS));
  const plan = normalizeStrategyPlan({ ...input, evidence: ['set by the user'] }, snapshot, KNOWN_AGENT_KEYS);
  if (!plan) throw new Error('A strategy needs a title and a rationale of at least 20 characters.');
  const active = await getActiveStrategy(userId);
  return adoptStrategy(
    userId,
    { ...plan, playbook: 'user_plan' },
    active ? { strategy: active, reason: 'You replaced it with your own strategy.' } : null,
    'user',
  );
}
