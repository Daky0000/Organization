import { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
import * as fabric from 'fabric';
import { jsPDF } from 'jspdf';
import {
  X, Save, Undo2, Redo2, Download, ChevronDown, Loader2,
  ZoomIn, ZoomOut, Maximize2, Send, ImagePlus, EyeOff, Grid3X3,
  FileJson, FileImage, FileType, AlertCircle, GalleryHorizontalEnd, CheckCircle2,
} from 'lucide-react';
import { mediaService } from '../../services/mediaService';
import { cardTemplateService } from '../../services/cardTemplateService';
import LayersPanel from '../cards/builder/LayersPanel';
import PropertiesPanel, { GradientStop } from '../cards/builder/PropertiesPanel';
import FloatingToolbar from '../cards/builder/FloatingToolbar';
import ImageUploadModal from '../cards/builder/ImageUploadModal';
import MediaLibraryModal from '../media/MediaLibraryModal';
import { CANVAS_PRESETS, CanvasPreset } from '../cards/builder/canvasPresets';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface FabricDesignData {
  fabricVersion: true;
  canvasWidth: number;
  canvasHeight: number;
  fabricJson: Record<string, unknown>;
}

interface AdminFabricBuilderProps {
  templateId: string | null;
  templateName: string;
  templateDescription?: string;
  isPublished?: boolean;
  existingDesignData?: FabricDesignData | null;
  existingCoverImageUrl?: string;
  onTemplateUpdated?: () => Promise<void> | void;
  /** Called when the builder closes — pass true when the template list should refresh */
  onClose: (refreshNeeded?: boolean) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';
const MAX_HISTORY = 60;

function fmtZoom(z: number) { return `${Math.round(z * 100)}%`; }

// ─── Component ────────────────────────────────────────────────────────────────
export default function AdminFabricBuilder({
  templateId: initialTemplateId,
  templateName,
  templateDescription = '',
  isPublished: initialIsPublished = false,
  existingDesignData,
  existingCoverImageUrl,
  onTemplateUpdated,
  onClose,
}: AdminFabricBuilderProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [preset, setPreset] = useState<CanvasPreset>(() => {
    if (existingDesignData) {
      return (
        CANVAS_PRESETS.find(
          (p) => p.w === existingDesignData.canvasWidth && p.h === existingDesignData.canvasHeight,
        ) ?? { id: 'custom', label: 'Custom', w: existingDesignData.canvasWidth, h: existingDesignData.canvasHeight }
      );
    }
    return CANVAS_PRESETS[0];
  });
  const [showPresets, setShowPresets] = useState(false);

  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [selectedObjects, setSelectedObjects] = useState<fabric.FabricObject[]>([]);
  const [publishingState, setPublishingState] = useState<'idle' | 'saving' | 'publishing' | 'unpublishing' | 'done'>('idle');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canvasScale, setCanvasScale] = useState(1);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [showImageModal, setShowImageModal] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  // Card details panel state
  const [name, setName] = useState(templateName);
  const [description, setDescription] = useState(templateDescription);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [customPreviewImage, setCustomPreviewImage] = useState<string | null>(existingCoverImageUrl ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showPreviewLibrary, setShowPreviewLibrary] = useState(false);
  const previewFileInputRef = useRef<HTMLInputElement>(null);
  const skipSnapshotRef = useRef(false);
  // Internal template ID — starts from prop, updated after first create
  const currentTemplateId = useRef<string | null>(initialTemplateId);
  const didChangeRef = useRef(false); // tracks whether any save happened (to refresh list on close)

  // ── History ─────────────────────────────────────────────────────────────────
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

  // ── Scale to fit ─────────────────────────────────────────────────────────────
  const scaleCanvasToFit = useCallback(() => {
    const c = fabricRef.current;
    const wrap = wrapperRef.current;
    if (!c || !wrap) return;
    const padding = 120;
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

  // ── Init canvas ──────────────────────────────────────────────────────────────
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

    const onSelect = () => setSelectedObjects([...canvas.getActiveObjects()]);
    const onClear  = () => setSelectedObjects([]);
    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onClear);
    canvas.on('object:added',    snapshot);
    canvas.on('object:modified', snapshot);
    canvas.on('object:removed',  snapshot);
    canvas.on('text:editing:exited', snapshot);

    if (existingDesignData?.fabricJson && Object.keys(existingDesignData.fabricJson).length > 0) {
      skipSnapshotRef.current = true;
      canvas.loadFromJSON(existingDesignData.fabricJson).then(() => {
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
      canvas.off('object:added',    snapshot);
      canvas.off('object:modified', snapshot);
      canvas.off('object:removed',  snapshot);
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

  // ── Wheel zoom ───────────────────────────────────────────────────────────────
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

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const c = fabricRef.current;
      if (!c) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z') { e.preventDefault(); undo(); }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (ctrl && e.key === 's') { e.preventDefault(); void handleSaveDraft(); }
      if (ctrl && e.key === 'd') { e.preventDefault(); duplicateSelection(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const objs = c.getActiveObjects();
        if (objs.length) { objs.forEach((o) => c.remove(o)); c.discardActiveObject(); c.requestRenderAll(); setSelectedObjects([]); }
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


  // ── Canvas helpers ───────────────────────────────────────────────────────────
  const canvasCenter = useCallback((w: number, h: number) => {
    const c = fabricRef.current;
    if (!c) return { left: 100, top: 100 };
    const vp = c.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const cx = (preset.w * canvasScale) / 2;
    const cy = (preset.h * canvasScale) / 2;
    return { left: (cx - vp[4]) / (vp[0] || 1) - w / 2, top: (cy - vp[5]) / (vp[3] || 1) - h / 2 };
  }, [preset, canvasScale]);

  const addText = useCallback((style: 'heading' | 'body' = 'body') => {
    const c = fabricRef.current;
    if (!c) return;
    const isH = style === 'heading';
    const pos = canvasCenter(300, 60);
    const text = new fabric.IText(isH ? 'Heading Text' : 'Body text here', {
      ...pos, fontFamily: 'Inter', fontSize: isH ? 72 : 36,
      fontWeight: isH ? 'bold' : 'normal', fill: '#1e293b', textAlign: 'left', lineHeight: 1.2, editable: true,
    });
    c.add(text); c.setActiveObject(text); c.requestRenderAll();
  }, [canvasCenter]);

  const addRect = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const pos = canvasCenter(200, 120);
    const r = new fabric.Rect({ ...pos, width: 200, height: 120, fill: '#e6332a', rx: 12, ry: 12, stroke: 'transparent', strokeWidth: 0 });
    c.add(r); c.setActiveObject(r); c.requestRenderAll();
  }, [canvasCenter]);

  const addCircle = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const pos = canvasCenter(120, 120);
    const el = new fabric.Ellipse({ ...pos, rx: 60, ry: 60, fill: '#2563eb', stroke: 'transparent', strokeWidth: 0 });
    c.add(el); c.setActiveObject(el); c.requestRenderAll();
  }, [canvasCenter]);

  const addLine = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const cx = (preset.w * canvasScale) / 2;
    const ln = new fabric.Line([cx - 150, preset.h * canvasScale * 0.5, cx + 150, preset.h * canvasScale * 0.5], { stroke: '#1e293b', strokeWidth: 3 });
    c.add(ln); c.setActiveObject(ln); c.requestRenderAll();
  }, [preset, canvasScale]);

  const addImageFromUrl = useCallback((url: string) => {
    const c = fabricRef.current;
    if (!c) return;
    fabric.FabricImage.fromURL(url,{ crossOrigin: 'anonymous' }).then((img) => {
      const maxW = Math.min(preset.w * canvasScale * 0.5, 400);
      if ((img.width ?? 1) > maxW) img.scale(maxW / (img.width ?? maxW));
      img.set(canvasCenter(img.getScaledWidth(), img.getScaledHeight()));
      c.add(img); c.setActiveObject(img); c.requestRenderAll();
    });
  }, [canvasCenter, preset, canvasScale]);

  // ── Background ───────────────────────────────────────────────────────────────
  const setBackground = useCallback((color: string) => {
    const c = fabricRef.current;
    if (!c) return;
    (c.backgroundColor=color,(() => { c.requestRenderAll(); snapshot(); })());
    setBgColor(color);
  }, [snapshot]);

  const setBackgroundGradient = useCallback((stops: GradientStop[], type: 'linear' | 'radial', angle: number) => {
    const c = fabricRef.current;
    if (!c) return;
    const W = (c.width  ?? preset.w) / c.getZoom();
    const H = (c.height ?? preset.h) / c.getZoom();
    const rad = (angle * Math.PI) / 180;
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    const colorStops = [...stops].sort((a, b) => a.offset - b.offset).map((s) => {
      const hex = s.color.replace('#', '');
      const color = s.opacity < 100 && hex.length === 6
        ? `rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${s.opacity/100})`
        : s.color;
      return { offset: s.offset, color };
    });
    const coords = type === 'linear'
      ? { x1: (0.5 - 0.5 * sinA) * W, y1: (0.5 + 0.5 * cosA) * H, x2: (0.5 + 0.5 * sinA) * W, y2: (0.5 - 0.5 * cosA) * H }
      : { r1: 0, r2: Math.sqrt(W * W + H * H) / 2, x1: W / 2, y1: H / 2, x2: W / 2, y2: H / 2 };
    const grad = new fabric.Gradient({ type, gradientUnits: 'pixels', coords, colorStops });
    (c.backgroundColor=grad as unknown as string,(() => { c.requestRenderAll(); snapshot(); })());
  }, [snapshot]);

  const setBgImageFromUrl = useCallback((url: string) => {
    const c = fabricRef.current;
    if (!c) return;
    if (!url) { (c.backgroundImage=undefined,(c.requestRenderAll.bind(c))()); snapshot(); return; }
    fabric.FabricImage.fromURL(url,{ crossOrigin: 'anonymous' }).then((img) => {
      (c.backgroundImage=img,img.set({
        scaleX: (c.width ?? preset.w) / (img.width ?? 1),
        scaleY: (c.height ?? preset.h) / (img.height ?? 1),
      }),(c.requestRenderAll.bind(c))());
      snapshot();
    });
  }, [preset, snapshot]);

  // ── Zoom ─────────────────────────────────────────────────────────────────────
  const applyZoom = useCallback((newZ: number) => {
    const c = fabricRef.current;
    if (!c) return;
    c.setZoom(newZ); c.setDimensions({ width: preset.w * newZ }); c.setDimensions({ height: preset.h * newZ });
    setZoomLevel(newZ); setCanvasScale(newZ); c.requestRenderAll();
  }, [preset]);

  const zoomIn  = useCallback(() => applyZoom(Math.min((fabricRef.current?.getZoom() ?? 1) * 1.25, 4)), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(Math.max((fabricRef.current?.getZoom() ?? 1) / 1.25, 0.1)), [applyZoom]);

  // ── Object manipulation ──────────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.getActiveObjects().forEach((o) => c.remove(o));
    c.discardActiveObject(); c.requestRenderAll(); setSelectedObjects([]);
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
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject(); if (obj) { c.bringObjectForward(obj); c.requestRenderAll(); }
  }, []);

  const sendBackward = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject(); if (obj) { c.sendObjectBackwards(obj); c.requestRenderAll(); }
  }, []);

  const flipH = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject() as fabric.FabricImage;
    if (obj) { obj.set('flipX', !obj.flipX); c.requestRenderAll(); snapshot(); }
  }, [snapshot]);

  const flipV = useCallback(() => {
    const c = fabricRef.current; if (!c) return;
    const obj = c.getActiveObject() as fabric.FabricImage;
    if (obj) { obj.set('flipY', !obj.flipY); c.requestRenderAll(); snapshot(); }
  }, [snapshot]);

  // ── Collect canvas data ───────────────────────────────────────────────────────
  const getDesignData = useCallback((): FabricDesignData => {
    const c = fabricRef.current!;
    return {
      fabricVersion: true,
      canvasWidth: preset.w,
      canvasHeight: preset.h,
      fabricJson: c.toObject(['data']) as Record<string, unknown>,
    };
  }, [preset]);

  // ── Save Draft ───────────────────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    if (publishingState !== 'idle') return;
    setSaveError(null);
    setSaveSuccess(null);
    setPublishingState('saving');
    try {
      const data = getDesignData();
      if (currentTemplateId.current) {
        await cardTemplateService.updateTemplate(currentTemplateId.current, {
          name,
          description,
          designData: data,
          coverImageUrl: customPreviewImage ?? undefined,
        });
      } else {
        const created = await cardTemplateService.createTemplate({ name, description, designData: data });
        currentTemplateId.current = created.id;
        // If we have a cover image, save it immediately after create
        if (customPreviewImage) {
          await cardTemplateService.updateTemplate(created.id, {
            name,
            description,
            designData: data,
            coverImageUrl: customPreviewImage,
          });
        }
      }
      if (onTemplateUpdated) await onTemplateUpdated();
      didChangeRef.current = true;
      setSaveSuccess('Saved!');
      setTimeout(() => setSaveSuccess(null), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed — please try again');
    } finally {
      setPublishingState('idle');
    }
  }, [publishingState, getDesignData, name, description, customPreviewImage, onTemplateUpdated]);

  // ── Publish ──────────────────────────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    const c = fabricRef.current;
    if (!c || publishingState !== 'idle') return;
    setSaveError(null);
    setSaveSuccess(null);

    // Step 1: Save first
    setPublishingState('saving');
    try {
      const data = getDesignData();
      if (currentTemplateId.current) {
        await cardTemplateService.updateTemplate(currentTemplateId.current, {
          name,
          description,
          designData: data,
          coverImageUrl: customPreviewImage ?? undefined,
        });
      } else {
        const created = await cardTemplateService.createTemplate({ name, description, designData: data });
        currentTemplateId.current = created.id;
      }
    } catch (err) {
      setPublishingState('idle');
      setSaveError(err instanceof Error ? err.message : 'Save failed before publishing');
      return;
    }

    // Step 2: Publish
    setPublishingState('publishing');
    try {
      const multiplier = preset.w / (preset.w * canvasScale);
      const thumbnailUrl = customPreviewImage || c.toDataURL({ format: 'jpeg', quality: 0.85, multiplier });
      await cardTemplateService.publishTemplate(currentTemplateId.current!, { coverImageUrl: thumbnailUrl });
      didChangeRef.current = true;
      setIsPublished(true);
      setPublishingState('done');
      if (onTemplateUpdated) await onTemplateUpdated();
      setTimeout(() => { setPublishingState('idle'); }, 2500);
    } catch (err) {
      setPublishingState('idle');
      setSaveError(err instanceof Error ? err.message : 'Publish failed — please try again');
    }
  }, [publishingState, getDesignData, preset, canvasScale, name, description, customPreviewImage, onTemplateUpdated]);

  // ── Unpublish ─────────────────────────────────────────────────────────────────
  const handleUnpublish = useCallback(async () => {
    if (publishingState !== 'idle' || !currentTemplateId.current) return;
    setPublishingState('unpublishing');
    try {
      await cardTemplateService.unpublishTemplate(currentTemplateId.current);
      didChangeRef.current = true;
      setIsPublished(false);
      if (onTemplateUpdated) await onTemplateUpdated();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unpublish failed');
    } finally {
      setPublishingState('idle');
    }
  }, [publishingState, onTemplateUpdated]);

  // ── Export ───────────────────────────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false);

  const getExportMultiplier = useCallback(() => preset.w / (preset.w * canvasScale), [preset, canvasScale]);
  const sanitizedName = templateName.replace(/[^a-z0-9]/gi, '_');

  const exportPNG = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL({ format: 'png', quality: 1, multiplier: getExportMultiplier() });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${sanitizedName}.png`;
    link.click();
    void mediaService.upload({
      url: dataUrl,
      thumbnail_url: dataUrl,
      file_name: `${sanitizedName}.png`,
      original_name: `${templateName || 'Template'}.png`,
      file_size: Math.round(dataUrl.length * 0.75),
      file_type: 'image/png',
      width: preset.w,
      height: preset.h,
      category: 'card-exports',
    }).catch(() => undefined);
    setShowExportMenu(false);
  }, [sanitizedName, templateName, preset.w, preset.h, getExportMultiplier]);

  const exportJPEG = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: getExportMultiplier() });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${sanitizedName}.jpg`;
    link.click();
    void mediaService.upload({
      url: dataUrl,
      thumbnail_url: dataUrl,
      file_name: `${sanitizedName}.jpg`,
      original_name: `${templateName || 'Template'}.jpg`,
      file_size: Math.round(dataUrl.length * 0.75),
      file_type: 'image/jpeg',
      width: preset.w,
      height: preset.h,
      category: 'card-exports',
    }).catch(() => undefined);
    setShowExportMenu(false);
  }, [sanitizedName, templateName, preset.w, preset.h, getExportMultiplier]);

  const getWrappedJSON = useCallback(() => {
    // Wrap in import-compatible format: [{ name, description, designData }]
    return JSON.stringify([{ name: templateName || 'Untitled Template', description, designData: getDesignData() }], null, 2);
  }, [templateName, description, getDesignData]);

  const exportJSON = useCallback(() => {
    const json = getWrappedJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizedName}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [sanitizedName, getWrappedJSON]);

  const copyJSON = useCallback(async () => {
    await navigator.clipboard.writeText(getWrappedJSON());
    setShowExportMenu(false);
  }, [getWrappedJSON]);

  const exportPDF = useCallback(() => {
    const c = fabricRef.current;
    if (!c) return;
    const imgData = c.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: getExportMultiplier() });
    const pxW = preset.w;
    const pxH = preset.h;
    // Convert px → mm (at 96dpi: 1px = 0.2646mm)
    const mmW = pxW * 0.2646;
    const mmH = pxH * 0.2646;
    const orientation = pxW >= pxH ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [mmW, mmH] });
    pdf.addImage(imgData, 'JPEG', 0, 0, mmW, mmH);
    pdf.save(`${sanitizedName}.pdf`);
    setShowExportMenu(false);
  }, [sanitizedName, preset, getExportMultiplier]);

  const applyPreset = useCallback((p: CanvasPreset) => {
    setPreset(p); setShowPresets(false); setTimeout(() => scaleCanvasToFit(), 0);
  }, [scaleCanvasToFit]);

  const busy = publishingState !== 'idle';

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-zinc-100" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 shadow-sm">
        <button type="button" onClick={() => onClose(didChangeRef.current)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900">
          <X size={18} />
        </button>

        <div className="h-6 w-px bg-zinc-200" />

        <span className="max-w-[200px] truncate text-sm font-semibold text-zinc-800">{templateName}</span>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-500">Template</span>

        {/* Canvas preset */}
        <div className="relative">
          <button type="button" onClick={() => setShowPresets((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100">
            {preset.label} <span className="text-zinc-400">{preset.w}×{preset.h}</span>
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

        {/* Undo/Redo */}
        <button type="button" onClick={undo} disabled={!canUndo} title={`Undo (${mod}+Z)`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30"><Undo2 size={16} /></button>
        <button type="button" onClick={redo} disabled={!canRedo} title={`Redo (${mod}+Y)`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30"><Redo2 size={16} /></button>

        <div className="h-6 w-px bg-zinc-200" />

        {/* Zoom */}
        <button type="button" onClick={zoomOut} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"><ZoomOut size={15} /></button>
        <span className="min-w-[44px] text-center text-xs font-semibold text-zinc-500">{fmtZoom(zoomLevel)}</span>
        <button type="button" onClick={zoomIn} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"><ZoomIn size={15} /></button>
        <button type="button" onClick={() => scaleCanvasToFit()} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100"><Maximize2 size={15} /></button>

        <div className="flex-1" />

        {/* Export dropdown */}
        <div className="relative">
          <button type="button" onClick={() => setShowExportMenu((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50">
            <Download size={13} /> Export <ChevronDown size={11} />
          </button>
          {showExportMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-zinc-200 bg-white p-1 shadow-xl">
                <button type="button" onClick={exportPNG}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition">
                  <FileImage size={13} className="text-zinc-400" /> Download as PNG
                </button>
                <button type="button" onClick={exportJPEG}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition">
                  <FileImage size={13} className="text-zinc-400" /> Download as JPEG
                </button>
                <button type="button" onClick={exportPDF}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition">
                  <FileType size={13} className="text-zinc-400" /> Download as PDF
                </button>
                <div className="my-1 border-t border-zinc-100" />
                <button type="button" onClick={exportJSON}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition">
                  <FileJson size={13} className="text-zinc-400" /> Download as JSON
                </button>
                <button type="button" onClick={() => void copyJSON()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition">
                  <FileJson size={13} className="text-zinc-400" /> Copy as JSON
                </button>
              </div>
            </>
          )}
        </div>

        {/* Grid toggle */}
        <button type="button" onClick={() => setShowGrid((v) => !v)} title={showGrid ? 'Hide grid' : 'Show grid'}
          className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
            showGrid ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
          }`}>
          <Grid3X3 size={15} />
        </button>

        {/* Save Draft */}
        <button type="button" onClick={() => void handleSaveDraft()} disabled={busy}
          className="flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60">
          {publishingState === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Draft
        </button>

        {/* Unpublish (shown when already published) */}
        {isPublished && (
          <button type="button" onClick={() => void handleUnpublish()} disabled={busy}
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            {publishingState === 'unpublishing' ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />}
            {publishingState === 'unpublishing' ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}

        {saveError && (
          <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
            <AlertCircle size={12} className="shrink-0" />
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={12} className="shrink-0" />
            {saveSuccess}
          </div>
        )}

        {/* Publish */}
        <button type="button" onClick={() => { setSaveError(null); void handlePublish(); }} disabled={busy}
          className={`flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold transition disabled:opacity-60 ${
            publishingState === 'done'
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-900 text-white hover:bg-slate-700'
          }`}>
          {(publishingState === 'publishing' || publishingState === 'saving')
            ? <Loader2 size={14} className="animate-spin" />
            : publishingState === 'done'
              ? null
              : <Send size={14} />}
          {publishingState === 'saving' ? 'Saving…'
            : publishingState === 'publishing' ? 'Publishing…'
            : publishingState === 'done' ? 'Published!'
            : isPublished ? 'Re-publish' : 'Publish'}
        </button>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* Layers */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Layers</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <LayersPanel canvas={fabricRef.current} selectedObjects={selectedObjects} />
          </div>
        </aside>

        {/* Canvas */}
        <div
          ref={wrapperRef}
          className="relative flex flex-1 items-center justify-center overflow-auto bg-zinc-200"
          style={{ backgroundImage: 'radial-gradient(circle, #a1a1aa 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          onClick={() => setShowPresets(false)}
        >
          <div className="flex flex-col items-center gap-2">
            <button type="button"
              onClick={() => { const c = fabricRef.current; if (c) { c.discardActiveObject(); c.requestRenderAll(); setSelectedObjects([]); } }}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-300/40 hover:text-zinc-600">
              {templateName} — {preset.w}×{preset.h}
            </button>
            <div className="relative shadow-2xl" style={{ width: preset.w * canvasScale, height: preset.h * canvasScale }}>
              <canvas ref={canvasElRef} />
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
          <FloatingToolbar
            onAddText={addText}
            onUploadImage={() => setShowImageModal(true)}
            onAddRect={addRect}
            onAddCircle={addCircle}
            onAddLine={addLine}
          />
        </div>

        {/* Properties */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-zinc-200 bg-white">
          {/* Card Details */}
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Card Details</p>
          </div>
          <div className="border-b border-zinc-100 p-4 space-y-3">
            {/* Title (editable) */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Title</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name…"
                className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm font-semibold text-zinc-800 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            {/* Description */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Description</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Short description shown in the gallery…"
                className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            {/* Preview image */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Preview Image</p>
              <input
                ref={previewFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const src = ev.target?.result as string;
                    const img = new Image();
                    img.onload = async () => {
                      const MAX_W = 1200, MAX_H = 800;
                      let { width: w, height: h } = img;
                      if (w > MAX_W || h > MAX_H) {
                        const ratio = Math.min(MAX_W / w, MAX_H / h);
                        w = Math.round(w * ratio);
                        h = Math.round(h * ratio);
                      }
                      const cvs = document.createElement('canvas');
                      cvs.width = w; cvs.height = h;
                      cvs.getContext('2d')!.drawImage(img, 0, 0, w, h);
                      const resized = cvs.toDataURL('image/jpeg', 0.88);
                      const approxBytes = Math.round((resized.length * 3) / 4);
                      try {
                        const uploaded = await mediaService.upload({
                          url: resized,
                          thumbnail_url: resized,
                          file_name: `admin-template-cover-${Date.now()}-${file.name.replace(/\.[^.]+$/, '.jpg')}`,
                          original_name: file.name,
                          file_size: approxBytes,
                          file_type: 'image/jpeg',
                          width: w,
                          height: h,
                          category: 'admin',
                          force: true,
                        });
                        setCustomPreviewImage(uploaded.url);
                      } catch (error) {
                        const duplicate = error as Error & { isDuplicate?: boolean; existingImage?: { url?: string } };
                        if (duplicate?.isDuplicate && duplicate.existingImage?.url) {
                          setCustomPreviewImage(duplicate.existingImage.url);
                        } else {
                          setCustomPreviewImage(resized);
                        }
                      }
                    };
                    img.src = src;
                  };
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
              {customPreviewImage ? (
                <div className="space-y-1.5">
                  <div className="relative overflow-hidden rounded-xl border border-zinc-200">
                    <img src={customPreviewImage} alt="Preview" className="h-24 w-full object-cover" />
                    <button type="button" onClick={() => setCustomPreviewImage(null)}
                      className="absolute right-1.5 top-1.5 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm transition hover:bg-red-500/80">
                      Remove
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => previewFileInputRef.current?.click()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-200 py-1.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50">
                      <ImagePlus size={11} /> Upload new
                    </button>
                    <button type="button" onClick={() => setShowPreviewLibrary(true)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-200 py-1.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50">
                      <GalleryHorizontalEnd size={11} /> Library
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <button type="button" onClick={() => previewFileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-200 py-3 transition hover:border-zinc-300 hover:bg-zinc-50">
                    <ImagePlus size={14} className="text-zinc-400" />
                    <span className="text-[10px] font-semibold text-zinc-500">Upload image file</span>
                  </button>
                  <button type="button" onClick={() => setShowPreviewLibrary(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 py-2 text-[10px] font-semibold text-zinc-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600">
                    <GalleryHorizontalEnd size={12} /> Choose from Media Library
                  </button>
                  <p className="text-center text-[9px] text-zinc-300">Auto-generated from canvas if not set</p>
                </div>
              )}
            </div>
          </div>

          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Properties</p>
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

      {/* Canvas image upload modal */}
      {showImageModal && (
        <ImageUploadModal
          onConfirm={(url) => { addImageFromUrl(url); setShowImageModal(false); }}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {/* Preview image — choose from media library */}
      {showPreviewLibrary && (
        <MediaLibraryModal
          onSelect={(url) => { setCustomPreviewImage(url); setShowPreviewLibrary(false); }}
          onClose={() => setShowPreviewLibrary(false)}
        />
      )}

      {/* Shortcut bar */}
      <div className="flex h-7 shrink-0 items-center gap-5 border-t border-zinc-200 bg-white px-4">
        {[
          [`${mod}+Z`, 'Undo'], [`${mod}+Y`, 'Redo'], [`${mod}+S`, 'Save Draft'],
          [`${mod}+D`, 'Duplicate'], ['Delete', 'Remove'], ['Ctrl+Scroll', 'Zoom'],
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
