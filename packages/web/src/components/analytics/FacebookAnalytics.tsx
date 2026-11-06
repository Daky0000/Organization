import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCcw, Heart, MessageCircle, Share2, TrendingUp, Users, ExternalLink, ChevronDown } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { facebookAnalyticsService, type FacebookPost, type FacebookPostSummary, type FacebookStatsResponse, type FacebookAccount } from '../../services/facebookAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type Props = {
  days: number;
};

type SubTab = 'pages' | 'groups';

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

export default function FacebookAnalytics({ days }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('pages');
  const [accounts, setAccounts] = useState<{ pages: FacebookAccount[]; groups: FacebookAccount[] }>({ pages: [], groups: [] });
  const [selectedAccount, setSelectedAccount] = useState<FacebookAccount | null>(null);
  const [posts, setPosts] = useState<FacebookPost[]>([]);
  const [summary, setSummary] = useState<FacebookPostSummary | null>(null);
  const [stats, setStats] = useState<FacebookStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  // Load accounts and select first one
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const result = await facebookAnalyticsService.getAccounts();
        setAccounts(result);
        const toSelect = subTab === 'pages' ? result.pages[0] : result.groups[0];
        setSelectedAccount(toSelect || null);
        if (!toSelect) {
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load accounts:', err);
        setLoading(false);
      }
    };
    loadAccounts();
  }, [subTab]);

  // Load data for selected account
  const fetchData = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const [postsResult, statsResult] = await Promise.all([
        facebookAnalyticsService.getPosts({ days, limit: 50, accountId: selectedAccount.account_id }),
        facebookAnalyticsService.getStats(),
      ]);
      setPosts(postsResult.posts);
      setSummary(postsResult.summary);
      setStats(statsResult);
    } catch (err) {
      console.error('Failed to load Facebook data:', err);
    } finally {
      setLoading(false);
    }
  }, [days, selectedAccount]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await facebookAnalyticsService.sync();
      setSyncResult(result);
      // Reload accounts list
      const accountsResult = await facebookAnalyticsService.getAccounts();
      setAccounts(accountsResult);
      await fetchData();
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !selectedAccount) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading Facebook accounts…
      </div>
    );
  }

  if (accounts.pages.length === 0 && accounts.groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
        <div className="font-semibold text-slate-700">No Facebook pages or groups connected</div>
        <div className="mt-1 text-xs">Connect a Facebook page or group to view analytics here.</div>
      </div>
    );
  }

  const currentAccounts = subTab === 'pages' ? accounts.pages : accounts.groups;
  const chartData = [...posts]
    .sort((a, b) => Number(b.engagement) - Number(a.engagement))
    .slice(0, 10)
    .map((p, i) => ({
      name: p.message ? p.message.slice(0, 20) + (p.message.length > 20 ? '…' : '') : `Post ${i + 1}`,
      engagement: Number(p.engagement),
      likes: Number(p.likes_count),
      comments: Number(p.comments_count),
    }))
    .reverse();

  const hasData = posts.length > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">Facebook Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">{posts.length} posts synced</div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync Facebook'}
        </button>
      </div>

      {/* Sub-tabs: Pages & Groups */}
      <div className="flex flex-wrap gap-2">
        {([
          { id: 'pages' as SubTab, label: `Pages (${accounts.pages.length})` },
          { id: 'groups' as SubTab, label: `Groups (${accounts.groups.length})` },
        ] as const).map((tab) => {
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                isActive ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Account Selector */}
      <div className="relative">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 mb-2">
          {subTab === 'pages' ? 'Select Page' : 'Select Group'}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowAccountDropdown(!showAccountDropdown)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              {selectedAccount?.picture_url && (
                <img src={selectedAccount.picture_url} alt="" className="h-6 w-6 rounded-full object-cover" />
              )}
              <span>{selectedAccount?.name || 'Select an account'}</span>
            </div>
            <ChevronDown size={16} className={`transition ${showAccountDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showAccountDropdown && (
            <div className="absolute top-full left-0 right-0 mt-2 rounded-2xl border border-slate-200 bg-white shadow-lg z-10">
              {currentAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => {
                    setSelectedAccount(account);
                    setShowAccountDropdown(false);
                  }}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 border-b border-slate-100 last:border-b-0"
                >
                  {account.picture_url && (
                    <img src={account.picture_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold text-slate-900">{account.name}</div>
                    <div className="text-xs text-slate-400">
                      {subTab === 'pages' ? `${fmt(account.followers ?? null)} followers` : `${fmt(account.members ?? null)} members`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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

      {/* Page/Group info snapshot */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          {subTab === 'pages' ? 'Page' : 'Group'} Info
        </div>
        {selectedAccount && (
          <div className="mb-3 flex items-center gap-3">
            {selectedAccount.picture_url && (
              <img src={selectedAccount.picture_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            )}
            <span className="text-sm font-bold text-slate-900">{selectedAccount.name}</span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard 
            label={subTab === 'pages' ? 'Followers' : 'Members'} 
            value={fmt(subTab === 'pages' ? (selectedAccount?.followers ?? null) : (selectedAccount?.members ?? null))} 
            icon={<Users size={16} />} 
          />
          {subTab === 'pages' && (
            <StatCard label="Page Likes" value={fmt(selectedAccount?.likes ?? null)} icon={<Heart size={16} />} />
          )}
          <StatCard label="Posts" value={fmt(stats?.posts_count ?? null)} icon={<MessageCircle size={16} />} />
          <StatCard label="Engagement Rate" value={stats && stats.engagement_rate !== null ? formatPercent(stats.engagement_rate) : '–'} icon={<TrendingUp size={16} />} />
        </div>
        {stats?.synced_at && (
          <div className="mt-1.5 text-xs text-slate-400">
            Last synced {new Date(stats.synced_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* Post summary KPIs */}
      {summary && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Post Performance · All time</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Posts" value={formatCompactNumber(summary.total_posts)} icon={<MessageCircle size={16} />} />
            <StatCard label="Total Likes" value={formatCompactNumber(summary.total_likes)} icon={<Heart size={16} />} />
            <StatCard label="Comments" value={formatCompactNumber(summary.total_comments)} icon={<MessageCircle size={16} />} />
            <StatCard label="Shares" value={formatCompactNumber(summary.total_shares)} icon={<Share2 size={16} />} />
            <StatCard label="Avg Engagement" value={formatCompactNumber(summary.avg_engagement_per_post)} icon={<TrendingUp size={16} />} />
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
          <div className="font-semibold text-slate-700">No Facebook posts synced yet</div>
          <div className="mt-1 text-xs">Click <span className="font-semibold">Sync Facebook</span> to pull your post insights.</div>
        </div>
      ) : (
        <>
          {/* Top posts chart */}
          {chartData.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-base font-bold text-slate-950">Top Posts by Engagement</div>
              <div className="text-xs text-slate-500 mt-1">Top 10 posts ranked by total engagement</div>
              <div className="mt-5 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} width={100} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCompactNumber(value), name === 'engagement' ? 'Engagement' : name === 'likes' ? 'Likes' : 'Comments']}
                    />
                    <Bar dataKey="engagement" fill="#e2e8f0" radius={[0, 4, 4, 0]} name="Engagement" />
                    <Bar dataKey="likes" fill="#0f172a" radius={[0, 4, 4, 0]} name="Likes" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-post analytics cards */}
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Posts · {posts.length} synced
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...posts]
                .sort((a, b) => Number(b.engagement) - Number(a.engagement))
                .map((post) => {
                  return (
                    <div key={post.post_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                      {/* Thumbnail / Picture */}
                      <div className="relative bg-slate-100 aspect-[4/3] overflow-hidden">
                        {post.picture ? (
                          <img src={post.picture} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <MessageCircle size={28} className="text-slate-300" />
                          </div>
                        )}
                        {post.type && (
                          <span className="absolute top-2 left-2 rounded-md bg-black/50 px-2 py-1 text-[10px] text-white/80 font-medium capitalize">
                            {post.type}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="p-4 space-y-3">
                        {/* Message */}
                        <div>
                          <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-3">
                            {post.message || `Post ${post.post_id.slice(0, 8)}`}
                          </div>
                        </div>

                        {/* Metrics grid */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Heart size={10} /> Likes
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.likes_count)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <MessageCircle size={10} /> Comments
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.comments_count)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <Share2 size={10} /> Shares
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.shares)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                              <TrendingUp size={10} /> Engagement
                            </div>
                            <div className="text-base font-black text-slate-900">{formatCompactNumber(post.engagement)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2 col-span-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Created</div>
                            <div className="text-sm font-semibold text-slate-700">{formatShortDate(post.created_at)}</div>
                          </div>
                        </div>

                        {/* Links */}
                        {post.permalink_url && (
                          <div className="flex items-center pt-2 border-t border-slate-100">
                            <a href={post.permalink_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                              <ExternalLink size={11} /> View on Facebook
                            </a>
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
