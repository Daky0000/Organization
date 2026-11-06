import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  Notice,
  RelativeTime,
  SectionHeading,
  StatGrid,
  StatTile,
  Table,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui';
import { autopilotService } from '../../services/autopilotService';

interface Props {
  onRefreshOverview: () => void;
}

export default function PerformanceTab({ onRefreshOverview }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [summary, setSummary] = useState<any | null>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any | null>(null);
  const [trafficFilter, setTrafficFilter] = useState<'all' | 'organic' | 'paid'>('all');

  // Metric logging form
  const [metricPillar, setMetricPillar] = useState('Educational Breakdown');
  const [metricFormat, setMetricFormat] = useState('carousel');
  const [metricChannel, setMetricChannel] = useState('instagram');
  const [metricReach, setMetricReach] = useState(1200);
  const [metricSaves, setMetricSaves] = useState(45);
  const [metricLeads, setMetricLeads] = useState(3);

  // Hypothesis experiment form
  const [hypothesis, setHypothesis] = useState('');
  const [variableChanged, setVariableChanged] = useState('hook_framing');

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, ledgerRes] = await Promise.all([
        autopilotService.getAnalyticsSummary(),
        autopilotService.getUsageLedger().catch(() => ({ ledger: null })),
      ]);
      setSummary(res.summary);
      setRecommendations(res.recommendations || []);
      setExperiments(res.experiments || []);
      if (ledgerRes?.ledger) setLedger(ledgerRes.ledger);
    } catch (e: any) {
      setError(e.message || 'Failed to load performance & insights');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const handleLogMetric = async () => {
    setBusy(true);
    setError(null);
    try {
      await autopilotService.ingestMetrics({
        channel: metricChannel,
        pillar_name: metricPillar.trim() || 'General',
        format: metricFormat,
        objective: summary?.objective || 'lead_generation',
        metrics: {
          reach: Number(metricReach) || 0,
          saves: Number(metricSaves) || 0,
          qualified_leads: Number(metricLeads) || 0,
        },
      });
      await loadAnalytics();
      setNote('Recorded post performance sample against workspace baseline.');
    } catch (e: any) {
      setError(e.message || 'Failed to record metrics');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateRecommendations = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.generateRecommendations();
      setNote(res.message);
      await loadAnalytics();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to evaluate strategy recommendations');
    } finally {
      setBusy(false);
    }
  };

  const handleDecide = async (recId: string, decision: 'accepted' | 'rejected' | 'defer') => {
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.decideRecommendation(recId, decision);
      setNote(
        decision === 'accepted'
          ? `Accepted recommendation and created Strategy v${res.updatedStrategy?.current_version ?? 'next'}.`
          : decision === 'defer'
            ? 'Deferred recommendation. It will be re-evaluated after additional sample posts are gathered.'
            : 'Rejected recommendation; strategy left unchanged.',
      );
      await loadAnalytics();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to apply decision');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateExperiment = async () => {
    if (!hypothesis.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await autopilotService.createExperiment({
        hypothesis: hypothesis.trim(),
        variable_changed: variableChanged,
        channel: metricChannel,
        primary_metric: summary?.kpi_framework?.primary_metric_key || 'saves',
        min_sample_size: 6,
      });
      setHypothesis('');
      await loadAnalytics();
      setNote('Created single-variable hypothesis experiment.');
    } catch (e: any) {
      setError(e.message || 'Failed to create experiment');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Loading label="Loading objective-aware analytics" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Analytics Error">{error}</Notice>}
      {note && <Notice tone="positive" title="Insights Engine">{note}</Notice>}

      {summary && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted font-medium">Traffic Scope:</span>
              {(['all', 'organic', 'paid'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTrafficFilter(mode)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                    trafficFilter === mode
                      ? 'bg-ink text-white'
                      : 'bg-sunken text-muted hover:text-ink border border-line'
                  }`}
                >
                  {mode === 'all' ? 'All Channels' : mode}
                </button>
              ))}
            </div>
            <div className="font-mono text-xs text-muted">
              Observation Window: 30-Day Moving Baseline (n = {summary.sample_size} posts)
            </div>
          </div>

          <Notice tone="info" title={`Objective KPI Lens: ${summary.kpi_framework?.label || summary.objective}`}>
            {summary.kpi_framework?.attribution_note}
          </Notice>

          {!summary.sufficient_for_strategy_recommendations && (
            <Notice tone="warn" title="LOW STATISTICAL SAMPLE SIZE (< 5 SAMPLES)">
              Currently {summary.sample_size} of 5 required post outcomes ingested. Strategy recommendations remain locked until sufficient sample volume avoids overreacting to single-post anomalies.
            </Notice>
          )}

          <StatGrid columns={4}>
            <StatTile
              label="SAMPLE SIZE"
              value={summary.sample_size}
              sub={
                summary.sufficient_for_strategy_recommendations
                  ? 'Meets n ≥ 5 recommendation threshold'
                  : `Need ${summary.minimum_sample_size_required} samples before strategy shifts`
              }
            />
            <StatTile
              label="BASELINE SCORE"
              value={summary.baseline_objective_score ?? '—'}
              sub={`Primary: ${(summary.kpi_framework?.primary_kpis || []).slice(0, 2).join(', ')}`}
            />
            <StatTile
              label="TOTAL SAVES"
              value={summary.totals?.saves !== null && summary.totals?.saves !== undefined ? summary.totals.saves : '—'}
              sub="Educational utility signal"
            />
            <StatTile
              label="QUALIFIED LEADS / CONV"
              value={
                summary.totals?.qualified_leads !== null && summary.totals?.qualified_leads !== undefined
                  ? summary.totals.qualified_leads + (summary.totals?.conversions ?? 0)
                  : '—'
              }
              sub="Attributed downstream actions"
            />
          </StatGrid>
        </>
      )}

      {/* Sample-Size-Gated Recommendations (Never Silently Mutates Strategy!) */}
      <Card>
        <SectionHeading
          title="Sample-Size-Gated Strategy Recommendations"
          hint="Autopilot never silently rewrites your strategy or overreacts to a single viral post. Proposals require n ≥ 5 samples and explicit operator sign-off."
          action={
            /* Single accent CTA on Performance view */
            <Button variant="accent" size="sm" onClick={handleGenerateRecommendations} disabled={busy}>
              Evaluate Recommendations
            </Button>
          }
        />

        {recommendations.length === 0 ? (
          <EmptyState message="No pending or historical strategy recommendations yet. Ingest at least 5 post outcomes to unlock confidence-scored proposals." />
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div key={rec.id} className="rounded-xl border border-line bg-sunken p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={rec.status === 'accepted' ? 'positive' : rec.status === 'rejected' ? 'muted' : 'info'}>
                      {rec.status}
                    </Badge>
                    <span className="font-mono text-xs text-muted">
                      n={rec.sample_size} · confidence {Math.round((rec.confidence || 0) * 100)}%
                    </span>
                  </div>
                  {rec.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" onClick={() => void handleDecide(rec.id, 'accepted')} disabled={busy}>
                        Accept & Create Strategy Version
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void handleDecide(rec.id, 'rejected')} disabled={busy}>
                        Reject
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleDecide(rec.id, 'defer')} disabled={busy}>
                        Defer
                      </Button>
                    </div>
                  )}
                </div>
                <h3 className="mt-2 font-display text-base font-medium text-ink">{rec.title}</h3>
                <p className="mt-1 text-xs text-ink">{rec.summary}</p>
                {rec.attribution_note && <p className="mt-1 text-[11px] text-muted">{rec.attribution_note}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Record Post Outcome & Structured Experiments */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading
            title="Ingest Channel Outcome Sample"
            hint="Log platform or UTM/CRM conversion outcomes against pillar and format."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pillar Name">
              <input className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={metricPillar} onChange={(e) => setMetricPillar(e.target.value)} />
            </Field>
            <Field label="Format">
              <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={metricFormat} onChange={(e) => setMetricFormat(e.target.value)}>
                <option value="carousel">carousel</option>
                <option value="product_demo">product_demo</option>
                <option value="short_video">short_video</option>
                <option value="static_graphic">static_graphic</option>
              </select>
            </Field>
            <Field label="Channel">
              <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={metricChannel} onChange={(e) => setMetricChannel(e.target.value)}>
                <option value="instagram">instagram</option>
                <option value="linkedin">linkedin</option>
                <option value="facebook">facebook</option>
                <option value="twitter">twitter</option>
              </select>
            </Field>
            <Field label="Reach">
              <input type="number" className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink" value={metricReach} onChange={(e) => setMetricReach(Number(e.target.value))} />
            </Field>
            <Field label="Saves">
              <input type="number" className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink" value={metricSaves} onChange={(e) => setMetricSaves(Number(e.target.value))} />
            </Field>
            <Field label="Qualified Leads / Conversions">
              <input type="number" className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink" value={metricLeads} onChange={(e) => setMetricLeads(Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" size="sm" onClick={handleLogMetric} disabled={busy}>
              Record Outcome Sample
            </Button>
          </div>
        </Card>

        <Card>
          <SectionHeading
            title="Hypothesis-Driven Experiments"
            hint="Change one variable at a time (hook framing, format, CTA, or posting slot) with a minimum sample size."
          />
          <div className="space-y-3">
            <Field label="Single Variable Changed">
              <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={variableChanged} onChange={(e) => setVariableChanged(e.target.value)}>
                <option value="hook_framing">Hook Framing (Problem-First vs Proof-First)</option>
                <option value="format">Asset Format (Carousel vs Product Demo Reel)</option>
                <option value="cta_style">CTA Style (Save Reference vs Book Walkthrough)</option>
                <option value="posting_slot">Named Weekly Slot (Morning vs Afternoon)</option>
              </select>
            </Field>
            <Field label="Testable Hypothesis">
              <input
                className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink"
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                placeholder="e.g. Problem-led carousel hooks increase saves by ≥15% over generic announcements"
              />
            </Field>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={handleCreateExperiment} disabled={busy || !hypothesis.trim()}>
                Launch Experiment
              </Button>
            </div>

            {experiments.length > 0 && (
              <Table>
                <Thead>
                  <Th>Hypothesis</Th>
                  <Th>Variable</Th>
                  <Th>Status</Th>
                </Thead>
                <tbody>
                  {experiments.map((ex) => (
                    <Tr key={ex.id}>
                      <Td className="text-xs">{ex.hypothesis}</Td>
                      <Td><span className="font-mono text-xs text-muted">{ex.variable_changed}</span></Td>
                      <Td><Badge tone={ex.status === 'completed' ? 'positive' : 'info'}>{ex.status}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      {/* Provider Usage & Cost Ledger Table */}
      {ledger && (
        <Card>
          <SectionHeading
            title="Third-Party Provider & Workspace Credit Usage Ledger"
            hint="Full dual-currency audit ledger tracking live provider vs sandbox fallback runs, reservation timestamps, and USD/credit settlement."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted">MTD Spend: ${Number(ledger.month_to_date_spend_usd ?? 0).toFixed(2)} USD</Badge>
                <Badge tone="muted">MTD Credits: {ledger.month_to_date_credits ?? 0} cr</Badge>
              </div>
            }
          />
          {(ledger.entries || []).length === 0 ? (
            <EmptyState message="No model generation ledger entries recorded in this billing cycle." />
          ) : (
            <Table>
              <Thead>
                <Th>Workflow / Job</Th>
                <Th>Provider / Model</Th>
                <Th>Mode</Th>
                <Th>Cost (USD)</Th>
                <Th>Credits</Th>
                <Th>Status</Th>
                <Th>Time</Th>
              </Thead>
              <tbody>
                {ledger.entries.slice(0, 15).map((e: any) => (
                  <Tr key={e.id}>
                    <Td>
                      <div className="font-mono text-xs text-ink">{e.workflow_type || 'workflow'}</div>
                      <div className="font-mono text-[10px] text-muted">{e.job_id?.slice(0, 8)}</div>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-muted">{e.provider || 'internal'}</span>
                    </Td>
                    <Td>
                      <Badge tone={e.execution_mode === 'live_provider' ? 'positive' : 'muted'}>
                        {e.execution_mode === 'live_provider' ? 'Live Provider' : 'Sandbox Fallback'}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-ink">${Number(e.cost_usd ?? 0).toFixed(3)}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-ink">{e.credits_deducted ?? 0} cr</span>
                    </Td>
                    <Td>
                      <Badge tone={e.status === 'settled' ? 'positive' : e.status === 'released' ? 'muted' : 'info'}>
                        {e.status}
                      </Badge>
                    </Td>
                    <Td>
                      <RelativeTime value={e.created_at} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
