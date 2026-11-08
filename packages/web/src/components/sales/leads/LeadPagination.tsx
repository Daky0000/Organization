import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [25, 50, 100] as const;

/**
 * Page numbers to show: always the first and last page plus the pages either
 * side of the current one, with "…" for the gaps — e.g. 1 … 4 5 6 … 12.
 * A gap of a single page shows that page instead of an ellipsis.
 */
export function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  const keep = new Set([1, totalPages, page - 1, page, page + 1]);
  const items: (number | 'gap')[] = [];
  let prev = 0;
  for (let p = 1; p <= totalPages; p++) {
    if (!keep.has(p)) continue;
    if (p - prev === 2) items.push(p - 1);
    else if (p - prev > 2) items.push('gap');
    items.push(p);
    prev = p;
  }
  return items;
}

export default function LeadPagination({ page, pageSize, total, onPage, onPageSize }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const arrow = 'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white';

  return (
    <nav aria-label="Leads pages" className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-slate-500">
        {from}–{to} of {total}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={arrow}>
            <ChevronLeft size={16} />
          </button>
          {pageItems(page, totalPages).map((item, i) => item === 'gap' ? (
            <span key={`gap-${i}`} className="w-6 text-center text-sm text-slate-400" aria-hidden>…</span>
          ) : (
            <button
              key={item}
              type="button"
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPage(item)}
              className={`h-9 min-w-9 rounded-xl px-2.5 text-sm font-semibold ${
                item === page ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item}
            </button>
          ))}
          <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={arrow}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-500">
        Per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-xl border border-slate-200 px-2 py-1.5 text-sm text-slate-700">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}
