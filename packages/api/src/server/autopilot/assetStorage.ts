import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import axios from 'axios';
import type { Pool } from 'pg';

// Durable storage for generated media. Two drivers:
//  - s3: any S3-compatible bucket (Railway Buckets, Cloudflare R2, AWS S3, MinIO).
//    Delivery is a presigned GET URL, or a public base URL when the bucket is public.
//  - postgres: a dedicated bytea table, delivered through a signed, expiring app
//    route on the public origin. For small deployments; capped at 50 MB a file.
// There is no silent default: with neither configured, persistence fails with
// STORAGE_NOT_CONFIGURED and generation does not complete.

export interface StoredObjectInfo {
  bytes: number;
  mimeType: string;
  sha256: string | null;
}

export interface AssetStorageDriver {
  readonly name: 's3' | 'postgres' | 'memory';
  put(key: string, body: Buffer, mimeType: string, meta: { sha256: string; tenantId: string }): Promise<void>;
  head(key: string): Promise<StoredObjectInfo | null>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** An HTTPS URL a social platform can fetch from outside the app, valid for ttlSeconds. */
  deliveryUrl(key: string, ttlSeconds: number): string;
}

export class StorageError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.retryable = retryable;
  }
}

const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
const encodeKeyPath = (key: string) => key.split('/').map(rfc3986).join('/');

export interface S3DriverConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** When set, objects are delivered as `${publicBaseUrl}/${key}` instead of presigned URLs. */
  publicBaseUrl?: string;
  /** path: https://endpoint/bucket/key (default). virtual: the endpoint host already names the bucket. */
  addressing?: 'path' | 'virtual';
  clock?: () => Date;
  http?: { request: (cfg: any) => Promise<{ status: number; headers: Record<string, any>; data: any }> };
}

/** S3-compatible driver with AWS Signature V4 (path-style addressing). */
export function createS3Driver(cfg: S3DriverConfig): AssetStorageDriver {
  const endpoint = new URL(cfg.endpoint);
  if (endpoint.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(endpoint.hostname)) {
    throw new StorageError('STORAGE_MISCONFIGURED', 'Object storage endpoint must use HTTPS.');
  }
  const http = cfg.http ?? { request: (c: any) => axios.request({ validateStatus: () => true, ...c }) };
  const basePath = endpoint.pathname.replace(/\/$/, '');
  const objectPath = (key: string) =>
    cfg.addressing === 'virtual' ? `${basePath}/${encodeKeyPath(key)}` : `${basePath}/${rfc3986(cfg.bucket)}/${encodeKeyPath(key)}`;
  const clock = cfg.clock ?? (() => new Date());

  function sign(method: string, path: string, query: Record<string, string>, headers: Record<string, string>, payloadHash: string, now: Date) {
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const scope = `${day}/${cfg.region}/s3/aws4_request`;
    const allHeaders: Record<string, string> = { ...headers, host: endpoint.host };
    const names = Object.keys(allHeaders).map((h) => h.toLowerCase()).sort();
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(allHeaders)) lower[k.toLowerCase()] = String(v).trim();
    const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
    const signedHeaders = names.join(';');
    const canonicalQuery = Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');
    const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${cfg.secretAccessKey}`, day);
    const kSigning = hmac(hmac(hmac(kDate, cfg.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return { amzDate, scope, signedHeaders, signature, canonicalQuery };
  }

  async function signedRequest(method: 'PUT' | 'HEAD' | 'GET' | 'DELETE', key: string, body?: Buffer, extraHeaders: Record<string, string> = {}) {
    const now = clock();
    const payloadHash = body ? sha256Hex(body) : sha256Hex('');
    const path = objectPath(key);
    const headers: Record<string, string> = { 'x-amz-content-sha256': payloadHash, ...extraHeaders };
    const s = sign(method, path, {}, { ...headers, 'x-amz-date': now.toISOString().replace(/[:-]|\.\d{3}/g, '') }, payloadHash, now);
    try {
      return await http.request({
        method,
        url: `${endpoint.origin}${path}`,
        data: body,
        headers: {
          ...headers,
          'x-amz-date': s.amzDate,
          Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${s.scope}, SignedHeaders=${s.signedHeaders}, Signature=${s.signature}`,
        },
        responseType: method === 'GET' ? 'arraybuffer' : undefined,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60_000,
      });
    } catch (err: any) {
      throw new StorageError('STORAGE_UNAVAILABLE', `Object storage ${method} failed: ${err?.code || err?.message || 'network error'}`, true);
    }
  }

  return {
    name: 's3',
    async put(key, body, mimeType, meta) {
      const res = await signedRequest('PUT', key, body, {
        'content-type': mimeType,
        'content-length': String(body.length),
        'x-amz-meta-sha256': meta.sha256,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new StorageError('STORAGE_WRITE_FAILED', `Object storage PUT returned HTTP ${res.status}.`, res.status >= 500 || res.status === 429);
      }
    },
    async head(key) {
      const res = await signedRequest('HEAD', key);
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) throw new StorageError('STORAGE_READ_FAILED', `Object storage HEAD returned HTTP ${res.status}.`, res.status >= 500);
      return {
        bytes: Number(res.headers['content-length'] ?? -1),
        mimeType: String(res.headers['content-type'] ?? '').split(';')[0],
        sha256: res.headers['x-amz-meta-sha256'] ? String(res.headers['x-amz-meta-sha256']) : null,
      };
    },
    async get(key) {
      const res = await signedRequest('GET', key);
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) throw new StorageError('STORAGE_READ_FAILED', `Object storage GET returned HTTP ${res.status}.`, res.status >= 500);
      return Buffer.from(res.data);
    },
    async delete(key) {
      const res = await signedRequest('DELETE', key);
      if (res.status >= 300 && res.status !== 404) throw new StorageError('STORAGE_DELETE_FAILED', `Object storage DELETE returned HTTP ${res.status}.`, res.status >= 500);
    },
    deliveryUrl(key, ttlSeconds) {
      if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl.replace(/\/$/, '')}/${encodeKeyPath(key)}`;
      const now = clock();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const day = amzDate.slice(0, 8);
      const path = objectPath(key);
      const query: Record<string, string> = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${cfg.accessKeyId}/${day}/${cfg.region}/s3/aws4_request`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(Math.max(60, Math.min(604800, Math.floor(ttlSeconds)))),
        'X-Amz-SignedHeaders': 'host',
      };
      const s = sign('GET', path, query, {}, 'UNSIGNED-PAYLOAD', now);
      return `${endpoint.origin}${path}?${s.canonicalQuery}&X-Amz-Signature=${s.signature}`;
    },
  };
}

// ── Signed app-route delivery (postgres driver) ─────────────────────────────

function deliverySecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  const explicit = env.AUTOPILOT_ASSET_SIGNING_SECRET;
  const base = explicit || env.JWT_SECRET;
  if (!base) throw new StorageError('STORAGE_MISCONFIGURED', 'No signing secret for asset delivery URLs.');
  return createHmac('sha256', base).update('autopilot-asset-delivery-v1').digest();
}

export function signDeliveryToken(key: string, expiresAtSec: number, env?: NodeJS.ProcessEnv): string {
  return createHmac('sha256', deliverySecret(env)).update(`${key}\n${expiresAtSec}`).digest('base64url');
}

export function verifyDeliveryToken(key: string, expiresAtSec: number, sig: string, nowSec = Math.floor(Date.now() / 1000), env?: NodeJS.ProcessEnv): boolean {
  if (!Number.isFinite(expiresAtSec) || expiresAtSec < nowSec) return false;
  const expected = Buffer.from(signDeliveryToken(key, expiresAtSec, env));
  const given = Buffer.from(String(sig || ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const POSTGRES_BLOB_MAX_BYTES = 50 * 1024 * 1024;

export function createPostgresBlobDriver(pool: Pick<Pool, 'query'>, publicBaseUrl: string): AssetStorageDriver {
  const base = publicBaseUrl.replace(/\/$/, '');
  return {
    name: 'postgres',
    async put(key, body, mimeType, meta) {
      if (body.length > POSTGRES_BLOB_MAX_BYTES) {
        throw new StorageError('STORAGE_OBJECT_TOO_LARGE', `The postgres asset store takes files up to ${POSTGRES_BLOB_MAX_BYTES} bytes; configure S3-compatible storage for larger media.`);
      }
      try {
        // Same key = same bytes (keys embed the content hash), so a retry is a no-op.
        await pool.query(
          `INSERT INTO autopilot_asset_blobs (storage_key, tenant_id, content, mime_type, sha256, byte_size)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (storage_key) DO NOTHING`,
          [key, meta.tenantId, body, mimeType, meta.sha256, body.length],
        );
      } catch (err: any) {
        throw new StorageError('STORAGE_WRITE_FAILED', `Asset blob write failed: ${err?.message || 'database error'}`, true);
      }
    },
    async head(key) {
      const { rows } = await pool.query(`SELECT byte_size, mime_type, sha256 FROM autopilot_asset_blobs WHERE storage_key = $1`, [key]);
      return rows[0] ? { bytes: Number(rows[0].byte_size), mimeType: rows[0].mime_type, sha256: rows[0].sha256 } : null;
    },
    async get(key) {
      const { rows } = await pool.query(`SELECT content FROM autopilot_asset_blobs WHERE storage_key = $1`, [key]);
      return rows[0] ? Buffer.from(rows[0].content) : null;
    },
    async delete(key) {
      await pool.query(`DELETE FROM autopilot_asset_blobs WHERE storage_key = $1`, [key]);
    },
    deliveryUrl(key, ttlSeconds) {
      const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(ttlSeconds));
      return `${base}/api/autopilot/asset-content?key=${encodeURIComponent(key)}&exp=${exp}&sig=${signDeliveryToken(key, exp)}`;
    },
  };
}

/** In-process store for tests. Delivery URLs point at a fake external origin. */
export function createMemoryStorageDriver(origin = 'https://assets.example.com'):AssetStorageDriver & { objects: Map<string, { body: Buffer; mimeType: string; sha256: string }>; failNextPut?: number } {
  const objects = new Map<string, { body: Buffer; mimeType: string; sha256: string }>();
  const driver = {
    name: 'memory' as const,
    objects,
    failNextPut: 0,
    async put(key: string, body: Buffer, mimeType: string, meta: { sha256: string }) {
      if (driver.failNextPut > 0) {
        driver.failNextPut -= 1;
        throw new StorageError('STORAGE_UNAVAILABLE', 'Simulated storage outage', true);
      }
      objects.set(key, { body: Buffer.from(body), mimeType, sha256: meta.sha256 });
    },
    async head(key: string) {
      const o = objects.get(key);
      return o ? { bytes: o.body.length, mimeType: o.mimeType, sha256: o.sha256 } : null;
    },
    async get(key: string) {
      return objects.get(key)?.body ?? null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
    deliveryUrl(key: string, ttlSeconds: number) {
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      return `${origin}/${encodeKeyPath(key)}?exp=${exp}`;
    },
  };
  return driver;
}

export interface StorageResolution {
  driver: AssetStorageDriver | null;
  configured: boolean;
  description: string;
}

/**
 * Picks the configured driver. AUTOPILOT_ASSET_STORAGE=s3|postgres chooses
 * explicitly; unset, S3 is used when its variables exist, otherwise postgres
 * when a database and a public base URL exist. The choice is reported in
 * diagnostics so nobody has to guess where media went.
 */
export function resolveAssetStorage(opts: {
  env?: NodeJS.ProcessEnv;
  pool?: Pick<Pool, 'query'> | null;
  hasDatabase?: () => boolean;
  publicBaseUrl?: string;
}): StorageResolution {
  const env = opts.env ?? process.env;
  const wanted = String(env.AUTOPILOT_ASSET_STORAGE || '').toLowerCase();
  const s3Ready = Boolean(env.AUTOPILOT_S3_ENDPOINT && env.AUTOPILOT_S3_BUCKET && env.AUTOPILOT_S3_ACCESS_KEY_ID && env.AUTOPILOT_S3_SECRET_ACCESS_KEY);
  if (wanted === 's3' || (!wanted && s3Ready)) {
    if (!s3Ready) return { driver: null, configured: false, description: 'AUTOPILOT_ASSET_STORAGE=s3 but AUTOPILOT_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY are incomplete' };
    try {
      const driver = createS3Driver({
        endpoint: env.AUTOPILOT_S3_ENDPOINT!,
        region: env.AUTOPILOT_S3_REGION || 'auto',
        bucket: env.AUTOPILOT_S3_BUCKET!,
        accessKeyId: env.AUTOPILOT_S3_ACCESS_KEY_ID!,
        secretAccessKey: env.AUTOPILOT_S3_SECRET_ACCESS_KEY!,
        publicBaseUrl: env.AUTOPILOT_S3_PUBLIC_BASE_URL || undefined,
        addressing: env.AUTOPILOT_S3_ADDRESSING === 'virtual' ? 'virtual' : 'path',
      });
      return { driver, configured: true, description: `s3 bucket ${env.AUTOPILOT_S3_BUCKET} at ${new URL(env.AUTOPILOT_S3_ENDPOINT!).host}` };
    } catch (err: any) {
      return { driver: null, configured: false, description: err?.message || 's3 misconfigured' };
    }
  }
  if (wanted === 'postgres' || !wanted) {
    const base = opts.publicBaseUrl || '';
    if (!opts.pool || !opts.hasDatabase?.()) return { driver: null, configured: false, description: 'No object storage configured and no database for the postgres asset store' };
    if (!/^https:\/\//.test(base) && env.NODE_ENV === 'production') {
      return { driver: null, configured: false, description: 'postgres asset store needs an https public base URL (BACKEND_PUBLIC_URL) so platforms can fetch media' };
    }
    if (!base) return { driver: null, configured: false, description: 'postgres asset store needs BACKEND_PUBLIC_URL' };
    return { driver: createPostgresBlobDriver(opts.pool, base), configured: true, description: `postgres asset store delivered via ${new URL(base).host}` };
  }
  return { driver: null, configured: false, description: `Unknown AUTOPILOT_ASSET_STORAGE value "${wanted}"` };
}
