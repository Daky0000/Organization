import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
} from "recharts";

type Props = {
  data?: Array<{ date: string; engagement: number }> | null;
  title: string;
};

export const EngagementChart: React.FC<Props> = ({ data, title }) => {
  const hasNonZeroData =
    !!data &&
    data.some(
      (point) => point.engagement !== null && point.engagement !== undefined && point.engagement !== 0
    );

  if (!hasNonZeroData) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <div className="mt-4 flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center text-sm text-slate-400">
          <p className="text-sm font-semibold text-slate-300">No data available yet</p>
          <p className="mt-2 text-xs text-slate-500">
            Publish posts to see engagement trends over time.
          </p>
          <a
            href="/posts/new"
            className="mt-4 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
          >
            Create First Post
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      </div>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #1f2937",
                borderRadius: "8px",
                color: "#e2e8f0",
              }}
            />
            <Area
              type="monotone"
              dataKey="engagement"
              fill="#6366f1"
              fillOpacity={0.15}
              stroke="none"
            />
            <Line
              type="monotone"
              dataKey="engagement"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
