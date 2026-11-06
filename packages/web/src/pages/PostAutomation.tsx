import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal, Notice, PageHeader, StatGrid, StatTile, StatusDot, Toggle, Field } from '../components/ui';
import ScheduleCalendar from '../components/calendar/ScheduleCalendar';
import SocialTemplatesTab from '../components/automation/SocialTemplatesTab';
import AutoContentPlans from '../components/automation/AutoContentPlans';
import OnboardingAndStrategyTab from '../components/autopilot/OnboardingAndStrategyTab';
import BrandStudioTab from '../components/autopilot/BrandStudioTab';
import CreativeQueueTab from '../components/autopilot/CreativeQueueTab';
import ApprovalQueueTab from '../components/autopilot/ApprovalQueueTab';
import PublishingActivityTab from '../components/autopilot/PublishingActivityTab';
import PerformanceTab from '../components/autopilot/PerformanceTab';
import { autopilotService, type AutopilotOverview } from '../services/autopilotService';
import { useWorkspace } from '../contexts/WorkspaceContext';

type AutopilotSection =
  | 'strategy'
  | 'brand'
  | 'creative'
  | 'approvals'
  | 'calendar'
  | 'publishing'
  | 'performance'
  | 'autocontent'
  | 'social';

export default function PostAutomation() {
  const { currentOrg, currentProject } = useWorkspace();
  const [activeTab, setActiveTab] = useState<AutopilotSection>('strategy');
  const [overview, setOverview] = useState<AutopilotOverview | null>(null);
  const [opsHealth, setOpsHealth] = useState<any | null>(null);
  const [controls, setControls] = useState<any | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [savingControls, setSavingControls] = useState(false);
  const [controlsNotice, setControlsNotice] = useState<string | null>(null);

  // Editable controls modal state
  const [killSwitch, setKillSwitch] = useState(false);
  const [pubPaused, setPubPaused] = useState(false);
  const [maxMonthlySpend, setMaxMonthlySpend] = useState(50);
  const [maxMonthlyCredits, setMaxMonthlyCredits] = useState(1000);

  const loadOverview = useCallback(async () => {
    try {
      const [resOverview, resHealth, resControls] = await Promise.all([
        autopilotService.getOverview().catch(() => null),
        autopilotService.getOpsHealth().catch(() => null),
        autopilotService.getTenantControls().catch(() => null),
      ]);
      if (resOverview) setOverview(resOverview);
      if (resHealth) setOpsHealth(resHealth);
      if (resControls?.controls) {
        setControls(resControls.controls);
        setKillSwitch(Boolean(resControls.controls.kill_switch_active));
        setPubPaused(Boolean(resControls.controls.publishing_paused));
        setMaxMonthlySpend(resControls.controls.max_monthly_provider_usd ?? 50);
        setMaxMonthlyCredits(resControls.controls.max_monthly_internal_credits ?? 1000);
      }
    } catch {
      // Keep page interactive even before first save
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, currentOrg?.id, currentProject?.id]);

  const handleSaveControls = async () => {
    setSavingControls(true);
    setControlsNotice(null);
    try {
      const res = await autopilotService.updateTenantControls({
        kill_switch_active: killSwitch,
        publishing_paused: pubPaused,
        max_monthly_provider_usd: Number(maxMonthlySpend),
        max_monthly_internal_credits: Number(maxMonthlyCredits),
      });
      setControls(res.controls);
      setControlsNotice('Tenant governance controls updated successfully.');
      void loadOverview();
    } catch (e: any) {
      setControlsNotice(`Failed to save controls: ${e.message}`);
    } finally {
      setSavingControls(false);
    }
  };

  const tabs: Array<{ id: AutopilotSection; label: string; count?: number }> = [
    { id: 'strategy', label: 'Strategy & Setup' },
    { id: 'brand', label: 'Brand Studio' },
    { id: 'creative', label: 'Creative Queue', count: overview?.counts?.planned },
    { id: 'approvals', label: 'Approval Queue', count: overview?.counts?.review_required },
    { id: 'calendar', label: 'Calendar' },
    { id: 'publishing', label: 'Publishing & Ledger' },
    { id: 'performance', label: 'Performance', count: overview?.counts?.pending_recommendations },
    { id: 'autocontent', label: 'Blog Plans' },
    { id: 'social', label: 'Channel Templates' },
  ];

  const campaignStages: Array<{
    num: number;
    title: string;
    sub: string;
    tab: AutopilotSection;
    isComplete?: boolean;
    isActive?: boolean;
  }> = [
    { num: 1, title: 'Context', sub: 'Business profile', tab: 'strategy', isComplete: Boolean(overview?.strategy) },
    { num: 2, title: 'Brand', sub: 'Tokens & vault', tab: 'brand', isComplete: overview?.brand?.approval_status === 'approved' },
    { num: 3, title: 'Strategy', sub: 'Pillars & cadence', tab: 'strategy', isComplete: Boolean(overview?.strategy) },
    { num: 4, title: 'Briefs', sub: 'Parameterized', tab: 'creative', isComplete: (overview?.counts?.total_items ?? 0) > 0 },
    { num: 5, title: 'Synthesis', sub: 'Dual cost-capped', tab: 'creative', isComplete: (overview?.counts?.review_required ?? 0) > 0 || (overview?.counts?.approved ?? 0) > 0 },
    { num: 6, title: 'QA Gate', sub: 'Human sign-off', tab: 'approvals', isComplete: (overview?.counts?.approved ?? 0) > 0 },
    { num: 7, title: 'Schedule', sub: 'Named slots', tab: 'calendar', isComplete: (overview?.counts?.scheduled ?? 0) > 0 },
    { num: 8, title: 'Publish', sub: 'Idempotent delivery', tab: 'publishing', isComplete: (overview?.counts?.published ?? 0) > 0 },
    { num: 9, title: 'Feedback', sub: 'Objective KPIs', tab: 'performance', isComplete: false },
  ];

  const isLiveProvider = opsHealth?.providers?.copy === 'live_llm' || opsHealth?.providers?.visual === 'live_provider';

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="BRAND-AWARE SOCIAL CONTENT AUTOPILOT"
        title="Content Autopilot"
        subtitle="Plan industry-adaptive strategy, govern versioned brand tokens, generate deterministic & AI-assisted creatives within dual cost caps, enforce human compliance sign-off, and publish idempotently across channels."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {overview?.tenant && (
              <Badge tone="muted">
                Workspace: {currentProject?.name || currentOrg?.name || 'Personal'} ({overview.tenant.role})
              </Badge>
            )}
            {overview?.brand && (
              <Badge tone={overview.brand.approval_status === 'approved' ? 'positive' : 'warn'}>
                Brand v{overview.brand.current_version}
              </Badge>
            )}
            <Button variant="secondary" size="sm" onClick={() => setControlsOpen(true)}>
              Safety & Spend Controls
            </Button>
          </div>
        }
      />

      {/* Emergency Kill Switch Banner if Active */}
      {controls?.kill_switch_active && (
        <Notice tone="danger" title="EMERGENCY KILL SWITCH ACTIVE">
          All automated generation, workflow execution, and publication schedules are currently halted for this workspace. Use Safety Controls to restore automation.
        </Notice>
      )}

      {/* Execution Mode & Provider Health Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 font-medium text-xs text-ink">
            <StatusDot tone={controls?.kill_switch_active ? 'bad' : 'live'} />
            <span>Operational Engine:</span>
            <span className="font-mono text-muted">
              {opsHealth?.controls?.worker_loop ? 'Active (60s tick)' : 'Online'}
            </span>
          </div>

          <div className="h-4 w-[1px] bg-line hidden sm:block" />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Copy:</span>
            <Badge tone={opsHealth?.providers?.copy === 'live_llm' ? 'positive' : 'muted'}>
              {opsHealth?.providers?.copy === 'live_llm' ? 'Live LLM Provider' : 'Deterministic Adapter'}
            </Badge>
            <span className="text-muted">Visual:</span>
            <Badge tone={opsHealth?.providers?.visual === 'live_provider' ? 'positive' : 'muted'}>
              {opsHealth?.providers?.visual === 'live_provider' ? 'Live Provider Engine' : 'Deterministic Bitmap/SVG Compositor'}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLiveProvider ? (
            <Badge tone="positive">Live Provider Execution Active</Badge>
          ) : (
            <span title="Generates valid raster PNGs, SVG typography, and platform captions locally with zero 3rd-party API fees">
              <Badge tone="muted">Zero-Cost Sandbox Fallback Mode</Badge>
            </span>
          )}
          {controls?.publishing_paused && (
            <Badge tone="warn">Publishing Paused</Badge>
          )}
        </div>
      </div>

      {/* 9-Stage Campaign Stepper */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white p-3">
        <div className="flex min-w-[760px] items-center justify-between gap-1">
          {campaignStages.map((st) => {
            const isCurrent = activeTab === st.tab;
            return (
              <button
                key={st.num}
                type="button"
                onClick={() => setActiveTab(st.tab)}
                className={`group flex flex-1 flex-col items-center rounded-xl p-2 text-center transition ${
                  isCurrent
                    ? 'bg-ink text-white'
                    : 'bg-transparent text-muted hover:bg-sunken hover:text-ink'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] font-medium ${
                      isCurrent
                        ? 'bg-white text-ink'
                        : st.isComplete
                          ? 'bg-accent/20 text-accent-text font-bold'
                          : 'bg-sunken text-muted'
                    }`}
                  >
                    {st.isComplete && !isCurrent ? '✓' : st.num}
                  </span>
                  <span className={`text-xs font-medium ${isCurrent ? 'text-white' : 'text-ink'}`}>
                    {st.title}
                  </span>
                </div>
                <span className={`mt-0.5 text-[10px] ${isCurrent ? 'text-white/70' : 'text-muted'}`}>
                  {st.sub}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {overview && (
        <StatGrid columns={5}>
          <StatTile
            label="TOTAL PIECES"
            value={overview.counts.total_items}
            sub="Workspace pipeline"
            onClick={() => setActiveTab('creative')}
          />
          <StatTile
            label="NEEDS REVIEW"
            value={overview.counts.review_required}
            sub="Human QA & sign-off"
            onClick={() => setActiveTab('approvals')}
          />
          <StatTile
            label="APPROVED"
            value={overview.counts.approved}
            sub="Cleared to schedule"
            onClick={() => setActiveTab('approvals')}
          />
          <StatTile
            label="SCHEDULED"
            value={overview.counts.scheduled}
            sub="Named slots queued"
            onClick={() => setActiveTab('publishing')}
          />
          <StatTile
            label="PUBLISHED"
            value={overview.counts.published}
            sub={
              overview.counts.publish_failed > 0
                ? `${overview.counts.publish_failed} failed — inspect ledger`
                : 'Idempotent delivery active'
            }
            onClick={() => setActiveTab('publishing')}
          />
        </StatGrid>
      )}

      {/* Product Sub-Navigation */}
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-white p-2"
        role="tablist"
        aria-label="Content Autopilot sections"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-xs font-medium transition ${
                isActive
                  ? 'bg-ink text-white'
                  : 'text-muted hover:bg-sunken hover:text-ink'
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                    isActive ? 'bg-white/20 text-white' : 'bg-sunken text-ink'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tenant Safety & Governance Controls Modal */}
      <Modal
        open={controlsOpen}
        onClose={() => setControlsOpen(false)}
        title="Workspace Safety & Spending Governance"
        subtitle="Manage circuit breakers, emergency kill switches, and monthly provider spend ceilings."
      >
        <div className="space-y-4 text-xs">
          {controlsNotice && <Notice tone="info" title="Status">{controlsNotice}</Notice>}

          <div className="rounded-xl border border-line bg-sunken p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-ink">Emergency Kill Switch</div>
                <div className="text-muted text-[11px]">Immediately aborts all automated brief execution, asset generation, and publishing workers.</div>
              </div>
              <Toggle checked={killSwitch} onChange={setKillSwitch} label="" />
            </div>

            <div className="flex items-center justify-between border-t border-line pt-3">
              <div>
                <div className="font-medium text-ink">Pause Scheduled Publishing</div>
                <div className="text-muted text-[11px]">Holds outgoing named-slot publications in the queue without canceling scheduled items.</div>
              </div>
              <Toggle checked={pubPaused} onChange={setPubPaused} label="" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Max Monthly Provider Spend (USD)" hint="Blocks requests exceeding this model budget cap">
              <input
                type="number"
                min={0}
                step={5}
                className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink"
                value={maxMonthlySpend}
                onChange={(e) => setMaxMonthlySpend(Number(e.target.value))}
              />
            </Field>

            <Field label="Max Monthly Internal Credits" hint="Ceiling for workspace internal credit deduction">
              <input
                type="number"
                min={0}
                step={50}
                className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink"
                value={maxMonthlyCredits}
                onChange={(e) => setMaxMonthlyCredits(Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Button variant="secondary" size="sm" onClick={() => setControlsOpen(false)}>
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveControls} disabled={savingControls}>
              {savingControls ? 'Saving…' : 'Apply Safety Controls'}
            </Button>
          </div>
        </div>
      </Modal>

      {activeTab === 'strategy' && (
        <OnboardingAndStrategyTab
          key={`strat:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
          onOpenCreativeQueue={() => setActiveTab('creative')}
          onOpenBrandStudio={() => setActiveTab('brand')}
        />
      )}

      {activeTab === 'brand' && (
        <BrandStudioTab
          key={`brand:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
        />
      )}

      {activeTab === 'creative' && (
        <CreativeQueueTab
          key={`creative:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
          onOpenApprovalQueue={() => setActiveTab('approvals')}
        />
      )}

      {activeTab === 'approvals' && (
        <ApprovalQueueTab
          key={`approvals:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
          onOpenPublishing={() => setActiveTab('publishing')}
        />
      )}

      {activeTab === 'calendar' && <ScheduleCalendar />}

      {activeTab === 'publishing' && (
        <PublishingActivityTab
          key={`pub:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
        />
      )}

      {activeTab === 'performance' && (
        <PerformanceTab
          key={`perf:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
        />
      )}

      {activeTab === 'autocontent' && <AutoContentPlans />}
      {activeTab === 'social' && <SocialTemplatesTab />}
    </div>
  );
}
