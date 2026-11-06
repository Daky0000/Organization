import { deflateSync } from 'node:zlib';
import jpegJs from 'jpeg-js';

const encodeJpeg = jpegJs.encode;
import type { BrandProfileRecord, CreativeBriefRecord, VideoStoryboardScene as StoryboardScene } from './types.ts';

/**
 * WCAG Relative Luminance calculation per W3C specification:
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = String(hex || '').trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) return { r: 13, g: 21, b: 38 }; // fallback dark ink
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return { r: 13, g: 21, b: 38 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function calculateContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(hexToRgb(foregroundHex));
  const l2 = relativeLuminance(hexToRgb(backgroundHex));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
    }
  }
  return ~c >>> 0;
}

export function ensureAccessibleTextHex(desiredTextHex: string, bgHex: string): string {
  const ratio = calculateContrastRatio(desiredTextHex, bgHex);
  if (ratio >= 4.5) return desiredTextHex;

  const darkInk = '#0D1526';
  const pureWhite = '#FFFFFF';
  return calculateContrastRatio(darkInk, bgHex) >= calculateContrastRatio(pureWhite, bgHex)
    ? darkInk
    : pureWhite;
}

// 5x7 scalable bitmap glyph definitions for clean raster text rendering without canvas
const BITMAP_FONT_5X7: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0],
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x7f, 0x20, 0x18, 0x20, 0x7f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
};

function drawBitmapChar(
  raw: Buffer,
  stride: number,
  canvasWidth: number,
  canvasHeight: number,
  char: string,
  startX: number,
  startY: number,
  scale: number,
  color: { r: number; g: number; b: number }
) {
  const glyph = BITMAP_FONT_5X7[char.toUpperCase()] || BITMAP_FONT_5X7['?'] || [0, 0, 0, 0, 0];
  for (let col = 0; col < 5; col++) {
    const bits = glyph[col];
    for (let row = 0; row < 7; row++) {
      if ((bits >> row) & 1) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = startX + col * scale + dx;
            const y = startY + row * scale + dy;
            if (x >= 0 && x < canvasWidth && y >= 0 && y < canvasHeight) {
              const px = y * stride + 1 + x * 4;
              raw[px] = color.r;
              raw[px + 1] = color.g;
              raw[px + 2] = color.b;
              raw[px + 3] = 255;
            }
          }
        }
      }
    }
  }
}

function drawBitmapString(
  raw: Buffer,
  stride: number,
  canvasWidth: number,
  canvasHeight: number,
  text: string,
  startX: number,
  startY: number,
  scale: number,
  color: { r: number; g: number; b: number }
) {
  let curX = startX;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    drawBitmapChar(raw, stride, canvasWidth, canvasHeight, ch, curX, startY, scale, color);
    curX += (5 + 1) * scale;
    if (curX + 6 * scale > canvasWidth - 10) break; // stay within bounds
  }
}

/**
 * Encodes a valid, deterministic raster PNG preview card with brand typography,
 * brand header, headline text, and CTA pill so downstream raster validators succeed.
 */
export function renderBrandCardRasterPngDataUrl(params: {
  width?: number;
  height?: number;
  backgroundHex: string;
  accentHex: string;
  textHex: string;
  brandName?: string;
  headline?: string;
  ctaText?: string;
  format?: 'png' | 'jpeg';
}): { dataUrl: string; width: number; height: number } {
  const width = Math.min(720, Math.max(120, params.width ?? 240));
  const height = Math.min(900, Math.max(150, params.height ?? 300));
  const bg = hexToRgb(params.backgroundHex);
  const accent = hexToRgb(params.accentHex);
  const text = hexToRgb(params.textHex);

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  // 1. Fill solid background
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // PNG filter None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      let color = bg;
      // Top accent banner
      if (y < Math.max(6, Math.floor(height * 0.04))) {
        color = accent;
      }
      raw[px] = color.r;
      raw[px + 1] = color.g;
      raw[px + 2] = color.b;
      raw[px + 3] = 255;
    }
  }

  // 2. Render Brand Header Text
  const brandTitle = (params.brandName || 'BRAND').slice(0, 16);
  drawBitmapString(raw, stride, width, height, brandTitle, 16, 20, 2, accent);

  // 3. Render Headline Lines
  const headlineStr = (params.headline || 'BRAND CONTENT').trim();
  const words = headlineStr.split(/\s+/);
  let line1 = '';
  let line2 = '';
  for (const w of words) {
    if ((line1 + ' ' + w).trim().length <= 16) {
      line1 = (line1 + ' ' + w).trim();
    } else if ((line2 + ' ' + w).trim().length <= 16) {
      line2 = (line2 + ' ' + w).trim();
    }
  }
  if (!line1) line1 = headlineStr.slice(0, 16);

  const headY = Math.floor(height * 0.45);
  drawBitmapString(raw, stride, width, height, line1, 16, headY, 2, text);
  if (line2) {
    drawBitmapString(raw, stride, width, height, line2, 16, headY + 20, 2, text);
  }

  // 4. Render CTA Pill
  const cta = (params.ctaText || 'LEARN MORE').slice(0, 14);
  const ctaY = Math.floor(height * 0.78);
  const pillW = Math.min(width - 32, (cta.length * 6 + 12) * 2);
  const pillH = 26;

  for (let y = ctaY; y < ctaY + pillH; y++) {
    if (y >= height) break;
    const rowStart = y * stride;
    for (let x = 16; x < 16 + pillW; x++) {
      if (x >= width) break;
      const px = rowStart + 1 + x * 4;
      raw[px] = accent.r;
      raw[px + 1] = accent.g;
      raw[px + 2] = accent.b;
    }
  }
  const ctaTextColor = calculateContrastRatio('#FFFFFF', params.accentHex) >= 4.5 ? { r: 255, g: 255, b: 255 } : { r: 13, g: 21, b: 38 };
  drawBitmapString(raw, stride, width, height, cta, 24, ctaY + 5, 2, ctaTextColor);

  if (params.format === 'jpeg') {
    // Instagram takes JPEG only. Same pixels, without the per-row PNG filter byte.
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) raw.copy(rgba, y * width * 4, y * stride + 1, (y + 1) * stride);
    const jpeg = encodeJpeg({ data: rgba, width, height }, 92).data;
    return { dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`, width, height };
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 6 });
  const pngBuffer = Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);

  return {
    dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
    width,
    height,
  };
}

export interface DeterministicLayerSpec {
  canvas: { width: number; height: number; aspect_ratio: string };
  safe_areas: { top_px: number; bottom_px: number; left_px: number; right_px: number };
  palette_applied: {
    background_hex: string;
    surface_hex: string;
    accent_hex: string;
    text_hex: string;
    contrast_ratio: number;
  };
  typography: {
    heading_font: string;
    body_font: string;
    mono_font: string;
    heading_size_px: number;
    body_size_px: number;
  };
  logo_layer: {
    enabled: boolean;
    policy: string;
    logo_url: string | null;
    variant: string | null;
    position: 'top_left' | 'bottom_right' | 'none';
    do_not_distort: boolean;
  };
  text_blocks: Array<{
    role: 'eyebrow' | 'headline' | 'body' | 'cta' | 'disclosure' | 'slide_counter';
    exact_text: string;
    within_safe_zone: boolean;
    clipped: boolean;
  }>;
  preview_raster_data_url: string;
  preview_svg_markup: string;
}

/**
 * A full-size raster of a layer for delivery (the layer's own preview is a
 * 240 px thumbnail). The renderer caps height at 900 px, so width is chosen
 * to keep the canvas aspect ratio exact.
 */
export function renderLayerRaster(layer: DeterministicLayerSpec, opts: { format: 'png' | 'jpeg'; brandName?: string }) {
  const { width: cw, height: ch } = layer.canvas;
  const width = Math.max(120, Math.min(720, Math.floor((900 * cw) / ch)));
  const height = Math.round((width * ch) / cw);
  return renderBrandCardRasterPngDataUrl({
    width,
    height,
    backgroundHex: layer.palette_applied.background_hex,
    accentHex: layer.palette_applied.accent_hex,
    textHex: layer.palette_applied.text_hex,
    brandName: opts.brandName,
    headline: layer.text_blocks.find((b) => b.role === 'headline')?.exact_text,
    ctaText: layer.text_blocks.find((b) => b.role === 'cta')?.exact_text,
    format: opts.format,
  });
}

export function composeDeterministicBrandLayer(params: {
  brief: CreativeBriefRecord;
  brand: BrandProfileRecord | null;
  headline: string;
  bodyText?: string;
  ctaText?: string;
  disclosures?: string[];
  slideIndex?: number;
  totalSlides?: number;
  contextualNeedsLogo?: boolean;
}): DeterministicLayerSpec {
  const { brief, brand } = params;
  const dimsByAspect: Record<string, { width: number; height: number }> = {
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
    '3:4': { width: 1080, height: 1440 },
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
  };
  const dims = dimsByAspect[brief.aspect_ratio] ?? { width: 1080, height: 1350 };

  const colors = brand?.visual?.colors ?? [];
  const bgHex = colors.find((c) => c.role === 'surface' || c.role === 'background')?.hex || '#FFFFFF';
  const accentHex = colors.find((c) => c.role === 'accent')?.hex || colors.find((c) => c.role === 'primary')?.hex || '#2563EB';
  const rawTextHex = colors.find((c) => c.role === 'text' || c.role === 'primary')?.hex || '#0D1526';
  const textHex = ensureAccessibleTextHex(rawTextHex, bgHex);
  const contrastRatio = calculateContrastRatio(textHex, bgHex);

  const headingFont = brand?.visual?.typography?.find((t) => t.use === 'display')?.family || 'Outfit';
  const bodyFont = brand?.visual?.typography?.find((t) => t.use === 'body')?.family || headingFont;
  const monoFont = brand?.visual?.typography?.find((t) => t.use === 'mono')?.family || 'JetBrains Mono';

  const logoPolicy = brief.controls.logo_policy;
  const shouldIncludeLogo =
    logoPolicy === 'always' ||
    (logoPolicy === 'contextual' &&
      params.contextualNeedsLogo !== false &&
      (!params.slideIndex || params.slideIndex === 1 || params.slideIndex === params.totalSlides));

  const isDarkBg = relativeLuminance(hexToRgb(bgHex)) < 0.25;
  const chosenLogo = shouldIncludeLogo
    ? brand?.visual?.logos?.find((l) => (isDarkBg ? /dark/i.test(l.variant) : /light/i.test(l.variant))) ??
      brand?.visual?.logos?.[0] ??
      null
    : null;

  const cleanHeadline = String(params.headline || '').trim();
  const cleanBody = String(params.bodyText || '').trim();
  const cleanCta = String(params.ctaText || brief.cta || 'Learn More').trim();

  const textBlocks: DeterministicLayerSpec['text_blocks'] = [];
  if (brand?.brand_name) {
    textBlocks.push({ role: 'eyebrow', exact_text: brand.brand_name.toUpperCase(), within_safe_zone: true, clipped: false });
  }
  if (cleanHeadline) {
    textBlocks.push({ role: 'headline', exact_text: cleanHeadline, within_safe_zone: true, clipped: false });
  }
  if (cleanBody) {
    textBlocks.push({ role: 'body', exact_text: cleanBody.slice(0, 320), within_safe_zone: true, clipped: cleanBody.length > 320 });
  }
  if (cleanCta) {
    textBlocks.push({ role: 'cta', exact_text: cleanCta, within_safe_zone: true, clipped: false });
  }
  if (params.disclosures?.length) {
    textBlocks.push({
      role: 'disclosure',
      exact_text: params.disclosures.join(' · ').slice(0, 200),
      within_safe_zone: true,
      clipped: params.disclosures.join(' · ').length > 200,
    });
  }
  if (params.slideIndex && params.totalSlides && params.totalSlides > 1) {
    textBlocks.push({
      role: 'slide_counter',
      exact_text: `${params.slideIndex}/${params.totalSlides}`,
      within_safe_zone: true,
      clipped: false,
    });
  }

  const raster = renderBrandCardRasterPngDataUrl({
    width: 240,
    height: Math.round((240 * dims.height) / dims.width),
    backgroundHex: bgHex,
    accentHex,
    textHex,
    brandName: brand?.brand_name,
    headline: cleanHeadline,
    ctaText: cleanCta,
  });

  const svgMarkup = buildDeterministicCardSvg({
    width: dims.width,
    height: dims.height,
    bgHex,
    accentHex,
    textHex,
    headingFont,
    bodyFont,
    brandName: brand?.brand_name || 'Brand',
    headline: cleanHeadline,
    bodyText: cleanBody,
    ctaText: cleanCta,
    disclosures: params.disclosures,
    logoUrl: chosenLogo?.url || null,
    slideCounter: params.slideIndex && params.totalSlides ? `${params.slideIndex}/${params.totalSlides}` : undefined,
  });

  return {
    canvas: { width: dims.width, height: dims.height, aspect_ratio: brief.aspect_ratio },
    safe_areas: {
      top_px: Math.round(dims.height * 0.08),
      bottom_px: Math.round(dims.height * 0.12),
      left_px: Math.round(dims.width * 0.08),
      right_px: Math.round(dims.width * 0.08),
    },
    palette_applied: {
      background_hex: bgHex,
      surface_hex: bgHex,
      accent_hex: accentHex,
      text_hex: textHex,
      contrast_ratio: contrastRatio,
    },
    typography: {
      heading_font: headingFont,
      body_font: bodyFont,
      mono_font: monoFont,
      heading_size_px: Math.round(dims.width * 0.06),
      body_size_px: Math.round(dims.width * 0.035),
    },
    logo_layer: {
      enabled: shouldIncludeLogo && Boolean(chosenLogo),
      policy: logoPolicy,
      logo_url: chosenLogo?.url || null,
      variant: chosenLogo?.variant || null,
      position: 'top_left',
      do_not_distort: true,
    },
    text_blocks: textBlocks,
    preview_raster_data_url: raster.dataUrl,
    preview_svg_markup: svgMarkup,
  };
}

export function buildDeterministicCardSvg(params: {
  width: number;
  height: number;
  bgHex: string;
  accentHex: string;
  textHex: string;
  headingFont: string;
  bodyFont: string;
  brandName: string;
  headline: string;
  bodyText?: string;
  ctaText?: string;
  disclosures?: string[];
  logoUrl?: string | null;
  slideCounter?: string;
}): string {
  const { width, height, bgHex, accentHex, textHex, headingFont, bodyFont, brandName, headline, bodyText, ctaText, disclosures, logoUrl, slideCounter } = params;

  const escapeXml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(headingFont)}:wght@700;800&amp;family=${encodeURIComponent(bodyFont)}:wght@400;600&amp;display=swap');
      .brand-eyebrow { font-family: '${headingFont}', sans-serif; font-size: ${Math.round(width * 0.025)}px; font-weight: 700; fill: ${accentHex}; letter-spacing: 2px; }
      .brand-headline { font-family: '${headingFont}', sans-serif; font-size: ${Math.round(width * 0.055)}px; font-weight: 800; fill: ${textHex}; line-height: 1.15; }
      .brand-body { font-family: '${bodyFont}', sans-serif; font-size: ${Math.round(width * 0.032)}px; font-weight: 400; fill: ${textHex}; opacity: 0.85; }
      .brand-cta-text { font-family: '${headingFont}', sans-serif; font-size: ${Math.round(width * 0.03)}px; font-weight: 700; fill: #FFFFFF; }
      .brand-disclosure { font-family: '${bodyFont}', sans-serif; font-size: ${Math.round(width * 0.02)}px; font-weight: 400; fill: ${textHex}; opacity: 0.6; }
      .brand-counter { font-family: '${bodyFont}', sans-serif; font-size: ${Math.round(width * 0.024)}px; font-weight: 600; fill: ${accentHex}; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="${bgHex}"/>
  <rect x="0" y="0" width="${width}" height="${Math.round(height * 0.015)}" fill="${accentHex}"/>
  <g transform="translate(${Math.round(width * 0.08)}, ${Math.round(height * 0.08)})">
    ${logoUrl ? `<image href="${escapeXml(logoUrl)}" x="0" y="0" height="${Math.round(height * 0.06)}" preserveAspectRatio="xMinYMin meet"/>` : ''}
    <text x="${logoUrl ? Math.round(width * 0.15) : 0}" y="${Math.round(height * 0.04)}" class="brand-eyebrow">${escapeXml(brandName.toUpperCase())}</text>
    ${slideCounter ? `<text x="${Math.round(width * 0.84)}" y="${Math.round(height * 0.04)}" text-anchor="end" class="brand-counter">${escapeXml(slideCounter)}</text>` : ''}
  </g>
  <g transform="translate(${Math.round(width * 0.08)}, ${Math.round(height * 0.35)})">
    <text x="0" y="0" class="brand-headline">${escapeXml(headline)}</text>
    ${bodyText ? `<text x="0" y="${Math.round(height * 0.12)}" class="brand-body">${escapeXml(bodyText.slice(0, 240))}</text>` : ''}
  </g>
  ${ctaText ? `
  <g transform="translate(${Math.round(width * 0.08)}, ${Math.round(height * 0.78)})">
    <rect x="0" y="0" width="${Math.round(width * 0.45)}" height="${Math.round(height * 0.065)}" rx="${Math.round(height * 0.032)}" fill="${accentHex}"/>
    <text x="${Math.round(width * 0.225)}" y="${Math.round(height * 0.042)}" text-anchor="middle" class="brand-cta-text">${escapeXml(ctaText)}</text>
  </g>` : ''}
  ${disclosures?.length ? `
  <g transform="translate(${Math.round(width * 0.08)}, ${Math.round(height * 0.92)})">
    <text x="0" y="0" class="brand-disclosure">${escapeXml(disclosures.join(' · ').slice(0, 160))}</text>
  </g>` : ''}
</svg>`;
}

/**
 * Deterministically renders WebVTT subtitles from video storyboard scenes.
 */
export function renderDeterministicSubtitlesVtt(storyboard: StoryboardScene[]): string {
  if (!storyboard || !storyboard.length) return 'WEBVTT\n\n';

  let currentSec = 0;
  let lines: string[] = ['WEBVTT', ''];

  storyboard.forEach((scene, idx) => {
    const dur = Math.max(2, Number(scene.duration_sec || (scene as any).duration_seconds || 4));
    const startSec = currentSec;
    const endSec = currentSec + dur;
    currentSec = endSec;

    const formatTime = (s: number) => {
      const hrs = Math.floor(s / 3600).toString().padStart(2, '0');
      const mins = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
      const secs = Math.floor(s % 60).toString().padStart(2, '0');
      const ms = Math.floor((s % 1) * 1000).toString().padStart(3, '0');
      return `${hrs}:${mins}:${secs}.${ms}`;
    };

    const text = (scene.caption_text || scene.voiceover || scene.visual_description || `Scene ${idx + 1}`).trim();
    lines.push(`${idx + 1}`);
    lines.push(`${formatTime(startSec)} --> ${formatTime(endSec)}`);
    lines.push(text);
    lines.push('');
  });

  return lines.join('\n');
}
