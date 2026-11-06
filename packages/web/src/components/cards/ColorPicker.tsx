import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clamp,
  colorResultFromHsva,
  HsvaColor,
  parseColor,
  rgbaToHsva,
  rgbaToString,
} from './colorUtils';

interface ColorPickerProps {
  value: string;
  onChange: (color: {
    hex: string;
    rgba: string;
    opacity: number;
    hsva: HsvaColor;
  }) => void;
}

const ColorPicker = ({ value, onChange }: ColorPickerProps) => {
  const satRef = useRef<HTMLDivElement | null>(null);
  const [draftRgb, setDraftRgb] = useState('');

  const hsva = useMemo(() => rgbaToHsva(parseColor(value)), [value]);
  const rgba = useMemo(() => {
    const parsed = parseColor(value);
    return `rgb(${Math.round(parsed.r)},${Math.round(parsed.g)},${Math.round(parsed.b)})`;
  }, [value]);

  useEffect(() => {
    setDraftRgb(rgba);
  }, [rgba]);

  const emit = (next: HsvaColor) => {
    onChange(colorResultFromHsva(next));
  };

  const updateSaturationValue = (clientX: number, clientY: number) => {
    if (!satRef.current) {
      return;
    }

    const rect = satRef.current.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    emit({ ...hsva, s, v });
  };

  const handleSatPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateSaturationValue(event.clientX, event.clientY);

    const handleMove = (moveEvent: PointerEvent) => updateSaturationValue(moveEvent.clientX, moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div className="w-[min(304px,calc(100vw-24px))] rounded-[15px] border border-[#d9d4ca] bg-[#f4f3ef] p-3 shadow-[0_14px_30px_rgba(15,23,42,0.18)]">
      <div
        ref={satRef}
        onPointerDown={handleSatPointer}
        className="relative h-[180px] w-full cursor-crosshair overflow-hidden rounded-[10px] focus:outline-none"
        style={{ backgroundColor: `hsl(${hsva.h} 100% 50%)` }}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsva.s * 100)}
        tabIndex={0}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div
          className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: `${hsva.s * 100}%`,
            top: `${(1 - hsva.v) * 100}%`,
          }}
        />
      </div>

      <div className="mt-3 space-y-3">
        <input
          type="range"
          min="0"
          max="360"
          value={hsva.h}
          aria-label="Hue"
          onChange={(event) => emit({ ...hsva, h: Number(event.target.value) })}
          className="h-[12px] w-full cursor-pointer appearance-none rounded-full bg-[linear-gradient(90deg,#ff3b30,#ff9500,#ffcc00,#34c759,#5ac8fa,#007aff,#5856d6,#ff2d55,#ff3b30)]"
        />

        <div className="relative h-[12px] overflow-hidden rounded-full border border-slate-200 bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%,transparent_75%,#d1d5db_75%,#d1d5db),linear-gradient(45deg,#d1d5db_25%,transparent_25%,transparent_75%,#d1d5db_75%,#d1d5db)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(90deg, ${rgbaToString({ ...parseColor(value), a: 0 })}, ${rgbaToString({ ...parseColor(value), a: 1 })})`,
            }}
          />
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(hsva.a * 100)}
            aria-label="Opacity"
            onChange={(event) => emit({ ...hsva, a: Number(event.target.value) / 100 })}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
          />
        </div>

        <div className="grid grid-cols-[54px_minmax(0,1fr)_54px] gap-2">
          <div className="flex h-9 min-w-0 items-center justify-center rounded-[10px] border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700">
            RGB
          </div>

          <input
            type="text"
            value={draftRgb}
            aria-label="Color value"
            onChange={(event) => setDraftRgb(event.target.value)}
            onBlur={() => {
              const parsed = parseColor(draftRgb);
              const nextHsva = rgbaToHsva(parsed);
              setDraftRgb(`rgb(${parsed.r},${parsed.g},${parsed.b})`);
              emit({ ...nextHsva, a: hsva.a });
            }}
            className="h-9 min-w-0 rounded-[10px] border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none"
          />

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_16px] items-center overflow-hidden rounded-[10px] border border-slate-300 bg-white">
            <input
              type="text"
              value={Math.round(hsva.a * 100)}
              aria-label="Opacity percent"
              inputMode="numeric"
              onChange={(event) => {
                const digitsOnly = event.target.value.replace(/[^\d]/g, '');
                const nextValue = digitsOnly === '' ? 0 : clamp(Number(digitsOnly), 0, 100);
                emit({ ...hsva, a: nextValue / 100 });
              }}
              className="h-9 min-w-0 w-full px-1.5 text-[11px] text-slate-700 outline-none"
            />
            <div className="border-l border-slate-200 text-center text-[9px] text-slate-500">%</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColorPicker;
