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

type TrendPoint = {
  date: string;
  publishedPosts: number;
  successfulPublishes: number;
  failedPublishes: number;
  engagementRate: number | null;
};

type TrendChartProps = {
  data: TrendPoint[];
  performanceMode: boolean;
};

const TrendChart = ({ data, performanceMode }: TrendChartProps) => {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No trend data yet.
      </div>
    );
  }

  const chartData = data.map((item) => ({
    ...item,
    dateLabel: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-950">
            {performanceMode ? 'Publishing And Engagement Trend' : 'Publishing Trend'}
          </h3>
          <p className="text-sm text-slate-500">
            {performanceMode
              ? 'Published output overlaid with logged engagement rate when available.'
              : 'Successful and failed publishes across the selected range.'}
          </p>
        </div>
      </div>

      <div className="mt-6 h-[320px]" data-testid="trend-chart" aria-label="Analytics trend chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="dateLabel" tick={{ fill: '#64748b', fontSize: 12 }} />
            <YAxis yAxisId="volume" tick={{ fill: '#64748b', fontSize: 12 }} />
            <YAxis
              yAxisId="rate"
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 12 }}
              domain={performanceMode ? [0, 'auto'] : [0, 'auto']}
            />
            <Tooltip />
            <Bar yAxisId="volume" dataKey="successfulPublishes" fill="#0f172a" radius={[8, 8, 0, 0]} name="Successful publishes" />
            <Bar yAxisId="volume" dataKey="failedPublishes" fill="#f59e0b" radius={[8, 8, 0, 0]} name="Failed publishes" />
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey={performanceMode ? 'engagementRate' : 'publishedPosts'}
              stroke="#2563eb"
              strokeWidth={3}
              dot={false}
              name={performanceMode ? 'Engagement rate (%)' : 'Published posts'}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TrendChart;
