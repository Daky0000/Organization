export function formatCompactNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '0';
  const n = Number(value);
  if (isNaN(n)) return '0';
  return new Intl.NumberFormat('en-US', {
    notation: n >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: n >= 1000 ? 1 : 0,
  }).format(n);
}

export function formatPercent(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 'N/A';
  const n = Number(value);
  if (isNaN(n)) return 'N/A';
  return `${n.toFixed(1)}%`;
}

export function formatTrend(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  const prefix = n > 0 ? '+' : '';
  return `${prefix}${n.toFixed(1)}%`;
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
