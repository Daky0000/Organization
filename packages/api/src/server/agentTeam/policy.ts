// ─────────────────────────────────────────────────────────────────────────────
// Agent team policy: the pure rules behind how the user's agents coordinate.
//
//  - Strategies are measured by a KPI the workspace actually records. Each one
//    is given an evaluation window before it can be judged, then reviewed
//    about twice per window. Two underperforming reviews in a row retire it.
//  - Research findings are routed to the agents that use them, so each agent
//    sees the slice of the niche research it needs rather than all of it.
//  - Handoffs say which teammates build on an agent's approved work.
//
// No database or network access here, so every rule is unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export const DIRECTOR_KEY = 'director';
export const DIRECTOR_NAME = 'Helm';

export type StrategyKpi = 'approval_rate' | 'engagement_rate' | 'publish_success_rate' | 'posts_published';

export const KPI_DEFS: Record<StrategyKpi, { label: string; minSample: number; defaultTarget: (windowDays: number) => number; isRate: boolean }> = {
  // Share of agent proposals the user approved. Always available once the
  // user reviews proposals, so it is the fallback signal.
  approval_rate: { label: 'Proposal approval rate', minSample: 4, defaultTarget: () => 0.6, isRate: true },
  // (likes + comments + shares + saves) / impressions over posts published in the window.
  engagement_rate: { label: 'Engagement rate', minSample: 3, defaultTarget: () => 0.03, isRate: true },
  publish_success_rate: { label: 'Publish success rate', minSample: 3, defaultTarget: () => 0.95, isRate: true },
  posts_published: { label: 'Posts published', minSample: 0, defaultTarget: (w) => Math.max(2, Math.round((w / 7) * 3)), isRate: false },
};

export function isStrategyKpi(value: unknown): value is StrategyKpi {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KPI_DEFS, value);
}

export type KpiObservation = { value: number | null; sample: number };
export type PerformanceSnapshot = Record<StrategyKpi, KpiObservation>;

export const MIN_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 30;
// Reviews that found the strategy behind, in a row, before it is replaced.
export const MISSES_BEFORE_SWITCH = 2;
// Windows with no measurable signal before a strategy is replaced by one
// measured on something the workspace records.
export const UNMEASURED_WINDOWS_BEFORE_SWITCH = 3;

export function clampWindowDays(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 14;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, n));
}

// The target a new strategy must reach: the caller's when it is sane,
// otherwise 15% better than the baseline, otherwise the KPI default.
export function resolveTarget(kpi: StrategyKpi, windowDays: number, baseline: number | null, proposed?: unknown): number {
  const def = KPI_DEFS[kpi];
  const p = Number(proposed);
  if (proposed !== undefined && proposed !== null && Number.isFinite(p) && p > 0 && (!def.isRate || p <= 1)) {
    if (baseline === null || p > baseline) return round4(p);
  }
  if (baseline !== null && baseline > 0) {
    const lifted = def.isRate ? Math.min(1, baseline * 1.15) : Math.ceil(baseline * 1.15);
    if (lifted > baseline) return round4(lifted);
  }
  return round4(def.defaultTarget(windowDays));
}

export type StrategyState = {
  kpi: StrategyKpi;
  baseline: number | null;
  target: number;
  evalWindowDays: number;
  startedAt: Date;
  lastEvaluatedAt: Date | null;
  consecutiveMisses: number;
};

export type StrategyVerdict = 'warming_up' | 'on_track' | 'progressing' | 'underperforming' | 'insufficient_data';

export type StrategyEvaluation = {
  verdict: StrategyVerdict;
  // false when the last formal review is too recent to count another one.
  counted: boolean;
  consecutiveMisses: number;
  shouldSwitch: boolean;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewIntervalDays(windowDays: number): number {
  return Math.max(1, Math.floor(windowDays / 2));
}

export function formatKpiValue(kpi: StrategyKpi, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return KPI_DEFS[kpi].isRate ? `${(value * 100).toFixed(1)}%` : String(Math.round(value));
}

export function evaluateStrategy(state: StrategyState, observed: KpiObservation, now: Date = new Date()): StrategyEvaluation {
  const def = KPI_DEFS[state.kpi];
  const ageDays = (now.getTime() - state.startedAt.getTime()) / DAY_MS;
  const sinceReview = state.lastEvaluatedAt ? (now.getTime() - state.lastEvaluatedAt.getTime()) / DAY_MS : Infinity;
  const counted = sinceReview >= reviewIntervalDays(state.evalWindowDays);
  const measured = observed.value !== null && Number.isFinite(observed.value) && observed.sample >= def.minSample;
  const shown = formatKpiValue(state.kpi, observed.value);
  const target = formatKpiValue(state.kpi, state.target);

  if (ageDays < state.evalWindowDays) {
    return {
      verdict: 'warming_up',
      counted: false,
      consecutiveMisses: state.consecutiveMisses,
      shouldSwitch: false,
      reason: `Day ${Math.floor(ageDays) + 1} of a ${state.evalWindowDays}-day evaluation window; ${def.label.toLowerCase()} is ${shown} against a ${target} target.`,
    };
  }

  if (!measured) {
    const unmeasuredWindows = Math.floor(ageDays / state.evalWindowDays);
    const shouldSwitch = counted && unmeasuredWindows >= UNMEASURED_WINDOWS_BEFORE_SWITCH;
    return {
      verdict: 'insufficient_data',
      counted,
      consecutiveMisses: state.consecutiveMisses,
      shouldSwitch,
      reason: shouldSwitch
        ? `${def.label} has had too little data to judge for ${Math.floor(ageDays)} days (${observed.sample} data points, ${def.minSample} needed); switching to a strategy measured on a signal this workspace records.`
        : `Not enough data yet to judge ${def.label.toLowerCase()} (${observed.sample} data points, ${def.minSample} needed).`,
    };
  }

  const value = observed.value as number;
  if (value >= state.target) {
    return { verdict: 'on_track', counted, consecutiveMisses: 0, shouldSwitch: false, reason: `${def.label} is ${shown}, at or above the ${target} target.` };
  }
  // Moving clearly beyond the starting point counts as progress, not a miss.
  if (state.baseline !== null && value > state.baseline * 1.05 && value > state.baseline) {
    return {
      verdict: 'progressing',
      counted,
      consecutiveMisses: counted ? 0 : state.consecutiveMisses,
      shouldSwitch: false,
      reason: `${def.label} improved from ${formatKpiValue(state.kpi, state.baseline)} to ${shown}; still below the ${target} target.`,
    };
  }
  const misses = counted ? state.consecutiveMisses + 1 : state.consecutiveMisses;
  const shouldSwitch = misses >= MISSES_BEFORE_SWITCH;
  const fromBaseline = state.baseline !== null ? ` (started at ${formatKpiValue(state.kpi, state.baseline)})` : '';
  return {
    verdict: 'underperforming',
    counted,
    consecutiveMisses: misses,
    shouldSwitch,
    reason: shouldSwitch
      ? `${def.label} stayed at ${shown}${fromBaseline} against a ${target} target for ${misses} reviews in a row after the ${state.evalWindowDays}-day window, so this strategy is not working.`
      : `${def.label} is ${shown}${fromBaseline}, below the ${target} target (review ${misses} of ${MISSES_BEFORE_SWITCH} before switching).`,
  };
}

// The KPI a new strategy should be measured on: the one the strategy names
// when the workspace has data for it, otherwise the best-measured signal.
export function chooseMeasurableKpi(preferred: StrategyKpi | null, perf: PerformanceSnapshot): StrategyKpi {
  const has = (k: StrategyKpi) => perf[k] && perf[k].value !== null && perf[k].sample >= Math.max(1, KPI_DEFS[k].minSample);
  if (preferred && (has(preferred) || preferred === 'approval_rate' || preferred === 'posts_published')) return preferred;
  if (has('engagement_rate')) return 'engagement_rate';
  if (has('approval_rate')) return 'approval_rate';
  return preferred === 'engagement_rate' ? 'posts_published' : 'approval_rate';
}

// ── Built-in playbooks ───────────────────────────────────────────────────────
// Used when no AI provider is configured or the director's answer is
// unusable. Each states why it fits, from the signals that selected it.

export type StrategyPlan = {
  playbook: string;
  title: string;
  hypothesis: string;
  rationale: string;
  kpi: StrategyKpi;
  target?: number;
  evalWindowDays: number;
  focus: Record<string, string>;
  evidence: string[];
};

export type PlaybookSignals = {
  perf: PerformanceSnapshot;
  niche: string;
  topTrend?: string | null;
  topPain?: string | null;
  excludedPlaybooks: string[];
};

export function pickPlaybook(signals: PlaybookSignals): StrategyPlan {
  const { perf, niche } = signals;
  const nicheLabel = niche || 'your niche';
  const shown = (k: StrategyKpi) => formatKpiValue(k, perf[k]?.value ?? null);
  const candidates: StrategyPlan[] = [];

  if ((perf.posts_published?.value ?? 0) < 2) {
    candidates.push({
      playbook: 'consistency_cadence',
      title: 'Build a consistent publishing cadence',
      hypothesis: 'Publishing three times a week gives the audience and the algorithms enough to respond to.',
      rationale: `Only ${shown('posts_published')} posts were published recently. No other strategy can be judged until content goes out regularly, so cadence comes first.`,
      kpi: 'posts_published',
      evalWindowDays: 14,
      focus: {
        daky: 'Turn each approved idea into a ready-to-schedule post; favour formats that are quick to produce.',
        flux: 'Propose a repeatable weekly schedule and an automation that queues approved drafts.',
        social_caption: 'Write captions in batches so a week of posts is ready at once.',
      },
      evidence: [`posts published in the last window: ${shown('posts_published')}`],
    });
  }
  if (perf.approval_rate?.value !== null && perf.approval_rate?.value !== undefined && perf.approval_rate.sample >= KPI_DEFS.approval_rate.minSample && perf.approval_rate.value < 0.45) {
    candidates.push({
      playbook: 'proven_themes',
      title: 'Narrow to the themes the user approves',
      hypothesis: 'Proposals built on previously approved themes will be approved more often.',
      rationale: `Only ${shown('approval_rate')} of recent proposals were approved (${perf.approval_rate.sample} decisions), so the team is spending effort on ideas that do not fit. Narrowing to approved themes should lift that.`,
      kpi: 'approval_rate',
      evalWindowDays: 14,
      focus: {
        sage: 'Base strategy on the themes in the approved decision history; drop angles the user rejected.',
        daky: 'Only write on themes the user has approved before, in their brand voice.',
        nova: 'Keep visuals consistent with concepts the user approved.',
      },
      evidence: [`approval rate ${shown('approval_rate')} over ${perf.approval_rate.sample} decisions`],
    });
  }
  if (perf.engagement_rate?.value !== null && perf.engagement_rate?.value !== undefined && perf.engagement_rate.sample >= KPI_DEFS.engagement_rate.minSample) {
    candidates.push({
      playbook: 'hook_first_short_form',
      title: 'Lead with hooks and short-form video',
      hypothesis: 'Stronger first lines and short-form video raise engagement per impression.',
      rationale: `Engagement is ${shown('engagement_rate')} across ${perf.engagement_rate.sample} recent posts. Short-form video with a tested hook is the most dependable lever on engagement per impression.`,
      kpi: 'engagement_rate',
      evalWindowDays: 14,
      focus: {
        hook_writing: 'Write 5+ hook variants per planned post and say which angle each tests.',
        video_script: 'Prioritise 20–45 second scripts that pay off the hook in the first 3 seconds.',
        social_caption: 'Open every caption with the strongest hook; end with one clear prompt to comment or save.',
      },
      evidence: [`engagement rate ${shown('engagement_rate')} over ${perf.engagement_rate.sample} posts`],
    });
  }
  if (signals.topTrend) {
    candidates.push({
      playbook: 'ride_niche_trend',
      title: `Own the conversation on "${signals.topTrend.slice(0, 60)}"`,
      hypothesis: `Content on a rising ${nicheLabel} topic earns more attention than evergreen posts.`,
      rationale: `Niche research found "${signals.topTrend.slice(0, 80)}" gaining attention in ${nicheLabel}. Getting there early is cheaper than competing on saturated topics.`,
      kpi: perf.engagement_rate?.value !== null && (perf.engagement_rate?.sample ?? 0) >= KPI_DEFS.engagement_rate.minSample ? 'engagement_rate' : 'approval_rate',
      evalWindowDays: 14,
      focus: {
        trend_research: `Track how "${signals.topTrend.slice(0, 60)}" develops and flag new angles.`,
        daky: 'Publish a point of view on the trend that only this brand could write.',
        hook_writing: 'Write hooks that tie the trend to the audience\'s main pain.',
      },
      evidence: [`niche research trend: ${signals.topTrend.slice(0, 120)}`],
    });
  }
  candidates.push({
    playbook: 'audience_pain_focus',
    title: 'Speak to the audience\'s most pressing pain',
    hypothesis: 'Content framed around a single, specific pain converts attention into intent.',
    rationale: signals.topPain
      ? `Audience research points to "${signals.topPain.slice(0, 80)}" as the most pressing pain in ${nicheLabel}. Framing content around it makes every piece relevant to the buyer.`
      : `There is no strong performance signal yet, so the safest start is content framed around the audience's main pain in ${nicheLabel}, judged on whether the user approves it.`,
    kpi: 'approval_rate',
    evalWindowDays: 14,
    focus: {
      audience_research: 'Sharpen the top pains and objections with concrete language the audience uses.',
      daky: 'Frame each piece around one pain and the outcome the brand delivers.',
      ad_copy: 'Lead with the pain angle; test it against a benefit angle.',
    },
    evidence: signals.topPain ? [`audience pain: ${signals.topPain.slice(0, 120)}`] : ['no measured performance yet'],
  });

  const allowed = candidates.filter((c) => !signals.excludedPlaybooks.includes(c.playbook));
  return allowed[0] ?? candidates[candidates.length - 1];
}

// ── Research routing ─────────────────────────────────────────────────────────

export type PlatformBenchmark = {
  platform: string;
  top_accounts: Array<{
    handle: string;
    name?: string;
    why_popular?: string;
    top_formats?: string[];
    winning_hooks?: string[];
  }>;
  what_works: string;
  what_to_avoid?: string;
};

export type ResearchTopic = 'trends' | 'audience' | 'competitors' | 'keywords' | 'content_formats' | 'opportunities' | 'platform_benchmarks';
const ALL_TOPICS: ResearchTopic[] = ['trends', 'audience', 'competitors', 'keywords', 'content_formats', 'opportunities', 'platform_benchmarks'];

export const AGENT_RESEARCH_FOCUS: Record<string, ResearchTopic[]> = {
  sage: ALL_TOPICS,
  campaign_brief: ALL_TOPICS,
  director: ALL_TOPICS,
  trend_research: ['trends', 'content_formats', 'opportunities', 'platform_benchmarks'],
  audience_research: ['audience', 'competitors'],
  seo_research: ['keywords', 'competitors'],
  daky: ['trends', 'audience', 'keywords', 'platform_benchmarks'],
  nova: ['content_formats', 'trends', 'platform_benchmarks'],
  promo: ['audience', 'opportunities'],
  thumbnail_design: ['content_formats'],
  hook_writing: ['trends', 'audience', 'platform_benchmarks'],
  social_caption: ['trends', 'audience', 'content_formats', 'platform_benchmarks'],
  video_script: ['trends', 'content_formats', 'audience', 'platform_benchmarks'],
  ad_copy: ['audience', 'competitors'],
  meta_ads: ['audience', 'competitors', 'platform_benchmarks'],
  aria: ['competitors', 'content_formats', 'platform_benchmarks'],
  flux: ['content_formats'],
  quality: ['audience'],
  planner: ['trends', 'content_formats', 'opportunities', 'platform_benchmarks'],
  sales_insight: ['audience', 'competitors'],
  sales_caller: ['audience', 'competitors'],
};

export function researchTopicsFor(agentKey: string): ResearchTopic[] {
  return AGENT_RESEARCH_FOCUS[agentKey] ?? ['opportunities'];
}

export function selectResearchFor(agentKey: string, findings: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!findings || typeof findings !== 'object') return {};
  const out: Record<string, unknown> = {};
  if (typeof findings.summary === 'string') out.summary = findings.summary;
  for (const topic of researchTopicsFor(agentKey)) {
    const v = (findings as Record<string, unknown>)[topic];
    if (v === undefined || v === null) continue;
    out[topic] = Array.isArray(v) ? v.slice(0, 6) : v;
  }
  return out;
}

// ── Handoffs ─────────────────────────────────────────────────────────────────
// Who builds on an agent's approved work.

export const AGENT_HANDOFFS: Record<string, string[]> = {
  sage: ['daky', 'nova', 'campaign_brief', 'hook_writing'],
  trend_research: ['daky', 'video_script', 'hook_writing', 'sage'],
  audience_research: ['ad_copy', 'daky', 'hook_writing', 'sage'],
  seo_research: ['daky'],
  daky: ['nova', 'social_caption', 'hook_writing'],
  hook_writing: ['social_caption', 'video_script', 'ad_copy'],
  nova: ['thumbnail_design', 'promo'],
  video_script: ['thumbnail_design'],
  campaign_brief: ['flux', 'meta_ads', 'daky'],
  aria: ['sage', DIRECTOR_KEY],
  ad_copy: ['meta_ads'],
};

export function handoffTargets(agentKey: string): string[] {
  return AGENT_HANDOFFS[agentKey] ?? [];
}

// Which teammates' work an agent should see: everyone who hands off to it.
export function upstreamAgents(agentKey: string): string[] {
  return Object.entries(AGENT_HANDOFFS).filter(([, to]) => to.includes(agentKey)).map(([from]) => from);
}

// ── Agent-to-agent messages ──────────────────────────────────────────────────

export type AgentMessageKind = 'request' | 'handoff' | 'insight' | 'alert' | 'directive';
export const AGENT_MESSAGE_KINDS: AgentMessageKind[] = ['request', 'handoff', 'insight', 'alert', 'directive'];
// Kinds an agent may send from its own output; directives come from the
// director or the user.
const AGENT_SENDABLE: AgentMessageKind[] = ['request', 'handoff', 'insight', 'alert'];

export type OutgoingAgentMessage = { to: string; kind: AgentMessageKind; subject: string; body: string };

// Validates the messages an agent asked to send. Drops unknown recipients,
// messages to itself, and anything malformed; caps the count per run.
export function sanitizeAgentMessages(from: string, raw: unknown, knownAgents: string[], max = 3): OutgoingAgentMessage[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set([...knownAgents, DIRECTOR_KEY, '*']);
  const out: OutgoingAgentMessage[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const to = String((m as any).to ?? '').trim().toLowerCase();
    const kind = String((m as any).kind ?? 'request').trim().toLowerCase() as AgentMessageKind;
    const subject = String((m as any).subject ?? '').trim().slice(0, 140);
    const body = String((m as any).body ?? '').trim().slice(0, 800);
    if (!to || to === from || !known.has(to)) continue;
    if (!AGENT_SENDABLE.includes(kind)) continue;
    if (!subject || !body) continue;
    const dedupe = `${to}|${subject.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ to, kind, subject, body });
    if (out.length >= max) break;
  }
  return out;
}

// ── Research output normalisation ────────────────────────────────────────────

export type NicheFindings = {
  summary: string;
  trends: Array<{ name: string; why: string; angle?: string }>;
  audience: { pains: string[]; desires: string[]; objections: string[] };
  competitors: Array<{ name: string; positioning?: string; gap?: string }>;
  keywords: Array<{ term: string; intent?: string }>;
  content_formats: Array<{ format: string; platform?: string; why?: string }>;
  opportunities: string[];
  platform_benchmarks?: PlatformBenchmark[];
};

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 8) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, max) : []);

export function normalizeFindings(raw: unknown): NicheFindings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const objs = (v: unknown, key: string) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && str(x[key])) : []);
  const benchObjs = Array.isArray(r.platform_benchmarks)
    ? r.platform_benchmarks.filter((p: any) => p && typeof p === 'object' && str(p.platform)).map((p: any) => ({
        platform: str(p.platform, 40),
        top_accounts: objs(p.top_accounts, 'handle').slice(0, 6).map((a: any) => ({
          handle: str(a.handle, 80),
          ...(str(a.name) ? { name: str(a.name, 80) } : {}),
          ...(str(a.why_popular) ? { why_popular: str(a.why_popular, 250) } : {}),
          ...(Array.isArray(a.top_formats) ? { top_formats: strList(a.top_formats, 4) } : {}),
          ...(Array.isArray(a.winning_hooks) ? { winning_hooks: strList(a.winning_hooks, 4) } : {}),
        })),
        what_works: str(p.what_works, 500),
        ...(str(p.what_to_avoid) ? { what_to_avoid: str(p.what_to_avoid, 300) } : {}),
      }))
    : [];

  const findings: NicheFindings = {
    summary: str(r.summary, 900),
    trends: objs(r.trends, 'name').slice(0, 8).map((t: any) => ({ name: str(t.name, 120), why: str(t.why), ...(str(t.angle) ? { angle: str(t.angle) } : {}) })),
    audience: {
      pains: strList(r.audience?.pains),
      desires: strList(r.audience?.desires),
      objections: strList(r.audience?.objections),
    },
    competitors: objs(r.competitors, 'name').slice(0, 8).map((c: any) => ({ name: str(c.name, 120), ...(str(c.positioning) ? { positioning: str(c.positioning) } : {}), ...(str(c.gap) ? { gap: str(c.gap) } : {}) })),
    keywords: objs(r.keywords, 'term').slice(0, 12).map((k: any) => ({ term: str(k.term, 120), ...(str(k.intent) ? { intent: str(k.intent, 60) } : {}) })),
    content_formats: objs(r.content_formats, 'format').slice(0, 8).map((f: any) => ({ format: str(f.format, 120), ...(str(f.platform) ? { platform: str(f.platform, 60) } : {}), ...(str(f.why) ? { why: str(f.why) } : {}) })),
    opportunities: strList(r.opportunities),
    ...(benchObjs.length ? { platform_benchmarks: benchObjs } : {}),
  };
  const hasContent = findings.summary || findings.trends.length || findings.audience.pains.length || findings.competitors.length || findings.keywords.length || (findings.platform_benchmarks && findings.platform_benchmarks.length > 0);
  return hasContent ? findings : null;
}

// The first JSON object in a model reply, tolerating code fences and prose.
export function extractJsonObject(text: string): Record<string, any> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Validates a strategy the director proposed; null when unusable.
export function normalizeStrategyPlan(raw: unknown, perf: PerformanceSnapshot, knownAgents: string[]): StrategyPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const title = str(r.title, 120);
  const rationale = str(r.rationale, 1200);
  const hypothesis = str(r.hypothesis, 400);
  if (!title || rationale.length < 20) return null;
  const kpi = chooseMeasurableKpi(isStrategyKpi(r.kpi) ? r.kpi : null, perf);
  const focus: Record<string, string> = {};
  if (r.focus && typeof r.focus === 'object') {
    for (const [k, v] of Object.entries(r.focus as Record<string, unknown>)) {
      const key = k.trim().toLowerCase();
      if (knownAgents.includes(key) && str(v)) focus[key] = str(v, 400);
      if (Object.keys(focus).length >= 8) break;
    }
  }
  return {
    playbook: 'director_plan',
    title,
    hypothesis: hypothesis || title,
    rationale,
    kpi,
    target: r.target === undefined ? undefined : Number(r.target),
    evalWindowDays: clampWindowDays(r.eval_window_days),
    focus,
    evidence: strList(r.evidence, 6),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
