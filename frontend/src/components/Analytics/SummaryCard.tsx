import React from "react";

type Props = {
  title: string;
  value?: number | null;
  trend?: number | null;
  icon: React.ReactNode;
  unit?: string;
};

const formatTrend = (trend: number) => {
  if (trend === 0) return "0%";
  return `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`;
};

export const SummaryCard: React.FC<Props> = ({
  title,
  value,
  trend,
  icon,
  unit,
}) => {
  const hasValue = value !== null && value !== undefined;
  const hasTrend = trend !== null && trend !== undefined;
  const trendColor =
    trend && trend > 0
      ? "text-emerald-300"
      : trend && trend < 0
        ? "text-red-300"
        : "text-slate-400";
  const trendSymbol = trend && trend > 0 ? "up" : trend && trend < 0 ? "down" : "-";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-200">
          {icon}
        </div>
        {hasTrend ? (
          <span className={`text-xs font-semibold ${trendColor}`}>
            {trendSymbol} {formatTrend(trend as number)}
          </span>
        ) : (
          <span className="text-xs text-slate-500">N/A</span>
        )}
      </div>
      <p className="mt-4 text-xs uppercase tracking-[0.3em] text-slate-500">
        {title}
      </p>
      {hasValue ? (
        <p className="mt-2 text-2xl font-semibold text-slate-100">
          {Number(value).toLocaleString()}
          {unit ? <span className="text-sm text-slate-400"> {unit}</span> : null}
        </p>
      ) : (
        <p className="mt-2 text-lg font-semibold text-slate-500">N/A</p>
      )}
    </div>
  );
};
