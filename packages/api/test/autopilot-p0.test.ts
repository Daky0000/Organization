// Acceptance tests for the P0 items of the autopilot production-completion
// spec: model registry (P0-1), durable media (P0-2/3), accounting (P0-4),
// publishing (P0-5) and release diagnostics (P0-6).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ||= 'z'.repeat(32);

import {
  getModelCapabilityRegistry,
  listSelectableModels,
  modelSelectability,
  priceFromReportedUsage,
  resolveSelectableModel,
  ModelUnavailableError,
  refreshModelRegistryOverrides,
} from '../src/server/autopilot/creativeBriefAndRouter.ts';
import { OPENAI_IMAGE_MODELS, openaiImageSizeForAspect } from '../src/server/openaiRoutes.ts';
import { creditsForUsd } from '../src/server/aiPricing.ts';
import { buildAutopilotVisualAdapter, classifyProviderHttpError, decodeStrictBase64 } from '../src/server/autopilot/autopilotProviderBridge.ts';
import { inspectMedia, MediaValidationError } from '../src/server/autopilot/mediaInspection.ts';
import { createMemoryStorageDriver, createS3Driver, signDeliveryToken, verifyDeliveryToken } from '../src/server/autopilot/assetStorage.ts';
import { createProviderMediaFetcher, isForbiddenMediaUrl, persistMediaBytes, AssetPipelineError } from '../src/server/autopilot/assetPipeline.ts';
import { evaluateMediaPublishability } from '../src/server/autopilot/mediaQa.ts';
import { createMemoryJobAccounting, BudgetPolicyError } from '../src/server/autopilot/billingAndBudgetService.ts';
import { executeAutopilotWorkflow, AutopilotWorkflowError } from '../src/server/autopilot/workflowOrchestrator.ts';
import { createAutopilotRepository } from '../src/server/autopilot/repository.ts';
import {
  processDueAutopilotPublications,
  executePublication,
  zonedLocalToUtc,
  scheduleApprovedContentItem,
  cancelPublication,
  type StagedPublisher,
} from '../src/server/autopilot/lifecycleAndPublishingService.ts';
import { registerAutopilotRoutes } from '../src/server/autopilot/autopilotRoutes.ts';
import { resolveAutopilotTenant, type AutopilotTenantContext } from '../src/server/autopilot/tenantContext.ts';
import { buildAutopilotDiagnostics } from '../src/server/autopilot/diagnostics.ts';
import type { ContentItemRecord, PublicationRecord } from '../src/server/autopilot/types.ts';
import { fakeVisualAdapter, jpegFixture, mp4Fixture, pngFixture } from './helpers/media-fixtures.ts';

const T = 'user:p0_owner';
const U = 'p0_owner';

function owner(tenantId = T, userId = U): AutopilotTenantContext {
  return { tenantId, orgId: null, projectId: null, userId, userRole: 'owner', canEdit: true, canApprove: true, canPublish: true, correlationId: 'test' };
}

async function seed(repo: ReturnType<typeof createAutopilotRepository>, overrides: Partial<ContentItemRecord> = {}, tenantId = T, userId = U) {
  await repo.upsertBusinessProfile(tenantId, userId, null, null, {
    business_name: 'Acme Studio',
    industry: 'Design',
    capacity: {
      weekly_hours: 5, monthly_budget_usd: 100, monthly_credit_cap: 5000, has_founder_footage: false, has_product_demos: false,
      has_photography: false, has_customer_permissions: false, approval_mode: 'mandatory', allowed_publisher_roles: [],
    } as any,
  });
  const now = new Date().toISOString();
  return repo.saveContentItem({
    id: overrides.id ?? `item_${Math.random().toString(36).slice(2, 10)}`,
    tenant_id: tenantId, org_id: null, project_id: null, owner_user_id: userId, strategy_id: null, strategy_version: null,
    brand_profile_id: null, brand_version: null, campaign_name: 'Launch', pillar_id: 'p1', pillar_name: 'Education', funnel_stage: 'awareness',
    title: 'Three ways to ship faster', hook: 'Ship faster.', caption: 'A clear checklist for weekly releases.', channel_variants: {},
    format: 'static_graphic', workflow_type: 'branded_social_graphic', target_channels: ['instagram'], lifecycle_state: 'brief_ready',
    approval_required: true, risk_flags: [], validation_report: {}, media_assets: [], deterministic_overlay: {}, slides: [], storyboard: [],
    alt_text: 'Checklist graphic', disclosures: [], scheduled_slot: null, linked_blog_post_id: null, version: 1, created_by: userId,
    approved_by: null, approved_at: null, created_at: now, updated_at: now,
    ...overrides,
  });
}

function memRepo() {
  return createAutopilotRepository({ pool: { query: async () => ({ rows: [] }) } as any, hasDatabase: () => false });
}

// ════════════════════════════════════════════════════════════════════════════
// P0-1 Model registry
// ════════════════════════════════════════════════════════════════════════════

test('P0-1: registry is consistent — every selectable model has an adapter, a pricing policy and a verified contract', () => {
  const env = { AUTOPILOT_MODEL_ROLLOUT: '' } as any;
  for (const m of getModelCapabilityRegistry()) {
    assert.ok(['per_token', 'flat_estimate', 'none', 'unknown'].includes(m.pricing.method), `${m.id} has a cost policy`);
    assert.ok(m.contract_source, `${m.id} names where its contract comes from`);
    const sel = modelSelectability(m, { env });
    if (sel.selectable) {
      assert.notEqual(m.adapter, 'none', `${m.id} is selectable so it must have an adapter`);
      assert.ok(m.contract_verified_at, `${m.id} is selectable without rollout so its contract must be verified`);
      assert.ok(m.lifecycle === 'active');
    }
  }
  // Shut-down OpenAI models can never be picked, by ID or by upstream name.
  for (const id of ['openai:gpt-image-1', 'gpt-image-1', 'openai:gpt-image-1-mini', 'dall-e-3', 'no-such-model']) {
    assert.throws(() => resolveSelectableModel(id, { env }), ModelUnavailableError, id);
  }
  // The image route's model list and the autopilot registry agree.
  const registryOpenAi = getModelCapabilityRegistry()
    .filter((m) => m.provider === 'openai' && m.output_type === 'image' && modelSelectability(m, { env }).selectable)
    .map((m) => m.model)
    .sort();
  assert.deepEqual(Object.keys(OPENAI_IMAGE_MODELS).sort(), registryOpenAi);
  for (const m of getModelCapabilityRegistry().filter((x) => x.provider === 'openai' && x.lifecycle === 'active' && x.output_type === 'image')) {
    assert.equal(OPENAI_IMAGE_MODELS[m.model].credits, m.internal_credits, `${m.id} credits drift`);
  }
});

test('P0-1: rollout flag gates unverified Magnific contracts; overrides cannot resurrect a retired model', () => {
  const entry = getModelCapabilityRegistry().find((m) => m.id === 'magnific:magnific-one')!;
  assert.deepEqual(modelSelectability(entry, { env: {} as any }), { selectable: false, reason: 'unverified_contract' });
  assert.deepEqual(modelSelectability(entry, { env: { AUTOPILOT_MODEL_ROLLOUT: 'magnific:magnific-one' } as any }), { selectable: true });

  refreshModelRegistryOverrides({ 'openai:gpt-image-1': { enabled: true, lifecycle: 'active', model: 'gpt-image-2.5-flare' } as any });
  const retired = getModelCapabilityRegistry().find((m) => m.id === 'openai:gpt-image-1')!;
  assert.equal(retired.lifecycle, 'retired', 'lifecycle is not overridable');
  assert.equal(retired.model, 'gpt-image-1', 'the upstream ID is not overridable');
  assert.equal(modelSelectability(retired).selectable, false);
  refreshModelRegistryOverrides({ 'openai:gpt-image-1': { enabled: false } });

  const past = getModelCapabilityRegistry().find((m) => m.id === 'openai:gpt-image-1-mini')!;
  assert.equal(modelSelectability({ ...past, enabled: true, lifecycle: 'active' }, { now: new Date('2026-12-02T00:00:00Z') }).selectable, false);
});

test('P0-1: GET /models returns exactly the registry with selectability; PUT brief rejects a retired model with MODEL_UNAVAILABLE', async () => {
  const repo = memRepo();
  const item = await seed(repo);
  const app = express();
  app.use(express.json());
  app.use('/api', registerAutopilotRoutes({
    requireAuth: () => ({ userId: U }),
    pool: { query: async () => ({ rows: [] }) } as any,
    hasDatabase: () => false,
    repo,
  }));
  const models = await request(app).get('/api/autopilot/models').expect(200);
  assert.deepEqual(models.body.models.map((m: any) => m.id), listSelectableModels().map((m) => m.id));
  assert.ok(models.body.models.every((m: any) => typeof m.selectable === 'boolean'));

  const rejected = await request(app).put(`/api/autopilot/items/${item.id}/brief`).send({ selected_model: 'gpt-image-1' }).expect(422);
  assert.equal(rejected.body.code, 'MODEL_UNAVAILABLE');
  assert.equal(rejected.body.details.replacement_model_id, 'openai:gpt-image-2.5-sunburst');

  const accepted = await request(app).put(`/api/autopilot/items/${item.id}/brief`).send({ selected_model: 'gpt-image-2.5-flare', estimated_provider_cost_usd: 0 }).expect(200);
  assert.equal(accepted.body.brief.controls.requested_model_id, 'openai:gpt-image-2.5-flare');
  assert.ok(accepted.body.brief.estimated_provider_cost_usd > 0, 'cost fields come from the server, not the client');

  // Registry overrides are global: a workspace owner is not a platform admin.
  await request(app).post('/api/autopilot/models/refresh').send({ overrides: {} }).expect(403);
});

test('P0-1: OpenAI adapter sends the exact model, a valid size and no response_format; classifies 401/429/504/timeout', async () => {
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  const sent: any[] = [];
  const okHttp = {
    post: async (_url: string, body: any) => {
      sent.push(body);
      return { headers: { 'x-request-id': 'req_abc' }, data: { data: [{ b64_json: jpegFixture().toString('base64') }], usage: { input_tokens: 100, output_tokens: 2000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } } };
    },
    get: async () => ({ status: 200 }),
  } as any;
  const adapter = buildAutopilotVisualAdapter({ http: okHttp });
  const ok = await adapter({ provider: 'openai', model: 'gpt-image-2.5-flare', modelId: 'openai:gpt-image-2.5-flare', prompt: 'p', aspectRatio: '4:5', referenceUrls: [], outputFormat: 'jpeg' });
  assert.equal(ok.ok, true);
  assert.equal(sent[0].model, 'gpt-image-2.5-flare');
  assert.equal('response_format' in sent[0], false, 'GPT image models reject response_format');
  assert.equal(sent[0].output_format, 'jpeg');
  const [w, h] = sent[0].size.split('x').map(Number);
  assert.ok(w % 16 === 0 && h % 16 === 0 && w / h >= 1 / 3 && w / h <= 3, `size ${sent[0].size} is valid for gpt-image-2.5`);
  if (ok.ok) assert.equal(ok.providerRequestId, 'req_abc');

  for (const aspect of ['1:1', '4:5', '3:4', '4:3', '16:9', '9:16']) {
    const [aw, ah] = openaiImageSizeForAspect(aspect).split('x').map(Number);
    assert.ok(aw % 16 === 0 && ah % 16 === 0, aspect);
  }

  const retired = await adapter({ provider: 'openai', model: 'gpt-image-1', modelId: 'openai:gpt-image-1', prompt: 'p', aspectRatio: '1:1', referenceUrls: [] });
  assert.equal(retired.ok, false);
  if (!retired.ok) {
    assert.equal(retired.code, 'MODEL_UNAVAILABLE');
    assert.equal(retired.billing, 'not_submitted');
  }
  assert.equal(sent.length, 1, 'a retired model never reaches the provider');

  const auth = classifyProviderHttpError({ response: { status: 401, headers: {} } });
  assert.equal(auth.code, 'PROVIDER_AUTH_FAILED');
  assert.equal(auth.retryable, false);
  assert.equal(classifyProviderHttpError({ response: { status: 429, headers: {} } }).retryable, true);
  assert.equal(classifyProviderHttpError({ response: { status: 504, headers: {} } }).billing, 'unknown_outcome');
  assert.equal(classifyProviderHttpError({ code: 'ECONNABORTED' }).billing, 'unknown_outcome');
  assert.equal(classifyProviderHttpError({ code: 'ENOTFOUND' }).billing, 'not_submitted');

  const malformedHttp = { post: async () => ({ headers: {}, data: { data: [{ b64_json: '%%%not base64' }] } }), get: async () => ({}) } as any;
  const malformed = await buildAutopilotVisualAdapter({ http: malformedHttp })({ provider: 'openai', model: 'gpt-image-2.5-flare', modelId: 'openai:gpt-image-2.5-flare', prompt: 'p', aspectRatio: '1:1', referenceUrls: [] });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, 'INVALID_PROVIDER_RESPONSE');
  assert.equal(decodeStrictBase64(''), null);
  assert.equal(decodeStrictBase64('abc'), null);
  delete process.env.OPENAI_API_KEY;

  assert.equal(priceFromReportedUsage({ method: 'per_token', text_input_usd_per_mtok: 5, image_input_usd_per_mtok: 8, image_output_usd_per_mtok: 30 }, { output_tokens: 1_000_000, input_tokens_details: { text_tokens: 0, image_tokens: 0 } }), 30);
  assert.equal(priceFromReportedUsage({ method: 'flat_estimate' }, { output_tokens: 10 }), null);
  assert.equal(priceFromReportedUsage({ method: 'per_token' }, undefined), null);
});

// ════════════════════════════════════════════════════════════════════════════
// P0-2 / P0-3 Durable media
// ════════════════════════════════════════════════════════════════════════════

test('P0-2/3: media inspection rejects empty, spoofed, malformed and oversized files by content, not label', () => {
  const ok = inspectMedia(jpegFixture(1080, 1350), 'image/jpeg');
  assert.deepEqual([ok.mimeType, ok.width, ok.height], ['image/jpeg', 1080, 1350]);
  const vid = inspectMedia(mp4Fixture({ width: 1080, height: 1920, durationMs: 9000 }), 'video/mp4');
  assert.deepEqual([vid.mimeType, vid.width, vid.height, vid.durationMs, vid.videoCodec], ['video/mp4', 1080, 1920, 9000, 'avc1']);

  const code = (fn: () => unknown) => { try { fn(); return 'none'; } catch (e) { return e instanceof MediaValidationError ? e.code : 'other'; } };
  assert.equal(code(() => inspectMedia(Buffer.alloc(0))), 'EMPTY_MEDIA');
  assert.equal(code(() => inspectMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))), 'UNSUPPORTED_MEDIA');
  assert.equal(code(() => inspectMedia(pngFixture(), 'video/mp4')), 'MIME_MISMATCH', 'PNG bytes labelled as video are refused');
  assert.equal(code(() => inspectMedia(mp4Fixture({ withMoov: false }), 'video/mp4')), 'MALFORMED_MEDIA', 'a video with no moov is refused');
  assert.equal(code(() => inspectMedia(pngFixture(10, 10))), 'INVALID_DIMENSIONS');
  const huge = Buffer.concat([jpegFixture(), Buffer.alloc(31 * 1024 * 1024)]);
  assert.equal(code(() => inspectMedia(huge, 'image/jpeg')), 'MEDIA_TOO_LARGE');
});

test('P0-2/3: forbidden URLs never count as durable media, and the provider fetcher refuses non-allowlisted, HTTP and private targets', async () => {
  for (const bad of ['', 'data:image/png;base64,AAAA', 'https://cdn.contentflow.local/autopilot/x.mp4', 'http://example.com/a.jpg', 'https://localhost/a.jpg', 'blob:abc']) {
    assert.equal(isForbiddenMediaUrl(bad), true, bad);
  }
  const fetcher = createProviderMediaFetcher({ AUTOPILOT_PROVIDER_MEDIA_HOSTS: '' } as any);
  const refused = async (url: string) => {
    try { await fetcher(url, { maxBytes: 1024, timeoutMs: 1000 }); return 'fetched'; } catch (e) { return e instanceof AssetPipelineError ? e.code : 'other'; }
  };
  assert.equal(await refused('http://cdn.freepik.com/a.png'), 'UNSAFE_MEDIA_URL');
  assert.equal(await refused('https://169.254.169.254/latest/meta-data'), 'UNSAFE_MEDIA_URL');
  assert.equal(await refused('https://evil.example.com/a.png'), 'UNSAFE_MEDIA_URL');
  assert.equal(await refused('https://cdn.freepik.com.evil.example/a.png'), 'UNSAFE_MEDIA_URL', 'suffix tricks do not pass the allowlist');
});

test('P0-2/3: a stored asset is verified (bytes, type, checksum) and repeated retries reuse one object; a storage outage is retried from retained bytes', async () => {
  const repo = memRepo();
  const storage = createMemoryStorageDriver();
  const deps = { storage, records: repo, verifyDelivery: async () => {} };
  const input = { tenantId: T, contentItemId: 'item_x', workflowRunId: 'run_x', slot: 'primary', buffer: jpegFixture(), declaredMime: 'image/jpeg', provider: 'openai', model: 'gpt-image-2.5-flare', provenance: {}, isDemo: false };
  storage.failNextPut = 2; // two outages, then storage recovers
  const a = await persistMediaBytes({ ...deps, storageAttempts: 3 }, input);
  const b = await persistMediaBytes(deps, input);
  assert.equal(a.id, b.id, 'same bytes for the same item resolve to one asset');
  assert.equal(storage.objects.size, 1);
  assert.ok(a.delivery_verified_at);
  assert.match(a.storage_key, /^autopilot\/[0-9a-f]{24}\/item_x\/[0-9a-f]{64}\.jpg$/);
  assert.ok(!a.storage_key.includes(T), 'storage keys do not expose tenant or user IDs');

  storage.failNextPut = 5;
  await assert.rejects(
    persistMediaBytes({ ...deps, storageAttempts: 3 }, { ...input, buffer: jpegFixture(1080, 1080) }),
    (e: any) => e instanceof AssetPipelineError && e.stage === 'store',
  );
  storage.failNextPut = 0;

  // Delivery that cannot be fetched from outside keeps the asset (no re-generation) but marks it unpublishable.
  const unreachable = await persistMediaBytes({ ...deps, verifyDelivery: async () => { throw Object.assign(new Error('403 from bucket'), { code: 'DELIVERY_UNREACHABLE' }); } }, { ...input, buffer: jpegFixture(1080, 1200) });
  assert.equal(unreachable.delivery_verified_at, null);
  assert.match(String(unreachable.delivery_error), /DELIVERY_UNREACHABLE/);
});

test('P0-2/3: the publishability gate blocks inline URLs, demo assets, unverified delivery, cross-tenant asset IDs and non-JPEG Instagram images', async () => {
  const repo = memRepo();
  const storage = createMemoryStorageDriver();
  const deps = { storage, records: repo, verifyDelivery: async () => {} };
  const base = { tenantId: T, contentItemId: 'i1', workflowRunId: 'r1', slot: 's', declaredMime: null, provider: 'x', model: 'y', provenance: {} };
  const png = await persistMediaBytes(deps, { ...base, buffer: pngFixture(1080, 1080), isDemo: false });
  const demo = await persistMediaBytes(deps, { ...base, buffer: jpegFixture(1080, 1081), isDemo: true });
  const other = await persistMediaBytes(deps, { ...base, tenantId: 'user:someone_else', buffer: jpegFixture(1080, 1082), isDemo: false });
  const item = await seed(repo, {
    media_assets: [
      { url: 'data:image/png;base64,AAAA', type: 'image' },
      { url: '', asset_id: png.id, type: 'image' },
      { url: '', asset_id: demo.id, type: 'image' },
      { url: '', asset_id: other.id, type: 'image' },
    ],
  });
  const assets = await repo.getAssetsByIds(T, item.media_assets.map((m) => m.asset_id ?? '').filter(Boolean));
  const codes = evaluateMediaPublishability({ item, assets, channels: ['instagram'] }).map((i) => i.code);
  for (const c of ['MEDIA_NOT_DURABLE', 'DEMO_ASSET_NOT_PUBLISHABLE', 'ASSET_NOT_FOUND', 'IG_IMAGE_REQUIRES_JPEG']) assert.ok(codes.includes(c), c);
  assert.equal(assets.get(other.id), null, 'another tenant\'s asset ID resolves to nothing');
});

test('P0-2/3: a failed provider never produces media — no empty URL, no fake CDN URL, no sandbox switch', async () => {
  const repo = memRepo();
  const item = await seed(repo);
  const accounting = createMemoryJobAccounting();
  const storage = createMemoryStorageDriver();
  await assert.rejects(
    executeAutopilotWorkflow({
      repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: item.id, accounting, sandbox: false, retryDelayMs: 0,
      assets: { storage, verifyDelivery: async () => {} },
      visualAdapter: async () => ({ ok: false, code: 'PROVIDER_NOT_CONFIGURED', safeMessage: 'OpenAI is not configured.', billing: 'not_submitted', retryable: false }),
    }),
    (e: any) => e instanceof AutopilotWorkflowError && e.code === 'PROVIDER_NOT_CONFIGURED',
  );
  const after = (await repo.getContentItem(T, item.id))!;
  assert.equal(after.lifecycle_state, 'generation_failed');
  assert.deepEqual(after.media_assets, []);
  assert.equal(storage.objects.size, 0);
  const [res] = [...accounting.reservations.values()];
  assert.equal(res.settled_credits, 0, 'nothing delivered, nothing charged');
  assert.equal(res.credits_held, 0);

  // Missing storage is refused before any provider call or reservation.
  let calls = 0;
  await assert.rejects(
    executeAutopilotWorkflow({ repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: (await seed(repo)).id, accounting, assets: {}, visualAdapter: async (i) => { calls++; return fakeVisualAdapter()(i); } }),
    (e: any) => e.code === 'STORAGE_NOT_CONFIGURED',
  );
  assert.equal(calls, 0);
});

test('P0-2/3: sandbox demo renders go through storage, are labelled DEMO — NOT PUBLISHABLE and cannot be approved for publishing', async () => {
  const repo = memRepo();
  const item = await seed(repo);
  const storage = createMemoryStorageDriver();
  const out = await executeAutopilotWorkflow({
    repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: item.id, sandbox: true,
    accounting: createMemoryJobAccounting(), assets: { storage, verifyDelivery: async () => {} },
  });
  assert.equal(out.item.execution_mode, 'sandbox_demo');
  assert.equal(out.item.media_assets[0].is_demo, true);
  assert.equal(storage.objects.size, 1);
  assert.ok((out.item.validation_report as any).issues.some((i: any) => i.code === 'DEMO_ASSET_NOT_PUBLISHABLE'));
  assert.equal(out.accounting?.settled_credits, 0);
  assert.equal((out.item.deterministic_overlay as any).preview_raster_data_url, '', 'no base64 blob in the content row');
});

test('P0-2/3: signed delivery tokens expire and cannot be reused for another key; S3 presigning matches the AWS SigV4 test vector', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signDeliveryToken('k1', exp);
  assert.equal(verifyDeliveryToken('k1', exp, sig), true);
  assert.equal(verifyDeliveryToken('k2', exp, sig), false);
  assert.equal(verifyDeliveryToken('k1', exp - 120, sig), false);
  assert.equal(verifyDeliveryToken('k1', exp, sig, exp + 1), false, 'expired');

  // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html example.
  const s3 = createS3Driver({
    endpoint: 'https://examplebucket.s3.amazonaws.com',
    addressing: 'virtual',
    region: 'us-east-1',
    bucket: 'examplebucket',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    clock: () => new Date('2013-05-24T00:00:00Z'),
  });
  const url = new URL(s3.deliveryUrl('test.txt', 86400));
  assert.equal(url.pathname, '/test.txt');
  assert.equal(url.searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

// ════════════════════════════════════════════════════════════════════════════
// P0-4 Accounting
// ════════════════════════════════════════════════════════════════════════════

const reserveInput = (key: string, over: Record<string, any> = {}) => ({
  tenantId: T, userId: U, contentItemId: 'i', workflowRunId: `run_${key}`, idempotencyKey: key, units: 1,
  unitCreditRate: 10, unitEstimatedUsd: 0.6, provider: 'openai', model: 'gpt-image-2.5-flare', isMock: false, userConfirmedSpend: true, ...over,
});

test('P0-4: two concurrent jobs that together exceed the monthly cap — only one reserves', async () => {
  const acc = createMemoryJobAccounting({ controls: () => ({ monthly_budget_usd: 1.0, confirmation_threshold_usd: 5 }) });
  const results = await Promise.allSettled([acc.reserve(reserveInput('a')), acc.reserve(reserveInput('b'))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'MONTHLY_BUDGET_EXCEEDED');
});

test('P0-4: reserve, settle and release are idempotent; duplicate settlement charges once', async () => {
  const acc = createMemoryJobAccounting();
  const r1 = await acc.reserve(reserveInput('k1'));
  const r2 = await acc.reserve(reserveInput('k1'));
  assert.equal(r1.id, r2.id, 'same key, same reservation, one hold');
  assert.equal(acc.wallets.get(U)!.held, 10);
  await acc.markUnitSubmitted(T, 'k1', 0);
  await acc.recordUnitOutcome(T, 'k1', { index: 0, state: 'succeeded', delivered: true, actualUsd: 0.054 });
  const s1 = await acc.settle(T, 'k1');
  const s2 = await acc.settle(T, 'k1');
  assert.equal(s1.settled_credits, 10);
  assert.equal(s2.settled_credits, 10);
  assert.equal(acc.wallets.get(U)!.held, 0);
  assert.equal(acc.wallets.get(U)!.credits, 100000 - 10);
  assert.equal(acc.events.filter((e) => e.entryType === 'settlement').length, 1);
  assert.equal(s1.cost_status, 'actual');
  assert.equal(s1.actual_provider_cost_usd, 0.054);

  await acc.reserve(reserveInput('k2'));
  const rel1 = await acc.release(T, 'k2', 'cancelled');
  const rel2 = await acc.release(T, 'k2', 'cancelled again');
  assert.equal(rel1.status, 'released');
  assert.equal(rel2.status, 'released');
  assert.equal(acc.events.filter((e) => e.key === 'k2:release').length, 1);
  // Releasing after work reached a provider is refused: it must be settled or reconciled.
  await acc.reserve(reserveInput('k3'));
  await acc.markUnitSubmitted(T, 'k3', 0);
  await assert.rejects(acc.release(T, 'k3', 'x'), (e: any) => e instanceof BudgetPolicyError && e.code === 'RELEASE_AFTER_SUBMISSION');
});

test('P0-4: a provider timeout is an unknown outcome — the hold stays until reconciled, nothing is charged or refunded blindly', async () => {
  const repo = memRepo();
  const item = await seed(repo);
  const accounting = createMemoryJobAccounting();
  let calls = 0;
  await assert.rejects(
    executeAutopilotWorkflow({
      repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: item.id, accounting, retryDelayMs: 0,
      assets: { storage: createMemoryStorageDriver(), verifyDelivery: async () => {} },
      visualAdapter: async () => { calls++; return { ok: false, code: 'PROVIDER_TIMEOUT', safeMessage: 'timed out', billing: 'unknown_outcome', retryable: false, providerRequestId: 'req_t' }; },
    }),
    (e: any) => e.code === 'PROVIDER_TIMEOUT',
  );
  assert.equal(calls, 1, 'an ambiguous submission is never resubmitted');
  const [res] = [...accounting.reservations.values()];
  assert.equal(res.status, 'reconciliation_required');
  assert.equal(res.credits_held, res.unit_credit_rate, 'the unknown unit keeps its hold');
  assert.equal(res.settled_credits, 0);
  const run = (await repo.listWorkflowRuns(T, item.id))[0];
  assert.equal(run.status, 'reconciliation_required');

  // Reconciliation: the provider confirms it never produced an image.
  const resolved = await accounting.resolveUnknownUnit(T, res.idempotency_key, 0, { delivered: false, spentUsd: 0, note: 'provider says no image', actor: 'ops' });
  assert.equal(resolved.status, 'settled');
  assert.equal(resolved.credits_held, 0);
  assert.equal(resolved.settled_credits, 0);
});

test('P0-4: retryable definitive failures retry within the ceiling; provider success with storage failure records spend without charging or regenerating', async () => {
  const repo = memRepo();
  const accounting = createMemoryJobAccounting();
  const storage = createMemoryStorageDriver();
  let calls = 0;
  const flaky = async (i: any) => {
    calls++;
    if (calls < 3) return { ok: false as const, code: 'PROVIDER_RATE_LIMITED' as const, safeMessage: '429', billing: 'definitive_failure' as const, retryable: true };
    return fakeVisualAdapter()(i);
  };
  const ok = await executeAutopilotWorkflow({ repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: (await seed(repo)).id, accounting, retryDelayMs: 0, maxProviderRetries: 2, assets: { storage, verifyDelivery: async () => {} }, visualAdapter: flaky });
  assert.equal(calls, 3);
  // The image model's provider cost × 1.54, in credits (server/aiPricing.ts).
  assert.equal(ok.accounting?.settled_credits, creditsForUsd(0.129), 'one delivered image, charged once');
  assert.equal(ok.accounting?.cost_status, 'actual', 'usage was reported');

  calls = 0;
  storage.failNextPut = 10;
  await assert.rejects(
    executeAutopilotWorkflow({ repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: (await seed(repo)).id, accounting, retryDelayMs: 0, assets: { storage, verifyDelivery: async () => {}, storageAttempts: 2 }, visualAdapter: async (i) => { calls++; return fakeVisualAdapter()(i); } }),
    (e: any) => e.code === 'ASSET_PERSISTENCE_FAILED',
  );
  storage.failNextPut = 0;
  assert.equal(calls, 1, 'storage failure does not trigger blind regeneration');
  const failed = [...accounting.reservations.values()].at(-1)!;
  assert.equal(failed.settled_credits, 0, 'customer is not charged for media that was not delivered');
  assert.ok(failed.actual_provider_cost_usd > 0, 'provider spend is still recorded');
  assert.equal(failed.status, 'settled');
});

test('P0-4: a kill switch flipped after queueing stops the provider call; missing usage is labelled estimated; rate changes do not rewrite history', async () => {
  const repo = memRepo();
  let killed = false;
  const accounting = createMemoryJobAccounting({ controls: () => ({ kill_switch_generation: killed }) });
  // The switch flips after the budget is reserved and before the provider call.
  const flipping = { ...accounting, reserve: async (i: any) => { const r = await accounting.reserve(i); killed = true; return r; } };
  let calls = 0;
  await assert.rejects(
    executeAutopilotWorkflow({
      repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: (await seed(repo)).id, accounting: flipping, retryDelayMs: 0,
      assets: { storage: createMemoryStorageDriver(), verifyDelivery: async () => {} },
      visualAdapter: async (i) => { calls++; return fakeVisualAdapter()(i); },
    }),
    (e: any) => e.code === 'KILL_SWITCH_ACTIVE',
  );
  assert.equal(calls, 0, 'kill switch is re-checked immediately before the external call');
  const stopped = [...accounting.reservations.values()].at(-1)!;
  assert.equal(stopped.credits_held, 0, 'the hold is returned');
  assert.equal(stopped.settled_credits, 0);
  killed = false;

  const est = await executeAutopilotWorkflow({ repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: (await seed(repo)).id, accounting, retryDelayMs: 0, assets: { storage: createMemoryStorageDriver(), verifyDelivery: async () => {} }, visualAdapter: fakeVisualAdapter([], { usage: false }) });
  assert.equal(est.accounting?.cost_status, 'estimated');

  const r = await accounting.reserve(reserveInput('rate', { unitCreditRate: 12 }));
  refreshModelRegistryOverrides({ 'openai:gpt-image-2.5-flare': { internal_credits: 99 } });
  await accounting.markUnitSubmitted(T, 'rate', 0);
  await accounting.recordUnitOutcome(T, 'rate', { index: 0, state: 'succeeded', delivered: true, actualUsd: null });
  const s = await accounting.settle(T, 'rate');
  refreshModelRegistryOverrides({ 'openai:gpt-image-2.5-flare': { internal_credits: 8 } });
  assert.equal(r.unit_credit_rate, 12);
  assert.equal(s.settled_credits, 12, 'the rate captured at reservation is what settles');
});

// ════════════════════════════════════════════════════════════════════════════
// P0-5 Publishing
// ════════════════════════════════════════════════════════════════════════════

function fakeInstagram(opts: { publishOutcome?: 'ok' | 'lost' | 'retry'; containerStatus?: string[]; account?: 'ok' | 'revoked' } = {}) {
  const log = { create: 0, check: 0, publish: 0, find: 0 };
  let statusQueue = [...(opts.containerStatus ?? ['FINISHED'])];
  let published = false;
  const staged: StagedPublisher = {
    async checkAccount() { return opts.account === 'revoked' ? { ok: false, code: 'RECONNECT_ACCOUNT', message: 'reconnect' } : { ok: true }; },
    async createContainer() { log.create++; return { ok: true, containerId: `cont_${log.create}` }; },
    async checkContainer() {
      log.check++;
      if (published) return { status: 'PUBLISHED' };
      return { status: (statusQueue.length > 1 ? statusQueue.shift() : statusQueue[0]) as any };
    },
    async publishContainer() {
      log.publish++;
      if (opts.publishOutcome === 'lost') { published = true; return { ok: false, code: 'PUBLISH_OUTCOME_UNKNOWN', message: 'lost', retryable: false, outcome: 'unknown' }; }
      if (opts.publishOutcome === 'retry' && log.publish === 1) return { ok: false, code: '2', message: 'transient', retryable: true, outcome: 'definitive' };
      published = true;
      return { ok: true, mediaId: '17890000000000001', permalink: 'https://www.instagram.com/p/ABC123/' };
    },
    async findPublishedMedia() { log.find++; return published ? { mediaId: '17890000000000001', permalink: 'https://www.instagram.com/p/ABC123/' } : null; },
  };
  return { staged, log };
}

async function approvedItem(repo: ReturnType<typeof createAutopilotRepository>, storage = createMemoryStorageDriver(), channels = ['instagram']) {
  const item = await seed(repo, { target_channels: channels });
  await executeAutopilotWorkflow({ repo, tenantId: T, actorUserId: U, actorRole: 'owner', itemId: item.id, accounting: createMemoryJobAccounting(), retryDelayMs: 0, assets: { storage, verifyDelivery: async () => {} }, visualAdapter: fakeVisualAdapter() });
  const fresh = (await repo.getContentItem(T, item.id))!;
  fresh.lifecycle_state = 'approved';
  fresh.approved_by = U;
  fresh.approved_at = new Date().toISOString();
  await repo.saveContentItem(fresh);
  return fresh;
}

async function approvedScheduledItem(repo: ReturnType<typeof createAutopilotRepository>, storage = createMemoryStorageDriver(), channels = ['instagram']) {
  const item = await approvedItem(repo, storage, channels);
  const fresh = item;
  const { publications } = await scheduleApprovedContentItem({ repo, tenant: owner(), itemId: item.id, scheduledAt: new Date(Date.now() + 60_000).toISOString(), channels });
  // make them due now
  for (const p of publications) await repo.transitionPublication(T, p.id, ['scheduled'], { scheduled_at: new Date(Date.now() - 1000).toISOString() });
  return { item: fresh, publications, storage };
}

test('P0-5: Instagram feed post goes container → processing → published with the real media ID and permalink', async () => {
  const repo = memRepo();
  const { publications, storage } = await approvedScheduledItem(repo);
  const ig = fakeInstagram({ containerStatus: ['IN_PROGRESS', 'FINISHED'] });
  const deps = { repo, storage, stagedPublishers: { instagram: ig.staged }, workerId: 'w1' };
  await processDueAutopilotPublications(deps);
  let pub = (await repo.getPublication(T, publications[0].id))!;
  assert.equal(pub.status, 'remote_processing');
  assert.equal(pub.provider_container_id, 'cont_1', 'the container ID is persisted before polling');
  await repo.transitionPublication(T, pub.id, ['remote_processing'], { next_attempt_at: new Date(Date.now() - 1000).toISOString() });
  await processDueAutopilotPublications(deps);
  pub = (await repo.getPublication(T, pub.id))!;
  assert.equal(pub.status, 'published');
  assert.equal(pub.remote_post_id, '17890000000000001');
  assert.equal(pub.permalink, 'https://www.instagram.com/p/ABC123/');
  assert.equal(ig.log.create, 1);
  assert.equal(ig.log.publish, 1);
  assert.equal((await repo.getContentItem(T, pub.content_item_id))!.lifecycle_state, 'published');
});

test('P0-5: a lost publish response reconciles from the container state without a second post', async () => {
  const repo = memRepo();
  const { publications, storage } = await approvedScheduledItem(repo);
  const ig = fakeInstagram({ publishOutcome: 'lost' });
  const deps = { repo, storage, stagedPublishers: { instagram: ig.staged }, workerId: 'w1' };
  await processDueAutopilotPublications(deps);
  let pub = (await repo.getPublication(T, publications[0].id))!;
  assert.equal(pub.status, 'reconciliation_required');
  assert.equal(pub.remote_post_id, null, 'no ID is invented');
  await repo.transitionPublication(T, pub.id, ['reconciliation_required'], { next_attempt_at: new Date(Date.now() - 1000).toISOString() });
  await processDueAutopilotPublications(deps);
  pub = (await repo.getPublication(T, pub.id))!;
  assert.equal(pub.status, 'published');
  assert.equal(pub.remote_post_id, '17890000000000001');
  assert.equal(ig.log.publish, 1, 'media_publish was called exactly once');
});

test('P0-5: two workers cannot submit the same publication', async () => {
  const repo = memRepo();
  const { publications, storage } = await approvedScheduledItem(repo);
  const ig = fakeInstagram();
  const deps = (w: string) => ({ repo, storage, stagedPublishers: { instagram: ig.staged }, workerId: w });
  await Promise.all([processDueAutopilotPublications(deps('w1')), processDueAutopilotPublications(deps('w2'))]);
  assert.equal(ig.log.create, 1);
  assert.equal((await repo.getPublication(T, publications[0].id))!.status, 'published');
});

test('P0-5: approval revoked, kill switch on, deleted media or revoked token are caught before any platform call', async () => {
  // approval revoked
  {
    const repo = memRepo();
    const { item, publications, storage } = await approvedScheduledItem(repo);
    item.approved_by = null;
    await repo.saveContentItem(item);
    const ig = fakeInstagram();
    await processDueAutopilotPublications({ repo, storage, stagedPublishers: { instagram: ig.staged } });
    const pub = (await repo.getPublication(T, publications[0].id))!;
    assert.equal(pub.status, 'publish_failed');
    assert.equal(pub.error_code, 'UNAPPROVED_PUBLISH_BLOCKED');
    assert.equal(ig.log.create, 0);
  }
  // global publishing kill switch: deferred, not failed, and nothing sent
  {
    const repo = memRepo();
    const { publications, storage } = await approvedScheduledItem(repo);
    const ig = fakeInstagram();
    process.env.AUTOPILOT_PUBLISHING_KILL_SWITCH = 'true';
    try {
      await processDueAutopilotPublications({ repo, storage, stagedPublishers: { instagram: ig.staged } });
    } finally {
      delete process.env.AUTOPILOT_PUBLISHING_KILL_SWITCH;
    }
    const pub = (await repo.getPublication(T, publications[0].id))!;
    assert.equal(pub.status, 'scheduled');
    assert.equal(pub.error_code, 'KILL_SWITCH_ACTIVE');
    assert.equal(ig.log.create, 0);
  }
  // stored object deleted
  {
    const repo = memRepo();
    const { publications, storage } = await approvedScheduledItem(repo);
    storage.objects.clear();
    const ig = fakeInstagram();
    await processDueAutopilotPublications({ repo, storage, stagedPublishers: { instagram: ig.staged } });
    const pub = (await repo.getPublication(T, publications[0].id))!;
    assert.equal(pub.error_code, 'MEDIA_UNAVAILABLE');
    assert.equal(ig.log.create, 0);
  }
  // revoked token: a reconnect action, not an endless retry
  {
    const repo = memRepo();
    const { publications, storage } = await approvedScheduledItem(repo);
    const ig = fakeInstagram({ account: 'revoked' });
    await processDueAutopilotPublications({ repo, storage, stagedPublishers: { instagram: ig.staged } });
    const pub = (await repo.getPublication(T, publications[0].id))!;
    assert.equal(pub.status, 'publish_failed');
    assert.equal(pub.error_code, 'RECONNECT_ACCOUNT');
  }
});

test('P0-5: one-shot channels never get an invented post ID; channels fail and succeed independently', async () => {
  const repo = memRepo();
  const { publications, storage } = await approvedScheduledItem(repo, createMemoryStorageDriver(), ['instagram', 'linkedin']);
  const ig = fakeInstagram();
  await processDueAutopilotPublications({
    repo, storage, stagedPublishers: { instagram: ig.staged },
    publisherAdapter: async () => ({ remotePostId: '' }),
  });
  const byChannel = Object.fromEntries((await repo.listPublications(T, publications[0].content_item_id)).map((p) => [p.channel, p]));
  assert.equal(byChannel.instagram.status, 'published');
  assert.equal(byChannel.linkedin.status, 'reconciliation_required');
  assert.equal(byChannel.linkedin.remote_post_id, null);
  assert.equal(byChannel.linkedin.error_code, 'PUBLISHED_WITHOUT_ID');
});

test('P0-5: transient errors back off and stop at the attempt ceiling; a published post is deduplicated on retry', async () => {
  const repo = memRepo();
  const { publications, storage } = await approvedScheduledItem(repo, createMemoryStorageDriver(), ['linkedin']);
  let calls = 0;
  const adapter = async () => { calls++; throw Object.assign(new Error('Service unavailable'), { status: 503 }); };
  const deps = { repo, storage, publisherAdapter: adapter };
  for (let i = 0; i < 8; i++) {
    await processDueAutopilotPublications(deps);
    const p = (await repo.getPublication(T, publications[0].id))!;
    if (p.status === 'retry_wait') await repo.transitionPublication(T, p.id, ['retry_wait'], { next_attempt_at: new Date(Date.now() - 1000).toISOString() });
  }
  const p = (await repo.getPublication(T, publications[0].id))!;
  assert.equal(p.status, 'publish_failed');
  assert.equal(p.error_code, 'RETRIES_EXHAUSTED');
  assert.ok(calls <= 6, `bounded attempts (${calls})`);

  const repo2 = memRepo();
  const two = await approvedScheduledItem(repo2, createMemoryStorageDriver(), ['linkedin']);
  let posts = 0;
  const deps2 = { repo: repo2, storage: two.storage, publisherAdapter: async () => { posts++; return { remotePostId: 'urn:li:share:1' }; } };
  const first = await executePublication({ ...deps2, tenant: owner(), publicationId: two.publications[0].id });
  const again = await executePublication({ ...deps2, tenant: owner(), publicationId: two.publications[0].id });
  assert.equal(first.publication.status, 'published');
  assert.equal(again.deduplicated, true);
  assert.equal(posts, 1);
  await assert.rejects(cancelPublication(repo2, owner(), two.publications[0].id), (e: any) => e.code === 'ALREADY_PUBLISHED');
});

test('P0-5: scheduling stores UTC with the IANA zone, rejects DST gaps, past times, bad zones and editor scheduling', async () => {
  assert.equal(zonedLocalToUtc('2026-11-25T10:00', 'America/Chicago').iso, '2026-11-25T16:00:00.000Z');
  assert.throws(() => zonedLocalToUtc('2027-03-14T02:30', 'America/New_York'), (e: any) => e.code === 'DST_GAP');
  const fallBack = zonedLocalToUtc('2026-11-01T01:30', 'America/New_York');
  assert.equal(fallBack.ambiguous, true);
  assert.equal(fallBack.iso, '2026-11-01T05:30:00.000Z', 'the earlier of the two instants');

  const repo = memRepo();
  const item = await approvedItem(repo);
  await assert.rejects(scheduleApprovedContentItem({ repo, tenant: owner(), itemId: item.id, scheduledAt: '2020-01-01T00:00:00Z' }), (e: any) => e.code === 'SCHEDULE_IN_PAST');
  await assert.rejects(scheduleApprovedContentItem({ repo, tenant: owner(), itemId: item.id, timezone: 'Mars/Olympus' }), (e: any) => e.code === 'INVALID_TIMEZONE');
  await assert.rejects(scheduleApprovedContentItem({ repo, tenant: owner(), itemId: item.id, scheduledLocal: '2027-03-14T02:30', timezone: 'America/New_York' }), (e: any) => e.code === 'DST_GAP');
  const editor = { ...owner(), userRole: 'editor' as const, canApprove: false, canPublish: false };
  await assert.rejects(scheduleApprovedContentItem({ repo, tenant: editor, itemId: item.id }), (e: any) => e.code === 'SCHEDULE_PERMISSION_DENIED');
  const ok = await scheduleApprovedContentItem({ repo, tenant: owner(), itemId: item.id, scheduledLocal: '2030-06-01T09:00', timezone: 'Europe/London' });
  assert.equal(ok.publications[0].scheduled_at, '2030-06-01T08:00:00.000Z');
  assert.equal(ok.publications[0].timezone, 'Europe/London');
  assert.equal(ok.publications[0].acting_user_id, U, 'the scheduling user is recorded and re-authorized at publish time');
});

// ════════════════════════════════════════════════════════════════════════════
// P0-6 Diagnostics and tenant guard
// ════════════════════════════════════════════════════════════════════════════

test('P0-6: diagnostics report build SHA, storage probe and selectable models without secrets', async () => {
  process.env.OPENAI_API_KEY = 'sk-should-never-appear-123456';
  const storage = createMemoryStorageDriver();
  const report = await buildAutopilotDiagnostics({
    pool: null,
    storage: { driver: storage, configured: true, description: 'memory' },
    providerDeps: { http: { get: async () => ({ status: 200 }), post: async () => ({}) } as any },
    checkStorageWrite: true,
  });
  delete process.env.OPENAI_API_KEY;
  assert.ok('commit_sha' in report.build);
  assert.equal(report.storage.probe, 'ok');
  assert.equal(storage.objects.size, 0, 'the probe cleans up after itself');
  assert.ok(report.execution.selectable_models.includes('openai:gpt-image-2.5-flare'));
  assert.ok(!report.execution.selectable_models.includes('openai:gpt-image-1'));
  assert.ok(!JSON.stringify(report).includes('sk-should-never-appear'), 'no credential in the report');
});

test('P0-6: the role-simulation header is ignored in production and can never elevate', async () => {
  const req: any = { headers: { 'x-autopilot-role': 'viewer' }, query: {}, body: {} };
  const res: any = { status: () => res, json: () => res };
  const prev = process.env.NODE_ENV;
  const t1 = await resolveAutopilotTenant(req, res, () => ({ userId: 'u1' }), null, () => false);
  assert.equal(t1?.userRole, 'viewer', 'narrowing works outside production');
  process.env.NODE_ENV = 'production';
  try {
    const t2 = await resolveAutopilotTenant(req, res, () => ({ userId: 'u1' }), null, () => false);
    assert.equal(t2?.userRole, 'owner', 'header ignored in production');
  } finally {
    process.env.NODE_ENV = prev;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Real PostgreSQL: the guarantees an in-memory double cannot prove
// ════════════════════════════════════════════════════════════════════════════

test('PostgreSQL P0: tenant lock serialises concurrent reservations, holds use the credit wallet, ledger rows are immutable, leases skip locked rows', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Pool } = await import('pg');
  const { randomUUID } = await import('node:crypto');
  const { runDatabaseMigrations, computeLiveSchemaFingerprint } = await import('../src/db-migrations.ts');
  const { runPaymentMigrations } = await import('../src/payment-migrations.ts');
  const { createPgJobAccounting, upsertTenantControls, sweepStaleReservations } = await import('../src/server/autopilot/billingAndBudgetService.ts');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 12 });
  const userId = randomUUID();
  const tenantId = `user:${userId}`;
  try {
    await runDatabaseMigrations(pool);
    await runPaymentMigrations(pool);
    await pool.query(`INSERT INTO users (id, email, password_hash, role, status) VALUES ($1, $2, 'fixture_hash', 'user', 'active')`, [userId, `p0-${userId}@example.com`]);
    await pool.query(
      `INSERT INTO user_credits (user_id, credits, purchased_credits, reset_date) VALUES ($1, 1000, 0, NOW() + INTERVAL '1 month')
       ON CONFLICT (user_id) DO UPDATE SET credits = 1000, purchased_credits = 0, reserved_credits = 0`,
      [userId],
    );
    await upsertTenantControls(pool, tenantId, { monthly_budget_usd: 1.0, confirmation_threshold_usd: 5, per_job_max_usd: 5 }, userId);

    const acc = createPgJobAccounting(pool);
    const input = (key: string) => ({
      tenantId, userId, contentItemId: null as any, workflowRunId: randomUUID(), idempotencyKey: key, units: 1,
      unitCreditRate: 10, unitEstimatedUsd: 0.6, provider: 'openai', model: 'gpt-image-2.5-flare', isMock: false, userConfirmedSpend: true,
    });
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => acc.reserve(input(`pg-k${i}`))));
    const won = results.filter((r) => r.status === 'fulfilled');
    assert.equal(won.length, 1, 'only one job fits under the $1.00 monthly cap, even when six race');
    const wallet = await pool.query(`SELECT credits, reserved_credits FROM user_credits WHERE user_id = $1`, [userId]);
    assert.equal(Number(wallet.rows[0].reserved_credits), 10);

    const key = (won[0] as PromiseFulfilledResult<any>).value.idempotency_key;
    await acc.markUnitSubmitted(tenantId, key, 0, 'req_pg');
    await acc.recordUnitOutcome(tenantId, key, { index: 0, state: 'succeeded', delivered: true, actualUsd: 0.05 });
    const [s1, s2] = await Promise.all([acc.settle(tenantId, key), acc.settle(tenantId, key)]);
    assert.equal(s1.settled_credits, 10);
    assert.equal(s2.settled_credits, 10);
    const after = await pool.query(`SELECT credits, reserved_credits FROM user_credits WHERE user_id = $1`, [userId]);
    assert.equal(Number(after.rows[0].credits), 990, 'charged exactly once');
    assert.equal(Number(after.rows[0].reserved_credits), 0);
    const debits = await pool.query(`SELECT COUNT(*)::int AS n FROM credit_events WHERE user_id = $1 AND delta < 0`, [userId]);
    assert.equal(debits.rows[0].n, 1);

    await assert.rejects(pool.query(`UPDATE autopilot_accounting_events SET status = 'tampered' WHERE tenant_id = $1`, [tenantId]), /immutable/);
    const evt = await pool.query(`SELECT idempotency_key FROM autopilot_accounting_events WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    await assert.rejects(
      pool.query(
        `INSERT INTO autopilot_accounting_events (id, tenant_id, user_id, reservation_id, attempt_key, idempotency_key, entry_type, status) VALUES ($1,$2,$3,$4,'x',$5,'adjustment','x')`,
        [randomUUID(), tenantId, userId, randomUUID(), evt.rows[0].idempotency_key],
      ),
      /duplicate key/,
    );

    // A reservation that never reached a provider is released by the sweep; a submitted one goes to reconciliation.
    await upsertTenantControls(pool, tenantId, { monthly_budget_usd: 50 }, userId);
    const stale1 = await acc.reserve(input('pg-stale-reserved'));
    const stale2 = await acc.reserve(input('pg-stale-submitted'));
    await acc.markUnitSubmitted(tenantId, stale2.idempotency_key, 0);
    await pool.query(`UPDATE autopilot_budget_reservations SET updated_at = NOW() - INTERVAL '2 hours' WHERE idempotency_key = ANY($1)`, [[stale1.idempotency_key, stale2.idempotency_key]]);
    const swept = await sweepStaleReservations(pool, acc, { graceMinutes: 30 });
    assert.ok(swept.released >= 1 && swept.flagged >= 1);
    assert.equal((await acc.get(tenantId, stale1.idempotency_key))!.status, 'released');
    assert.equal((await acc.get(tenantId, stale2.idempotency_key))!.status, 'reconciliation_required');

    // Leasing: two workers asking at once get disjoint rows.
    const repo = createAutopilotRepository({ pool, hasDatabase: () => true });
    const item = await seed(repo, { id: randomUUID(), target_channels: ['instagram', 'linkedin', 'facebook'] }, tenantId, userId);
    const now = new Date().toISOString();
    for (const ch of ['instagram', 'linkedin', 'facebook']) {
      await repo.savePublication({
        id: randomUUID(), tenant_id: tenantId, content_item_id: item.id, channel: ch, social_account_id: null, platform_media_type: 'FEED_POST',
        slot_name: 's', timezone: 'UTC', scheduled_at: new Date(Date.now() - 60_000).toISOString(), status: 'scheduled', remote_post_id: null,
        error_message: null, retryable: false, acting_user_id: userId, published_at: null, created_at: now, updated_at: now,
      } as PublicationRecord);
    }
    const [l1, l2] = await Promise.all([repo.leaseDuePublications('w1', 2), repo.leaseDuePublications('w2', 2)]);
    const ids1 = new Set(l1.filter((p) => p.tenant_id === tenantId).map((p) => p.id));
    const ids2 = l2.filter((p) => p.tenant_id === tenantId).map((p) => p.id);
    assert.ok(ids2.every((id) => !ids1.has(id)), 'no publication leased twice');
    assert.equal(ids1.size + ids2.length, 3);

    const fp = await computeLiveSchemaFingerprint(pool);
    assert.match(fp.fingerprint, /^[0-9a-f]{64}$/);
    console.log(`[release-evidence] schema_fingerprint=${fp.fingerprint} tables=${fp.tables} columns=${fp.columns} indexes=${fp.indexes}`);
    const mig = await pool.query(`SELECT checksum FROM schema_migrations WHERE version = '2026.10.29-autopilot-p0'`);
    assert.match(mig.rows[0]?.checksum ?? '', /^[0-9a-f]{64}$/, 'the P0 migration records a real checksum');
  } finally {
    await pool.query(`DELETE FROM autopilot_publications WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await pool.query(`DELETE FROM autopilot_content_items WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await pool.query(`DELETE FROM autopilot_business_profiles WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await pool.query(`DELETE FROM autopilot_budget_reservations WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await pool.query(`DELETE FROM autopilot_tenant_controls WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await pool.query(`DELETE FROM credit_events WHERE user_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM credit_ledger WHERE user_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM user_credits WHERE user_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.end();
  }
});
