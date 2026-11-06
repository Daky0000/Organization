import { useCallback, useEffect, useRef, useState } from 'react';
import { Bold, Check, Loader2, Plus, Trash2, Type, X } from 'lucide-react';
import { designService } from '../../services/designService';

// ─────────────────────────────────────────────────────────────────────────────
// "Edit element" — soft builder that turns a Discover image into an editable
// design. Text-only for now: add/drag/edit text layers over the image, then
// Save composites everything onto a canvas and stores it as a user design
// (layers kept in canvas_data so the design stays re-editable later).
//
// The image must be same-origin (or a blob:) URL — remote gallery images are
// fetched through /api/mcp/media/:id/image to avoid tainting the canvas.
// ─────────────────────────────────────────────────────────────────────────────

export type TextLayer = {
  id: string;
  text: string;
  xPct: number;      // top-left position, % of image box
  yPct: number;
  sizePct: number;   // font size as % of image display width
  color: string;
  bold: boolean;
  fontFamily?: string; // key into FONT_FAMILIES
};

export const FONT_FAMILIES: Record<string, { label: string; css: string }> = {
  'sans-serif': { label: 'Sans — Inter',    css: 'Inter, Arial, sans-serif' },
  serif:        { label: 'Serif — Georgia', css: 'Georgia, "Times New Roman", serif' },
  display:      { label: 'Display — Impact',css: 'Impact, "Arial Black", sans-serif' },
  script:       { label: 'Script',          css: '"Brush Script MT", "Segoe Script", cursive' },
  monospace:    { label: 'Mono — Courier',  css: '"Courier New", monospace' },
};

function fontCss(layer: TextLayer): string {
  return FONT_FAMILIES[layer.fontFamily ?? 'sans-serif']?.css ?? FONT_FAMILIES['sans-serif'].css;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export default function ImageTextEditor({
  imageUrl,
  fetchWithAuth,
  designName,
  initialLayers,
  onClose,
  onSaved,
}: {
  imageUrl: string;
  // When set, the image is fetched with auth headers and rendered from a blob
  // (required for the /api/mcp proxy). Plain URLs are used directly.
  fetchWithAuth?: boolean;
  designName: string;
  initialLayers?: TextLayer[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(fetchWithAuth ? null : imageUrl);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layers, setLayers] = useState<TextLayer[]>(initialLayers ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialLayers?.[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!fetchWithAuth) return;
    let revoke: string | null = null;
    const tok = localStorage.getItem('auth_token') ?? '';
    fetch(imageUrl, { headers: { Authorization: `Bearer ${tok}` } })
      .then((r) => { if (!r.ok) throw new Error('Image unavailable'); return r.blob(); })
      .then((b) => { revoke = URL.createObjectURL(b); setBlobUrl(revoke); })
      .catch(() => setLoadError('Could not load the image for editing.'));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [imageUrl, fetchWithAuth]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  const addLayer = () => {
    const layer: TextLayer = { id: uid(), text: 'Your text here', xPct: 30, yPct: 42, sizePct: 6, color: '#ffffff', bold: true, fontFamily: 'sans-serif' };
    setLayers((prev) => [...prev, layer]);
    setSelectedId(layer.id);
  };

  const updateSelected = (patch: Partial<TextLayer>) => {
    if (!selectedId) return;
    setLayers((prev) => prev.map((l) => (l.id === selectedId ? { ...l, ...patch } : l)));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setLayers((prev) => prev.filter((l) => l.id !== selectedId));
    setSelectedId(null);
  };

  const onLayerPointerDown = (e: React.PointerEvent, layer: TextLayer) => {
    e.stopPropagation();
    setSelectedId(layer.id);
    dragRef.current = { id: layer.id, startX: e.clientX, startY: e.clientY, origX: layer.xPct, origY: layer.yPct };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = boxRef.current;
    if (!drag || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / rect.width) * 100;
    const dy = ((e.clientY - drag.startY) / rect.height) * 100;
    setLayers((prev) => prev.map((l) => (l.id === drag.id
      ? { ...l, xPct: Math.min(96, Math.max(0, drag.origX + dx)), yPct: Math.min(96, Math.max(0, drag.origY + dy)) }
      : l)));
  };

  const onPointerUp = () => { dragRef.current = null; };

  const save = useCallback(async () => {
    if (!blobUrl || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image failed to load'));
        img.src = blobUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.drawImage(img, 0, 0);
      for (const layer of layers) {
        const fontPx = Math.max(8, (layer.sizePct / 100) * canvas.width);
        ctx.font = `${layer.bold ? '700' : '400'} ${fontPx}px ${fontCss(layer)}`;
        ctx.fillStyle = layer.color;
        ctx.textBaseline = 'top';
        const x = (layer.xPct / 100) * canvas.width;
        let y = (layer.yPct / 100) * canvas.height;
        for (const line of layer.text.split('\n')) {
          ctx.fillText(line, x, y);
          y += fontPx * 1.25;
        }
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      await designService.create({
        name: designName,
        canvas_width: canvas.width,
        canvas_height: canvas.height,
        canvas_data: { type: 'image_text_overlay', source_image: imageUrl, layers },
        thumbnail_url: dataUrl,
      });
      setSaved(true);
      onSaved?.();
      setTimeout(onClose, 900);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [blobUrl, layers, designName, imageUrl, onSaved, onClose, saving]);

  return (
    <div className="fixed inset-0 z-[60] flex bg-black/90 backdrop-blur-xl">
      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 overflow-hidden" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {loadError ? (
          <p className="text-sm text-red-400">{loadError}</p>
        ) : !blobUrl ? (
          <Loader2 size={24} className="animate-spin text-white/40" />
        ) : (
          <div ref={boxRef} className="relative max-h-full max-w-full select-none" onPointerDown={() => setSelectedId(null)}>
            <img src={blobUrl} alt="" draggable={false} className="max-h-[82vh] max-w-full rounded-xl shadow-2xl" />
            {layers.map((layer) => (
              <div
                key={layer.id}
                onPointerDown={(e) => onLayerPointerDown(e, layer)}
                className={`absolute cursor-move whitespace-pre leading-tight ${selectedId === layer.id ? 'ring-2 ring-indigo-400 ring-offset-1 ring-offset-transparent' : ''}`}
                style={{
                  left: `${layer.xPct}%`,
                  top: `${layer.yPct}%`,
                  color: layer.color,
                  fontWeight: layer.bold ? 700 : 400,
                  fontFamily: fontCss(layer),
                }}
                ref={(el) => {
                  // Font size relative to the displayed image width so the
                  // saved composition (percent-based) matches what's on screen.
                  if (el && boxRef.current) {
                    el.style.fontSize = `${(layer.sizePct / 100) * boxRef.current.getBoundingClientRect().width}px`;
                  }
                }}
              >
                {layer.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="w-72 shrink-0 bg-white flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Type size={14} className="text-indigo-500" />
            <span className="text-sm font-black text-slate-900">Edit element</span>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <button type="button" onClick={addLayer}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-bold text-indigo-600 hover:bg-indigo-100 transition">
            <Plus size={14} /> Add text
          </button>

          {layers.length === 0 && (
            <p className="text-xs text-slate-400 leading-relaxed text-center py-4">
              Add a text element, then drag it into place on the image.
              Only text edits are supported for now.
            </p>
          )}

          {selected ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Text</label>
                <textarea
                  rows={3}
                  value={selected.text}
                  onChange={(e) => updateSelected({ text: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 resize-y"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Font</label>
                <select
                  value={selected.fontFamily ?? 'sans-serif'}
                  onChange={(e) => updateSelected({ fontFamily: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
                >
                  {Object.entries(FONT_FAMILIES).map(([key, f]) => (
                    <option key={key} value={key} style={{ fontFamily: f.css }}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Size — {selected.sizePct.toFixed(1)}%</label>
                <input type="range" min={1.5} max={20} step={0.5} value={selected.sizePct}
                  onChange={(e) => updateSelected({ sizePct: Number(e.target.value) })}
                  className="mt-1 w-full accent-indigo-500" />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Color</label>
                  <input type="color" value={selected.color}
                    onChange={(e) => updateSelected({ color: e.target.value })}
                    className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-slate-200" />
                </div>
                <button type="button" onClick={() => updateSelected({ bold: !selected.bold })}
                  className={`mt-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${selected.bold ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}>
                  <Bold size={14} />
                </button>
                <button type="button" onClick={removeSelected}
                  className="mt-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ) : layers.length > 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">Click a text element on the image to edit it.</p>
          ) : null}

          {saveError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{saveError}</p>}
        </div>

        <div className="border-t border-slate-100 p-4">
          <button type="button" onClick={() => void save()} disabled={saving || !blobUrl || saved}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition">
            {saved ? <><Check size={14} className="text-emerald-400" /> Saved to History</>
              : saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
              : 'Save as design'}
          </button>
        </div>
      </div>
    </div>
  );
}
