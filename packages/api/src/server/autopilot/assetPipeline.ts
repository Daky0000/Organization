import { createHash, randomUUID } from 'node:crypto';
import { safeAxios } from '../../ssrf-guard.ts';
import { inspectMedia, extensionForMime, MediaValidationError, type MediaInspection } from './mediaInspection.ts';
import { StorageError, type AssetStorageDriver } from './assetStorage.ts';

// Provider output → validated bytes → durable object → verified delivery →
// asset record. Content items reference asset IDs; URLs are derived per use.

export interface ProviderUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

export type VisualFailureCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'ASSET_PERSISTENCE_FAILED';

export type VisualGenerationResult =
  | {
      ok: true;
      provider: string;
      model: string;
      mediaType: 'image' | 'video';
      providerRequestId?: string;
      bytes?: Uint8Array;
      sourceUrl?: string;
      mimeType: string;
      usage?: ProviderUsage;
    }
  | {
      ok: false;
      code: VisualFailureCode;
      retryable: boolean;
      safeMessage: string;
      providerRequestId?: string;
      /**
       * not_submitted: nothing reached the provider, so nothing can be owed.
       * definitive_failure: the provider answered with a failure.
       * unknown_outcome: the request may have run (timeout, dropped connection
       * after submission); it must be reconciled before refunding or resubmitting.
       */
      billing: 'not_submitted' | 'definitive_failure' | 'unknown_outcome';
    };

export interface AutopilotAssetRecord {
  id: string;
  tenant_id: string;
  content_item_id: string | null;
  workflow_run_id: string | null;
  slot: string;
  storage_driver: string;
  storage_key: string;
  sha256: string;
  mime_type: string;
  media_type: 'image' | 'video';
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  video_codec: string | null;
  provider: string;
  model: string;
  provider_request_id: string | null;
  provenance: Record<string, any>;
  is_demo: boolean;
  qa_state: 'pending' | 'passed' | 'blocked';
  delivery_verified_at: string | null;
  delivery_error: string | null;
  retention_class: 'temporary' | 'draft' | 'approved' | 'published';
  expires_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface AssetRecordStore {
  saveAsset(asset: AutopilotAssetRecord): Promise<AutopilotAssetRecord>;
  getAsset(tenantId: string, assetId: string): Promise<AutopilotAssetRecord | null>;
  findAssetByKey(tenantId: string, storageKey: string): Promise<AutopilotAssetRecord | null>;
}

export class AssetPipelineError extends Error {
  code: string;
  retryable: boolean;
  stage: 'fetch' | 'validate' | 'store' | 'verify' | 'record';
  constructor(code: string, message: string, stage: AssetPipelineError['stage'], retryable = false) {
    super(message);
    this.name = 'AssetPipelineError';
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
  }
}

const DEFAULT_PROVIDER_MEDIA_HOSTS = ['freepik.com', 'magnific.com', 'magnific.ai', 'cdnpk.net'];

export function providerMediaHostAllowed(hostname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const extra = String(env.AUTOPILOT_PROVIDER_MEDIA_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return [...DEFAULT_PROVIDER_MEDIA_HOSTS, ...extra].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export type MediaFetcher = (url: string, opts: { maxBytes: number; timeoutMs: number }) => Promise<{ buffer: Buffer; mimeType: string }>;

/**
 * Downloads provider output. HTTPS only, allowlisted hosts only, at most one
 * redirect (to another allowlisted HTTPS host), SSRF-guarded at DNS and
 * connection time, byte-capped and time-boxed.
 */
export function createProviderMediaFetcher(env: NodeJS.ProcessEnv = process.env): MediaFetcher {
  return async (rawUrl, { maxBytes, timeoutMs }) => {
    let url = rawUrl;
    for (let hop = 0; hop < 2; hop++) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new AssetPipelineError('INVALID_PROVIDER_RESPONSE', 'Provider returned an invalid media URL.', 'fetch'); }
      if (parsed.protocol !== 'https:') throw new AssetPipelineError('UNSAFE_MEDIA_URL', 'Provider media URL is not HTTPS.', 'fetch');
      if (!providerMediaHostAllowed(parsed.hostname, env)) {
        throw new AssetPipelineError('UNSAFE_MEDIA_URL', `Provider media host ${parsed.hostname} is not on the allowlist (AUTOPILOT_PROVIDER_MEDIA_HOSTS).`, 'fetch');
      }
      let res;
      try {
        res = await safeAxios<ArrayBuffer>({
          url,
          method: 'GET',
          responseType: 'arraybuffer',
          maxRedirects: 0,
          maxContentLength: maxBytes,
          timeout: timeoutMs,
          validateStatus: () => true,
        });
      } catch (err: any) {
        const tooBig = /maxContentLength/i.test(String(err?.message));
        throw new AssetPipelineError(tooBig ? 'MEDIA_TOO_LARGE' : 'MEDIA_FETCH_FAILED', tooBig ? 'Provider media exceeds the size limit.' : `Provider media download failed: ${err?.message || 'network error'}`, 'fetch', !tooBig);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.location && hop === 0) {
        url = new URL(String(res.headers.location), url).toString();
        continue;
      }
      if (res.status !== 200) throw new AssetPipelineError('MEDIA_FETCH_FAILED', `Provider media download returned HTTP ${res.status}.`, 'fetch', res.status >= 500 || res.status === 429);
      return { buffer: Buffer.from(res.data), mimeType: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase() };
    }
    throw new AssetPipelineError('UNSAFE_MEDIA_URL', 'Provider media URL redirected more than once.', 'fetch');
  };
}

export type DeliveryVerifier = (url: string, expected: { mimeType: string; firstBytes: Buffer }) => Promise<void>;

/** Fetches the first bytes through the delivery URL, the way a social platform would. */
export const verifyDeliveryOverHttps: DeliveryVerifier = async (url, expected) => {
  if (!/^https:\/\//.test(url)) throw new AssetPipelineError('DELIVERY_NOT_HTTPS', 'Delivery URL is not HTTPS; social platforms will not fetch it.', 'verify');
  let res;
  try {
    res = await safeAxios<ArrayBuffer>({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: { Range: `bytes=0-${expected.firstBytes.length - 1}` },
      maxRedirects: 2,
      maxContentLength: 64 * 1024 * 1024,
      timeout: 20_000,
      validateStatus: () => true,
    });
  } catch (err: any) {
    throw new AssetPipelineError('DELIVERY_UNREACHABLE', `Delivery URL could not be fetched: ${err?.message || 'network error'}`, 'verify', true);
  }
  if (res.status !== 200 && res.status !== 206) throw new AssetPipelineError('DELIVERY_UNREACHABLE', `Delivery URL returned HTTP ${res.status}.`, 'verify', res.status >= 500);
  const got = Buffer.from(res.data).subarray(0, expected.firstBytes.length);
  if (!got.equals(expected.firstBytes)) throw new AssetPipelineError('DELIVERY_CONTENT_MISMATCH', 'Delivery URL served different bytes than were stored.', 'verify');
  const ctype = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ctype && ctype !== expected.mimeType && ctype !== 'application/octet-stream') {
    throw new AssetPipelineError('DELIVERY_CONTENT_MISMATCH', `Delivery URL serves ${ctype}, expected ${expected.mimeType}.`, 'verify');
  }
};

export interface AssetPipelineDeps {
  storage: AssetStorageDriver | null;
  records: AssetRecordStore;
  fetchMedia?: MediaFetcher;
  verifyDelivery?: DeliveryVerifier | null;
  /** Retries of the storage write before giving up; bytes are kept in memory across them. */
  storageAttempts?: number;
}

export function tenantStorageNamespace(tenantId: string): string {
  return createHash('sha256').update(`autopilot-tenant:${tenantId}`).digest('hex').slice(0, 24);
}

export async function persistMediaBytes(
  deps: AssetPipelineDeps,
  input: {
    tenantId: string;
    contentItemId: string | null;
    workflowRunId: string | null;
    slot: string;
    buffer: Buffer;
    declaredMime?: string | null;
    expectedMediaType?: 'image' | 'video';
    provider: string;
    model: string;
    providerRequestId?: string | null;
    provenance: Record<string, any>;
    isDemo: boolean;
  },
): Promise<AutopilotAssetRecord> {
  if (!deps.storage) throw new AssetPipelineError('STORAGE_NOT_CONFIGURED', 'No asset storage is configured (set AUTOPILOT_ASSET_STORAGE / AUTOPILOT_S3_*).', 'store');

  let info: MediaInspection;
  try {
    info = inspectMedia(input.buffer, input.declaredMime);
  } catch (err) {
    if (err instanceof MediaValidationError) throw new AssetPipelineError(err.code, err.message, 'validate');
    throw err;
  }
  if (input.expectedMediaType && info.mediaType !== input.expectedMediaType) {
    throw new AssetPipelineError('UNEXPECTED_MEDIA_TYPE', `Expected ${input.expectedMediaType} output but received ${info.mimeType}.`, 'validate');
  }

  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  const ns = tenantStorageNamespace(input.tenantId);
  const storageKey = `autopilot/${ns}/${input.contentItemId ?? 'unattached'}/${sha256}.${extensionForMime(info.mimeType)}`;

  // Same bytes for the same item already stored and recorded: reuse it.
  const existing = await deps.records.findAssetByKey(input.tenantId, storageKey);
  if (existing && !existing.deleted_at) return existing;

  const attempts = Math.max(1, deps.storageAttempts ?? 3);
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await deps.storage.put(storageKey, input.buffer, info.mimeType, { sha256, tenantId: input.tenantId });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof StorageError) || !err.retryable) break;
    }
  }
  if (lastErr) {
    const e = lastErr as any;
    throw new AssetPipelineError(e?.code || 'STORAGE_WRITE_FAILED', e?.message || 'Asset storage write failed.', 'store', Boolean(e?.retryable));
  }

  const stored = await deps.storage.head(storageKey).catch((err) => {
    throw new AssetPipelineError('STORAGE_READ_FAILED', err?.message || 'Could not confirm the stored object.', 'verify', true);
  });
  if (!stored) throw new AssetPipelineError('STORAGE_OBJECT_MISSING', 'Stored object is not present after upload.', 'verify', true);
  if (stored.bytes !== info.bytes) throw new AssetPipelineError('STORAGE_SIZE_MISMATCH', `Stored ${stored.bytes} bytes, expected ${info.bytes}.`, 'verify', true);
  if (stored.mimeType && stored.mimeType !== info.mimeType) throw new AssetPipelineError('STORAGE_MIME_MISMATCH', `Stored type ${stored.mimeType}, expected ${info.mimeType}.`, 'verify');
  if (stored.sha256 && stored.sha256 !== sha256) throw new AssetPipelineError('STORAGE_CHECKSUM_MISMATCH', 'Stored checksum does not match the uploaded bytes.', 'verify');

  let deliveryVerifiedAt: string | null = null;
  let deliveryError: string | null = null;
  if (deps.verifyDelivery) {
    try {
      await deps.verifyDelivery(deps.storage.deliveryUrl(storageKey, 600), { mimeType: info.mimeType, firstBytes: input.buffer.subarray(0, 16) });
      deliveryVerifiedAt = new Date().toISOString();
    } catch (err: any) {
      // The object is durable; keep the record so delivery can be re-verified
      // without paying for generation again. Publishing stays blocked.
      deliveryError = `${err?.code || 'DELIVERY_UNVERIFIED'}: ${err?.message || 'delivery check failed'}`.slice(0, 500);
    }
  } else {
    deliveryError = 'DELIVERY_UNVERIFIED: no delivery verifier configured';
  }

  const now = new Date().toISOString();
  const record: AutopilotAssetRecord = {
    id: randomUUID(),
    tenant_id: input.tenantId,
    content_item_id: input.contentItemId,
    workflow_run_id: input.workflowRunId,
    slot: input.slot,
    storage_driver: deps.storage.name,
    storage_key: storageKey,
    sha256,
    mime_type: info.mimeType,
    media_type: info.mediaType,
    byte_size: info.bytes,
    width: info.width,
    height: info.height,
    duration_ms: info.durationMs,
    video_codec: info.videoCodec,
    provider: input.provider,
    model: input.model,
    provider_request_id: input.providerRequestId ?? null,
    provenance: input.provenance,
    is_demo: input.isDemo,
    qa_state: 'pending',
    delivery_verified_at: deliveryVerifiedAt,
    delivery_error: deliveryError,
    retention_class: input.isDemo ? 'temporary' : 'draft',
    expires_at: input.isDemo ? new Date(Date.now() + 7 * 86400_000).toISOString() : null,
    created_at: now,
    deleted_at: null,
  };
  try {
    return await deps.records.saveAsset(record);
  } catch (err: any) {
    // The object is stored under a content-addressed key, so a retry finds and
    // records it; the orphan sweep removes it if the retry never comes.
    throw new AssetPipelineError('ASSET_RECORD_FAILED', `Stored media could not be recorded: ${err?.message || 'database error'}`, 'record', true);
  }
}

/** Turns a successful provider result into a stored, verified asset. */
export async function persistProviderOutput(
  deps: AssetPipelineDeps,
  input: {
    tenantId: string;
    contentItemId: string;
    workflowRunId: string;
    slot: string;
    result: Extract<VisualGenerationResult, { ok: true }>;
    provenance: Record<string, any>;
    isDemo?: boolean;
  },
): Promise<AutopilotAssetRecord> {
  const { result } = input;
  let buffer: Buffer;
  let declared = result.mimeType;
  if (result.bytes && result.bytes.length) {
    buffer = Buffer.from(result.bytes);
  } else if (result.sourceUrl) {
    const fetcher = deps.fetchMedia ?? createProviderMediaFetcher();
    const fetched = await fetcher(result.sourceUrl, {
      maxBytes: result.mediaType === 'video' ? 300 * 1024 * 1024 : 30 * 1024 * 1024,
      timeoutMs: result.mediaType === 'video' ? 120_000 : 45_000,
    });
    buffer = fetched.buffer;
    declared = fetched.mimeType && fetched.mimeType !== 'application/octet-stream' ? fetched.mimeType : result.mimeType;
  } else {
    throw new AssetPipelineError('INVALID_PROVIDER_RESPONSE', 'Provider reported success without media bytes or a URL.', 'fetch');
  }
  return persistMediaBytes(deps, {
    tenantId: input.tenantId,
    contentItemId: input.contentItemId,
    workflowRunId: input.workflowRunId,
    slot: input.slot,
    buffer,
    declaredMime: declared,
    expectedMediaType: result.mediaType,
    provider: result.provider,
    model: result.model,
    providerRequestId: result.providerRequestId ?? null,
    provenance: input.provenance,
    isDemo: Boolean(input.isDemo),
  });
}

/** URLs that must never reach a publishable item or a social platform. */
export function isForbiddenMediaUrl(url: string | null | undefined): boolean {
  const u = String(url || '').trim();
  if (!u) return true;
  if (/^data:/i.test(u) || /^blob:/i.test(u)) return true;
  if (/cdn\.contentflow\.local/i.test(u)) return true;
  if (!/^https:\/\//i.test(u)) return true;
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.invalid')) return true;
  } catch {
    return true;
  }
  return false;
}
