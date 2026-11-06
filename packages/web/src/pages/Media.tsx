import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, CheckSquare, Copy, Download, Loader2, Search,
  Square, Tag, Trash2, Upload, X, Image as ImageIcon, Info,
} from 'lucide-react';
import { MediaImage, mediaService } from '../services/mediaService';
import { compressImage, formatBytes, formatDate } from '../utils/imageCompression';

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml';
const MAX_MB = 10;

type View = 'grid' | 'upload';

export default function Media() {
  const [view, setView] = useState<View>('grid');
  const [images, setImages] = useState<MediaImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [selected, setSelected] = useState<MediaImage | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Upload state
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [dupDialog, setDupDialog] = useState<{ file: File; suggestedName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialSyncDoneRef = useRef(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const imgs = await mediaService.list({
        search: debouncedSearch || undefined,
        tag: activeTag || undefined,
      });
      setImages(imgs);
    } catch {
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, activeTag]);

  useEffect(() => { void load(); }, [load]);

  // Sync any featured images from posts that aren't yet in media library
  useEffect(() => {
    if (initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;
    const syncImages = async () => {
      try {
        const data = await mediaService.syncAll();
        if (data.synced > 0) {
          // Reload media list after sync
          void load();
        }
      } catch (err) {
        // Silent sync, don't interrupt user experience
        console.debug('Image sync check completed');
      }
    };
    void syncImages();
  }, [load]);

  const allTags = Array.from(new Set(images.flatMap((i) => i.tags ?? []))).slice(0, 30);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const selectImage = (img: MediaImage) => {
    if (bulkMode) {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        next.has(img.id) ? next.delete(img.id) : next.add(img.id);
        return next;
      });
      return;
    }
    setSelected(img);
    setEditName(img.file_name);
  };

  const handleSaveName = async () => {
    if (!selected || !editName.trim()) return;
    setSaving(true);
    try {
      const updated = await mediaService.update(selected.id, { file_name: editName.trim() });
      setImages((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSelected(updated);
      flash('Name saved');
    } catch { setError('Failed to save name'); }
    finally { setSaving(false); }
  };

  const addTag = async () => {
    if (!selected || !tagInput.trim()) return;
    const newTags = [...new Set([...(selected.tags ?? []), tagInput.trim()])];
    setSaving(true);
    try {
      const updated = await mediaService.update(selected.id, { tags: newTags });
      setImages((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSelected(updated);
      setTagInput('');
      flash('Tag added');
    } catch { setError('Failed to add tag'); }
    finally { setSaving(false); }
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    const newTags = (selected.tags ?? []).filter((t) => t !== tag);
    try {
      const updated = await mediaService.update(selected.id, { tags: newTags });
      setImages((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSelected(updated);
    } catch { setError('Failed to remove tag'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    await mediaService.remove(id);
    setImages((prev) => prev.filter((i) => i.id !== id));
    if (selected?.id === id) setSelected(null);
    flash('Image deleted');
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(bulkSelected);
    if (!ids.length || !confirm(`Delete ${ids.length} image(s)? This cannot be undone.`)) return;
    await mediaService.bulkDelete(ids);
    setImages((prev) => prev.filter((i) => !bulkSelected.has(i.id)));
    if (selected && bulkSelected.has(selected.id)) setSelected(null);
    setBulkSelected(new Set());
    setBulkMode(false);
    flash(`${ids.length} image(s) deleted`);
  };

  const copyUrl = () => {
    if (!selected) return;
    void navigator.clipboard.writeText(selected.url).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  };

  const downloadImage = () => {
    if (!selected) return;
    const a = document.createElement('a');
    a.href = selected.url;
    a.download = selected.file_name;
    a.click();
  };

  // Upload
  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const processUpload = useCallback(async (file: File, forceName?: string) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) { setUploadError('Unsupported type. Use PNG, JPG, WEBP, or SVG.'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setUploadError(`Image exceeds the maximum upload size of ${MAX_MB}MB.`); return; }
    setUploadError('');
    setUploading(true);
    setUploadProgress(0);
    let prog = 0;
    timerRef.current = setInterval(() => {
      prog += Math.random() * 15 + 5;
      if (prog >= 85) { prog = 85; clearTimer(); }
      setUploadProgress(Math.round(prog));
    }, 60);
    try {
      const compressed = await compressImage(file);
      clearTimer();
      setUploadProgress(95);
      const nameToUse = forceName || file.name;
      const saved = await mediaService.upload({
        url: compressed.url,
        thumbnail_url: compressed.thumbnail_url,
        file_name: nameToUse,
        original_name: nameToUse,
        file_size: compressed.file_size,
        file_type: compressed.file_type,
        width: compressed.width,
        height: compressed.height,
        force: !!forceName,
      });
      setUploadProgress(100);
      setImages((prev) => [saved, ...prev]);
      setSelected(saved);
      setEditName(saved.file_name);
      setView('grid');
      flash('Image uploaded successfully');
    } catch (err: any) {
      if (err?.isDuplicate) {
        clearTimer();
        setUploading(false);
        setUploadProgress(0);
        setDupDialog({ file, suggestedName: err.suggestedName });
        return;
      }
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      clearTimer();
      setUploading(false);
      setUploadProgress(0);
    }
  }, []);

  const handleDupProceed = useCallback(async () => {
    if (!dupDialog) return;
    const { file, suggestedName } = dupDialog;
    setDupDialog(null);
    await processUpload(file, suggestedName);
  }, [dupDialog, processUpload]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void processUpload(file);
  };

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Media Library</h1>
          <p className="mt-0.5 text-sm text-slate-500">Upload and manage all your images in one place.</p>
        </div>
        <button
          type="button"
          onClick={() => setView(view === 'upload' ? 'grid' : 'upload')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${view === 'upload' ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        >
          <Upload size={16} />
          {view === 'upload' ? 'Back to Library' : 'Upload Image'}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">
          {error}
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
          <Check size={14} /> {success}
        </div>
      )}

      {/* Upload panel */}
      {view === 'upload' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <h2 className="mb-6 text-base font-bold text-slate-800">Upload New Image</h2>
          <div
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40'}`}
          >
            <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void processUpload(f); e.target.value = ''; }} />
            {uploading ? (
              <div className="flex flex-col items-center gap-4 w-72">
                <Loader2 size={32} className="animate-spin text-blue-500" />
                <div className="w-full space-y-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-blue-500 transition-all duration-100" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-center text-xs text-slate-500">Processing… {uploadProgress}%</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                  <Upload size={28} className="text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-slate-700">Drop your image here or <span className="text-blue-600">click to browse</span></p>
                  <p className="mt-1 text-sm text-slate-400">PNG, JPG, WEBP, SVG · Max {MAX_MB}MB per image</p>
                </div>
              </>
            )}
          </div>
          {uploadError && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{uploadError}</p>
          )}
        </div>
      )}

      {/* Grid view */}
      {view === 'grid' && (
        <div className="flex flex-1 gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white min-h-[500px]">
          {/* Left: grid */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 p-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name or tag…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="button"
                onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); if (bulkMode) setSelected(null); }}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition ${bulkMode ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <Square size={14} /> {bulkMode ? 'Exit Select' : 'Select'}
              </button>
              {bulkMode && bulkSelected.size > 0 && (
                <button
                  type="button"
                  onClick={() => void handleBulkDelete()}
                  className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
                >
                  <Trash2 size={14} /> Delete ({bulkSelected.size})
                </button>
              )}
            </div>

            {/* Tag pills */}
            {allTags.length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
                <button onClick={() => setActiveTag('')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!activeTag ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All</button>
                {allTags.map((t) => (
                  <button key={t} onClick={() => setActiveTag(activeTag === t ? '' : t)}
                    className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${activeTag === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    <Tag size={10} /> {t}
                  </button>
                ))}
              </div>
            )}

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 size={28} className="animate-spin text-slate-300" />
                </div>
              ) : images.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
                  <ImageIcon size={44} className="text-slate-200" />
                  <p className="font-semibold">{debouncedSearch || activeTag ? 'No images found' : 'No images yet'}</p>
                  {!debouncedSearch && !activeTag && (
                    <button onClick={() => setView('upload')}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                      Upload your first image
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {images.map((img) => {
                    const isSel = selected?.id === img.id;
                    const isBulk = bulkSelected.has(img.id);
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => selectImage(img)}
                        className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition ${isSel ? 'border-blue-500 shadow-md' : isBulk ? 'border-blue-400' : 'border-transparent hover:border-slate-300'}`}
                      >
                        <img
                          src={img.thumbnail_url || img.url}
                          alt={img.file_name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition group-hover:opacity-100 p-2">
                          <p className="truncate text-[10px] font-semibold text-white leading-tight">{img.file_name}</p>
                          <p className="text-[9px] text-white/70">{formatBytes(img.file_size)}</p>
                        </div>
                        {bulkMode && (
                          <div className="absolute right-1.5 top-1.5">
                            {isBulk ? <CheckSquare size={16} className="text-blue-500 drop-shadow" /> : <Square size={16} className="text-white drop-shadow" />}
                          </div>
                        )}
                        {isSel && !bulkMode && (
                          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                            <Check size={11} className="text-white" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom count */}
            <div className="shrink-0 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
              {images.length} image{images.length !== 1 ? 's' : ''}
              {bulkSelected.size > 0 && ` · ${bulkSelected.size} selected`}
            </div>
          </div>

          {/* Right: details panel */}
          {selected && !bulkMode ? (
            <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-100">
              {/* Preview */}
              <div className="shrink-0 border-b border-slate-100 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Details</p>
                  <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                </div>
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-100">
                  <img src={selected.url} alt={selected.file_name} className="h-full w-full object-contain" />
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                {/* File name */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">File name</label>
                  <div className="flex gap-1.5">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveName(); }}
                      className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <button onClick={() => void handleSaveName()} disabled={saving}
                      className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-slate-700 disabled:opacity-50">
                      {saving ? '…' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Meta */}
                <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
                  {selected.width && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Dimensions</span>
                      <span className="font-semibold text-slate-800">{selected.width} × {selected.height}px</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">File size</span>
                    <span className="font-semibold text-slate-800">{formatBytes(selected.file_size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Type</span>
                    <span className="font-semibold text-slate-800">{selected.file_type.split('/')[1]?.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Uploaded</span>
                    <span className="font-semibold text-slate-800">{formatDate(selected.upload_date)}</span>
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500">
                    <Tag size={10} /> Tags
                  </label>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {(selected.tags ?? []).map((t) => (
                      <span key={t} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                        {t}
                        <button onClick={() => void removeTag(t)} className="text-blue-400 hover:text-blue-700"><X size={9} /></button>
                      </span>
                    ))}
                    {(selected.tags ?? []).length === 0 && <p className="text-xs text-slate-400">No tags yet</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      placeholder="logo, banner, profile…"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addTag(); }}
                      className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <button onClick={() => void addTag()}
                      className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-slate-700">Add</button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-1">
                  <button onClick={copyUrl}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    {copyDone ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                    {copyDone ? 'Copied!' : 'Copy URL'}
                  </button>
                  <button onClick={downloadImage}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <Download size={13} /> Download
                  </button>
                  <button onClick={() => void handleDelete(selected.id)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-600 hover:bg-red-100">
                    <Trash2 size={13} /> Delete Image
                  </button>
                </div>
              </div>
            </div>
          ) : (
            !bulkMode && (
              <div className="hidden w-64 shrink-0 items-center justify-center border-l border-slate-100 lg:flex">
                <div className="flex flex-col items-center gap-2 text-slate-300">
                  <Info size={32} />
                  <p className="text-xs font-medium">Click an image to view details</p>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {dupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Image already exists</h3>
            <p className="mt-2 text-sm text-slate-600">
              An image named <span className="font-semibold">"{dupDialog.suggestedName.replace(/\(\d+\)/, '').trim()}"</span> already exists.
              Saving as <span className="font-semibold">"{dupDialog.suggestedName}"</span> instead.
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDupDialog(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={handleDupProceed}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
