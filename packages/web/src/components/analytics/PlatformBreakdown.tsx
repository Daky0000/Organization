import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactNumber, formatPercent } from './analyticsUtils';

type PlatformBreakdownEntry = {
  label: string;
  published: number;
  successRate: number | null;
};

type PlatformBreakdownProps = {
  data: PlatformBreakdownEntry[];
  performanceMode: boolean;
};

const COLORS = ['#0f172a', '#2563eb', '#14b8a6', '#f59e0b', '#e11d48', '#2563EB'];

const PlatformBreakdown = ({ data, performanceMode }: PlatformBreakdownProps) => {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Connect platforms and publish content to see a platform breakdown.
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-bold text-slate-950">Distribution By Platform</h3>
        <p className="text-sm text-slate-500">Share of successful publishes across your active channels.</p>
        <div className="mt-6 h-[260px]" aria-label="Platform distribution pie chart">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="published" nameKey="label" innerRadius={54} outerRadius={92} paddingAngle={2}>
                {data.map((entry, index) => (
                  <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [formatCompactNumber(value), 'Publishes']} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-bold text-slate-950">
          {performanceMode ? 'Platform Reliability' : 'Publish Success Rate'}
        </h3>
        <p className="text-sm text-slate-500">How cleanly each platform is handling your outbound publishing.</p>
        <div className="mt-6 h-[260px]" aria-label="Platform success rate bar chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 12 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 12 }} domain={[0, 100]} />
              <Tooltip
                formatter={(value) => [
                  formatPercent(typeof value === 'number' ? value : Number(value)),
                  'Success rate',
                ]}
              />
              <Bar dataKey="successRate" fill="#2563eb" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default PlatformBreakdown;
