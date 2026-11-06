import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, HardDrive, Image as ImageIcon, Loader2, Search, Send, Star, StarOff,
  Trash2, Upload, Users, X, Wand2,
} from 'lucide-react';
import { AdminMediaStats, MediaImage, mediaService } from '../../services/mediaService';
import { compressImage, formatBytes, formatDate } from '../../utils/imageCompression';
import { API_BASE_URL } from '../../utils/apiBase';

type AIGeneration = {
  id: string;
  user_id: string;
  prompt: string;
  model: string;
  result_url: string;
  created_at: string;
  user_email: string | null;
  user_full_name: string | null;
  user_username: string | null;
  user_avatar: string | null;
  discover_id: string | null;
};

function GeneratedImagesTab() {
  const [generations, setGenerations] = useState<AIGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pushing, setPushing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token') ?? '';
      const r = await fetch(`${API_BASE_URL}/api/admin/magnific/generations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.success) setGenerations(data.generations ?? []);
      else setError(data.error ?? 'Failed to load');
    } catch {
      setError('Failed to load generations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pushToDiscover = async (gen: AIGeneration) => {
    setPushing(gen.id);
    try {
      const token = localStorage.getItem('auth_token') ?? '';
      const r = await fetch(`${API_BASE_URL}/api/admin/generations/${gen.id}/push-to-discover`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.success) {
        setGenerations((prev) => prev.map((g) => g.id === gen.id ? { ...g, discover_id: data.discover_id } : g));
        flash('Pushed to Discover');
      } else {
        setError(data.error ?? 'Failed to push');
      }
    } catch {
      setError('Failed to push to Discover');
    } finally {
      setPushing(null);
    }
  };

  const removeFromDiscover = async (gen: AIGeneration) => {
    if (!gen.discover_id) return;
    setRemoving(gen.id);
    try {
      const token = localStorage.getItem('auth_token') ?? '';
      const r = await fetch(`${API_BASE_URL}/api/admin/discover/${gen.discover_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.success) {
        setGenerations((prev) => prev.map((g) => g.id === gen.id ? { ...g, discover_id: null } : g));
        flash('Removed from Discover');
      } else {
        setError(data.error ?? 'Failed to remove');
      }
    } catch {
      setError('Failed to remove from Discover');
    } finally {
      setRemoving(null);
    }
  };

  const filtered = search.trim()
    ? generations.filter((g) =>
        g.prompt.toLowerCase().includes(search.toLowerCase()) ||
        (g.user_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (g.user_full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        g.model.toLowerCase().includes(search.toLowerCase())
      )
    : generations;

  return (
    <div className="space-y-4">
      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">
          {error} <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
          <Check size={14} /> {success}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search by prompt, user, or model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 size={24} className="animate-spin text-slate-300" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
          <Wand2 size={36} className="text-slate-200" />
          <p className="text-sm font-semibold">{search ? 'No results' : 'No AI-generated images yet'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((gen) => {
            const displayName = gen.user_full_name || gen.user_username || gen.user_email || 'Unknown user';
            const initial = displayName[0]?.toUpperCase() ?? '?';
            const inDiscover = !!gen.discover_id;
            return (
              <div key={gen.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Image */}
                <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                  <img
                    src={gen.result_url}
                    alt={gen.prompt}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {inDiscover && (
                    <div className="absolute top-2 right-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                      In Discover
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3 space-y-2">
                  {/* User */}
                  <div className="flex items-center gap-2">
                    {gen.user_avatar ? (
                      <img src={gen.user_avatar} alt={displayName} className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-600">
                        {initial}
                      </div>
                    )}
                    <span className="truncate text-xs font-semibold text-slate-700">{displayName}</span>
                  </div>

                  {/* Prompt */}
                  <p className="line-clamp-2 text-xs text-slate-500 leading-relaxed">{gen.prompt || '(no prompt)'}</p>

                  {/* Model + date */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{gen.model}</span>
                    <span>{new Date(gen.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>

                  {/* Action */}
                  {inDiscover ? (
                    <button
                      type="button"
                      disabled={removing === gen.id}
                      onClick={() => void removeFromDiscover(gen)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      {removing === gen.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                      Remove from Discover
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pushing === gen.id}
                      onClick={() => void pushToDiscover(gen)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 py-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {pushing === gen.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Push to Discover
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-slate-400 pt-1">
        {filtered.length} image{filtered.length !== 1 ? 's' : ''} · showing completed AI generations only
      </div>
    </div>
  );
}

export default function AdminMediaManagement() {
  type MediaTab = 'library' | 'generated';
  const [activeTab, setActiveTab] = useState<MediaTab>('library');

  const [images, setImages] = useState<MediaImage[]>([]);
  const [stats, setStats] = useState<AdminMediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [selected, setSelected] = useState<MediaImage | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [imgs, s] = await Promise.all([
        mediaService.adminList({ search: debouncedSearch || undefined }),
        mediaService.adminStats(),
      ]);
      setImages(imgs);
      setStats(s);
    } catch {
      setError('Failed to load media');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { if (activeTab === 'library') void load(); }, [load, activeTab]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await mediaService.adminDelete(id);
      setImages((prev) => prev.filter((i) => i.id !== id));
      if (selected?.id === id) setSelected(null);
      if (stats) setStats({ ...stats, total_images: stats.total_images - 1 });
      flash('Image deleted');
    } catch {
      setError('Failed to delete image');
    }
  };

  const handleToggleCategory = async (img: MediaImage) => {
    const next = img.category === 'admin' ? 'user' : 'admin';
    try {
      const updated = await mediaService.adminSetCategory(img.id, next);
      setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, category: updated.category } : i)));
      if (selected?.id === img.id) setSelected((s) => s ? { ...s, category: updated.category } : s);
      flash(next === 'admin' ? 'Marked as Admin Asset' : 'Moved to user media');
    } catch {
      setError('Failed to update category');
    }
  };

  const handleUploadFile = async (file: File) => {
    const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!ACCEPTED.includes(file.type)) { setError('Unsupported file type. Use PNG, JPG, WEBP, or SVG.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Image exceeds 10MB limit.'); return; }
    setUploading(true);
    setUploadProgress(0);
    let prog = 0;
    const timer = setInterval(() => {
      prog += Math.random() * 18 + 8;
      if (prog >= 85) { prog = 85; clearInterval(timer); }
      setUploadProgress(Math.round(prog));
    }, 60);
    try {
      const compressed = await compressImage(file);
      clearInterval(timer);
      setUploadProgress(100);
      const img = await mediaService.upload({
        url: compressed.url,
        thumbnail_url: compressed.thumbnail_url,
        file_name: file.name,
        original_name: file.name,
        file_size: compressed.file_size,
        file_type: compressed.file_type,
        width: compressed.width,
        height: compressed.height,
        category: 'admin',
      });
      setImages((prev) => [img, ...prev]);
      if (stats) setStats({ ...stats, total_images: stats.total_images + 1 });
      flash('Uploaded as Admin Asset');
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      clearInterval(timer);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const filteredImages = categoryFilter === 'all'
    ? images
    : images.filter((i) => (i.category ?? 'user') === categoryFilter);

  const fmtStorage = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900">Media</h2>
          <p className="mt-1 text-sm text-slate-500">Manage uploaded files and AI-generated images.</p>
        </div>
        {activeTab === 'library' && (
          <div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadFile(f); e.target.value = ''; }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? `Uploading ${uploadProgress}%` : 'Upload Admin Asset'}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {([
          { id: 'library', label: 'Media Library', icon: ImageIcon },
          { id: 'generated', label: 'Generated Images', icon: Wand2 },
        ] as { id: MediaTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'generated' ? (
        <GeneratedImagesTab />
      ) : (
        <>
          {/* Alerts */}
          {error && (
            <div className="flex items-center justify-between rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">
              {error} <button onClick={() => setError('')}><X size={14} /></button>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
              <Check size={14} /> {success}
            </div>
          )}

          {/* Stats cards */}
          {stats && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100">
                  <ImageIcon size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500">Total Images</p>
                  <p className="text-2xl font-black text-slate-900">{Number(stats.total_images).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-100">
                  <HardDrive size={20} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500">Storage Used</p>
                  <p className="text-2xl font-black text-slate-900">{fmtStorage(Number(stats.total_size))}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                  <Users size={20} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500">Users with Media</p>
                  <p className="text-2xl font-black text-slate-900">{Number(stats.users_count).toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Main panel */}
          <div className="flex gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white" style={{ minHeight: 520 }}>
            {/* List */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Search + filter */}
              <div className="shrink-0 border-b border-slate-100 p-4 space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by filename or username…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div className="flex gap-2">
                  {(['all', 'admin', 'user'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryFilter(c)}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                        categoryFilter === c
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {c === 'all' ? 'All' : c === 'admin' ? '★ Admin Assets' : 'User Uploads'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex h-64 items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-slate-300" />
                  </div>
                ) : filteredImages.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
                    <ImageIcon size={36} className="text-slate-200" />
                    <p className="text-sm font-semibold">{debouncedSearch ? 'No results found' : 'No images yet'}</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Image</th>
                        <th className="px-4 py-3 text-left">File Name</th>
                        <th className="px-4 py-3 text-left">User</th>
                        <th className="px-4 py-3 text-left">Size</th>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredImages.map((img) => (
                        <tr
                          key={img.id}
                          onClick={() => setSelected(selected?.id === img.id ? null : img)}
                          className={`cursor-pointer transition hover:bg-slate-50 ${selected?.id === img.id ? 'bg-blue-50/60' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="relative h-10 w-10 overflow-hidden rounded-lg bg-slate-100">
                              <img
                                src={img.thumbnail_url || img.url}
                                alt={img.file_name}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                              {img.category === 'admin' && (
                                <div className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-400 p-0.5">
                                  <Star size={8} className="fill-white text-white" />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="max-w-[180px] px-4 py-3">
                            <p className="truncate font-medium text-slate-800">{img.file_name}</p>
                            <p className="text-xs text-slate-400">{img.file_type.split('/')[1]?.toUpperCase()}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-700">{img.username ?? '—'}</p>
                            <p className="text-xs text-slate-400">{img.user_email ?? ''}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatBytes(img.file_size)}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(img.upload_date)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                title={img.category === 'admin' ? 'Remove from Admin Assets' : 'Mark as Admin Asset'}
                                onClick={(e) => { e.stopPropagation(); void handleToggleCategory(img); }}
                                className={`rounded-lg p-1.5 transition ${
                                  img.category === 'admin'
                                    ? 'text-amber-500 hover:bg-amber-50'
                                    : 'text-slate-400 hover:bg-amber-50 hover:text-amber-500'
                                }`}
                              >
                                {img.category === 'admin' ? <Star size={14} className="fill-amber-400" /> : <StarOff size={14} />}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleDelete(img.id, img.file_name); }}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="shrink-0 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
                {filteredImages.length} image{filteredImages.length !== 1 ? 's' : ''}
                {categoryFilter !== 'all' && <span className="ml-1 text-slate-300">({categoryFilter === 'admin' ? 'admin assets' : 'user uploads'})</span>}
              </div>
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-100">
                <div className="shrink-0 border-b border-slate-100 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Preview</p>
                    <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                  </div>
                  <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-100">
                    <img src={selected.url} alt={selected.file_name} className="h-full w-full object-contain" />
                  </div>
                </div>
                <div className="flex-1 space-y-3 p-4 text-xs">
                  <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
                    <div className="flex justify-between"><span className="text-slate-500">File</span><span className="max-w-[140px] truncate text-right font-semibold text-slate-800">{selected.file_name}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">User</span><span className="font-semibold text-slate-800">{selected.username ?? '—'}</span></div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Category</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selected.category === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                        {selected.category === 'admin' ? '★ Admin Asset' : 'User'}
                      </span>
                    </div>
                    {selected.width && <div className="flex justify-between"><span className="text-slate-500">Dimensions</span><span className="font-semibold text-slate-800">{selected.width} × {selected.height}px</span></div>}
                    <div className="flex justify-between"><span className="text-slate-500">Size</span><span className="font-semibold text-slate-800">{formatBytes(selected.file_size)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Type</span><span className="font-semibold text-slate-800">{selected.file_type.split('/')[1]?.toUpperCase()}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Date</span><span className="font-semibold text-slate-800">{formatDate(selected.upload_date)}</span></div>
                  </div>

                  <button
                    onClick={() => void handleToggleCategory(selected)}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition ${
                      selected.category === 'admin'
                        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {selected.category === 'admin' ? <><StarOff size={13} /> Remove from Admin Assets</> : <><Star size={13} /> Mark as Admin Asset</>}
                  </button>

                  <button
                    onClick={() => void handleDelete(selected.id, selected.file_name)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-xs font-bold text-red-600 hover:bg-red-100"
                  >
                    <Trash2 size={13} /> Delete Image
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
