import { Router, type Response } from 'express';
import type { Request } from '../types/http.ts';
import { logger } from '../logger.ts';
import { AGENT_DEFS } from '../agent-helpers.ts';
import {
  type AgentRunner,
  agentDisplayName,
  computePerformance,
  getActiveStrategy,
  getLatestResearch,
  listAgentMessages,
  listStrategies,
  listStrategyReviews,
  postAgentMessage,
  runDirectorReview,
  runNicheResearch,
  setStrategyFromUser,
} from './agentTeam/coordination.ts';
import { runWeeklyPerformanceScan } from './agentTeam/weeklyScanner.ts';
import { DIRECTOR_KEY, DIRECTOR_NAME, KPI_DEFS, formatKpiValue, type StrategyKpi } from './agentTeam/policy.ts';

// Agent team API: the director's strategy and its reviews, niche research,
// and the message channel between the user's agents.

type AuthResult = { userId: string } | null;

export type AgentTeamDeps = {
  requireAuth: (req: Request, res: Response) => AuthResult;
  hasDatabase: () => boolean;
  runAgent?: AgentRunner;
};

const RESEARCH_COOLDOWN_MS = 10 * 60 * 1000;
const REVIEW_COOLDOWN_MS = 60 * 1000;
const lastManualReview = new Map<string, number>();

export function registerAgentTeamRoutes(deps: AgentTeamDeps): Router {
  const router = Router();
  const { requireAuth, hasDatabase } = deps;

  const guard = (req: Request, res: Response): string | null => {
    const auth = requireAuth(req, res);
    if (!auth) return null;
    if (!hasDatabase()) {
      res.status(503).json({ success: false, error: 'Database unavailable' });
      return null;
    }
    return auth.userId;
  };

  router.get('/user/agent-team/overview', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    try {
      const [active, history, research, perf, messages] = await Promise.all([
        getActiveStrategy(userId),
        listStrategies(userId, 10),
        getLatestResearch(userId),
        computePerformance(userId, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
        listAgentMessages(userId, { limit: 30 }),
      ]);
      const reviews = active ? await listStrategyReviews(userId, active.id, 10) : [];
      const kpis = (Object.keys(KPI_DEFS) as StrategyKpi[]).map((k) => ({
        kpi: k,
        label: KPI_DEFS[k].label,
        value: perf.snapshot[k].value,
        display: formatKpiValue(k, perf.snapshot[k].value),
        sample: perf.snapshot[k].sample,
      }));
      return res.json({
        success: true,
        director: { key: DIRECTOR_KEY, name: DIRECTOR_NAME },
        strategy: active ? { ...active, kpi_label: KPI_DEFS[active.kpi].label, target_display: formatKpiValue(active.kpi, active.target), baseline_display: formatKpiValue(active.kpi, active.baseline), last_value_display: formatKpiValue(active.kpi, active.last_value) } : null,
        reviews,
        history: history.filter((s) => s.status !== 'active').map((s) => ({ id: s.id, title: s.title, kpi: s.kpi, status: s.status, started_at: s.started_at, ended_at: s.ended_at, ended_reason: s.ended_reason, rationale: s.rationale, created_by: s.created_by })),
        research,
        performance: { window_days: 14, kpis, by_agent: perf.byAgent.map((a) => ({ ...a, name: agentDisplayName(a.agent_key) })) },
        messages,
      });
    } catch (err) {
      logger.error({ err, userId }, 'agent_team_overview_failed');
      return res.status(500).json({ success: false, error: 'Could not load the team overview.' });
    }
  });

  // Runs a director review now. replace=true asks for a new strategy even if
  // the current one is on track.
  router.post('/user/agent-team/review', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    const last = lastManualReview.get(userId) ?? 0;
    if (Date.now() - last < REVIEW_COOLDOWN_MS) {
      return res.status(429).json({ success: false, error: 'A review just ran. Try again in a minute.' });
    }
    lastManualReview.set(userId, Date.now());
    try {
      const replace = Boolean((req.body as any)?.replace);
      const result = await runDirectorReview(userId, { force: true, replace, runAgent: deps.runAgent });
      if (result.skipped === 'no_brand_profile') {
        return res.status(422).json({ success: false, error: 'Set up your brand profile (at least a name or niche) so the director has something to plan for.' });
      }
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error({ err, userId }, 'agent_team_review_failed');
      return res.status(500).json({ success: false, error: 'The review could not be completed.' });
    }
  });

  router.get('/user/agent-team/research', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    try {
      return res.json({ success: true, research: await getLatestResearch(userId) });
    } catch (err) {
      logger.error({ err, userId }, 'agent_team_research_read_failed');
      return res.status(500).json({ success: false, error: 'Could not load research.' });
    }
  });

  router.post('/user/agent-team/research', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    try {
      const latest = await getLatestResearch(userId);
      if (latest && Date.now() - new Date(latest.created_at).getTime() < RESEARCH_COOLDOWN_MS) {
        return res.status(429).json({ success: false, error: 'Research was refreshed a few minutes ago. Try again later.' });
      }
      const outcome = await runNicheResearch(userId);
      if (!outcome.ok) return res.status(outcome.status).json({ success: false, error: outcome.error });
      return res.json({ success: true, research: outcome.research });
    } catch (err) {
      logger.error({ err, userId }, 'agent_team_research_failed');
      return res.status(500).json({ success: false, error: 'Research could not be completed.' });
    }
  });

  router.put('/user/agent-team/strategy', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    const body = (req.body || {}) as Record<string, any>;
    const title = String(body.title || '').trim();
    const rationale = String(body.rationale || '').trim();
    if (!title || rationale.length < 20) {
      return res.status(400).json({ success: false, error: 'Give the strategy a title and explain why in at least 20 characters.' });
    }
    try {
      const strategy = await setStrategyFromUser(userId, {
        title,
        rationale,
        hypothesis: body.hypothesis ? String(body.hypothesis) : undefined,
        kpi: body.kpi ? String(body.kpi) : undefined,
        target: body.target === undefined || body.target === null || body.target === '' ? undefined : Number(body.target),
        eval_window_days: body.eval_window_days === undefined ? undefined : Number(body.eval_window_days),
        focus: body.focus && typeof body.focus === 'object' ? body.focus : undefined,
      });
      return res.json({ success: true, strategy });
    } catch (err) {
      logger.error({ err, userId }, 'agent_team_strategy_set_failed');
      return res.status(500).json({ success: false, error: 'Could not save the strategy.' });
    }
  });

  router.get('/user/agent-team/messages', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    const agent = typeof req.query.agent === 'string' ? req.query.agent : undefined;
    const limit = Number(req.query.limit) || 50;
    try {
      return res.json({ success: true, messages: await listAgentMessages(userId, { agent, limit }) });
    } catch (err) {
      logger.error({ err, userId }, 'agent_team_messages_failed');
      return res.status(500).json({ success: false, error: 'Could not load messages.' });
    }
  });

  // The user directs an agent (or the whole team); it is read on the agent's
  // next run, ahead of teammates' messages.
  router.post('/user/agent-team/messages', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    const body = (req.body || {}) as Record<string, any>;
    const to = String(body.to || '').trim().toLowerCase();
    const subject = String(body.subject || '').trim();
    const text = String(body.body || '').trim();
    if (!(to === '*' || to === DIRECTOR_KEY || AGENT_DEFS[to])) {
      return res.status(400).json({ success: false, error: 'Choose an agent, the director, or the whole team.' });
    }
    if (!subject || !text) return res.status(400).json({ success: false, error: 'A message needs a subject and a body.' });
    const id = await postAgentMessage(userId, {
      from: 'user',
      to,
      kind: to === DIRECTOR_KEY ? 'alert' : 'directive',
      subject: subject.slice(0, 140),
      body: text.slice(0, 2000),
      priority: 4,
      ttlDays: 30,
    });
    if (!id) return res.status(500).json({ success: false, error: 'Could not send the message.' });
    return res.json({ success: true, id });
  });

  // POST /user/agent-team/scanner/weekly/run — on-demand or weekly triggered scan
  router.post('/user/agent-team/scanner/weekly/run', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    try {
      const scan = await runWeeklyPerformanceScan(userId);
      return res.json({ success: true, scan });
    } catch (err) {
      logger.error({ err, userId }, 'weekly_scanner_endpoint_failed');
      return res.status(500).json({ success: false, error: 'Weekly performance scan failed.' });
    }
  });

  // GET /user/agent-team/strategy-milestone — monthly Double Down vs Pivot status
  router.get('/user/agent-team/strategy-milestone', async (req: Request, res: Response) => {
    const userId = guard(req, res);
    if (!userId) return;
    try {
      const active = await getActiveStrategy(userId);
      if (!active) {
        return res.json({ success: true, milestone: null, message: 'No active strategy to review.' });
      }
      const reviews = await listStrategyReviews(userId, active.id, 5);
      const latestReview = reviews[0] ?? null;
      const isDoublingDown = latestReview?.verdict === 'on_track' || latestReview?.verdict === 'progressing';
      const isPivot = latestReview?.verdict === 'switched' || active.consecutive_misses >= 2;

      return res.json({
        success: true,
        milestone: {
          strategyId: active.id,
          title: active.title,
          kpi: active.kpi,
          target: active.target,
          currentValue: active.last_value,
          consecutiveMisses: active.consecutive_misses,
          status: isPivot ? 'pivot_recommended' : isDoublingDown ? 'doubling_down' : 'evaluating',
          latestVerdict: latestReview?.verdict ?? active.last_verdict ?? 'evaluating',
          latestNotes: latestReview?.notes ?? 'Strategy evaluation in progress.',
          evalWindowDays: active.eval_window_days,
        },
      });
    } catch (err) {
      logger.error({ err, userId }, 'strategy_milestone_endpoint_failed');
      return res.status(500).json({ success: false, error: 'Could not load strategy milestone.' });
    }
  });

  return router;
}
