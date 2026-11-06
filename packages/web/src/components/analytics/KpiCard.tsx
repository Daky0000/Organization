import type { ReactNode } from 'react';
import { formatCompactNumber, formatPercent, formatTrend } from './analyticsUtils';

type KpiCardProps = {
  label: string;
  value: number | string | null;
  icon: ReactNode;
  trend?: number | null;
  valueType?: 'number' | 'percent' | 'text';
  subtext?: string | null;
};

const KpiCard = ({ label, value, icon, trend = null, valueType = 'number', subtext }: KpiCardProps) => {
  const trendText = formatTrend(trend);
  const trendClass =
    trend === null || trend === undefined
      ? 'text-slate-400'
      : trend > 0
        ? 'text-emerald-600'
        : trend < 0
          ? 'text-rose-600'
          : 'text-slate-500';

  const displayValue =
    valueType === 'text'
      ? value || 'N/A'
      : valueType === 'percent'
        ? formatPercent(typeof value === 'number' ? value : null)
        : formatCompactNumber(typeof value === 'number' ? value : null);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">{displayValue}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs">
        <span className={trendClass}>{trendText ?? 'No previous period'}</span>
        <span className="text-slate-500">{subtext || 'vs previous period'}</span>
      </div>
    </div>
  );
};

export default KpiCard;
