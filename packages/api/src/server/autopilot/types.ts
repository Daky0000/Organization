import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Brand-Aware Social Content Autopilot — Core Domain Types & Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const BUSINESS_MODELS = [
  'B2B',
  'B2C',
  'B2B2C',
  'marketplace',
  'creator',
  'nonprofit',
  'local_service',
  'ecommerce',
  'saas',
  'professional_services',
  'education',
  'media',
  'healthcare',
  'finance',
  'hospitality',
  'other',
] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

export const MARKETING_OBJECTIVES = [
  'awareness',
  'education',
  'engagement',
  'lead_generation',
  'sales',
  'retention',
  'hiring',
  'community',
  'launches',
  'thought_leadership',
] as const;
export type MarketingObjective = (typeof MARKETING_OBJECTIVES)[number];

export const RISK_CATEGORIES = [
  'standard',
  'healthcare',
  'finance',
  'legal',
  'employment',
  'age_restricted',
  'children_sensitive',
  'custom',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const CREATIVE_MODES = ['strict_brand', 'brand_inspired', 'creative_freedom'] as const;
export type CreativeMode = (typeof CREATIVE_MODES)[number];

export const LOGO_POLICIES = ['always', 'contextual', 'never'] as const;
export type LogoPolicy = (typeof LOGO_POLICIES)[number];

export const TEXT_IN_IMAGE_POLICIES = ['avoid', 'minimal', 'allowed'] as const;
export type TextInImagePolicy = (typeof TEXT_IN_IMAGE_POLICIES)[number];

export const REFERENCE_FIDELITIES = ['strict', 'balanced', 'exploratory'] as const;
export type ReferenceFidelity = (typeof REFERENCE_FIDELITIES)[number];

export const MEDIA_SOURCE_MODES = ['ai_generated', 'real_screenshot', 'real_photography', 'hybrid'] as const;
export type MediaSourceMode = (typeof MEDIA_SOURCE_MODES)[number];

export const WORKFLOW_TYPES = [
  'branded_social_graphic',
  'short_form_video',
  'carousel',
  'product_demo',
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

export const CONTENT_FORMATS = [
  'static_graphic',
  'carousel',
  'short_video',
  'product_demo',
  'text_post',
  'story',
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const LIFECYCLE_STATES = [
  'idea',
  'brief_ready',
  'planned',
  'generating',
  'draft_ready',
  'review_required',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'rejected',
  'needs_changes',
  'generation_failed',
  'publish_failed',
  'cancelled',
  'archived',
] as const;
export type ContentLifecycleState = (typeof LIFECYCLE_STATES)[number];

export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<ContentLifecycleState, readonly ContentLifecycleState[]> = {
  idea: ['brief_ready', 'planned', 'cancelled', 'archived'],
  brief_ready: ['planned', 'generating', 'cancelled', 'archived'],
  planned: ['brief_ready', 'generating', 'cancelled', 'archived'],
  generating: ['draft_ready', 'review_required', 'generation_failed', 'cancelled'],
  generation_failed: ['brief_ready', 'generating', 'cancelled', 'archived'],
  draft_ready: ['review_required', 'approved', 'generating', 'needs_changes', 'cancelled', 'archived'],
  review_required: ['approved', 'needs_changes', 'rejected', 'cancelled'],
  needs_changes: ['brief_ready', 'generating', 'draft_ready', 'review_required', 'cancelled', 'archived'],
  rejected: ['brief_ready', 'archived'],
  approved: ['scheduled', 'publishing', 'needs_changes', 'cancelled', 'archived'],
  scheduled: ['publishing', 'approved', 'scheduled', 'cancelled'],
  publishing: ['published', 'publish_failed'],
  publish_failed: ['scheduled', 'publishing', 'approved', 'cancelled', 'archived'],
  published: ['archived'],
  cancelled: ['brief_ready', 'planned', 'archived'],
  archived: [],
};

export interface AudienceSegment {
  segment: string;
  role: string;
  sophistication: 'beginner' | 'intermediate' | 'expert';
  jobs_to_be_done: string[];
  geography?: string;
}

export interface ProofEvidence {
  id: string;
  type: 'demo' | 'case_study' | 'review' | 'data' | 'customer_story' | 'portfolio';
  summary: string;
  metric_or_claim?: string;
  source_url?: string;
  verified: boolean;
  permission_confirmed?: boolean;
}

export interface ProductionCapacity {
  weekly_hours: number;
  monthly_budget_usd: number;
  monthly_credit_cap: number;
  has_founder_footage: boolean;
  has_product_demos: boolean;
  has_photography: boolean;
  has_customer_permissions: boolean;
  approval_mode: 'mandatory' | 'risk_based' | 'streamlined_evergreen';
  allowed_publisher_roles: Array<'owner' | 'admin' | 'editor'>;
}

export interface NamedScheduleSlot {
  id: string;
  name: string;
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday .. 6 = Saturday
  hour: number;
  minute: number;
  timezone: string;
  channels: string[];
  preferred_format?: ContentFormat;
}

export interface ScheduleConfig {
  timezone: string;
  named_slots: NamedScheduleSlot[];
  blackout_dates: string[]; // YYYY-MM-DD
  holidays: Array<{ date: string; name: string }>;
  publishing_windows?: Record<string, { start_hour: number; end_hour: number }>;
}

export interface RiskProfileConfig {
  category: RiskCategory;
  jurisdiction?: string;
  required_disclosures: string[];
  prohibited_claims: string[];
  reviewer_role: 'owner' | 'admin' | 'legal_reviewer';
  require_human_review_always?: boolean;
}

export interface BusinessProfileRecord {
  id: string;
  tenant_id: string;
  org_id: string | null;
  project_id: string | null;
  owner_user_id: string;
  business_name: string;
  website_url: string;
  industry: string;
  niche: string;
  business_model: BusinessModel;
  primary_offer: string;
  price_range: string;
  geography: string[];
  languages: string[];
  audiences: AudienceSegment[];
  funnel_stage: string;
  primary_objective: MarketingObjective;
  secondary_objectives: MarketingObjective[];
  success_metric: string;
  sales_cycle: string;
  conversion_path: string;
  available_proof: ProofEvidence[];
  capacity: ProductionCapacity;
  channels: {
    connected: string[];
    preferred: string[];
    preferred_formats: ContentFormat[];
    desired_cadence: 'minimum_viable' | 'balanced_growth' | 'high_output_campaign' | 'custom' | 'recommend';
    custom_posts_per_week?: number;
  };
  risk_profile: RiskProfileConfig;
  schedule_config: ScheduleConfig;
  onboarding_step: number;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrandTokenRecord {
  id: string;
  brand_profile_id: string;
  tenant_id: string;
  name: string;
  value: any;
  category: 'color' | 'typography' | 'shape' | 'logo' | 'imagery' | 'voice' | 'motion' | 'claim';
  sub_type: string;
  source_url: string | null;
  source_type: 'observed' | 'inferred' | 'customer_entered' | 'imported';
  confidence: number;
  rights_confirmed: boolean;
  approval_status: 'candidate' | 'approved' | 'ignored';
  version: number;
  notes: string;
  allowed_contexts: string[];
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandAssetRecord {
  id: string;
  brand_profile_id: string;
  tenant_id: string;
  asset_type: 'logo' | 'font' | 'product_screenshot' | 'product_photo' | 'founder_footage' | 'style_reference' | 'video_capture';
  name: string;
  url: string;
  mime_type: string;
  variant: string;
  rights_confirmed: boolean;
  consented_likeness: boolean;
  usage_rules: Record<string, any>;
  approval_status: 'needs_review' | 'approved' | 'rejected';
  uploaded_by: string;
  created_at: string;
}

export interface BrandProfileRecord {
  id: string;
  tenant_id: string;
  org_id: string | null;
  project_id: string | null;
  owner_user_id: string;
  brand_name: string;
  current_version: number;
  source: {
    website_url?: string;
    scanned_at?: string;
    pages_scanned?: string[];
    approval_status: 'needs_review' | 'approved';
  };
  identity: {
    industry: string;
    niche: string;
    positioning: string;
    audience: string[];
    value_proposition: string;
    differentiators: string[];
    approved_claims: string[];
    prohibited_claims: string[];
  };
  visual: {
    colors: Array<{ name: string; hex: string; role: 'primary' | 'secondary' | 'accent' | 'background' | 'surface' | 'text' | 'border' | 'semantic_status' }>;
    retired_colors: string[];
    typography: Array<{ family: string; weights: string[]; use: 'display' | 'body' | 'mono' | 'caption'; fallback: string; licensed_asset?: boolean }>;
    logos: Array<{ variant: string; url: string; min_size_px?: number; clear_space?: string; allowed_backgrounds?: string[]; do_not_distort?: boolean }>;
    imagery: {
      style: string[];
      preferred_subjects: string[];
      avoid: string[];
    };
    layout_rules: string[];
    shape_and_spacing: Record<string, any>;
    shadows: string[];
    iconography: Record<string, any>;
    motion: Record<string, any>;
    social_templates: string[];
  };
  voice: {
    attributes: string[];
    writing_rules: string[];
    preferred_terms: string[];
    avoid_terms: string[];
    example_copy: string[];
  };
  content_rules: {
    logo_policy_default: LogoPolicy;
    disclosure_requirements: string[];
    accessibility_requirements: string[];
    factuality_rules: string[];
    industry_review_rules: string[];
  };
  approval_status: 'needs_review' | 'approved';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StrategyPillar {
  id: string;
  name: string;
  purpose: string;
  objective: MarketingObjective;
  target_audience: string;
  formats: ContentFormat[];
  allocation_pct: number;
  example_angles: string[];
}

export interface StrategyChannelPlan {
  channel: string;
  role: string;
  priority: 'primary' | 'secondary' | 'experimental';
  posts_per_week: number;
  formats: ContentFormat[];
  platform_media_types: Array<'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY'>;
  destination_url?: string;
}

export interface StrategyAssumption {
  key: string;
  assumption: string;
  inferred: boolean;
  confidence: number;
  confirmed: boolean;
}

export interface StrategyFollowUpQuestion {
  id: string;
  question: string;
  why_it_matters: string;
  field_key: string;
  suggested_options: string[];
}

export interface ContentStrategyRecord {
  id: string;
  tenant_id: string;
  org_id: string | null;
  project_id: string | null;
  owner_user_id: string;
  name: string;
  current_version: number;
  status: 'proposed' | 'approved' | 'paused' | 'rejected' | 'superseded' | 'archived';
  objective: {
    primary: MarketingObjective;
    secondary: MarketingObjective[];
    success_metric: string;
  };
  audiences: AudienceSegment[];
  positioning: {
    value_proposition: string;
    differentiators: string[];
    objections_to_address: string[];
    available_proof_summary: string[];
  };
  channels: StrategyChannelPlan[];
  pillars: StrategyPillar[];
  funnel_mix: {
    awareness_pct: number;
    consideration_pct: number;
    conversion_pct: number;
    retention_pct: number;
  };
  cadence: {
    tier: 'minimum_viable' | 'balanced_growth' | 'high_output_campaign' | 'custom';
    total_posts_per_week: number;
    estimated_weekly_hours: number;
    estimated_weekly_credits: number;
    estimated_weekly_provider_usd: number;
    capacity_warning?: string | null;
    was_downscaled_for_capacity: boolean;
  };
  campaigns: Array<{ name: string; type: 'launch' | 'seasonal' | 'evergreen' | 'event' | 'offer'; active: boolean }>;
  cta_policy: Record<string, string>;
  proof_policy: {
    allowed_evidence_types: string[];
    prohibited_claims: string[];
    require_source_for_numbers: boolean;
  };
  risk_policy: RiskProfileConfig;
  measurement: {
    primary_kpis: string[];
    secondary_kpis: string[];
    attribution_notes: string;
    review_cadence: 'weekly' | 'biweekly' | 'monthly';
  };
  assumptions: StrategyAssumption[];
  follow_up_questions: StrategyFollowUpQuestion[];
  rationale: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreativeControls {
  logo_policy: LogoPolicy;
  text_in_image: TextInImagePolicy;
  reference_fidelity: ReferenceFidelity;
  media_source_mode: MediaSourceMode;
  tone_override?: string;
  humour_level: 'none' | 'subtle' | 'playful';
  motion_intensity: 'none' | 'subtle' | 'moderate' | 'cinematic';
  talent_likeness_asset_id?: string | null;
  talent_consented?: boolean;
  background_complexity: 'clean_solid' | 'minimal_studio' | 'contextual' | 'rich_editorial';
  confirmation_threshold_usd: number;
  user_confirmed_spend?: boolean;
}

export interface CreativeBriefRecord {
  id: string;
  content_item_id: string;
  tenant_id: string;
  objective: MarketingObjective;
  target_audience: string;
  channel: string;
  placement: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY';
  aspect_ratio: '1:1' | '4:5' | '9:16' | '16:9' | '3:4';
  safe_areas: { top_px: number; bottom_px: number; left_px: number; right_px: number };
  hook_message: string;
  intended_takeaway: string;
  cta: string;
  destination_url: string;
  brand_profile_id: string | null;
  brand_version: number;
  creative_mode: CreativeMode;
  controls: CreativeControls;
  reference_asset_ids: string[];
  permitted_claims: string[];
  evidence_refs: Array<{ claim: string; proof_id?: string; source?: string }>;
  selected_provider: string;
  selected_model: string;
  estimated_provider_cost_usd: number;
  estimated_credits: number;
  spend_limit_usd: number;
  credit_ceiling: number;
  max_attempts: number;
  review_criteria: string[];
  created_at: string;
  updated_at: string;
}

export interface ValidationIssue {
  gate: 'brand_compliance' | 'factual_integrity' | 'industry_risk' | 'accessibility' | 'platform_format';
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  remediation: string;
}

export interface ValidationReport {
  passed: boolean;
  outcome?: 'pass' | 'warning' | 'fail';
  score: number;
  requires_human_review: boolean;
  escalation_reasons: string[];
  issues: ValidationIssue[];
  contrast_ratio?: number;
  checked_at: string;
}

export interface CarouselSlideSpec {
  slide_number: number;
  heading: string;
  body: string;
  visual_prompt?: string;
  background_url?: string;
  rendered_url?: string;
  alt_text: string;
  source_note?: string;
}

export interface VideoStoryboardScene {
  scene_number: number;
  duration_sec: number;
  visual_description: string;
  camera_motion: string;
  voiceover: string;
  caption_text: string;
  source_type: 'real_screen_recording' | 'customer_footage' | 'founder_footage' | 'licensed_stock' | 'ai_generated';
  asset_url?: string;
  status?: 'pending' | 'draft_ready' | 'passed' | 'failed';
  evaluation_notes?: string;
}

export interface ContentItemRecord {
  id: string;
  tenant_id: string;
  org_id: string | null;
  project_id: string | null;
  owner_user_id: string;
  strategy_id: string | null;
  strategy_version: number | null;
  brand_profile_id: string | null;
  brand_version: number | null;
  campaign_id?: string | null;
  campaign_name: string;
  content_hash?: string;
  approved_content_hash?: string | null;
  approved_destination?: string | null;
  execution_mode?: 'live_provider' | 'sandbox_fallback';
  pillar_id: string;
  pillar_name: string;
  funnel_stage: string;
  title: string;
  hook: string;
  caption: string;
  channel_variants: Record<string, { caption: string; hashtags: string[]; media_type: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY' }>;
  format: ContentFormat;
  workflow_type: WorkflowType;
  target_channels: string[];
  lifecycle_state: ContentLifecycleState;
  approval_required: boolean;
  risk_flags: string[];
  validation_report: ValidationReport | Record<string, any>;
  media_assets: Array<{ url: string; type: 'image' | 'video'; alt_text?: string; width?: number; height?: number; provenance?: string }>;
  deterministic_overlay: Record<string, any>;
  slides: CarouselSlideSpec[];
  storyboard: VideoStoryboardScene[];
  alt_text: string;
  disclosures: string[];
  scheduled_slot: { slot_id?: string; slot_name?: string; scheduled_at: string; timezone: string } | null;
  linked_blog_post_id: string | null;
  version: number;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNodeExecution {
  node_id: string;
  node_name: string;
  status: 'completed' | 'failed' | 'skipped';
  provider?: string;
  model?: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  provider_cost_usd: number;
  credits_used: number;
  duration_ms: number;
  error?: string;
}

export interface WorkflowRunRecord {
  id: string;
  tenant_id: string;
  content_item_id: string;
  workflow_type: WorkflowType;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  parameters: Record<string, any>;
  node_executions: WorkflowNodeExecution[];
  estimated_provider_cost_usd: number;
  actual_provider_cost_usd: number;
  estimated_credits: number;
  actual_credits: number;
  attempt_number: number;
  failure_reason: string | null;
  provenance: Record<string, any>;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface PublicationRecord {
  id: string;
  tenant_id: string;
  content_item_id: string;
  channel: string;
  social_account_id: string | null;
  platform_media_type: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY';
  slot_name: string;
  timezone: string;
  scheduled_at: string | null;
  status: 'pending' | 'scheduled' | 'publishing' | 'published' | 'publish_failed' | 'cancelled';
  remote_post_id: string | null;
  error_message: string | null;
  retryable: boolean;
  reconcile_required?: boolean;
  approved_revision_hash?: string | null;
  provider_response?: Record<string, any> | null;
  paused?: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationAttemptRecord {
  id: string;
  tenant_id: string;
  publication_id: string;
  idempotency_key: string;
  attempt_number: number;
  status: 'succeeded' | 'failed_retryable' | 'failed_permanent' | 'deduplicated';
  request_meta: Record<string, any>;
  response_meta: Record<string, any>;
  error_message: string | null;
  retryable: boolean;
  next_retry_at: string | null;
  created_at: string;
}

// ── Zod Validation Schemas for API Boundaries ────────────────────────────────

export const BusinessProfileInputSchema = z.object({
  business_name: z.string().max(160).optional(),
  website_url: z.string().max(300).optional(),
  industry: z.string().max(120).optional(),
  niche: z.string().max(160).optional(),
  business_model: z.enum(BUSINESS_MODELS).optional(),
  primary_offer: z.string().max(400).optional(),
  price_range: z.string().max(120).optional(),
  geography: z.array(z.string().max(80)).max(20).optional(),
  languages: z.array(z.string().max(20)).max(10).optional(),
  audiences: z.array(z.object({
    segment: z.string().max(120),
    role: z.string().max(120).default('Decision Maker'),
    sophistication: z.enum(['beginner', 'intermediate', 'expert']).default('intermediate'),
    jobs_to_be_done: z.array(z.string().max(200)).max(8).default([]),
    geography: z.string().max(80).optional(),
  })).max(8).optional(),
  funnel_stage: z.string().max(60).optional(),
  primary_objective: z.enum(MARKETING_OBJECTIVES).optional(),
  secondary_objectives: z.array(z.enum(MARKETING_OBJECTIVES)).max(5).optional(),
  success_metric: z.string().max(200).optional(),
  sales_cycle: z.string().max(80).optional(),
  conversion_path: z.string().max(300).optional(),
  available_proof: z.array(z.object({
    id: z.string().max(80).default(() => `proof_${Math.random().toString(36).slice(2, 9)}`),
    type: z.enum(['demo', 'case_study', 'review', 'data', 'customer_story', 'portfolio']),
    summary: z.string().max(400),
    metric_or_claim: z.string().max(240).optional(),
    source_url: z.string().max(400).optional(),
    verified: z.boolean().default(true),
    permission_confirmed: z.boolean().optional(),
  })).max(30).optional(),
  capacity: z.object({
    weekly_hours: z.number().min(0.5).max(168).default(4),
    monthly_budget_usd: z.number().min(0).max(100000).default(50),
    monthly_credit_cap: z.number().int().min(0).max(1000000).default(1000),
    has_founder_footage: z.boolean().default(false),
    has_product_demos: z.boolean().default(false),
    has_photography: z.boolean().default(false),
    has_customer_permissions: z.boolean().default(false),
    approval_mode: z.enum(['mandatory', 'risk_based', 'streamlined_evergreen']).default('mandatory'),
    allowed_publisher_roles: z.array(z.enum(['owner', 'admin', 'editor'])).default(['owner', 'admin']),
  }).partial().optional(),
  channels: z.object({
    connected: z.array(z.string().max(40)).optional(),
    preferred: z.array(z.string().max(40)).optional(),
    preferred_formats: z.array(z.enum(CONTENT_FORMATS)).optional(),
    desired_cadence: z.enum(['minimum_viable', 'balanced_growth', 'high_output_campaign', 'custom', 'recommend']).optional(),
    custom_posts_per_week: z.number().int().min(1).max(28).optional(),
  }).optional(),
  risk_profile: z.object({
    category: z.enum(RISK_CATEGORIES).default('standard'),
    jurisdiction: z.string().max(80).optional(),
    required_disclosures: z.array(z.string().max(240)).max(15).default([]),
    prohibited_claims: z.array(z.string().max(240)).max(25).default([]),
    reviewer_role: z.enum(['owner', 'admin', 'legal_reviewer']).default('owner'),
    require_human_review_always: z.boolean().optional(),
  }).partial().optional(),
  schedule_config: z.any().optional(),
  onboarding_step: z.number().int().min(1).max(6).optional(),
  onboarding_completed: z.boolean().optional(),
});

// ── Tenant-Scoped DakyXTech Pilot Configuration (Opt-In Only, Never Global Default) ──

export function buildDakyXTechPilotSeed(tenantId: string, ownerUserId: string, orgId: string | null = null, projectId: string | null = null) {
  const now = new Date().toISOString();
  const business: Partial<BusinessProfileRecord> = {
    tenant_id: tenantId,
    org_id: orgId,
    project_id: projectId,
    owner_user_id: ownerUserId,
    business_name: 'DakyXTech',
    website_url: 'https://dakyx.com',
    industry: 'SaaS & Software Engineering',
    niche: 'Software, websites, business automation, and digital products/services',
    business_model: 'B2B',
    primary_offer: 'Custom software systems, high-converting web platforms, and AI-assisted workflow automation',
    price_range: 'Project & SaaS subscription tiers',
    geography: ['Global', 'Ghana', 'North America', 'Europe'],
    languages: ['en'],
    audiences: [
      {
        segment: 'Founders & Operators',
        role: 'Founder / Managing Director',
        sophistication: 'intermediate',
        jobs_to_be_done: ['Automate manual operational bottlenecks', 'Launch credible web and software systems quickly'],
      },
      {
        segment: 'Growth & Marketing Teams',
        role: 'Head of Growth / Agency Lead',
        sophistication: 'expert',
        jobs_to_be_done: ['Scale consistent brand execution across channels without fabricating claims'],
      },
    ],
    funnel_stage: 'full_funnel',
    primary_objective: 'lead_generation',
    secondary_objectives: ['awareness', 'education'],
    success_metric: 'Qualified DMs, profile actions, saves/shares on educational posts, and demo enquiries',
    sales_cycle: '2-6 weeks consultative + self-serve digital products',
    conversion_path: 'Educational Reel / Carousel / Real Product Demo -> Profile / Link -> Discovery or Trial',
    available_proof: [
      {
        id: 'proof_dakyx_demo_1',
        type: 'demo',
        summary: 'Real screen captures of the Dakyworld Contentflow OS multi-channel workspace and automation builder',
        verified: true,
        permission_confirmed: true,
      },
    ],
    capacity: {
      weekly_hours: 6,
      monthly_budget_usd: 75,
      monthly_credit_cap: 1500,
      has_founder_footage: true,
      has_product_demos: true,
      has_photography: false,
      has_customer_permissions: false,
      approval_mode: 'mandatory',
      allowed_publisher_roles: ['owner', 'admin'],
    },
    channels: {
      connected: ['instagram'],
      preferred: ['instagram', 'linkedin'],
      preferred_formats: ['product_demo', 'carousel', 'short_video', 'static_graphic'],
      desired_cadence: 'balanced_growth',
    },
    risk_profile: {
      category: 'standard',
      required_disclosures: [],
      prohibited_claims: [
        'Invented customer testimonials or star ratings',
        'Unverified customer counts or revenue/ROI multipliers',
        'Fabricated UI screens not present in the shipped product',
      ],
      reviewer_role: 'owner',
      require_human_review_always: true,
    },
  };

  const brand: Omit<BrandProfileRecord, 'id' | 'created_at' | 'updated_at'> = {
    tenant_id: tenantId,
    org_id: orgId,
    project_id: projectId,
    owner_user_id: ownerUserId,
    brand_name: 'DakyXTech',
    current_version: 1,
    source: {
      website_url: 'https://dakyx.com',
      scanned_at: now,
      pages_scanned: ['uploaded_design_system_reference'],
      approval_status: 'needs_review',
    },
    identity: {
      industry: 'SaaS & Software Engineering',
      niche: 'Software, websites, automation, and digital products/services',
      positioning: 'Restrained, engineering-grade software and automation partner built on clarity and verifiable execution.',
      audience: ['Founders & Operators', 'Technical & Growth Leaders'],
      value_proposition: 'Ship reliable websites, software, and workflow automation with calm precision.',
      differentiators: [
        'Restrained corporate design language with high legibility',
        'Real product demonstrations over hype',
        'End-to-end automation and software craftsmanship',
      ],
      approved_claims: [
        'Builds custom software, websites, and workflow automation systems',
        'Supports multi-channel content planning, approval gating, and scheduling in Contentflow',
      ],
      prohibited_claims: [
        'Guaranteed viral reach, leads, or revenue',
        'Invented testimonials, ratings, or customer counts',
        'Unsupported performance percentages',
      ],
    },
    visual: {
      colors: [
        { name: 'Navy', hex: '#091833', role: 'primary' },
        { name: 'Ink', hex: '#0D1526', role: 'text' },
        { name: 'Brand Blue', hex: '#2563EB', role: 'accent' },
        { name: 'Canvas Cool Grey', hex: '#ECEEF1', role: 'background' },
        { name: 'White Surface', hex: '#FFFFFF', role: 'surface' },
        { name: 'Muted Slate', hex: '#5B6374', role: 'secondary' },
        { name: 'Hairline Border', hex: '#E3E6EB', role: 'border' },
        { name: 'Positive Semantic', hex: '#2F8F5B', role: 'semantic_status' },
        { name: 'Warning Semantic', hex: '#C8871B', role: 'semantic_status' },
        { name: 'Danger Semantic', hex: '#D33A2C', role: 'semantic_status' },
      ],
      retired_colors: ['lime', '#84CC16', '#A3E635', 'cyan', '#06B6D4', '#22D3EE', 'bronze', '#CD7F32', 'ivory', '#FFFFF0'],
      typography: [
        { family: 'Outfit', weights: ['400', '500', '600'], use: 'display', fallback: 'Inter, system-ui, sans-serif', licensed_asset: true },
        { family: 'Outfit', weights: ['300', '400', '500'], use: 'body', fallback: 'Inter, system-ui, sans-serif', licensed_asset: true },
        { family: 'JetBrains Mono', weights: ['400', '500'], use: 'mono', fallback: 'monospace', licensed_asset: true },
      ],
      logos: [
        {
          variant: 'lockup-on-light',
          url: '/brand/dakyxtech-lockup-on-light.png',
          min_size_px: 96,
          clear_space: '1x mark height',
          allowed_backgrounds: ['#FFFFFF', '#ECEEF1', '#F6F7F9'],
          do_not_distort: true,
        },
        {
          variant: 'lockup-on-dark',
          url: '/brand/dakyxtech-lockup-on-dark.png',
          min_size_px: 96,
          clear_space: '1x mark height',
          allowed_backgrounds: ['#091833', '#0D1526'],
          do_not_distort: true,
        },
      ],
      imagery: {
        style: ['Restrained corporate clarity', 'Genuine software UI captures', 'Clean architectural lighting'],
        preferred_subjects: ['Real product workflows', 'Clear diagrams and typographic slides', 'Authentic founder/team moments'],
        avoid: ['Neon cyberpunk clutter', 'Recreated or warped wordmarks', 'Retired lime/cyan/bronze/ivory accents', 'Synthetic fake testimonials'],
      },
      layout_rules: [
        'Blue (#2563EB) is the sole brand accent; status colors are strictly for semantic states',
        'Generous whitespace, hairline 1px borders (#E3E6EB), restrained elevation, controlled corner radii (10px-22px)',
        'Render exact headlines and approved logo masters deterministically rather than via generative pixels',
      ],
      shape_and_spacing: { card_radius_px: 16, panel_radius_px: 22, button_radius_px: 10, border_width_px: 1 },
      shadows: ['none (hairline border preferred)'],
      iconography: { style: '1.75px clean geometric strokes' },
      motion: { easing: 'cubic-bezier(0.22, 1, 0.36, 1)', duration_ms: '180-320ms', respect_reduced_motion: true },
      social_templates: ['educational_carousel', 'real_product_demo_frame', 'technical_explainer_card'],
    },
    voice: {
      attributes: ['Clear', 'Direct', 'Calmly authoritative', 'Practical', 'Evidence-led'],
      writing_rules: [
        'Lead with concrete operational problems and verifiable outcomes',
        'Never invent metrics, testimonials, customer logos, or product screens',
        'Avoid hype clichés and guaranteed growth claims',
      ],
      preferred_terms: ['workflow', 'system', 'reliable', 'verified', 'automation', 'deterministic'],
      avoid_terms: ['guaranteed viral', '10x overnight', 'magic', 'secret hack'],
      example_copy: [
        'Manual handoffs break when volume doubles. Here is how a single validated webhook and approval gate keeps publishing predictable.',
      ],
    },
    content_rules: {
      logo_policy_default: 'contextual',
      disclosure_requirements: [],
      accessibility_requirements: ['Minimum 4.5:1 text contrast', 'Subtitles on all spoken video clips', 'Descriptive alt text on graphics and carousels'],
      factuality_rules: [
        'Every demonstrated software capability must exist in the shipped product',
        'No fabricated testimonials, star ratings, customer counts, or performance claims',
      ],
      industry_review_rules: ['Manual operator approval required before scheduling or publication'],
    },
    approval_status: 'needs_review',
    approved_by: null,
    approved_at: null,
  };

  return { business, brand };
}
