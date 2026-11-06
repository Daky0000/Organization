import { useId, useMemo, useRef, type ChangeEvent } from 'react';
import {
  Droplets,
  GalleryHorizontal,
  Image as ImageIcon,
  PaintBucket,
  Pipette,
  Plus,
  Sparkles,
  Wallpaper,
  X,
} from 'lucide-react';

export type StyleAssetMode = 'solid' | 'gradient' | 'image';
type ImageSize = 'auto' | 'cover' | 'contain' | 'custom';
type ImageRepeat = 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';

export interface StyleAssetValue {
  type: StyleAssetMode;
  solidColor: string;
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  imageUrl: string;
  imageSize: ImageSize;
  imageRepeat: ImageRepeat;
  imagePosition: {
    x: number;
    y: number;
  };
  imageSizeCustom: {
    width: number;
    height: number;
  };
}

interface StyleAssetPickerProps {
  label: string;
  value: StyleAssetValue;
  onChange: (value: StyleAssetValue) => void;
  modes?: StyleAssetMode[];
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
}

const modeIcons = {
  solid: PaintBucket,
  gradient: GalleryHorizontal,
  image: ImageIcon,
};

const defaultLibraries: Record<StyleAssetMode, string[]> = {
  solid: ['#0f172a', '#ffffff', '#f97316', '#22c55e', '#2563eb', '#ec4899'],
  gradient: ['#667eea,#764ba2', '#f97316,#7c2d12', '#14b8a6,#0f766e', '#3b82f6,#06b6d4'],
  image: [],
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const applyColor = (value: StyleAssetValue) => {
  if (value.type === 'solid') {
    return { backgroundColor: value.solidColor };
  }

  if (value.type === 'gradient') {
    return {
      backgroundImage: `linear-gradient(${value.gradientAngle}deg, ${value.gradientStart}, ${value.gradientEnd})`,
    };
  }

  const backgroundSize =
    value.imageSize === 'custom'
      ? `${value.imageSizeCustom.width}% ${value.imageSizeCustom.height}%`
      : value.imageSize;

  return {
    backgroundColor: '#f3f4f6',
    backgroundImage: value.imageUrl ? `url("${value.imageUrl}")` : undefined,
    backgroundPosition: `${value.imagePosition.x}% ${value.imagePosition.y}%`,
    backgroundRepeat: value.imageRepeat,
    backgroundSize,
  };
};

const Slider = ({
  value,
  min,
  max,
  step,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  className: string;
}) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={(event) => onChange(Number(event.target.value))}
    className={`h-3 w-full cursor-pointer appearance-none rounded-full ${className}`}
  />
);

const StyleAssetPicker = ({
  label,
  value,
  onChange,
  modes = ['solid', 'gradient', 'image'],
  opacity,
  onOpacityChange,
}: StyleAssetPickerProps) => {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentColor = useMemo(() => {
    if (value.type === 'solid') {
      return value.solidColor;
    }

    if (value.type === 'gradient') {
      return value.gradientEnd;
    }

    return '#ffffff';
  }, [value]);

  const update = (patch: Partial<StyleAssetValue>) => {
    onChange({ ...value, ...patch });
  };

  const updateImage = (patch: Partial<StyleAssetValue['imagePosition']>) => {
    update({
      imagePosition: {
        ...value.imagePosition,
        ...patch,
      },
    });
  };

  const updateImageSize = (patch: Partial<StyleAssetValue['imageSizeCustom']>) => {
    update({
      imageSizeCustom: {
        ...value.imageSizeCustom,
        ...patch,
      },
    });
  };

  const readFile = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      update({
        type: 'image',
        imageUrl: String(reader.result ?? ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const libraries = defaultLibraries[value.type];

  return (
    <div className="rounded-[28px] border border-gray-200 bg-[#f6f3ef] p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="rounded-full bg-white/80 p-1 shadow-sm">
          <div className="flex items-center gap-1 rounded-full bg-gray-100 p-1 text-xs font-medium text-gray-500">
            <button className="rounded-full bg-white px-3 py-1 text-gray-900 shadow-sm">{label}</button>
            <button className="rounded-full px-3 py-1">Libraries</button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="rounded-full p-2 text-gray-700 transition-colors hover:bg-white">
            <Plus size={16} />
          </button>
          <button className="rounded-full p-2 text-gray-700 transition-colors hover:bg-white">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-2xl border border-gray-200 bg-[#efede9] p-2">
        <div className="flex items-center gap-2">
          {modes.map((mode) => {
            const Icon = modeIcons[mode];
            const isActive = value.type === mode;

            return (
              <button
                key={mode}
                type="button"
                onClick={() => update({ type: mode })}
                className={`rounded-xl border p-2 transition-colors ${
                  isActive ? 'border-gray-900 bg-white text-gray-900 shadow-sm' : 'border-transparent text-gray-500 hover:bg-white'
                }`}
                aria-label={mode}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 text-gray-500">
          <button className="rounded-xl p-2 transition-colors hover:bg-white">
            <Sparkles size={16} />
          </button>
          <button className="rounded-xl p-2 transition-colors hover:bg-white">
            <Droplets size={16} />
          </button>
          <button className="rounded-xl p-2 transition-colors hover:bg-white">
            <Pipette size={16} />
          </button>
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl border border-gray-300 bg-white">
        <div
          className="relative h-56 w-full"
          style={{
            ...applyColor(value),
            opacity: value.type === 'image' && typeof opacity === 'number' ? clamp(opacity, 0, 1) : 1,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/75 via-transparent to-black/90" />
          <div
            className="absolute inset-y-0 left-0 w-12 rounded-full bg-white/80 shadow"
            style={{ transform: 'translateX(-50%)' }}
          />
          {!value.imageUrl && value.type === 'image' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-600">
              <Wallpaper size={24} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm"
              >
                Upload media
              </button>
            </div>
          )}
        </div>
      </div>

      {libraries.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {libraries.map((entry) => {
            const style =
              value.type === 'gradient'
                ? { backgroundImage: `linear-gradient(135deg, ${entry.replace(',', ', ')})` }
                : { backgroundColor: entry };

            return (
              <button
                key={entry}
                type="button"
                onClick={() => {
                  if (value.type === 'solid') {
                    update({ solidColor: entry });
                  }

                  if (value.type === 'gradient') {
                    const [gradientStart, gradientEnd] = entry.split(',');
                    update({ gradientStart, gradientEnd });
                  }
                }}
                className="h-8 w-8 rounded-full border border-white shadow-sm"
                style={style}
              />
            );
          })}
        </div>
      )}

      {value.type === 'solid' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              id={`${inputId}-solid`}
              type="color"
              value={value.solidColor}
              onChange={(event) => update({ solidColor: event.target.value })}
              className="h-12 w-12 cursor-pointer rounded-xl border border-gray-200 bg-transparent"
            />
            <input
              type="text"
              value={value.solidColor}
              onChange={(event) => update({ solidColor: event.target.value })}
              className="h-12 flex-1 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-900"
            />
          </div>
        </div>
      )}

      {value.type === 'gradient' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-2">
              <input
                type="color"
                value={value.gradientStart}
                onChange={(event) => update({ gradientStart: event.target.value })}
                className="h-10 w-10 cursor-pointer rounded-xl border border-gray-200 bg-transparent"
              />
              <input
                type="text"
                value={value.gradientStart}
                onChange={(event) => update({ gradientStart: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium uppercase text-gray-900"
              />
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-2">
              <input
                type="color"
                value={value.gradientEnd}
                onChange={(event) => update({ gradientEnd: event.target.value })}
                className="h-10 w-10 cursor-pointer rounded-xl border border-gray-200 bg-transparent"
              />
              <input
                type="text"
                value={value.gradientEnd}
                onChange={(event) => update({ gradientEnd: event.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium uppercase text-gray-900"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-medium text-gray-700">
              <span>Angle</span>
              <span>{value.gradientAngle}°</span>
            </div>
            <Slider
              value={value.gradientAngle}
              min={0}
              max={360}
              onChange={(next) => update({ gradientAngle: next })}
              className="bg-gradient-to-r from-amber-500 via-sky-500 to-fuchsia-500"
            />
          </div>
        </div>
      )}

      {value.type === 'image' && (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={readFile}
            className="hidden"
          />

          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
            >
              <ImageIcon size={16} />
              Choose media
            </button>
            <p className="text-xs text-gray-500">Upload an image or paste a media URL.</p>
          </div>

          <input
            type="text"
            value={value.imageUrl}
            onChange={(event) => update({ imageUrl: event.target.value })}
            placeholder="https://example.com/asset.jpg"
            className="h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">X Position</div>
              <Slider
                value={value.imagePosition.x}
                min={0}
                max={100}
                onChange={(next) => updateImage({ x: next })}
                className="bg-gradient-to-r from-gray-200 via-gray-400 to-gray-700"
              />
            </label>
            <label className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Y Position</div>
              <Slider
                value={value.imagePosition.y}
                min={0}
                max={100}
                onChange={(next) => updateImage({ y: next })}
                className="bg-gradient-to-r from-gray-200 via-gray-400 to-gray-700"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <select
              value={value.imageSize}
              onChange={(event) => update({ imageSize: event.target.value as ImageSize })}
              className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900"
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="auto">Auto</option>
              <option value="custom">Custom</option>
            </select>
            <select
              value={value.imageRepeat}
              onChange={(event) => update({ imageRepeat: event.target.value as ImageRepeat })}
              className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900"
            >
              <option value="no-repeat">No repeat</option>
              <option value="repeat">Repeat</option>
              <option value="repeat-x">Repeat X</option>
              <option value="repeat-y">Repeat Y</option>
            </select>
          </div>

          {value.imageSize === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Width</div>
                <Slider
                  value={value.imageSizeCustom.width}
                  min={10}
                  max={200}
                  onChange={(next) => updateImageSize({ width: next })}
                  className="bg-gradient-to-r from-orange-300 to-orange-600"
                />
              </label>
              <label className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Height</div>
                <Slider
                  value={value.imageSizeCustom.height}
                  min={10}
                  max={200}
                  onChange={(next) => updateImageSize({ height: next })}
                  className="bg-gradient-to-r from-orange-300 to-orange-600"
                />
              </label>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <Slider
          value={Math.round(((typeof opacity === 'number' ? opacity : 1) * 100))}
          min={0}
          max={100}
          onChange={(next) => onOpacityChange?.(next / 100)}
          className="bg-gradient-to-r from-[#f97316] via-[#b6f14d] via-40% via-[#48dca9] via-60% via-[#2364ff] to-[#ef4444]"
        />

        <div className="h-4 rounded-full border border-gray-200 bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%,transparent_75%,#d1d5db_75%,#d1d5db),linear-gradient(45deg,#d1d5db_25%,transparent_25%,transparent_75%,#d1d5db_75%,#d1d5db)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]" />

        <div className="grid grid-cols-[96px_1fr_84px] gap-2">
          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-900">
            <span>Hex</span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4">
            <div className="h-5 w-5 rounded-full border border-gray-200" style={{ backgroundColor: currentColor }} />
            <input
              type="text"
              value={value.type === 'solid' ? value.solidColor : value.type === 'gradient' ? value.gradientEnd : currentColor}
              onChange={(event) => {
                if (value.type === 'solid') {
                  update({ solidColor: event.target.value });
                } else if (value.type === 'gradient') {
                  update({ gradientEnd: event.target.value });
                }
              }}
              disabled={value.type === 'image'}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase text-gray-900 disabled:text-gray-400"
            />
          </div>
          <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm font-medium text-gray-900">
            {Math.round(((typeof opacity === 'number' ? opacity : 1) * 100))} %
          </div>
        </div>
      </div>
    </div>
  );
};

export const createStyleAssetValue = (partial?: Partial<StyleAssetValue>): StyleAssetValue => ({
  type: partial?.type ?? 'solid',
  solidColor: partial?.solidColor ?? '#ffffff',
  gradientStart: partial?.gradientStart ?? '#667eea',
  gradientEnd: partial?.gradientEnd ?? '#764ba2',
  gradientAngle: partial?.gradientAngle ?? 135,
  imageUrl: partial?.imageUrl ?? '',
  imageSize: partial?.imageSize ?? 'cover',
  imageRepeat: partial?.imageRepeat ?? 'no-repeat',
  imagePosition: partial?.imagePosition ?? { x: 50, y: 50 },
  imageSizeCustom: partial?.imageSizeCustom ?? { width: 100, height: 100 },
});

export default StyleAssetPicker;
