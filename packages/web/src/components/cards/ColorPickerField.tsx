import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import ColorPicker from './ColorPicker';
import { normalizeHex } from './colorUtils';

interface ColorPickerFieldProps {
  value: string;
  onChange: (value: string) => void;
}

const ColorPickerField = ({ value, onChange }: ColorPickerFieldProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = rootRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current) {
        return;
      }

      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = Math.min(304, window.innerWidth - 24);
      const panelHeight = 340;
      const gutter = 16;

      let left = rect.left + rect.width / 2 - panelWidth / 2;
      let top = rect.top + rect.height + 12;

      if (left < gutter) {
        left = gutter;
      }

      if (left + panelWidth > window.innerWidth - gutter) {
        left = window.innerWidth - panelWidth - gutter;
      }

      if (top + panelHeight > window.innerHeight - gutter) {
        top = rect.top - panelHeight - 12;
      }

      if (top < gutter) {
        top = gutter;
      }

      setPanelPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center gap-3 rounded-2xl border border-slate-300 bg-white px-3"
      >
        <span
          className="h-6 w-6 rounded-full border border-white shadow-sm"
          style={{ backgroundColor: value }}
        />
        <span className="min-w-0 flex-1 truncate text-left text-sm text-slate-700">
          {value.startsWith('rgba') ? value : normalizeHex(value)}
        </span>
        <ChevronDown size={16} className="text-slate-500" />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50"
            style={{ top: `${panelPosition.top}px`, left: `${panelPosition.left}px` }}
          >
            <ColorPicker
              value={value}
              onChange={(color) => {
                onChange(color.rgba);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
};

export default ColorPickerField;
