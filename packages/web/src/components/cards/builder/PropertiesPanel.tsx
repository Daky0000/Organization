import { useState, useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import {
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Trash2, Copy, ArrowUp, ArrowDown, Eye, EyeOff,
  ChevronDown, ChevronUp, ImagePlus, Layers, X,
  Plus, Minus, ArrowLeftRight, RefreshCw,
} from 'lucide-react';
import ColorPicker from './ColorPicker';
import { mediaService } from '../../../services/mediaService';
import { compressImage } from '../../../utils/imageCompression';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GradientStop {
  id: string;
  offset: number;   // 0–1
  color: string;    // hex e.g. '#ff0000'
  opacity: number;  // 0–100
}

interface PropsPanelProps {
  canvas: fabric.Canvas | null;
  selectedObjects: fabric.FabricObject[];
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onSetBgSolid: (color: string) => void;
  onSetBgGradient: (stops: GradientStop[], type: 'linear' | 'radial', angle: number) => void;
  onSetBgImage: (url: string) => void;
  onSnapshot?: () => void;
  bgColor?: string;
  artboardW?: number;
  artboardH?: number;
}

const FONTS = [
  'Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman',
  'Verdana', 'Trebuchet MS', 'Impact', 'Courier New',
];

const FONT_WEIGHTS: { value: string; label: string }[] = [
  { value: '100', label: '100 – Thin' },
  { value: '200', label: '200 – ExtraLight' },
  { value: '300', label: '300 – Light' },
  { value: '400', label: '400 – Normal' },
  { value: '500', label: '500 – Medium' },
  { value: '600', label: '600 – SemiBold' },
  { value: '700', label: '700 – Bold' },
  { value: '800', label: '800 – ExtraBold' },
  { value: '900', label: '900 – Black' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function applyOpacity(color: string, opacity: number): string {
  if (opacity >= 100) return color;
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

// ── Color swatch + picker popover — fixed positioning (escapes overflow:hidden) ─
function ColorSwatch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const pw = 244, ph = 400;
      const left = rect.left + pw > window.innerWidth - 8 ? rect.right - pw : rect.left;
      const top = rect.bottom + ph > window.innerHeight - 8 ? rect.top - ph - 4 : rect.bottom + 4;
      setPickerPos({ top, left });
    }
    setOpen((o) => !o);
  };

  const displayColor = value?.startsWith('rgba') ? value : (value || '#000000');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        <span
          className="h-4 w-4 shrink-0 rounded-full border border-zinc-300"
          style={{ background: displayColor }}
        />
        <span className="flex-1 truncate text-left">{label || value}</span>
      </button>
      {open && (
        <div style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}>
          <ColorPicker value={value || '#000000'} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ── Mini color swatch (for gradient stop rows) ────────────────────────────────
function MiniColorSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const pw = 244, ph = 400;
      const left = rect.left + pw > window.innerWidth - 8 ? rect.right - pw : rect.left;
      const top = rect.bottom + ph > window.innerHeight - 8 ? rect.top - ph - 4 : rect.bottom + 4;
      setPickerPos({ top, left });
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={handleToggle}
        className="h-5 w-5 rounded border border-zinc-300 shadow-sm transition hover:border-zinc-400"
        style={{ background: value }}
      />
      {open && (
        <div style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}>
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ── Number input ──────────────────────────────────────────────────────────────
function Num({ value, onChange, min, max, step = 1, unit }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="relative flex items-center">
      <input
        type="number"
        value={isNaN(value) ? '' : Math.round(value * 100) / 100}
        min={min} max={max} step={step}
        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v, min ?? -Infinity, max ?? Infinity)); }}
        className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-2.5 pr-8 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
      {unit && <span className="pointer-events-none absolute right-2 text-[10px] text-zinc-400">{unit}</span>}
    </div>
  );
}

// ── Toggle button ─────────────────────────────────────────────────────────────
function Tog({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button" title={title} onClick={onClick}
      className={`flex h-8 items-center justify-center rounded-lg border px-2.5 text-sm transition ${
        active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ label }: { label: string }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{label}</p>;
}

// ── Gradient editor ───────────────────────────────────────────────────────────
function GradientEditor({
  stops, type, angle, onChange,
}: {
  stops: GradientStop[];
  type: 'linear' | 'radial';
  angle: number;
  onChange: (stops: GradientStop[], type: 'linear' | 'radial', angle: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string>(stops[0]?.id ?? '');
  const draggingRef = useRef<string | null>(null);

  // Keep refs current so drag handlers don't capture stale closures
  const stopsRef = useRef(stops);
  const typeRef = useRef(type);
  const angleRef = useRef(angle);
  stopsRef.current = stops;
  typeRef.current = type;
  angleRef.current = angle;

  const sortedStops = [...stops].sort((a, b) => a.offset - b.offset);
  const stopStr = sortedStops.map((s) => `${applyOpacity(s.color, s.opacity)} ${(s.offset * 100).toFixed(1)}%`).join(', ');
  const gradCSS = type === 'linear'
    ? `linear-gradient(${angle}deg, ${stopStr})`
    : `radial-gradient(circle, ${stopStr})`;

  const update = (id: string, patch: Partial<GradientStop>) => {
    onChange(stopsRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)), typeRef.current, angleRef.current);
  };

  const addStop = useCallback(() => {
    const sorted = [...stopsRef.current].sort((a, b) => a.offset - b.offset);
    let maxGap = 0, insertAt = 0.5;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].offset - sorted[i].offset;
      if (gap > maxGap) { maxGap = gap; insertAt = (sorted[i].offset + sorted[i + 1].offset) / 2; }
    }
    const ns: GradientStop = { id: Math.random().toString(36).slice(2), offset: insertAt, color: '#888888', opacity: 100 };
    onChange([...stopsRef.current, ns], typeRef.current, angleRef.current);
    setSelectedId(ns.id);
  }, [onChange]);

  const removeStop = (id: string) => {
    if (stopsRef.current.length <= 2) return;
    const next = stopsRef.current.filter((s) => s.id !== id);
    onChange(next, typeRef.current, angleRef.current);
    if (selectedId === id) setSelectedId(next[0].id);
  };

  const handleStopMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
    draggingRef.current = id;
    const onMove = (me: MouseEvent) => {
      if (!barRef.current || !draggingRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const offset = clamp((me.clientX - rect.left) / rect.width, 0, 1);
      onChange(
        stopsRef.current.map((s) => (s.id === draggingRef.current ? { ...s, offset } : s)),
        typeRef.current,
        angleRef.current,
      );
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Type + actions row */}
      <div className="flex items-center gap-1.5">
        <select
          value={type}
          onChange={(e) => onChange(stopsRef.current, e.target.value as 'linear' | 'radial', angleRef.current)}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        <button type="button" title="Reverse gradient"
          onClick={() => onChange(stopsRef.current.map((s) => ({ ...s, offset: 1 - s.offset })), typeRef.current, angleRef.current)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50">
          <ArrowLeftRight size={12} />
        </button>
        <button type="button" title="Rotate 45°"
          onClick={() => onChange(stopsRef.current, typeRef.current, (angleRef.current + 45) % 360)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50">
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Gradient bar + draggable handles */}
      <div className="relative pt-3">
        <div
          ref={barRef}
          className="h-7 w-full rounded-lg border border-zinc-200"
          style={{ background: gradCSS }}
        />
        {stops.map((s) => (
          <div
            key={s.id}
            onMouseDown={(e) => handleStopMouseDown(e, s.id)}
            style={{ left: `${s.offset * 100}%`, top: 0 }}
            className="absolute -translate-x-1/2 cursor-ew-resize select-none"
          >
            <div
              className={`h-5 w-4 rounded-md border-2 shadow-md transition-[border-color] ${
                selectedId === s.id ? 'border-blue-500 ring-1 ring-blue-300' : 'border-white'
              }`}
              style={{ background: s.color }}
            />
          </div>
        ))}
      </div>

      {/* Stops list header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Stops</p>
        <button type="button" onClick={addStop}
          className="flex h-5 w-5 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition hover:bg-zinc-100">
          <Plus size={10} />
        </button>
      </div>

      {/* Stops rows */}
      <div className="flex flex-col gap-1">
        {sortedStops.map((s) => (
          <div
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer transition ${
              selectedId === s.id ? 'bg-zinc-100' : 'hover:bg-zinc-50'
            }`}
          >
            {/* Position % */}
            <input
              type="number" min={0} max={100}
              value={Math.round(s.offset * 100)}
              onChange={(e) => { const v = clamp(parseInt(e.target.value) || 0, 0, 100); update(s.id, { offset: v / 100 }); }}
              onClick={(e) => e.stopPropagation()}
              className="w-9 rounded border border-zinc-200 bg-white px-1 py-0.5 text-center text-[11px] text-zinc-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="shrink-0 text-[10px] text-zinc-400">%</span>

            {/* Color swatch */}
            <MiniColorSwatch value={s.color} onChange={(c) => update(s.id, { color: c })} />

            {/* Hex */}
            <input
              type="text"
              value={s.color.replace('#', '').toUpperCase()}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                if (v.length === 6) update(s.id, { color: '#' + v });
              }}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />

            {/* Opacity */}
            <input
              type="number" min={0} max={100}
              value={s.opacity}
              onChange={(e) => { const v = clamp(parseInt(e.target.value) || 0, 0, 100); update(s.id, { opacity: v }); }}
              onClick={(e) => e.stopPropagation()}
              className="w-9 rounded border border-zinc-200 bg-white px-1 py-0.5 text-center text-[11px] text-zinc-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            <span className="shrink-0 text-[10px] text-zinc-400">%</span>

            {/* Remove */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeStop(s.id); }}
              disabled={stops.length <= 2}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-200 text-zinc-400 transition hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Minus size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Angle (linear only) */}
      {type === 'linear' && (
        <div>
          <p className="mb-1 text-[10px] text-zinc-400">Angle</p>
          <Num value={angle} onChange={(v) => onChange(stopsRef.current, typeRef.current, v)} min={0} max={360} unit="°" />
        </div>
      )}
    </div>
  );
}

// ── Artboard background panel ─────────────────────────────────────────────────
function ArtboardPanel({ bgColor, onSetBgSolid, onSetBgGradient, onSetBgImage, canvas }: {
  bgColor: string;
  onSetBgSolid: (c: string) => void;
  onSetBgGradient: (stops: GradientStop[], type: 'linear' | 'radial', angle: number) => void;
  onSetBgImage: (url: string) => void;
  canvas?: fabric.Canvas | null;
}) {
  const [tab, setTab] = useState<'solid' | 'gradient' | 'image'>('solid');
  const [gradStops, setGradStops] = useState<GradientStop[]>([
    { id: 'a', offset: 0, color: '#e6332a', opacity: 100 },
    { id: 'b', offset: 1, color: '#1e293b', opacity: 100 },
  ]);
  const [gradType, setGradType] = useState<'linear' | 'radial'>('linear');
  const [gradAngle, setGradAngle] = useState(90);
  const [bgImagePreview, setBgImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seed gradient state from existing canvas background on mount
  useEffect(() => {
    if (!canvas) return;
    const bg = canvas.backgroundColor;
    if (!bg || typeof bg === 'string') return;
    const grad = bg as unknown as {
      type: string;
      colorStops: Array<{ offset: number; color: string }>;
      coords: { x1?: number; y1?: number; x2?: number; y2?: number };
    };
    if (!grad.colorStops || grad.colorStops.length < 2) return;
    const stops: GradientStop[] = grad.colorStops.map((cs, i) => {
      const opacityMatch = cs.color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
      const opacity = opacityMatch ? Math.round(parseFloat(opacityMatch[1]) * 100) : 100;
      let hexColor = cs.color;
      if (cs.color.startsWith('rgba') || cs.color.startsWith('rgb')) {
        const m = cs.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) hexColor = '#' + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
      }
      return { id: `g${i}`, offset: cs.offset, color: hexColor, opacity };
    });
    setGradStops(stops);
    if (grad.type === 'radial') setGradType('radial');
    // Recover angle from coords
    if (grad.type === 'linear' && grad.coords.x1 !== undefined && canvas) {
      const W = (canvas.width ?? 1080) / canvas.getZoom();
      const H = (canvas.height ?? 1080) / canvas.getZoom();
      const sinA = ((grad.coords.x2 ?? 0) - (grad.coords.x1 ?? 0)) / W;
      const cosA = ((grad.coords.y1 ?? 0) - (grad.coords.y2 ?? 0)) / H;
      const recovered = Math.round((Math.atan2(sinA, cosA) * 180) / Math.PI);
      setGradAngle(((recovered % 360) + 360) % 360);
    }
    setTab('gradient');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const uploaded = await mediaService.upload({
        url: compressed.url,
        thumbnail_url: compressed.thumbnail_url,
        file_name: `design-background-${Date.now()}-${file.name}`,
        original_name: file.name,
        file_size: compressed.file_size,
        file_type: compressed.file_type,
        width: compressed.width,
        height: compressed.height,
        force: true,
      });
      setBgImagePreview(uploaded.url);
      onSetBgImage(uploaded.url);
    } catch (error) {
      const duplicate = error as Error & { isDuplicate?: boolean; existingImage?: { url?: string } };
      if (duplicate?.isDuplicate && duplicate.existingImage?.url) {
        setBgImagePreview(duplicate.existingImage.url);
        onSetBgImage(duplicate.existingImage.url);
      } else {
        console.error('Background image upload failed:', error);
      }
    } finally {
      e.target.value = '';
    }
  }, [onSetBgImage]);

  const clearBgImage = useCallback(() => {
    setBgImagePreview(null);
    onSetBgImage('');
  }, [onSetBgImage]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <SectionHead label="Artboard Background" />
      <div className="flex rounded-xl border border-zinc-200 bg-zinc-50 p-0.5">
        {(['solid', 'gradient', 'image'] as const).map((t) => (
          <button key={t} type="button" onClick={() => {
            setTab(t);
            if (t === 'solid') onSetBgSolid(bgColor);
            // When switching to gradient, apply the current (already-seeded) stops
            // without re-reading from canvas, so user edits aren't overridden.
            if (t === 'gradient') onSetBgGradient(gradStops, gradType, gradAngle);
          }}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold capitalize transition ${
              tab === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'solid' && (
        <div>
          <p className="mb-2 text-[10px] text-zinc-400">Background Color</p>
          <ColorSwatch value={bgColor} onChange={onSetBgSolid} label="Pick color" />
        </div>
      )}

      {tab === 'gradient' && (
        <GradientEditor
          stops={gradStops}
          type={gradType}
          angle={gradAngle}
          onChange={(stops, type, angle) => {
            setGradStops(stops);
            setGradType(type);
            setGradAngle(angle);
            onSetBgGradient(stops, type, angle);
          }}
        />
      )}

      {tab === 'image' && (
        <div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          {bgImagePreview ? (
            <div className="relative overflow-hidden rounded-2xl border border-zinc-200">
              <img src={bgImagePreview} alt="Background" className="h-32 w-full object-cover" />
              <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 to-transparent p-3">
                <span className="text-[11px] font-semibold text-white/80">Background image</span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/30">
                    Change
                  </button>
                  <button type="button" onClick={clearBgImage} title="Remove"
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20 text-white backdrop-blur-sm transition hover:bg-red-500/70">
                    <X size={11} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 py-8 transition hover:border-zinc-300 hover:bg-zinc-50">
              <ImagePlus size={20} className="text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-500">Upload background image</span>
              <span className="text-[10px] text-zinc-300">PNG, JPG, WEBP</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PropertiesPanel({
  canvas, selectedObjects, onDelete, onDuplicate, onBringForward, onSendBackward,
  onFlipH, onFlipV, onSetBgSolid, onSetBgGradient, onSetBgImage, onSnapshot,
  bgColor = '#ffffff', artboardW = 1080, artboardH = 1080,
}: PropsPanelProps) {
  const [, refresh] = useState(0);
  const [typoExpanded, setTypoExpanded] = useState(false);
  const [strokeExpanded, setStrokeExpanded] = useState(false);

  // ── Text fill mode (solid vs gradient) ────────────────────────────────────
  const [textFillMode, setTextFillMode] = useState<'solid' | 'gradient'>('solid');
  const [textGradStops, setTextGradStops] = useState<GradientStop[]>([
    { id: 'ta', offset: 0, color: '#2563EB', opacity: 100 },
    { id: 'tb', offset: 1, color: '#ec4899', opacity: 100 },
  ]);
  const [textGradType, setTextGradType] = useState<'linear' | 'radial'>('linear');
  const [textGradAngle, setTextGradAngle] = useState(90);

  useEffect(() => {
    if (!canvas) return;
    const h = () => refresh((n) => n + 1);
    const evts = ['object:modified', 'object:scaling', 'object:moving', 'object:rotating'] as const;
    evts.forEach((ev) => canvas.on(ev, h));
    return () => evts.forEach((ev) => canvas.off(ev, h));
  }, [canvas]);

  // Sync text fill mode when selection changes
  useEffect(() => {
    const obj = selectedObjects[0];
    if (!obj || !(obj instanceof fabric.IText || obj instanceof fabric.FabricText)) {
      setTextFillMode('solid');
      return;
    }
    const fill = (obj as fabric.IText).fill;
    if (fill && typeof fill === 'object' && 'type' in (fill as object)) {
      setTextFillMode('gradient');
    } else {
      setTextFillMode('solid');
    }
  }, [selectedObjects]);

  // ── Empty / artboard state ────────────────────────────────────────────────
  if (!canvas || selectedObjects.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <ArtboardPanel bgColor={bgColor} onSetBgSolid={onSetBgSolid} onSetBgGradient={onSetBgGradient} onSetBgImage={onSetBgImage} canvas={canvas} />
        <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
          <Layers size={26} className="mb-3 text-zinc-200" />
          <p className="text-sm text-zinc-400">Select an element to edit properties</p>
        </div>
      </div>
    );
  }

  const obj = selectedObjects[0];
  const isText = obj instanceof fabric.IText || obj instanceof fabric.FabricText;
  const isImage = obj instanceof fabric.FabricImage;
  const isShape = !isText && !isImage && (obj instanceof fabric.Rect || obj instanceof fabric.Circle || obj instanceof fabric.Line || obj instanceof fabric.Ellipse);
  const zoom = canvas.getZoom();

  const set = (key: string, value: unknown) => {
    selectedObjects.forEach((o) => (o as fabric.FabricObject & Record<string, unknown>).set(key, value));
    canvas.requestRenderAll();
    refresh((n) => n + 1);
    onSnapshot?.();
  };

  const setPos = (axis: 'left' | 'top', value: number) => {
    obj.set(axis, value / zoom); canvas.requestRenderAll(); refresh((n) => n + 1); onSnapshot?.();
  };
  const setSize = (dim: 'scaleX' | 'scaleY', px: number) => {
    const orig = dim === 'scaleX' ? (obj.width ?? 1) : (obj.height ?? 1);
    obj.set(dim, px / orig); canvas.requestRenderAll(); refresh((n) => n + 1); onSnapshot?.();
  };

  // Canvas logical dimensions (unscaled)
  const cw = (canvas.width ?? artboardW) / zoom;
  const ch = (canvas.height ?? artboardH) / zoom;

  // Image fit to artboard
  const applyFit = (fit: 'auto' | 'fill' | 'cover' | 'contain') => {
    if (!isImage) return;
    const img = obj as fabric.FabricImage;
    const iw = img.width ?? 1;
    const ih = img.height ?? 1;
    if (fit === 'auto') {
      img.set({ scaleX: 1, scaleY: 1 });
    } else if (fit === 'fill') {
      img.set({ scaleX: cw / iw, scaleY: ch / ih, left: 0, top: 0 });
    } else if (fit === 'cover') {
      const scale = Math.max(cw / iw, ch / ih);
      img.set({ scaleX: scale, scaleY: scale, left: (cw - iw * scale) / 2, top: (ch - ih * scale) / 2 });
    } else if (fit === 'contain') {
      const scale = Math.min(cw / iw, ch / ih);
      img.set({ scaleX: scale, scaleY: scale, left: (cw - iw * scale) / 2, top: (ch - ih * scale) / 2 });
    }
    canvas.requestRenderAll();
    refresh((n) => n + 1);
    onSnapshot?.();
  };

  // Image position alignment
  const alignImage = (hAlign: 'left' | 'center' | 'right' | null, vAlign: 'top' | 'center' | 'bottom' | null) => {
    if (!isImage) return;
    const img = obj as fabric.FabricImage;
    const sw = img.getScaledWidth();
    const sh = img.getScaledHeight();
    if (hAlign === 'left') img.set('left', 0);
    else if (hAlign === 'center') img.set('left', (cw - sw) / 2);
    else if (hAlign === 'right') img.set('left', cw - sw);
    if (vAlign === 'top') img.set('top', 0);
    else if (vAlign === 'center') img.set('top', (ch - sh) / 2);
    else if (vAlign === 'bottom') img.set('top', ch - sh);
    canvas.requestRenderAll();
    refresh((n) => n + 1);
    onSnapshot?.();
  };

  // ── Apply gradient to text fill ─────────────────────────────────────────────
  const applyTextGradient = (stops: GradientStop[], gType: 'linear' | 'radial', gAngle: number) => {
    if (!canvas) return;
    const textObj = obj as fabric.IText;
    const W = textObj.width ?? 200;
    const H = textObj.height ?? 60;
    const rad = (gAngle * Math.PI) / 180;
    // CSS-compatible angle convention
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    const colorStops = [...stops]
      .sort((a, b) => a.offset - b.offset)
      .map((s) => ({ offset: s.offset, color: applyOpacity(s.color, s.opacity) }));
    const coords = gType === 'linear'
      ? {
          x1: (0.5 - 0.5 * sinA) * W,
          y1: (0.5 + 0.5 * cosA) * H,
          x2: (0.5 + 0.5 * sinA) * W,
          y2: (0.5 - 0.5 * cosA) * H,
        }
      : { r1: 0, r2: Math.max(W, H) / 2, x1: W / 2, y1: H / 2, x2: W / 2, y2: H / 2 };
    const grad = new fabric.Gradient({ type: gType, gradientUnits: 'pixels', coords, colorStops });
    selectedObjects.forEach((o) => o.set('fill', grad as unknown as string));
    canvas.requestRenderAll();
    refresh((n) => n + 1);
    onSnapshot?.();
  };

  const displayLeft = Math.round((obj.left ?? 0) * zoom);
  const displayTop = Math.round((obj.top ?? 0) * zoom);
  const displayW = Math.round((obj.getScaledWidth?.() ?? obj.width ?? 0) * zoom);
  const displayH = Math.round((obj.getScaledHeight?.() ?? obj.height ?? 0) * zoom);
  const txt = obj as fabric.IText;

  // Image preview src
  const imagePreviewSrc = isImage
    ? ((obj as fabric.FabricImage).getElement() as HTMLImageElement)?.src ?? ''
    : '';

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-5 p-4">

        {/* ── Actions ── */}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onDuplicate} title="Duplicate"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            <Copy size={12} /> Copy
          </button>
          <button type="button" onClick={() => { obj.set('visible', !obj.visible); canvas.requestRenderAll(); refresh((n) => n + 1); onSnapshot?.(); }}
            title={obj.visible ? 'Hide' : 'Show'}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            {obj.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button type="button" onClick={onBringForward} title="Bring Forward"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            <ArrowUp size={12} />
          </button>
          <button type="button" onClick={onSendBackward} title="Send Backward"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">
            <ArrowDown size={12} />
          </button>
          <button type="button" onClick={onDelete} title="Delete"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50">
            <Trash2 size={12} />
          </button>
        </div>

        {/* ── Position & Size ── */}
        <div>
          <SectionHead label="Position & Size" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><p className="mb-1 text-[10px] text-zinc-400">X</p><Num value={displayLeft} onChange={(v) => setPos('left', v)} /></div>
            <div><p className="mb-1 text-[10px] text-zinc-400">Y</p><Num value={displayTop} onChange={(v) => setPos('top', v)} /></div>
            <div><p className="mb-1 text-[10px] text-zinc-400">W</p><Num value={displayW} onChange={(v) => setSize('scaleX', v)} min={1} /></div>
            <div><p className="mb-1 text-[10px] text-zinc-400">H</p><Num value={displayH} onChange={(v) => setSize('scaleY', v)} min={1} /></div>
          </div>
          <div className="mt-2">
            <p className="mb-1 text-[10px] text-zinc-400">Rotation</p>
            <Num value={obj.angle ?? 0} onChange={(v) => set('angle', v)} min={0} max={360} unit="°" />
          </div>
        </div>

        {/* ── Opacity ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionHead label="Opacity" />
            <span className="text-xs font-semibold text-zinc-500">{Math.round((obj.opacity ?? 1) * 100)}%</span>
          </div>
          <input type="range" min={0} max={1} step={0.01} value={obj.opacity ?? 1}
            onChange={(e) => set('opacity', parseFloat(e.target.value))}
            className="w-full accent-slate-900" />
        </div>

        {/* ── Typography ── */}
        {isText && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3">
            <button type="button" onClick={() => setTypoExpanded((e) => !e)}
              className="flex w-full items-center justify-between">
              <span className="text-xs font-bold text-zinc-700">Typography</span>
              {typoExpanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
            </button>

            <div className="mt-3 flex flex-col gap-2.5">
              {/* Font family */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Font family
                </p>
                <select value={txt.fontFamily ?? 'Inter'} onChange={(e) => set('fontFamily', e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300">
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              {/* Font weight */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Font weight
                </p>
                <select value={txt.fontWeight?.toString() ?? '400'} onChange={(e) => set('fontWeight', e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-slate-300">
                  {FONT_WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>

              {/* Font size */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Font size
                </p>
                <Num value={txt.fontSize ?? 24} onChange={(v) => set('fontSize', v)} min={6} max={400} unit="PX" />
              </div>

              {/* Text align */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Text align
                </p>
                <div className="flex gap-1">
                  {[
                    { align: 'left', icon: <AlignLeft size={13} /> },
                    { align: 'center', icon: <AlignCenter size={13} /> },
                    { align: 'right', icon: <AlignRight size={13} /> },
                    { align: 'justify', icon: <AlignJustify size={13} /> },
                  ].map(({ align, icon }) => (
                    <Tog key={align} active={txt.textAlign === align} onClick={() => set('textAlign', align)}>{icon}</Tog>
                  ))}
                </div>
              </div>

              {/* Text fill (solid or gradient) */}
              <div>
                <p className="mb-1.5 flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" /> Text fill
                </p>
                {/* Mode toggle */}
                <div className="mb-2 flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                  {(['solid', 'gradient'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setTextFillMode(m);
                        if (m === 'solid') {
                          // Revert to a solid color
                          const solidColor = typeof txt.fill === 'string' ? txt.fill : '#000000';
                          selectedObjects.forEach((o) => (o as fabric.FabricObject).set('fill', solidColor));
                          canvas?.requestRenderAll();
                          refresh((n) => n + 1);
                          onSnapshot?.();
                        } else {
                          // Apply current gradient immediately
                          applyTextGradient(textGradStops, textGradType, textGradAngle);
                        }
                      }}
                      className={`flex-1 rounded-md py-1 text-[11px] font-semibold capitalize transition ${
                        textFillMode === m ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {textFillMode === 'solid' ? (
                  <ColorSwatch
                    value={typeof txt.fill === 'string' ? (txt.fill ?? '#000000') : '#000000'}
                    onChange={(v) => set('fill', v)}
                    label={typeof txt.fill === 'string' ? (txt.fill?.slice(0, 14) ?? '#000000') : 'gradient'}
                  />
                ) : (
                  <GradientEditor
                    stops={textGradStops}
                    type={textGradType}
                    angle={textGradAngle}
                    onChange={(stops, type, angle) => {
                      setTextGradStops(stops);
                      setTextGradType(type);
                      setTextGradAngle(angle);
                      applyTextGradient(stops, type, angle);
                    }}
                  />
                )}
              </div>

              {/* Show more / less toggle */}
              <button type="button" onClick={() => setTypoExpanded((e) => !e)}
                className="flex items-center justify-center gap-1 rounded-lg border border-zinc-200 py-1.5 text-[11px] font-semibold text-zinc-500 transition hover:bg-zinc-50">
                {typoExpanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
              </button>

              {/* Expanded */}
              {typoExpanded && (
                <div className="flex flex-col gap-2.5 border-t border-zinc-200 pt-2.5">
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Line height</p>
                    <Num value={txt.lineHeight ?? 1.2} onChange={(v) => set('lineHeight', v)} min={0.5} max={5} step={0.05} unit="PX" />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Letter spacing</p>
                    <Num value={txt.charSpacing ?? 0} onChange={(v) => set('charSpacing', v)} min={-200} max={800} unit="PX" />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Word spacing</p>
                    <Num value={0} onChange={() => {}} unit="PX" />
                  </div>

                  {/* Line decoration */}
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Line decoration</p>
                    <div className="flex gap-1">
                      <Tog active={!txt.underline && !txt.overline && !txt.linethrough}
                        onClick={() => { set('underline', false); set('overline', false); set('linethrough', false); }} title="None">
                        <span className="text-[11px] font-bold">—</span>
                      </Tog>
                      <Tog active={!!txt.underline} onClick={() => set('underline', !txt.underline)} title="Underline">
                        <span className="text-[11px] underline font-bold">T</span>
                      </Tog>
                      <Tog active={!!txt.overline} onClick={() => set('overline', !txt.overline)} title="Overline">
                        <span className="text-[11px] overline font-bold">T</span>
                      </Tog>
                      <Tog active={!!txt.linethrough} onClick={() => set('linethrough', !txt.linethrough)} title="Strikethrough">
                        <span className="text-[11px] line-through font-bold">T</span>
                      </Tog>
                    </div>
                  </div>

                  {/* Text transform */}
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Text transform</p>
                    <div className="flex gap-1">
                      {[{ label: '—', title: 'None' }, { label: 'Aa', title: 'Capitalize' }, { label: 'AA', title: 'Uppercase' }, { label: 'aa', title: 'Lowercase' }].map(({ label, title }) => (
                        <Tog key={label} onClick={() => {}} title={title}>
                          <span className="text-[10px] font-bold">{label}</span>
                        </Tog>
                      ))}
                    </div>
                  </div>

                  {/* Font style */}
                  <div>
                    <p className="mb-1 text-[10px] text-zinc-500">Font style</p>
                    <div className="flex gap-1">
                      <Tog active={txt.fontStyle !== 'italic'} onClick={() => set('fontStyle', 'normal')} title="Normal">
                        <span className="text-[11px] font-bold">—</span>
                      </Tog>
                      <Tog active={txt.fontStyle === 'italic'} onClick={() => set('fontStyle', txt.fontStyle === 'italic' ? 'normal' : 'italic')} title="Italic">
                        <span className="text-[11px] italic font-bold">I</span>
                      </Tog>
                    </div>
                  </div>

                  {/* Text stroke */}
                  <div>
                    <button type="button" onClick={() => setStrokeExpanded((e) => !e)}
                      className="flex w-full items-center justify-between text-[10px] text-zinc-500">
                      <span>Text stroke</span>
                      {strokeExpanded ? <ChevronUp size={11} /> : <span className="text-zinc-400">+</span>}
                    </button>
                    {strokeExpanded && (
                      <div className="mt-2 flex flex-col gap-2">
                        <div>
                          <p className="mb-1 text-[10px] text-zinc-400">Stroke color</p>
                          <ColorSwatch value={(txt.stroke as string) ?? '#000000'} onChange={(v) => set('stroke', v)} />
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] text-zinc-400">Stroke width</p>
                          <Num value={txt.strokeWidth ?? 0} onChange={(v) => set('strokeWidth', v)} min={0} max={20} unit="PX" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Fill & Stroke (shapes) ── */}
        {isShape && (
          <div>
            <SectionHead label="Fill & Stroke" />
            <div className="mt-2 flex flex-col gap-2.5">
              <div>
                <p className="mb-1 text-[10px] text-zinc-400">Fill color</p>
                <ColorSwatch value={((obj as fabric.Rect).fill as string) ?? '#cccccc'} onChange={(v) => set('fill', v)} />
              </div>
              <div>
                <p className="mb-1 text-[10px] text-zinc-400">Stroke color</p>
                <ColorSwatch value={((obj as fabric.Rect).stroke as string) ?? '#000000'} onChange={(v) => set('stroke', v)} />
              </div>
              <div>
                <p className="mb-1 text-[10px] text-zinc-400">Stroke width</p>
                <Num value={(obj as fabric.Rect).strokeWidth ?? 0} onChange={(v) => set('strokeWidth', v)} min={0} max={50} unit="PX" />
              </div>
              {obj instanceof fabric.Rect && (
                <div>
                  <p className="mb-1 text-[10px] text-zinc-400">Corner radius</p>
                  <Num value={(obj as fabric.Rect).rx ?? 0} onChange={(v) => { set('rx', v); set('ry', v); }} min={0} max={500} unit="PX" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Image ── */}
        {isImage && (
          <div>
            {/* Thumbnail preview */}
            {imagePreviewSrc && (
              <div className="mb-3 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                <img src={imagePreviewSrc} alt="" className="h-24 w-full object-contain" />
              </div>
            )}

            <SectionHead label="Image" />
            <div className="mt-2 flex flex-col gap-3">

              {/* Fit to artboard */}
              <div>
                <p className="mb-1.5 text-[10px] text-zinc-400">Fit to canvas</p>
                <div className="grid grid-cols-4 gap-1">
                  {(['auto', 'fill', 'cover', 'contain'] as const).map((fit) => (
                    <button key={fit} type="button" onClick={() => applyFit(fit)}
                      className="rounded-lg border border-zinc-200 py-1.5 text-[10px] font-semibold capitalize text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50">
                      {fit}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position alignment */}
              <div>
                <p className="mb-1.5 text-[10px] text-zinc-400">Align to canvas</p>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: '↖', h: 'left' as const,   v: 'top' as const,    title: 'Top Left' },
                    { label: '↑', h: 'center' as const, v: 'top' as const,    title: 'Top Center' },
                    { label: '↗', h: 'right' as const,  v: 'top' as const,    title: 'Top Right' },
                    { label: '←', h: 'left' as const,   v: 'center' as const, title: 'Middle Left' },
                    { label: '⊙', h: 'center' as const, v: 'center' as const, title: 'Center' },
                    { label: '→', h: 'right' as const,  v: 'center' as const, title: 'Middle Right' },
                    { label: '↙', h: 'left' as const,   v: 'bottom' as const, title: 'Bottom Left' },
                    { label: '↓', h: 'center' as const, v: 'bottom' as const, title: 'Bottom Center' },
                    { label: '↘', h: 'right' as const,  v: 'bottom' as const, title: 'Bottom Right' },
                  ].map(({ label, h, v, title }) => (
                    <button key={title} type="button" title={title} onClick={() => alignImage(h, v)}
                      className="flex h-7 items-center justify-center rounded-lg border border-zinc-200 text-xs text-zinc-500 transition hover:bg-zinc-50 hover:border-zinc-400">
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Flip */}
              <div className="flex gap-2">
                <button type="button" onClick={onFlipH} className="flex-1 rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">Flip H</button>
                <button type="button" onClick={onFlipV} className="flex-1 rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50">Flip V</button>
              </div>
            </div>
          </div>
        )}

        {selectedObjects.length > 1 && (
          <p className="text-center text-xs text-zinc-400">{selectedObjects.length} objects selected</p>
        )}
      </div>
    </div>
  );
}
