import { randomUUID } from 'crypto';
import { creditsForUsd } from '../aiPricing.ts';
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
// Model registry: the one list the UI, router, provider adapters, cost
// estimator, health check and tests all read. Each entry names the exact
// upstream model ID, how it is called, how it is priced, and when its contract
// was last checked against the provider's own documentation.
//
// An entry is selectable only when it is enabled, not retired or past its
// shutdown date, has an adapter that can call it, and its API contract has been
// verified (or an operator has rolled it out explicitly with
// AUTOPILOT_MODEL_ROLLOUT after verifying it in staging). Nothing is ever
// substituted silently: an unselectable model is a MODEL_UNAVAILABLE error.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelTaskType =
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
  | 'deterministic_compositing';

export type ModelLifecycle = 'active' | 'deprecated' | 'retired' | 'unverified_contract';
export type ModelAdapterKind = 'openai_images' | 'magnific_image_task' | 'magnific_video_task' | 'deterministic' | 'text_llm' | 'none';

export interface ModelPricingPolicy {
  /** per_token: priced from provider-reported usage; flat_estimate: no usage reported, cost is always an estimate; none: free; unknown: no published price. */
  method: 'per_token' | 'flat_estimate' | 'none' | 'unknown';
  text_input_usd_per_mtok?: number;
  image_input_usd_per_mtok?: number;
  image_output_usd_per_mtok?: number;
  /** Conservative output-token estimate per unit, used only for the reservation. */
  estimated_output_tokens_per_unit?: number;
  estimated_input_tokens_per_unit?: number;
  source?: string;
}

export interface ModelCapabilityEntry {
  id: string;
  provider: 'magnific' | 'google' | 'openai' | 'anthropic' | 'elevenlabs' | 'deterministic';
  /** Exact upstream model ID sent to the provider. */
  model: string;
  task_types: ModelTaskType[];
  input_types: Array<'text' | 'image_ref' | 'video_ref' | 'audio' | 'brand_tokens'>;
  output_type: 'text' | 'image' | 'video' | 'audio';
  supported_aspect_ratios: string[];
  supported_resolutions?: string[];
  max_clip_duration_sec?: number;
  max_references: number;
  supports_exact_text_in_image: boolean;
  latency_tier: 'instant' | 'fast' | 'standard' | 'heavy';
  sync_mode: 'sync' | 'async_task' | 'local';
  /** Estimated third-party USD per unit. Never conflated with SaaS credits. */
  provider_cost_usd: number;
  /** SaaS credits charged per delivered unit (customer price). */
  internal_credits: number;
  pricing: ModelPricingPolicy;
  enabled: boolean;
  lifecycle: ModelLifecycle;
  /** ISO date after which the provider no longer serves this model. */
  shutdown_date?: string;
  replacement_model_id?: string;
  adapter: ModelAdapterKind;
  contract_source: string;
  /** Date the API contract was checked against the provider's documentation. */
  contract_verified_at: string | null;
  /** Date a real staging request succeeded. Null until staging evidence exists. */
  staging_verified_at: string | null;
  feature_flag?: string;
  fallback_model_id?: string;
}

const OPENAI_IMAGE_PRICING: ModelPricingPolicy = {
  method: 'per_token',
  text_input_usd_per_mtok: 5,
  image_input_usd_per_mtok: 8,
  image_output_usd_per_mtok: 30,
  // Upper estimate for one image at <= 1536px, used only to size the hold; the
  // settled cost comes from the usage object OpenAI returns with each image.
  estimated_output_tokens_per_unit: 4200,
  estimated_input_tokens_per_unit: 600,
  source: 'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare',
};

const MAGNIFIC_UNVERIFIED_NOTE =
  'Not in the public Magnific API reference (docs.magnific.com/llms.txt, checked 2026-10-29). Roll out with AUTOPILOT_MODEL_ROLLOUT only after a staging request succeeds.';

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
    sync_mode: 'sync',
    provider_cost_usd: 0.004,
    internal_credits: 2,
    pricing: { method: 'flat_estimate' },
    // Not called by the autopilot workflow: the brief/copy node is built
    // deterministically, so this entry is informational and never charged.
    enabled: false,
    lifecycle: 'active',
    adapter: 'none',
    contract_source: 'Configured through Admin → AI settings (ai-helpers.ts); not invoked by executeAutopilotWorkflow',
    contract_verified_at: null,
    staging_verified_at: null,
  },
  {
    id: 'openai:gpt-image-2.5-flare',
    provider: 'openai',
    model: 'gpt-image-2.5-flare',
    task_types: ['static_graphic_draft', 'static_graphic_final'],
    input_types: ['text'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '4:5', '3:4', '4:3', '16:9', '9:16'],
    supported_resolutions: ['1024x1024', '1024x1280', '1152x1536', '1536x1152', '1792x1008', '1008x1792'],
    max_references: 0,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    sync_mode: 'sync',
    provider_cost_usd: 0.129,
    internal_credits: 8,
    pricing: OPENAI_IMAGE_PRICING,
    enabled: true,
    lifecycle: 'active',
    adapter: 'openai_images',
    contract_source: 'https://developers.openai.com/api/reference/resources/images/methods/generate',
    contract_verified_at: '2026-10-29',
    staging_verified_at: null,
  },
  {
    id: 'openai:gpt-image-2.5-sunburst',
    provider: 'openai',
    model: 'gpt-image-2.5-sunburst',
    task_types: ['static_graphic_final', 'product_typography_image', 'photorealistic_campaign'],
    input_types: ['text'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '4:5', '3:4', '4:3', '16:9', '9:16'],
    supported_resolutions: ['1024x1024', '1024x1280', '1152x1536', '1536x1152', '1792x1008', '1008x1792'],
    max_references: 0,
    supports_exact_text_in_image: true,
    latency_tier: 'standard',
    sync_mode: 'sync',
    provider_cost_usd: 0.129,
    internal_credits: 12,
    pricing: OPENAI_IMAGE_PRICING,
    enabled: true,
    lifecycle: 'active',
    adapter: 'openai_images',
    contract_source: 'https://developers.openai.com/api/reference/resources/images/methods/generate',
    contract_verified_at: '2026-10-29',
    staging_verified_at: null,
  },
  {
    // Shut down by OpenAI on 2026-10-23. Kept so history and old briefs resolve
    // to a clear MODEL_UNAVAILABLE instead of an unknown ID.
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
    sync_mode: 'sync',
    provider_cost_usd: 0.04,
    internal_credits: 8,
    pricing: OPENAI_IMAGE_PRICING,
    enabled: false,
    lifecycle: 'retired',
    shutdown_date: '2026-10-23',
    replacement_model_id: 'openai:gpt-image-2.5-sunburst',
    adapter: 'openai_images',
    contract_source: 'https://developers.openai.com/api/docs/deprecations',
    contract_verified_at: '2026-10-29',
    staging_verified_at: null,
  },
  {
    // Announced 2026-06-02, shutdown 2026-12-01. Not selectable for new work.
    id: 'openai:gpt-image-1-mini',
    provider: 'openai',
    model: 'gpt-image-1-mini',
    task_types: ['static_graphic_draft'],
    input_types: ['text'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '16:9', '9:16'],
    max_references: 0,
    supports_exact_text_in_image: false,
    latency_tier: 'fast',
    sync_mode: 'sync',
    provider_cost_usd: 0.015,
    internal_credits: 4,
    pricing: OPENAI_IMAGE_PRICING,
    enabled: false,
    lifecycle: 'deprecated',
    shutdown_date: '2026-12-01',
    replacement_model_id: 'openai:gpt-image-2.5-flare',
    adapter: 'openai_images',
    contract_source: 'https://developers.openai.com/api/docs/deprecations',
    contract_verified_at: '2026-10-29',
    staging_verified_at: null,
  },
  {
    id: 'magnific:magnific-one',
    provider: 'magnific',
    model: 'magnific-one',
    task_types: ['static_graphic_final', 'photorealistic_campaign'],
    input_types: ['text', 'image_ref', 'brand_tokens'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    supported_resolutions: ['1k', '2k', '4k'],
    max_references: 10,
    supports_exact_text_in_image: false,
    latency_tier: 'standard',
    sync_mode: 'async_task',
    provider_cost_usd: 0.6, // 2k high: 600 Magnific credits (Magnific cost simulator, 2 Nov 2026)
    internal_credits: 10,
    pricing: { method: 'flat_estimate', source: 'Internal rate card; Magnific task responses report no usage' },
    enabled: true,
    lifecycle: 'unverified_contract',
    adapter: 'magnific_image_task',
    contract_source: MAGNIFIC_UNVERIFIED_NOTE,
    contract_verified_at: null,
    staging_verified_at: null,
  },
  {
    id: 'magnific:nano-banana-pro',
    provider: 'magnific',
    model: 'nano-banana-pro',
    task_types: ['product_typography_image', 'surface_mockup'],
    input_types: ['text', 'image_ref'],
    output_type: 'image',
    supported_aspect_ratios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    max_references: 6,
    supports_exact_text_in_image: true,
    latency_tier: 'standard',
    sync_mode: 'async_task',
    provider_cost_usd: 0.075, // 75 Magnific credits (Magnific cost simulator, 2 Nov 2026)
    internal_credits: 12,
    pricing: { method: 'flat_estimate', source: 'Internal rate card; Magnific task responses report no usage' },
    enabled: true,
    lifecycle: 'unverified_contract',
    adapter: 'magnific_image_task',
    contract_source: MAGNIFIC_UNVERIFIED_NOTE,
    contract_verified_at: null,
    staging_verified_at: null,
  },
  {
    id: 'magnific:seedance-2-5',
    provider: 'magnific',
    model: 'seedance-2-5',
    task_types: ['short_video_draft', 'short_video_final'],
    input_types: ['text', 'image_ref', 'video_ref'],
    output_type: 'video',
    supported_aspect_ratios: ['9:16', '16:9', '1:1'],
    supported_resolutions: ['480p', '720p', '1080p'],
    max_clip_duration_sec: 30,
    max_references: 30,
    supports_exact_text_in_image: false,
    latency_tier: 'heavy',
    sync_mode: 'async_task',
    provider_cost_usd: 3.95, // 5 s 1080p: 3,950 Magnific credits (Magnific cost simulator, 2 Nov 2026)
    internal_credits: 35,
    pricing: { method: 'flat_estimate', source: 'Internal rate card; Magnific task responses report no usage' },
    enabled: true,
    lifecycle: 'unverified_contract',
    adapter: 'magnific_video_task',
    contract_source: MAGNIFIC_UNVERIFIED_NOTE,
    contract_verified_at: null,
    staging_verified_at: null,
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
    sync_mode: 'async_task',
    provider_cost_usd: 0.475, // 5 s 1080p: 475 Magnific credits (Magnific cost simulator, 2 Nov 2026)
    internal_credits: 38,
    pricing: { method: 'flat_estimate', source: 'Internal rate card; Magnific task responses report no usage' },
    enabled: true,
    lifecycle: 'unverified_contract',
    adapter: 'magnific_video_task',
    contract_source: MAGNIFIC_UNVERIFIED_NOTE,
    contract_verified_at: null,
    staging_verified_at: null,
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
    sync_mode: 'local',
    provider_cost_usd: 0,
    internal_credits: 0,
    pricing: { method: 'none' },
    enabled: true,
    lifecycle: 'active',
    adapter: 'deterministic',
    contract_source: 'deterministicCompositor.ts',
    contract_verified_at: '2026-10-29',
    staging_verified_at: null,
  },
];

// Runtime overrides (admin price/availability updates). Restricted to fields
// that cannot resurrect a retired model or change what is sent upstream.
const OVERRIDABLE_FIELDS = new Set<keyof ModelCapabilityEntry>(['enabled', 'provider_cost_usd', 'internal_credits']);
let runtimeRegistryOverrides: Record<string, Partial<ModelCapabilityEntry>> = {};

export function refreshModelRegistryOverrides(overrides: Record<string, Partial<ModelCapabilityEntry>>) {
  const known = new Set(DEFAULT_MODEL_REGISTRY.map((m) => m.id));
  const next = { ...runtimeRegistryOverrides };
  for (const [id, patch] of Object.entries(overrides ?? {})) {
    if (!known.has(id) || !patch || typeof patch !== 'object') continue;
    const clean: Partial<ModelCapabilityEntry> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!OVERRIDABLE_FIELDS.has(k as keyof ModelCapabilityEntry)) continue;
      if (k === 'enabled' && typeof v === 'boolean') clean.enabled = v;
      if ((k === 'provider_cost_usd' || k === 'internal_credits') && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        (clean as any)[k] = k === 'internal_credits' ? Math.round(v) : v;
      }
    }
    next[id] = { ...(next[id] ?? {}), ...clean };
  }
  runtimeRegistryOverrides = next;
}

export function getModelCapabilityRegistry(): ModelCapabilityEntry[] {
  return DEFAULT_MODEL_REGISTRY.map((entry) => {
    const override = runtimeRegistryOverrides[entry.id] ?? {};
    const merged = { ...entry, ...override };
    // Credits follow the provider cost × 1.54 (server/aiPricing.ts) unless an admin set them explicitly.
    if (override.internal_credits === undefined && merged.provider_cost_usd > 0) merged.internal_credits = creditsForUsd(merged.provider_cost_usd);
    return merged;
  });
}

function rolledOutModelIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(String(env.AUTOPILOT_MODEL_ROLLOUT || '').split(',').map((s) => s.trim()).filter(Boolean));
}

export type ModelUnavailableReason = 'unknown' | 'disabled' | 'retired' | 'past_shutdown' | 'unverified_contract' | 'no_adapter' | 'provider_not_configured';

export function modelSelectability(
  entry: ModelCapabilityEntry | undefined,
  opts: { now?: Date; env?: NodeJS.ProcessEnv; availableProviders?: Set<string> } = {},
): { selectable: true } | { selectable: false; reason: ModelUnavailableReason } {
  if (!entry) return { selectable: false, reason: 'unknown' };
  const now = opts.now ?? new Date();
  if (entry.lifecycle === 'retired') return { selectable: false, reason: 'retired' };
  if (entry.shutdown_date && now.toISOString().slice(0, 10) >= entry.shutdown_date) return { selectable: false, reason: 'past_shutdown' };
  if (!entry.enabled) return { selectable: false, reason: 'disabled' };
  if (entry.adapter === 'none') return { selectable: false, reason: 'no_adapter' };
  if (entry.lifecycle === 'unverified_contract' && !rolledOutModelIds(opts.env).has(entry.id)) {
    return { selectable: false, reason: 'unverified_contract' };
  }
  if (opts.availableProviders && entry.provider !== 'deterministic' && !opts.availableProviders.has(entry.provider)) {
    return { selectable: false, reason: 'provider_not_configured' };
  }
  return { selectable: true };
}

export class ModelUnavailableError extends Error {
  code = 'MODEL_UNAVAILABLE' as const;
  status = 422;
  details: Record<string, any>;
  constructor(message: string, details: Record<string, any>) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.details = details;
  }
}

/** Looks up a model by registry ID or exact upstream ID. Never substitutes. */
export function resolveSelectableModel(
  idOrUpstream: string,
  opts: { now?: Date; env?: NodeJS.ProcessEnv; availableProviders?: Set<string> } = {},
): ModelCapabilityEntry {
  const registry = getModelCapabilityRegistry();
  const raw = String(idOrUpstream || '').trim();
  const entry = registry.find((m) => m.id === raw) ?? registry.find((m) => m.model === raw);
  const check = modelSelectability(entry, opts);
  if (!check.selectable) {
    throw new ModelUnavailableError(
      entry?.replacement_model_id
        ? `Model "${raw}" is not available (${check.reason}). Use "${entry.replacement_model_id}" instead.`
        : `Model "${raw}" is not available (${check.reason}).`,
      { requested_model: raw, reason: check.reason, replacement_model_id: entry?.replacement_model_id ?? null },
    );
  }
  return entry!;
}

export function listSelectableModels(opts: { now?: Date; env?: NodeJS.ProcessEnv; availableProviders?: Set<string> } = {}) {
  return getModelCapabilityRegistry().map((entry) => {
    const check = modelSelectability(entry, opts);
    return { ...entry, selectable: check.selectable, unavailable_reason: check.selectable ? null : check.reason };
  });
}

export interface RouteTaskInput {
  workflowType: WorkflowType;
  controls: CreativeControls;
  preferDraftCost?: boolean;
  slideCount?: number;
  sceneCount?: number;
  availableProviders?: Set<string>;
  /** A model the brief asked for explicitly. Validated, never replaced. */
  requestedModelId?: string | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface RoutedModelSelection {
  /** Null when no selectable model can do this task: callers must refuse with MODEL_UNAVAILABLE. */
  primary: ModelCapabilityEntry | null;
  compositor: ModelCapabilityEntry;
  copyModel: ModelCapabilityEntry;
  fallback: ModelCapabilityEntry | null;
  rationale: string;
  unavailable?: { code: 'MODEL_UNAVAILABLE'; message: string; considered: Array<{ id: string; reason: string }> };
}

function firstSelectable(ids: string[], input: RouteTaskInput) {
  const registry = getModelCapabilityRegistry();
  const considered: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const entry = registry.find((m) => m.id === id);
    const check = modelSelectability(entry, { now: input.now, env: input.env, availableProviders: input.availableProviders });
    if (check.selectable) return { entry: entry!, considered };
    considered.push({ id, reason: check.reason });
  }
  return { entry: null, considered };
}

export function routeModelForBrief(input: RouteTaskInput): RoutedModelSelection {
  const registry = getModelCapabilityRegistry();
  const byId = new Map(registry.map((m) => [m.id, m]));
  const compositor = byId.get('deterministic:compositor-v1')!;
  const copyModel = byId.get('google:gemini-2.5-flash')!;

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

  if (input.controls.media_source_mode === 'real_photography') {
    return {
      primary: compositor,
      compositor,
      copyModel,
      fallback: null,
      rationale: 'Selected deterministic brand layout over customer-provided photography.',
    };
  }

  const isVideo = input.workflowType === 'short_form_video';

  if (input.requestedModelId) {
    const entry = resolveSelectableModel(input.requestedModelId, {
      now: input.now,
      env: input.env,
      availableProviders: input.availableProviders,
    });
    const wanted = isVideo ? 'video' : 'image';
    if (entry.output_type !== wanted) {
      throw new ModelUnavailableError(`Model "${entry.id}" produces ${entry.output_type}, not ${wanted}.`, {
        requested_model: entry.id,
        reason: 'wrong_media_type',
      });
    }
    return {
      primary: entry,
      compositor,
      copyModel,
      fallback: null,
      rationale: `Using the model this brief selected: ${entry.model} (${entry.provider}).`,
    };
  }

  // Preference order per task. The first selectable entry wins; the choice is
  // made here, before any budget is reserved, and is reported to the user.
  const preference = isVideo
    ? input.controls.reference_fidelity === 'strict'
      ? ['magnific:kling-3-0-omni', 'magnific:seedance-2-5']
      : ['magnific:seedance-2-5', 'magnific:kling-3-0-omni']
    : input.preferDraftCost
      ? ['openai:gpt-image-2.5-flare', 'magnific:magnific-one']
      : input.controls.text_in_image === 'allowed'
        ? ['magnific:nano-banana-pro', 'openai:gpt-image-2.5-sunburst']
        : ['magnific:magnific-one', 'openai:gpt-image-2.5-sunburst', 'openai:gpt-image-2.5-flare'];

  // Lowest cost first unless the brief asks for best quality: the same order,
  // re-sorted by what each model costs us (stable, so ties keep their rank).
  if (input.controls.cost_mode !== 'quality') {
    const cost = (id: string) => byId.get(id)?.provider_cost_usd ?? Number.POSITIVE_INFINITY;
    preference.sort((a, b) => cost(a) - cost(b));
  }

  const picked = firstSelectable(preference, input);
  if (!picked.entry) {
    const message = isVideo
      ? 'No video model is currently available: every candidate is unverified, disabled or its provider is not configured.'
      : 'No image model is currently available: every candidate is disabled, retired, unverified or its provider is not configured.';
    return {
      primary: null,
      compositor,
      copyModel,
      fallback: null,
      rationale: message,
      unavailable: { code: 'MODEL_UNAVAILABLE', message, considered: picked.considered },
    };
  }

  const skipped = picked.considered.length
    ? ` Skipped ${picked.considered.map((c) => `${c.id} (${c.reason})`).join(', ')}.`
    : '';
  return {
    primary: picked.entry,
    compositor,
    copyModel,
    fallback: null,
    rationale: isVideo
      ? `Selected ${picked.entry.model} (${picked.entry.provider}) for short-form video with deterministic caption/logo finishing.${skipped}`
      : input.controls.text_in_image === 'avoid'
        ? `Selected ${picked.entry.model} (${picked.entry.provider}) for a text-free visual background + deterministic layer for exact typography and logo lockup.${skipped}`
        : `Selected ${picked.entry.model} (${picked.entry.provider}) for in-image typography + deterministic verification.${skipped}`,
  };
}

export interface CostEstimateBreakdown {
  selected_provider: string;
  selected_model: string;
  selected_model_id: string | null;
  units: {
    copy_passes: number;
    visual_generations: number;
    deterministic_renders: number;
  };
  estimated_provider_cost_usd: number; // Third-party provider USD estimate
  estimated_internal_credits: number;  // Separate SaaS internal credits
  cost_basis: 'estimated';
  requires_spend_confirmation: boolean;
  exceeds_brief_cap: boolean;
  exceeds_monthly_budget: boolean;
  blocking_reason: string | null;
  blocking_code: 'MODEL_UNAVAILABLE' | 'COST_CAP_BLOCKED' | null;
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
  requestedModelId?: string | null;
  routed?: RoutedModelSelection;
}): CostEstimateBreakdown {
  const routed = params.routed ?? routeModelForBrief({
    workflowType: params.workflowType,
    controls: params.controls,
    preferDraftCost: params.preferDraftCost,
    availableProviders: params.availableProviders,
    requestedModelId: params.requestedModelId,
  });

  if (!routed.primary) {
    return {
      selected_provider: '',
      selected_model: '',
      selected_model_id: null,
      units: { copy_passes: 0, visual_generations: 0, deterministic_renders: 0 },
      estimated_provider_cost_usd: 0,
      estimated_internal_credits: 0,
      cost_basis: 'estimated',
      requires_spend_confirmation: false,
      exceeds_brief_cap: false,
      exceeds_monthly_budget: false,
      blocking_reason: routed.unavailable?.message ?? 'No model available for this task.',
      blocking_code: 'MODEL_UNAVAILABLE',
    };
  }

  const visualUnits =
    routed.primary.provider === 'deterministic'
      ? 0
      : params.workflowType === 'carousel'
        ? Math.max(1, Math.min(params.slideCount ?? 4, 10))
        : params.workflowType === 'short_form_video'
          ? Math.max(1, Math.min(params.aiSceneCount ?? 2, 4))
          : 1;

  // The brief/copy node is deterministic (no LLM call), so it carries no cost.
  const copyPasses = 0;
  const providerUsd = Number((visualUnits * routed.primary.provider_cost_usd).toFixed(4));
  const internalCredits = visualUnits * routed.primary.internal_credits;

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
    selected_model_id: routed.primary.id,
    units: {
      copy_passes: copyPasses,
      visual_generations: visualUnits,
      deterministic_renders: params.workflowType === 'carousel' ? Math.max(2, params.slideCount ?? 4) : 1,
    },
    estimated_provider_cost_usd: providerUsd,
    estimated_internal_credits: internalCredits,
    cost_basis: 'estimated',
    requires_spend_confirmation: requiresConfirmation,
    exceeds_brief_cap: exceedsBriefUsd || exceedsBriefCredits,
    exceeds_monthly_budget: exceedsMonthlyUsd || exceedsMonthlyCredits,
    blocking_reason: blockingReason,
    blocking_code: blockingReason ? 'COST_CAP_BLOCKED' : null,
  };
}

/** USD for one OpenAI image from its reported usage object; null when usage is absent. */
export function priceFromReportedUsage(
  pricing: ModelPricingPolicy,
  usage: { input_tokens_details?: { text_tokens?: number; image_tokens?: number }; input_tokens?: number; output_tokens?: number } | null | undefined,
): number | null {
  if (pricing.method !== 'per_token' || !usage || typeof usage.output_tokens !== 'number') return null;
  const textIn = Number(usage.input_tokens_details?.text_tokens ?? (usage.input_tokens_details ? 0 : usage.input_tokens ?? 0));
  const imageIn = Number(usage.input_tokens_details?.image_tokens ?? 0);
  const out = Number(usage.output_tokens);
  if (![textIn, imageIn, out].every((n) => Number.isFinite(n) && n >= 0)) return null;
  const usd =
    (textIn * (pricing.text_input_usd_per_mtok ?? 0) +
      imageIn * (pricing.image_input_usd_per_mtok ?? 0) +
      out * (pricing.image_output_usd_per_mtok ?? 0)) /
    1_000_000;
  return Number(usd.toFixed(6));
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

  // Default per-brief cap. Real video costs (e.g. Seedance 2.5: $3.95 per 5 s clip) need room for a multi-clip video.
  const spendLimitUsd = params.spendLimitUsd ?? Math.min(20.0, Math.max(0.5, business.capacity.monthly_budget_usd));
  // The credit ceiling matches the spend limit at cost × 1.54, within the monthly credit cap.
  const creditCeiling = params.creditCeiling ?? Math.min(creditsForUsd(spendLimitUsd), Math.max(10, business.capacity.monthly_credit_cap));

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
