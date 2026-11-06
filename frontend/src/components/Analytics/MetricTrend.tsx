import React from "react";

type Props = {
  value?: number | null;
  percentageChange?: number | null;
  label: string;
};

export const MetricTrend: React.FC<Props> = ({
  value,
  percentageChange,
  label,
}) => {
  const hasValue = value !== null && value !== undefined;
  const hasTrend = percentageChange !== null && percentageChange !== undefined;
  const color =
    percentageChange && percentageChange > 0
      ? "text-emerald-300"
      : percentageChange && percentageChange < 0
        ? "text-red-300"
        : "text-slate-400";
  const symbol =
    percentageChange && percentageChange > 0
      ? "up"
      : percentageChange && percentageChange < 0
        ? "down"
        : "-";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between">
        {hasValue ? (
          <p className="text-xl font-semibold text-slate-100">
            {Number(value).toLocaleString()}
          </p>
        ) : (
          <p className="text-sm font-semibold text-slate-500">N/A</p>
        )}
        {hasTrend ? (
          <span className={`text-xs font-semibold ${color}`}>
            {symbol} {Number(percentageChange).toFixed(1)}%
          </span>
        ) : (
          <span className="text-xs text-slate-500">N/A</span>
        )}
      </div>
    </div>
  );
};
