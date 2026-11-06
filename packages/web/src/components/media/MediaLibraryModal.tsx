import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, CheckSquare, Copy, Loader2, Search, Square, Tag, Trash2,
  Upload, X, Image as ImageIcon, LayoutGrid, Info,
} from 'lucide-react';
import { MediaImage, mediaService } from '../../services/mediaService';
import { compressImage, formatBytes, formatDate } from '../../utils/imageCompression';

interface MediaLibraryModalProps {
  onSelect: (url: string) => void;
  onClose: () => void;
}

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml';
const MAX_FILE_MB = 10;

type View = 'grid' | 'upload';

export default function MediaLibraryModal({ onSelect, onClose }: MediaLibraryModalProps) {
  const [view, setView] = useState<View>('grid');
  const [images, setImages] = useState<MediaImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [selected, setSelected] = useState<MediaImage | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editAlt, setEditAlt] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [error, setError] = useState('');

  // Upload state
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dupDialog, setDupDialog] = useState<{ file: File; suggestedName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const imgs = await mediaService.list({ search: search || undefined, tag: activeTag || undefined });
      setImages(imgs);
    } catch {
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  }, [search, activeTag]);

  useEffect(() => { void load(); }, [load]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 400);
    return () => clearTimeout(t);
  }, [search, load]);

  const allTags = Array.from(new Set(images.flatMap((i) => i.tags ?? []))).slice(0, 20);

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
    setEditTags((img.tags ?? []).join(', '));
    setEditAlt(img.alt_text ?? '');
    setEditCaption(img.caption ?? '');
    setEditDescription(img.description ?? '');
  };

  const handleSaveDetails = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const tagsArr = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      const updated = await mediaService.update(selected.id, {
        file_name: editName,
        tags: tagsArr,
        alt_text: editAlt,
        caption: editCaption,
        description: editDescription,
      });
      setImages((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSelected(updated);
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this image?')) return;
    await mediaService.remove(id);
    setImages((prev) => prev.filter((i) => i.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(bulkSelected);
    if (!ids.length || !confirm(`Delete ${ids.length} image(s)?`)) return;
    await mediaService.bulkDelete(ids);
    setImages((prev) => prev.filter((i) => !bulkSelected.has(i.id)));
    setBulkSelected(new Set());
    setBulkMode(false);
    if (selected && bulkSelected.has(selected.id)) setSelected(null);
  };

  const copyUrl = () => {
    if (!selected) return;
    void navigator.clipboard.writeText(selected.url).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  };

  const addTag = async () => {
    if (!selected || !tagInput.trim()) return;
    const newTags = [...new Set([...(selected.tags ?? []), tagInput.trim()])];
    setSaving(true);
    try {
      const updated = await mediaService.update(selected.id, { tags: newTags });
      setImages((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSelected(updated);
      setEditTags(newTags.join(', '));
      setTagInput('');
    } catch {
      setError('Failed to add tag');
    } finally {
      setSaving(false);
    }
  };

  // ── Upload logic ──────────────────────────────────────────────────────────
  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const processUpload = useCallback(async (file: File, forceName?: string) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) { setError('Unsupported file type. Use PNG, JPG, WEBP or SVG.'); return; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { setError(`Image exceeds the maximum upload size of ${MAX_FILE_MB}MB.`); return; }
    setError('');
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
      setView('grid');
    } catch (err: any) {
      if (err?.isDuplicate) {
        clearTimer();
        setUploading(false);
        setUploadProgress(0);
        setDupDialog({ file, suggestedName: err.suggestedName });
        return;
      }
      setError(err instanceof Error ? err.message : 'Upload failed');
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
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <ImageIcon size={18} className="text-blue-600" />
            <h2 className="text-sm font-bold text-zinc-900">Media Library</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView(view === 'grid' ? 'upload' : 'grid')}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${view === 'upload' ? 'bg-blue-600 text-white' : 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
            >
              <Upload size={12} /> Upload New
            </button>
            <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100">
              <X size={15} />
            </button>
          </div>
        </div>

        {error && (
          <div className="shrink-0 bg-red-50 px-6 py-2 text-xs font-semibold text-red-600">
            {error} <button className="ml-2 underline" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {/* Upload view */}
        {view === 'upload' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10">
            <div
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`flex w-full max-w-lg cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed py-16 transition ${dragging ? 'border-blue-400 bg-blue-50' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'}`}
            >
              <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void processUpload(f); e.target.value = ''; }} />
              {uploading ? (
                <div className="flex flex-col items-center gap-3 w-64">
                  <Loader2 size={28} className="animate-spin text-blue-500" />
                  <div className="w-full h-2 rounded-full bg-zinc-200 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500 transition-all duration-100" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-xs text-zinc-500">Uploading… {uploadProgress}%</p>
                </div>
              ) : (
                <>
                  <Upload size={32} className="text-zinc-300" />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-zinc-700">Drop your image here or <span className="text-blue-600">browse</span></p>
                    <p className="mt-1 text-xs text-zinc-400">PNG, JPG, WEBP, SVG · Max {MAX_FILE_MB}MB</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Grid view */}
        {view === 'grid' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: grid */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
                <div className="relative flex-1 min-w-[160px]">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Search images…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 py-2 pl-8 pr-3 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${bulkMode ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                >
                  <LayoutGrid size={12} /> {bulkMode ? 'Exit Select' : 'Select'}
                </button>
                {bulkMode && bulkSelected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleBulkDelete()}
                    className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                  >
                    <Trash2 size={12} /> Delete ({bulkSelected.size})
                  </button>
                )}
              </div>

              {/* Tag filter pills */}
              {allTags.length > 0 && (
                <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setActiveTag('')}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${!activeTag ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                  >All</button>
                  {allTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setActiveTag(activeTag === t ? '' : t)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${activeTag === t ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                    >{t}</button>
                  ))}
                </div>
              )}

              {/* Image grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-zinc-300" />
                  </div>
                ) : images.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
                    <ImageIcon size={40} className="text-zinc-200" />
                    <p className="text-sm font-semibold">{search ? 'No images found' : 'No images yet'}</p>
                    <button
                      type="button"
                      onClick={() => setView('upload')}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >Upload your first image</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                    {images.map((img) => {
                      const isSel = selected?.id === img.id;
                      const isBulk = bulkSelected.has(img.id);
                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => selectImage(img)}
                          className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition ${
                            isSel ? 'border-blue-500 shadow-md' : isBulk ? 'border-blue-400' : 'border-transparent hover:border-zinc-300'
                          }`}
                        >
                          <img
                            src={img.thumbnail_url || img.url}
                            alt={img.file_name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          {/* Hover overlay */}
                          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition group-hover:opacity-100 p-2">
                            <p className="truncate text-[10px] font-semibold text-white">{img.file_name}</p>
                            <p className="text-[9px] text-white/70">{formatBytes(img.file_size)}</p>
                          </div>
                          {/* Bulk checkbox */}
                          {bulkMode && (
                            <div className="absolute right-1.5 top-1.5">
                              {isBulk
                                ? <CheckSquare size={16} className="text-blue-500 drop-shadow" />
                                : <Square size={16} className="text-white drop-shadow" />}
                            </div>
                          )}
                          {/* Selected tick */}
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
            </div>

            {/* Right: details panel */}
            {selected && !bulkMode && (
              <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-100 bg-zinc-50">
                <div className="shrink-0 border-b border-zinc-100 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Details</p>
                    <button type="button" onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
                  </div>
                  <div className="aspect-video w-full overflow-hidden rounded-xl bg-zinc-200">
                    <img src={selected.url} alt={selected.file_name} className="h-full w-full object-contain" />
                  </div>
                </div>

                <div className="flex-1 space-y-4 p-4 text-xs">
                  {/* Name */}
                  <div>
                    <label className="mb-1 block font-semibold text-zinc-500">File name</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {/* Meta */}
                  <div className="space-y-1.5 rounded-xl bg-white p-3 border border-zinc-200">
                    {selected.width && <div className="flex justify-between"><span className="text-zinc-500">Dimensions</span><span className="font-semibold text-zinc-800">{selected.width} × {selected.height}</span></div>}
                    <div className="flex justify-between"><span className="text-zinc-500">Size</span><span className="font-semibold text-zinc-800">{formatBytes(selected.file_size)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Type</span><span className="font-semibold text-zinc-800">{selected.file_type.split('/')[1]?.toUpperCase()}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Uploaded</span><span className="font-semibold text-zinc-800">{formatDate(selected.upload_date)}</span></div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="mb-1 flex items-center gap-1 font-semibold text-zinc-500"><Tag size={10} /> Tags</label>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {(selected.tags ?? []).map((t) => (
                        <span key={t} className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{t}</span>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        placeholder="Add tag…"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void addTag(); }}
                        className="flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <button type="button" onClick={() => void addTag()} className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-zinc-700">Add</button>
                    </div>
                  </div>

                  {/* SEO fields */}
                  <div className="space-y-3 rounded-xl bg-white p-3 border border-zinc-200">
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-500">Alt text</label>
                      <input
                        value={editAlt}
                        onChange={(e) => setEditAlt(e.target.value)}
                        placeholder="Describe the image for accessibility"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-500">Caption</label>
                      <input
                        value={editCaption}
                        onChange={(e) => setEditCaption(e.target.value)}
                        placeholder="Optional caption"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-zinc-500">Description</label>
                      <textarea
                        rows={3}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Optional description"
                        className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveDetails()}
                      disabled={saving}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 py-2 text-xs font-bold text-white hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={copyUrl}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                    >
                      {copyDone ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                      {copyDone ? 'Copied!' : 'Copy URL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(selected.id)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* No selection hint */}
            {!selected && !bulkMode && images.length > 0 && (
              <div className="hidden w-64 shrink-0 items-center justify-center border-l border-zinc-100 lg:flex">
                <div className="flex flex-col items-center gap-2 text-zinc-300">
                  <Info size={28} />
                  <p className="text-xs">Click an image for details</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-zinc-100 bg-white px-6 py-3">
          <p className="text-xs text-zinc-400">{images.length} image{images.length !== 1 ? 's' : ''}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => { if (selected) { onSelect(selected.url); onClose(); } }}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Select Image
            </button>
          </div>
        </div>
      </div>

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
