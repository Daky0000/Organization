import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarRange,
  Clock3,
  Download,
  Layers3,
  Loader2,
  RefreshCcw,
  Target,
  TrendingUp,
} from 'lucide-react';
import InsightsPanel from '../components/analytics/InsightsPanel';
import KpiCard from '../components/analytics/KpiCard';
import PlatformBreakdown from '../components/analytics/PlatformBreakdown';
import TopPostsTable from '../components/analytics/TopPostsTable';
import TrendChart from '../components/analytics/TrendChart';
import ComparisonView from '../components/analytics/ComparisonView';
import TikTokAnalytics from '../components/analytics/TikTokAnalytics';
import FacebookAnalytics from '../components/analytics/FacebookAnalytics';
import InstagramAnalytics from '../components/analytics/InstagramAnalytics';
import ThreadsAnalytics from '../components/analytics/ThreadsAnalytics';
import PinterestAnalytics from '../components/analytics/PinterestAnalytics';
import LinkedInAnalytics from '../components/analytics/LinkedInAnalytics';
import type { AnalyticsRangePreset, BlogAnalyticsDashboard, DashboardQuery } from '../services/blogAnalyticsService';
import { blogAnalyticsService } from '../services/blogAnalyticsService';
import { fetchApiJson } from '../utils/apiRequest';

type Tab = 'overview' | 'tiktok' | 'facebook' | 'instagram' | 'threads' | 'pinterest' | 'linkedin' | 'comparison';

const PLATFORM_TABS: Array<{ id: Tab; label: string; platform: string }> = [
  { id: 'tiktok',    label: 'TikTok',    platform: 'tiktok' },
  { id: 'facebook',  label: 'Facebook',  platform: 'facebook' },
  { id: 'instagram', label: 'Instagram', platform: 'instagram' },
  { id: 'threads',   label: 'Threads',   platform: 'threads' },
  { id: 'pinterest', label: 'Pinterest', platform: 'pinterest' },
  { id: 'linkedin',  label: 'LinkedIn',  platform: 'linkedin' },
];

const PRESETS: Array<{ value: AnalyticsRangePreset; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

const DAYS_MAP: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  // null = still loading (show tabs as active to avoid false-disabled flash)
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string> | null>(null);

  // Publishing tab state (existing)
  const [selectedPreset, setSelectedPreset] = useState<AnalyticsRangePreset>('30d');
  const [query, setQuery] = useState<DashboardQuery>({ preset: '30d' });
  const [dashboard, setDashboard] = useState<BlogAnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Days integer for social tabs
  const socialDays = DAYS_MAP[selectedPreset] ?? 30;

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) return;
    fetchApiJson<{ data?: any[] }>('/api/accounts', { headers: { Authorization: `Bearer ${token}` } })
      .then(({ payload }) => {
        const accounts: any[] = payload?.data ?? [];
        setConnectedPlatforms(
          new Set(accounts.filter((a) => a?.connected !== false).map((a) => String(a.platform || '').toLowerCase()))
        );
      })
      .catch(() => setConnectedPlatforms(new Set()));
  }, []);

  useEffect(() => {
    if (activeTab !== 'overview') return;
    let alive = true;
    setLoading(true);
    setError(null);

    void blogAnalyticsService
      .fetchDashboard(query)
      .then((data) => { if (!alive) return; setDashboard(data); })
      .catch((err) => { if (!alive) return; setError(err instanceof Error ? err.message : 'Failed to load analytics'); })
      .finally(() => { if (!alive) return; setLoading(false); setRefreshing(false); });

    return () => { alive = false; };
  }, [query, activeTab]);

  const performanceMode = dashboard?.metricsAvailability.performance ?? false;

  const cards = useMemo(() => {
    if (!dashboard) return [];
    if (performanceMode) {
      return [
        { label: 'Total Reach', value: dashboard.kpis.totalReach, trend: dashboard.kpis.totalReachChange, icon: <TrendingUp size={20} />, valueType: 'number' as const, subtext: dashboard.range.label },
        { label: 'Engagement Rate', value: dashboard.kpis.engagementRate, trend: dashboard.kpis.engagementRateChange, icon: <Activity size={20} />, valueType: 'percent' as const, subtext: dashboard.range.label },
        { label: 'Top Platform', value: dashboard.kpis.topPlatform?.label || null, trend: null, icon: <Layers3 size={20} />, valueType: 'text' as const, subtext: dashboard.kpis.topPlatform ? `${dashboard.kpis.topPlatform.share}% of publishes` : 'No platform data yet' },
        { label: 'Best Time Window', value: dashboard.kpis.bestTimeWindow?.label || null, trend: null, icon: <Clock3 size={20} />, valueType: 'text' as const, subtext: dashboard.kpis.bestTimeWindow?.supportingValue || 'Need more publishing data' },
      ];
    }
    return [
      { label: 'Published Posts', value: dashboard.kpis.publishedPosts, trend: dashboard.kpis.publishedPostsChange, icon: <BarChart3 size={20} />, valueType: 'number' as const, subtext: dashboard.range.label },
      { label: 'Publish Success Rate', value: dashboard.kpis.publishSuccessRate, trend: dashboard.kpis.publishSuccessRateChange, icon: <Target size={20} />, valueType: 'percent' as const, subtext: dashboard.range.label },
      { label: 'Top Platform', value: dashboard.kpis.topPlatform?.label || null, trend: null, icon: <Layers3 size={20} />, valueType: 'text' as const, subtext: dashboard.kpis.topPlatform ? `${dashboard.kpis.topPlatform.share}% of publishes` : 'No platform data yet' },
      { label: 'Best Time Window', value: dashboard.kpis.bestTimeWindow?.label || null, trend: null, icon: <Clock3 size={20} />, valueType: 'text' as const, subtext: dashboard.kpis.bestTimeWindow?.supportingValue || 'Need more publishing data' },
    ];
  }, [dashboard, performanceMode]);

  const handlePresetChange = (preset: AnalyticsRangePreset) => {
    setSelectedPreset(preset);
    if (preset === 'custom') {
      const today = new Date().toISOString().slice(0, 10);
      setCustomEnd((prev) => prev || today);
      setCustomStart((prev) => prev || new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      return;
    }
    setQuery({ preset });
  };

  const handleApplyCustomRange = () => {
    if (!customStart || !customEnd) { setError('Choose both a start and end date for the custom range.'); return; }
    setSelectedPreset('custom');
    setQuery({ preset: 'custom', start: customStart, end: customEnd });
  };

  const handleRefresh = () => { setRefreshing(true); setQuery((c) => ({ ...c })); };

  const handleSyncAnalytics = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const result = await blogAnalyticsService.syncAnalytics();
      setSyncResult(result);
      setRefreshing(true);
      setQuery((c) => ({ ...c }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await blogAnalyticsService.exportDashboard(query);
      const descriptor = query.preset === 'custom' ? `${customStart}-to-${customEnd}` : query.preset || 'analytics';
      downloadBlob(blob, `analytics-${descriptor}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export analytics');
    } finally {
      setExporting(false);
    }
  };

  const hasData =
    !!dashboard &&
    (dashboard.kpis.publishedPosts > 0 ||
      dashboard.kpis.futureScheduledCount > 0 ||
      dashboard.platformBreakdown.some((e) => e.published > 0 || e.failed > 0 || e.scheduled > 0 || e.accounts > 0) ||
      dashboard.topPosts.length > 0);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
  };

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Analytics</div>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] text-slate-950">Content Intelligence</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Publishing history, platform reliability, per-account engagement metrics, and cross-account comparison — all from your connected accounts.
          </p>
        </div>

        <div data-tour-id="analytics-filters" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value as AnalyticsRangePreset)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleSyncAnalytics}
            disabled={syncing || loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Pull fresh metrics from connected platforms"
          >
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            Sync
          </button>

          {activeTab === 'overview' && (
            <>
              <button
                type="button"
                onClick={handleRefresh}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                Refresh
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Export CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* Custom date range picker (publishing tab only) */}
      {activeTab === 'overview' && (selectedPreset === 'custom' || query.preset === 'custom') && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Start Date</label>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-slate-400" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">End Date</label>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-slate-400" />
            </div>
            <button type="button" onClick={handleApplyCustomRange}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <CalendarRange size={16} /> Apply Custom Range
            </button>
          </div>
        </div>
      )}

      {dashboard?.lastSyncedAt && activeTab === 'overview' && (
        <p className="text-xs text-slate-400">Analytics last synced: {new Date(dashboard.lastSyncedAt).toLocaleString()}</p>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {syncResult && !syncing && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          syncResult.errors?.length
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}>
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues</span>
              {syncResult.synced > 0 && <span className="ml-1">({syncResult.synced} item{syncResult.synced !== 1 ? 's' : ''} saved)</span>}
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs">
                {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </>
          ) : (
            <span><span className="font-semibold">Sync complete.</span> {syncResult.synced} item{syncResult.synced !== 1 ? 's' : ''} updated.</span>
          )}
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {/* Overview tab (always active) */}
        {(['overview', 'comparison'] as const).map((id) => {
          const label = id === 'overview' ? 'Overview' : 'Comparison';
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(id)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                isActive ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          );
        })}

        {/* Platform tabs — inactive only after load confirms account not connected */}
        {PLATFORM_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          // null = accounts not yet fetched; treat as connected so no premature disabling
          const isConnected = connectedPlatforms === null || connectedPlatforms.has(tab.platform);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={!isConnected}
              title={isConnected ? undefined : `Connect ${tab.label} to unlock`}
              onClick={() => { if (isConnected) handleTabChange(tab.id); }}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : isConnected
                    ? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    : 'border border-slate-200 bg-white text-slate-300 cursor-not-allowed'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Overview tab ─────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        loading ? (
          <div className="grid gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : !hasData ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
              <BarChart3 size={24} />
            </div>
            <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950">No analytics yet</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-slate-500">
              Publish a few posts and connect at least one platform to unlock trend lines, top posts, and recommendations here.
            </p>
            <a href="/posts" className="mt-6 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              Create your next post
            </a>
          </div>
        ) : (
          <>
            {dashboard?.summaryNote && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {dashboard.summaryNote}
              </div>
            )}
            <div data-tour-id="analytics-stats" className="grid gap-4 lg:grid-cols-4">
              {cards.map((card) => (
                <KpiCard key={card.label} label={card.label} value={card.value} trend={card.trend}
                  icon={card.icon} valueType={card.valueType} subtext={card.subtext} />
              ))}
            </div>
            <div className="grid gap-6">
              <TrendChart data={dashboard?.trend || []} performanceMode={performanceMode} />
              <PlatformBreakdown data={dashboard?.platformBreakdown || []} performanceMode={performanceMode} />
              <TopPostsTable posts={dashboard?.topPosts || []} performanceMode={performanceMode} />
              <InsightsPanel insights={dashboard?.insights || []} />
            </div>
          </>
        )
      )}

      {/* ── TikTok tab ────────────────────────────────────────────── */}
      {activeTab === 'tiktok' && (
        <TikTokAnalytics days={socialDays} />
      )}

      {/* ── Facebook tab ────────────────────────────────────────────── */}
      {activeTab === 'facebook' && (
        <FacebookAnalytics days={socialDays} />
      )}

      {/* ── LinkedIn tab ────────────────────────────────────────────── */}
      {activeTab === 'instagram' && (
        <InstagramAnalytics days={socialDays} />
      )}

      {activeTab === 'threads' && (
        <ThreadsAnalytics days={socialDays} />
      )}

      {activeTab === 'pinterest' && (
        <PinterestAnalytics days={socialDays} />
      )}

      {activeTab === 'linkedin' && (
        <LinkedInAnalytics />
      )}

      {/* ── Comparison tab ─────────────────────────────────────────── */}
      {activeTab === 'comparison' && (
        <ComparisonView days={socialDays} />
      )}

    </div>
  );
}
