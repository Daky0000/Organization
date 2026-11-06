import { randomUUID } from 'crypto';
import { getMediaMode } from '../chatActions.ts';
import { autopilotTasteInputs, autopilotUsesStyle, loadTaste, type Taste } from '../imageTaste.ts';
import { dbQuery } from '../../db.ts';
import type { AutopilotRepository } from './repository.ts';
import {
  buildBrandAwarePrompt,
  createCreativeBriefForItem,
  estimateGenerationCost,
  routeModelForBrief,
  priceFromReportedUsage,
  ModelUnavailableError,
  type RoutedModelSelection,
} from './creativeBriefAndRouter.ts';
import { composeDeterministicBrandLayer, renderLayerRaster, type DeterministicLayerSpec } from './deterministicCompositor.ts';
import { maskSecretsAndPii, validateAutopilotContentItem } from './validationAndPolicyService.ts';
import { BudgetPolicyError, createJobAccounting, type JobAccounting, type ReservationRecord } from './billingAndBudgetService.ts';
import {
  AssetPipelineError,
  persistMediaBytes,
  persistProviderOutput,
  verifyDeliveryOverHttps,
  type AssetPipelineDeps,
  type AutopilotAssetRecord,
  type MediaFetcher,
  type VisualGenerationResult,
} from './assetPipeline.ts';
import { evaluateMediaPublishability, mergeValidationIssues } from './mediaQa.ts';
import { fetchMediaBytes } from '../../ssrf-guard.ts';
import type { Pool } from 'pg';
import type {
  BrandAssetRecord,
  BrandProfileRecord,
  BusinessProfileRecord,
  CarouselSlideSpec,
  ContentItemRecord,
  CreativeBriefRecord,
  VideoStoryboardScene,
  WorkflowNodeExecution,
  WorkflowRunRecord,
} from './types.ts';

export class AutopilotWorkflowError extends Error {
  code: string;
  status: number;
  details?: Record<string, any>;

  constructor(code: string, message: string, status = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'AutopilotWorkflowError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface VisualProviderAdapterInput {
  provider: string;
  model: string;
  /** Registry ID; the adapter re-validates it and never substitutes another model. */
  modelId?: string;
  prompt: string;
  aspectRatio: string;
  referenceUrls: string[];
  magnificSpaceId?: string;
  magnificFlowId?: string;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  quality?: 'low' | 'medium' | 'high';
  /** Whose taught image style applies (Brand Kit, example designs, rules, saved items). */
  userId?: string;
  /** False when the user switched "use my image style in Autopilot" off. */
  useTaste?: boolean;
}

export type VisualProviderAdapter = (input: VisualProviderAdapterInput) => Promise<VisualGenerationResult>;
/** @deprecated kept for callers of the old name; the adapter now returns a typed result. */
export type VisualProviderAdapterResult = VisualGenerationResult;

export interface WorkflowAssetDeps extends Partial<Omit<AssetPipelineDeps, 'records'>> {
  records?: AssetPipelineDeps['records'];
  /** Fetches customer media (brand assets, demo captures); defaults to the SSRF-guarded fetcher. */
  fetchCustomerMedia?: (url: string) => Promise<{ buffer: Buffer; mimeType: string }>;
  fetchMedia?: MediaFetcher;
}

export interface ExecuteWorkflowParams {
  repo: AutopilotRepository;
  pool?: Pick<Pool, 'query'> | null;
  hasDatabase?: () => boolean;
  tenantId: string;
  actorUserId: string;
  actorRole: string;
  itemId: string;
  preferDraftCost?: boolean;
  slideCount?: number;
  regenerateSceneNumbers?: number[];
  regenerateFailedScenesOnly?: boolean;
  regenerateCaptionOnly?: boolean;
  regenerateSlideIndices?: number[];
  proposedPaletteHexes?: string[];
  demoCaptureUrl?: string;
  magnificSpaceId?: string;
  magnificFlowId?: string;
  availableProviders?: Set<string>;
  visualAdapter?: VisualProviderAdapter;
  copyAdapter?: (prompt: string, systemPrompt?: string) => Promise<string>;
  accounting?: JobAccounting;
  assets?: WorkflowAssetDeps;
  /** Explicit demo mode. Defaults to AUTOPILOT_SANDBOX_MODE=true; never switched on by a provider failure. */
  sandbox?: boolean;
  /** Client idempotency key for this attempt; resending it replays the earlier run. */
  attemptKey?: string;
  maxProviderRetries?: number;
  retryDelayMs?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
}

function enforceOneIdeaPerSlide(rawBody: string): string {
  const cleaned = String(rawBody || '').trim();
  if (!cleaned) return '';
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(' ').slice(0, 220);
}

function buildDefaultSlides(
  item: ContentItemRecord,
  brief: CreativeBriefRecord,
  business: BusinessProfileRecord,
  desiredCount: number,
): CarouselSlideSpec[] {
  const count = Math.min(10, Math.max(2, desiredCount));
  const brandOrBiz = business.business_name || 'Our team';
  const slides: CarouselSlideSpec[] = [];

  for (let idx = 1; idx <= count; idx++) {
    if (idx === 1) {
      slides.push({
        slide_number: 1,
        heading: brief.hook_message.slice(0, 90),
        body: enforceOneIdeaPerSlide(brief.intended_takeaway || item.hook),
        alt_text: `Slide 1 of ${count}: ${brief.hook_message}`,
      });
    } else if (idx === count) {
      slides.push({
        slide_number: count,
        heading: 'Key Takeaway & Next Step',
        body: enforceOneIdeaPerSlide(brief.cta || `Explore how ${brandOrBiz} supports this workflow.`),
        alt_text: `Slide ${count} of ${count}: Summary and call to action — ${brief.cta}`,
      });
    } else {
      const pointNum = idx - 1;
      const proofItem = business.available_proof.filter((p) => p.verified)[(pointNum - 1) % Math.max(1, business.available_proof.length)];
      const bodyPoint = proofItem
        ? `Grounded in ${proofItem.type.replace('_', ' ')}: ${proofItem.summary}`
        : `Step ${pointNum}: Focus on clear execution around ${item.pillar_name.toLowerCase()}.`;
      slides.push({
        slide_number: idx,
        heading: `Core Principle ${pointNum}`,
        body: enforceOneIdeaPerSlide(bodyPoint),
        alt_text: `Slide ${idx} of ${count}: Core Principle ${pointNum} — ${item.pillar_name}`,
        source_note: proofItem?.source_url || undefined,
      });
    }
  }
  return slides;
}

function buildDefaultVideoStoryboard(
  item: ContentItemRecord,
  brief: CreativeBriefRecord,
  business: BusinessProfileRecord,
  referencedAssets: BrandAssetRecord[],
): VideoStoryboardScene[] {
  const founderClip = referencedAssets.find((a) => a.asset_type === 'founder_footage' && a.consented_likeness);
  const screenClip = referencedAssets.find((a) => a.asset_type === 'video_capture' || a.asset_type === 'product_screenshot');

  const scenes: VideoStoryboardScene[] = [
    {
      scene_number: 1,
      duration_sec: 3,
      visual_description: founderClip
        ? `Consented founder opening hook framing ${item.pillar_name}`
        : `Clean editorial visual hook illustrating ${item.title} — no music, ambient room tone only`,
      camera_motion: brief.controls.motion_intensity === 'none' ? 'locked tripod frame' : 'subtle push-in',
      voiceover: brief.hook_message,
      caption_text: brief.hook_message,
      source_type: founderClip ? 'founder_footage' : 'ai_generated',
      asset_url: founderClip?.url,
      status: 'pending',
    },
    {
      scene_number: 2,
      duration_sec: 5,
      visual_description: screenClip
        ? `Authentic workflow walkthrough using verified capture (${screenClip.name})`
        : `Structured visual breakdown of ${brief.intended_takeaway} — no music`,
      camera_motion: 'steady medium framing',
      voiceover: brief.intended_takeaway,
      caption_text: brief.intended_takeaway,
      source_type: screenClip ? 'real_screen_recording' : 'ai_generated',
      asset_url: screenClip?.url,
      status: 'pending',
    },
    {
      scene_number: 3,
      duration_sec: 4,
      visual_description: `Closing brand summary frame with clear negative space for deterministic CTA — no music`,
      camera_motion: 'static clean lockoff',
      voiceover: brief.cta,
      caption_text: brief.cta,
      source_type: 'ai_generated',
      status: 'pending',
    },
  ];

  // Guarantee multi-clip audio rule (Section 8.2 / Magnific Academy): include "no music" on AI scenes in multi-scene videos
  if (scenes.length > 1) {
    for (const sc of scenes) {
      if (sc.source_type === 'ai_generated' && !/\bno\s+music\b/i.test(sc.visual_description)) {
        sc.visual_description = `${sc.visual_description} — no music`;
      }
    }
  }

  // Never synthesize fake customer/founder testimonials when business lacks consented footage
  if (!business.capacity.has_customer_permissions) {
    for (const sc of scenes) {
      if (sc.source_type === 'customer_footage') {
        sc.source_type = 'ai_generated';
        sc.visual_description = `Illustrative workflow metaphor for ${item.pillar_name} — no music`;
      }
    }
  }

  return scenes;
}

type MediaEntry = ContentItemRecord['media_assets'][number];

class UnitFailure extends Error {
  code: string;
  status: number;
  retryable: boolean;
  constructor(code: string, message: string, status = 502, retryable = false) {
    super(message);
    this.name = 'UnitFailure';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** The overlay spec is stored with the item; its inline raster preview is not. */
function withoutInlineRaster<T extends Record<string, any>>(layer: T): T {
  return { ...layer, preview_raster_data_url: '' };
}

function rasterBytes(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

function mediaEntryFromAsset(asset: AutopilotAssetRecord, role: NonNullable<MediaEntry['role']>, altText: string, provenance: string): MediaEntry {
  return {
    url: '',
    asset_id: asset.id,
    type: asset.media_type,
    mime_type: asset.mime_type,
    is_demo: asset.is_demo,
    role,
    alt_text: altText,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    provenance,
  };
}

export async function executeAutopilotWorkflow(params: ExecuteWorkflowParams): Promise<{
  item: ContentItemRecord;
  brief: CreativeBriefRecord;
  run: WorkflowRunRecord;
  accounting?: ReservationRecord | null;
  replayed?: boolean;
}> {
  const { repo, tenantId, actorUserId, actorRole, itemId } = params;

  const item = await repo.getContentItem(tenantId, itemId);
  if (!item) {
    throw new AutopilotWorkflowError('ITEM_NOT_FOUND', 'Content item not found in this workspace.', 404);
  }

  const business = await repo.getBusinessProfile(tenantId);
  if (!business) {
    throw new AutopilotWorkflowError('BUSINESS_PROFILE_REQUIRED', 'Complete Business Profile setup before running creative workflows.', 400);
  }

  const brand: BrandProfileRecord | null = await repo.getBrandProfile(tenantId);
  const allTokens = await repo.listBrandTokens(tenantId);
  const approvedTokens = allTokens.filter((t) => t.approval_status === 'approved');

  let brief = await repo.getCreativeBrief(tenantId, item.id);
  if (!brief) {
    brief = createCreativeBriefForItem({
      item,
      business,
      brand,
      preferDraftCost: params.preferDraftCost,
      // The user's media setting: lowest-cost models unless they chose best quality.
      controlsOverride: { cost_mode: await getMediaMode(dbQuery, params.actorUserId).catch(() => 'economy' as const) },
    });
    await repo.saveCreativeBrief(brief);
  }

  // The taught image style of the item's owner (on unless they switched it off for Autopilot).
  const tasteUserId: string | null = (item as any).owner_user_id || params.actorUserId || null;
  const taste: Taste | null = tasteUserId && await autopilotUsesStyle((sql, p) => dbQuery(sql, p as any[]), tasteUserId)
    ? await loadTaste((sql, p) => dbQuery(sql, p as any[]), tasteUserId).catch(() => null)
    : null;

  // One idempotency key per intentional attempt. Re-sending the same attempt
  // key returns the earlier run instead of generating (and paying) again; a
  // deliberate regenerate omits it and gets a fresh key.
  const attemptKey = params.attemptKey ? String(params.attemptKey).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) : '';
  const idempotencyKey = `wf:${item.id}:${attemptKey || randomUUID()}`;
  if (attemptKey) {
    const prior = await repo.findWorkflowRunByIdempotencyKey(tenantId, item.id, idempotencyKey);
    if (prior) {
      const accounting = params.accounting ?? createJobAccounting(params.pool, params.hasDatabase);
      return { item, brief, run: prior, accounting: await accounting.get(tenantId, idempotencyKey), replayed: true };
    }
  }

  // The attempt ceiling counts every logical attempt, including scene-level reruns.
  const priorRuns = await repo.listWorkflowRuns(tenantId, item.id);
  const attemptNumber = priorRuns.length + 1;
  if (attemptNumber > (brief.max_attempts || 3)) {
    throw new AutopilotWorkflowError(
      'MAX_ATTEMPTS_EXCEEDED',
      `Reached maximum generation attempts (${brief.max_attempts}) for this brief. Increase max_attempts or revise the brief.`,
      429,
      { attemptNumber, maxAttempts: brief.max_attempts },
    );
  }

  // Resolve referenced assets (enforcing tenant isolation via repo.getBrandAssetById)
  const referencedAssets: BrandAssetRecord[] = [];
  for (const refId of brief.reference_asset_ids) {
    const asset = await repo.getBrandAssetById(tenantId, refId);
    if (!asset) {
      throw new AutopilotWorkflowError(
        'CROSS_TENANT_OR_MISSING_ASSET',
        `Referenced brand asset ${refId} does not exist in tenant ${tenantId}.`,
        403,
      );
    }
    referencedAssets.push(asset);
  }

  const effectiveSlideCount =
    item.workflow_type === 'carousel'
      ? (params.slideCount ?? (item.slides.length >= 2 ? item.slides.length : 4))
      : undefined;

  const targetedRegenSet = params.regenerateSceneNumbers?.length
    ? new Set(params.regenerateSceneNumbers)
    : params.regenerateFailedScenesOnly
      ? new Set(item.storyboard.filter((s) => s.status === 'failed').map((s) => s.scene_number))
      : null;

  const effectiveAiSceneCount =
    item.workflow_type === 'short_form_video'
      ? targetedRegenSet
        ? Math.max(1, targetedRegenSet.size)
        : Math.max(1, item.storyboard.filter((s) => s.source_type === 'ai_generated').length || 3)
      : undefined;

  // Execution mode is decided once, explicitly. Sandbox is never a silent
  // fallback for a failed provider: it must be switched on.
  const sandbox = params.sandbox ?? process.env.AUTOPILOT_SANDBOX_MODE === 'true';
  const executionMode: 'live_provider' | 'sandbox_demo' = sandbox ? 'sandbox_demo' : 'live_provider';

  let routed: RoutedModelSelection;
  try {
    routed = routeModelForBrief({
      workflowType: item.workflow_type,
      controls: brief.controls,
      preferDraftCost: params.preferDraftCost,
      slideCount: effectiveSlideCount,
      sceneCount: effectiveAiSceneCount,
      availableProviders: sandbox ? undefined : params.availableProviders,
      requestedModelId: sandbox ? null : brief.controls.requested_model_id,
    });
  } catch (err) {
    if (err instanceof ModelUnavailableError) {
      await repo.recordAudit(tenantId, actorUserId, actorRole, 'workflow.blocked_model_unavailable', 'content_item', item.id, err.details);
      throw new AutopilotWorkflowError('MODEL_UNAVAILABLE', err.message, 422, err.details);
    }
    throw err;
  }
  if (sandbox) {
    routed = { ...routed, primary: routed.compositor, rationale: 'Sandbox demo mode: deterministic compositor render, labelled DEMO — NOT PUBLISHABLE.' };
  }
  if (!routed.primary) {
    await repo.recordAudit(tenantId, actorUserId, actorRole, 'workflow.blocked_model_unavailable', 'content_item', item.id, routed.unavailable ?? {});
    throw new AutopilotWorkflowError('MODEL_UNAVAILABLE', routed.unavailable?.message ?? 'No model available for this task.', 422, { considered: routed.unavailable?.considered ?? [] });
  }
  const primary = routed.primary;
  const callsProvider = !sandbox && primary.provider !== 'deterministic';
  if (callsProvider && !params.visualAdapter) {
    throw new AutopilotWorkflowError('PROVIDER_NOT_CONFIGURED', `No provider adapter is configured for ${primary.id}.`, 503);
  }
  const storage = params.assets?.storage ?? null;
  if (!storage) {
    throw new AutopilotWorkflowError('STORAGE_NOT_CONFIGURED', 'Generated media needs durable storage. Configure AUTOPILOT_ASSET_STORAGE (s3 or postgres).', 503);
  }
  const assetDeps: AssetPipelineDeps = {
    storage,
    records: params.assets?.records ?? repo,
    fetchMedia: params.assets?.fetchMedia,
    verifyDelivery: params.assets?.verifyDelivery === undefined ? verifyDeliveryOverHttps : params.assets.verifyDelivery,
    storageAttempts: params.assets?.storageAttempts,
  };

  const preflightEstimate = estimateGenerationCost({
    workflowType: item.workflow_type,
    controls: brief.controls,
    spendLimitUsd: brief.spend_limit_usd,
    creditCeiling: brief.credit_ceiling,
    preferDraftCost: params.preferDraftCost,
    slideCount: effectiveSlideCount,
    aiSceneCount: effectiveAiSceneCount,
    businessCapacity: business.capacity,
    routed,
  });

  if (preflightEstimate.blocking_reason) {
    await repo.recordAudit(tenantId, actorUserId, actorRole, 'workflow.blocked_by_cost_cap', 'content_item', item.id, {
      reason: preflightEstimate.blocking_reason,
      estimated_provider_cost_usd: preflightEstimate.estimated_provider_cost_usd,
      estimated_internal_credits: preflightEstimate.estimated_internal_credits,
      spend_limit_usd: brief.spend_limit_usd,
      credit_ceiling: brief.credit_ceiling,
    });
    throw new AutopilotWorkflowError(
      preflightEstimate.blocking_code === 'MODEL_UNAVAILABLE' ? 'MODEL_UNAVAILABLE' : 'COST_CAP_BLOCKED',
      preflightEstimate.blocking_reason,
      preflightEstimate.blocking_code === 'MODEL_UNAVAILABLE' ? 422 : 402,
      { estimate: preflightEstimate },
    );
  }

  const accounting = params.accounting ?? createJobAccounting(params.pool, params.hasDatabase);
  const runId = randomUUID();
  const nowIso = new Date().toISOString();
  const nodeExecutions: WorkflowNodeExecution[] = [];
  let totalRedactions = 0;

  const runRecord: WorkflowRunRecord = {
    id: runId,
    tenant_id: tenantId,
    content_item_id: item.id,
    workflow_type: item.workflow_type,
    status: 'running',
    parameters: {
      idempotency_key: idempotencyKey,
      execution_mode: executionMode,
      selected_model_id: primary.id,
      creative_mode: brief.creative_mode,
      controls: brief.controls,
      preferDraftCost: Boolean(params.preferDraftCost),
      slideCount: effectiveSlideCount,
      regenerateSceneNumbers: targetedRegenSet ? [...targetedRegenSet] : undefined,
      magnificSpaceId: params.magnificSpaceId ?? null,
      magnificFlowId: params.magnificFlowId ?? null,
    },
    node_executions: nodeExecutions,
    estimated_provider_cost_usd: preflightEstimate.estimated_provider_cost_usd,
    actual_provider_cost_usd: 0,
    estimated_credits: preflightEstimate.estimated_internal_credits,
    actual_credits: 0,
    attempt_number: attemptNumber,
    failure_reason: null,
    provenance: { execution_mode: executionMode, selected_model_id: primary.id, routed_rationale: routed.rationale },
    created_by: actorUserId,
    created_at: nowIso,
    completed_at: null,
  };
  await repo.saveWorkflowRun(runRecord);

  const providerUnits = callsProvider ? preflightEstimate.units.visual_generations : 0;
  let reservation: ReservationRecord | null = null;
  try {
    reservation = await accounting.reserve({
      tenantId,
      userId: actorUserId,
      contentItemId: item.id,
      workflowRunId: runId,
      idempotencyKey,
      units: providerUnits,
      unitCreditRate: primary.internal_credits,
      unitEstimatedUsd: primary.provider_cost_usd,
      provider: primary.provider,
      model: primary.model,
      isMock: !callsProvider,
      userConfirmedSpend: brief.controls.user_confirmed_spend,
      meta: { execution_mode: executionMode, model_id: primary.id },
    });
  } catch (bErr: any) {
    runRecord.status = 'failed';
    runRecord.failure_reason = bErr?.message || 'Job budget blocked by policy.';
    runRecord.provenance = { ...runRecord.provenance, failure_code: bErr?.code || 'BUDGET_RESERVATION_BLOCKED' };
    runRecord.completed_at = new Date().toISOString();
    await repo.saveWorkflowRun(runRecord);
    const code = bErr instanceof BudgetPolicyError ? bErr.code : 'BUDGET_RESERVATION_BLOCKED';
    throw new AutopilotWorkflowError(code === 'KILL_SWITCH_ACTIVE' ? 'KILL_SWITCH_ACTIVE' : 'BUDGET_RESERVATION_BLOCKED', bErr?.message || 'Job budget blocked by policy.', bErr?.status || 402, {
      policy_code: code,
      ...(bErr?.details ?? {}),
    });
  }

  item.execution_mode = executionMode;
  item.lifecycle_state = 'generating';
  item.updated_at = nowIso;
  await repo.saveContentItem(item);

  const createdAssets: AutopilotAssetRecord[] = [];
  const providerSuccesses: Array<{ index: number; providerRequestId: string | null; actualUsd: number | null; usage: any; model: string }> = [];
  let nextUnit = 0;
  const maxRetries = Math.max(0, params.maxProviderRetries ?? 2);
  const retryDelayMs = params.retryDelayMs ?? 750;
  const outputFormat = (item.target_channels ?? []).some((c) => c.toLowerCase() === 'instagram') ? 'jpeg' : (params.outputFormat ?? 'jpeg');

  /** One provider call (one accounting unit), persisted as a verified asset. */
  async function generateVisual(slot: string, prompt: string, aspectRatio: string, mediaType: 'image' | 'video', sandboxLayer?: DeterministicLayerSpec): Promise<AutopilotAssetRecord> {
    if (!callsProvider) {
      if (!sandboxLayer) throw new UnitFailure('MODEL_UNAVAILABLE', 'No renderer for this slot in sandbox mode.', 422);
      const format = outputFormat === 'png' ? 'png' : 'jpeg';
      const raster = renderLayerRaster(sandboxLayer, { format, brandName: brand?.brand_name });
      const asset = await persistMediaBytes(assetDeps, {
        tenantId,
        contentItemId: item!.id,
        workflowRunId: runId,
        slot,
        buffer: rasterBytes(raster.dataUrl),
        declaredMime: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        provider: sandbox ? 'sandbox' : 'deterministic',
        model: 'deterministic-compositor-v1',
        provenance: { execution_mode: executionMode, label: sandbox ? 'DEMO — NOT PUBLISHABLE' : 'deterministic render' },
        isDemo: sandbox,
      });
      createdAssets.push(asset);
      return asset;
    }

    const index = nextUnit++;
    try {
      await accounting.assertGenerationAllowed(tenantId);
    } catch (err: any) {
      throw new UnitFailure(err?.code || 'KILL_SWITCH_ACTIVE', err?.message || 'Generation is paused.', 423);
    }
    await accounting.markUnitSubmitted(tenantId, idempotencyKey, index);

    // The user's taught image style: learned direction + bans in the prompt,
    // example designs and saved products/people/places as references.
    const taught = taste ? autopilotTasteInputs(taste, `${item?.title ?? ""} ${item?.hook ?? ""} ${item?.caption ?? ""} ${prompt}`) : null;
    const tastedPrompt = taught?.promptAddon ? `${prompt}\n\n${taught.promptAddon}` : prompt;
    const baseRefs = referencedAssets.map((a) => a.url).filter((u) => /^https:\/\//.test(u));
    let result: VisualGenerationResult | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      result = await params.visualAdapter!({
        provider: primary.provider,
        model: primary.model,
        modelId: primary.id,
        prompt: tastedPrompt,
        aspectRatio,
        // The user's own attached media first; then what they taught.
        referenceUrls: [...new Set([...baseRefs, ...(taught?.referenceUrls ?? [])])],
        userId: tasteUserId ?? undefined,
        useTaste: Boolean(taste),
        magnificSpaceId: params.magnificSpaceId,
        magnificFlowId: params.magnificFlowId,
        outputFormat: mediaType === 'image' ? outputFormat : undefined,
      });
      if (result.ok) break;
      // Never resubmit when the first call may already have run.
      if (result.billing === 'unknown_outcome' || !result.retryable || attempt === maxRetries) break;
      try {
        await accounting.assertGenerationAllowed(tenantId);
      } catch {
        break;
      }
      await sleep(retryDelayMs * 2 ** attempt * (0.8 + Math.random() * 0.4));
    }

    if (!result || !result.ok) {
      const f = result && !result.ok ? result : null;
      await accounting.recordUnitOutcome(tenantId, idempotencyKey, {
        index,
        state: f?.billing === 'unknown_outcome' ? 'unknown' : f?.billing === 'not_submitted' ? 'not_submitted' : 'failed',
        delivered: false,
        providerRequestId: f?.providerRequestId ?? null,
        errorCode: f?.code ?? 'INVALID_PROVIDER_RESPONSE',
      });
      const status = f?.code === 'PROVIDER_NOT_CONFIGURED' ? 503 : f?.code === 'MODEL_UNAVAILABLE' ? 422 : f?.code === 'PROVIDER_RATE_LIMITED' ? 429 : 502;
      throw new UnitFailure(f?.code ?? 'INVALID_PROVIDER_RESPONSE', f?.safeMessage ?? 'The provider returned no usable media.', status, Boolean(f?.retryable));
    }

    providerSuccesses.push({
      index,
      providerRequestId: result.providerRequestId ?? null,
      actualUsd: priceFromReportedUsage(primary.pricing, result.usage ?? null),
      usage: result.usage ?? null,
      model: result.model,
    });
    try {
      const asset = await persistProviderOutput(assetDeps, {
        tenantId,
        contentItemId: item!.id,
        workflowRunId: runId,
        slot,
        result,
        provenance: { execution_mode: executionMode, model_id: primary.id, provider_request_id: result.providerRequestId ?? null, prompt_chars: prompt.length },
      });
      createdAssets.push(asset);
      return asset;
    } catch (err: any) {
      if (err instanceof AssetPipelineError) {
        throw new UnitFailure(err.stage === 'validate' || err.code === 'INVALID_PROVIDER_RESPONSE' ? 'INVALID_PROVIDER_RESPONSE' : 'ASSET_PERSISTENCE_FAILED', `${err.code}: ${err.message}`, 502, err.retryable);
      }
      throw err;
    }
  }

  /** Real customer media (screenshots, captures, photos) stored the same way. */
  async function ingestCustomerMedia(slot: string, url: string, provenance: string): Promise<AutopilotAssetRecord> {
    let fetched: { buffer: Buffer; mimeType: string };
    try {
      fetched = await (params.assets?.fetchCustomerMedia ?? ((u: string) => fetchMediaBytes(u, { maxBytes: 300 * 1024 * 1024, timeoutMs: 120_000 })))(url);
    } catch (err: any) {
      throw new UnitFailure('ASSET_PERSISTENCE_FAILED', `Could not fetch the customer media: ${err?.message || 'error'}`, 422);
    }
    try {
      const asset = await persistMediaBytes(assetDeps, {
        tenantId,
        contentItemId: item!.id,
        workflowRunId: runId,
        slot,
        buffer: fetched.buffer,
        declaredMime: fetched.mimeType,
        provider: 'customer_media',
        model: 'none',
        provenance: { source: provenance },
        isDemo: false,
      });
      createdAssets.push(asset);
      return asset;
    } catch (err: any) {
      if (err instanceof AssetPipelineError) throw new UnitFailure('ASSET_PERSISTENCE_FAILED', `${err.code}: ${err.message}`, 422, err.retryable);
      throw err;
    }
  }

  try {
    // ── Node 1: Brand-aware prompt & copy sanitization (deterministic, no LLM call) ──
    const t0 = Date.now();
    const promptBundle = buildBrandAwarePrompt({ item, brief, brand, approvedTokens });

    const maskedTitle = maskSecretsAndPii(item.title);
    const maskedHook = maskSecretsAndPii(item.hook);
    const maskedCaption = maskSecretsAndPii(item.caption);
    const maskedBriefHook = maskSecretsAndPii(brief.hook_message);
    totalRedactions +=
      maskedTitle.redactionsCount + maskedHook.redactionsCount + maskedCaption.redactionsCount + maskedBriefHook.redactionsCount;

    item.title = maskedTitle.masked;
    item.hook = maskedHook.masked;
    item.caption = maskedCaption.masked;
    brief.hook_message = maskedBriefHook.masked;

    for (const ch of Object.keys(item.channel_variants || {})) {
      const m = maskSecretsAndPii(item.channel_variants[ch].caption);
      item.channel_variants[ch].caption = m.masked;
      totalRedactions += m.redactionsCount;
    }

    for (const reqDisc of business.risk_profile?.required_disclosures ?? []) {
      if (reqDisc && !item.disclosures.includes(reqDisc)) {
        item.disclosures.push(reqDisc);
      }
    }

    nodeExecutions.push({
      node_id: 'node_brief_and_copy',
      node_name: 'Brief, Brand Constraints & Secret/PII Guard',
      status: 'completed',
      provider: 'deterministic',
      model: 'brand-prompt-builder-v1',
      inputs: {
        creative_mode: brief.creative_mode,
        approved_token_count: approvedTokens.length,
        reference_count: referencedAssets.length,
      },
      outputs: {
        visual_prompt: promptBundle.visualPrompt,
        copy_directives: promptBundle.copyDirectives,
        pii_redactions: totalRedactions,
      },
      provider_cost_usd: 0,
      credits_used: 0,
      duration_ms: Math.max(1, Date.now() - t0),
    });

    if (item.workflow_type === 'branded_social_graphic') {
      const tGen = Date.now();
      const layer = composeDeterministicBrandLayer({
        brief,
        brand,
        headline: brief.hook_message || item.title,
        bodyText: brief.intended_takeaway,
        ctaText: brief.cta,
        disclosures: item.disclosures,
      });
      const altText = item.alt_text || `${item.title} — ${brief.intended_takeaway}`;
      let media: MediaEntry[] = [];
      if (primary.provider === 'deterministic' && !sandbox) {
        const photo = referencedAssets.find((a) => a.mime_type.startsWith('image/'));
        if (photo) {
          const asset = await ingestCustomerMedia('primary', photo.url, `brand_asset:${photo.id}`);
          media = [mediaEntryFromAsset(asset, 'primary', altText, 'customer_photography+deterministic-compositor-v1')];
        } else {
          // No customer photo: the deterministic brand card itself is the graphic.
          const asset = await generateVisual('primary', promptBundle.visualPrompt, brief.aspect_ratio, 'image', layer);
          media = [mediaEntryFromAsset(asset, 'primary', altText, 'deterministic-compositor-v1')];
        }
      } else {
        const asset = await generateVisual('primary', promptBundle.visualPrompt, brief.aspect_ratio, 'image', layer);
        media = [mediaEntryFromAsset(asset, 'primary', altText, `${asset.provider}:${asset.model}+deterministic-compositor-v1`)];
      }
      item.media_assets = media;
      item.deterministic_overlay = withoutInlineRaster(layer);
      if (!item.alt_text.trim()) {
        item.alt_text = `${brand?.brand_name || business.business_name || 'Brand'} graphic: ${brief.hook_message}`;
      }

      nodeExecutions.push({
        node_id: 'node_visual_generation',
        node_name: 'Brand-Guided Visual Generation',
        status: 'completed',
        provider: sandbox ? 'sandbox' : primary.provider,
        model: primary.model,
        inputs: { aspect_ratio: brief.aspect_ratio, text_in_image: brief.controls.text_in_image, magnific_flow_id: params.magnificFlowId ?? null },
        outputs: { asset_ids: media.map((m) => m.asset_id) },
        provider_cost_usd: callsProvider ? primary.provider_cost_usd : 0,
        credits_used: callsProvider ? primary.internal_credits : 0,
        duration_ms: Math.max(1, Date.now() - tGen),
      });
      nodeExecutions.push({
        node_id: 'node_deterministic_compositor',
        node_name: 'Deterministic Typography, Safe-Zone & Logo Layer',
        status: 'completed',
        provider: 'deterministic',
        model: 'deterministic-compositor-v1',
        inputs: { logo_policy: brief.controls.logo_policy },
        outputs: { contrast_ratio: layer.palette_applied.contrast_ratio, logo_enabled: layer.logo_layer.enabled },
        provider_cost_usd: 0,
        credits_used: 0,
        duration_ms: 2,
      });
    } else if (item.workflow_type === 'carousel') {
      const tCar = Date.now();
      const slides =
        item.slides.length >= 2 && !params.slideCount
          ? item.slides.map((s, idx, arr) => {
              const mHead = maskSecretsAndPii(s.heading);
              const mBody = maskSecretsAndPii(enforceOneIdeaPerSlide(s.body));
              totalRedactions += mHead.redactionsCount + mBody.redactionsCount;
              return {
                ...s,
                slide_number: idx + 1,
                heading: mHead.masked,
                body: mBody.masked,
                alt_text: s.alt_text || `Slide ${idx + 1} of ${arr.length}: ${mHead.masked}`,
              };
            })
          : buildDefaultSlides(item, brief, business, effectiveSlideCount ?? 4);

      const renderedMedia: MediaEntry[] = [];
      let coverLayer: DeterministicLayerSpec | null = null;
      for (const slide of slides) {
        const layer = composeDeterministicBrandLayer({
          brief,
          brand,
          headline: slide.heading,
          bodyText: slide.body,
          ctaText: slide.slide_number === slides.length ? brief.cta : undefined,
          disclosures: slide.slide_number === slides.length ? item.disclosures : undefined,
          slideIndex: slide.slide_number,
          totalSlides: slides.length,
        });
        if (slide.slide_number === 1) coverLayer = layer;
        const asset = await generateVisual(
          `slide-${slide.slide_number}`,
          `${promptBundle.visualPrompt} Slide ${slide.slide_number}/${slides.length}: ${slide.heading}`,
          brief.aspect_ratio,
          'image',
          layer,
        );
        slide.rendered_url = '';
        (slide as any).asset_id = asset.id;
        renderedMedia.push(mediaEntryFromAsset(asset, 'slide', slide.alt_text, `carousel_slide_${slide.slide_number}:${asset.provider}:${asset.model}`));
      }

      item.slides = slides;
      item.media_assets = renderedMedia;
      item.deterministic_overlay = coverLayer ? withoutInlineRaster(coverLayer) : {};
      if (!item.alt_text.trim()) {
        item.alt_text = `${slides.length}-slide carousel: ${slides[0]?.heading || item.title}`;
      }

      nodeExecutions.push({
        node_id: 'node_carousel_layout',
        node_name: '1-Idea-Per-Slide Progression & Deterministic Slide Deck',
        status: 'completed',
        provider: sandbox ? 'sandbox' : primary.provider,
        model: primary.model,
        inputs: { slide_count: slides.length },
        outputs: { rendered_slides: slides.length, cover_contrast_ratio: coverLayer?.palette_applied?.contrast_ratio, asset_ids: renderedMedia.map((m) => m.asset_id) },
        provider_cost_usd: callsProvider ? Number((primary.provider_cost_usd * slides.length).toFixed(4)) : 0,
        credits_used: callsProvider ? primary.internal_credits * slides.length : 0,
        duration_ms: Math.max(1, Date.now() - tCar),
      });
    } else if (item.workflow_type === 'short_form_video') {
      const tVid = Date.now();
      const storyboard =
        item.storyboard.length > 0
          ? item.storyboard.map((sc) => {
              const mVo = maskSecretsAndPii(sc.voiceover);
              const mCap = maskSecretsAndPii(sc.caption_text || sc.voiceover);
              totalRedactions += mVo.redactionsCount + mCap.redactionsCount;
              let desc = sc.visual_description;
              if (item.storyboard.length > 1 && sc.source_type === 'ai_generated' && !/\bno\s+music\b/i.test(desc)) {
                desc = `${desc} — no music`;
              }
              return { ...sc, voiceover: mVo.masked, caption_text: mCap.masked, visual_description: desc };
            })
          : buildDefaultVideoStoryboard(item, brief, business, referencedAssets);

      const endCardLayer = composeDeterministicBrandLayer({
        brief,
        brand,
        headline: brief.hook_message || item.title,
        bodyText: brief.intended_takeaway,
        ctaText: brief.cta,
        disclosures: item.disclosures,
      });

      let regeneratedCount = 0;
      let skippedCount = 0;
      for (const scene of storyboard) {
        const shouldRenderScene = targetedRegenSet ? targetedRegenSet.has(scene.scene_number) : scene.status !== 'passed';
        if (!shouldRenderScene) {
          skippedCount += 1;
          continue;
        }
        if (scene.source_type === 'ai_generated') {
          regeneratedCount += 1;
          const asset = await generateVisual(
            `scene-${scene.scene_number}`,
            `${promptBundle.visualPrompt} Scene ${scene.scene_number}: ${scene.visual_description}`,
            '9:16',
            'video',
            endCardLayer,
          );
          scene.asset_id = asset.id;
          scene.asset_url = '';
          scene.status = 'draft_ready';
          scene.evaluation_notes = asset.is_demo
            ? 'DEMO — NOT PUBLISHABLE: sandbox still frame, no video was generated.'
            : 'Rendered and stored; framing and motion have not been reviewed yet.';
        }
      }

      const sceneAssetIds = storyboard.map((s) => s.asset_id).filter((id): id is string => Boolean(id));
      const sceneAssets = await repo.getAssetsByIds(tenantId, sceneAssetIds);
      for (const a of createdAssets) sceneAssets.set(a.id, a);
      const clips = storyboard
        .map((s) => (s.asset_id ? sceneAssets.get(s.asset_id) : null))
        .filter((a): a is AutopilotAssetRecord => Boolean(a));
      const altText = item.alt_text || `${item.title} short-form video`;
      // One clip is the reel. Several clips are not a reel until they are
      // edited into one master file, which this pipeline does not do: they are
      // kept as scene clips and QA blocks publishing.
      item.media_assets = clips.length === 1
        ? [mediaEntryFromAsset(clips[0], 'primary', altText, `${clips[0].provider}:${clips[0].model}`)]
        : clips.map((c, i) => mediaEntryFromAsset(c, 'scene_clip', `${altText} — scene ${i + 1}`, `${c.provider}:${c.model}`));
      item.storyboard = storyboard;
      item.deterministic_overlay = withoutInlineRaster(endCardLayer);

      nodeExecutions.push({
        node_id: 'node_storyboard_and_selective_render',
        node_name: 'Storyboard, Multi-Clip Audio Rule & Selective Scene Render',
        status: 'completed',
        provider: sandbox ? 'sandbox' : primary.provider,
        model: primary.model,
        inputs: {
          total_scenes: storyboard.length,
          selective_regeneration: Boolean(targetedRegenSet),
          targeted_scenes: targetedRegenSet ? [...targetedRegenSet] : 'all_pending',
        },
        outputs: { scenes_rendered: regeneratedCount, scenes_preserved_without_rerun: skippedCount, assembled_master: clips.length === 1 },
        provider_cost_usd: callsProvider ? Number((primary.provider_cost_usd * regeneratedCount).toFixed(4)) : 0,
        credits_used: callsProvider ? primary.internal_credits * regeneratedCount : 0,
        duration_ms: Math.max(1, Date.now() - tVid),
      });
    } else if (item.workflow_type === 'product_demo') {
      const tDemo = Date.now();
      const realAsset =
        referencedAssets.find((a) => a.asset_type === 'product_screenshot' || a.asset_type === 'video_capture') ?? null;
      const captureUrl = params.demoCaptureUrl || realAsset?.url || null;
      if (captureUrl) {
        const asset = await ingestCustomerMedia('primary', captureUrl, params.demoCaptureUrl ? 'demo_capture_url' : `brand_asset:${realAsset!.id}`);
        item.media_assets = [
          mediaEntryFromAsset(asset, 'primary', item.alt_text || `Authentic product demo capture of ${business.business_name || 'product'}`, 'real_product_capture'),
        ];
      }

      const rawSteps = item.storyboard.length > 0
        ? item.storyboard
        : [
            { scene_number: 1, duration_sec: 4, visual_description: 'Real product workspace view highlighting user problem', camera_motion: 'cursor callout zoom', voiceover: brief.hook_message, caption_text: brief.hook_message, source_type: 'real_screen_recording' as const, status: 'passed' as const },
            { scene_number: 2, duration_sec: 6, visual_description: 'Authentic feature walkthrough using verified product UI', camera_motion: 'guided pan across active controls', voiceover: brief.intended_takeaway, caption_text: brief.intended_takeaway, source_type: 'real_screen_recording' as const, status: 'passed' as const },
            { scene_number: 3, duration_sec: 3, visual_description: 'Deterministic brand callout & next step', camera_motion: 'static frame', voiceover: brief.cta, caption_text: brief.cta, source_type: 'real_screen_recording' as const, status: 'passed' as const },
          ];

      item.storyboard = rawSteps.map((step) => {
        const mVo = maskSecretsAndPii(step.voiceover);
        const mCap = maskSecretsAndPii(step.caption_text || step.voiceover);
        const mDesc = maskSecretsAndPii(step.visual_description);
        totalRedactions += mVo.redactionsCount + mCap.redactionsCount + mDesc.redactionsCount;
        return { ...step, voiceover: mVo.masked, caption_text: mCap.masked, visual_description: mDesc.masked };
      });

      const demoFrame = composeDeterministicBrandLayer({
        brief,
        brand,
        headline: brief.hook_message || item.title,
        bodyText: brief.intended_takeaway,
        ctaText: brief.cta,
        disclosures: item.disclosures,
      });
      item.deterministic_overlay = withoutInlineRaster(demoFrame);

      nodeExecutions.push({
        node_id: 'node_product_demo_verification',
        node_name: 'Authentic Product Capture Check, PII Redaction & Deterministic Callouts',
        status: 'completed',
        provider: 'deterministic',
        model: 'deterministic-compositor-v1',
        inputs: { has_real_capture: Boolean(captureUrl) },
        outputs: { pii_and_secret_redactions: totalRedactions, demo_steps: item.storyboard.length, asset_ids: item.media_assets.map((m) => m.asset_id) },
        provider_cost_usd: 0,
        credits_used: 0,
        duration_ms: Math.max(1, Date.now() - tDemo),
      });
    }

    // ── Final node: policy QA + media publishability QA ─────────────────────
    // The palette is part of the output, so it is kept with the item: approval
    // re-runs QA from stored facts, not from what the generate request said.
    item.deterministic_overlay = {
      ...(item.deterministic_overlay ?? {}),
      proposed_palette_hexes: Array.isArray(params.proposedPaletteHexes) ? params.proposedPaletteHexes.slice(0, 24) : [],
    };
    const tQa = Date.now();
    const policyReport = validateAutopilotContentItem({
      item,
      brief,
      business,
      brand,
      referencedAssets,
      proposedPaletteHexes: params.proposedPaletteHexes,
    });
    const assetMap = await repo.getAssetsByIds(tenantId, item.media_assets.map((m) => m.asset_id ?? '').filter(Boolean));
    for (const a of createdAssets) assetMap.set(a.id, a);
    const mediaIssues = evaluateMediaPublishability({ item, assets: assetMap, channels: item.target_channels ?? [] });
    const validation = mergeValidationIssues(policyReport, mediaIssues);

    item.validation_report = validation;
    item.risk_flags = [
      ...new Set([
        ...item.risk_flags.filter((f) => !f.startsWith('blocker:')),
        ...validation.escalation_reasons,
        ...validation.issues.filter((i) => i.severity === 'blocker').map((i) => `blocker:${i.code}`),
      ]),
    ];
    if (validation.requires_human_review) item.approval_required = true;

    const nextState = validation.requires_human_review || item.approval_required || !validation.passed ? 'review_required' : 'draft_ready';
    item.lifecycle_state = nextState;
    item.version += 1;
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);

    brief.selected_provider = primary.provider;
    brief.selected_model = primary.model;
    brief.estimated_provider_cost_usd = preflightEstimate.estimated_provider_cost_usd;
    brief.estimated_credits = preflightEstimate.estimated_internal_credits;
    brief.updated_at = item.updated_at;
    await repo.saveCreativeBrief(brief);

    nodeExecutions.push({
      node_id: 'node_qa_and_policy_gates',
      node_name: 'Brand, Factual, Regulatory, Accessibility & Media QA Gate',
      status: 'completed',
      provider: 'deterministic',
      model: validation.validator_version,
      inputs: { creative_mode: brief.creative_mode, risk_category: business.risk_profile?.category || 'standard' },
      outputs: {
        passed: validation.passed,
        score: validation.score,
        blocker_count: validation.issues.filter((i) => i.severity === 'blocker').length,
        warning_count: validation.issues.filter((i) => i.severity === 'warning').length,
        media_issue_codes: validation.media_issue_codes,
        transitioned_to: nextState,
      },
      provider_cost_usd: 0,
      credits_used: 0,
      duration_ms: Math.max(1, Date.now() - tQa),
    });

    for (const s of providerSuccesses) {
      await accounting.recordUnitOutcome(tenantId, idempotencyKey, {
        index: s.index,
        state: 'succeeded',
        delivered: true,
        providerRequestId: s.providerRequestId,
        actualUsd: s.actualUsd,
        usage: s.usage,
        model: s.model,
      });
    }
    reservation = await accounting.settle(tenantId, idempotencyKey);

    runRecord.status = 'completed';
    runRecord.actual_provider_cost_usd = Number(reservation.actual_provider_cost_usd.toFixed(4));
    runRecord.actual_credits = reservation.settled_credits;
    runRecord.provenance = {
      brand_profile_id: brand?.id ?? null,
      brand_version: brand?.current_version ?? null,
      strategy_id: item.strategy_id,
      strategy_version: item.strategy_version,
      creative_mode: brief.creative_mode,
      routed_rationale: routed.rationale,
      selected_provider: primary.provider,
      selected_model: primary.model,
      selected_model_id: primary.id,
      pii_redactions_count: totalRedactions,
      magnific_space_id: params.magnificSpaceId ?? null,
      magnific_flow_id: params.magnificFlowId ?? null,
      execution_mode: executionMode,
      cost_status: reservation.cost_status,
      accounting_status: reservation.status,
      asset_ids: createdAssets.map((a) => a.id),
      provider_request_ids: providerSuccesses.map((s) => s.providerRequestId).filter(Boolean),
    };
    runRecord.completed_at = new Date().toISOString();
    await repo.saveWorkflowRun(runRecord);

    await repo.recordAudit(tenantId, actorUserId, actorRole, 'workflow.completed', 'content_item', item.id, {
      run_id: runRecord.id,
      workflow_type: item.workflow_type,
      lifecycle_state: item.lifecycle_state,
      validation_passed: validation.passed,
      execution_mode: executionMode,
      actual_provider_cost_usd: runRecord.actual_provider_cost_usd,
      cost_status: reservation.cost_status,
      actual_credits: runRecord.actual_credits,
    });

    return { item, brief, run: runRecord, accounting: reservation };
  } catch (err: any) {
    // Work the provider did is spend whether or not we could keep the result;
    // none of it is charged to the customer because nothing was delivered.
    for (const s of providerSuccesses) {
      await accounting
        .recordUnitOutcome(tenantId, idempotencyKey, { index: s.index, state: 'succeeded', delivered: false, providerRequestId: s.providerRequestId, actualUsd: s.actualUsd, usage: s.usage, model: s.model })
        .catch(() => {});
    }
    reservation = await accounting.settle(tenantId, idempotencyKey).catch((settleErr) => {
      runRecord.provenance = { ...runRecord.provenance, settle_error: String(settleErr?.message || settleErr) };
      return reservation;
    });

    const code = err instanceof UnitFailure ? err.code : err instanceof AutopilotWorkflowError ? err.code : 'WORKFLOW_FAILED';
    const safeMessage = err instanceof UnitFailure || err instanceof AutopilotWorkflowError ? err.message : 'Workflow execution failed';

    item.lifecycle_state = 'generation_failed';
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);

    runRecord.status = reservation?.status === 'reconciliation_required' ? 'reconciliation_required' : 'failed';
    runRecord.actual_provider_cost_usd = Number((reservation?.actual_provider_cost_usd ?? 0).toFixed(4));
    runRecord.actual_credits = reservation?.settled_credits ?? 0;
    runRecord.failure_reason = safeMessage;
    runRecord.provenance = {
      ...runRecord.provenance,
      failure_code: code,
      cost_status: reservation?.cost_status ?? 'none',
      accounting_status: reservation?.status ?? null,
      // Stored assets survive a failed run so a retry or a repair can reuse them.
      recovery_asset_ids: createdAssets.map((a) => a.id),
    };
    runRecord.completed_at = new Date().toISOString();
    await repo.saveWorkflowRun(runRecord);
    await repo.recordAudit(tenantId, actorUserId, actorRole, 'workflow.failed', 'content_item', item.id, {
      run_id: runRecord.id,
      failure_code: code,
      accounting_status: reservation?.status ?? null,
    });

    if (err instanceof AutopilotWorkflowError) throw err;
    if (err instanceof UnitFailure) {
      throw new AutopilotWorkflowError(code, safeMessage, err.status, {
        retryable: err.retryable,
        run_id: runRecord.id,
        accounting_status: reservation?.status ?? null,
      });
    }
    throw err;
  }
}
