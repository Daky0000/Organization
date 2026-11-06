import { useState } from 'react';
import { MousePointer2, Type, ImagePlus, Square, Circle, Minus } from 'lucide-react';

interface FloatingToolbarProps {
  onAddText: () => void;
  onUploadImage: () => void;
  onAddRect: () => void;
  onAddCircle: () => void;
  onAddLine: () => void;
}

type ToolId = 'move' | 'text' | 'image' | 'shape';

const SHAPES = [
  { id: 'rect', icon: <Square size={14} />, label: 'Rectangle' },
  { id: 'circle', icon: <Circle size={14} />, label: 'Ellipse' },
  { id: 'line', icon: <Minus size={14} />, label: 'Line' },
];

export default function FloatingToolbar({ onAddText, onUploadImage, onAddRect, onAddCircle, onAddLine }: FloatingToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [shapeOpen, setShapeOpen] = useState(false);

  const tools: { id: ToolId; icon: React.ReactNode; label: string; shortcut: string; onClick?: () => void }[] = [
    { id: 'move', icon: <MousePointer2 size={18} />, label: 'Move', shortcut: 'V' },
    { id: 'text', icon: <Type size={18} />, label: 'Text', shortcut: 'T', onClick: onAddText },
    { id: 'image', icon: <ImagePlus size={18} />, label: 'Image', shortcut: 'I', onClick: onUploadImage },
    { id: 'shape', icon: <Square size={18} />, label: 'Shape', shortcut: 'R' },
  ];

  return (
    <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-2xl border border-zinc-200 bg-white px-2 py-2 shadow-xl">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="relative"
            onMouseEnter={() => setHovered(tool.id)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Tooltip */}
            {hovered === tool.id && (
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
                {tool.label}
                <span className="ml-1.5 text-zinc-400">{tool.shortcut}</span>
                <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
              </div>
            )}

            {tool.id === 'shape' ? (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Shape"
                  onClick={() => setShapeOpen((o) => !o)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100"
                >
                  {tool.icon}
                </button>
                {/* Shape submenu */}
                {shapeOpen && (
                  <div
                    className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl"
                    onMouseLeave={() => setShapeOpen(false)}
                  >
                    <div className="flex flex-col gap-0.5">
                      {SHAPES.map((shape) => (
                        <button
                          key={shape.id}
                          type="button"
                          onClick={() => {
                            setShapeOpen(false);
                            if (shape.id === 'rect') onAddRect();
                            else if (shape.id === 'circle') onAddCircle();
                            else onAddLine();
                          }}
                          className="flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                        >
                          <span className="text-zinc-500">{shape.icon}</span>
                          {shape.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                aria-label={tool.label}
                onClick={tool.onClick}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-600 transition hover:bg-zinc-100"
              >
                {tool.icon}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
