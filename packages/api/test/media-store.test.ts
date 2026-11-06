import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { encode as encodePng } from 'fast-png';
import jpegJs from 'jpeg-js';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);
process.env.BACKEND_PUBLIC_URL = 'https://app.example.com';

const store = await import('../src/server/mediaStore.ts');
const { createMemoryStorageDriver } = await import('../src/server/autopilot/assetStorage.ts');

// Memory driver reporting itself as s3, since only object storage qualifies.
function memoryS3() {
  const d = createMemoryStorageDriver('https://bucket.example.com');
  return Object.assign(d, { name: 's3' as const });
}

function rgbaPng(width: number, height: number, alpha = 255): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = 40; data[i + 2] = 10; data[i + 3] = alpha; }
  return Buffer.from(encodePng({ width, height, data, channels: 4, depth: 8 }));
}

test('media store: bytes are content-addressed and stored once', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const a = await store.storeMediaBytes(jpg, 'application/octet-stream');
    const b = await store.storeMediaBytes(jpg, 'image/jpeg');
    const sha = createHash('sha256').update(jpg).digest('hex');
    assert.equal(a, `https://app.example.com/media/r2/${sha}.jpg`, 'sniffed as JPEG despite the generic type');
    assert.equal(a, b);
    assert.equal(driver.objects.size, 1);
    assert.ok(store.isStoredMediaUrl(a));
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store: PNG is stored as a decodable JPEG with alpha flattened onto white', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const url = await store.storeMediaBytes(rgbaPng(16, 12, 0), 'image/png', 't', { jpeg: true });
    assert.match(url, /\.jpg$/);
    const [obj] = [...driver.objects.values()];
    assert.equal(obj.mimeType, 'image/jpeg');
    const decoded = jpegJs.decode(obj.body);
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 12);
    assert.ok(decoded.data[0] > 240 && decoded.data[1] > 240, 'fully transparent pixels become white');
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store: data URL is copied; a stored PNG gets a JPEG twin on request', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const png = rgbaPng(8, 8);
    const stored = await store.durableMediaUrl(`data:image/png;base64,${png.toString('base64')}`, 'u1');
    assert.match(stored, /^https:\/\/app\.example\.com\/media\/r2\/[a-f0-9]{64}\.png$/);
    const twin = await store.durableMediaUrl(stored, 'u1', { jpeg: true });
    assert.match(twin, /\.jpg$/);
    assert.equal(driver.objects.size, 2);
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store: storage failure and missing storage both return the input unchanged', async () => {
  const driver = memoryS3();
  driver.failNextPut = 1;
  store.setMediaStorageForTests(driver as any);
  try {
    const dataUrl = `data:image/png;base64,${rgbaPng(4, 4).toString('base64')}`;
    assert.equal(await store.durableMediaUrl(dataUrl), dataUrl);
  } finally { store.setMediaStorageForTests(undefined); }
  store.setMediaStorageForTests(null);
  try {
    assert.equal(await store.durableMediaUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  } finally { store.setMediaStorageForTests(undefined); }
});

test('media store route: redirects a stored file to the bucket, refuses anything else', async () => {
  const driver = memoryS3();
  store.setMediaStorageForTests(driver as any);
  try {
    const app = express();
    app.use(store.registerMediaStoreRoutes());
    const file = `${'a'.repeat(64)}.jpg`;
    const ok = await request(app).get(`/media/r2/${file}`);
    assert.equal(ok.status, 302);
    assert.match(ok.headers.location, new RegExp(`^https://bucket\\.example\\.com/media/${file}\\?exp=`));
    assert.equal(ok.headers['cross-origin-resource-policy'], 'cross-origin');
    for (const bad of ['..%2F..%2Fsecret', 'abc.jpg', `${'a'.repeat(64)}.exe`, `${'A'.repeat(64)}.jpg`]) {
      assert.equal((await request(app).get(`/media/r2/${bad}`)).status, 404, bad);
    }
    assert.equal(store.directMediaUrl(`https://app.example.com/media/r2/${file}`).startsWith('https://bucket.example.com/media/'), true);
    assert.equal(store.directMediaUrl('https://elsewhere.example.com/x.jpg'), 'https://elsewhere.example.com/x.jpg');
  } finally { store.setMediaStorageForTests(undefined); }
});

test('no object storage: media is kept in the database and served from the same public address', async () => {
  store.setMediaStorageForTests(null as any);
  const blobs = new Map<string, { bytes: Buffer; mime: string }>();
  store.setMediaBlobBackendForTests({
    available: () => true,
    put: async (file, bytes, mime) => { blobs.set(file, { bytes, mime }); },
    get: async (file) => blobs.get(file) ?? null,
  });
  try {
    // getMediaStorage() is null (no S3) but uploads still work.
    assert.equal(store.getMediaStorage(), null);
    assert.equal(store.mediaStorageAvailable(), true);
    const jpeg = Buffer.from(jpegJs.encode({ data: Buffer.alloc(4 * 4 * 4, 200), width: 4, height: 4 }, 90).data);
    const url = await store.storeMediaBytes(jpeg, 'image/jpeg', 'u1');
    assert.match(url, /\/media\/r2\/[a-f0-9]{64}\.jpg$/);
    assert.equal(blobs.size, 1);
    // Same bytes: stored once.
    assert.equal(await store.storeMediaBytes(jpeg, 'image/jpeg', 'u1'), url);
    assert.equal(blobs.size, 1);
    // Served publicly with its type, cacheable.
    const app = express();
    app.use(store.registerMediaStoreRoutes());
    const res = await request(app).get(url.slice(url.indexOf('/media/r2/')));
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.match(String(res.headers['cache-control']), /immutable/);
    assert.equal(Buffer.compare(res.body as Buffer, jpeg), 0);
    // Unknown files are 404, not an error.
    assert.equal((await request(app).get(`/media/r2/${'0'.repeat(64)}.jpg`)).status, 404);
    // Too big for the database fallback: a clear error.
    await assert.rejects(() => store.storeMediaBytes(Buffer.concat([jpeg, Buffer.alloc(store.DB_MAX_BYTES)]), 'image/jpeg'), /need object storage/);
  } finally {
    store.setMediaBlobBackendForTests(null);
    store.setMediaStorageForTests(undefined as any);
  }
});

test('database fallback keeps images only: videos keep their provider link until R2 is set up', async () => {
  store.setMediaStorageForTests(null as any);
  const blobs = new Map<string, { bytes: Buffer; mime: string }>();
  store.setMediaBlobBackendForTests({ available: () => true, put: async (f, b, m) => { blobs.set(f, { bytes: b, mime: m }); }, get: async (f) => blobs.get(f) ?? null });
  try {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);
    await assert.rejects(() => store.storeMediaBytes(mp4, 'video/mp4'), /need object storage/);
    assert.equal(blobs.size, 0);
  } finally {
    store.setMediaBlobBackendForTests(null);
    store.setMediaStorageForTests(undefined as any);
  }
});

/** A fake media_blobs table + the reference tables the clean-up checks. */
function fakeBlobDb(init: Array<{ file: string; ageDays: number }>, refs: { posts?: Array<{ text: string; status: string; publishedDaysAgo?: number }>; examples?: string[]; missingTables?: string[] } = {}) {
  const blobs = init.map((b) => ({ file: b.file, mime: 'image/jpeg', bytes: Buffer.from(b.file), tenant_id: 'u', ageDays: b.ageDays }));
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const missing = (refs.missingTables ?? []).find((t) => s.includes(`FROM ${t}`));
    if (missing) throw new Error(`relation "${missing}" does not exist`);
    if (s.startsWith('SELECT file, mime, bytes, tenant_id FROM media_blobs')) return { rows: blobs.slice(0, 10) };
    if (s.startsWith('DELETE FROM media_blobs WHERE file=$1')) { const i = blobs.findIndex((b) => b.file === p[0]); if (i >= 0) blobs.splice(i, 1); return { rows: [] }; }
    if (s.startsWith('SELECT EXISTS (SELECT 1 FROM media_blobs)')) return { rows: [{ any: blobs.length > 0 }] };
    if (s.startsWith('SELECT file FROM media_blobs WHERE created_at')) return { rows: blobs.filter((b) => b.ageDays > p[0]).slice(0, p[1]) };
    const needle = String(p[0] ?? '').replace(/%/g, '');
    if (s.startsWith('SELECT 1 FROM blog_posts')) return { rows: (refs.posts ?? []).filter((x) => x.text.includes(needle) && (x.status !== 'published' || (x.publishedDaysAgo ?? 0) < p[1])) };
    if (s.startsWith('SELECT 1 FROM user_style_examples')) return { rows: (refs.examples ?? []).filter((u) => u.includes(needle)) };
    if (s.startsWith('SELECT 1 FROM user_library_assets') || s.startsWith('SELECT 1 FROM user_design_systems')) return { rows: [] };
    throw new Error(`unexpected SQL ${s.slice(0, 60)}`);
  };
  return { query, blobs };
}

test('clean-up without R2: copies nothing needs any more are removed after 30 days; anything still used stays', async () => {
  const f = (n: string) => `${n.repeat(64).slice(0, 64)}.jpg`;
  const db = fakeBlobDb(
    [{ file: f('a'), ageDays: 40 }, { file: f('b'), ageDays: 40 }, { file: f('c'), ageDays: 40 }, { file: f('d'), ageDays: 40 }, { file: f('e'), ageDays: 5 }, { file: f('f'), ageDays: 40 }],
    {
      posts: [
        { text: `https://app/media/r2/${f('b')}`, status: 'scheduled' },                       // unpublished post: keep
        { text: `https://app/media/r2/${f('c')}`, status: 'published', publishedDaysAgo: 10 }, // published 10 days ago: keep
        { text: `https://app/media/r2/${f('d')}`, status: 'published', publishedDaysAgo: 60 }, // published long ago: remove
      ],
      examples: [`https://app/media/r2/${f('f')}`],                                             // example design: keep
      missingTables: ['user_library_assets'],                                                   // not created yet: no references
    },
  );
  const r = await store.runMediaMaintenance({ query: db.query, driver: null });
  assert.equal(r.removed, 2, 'the unused one and the long-published one');
  assert.deepEqual(db.blobs.map((b) => b.file[0]).sort(), ['b', 'c', 'e', 'f']);
  assert.equal(r.remaining, true);
});

test('R2 configured: every database file moves to R2 at the same address, then leaves the database', async () => {
  const driver = createMemoryStorageDriver();
  const f = (n: string) => `${n.repeat(64).slice(0, 64)}.jpg`;
  const db = fakeBlobDb([{ file: f('1'), ageDays: 1 }, { file: f('2'), ageDays: 400 }]);
  const r = await store.runMediaMaintenance({ query: db.query, driver });
  assert.equal(r.moved, 2);
  assert.equal(db.blobs.length, 0);
  assert.equal(r.remaining, false);
  assert.ok(await driver.head(`media/${f('1')}`));
  assert.equal((await driver.get(`media/${f('2')}`))!.toString(), f('2'));
});

test('R2 just configured: a file not moved yet is still served from the database', async () => {
  const driver = createMemoryStorageDriver();
  store.setMediaStorageForTests(driver as any);
  const file = `${'9'.repeat(64)}.jpg`;
  store.setMediaBlobBackendForTests({ available: () => true, put: async () => undefined, get: async (f) => (f === file ? { bytes: Buffer.from('jpegbytes'), mime: 'image/jpeg' } : null) });
  try {
    const app = express();
    app.use(store.registerMediaStoreRoutes());
    const res = await request(app).get(`/media/r2/${file}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    const other = await request(app).get(`/media/r2/${'8'.repeat(64)}.jpg`);
    assert.equal(other.status, 302, 'files already in R2 redirect as before');
  } finally {
    store.setMediaBlobBackendForTests(null);
    store.setMediaStorageForTests(undefined as any);
  }
});
