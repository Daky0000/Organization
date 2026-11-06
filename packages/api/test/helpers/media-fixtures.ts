// Minimal but structurally valid media files for tests: the headers the media
// inspector reads (PNG IHDR, JPEG SOF0, ISO-BMFF moov/trak) with real values.
import type { VisualGenerationResult } from '../../src/server/autopilot/assetPipeline.ts';
import type { VisualProviderAdapterInput } from '../../src/server/autopilot/workflowOrchestrator.ts';

export function pngFixture(width = 1024, height = 1024): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([sig, ihdr, iend]);
}

export function jpegFixture(width = 1024, height = 1280): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof0 = Buffer.alloc(19);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3;
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0, Buffer.alloc(32, 0x11), eoi]);
}

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

export function mp4Fixture(opts: { width?: number; height?: number; durationMs?: number; codec?: string; withMoov?: boolean } = {}): Buffer {
  const { width = 1080, height = 1920, durationMs = 8000, codec = 'avc1', withMoov = true } = opts;
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2avc1mp41', 'latin1'));
  if (!withMoov) return Buffer.concat([ftyp, box('mdat', Buffer.alloc(64))]);
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(durationMs, 16); // duration in timescale units
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const hdlr = Buffer.alloc(24);
  hdlr.write('vide', 8, 'latin1');
  const entry = Buffer.alloc(8);
  entry.writeUInt32BE(8, 0);
  entry.write(codec, 4, 'latin1');
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box('stsd', stsdHead, entry);
  const trak = box('trak', box('tkhd', tkhd), box('mdia', box('hdlr', hdlr), box('minf', box('stbl', stsd))));
  const moov = box('moov', box('mvhd', mvhd), trak);
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(64))]);
}

/** A provider adapter that returns real bytes; records every call. */
export function fakeVisualAdapter(calls: VisualProviderAdapterInput[] = [], opts: { usage?: boolean } = {}) {
  return async (input: VisualProviderAdapterInput): Promise<VisualGenerationResult> => {
    calls.push(input);
    const isVideo = /seedance|kling/.test(input.model);
    const bytes = isVideo ? mp4Fixture() : input.aspectRatio === '1:1' ? jpegFixture(1024, 1024) : jpegFixture(1024, 1280);
    return {
      ok: true,
      provider: input.provider,
      model: input.model,
      mediaType: isVideo ? 'video' : 'image',
      providerRequestId: `req_${calls.length}`,
      bytes,
      mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
      usage: opts.usage === false || isVideo ? undefined : { input_tokens: 500, output_tokens: 1800, input_tokens_details: { text_tokens: 500, image_tokens: 0 } },
    };
  };
}
