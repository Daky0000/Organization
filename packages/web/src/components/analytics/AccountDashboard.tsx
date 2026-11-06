import { useEffect, useState } from 'react';
import { Loader2, ArrowLeft, Eye, TrendingUp, Heart, MessageCircle, Share2, Check, Users, Zap } from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PlatformLogo } from '../PlatformLogo';
import { socialAnalyticsService, type AccountDashboard as AccountDashboardData, type SocialAccount } from '../../services/socialAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  account: SocialAccount;
  days: number;
  onBack: () => void;
};

function MetricPill({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

export default function AccountDashboard({ account, days, onBack }: Props) {
  const [data, setData] = useState<AccountDashboardData | null>(null);
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
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading account data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} /> Back to accounts
        </button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const s = data.summary;
  const trendData = data.trend.map((t) => ({
    ...t,
    dateLabel: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  const hasEngagementData = data.trend.some((t) => t.engagement > 0 || t.impressions > 0);
  const hasTopPosts = data.top_posts.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} /> Back to accounts
        </button>
      </div>

      <div className="flex items-center gap-4">
        <PlatformLogo platform={account.platform} size={44} />
        <div>
          <div className="text-2xl font-black tracking-tight text-slate-950 capitalize">{account.platform}</div>
          <div className="text-sm text-slate-500">
            {account.account_name || account.handle}
            {data.account.followers > 0 && (
              <span className="ml-2 text-slate-400">· {formatCompactNumber(data.account.followers)} followers</span>
            )}
          </div>
        </div>
      </div>

      {/* Profile Snapshot - Basic Insights */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <div className="text-base font-bold text-slate-950 mb-4">Profile Insights</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Followers */}
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1">
              <Users size={14} /> Followers
            </div>
            <div className="text-2xl font-black text-slate-950">{formatCompactNumber(data.account.followers)}</div>
          </div>

          {/* Following */}
          {Number(account.following_count) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1">
                <Zap size={14} /> Following
              </div>
              <div className="text-2xl font-black text-slate-950">{formatCompactNumber(account.following_count)}</div>
            </div>
          )}

          {/* Video Count */}
          {Number(account.video_count) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1">
                <Share2 size={14} /> Videos
              </div>
              <div className="text-2xl font-black text-slate-950">{formatCompactNumber(account.video_count)}</div>
            </div>
          )}

          {/* Total Likes */}
          {Number(account.total_likes_count) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1">
                <Heart size={14} /> Total Likes
              </div>
              <div className="text-2xl font-black text-slate-950">{formatCompactNumber(account.total_likes_count)}</div>
            </div>
          )}
        </div>

        {/* Bio & Verification */}
        {(account.bio || account.is_verified) && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
            {account.is_verified && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Check size={16} className="text-blue-500 flex-shrink-0" />
                <span className="font-semibold">Verified Account</span>
              </div>
            )}
            {account.bio && (
              <div className="text-sm text-slate-600 leading-relaxed">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 mb-1">Bio</div>
                <p className="line-clamp-3">{account.bio}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricPill label="Reach" value={formatCompactNumber(s.total_reach)} icon={<Eye size={18} />} />
        <MetricPill label="Impressions" value={formatCompactNumber(s.total_impressions)} icon={<TrendingUp size={18} />} />
        <MetricPill label="Engagement" value={formatPercent(s.engagement_rate)} icon={<TrendingUp size={18} />} />
        <MetricPill label="Likes" value={formatCompactNumber(s.total_likes)} icon={<Heart size={18} />} />
        <MetricPill label="Comments" value={formatCompactNumber(s.total_comments)} icon={<MessageCircle size={18} />} />
        <MetricPill label="Posts Synced" value={formatCompactNumber(s.posts_count)} icon={<Share2 size={18} />} />
      </div>

      {/* Trend chart */}
      {trendData.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-bold text-slate-950">Engagement Trend</h3>
          <p className="text-sm text-slate-500">Daily engagement and impressions over the last {days} days.</p>
          <div className="mt-6 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dateLabel" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="vol" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="rate" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip />
                <Bar yAxisId="vol" dataKey="engagement" fill="#0f172a" radius={[6, 6, 0, 0]} name="Engagement" />
                <Bar yAxisId="vol" dataKey="impressions" fill="#e2e8f0" radius={[6, 6, 0, 0]} name="Impressions" />
                <Line yAxisId="rate" type="monotone" dataKey="engagement_rate" stroke="#2563eb" strokeWidth={2} dot={false} name="Engagement rate (%)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
          No daily trend data yet — sync to pull dated metrics from {account.platform}.
        </div>
      )}

      {/* Top posts */}
      {hasTopPosts ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-bold text-slate-950">Top Posts</h3>
          <p className="text-sm text-slate-500">Ranked by engagement from synced posts.</p>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="pb-3 text-left font-semibold">Post</th>
                  <th className="pb-3 text-right font-semibold">Likes</th>
                  <th className="pb-3 text-right font-semibold">Comments</th>
                  <th className="pb-3 text-right font-semibold">Reach</th>
                  <th className="pb-3 text-right font-semibold">Engagement</th>
                  <th className="pb-3 text-right font-semibold">Rate</th>
                  <th className="pb-3 text-right font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.top_posts.map((post) => (
                  <tr key={post.platform_post_id} className="border-b border-slate-100">
                    <td className="py-3 pr-4 max-w-[220px]">
                      <span className="block truncate font-medium text-slate-900">{post.title}</span>
                    </td>
                    <td className="py-3 pr-4 text-right text-slate-600">{formatCompactNumber(post.likes)}</td>
                    <td className="py-3 pr-4 text-right text-slate-600">{formatCompactNumber(post.comments)}</td>
                    <td className="py-3 pr-4 text-right text-slate-600">{formatCompactNumber(post.reach)}</td>
                    <td className="py-3 pr-4 text-right text-slate-600">{formatCompactNumber(post.engagement)}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-slate-900">{formatPercent(post.engagement_rate)}</td>
                    <td className="py-3 text-right text-slate-400">{formatShortDate(post.posted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
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
