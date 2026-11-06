import { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
import * as fabric from 'fabric';
import {
  X, Save, Undo2, Redo2, Download, ChevronDown, Loader2,
  ZoomIn, ZoomOut, Maximize2, Grid3X3,
} from 'lucide-react';
import LayersPanel from './LayersPanel';
import PropertiesPanel, { GradientStop } from './PropertiesPanel';
import FloatingToolbar from './FloatingToolbar';
import ImageUploadModal from './ImageUploadModal';
import { CANVAS_PRESETS, CanvasPreset } from './canvasPresets';
import { designService, UserDesign } from '../../../services/designService';

// ─── Keyboard shortcut map ────────────────────────────────────────────────────
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

// ─── History helpers ──────────────────────────────────────────────────────────
const MAX_HISTORY = 60;

// ─── Props ────────────────────────────────────────────────────────────────────
interface CardBuilderModalProps {
  existingDesign?: UserDesign | null;
  /** Pre-load canvas data from a template (creates a new user design) */
  initialCanvasData?: { fabricJson: Record<string, unknown>; canvasWidth?: number; canvasHeight?: number } | null;
  initialDesignName?: string;
  onClose: () => void;
  onSaved?: (design: UserDesign) => void;
}

function fmtZoom(z: number) {
  return `${Math.round(z * 100)}%`;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CardBuilderModal({
  existingDesign,
  initialCanvasData,
  initialDesignName,
  onClose,
  onSaved,
}: CardBuilderModalProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Design metadata ─────────────────────────────────────────────────────────
  const [designId, setDesignId] = useState<string | null>(existingDesign?.id ?? null);
  const [designName, setDesignName] = useState(
    existingDesign?.name ?? initialDesignName ?? 'Untitled Design',
  );
  const [preset, setPreset] = useState<CanvasPreset>(() => {
    if (existingDesign) {
      return (
        CANVAS_PRESETS.find(
          (p) => p.w === existingDesign.canvas_width && p.h === existingDesign.canvas_height,
        ) ?? { id: 'custom', label: 'Custom', w: existingDesign.canvas_width, h: existingDesign.canvas_height }
      );
    }
    if (initialCanvasData) {
      const w = initialCanvasData.canvasWidth ?? 1080;
      const h = initialCanvasData.canvasHeight ?? 1080;
      return CANVAS_PRESETS.find((p) => p.w === w && p.h === h)
        ?? { id: 'custom', label: 'Custom', w, h };
    }
    return CANVAS_PRESETS[0];
  });
  const [showPresets, setShowPresets] = useState(false);

  // ── History ─────────────────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selectedObjects, setSelectedObjects] = useState<fabric.FabricObject[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canvasScale, setCanvasScale] = useState(1);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [showImageModal, setShowImageModal] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const skipSnapshotRef = useRef(false);

  // ── Snapshot / history helpers ──────────────────────────────────────────────
  const snapshot = useCallback(() => {
    if (skipSnapshotRef.current) return;
    const c = fabricRef.current;
    if (!c) return;
    const json = JSON.stringify(c.toObject(['data']));
    if (undoStack.current[undoStack.current.length - 1] === json) return;
    undoStack.current.push(json);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 1);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const c = fabricRef.current;
    if (!c || undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    skipSnapshotRef.current = true;
    c.loadFromJSON(JSON.parse(prev)).then(() => {
      skipSnapshotRef.current = false;
      c.requestRenderAll();
      setCanUndo(undoStack.current.length > 1);
      setCanRedo(redoStack.current.length > 0);
      setSelectedObjects([]);
    });
  }, []);

  const redo = useCallback(() => {
    const c = fabricRef.current;
    if (!c || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    skipSnapshotRef.current = true;
    c.loadFromJSON(JSON.parse(next)).then(() => {
      skipSnapshotRef.current = false;
      c.requestRenderAll();
      setCanUndo(undoStack.current.length > 1);
      setCanRedo(redoStack.current.length > 0);
      setSelectedObjects([]);
    });
  }, []);

  // ── Scale canvas to fit the center panel ────────────────────────────────────
  const scaleCanvasToFit = useCallback(() => {
    const c = fabricRef.current;
    const wrap = wrapperRef.current;
    if (!c || !wrap) return;

    const padding = 120; // extra space for floating toolbar
    const availW = wrap.clientWidth - padding;
    const availH = wrap.clientHeight - padding;
    const scale = Math.min(availW / preset.w, availH / preset.h, 1);

    c.setZoom(scale);
    c.setDimensions({ width: preset.w * scale });
    c.setDimensions({ height: preset.h * scale });
    setCanvasScale(scale);
    setZoomLevel(scale);
    c.requestRenderAll();
  }, [preset]);

  // ── Init canvas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const canvas = new fabric.Canvas(el, {
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: true,
    });

    fabricRef.current = canvas;

    const onSelect = () => {
      const active = canvas.getActiveObjects();
      setSelectedObjects([...active]);
    };
    const onClear = () => setSelectedObjects([]);
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onClear);
    canvas.on('object:added', snapshot);
    canvas.on('object:modified', snapshot);
    canvas.on('object:removed', snapshot);
    canvas.on('text:editing:exited', snapshot);

    const startJson = existingDesign?.canvas_data
      ?? (initialCanvasData?.fabricJson && Object.keys(initialCanvasData.fabricJson).length > 0
          ? initialCanvasData.fabricJson
          : null);

    if (startJson) {
      skipSnapshotRef.current = true;
      canvas.loadFromJSON(startJson).then(() => {
        skipSnapshotRef.current = false;
        canvas.requestRenderAll();
        const json = JSON.stringify(canvas.toObject(['data']));
        undoStack.current = [json];
        redoStack.current = [];
        setCanUndo(false);
        setCanRedo(false);
        const bg = canvas.backgroundColor;
        if (typeof bg === 'string') setBgColor(bg);
      });
    } else {
      const json = JSON.stringify(canvas.toObject(['data']));
      undoStack.current = [json];
      redoStack.current = [];
    }

    return () => {
      canvas.off('selection:created', onSelect);
      canvas.off('selection:updated', onSelect);
      canvas.off('selection:cleared', onClear);
      canvas.off('object:added', snapshot);
      canvas.off('object:modified', snapshot);
      canvas.off('object:removed', snapshot);
      canvas.off('text:editing:exited', snapshot);
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => { scaleCanvasToFit(); }, [scaleCanvasToFit]);

  useEffect(() => {
    const ro = new ResizeObserver(() => scaleCanvasToFit());
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [scaleCanvasToFit]);

  // ── Scroll wheel zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const c = fabricRef.current;
      if (!c) return;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZ = Math.max(0.1, Math.min(4, c.getZoom() * delta));
      c.setZoom(newZ);
      c.setDimensions({ width: preset.w * newZ });
      c.setDimensions({ height: preset.h * newZ });
      setZoomLevel(newZ);
      setCanvasScale(newZ);
      c.requestRenderAll();
    };
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [preset]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const c = fabricRef.current;
      if (!c) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z') { e.preventDefault(); undo(); }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (ctrl && e.key === 's') { e.preventDefault(); void handleSave(); }
      if (ctrl && e.key === 'c') { e.preventDefault(); copySelection(); }
      if (ctrl && e.key === 'v') { e.preventDefault(); paste(); }
      if (ctrl && e.key === 'd') { e.preventDefault(); duplicateSelection(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const objs = c.getActiveObjects();
        if (objs.length) {
          objs.forEach((o) => c.remove(o));
          c.discardActiveObject();
          c.requestRenderAll();
          setSelectedObjects([]);
        }
      }
      const nudge = e.shiftKey ? 10 : 1;
      const obj = c.getActiveObject();
      if (obj) {
        if (e.key === 'ArrowLeft')  { obj.set('left', (obj.left ?? 0) - nudge); c.requestRenderAll(); }
        if (e.key === 'ArrowRight') { obj.set('left', (obj.left ?? 0) + nudge); c.requestRenderAll(); }
        if (e.key === 'ArrowUp')    { obj.set('top',  (obj.top  ?? 0) - nudge); c.requestRenderAll(); }
        if (e.key === 'ArrowDown')  { obj.set('top',  (obj.top  ?? 0) + nudge); c.requestRenderAll(); }
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); snapshot(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo]);

  // ── Clipboard ───────────────────────────────────────────────────────────────
  const clipboardRef = useRef<fabric.FabricObject | null>(null);
  const copySelection = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    obj.clone(['data']).then((cloned: fabric.FabricObject) => { clipboardRef.current = cloned; });
  }, []);
  const paste = useCallback(() => {
    const c = fabricRef.current;
    if (!c || !clipboardRef.current) return;
    clipboardRef.current.clone(['data']).then((cloned: fabric.FabricObject) => {
      c.discardActiveObject();
      cloned.set({ left: (cloned.left ?? 0) + 20, top: (cloned.top ?? 0) + 20, evented: true });
      if (cloned instanceof fabric.ActiveSelection) {
        cloned.canvas = c;
        cloned.forEachObject((obj) => c.add(obj));
        cloned.setCoords();
      } else {
        c.add(cloned);
      }
      c.setActiveObject(cloned);
      c.requestRenderAll();
    });
  }, []);

  // ── Add elements ─────────────────────────────────────────────────────────────
  const canvasCenter = useCallback(
    (w: number, h: number) => {
      const c = fabricRef.current;
      if (!c) return { left: 100, top: 100 };
      const vp = c.viewportTransform ?? [1, 0, 0, 1, 0, 0];
      const cx = (preset.w * canvasScale) / 2;
      const cy = (preset.h * canvasScale) / 2;
      return {
        left: (cx - vp[4]) / (vp[0] || 1) - w / 2,
        top: (cy - vp[5]) / (vp[3] || 1) - h / 2,
      };
    },
    [preset, canvasScale],
  );

  const addText = useCallback(
    (style: 'heading' | 'body' = 'body') => {
      const c = fabricRef.current;
      if (!c) return;
      const isHeading = style === 'heading';
      const pos = canvasCenter(300, 60);
      const text = new fabric.IText(isHeading ? 'Heading Text' : 'Body text here', {
        ...pos,
        fontFamily: 'Inter',
        fontSize: isHeading ? 72 : 36,
        fontWeight: isHeading ? 'bold' : 'normal',
        fill: '#1e293b',
        textAlign: 'left',
        lineHeight: 1.2,
        editable: true,
      });
      c.add(text);
      c.setActiveObject(text);
      c.requestRenderAll();
    },
    [canvasCenter],
  );

  const addRect = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const pos = canvasCenter(200, 120);
    const rect = new fabric.Rect({ ...pos, width: 200, height: 120, fill: '#e6332a', rx: 12, ry: 12, stroke: 'transparent', strokeWidth: 0 });
    c.add(rect); c.setActiveObject(rect); c.requestRenderAll();
  }, [canvasCenter]);

  const addCircle = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const pos = canvasCenter(120, 120);
    const circle = new fabric.Ellipse({ ...pos, rx: 60, ry: 60, fill: '#2563eb', stroke: 'transparent', strokeWidth: 0 });
    c.add(circle); c.setActiveObject(circle); c.requestRenderAll();
  }, [canvasCenter]);

  const addLine = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const cx = (preset.w * canvasScale) / 2;
    const line = new fabric.Line(
      [cx - 150, preset.h * canvasScale * 0.5, cx + 150, preset.h * canvasScale * 0.5],
      { stroke: '#1e293b', strokeWidth: 3, selectable: true },
    );
    c.add(line); c.setActiveObject(line); c.requestRenderAll();
  }, [preset, canvasScale]);

  const handleUploadImage = useCallback(() => { setShowImageModal(true); }, []);

  const addImageFromUrl = useCallback(
    (url: string) => {
      const c = fabricRef.current;
      if (!c) return;
      fabric.FabricImage.fromURL(url,{ crossOrigin: 'anonymous' }).then((img) => {
        const maxW = Math.min(preset.w * canvasScale * 0.5, 400);
        if ((img.width ?? 1) > maxW) img.scale(maxW / (img.width ?? maxW));
        const pos = canvasCenter(img.getScaledWidth(), img.getScaledHeight());
        img.set(pos);
        c.add(img); c.setActiveObject(img); c.requestRenderAll();
      });
    },
    [canvasCenter, preset, canvasScale],
  );

  const setBgImageFromUrl = useCallback(
    (url: string) => {
      const c = fabricRef.current;
      if (!c) return;
      if (!url) {
        // Clear background image
        (c.backgroundImage=undefined,(c.requestRenderAll.bind(c))());
        snapshot();
        return;
      }
      fabric.FabricImage.fromURL(url,{ crossOrigin: 'anonymous' }).then((img) => {
        (c.backgroundImage=img,img.set({
          scaleX: (c.width ?? preset.w) / (img.width ?? 1),
          scaleY: (c.height ?? preset.h) / (img.height ?? 1),
        }),(c.requestRenderAll.bind(c))());
        snapshot();
      });
    },
    [preset, snapshot],
  );

  // ── Background ───────────────────────────────────────────────────────────────
  const setBackground = useCallback((color: string) => {
    const c = fabricRef.current;
    if (!c) return;
    (c.backgroundColor=color,(() => { c.requestRenderAll(); snapshot(); })());
    setBgColor(color);
  }, [snapshot]);

  const setBackgroundGradient = useCallback((
    stops: GradientStop[],
    type: 'linear' | 'radial',
    angle: number,
  ) => {
    const c = fabricRef.current;
    if (!c) return;
    // Use logical canvas dimensions (not zoomed pixel dimensions) so the
    // gradient spans the full artboard at any zoom level and export multiplier.
    const W = (c.width  ?? preset.w) / c.getZoom();
    const H = (c.height ?? preset.h) / c.getZoom();
    const rad = (angle * Math.PI) / 180;
    // CSS-compatible angle convention: 0°=up, 90°=right, 180°=down, 270°=left
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    const x1 = (0.5 - 0.5 * sinA) * W;
    const y1 = (0.5 + 0.5 * cosA) * H;
    const x2 = (0.5 + 0.5 * sinA) * W;
    const y2 = (0.5 - 0.5 * cosA) * H;
    const colorStops = [...stops]
      .sort((a, b) => a.offset - b.offset)
      .map((s) => {
        const hex = s.color.replace('#', '');
        const color = s.opacity < 100 && hex.length === 6
          ? `rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${s.opacity/100})`
          : s.color;
        return { offset: s.offset, color };
      });
    const coords = type === 'linear'
      ? { x1, y1, x2, y2 }
      : { r1: 0, r2: Math.sqrt(W * W + H * H) / 2, x1: W / 2, y1: H / 2, x2: W / 2, y2: H / 2 };
    const grad = new fabric.Gradient({ type, gradientUnits: 'pixels', coords, colorStops });
    (c.backgroundColor=grad as unknown as string,(() => { c.requestRenderAll(); snapshot(); })());
  }, [snapshot]);

  // ── Zoom controls ───────────────────────────────────────────────────────────
  const applyZoom = useCallback((newZ: number) => {
    const c = fabricRef.current;
    if (!c) return;
    c.setZoom(newZ);
    c.setDimensions({ width: preset.w * newZ });
    c.setDimensions({ height: preset.h * newZ });
    setZoomLevel(newZ);
    setCanvasScale(newZ);
    c.requestRenderAll();
  }, [preset]);

  const zoomIn = useCallback(() => applyZoom(Math.min(fabricRef.current?.getZoom() ?? 1 * 1.25, 4) * 1.25), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(Math.max((fabricRef.current?.getZoom() ?? 1) / 1.25, 0.1)), [applyZoom]);
  const zoomFit = useCallback(() => scaleCanvasToFit(), [scaleCanvasToFit]);

  // ── Object manipulation ─────────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.getActiveObjects().forEach((o) => c.remove(o));
    c.discardActiveObject();
    c.requestRenderAll();
    setSelectedObjects([]);
  }, []);

  const duplicateSelection = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!obj) return;
    obj.clone(['data']).then((cloned: fabric.FabricObject) => {
      cloned.set({ left: (cloned.left ?? 0) + 20, top: (cloned.top ?? 0) + 20 });
      c.add(cloned); c.setActiveObject(cloned); c.requestRenderAll();
    });
  }, []);

  const bringForward = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) { c.bringObjectForward(obj); c.requestRenderAll(); }
  }, []);

  const sendBackward = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (obj) { c.sendObjectBackwards(obj); c.requestRenderAll(); }
  }, []);

  const flipH = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject() as fabric.FabricImage;
    if (obj) { obj.set('flipX', !obj.flipX); c.requestRenderAll(); snapshot(); }
  }, [snapshot]);

  const flipV = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const obj = c.getActiveObject() as fabric.FabricImage;
    if (obj) { obj.set('flipY', !obj.flipY); c.requestRenderAll(); snapshot(); }
  }, [snapshot]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportPNG = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const multiplier = preset.w / (preset.w * canvasScale);
    const dataUrl = c.toDataURL({ format: 'png', quality: 1, multiplier });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${designName.replace(/[^a-z0-9]/gi, '_')}.png`;
    link.click();
  }, [designName, preset, canvasScale]);

  const exportJPG = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const multiplier = preset.w / (preset.w * canvasScale);
    const dataUrl = c.toDataURL({ format: 'jpeg', quality: 0.95, multiplier });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${designName.replace(/[^a-z0-9]/gi, '_')}.jpg`;
    link.click();
  }, [designName, preset, canvasScale]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const c = fabricRef.current;
    if (!c || saving) return;
    setSaving(true);
    try {
      const canvasData = c.toObject(['data']);
      const thumbnailUrl = c.toDataURL({ format: 'jpeg', quality: 0.5, multiplier: 0.3 });
      const payload = { name: designName, canvas_width: preset.w, canvas_height: preset.h, canvas_data: canvasData, thumbnail_url: thumbnailUrl };
      let saved: UserDesign;
      if (designId) {
        saved = await designService.update(designId, payload);
      } else {
        saved = await designService.create(payload);
        setDesignId(saved.id);
      }
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 2000);
      onSaved?.(saved);
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setSaving(false);
    }
  }, [designId, designName, preset, saving, onSaved]);

  // ── Preset change ─────────────────────────────────────────────────────────
  const applyPreset = useCallback(
    (p: CanvasPreset) => { setPreset(p); setShowPresets(false); setTimeout(() => scaleCanvasToFit(), 0); },
    [scaleCanvasToFit],
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-zinc-100"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* ── Top Toolbar ──────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 shadow-sm">
        <button type="button" onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          title="Exit builder">
          <X size={18} />
        </button>

        <div className="h-6 w-px bg-zinc-200" />

        {/* Design name */}
        <input
          type="text"
          value={designName}
          onChange={(e) => setDesignName(e.target.value)}
          className="min-w-0 max-w-[200px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-zinc-800 focus:border-zinc-300 focus:bg-zinc-50 focus:outline-none"
          placeholder="Untitled Design"
        />

        {/* Canvas preset selector */}
        <div className="relative">
          <button type="button" onClick={() => setShowPresets((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100">
            {preset.label}
            <span className="text-zinc-400">{preset.w}×{preset.h}</span>
            <ChevronDown size={12} />
          </button>
          {showPresets && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-2xl border border-zinc-200 bg-white p-1 shadow-xl">
              {CANVAS_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => applyPreset(p)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-zinc-50 ${preset.id === p.id ? 'font-bold text-zinc-900' : 'text-zinc-700'}`}>
                  <span>{p.label}</span>
                  <span className="text-xs text-zinc-400">{p.w}×{p.h}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-zinc-200" />

        {/* Undo / Redo */}
        <button type="button" onClick={undo} disabled={!canUndo} title={`Undo (${mod}+Z)`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30">
          <Undo2 size={16} />
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title={`Redo (${mod}+Y)`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30">
          <Redo2 size={16} />
        </button>

        <div className="h-6 w-px bg-zinc-200" />

        {/* Zoom controls */}
        <button type="button" onClick={zoomOut} title="Zoom out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100">
          <ZoomOut size={15} />
        </button>
        <span className="min-w-[44px] text-center text-xs font-semibold text-zinc-500">{fmtZoom(zoomLevel)}</span>
        <button type="button" onClick={zoomIn} title="Zoom in"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100">
          <ZoomIn size={15} />
        </button>
        <button type="button" onClick={zoomFit} title="Fit to screen"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100">
          <Maximize2 size={15} />
        </button>

        <div className="h-6 w-px bg-zinc-200" />

        {/* Grid toggle */}
        <button
          type="button"
          onClick={() => setShowGrid((v) => !v)}
          title={showGrid ? 'Hide grid' : 'Show grid'}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
            showGrid ? 'bg-blue-100 text-blue-600' : 'text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <Grid3X3 size={15} />
        </button>

        <div className="flex-1" />

        {/* Export */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={exportPNG}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50" title="Export PNG">
            <Download size={13} /> PNG
          </button>
          <button type="button" onClick={exportJPG}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50" title="Export JPG">
            <Download size={13} /> JPG
          </button>
        </div>

        {/* Save */}
        <button type="button" onClick={() => void handleSave()} disabled={saving}
          className={`flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold transition disabled:opacity-60 ${
            savedPulse ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-700'
          }`}
          title={`Save (${mod}+S)`}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {savedPulse ? 'Saved!' : 'Save'}
        </button>
      </header>

      {/* ── Body (3 columns) ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* Left sidebar — Layers */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Layers</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <LayersPanel
              canvas={fabricRef.current}
              selectedObjects={selectedObjects}
            />
          </div>
        </aside>

        {/* Center — Canvas workspace */}
        <div
          ref={wrapperRef}
          className="relative flex flex-1 items-center justify-center overflow-auto bg-zinc-200"
          style={{ backgroundImage: 'radial-gradient(circle, #a1a1aa 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          onClick={() => setShowPresets(false)}
        >
          {/* Artboard container with name label */}
          <div className="flex flex-col items-center gap-2">
            {/* Artboard name label */}
            <button
              type="button"
              onClick={() => {
                const c = fabricRef.current;
                if (c) { c.discardActiveObject(); c.requestRenderAll(); setSelectedObjects([]); }
              }}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-300/40 hover:text-zinc-600"
              title="Click to edit artboard background"
            >
              {designName} — {preset.w}×{preset.h}
            </button>

            {/* Canvas artboard */}
            <div
              className="relative shadow-2xl"
              style={{ width: preset.w * canvasScale, height: preset.h * canvasScale }}
            >
              <canvas ref={canvasElRef} />
              {/* Grid overlay — pointer-events:none so it never interferes with canvas interaction */}
              {showGrid && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage: `linear-gradient(rgba(37, 99, 235,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235,0.18) 1px, transparent 1px)`,
                    backgroundSize: `${50 * canvasScale}px ${50 * canvasScale}px`,
                  }}
                />
              )}
            </div>
          </div>

          {/* Floating toolbar — fixed to bottom-center of canvas area */}
          <FloatingToolbar
            onAddText={addText}
            onUploadImage={handleUploadImage}
            onAddRect={addRect}
            onAddCircle={addCircle}
            onAddLine={addLine}
          />
        </div>

        {/* Right sidebar — Properties */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Properties</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <PropertiesPanel
              canvas={fabricRef.current}
              selectedObjects={selectedObjects}
              onDelete={deleteSelected}
              onDuplicate={duplicateSelection}
              onBringForward={bringForward}
              onSendBackward={sendBackward}
              onFlipH={flipH}
              onFlipV={flipV}
              onSetBgSolid={setBackground}
              onSetBgGradient={setBackgroundGradient}
              onSetBgImage={setBgImageFromUrl}
              onSnapshot={snapshot}
              bgColor={bgColor}
              artboardW={preset.w}
              artboardH={preset.h}
            />
          </div>
        </aside>
      </div>

      {/* ── Image Upload Modal ───────────────────────────────────────────────── */}
      {showImageModal && (
        <ImageUploadModal
          onConfirm={(url) => { addImageFromUrl(url); setShowImageModal(false); }}
          onClose={() => setShowImageModal(false)}
        />
      )}
      {/* ── Keyboard shortcut hint bar ───────────────────────────────────────── */}
      <div className="flex h-7 shrink-0 items-center gap-5 border-t border-zinc-200 bg-white px-4">
        {[
          [`${mod}+Z`, 'Undo'],
          [`${mod}+Y`, 'Redo'],
          [`${mod}+S`, 'Save'],
          [`${mod}+D`, 'Duplicate'],
          ['Delete', 'Remove'],
          ['Arrow keys', 'Nudge'],
          [`Shift+Arrow`, 'Nudge ×10'],
          ['Ctrl+Scroll', 'Zoom'],
        ].map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
