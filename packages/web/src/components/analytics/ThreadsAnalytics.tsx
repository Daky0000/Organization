import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Quote,
  RefreshCcw,
  Repeat2,
  Share2,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  threadsAnalyticsService,
  type ThreadsPost,
  type ThreadsPostsSummary,
  type ThreadsProfileResponse,
} from '../../services/threadsAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  days: number;
};

type SortKey = 'views' | 'engagement' | 'likes' | 'replies' | 'reposts' | 'quotes' | 'shares';

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
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

const fmt = (value: number | string | null | undefined) =>
  value !== null && value !== undefined && value !== '' ? formatCompactNumber(value) : 'N/A';

function guessThreadsUrl(permalink: string | null, threadId: string) {
  if (permalink && permalink.startsWith('http')) return permalink;
  // Permalinks are usually present in the API response; this fallback keeps the UI resilient.
  return `https://www.threads.net/t/${encodeURIComponent(threadId)}`;
}

function metricLabel(key: SortKey) {
  switch (key) {
    case 'views': return 'Views';
    case 'engagement': return 'Engagement';
    case 'likes': return 'Likes';
    case 'replies': return 'Replies';
    case 'reposts': return 'Reposts';
    case 'quotes': return 'Quotes';
    case 'shares': return 'Shares';
    default: return 'Views';
  }
}

function metricValue(post: ThreadsPost, key: SortKey) {
  switch (key) {
    case 'views': return Number(post.views || 0);
    case 'engagement': return Number(post.engagement || 0);
    case 'likes': return Number(post.likes || 0);
    case 'replies': return Number(post.replies || post.comments || 0);
    case 'reposts': return Number(post.reposts || 0);
    case 'quotes': return Number(post.quotes || 0);
    case 'shares': return Number(post.shares || 0);
    default: return Number(post.views || 0);
  }
}

function extractInsightValueMap(payload: unknown): Record<string, number> | null {
  const obj: any = payload;
  const data = Array.isArray(obj?.data) ? obj.data : [];
  const first = data[0];
  const values = Array.isArray(first?.values) ? first.values : [];
  const lastValue = values.length ? values[values.length - 1]?.value : null;
  if (!lastValue || typeof lastValue !== 'object' || Array.isArray(lastValue)) return null;

  const entries = Object.entries(lastValue as Record<string, unknown>)
    .map(([key, value]) => {
      const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
      return Number.isFinite(n) ? [key, n] : null;
    })
    .filter(Boolean) as Array<[string, number]>;

  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

export default function ThreadsAnalytics({ days }: Props) {
  const [posts, setPosts] = useState<ThreadsPost[]>([]);
  const [summary, setSummary] = useState<ThreadsPostsSummary | null>(null);
  const [profile, setProfile] = useState<ThreadsProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('views');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postsResult, profileResult] = await Promise.all([
        threadsAnalyticsService.getPosts({ days, limit: 80 }),
        threadsAnalyticsService.getProfile(),
      ]);
      setPosts(postsResult.posts);
      setSummary(postsResult.summary);
      setProfile(profileResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Threads analytics');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await threadsAnalyticsService.sync();
      setSyncResult(result);
      await fetchData();
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  const topPosts = useMemo(() => {
    const sorted = [...posts].sort((a, b) => metricValue(b, sortBy) - metricValue(a, sortBy));
    return sorted.slice(0, 12);
  }, [posts, sortBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading Threads analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  const displayName =
    profile?.account_name ||
    (profile?.handle ? (profile.handle.startsWith('@') ? profile.handle : `@${profile.handle}`) : null) ||
    'Threads';

  const handleText =
    profile?.handle
      ? (profile.handle.startsWith('@') ? profile.handle : `@${profile.handle}`)
      : null;

  const hasPosts = (summary?.total_posts ?? posts.length) > 0;
  const clicks = profile?.total_clicks ?? null;
  const hasClicks = clicks !== null && clicks !== undefined;
  const countryCounts = extractInsightValueMap(profile?.follower_demographics?.country);
  const topCountries = countryCounts
    ? Object.entries(countryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">Threads Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {summary ? `${formatCompactNumber(summary.total_posts)} posts synced` : `${posts.length} posts loaded`}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Threads'}
        </button>
      </div>

      {syncResult && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          syncResult.errors?.length
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}>
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues.</span> {syncResult.synced} items synced.
              {syncResult.errors.map((message, index) => (
                <span key={index} className="block mt-1 text-xs">{message}</span>
              ))}
            </>
          ) : (
            <><span className="font-semibold">Sync successful!</span> {syncResult.synced} items updated.</>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Profile Snapshot</div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {profile?.picture_url ? (
                <img src={profile.picture_url} alt="" className="h-14 w-14 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-600">
                  {(displayName || 'T').slice(0, 1).toUpperCase()}
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <span>{displayName}</span>
                  {profile?.is_verified ? <BadgeCheck size={16} className="text-sky-600" /> : null}
                </div>
                <div className="text-sm text-slate-500">
                  {handleText || 'Threads profile'}
                </div>
                {profile?.bio ? (
                  <div className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">{profile.bio}</div>
                ) : null}
                {profile?.synced_at ? (
                  <div className="mt-2 text-xs text-slate-400">
                    Last synced {new Date(profile.synced_at).toLocaleString()}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${hasClicks ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
            <StatCard label="Followers" value={fmt(profile?.followers)} icon={<Users size={16} />} />
            <StatCard label="Views" value={fmt(summary?.total_views)} icon={<Eye size={16} />} />
            <StatCard label="Likes" value={fmt(summary?.total_likes)} icon={<Heart size={16} />} />
            <StatCard label="Avg Eng. Rate" value={formatPercent(summary?.avg_engagement_rate)} icon={<TrendingUp size={16} />} />
            {hasClicks ? (
              <StatCard label="Clicks" value={fmt(clicks)} icon={<MousePointerClick size={16} />} />
            ) : null}
          </div>

          {summary ? (
            <div className="mt-3 text-xs text-slate-500">
              Last {days} days: {formatCompactNumber(summary.total_replies)} replies, {formatCompactNumber(summary.total_reposts)} reposts, {formatCompactNumber(summary.total_quotes)} quotes, {formatCompactNumber(summary.total_shares)} shares.
            </div>
          ) : null}

          {topCountries.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Top Countries</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {topCountries.map(([country, count]) => (
                  <span
                    key={country}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                  >
                    <span className="truncate max-w-[140px]" title={country}>{country}</span> · {formatCompactNumber(count)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {!profile?.hasData && !summary?.total_posts ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
              No Threads data yet. Connect Threads in <a href="/integrations" className="font-semibold underline">Integrations</a>, then click <span className="font-semibold">Sync Threads</span>.
            </div>
          ) : null}
        </div>
      </div>

      {!hasPosts ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No Threads posts synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync Threads</span> to pull post insights.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Top Posts · Sorted by {metricLabel(sortBy)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Showing {topPosts.length} of {formatCompactNumber(summary?.total_posts ?? posts.length)} posts</div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sort</div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-slate-400"
              >
                <option value="views">Views</option>
                <option value="engagement">Engagement</option>
                <option value="likes">Likes</option>
                <option value="replies">Replies</option>
                <option value="reposts">Reposts</option>
                <option value="quotes">Quotes</option>
                <option value="shares">Shares</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topPosts.map((post) => {
              const url = guessThreadsUrl(post.permalink || null, post.thread_id || post.platform_post_id);
              const excerpt = post.text ? post.text.trim() : '';
              const showMedia = Boolean(post.media_url || post.thumbnail_url);
              const preview = post.media_url || post.thumbnail_url || null;

              return (
                <div key={post.thread_id || post.platform_post_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                  {showMedia ? (
                    <div className="relative bg-slate-100 aspect-[9/5] overflow-hidden">
                      {preview ? (
                        <img src={preview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <MessageCircle size={28} />
                        </div>
                      )}
                      {post.media_type ? (
                        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          {post.media_type}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="p-4 space-y-3">
                    <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-4">
                      {excerpt || `Thread · ${String(post.thread_id || post.platform_post_id).slice(0, 8)}`}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Eye size={12} /> {formatCompactNumber(post.views)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Heart size={12} /> {formatCompactNumber(post.likes)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <MessageCircle size={12} /> {formatCompactNumber(post.replies)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Repeat2 size={12} /> {formatCompactNumber(post.reposts)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Quote size={12} /> {formatCompactNumber(post.quotes)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                        <Share2 size={12} /> {formatCompactNumber(post.shares)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {formatShortDate(post.posted_at)}
                      </div>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                        title="View on Threads"
                      >
                        <ExternalLink size={11} /> View
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

