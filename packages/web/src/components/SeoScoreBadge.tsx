import type { CSSProperties } from 'react';

interface SeoScoreBadgeProps {
  score: number;
  size?: number;
  label?: string;
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export default function SeoScoreBadge({
  score,
  size = 90,
  label = 'SEO',
  className = '',
}: SeoScoreBadgeProps) {
  const pct = clamp(score, 0, 100);
  const palette = (() => {
    if (pct >= 71) return { main: '#16a34a', pale: '#dcfce7', textClass: 'text-emerald-700', border: '#bbf7d0' };
    if (pct >= 41) return { main: '#f59e0b', pale: '#ffedd5', textClass: 'text-amber-700', border: '#fed7aa' };
    return { main: '#ef4444', pale: '#fee2e2', textClass: 'text-red-600', border: '#fecaca' };
  })();
  const gradientStyle: CSSProperties = {
    background: `conic-gradient(${palette.main} ${pct}%, ${palette.pale} ${pct}%)`,
  };
  const innerSize = size * 0.78;

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 rounded-full border border-[#d1fae5]"
          style={{ ...gradientStyle, borderColor: palette.border }}
        />
        <div
          className="flex items-center justify-center rounded-full bg-white shadow-sm"
          style={{ width: innerSize, height: innerSize }}
        >
          <span className={`text-lg font-black ${palette.textClass}`}>
            {Math.round(pct)}
            <span className="align-top text-[10px] font-semibold">%</span>
          </span>
        </div>
      </div>
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</span>
    </div>
  );
}
