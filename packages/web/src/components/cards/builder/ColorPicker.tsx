import { useState, useRef, useEffect } from 'react';
import { Pipette, Plus } from 'lucide-react';

// ── Color math ─────────────────────────────────────────────────────────────────
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

// Handles #rrggbb and rgba(r,g,b,a)
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!hex) return null;
  const rgba = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgba) return [parseInt(rgba[1]), parseInt(rgba[2]), parseInt(rgba[3])];
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// Parse alpha from rgba() string, returns 1 if not present
export function parseAlpha(color: string): number {
  const m = color.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}

const SAVED_DEFAULTS = [
  '#6b7280', '#3b82f6', '#22c55e', '#f97316',
  '#ef4444', '#eab308', '#14b8a6', '#2563EB',
];

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  const parsed = hexToRgb(value) ?? [0, 0, 0];
  const [hsvH, hsvS, hsvV] = rgbToHsv(...parsed);
  const initAlpha = parseAlpha(value);

  const [hue, setHue] = useState(hsvH);
  const [sat, setSat] = useState(hsvS);
  const [bri, setBri] = useState(hsvV);
  const [alphaVal, setAlphaVal] = useState(initAlpha);
  const [format, setFormat] = useState<'RGB' | 'HEX'>('RGB');
  const [hexInput, setHexInput] = useState(rgbToHex(...parsed).replace('#', ''));
  const [savedColors, setSavedColors] = useState<string[]>(SAVED_DEFAULTS);

  const gradRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);

  // Ref so drag callbacks always have fresh state without stale closures
  const stateRef = useRef({ hue, sat, bri, alphaVal });
  stateRef.current = { hue, sat, bri, alphaVal };

  useEffect(() => {
    const rgb = hexToRgb(value);
    if (rgb) {
      const [h, s, v] = rgbToHsv(...rgb);
      setHue(h); setSat(s); setBri(v);
      setHexInput(rgbToHex(...rgb).replace('#', ''));
    }
    setAlphaVal(parseAlpha(value));
  }, [value]);

  // Emit color including alpha
  const emitColor = (h: number, s: number, v: number, a: number) => {
    const [rr, gg, bb] = hsvToRgb(h, s, v);
    if (a < 0.995) {
      onChange(`rgba(${rr},${gg},${bb},${parseFloat(a.toFixed(3))})`);
    } else {
      onChange(rgbToHex(rr, gg, bb));
    }
  };

  // Drag helper — always reads fresh state via ref
  const makeDrag = (onMove: (clientX: number, clientY: number) => void) =>
    (e: React.PointerEvent) => {
      e.preventDefault();
      onMove(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => onMove(ev.clientX, ev.clientY);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

  const handleGrad = makeDrag((cx, cy) => {
    const el = gradRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height));
    setSat(s); setBri(v);
    emitColor(stateRef.current.hue, s, v, stateRef.current.alphaVal);
  });

  const handleHue = makeDrag((cx) => {
    const el = hueRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
    setHue(h);
    emitColor(h, stateRef.current.sat, stateRef.current.bri, stateRef.current.alphaVal);
  });

  const handleAlpha = makeDrag((cx) => {
    const el = alphaRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    setAlphaVal(a);
    emitColor(stateRef.current.hue, stateRef.current.sat, stateRef.current.bri, a);
  });

  const [r, g, b] = hsvToRgb(hue, sat, bri);
  const currentHex = rgbToHex(r, g, b);
  const pureHue = rgbToHex(...hsvToRgb(hue, 1, 1));

  const tryEyedropper = async () => {
    if (!('EyeDropper' in window)) return;
    try {
      // @ts-ignore
      const ed = new window.EyeDropper();
      const { sRGBHex } = await ed.open();
      const rgb2 = hexToRgb(sRGBHex);
      if (rgb2) { const [h, s, v] = rgbToHsv(...rgb2); setHue(h); setSat(s); setBri(v); emitColor(h, s, v, alphaVal); }
    } catch { /* cancelled */ }
  };

  const selectSaved = (c: string) => {
    const rgb2 = hexToRgb(c);
    if (!rgb2) return;
    const [h, s, v] = rgbToHsv(...rgb2);
    const a = parseAlpha(c);
    setHue(h); setSat(s); setBri(v); setAlphaVal(a);
    emitColor(h, s, v, a);
  };

  return (
    <div className="w-[240px] rounded-2xl border border-zinc-200 bg-white p-3 shadow-2xl select-none" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Gradient square */}
      <div
        ref={gradRef}
        onPointerDown={handleGrad}
        className="relative mb-2.5 h-[150px] w-full cursor-crosshair overflow-hidden rounded-xl"
        style={{ background: pureHue }}
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #fff, transparent)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent, #000)' }} />
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${sat * 100}%`, top: `${(1 - bri) * 100}%`, background: currentHex }}
        />
      </div>

      {/* Sliders row */}
      <div className="mb-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void tryEyedropper()}
          title="Eyedropper"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:bg-zinc-50"
        >
          <Pipette size={12} />
        </button>
        <div className="flex flex-1 flex-col gap-1.5">
          {/* Hue */}
          <div
            ref={hueRef}
            onPointerDown={handleHue}
            className="relative h-2.5 w-full cursor-pointer rounded-full"
            style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{ left: `${(hue / 360) * 100}%`, background: pureHue }}
            />
          </div>
          {/* Alpha */}
          <div
            ref={alphaRef}
            onPointerDown={handleAlpha}
            className="relative h-2.5 w-full cursor-pointer overflow-hidden rounded-full"
          >
            <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)', backgroundSize: '6px 6px', backgroundPosition: '0 0,0 3px,3px -3px,-3px 0' }} />
            <div className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(to right,transparent,${currentHex})` }} />
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{ left: `${alphaVal * 100}%`, background: currentHex }}
            />
          </div>
        </div>
      </div>

      {/* Format + inputs */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFormat((f) => (f === 'RGB' ? 'HEX' : 'RGB'))}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-semibold text-zinc-600 transition hover:bg-zinc-50"
        >
          {format} <span className="text-zinc-400">▾</span>
        </button>

        {format === 'RGB' ? (
          <div className="grid flex-1 grid-cols-4 gap-0.5">
            {([['R', r, 0], ['G', g, 1], ['B', b, 2]] as [string, number, number][]).map(([lbl, val, idx]) => (
              <div key={lbl} className="flex flex-col items-center">
                <input
                  type="number" min={0} max={255} value={val}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                    const nr = idx === 0 ? n : r, ng = idx === 1 ? n : g, nb = idx === 2 ? n : b;
                    const [h, s, v] = rgbToHsv(nr, ng, nb);
                    setHue(h); setSat(s); setBri(v); emitColor(h, s, v, alphaVal);
                  }}
                  className="w-full rounded border border-zinc-200 py-0.5 text-center text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-slate-300"
                />
                <span className="mt-0.5 text-[9px] text-zinc-400">{lbl}</span>
              </div>
            ))}
            <div className="flex flex-col items-center">
              <input
                type="number" min={0} max={100} value={Math.round(alphaVal * 100)}
                onChange={(e) => {
                  const a = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) / 100;
                  setAlphaVal(a); emitColor(hue, sat, bri, a);
                }}
                className="w-full rounded border border-zinc-200 py-0.5 text-center text-[11px] text-zinc-800 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <span className="mt-0.5 text-[9px] text-zinc-400">A%</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-1">
            <span className="text-sm text-zinc-400">#</span>
            <input
              type="text" maxLength={6} value={hexInput}
              onChange={(e) => {
                setHexInput(e.target.value);
                if (e.target.value.length === 6) {
                  const rgb2 = hexToRgb('#' + e.target.value);
                  if (rgb2) { const [h, s, v] = rgbToHsv(...rgb2); setHue(h); setSat(s); setBri(v); emitColor(h, s, v, alphaVal); }
                }
              }}
              className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs uppercase text-zinc-800 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
        )}
      </div>

      {/* Saved colors */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-600">Saved Colors</span>
          <button
            type="button"
            onClick={() => { if (!savedColors.includes(currentHex)) setSavedColors((p) => [currentHex, ...p].slice(0, 16)); }}
            className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            <Plus size={11} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {savedColors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => selectSaved(c)}
              className="h-5 w-5 rounded-full border-2 transition hover:scale-110"
              style={{ background: c, borderColor: c === currentHex ? '#1e293b' : 'transparent', outline: c === currentHex ? '1px solid #1e293b' : 'none' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Floating popover wrapper used by other pages ──────────────────────────────

export function ColorPickerPopover({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (c: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`h-8 w-8 rounded-full border-2 border-white shadow transition-transform ${
          open ? 'ring-2 ring-indigo-400 ring-offset-1' : 'ring-1 ring-slate-300'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'}`}
        style={{ background: value }}
        title={value}
      />
      {open && (
        <div className="absolute left-0 z-50 mt-2">
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
