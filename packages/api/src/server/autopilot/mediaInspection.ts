// Reads what a media file actually is from its bytes, never from a declared
// MIME type or file extension. Anything this cannot positively identify is
// rejected rather than relabelled.

export type SniffedMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/quicktime';

export interface MediaInspection {
  mimeType: SniffedMime;
  mediaType: 'image' | 'video';
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  videoCodec: string | null;
}

export class MediaValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MediaValidationError';
    this.code = code;
  }
}

export const MEDIA_LIMITS = {
  imageMaxBytes: 30 * 1024 * 1024,
  videoMaxBytes: 300 * 1024 * 1024,
  minDimension: 64,
  maxDimension: 8192,
  maxVideoDurationMs: 15 * 60 * 1000,
} as const;

export function sniffMime(buf: Buffer): SniffedMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

function pngDimensions(buf: Buffer) {
  // IHDR is always the first chunk: 8-byte signature, 4 length, 4 type, then width/height.
  if (buf.length < 24 || buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegDimensions(buf: Buffer) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpDimensions(buf: Buffer) {
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

interface Box { type: string; start: number; end: number; bodyStart: number }

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let i = start;
  while (i + 8 <= end) {
    let size = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    let header = 8;
    if (size === 1) {
      if (i + 16 > end) return;
      const big = buf.readBigUInt64BE(i + 8);
      if (big > BigInt(end - i)) return;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) return;
    yield { type, start: i, end: i + size, bodyStart: i + header };
    i += size;
  }
}

function findBox(buf: Buffer, parent: { bodyStart: number; end: number }, type: string): Box | null {
  for (const b of boxes(buf, parent.bodyStart, parent.end)) if (b.type === type) return b;
  return null;
}

/** Duration, size and codec of the first video track of an ISO-BMFF (MP4/MOV) file. */
function mp4Details(buf: Buffer) {
  const moov = [...boxes(buf, 0, buf.length)].find((b) => b.type === 'moov');
  if (!moov) return null;
  const mvhd = findBox(buf, moov, 'mvhd');
  let durationMs: number | null = null;
  if (mvhd) {
    const v = buf[mvhd.bodyStart];
    const timescale = v === 1 ? buf.readUInt32BE(mvhd.bodyStart + 20) : buf.readUInt32BE(mvhd.bodyStart + 12);
    const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.bodyStart + 24)) : buf.readUInt32BE(mvhd.bodyStart + 16);
    if (timescale > 0) durationMs = Math.round((duration / timescale) * 1000);
  }
  for (const trak of boxes(buf, moov.bodyStart, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = findBox(buf, trak, 'mdia');
    const hdlr = mdia ? findBox(buf, mdia, 'hdlr') : null;
    if (!mdia || !hdlr || buf.subarray(hdlr.bodyStart + 8, hdlr.bodyStart + 12).toString('latin1') !== 'vide') continue;
    const tkhd = findBox(buf, trak, 'tkhd');
    let width: number | null = null;
    let height: number | null = null;
    if (tkhd && tkhd.end - 8 >= tkhd.bodyStart) {
      width = Math.round(buf.readUInt32BE(tkhd.end - 8) / 65536);
      height = Math.round(buf.readUInt32BE(tkhd.end - 4) / 65536);
    }
    const minf = findBox(buf, mdia, 'minf');
    const stbl = minf ? findBox(buf, minf, 'stbl') : null;
    const stsd = stbl ? findBox(buf, stbl, 'stsd') : null;
    // stsd: version/flags (4) + entry count (4), then the first sample entry box.
    const codec = stsd && stsd.bodyStart + 16 <= stsd.end ? buf.subarray(stsd.bodyStart + 12, stsd.bodyStart + 16).toString('latin1') : null;
    return { durationMs, width, height, codec };
  }
  return { durationMs, width: null, height: null, codec: null };
}

/**
 * Validates bytes as a deliverable image or video. Throws MediaValidationError
 * for empty files, unknown or spoofed formats, oversize files, impossible
 * dimensions, and video containers with no playable video track.
 */
export function inspectMedia(buf: Buffer, declaredMime?: string | null): MediaInspection {
  if (!buf || buf.length === 0) throw new MediaValidationError('EMPTY_MEDIA', 'Media file is empty.');
  const mimeType = sniffMime(buf);
  if (!mimeType) throw new MediaValidationError('UNSUPPORTED_MEDIA', 'File signature is not a supported PNG, JPEG, WebP, MP4 or MOV file.');
  const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';
  if (declaredMime) {
    const declared = declaredMime.split(';')[0].trim().toLowerCase();
    const declaredKind = declared.split('/')[0];
    const sameFamily = declared === mimeType || (mediaType === 'video' && (declared === 'video/mp4' || declared === 'video/quicktime'));
    if (declaredKind && declaredKind !== 'application' && !sameFamily) {
      throw new MediaValidationError('MIME_MISMATCH', `Declared type ${declared} does not match the file's content (${mimeType}).`);
    }
  }
  const maxBytes = mediaType === 'video' ? MEDIA_LIMITS.videoMaxBytes : MEDIA_LIMITS.imageMaxBytes;
  if (buf.length > maxBytes) throw new MediaValidationError('MEDIA_TOO_LARGE', `Media is ${buf.length} bytes; the limit is ${maxBytes}.`);

  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let videoCodec: string | null = null;
  if (mediaType === 'image') {
    const dims = mimeType === 'image/png' ? pngDimensions(buf) : mimeType === 'image/jpeg' ? jpegDimensions(buf) : webpDimensions(buf);
    if (!dims) throw new MediaValidationError('MALFORMED_MEDIA', 'Image header could not be read.');
    width = dims.width;
    height = dims.height;
  } else {
    const details = mp4Details(buf);
    if (!details) throw new MediaValidationError('MALFORMED_MEDIA', 'Video has no moov box; it is truncated or not a playable MP4/MOV.');
    if (!details.codec) throw new MediaValidationError('MALFORMED_MEDIA', 'Video has no readable video track.');
    if (!details.durationMs || details.durationMs <= 0 || details.durationMs > MEDIA_LIMITS.maxVideoDurationMs) {
      throw new MediaValidationError('MALFORMED_MEDIA', 'Video duration is missing or out of range.');
    }
    width = details.width;
    height = details.height;
    durationMs = details.durationMs;
    videoCodec = details.codec;
  }
  if (width !== null && height !== null) {
    if (width < MEDIA_LIMITS.minDimension || height < MEDIA_LIMITS.minDimension || width > MEDIA_LIMITS.maxDimension || height > MEDIA_LIMITS.maxDimension) {
      throw new MediaValidationError('INVALID_DIMENSIONS', `Media dimensions ${width}x${height} are outside ${MEDIA_LIMITS.minDimension}-${MEDIA_LIMITS.maxDimension}px.`);
    }
  } else if (mediaType === 'image') {
    throw new MediaValidationError('MALFORMED_MEDIA', 'Image dimensions could not be read.');
  }
  return { mimeType, mediaType, bytes: buf.length, width, height, durationMs, videoCodec };
}

export function extensionForMime(mime: SniffedMime): string {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'video/quicktime' ? 'mov' : 'mp4';
}
