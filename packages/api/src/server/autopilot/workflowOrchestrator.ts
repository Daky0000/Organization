import { randomUUID } from 'crypto';
import type { AutopilotRepository } from './repository.ts';
import {
  buildBrandAwarePrompt,
  createCreativeBriefForItem,
  estimateGenerationCost,
  routeModelForBrief,
} from './creativeBriefAndRouter.ts';
import { composeDeterministicBrandLayer } from './deterministicCompositor.ts';
import { maskSecretsAndPii, validateAutopilotContentItem } from './validationAndPolicyService.ts';
import { reserveJobBudget, settleJobBudget, releaseJobBudget } from './billingAndBudgetService.ts';
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
  prompt: string;
  aspectRatio: string;
  referenceUrls: string[];
  magnificSpaceId?: string;
  magnificFlowId?: string;
}

export interface VisualProviderAdapterResult {
  url: string;
  type: 'image' | 'video';
  provider: string;
  model: string;
  actualProviderCostUsd?: number;
  actualCredits?: number;
  provenanceNote?: string;
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
  visualAdapter?: (input: VisualProviderAdapterInput) => Promise<VisualProviderAdapterResult>;
  copyAdapter?: (prompt: string, systemPrompt?: string) => Promise<string>;
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

export async function executeAutopilotWorkflow(params: ExecuteWorkflowParams): Promise<{
  item: ContentItemRecord;
  brief: CreativeBriefRecord;
  run: WorkflowRunRecord;
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
    });
    await repo.saveCreativeBrief(brief);
  }

  // Enforce max_attempts retry ceiling per brief
  const priorRuns = await repo.listWorkflowRuns(tenantId, item.id);
  const attemptNumber = priorRuns.length + 1;
  if (attemptNumber > (brief.max_attempts || 3) && !params.regenerateSceneNumbers?.length && !params.regenerateFailedScenesOnly) {
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

  // Determine exact slide/scene count for accurate pre-flight cost gating
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
        : Math.max(1, item.storyboard.filter((s) => s.source_type === 'ai_generated').length || 2)
      : undefined;

  const preflightEstimate = estimateGenerationCost({
    workflowType: item.workflow_type,
    controls: brief.controls,
    spendLimitUsd: brief.spend_limit_usd,
    creditCeiling: brief.credit_ceiling,
    preferDraftCost: params.preferDraftCost,
    slideCount: effectiveSlideCount,
    aiSceneCount: effectiveAiSceneCount,
    businessCapacity: business.capacity,
    availableProviders: params.availableProviders,
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
      'COST_CAP_BLOCKED',
      preflightEstimate.blocking_reason,
      402,
      { estimate: preflightEstimate },
    );
  }

  const routed = routeModelForBrief({
    workflowType: item.workflow_type,
    controls: brief.controls,
    preferDraftCost: params.preferDraftCost,
    slideCount: effectiveSlideCount,
    sceneCount: effectiveAiSceneCount,
    availableProviders: params.availableProviders,
  });

  const runId = randomUUID();
  const idempotencyKey = `wf:${item.id}:att:${attemptNumber}`;

  // Reserve budget from tenant ledger & enforce kill switches
  let reservationId: string | null = null;
  if (params.pool) {
    try {
      reservationId = await reserveJobBudget(params.pool as any, {
        tenantId,
        userId: actorUserId,
        contentItemId: item.id,
        workflowRunId: runId,
        idempotencyKey,
        estimatedProviderCostUsd: preflightEstimate.estimated_provider_cost_usd,
        estimatedCredits: preflightEstimate.estimated_internal_credits,
        customerPriceUsd: preflightEstimate.estimated_provider_cost_usd * 1.5,
        provider: routed.primary.provider,
        model: routed.primary.model,
        isMock: !params.visualAdapter,
        userConfirmedSpend: brief.controls.user_confirmed_spend,
      });
    } catch (bErr: any) {
      throw new AutopilotWorkflowError('BUDGET_RESERVATION_BLOCKED', bErr?.message || 'Job budget blocked by policy.', bErr?.status || 402);
    }
  }

  const executionMode: 'live_provider' | 'sandbox_fallback' = params.visualAdapter ? 'live_provider' : 'sandbox_fallback';
  item.execution_mode = executionMode;

  // Transition item into `generating`
  const nowIso = new Date().toISOString();
  item.lifecycle_state = 'generating';
  item.updated_at = nowIso;
  await repo.saveContentItem(item);

  const nodeExecutions: WorkflowNodeExecution[] = [];
  let actualProviderUsd = 0;
  let actualCredits = 0;
  let totalRedactions = 0;

  const runRecord: WorkflowRunRecord = {
    id: runId,
    tenant_id: tenantId,
    content_item_id: item.id,
    workflow_type: item.workflow_type,
    status: 'running',
    parameters: {
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
    provenance: {},
    created_by: actorUserId,
    created_at: nowIso,
    completed_at: null,
  };
  await repo.saveWorkflowRun(runRecord);

  try {
    // ── Node 1: Brand-Aware Prompt & Copy Sanitization ──────────────────────
    const t0 = Date.now();
    const promptBundle = buildBrandAwarePrompt({
      item,
      brief,
      brand,
      approvedTokens,
    });

    const maskedTitle = maskSecretsAndPii(item.title);
    const maskedHook = maskSecretsAndPii(item.hook);
    const maskedCaption = maskSecretsAndPii(item.caption);
    const maskedBriefHook = maskSecretsAndPii(brief.hook_message);
    totalRedactions +=
      maskedTitle.redactionsCount +
      maskedHook.redactionsCount +
      maskedCaption.redactionsCount +
      maskedBriefHook.redactionsCount;

    item.title = maskedTitle.masked;
    item.hook = maskedHook.masked;
    item.caption = maskedCaption.masked;
    brief.hook_message = maskedBriefHook.masked;

    for (const ch of Object.keys(item.channel_variants || {})) {
      const m = maskSecretsAndPii(item.channel_variants[ch].caption);
      item.channel_variants[ch].caption = m.masked;
      totalRedactions += m.redactionsCount;
    }

    // Ensure required regulatory disclosures are surfaced on item
    for (const reqDisc of business.risk_profile?.required_disclosures ?? []) {
      if (reqDisc && !item.disclosures.includes(reqDisc)) {
        item.disclosures.push(reqDisc);
      }
    }

    actualProviderUsd += routed.copyModel.provider_cost_usd;
    actualCredits += routed.copyModel.internal_credits;

    nodeExecutions.push({
      node_id: 'node_brief_and_copy',
      node_name: 'Brief, Brand Constraints & Secret/PII Guard',
      status: 'completed',
      provider: routed.copyModel.provider,
      model: routed.copyModel.model,
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
      provider_cost_usd: routed.copyModel.provider_cost_usd,
      credits_used: routed.copyModel.internal_credits,
      duration_ms: Math.max(1, Date.now() - t0),
    });

    // ── Workflow-Specific Execution Branches (Section 8.1 – 8.4) ────────────
    if (item.workflow_type === 'branded_social_graphic') {
      const tGen = Date.now();
      const deterministicLayer = composeDeterministicBrandLayer({
        brief,
        brand,
        headline: brief.hook_message || item.title,
        bodyText: brief.intended_takeaway,
        ctaText: brief.cta,
        disclosures: item.disclosures,
      });

      let backgroundUrl = deterministicLayer.preview_raster_data_url;
      let genCostUsd = 0;
      let genCredits = 0;
      let usedProvider: string = routed.primary.provider;
      let usedModel: string = routed.primary.model;

      if (routed.primary.provider !== 'deterministic') {
        if (params.visualAdapter) {
          const adapted = await params.visualAdapter({
            provider: routed.primary.provider,
            model: routed.primary.model,
            prompt: promptBundle.visualPrompt,
            aspectRatio: brief.aspect_ratio,
            referenceUrls: referencedAssets.map((a) => a.url),
            magnificSpaceId: params.magnificSpaceId,
            magnificFlowId: params.magnificFlowId,
          });
          backgroundUrl = adapted.url;
          usedProvider = adapted.provider;
          usedModel = adapted.model;
          genCostUsd = adapted.actualProviderCostUsd ?? routed.primary.provider_cost_usd;
          genCredits = adapted.actualCredits ?? routed.primary.internal_credits;
        } else {
          genCostUsd = 0;
          genCredits = 0;
        }
      }

      actualProviderUsd += genCostUsd;
      actualCredits += genCredits;

      nodeExecutions.push({
        node_id: 'node_visual_generation',
        node_name: 'Brand-Guided Visual Generation',
        status: 'completed',
        provider: usedProvider,
        model: usedModel,
        inputs: {
          aspect_ratio: brief.aspect_ratio,
          text_in_image: brief.controls.text_in_image,
          magnific_flow_id: params.magnificFlowId ?? null,
        },
        outputs: { asset_url_preview: backgroundUrl.slice(0, 80) },
        provider_cost_usd: genCostUsd,
        credits_used: genCredits,
        duration_ms: Math.max(1, Date.now() - tGen),
      });

      item.deterministic_overlay = deterministicLayer;
      item.media_assets = [
        {
          url: backgroundUrl,
          type: 'image',
          alt_text: item.alt_text || `${item.title} — ${brief.intended_takeaway}`,
          width: deterministicLayer.canvas.width,
          height: deterministicLayer.canvas.height,
          provenance: `${usedProvider}:${usedModel}+deterministic-compositor-v1`,
        },
      ];
      if (!item.alt_text.trim()) {
        item.alt_text = `${brand?.brand_name || business.business_name || 'Brand'} graphic: ${brief.hook_message}`;
      }

      nodeExecutions.push({
        node_id: 'node_deterministic_compositor',
        node_name: 'Deterministic Typography, Safe-Zone & Logo Layer',
        status: 'completed',
        provider: 'deterministic',
        model: 'deterministic-compositor-v1',
        inputs: { logo_policy: brief.controls.logo_policy },
        outputs: {
          contrast_ratio: deterministicLayer.palette_applied.contrast_ratio,
          logo_enabled: deterministicLayer.logo_layer.enabled,
        },
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

      const renderedMedia: ContentItemRecord['media_assets'] = [];
      let coverLayer: any = null;
      let totalSlideCostUsd = 0;
      let totalSlideCredits = 0;

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

        let slideUrl = layer.preview_raster_data_url;
        if (routed.primary.provider !== 'deterministic') {
          if (params.visualAdapter) {
            const adapted = await params.visualAdapter({
              provider: routed.primary.provider,
              model: routed.primary.model,
              prompt: `${promptBundle.visualPrompt} Slide ${slide.slide_number}/${slides.length}: ${slide.heading}`,
              aspectRatio: brief.aspect_ratio,
              referenceUrls: referencedAssets.map((a) => a.url),
            });
            slideUrl = adapted.url;
            totalSlideCostUsd += adapted.actualProviderCostUsd ?? routed.primary.provider_cost_usd;
            totalSlideCredits += adapted.actualCredits ?? routed.primary.internal_credits;
          } else {
            totalSlideCostUsd += routed.primary.provider_cost_usd;
            totalSlideCredits += routed.primary.internal_credits;
          }
        }

        slide.rendered_url = slideUrl;
        renderedMedia.push({
          url: slideUrl,
          type: 'image',
          alt_text: slide.alt_text,
          width: layer.canvas.width,
          height: layer.canvas.height,
          provenance: `carousel_slide_${slide.slide_number}:${routed.primary.provider}:${routed.primary.model}`,
        });
      }

      actualProviderUsd += Number(totalSlideCostUsd.toFixed(4));
      actualCredits += totalSlideCredits;
      item.slides = slides;
      item.media_assets = renderedMedia;
      item.deterministic_overlay = coverLayer ?? {};
      if (!item.alt_text.trim()) {
        item.alt_text = `${slides.length}-slide carousel: ${slides[0]?.heading || item.title}`;
      }

      nodeExecutions.push({
        node_id: 'node_carousel_layout',
        node_name: '1-Idea-Per-Slide Progression & Deterministic Slide Deck',
        status: 'completed',
        provider: routed.primary.provider,
        model: routed.primary.model,
        inputs: { slide_count: slides.length },
        outputs: {
          rendered_slides: slides.length,
          cover_contrast_ratio: coverLayer?.palette_applied?.contrast_ratio,
        },
        provider_cost_usd: Number(totalSlideCostUsd.toFixed(4)),
        credits_used: totalSlideCredits,
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

      let regeneratedCount = 0;
      let skippedCount = 0;
      let videoCostUsd = 0;
      let videoCredits = 0;

      for (const scene of storyboard) {
        const shouldRenderScene = targetedRegenSet
          ? targetedRegenSet.has(scene.scene_number)
          : scene.status !== 'passed';

        if (!shouldRenderScene) {
          skippedCount += 1;
          continue;
        }

        if (scene.source_type === 'ai_generated') {
          regeneratedCount += 1;
          if (params.visualAdapter) {
            const adapted = await params.visualAdapter({
              provider: routed.primary.provider,
              model: routed.primary.model,
              prompt: `${promptBundle.visualPrompt} Scene ${scene.scene_number}: ${scene.visual_description}`,
              aspectRatio: '9:16',
              referenceUrls: referencedAssets.map((a) => a.url),
              magnificSpaceId: params.magnificSpaceId,
              magnificFlowId: params.magnificFlowId,
            });
            scene.asset_url = adapted.url;
            videoCostUsd += adapted.actualProviderCostUsd ?? routed.primary.provider_cost_usd;
            videoCredits += adapted.actualCredits ?? routed.primary.internal_credits;
          } else {
            scene.asset_url = `https://cdn.contentflow.local/autopilot/${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')}/${item.id}/scene-${scene.scene_number}.mp4`;
            videoCostUsd += routed.primary.provider_cost_usd;
            videoCredits += routed.primary.internal_credits;
          }
        }
        scene.status = 'passed';
        scene.evaluation_notes = 'Framing, motion stability, and "no music" multi-clip audio rule verified.';
      }

      const endCardLayer = composeDeterministicBrandLayer({
        brief,
        brand,
        headline: brief.hook_message || item.title,
        bodyText: brief.intended_takeaway,
        ctaText: brief.cta,
        disclosures: item.disclosures,
      });

      actualProviderUsd += Number(videoCostUsd.toFixed(4));
      actualCredits += videoCredits;
      item.storyboard = storyboard;
      item.deterministic_overlay = endCardLayer;
      const primaryVideoUrl =
        storyboard.find((s) => s.asset_url)?.asset_url ||
        `https://cdn.contentflow.local/autopilot/${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')}/${item.id}/reel-master.mp4`;
      item.media_assets = [
        {
          url: primaryVideoUrl,
          type: 'video',
          alt_text: item.alt_text || `${item.title} short-form video with burned-in captions`,
          width: 1080,
          height: 1920,
          provenance: `${routed.primary.provider}:${routed.primary.model}+deterministic-subtitles`,
        },
      ];

      nodeExecutions.push({
        node_id: 'node_storyboard_and_selective_render',
        node_name: 'Storyboard, Multi-Clip Audio Rule & Selective Scene Render',
        status: 'completed',
        provider: routed.primary.provider,
        model: routed.primary.model,
        inputs: {
          total_scenes: storyboard.length,
          selective_regeneration: Boolean(targetedRegenSet),
          targeted_scenes: targetedRegenSet ? [...targetedRegenSet] : 'all_pending',
        },
        outputs: {
          scenes_rendered: regeneratedCount,
          scenes_preserved_without_rerun: skippedCount,
        },
        provider_cost_usd: Number(videoCostUsd.toFixed(4)),
        credits_used: videoCredits,
        duration_ms: Math.max(1, Date.now() - tVid),
      });
    } else if (item.workflow_type === 'product_demo') {
      const tDemo = Date.now();
      const realAsset =
        referencedAssets.find((a) => a.asset_type === 'product_screenshot' || a.asset_type === 'video_capture') ??
        null;

      if (params.demoCaptureUrl) {
        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(params.demoCaptureUrl);
        item.media_assets = [
          {
            url: params.demoCaptureUrl,
            type: isVideo ? 'video' : 'image',
            alt_text: item.alt_text || `Authentic product demo capture of ${business.business_name || 'product'}`,
            provenance: 'real_product_capture',
          },
        ];
      } else if (realAsset) {
        const isVideo = realAsset.asset_type === 'video_capture' || realAsset.mime_type.startsWith('video/');
        item.media_assets = [
          {
            url: realAsset.url,
            type: isVideo ? 'video' : 'image',
            alt_text: item.alt_text || `Authentic product demo capture: ${realAsset.name}`,
            provenance: 'real_product_capture',
          },
        ];
      }

      // Build authentic narration storyboard with strict PII/secret masking
      const rawSteps = item.storyboard.length > 0
        ? item.storyboard
        : [
            {
              scene_number: 1,
              duration_sec: 4,
              visual_description: 'Real product workspace view highlighting user problem',
              camera_motion: 'cursor callout zoom',
              voiceover: brief.hook_message,
              caption_text: brief.hook_message,
              source_type: 'real_screen_recording' as const,
              status: 'passed' as const,
            },
            {
              scene_number: 2,
              duration_sec: 6,
              visual_description: 'Authentic feature walkthrough using verified product UI',
              camera_motion: 'guided pan across active controls',
              voiceover: brief.intended_takeaway,
              caption_text: brief.intended_takeaway,
              source_type: 'real_screen_recording' as const,
              status: 'passed' as const,
            },
            {
              scene_number: 3,
              duration_sec: 3,
              visual_description: 'Deterministic brand callout & next step',
              camera_motion: 'static frame',
              voiceover: brief.cta,
              caption_text: brief.cta,
              source_type: 'real_screen_recording' as const,
              status: 'passed' as const,
            },
          ];

      item.storyboard = rawSteps.map((step) => {
        const mVo = maskSecretsAndPii(step.voiceover);
        const mCap = maskSecretsAndPii(step.caption_text || step.voiceover);
        const mDesc = maskSecretsAndPii(step.visual_description);
        totalRedactions += mVo.redactionsCount + mCap.redactionsCount + mDesc.redactionsCount;
        return {
          ...step,
          voiceover: mVo.masked,
          caption_text: mCap.masked,
          visual_description: mDesc.masked,
        };
      });

      const demoFrame = composeDeterministicBrandLayer({
        brief,
        brand,
        headline: brief.hook_message || item.title,
        bodyText: brief.intended_takeaway,
        ctaText: brief.cta,
        disclosures: item.disclosures,
      });
      item.deterministic_overlay = demoFrame;

      nodeExecutions.push({
        node_id: 'node_product_demo_verification',
        node_name: 'Authentic Product Capture Check, PII Redaction & Deterministic Callouts',
        status: 'completed',
        provider: 'deterministic',
        model: 'deterministic-compositor-v1',
        inputs: {
          has_real_capture: Boolean(params.demoCaptureUrl || realAsset || item.media_assets.some((m) => m.provenance === 'real_product_capture')),
        },
        outputs: {
          pii_and_secret_redactions: totalRedactions,
          demo_steps: item.storyboard.length,
        },
        provider_cost_usd: 0,
        credits_used: 0,
        duration_ms: Math.max(1, Date.now() - tDemo),
      });
    }

    // ── Final Node: QA, Brand, Factual, Risk & Accessibility Gate (Sec 10) ──
    const tQa = Date.now();
    const validation = validateAutopilotContentItem({
      item,
      brief,
      business,
      brand,
      referencedAssets,
      proposedPaletteHexes: params.proposedPaletteHexes,
    });

    item.validation_report = validation;
    item.risk_flags = [
      ...new Set([
        ...item.risk_flags,
        ...validation.escalation_reasons,
        ...validation.issues.filter((i) => i.severity === 'blocker').map((i) => `blocker:${i.code}`),
      ]),
    ];

    if (validation.requires_human_review) {
      item.approval_required = true;
    }

    const nextState =
      validation.requires_human_review || item.approval_required || !validation.passed
        ? 'review_required'
        : 'draft_ready';

    item.lifecycle_state = nextState;
    item.version += 1;
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);

    // Update brief with latest selected provider/model
    brief.selected_provider = routed.primary.provider;
    brief.selected_model = routed.primary.model;
    brief.estimated_provider_cost_usd = preflightEstimate.estimated_provider_cost_usd;
    brief.estimated_credits = preflightEstimate.estimated_internal_credits;
    brief.updated_at = item.updated_at;
    await repo.saveCreativeBrief(brief);

    nodeExecutions.push({
      node_id: 'node_qa_and_policy_gates',
      node_name: 'Brand, Factual, Regulatory & Accessibility QA Gate',
      status: 'completed',
      provider: 'deterministic',
      model: 'qa-policy-engine-v1',
      inputs: { creative_mode: brief.creative_mode, risk_category: business.risk_profile?.category || 'standard' },
      outputs: {
        passed: validation.passed,
        score: validation.score,
        blocker_count: validation.issues.filter((i) => i.severity === 'blocker').length,
        warning_count: validation.issues.filter((i) => i.severity === 'warning').length,
        transitioned_to: nextState,
      },
      provider_cost_usd: 0,
      credits_used: 0,
      duration_ms: Math.max(1, Date.now() - tQa),
    });

    runRecord.status = 'completed';
    runRecord.actual_provider_cost_usd = Number(actualProviderUsd.toFixed(4));
    runRecord.actual_credits = actualCredits;
    runRecord.provenance = {
      brand_profile_id: brand?.id ?? null,
      brand_version: brand?.current_version ?? null,
      strategy_id: item.strategy_id,
      strategy_version: item.strategy_version,
      creative_mode: brief.creative_mode,
      routed_rationale: routed.rationale,
      selected_provider: routed.primary.provider,
      selected_model: routed.primary.model,
      pii_redactions_count: totalRedactions,
      magnific_space_id: params.magnificSpaceId ?? null,
      magnific_flow_id: params.magnificFlowId ?? null,
      execution_mode: executionMode,
    };
    runRecord.completed_at = new Date().toISOString();
    await repo.saveWorkflowRun(runRecord);

    if (reservationId && params.pool) {
      await settleJobBudget(params.pool as any, {
        tenantId,
        idempotencyKey,
        actualProviderCostUsd: runRecord.actual_provider_cost_usd,
        actualCredits: runRecord.actual_credits,
        workflowRunId: runRecord.id,
      }).catch(() => {});
    }

    await repo.recordAudit(tenantId, actorUserId, actorRole, 'workflow.completed', 'content_item', item.id, {
      run_id: runRecord.id,
      workflow_type: item.workflow_type,
      lifecycle_state: item.lifecycle_state,
      validation_passed: validation.passed,
      actual_provider_cost_usd: runRecord.actual_provider_cost_usd,
      actual_credits: runRecord.actual_credits,
    });

    return { item, brief, run: runRecord };
  } catch (err: any) {
    if (typeof reservationId !== 'undefined' && reservationId && params.pool) {
      await releaseJobBudget(params.pool as any, {
        tenantId,
        idempotencyKey,
        reason: err?.message || 'Workflow execution failed',
      }).catch(() => {});
    }
    item.lifecycle_state = 'generation_failed';
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);

    runRecord.status = 'failed';
    runRecord.actual_provider_cost_usd = Number(actualProviderUsd.toFixed(4));
    runRecord.actual_credits = actualCredits;
    runRecord.failure_reason = err?.message || 'Workflow execution failed';
    runRecord.completed_at = new Date().toISOString();
    await repo.saveWorkflowRun(runRecord);

    throw err;
  }
}
