import { useState, useEffect } from 'react';
import * as fabric from 'fabric';
import { Type, ImageIcon, Square, Minus, Eye, EyeOff, Layers } from 'lucide-react';

interface LayersPanelProps {
  canvas: fabric.Canvas | null;
  selectedObjects: fabric.FabricObject[];
}

function getLabel(obj: fabric.FabricObject, i: number): string {
  if (obj instanceof fabric.IText || obj instanceof fabric.FabricText) {
    const t = (obj as fabric.IText).text?.trim() ?? '';
    return t.slice(0, 18) || `Text ${i + 1}`;
  }
  if (obj instanceof fabric.FabricImage) return `Image ${i + 1}`;
  if (obj instanceof fabric.Rect) return `Rectangle ${i + 1}`;
  if (obj instanceof fabric.Ellipse) return `Ellipse ${i + 1}`;
  if (obj instanceof fabric.Circle) return `Circle ${i + 1}`;
  if (obj instanceof fabric.Line) return `Line ${i + 1}`;
  return `Layer ${i + 1}`;
}

function getIcon(obj: fabric.FabricObject) {
  if (obj instanceof fabric.IText || obj instanceof fabric.FabricText) return <Type size={12} />;
  if (obj instanceof fabric.FabricImage) return <ImageIcon size={12} />;
  if (obj instanceof fabric.Line) return <Minus size={12} />;
  return <Square size={12} />;
}

export default function LayersPanel({ canvas, selectedObjects }: LayersPanelProps) {
  const [, tick] = useState(0);
  const refresh = () => tick((n) => n + 1);

  useEffect(() => {
    if (!canvas) return;
    const evts = ['object:added', 'object:removed', 'object:modified', 'selection:created', 'selection:cleared', 'selection:updated'] as const;
    evts.forEach((ev) => canvas.on(ev, refresh));
    return () => evts.forEach((ev) => canvas.off(ev, refresh));
  }, [canvas]);

  if (!canvas) {
    return (
      <div className="flex h-40 flex-col items-center justify-center text-center">
        <Layers size={22} className="mb-2 text-zinc-200" />
        <p className="text-xs text-zinc-400">No canvas</p>
      </div>
    );
  }

  const objects = [...canvas.getObjects()].reverse();

  if (objects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
        <Layers size={22} className="mb-2 text-zinc-200" />
        <p className="text-xs font-medium text-zinc-400">No layers yet</p>
        <p className="mt-0.5 text-[10px] text-zinc-300">Add elements using the toolbar below</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {objects.map((obj, i) => {
        const selected = selectedObjects.includes(obj);
        const label = getLabel(obj, objects.length - 1 - i);
        const visible = obj.visible !== false;

        return (
          <div
            key={i}
            onClick={() => {
              canvas.discardActiveObject();
              canvas.setActiveObject(obj);
              canvas.requestRenderAll();
            }}
            className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition ${
              selected ? 'bg-blue-50 text-blue-700' : 'text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            <span className={`shrink-0 ${selected ? 'text-blue-500' : 'text-zinc-400'}`}>
              {getIcon(obj)}
            </span>
            <span className="flex-1 truncate text-xs font-medium">{label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                obj.set('visible', !visible);
                canvas.requestRenderAll();
                refresh();
              }}
              className={`shrink-0 transition-opacity ${selected || !visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${visible ? 'text-zinc-400 hover:text-zinc-600' : 'text-zinc-300'}`}
            >
              {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
