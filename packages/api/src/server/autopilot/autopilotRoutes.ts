import { getTenantControls, upsertTenantControls, getTenantUsageLedger } from './billingAndBudgetService.ts';
import { getAutopilotProviderStatus } from './autopilotProviderBridge.ts';
import { Router, type Response } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import type { Pool } from 'pg';
import type { Request } from '../../types/http.ts';
import { createAutopilotRepository, type AutopilotRepository } from './repository.ts';
import { resolveAutopilotTenant, type TenantRole } from './tenantContext.ts';
import { scanWebsiteForBrandCandidates, type WebsiteFetchFn } from './websiteBrandExtractor.ts';
import {
  detectMissingHighImpactQuestions,
  generateAdaptiveStrategy,
  generateContentCalendarBatch,
} from './strategyEngine.ts';
import {
  createCreativeBriefForItem,
  estimateGenerationCost,
  getModelCapabilityRegistry,
  refreshModelRegistryOverrides,
  routeModelForBrief,
} from './creativeBriefAndRouter.ts';
import { validateAutopilotContentItem } from './validationAndPolicyService.ts';
import {
  AutopilotWorkflowError,
  executeAutopilotWorkflow,
  type VisualProviderAdapterInput,
  type VisualProviderAdapterResult,
} from './workflowOrchestrator.ts';
import {
  AutopilotLifecycleError,
  executePublication,
  scheduleApprovedContentItem,
  transitionContentItemState,
  pausePublication,
  resumePublication,
  reschedulePublication,
  type SocialPublisherInput,
  type SocialPublisherResult,
} from './lifecycleAndPublishingService.ts';
import {
  buildAnalyticsSummary,
  decideStrategyRecommendation,
  evaluateExperimentOutcome,
  generateStrategyRecommendations,
} from './analyticsAndInsightsService.ts';
import {
  BusinessProfileInputSchema,
  CREATIVE_MODES,
  WORKFLOW_TYPES,
  buildDakyXTechPilotSeed,
  type ContentFormat,
  type ContentItemRecord,
  type CreativeMode,
  type WorkflowType,
} from './types.ts';

export interface AutopilotRoutesDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role?: string } | null;
  requireAdmin?: (req: Request, res: Response) => Promise<{ userId: string } | null> | { userId: string } | null;
  pool: Pick<Pool, 'query'>;
  hasDatabase: () => boolean;
  publishToplatform?: (
    userId: string,
    post: Record<string, any>,
    platform: string,
    options?: {
      template?: string;
      destination?: any;
      mediaType?: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY';
      mediaAssets?: Array<{ url: string; type?: 'image' | 'video'; alt_text?: string }>;
      captionOverride?: string;
    },
  ) => Promise<{ status: string; platformPostId?: string; error?: string; retryable?: boolean }>;
  createNotification?: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<any>;
  websiteFetcher?: WebsiteFetchFn;
  visualAdapter?: (input: VisualProviderAdapterInput) => Promise<VisualProviderAdapterResult>;
  copyAdapter?: (prompt: string, systemPrompt?: string) => Promise<string>;
  publisherAdapter?: (input: SocialPublisherInput) => Promise<SocialPublisherResult>;
  repo?: AutopilotRepository;
}

export function registerAutopilotRoutes(deps: AutopilotRoutesDeps) {
  const router = Router();
  const repo = deps.repo ?? createAutopilotRepository({ pool: deps.pool, hasDatabase: deps.hasDatabase });

  const defaultPublisherAdapter = async (input: SocialPublisherInput): Promise<SocialPublisherResult> => {
    if (deps.publisherAdapter) {
      return deps.publisherAdapter(input);
    }
    if (!deps.publishToplatform) {
      const err: any = new Error(`No social publishing connector configured for channel "${input.channel}". Connect the account in Integrations first.`);
      err.status = 400;
      throw err;
    }

    const coverImage = input.mediaAssets.find((m) => m.type === 'image')?.url ?? null;
    const videoUrl = input.mediaAssets.find((m) => m.type === 'video')?.url ?? null;

    const res = await deps.publishToplatform(
      input.userId,
      {
        id: input.idempotencyKey,
        title: input.title,
        excerpt: input.caption.slice(0, 260),
        content: input.caption,
        featured_image: coverImage,
        video_url: videoUrl,
        media_assets: input.mediaAssets,
        post_format: input.platformMediaType,
        approval_status: 'approved',
        status: 'published',
      },
      input.channel,
      {
        mediaType: input.platformMediaType,
        mediaAssets: input.mediaAssets,
        captionOverride: input.caption,
      },
    );

    if (res.status !== 'published') {
      const err: any = new Error(res.error || `Failed to publish to ${input.channel}`);
      err.status = res.retryable ? 503 : 400;
      throw err;
    }

    return {
      remotePostId: res.platformPostId || `remote_${randomUUID().slice(0, 8)}`,
    };
  };

  const guardTenant = (req: Request, res: Response, minRole: TenantRole = 'viewer') =>
    resolveAutopilotTenant(req, res, deps.requireAuth, deps.pool, deps.hasDatabase, minRole);

  // ── 0. Prefill Context & Overview Bootstrap ─────────────────────────────────
  router.get('/autopilot/overview', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'viewer');
      if (!tenant) return;

      const [business, brand, strategy, items, publications, recommendations] = await Promise.all([
        repo.getBusinessProfile(tenant.tenantId),
        repo.getBrandProfile(tenant.tenantId),
        repo.getLatestStrategy(tenant.tenantId),
        repo.listContentItems(tenant.tenantId),
        repo.listPublications(tenant.tenantId),
        repo.listRecommendations(tenant.tenantId),
      ]);

      return res.json({
        success: true,
        tenant: {
          tenantId: tenant.tenantId,
          orgId: tenant.orgId,
          projectId: tenant.projectId,
          role: tenant.userRole,
          canEdit: tenant.canEdit,
          canApprove: tenant.canApprove,
          canPublish: tenant.canPublish,
        },
        business,
        brand,
        strategy,
        counts: {
          total_items: items.length,
          planned: items.filter((i) => i.lifecycle_state === 'planned' || i.lifecycle_state === 'brief_ready').length,
          review_required: items.filter((i) => i.lifecycle_state === 'review_required').length,
          approved: items.filter((i) => i.lifecycle_state === 'approved').length,
          scheduled: items.filter((i) => i.lifecycle_state === 'scheduled').length,
          published: items.filter((i) => i.lifecycle_state === 'published').length,
          publish_failed: publications.filter((p) => p.status === 'publish_failed').length,
          pending_recommendations: recommendations.filter((r) => r.status === 'pending').length,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to load autopilot overview' });
    }
  });

  router.get('/autopilot/prefill-context', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'viewer');
      if (!tenant) return;

      const prefill: Record<string, any> = {
        connected_channels: [],
        legacy_brand: null,
        memories: [],
      };

      if (deps.hasDatabase()) {
        try {
          const sa = await deps.pool.query(
            `SELECT DISTINCT LOWER(platform) AS platform FROM social_accounts WHERE user_id = $1 AND connected = true`,
            [tenant.userId],
          );
          prefill.connected_channels = sa.rows.map((r: any) => r.platform).filter(Boolean);
        } catch { /* optional table */ }

        try {
          const bp = await deps.pool.query(
            `SELECT name, tagline, industry, tone_voice, target_audience, colors, fonts, website_url
             FROM brand_profiles WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
            [tenant.userId],
          );
          if (bp.rows[0]) prefill.legacy_brand = bp.rows[0];
        } catch { /* optional table */ }
      }

      return res.json({ success: true, prefill });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to load prefill context' });
    }
  });

  // ── 1. Business Profile & Tenant-Scoped DakyXTech Pilot Opt-In ──────────────
  router.get('/autopilot/business-profile', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const profile = await repo.getBusinessProfile(tenant.tenantId);
    const followUpQuestions = profile ? detectMissingHighImpactQuestions(profile) : [];
    return res.json({ success: true, profile, follow_up_questions: followUpQuestions });
  });

  router.put('/autopilot/business-profile', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const parsed = BusinessProfileInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid business profile input',
        issues: parsed.error.issues,
      });
    }

    const saved = await repo.upsertBusinessProfile(
      tenant.tenantId,
      tenant.userId,
      tenant.orgId,
      tenant.projectId,
      parsed.data as any,
    );
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'business_profile.updated', 'business_profile', saved.id, {
      industry: saved.industry,
      niche: saved.niche,
      primary_objective: saved.primary_objective,
    });

    return res.json({
      success: true,
      profile: saved,
      follow_up_questions: detectMissingHighImpactQuestions(saved),
    });
  });

  // Opt-in DakyXTech Pilot Seed (Strictly tenant-scoped, NEVER global default — Section 18)
  router.post('/autopilot/pilot/dakyxtech', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const seed = buildDakyXTechPilotSeed(tenant.tenantId, tenant.userId, tenant.orgId, tenant.projectId);
    const business = await repo.upsertBusinessProfile(
      tenant.tenantId,
      tenant.userId,
      tenant.orgId,
      tenant.projectId,
      { ...seed.business, onboarding_step: 5, onboarding_completed: true },
    );
    const brand = await repo.upsertBrandProfile(
      tenant.tenantId,
      tenant.userId,
      tenant.orgId,
      tenant.projectId,
      seed.brand,
      tenant.userId,
      'Loaded tenant-scoped DakyXTech pilot configuration (pending operator review)',
      true,
    );
    const strategy = generateAdaptiveStrategy(business, brand, 0);
    strategy.channels = [
      {
        channel: 'instagram',
        role: 'Primary lead-generation & educational proof channel',
        priority: 'primary',
        posts_per_week: 4,
        formats: ['product_demo', 'carousel', 'short_video', 'static_graphic'],
        platform_media_types: ['REEL', 'CAROUSEL', 'FEED_POST', 'STORY'],
        destination_url: 'https://dakyx.com',
      },
    ];
    strategy.cadence.total_posts_per_week = 4;
    await repo.saveStrategy(strategy, tenant.userId, 'DakyXTech 4-post/week Instagram pilot proposal');

    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'pilot.dakyxtech_loaded', 'business_profile', business.id, {
      tenant_id: tenant.tenantId,
    });

    return res.json({ success: true, business, brand, strategy });
  });

  // ── 2. Brand Studio: Safe Website Scanner, Profile, Tokens & Assets ─────────
  router.post('/autopilot/brand/scan-website', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;

      const rawUrl = String(req.body?.url || req.body?.website_url || '').trim();
      if (!rawUrl) {
        return res.status(400).json({ success: false, error: 'Website URL is required' });
      }

      const scan = await scanWebsiteForBrandCandidates(rawUrl, deps.websiteFetcher);

      // Ensure a draft BrandProfile exists (always `needs_review` until customer approves!)
      const existingBrand = await repo.getBrandProfile(tenant.tenantId);
      const brandProfile = await repo.upsertBrandProfile(
        tenant.tenantId,
        tenant.userId,
        tenant.orgId,
        tenant.projectId,
        {
          brand_name: existingBrand?.brand_name || scan.inferred_brand_name || 'Workspace Brand',
          source: {
            website_url: scan.website_url,
            scanned_at: scan.scanned_at,
            pages_scanned: scan.pages_scanned,
            approval_status: 'needs_review',
          },
          identity: {
            ...(existingBrand?.identity ?? {
              industry: '',
              niche: '',
              positioning: '',
              audience: [],
              value_proposition: '',
              differentiators: [],
              approved_claims: [],
              prohibited_claims: [],
            }),
            value_proposition: existingBrand?.identity?.value_proposition || scan.inferred_description,
          },
          approval_status: existingBrand?.approval_status === 'approved' ? 'approved' : 'needs_review',
        },
        tenant.userId,
        `Scanned public website ${scan.website_url} for candidate brand tokens`,
        false,
      );

      const savedTokens = scan.candidate_tokens.length
        ? await repo.saveBrandTokens(tenant.tenantId, brandProfile.id, scan.candidate_tokens)
        : [];

      await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'brand.website_scanned', 'brand_profile', brandProfile.id, {
        website_url: scan.website_url,
        pages_scanned: scan.pages_scanned,
        candidate_count: savedTokens.length,
        warnings: scan.warnings,
      });

      return res.json({
        success: true,
        scan: {
          ...scan,
          candidate_tokens: savedTokens,
        },
        brand: brandProfile,
      });
    } catch (err: any) {
      const msg = String(err?.message || 'Website scan failed');
      const isSsrfOrInput = /ssrf|private|reserved|only http|invalid url/i.test(msg);
      return res.status(isSsrfOrInput ? 400 : 502).json({ success: false, error: msg });
    }
  });

  router.get('/autopilot/brand-profile', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const [brand, tokens, assets, versions] = await Promise.all([
      repo.getBrandProfile(tenant.tenantId),
      repo.listBrandTokens(tenant.tenantId),
      repo.listBrandAssets(tenant.tenantId),
      repo.listBrandVersions(tenant.tenantId),
    ]);
    return res.json({ success: true, brand, tokens, assets, versions });
  });

  router.put('/autopilot/brand-profile', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const rationale = String(req.body?.change_rationale || 'Updated brand system settings').slice(0, 300);
    const bumpVersion = Boolean(req.body?.bump_version ?? true);
    const brand = await repo.upsertBrandProfile(
      tenant.tenantId,
      tenant.userId,
      tenant.orgId,
      tenant.projectId,
      req.body ?? {},
      tenant.userId,
      rationale,
      bumpVersion,
    );
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'brand.updated', 'brand_profile', brand.id, {
      version: brand.current_version,
      rationale,
    });
    return res.json({ success: true, brand });
  });

  router.post('/autopilot/brand-profile/approve', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'admin');
    if (!tenant) return;

    const existing = await repo.getBrandProfile(tenant.tenantId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Create or scan a brand profile first' });
    }

    // Promote approved candidate color/typography/logo tokens into structured BrandProfile visual system
    const tokens = await repo.listBrandTokens(tenant.tenantId);
    const approvedTokenColors = tokens
      .filter((t) => t.category === 'color' && t.approval_status === 'approved' && t.value?.hex)
      .map((t) => ({
        name: t.name,
        hex: String(t.value.hex).toUpperCase(),
        role: (['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'border'].includes(t.sub_type)
          ? t.sub_type
          : 'accent') as any,
      }));

    const existingHexes = new Set(existing.visual.colors.map((c) => c.hex.toUpperCase()));
    const mergedColors = [
      ...existing.visual.colors,
      ...approvedTokenColors.filter((c) => !existingHexes.has(c.hex)),
    ];

    const now = new Date().toISOString();
    const approved = await repo.upsertBrandProfile(
      tenant.tenantId,
      tenant.userId,
      tenant.orgId,
      tenant.projectId,
      {
        visual: {
          ...existing.visual,
          colors: mergedColors,
        },
        source: {
          ...existing.source,
          approval_status: 'approved',
        },
        approval_status: 'approved',
        approved_by: tenant.userId,
        approved_at: now,
      },
      tenant.userId,
      String(req.body?.rationale || 'Customer approved Brand Profile version'),
      true,
    );

    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'brand.approved', 'brand_profile', approved.id, {
      version: approved.current_version,
    });
    return res.json({ success: true, brand: approved });
  });

  router.get('/autopilot/brand-profile/versions', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const versions = await repo.listBrandVersions(tenant.tenantId);
    return res.json({ success: true, versions });
  });

  router.get('/autopilot/brand/tokens', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const tokens = await repo.listBrandTokens(tenant.tenantId);
    return res.json({ success: true, tokens });
  });

  router.post('/autopilot/brand/tokens', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    let brand = await repo.getBrandProfile(tenant.tenantId);
    if (!brand) {
      brand = await repo.upsertBrandProfile(tenant.tenantId, tenant.userId, tenant.orgId, tenant.projectId, { brand_name: 'Workspace Brand' }, tenant.userId);
    }
    const body = req.body ?? {};
    const saved = await repo.saveBrandTokens(tenant.tenantId, brand.id, [
      {
        name: String(body.name || 'Custom Token').slice(0, 120),
        value: body.value ?? {},
        category: body.category || 'color',
        sub_type: String(body.sub_type || 'accent'),
        source_url: null,
        source_type: 'customer_entered',
        confidence: 1,
        rights_confirmed: Boolean(body.rights_confirmed ?? true),
        approval_status: body.approval_status || 'approved',
        version: brand.current_version,
        notes: String(body.notes || ''),
        allowed_contexts: Array.isArray(body.allowed_contexts) ? body.allowed_contexts : ['all'],
        last_verified_at: new Date().toISOString(),
      },
    ]);
    return res.status(201).json({ success: true, token: saved[0] });
  });

  router.patch('/autopilot/brand/tokens/:tokenId', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const updated = await repo.updateBrandToken(tenant.tenantId, req.params.tokenId, {
      name: req.body?.name,
      value: req.body?.value,
      approval_status: req.body?.approval_status,
      notes: req.body?.notes,
      rights_confirmed: req.body?.rights_confirmed,
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Brand token not found in this workspace' });
    }
    return res.json({ success: true, token: updated });
  });

  router.delete('/autopilot/brand/tokens/:tokenId', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const deleted = await repo.deleteBrandToken(tenant.tenantId, req.params.tokenId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Brand token not found or already deleted' });
    }
    return res.json({ success: true, deleted: true });
  });

  router.get('/autopilot/brand/assets', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const assets = await repo.listBrandAssets(tenant.tenantId);
    return res.json({ success: true, assets });
  });

  router.post('/autopilot/brand/assets', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const url = String(req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, error: 'Asset url is required' });
    }
    let brand = await repo.getBrandProfile(tenant.tenantId);
    if (!brand) {
      brand = await repo.upsertBrandProfile(tenant.tenantId, tenant.userId, tenant.orgId, tenant.projectId, { brand_name: 'Workspace Brand' }, tenant.userId);
    }

    const asset = await repo.addBrandAsset(tenant.tenantId, brand.id, {
      asset_type: req.body?.asset_type || 'logo',
      name: String(req.body?.name || 'Brand Asset').slice(0, 140),
      url,
      mime_type: String(req.body?.mime_type || 'image/png'),
      variant: String(req.body?.variant || 'default'),
      rights_confirmed: Boolean(req.body?.rights_confirmed ?? true),
      consented_likeness: Boolean(req.body?.consented_likeness ?? false),
      usage_rules: req.body?.usage_rules && typeof req.body.usage_rules === 'object' ? req.body.usage_rules : {},
      approval_status: req.body?.approval_status || 'approved',
      uploaded_by: tenant.userId,
    });
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'brand.asset_added', 'brand_asset', asset.id, {
      asset_type: asset.asset_type,
      name: asset.name,
    });
    return res.status(201).json({ success: true, asset });
  });

  router.delete('/autopilot/brand/assets/:assetId', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const deleted = await repo.deleteBrandAsset(tenant.tenantId, req.params.assetId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Brand asset not found in this workspace' });
    }
    return res.json({ success: true });
  });

  // ── 3. Adaptive Strategy Engine & Version History ───────────────────────────
  router.post('/autopilot/strategy/generate', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    let business = await repo.getBusinessProfile(tenant.tenantId);
    if (!business) {
      business = await repo.upsertBusinessProfile(tenant.tenantId, tenant.userId, tenant.orgId, tenant.projectId, req.body?.business ?? {});
    }
    const brand = await repo.getBrandProfile(tenant.tenantId);
    const existing = await repo.getLatestStrategy(tenant.tenantId);

    const proposal = generateAdaptiveStrategy(
      business,
      brand,
      existing?.current_version ?? 0,
    );
    await repo.saveStrategy(proposal, tenant.userId, 'Generated adaptive content strategy proposal');
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'strategy.generated', 'strategy', proposal.id, {
      version: proposal.current_version,
      posts_per_week: proposal.cadence.total_posts_per_week,
      was_downscaled: proposal.cadence.was_downscaled_for_capacity,
    });

    return res.status(201).json({ success: true, strategy: proposal });
  });

  router.get('/autopilot/strategy', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const strategy = await repo.getLatestStrategy(tenant.tenantId);
    const versions = strategy ? await repo.listStrategyVersions(tenant.tenantId, strategy.id) : [];
    return res.json({ success: true, strategy, versions });
  });

  router.put('/autopilot/strategy/:id', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const existing = await repo.getStrategyById(tenant.tenantId, req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Strategy not found in this workspace' });
    }

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      ...(req.body ?? {}),
      id: existing.id,
      tenant_id: tenant.tenantId,
      current_version: existing.current_version + 1,
      updated_at: now,
    };
    const rationale = String(req.body?.change_rationale || 'Edited strategy parameters').slice(0, 300);
    await repo.saveStrategy(updated, tenant.userId, rationale);
    return res.json({ success: true, strategy: updated });
  });

  router.post('/autopilot/strategy/:id/approve', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'admin');
    if (!tenant) return;

    const existing = await repo.getStrategyById(tenant.tenantId, req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Strategy not found in this workspace' });
    }

    const now = new Date().toISOString();
    existing.status = 'approved';
    existing.approved_by = tenant.userId;
    existing.approved_at = now;
    existing.updated_at = now;
    existing.assumptions = existing.assumptions.map((a) => ({ ...a, confirmed: true }));

    await repo.saveStrategy(existing, tenant.userId, 'Customer approved content strategy');
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'strategy.approved', 'strategy', existing.id, {
      version: existing.current_version,
    });
    return res.json({ success: true, strategy: existing });
  });

  router.get('/autopilot/strategy/:id/versions', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const versions = await repo.listStrategyVersions(tenant.tenantId, req.params.id);
    return res.json({ success: true, versions });
  });

  // ── 4. Calendar Pilot Batch, Content Items & Creative Briefs ────────────────
  router.post('/autopilot/calendar/generate-batch', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const business = await repo.getBusinessProfile(tenant.tenantId);
    if (!business) {
      return res.status(400).json({ success: false, error: 'Save Business Profile before generating a content batch' });
    }
    const brand = await repo.getBrandProfile(tenant.tenantId);
    let strategy = await repo.getLatestStrategy(tenant.tenantId);
    if (!strategy) {
      strategy = generateAdaptiveStrategy(business, brand);
      await repo.saveStrategy(strategy, tenant.userId, 'Auto-initialized adaptive strategy for pilot batch');
    }

    const batchSize = req.body?.batch_size ? Number(req.body.batch_size) : undefined;
    const campaignName = req.body?.campaign_name ? String(req.body.campaign_name) : undefined;
    const creativeMode: CreativeMode = CREATIVE_MODES.includes(req.body?.creative_mode)
      ? req.body.creative_mode
      : 'brand_inspired';

    const items = generateContentCalendarBatch({
      business,
      brand,
      strategy,
      batchSize,
      campaignName,
      actorUserId: tenant.userId,
    });

    let batchEstimatedUsd = 0;
    let batchEstimatedCredits = 0;
    const savedBriefs = [];

    for (const item of items) {
      await repo.saveContentItem(item);
      const brief = createCreativeBriefForItem({
        item,
        business,
        brand,
        creativeMode,
      });
      await repo.saveCreativeBrief(brief);
      savedBriefs.push(brief);
      batchEstimatedUsd += brief.estimated_provider_cost_usd;
      batchEstimatedCredits += brief.estimated_credits;
    }

    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'calendar.batch_generated', 'strategy', strategy.id, {
      count: items.length,
      estimated_provider_cost_usd: Number(batchEstimatedUsd.toFixed(4)),
      estimated_credits: batchEstimatedCredits,
    });

    return res.status(201).json({
      success: true,
      items,
      briefs: savedBriefs,
      batch_cost_summary: {
        estimated_provider_cost_usd: Number(batchEstimatedUsd.toFixed(4)),
        estimated_internal_credits: batchEstimatedCredits,
      },
    });
  });

  router.get('/autopilot/items', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const items = await repo.listContentItems(tenant.tenantId, state);
    return res.json({ success: true, items });
  });

  router.post('/autopilot/items', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const business = (await repo.getBusinessProfile(tenant.tenantId)) ?? (await repo.upsertBusinessProfile(tenant.tenantId, tenant.userId, tenant.orgId, tenant.projectId, {}));
    const brand = await repo.getBrandProfile(tenant.tenantId);
    const strategy = await repo.getLatestStrategy(tenant.tenantId);

    const body = req.body ?? {};
    const format: ContentFormat = body.format || 'static_graphic';
    const workflowType: WorkflowType = WORKFLOW_TYPES.includes(body.workflow_type)
      ? body.workflow_type
      : format === 'carousel'
        ? 'carousel'
        : format === 'short_video'
          ? 'short_form_video'
          : format === 'product_demo'
            ? 'product_demo'
            : 'branded_social_graphic';

    const now = new Date().toISOString();
    const targetChannels: string[] = Array.isArray(body.target_channels) && body.target_channels.length
      ? body.target_channels
      : business.channels.preferred.length
        ? business.channels.preferred
        : ['instagram'];

    const item: ContentItemRecord = {
      id: randomUUID(),
      tenant_id: tenant.tenantId,
      org_id: tenant.orgId,
      project_id: tenant.projectId,
      owner_user_id: tenant.userId,
      strategy_id: strategy?.id ?? null,
      strategy_version: strategy?.current_version ?? null,
      brand_profile_id: brand?.id ?? null,
      brand_version: brand?.current_version ?? null,
      campaign_name: String(body.campaign_name || 'Custom Content').slice(0, 120),
      pillar_id: String(body.pillar_id || strategy?.pillars?.[0]?.id || 'pillar_custom'),
      pillar_name: String(body.pillar_name || strategy?.pillars?.[0]?.name || 'General'),
      funnel_stage: String(body.funnel_stage || 'consideration'),
      title: String(body.title || 'Untitled Content Piece').slice(0, 160),
      hook: String(body.hook || body.title || ''),
      caption: String(body.caption || body.hook || ''),
      channel_variants: body.channel_variants ?? {},
      format,
      workflow_type: workflowType,
      target_channels: targetChannels,
      lifecycle_state: 'brief_ready',
      approval_required: Boolean(body.approval_required ?? (business.capacity.approval_mode !== 'streamlined_evergreen')),
      risk_flags: [],
      validation_report: {},
      media_assets: Array.isArray(body.media_assets) ? body.media_assets : [],
      deterministic_overlay: {},
      slides: Array.isArray(body.slides) ? body.slides : [],
      storyboard: Array.isArray(body.storyboard) ? body.storyboard : [],
      alt_text: String(body.alt_text || ''),
      disclosures: Array.isArray(body.disclosures) ? body.disclosures : [...(business.risk_profile?.required_disclosures ?? [])],
      scheduled_slot: body.scheduled_slot ?? null,
      linked_blog_post_id: null,
      version: 1,
      created_by: tenant.userId,
      approved_by: null,
      approved_at: null,
      created_at: now,
      updated_at: now,
    };

    await repo.saveContentItem(item);
    const brief = createCreativeBriefForItem({
      item,
      business,
      brand,
      creativeMode: CREATIVE_MODES.includes(body.creative_mode) ? body.creative_mode : 'brand_inspired',
      controlsOverride: body.controls,
      spendLimitUsd: typeof body.spend_limit_usd === 'number' ? body.spend_limit_usd : undefined,
      creditCeiling: typeof body.credit_ceiling === 'number' ? body.credit_ceiling : undefined,
    });
    if (Array.isArray(body.reference_asset_ids)) {
      brief.reference_asset_ids = body.reference_asset_ids;
    }
    if (Array.isArray(body.permitted_claims)) {
      brief.permitted_claims = body.permitted_claims;
    }
    await repo.saveCreativeBrief(brief);

    return res.status(201).json({ success: true, item, brief });
  });

  router.get('/autopilot/items/:id', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;

    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Content item not found in this workspace' });
    }
    const [brief, runs, approvals, publications] = await Promise.all([
      repo.getCreativeBrief(tenant.tenantId, item.id),
      repo.listWorkflowRuns(tenant.tenantId, item.id),
      repo.listApprovalEvents(tenant.tenantId, item.id),
      repo.listPublications(tenant.tenantId, item.id),
    ]);
    return res.json({ success: true, item, brief, runs, approvals, publications });
  });

  router.patch('/autopilot/items/:id', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Content item not found in this workspace' });
    }

    const patch = req.body ?? {};
    const editableFields = [
      'title', 'hook', 'caption', 'channel_variants', 'format', 'workflow_type',
      'target_channels', 'media_assets', 'slides', 'storyboard', 'alt_text', 'disclosures', 'campaign_name',
    ] as const;

    for (const key of editableFields) {
      if (patch[key] !== undefined) {
        (item as any)[key] = patch[key];
      }
    }

    // Any substantive content edit invalidates prior approval and cached QA report so changes cannot sneak past review
    item.validation_report = {};
    item.risk_flags = [];
    if (item.lifecycle_state === 'approved' || item.lifecycle_state === 'scheduled') {
      item.lifecycle_state = 'review_required';
      item.approved_by = null;
      item.approved_at = null;
    }
    item.version += 1;
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);

    return res.json({ success: true, item });
  });

  // ── 5. Creative Brief, Model Capability Registry & Dual Cost Estimator ──────
  router.get('/autopilot/models', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    return res.json({ success: true, models: getModelCapabilityRegistry() });
  });

  router.post('/autopilot/models/refresh', async (req: Request, res: Response) => {
    if (deps.requireAdmin) {
      const admin = await deps.requireAdmin(req, res);
      if (!admin) return;
    } else {
      const tenant = await guardTenant(req, res, 'admin');
      if (!tenant) return;
    }
    refreshModelRegistryOverrides(req.body?.overrides ?? {});
    return res.json({ success: true, models: getModelCapabilityRegistry() });
  });

  router.get('/autopilot/items/:id/brief', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const brief = await repo.getCreativeBrief(tenant.tenantId, req.params.id);
    if (!brief) return res.status(404).json({ success: false, error: 'Creative brief not found' });
    const routed = routeModelForBrief({ workflowType: 'branded_social_graphic', controls: brief.controls });
    return res.json({ success: true, brief, routed });
  });

  router.put('/autopilot/items/:id/brief', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Content item not found' });

    const business = (await repo.getBusinessProfile(tenant.tenantId)) ?? (await repo.upsertBusinessProfile(tenant.tenantId, tenant.userId, tenant.orgId, tenant.projectId, {}));
    const brand = await repo.getBrandProfile(tenant.tenantId);

    // Verify all referenced asset IDs belong to this tenant!
    if (Array.isArray(req.body?.reference_asset_ids)) {
      for (const refId of req.body.reference_asset_ids) {
        const asset = await repo.getBrandAssetById(tenant.tenantId, String(refId));
        if (!asset) {
          return res.status(403).json({
            success: false,
            error: `Referenced asset ${refId} does not belong to this workspace.`,
          });
        }
      }
    }

    const existing =
      (await repo.getCreativeBrief(tenant.tenantId, item.id)) ??
      createCreativeBriefForItem({ item, business, brand });

    const mergedControls = {
      ...existing.controls,
      ...(req.body?.controls ?? {}),
    };

    const spendLimitUsd = typeof req.body?.spend_limit_usd === 'number' ? req.body.spend_limit_usd : existing.spend_limit_usd;
    const creditCeiling = typeof req.body?.credit_ceiling === 'number' ? req.body.credit_ceiling : existing.credit_ceiling;

    const estimate = estimateGenerationCost({
      workflowType: item.workflow_type,
      controls: mergedControls,
      spendLimitUsd,
      creditCeiling,
      businessCapacity: business.capacity,
    });

    const updated = {
      ...existing,
      ...(req.body ?? {}),
      id: existing.id,
      content_item_id: item.id,
      tenant_id: tenant.tenantId,
      controls: mergedControls,
      spend_limit_usd: spendLimitUsd,
      credit_ceiling: creditCeiling,
      selected_provider: req.body?.selected_provider || estimate.selected_provider,
      selected_model: req.body?.selected_model || estimate.selected_model,
      estimated_provider_cost_usd: estimate.estimated_provider_cost_usd,
      estimated_credits: estimate.estimated_internal_credits,
      updated_at: new Date().toISOString(),
    };

    await repo.saveCreativeBrief(updated);
    return res.json({ success: true, brief: updated, cost_estimate: estimate });
  });

  router.post('/autopilot/items/:id/estimate-cost', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;

    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Content item not found' });

    const business = await repo.getBusinessProfile(tenant.tenantId);
    const brief = await repo.getCreativeBrief(tenant.tenantId, item.id);
    if (!brief) return res.status(404).json({ success: false, error: 'Creative brief not found' });

    const estimate = estimateGenerationCost({
      workflowType: item.workflow_type,
      controls: { ...brief.controls, ...(req.body?.controls ?? {}) },
      spendLimitUsd: typeof req.body?.spend_limit_usd === 'number' ? req.body.spend_limit_usd : brief.spend_limit_usd,
      creditCeiling: typeof req.body?.credit_ceiling === 'number' ? req.body.credit_ceiling : brief.credit_ceiling,
      preferDraftCost: Boolean(req.body?.prefer_draft_cost),
      slideCount: typeof req.body?.slide_count === 'number' ? req.body.slide_count : undefined,
      aiSceneCount: typeof req.body?.ai_scene_count === 'number' ? req.body.ai_scene_count : undefined,
      businessCapacity: business?.capacity,
    });

    return res.json({ success: true, estimate });
  });

  // ── 6. Workflow Execution (Workflows A/B/C/D) & QA Validation ───────────────
  router.post('/autopilot/items/:id/generate', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;

      const result = await executeAutopilotWorkflow({
        repo,
        pool: deps.pool,
        hasDatabase: deps.hasDatabase,
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        actorRole: tenant.userRole,
        itemId: req.params.id,
        preferDraftCost: Boolean(req.body?.prefer_draft_cost),
        slideCount: typeof req.body?.slide_count === 'number' ? req.body.slide_count : undefined,
        regenerateSceneNumbers: Array.isArray(req.body?.regenerate_scene_numbers)
          ? req.body.regenerate_scene_numbers.map(Number)
          : undefined,
        regenerateFailedScenesOnly: Boolean(req.body?.regenerate_failed_scenes_only),
        regenerateCaptionOnly: Boolean(req.body?.regenerate_caption_only),
        regenerateSlideIndices: Array.isArray(req.body?.regenerate_slide_indices)
          ? req.body.regenerate_slide_indices.map(Number)
          : undefined,
        proposedPaletteHexes: Array.isArray(req.body?.proposed_palette_hexes)
          ? req.body.proposed_palette_hexes
          : undefined,
        demoCaptureUrl: typeof req.body?.demo_capture_url === 'string' ? req.body.demo_capture_url : undefined,
        magnificSpaceId: req.body?.magnific_space_id,
        magnificFlowId: req.body?.magnific_flow_id,
        visualAdapter: deps.visualAdapter,
        copyAdapter: deps.copyAdapter,
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof AutopilotWorkflowError) {
        return res.status(err.status).json({
          success: false,
          code: err.code,
          error: err.message,
          details: err.details,
        });
      }
      return res.status(500).json({ success: false, error: err?.message || 'Workflow execution failed' });
    }
  });

  router.get('/autopilot/items/:id/runs', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Content item not found' });
    const runs = await repo.listWorkflowRuns(tenant.tenantId, item.id);
    return res.json({ success: true, runs });
  });

  router.post('/autopilot/items/:id/validate', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;

    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Content item not found' });

    const business = await repo.getBusinessProfile(tenant.tenantId);
    if (!business) return res.status(400).json({ success: false, error: 'Business profile required' });

    const brand = await repo.getBrandProfile(tenant.tenantId);
    const brief =
      (await repo.getCreativeBrief(tenant.tenantId, item.id)) ??
      createCreativeBriefForItem({ item, business, brand });

    const referencedAssets = [];
    for (const refId of brief.reference_asset_ids) {
      const a = await repo.getBrandAssetById(tenant.tenantId, refId);
      if (a) referencedAssets.push(a);
    }

    const report = validateAutopilotContentItem({
      item,
      brief,
      business,
      brand,
      referencedAssets,
      proposedPaletteHexes: Array.isArray(req.body?.proposed_palette_hexes)
        ? req.body.proposed_palette_hexes
        : undefined,
    });

    item.validation_report = report;
    if (report.requires_human_review) item.approval_required = true;
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);

    return res.json({ success: true, validation_report: report, item });
  });

  // ── 7. Approval Queue, Lifecycle Transitions & External Sign-Off Links ──────
  const makeTransitionHandler = (targetState: 'review_required' | 'approved' | 'needs_changes' | 'rejected') =>
    async (req: Request, res: Response) => {
      try {
        const minRole: TenantRole = targetState === 'approved' || targetState === 'rejected' ? 'admin' : 'editor';
        const tenant = await guardTenant(req, res, minRole);
        if (!tenant) return;

        const updated = await transitionContentItemState({
          repo,
          tenant,
          itemId: req.params.id,
          toState: targetState,
          actorName: req.body?.actor_name,
          notes: req.body?.notes,
        });
        return res.json({ success: true, item: updated });
      } catch (err: any) {
        if (err instanceof AutopilotLifecycleError) {
          return res.status(err.status).json({
            success: false,
            code: err.code,
            error: err.message,
            details: err.details,
          });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Transition failed' });
      }
    };

  router.post('/autopilot/items/:id/submit-review', makeTransitionHandler('review_required'));
  router.post('/autopilot/items/:id/approve', makeTransitionHandler('approved'));
  router.post('/autopilot/items/:id/request-changes', makeTransitionHandler('needs_changes'));
  router.post('/autopilot/items/:id/reject', makeTransitionHandler('rejected'));

  // Create tokenized external client review link (`/review/:token`) for an Autopilot item
  router.post('/autopilot/items/:id/share-review-link', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const item = await repo.getContentItem(tenant.tenantId, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Content item not found' });

    const token = randomBytes(24).toString('hex');
    const expiresDays = Math.min(90, Math.max(1, Number(req.body?.expires_in_days) || 14));
    const expiresAt = new Date(Date.now() + expiresDays * 86_400_000).toISOString();

    if (deps.hasDatabase()) {
      await deps.pool.query(
        `INSERT INTO client_approval_links (id, user_id, token, resource_type, resource_id, title, resource_snapshot, status, expires_at)
         VALUES ($1, $2, $3, 'autopilot_item', $4, $5, $6::jsonb, 'pending', $7)`,
        [
          randomUUID(),
          tenant.userId,
          token,
          item.id,
          item.title,
          JSON.stringify({
            title: item.title,
            hook: item.hook,
            caption: item.caption,
            format: item.format,
            target_channels: item.target_channels,
            media_assets: item.media_assets,
            slides: item.slides,
            disclosures: item.disclosures,
          }),
          expiresAt,
        ],
      );
    }

    return res.status(201).json({
      success: true,
      token,
      review_path: `/review/${token}`,
      expires_at: expiresAt,
    });
  });

  // ── 8. Scheduling & Idempotent Multi-Channel Publishing ─────────────────────
  router.post('/autopilot/items/:id/schedule', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;

      const scheduled = await scheduleApprovedContentItem({
        repo,
        pool: deps.pool,
        hasDatabase: deps.hasDatabase,
        tenant,
        itemId: req.params.id,
        scheduledAt: req.body?.scheduled_at,
        slotId: req.body?.slot_id,
        timezone: req.body?.timezone,
        channels: Array.isArray(req.body?.channels) ? req.body.channels : undefined,
        socialAccountMap: req.body?.social_account_map,
        allowBlackoutOverride: Boolean(req.body?.allow_blackout_override),
      });

      return res.json({ success: true, ...scheduled });
    } catch (err: any) {
      if (err instanceof AutopilotLifecycleError) {
        return res.status(err.status).json({
          success: false,
          code: err.code,
          error: err.message,
          details: err.details,
        });
      }
      return res.status(500).json({ success: false, error: err?.message || 'Failed to schedule item' });
    }
  });

  router.get('/autopilot/publications', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined;
    const publications = await repo.listPublications(tenant.tenantId, itemId);
    return res.json({ success: true, publications });
  });

  router.get('/autopilot/publications/:pubId/attempts', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const pub = await repo.getPublication(tenant.tenantId, req.params.pubId);
    if (!pub) return res.status(404).json({ success: false, error: 'Publication not found' });
    const attempts = await repo.listPublicationAttempts(tenant.tenantId, pub.id);
    return res.json({ success: true, publication: pub, attempts });
  });

  const handlePublishOrRetry = async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;

      const result = await executePublication({
        repo,
        tenant,
        publicationId: req.params.pubId,
        idempotencyKey: req.body?.idempotency_key || (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined),
        publisherAdapter: defaultPublisherAdapter,
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof AutopilotLifecycleError) {
        return res.status(err.status).json({
          success: false,
          code: err.code,
          error: err.message,
          details: err.details,
        });
      }
      return res.status(500).json({ success: false, error: err?.message || 'Publish execution failed' });
    }
  };

  router.post('/autopilot/publications/:pubId/publish', handlePublishOrRetry);
  router.post('/autopilot/publications/:pubId/retry', handlePublishOrRetry);

  router.post('/autopilot/publications/:pubId/cancel', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const pub = await repo.getPublication(tenant.tenantId, req.params.pubId);
    if (!pub) return res.status(404).json({ success: false, error: 'Publication not found' });
    if (pub.status === 'published') {
      return res.status(409).json({ success: false, error: 'Cannot cancel an already-published post' });
    }
    pub.status = 'cancelled';
    pub.updated_at = new Date().toISOString();
    await repo.savePublication(pub);
    return res.json({ success: true, publication: pub });
  });

  // ── 9. Analytics, Sample-Size-Gated Recommendations & Experiments ───────────
  router.post('/autopilot/analytics/metrics', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [req.body ?? {}];
    const saved = [];
    for (const raw of entries) {
      const row = await repo.ingestChannelMetric({
        tenant_id: tenant.tenantId,
        content_item_id: raw.content_item_id ?? null,
        publication_id: raw.publication_id ?? null,
        channel: String(raw.channel || 'instagram').toLowerCase(),
        objective: String(raw.objective || 'awareness'),
        pillar_name: String(raw.pillar_name || 'General'),
        format: String(raw.format || 'static_graphic'),
        metrics: raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {},
        window_start: raw.window_start ?? null,
        window_end: raw.window_end ?? null,
        source: raw.source || 'manual_or_platform_sync',
      });
      saved.push(row);
    }

    return res.status(201).json({ success: true, ingested: saved.length, metrics: saved });
  });

  router.get('/autopilot/analytics/summary', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const [summary, recommendations, experiments] = await Promise.all([
      buildAnalyticsSummary({ repo, tenantId: tenant.tenantId }),
      repo.listRecommendations(tenant.tenantId),
      repo.listExperiments(tenant.tenantId),
    ]);
    return res.json({ success: true, summary, recommendations, experiments });
  });

  router.post('/autopilot/analytics/recommendations/generate', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const result = await generateStrategyRecommendations({ repo, tenantId: tenant.tenantId });
    return res.json({ success: true, ...result });
  });

  router.post('/autopilot/analytics/recommendations/:recId/decide', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'admin');
      if (!tenant) return;

      const decision = req.body?.decision === 'accepted' ? 'accepted' : req.body?.decision === 'rejected' ? 'rejected' : null;
      if (!decision) {
        return res.status(400).json({ success: false, error: 'decision must be "accepted" or "rejected"' });
      }

      const result = await decideStrategyRecommendation({
        repo,
        tenantId: tenant.tenantId,
        recommendationId: req.params.recId,
        decision,
        actorUserId: tenant.userId,
        actorRole: tenant.userRole,
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(404).json({ success: false, error: err?.message || 'Recommendation decision failed' });
    }
  });

  router.get('/autopilot/experiments', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const experiments = await repo.listExperiments(tenant.tenantId);
    return res.json({ success: true, experiments });
  });

  router.post('/autopilot/experiments', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const body = req.body ?? {};
    if (!body.hypothesis || !body.variable_changed) {
      return res.status(400).json({ success: false, error: 'hypothesis and variable_changed are required' });
    }
    const strategy = await repo.getLatestStrategy(tenant.tenantId);
    const exp = await repo.saveExperiment({
      tenant_id: tenant.tenantId,
      strategy_id: strategy?.id ?? null,
      hypothesis: String(body.hypothesis).slice(0, 300),
      variable_changed: String(body.variable_changed).slice(0, 120),
      control_variant: body.control_variant ?? {},
      test_variant: body.test_variant ?? {},
      channel: String(body.channel || 'instagram'),
      audience_segment: String(body.audience_segment || ''),
      primary_metric: String(body.primary_metric || 'saves'),
      min_sample_size: Math.max(4, Number(body.min_sample_size) || 6),
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: tenant.userId,
    });
    return res.status(201).json({ success: true, experiment: exp });
  });

  router.patch('/autopilot/experiments/:expId', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'editor');
    if (!tenant) return;
    const list = await repo.listExperiments(tenant.tenantId);
    const existing = list.find((e: any) => e.id === req.params.expId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Experiment not found in this workspace' });
    }

    const controlScores: number[] = Array.isArray(req.body?.control_scores) ? req.body.control_scores.map(Number) : [];
    const variantScores: number[] = Array.isArray(req.body?.variant_scores) ? req.body.variant_scores.map(Number) : [];
    const evaluation = (controlScores.length || variantScores.length)
      ? evaluateExperimentOutcome({
          minSampleSize: existing.min_sample_size,
          controlScores,
          variantScores,
        })
      : existing.result;

    const updated = await repo.saveExperiment({
      ...existing,
      current_sample_size: controlScores.length + variantScores.length || existing.current_sample_size,
      status: req.body?.status ?? (evaluation?.outcome && evaluation.outcome !== 'inconclusive_sample_too_small' ? 'completed' : existing.status),
      result: evaluation,
      ended_at: req.body?.status === 'completed' ? new Date().toISOString() : existing.ended_at,
    });
    return res.json({ success: true, experiment: updated });
  });

  // ── 10. Audit Trail & Privacy / Tenant Data Deletion Control (Section 13) ───
  router.get('/autopilot/audit-events', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const events = await repo.listAuditEvents(tenant.tenantId, 100);
    return res.json({ success: true, events });
  });

  router.delete('/autopilot/tenant-data', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'owner');
    if (!tenant) return;
    await repo.purgeTenantAutopilotData(tenant.tenantId);
    return res.json({ success: true, purged_tenant_id: tenant.tenantId });
  });


  // ── Brand Version Diff & Restore ───────────────────────────────────────────
  router.get('/autopilot/brand/diff', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const v1 = parseInt(String(req.query.v1 || ''), 10);
    const v2 = parseInt(String(req.query.v2 || ''), 10);
    const versions = await repo.listBrandVersions(tenant.tenantId);
    const snap1 = versions.find((v: any) => v.version === v1)?.snapshot;
    const snap2 = versions.find((v: any) => v.version === v2)?.snapshot;
    if (!snap1 || !snap2) {
      return res.status(404).json({ success: false, error: 'One or both requested versions not found' });
    }
    return res.json({ success: true, v1, v2, diff: { before: snap1, after: snap2 } });
  });

  router.post('/autopilot/brand/restore', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'admin');
    if (!tenant) return;
    const targetVersion = parseInt(String(req.body?.version || ''), 10);
    const versions = await repo.listBrandVersions(tenant.tenantId);
    const target = versions.find((v: any) => v.version === targetVersion);
    if (!target) {
      return res.status(404).json({ success: false, error: `Brand version ${targetVersion} not found` });
    }
    const restored = await repo.upsertBrandProfile(
      tenant.tenantId,
      tenant.userId,
      tenant.orgId,
      tenant.projectId,
      target.snapshot,
      tenant.userId,
      `Restored from version ${targetVersion}`,
      true
    );
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'brand.restored', 'brand_profile', restored.id, {
      from_version: targetVersion,
      to_version: restored.current_version,
    });
    return res.json({ success: true, brand: restored });
  });

  // ── Tenant Controls & Kill Switches ───────────────────────────────────────
  router.get('/autopilot/controls', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const controls = await getTenantControls(deps.pool, tenant.tenantId);
    return res.json({ success: true, controls });
  });

  router.post('/autopilot/controls', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'admin');
    if (!tenant) return;
    const controls = await upsertTenantControls(deps.pool, tenant.tenantId, req.body || {}, tenant.userId);
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'controls.updated', 'tenant_controls', tenant.tenantId, controls);
    return res.json({ success: true, controls });
  });

  router.get('/autopilot/usage/ledger', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const ledger = await getTenantUsageLedger(deps.pool, tenant.tenantId);
    return res.json({ success: true, ledger });
  });

  // ── Tenant Data Export ────────────────────────────────────────────────────
  router.get('/autopilot/tenant/export', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'admin');
    if (!tenant) return;
    const exported = await repo.exportTenantAutopilotData(tenant.tenantId);
    return res.json({ success: true, export: exported });
  });

  // ── Publication Pause, Resume & Reschedule ─────────────────────────────────
  router.post('/autopilot/publications/:pubId/pause', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;
      const publication = await pausePublication(repo, tenant, req.params.pubId);
      return res.json({ success: true, publication });
    } catch (err: any) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  router.post('/autopilot/publications/:pubId/resume', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;
      const publication = await resumePublication(repo, tenant, req.params.pubId);
      return res.json({ success: true, publication });
    } catch (err: any) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  router.post('/autopilot/publications/:pubId/reschedule', async (req: Request, res: Response) => {
    try {
      const tenant = await guardTenant(req, res, 'editor');
      if (!tenant) return;
      const publication = await reschedulePublication(repo, tenant, req.params.pubId, String(req.body?.scheduled_at || ''));
      return res.json({ success: true, publication });
    } catch (err: any) {
      return res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  // ── Autopilot Ops Health & Provider Status ────────────────────────────────
  router.get('/autopilot/ops/health', async (req: Request, res: Response) => {
    const tenant = await guardTenant(req, res, 'viewer');
    if (!tenant) return;
    const providerStatus = await getAutopilotProviderStatus(deps.pool);
    const controls = await getTenantControls(deps.pool, tenant.tenantId);
    return res.json({
      success: true,
      service: 'autopilot-core',
      timestamp: new Date().toISOString(),
      providers: providerStatus,
      controls: {
        global_kill_switch: controls.global_kill_switch,
        publishing_kill_switch: controls.publishing_kill_switch,
        ai_generation_kill_switch: controls.ai_generation_kill_switch,
      },
    });
  });

  return router;
}
