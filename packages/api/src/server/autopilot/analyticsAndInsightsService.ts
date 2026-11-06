import { randomUUID } from 'crypto';
import type { AutopilotRepository } from './repository.ts';
import type { ContentStrategyRecord, MarketingObjective } from './types.ts';

export const MIN_RECOMMENDATION_SAMPLE_SIZE = 5;

export interface ObjectiveKpiSpec {
  objective: MarketingObjective;
  label: string;
  primary_kpis: string[];
  primary_metric_key: string;
  secondary_kpis: string[];
  attribution_note: string;
}

export const OBJECTIVE_KPI_FRAMEWORK: Record<MarketingObjective, ObjectiveKpiSpec> = {
  awareness: {
    objective: 'awareness',
    label: 'Brand Awareness & Reach',
    primary_kpis: ['Reach', 'Non-follower impressions', 'Profile visits'],
    primary_metric_key: 'reach',
    secondary_kpis: ['3s/50% video completion rate', 'Shares'],
    attribution_note: 'Impressions and reach measure top-of-funnel visibility, not direct purchase intent.',
  },
  education: {
    objective: 'education',
    label: 'Audience Education & Utility',
    primary_kpis: ['Saves', 'Shares', 'Carousel completion / watch retention'],
    primary_metric_key: 'saves',
    secondary_kpis: ['Thoughtful comments', 'Profile visits'],
    attribution_note: 'Saves and shares signal educational reference value; downstream conversion often occurs weeks later.',
  },
  engagement: {
    objective: 'engagement',
    label: 'Community & Conversation',
    primary_kpis: ['Meaningful comments', 'Shares', 'Engagement rate per reach'],
    primary_metric_key: 'comments',
    secondary_kpis: ['Saves', 'DM replies'],
    attribution_note: 'High comment volume reflects topic resonance, which may not correlate 1:1 with buyer readiness.',
  },
  lead_generation: {
    objective: 'lead_generation',
    label: 'Qualified Lead Generation',
    primary_kpis: ['UTM link clicks', 'Qualified DMs / enquiries', 'Form / demo submissions'],
    primary_metric_key: 'qualified_leads',
    secondary_kpis: ['Profile action taps', 'Saves on proof assets'],
    attribution_note: 'Social touchpoints are frequently dark-social assisted; reconcile platform clicks with self-reported CRM attribution.',
  },
  sales: {
    objective: 'sales',
    label: 'Product Merchandising & Conversion',
    primary_kpis: ['Product page clicks (UTM)', 'Add-to-cart / checkout initiations', 'Attributed orders'],
    primary_metric_key: 'conversions',
    secondary_kpis: ['Product tag taps', 'Saves on buying guides'],
    attribution_note: 'Last-click social attribution undercounts multi-session shoppers and overcounts retargeting; evaluate blended lift.',
  },
  retention: {
    objective: 'retention',
    label: 'Customer Adoption & Retention',
    primary_kpis: ['Feature walkthrough completion', 'Repeat-visitor clicks', 'Saves'],
    primary_metric_key: 'saves',
    secondary_kpis: ['Support FAQ deflection signals', 'Community replies'],
    attribution_note: 'Retention content supports product adoption alongside lifecycle email and in-app guidance.',
  },
  hiring: {
    objective: 'hiring',
    label: 'Talent Brand & Recruiting',
    primary_kpis: ['Careers page clicks', 'Qualified applicant referrals', 'Shares'],
    primary_metric_key: 'link_clicks',
    secondary_kpis: ['Profile visits', 'Team post saves'],
    attribution_note: 'Employer brand posts influence candidate conversion across multiple touchpoints prior to application.',
  },
  community: {
    objective: 'community',
    label: 'Community Participation',
    primary_kpis: ['Event RSVPs / group joins', 'Replies & shares', 'Returning commenters'],
    primary_metric_key: 'shares',
    secondary_kpis: ['Reach', 'Saves'],
    attribution_note: 'Community health compounds over consistent cadence rather than isolated viral spikes.',
  },
  launches: {
    objective: 'launches',
    label: 'Product / Campaign Launch',
    primary_kpis: ['Launch page clicks', 'Waitlist / trial signups', 'Announcement shares'],
    primary_metric_key: 'link_clicks',
    secondary_kpis: ['Reach', 'Demo video retention'],
    attribution_note: 'Launch spikes reflect pent-up audience interest; compare post-launch steady-state against pre-launch baseline.',
  },
  thought_leadership: {
    objective: 'thought_leadership',
    label: 'Category Authority & Executive Trust',
    primary_kpis: ['Shares', 'Saves', 'Target-role profile visits & inbound enquiries'],
    primary_metric_key: 'shares',
    secondary_kpis: ['Substantive comments', 'Newsletter / site clicks'],
    attribution_note: 'Executive authority shortens consultative sales cycles in ways rarely captured by last-click UTMs.',
  },
};

function computeObjectiveScore(metrics: Record<string, number>, objective: MarketingObjective): number {
  const spec = OBJECTIVE_KPI_FRAMEWORK[objective] ?? OBJECTIVE_KPI_FRAMEWORK.awareness;
  const rawPrimary = metrics[spec.primary_metric_key];
  // If the primary KPI was explicitly measured and supplied (even if 0!), return it directly
  if (rawPrimary !== undefined && rawPrimary !== null && !Number.isNaN(Number(rawPrimary))) {
    return Number(rawPrimary);
  }

  // Fallback weighted composite only when raw platform payload lacks the primary metric key
  const saves = Number(metrics.saves ?? 0);
  const shares = Number(metrics.shares ?? 0);
  const clicks = Number(metrics.link_clicks ?? metrics.clicks ?? 0);
  const leads = Number(metrics.qualified_leads ?? metrics.conversions ?? 0);
  const comments = Number(metrics.comments ?? 0);
  const reach = Number(metrics.reach ?? metrics.impressions ?? 0);

  if (objective === 'lead_generation' || objective === 'sales') {
    return leads * 25 + clicks * 4 + saves * 2 + shares * 2 + reach * 0.005;
  }
  if (objective === 'education' || objective === 'thought_leadership') {
    return saves * 5 + shares * 5 + comments * 3 + clicks * 2 + reach * 0.005;
  }
  return reach * 0.02 + shares * 4 + saves * 3 + comments * 2 + clicks * 2;
}

export async function buildAnalyticsSummary(params: {
  repo: AutopilotRepository;
  tenantId: string;
}) {
  const { repo, tenantId } = params;
  const business = await repo.getBusinessProfile(tenantId);
  const strategy = await repo.getLatestStrategy(tenantId);
  const rows = await repo.listChannelMetrics(tenantId);
  const primaryObjective: MarketingObjective =
    strategy?.objective?.primary || business?.primary_objective || 'awareness';
  const kpiSpec = OBJECTIVE_KPI_FRAMEWORK[primaryObjective] ?? OBJECTIVE_KPI_FRAMEWORK.awareness;

  const totals = {
    sample_size: rows.length,
    reach: 0,
    saves: 0,
    shares: 0,
    comments: 0,
    link_clicks: 0,
    qualified_leads: 0,
    conversions: 0,
  };

  const byPillar: Record<string, { count: number; totalScore: number; avgScore: number }> = {};
  const byFormat: Record<string, { count: number; totalScore: number; avgScore: number }> = {};
  const byChannel: Record<string, { count: number; totalScore: number; avgScore: number }> = {};

  let totalScore = 0;

  for (const r of rows) {
    const m = r.metrics || {};
    totals.reach += Number(m.reach ?? m.impressions ?? 0);
    totals.saves += Number(m.saves ?? 0);
    totals.shares += Number(m.shares ?? 0);
    totals.comments += Number(m.comments ?? 0);
    totals.link_clicks += Number(m.link_clicks ?? m.clicks ?? 0);
    totals.qualified_leads += Number(m.qualified_leads ?? 0);
    totals.conversions += Number(m.conversions ?? 0);

    const score = computeObjectiveScore(m, primaryObjective);
    totalScore += score;

    const pillarKey = r.pillar_name || 'Unassigned Pillar';
    byPillar[pillarKey] ??= { count: 0, totalScore: 0, avgScore: 0 };
    byPillar[pillarKey].count += 1;
    byPillar[pillarKey].totalScore += score;

    const formatKey = r.format || 'static_graphic';
    byFormat[formatKey] ??= { count: 0, totalScore: 0, avgScore: 0 };
    byFormat[formatKey].count += 1;
    byFormat[formatKey].totalScore += score;

    const chKey = r.channel || 'instagram';
    byChannel[chKey] ??= { count: 0, totalScore: 0, avgScore: 0 };
    byChannel[chKey].count += 1;
    byChannel[chKey].totalScore += score;
  }

  for (const group of [byPillar, byFormat, byChannel]) {
    for (const k of Object.keys(group)) {
      group[k].avgScore = Number((group[k].totalScore / Math.max(1, group[k].count)).toFixed(2));
    }
  }

  // Robust trimmed mean: if n >= 10, drop extreme top & bottom 5% outliers
  let baselineAvgScore = 0;
  if (rows.length > 0) {
    if (rows.length >= 10) {
      const scores = rows.map((r) => computeObjectiveScore(r.metrics || {}, primaryObjective)).sort((a, b) => a - b);
      const trimCount = Math.max(1, Math.floor(scores.length * 0.05));
      const trimmed = scores.slice(trimCount, scores.length - trimCount);
      const sumTrimmed = trimmed.reduce((a, b) => a + b, 0);
      baselineAvgScore = Number((sumTrimmed / Math.max(1, trimmed.length)).toFixed(2));
    } else {
      baselineAvgScore = Number((totalScore / rows.length).toFixed(2));
    }
  }

  return {
    objective: primaryObjective,
    kpi_framework: kpiSpec,
    sample_size: rows.length,
    sufficient_for_strategy_recommendations: rows.length >= MIN_RECOMMENDATION_SAMPLE_SIZE,
    minimum_sample_size_required: MIN_RECOMMENDATION_SAMPLE_SIZE,
    baseline_objective_score: baselineAvgScore,
    totals,
    breakdown: {
      by_pillar: byPillar,
      by_format: byFormat,
      by_channel: byChannel,
    },
  };
}

export async function generateStrategyRecommendations(params: {
  repo: AutopilotRepository;
  tenantId: string;
}) {
  const { repo, tenantId } = params;
  const summary = await buildAnalyticsSummary({ repo, tenantId });
  const strategy = await repo.getLatestStrategy(tenantId);

  // Guard against overreacting to 1 viral post or tiny samples (Section 12.2 & 12.3)
  if (summary.sample_size < MIN_RECOMMENDATION_SAMPLE_SIZE) {
    return {
      generated: [],
      insufficient_evidence: true,
      sample_size: summary.sample_size,
      minimum_required: MIN_RECOMMENDATION_SAMPLE_SIZE,
      message: `Collected ${summary.sample_size} published post metric sample(s); at least ${MIN_RECOMMENDATION_SAMPLE_SIZE} posts are required before proposing strategy adjustments so a single outlier post never distorts your plan.`,
    };
  }

  const generated: Array<Record<string, any>> = [];
  const baseline = Math.max(0.01, summary.baseline_objective_score);

  // 1. Evaluate Pillar Performance vs Tenant Baseline (requiring group count >= 2 & total >= 5)
  const pillarEntries = Object.entries(summary.breakdown.by_pillar).filter(([, v]) => v.count >= 2);
  pillarEntries.sort((a, b) => b[1].avgScore - a[1].avgScore);

  if (pillarEntries.length >= 2) {
    const [topPillarName, topStats] = pillarEntries[0];
    const [lowPillarName, lowStats] = pillarEntries[pillarEntries.length - 1];
    const upliftRatio = topStats.avgScore / baseline;

    if (upliftRatio >= 1.25 && topPillarName !== lowPillarName) {
      const confidence = Number(Math.min(0.9, 0.55 + Math.min(0.25, summary.sample_size * 0.025) + Math.min(0.1, (upliftRatio - 1) * 0.15)).toFixed(3));
      const rec = await repo.saveRecommendation({
        id: randomUUID(),
        tenant_id: tenantId,
        strategy_id: strategy?.id ?? null,
        category: 'pillar_reallocation',
        title: `Shift +10% weight toward "${topPillarName}"`,
        summary: `"${topPillarName}" outperformed workspace baseline by ${Math.round((upliftRatio - 1) * 100)}% on ${summary.objective.replace('_', ' ')} signals across ${topStats.count} posts (total n=${summary.sample_size}).`,
        evidence: {
          top_pillar: { name: topPillarName, count: topStats.count, avg_score: topStats.avgScore },
          underperforming_pillar: { name: lowPillarName, count: lowStats.count, avg_score: lowStats.avgScore },
          baseline_score: summary.baseline_objective_score,
        },
        sample_size: summary.sample_size,
        confidence,
        proposed_patch: {
          type: 'rebalance_pillars',
          increase_pillar: topPillarName,
          decrease_pillar: lowPillarName,
          delta_pct: 10,
        },
        attribution_note: summary.kpi_framework.attribution_note,
        status: 'pending',
      });
      generated.push(rec);
    }
  }

  // 2. Evaluate Format Performance vs Tenant Baseline
  const formatEntries = Object.entries(summary.breakdown.by_format).filter(([, v]) => v.count >= 2);
  formatEntries.sort((a, b) => b[1].avgScore - a[1].avgScore);
  if (formatEntries.length >= 2) {
    const [bestFormat, bestStats] = formatEntries[0];
    const uplift = bestStats.avgScore / baseline;
    if (uplift >= 1.2) {
      const confidence = Number(Math.min(0.88, 0.52 + Math.min(0.25, summary.sample_size * 0.02)).toFixed(3));
      const rec = await repo.saveRecommendation({
        id: randomUUID(),
        tenant_id: tenantId,
        strategy_id: strategy?.id ?? null,
        category: 'format_mix',
        title: `Prioritize ${bestFormat.replace('_', ' ')} format in upcoming batch`,
        summary: `Format "${bestFormat}" delivered ${Math.round((uplift - 1) * 100)}% higher ${summary.objective.replace('_', ' ')} resonance than workspace average across ${bestStats.count} samples.`,
        evidence: {
          format: bestFormat,
          count: bestStats.count,
          avg_score: bestStats.avgScore,
          baseline_score: summary.baseline_objective_score,
        },
        sample_size: summary.sample_size,
        confidence,
        proposed_patch: {
          type: 'prioritize_format',
          preferred_format: bestFormat,
        },
        attribution_note: summary.kpi_framework.attribution_note,
        status: 'pending',
      });
      generated.push(rec);
    }
  }

  return {
    generated,
    insufficient_evidence: false,
    sample_size: summary.sample_size,
    minimum_required: MIN_RECOMMENDATION_SAMPLE_SIZE,
    message: generated.length
      ? `Generated ${generated.length} reviewable recommendation(s). Strategy remains unchanged until you accept a proposal.`
      : 'Performance across pillars and formats is balanced relative to baseline; no strategy shift needed yet.',
  };
}

export async function decideStrategyRecommendation(params: {
  repo: AutopilotRepository;
  tenantId: string;
  recommendationId: string;
  decision: 'accepted' | 'rejected' | 'defer';
  actorUserId: string;
  actorRole: string;
}): Promise<{ recommendation: Record<string, any>; updatedStrategy: ContentStrategyRecord | null }> {
  const { repo, tenantId, recommendationId, decision, actorUserId, actorRole } = params;
  const rec = await repo.getRecommendation(tenantId, recommendationId);
  if (!rec) {
    throw new Error('Recommendation not found in this workspace.');
  }

  const now = new Date().toISOString();
  rec.status = decision === 'defer' ? 'deferred' : decision;
  rec.decided_by = actorUserId;
  rec.decided_at = now;
  await repo.saveRecommendation(rec);

  let updatedStrategy: ContentStrategyRecord | null = null;

  if (decision === 'accepted' && rec.strategy_id) {
    const strategy = await repo.getStrategyById(tenantId, rec.strategy_id);
    if (strategy) {
      const nextStrategy: ContentStrategyRecord = structuredClone(strategy);
      nextStrategy.current_version += 1;
      nextStrategy.updated_at = now;

      const patch = rec.proposed_patch || {};
      if (patch.type === 'rebalance_pillars' && nextStrategy.pillars.length >= 2) {
        const inc = nextStrategy.pillars.find((p) => p.name === patch.increase_pillar);
        const dec = nextStrategy.pillars.find((p) => p.name === patch.decrease_pillar);
        const delta = Number(patch.delta_pct || 10);
        if (inc && dec && dec.allocation_pct > delta + 5) {
          inc.allocation_pct += delta;
          dec.allocation_pct -= delta;
        }
      } else if (patch.type === 'prioritize_format' && patch.preferred_format) {
        for (const p of nextStrategy.pillars) {
          if (!p.formats.includes(patch.preferred_format)) {
            p.formats = [patch.preferred_format, ...p.formats].slice(0, 3);
          }
        }
      }

      updatedStrategy = await repo.saveStrategy(
        nextStrategy,
        actorUserId,
        `Accepted performance recommendation: ${rec.title} (n=${rec.sample_size}, confidence=${rec.confidence})`,
      );
    }
  }

  await repo.recordAudit(tenantId, actorUserId, actorRole, `recommendation.${decision}`, 'recommendation', recommendationId, {
    title: rec.title,
    new_strategy_version: updatedStrategy?.current_version ?? null,
  });

  return { recommendation: rec, updatedStrategy };
}

export function evaluateExperimentOutcome(params: {
  minSampleSize: number;
  controlScores: number[];
  variantScores: number[];
}): {
  outcome: 'inconclusive_sample_too_small' | 'variant_outperformed' | 'control_retained';
  control_mean: number;
  variant_mean: number;
  lift_pct: number;
  total_samples: number;
  summary: string;
} {
  const totalSamples = params.controlScores.length + params.variantScores.length;
  const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const cMean = Number(mean(params.controlScores).toFixed(2));
  const vMean = Number(mean(params.variantScores).toFixed(2));
  const liftPct = cMean > 0 ? Number((((vMean - cMean) / cMean) * 100).toFixed(1)) : 0;

  if (totalSamples < Math.max(4, params.minSampleSize) || params.controlScores.length < 2 || params.variantScores.length < 2) {
    return {
      outcome: 'inconclusive_sample_too_small',
      control_mean: cMean,
      variant_mean: vMean,
      lift_pct: liftPct,
      total_samples: totalSamples,
      summary: `Sample size (${totalSamples}/${params.minSampleSize}) is too small to draw a reliable conclusion yet.`,
    };
  }

  if (liftPct >= 15) {
    return {
      outcome: 'variant_outperformed',
      control_mean: cMean,
      variant_mean: vMean,
      lift_pct: liftPct,
      total_samples: totalSamples,
      summary: `Test variant outperformed control by +${liftPct}% across ${totalSamples} samples.`,
    };
  }

  return {
    outcome: 'control_retained',
    control_mean: cMean,
    variant_mean: vMean,
    lift_pct: liftPct,
    total_samples: totalSamples,
    summary: `Test variant did not clear the +15% practical lift threshold (${liftPct}%); retain control baseline.`,
  };
}
