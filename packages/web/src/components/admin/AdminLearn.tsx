import {
  BookOpen,
  Calendar,
  ExternalLink,
  Filter,
  Lightbulb,
  Loader2,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../../utils/apiBase';

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

type LearnedItem = {
  id: string;
  title: string;
  url: string;
  source_type: 'article' | 'video';
  summary: string;
  key_points: string[];
  saas_application: string;
  category: string;
  labels: string[];
  created_at: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  'Content Strategy': 'bg-violet-100 text-violet-700',
  'Audience Growth': 'bg-green-100 text-green-700',
  'Platform Algorithms': 'bg-blue-100 text-blue-700',
  'Brand Voice': 'bg-pink-100 text-pink-700',
  Analytics: 'bg-amber-100 text-amber-700',
  Engagement: 'bg-orange-100 text-orange-700',
  Copywriting: 'bg-rose-100 text-rose-700',
  'Visual Design': 'bg-teal-100 text-teal-700',
  Scheduling: 'bg-cyan-100 text-cyan-700',
  General: 'bg-slate-100 text-slate-600',
};

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? 'bg-slate-100 text-slate-600';
}

export default function AdminLearn() {
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterLabel, setFilterLabel] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Meta (for dropdowns)
  const [categories, setCategories] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);

  // Add URL modal
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addCategory, setAddCategory] = useState('');
  const [addLabels, setAddLabels] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Compile state
  const [compiling, setCompiling] = useState<string | null>(null);
  const [compileSuccess, setCompileSuccess] = useState<string | null>(null);

  // Detail modal
  const [detailItem, setDetailItem] = useState<LearnedItem | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async (item: LearnedItem) => {
    setAnalyzing(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/learn/${item.id}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Analysis failed');
      setDetailItem(d.item);
      setItems((prev) => prev.map((i) => i.id === d.item.id ? d.item : i));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMeta = async () => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/learn/meta`, { headers: { Authorization: `Bearer ${tok()}` } });
      const d = await r.json();
      if (d.success) { setCategories(d.categories); setLabels(d.labels); }
    } catch { /* non-fatal */ }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCategory) params.set('category', filterCategory);
      if (filterLabel) params.set('label', filterLabel);
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);
      const r = await fetch(`${getApiBaseUrl()}/api/learn?${params}`, { headers: { Authorization: `Bearer ${tok()}` } });
      const d = await r.json();
      if (d.success) setItems(d.items);
      else setError(d.error || 'Failed to load');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void fetchMeta(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void load(); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, filterCategory, filterLabel, filterFrom, filterTo]);

  const handleAdd = async () => {
    if (!addUrl.trim()) { setAddError('URL is required'); return; }
    setAdding(true);
    setAddError('');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({
          url: addUrl.trim(),
          category: addCategory.trim() || undefined,
          labels: addLabels ? addLabels.split(',').map((l) => l.trim()).filter(Boolean) : undefined,
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed');
      setShowAdd(false);
      setAddUrl('');
      setAddCategory('');
      setAddLabels('');
      void fetchMeta();
      void load();
    } catch (e: any) { setAddError(e.message); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this learned item?')) return;
    try {
      await fetch(`${getApiBaseUrl()}/api/learn/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok()}` } });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { /* ignore */ }
  };

  const handleCompile = async (category: string) => {
    setCompiling(category);
    setCompileSuccess(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/learn/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ category }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Compile failed');
      setCompileSuccess(`"${d.skillName}" skill updated — ${d.itemCount} item(s) compiled.`);
    } catch (e: any) { setCompileSuccess(`Error: ${e.message}`); }
    finally { setCompiling(null); }
  };

  // Group items by category for the compile section
  const categoryCounts: Record<string, number> = {};
  for (const item of items) {
    categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen size={20} className="text-violet-600" />
            <h2 className="text-xl font-black tracking-tight text-slate-950">Daky Learn</h2>
          </div>
          <p className="text-sm text-slate-500">
            Add articles and videos. Daky extracts key marketing insights, organises them by category, and compiles them into skills that power every response.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
        >
          <Plus size={15} />
          Add URL
        </button>
      </div>

      {/* Compile skills panel */}
      {Object.keys(categoryCounts).length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-violet-600" />
            <span className="text-sm font-bold text-violet-900">Compile to Skills</span>
            <span className="text-xs text-violet-600">— select a category to build a Daky skill from its learnings</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(categoryCounts).map(([cat, count]) => (
              <button
                key={cat}
                type="button"
                onClick={() => void handleCompile(cat)}
                disabled={compiling === cat}
                className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-60"
              >
                {compiling === cat ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {cat}
                <span className="ml-0.5 rounded-full bg-violet-100 px-1.5 text-violet-600">{count}</span>
              </button>
            ))}
          </div>
          {compileSuccess && (
            <p className={`mt-2 text-xs font-medium ${compileSuccess.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
              {compileSuccess}
            </p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filterLabel}
            onChange={(e) => setFilterLabel(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            <option value="">All labels</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <div className="flex gap-2">
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>
        {(search || filterCategory || filterLabel || filterFrom || filterTo) && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFilterCategory(''); setFilterLabel(''); setFilterFrom(''); setFilterTo(''); }}
            className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
          >
            <X size={11} /> Clear filters
          </button>
        )}
      </div>

      {/* Item list */}
      {error && <p className="text-sm text-red-600 rounded-xl bg-red-50 border border-red-200 px-4 py-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-violet-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <BookOpen size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">No learned items yet</p>
          <p className="text-xs text-slate-400 mt-1">Add an article or video URL and Daky will extract marketing insights automatically.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-start gap-4 px-5 py-4">
                  <div className="mt-0.5 shrink-0 rounded-lg bg-slate-100 p-2">
                    {item.source_type === 'video' ? <Video size={14} className="text-slate-600" /> : <BookOpen size={14} className="text-slate-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${categoryColor(item.category)}`}>{item.category}</span>
                      {item.labels.map((l) => (
                        <span key={l} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          <Tag size={9} />{l}
                        </span>
                      ))}
                      <span className="flex items-center gap-1 text-xs text-slate-400 ml-auto">
                        <Calendar size={10} />
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 leading-snug">{item.title}</p>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-violet-600 hover:underline mt-0.5 truncate max-w-[400px]"
                    >
                      <ExternalLink size={10} />
                      {item.url}
                    </a>
                    {item.summary && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{item.summary}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-50 transition-colors"
                    >
                      View details
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
          ))}
        </div>
      )}

      {/* Add URL modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-violet-600" />
                <span className="font-bold text-slate-900">Add Learning</span>
              </div>
              <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-500">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Article or Video URL *</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  autoFocus
                />
                <p className="mt-1 text-xs text-slate-400">YouTube videos, blog posts, LinkedIn articles — any public URL.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category <span className="text-slate-400">(optional — AI will suggest one)</span></label>
                <select
                  value={addCategory}
                  onChange={(e) => setAddCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="">Let AI decide</option>
                  {['Content Strategy', 'Audience Growth', 'Platform Algorithms', 'Brand Voice', 'Analytics', 'Engagement', 'Copywriting', 'Visual Design', 'Scheduling', 'General'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Labels <span className="text-slate-400">(comma-separated, optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. instagram, reels, hooks"
                  value={addLabels}
                  onChange={(e) => setAddLabels(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              {addError && <p className="text-xs text-red-600 rounded-lg bg-red-50 border border-red-100 px-3 py-2">{addError}</p>}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={adding || !addUrl.trim()}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition-colors disabled:opacity-60"
              >
                {adding ? <><Loader2 size={14} className="animate-spin" /> Analysing…</> : <><Sparkles size={14} /> Add & Learn</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setDetailItem(null)}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 rounded-lg bg-slate-100 p-2">
                  {detailItem.source_type === 'video' ? <Video size={15} className="text-slate-600" /> : <BookOpen size={15} className="text-slate-600" />}
                </div>
                <div className="min-w-0">
                  <p className="font-black text-slate-900 leading-snug">{detailItem.title}</p>
                  <a
                    href={detailItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-violet-600 hover:underline mt-0.5 truncate"
                  >
                    <ExternalLink size={10} />
                    {detailItem.url}
                  </a>
                </div>
              </div>
              <button type="button" onClick={() => setDetailItem(null)} className="shrink-0 rounded-lg p-1.5 hover:bg-slate-100 text-slate-500">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Meta */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${categoryColor(detailItem.category)}`}>{detailItem.category}</span>
                {detailItem.labels.map((l) => (
                  <span key={l} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    <Tag size={9} />{l}
                  </span>
                ))}
                <span className="flex items-center gap-1 text-xs text-slate-400 ml-auto">
                  <Calendar size={10} />
                  {new Date(detailItem.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>

              {/* What it's about */}
              {detailItem.summary && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen size={13} className="text-slate-500" />
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">What it's about</p>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{detailItem.summary}</p>
                </div>
              )}

              {/* What was learned */}
              {detailItem.key_points.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb size={13} className="text-violet-600" />
                    <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">What was learned</p>
                  </div>
                  <ul className="space-y-2">
                    {detailItem.key_points.map((pt, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-violet-900">
                        <span className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-violet-200 text-[10px] font-bold text-violet-700">{i + 1}</span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* How it helps your SaaS */}
              {detailItem.saas_application ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Rocket size={13} className="text-emerald-600" />
                      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">How this helps your SaaS</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAnalyze(detailItem)}
                      disabled={analyzing}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                    >
                      {analyzing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      {analyzing ? 'Analysing…' : 'Refresh'}
                    </button>
                  </div>
                  <p className="text-sm text-emerald-900 leading-relaxed">{detailItem.saas_application}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Rocket size={13} className="text-slate-400" />
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">How this helps your SaaS</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">Deep insight not yet generated for this item.</p>
                  <button
                    type="button"
                    onClick={() => void handleAnalyze(detailItem)}
                    disabled={analyzing}
                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 transition-colors disabled:opacity-60"
                  >
                    {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {analyzing ? 'Analysing content…' : 'Generate insights with AI'}
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
