import { useState, useRef } from 'react';
import { X, Download, Upload, Send, Trash2, Copy, CheckCircle } from 'lucide-react';
import html2canvas from 'html2canvas';
import {
  CardTemplate,
  CardElement,
  createStyleConfig,
  createSpacing,
} from '../../types/cardTemplate';
import CardPreviewCanvas from '../cards/CardPreviewCanvas';
import ColorPickerField from '../cards/ColorPickerField';
import GradientPickerField from '../cards/GradientPickerField';

// ─── Palette Definition ───────────────────────────────────────────────────────

type PaletteItem = {
  id: string;
  label: string;
  icon: string;
  description: string;
  createElement: (uid: number) => CardElement;
};

const PALETTE_ITEMS: PaletteItem[] = [
  {
    id: 'text',
    label: 'Text',
    icon: '¶',
    description: 'Paragraph or body copy',
    createElement: (uid) => ({
      id: `text-${uid}`,
      type: 'text',
      content: 'Your text here',
      frame: { x: 10, y: 30, width: 50, height: 10 },
      styles: createStyleConfig({ fontSize: 16, fontWeight: 400, color: '#ffffff' }),
    }),
  },
  {
    id: 'heading',
    label: 'Heading',
    icon: 'H',
    description: 'Large display title',
    createElement: (uid) => ({
      id: `heading-${uid}`,
      type: 'heading',
      content: 'Heading Title',
      frame: { x: 10, y: 10, width: 60, height: 12 },
      styles: createStyleConfig({ fontSize: 32, fontWeight: 800, color: '#ffffff' }),
    }),
  },
  {
    id: 'image',
    label: 'Image',
    icon: '🖼',
    description: 'Photo or illustration',
    createElement: (uid) => ({
      id: `image-${uid}`,
      type: 'image',
      content: '',
      src: 'https://placehold.co/400x300/1e293b/94a3b8?text=Image',
      alt: 'Image',
      frame: { x: 15, y: 30, width: 35, height: 25 },
      styles: createStyleConfig({ objectFit: 'cover' }),
    }),
  },
  {
    id: 'avatar',
    label: 'Avatar',
    icon: '○',
    description: 'Circular profile photo',
    createElement: (uid) => ({
      id: `avatar-${uid}`,
      type: 'image',
      content: '',
      src: 'https://placehold.co/200x200/334155/94a3b8?text=Avatar',
      alt: 'Avatar',
      frame: { x: 5, y: 5, width: 15, height: 20 },
      styles: createStyleConfig({ objectFit: 'cover', borderRadius: 999 }),
    }),
  },
  {
    id: 'button',
    label: 'Button',
    icon: '▶',
    description: 'Call-to-action element',
    createElement: (uid) => ({
      id: `button-${uid}`,
      type: 'button',
      content: 'Click Here',
      frame: { x: 20, y: 65, width: 25, height: 8 },
      styles: createStyleConfig({
        fontSize: 14,
        fontWeight: 600,
        color: '#ffffff',
        backgroundType: 'solid',
        backgroundColor: '#3b82f6',
        borderRadius: 6,
        padding: createSpacing(2),
      }),
    }),
  },
  {
    id: 'shape',
    label: 'Shape',
    icon: '◼',
    description: 'Geometric background shape',
    createElement: (uid) => ({
      id: `shape-${uid}`,
      type: 'icon',
      content: '',
      frame: { x: 10, y: 10, width: 20, height: 20 },
      styles: createStyleConfig({
        backgroundType: 'solid',
        backgroundColor: '#2563EB',
        borderRadius: 8,
      }),
    }),
  },
  {
    id: 'divider',
    label: 'Divider',
    icon: '—',
    description: 'Horizontal separator line',
    createElement: (uid) => ({
      id: `divider-${uid}`,
      type: 'text',
      content: '',
      frame: { x: 5, y: 50, width: 90, height: 1 },
      styles: createStyleConfig({
        backgroundType: 'solid',
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderRadius: 0,
      }),
    }),
  },
  {
    id: 'icon',
    label: 'Icon',
    icon: '🏷',
    description: 'Badge or tag label',
    createElement: (uid) => ({
      id: `icon-${uid}`,
      type: 'icon',
      content: 'NEW',
      frame: { x: 5, y: 5, width: 12, height: 5 },
      styles: createStyleConfig({
        fontSize: 11,
        fontWeight: 700,
        color: '#ffffff',
        backgroundType: 'solid',
        backgroundColor: '#ef4444',
        borderRadius: 4,
        padding: createSpacing(2),
      }),
    }),
  },
  {
    id: 'logo',
    label: 'Logo',
    icon: '◆',
    description: 'Brand logo placement',
    createElement: (uid) => ({
      id: `logo-${uid}`,
      type: 'image',
      content: '',
      src: 'https://placehold.co/200x80/000000/ffffff?text=LOGO',
      alt: 'Logo',
      frame: { x: 5, y: 5, width: 20, height: 10 },
      styles: createStyleConfig({ objectFit: 'contain' }),
    }),
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsTab = 'Content' | 'Style' | 'Advanced';

interface CardBuilderProps {
  template: CardTemplate;
  templateName: string;
  onSave: (template: CardTemplate) => void;
  onPublish?: (template: CardTemplate, previewImageUrl: string) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const CardBuilder = ({
  template,
  templateName,
  onSave,
  onPublish,
  onCancel,
  isLoading = false,
}: CardBuilderProps) => {
  const [currentTemplate, setCurrentTemplate] = useState<CardTemplate>(template);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<PaletteItem | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('Content');
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const selectedElement =
    currentTemplate.elements.find((el) => el.id === selectedElementId) ?? null;

  // ─── Element Operations ─────────────────────────────────────────────────────

  const addElement = (item: PaletteItem, x?: number, y?: number) => {
    const newEl = item.createElement(Date.now());
    if (x !== undefined) newEl.frame.x = Math.max(0, Math.min(88, x));
    if (y !== undefined) newEl.frame.y = Math.max(0, Math.min(88, y));
    setCurrentTemplate((prev) => ({ ...prev, elements: [...prev.elements, newEl] }));
    setSelectedElementId(newEl.id);
    setDraggedItem(null);
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!draggedItem) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    addElement(draggedItem, x, y);
  };

  const deleteElement = (id: string) => {
    setCurrentTemplate((prev) => ({
      ...prev,
      elements: prev.elements.filter((el) => el.id !== id),
    }));
    if (selectedElementId === id) setSelectedElementId(null);
  };

  const duplicateElement = (id: string) => {
    const el = currentTemplate.elements.find((e) => e.id === id);
    if (!el) return;
    const clone: CardElement = {
      ...el,
      id: `${el.type}-${Date.now()}`,
      frame: { ...el.frame, x: Math.min(88, el.frame.x + 2), y: Math.min(88, el.frame.y + 2) },
    };
    setCurrentTemplate((prev) => ({ ...prev, elements: [...prev.elements, clone] }));
  };

  const updateEl = (id: string, patch: Partial<CardElement>) => {
    setCurrentTemplate((prev) => ({
      ...prev,
      elements: prev.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)),
    }));
  };

  const updateStyles = (id: string, patch: Partial<CardElement['styles']>) => {
    setCurrentTemplate((prev) => ({
      ...prev,
      elements: prev.elements.map((el) =>
        el.id === id ? { ...el, styles: { ...el.styles, ...patch } } : el
      ),
    }));
  };

  // ─── Toolbar Actions ────────────────────────────────────────────────────────

  const handleDownloadPreview = async () => {
    if (!cardRef.current) return;
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(cardRef.current, { backgroundColor: null, scale: 2 });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${templateName.replace(/\s+/g, '-').toLowerCase()}-preview.png`;
      link.click();
      setDownloadDone(true);
    } catch (err) {
      console.error('Preview download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePreviewUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPreviewImageUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handlePublish = async () => {
    if (!onPublish || !previewImageUrl) return;
    setIsPublishing(true);
    try {
      await onPublish(currentTemplate, previewImageUrl);
    } finally {
      setIsPublishing(false);
    }
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const isTextLike =
    selectedElement &&
    ['text', 'heading', 'icon', 'button'].includes(selectedElement.type);
  const isImageEl = selectedElement?.type === 'image';

  const fieldClass =
    'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">

      {/* ═══ TOP TOOLBAR ═══════════════════════════════════════════════════════ */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-800 bg-gray-900 px-4">
        {/* Close */}
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition"
        >
          <X size={16} />
          <span className="hidden sm:inline">Close</span>
        </button>

        <div className="h-5 w-px bg-gray-700" />

        {/* Template name */}
        <span className="max-w-[180px] truncate text-sm font-semibold text-white">
          {templateName}
        </span>

        {/* Right-side actions */}
        <div className="ml-auto flex items-center gap-2">

          {/* Step 1 — Download Preview */}
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-gray-600 lg:inline">1.</span>
            <button
              onClick={handleDownloadPreview}
              disabled={isDownloading}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                downloadDone
                  ? 'bg-emerald-900/40 text-emerald-400'
                  : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
              }`}
            >
              {downloadDone ? <CheckCircle size={14} /> : <Download size={14} />}
              {isDownloading ? 'Downloading…' : downloadDone ? 'Downloaded' : 'Download Preview'}
            </button>
          </div>

          {/* Step 2 — Upload Preview */}
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-gray-600 lg:inline">2.</span>
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              onChange={handlePreviewUpload}
              className="hidden"
            />
            <button
              onClick={() => uploadRef.current?.click()}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                previewImageUrl
                  ? 'bg-blue-900/50 text-blue-300'
                  : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
              }`}
            >
              {previewImageUrl ? <CheckCircle size={14} /> : <Upload size={14} />}
              {previewImageUrl ? 'Preview Uploaded' : 'Upload Preview'}
            </button>
            {previewImageUrl && (
              <img
                src={previewImageUrl}
                alt="Uploaded preview thumbnail"
                className="h-8 w-12 rounded border border-gray-600 object-cover"
              />
            )}
          </div>

          {/* Save Draft */}
          <button
            onClick={() => onSave(currentTemplate)}
            disabled={isLoading}
            className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-600 transition disabled:opacity-50"
          >
            {isLoading ? 'Saving…' : 'Save Draft'}
          </button>

          {/* Step 3 — Publish Template */}
          {onPublish && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-gray-600 lg:inline">3.</span>
              <button
                onClick={handlePublish}
                disabled={!previewImageUrl || isPublishing}
                title={!previewImageUrl ? 'Upload a preview image first (step 2)' : ''}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700 transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={14} />
                {isPublishing ? 'Publishing…' : 'Publish Template'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MAIN BUILDER AREA ═════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── LEFT PANEL — Elements ───────────────────────────────────────── */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Elements</p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {PALETTE_ITEMS.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDraggedItem(item)}
                onClick={() => addElement(item)}
                className="flex cursor-grab items-center gap-2.5 rounded-lg px-2.5 py-2 text-gray-300 hover:bg-gray-800 hover:text-white transition select-none active:cursor-grabbing"
              >
                <span className="w-5 shrink-0 text-center text-sm leading-none">{item.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none">{item.label}</p>
                  <p className="mt-0.5 truncate text-[11px] text-gray-600">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Layers section */}
          {currentTemplate.elements.length > 0 && (
            <>
              <div className="border-t border-gray-800 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Layers</p>
              </div>
              <div className="max-h-44 overflow-y-auto p-2 space-y-0.5">
                {[...currentTemplate.elements].reverse().map((el) => (
                  <div
                    key={el.id}
                    onClick={() => setSelectedElementId(el.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer transition ${
                      selectedElementId === el.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span className="flex-1 truncate text-xs font-medium">
                      {el.type} · {el.id.split('-').slice(-1)[0]}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteElement(el.id);
                      }}
                      className="shrink-0 text-gray-600 hover:text-red-400 transition"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-gray-800 px-3 py-2">
            <p className="text-[10px] text-gray-700">Drag or click to add</p>
          </div>
        </aside>

        {/* ─── CENTER — Canvas ─────────────────────────────────────────────── */}
        <div
          className="flex flex-1 flex-col items-center justify-center overflow-auto bg-gray-950 p-8"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleCanvasDrop}
        >
          <div
            className="shadow-2xl"
            style={{
              aspectRatio:
                currentTemplate.aspectRatio === '1:1'
                  ? '1/1'
                  : currentTemplate.aspectRatio === '4:5'
                    ? '4/5'
                    : currentTemplate.aspectRatio === '16:9'
                      ? '16/9'
                      : '9/16',
              width: '100%',
              maxWidth: '640px',
              cursor: draggedItem ? 'copy' : 'default',
            }}
          >
            <CardPreviewCanvas
              cardRef={cardRef}
              template={currentTemplate}
              selectedElementId={selectedElementId}
              onSelectElement={setSelectedElementId}
              interactive
              stageTone="dark"
            />
          </div>

          {currentTemplate.elements.length === 0 && (
            <p className="mt-6 text-sm text-gray-600">
              Drag elements from the left panel, or click an item to add it
            </p>
          )}

          {/* Aspect ratio selector */}
          <div className="mt-6 flex items-center gap-2">
            <span className="text-xs text-gray-600">Canvas:</span>
            {(['1:1', '16:9', '4:5', '9:16'] as const).map((ratio) => (
              <button
                key={ratio}
                onClick={() =>
                  setCurrentTemplate((prev) => ({ ...prev, aspectRatio: ratio }))
                }
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  currentTemplate.aspectRatio === ratio
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        {/* ─── RIGHT PANEL — Settings ──────────────────────────────────────── */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-gray-800 bg-gray-900">
          {/* Tab bar */}
          <div className="grid grid-cols-3 border-b border-gray-800">
            {(['Content', 'Style', 'Advanced'] as SettingsTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setSettingsTab(tab)}
                className={`border-b-2 py-3 text-xs font-semibold uppercase tracking-wide transition ${
                  settingsTab === tab
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-600 hover:text-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {!selectedElement ? (
              <div className="py-10 text-center">
                <p className="text-sm text-gray-600">Select an element on the canvas to edit it</p>
              </div>
            ) : (
              <>
                {/* ── CONTENT TAB ─────────────────────────────────────────── */}
                {settingsTab === 'Content' && (
                  <div className="space-y-4">
                    <div>
                      <label className={labelClass}>{isImageEl ? 'Image URL' : 'Content'}</label>
                      {isImageEl ? (
                        <input
                          type="text"
                          value={selectedElement.src || ''}
                          onChange={(e) => updateEl(selectedElement.id, { src: e.target.value })}
                          placeholder="https://example.com/image.jpg"
                          className={fieldClass}
                        />
                      ) : (
                        <textarea
                          value={selectedElement.content || ''}
                          onChange={(e) => updateEl(selectedElement.id, { content: e.target.value })}
                          rows={3}
                          className={`${fieldClass} resize-none`}
                        />
                      )}
                    </div>

                    {/* Position */}
                    <div>
                      <label className={labelClass}>Position</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['x', 'y'] as const).map((axis) => (
                          <div key={axis}>
                            <p className="mb-1 text-xs text-gray-600">{axis.toUpperCase()} (%)</p>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={Math.round(selectedElement.frame[axis])}
                              onChange={(e) =>
                                updateEl(selectedElement.id, {
                                  frame: {
                                    ...selectedElement.frame,
                                    [axis]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                                  },
                                })
                              }
                              className={fieldClass}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Size */}
                    <div>
                      <label className={labelClass}>Size</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([['width', 'W'], ['height', 'H']] as const).map(([field, abbr]) => (
                          <div key={field}>
                            <p className="mb-1 text-xs text-gray-600">{abbr} (%)</p>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={Math.round(selectedElement.frame[field])}
                              onChange={(e) =>
                                updateEl(selectedElement.id, {
                                  frame: {
                                    ...selectedElement.frame,
                                    [field]: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                                  },
                                })
                              }
                              className={fieldClass}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Alt text for images */}
                    {isImageEl && (
                      <div>
                        <label className={labelClass}>Alt Text</label>
                        <input
                          type="text"
                          value={selectedElement.alt || ''}
                          onChange={(e) => updateEl(selectedElement.id, { alt: e.target.value })}
                          className={fieldClass}
                        />
                      </div>
                    )}

                    {/* Element actions */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => duplicateElement(selectedElement.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition"
                      >
                        <Copy size={13} />
                        Duplicate
                      </button>
                      <button
                        onClick={() => deleteElement(selectedElement.id)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-red-950/50 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── STYLE TAB ────────────────────────────────────────────── */}
                {settingsTab === 'Style' && (
                  <div className="space-y-4">
                    {isTextLike && (
                      <div>
                        <label className={labelClass}>Text Color</label>
                        <ColorPickerField
                          value={selectedElement.styles.color}
                          onChange={(color) => updateStyles(selectedElement.id, { color })}
                        />
                      </div>
                    )}

                    <div>
                      <label className={labelClass}>Background</label>
                      <select
                        value={selectedElement.styles.backgroundType}
                        onChange={(e) =>
                          updateStyles(selectedElement.id, {
                            backgroundType: e.target.value as CardElement['styles']['backgroundType'],
                          })
                        }
                        className={fieldClass}
                      >
                        <option value="none">None</option>
                        <option value="solid">Solid Color</option>
                        <option value="gradient">Gradient</option>
                      </select>
                    </div>

                    {selectedElement.styles.backgroundType === 'solid' && (
                      <div>
                        <label className={labelClass}>Background Color</label>
                        <ColorPickerField
                          value={selectedElement.styles.backgroundColor}
                          onChange={(backgroundColor) =>
                            updateStyles(selectedElement.id, { backgroundColor })
                          }
                        />
                      </div>
                    )}

                    {selectedElement.styles.backgroundType === 'gradient' && (
                      <GradientPickerField
                        styles={selectedElement.styles}
                        onChange={(patch) => updateStyles(selectedElement.id, patch)}
                      />
                    )}

                    {isTextLike && (
                      <>
                        <div>
                          <label className={labelClass}>Font Size (px)</label>
                          <input
                            type="number"
                            min={8}
                            max={200}
                            value={selectedElement.styles.fontSize}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                fontSize: Math.max(8, Number(e.target.value) || 8),
                              })
                            }
                            className={fieldClass}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>Font Weight</label>
                          <select
                            value={selectedElement.styles.fontWeight}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                fontWeight: Number(e.target.value) as 400 | 500 | 600 | 700 | 800,
                              })
                            }
                            className={fieldClass}
                          >
                            <option value={400}>Regular (400)</option>
                            <option value={500}>Medium (500)</option>
                            <option value={600}>Semibold (600)</option>
                            <option value={700}>Bold (700)</option>
                            <option value={800}>Extrabold (800)</option>
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>Text Align</label>
                          <div className="grid grid-cols-3 gap-1">
                            {(['left', 'center', 'right'] as const).map((align) => (
                              <button
                                key={align}
                                onClick={() => updateStyles(selectedElement.id, { textAlign: align })}
                                className={`rounded-lg py-1.5 text-xs font-medium capitalize transition ${
                                  selectedElement.styles.textAlign === align
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                }`}
                              >
                                {align}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    <div>
                      <label className={labelClass}>Border Radius (px)</label>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={selectedElement.styles.borderRadius}
                        onChange={(e) =>
                          updateStyles(selectedElement.id, {
                            borderRadius: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className={fieldClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Opacity</label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedElement.styles.opacity}
                        onChange={(e) =>
                          updateStyles(selectedElement.id, { opacity: Number(e.target.value) })
                        }
                        className="w-full accent-blue-500"
                      />
                      <p className="mt-1 text-right text-xs text-gray-600">
                        {Math.round(selectedElement.styles.opacity * 100)}%
                      </p>
                    </div>
                  </div>
                )}

                {/* ── ADVANCED TAB ─────────────────────────────────────────── */}
                {settingsTab === 'Advanced' && (
                  <div className="space-y-4">
                    {isTextLike && (
                      <>
                        <div>
                          <label className={labelClass}>Font Family</label>
                          <select
                            value={selectedElement.styles.fontFamily}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, { fontFamily: e.target.value })
                            }
                            className={fieldClass}
                          >
                            {[
                              'Urbanist',
                              'Inter',
                              'Arial',
                              'Helvetica',
                              'Georgia',
                              'Times New Roman',
                              'Courier New',
                              'Verdana',
                              'Trebuchet MS',
                              'Impact',
                            ].map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>Letter Spacing (px)</label>
                          <input
                            type="number"
                            min={-5}
                            max={20}
                            step={0.5}
                            value={selectedElement.styles.letterSpacing}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                letterSpacing: Number(e.target.value) || 0,
                              })
                            }
                            className={fieldClass}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>Line Height</label>
                          <input
                            type="number"
                            min={0.5}
                            max={5}
                            step={0.1}
                            value={selectedElement.styles.lineHeight}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                lineHeight: Number(e.target.value) || 1,
                              })
                            }
                            className={fieldClass}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>Text Transform</label>
                          <select
                            value={selectedElement.styles.textTransform}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                textTransform: e.target.value as CardElement['styles']['textTransform'],
                              })
                            }
                            className={fieldClass}
                          >
                            <option value="none">None</option>
                            <option value="uppercase">UPPERCASE</option>
                            <option value="lowercase">lowercase</option>
                            <option value="capitalize">Capitalize</option>
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>Font Style</label>
                          <div className="grid grid-cols-2 gap-1">
                            {(['normal', 'italic'] as const).map((fs) => (
                              <button
                                key={fs}
                                onClick={() => updateStyles(selectedElement.id, { fontStyle: fs })}
                                className={`rounded-lg py-1.5 text-xs font-medium capitalize transition ${
                                  selectedElement.styles.fontStyle === fs
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                }`}
                              >
                                {fs}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {isImageEl && (
                      <div>
                        <label className={labelClass}>Object Fit</label>
                        <div className="grid grid-cols-2 gap-1">
                          {(['cover', 'contain'] as const).map((fit) => (
                            <button
                              key={fit}
                              onClick={() => updateStyles(selectedElement.id, { objectFit: fit })}
                              className={`rounded-lg py-1.5 text-xs font-medium capitalize transition ${
                                selectedElement.styles.objectFit === fit
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                              }`}
                            >
                              {fit}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Border */}
                    <div>
                      <label className={labelClass}>Border</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="mb-1 text-xs text-gray-600">Width (px)</p>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={selectedElement.styles.borderWidth}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                borderWidth: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-gray-600">Style</p>
                          <select
                            value={selectedElement.styles.borderStyle}
                            onChange={(e) =>
                              updateStyles(selectedElement.id, {
                                borderStyle: e.target.value as CardElement['styles']['borderStyle'],
                              })
                            }
                            className={fieldClass}
                          >
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                          </select>
                        </div>
                      </div>
                      {selectedElement.styles.borderWidth > 0 && (
                        <div className="mt-2">
                          <p className="mb-1.5 text-xs text-gray-600">Border Color</p>
                          <ColorPickerField
                            value={selectedElement.styles.borderColor}
                            onChange={(borderColor) =>
                              updateStyles(selectedElement.id, { borderColor })
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Canvas Background — always visible at bottom */}
            <div className="border-t border-gray-800 pt-5">
              <p className={labelClass}>Canvas Background</p>
              <GradientPickerField
                styles={currentTemplate.background}
                onChange={(bg) =>
                  setCurrentTemplate((prev) => ({
                    ...prev,
                    background: { ...prev.background, ...bg },
                  }))
                }
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CardBuilder;
