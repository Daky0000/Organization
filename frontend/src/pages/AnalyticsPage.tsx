import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Users,
  Activity,
  Gauge,
  RefreshCcw,
  Download,
} from "lucide-react";
import { SummaryCard } from "../components/Analytics/SummaryCard";
import { EngagementChart } from "../components/Analytics/EngagementChart";
import { PlatformComparison } from "../components/Analytics/PlatformComparison";
import { TopPostsTable } from "../components/Analytics/TopPostsTable";
import { DateRangeSelector } from "../components/Analytics/DateRangeSelector";
import { MetricTrend } from "../components/Analytics/MetricTrend";
import { Toast } from "../components/ui/Toast";
import { useAnalytics } from "../hooks/useAnalytics";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "platforms", label: "By Platform" },
  { key: "top", label: "Top Content" },
  { key: "trends", label: "Trends" },
  { key: "comparison", label: "Comparison" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

type PlatformDetails = {
  platform: string;
  accountName?: string;
  metrics: any;
  dailyBreakdown: Array<{
    date: string;
    reach: number;
    impressions: number;
    engagement: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
  }>;
};

const EmptyState: React.FC<{ title: string; message: string }> = ({
  title,
  message,
}) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
    <p className="text-sm font-semibold text-slate-200">{title}</p>
    <p className="mt-2 text-xs text-slate-500">{message}</p>
    <a
      href="/posts/new"
      className="mt-4 inline-flex rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
    >
      Create First Post
    </a>
  </div>
);

export const AnalyticsPage: React.FC = () => {
  const {
    analyticsData,
    platformMetrics,
    topPosts,
    trends,
    comparison,
    loading,
    error,
    selectedDays,
    getOverviewAnalytics,
    getPlatformMetrics,
    getPlatformDetails,
    getTopContent,
    getTrends,
    getComparison,
    refreshAnalytics,
    exportAnalytics,
    setSelectedDays,
  } = useAnalytics();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [toast, setToast] = useState<string | null>(null);
  const [platformSlug, setPlatformSlug] = useState<string>("");
  const [platformDetails, setPlatformDetails] = useState<PlatformDetails | null>(
    null
  );
  const [trendGroup, setTrendGroup] = useState<"daily" | "weekly" | "monthly">(
    "daily"
  );

  useEffect(() => {
    void getOverviewAnalytics(selectedDays);
    void getPlatformMetrics(selectedDays);
    void getTopContent(selectedDays);
    void getTrends(selectedDays);
    void getComparison();
  }, [
    getOverviewAnalytics,
    getPlatformMetrics,
    getTopContent,
    getTrends,
    getComparison,
    selectedDays,
  ]);

  useEffect(() => {
    if (!platformMetrics.length) return;
    const first = platformMetrics[0];
    if (!first?.platform) return;
    setPlatformSlug(first.platform);
  }, [platformMetrics]);

  useEffect(() => {
    if (!platformSlug) return;
    getPlatformDetails(platformSlug, selectedDays)
      .then((data) => setPlatformDetails(data))
      .catch(() => setPlatformDetails(null));
  }, [platformSlug, selectedDays, getPlatformDetails]);

  const summary = analyticsData?.summary || null;

  const hasNonZeroChartData = (data: Array<{ date: string; engagement: number }> | null) =>
    !!data && data.some((point) => point.engagement !== null && point.engagement !== undefined && point.engagement !== 0);

  const chartEngagement = useMemo(() => {
    const data = analyticsData?.trends
      ? analyticsData.trends.map((item) => ({
          date: item.date,
          engagement: item.totalEngagement,
        }))
      : null;
    return hasNonZeroChartData(data) ? data : null;
  }, [analyticsData]);

  const chartReach = useMemo(() => {
    const data = analyticsData?.trends
      ? analyticsData.trends.map((item) => ({
          date: item.date,
          engagement: item.totalReach,
        }))
      : null;
    return hasNonZeroChartData(data) ? data : null;
  }, [analyticsData]);

  const trendData = useMemo(() => {
    if (!trends?.engagementTrend?.length) return null;
    if (trendGroup === "daily") {
      return trends.engagementTrend.map((item) => ({
        date: item.date,
        engagement: item.value,
      }));
    }
    const grouped = new Map<string, number>();
    trends.engagementTrend.forEach((item) => {
      const date = new Date(item.date);
      let key = item.date;
      if (trendGroup === "weekly") {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split("T")[0];
      }
      if (trendGroup === "monthly") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }
      grouped.set(key, (grouped.get(key) || 0) + item.value);
    });
    return Array.from(grouped.entries()).map(([date, engagement]) => ({
      date,
      engagement,
    }));
  }, [trends, trendGroup]);

  const platformComparisonData = useMemo(
    () =>
      platformMetrics.map((item) => ({
        name: item.platform,
        engagement: item.metrics?.totalEngagement ?? null,
        reach: item.metrics?.totalReach ?? null,
        impressions: item.metrics?.totalImpressions ?? null,
      })),
    [platformMetrics]
  );\n  const hasPlatformData = useMemo(\n    () => platformMetrics.some((item) => !!item.metrics),\n    [platformMetrics]\n  );\n

  const handleRefresh = async () => {
    try {
      await refreshAnalytics();
      await Promise.all([
        getOverviewAnalytics(selectedDays),
        getPlatformMetrics(selectedDays),
        getTopContent(selectedDays),
        getTrends(selectedDays),
        getComparison(),
      ]);
      setToast("Analytics refreshed");
    } catch {
      setToast("Failed to refresh analytics");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Analytics & Performance</h1>
            <p className="text-sm text-slate-400">
              {selectedDays === 30 ? "Last 30 days" : "Last 60 days"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DateRangeSelector
              selectedDays={selectedDays}
              onChange={setSelectedDays}
            />
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-2 rounded-full border border-slate-800 px-4 py-2 text-xs text-slate-200"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => exportAnalytics("csv", selectedDays)}
              className="flex items-center gap-2 rounded-full bg-indigo-500 px-4 py-2 text-xs text-white"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        {toast && (
          <div className="mt-6">
            <Toast message={toast} variant={toast.includes("Failed") ? "error" : "success"} onClose={() => setToast(null)} />
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
            <button
              type="button"
              onClick={() => setSelectedDays(selectedDays)}
              className="ml-4 text-xs underline"
            >
              Retry
            </button>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? "bg-indigo-500 text-white"
                  : "bg-slate-900/60 text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && !analyticsData ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60"
              />
            ))}
          </div>
        ) : null}

        {activeTab === "overview" && (
          <div className="mt-8 space-y-6">
            {!summary && (
              <EmptyState
                title="No Data Available Yet"
                message="You haven't published any posts yet. Once you do, analytics will appear here."
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <SummaryCard
                title="Total Posts"
                value={summary?.totalPosts}
                trend={summary?.growthRate}
                icon={<BarChart3 className="h-5 w-5" />}
                unit="posts"
              />
              <SummaryCard
                title="Total Reach"
                value={summary?.totalReach}
                trend={summary?.growthRate}
                icon={<Users className="h-5 w-5" />}
              />
              <SummaryCard
                title="Impressions"
                value={summary?.totalImpressions}
                trend={summary?.growthRate}
                icon={<TrendingUp className="h-5 w-5" />}
              />
              <SummaryCard
                title="Engagement"
                value={summary?.totalEngagement}
                trend={summary?.growthRate}
                icon={<Activity className="h-5 w-5" />}
              />
              <SummaryCard
                title="Engagement Rate"
                value={summary?.engagementRate}
                trend={summary?.growthRate}
                icon={<Gauge className="h-5 w-5" />}
                unit="%"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <EngagementChart data={chartEngagement} title="Engagement Trend" />
              <EngagementChart data={chartReach} title="Reach Trend" />
            </div>

            <PlatformComparison platforms={platformComparisonData} />
            <TopPostsTable posts={topPosts} />
          </div>
        )}

        {activeTab === "platforms" && (
          <div className="mt-8 space-y-6">
            {platformMetrics.length === 0 ? (
              <EmptyState
                title="No platforms connected"
                message="Connect your first platform to start collecting analytics."
              />
            ) : !hasPlatformData ? (
              <EmptyState
                title="No platform data yet"
                message="Publish posts to start seeing platform analytics."
              />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {platformMetrics.map((platform) => (
                    <button
                      key={platform.platform}
                      type="button"
                      onClick={() => setPlatformSlug(platform.platform)}
                      className={`rounded-full px-3 py-2 text-xs font-semibold ${
                        platformSlug === platform.platform
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-900/60 text-slate-300"
                      }`}
                    >
                      {platform.platform}
                    </button>
                  ))}
                </div>

                {platformDetails ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <MetricTrend
                        label="Reach"
                        value={platformDetails.metrics?.totalReach}
                        percentageChange={null}
                      />
                      <MetricTrend
                        label="Impressions"
                        value={platformDetails.metrics?.totalImpressions}
                        percentageChange={null}
                      />
                      <MetricTrend
                        label="Engagement"
                        value={platformDetails.metrics?.totalEngagement}
                        percentageChange={null}
                      />
                      <MetricTrend
                        label="Engagement Rate"
                        value={platformDetails.metrics?.engagementRate}
                        percentageChange={null}
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                      <h3 className="text-sm font-semibold text-slate-100">
                        Daily Breakdown
                      </h3>
                      <div className="mt-4 overflow-x-auto">
                        {platformDetails.dailyBreakdown.length ? (
                          <table className="min-w-full text-left text-xs text-slate-300">
                            <thead>
                              <tr className="border-b border-slate-800 text-slate-500">
                                <th className="py-2 pr-4">Date</th>
                                <th className="py-2 pr-4">Reach</th>
                                <th className="py-2 pr-4">Impressions</th>
                                <th className="py-2 pr-4">Engagement</th>
                                <th className="py-2">Likes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {platformDetails.dailyBreakdown.map((row) => (
                                <tr key={row.date} className="border-b border-slate-900">
                                  <td className="py-2 pr-4">
                                    {new Date(row.date).toLocaleDateString()}
                                  </td>
                                  <td className="py-2 pr-4">{row.reach}</td>
                                  <td className="py-2 pr-4">{row.impressions}</td>
                                  <td className="py-2 pr-4">{row.engagement}</td>
                                  <td className="py-2">{row.likes ?? "N/A"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="text-xs text-slate-400">No daily data yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    title="No platform data"
                    message="No analytics are available for this platform yet."
                  />
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "top" && (
          <div className="mt-8">
            <TopPostsTable posts={topPosts} />
          </div>
        )}

        {activeTab === "trends" && (
          <div className="mt-8 space-y-4">
            <div className="flex gap-2">
              {(["daily", "weekly", "monthly"] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTrendGroup(range)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    trendGroup === range
                      ? "bg-indigo-500 text-white"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <EngagementChart data={trendData} title="Engagement Trend" />
            <EngagementChart
              data={
                trends?.reachTrend?.map((item) => ({
                  date: item.date,
                  engagement: item.value,
                })) || null
              }
              title="Reach Trend"
            />
            <EngagementChart
              data={
                trends?.impressionsTrend?.map((item) => ({
                  date: item.date,
                  engagement: item.value,
                })) || null
              }
              title="Impressions Trend"
            />
          </div>
        )}

        {activeTab === "comparison" && (
          <div className="mt-8 space-y-6">
            {!comparison ? (
              <EmptyState
                title="No comparison data"
                message="Publish posts to compare performance across periods."
              />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricTrend
                    label="Posts"
                    value={comparison?.thisMonth?.postsPublished}
                    percentageChange={comparison?.change?.posts}
                  />
                  <MetricTrend
                    label="Engagement"
                    value={comparison?.thisMonth?.totalEngagement}
                    percentageChange={comparison?.change?.engagement}
                  />
                  <MetricTrend
                    label="Reach"
                    value={comparison?.thisMonth?.totalReach}
                    percentageChange={comparison?.change?.reach}
                  />
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-xs text-slate-300">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-slate-500">This Month</p>
                      <p>Posts: {comparison?.thisMonth?.postsPublished ?? "N/A"}</p>
                      <p>Engagement: {comparison?.thisMonth?.totalEngagement ?? "N/A"}</p>
                      <p>Reach: {comparison?.thisMonth?.totalReach ?? "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Last Month</p>
                      <p>Posts: {comparison?.lastMonth?.postsPublished ?? "N/A"}</p>
                      <p>Engagement: {comparison?.lastMonth?.totalEngagement ?? "N/A"}</p>
                      <p>Reach: {comparison?.lastMonth?.totalReach ?? "N/A"}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

