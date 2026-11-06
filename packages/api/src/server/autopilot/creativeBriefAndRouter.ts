import { randomUUID } from 'crypto';
import { scanForPromptInjection } from './validationAndPolicyService.ts';
import type {
  BrandProfileRecord,
  BrandTokenRecord,
  BusinessProfileRecord,
  ContentItemRecord,
  CreativeBriefRecord,
  CreativeControls,
  CreativeMode,
  WorkflowType,
} from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Refreshable Provider / Model Capability Registry & Task-Based Router (Sec 7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelCapabilityEntry {
  id: string;
  provider: 'magnific' | 'google' | 'openai' | 'anthropic' | 'elevenlabs' | 'deterministic';
  model: string;
  task_types: Array<
    | 'copy_and_strategy'
    | 'static_graphic_draft'
    | 'static_graphic_final'
    | 'product_typography_image'
    | 'surface_mockup'
    | 'photorealistic_campaign'
    | 'short_video_draft'
    | 'short_video_final'
    | 'reference_video_omni'
    | 'voiceover'
    | 'upscale_precision'
    | 'deterministic_compositing'
  >;
  input_types: Array<'text' | 'image_ref' | 'video_ref' | 'audio' | 'brand_tokens'>;
  output_type: 'text' | 'image' | 'video' | 'audio';
  supported_aspect_ratios: string[];
  max_clip_duration_sec?: number;
  max_references: number;
  supports_exact_text_in_image: boolean;
  latency_tier: 'instant' | 'fast' | 'standard' | 'heavy';
  provider_cost_usd: number; // Actual estimated third-party provider USD cost (NEVER conflated with SaaS credits!)
  internal_credits: number;  // Internal SaaS credit consumption
  enabled: boolean;
  feature_flag?: string;
  fallback_model_id?: string;
}

const DEFAULT_MODEL_REGISTRY: ModelCapabilityEntry[] = [
  {
    id: 'google:gemini-2.5-flash',
    provider: 'google',
    model: 'gemini-2.5-flash',
    task_types: ['copy_and_strategy'],
    input_types: ['text', 'brand_tokens'],
    output_type: 'text',
    supported_aspect_ratios: [],
    max_references: 0,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    provider_cost_usd: 0.004,
    internal_credits: 2,
    enabled: true,
    fallback_model_id: 'anthropic:claude-haiku-4-5',
  },
  {
    id: 'anthropic:claude-haiku-4-5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    task_types: ['copy_and_strategy'],
    input_types: ['text', 'brand_tokens'],
    output_type: 'text',
    supported_aspect_ratios: [],
    max_references: 0,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    provider_cost_usd: 0.006,
    internal_credits: 2,
    enabled: true,
  },
  {
    id: 'magnific:magnific-one-draft',
    provider: 'magnific',
    model: 'magnific-one',
    task_types: ['static_graphic_draft'],
    input_types: ['text', 'image_ref', 'brand_tokens'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '4:5', '3:4', '4:3', '16:9', '9:16'],
    max_references: 10,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    provider_cost_usd: 0.04,
    internal_credits: 5,
    enabled: true,
    fallback_model_id: 'google:gemini-2.5-flash-image',
  },
  {
    id: 'magnific:magnific-one',
    provider: 'magnific',
    model: 'magnific-one',
    task_types: ['static_graphic_final', 'photorealistic_campaign'],
    input_types: ['text', 'image_ref', 'brand_tokens'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '4:5', '3:4', '4:3', '16:9', '9:16'],
    max_references: 10,
    supports_exact_text_in_image: false,
    latency_tier: 'standard',
    provider_cost_usd: 0.08,
    internal_credits: 10,
    enabled: true,
    fallback_model_id: 'openai:gpt-image-1',
  },
  {
    id: 'magnific:nano-banana-pro',
    provider: 'magnific',
    model: 'nano-banana-pro',
    task_types: ['product_typography_image'],
    input_types: ['text', 'image_ref'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    max_references: 6,
    supports_exact_text_in_image: true,
    latency_tier: 'standard',
    provider_cost_usd: 0.09,
    internal_credits: 12,
    enabled: true,
    fallback_model_id: 'openai:gpt-image-1',
  },
  {
    id: 'magnific:nano-banana-2',
    provider: 'magnific',
    model: 'nano-banana-2',
    task_types: ['surface_mockup'],
    input_types: ['text', 'image_ref'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    max_references: 6,
    supports_exact_text_in_image: true,
    latency_tier: 'standard',
    provider_cost_usd: 0.09,
    internal_credits: 12,
    enabled: true,
    fallback_model_id: 'magnific:magnific-one',
  },
  {
    id: 'google:gemini-2.5-flash-image',
    provider: 'google',
    model: 'gemini-2.5-flash-image',
    task_types: ['static_graphic_draft', 'static_graphic_final'],
    input_types: ['text', 'image_ref'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    max_references: 3,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    provider_cost_usd: 0.039,
    internal_credits: 6,
    enabled: true,
    fallback_model_id: 'openai:gpt-image-1',
  },
  {
    id: 'openai:gpt-image-1',
    provider: 'openai',
    model: 'gpt-image-1',
    task_types: ['static_graphic_final', 'product_typography_image'],
    input_types: ['text'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '16:9', '9:16'],
    max_references: 0,
    supports_exact_text_in_image: true,
    latency_tier: 'standard',
    provider_cost_usd: 0.04,
    internal_credits: 8,
    enabled: true,
  },
  {
    id: 'magnific:seedance-2-5-draft',
    provider: 'magnific',
    model: 'seedance-2-5',
    task_types: ['short_video_draft'],
    input_types: ['text', 'image_ref', 'video_ref'],
    output_type: 'video',
    supported_aspect_ratios: ['9:16', '16:9', '1:1'],
    max_clip_duration_sec: 15,
    max_references: 50,
    supports_exact_text_in_image: false,
    latency_tier: 'standard',
    provider_cost_usd: 0.22,
    internal_credits: 18,
    enabled: true,
    fallback_model_id: 'magnific:kling-3-0-omni',
  },
  {
    id: 'magnific:seedance-2-5',
    provider: 'magnific',
    model: 'seedance-2-5',
    task_types: ['short_video_final'],
    input_types: ['text', 'image_ref', 'video_ref'],
    output_type: 'video',
    supported_aspect_ratios: ['9:16', '16:9', '1:1'],
    max_clip_duration_sec: 30,
    max_references: 50,
    supports_exact_text_in_image: false,
    latency_tier: 'heavy',
    provider_cost_usd: 0.45,
    internal_credits: 35,
    enabled: true,
    fallback_model_id: 'magnific:kling-3-0-omni',
  },
  {
    id: 'magnific:kling-3-0-omni',
    provider: 'magnific',
    model: 'kling-3-0-omni',
    task_types: ['reference_video_omni', 'short_video_final'],
    input_types: ['text', 'image_ref', 'video_ref'],
    output_type: 'video',
    supported_aspect_ratios: ['9:16', '16:9', '1:1'],
    max_clip_duration_sec: 15,
    max_references: 6,
    supports_exact_text_in_image: true,
    latency_tier: 'heavy',
    provider_cost_usd: 0.48,
    internal_credits: 38,
    enabled: true,
  },
  {
    id: 'openai:gpt-4o-mini-tts',
    provider: 'openai',
    model: 'gpt-4o-mini-tts',
    task_types: ['voiceover'],
    input_types: ['text'],
    output_type: 'audio',
    supported_aspect_ratios: [],
    max_references: 0,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    provider_cost_usd: 0.015,
    internal_credits: 3,
    enabled: true,
  },
  {
    id: 'magnific:upscale-precision',
    provider: 'magnific',
    model: 'image-upscaler-precision',
    task_types: ['upscale_precision'],
    input_types: ['image_ref'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '4:5', '9:16', '16:9'],
    max_references: 1,
    supports_exact_text_in_image: true,
    latency_tier: 'fast',
    provider_cost_usd: 0.03,
    internal_credits: 4,
    enabled: true,
  },
  {
    id: 'deterministic:compositor-v1',
    provider: 'deterministic',
    model: 'deterministic-compositor-v1',
    task_types: ['deterministic_compositing'],
    input_types: ['text', 'image_ref', 'brand_tokens'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '4:5', '9:16', '16:9', '3:4'],
    max_references: 10,
    supports_exact_text_in_image: true,
    latency_tier: 'instant',
    provider_cost_usd: 0,
    internal_credits: 0,
    enabled: true,
  },
];

// Runtime refreshable catalog overrides (e.g., admin price/availability updates or feature flags)
let runtimeRegistryOverrides: Record<string, Partial<ModelCapabilityEntry>> = {};

export function refreshModelRegistryOverrides(overrides: Record<string, Partial<ModelCapabilityEntry>>) {
  runtimeRegistryOverrides = { ...runtimeRegistryOverrides, ...overrides };
}

export function getModelCapabilityRegistry(): ModelCapabilityEntry[] {
  return DEFAULT_MODEL_REGISTRY.map((entry) => ({
    ...entry,
    ...(runtimeRegistryOverrides[entry.id] ?? {}),
  }));
}

export interface RouteTaskInput {
  workflowType: WorkflowType;
  controls: CreativeControls;
  preferDraftCost?: boolean;
  slideCount?: number;
  sceneCount?: number;
  availableProviders?: Set<string>;
}

export interface RoutedModelSelection {
  primary: ModelCapabilityEntry;
  compositor: ModelCapabilityEntry;
  copyModel: ModelCapabilityEntry;
  fallback: ModelCapabilityEntry | null;
  rationale: string;
}

export function routeModelForBrief(input: RouteTaskInput): RoutedModelSelection {
  const registry = getModelCapabilityRegistry().filter((m) => m.enabled);
  const byId = new Map(registry.map((m) => [m.id, m]));
  const isAvailable = (m: ModelCapabilityEntry) =>
    !input.availableProviders || m.provider === 'deterministic' || input.availableProviders.has(m.provider);

  const compositor = byId.get('deterministic:compositor-v1')!;
  const copyModel = registry.find((m) => m.task_types.includes('copy_and_strategy') && isAvailable(m)) ?? byId.get('google:gemini-2.5-flash')!;

  // Product demo or real screenshot enhancement: NEVER hallucinate fake UI with generative models!
  if (input.workflowType === 'product_demo' || input.controls.media_source_mode === 'real_screenshot') {
    return {
      primary: compositor,
      compositor,
      copyModel,
      fallback: null,
      rationale: 'Selected deterministic compositor to preserve 100% authentic UI/screenshot pixels and overlay captions without hallucinating product features.',
    };
  }

  // Real photography only
  if (input.controls.media_source_mode === 'real_photography') {
    return {
      primary: compositor,
      compositor,
      copyModel,
      fallback: null,
      rationale: 'Selected deterministic brand layout over customer-provided photography.',
    };
  }

  // Short-form video / Reel
  if (input.workflowType === 'short_form_video') {
    const desiredId = input.preferDraftCost
      ? 'magnific:seedance-2-5-draft'
      : input.controls.reference_fidelity === 'strict'
        ? 'magnific:kling-3-0-omni'
        : 'magnific:seedance-2-5';
    let chosen = byId.get(desiredId) ?? registry.find((m) => m.output_type === 'video' && isAvailable(m)) ?? byId.get('magnific:seedance-2-5-draft')!;
    if (!isAvailable(chosen) && chosen.fallback_model_id && byId.get(chosen.fallback_model_id)) {
      chosen = byId.get(chosen.fallback_model_id)!;
    }
    const fallback = chosen.fallback_model_id ? byId.get(chosen.fallback_model_id) ?? null : null;
    return {
      primary: chosen,
      compositor,
      copyModel,
      fallback,
      rationale: input.preferDraftCost
        ? `Selected ${chosen.model} in low-cost draft resolution to validate blocking before full render.`
        : `Selected ${chosen.model} (${chosen.provider}) for reference-consistent multi-shot video with deterministic caption/logo finishing.`,
    };
  }

  // Static graphic or Carousel background generation
  let desiredImageId = 'magnific:magnific-one';
  if (input.preferDraftCost) {
    desiredImageId = 'magnific:magnific-one-draft';
  } else if (input.controls.text_in_image === 'allowed') {
    desiredImageId = 'magnific:nano-banana-pro';
  }

  let primary = byId.get(desiredImageId)!;
  if (!isAvailable(primary)) {
    const fb = primary.fallback_model_id ? byId.get(primary.fallback_model_id) : null;
    if (fb && isAvailable(fb)) primary = fb;
  }
  const fallback = primary.fallback_model_id ? byId.get(primary.fallback_model_id) ?? null : null;

  return {
    primary,
    compositor,
    copyModel,
    fallback,
    rationale:
      input.controls.text_in_image === 'avoid'
        ? `Selected ${primary.model} (${primary.provider}) for text-free visual background + deterministic layer for exact typography and logo lockup.`
        : `Selected ${primary.model} (${primary.provider}) for micro-typography support + deterministic verification.`,
  };
}

export interface CostEstimateBreakdown {
  selected_provider: string;
  selected_model: string;
  units: {
    copy_passes: number;
    visual_generations: number;
    deterministic_renders: number;
  };
  estimated_provider_cost_usd: number; // Actual third-party provider USD estimate
  estimated_internal_credits: number;  // Separate SaaS internal credits
  requires_spend_confirmation: boolean;
  exceeds_brief_cap: boolean;
  exceeds_monthly_budget: boolean;
  blocking_reason: string | null;
}

export function estimateGenerationCost(params: {
  workflowType: WorkflowType;
  controls: CreativeControls;
  spendLimitUsd: number;
  creditCeiling: number;
  preferDraftCost?: boolean;
  slideCount?: number;
  aiSceneCount?: number;
  businessCapacity?: BusinessProfileRecord['capacity'];
  availableProviders?: Set<string>;
}): CostEstimateBreakdown {
  const routed = routeModelForBrief({
    workflowType: params.workflowType,
    controls: params.controls,
    preferDraftCost: params.preferDraftCost,
    availableProviders: params.availableProviders,
  });

  const visualUnits =
    routed.primary.provider === 'deterministic'
      ? 0
      : params.workflowType === 'carousel'
        ? Math.max(1, Math.min(params.slideCount ?? 4, 8))
        : params.workflowType === 'short_form_video'
          ? Math.max(1, Math.min(params.aiSceneCount ?? 2, 4))
          : 1;

  const copyPasses = 1;
  const providerUsd = Number(
    (copyPasses * routed.copyModel.provider_cost_usd + visualUnits * routed.primary.provider_cost_usd).toFixed(4),
  );
  const internalCredits =
    copyPasses * routed.copyModel.internal_credits + visualUnits * routed.primary.internal_credits;

  const exceedsBriefUsd = providerUsd > params.spendLimitUsd;
  const exceedsBriefCredits = internalCredits > params.creditCeiling;
  const exceedsMonthlyUsd = params.businessCapacity
    ? providerUsd > params.businessCapacity.monthly_budget_usd
    : false;
  const exceedsMonthlyCredits = params.businessCapacity
    ? internalCredits > params.businessCapacity.monthly_credit_cap
    : false;

  const confirmationThreshold = params.controls.confirmation_threshold_usd ?? 2.0;
  const requiresConfirmation =
    providerUsd > confirmationThreshold && !params.controls.user_confirmed_spend;

  let blockingReason: string | null = null;
  if (exceedsBriefUsd) {
    blockingReason = `Estimated provider cost ($${providerUsd.toFixed(2)}) exceeds brief spend limit ($${params.spendLimitUsd.toFixed(2)}).`;
  } else if (exceedsBriefCredits) {
    blockingReason = `Estimated internal credits (${internalCredits}) exceed brief credit ceiling (${params.creditCeiling}).`;
  } else if (exceedsMonthlyUsd || exceedsMonthlyCredits) {
    blockingReason = `Estimated run exceeds workspace monthly budget/credit policy.`;
  } else if (requiresConfirmation) {
    blockingReason = `Estimated provider spend ($${providerUsd.toFixed(2)}) exceeds confirmation threshold ($${confirmationThreshold.toFixed(2)}). Set user_confirmed_spend=true to proceed.`;
  }

  return {
    selected_provider: routed.primary.provider,
    selected_model: routed.primary.model,
    units: {
      copy_passes: copyPasses,
      visual_generations: visualUnits,
      deterministic_renders: params.workflowType === 'carousel' ? Math.max(2, params.slideCount ?? 4) : 1,
    },
    estimated_provider_cost_usd: providerUsd,
    estimated_internal_credits: internalCredits,
    requires_spend_confirmation: requiresConfirmation,
    exceeds_brief_cap: exceedsBriefUsd || exceedsBriefCredits,
    exceeds_monthly_budget: exceedsMonthlyUsd || exceedsMonthlyCredits,
    blocking_reason: blockingReason,
  };
}

/**
 * Constructs task-relevant prompts that behave predictably and distinctly across
 * `strict_brand`, `brand_inspired`, and `creative_freedom` modes (Section 2.2 & Section 6).
 */
export function buildBrandAwarePrompt(params: {
  item: ContentItemRecord;
  brief: CreativeBriefRecord;
  brand: BrandProfileRecord | null;
  approvedTokens: BrandTokenRecord[];
}): {
  visualPrompt: string;
  copyDirectives: string[];
  enforcedConstraints: string[];
} {
  const { item, brief, brand, approvedTokens } = params;
  const mode: CreativeMode = brief.creative_mode;

  // Sanitize any user tone or prompt override to prevent jailbreak leakage into image generator
  const toneCheck = scanForPromptInjection(brief.controls.tone_override || '');
  const cleanTone = toneCheck.safe ? brief.controls.tone_override : undefined;

  const approvedColors = [
    ...(brand?.visual?.colors ?? []).map((c) => `${c.name} (${c.hex}, ${c.role})`),
    ...approvedTokens
      .filter((t) => t.category === 'color' && t.approval_status === 'approved')
      .map((t) => `${t.name} (${t.value?.hex || ''})`),
  ];
  const retiredColors = brand?.visual?.retired_colors ?? [];
  const avoidMotifs = brand?.visual?.imagery?.avoid ?? [];
  const voiceAttrs = brand?.voice?.attributes ?? ['Clear', 'Professional'];

  const modeDirective =
    mode === 'strict_brand'
      ? `STRICT BRAND MODE: Use ONLY approved brand palette (${approvedColors.slice(0, 5).join(', ') || 'clean neutral palette'}). Zero unapproved accent colors, zero stylistic departures, clean restrained layout.`
      : mode === 'brand_inspired'
        ? `BRAND-INSPIRED MODE: Anchor visual identity in ${approvedColors.slice(0, 3).join(', ') || 'brand colors'} while allowing natural lighting, editorial depth, and campaign-specific storytelling.`
        : `CREATIVE FREEDOM MODE: Explore bold campaign art direction, expressive lighting, and novel visual metaphors. Factual accuracy, prohibited claims, retired identity bans, and consent rules remain strictly enforced.`;

  const textInImageRule =
    brief.controls.text_in_image === 'avoid'
      ? 'NO embedded text, NO letters, NO watermarks, NO generated logos inside pixels — leave clean negative space for the deterministic typography & logo layer.'
      : brief.controls.text_in_image === 'minimal'
        ? `Minimal short label allowed only if tack-sharp; reserve main headline and logo for deterministic overlay.`
        : `Exact product typography permitted: "${brief.hook_message.slice(0, 40)}" — no misspellings, no extra glyphs, no warped logos.`;

  const bgRule =
    brief.controls.background_complexity === 'clean_solid'
      ? 'Clean solid studio surface background.'
      : brief.controls.background_complexity === 'minimal_studio'
        ? 'Minimal architectural studio background with controlled directional lighting.'
        : brief.controls.background_complexity === 'rich_editorial'
          ? 'Rich editorial environment with shallow depth of field.'
          : 'Contextual workspace environment supporting the subject.';

  const negativeRules = [
    retiredColors.length ? `Never use retired colors (${retiredColors.join(', ')})` : '',
    avoidMotifs.length ? `Avoid motifs: ${avoidMotifs.join(', ')}` : '',
    'Never fabricate software UI screens, fake customer faces/testimonials, or distorted brand wordmarks',
  ].filter(Boolean);

  const visualPrompt = [
    `Subject: ${item.title}. ${brief.intended_takeaway || item.hook}.`,
    modeDirective,
    bgRule,
    textInImageRule,
    `Negative constraints: ${negativeRules.join('; ')}.`,
  ].join(' ');

  const copyDirectives = [
    `Voice attributes: ${voiceAttrs.join(', ')}${brief.controls.tone_override ? ` (override: ${brief.controls.tone_override})` : ''}.`,
    `Humour level: ${brief.controls.humour_level}.`,
    `Permitted verified claims ONLY: ${brief.permitted_claims.length ? brief.permitted_claims.join(' | ') : 'None — write educational/narrative copy without unverified numbers or testimonials'}.`,
    ...(brand?.voice?.avoid_terms?.length ? [`Never use terms: ${brand.voice.avoid_terms.join(', ')}.`] : []),
  ];

  return {
    visualPrompt,
    copyDirectives,
    enforcedConstraints: negativeRules,
  };
}

export function createCreativeBriefForItem(params: {
  item: ContentItemRecord;
  business: BusinessProfileRecord;
  brand: BrandProfileRecord | null;
  creativeMode?: CreativeMode;
  controlsOverride?: Partial<CreativeControls>;
  spendLimitUsd?: number;
  creditCeiling?: number;
  preferDraftCost?: boolean;
}): CreativeBriefRecord {
  const { item, business, brand } = params;
  const now = new Date().toISOString();
  const primaryChannel = item.target_channels[0] || 'instagram';
  const placement: CreativeBriefRecord['placement'] =
    item.format === 'carousel' ? 'CAROUSEL'
    : item.format === 'short_video' || item.format === 'product_demo' ? 'REEL'
    : item.format === 'story' ? 'STORY'
    : 'FEED_POST';

  const aspectRatio: CreativeBriefRecord['aspect_ratio'] =
    placement === 'REEL' || placement === 'STORY' ? '9:16'
    : primaryChannel === 'instagram' ? '4:5'
    : '1:1';

  const safeAreas =
    placement === 'REEL' || placement === 'STORY'
      ? { top_px: 220, bottom_px: 340, left_px: 64, right_px: 120 }
      : { top_px: 60, bottom_px: 60, left_px: 60, right_px: 60 };

  const defaultSourceMode =
    item.workflow_type === 'product_demo' ? 'real_screenshot' : 'ai_generated';

  const controls: CreativeControls = {
    logo_policy: brand?.content_rules?.logo_policy_default ?? 'contextual',
    text_in_image: 'avoid',
    reference_fidelity: params.creativeMode === 'strict_brand' ? 'strict' : 'balanced',
    media_source_mode: defaultSourceMode,
    humour_level: 'none',
    motion_intensity: placement === 'REEL' ? 'moderate' : 'none',
    background_complexity: params.creativeMode === 'strict_brand' ? 'minimal_studio' : 'contextual',
    confirmation_threshold_usd: 2.0,
    user_confirmed_spend: false,
    ...(params.controlsOverride ?? {}),
  };

  const spendLimitUsd = params.spendLimitUsd ?? Math.min(5.0, Math.max(0.5, business.capacity.monthly_budget_usd));
  const creditCeiling = params.creditCeiling ?? Math.min(150, Math.max(10, business.capacity.monthly_credit_cap));

  const costEstimate = estimateGenerationCost({
    workflowType: item.workflow_type,
    controls,
    spendLimitUsd,
    creditCeiling,
    preferDraftCost: params.preferDraftCost,
    businessCapacity: business.capacity,
  });

  const permittedClaims = [
    ...(brand?.identity?.approved_claims ?? []),
    ...business.available_proof.filter((p) => p.verified).map((p) => p.metric_or_claim || p.summary),
  ].slice(0, 12);

  return {
    id: randomUUID(),
    content_item_id: item.id,
    tenant_id: item.tenant_id,
    objective: business.primary_objective,
    target_audience: business.audiences[0]?.segment || 'Primary Audience',
    channel: primaryChannel,
    placement,
    aspect_ratio: aspectRatio,
    safe_areas: safeAreas,
    hook_message: item.hook || item.title,
    intended_takeaway: item.caption.split('\n')[0] || item.title,
    cta: item.caption.split('\n').slice(-1)[0] || 'Learn more.',
    destination_url: business.website_url || '',
    brand_profile_id: brand?.id ?? null,
    brand_version: brand?.current_version ?? 1,
    creative_mode: params.creativeMode ?? 'brand_inspired',
    controls,
    reference_asset_ids: [],
    permitted_claims: permittedClaims,
    evidence_refs: business.available_proof.filter((p) => p.verified).map((p) => ({
      claim: p.metric_or_claim || p.summary,
      proof_id: p.id,
      source: p.source_url,
    })),
    selected_provider: costEstimate.selected_provider,
    selected_model: costEstimate.selected_model,
    estimated_provider_cost_usd: costEstimate.estimated_provider_cost_usd,
    estimated_credits: costEstimate.estimated_internal_credits,
    spend_limit_usd: spendLimitUsd,
    credit_ceiling: creditCeiling,
    max_attempts: 3,
    review_criteria: [
      'Brand palette & logo compliance',
      'Zero unverified numerical or testimonial claims',
      'Safe-zone & minimum 4.5:1 text contrast',
    ],
    created_at: now,
    updated_at: now,
  };
}
