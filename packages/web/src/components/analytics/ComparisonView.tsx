import { useEffect, useState } from 'react';
import { Loader2, Users, TrendingUp, Eye, Trophy } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { PlatformLogo } from '../PlatformLogo';
import { socialAnalyticsService, type ComparisonData, type SocialAccount } from '../../services/socialAnalyticsService';
import { formatCompactNumber, formatPercent } from './analyticsUtils';

type Props = { days: number };

const RANK_COLORS = ['#fbbf24', '#94a3b8', '#d97706'];
const RANK_LABELS = ['1st', '2nd', '3rd'];

function RankingCard({
  title,
  subtitle,
  entries,
  formatValue,
  icon,
}: {
  title: string;
  subtitle: string;
  entries: Array<{ platform: string; account_name: string; value: number; rank: number }>;
  formatValue: (v: number) => string;
  icon: React.ReactNode;
}) {
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map((e) => e.value), 1);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">{icon}</div>
        <div>
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
      </div>
      <div className="space-y-3">
        {entries.slice(0, 5).map((entry, idx) => (
          <div key={entry.platform} className="flex items-center gap-3">
            <span
              className="w-8 shrink-0 rounded-full py-0.5 text-center text-[10px] font-black"
              style={{ background: RANK_COLORS[idx] || '#e2e8f0', color: idx < 3 ? '#1e293b' : '#64748b' }}
            >
              {RANK_LABELS[idx] || `${idx + 1}`}
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <PlatformLogo platform={entry.platform} size={16} />
                  <span className="text-xs font-semibold capitalize text-slate-800 truncate">{entry.platform}</span>
                </div>
                <span className="text-xs font-bold text-slate-900 shrink-0">{formatValue(entry.value)}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-100">
                <div
                  className="h-1.5 rounded-full bg-slate-900 transition-all"
                  style={{ width: `${(entry.value / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountSummaryCard({ account }: { account: SocialAccount }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3 mb-4">
        <PlatformLogo platform={account.platform} size={36} />
        <div>
          <div className="text-sm font-bold capitalize text-slate-900">{account.platform}</div>
          <div className="text-xs text-slate-500 truncate max-w-[160px]">{account.account_name || account.handle}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-slate-50 p-2">
          <div className="text-base font-black text-slate-950">{formatCompactNumber(account.followers)}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Followers</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <div className="text-base font-black text-slate-950">{formatPercent(account.engagement_rate)}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Eng. Rate</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <div className="text-base font-black text-slate-950">{formatCompactNumber(account.total_reach)}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Reach</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <div className="text-base font-black text-slate-950">{formatCompactNumber(account.posts_synced)}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Posts</div>
        </div>
      </div>
    </div>
  );
}

function EngagementBarChart({ accounts }: { accounts: SocialAccount[] }) {
  const data = accounts
    .filter((a) => a.total_engagement > 0 || a.total_reach > 0)
    .map((a) => ({
      platform: a.platform.charAt(0).toUpperCase() + a.platform.slice(1),
      Engagement: a.total_engagement,
      Reach: a.total_reach,
      Impressions: a.total_impressions,
    }));

  if (data.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-bold text-slate-950">Engagement vs Reach by Platform</h3>
      <p className="text-sm text-slate-500">Aggregated from synced posts in the selected period.</p>
      <div className="mt-6 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="platform" tick={{ fill: '#64748b', fontSize: 12 }} />
            <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="Engagement" fill="#0f172a" radius={[6, 6, 0, 0]} />
            <Bar dataKey="Reach" fill="#2563eb" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ComparisonView({ days }: Props) {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    socialAnalyticsService
      .getComparison(days)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Failed to load comparison'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading comparison…
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  }

  if (!data || data.accounts.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
          <Trophy size={24} />
        </div>
        <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950">No accounts to compare</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
          Connect at least two social accounts and sync metrics to unlock comparison analytics.
        </p>
      </div>
    );
  }

  if (data.accounts.length < 2) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800">
        <span className="font-semibold">Only one account connected.</span> Connect a second account to unlock cross-account comparison.
      </div>
    );
  }

  const insightStyles: Record<string, string> = {
    followers_leader: 'border-purple-200 bg-purple-50',
    engagement_leader: 'border-blue-200 bg-blue-50',
    reach_leader: 'border-emerald-200 bg-emerald-50',
  };

  return (
    <div className="space-y-8">
      {/* Account summary cards */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
          Account Snapshots — last {days} days
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.accounts.map((account) => (
            <AccountSummaryCard key={account.id} account={account} />
          ))}
        </div>
      </div>

      {/* Rankings */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Rankings</h3>
        <div className="grid gap-6 lg:grid-cols-3">
          <RankingCard
            title="By Followers"
            subtitle="Current follower count"
            entries={data.rankings.by_followers}
            formatValue={formatCompactNumber}
            icon={<Users size={18} />}
          />
          <RankingCard
            title="By Engagement Rate"
            subtitle="Engagement ÷ impressions"
            entries={data.rankings.by_engagement}
            formatValue={(v) => formatPercent(v)}
            icon={<TrendingUp size={18} />}
          />
          <RankingCard
            title="By Reach"
            subtitle="Total reach in period"
            entries={data.rankings.by_reach}
            formatValue={formatCompactNumber}
            icon={<Eye size={18} />}
          />
        </div>
      </div>

      {/* Bar chart */}
      <EngagementBarChart accounts={data.accounts} />

      {/* Insights */}
      {data.insights.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Key Insights</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.insights.map((insight) => (
              <div
                key={insight.type}
                className={`rounded-2xl border px-5 py-4 ${insightStyles[insight.type] || 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <PlatformLogo platform={insight.winner} size={20} />
                  <span className="text-sm font-bold text-slate-900">{insight.title}</span>
                </div>
                <p className="text-sm text-slate-700">{insight.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.accounts.every((a) => a.posts_synced === 0) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">No posts synced yet.</span> Follower counts are displayed where available. Sync to pull engagement and reach data.
        </div>
      )}
    </div>
  );
}
