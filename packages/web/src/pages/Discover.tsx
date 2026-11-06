import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

const PAGE_SIZE = 48;

type DiscoverItem = {
  discover_id: string;
  pushed_at: string;
  generation_id: string;
  prompt: string;
  model: string;
  result_url: string;
  created_at: string;
  creator_id: string | null;
  creator_name: string | null;
  creator_username: string | null;
  creator_avatar: string | null;
};

export default function Discover() {
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DiscoverItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback((offset: number, append: boolean) => {
    const token = localStorage.getItem('auth_token') ?? '';
    (append ? setLoadingMore : setLoading)(true);
    fetch(`${API_BASE_URL}/api/discover?limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) { if (!append) setError(data.error ?? 'Failed to load'); return; }
        const page: DiscoverItem[] = data.items ?? [];
        setItems((prev) => {
          if (!append) return page;
          const seen = new Set(prev.map((i) => i.discover_id));
          return [...prev, ...page.filter((i) => !seen.has(i.discover_id))];
        });
        setHasMore(Boolean(data.hasMore ?? page.length === PAGE_SIZE));
      })
      .catch(() => { if (!append) setError('Failed to load discover feed'); })
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  }, []);

  useEffect(() => { fetchPage(0, false); }, [fetchPage]);

  // Auto-load the next page when scrolling near the bottom
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMore && !loading) fetchPage(items.length, true);
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, items.length, loadingMore, loading, fetchPage]);

  const getDisplayName = (item: DiscoverItem) =>
    item.creator_name || item.creator_username || 'Anonymous';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Compass size={18} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-gray-900">Discover</h1>
            <p className="text-sm text-gray-500">AI-generated images curated by our team</p>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      ) : error ? (
        <div className="flex h-64 items-center justify-center text-sm text-red-500">{error}</div>
      ) : items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-gray-400">
          <Compass size={40} className="text-gray-200" />
          <p className="text-sm font-semibold">Nothing here yet</p>
          <p className="text-xs">Our team will curate the best AI creations here.</p>
        </div>
      ) : (
        <>
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {items.map((item) => {
              const displayName = getDisplayName(item);
              const initial = displayName[0]?.toUpperCase() ?? '?';
              return (
                <div
                  key={item.discover_id}
                  className="mb-4 break-inside-avoid group cursor-pointer overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md"
                  onClick={() => setSelected(item)}
                >
                  {/* Image */}
                  <div className="relative overflow-hidden bg-gray-100">
                    <img
                      src={item.result_url}
                      alt={item.prompt}
                      loading="lazy"
                      className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>

                  {/* Meta */}
                  <div className="p-3 space-y-2">
                    {/* Creator */}
                    <div className="flex items-center gap-2">
                      {item.creator_avatar ? (
                        <img
                          src={item.creator_avatar}
                          alt={displayName}
                          className="h-7 w-7 rounded-full object-cover ring-2 ring-white"
                        />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-600 ring-2 ring-white">
                          {initial}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-gray-800">{displayName}</p>
                        {item.creator_username && item.creator_name && (
                          <p className="truncate text-[10px] text-gray-400">@{item.creator_username}</p>
                        )}
                      </div>
                    </div>

                    {/* Prompt */}
                    <p className="line-clamp-2 text-xs leading-relaxed text-gray-500">{item.prompt || '(no prompt)'}</p>

                    {/* Model + date */}
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                        {item.model}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(item.pushed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore ? (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <button
                type="button"
                onClick={() => fetchPage(items.length, true)}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            </div>
          ) : (
            <p className="text-center text-xs text-gray-400">{items.length} creation{items.length !== 1 ? 's' : ''} in the feed</p>
          )}
        </>
      )}

      {/* Lightbox */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-2xl w-full overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selected.result_url}
              alt={selected.prompt}
              className="w-full max-h-[60vh] object-contain bg-gray-50"
            />
            <div className="p-5 space-y-3">
              {/* Creator */}
              <div className="flex items-center gap-3">
                {selected.creator_avatar ? (
                  <img src={selected.creator_avatar} alt={getDisplayName(selected)} className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                    {getDisplayName(selected)[0]?.toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-bold text-gray-900">{getDisplayName(selected)}</p>
                  {selected.creator_username && selected.creator_name && (
                    <p className="text-xs text-gray-400">@{selected.creator_username}</p>
                  )}
                </div>
              </div>

              {/* Prompt */}
              <p className="text-sm text-gray-700 leading-relaxed">{selected.prompt || '(no prompt)'}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">{selected.model}</span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                  {new Date(selected.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
