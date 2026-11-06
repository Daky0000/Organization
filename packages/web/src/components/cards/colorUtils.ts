export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

export interface ColorPickerResult {
  hex: string;
  rgba: string;
  opacity: number;
  hsva: HsvaColor;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeHex = (value: string) => {
  const raw = value.trim().replace('#', '');
  if (raw.length === 3) {
    return `#${raw
      .split('')
      .map((part) => `${part}${part}`)
      .join('')}`.toLowerCase();
  }
  if (raw.length === 6) {
    return `#${raw}`.toLowerCase();
  }
  return '#000000';
};

export const parseColor = (value: string): RgbaColor => {
  const hexMatch = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = normalizeHex(value).slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgbaMatch = value
    .trim()
    .match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbaMatch) {
    return {
      r: clamp(Number(rgbaMatch[1]), 0, 255),
      g: clamp(Number(rgbaMatch[2]), 0, 255),
      b: clamp(Number(rgbaMatch[3]), 0, 255),
      a: clamp(Number(rgbaMatch[4] ?? 1), 0, 1),
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
};

export const rgbaToHex = ({ r, g, b }: RgbaColor) =>
  `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`.toLowerCase();

export const rgbaToString = (rgba: RgbaColor) =>
  rgba.a >= 0.999
    ? rgbaToHex(rgba)
    : `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${rgba.a.toFixed(2)})`;

export const rgbaToHsva = ({ r, g, b, a }: RgbaColor): HsvaColor => {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rr) {
      h = ((gg - bb) / delta) % 6;
    } else if (max === gg) {
      h = (bb - rr) / delta + 2;
    } else {
      h = (rr - gg) / delta + 4;
    }
  }

  return {
    h: Math.round(((h * 60) + 360) % 360),
    s: max === 0 ? 0 : delta / max,
    v: max,
    a,
  };
};

export const hsvaToRgba = ({ h, s, v, a }: HsvaColor): RgbaColor => {
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hh >= 0 && hh < 1) {
    r = c;
    g = x;
  } else if (hh >= 1 && hh < 2) {
    r = x;
    g = c;
  } else if (hh >= 2 && hh < 3) {
    g = c;
    b = x;
  } else if (hh >= 3 && hh < 4) {
    g = x;
    b = c;
  } else if (hh >= 4 && hh < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a,
  };
};

export const colorResultFromHsva = (hsva: HsvaColor): ColorPickerResult => {
  const rgbaColor = hsvaToRgba(hsva);
  return {
    hex: rgbaToHex(rgbaColor),
    rgba: rgbaToString(rgbaColor),
    opacity: hsva.a,
    hsva,
  };
};
