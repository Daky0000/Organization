import { Type, Image, Square, Circle, Minus, AlignLeft } from 'lucide-react';

interface ElementsPanelProps {
  onAddText: (style?: 'heading' | 'body') => void;
  onAddRect: () => void;
  onAddCircle: () => void;
  onAddLine: () => void;
  onUploadImage: () => void;
  onSetBackground: (color: string) => void;
}

const FONTS = [
  'Inter', 'Georgia', 'Times New Roman', 'Arial', 'Helvetica',
  'Courier New', 'Verdana', 'Trebuchet MS', 'Impact',
];

interface SectionProps { title: string; children: React.ReactNode }
function Section({ title, children }: SectionProps) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{title}</p>
      {children}
    </div>
  );
}

interface ElemBtnProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}
function ElemBtn({ icon, label, onClick }: ElemBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98]"
    >
      <span className="text-zinc-500">{icon}</span>
      {label}
    </button>
  );
}

const BG_PRESETS = [
  '#ffffff', '#000000', '#1e293b', '#0f172a',
  '#e6332a', '#2563eb', '#16a34a', '#d97706',
  '#f1f5f9', '#fef2f2', '#eff6ff', '#f0fdf4',
];

export default function ElementsPanel({
  onAddText,
  onAddRect,
  onAddCircle,
  onAddLine,
  onUploadImage,
  onSetBackground,
}: ElementsPanelProps) {
  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Text */}
      <Section title="Text">
        <div className="flex flex-col gap-2">
          <ElemBtn icon={<Type size={16} />} label="Add Heading" onClick={() => onAddText('heading')} />
          <ElemBtn icon={<AlignLeft size={16} />} label="Add Body Text" onClick={() => onAddText('body')} />
        </div>
      </Section>

      {/* Images */}
      <Section title="Images">
        <ElemBtn icon={<Image size={16} />} label="Upload Image" onClick={onUploadImage} />
      </Section>

      {/* Shapes */}
      <Section title="Shapes">
        <div className="flex flex-col gap-2">
          <ElemBtn icon={<Square size={16} />} label="Rectangle" onClick={onAddRect} />
          <ElemBtn icon={<Circle size={16} />} label="Ellipse" onClick={onAddCircle} />
          <ElemBtn icon={<Minus size={16} />} label="Line" onClick={onAddLine} />
        </div>
      </Section>

      {/* Background */}
      <Section title="Background">
        <div className="grid grid-cols-6 gap-1.5">
          {BG_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onSetBackground(color)}
              title={color}
              className="h-7 w-7 rounded-lg border border-zinc-200 transition hover:scale-110 hover:border-zinc-400"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-500 cursor-pointer">
          Custom color
          <input
            type="color"
            defaultValue="#ffffff"
            onChange={(e) => onSetBackground(e.target.value)}
            className="h-7 w-14 cursor-pointer rounded border border-zinc-200"
          />
        </label>
      </Section>

      {/* Font reference */}
      <Section title="Available Fonts">
        <div className="flex flex-col gap-1">
          {FONTS.map((f) => (
            <span key={f} className="truncate text-xs text-zinc-500" style={{ fontFamily: f }}>
              {f}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
