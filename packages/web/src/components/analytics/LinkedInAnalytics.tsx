import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  MousePointerClick,
  RefreshCcw,
  Repeat2,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  linkedInAnalyticsService,
  type LinkedInCompanyPost,
  type LinkedInCompanyPostSummary,
  type LinkedInCompanyStatsResponse,
  type LinkedInOrganization,
  type LinkedInPost,
  type LinkedInProfileResponse,
} from '../../services/linkedInAnalyticsService';
import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

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

const fmt = (val: number | string | null | undefined) =>
  val === null || val === undefined || val === '' ? '–' : formatCompactNumber(val);

type SubTab = 'company' | 'personal';

export default function LinkedInAnalytics() {
  const [subTab, setSubTab] = useState<SubTab>(() => {
    const saved = localStorage.getItem('linkedin_analytics_view');
    return saved === 'personal' || saved === 'company' ? saved : 'company';
  });

  const [posts, setPosts] = useState<LinkedInPost[]>([]);
  const [profile, setProfile] = useState<LinkedInProfileResponse | null>(null);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [personalError, setPersonalError] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<LinkedInOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState(() => localStorage.getItem('linkedin_analytics_org') || '');
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [companyStats, setCompanyStats] = useState<LinkedInCompanyStatsResponse | null>(null);
  const [companyPosts, setCompanyPosts] = useState<LinkedInCompanyPost[]>([]);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [companySummary, setCompanySummary] = useState<LinkedInCompanyPostSummary | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors?: string[] } | null>(null);

  const selectedOrganization = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) || null,
    [organizations, selectedOrgId]
  );

  const fetchPersonalData = useCallback(async () => {
    setPersonalLoading(true);
    setPersonalError(null);
    try {
      const [postsResult, profileResult] = await Promise.all([
        linkedInAnalyticsService.getPosts({ limit: 50 }),
        linkedInAnalyticsService.getProfile(),
      ]);
      setPosts(postsResult.posts);
      setProfile(profileResult);
    } catch (err) {
      setPersonalError(err instanceof Error ? err.message : 'Failed to load LinkedIn personal data');
    } finally {
      setPersonalLoading(false);
    }
  }, []);

  const fetchOrganizations = useCallback(async () => {
    setOrgLoading(true);
    setOrgError(null);
    try {
      const res = await linkedInAnalyticsService.listOrganizations();
      setOrganizations(res.organizations || []);
    } catch (err) {
      setOrganizations([]);
      setOrgError(err instanceof Error ? err.message : 'Failed to load LinkedIn company pages');
    } finally {
      setOrgLoading(false);
    }
  }, []);

  const fetchCompanyData = useCallback(async (organizationId: string) => {
    if (!organizationId) return;
    setCompanyLoading(true);
    setCompanyError(null);
    setCompanyStats(null);
    setCompanyPosts([]);
    setCompanyTotal(0);
    setCompanySummary(null);
    try {
      const [statsResult, postsResult] = await Promise.all([
        linkedInAnalyticsService.getCompanyStats(organizationId),
        linkedInAnalyticsService.getCompanyPosts(organizationId, { limit: 50 }),
      ]);
      setCompanyStats(statsResult);
      setCompanyPosts(postsResult.posts);
      setCompanyTotal(postsResult.total);
      setCompanySummary(postsResult.summary);
    } catch (err) {
      setCompanyError(err instanceof Error ? err.message : 'Failed to load LinkedIn page analytics');
    } finally {
      setCompanyLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPersonalData();
    void fetchOrganizations();
  }, [fetchOrganizations, fetchPersonalData]);

  useEffect(() => {
    localStorage.setItem('linkedin_analytics_view', subTab);
  }, [subTab]);

  useEffect(() => {
    if (!selectedOrgId) return;
    localStorage.setItem('linkedin_analytics_org', selectedOrgId);
  }, [selectedOrgId]);

  useEffect(() => {
    if (organizations.length === 0) return;
    if (selectedOrgId && organizations.some((org) => org.id === selectedOrgId)) return;
    setSelectedOrgId(organizations[0].id);
  }, [organizations, selectedOrgId]);

  useEffect(() => {
    if (subTab !== 'company') return;
    if (!selectedOrgId) return;
    if (organizations.length > 0 && !organizations.some((org) => org.id === selectedOrgId)) return;
    void fetchCompanyData(selectedOrgId);
  }, [fetchCompanyData, organizations, selectedOrgId, subTab]);

  const handleSync = async () => {
    if (subTab === 'company' && !selectedOrgId) {
      setSyncResult({ synced: 0, errors: ['Select a company page first.'] });
      return;
    }

    setSyncing(true);
    setSyncResult(null);
    try {
      const result =
        subTab === 'company'
          ? await linkedInAnalyticsService.syncCompany(selectedOrgId)
          : await linkedInAnalyticsService.sync();
      setSyncResult(result);
      if (subTab === 'company') {
        await fetchOrganizations();
        await fetchCompanyData(selectedOrgId);
      } else {
        await fetchPersonalData();
      }
    } catch (err) {
      setSyncResult({ synced: 0, errors: [err instanceof Error ? err.message : 'Sync failed'] });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-base font-bold text-slate-950">LinkedIn Analytics</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {subTab === 'company'
              ? (selectedOrganization ? `Company Page · ${selectedOrganization.name}` : 'Company Page')
              : 'Personal Profile'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || (subTab === 'company' && !selectedOrgId)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : subTab === 'company' ? 'Sync Page' : 'Sync Profile'}
        </button>
      </div>

      {/* View toggle */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="LinkedIn analytics views">
        {[
          { id: 'company' as const, label: 'Company Pages' },
          { id: 'personal' as const, label: 'Personal' },
        ].map((tab) => {
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
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

      {/* Sync Result Banner */}
      {syncResult && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          syncResult.errors?.length
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}>
          {syncResult.errors?.length ? (
            <>
              <span className="font-semibold">Sync completed with issues.</span>{' '}
              {syncResult.synced} items synced.
              {syncResult.errors.map((e, i) => (
                <span key={i} className="block mt-1 text-xs">{e}</span>
              ))}
            </>
          ) : (
            <><span className="font-semibold">Sync successful!</span> {syncResult.synced} items updated.</>
          )}
        </div>
      )}

      {subTab === 'company' ? (
        <>
          {/* Company Page Selector */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Company Page</div>
            {orgLoading ? (
              <div className="flex items-center justify-center py-10 text-slate-400">
                <Loader2 size={20} className="animate-spin mr-2" /> Loading LinkedIn company pages…
              </div>
            ) : organizations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
                <div className="font-semibold text-slate-700">No LinkedIn company pages detected</div>
                <div className="mt-1 text-xs">
                  Connect LinkedIn and approve organization scopes, then sync a company page from Integrations or click Sync Page here.
                </div>
                {orgError ? <div className="mt-2 text-xs text-amber-700">{orgError}</div> : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      {selectedOrganization?.picture_url ? (
                        <img src={selectedOrganization.picture_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                          <Building2 size={16} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">{selectedOrganization?.name || 'Select a page'}</div>
                        <div className="text-[11px] text-slate-500 truncate">Organization ID: {selectedOrgId}</div>
                      </div>
                    </div>
                  </div>
                  <div className="w-full sm:w-[320px]">
                    <select
                      value={selectedOrgId}
                      onChange={(e) => setSelectedOrgId(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
                    >
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {orgError ? <div className="mt-2 text-xs text-amber-700">{orgError}</div> : null}
              </div>
            )}
          </div>

          {/* Company Snapshot */}
          {selectedOrgId ? (
            companyLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 size={20} className="animate-spin mr-2" /> Loading page analytics…
              </div>
            ) : companyError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {companyError}
              </div>
            ) : companyStats && companyStats.hasData ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Page Snapshot</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="Followers" value={fmt(companyStats.follower_count)} icon={<Users size={16} />} />
                  <StatCard label="Posts Created" value={fmt(companyStats.posts_created)} icon={<MessageCircle size={16} />} />
                  <StatCard label="Engagement Rate" value={formatPercent(companyStats.engagement_rate)} icon={<TrendingUp size={16} />} />
                  <StatCard label="Posts Synced" value={fmt(companyTotal)} icon={<Briefcase size={16} />} />
                </div>
                {companyStats.synced_at ? (
                  <div className="mt-1.5 text-xs text-slate-400">
                    Last synced {new Date(companyStats.synced_at).toLocaleString()}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
                <div className="font-semibold text-slate-700">No page analytics synced yet</div>
                <div className="mt-1 text-xs">Click Sync Page to pull analytics for this organization.</div>
              </div>
            )
          ) : null}

          {/* Company Posts */}
          {selectedOrgId ? (
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Page Posts · {fmt(companyTotal)} total
              </div>

              {companySummary ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
                  <StatCard label="Impressions" value={fmt(companySummary.total_impressions)} icon={<Eye size={16} />} />
                  <StatCard label="Likes" value={fmt(companySummary.total_likes)} icon={<Heart size={16} />} />
                  <StatCard label="Comments" value={fmt(companySummary.total_comments)} icon={<MessageCircle size={16} />} />
                  <StatCard label="Clicks" value={fmt(companySummary.total_clicks)} icon={<MousePointerClick size={16} />} />
                </div>
              ) : null}

              {companyPosts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
                  <div className="font-semibold text-slate-700">No page posts synced yet</div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {companyPosts.map((post) => (
                    <div key={post.post_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                      <div className="p-4 space-y-3">
                        <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-4">
                          {post.text || `Post · ${post.post_id.slice(0, 8)}`}
                        </div>

                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-600">
                          <div className="flex items-center gap-1.5"><Eye size={12} /> {fmt(post.impressions)} impressions</div>
                          <div className="flex items-center gap-1.5"><Heart size={12} /> {fmt(post.likes)} likes</div>
                          <div className="flex items-center gap-1.5"><MessageCircle size={12} /> {fmt(post.comments)} comments</div>
                          <div className="flex items-center gap-1.5"><MousePointerClick size={12} /> {fmt(post.clicks)} clicks</div>
                          <div className="flex items-center gap-1.5"><Repeat2 size={12} /> {fmt(post.reposts)} reposts</div>
                          <div className="flex items-center gap-1.5"><TrendingUp size={12} /> {formatPercent(post.engagement_rate)} engagement</div>
                        </div>

                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {formatShortDate(post.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {personalLoading && !profile ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading LinkedIn profile…
            </div>
          ) : personalError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {personalError}
            </div>
          ) : profile && profile.hasData ? (
            <>
              {/* Profile Info */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Profile</div>
                <div className="mb-3 flex items-start gap-4">
                  {profile.profile_picture_url ? (
                    <img src={profile.profile_picture_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : null}
                  <div>
                    <div className="text-base font-bold text-slate-900">
                      {profile.first_name} {profile.last_name}
                    </div>
                    {profile.headline ? (
                      <div className="text-sm text-slate-600 mt-0.5">{profile.headline}</div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <StatCard label="Connections" value={fmt(profile.connections_count)} icon={<Users size={16} />} />
                  <StatCard label="Posts" value={fmt(posts.length)} icon={<MessageCircle size={16} />} />
                  <StatCard label="Account Type" value="Personal" icon={<Briefcase size={16} />} />
                </div>

                {profile.synced_at ? (
                  <div className="mt-1.5 text-xs text-slate-400">
                    Last synced {new Date(profile.synced_at).toLocaleString()}
                  </div>
                ) : null}
              </div>

              {/* Personal Posts */}
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Posts · {posts.length} synced
                </div>
                {posts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                    <MessageCircle size={32} className="mx-auto mb-3 text-slate-300" />
                    <div className="font-semibold text-slate-700">No posts synced yet</div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {posts.map((post) => (
                      <div key={post.post_id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                        <div className="p-4 space-y-3">
                          <div className="font-semibold text-sm text-slate-900 leading-snug line-clamp-4">
                            {post.text || `Post · ${post.post_id.slice(0, 8)}`}
                          </div>

                          {post.media_type ? (
                            <span className="inline-block rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600 font-medium capitalize">
                              {post.media_type}
                            </span>
                          ) : null}

                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {formatShortDate(post.created_at)}
                          </div>

                          {post.post_url ? (
                            <a
                              href={post.post_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                            >
                              <ExternalLink size={11} /> View on LinkedIn
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              <Briefcase size={32} className="mx-auto mb-3 text-slate-300" />
              <div className="font-semibold text-slate-700">No LinkedIn profile data yet</div>
              <div className="mt-1 text-xs">Click Sync Profile to pull your LinkedIn profile + posts.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

