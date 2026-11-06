import { useEffect, useState } from 'react';
import { Loader2, Users, TrendingUp, Eye, MessageSquare, Heart, MessageCircle } from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { PlatformLogo } from '../PlatformLogo';
import { socialAnalyticsService, type SocialAccount, type AccountDashboard } from '../../services/socialAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  days: number;
};

function MetricPill({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function AccountSnapshot({ account, days }: { account: SocialAccount; days: number }) {
  const [data, setData] = useState<AccountDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    socialAnalyticsService
      .getAccountDashboard(account.id, days)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Failed to load account data'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [account.id, days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading {account.platform} data…
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  }

  if (!data) return null;

  const s = data.summary;
  const trendData = data.trend.map((t) => ({
    ...t,
    dateLabel: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));
  const hasEngagementData = data.trend.some((t) => Number(t.engagement) > 0 || Number(t.impressions) > 0);
  const hasTopPosts = data.top_posts.length > 0;

  return (
    <div className="space-y-5">
      {/* Account identity */}
      <div className="flex items-start gap-4">
        <PlatformLogo platform={account.platform} size={38} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black tracking-tight text-slate-950 capitalize">{account.platform}</div>
          <div className="text-sm text-slate-500">
            {account.account_name || account.handle || '—'}
          </div>
          {account.bio && (
            <div className="mt-1 text-xs text-slate-400 leading-relaxed max-w-lg line-clamp-2">{account.bio}</div>
          )}
          {/* Profile-level stats row — sourced from data.account (live dashboard values) */}
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            {Number(data.account.followers) > 0 && (
              <span><span className="font-bold text-slate-800">{formatCompactNumber(data.account.followers)}</span> followers</span>
            )}
            {Number(data.account.following_count) > 0 && (
              <span><span className="font-bold text-slate-800">{formatCompactNumber(data.account.following_count)}</span> following</span>
            )}
            {Number(data.account.video_count) > 0 && (
              <span><span className="font-bold text-slate-800">{formatCompactNumber(data.account.video_count)}</span> posts</span>
            )}
            {Number(data.account.total_likes_count) > 0 && (
              <span><span className="font-bold text-slate-800">{formatCompactNumber(data.account.total_likes_count)}</span> total likes</span>
            )}
          </div>
        </div>
      </div>

      {/* KPI pills */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <MetricPill label="Followers" value={Number(data.account.followers) > 0 ? formatCompactNumber(data.account.followers) : '—'} icon={<Users size={16} />} />
        <MetricPill label="Engagement Rate" value={formatPercent(s.engagement_rate)} icon={<TrendingUp size={16} />} />
        <MetricPill label="Likes" value={formatCompactNumber(s.total_likes)} icon={<Heart size={16} />} />
        <MetricPill label="Comments" value={formatCompactNumber(s.total_comments)} icon={<MessageCircle size={16} />} />
      </div>

      {/* Trend chart */}
      {trendData.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-base font-bold text-slate-950">Engagement Trend</div>
          <div className="text-xs text-slate-500 mt-1">Daily engagement and impressions · last {days} days</div>
          <div className="mt-5 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="vol" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis yAxisId="rate" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip />
                <Bar yAxisId="vol" dataKey="engagement" fill="#0f172a" radius={[4, 4, 0, 0]} name="Engagement" />
                <Bar yAxisId="vol" dataKey="impressions" fill="#e2e8f0" radius={[4, 4, 0, 0]} name="Impressions" />
                <Line yAxisId="rate" type="monotone" dataKey="engagement_rate" stroke="#2563eb" strokeWidth={2} dot={false} name="Eng. Rate (%)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
          No daily trend data yet — use Sync to pull metrics from {account.platform}.
        </div>
      )}

      {/* Top posts */}
      {hasTopPosts ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-base font-bold text-slate-950">Top Posts</div>
          <div className="text-xs text-slate-500 mt-1">Ranked by engagement from synced posts</div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="pb-3 text-left font-semibold">Post</th>
                  <th className="pb-3 text-right font-semibold">Likes</th>
                  <th className="pb-3 text-right font-semibold">Comments</th>
                  <th className="pb-3 text-right font-semibold">Reach</th>
                  <th className="pb-3 text-right font-semibold">Rate</th>
                  <th className="pb-3 text-right font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.top_posts.map((post) => (
                  <tr key={post.platform_post_id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-4 max-w-[220px]">
                      <span className="block truncate font-medium text-slate-900">{post.title}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(post.likes)}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(post.comments)}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{formatCompactNumber(post.reach)}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold text-slate-900">{formatPercent(post.engagement_rate)}</td>
                    <td className="py-2.5 text-right text-slate-400">{formatShortDate(post.posted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
          No posts synced for this account yet.
        </div>
      )}

      {!hasEngagementData && !hasTopPosts && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">No engagement data yet.</span> Use the Sync button to pull real metrics from {account.platform}.
        </div>
      )}
    </div>
  );
}

export default function SocialAccountsOverview({ days }: Props) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    socialAnalyticsService
      .getAccounts(days)
      .then((data) => {
        if (!alive) return;
        setAccounts(data.accounts);
        if (data.accounts.length > 0) setActiveAccountId((prev) => prev ?? data.accounts[0].id);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load accounts');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading accounts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
          <Users size={24} />
        </div>
        <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950">No connected accounts</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
          Connect a social account from the Integrations page, then use Sync to pull metrics.
        </p>
        <a href="/integrations" className="mt-6 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          Go to Integrations
        </a>
      </div>
    );
  }

  const totalFollowers  = accounts.reduce((s, a) => s + Number(a.followers), 0);
  const totalReach      = accounts.reduce((s, a) => s + Number(a.total_reach), 0);
  const totalEngagement = accounts.reduce((s, a) => s + Number(a.total_engagement), 0);
  // video_count = total posts across all platforms (from social_profile_stats)
  const totalPosts = accounts.reduce((s, a) => {
    const fromProfile = Number(a.video_count);
    const fromMetrics = Number(a.posts_synced);
    return s + (fromProfile > 0 ? fromProfile : fromMetrics);
  }, 0);
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? accounts[0];

  return (
    <div className="space-y-6">
      {/* Aggregate KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Followers', value: formatCompactNumber(totalFollowers), icon: <Users size={18} /> },
          { label: 'Total Reach', value: formatCompactNumber(totalReach), icon: <Eye size={18} /> },
          { label: 'Total Engagement', value: formatCompactNumber(totalEngagement), icon: <TrendingUp size={18} /> },
          { label: 'Posts Synced', value: formatCompactNumber(totalPosts), icon: <MessageSquare size={18} /> },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{kpi.label}</div>
                <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">{kpi.value}</div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                {kpi.icon}
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-400">
              Across {accounts.length} account{accounts.length !== 1 ? 's' : ''} · last {days}d
            </div>
          </div>
        ))}
      </div>

      {/* Per-account tab strip */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
        <div className="flex flex-wrap gap-1">
          {accounts.map((account) => {
            const isActive = account.id === activeAccount.id;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => setActiveAccountId(account.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <PlatformLogo platform={account.platform} size={16} />
                <span className="capitalize">{account.platform}</span>
                {account.account_name && (
                  <span className={`text-xs font-normal truncate max-w-[100px] ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                    {account.account_name}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active account title */}
      <div className="flex items-center gap-3 pt-2">
        <PlatformLogo platform={activeAccount.platform} size={32} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Connected Account</div>
          <h2 className="text-2xl font-black tracking-tight text-slate-950">{activeAccount.account_name || activeAccount.handle || 'Unnamed Account'}</h2>
        </div>
      </div>

      {/* Active account snapshot */}
      <AccountSnapshot key={activeAccount.id} account={activeAccount} days={days} />
    </div>
  );
}
