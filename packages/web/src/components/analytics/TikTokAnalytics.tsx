import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCcw, Eye, Heart, MessageCircle, Share2, TrendingUp, Play, Users, UserCheck, BadgeCheck, Clock, ExternalLink } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { tiktokAnalyticsService, type TikTokVideo, type TikTokVideoSummary, type TikTokFollowersResponse } from '../../services/tiktokAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  days: number;
};

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

const fmt = (val: number | null) => val !== null ? formatCompactNumber(val) : '–';

export default function TikTokAnalytics({ days }: Props) {
  const [videos, setVideos] = useState<TikTokVideo[]>([]);
  const [summary, setSummary] = useState<TikTokVideoSummary | null>(null);
  const [profile, setProfile] = useState<TikTokFollowersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [videosResult, profileResult] = await Promise.all([
        tiktokAnalyticsService.getVideos({ days, limit: 50 }),
        tiktokAnalyticsService.getFollowers(),
      ]);
      setVideos(videosResult.videos);
      setSummary(videosResult.summary);
      setProfile(profileResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TikTok data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await tiktokAnalyticsService.sync();
      setSyncResult(result);
      await fetchData();
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading TikTok analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  // Chart data — top 10 by views for the bar chart
  const chartData = [...videos]
    .sort((a, b) => Number(b.views) - Number(a.views))
    .slice(0, 10)
    .map((v, i) => ({
      name: v.title ? v.title.slice(0, 20) + (v.title.length > 20 ? '…' : '') : `Video ${i + 1}`,
      views: Number(v.views),
      likes: Number(v.likes),
      engagement: Number(v.engagement),
    }))
    .reverse();

  const hasData = videos.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">TikTok Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">{videos.length} videos synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync TikTok'}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          syncResult.errors?.length
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}>
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues.</span>{' '}
              {syncResult.synced} items synced.{' '}
              {syncResult.errors.map((e, i) => <span key={i} className="block mt-1 text-xs">{e}</span>)}
            </>
          ) : (
            <><span className="font-semibold">Sync successful!</span> {syncResult.synced} items updated.</>
          )}
        </div>
      )}

      {/* Profile snapshot — account-level stats from social_profile_stats */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Account</div>
        {profile?.display_name && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{profile.display_name}</span>
            {profile.handle && <span className="text-sm text-slate-400">@{profile.handle}</span>}
            {profile.is_verified && <BadgeCheck size={15} className="text-[#2563EB]" />}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Followers"   value={fmt(profile?.followers   ?? null)} icon={<Users size={16} />} />
          <StatCard label="Following"   value={fmt(profile?.following   ?? null)} icon={<UserCheck size={16} />} />
          <StatCard label="Total Likes" value={fmt(profile?.total_likes ?? null)} icon={<Heart size={16} />} />
          <StatCard label="Videos Posted" value={fmt(profile?.posts_count ?? null)} icon={<Play size={16} />} />
        </div>
        {profile?.bio && (
          <div className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-600">{profile.bio}</div>
        )}
        {profile?.synced_at && (
          <div className="mt-1.5 text-xs text-slate-400">
            Last synced {new Date(profile.synced_at).toLocaleString()}
          </div>
        )}
        {!profile?.hasData && (
          <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            No profile data yet — click <span className="font-semibold">Sync TikTok</span> to pull your account stats.
          </div>
        )}
      </div>

      {/* Video summary KPIs */}
      {summary && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Video Performance · All time</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Videos" value={formatCompactNumber(summary.total_videos)} icon={<Play size={16} />} />
            <StatCard label="Total Views" value={formatCompactNumber(summary.total_views)} icon={<Eye size={16} />} />
            <StatCard label="Total Likes" value={formatCompactNumber(summary.total_likes)} icon={<Heart size={16} />} />
            <StatCard label="Comments" value={formatCompactNumber(summary.total_comments)} icon={<MessageCircle size={16} />} />
            <StatCard label="Shares" value={formatCompactNumber(summary.total_shares)} icon={<Share2 size={16} />} />
            <StatCard label="Avg Eng. Rate" value={formatPercent(summary.avg_engagement_rate)} icon={<TrendingUp size={16} />} />
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <Play size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No TikTok videos synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync TikTok</span> to pull your video insights.</div>
        </div>
      ) : (
        <>
          {/* Top videos chart */}
          {chartData.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-bold text-slate-950">Top Videos by Views</div>
              <div className="text-xs text-slate-500 mt-1">Top 10 videos ranked by views</div>
              <div className="mt-5 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} width={100} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCompactNumber(value), name === 'views' ? 'Views' : name === 'likes' ? 'Likes' : 'Engagement']}
                    />
                    <Bar dataKey="views" fill="#e2e8f0" radius={[0, 4, 4, 0]} name="Views" />
                    <Bar dataKey="likes" fill="#0f172a" radius={[0, 4, 4, 0]} name="Likes" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-video analytics cards */}
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Videos · {videos.length} synced
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...videos]
                .sort((a, b) => Number(b.views) - Number(a.views))
                .map((video) => {
                  const engRate = Number(video.views) > 0
                    ? (Number(video.engagement) / Number(video.views)) * 100
                    : 0;
                  const durationMin = video.duration_seconds
                    ? `${Math.floor(video.duration_seconds / 60)}:${String(video.duration_seconds % 60).padStart(2, '0')}`
                    : null;
                  return (
                    <div key={video.video_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                      {/* Thumbnail */}
                      <div className="relative bg-slate-100 aspect-[9/5] overflow-hidden">
                        {video.cover_url ? (
                          <img src={video.cover_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Play size={28} className="text-slate-300" />
                          </div>
                        )}
                        {durationMin && (
                          <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white flex items-center gap-1">
                            <Clock size={10} /> {durationMin}
                          </span>
                        )}
                        {video.width && video.height ? (
                          <span className="absolute top-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">
                            {video.width}×{video.height}
                          </span>
                        ) : null}
                      </div>

                      {/* Content */}
                      <div className="p-4 space-y-3">
                        {/* Title + description */}
                        <div>
                          <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-2">
                            {video.title || `Video ${video.video_id.slice(0, 8)}`}
                          </div>
                          {video.video_description && (
                            <div className="mt-1 text-xs text-slate-400 line-clamp-2">{video.video_description}</div>
                          )}
                        </div>

                        {/* Metrics grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Eye size={10} /> Views
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(video.views)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <TrendingUp size={10} /> Eng. Rate
                            </div>
                            <div className="text-base font-black text-slate-900">{formatPercent(engRate)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Heart size={10} /> Likes
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(video.likes)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <MessageCircle size={10} /> Comments
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(video.comments)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Share2 size={10} /> Shares
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(video.shares)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Posted</div>
                            <div className="text-sm font-semibold text-slate-700">{formatShortDate(video.posted_at)}</div>
                          </div>
                        </div>

                        {/* Links */}
                        {(video.share_url || video.embed_link) && (
                          <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
                            {video.share_url && (
                              <a href={video.share_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline">
                                <ExternalLink size={11} /> View on TikTok
                              </a>
                            )}
                            {video.embed_link && (
                              <a href={video.embed_link} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:underline">
                                Embed
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
