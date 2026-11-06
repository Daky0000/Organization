import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type PlatformMetric = {
  name: string;
  engagement?: number | null;
  reach?: number | null;
  impressions?: number | null;
};

type Props = {
  platforms: PlatformMetric[];
};

const colors = ["#6366f1", "#22c55e", "#f97316", "#38bdf8", "#f472b6", "#eab308"];

const formatValue = (value?: number | null) =>
  value === null || value === undefined ? "N/A" : value.toLocaleString();

export const PlatformComparison: React.FC<Props> = ({ platforms }) => {
  const [view, setView] = useState<"chart" | "table">("chart");

  const filtered = useMemo(
    () =>
      platforms.filter(
        (platform) =>
          (platform.engagement !== null && platform.engagement !== undefined) ||
          (platform.reach !== null && platform.reach !== undefined) ||
          (platform.impressions !== null && platform.impressions !== undefined)
      ),
    [platforms]
  );

  const chartData = useMemo(
    () =>
      filtered
        .filter((platform) => platform.engagement !== null && platform.engagement !== undefined)
        .map((platform) => ({
          ...platform,
          engagementRate:
            platform.impressions && platform.engagement !== null && platform.engagement !== undefined
              ? Number(((platform.engagement / platform.impressions) * 100).toFixed(2))
              : null,
        })),
    [filtered]
  );

  if (!filtered.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
        <p className="text-sm font-semibold text-slate-200">No platform data yet</p>
        <p className="mt-2 text-xs text-slate-500">
          Connect platforms or publish posts to see comparisons.
        </p>
        <a
          href="/integrations"
          className="mt-4 inline-flex rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
        >
          Go to Integrations
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Platform Comparison</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView("chart")}
            className={`rounded-full px-3 py-1 text-xs ${
              view === "chart" ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={`rounded-full px-3 py-1 text-xs ${
              view === "table" ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            Table
          </button>
        </div>
      </div>

      {view === "chart" ? (
        chartData.length ? (
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #1f2937",
                    borderRadius: "8px",
                    color: "#e2e8f0",
                  }}
                />
                <Bar dataKey="engagement" fill={colors[0]} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
            No engagement data available yet.
          </div>
        )
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs text-slate-300">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="py-2 pr-4">Platform</th>
                <th className="py-2 pr-4">Engagement</th>
                <th className="py-2 pr-4">Reach</th>
                <th className="py-2 pr-4">Impressions</th>
                <th className="py-2">Engagement Rate</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((platform) => {
                const engagementRate =
                  platform.impressions && platform.engagement !== null && platform.engagement !== undefined
                    ? Number(((platform.engagement / platform.impressions) * 100).toFixed(2))
                    : null;

                return (
                  <tr key={platform.name} className="border-b border-slate-900">
                    <td className="py-2 pr-4 font-semibold text-slate-100">
                      {platform.name}
                    </td>
                    <td className="py-2 pr-4">{formatValue(platform.engagement)}</td>
                    <td className="py-2 pr-4">{formatValue(platform.reach)}</td>
                    <td className="py-2 pr-4">{formatValue(platform.impressions)}</td>
                    <td className="py-2 text-emerald-300">
                      {engagementRate === null ? "N/A" : `${engagementRate}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

