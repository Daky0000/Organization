import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Bookmark, ExternalLink, Heart, Image as ImageIcon, Loader2, MessageCircle, RefreshCcw, TrendingUp, Users } from 'lucide-react';
import { instagramAnalyticsService, type InstagramMedia, type InstagramPostsSummary, type InstagramProfileResponse } from '../../services/instagramAnalyticsService';
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

const fmt = (value: number | null | undefined) => value !== null && value !== undefined ? formatCompactNumber(value) : 'N/A';

export default function InstagramAnalytics({ days }: Props) {
  const [posts, setPosts] = useState<InstagramMedia[]>([]);
  const [summary, setSummary] = useState<InstagramPostsSummary | null>(null);
  const [profile, setProfile] = useState<InstagramProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postsResult, profileResult] = await Promise.all([
        instagramAnalyticsService.getPosts({ days, limit: 50 }),
        instagramAnalyticsService.getProfile(),
      ]);
      setPosts(postsResult.posts);
      setSummary(postsResult.summary);
      setProfile(profileResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Instagram analytics');
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
      const result = await instagramAnalyticsService.sync();
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
        <Loader2 size={20} className="animate-spin mr-2" /> Loading Instagram analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  const hasPosts = posts.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">Instagram Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">{posts.length} posts synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Instagram'}
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
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Profile</div>
        {profile?.account_name && (
          <div className="mb-3 flex items-center gap-3">
            {profile.picture_url ? (
              <img src={profile.picture_url} alt="" className="h-12 w-12 rounded-2xl object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-600">
                {(profile.handle || profile.account_name || 'I').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                <span>{profile.account_name}</span>
                {profile.is_verified ? <BadgeCheck size={16} className="text-sky-600" /> : null}
              </div>
              <div className="text-sm text-slate-500">
                {profile.handle ? `@${profile.handle}` : 'Instagram professional account'}
                {profile.account_type ? ` • ${profile.account_type.replace(/_/g, ' ')}` : ''}
              </div>
              {profile.page_name ? (
                <div className="text-xs text-slate-400">Linked Facebook Page: {profile.page_name}</div>
              ) : null}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Followers" value={fmt(profile?.followers)} icon={<Users size={16} />} />
          <StatCard label="Following" value={fmt(profile?.following)} icon={<Heart size={16} />} />
          <StatCard label="Posts" value={fmt(profile?.posts_count)} icon={<ImageIcon size={16} />} />
          <StatCard label="Website" value={profile?.website ? 'Linked' : 'None'} icon={<ExternalLink size={16} />} />
        </div>

        {profile?.bio ? (
          <div className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-600">{profile.bio}</div>
        ) : null}
        {profile?.synced_at ? (
          <div className="mt-1.5 text-xs text-slate-400">
            Last synced {new Date(profile.synced_at).toLocaleString()}
          </div>
        ) : null}
        {!profile?.hasData ? (
          <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            No Instagram profile data yet. Click <span className="font-semibold">Sync Instagram</span> to pull your account stats.
          </div>
        ) : null}
      </div>

      {summary ? (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Post Performance</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Posts" value={formatCompactNumber(summary.total_posts)} icon={<ImageIcon size={16} />} />
            <StatCard label="Impressions" value={formatCompactNumber(summary.total_impressions)} icon={<TrendingUp size={16} />} />
            <StatCard label="Reach" value={formatCompactNumber(summary.total_reach)} icon={<Users size={16} />} />
            <StatCard label="Likes" value={formatCompactNumber(summary.total_likes)} icon={<Heart size={16} />} />
            <StatCard label="Comments" value={formatCompactNumber(summary.total_comments)} icon={<MessageCircle size={16} />} />
            <StatCard label="Avg Eng. Rate" value={formatPercent(summary.avg_engagement_rate)} icon={<Bookmark size={16} />} />
          </div>
        </div>
      ) : null}

      {!hasPosts ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <ImageIcon size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No Instagram posts synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync Instagram</span> to pull your media insights.</div>
        </div>
      ) : (
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Posts • {posts.length} synced
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => {
              const mediaPreview = post.media_type === 'VIDEO' ? (post.thumbnail_url || post.media_url) : (post.media_url || post.thumbnail_url);
              const engagementRate = post.impressions > 0 ? (post.engagement / post.impressions) * 100 : 0;
              return (
                <div key={post.media_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="aspect-square bg-slate-100">
                    {mediaPreview ? (
                      <img src={mediaPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageIcon size={28} className="text-slate-300" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <div className="line-clamp-3 text-sm font-semibold leading-snug text-slate-900">
                        {post.caption || `Instagram post ${post.media_id.slice(0, 8)}`}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {post.media_type || 'MEDIA'} • {formatShortDate(post.posted_at)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">Likes: <span className="font-semibold text-slate-700">{formatCompactNumber(post.likes)}</span></div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">Comments: <span className="font-semibold text-slate-700">{formatCompactNumber(post.comments)}</span></div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">Reach: <span className="font-semibold text-slate-700">{formatCompactNumber(post.reach)}</span></div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">Saves: <span className="font-semibold text-slate-700">{formatCompactNumber(post.saves)}</span></div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Engagement rate {formatPercent(engagementRate)}</span>
                      {post.permalink ? (
                        <a
                          href={post.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-pink-600 hover:underline"
                        >
                          <ExternalLink size={11} /> View
                        </a>
                      ) : null}
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
