import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type {
  BrandAssetRecord,
  BrandProfileRecord,
  BrandTokenRecord,
  BusinessProfileRecord,
  ContentItemRecord,
  ContentStrategyRecord,
  CreativeBriefRecord,
  PublicationAttemptRecord,
  PublicationRecord,
  WorkflowRunRecord,
} from './types.ts';
import type { AutopilotAssetRecord } from './assetPipeline.ts';

export interface AutopilotRepoDeps {
  pool: Pick<Pool, 'query'>;
  hasDatabase: () => boolean;
}

interface InMemoryAutopilotState {
  businessProfiles: Map<string, BusinessProfileRecord>;
  brandProfiles: Map<string, BrandProfileRecord>;
  brandVersions: Array<{ id: string; brand_profile_id: string; tenant_id: string; version: number; snapshot: any; change_rationale: string; approved_by: string | null; approved_at: string | null; created_by: string; created_at: string }>;
  brandTokens: Map<string, BrandTokenRecord>;
  brandAssets: Map<string, BrandAssetRecord>;
  strategies: Map<string, ContentStrategyRecord>;
  strategyVersions: Array<{ id: string; strategy_id: string; tenant_id: string; version: number; snapshot: any; change_rationale: string; created_by: string; created_at: string }>;
  contentItems: Map<string, ContentItemRecord>;
  creativeBriefs: Map<string, CreativeBriefRecord>;
  workflowRuns: Map<string, WorkflowRunRecord>;
  approvalEvents: Array<Record<string, any>>;
  publications: Map<string, PublicationRecord>;
  publicationAttempts: Map<string, PublicationAttemptRecord>;
  channelMetrics: Array<Record<string, any>>;
  experiments: Map<string, Record<string, any>>;
  recommendations: Map<string, Record<string, any>>;
  auditEvents: Array<Record<string, any>>;
  assets: Map<string, AutopilotAssetRecord>;
}

export function createAutopilotRepository({ pool, hasDatabase }: AutopilotRepoDeps) {
  const mem: InMemoryAutopilotState = {
    businessProfiles: new Map(),
    brandProfiles: new Map(),
    brandVersions: [],
    brandTokens: new Map(),
    brandAssets: new Map(),
    strategies: new Map(),
    strategyVersions: [],
    contentItems: new Map(),
    creativeBriefs: new Map(),
    workflowRuns: new Map(),
    approvalEvents: [],
    publications: new Map(),
    publicationAttempts: new Map(),
    channelMetrics: [],
    experiments: new Map(),
    recommendations: new Map(),
    auditEvents: [],
    assets: new Map(),
  };

  const usePg = () => hasDatabase();

  // ── Audit Events ────────────────────────────────────────────────────────────
  async function recordAudit(
    tenantId: string,
    actorUserId: string | null,
    actorRole: string,
    eventType: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, any> = {},
  ) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_audit_events (id, tenant_id, actor_user_id, actor_role, event_type, resource_type, resource_id, details, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [id, tenantId, actorUserId, actorRole, eventType, resourceType, resourceId, JSON.stringify(details), createdAt],
      );
    } else {
      mem.auditEvents.unshift({ id, tenant_id: tenantId, actor_user_id: actorUserId, actor_role: actorRole, event_type: eventType, resource_type: resourceType, resource_id: resourceId, details, created_at: createdAt });
    }
  }

  async function listAuditEvents(tenantId: string, limit = 50) {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_audit_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [tenantId, limit],
      );
      return rows;
    }
    return mem.auditEvents.filter((e) => e.tenant_id === tenantId).slice(0, limit);
  }

  // ── Business Profiles ───────────────────────────────────────────────────────
  async function getBusinessProfile(tenantId: string): Promise<BusinessProfileRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_business_profiles WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      return (rows[0] as BusinessProfileRecord) ?? null;
    }
    return mem.businessProfiles.get(tenantId) ?? null;
  }

  async function upsertBusinessProfile(
    tenantId: string,
    ownerUserId: string,
    orgId: string | null,
    projectId: string | null,
    patch: Partial<BusinessProfileRecord>,
  ): Promise<BusinessProfileRecord> {
    const existing = await getBusinessProfile(tenantId);
    const now = new Date().toISOString();
    const merged: BusinessProfileRecord = {
      id: existing?.id ?? randomUUID(),
      tenant_id: tenantId,
      org_id: orgId ?? existing?.org_id ?? null,
      project_id: projectId ?? existing?.project_id ?? null,
      owner_user_id: existing?.owner_user_id ?? ownerUserId,
      business_name: patch.business_name ?? existing?.business_name ?? '',
      website_url: patch.website_url ?? existing?.website_url ?? '',
      industry: patch.industry ?? existing?.industry ?? '',
      niche: patch.niche ?? existing?.niche ?? '',
      business_model: patch.business_model ?? existing?.business_model ?? 'B2B',
      primary_offer: patch.primary_offer ?? existing?.primary_offer ?? '',
      price_range: patch.price_range ?? existing?.price_range ?? '',
      geography: patch.geography ?? existing?.geography ?? [],
      languages: patch.languages ?? existing?.languages ?? ['en'],
      audiences: patch.audiences ?? existing?.audiences ?? [],
      funnel_stage: patch.funnel_stage ?? existing?.funnel_stage ?? 'full_funnel',
      primary_objective: patch.primary_objective ?? existing?.primary_objective ?? 'awareness',
      secondary_objectives: patch.secondary_objectives ?? existing?.secondary_objectives ?? [],
      success_metric: patch.success_metric ?? existing?.success_metric ?? '',
      sales_cycle: patch.sales_cycle ?? existing?.sales_cycle ?? 'medium',
      conversion_path: patch.conversion_path ?? existing?.conversion_path ?? '',
      available_proof: patch.available_proof ?? existing?.available_proof ?? [],
      capacity: {
        weekly_hours: 4,
        monthly_budget_usd: 50,
        monthly_credit_cap: 1000,
        has_founder_footage: false,
        has_product_demos: false,
        has_photography: false,
        has_customer_permissions: false,
        approval_mode: 'mandatory',
        allowed_publisher_roles: ['owner', 'admin'],
        ...(existing?.capacity ?? {}),
        ...(patch.capacity ?? {}),
      },
      channels: {
        connected: [],
        preferred: [],
        preferred_formats: ['static_graphic', 'carousel'],
        desired_cadence: 'recommend',
        ...(existing?.channels ?? {}),
        ...(patch.channels ?? {}),
      },
      risk_profile: {
        category: 'standard',
        required_disclosures: [],
        prohibited_claims: [],
        reviewer_role: 'owner',
        ...(existing?.risk_profile ?? {}),
        ...(patch.risk_profile ?? {}),
      },
      schedule_config: patch.schedule_config ?? existing?.schedule_config ?? {
        timezone: 'UTC',
        named_slots: [
          { id: 'slot_tue_am', name: 'Tuesday Morning Deep-Dive', day_of_week: 2, hour: 9, minute: 30, timezone: 'UTC', channels: ['linkedin', 'instagram'] },
          { id: 'slot_thu_pm', name: 'Thursday Afternoon Proof', day_of_week: 4, hour: 14, minute: 0, timezone: 'UTC', channels: ['instagram', 'linkedin'] },
        ],
        blackout_dates: [],
        holidays: [],
      },
      onboarding_step: patch.onboarding_step ?? existing?.onboarding_step ?? 1,
      onboarding_completed: patch.onboarding_completed ?? existing?.onboarding_completed ?? false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    if (usePg()) {
      const { rows } = await pool.query(
        `INSERT INTO autopilot_business_profiles (
           id, tenant_id, org_id, project_id, owner_user_id, business_name, website_url,
           industry, niche, business_model, primary_offer, price_range, geography, languages,
           audiences, funnel_stage, primary_objective, secondary_objectives, success_metric,
           sales_cycle, conversion_path, available_proof, capacity, channels, risk_profile,
           schedule_config, onboarding_step, onboarding_completed, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
           $15::jsonb,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,
           $26::jsonb,$27,$28,$29,$30
         )
         ON CONFLICT (tenant_id) DO UPDATE SET
           business_name = EXCLUDED.business_name,
           website_url = EXCLUDED.website_url,
           industry = EXCLUDED.industry,
           niche = EXCLUDED.niche,
           business_model = EXCLUDED.business_model,
           primary_offer = EXCLUDED.primary_offer,
           price_range = EXCLUDED.price_range,
           geography = EXCLUDED.geography,
           languages = EXCLUDED.languages,
           audiences = EXCLUDED.audiences,
           funnel_stage = EXCLUDED.funnel_stage,
           primary_objective = EXCLUDED.primary_objective,
           secondary_objectives = EXCLUDED.secondary_objectives,
           success_metric = EXCLUDED.success_metric,
           sales_cycle = EXCLUDED.sales_cycle,
           conversion_path = EXCLUDED.conversion_path,
           available_proof = EXCLUDED.available_proof,
           capacity = EXCLUDED.capacity,
           channels = EXCLUDED.channels,
           risk_profile = EXCLUDED.risk_profile,
           schedule_config = EXCLUDED.schedule_config,
           onboarding_step = EXCLUDED.onboarding_step,
           onboarding_completed = EXCLUDED.onboarding_completed,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          merged.id, merged.tenant_id, merged.org_id, merged.project_id, merged.owner_user_id,
          merged.business_name, merged.website_url, merged.industry, merged.niche, merged.business_model,
          merged.primary_offer, merged.price_range, merged.geography, merged.languages,
          JSON.stringify(merged.audiences), merged.funnel_stage, merged.primary_objective,
          merged.secondary_objectives, merged.success_metric, merged.sales_cycle, merged.conversion_path,
          JSON.stringify(merged.available_proof), JSON.stringify(merged.capacity),
          JSON.stringify(merged.channels), JSON.stringify(merged.risk_profile),
          JSON.stringify(merged.schedule_config), merged.onboarding_step, merged.onboarding_completed,
          merged.created_at, merged.updated_at,
        ],
      );
      return rows[0] as BusinessProfileRecord;
    }

    mem.businessProfiles.set(tenantId, merged);
    return merged;
  }

  // ── Brand Studio (Profiles, Versions, Tokens, Assets) ───────────────────────
  async function getBrandProfile(tenantId: string): Promise<BrandProfileRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_brand_profiles WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      return (rows[0] as BrandProfileRecord) ?? null;
    }
    return mem.brandProfiles.get(tenantId) ?? null;
  }

  async function upsertBrandProfile(
    tenantId: string,
    ownerUserId: string,
    orgId: string | null,
    projectId: string | null,
    patch: Partial<BrandProfileRecord>,
    actorUserId: string,
    rationale = 'Updated brand profile',
    bumpVersion = false,
  ): Promise<BrandProfileRecord> {
    const existing = await getBrandProfile(tenantId);
    const now = new Date().toISOString();
    const nextVersion = existing ? (bumpVersion ? existing.current_version + 1 : existing.current_version) : 1;

    const merged: BrandProfileRecord = {
      id: existing?.id ?? randomUUID(),
      tenant_id: tenantId,
      org_id: orgId ?? existing?.org_id ?? null,
      project_id: projectId ?? existing?.project_id ?? null,
      owner_user_id: existing?.owner_user_id ?? ownerUserId,
      brand_name: patch.brand_name ?? existing?.brand_name ?? '',
      current_version: nextVersion,
      source: {
        approval_status: 'needs_review',
        ...(existing?.source ?? {}),
        ...(patch.source ?? {}),
      },
      identity: {
        industry: '',
        niche: '',
        positioning: '',
        audience: [],
        value_proposition: '',
        differentiators: [],
        approved_claims: [],
        prohibited_claims: [],
        ...(existing?.identity ?? {}),
        ...(patch.identity ?? {}),
      },
      visual: {
        colors: [],
        retired_colors: [],
        typography: [],
        logos: [],
        imagery: { style: [], preferred_subjects: [], avoid: [] },
        layout_rules: [],
        shape_and_spacing: {},
        shadows: [],
        iconography: {},
        motion: {},
        social_templates: [],
        ...(existing?.visual ?? {}),
        ...(patch.visual ?? {}),
      },
      voice: {
        attributes: [],
        writing_rules: [],
        preferred_terms: [],
        avoid_terms: [],
        example_copy: [],
        ...(existing?.voice ?? {}),
        ...(patch.voice ?? {}),
      },
      content_rules: {
        logo_policy_default: 'contextual',
        disclosure_requirements: [],
        accessibility_requirements: ['Minimum 4.5:1 text contrast'],
        factuality_rules: ['Only use verified facts and customer-approved claims'],
        industry_review_rules: [],
        ...(existing?.content_rules ?? {}),
        ...(patch.content_rules ?? {}),
      },
      approval_status: patch.approval_status ?? existing?.approval_status ?? 'needs_review',
      approved_by: patch.approved_by !== undefined ? patch.approved_by : (existing?.approved_by ?? null),
      approved_at: patch.approved_at !== undefined ? patch.approved_at : (existing?.approved_at ?? null),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_brand_profiles (
           id, tenant_id, org_id, project_id, owner_user_id, brand_name, current_version,
           source, identity, visual, voice, content_rules, approval_status, approved_by, approved_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17
         )
         ON CONFLICT (tenant_id) DO UPDATE SET
           brand_name = EXCLUDED.brand_name,
           current_version = EXCLUDED.current_version,
           source = EXCLUDED.source,
           identity = EXCLUDED.identity,
           visual = EXCLUDED.visual,
           voice = EXCLUDED.voice,
           content_rules = EXCLUDED.content_rules,
           approval_status = EXCLUDED.approval_status,
           approved_by = EXCLUDED.approved_by,
           approved_at = EXCLUDED.approved_at,
           updated_at = EXCLUDED.updated_at`,
        [
          merged.id, merged.tenant_id, merged.org_id, merged.project_id, merged.owner_user_id,
          merged.brand_name, merged.current_version, JSON.stringify(merged.source),
          JSON.stringify(merged.identity), JSON.stringify(merged.visual),
          JSON.stringify(merged.voice), JSON.stringify(merged.content_rules),
          merged.approval_status, merged.approved_by, merged.approved_at, merged.created_at, merged.updated_at,
        ],
      );
      if (!existing || bumpVersion) {
        await pool.query(
          `INSERT INTO autopilot_brand_versions (id, brand_profile_id, tenant_id, version, snapshot, change_rationale, approved_by, approved_at, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
           ON CONFLICT (brand_profile_id, version) DO UPDATE SET snapshot = EXCLUDED.snapshot, change_rationale = EXCLUDED.change_rationale`,
          [randomUUID(), merged.id, tenantId, merged.current_version, JSON.stringify(merged), rationale, merged.approved_by, merged.approved_at, actorUserId, now],
        );
      }
    } else {
      mem.brandProfiles.set(tenantId, merged);
      if (!existing || bumpVersion) {
        mem.brandVersions.unshift({
          id: randomUUID(),
          brand_profile_id: merged.id,
          tenant_id: tenantId,
          version: merged.current_version,
          snapshot: structuredClone(merged),
          change_rationale: rationale,
          approved_by: merged.approved_by,
          approved_at: merged.approved_at,
          created_by: actorUserId,
          created_at: now,
        });
      }
    }
    return merged;
  }

  async function listBrandVersions(tenantId: string) {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_brand_versions WHERE tenant_id = $1 ORDER BY version DESC`, [tenantId]);
      return rows;
    }
    return mem.brandVersions.filter((v) => v.tenant_id === tenantId).sort((a, b) => b.version - a.version);
  }

  async function listBrandTokens(tenantId: string): Promise<BrandTokenRecord[]> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_brand_tokens WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
      return rows.map((r: any) => ({ ...r, confidence: Number(r.confidence) }));
    }
    return [...mem.brandTokens.values()].filter((t) => t.tenant_id === tenantId);
  }

  async function saveBrandTokens(tenantId: string, brandProfileId: string, tokens: Array<Omit<BrandTokenRecord, 'id' | 'brand_profile_id' | 'tenant_id' | 'created_at' | 'updated_at'>>): Promise<BrandTokenRecord[]> {
    const now = new Date().toISOString();
    const saved: BrandTokenRecord[] = [];
    for (const t of tokens) {
      const rec: BrandTokenRecord = {
        id: randomUUID(),
        brand_profile_id: brandProfileId,
        tenant_id: tenantId,
        ...t,
        created_at: now,
        updated_at: now,
      };
      if (usePg()) {
        await pool.query(
          `INSERT INTO autopilot_brand_tokens (
             id, brand_profile_id, tenant_id, name, value, category, sub_type, source_url,
             source_type, confidence, rights_confirmed, approval_status, version, notes,
             allowed_contexts, last_verified_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            rec.id, rec.brand_profile_id, rec.tenant_id, rec.name, JSON.stringify(rec.value),
            rec.category, rec.sub_type, rec.source_url, rec.source_type, rec.confidence,
            rec.rights_confirmed, rec.approval_status, rec.version, rec.notes,
            rec.allowed_contexts, rec.last_verified_at, rec.created_at, rec.updated_at,
          ],
        );
      } else {
        mem.brandTokens.set(rec.id, rec);
      }
      saved.push(rec);
    }
    return saved;
  }

  async function updateBrandToken(tenantId: string, tokenId: string, patch: Partial<Pick<BrandTokenRecord, 'value' | 'approval_status' | 'notes' | 'rights_confirmed' | 'name'>>): Promise<BrandTokenRecord | null> {
    const now = new Date().toISOString();
    if (usePg()) {
      const existingRes = await pool.query(`SELECT * FROM autopilot_brand_tokens WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [tokenId, tenantId]);
      if (!existingRes.rows[0]) return null;
      const cur = existingRes.rows[0];
      const nextVal = patch.value !== undefined ? patch.value : cur.value;
      const nextStatus = patch.approval_status ?? cur.approval_status;
      const nextNotes = patch.notes ?? cur.notes;
      const nextRights = patch.rights_confirmed !== undefined ? patch.rights_confirmed : cur.rights_confirmed;
      const nextName = patch.name ?? cur.name;
      const verifiedAt = nextStatus === 'approved' ? now : cur.last_verified_at;
      const { rows } = await pool.query(
        `UPDATE autopilot_brand_tokens
         SET name = $3, value = $4::jsonb, approval_status = $5, notes = $6, rights_confirmed = $7, last_verified_at = $8, updated_at = $9
         WHERE id::text = $1 AND tenant_id = $2 RETURNING *`,
        [tokenId, tenantId, nextName, JSON.stringify(nextVal), nextStatus, nextNotes, nextRights, verifiedAt, now],
      );
      return rows[0] ? { ...rows[0], confidence: Number(rows[0].confidence) } : null;
    }

    const tok = mem.brandTokens.get(tokenId);
    if (!tok || tok.tenant_id !== tenantId) return null;
    const updated: BrandTokenRecord = {
      ...tok,
      name: patch.name ?? tok.name,
      value: patch.value !== undefined ? patch.value : tok.value,
      approval_status: patch.approval_status ?? tok.approval_status,
      notes: patch.notes ?? tok.notes,
      rights_confirmed: patch.rights_confirmed !== undefined ? patch.rights_confirmed : tok.rights_confirmed,
      last_verified_at: patch.approval_status === 'approved' ? now : tok.last_verified_at,
      updated_at: now,
    };
    mem.brandTokens.set(tokenId, updated);
    return updated;
  }

  async function listBrandAssets(tenantId: string): Promise<BrandAssetRecord[]> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_brand_assets WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
      return rows as BrandAssetRecord[];
    }
    return [...mem.brandAssets.values()].filter((a) => a.tenant_id === tenantId);
  }

  async function getBrandAssetById(tenantId: string, assetId: string): Promise<BrandAssetRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_brand_assets WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [assetId, tenantId]);
      return (rows[0] as BrandAssetRecord) ?? null;
    }
    const found = mem.brandAssets.get(assetId);
    return found && found.tenant_id === tenantId ? found : null;
  }

  async function addBrandAsset(tenantId: string, brandProfileId: string, input: Omit<BrandAssetRecord, 'id' | 'brand_profile_id' | 'tenant_id' | 'created_at'>): Promise<BrandAssetRecord> {
    const rec: BrandAssetRecord = {
      id: randomUUID(),
      brand_profile_id: brandProfileId,
      tenant_id: tenantId,
      ...input,
      created_at: new Date().toISOString(),
    };
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_brand_assets (
           id, brand_profile_id, tenant_id, asset_type, name, url, mime_type, variant,
           rights_confirmed, consented_likeness, usage_rules, approval_status, uploaded_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
        [
          rec.id, rec.brand_profile_id, rec.tenant_id, rec.asset_type, rec.name, rec.url,
          rec.mime_type, rec.variant, rec.rights_confirmed, rec.consented_likeness,
          JSON.stringify(rec.usage_rules), rec.approval_status, rec.uploaded_by, rec.created_at,
        ],
      );
    } else {
      mem.brandAssets.set(rec.id, rec);
    }
    return rec;
  }

  async function deleteBrandAsset(tenantId: string, assetId: string): Promise<boolean> {
    if (usePg()) {
      const { rows } = await pool.query(`DELETE FROM autopilot_brand_assets WHERE id::text = $1 AND tenant_id = $2 RETURNING id`, [assetId, tenantId]);
      return rows.length > 0;
    }
    const cur = mem.brandAssets.get(assetId);
    if (!cur || cur.tenant_id !== tenantId) return false;
    mem.brandAssets.delete(assetId);
    return true;
  }

  async function deleteBrandToken(tenantId: string, tokenId: string): Promise<boolean> {
    if (usePg()) {
      const { rows } = await pool.query(`DELETE FROM autopilot_brand_tokens WHERE id::text = $1 AND tenant_id = $2 RETURNING id`, [tokenId, tenantId]);
      return rows.length > 0;
    }
    const cur = mem.brandTokens.get(tokenId);
    if (!cur || cur.tenant_id !== tenantId) return false;
    mem.brandTokens.delete(tokenId);
    return true;
  }

  // ── Content Strategies & Versions ───────────────────────────────────────────
  async function getLatestStrategy(tenantId: string): Promise<ContentStrategyRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_strategies WHERE tenant_id = $1 AND status != 'archived' ORDER BY updated_at DESC LIMIT 1`,
        [tenantId],
      );
      return (rows[0] as ContentStrategyRecord) ?? null;
    }
    const list = [...mem.strategies.values()].filter((s) => s.tenant_id === tenantId && s.status !== 'archived');
    list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return list[0] ?? null;
  }

  async function getStrategyById(tenantId: string, strategyId: string): Promise<ContentStrategyRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_strategies WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [strategyId, tenantId]);
      return (rows[0] as ContentStrategyRecord) ?? null;
    }
    const s = mem.strategies.get(strategyId);
    return s && s.tenant_id === tenantId ? s : null;
  }

  async function saveStrategy(
    strategy: ContentStrategyRecord,
    actorUserId: string,
    changeRationale = 'Initial adaptive strategy proposal',
  ): Promise<ContentStrategyRecord> {
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_strategies (
           id, tenant_id, org_id, project_id, owner_user_id, name, current_version, status,
           objective, audiences, positioning, channels, pillars, funnel_mix, cadence, campaigns,
           cta_policy, proof_policy, risk_policy, measurement, assumptions, follow_up_questions,
           rationale, approved_by, approved_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,
           $15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,
           $23,$24,$25,$26,$27
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           current_version = EXCLUDED.current_version,
           status = EXCLUDED.status,
           objective = EXCLUDED.objective,
           audiences = EXCLUDED.audiences,
           positioning = EXCLUDED.positioning,
           channels = EXCLUDED.channels,
           pillars = EXCLUDED.pillars,
           funnel_mix = EXCLUDED.funnel_mix,
           cadence = EXCLUDED.cadence,
           campaigns = EXCLUDED.campaigns,
           cta_policy = EXCLUDED.cta_policy,
           proof_policy = EXCLUDED.proof_policy,
           risk_policy = EXCLUDED.risk_policy,
           measurement = EXCLUDED.measurement,
           assumptions = EXCLUDED.assumptions,
           follow_up_questions = EXCLUDED.follow_up_questions,
           rationale = EXCLUDED.rationale,
           approved_by = EXCLUDED.approved_by,
           approved_at = EXCLUDED.approved_at,
           updated_at = EXCLUDED.updated_at`,
        [
          strategy.id, strategy.tenant_id, strategy.org_id, strategy.project_id, strategy.owner_user_id,
          strategy.name, strategy.current_version, strategy.status,
          JSON.stringify(strategy.objective), JSON.stringify(strategy.audiences),
          JSON.stringify(strategy.positioning), JSON.stringify(strategy.channels),
          JSON.stringify(strategy.pillars), JSON.stringify(strategy.funnel_mix),
          JSON.stringify(strategy.cadence), JSON.stringify(strategy.campaigns),
          JSON.stringify(strategy.cta_policy), JSON.stringify(strategy.proof_policy),
          JSON.stringify(strategy.risk_policy), JSON.stringify(strategy.measurement),
          JSON.stringify(strategy.assumptions), JSON.stringify(strategy.follow_up_questions),
          strategy.rationale, strategy.approved_by, strategy.approved_at, strategy.created_at, strategy.updated_at,
        ],
      );
      await pool.query(
        `INSERT INTO autopilot_strategy_versions (id, strategy_id, tenant_id, version, snapshot, change_rationale, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
         ON CONFLICT (strategy_id, version) DO UPDATE SET snapshot = EXCLUDED.snapshot, change_rationale = EXCLUDED.change_rationale`,
        [randomUUID(), strategy.id, strategy.tenant_id, strategy.current_version, JSON.stringify(strategy), changeRationale, actorUserId, strategy.updated_at],
      );
    } else {
      mem.strategies.set(strategy.id, structuredClone(strategy));
      mem.strategyVersions.unshift({
        id: randomUUID(),
        strategy_id: strategy.id,
        tenant_id: strategy.tenant_id,
        version: strategy.current_version,
        snapshot: structuredClone(strategy),
        change_rationale: changeRationale,
        created_by: actorUserId,
        created_at: strategy.updated_at,
      });
    }
    return strategy;
  }

  async function listStrategyVersions(tenantId: string, strategyId: string) {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_strategy_versions WHERE tenant_id = $1 AND strategy_id = $2 ORDER BY version DESC`,
        [tenantId, strategyId],
      );
      return rows;
    }
    return mem.strategyVersions.filter((v) => v.tenant_id === tenantId && v.strategy_id === strategyId).sort((a, b) => b.version - a.version);
  }

  // ── Content Items & Creative Briefs ─────────────────────────────────────────
  async function listContentItems(tenantId: string, stateFilter?: string): Promise<ContentItemRecord[]> {
    if (usePg()) {
      if (stateFilter) {
        const { rows } = await pool.query(
          `SELECT * FROM autopilot_content_items WHERE tenant_id = $1 AND lifecycle_state = $2 ORDER BY created_at DESC`,
          [tenantId, stateFilter],
        );
        return rows as ContentItemRecord[];
      }
      const { rows } = await pool.query(`SELECT * FROM autopilot_content_items WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
      return rows as ContentItemRecord[];
    }
    return [...mem.contentItems.values()]
      .filter((i) => i.tenant_id === tenantId && (!stateFilter || i.lifecycle_state === stateFilter))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async function getContentItem(tenantId: string, itemId: string): Promise<ContentItemRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_content_items WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [itemId, tenantId]);
      return (rows[0] as ContentItemRecord) ?? null;
    }
    const item = mem.contentItems.get(itemId);
    return item && item.tenant_id === tenantId ? item : null;
  }

  async function saveContentItem(item: ContentItemRecord): Promise<ContentItemRecord> {
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_content_items (
           id, tenant_id, org_id, project_id, owner_user_id, strategy_id, strategy_version,
           brand_profile_id, brand_version, campaign_name, pillar_id, pillar_name, funnel_stage,
           title, hook, caption, channel_variants, format, workflow_type, target_channels,
           lifecycle_state, approval_required, risk_flags, validation_report, media_assets,
           deterministic_overlay, slides, storyboard, alt_text, disclosures, scheduled_slot,
           linked_blog_post_id, version, created_by, approved_by, approved_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,
           $21,$22,$23,$24::jsonb,$25::jsonb,$26::jsonb,$27::jsonb,$28::jsonb,$29,$30,$31::jsonb,
           $32,$33,$34,$35,$36,$37,$38
         )
         ON CONFLICT (id) DO UPDATE SET
           campaign_name = EXCLUDED.campaign_name,
           pillar_id = EXCLUDED.pillar_id,
           pillar_name = EXCLUDED.pillar_name,
           funnel_stage = EXCLUDED.funnel_stage,
           title = EXCLUDED.title,
           hook = EXCLUDED.hook,
           caption = EXCLUDED.caption,
           channel_variants = EXCLUDED.channel_variants,
           format = EXCLUDED.format,
           workflow_type = EXCLUDED.workflow_type,
           target_channels = EXCLUDED.target_channels,
           lifecycle_state = EXCLUDED.lifecycle_state,
           approval_required = EXCLUDED.approval_required,
           risk_flags = EXCLUDED.risk_flags,
           validation_report = EXCLUDED.validation_report,
           media_assets = EXCLUDED.media_assets,
           deterministic_overlay = EXCLUDED.deterministic_overlay,
           slides = EXCLUDED.slides,
           storyboard = EXCLUDED.storyboard,
           alt_text = EXCLUDED.alt_text,
           disclosures = EXCLUDED.disclosures,
           scheduled_slot = EXCLUDED.scheduled_slot,
           linked_blog_post_id = EXCLUDED.linked_blog_post_id,
           version = EXCLUDED.version,
           approved_by = EXCLUDED.approved_by,
           approved_at = EXCLUDED.approved_at,
           updated_at = EXCLUDED.updated_at`,
        [
          item.id, item.tenant_id, item.org_id, item.project_id, item.owner_user_id,
          item.strategy_id, item.strategy_version, item.brand_profile_id, item.brand_version,
          item.campaign_name, item.pillar_id, item.pillar_name, item.funnel_stage,
          item.title, item.hook, item.caption, JSON.stringify(item.channel_variants),
          item.format, item.workflow_type, item.target_channels, item.lifecycle_state,
          item.approval_required, item.risk_flags, JSON.stringify(item.validation_report),
          JSON.stringify(item.media_assets), JSON.stringify(item.deterministic_overlay),
          JSON.stringify(item.slides), JSON.stringify(item.storyboard), item.alt_text,
          item.disclosures, item.scheduled_slot ? JSON.stringify(item.scheduled_slot) : null,
          item.linked_blog_post_id, item.version, item.created_by, item.approved_by,
          item.approved_at, item.created_at, item.updated_at,
        ],
      );
    } else {
      mem.contentItems.set(item.id, structuredClone(item));
    }
    return item;
  }

  async function getCreativeBrief(tenantId: string, contentItemId: string): Promise<CreativeBriefRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_creative_briefs WHERE content_item_id::text = $1 AND tenant_id = $2 LIMIT 1`,
        [contentItemId, tenantId],
      );
      if (!rows[0]) return null;
      return {
        ...rows[0],
        estimated_provider_cost_usd: Number(rows[0].estimated_provider_cost_usd),
        spend_limit_usd: Number(rows[0].spend_limit_usd),
      } as CreativeBriefRecord;
    }
    const found = [...mem.creativeBriefs.values()].find((b) => b.content_item_id === contentItemId && b.tenant_id === tenantId);
    return found ?? null;
  }

  async function saveCreativeBrief(brief: CreativeBriefRecord): Promise<CreativeBriefRecord> {
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_creative_briefs (
           id, content_item_id, tenant_id, objective, target_audience, channel, placement,
           aspect_ratio, safe_areas, hook_message, intended_takeaway, cta, destination_url,
           brand_profile_id, brand_version, creative_mode, controls, reference_asset_ids,
           permitted_claims, evidence_refs, selected_provider, selected_model,
           estimated_provider_cost_usd, estimated_credits, spend_limit_usd, credit_ceiling,
           max_attempts, review_criteria, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,
           $19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
         )
         ON CONFLICT (content_item_id) DO UPDATE SET
           objective = EXCLUDED.objective,
           target_audience = EXCLUDED.target_audience,
           channel = EXCLUDED.channel,
           placement = EXCLUDED.placement,
           aspect_ratio = EXCLUDED.aspect_ratio,
           safe_areas = EXCLUDED.safe_areas,
           hook_message = EXCLUDED.hook_message,
           intended_takeaway = EXCLUDED.intended_takeaway,
           cta = EXCLUDED.cta,
           destination_url = EXCLUDED.destination_url,
           brand_profile_id = EXCLUDED.brand_profile_id,
           brand_version = EXCLUDED.brand_version,
           creative_mode = EXCLUDED.creative_mode,
           controls = EXCLUDED.controls,
           reference_asset_ids = EXCLUDED.reference_asset_ids,
           permitted_claims = EXCLUDED.permitted_claims,
           evidence_refs = EXCLUDED.evidence_refs,
           selected_provider = EXCLUDED.selected_provider,
           selected_model = EXCLUDED.selected_model,
           estimated_provider_cost_usd = EXCLUDED.estimated_provider_cost_usd,
           estimated_credits = EXCLUDED.estimated_credits,
           spend_limit_usd = EXCLUDED.spend_limit_usd,
           credit_ceiling = EXCLUDED.credit_ceiling,
           max_attempts = EXCLUDED.max_attempts,
           review_criteria = EXCLUDED.review_criteria,
           updated_at = EXCLUDED.updated_at`,
        [
          brief.id, brief.content_item_id, brief.tenant_id, brief.objective, brief.target_audience,
          brief.channel, brief.placement, brief.aspect_ratio, JSON.stringify(brief.safe_areas),
          brief.hook_message, brief.intended_takeaway, brief.cta, brief.destination_url,
          brief.brand_profile_id, brief.brand_version, brief.creative_mode, JSON.stringify(brief.controls),
          brief.reference_asset_ids, brief.permitted_claims, JSON.stringify(brief.evidence_refs),
          brief.selected_provider, brief.selected_model, brief.estimated_provider_cost_usd,
          brief.estimated_credits, brief.spend_limit_usd, brief.credit_ceiling, brief.max_attempts,
          brief.review_criteria, brief.created_at, brief.updated_at,
        ],
      );
    } else {
      mem.creativeBriefs.set(brief.content_item_id, structuredClone(brief));
    }
    return brief;
  }

  // ── Workflow Runs & Approval Events ─────────────────────────────────────────
  async function saveWorkflowRun(run: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_workflow_runs (
           id, tenant_id, content_item_id, workflow_type, status, parameters, node_executions,
           estimated_provider_cost_usd, actual_provider_cost_usd, estimated_credits, actual_credits,
           attempt_number, failure_reason, provenance, created_by, created_at, completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           node_executions = EXCLUDED.node_executions,
           actual_provider_cost_usd = EXCLUDED.actual_provider_cost_usd,
           actual_credits = EXCLUDED.actual_credits,
           failure_reason = EXCLUDED.failure_reason,
           provenance = EXCLUDED.provenance,
           completed_at = EXCLUDED.completed_at`,
        [
          run.id, run.tenant_id, run.content_item_id, run.workflow_type, run.status,
          JSON.stringify(run.parameters), JSON.stringify(run.node_executions),
          run.estimated_provider_cost_usd, run.actual_provider_cost_usd,
          run.estimated_credits, run.actual_credits, run.attempt_number,
          run.failure_reason, JSON.stringify(run.provenance), run.created_by,
          run.created_at, run.completed_at,
        ],
      );
    } else {
      mem.workflowRuns.set(run.id, structuredClone(run));
    }
    return run;
  }

  async function listWorkflowRuns(tenantId: string, contentItemId?: string): Promise<WorkflowRunRecord[]> {
    if (usePg()) {
      if (contentItemId) {
        const { rows } = await pool.query(
          `SELECT * FROM autopilot_workflow_runs WHERE tenant_id = $1 AND content_item_id = $2 ORDER BY created_at DESC`,
          [tenantId, contentItemId],
        );
        return rows.map((r: any) => ({ ...r, estimated_provider_cost_usd: Number(r.estimated_provider_cost_usd), actual_provider_cost_usd: Number(r.actual_provider_cost_usd) }));
      }
      const { rows } = await pool.query(`SELECT * FROM autopilot_workflow_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [tenantId]);
      return rows.map((r: any) => ({ ...r, estimated_provider_cost_usd: Number(r.estimated_provider_cost_usd), actual_provider_cost_usd: Number(r.actual_provider_cost_usd) }));
    }
    return [...mem.workflowRuns.values()]
      .filter((r) => r.tenant_id === tenantId && (!contentItemId || r.content_item_id === contentItemId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async function recordApprovalEvent(event: {
    tenant_id: string;
    content_item_id: string;
    action: string;
    from_state: string;
    to_state: string;
    actor_user_id: string | null;
    actor_name: string;
    actor_role: string;
    notes: string;
  }) {
    const id = randomUUID();
    const created_at = new Date().toISOString();
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_approval_events (id, tenant_id, content_item_id, action, from_state, to_state, actor_user_id, actor_name, actor_role, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, event.tenant_id, event.content_item_id, event.action, event.from_state, event.to_state, event.actor_user_id, event.actor_name, event.actor_role, event.notes, created_at],
      );
    } else {
      mem.approvalEvents.unshift({ id, ...event, created_at });
    }
    return { id, ...event, created_at };
  }

  async function listApprovalEvents(tenantId: string, contentItemId?: string) {
    if (usePg()) {
      if (contentItemId) {
        const { rows } = await pool.query(
          `SELECT * FROM autopilot_approval_events WHERE tenant_id = $1 AND content_item_id = $2 ORDER BY created_at DESC`,
          [tenantId, contentItemId],
        );
        return rows;
      }
      const { rows } = await pool.query(`SELECT * FROM autopilot_approval_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [tenantId]);
      return rows;
    }
    return mem.approvalEvents.filter((e) => e.tenant_id === tenantId && (!contentItemId || e.content_item_id === contentItemId));
  }

  // ── Publications & Idempotent Attempts ──────────────────────────────────────
  async function savePublication(pub: PublicationRecord): Promise<PublicationRecord> {
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_publications (
           id, tenant_id, content_item_id, channel, social_account_id, platform_media_type,
           slot_name, timezone, scheduled_at, status, remote_post_id, error_message, retryable,
           published_at, created_at, updated_at, paused, reconcile_required, acting_user_id,
           publish_idempotency_key, attempt_count, next_attempt_at, provider_container_id, permalink,
           error_code, submitted_at, processing_started_at, provider_response
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           scheduled_at = EXCLUDED.scheduled_at,
           timezone = EXCLUDED.timezone,
           status = EXCLUDED.status,
           remote_post_id = EXCLUDED.remote_post_id,
           error_message = EXCLUDED.error_message,
           retryable = EXCLUDED.retryable,
           published_at = EXCLUDED.published_at,
           updated_at = EXCLUDED.updated_at,
           paused = EXCLUDED.paused,
           reconcile_required = EXCLUDED.reconcile_required,
           attempt_count = EXCLUDED.attempt_count,
           next_attempt_at = EXCLUDED.next_attempt_at,
           provider_container_id = EXCLUDED.provider_container_id,
           permalink = EXCLUDED.permalink,
           error_code = EXCLUDED.error_code,
           submitted_at = EXCLUDED.submitted_at,
           processing_started_at = EXCLUDED.processing_started_at,
           provider_response = EXCLUDED.provider_response,
           version = autopilot_publications.version + 1`,
        [
          pub.id, pub.tenant_id, pub.content_item_id, pub.channel, pub.social_account_id,
          pub.platform_media_type, pub.slot_name, pub.timezone, pub.scheduled_at, pub.status,
          pub.remote_post_id, pub.error_message, pub.retryable, pub.published_at, pub.created_at, pub.updated_at,
          Boolean(pub.paused), Boolean(pub.reconcile_required), pub.acting_user_id ?? null,
          pub.publish_idempotency_key ?? null, pub.attempt_count ?? 0, pub.next_attempt_at ?? null,
          pub.provider_container_id ?? null, pub.permalink ?? null, pub.error_code ?? null,
          pub.submitted_at ?? null, pub.processing_started_at ?? null, JSON.stringify(pub.provider_response ?? {}),
        ],
      );
    } else {
      mem.publications.set(pub.id, structuredClone(pub));
    }
    return pub;
  }

  /**
   * Compare-and-set state change for the publishing worker. Succeeds only when
   * the row is still in one of `fromStatuses`, so two workers (or a worker and
   * a user action) cannot both move the same publication.
   */
  async function transitionPublication(
    tenantId: string,
    pubId: string,
    fromStatuses: string[],
    patch: Partial<PublicationRecord>,
  ): Promise<PublicationRecord | null> {
    const now = new Date().toISOString();
    if (usePg()) {
      const cols = Object.keys(patch).filter((k) => !['id', 'tenant_id', 'content_item_id', 'created_at', 'version'].includes(k));
      const sets = cols.map((c, i) => `${c} = $${i + 4}${c === 'provider_response' ? '::jsonb' : ''}`);
      const values = cols.map((c) => (c === 'provider_response' ? JSON.stringify((patch as any)[c] ?? {}) : (patch as any)[c]));
      const { rows } = await pool.query(
        `UPDATE autopilot_publications SET ${[...sets, 'updated_at = NOW()', 'version = version + 1'].join(', ')}
         WHERE id::text = $1 AND tenant_id = $2 AND status = ANY($3::text[])
         RETURNING *`,
        [pubId, tenantId, fromStatuses, ...values],
      );
      return (rows[0] as PublicationRecord) ?? null;
    }
    const pub = mem.publications.get(pubId);
    if (!pub || pub.tenant_id !== tenantId || !fromStatuses.includes(pub.status)) return null;
    Object.assign(pub, patch, { updated_at: now, version: (pub.version ?? 0) + 1 });
    return structuredClone(pub);
  }

  /**
   * Leases due publications with FOR UPDATE SKIP LOCKED, so concurrent workers
   * never pick the same row. Returns each row with the status it had before.
   */
  async function leaseDuePublications(workerId: string, limit = 10, leaseSeconds = 300): Promise<Array<PublicationRecord & { prior_status: string }>> {
    if (usePg()) {
      const { rows } = await pool.query(
        `WITH due AS (
           SELECT id, status AS prior_status FROM autopilot_publications
           WHERE paused IS NOT TRUE AND (
             (status IN ('scheduled','pending') AND scheduled_at IS NOT NULL AND scheduled_at <= NOW())
             OR (status IN ('retry_wait','remote_processing','reconciliation_required') AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW())
             OR (status IN ('claimed','submitting','publishing') AND (lease_expires_at IS NULL OR lease_expires_at < NOW()))
           )
           ORDER BY COALESCE(next_attempt_at, scheduled_at) ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE autopilot_publications p
         SET lease_owner = $1, lease_expires_at = NOW() + ($3 || ' seconds')::interval,
             status = CASE WHEN due.prior_status IN ('scheduled','pending','retry_wait') THEN 'claimed' ELSE p.status END,
             version = p.version + 1, updated_at = NOW()
         FROM due WHERE p.id = due.id
         RETURNING p.*, due.prior_status`,
        [workerId, limit, String(leaseSeconds)],
      );
      return rows as any;
    }
    const now = new Date().toISOString();
    const out: Array<PublicationRecord & { prior_status: string }> = [];
    for (const p of mem.publications.values()) {
      if (out.length >= limit || p.paused) continue;
      const due =
        (['scheduled', 'pending'].includes(p.status) && p.scheduled_at && p.scheduled_at <= now) ||
        (['retry_wait', 'remote_processing', 'reconciliation_required'].includes(p.status) && p.next_attempt_at && p.next_attempt_at <= now) ||
        (['claimed', 'submitting', 'publishing'].includes(p.status) && (!p.lease_expires_at || p.lease_expires_at < now));
      if (!due) continue;
      const prior = p.status;
      p.lease_owner = workerId;
      p.lease_expires_at = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      if (['scheduled', 'pending', 'retry_wait'].includes(prior)) p.status = 'claimed';
      p.version = (p.version ?? 0) + 1;
      out.push({ ...structuredClone(p), prior_status: prior });
    }
    return out;
  }

  // ── Generated media assets ──────────────────────────────────────────────────
  function rowToAsset(r: any): AutopilotAssetRecord {
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? null);
    return {
      ...r,
      byte_size: Number(r.byte_size),
      width: r.width === null ? null : Number(r.width),
      height: r.height === null ? null : Number(r.height),
      duration_ms: r.duration_ms === null ? null : Number(r.duration_ms),
      created_at: iso(r.created_at),
      deleted_at: iso(r.deleted_at),
      delivery_verified_at: iso(r.delivery_verified_at),
      expires_at: iso(r.expires_at),
    } as AutopilotAssetRecord;
  }

  async function saveAsset(asset: AutopilotAssetRecord): Promise<AutopilotAssetRecord> {
    if (usePg()) {
      const { rows } = await pool.query(
        `INSERT INTO autopilot_assets (
           id, tenant_id, content_item_id, workflow_run_id, slot, storage_driver, storage_key, sha256,
           mime_type, media_type, byte_size, width, height, duration_ms, video_codec, provider, model,
           provider_request_id, provenance, is_demo, qa_state, delivery_verified_at, delivery_error,
           retention_class, expires_at, created_at, deleted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27)
         ON CONFLICT (tenant_id, storage_key) DO UPDATE SET
           delivery_verified_at = COALESCE(EXCLUDED.delivery_verified_at, autopilot_assets.delivery_verified_at),
           delivery_error = EXCLUDED.delivery_error,
           qa_state = EXCLUDED.qa_state,
           retention_class = EXCLUDED.retention_class,
           deleted_at = EXCLUDED.deleted_at
         RETURNING *`,
        [
          asset.id, asset.tenant_id, asset.content_item_id, asset.workflow_run_id, asset.slot, asset.storage_driver,
          asset.storage_key, asset.sha256, asset.mime_type, asset.media_type, asset.byte_size, asset.width, asset.height,
          asset.duration_ms, asset.video_codec, asset.provider, asset.model, asset.provider_request_id,
          JSON.stringify(asset.provenance ?? {}), asset.is_demo, asset.qa_state, asset.delivery_verified_at,
          asset.delivery_error, asset.retention_class, asset.expires_at, asset.created_at, asset.deleted_at,
        ],
      );
      return rowToAsset(rows[0]);
    }
    const existing = [...mem.assets.values()].find((a) => a.tenant_id === asset.tenant_id && a.storage_key === asset.storage_key);
    const merged = existing ? { ...existing, ...asset, id: existing.id } : asset;
    mem.assets.set(merged.id, structuredClone(merged));
    return structuredClone(merged);
  }

  async function getAsset(tenantId: string, assetId: string): Promise<AutopilotAssetRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_assets WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [assetId, tenantId]);
      return rows[0] ? rowToAsset(rows[0]) : null;
    }
    const a = mem.assets.get(assetId);
    return a && a.tenant_id === tenantId ? structuredClone(a) : null;
  }

  async function findAssetByKey(tenantId: string, storageKey: string): Promise<AutopilotAssetRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_assets WHERE tenant_id = $1 AND storage_key = $2 LIMIT 1`, [tenantId, storageKey]);
      return rows[0] ? rowToAsset(rows[0]) : null;
    }
    const a = [...mem.assets.values()].find((x) => x.tenant_id === tenantId && x.storage_key === storageKey);
    return a ? structuredClone(a) : null;
  }

  async function getAssetsByIds(tenantId: string, ids: string[]): Promise<Map<string, AutopilotAssetRecord | null>> {
    const out = new Map<string, AutopilotAssetRecord | null>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return out;
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_assets WHERE tenant_id = $1 AND id::text = ANY($2::text[])`, [tenantId, unique]);
      for (const id of unique) out.set(id, null);
      for (const r of rows) out.set(String(r.id), rowToAsset(r));
      return out;
    }
    for (const id of unique) {
      const a = mem.assets.get(id);
      out.set(id, a && a.tenant_id === tenantId ? structuredClone(a) : null);
    }
    return out;
  }

  async function updateAssetDelivery(tenantId: string, assetId: string, verifiedAt: string | null, error: string | null) {
    if (usePg()) {
      await pool.query(
        `UPDATE autopilot_assets SET delivery_verified_at = $3, delivery_error = $4 WHERE id::text = $1 AND tenant_id = $2`,
        [assetId, tenantId, verifiedAt, error],
      );
      return;
    }
    const a = mem.assets.get(assetId);
    if (a && a.tenant_id === tenantId) Object.assign(a, { delivery_verified_at: verifiedAt, delivery_error: error });
  }

  async function findWorkflowRunByIdempotencyKey(tenantId: string, contentItemId: string, key: string): Promise<WorkflowRunRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_workflow_runs WHERE tenant_id = $1 AND content_item_id::text = $2 AND parameters->>'idempotency_key' = $3 LIMIT 1`,
        [tenantId, contentItemId, key],
      );
      return rows[0] ? ({ ...rows[0], estimated_provider_cost_usd: Number(rows[0].estimated_provider_cost_usd), actual_provider_cost_usd: Number(rows[0].actual_provider_cost_usd) } as WorkflowRunRecord) : null;
    }
    const r = [...mem.workflowRuns.values()].find((x) => x.tenant_id === tenantId && x.content_item_id === contentItemId && x.parameters?.idempotency_key === key);
    return r ? structuredClone(r) : null;
  }

  async function getPublication(tenantId: string, pubId: string): Promise<PublicationRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_publications WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [pubId, tenantId]);
      return (rows[0] as PublicationRecord) ?? null;
    }
    const pub = mem.publications.get(pubId);
    return pub && pub.tenant_id === tenantId ? pub : null;
  }

  async function listPublications(tenantId: string, contentItemId?: string): Promise<PublicationRecord[]> {
    if (usePg()) {
      if (contentItemId) {
        const { rows } = await pool.query(
          `SELECT * FROM autopilot_publications WHERE tenant_id = $1 AND content_item_id = $2 ORDER BY created_at DESC`,
          [tenantId, contentItemId],
        );
        return rows as PublicationRecord[];
      }
      const { rows } = await pool.query(`SELECT * FROM autopilot_publications WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [tenantId]);
      return rows as PublicationRecord[];
    }
    return [...mem.publications.values()]
      .filter((p) => p.tenant_id === tenantId && (!contentItemId || p.content_item_id === contentItemId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async function findAttemptByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<PublicationAttemptRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_publication_attempts WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [tenantId, idempotencyKey],
      );
      return (rows[0] as PublicationAttemptRecord) ?? null;
    }
    const found = [...mem.publicationAttempts.values()].find((a) => a.tenant_id === tenantId && a.idempotency_key === idempotencyKey);
    return found ?? null;
  }

  async function listPublicationAttempts(tenantId: string, publicationId: string): Promise<PublicationAttemptRecord[]> {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_publication_attempts WHERE tenant_id = $1 AND publication_id = $2 ORDER BY attempt_number DESC`,
        [tenantId, publicationId],
      );
      return rows as PublicationAttemptRecord[];
    }
    return [...mem.publicationAttempts.values()]
      .filter((a) => a.tenant_id === tenantId && a.publication_id === publicationId)
      .sort((a, b) => b.attempt_number - a.attempt_number);
  }

  async function savePublicationAttempt(attempt: PublicationAttemptRecord): Promise<PublicationAttemptRecord> {
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_publication_attempts (
           id, tenant_id, publication_id, idempotency_key, attempt_number, status,
           request_meta, response_meta, error_message, retryable, next_retry_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
        [
          attempt.id, attempt.tenant_id, attempt.publication_id, attempt.idempotency_key,
          attempt.attempt_number, attempt.status, JSON.stringify(attempt.request_meta),
          JSON.stringify(attempt.response_meta), attempt.error_message, attempt.retryable,
          attempt.next_retry_at, attempt.created_at,
        ],
      );
    } else {
      mem.publicationAttempts.set(attempt.id, structuredClone(attempt));
    }
    return attempt;
  }

  // ── Channel Metrics, Recommendations & Experiments ──────────────────────────
  async function ingestChannelMetric(metric: {
    tenant_id: string;
    content_item_id: string | null;
    publication_id: string | null;
    channel: string;
    objective: string;
    pillar_name: string;
    format: string;
    metrics: Record<string, number>;
    window_start?: string | null;
    window_end?: string | null;
    source?: string;
  }) {
    const id = randomUUID();
    const collected_at = new Date().toISOString();
    const row = { id, ...metric, source: metric.source ?? 'platform_api', collected_at };
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_channel_metrics (id, tenant_id, content_item_id, publication_id, channel, objective, pillar_name, format, metrics, window_start, window_end, source, collected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
        [
          id, metric.tenant_id, metric.content_item_id, metric.publication_id, metric.channel,
          metric.objective, metric.pillar_name, metric.format, JSON.stringify(metric.metrics),
          metric.window_start ?? null, metric.window_end ?? null, row.source, collected_at,
        ],
      );
    } else {
      mem.channelMetrics.unshift(row);
    }
    return row;
  }

  async function listChannelMetrics(tenantId: string) {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_channel_metrics WHERE tenant_id = $1 ORDER BY collected_at DESC LIMIT 200`, [tenantId]);
      return rows;
    }
    return mem.channelMetrics.filter((m) => m.tenant_id === tenantId);
  }

  async function saveRecommendation(rec: Record<string, any>) {
    const id = rec.id || randomUUID();
    const created_at = rec.created_at || new Date().toISOString();
    const full: Record<string, any> = { ...rec, id, created_at };
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_recommendations (
           id, tenant_id, strategy_id, category, title, summary, evidence, sample_size,
           confidence, proposed_patch, attribution_note, status, decided_by, decided_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           decided_by = EXCLUDED.decided_by,
           decided_at = EXCLUDED.decided_at`,
        [
          full.id, full.tenant_id, full.strategy_id ?? null, full.category, full.title,
          full.summary, JSON.stringify(full.evidence ?? {}), full.sample_size ?? 0,
          full.confidence ?? 0, JSON.stringify(full.proposed_patch ?? {}),
          full.attribution_note ?? '', full.status ?? 'pending',
          full.decided_by ?? null, full.decided_at ?? null, full.created_at,
        ],
      );
    } else {
      mem.recommendations.set(full.id, structuredClone(full));
    }
    return full;
  }

  async function listRecommendations(tenantId: string) {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_recommendations WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
      return rows.map((r: any) => ({ ...r, confidence: Number(r.confidence) }));
    }
    return [...mem.recommendations.values()].filter((r) => r.tenant_id === tenantId);
  }

  async function getRecommendation(tenantId: string, recId: string) {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_recommendations WHERE id::text = $1 AND tenant_id = $2 LIMIT 1`, [recId, tenantId]);
      return rows[0] ? { ...rows[0], confidence: Number(rows[0].confidence) } : null;
    }
    const r = mem.recommendations.get(recId);
    return r && r.tenant_id === tenantId ? r : null;
  }

  async function saveExperiment(exp: Record<string, any>) {
    const now = new Date().toISOString();
    const full = {
      id: exp.id || randomUUID(),
      tenant_id: exp.tenant_id,
      strategy_id: exp.strategy_id ?? null,
      hypothesis: exp.hypothesis,
      variable_changed: exp.variable_changed,
      control_variant: exp.control_variant ?? {},
      test_variant: exp.test_variant ?? {},
      channel: exp.channel ?? 'instagram',
      audience_segment: exp.audience_segment ?? '',
      primary_metric: exp.primary_metric ?? 'saves',
      min_sample_size: exp.min_sample_size ?? 6,
      current_sample_size: exp.current_sample_size ?? 0,
      status: exp.status ?? 'proposed',
      result: exp.result ?? {},
      started_at: exp.started_at ?? null,
      ended_at: exp.ended_at ?? null,
      created_by: exp.created_by,
      created_at: exp.created_at || now,
      updated_at: now,
    };
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_experiments (
           id, tenant_id, strategy_id, hypothesis, variable_changed, control_variant, test_variant,
           channel, audience_segment, primary_metric, min_sample_size, current_sample_size, status,
           result, started_at, ended_at, created_by, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO UPDATE SET
           current_sample_size = EXCLUDED.current_sample_size,
           status = EXCLUDED.status,
           result = EXCLUDED.result,
           started_at = EXCLUDED.started_at,
           ended_at = EXCLUDED.ended_at,
           updated_at = EXCLUDED.updated_at`,
        [
          full.id, full.tenant_id, full.strategy_id, full.hypothesis, full.variable_changed,
          JSON.stringify(full.control_variant), JSON.stringify(full.test_variant),
          full.channel, full.audience_segment, full.primary_metric, full.min_sample_size,
          full.current_sample_size, full.status, JSON.stringify(full.result),
          full.started_at, full.ended_at, full.created_by, full.created_at, full.updated_at,
        ],
      );
    } else {
      mem.experiments.set(full.id, structuredClone(full));
    }
    return full;
  }

  async function listExperiments(tenantId: string) {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_experiments WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
      return rows;
    }
    return [...mem.experiments.values()].filter((e) => e.tenant_id === tenantId);
  }

  async function claimPublicationForExecution(tenantId: string, pubId: string): Promise<PublicationRecord | null> {
    if (usePg()) {
      const { rows } = await pool.query(
        `UPDATE autopilot_publications
         SET status = 'publishing', updated_at = NOW()
         WHERE id::text = $1 AND tenant_id = $2 AND status IN ('pending', 'scheduled', 'publish_failed')
         RETURNING *`,
        [pubId, tenantId],
      );
      return (rows[0] as PublicationRecord) ?? null;
    }
    const pub = mem.publications.get(pubId);
    if (!pub || pub.tenant_id !== tenantId || !['pending', 'scheduled', 'publish_failed'].includes(pub.status)) {
      return null;
    }
    pub.status = 'publishing';
    pub.updated_at = new Date().toISOString();
    return structuredClone(pub);
  }

  async function listDuePublications(limit = 10): Promise<PublicationRecord[]> {
    if (usePg()) {
      const { rows } = await pool.query(
        `SELECT * FROM autopilot_publications
         WHERE status = 'scheduled'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= NOW()
           AND (paused IS NOT TRUE)
         ORDER BY scheduled_at ASC
         LIMIT $1`,
        [limit],
      );
      return rows as PublicationRecord[];
    }
    const now = new Date().toISOString();
    return [...mem.publications.values()]
      .filter((p) => p.status === 'scheduled' && p.scheduled_at && p.scheduled_at <= now && !p.paused)
      .slice(0, limit);
  }

  async function recordContentItemRevision(
    tenantId: string,
    contentItemId: string,
    version: number,
    snapshot: any,
    changeRationale: string,
    createdBy: string,
  ) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    if (usePg()) {
      await pool.query(
        `INSERT INTO autopilot_content_item_revisions (id, tenant_id, content_item_id, version, snapshot, change_rationale, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
         ON CONFLICT (tenant_id, content_item_id, version) DO UPDATE SET
           snapshot = EXCLUDED.snapshot,
           change_rationale = EXCLUDED.change_rationale`,
        [id, tenantId, contentItemId, version, JSON.stringify(snapshot), changeRationale, createdBy, createdAt],
      );
    }
    return { id, tenant_id: tenantId, content_item_id: contentItemId, version, snapshot, change_rationale: changeRationale, created_by: createdBy, created_at: createdAt };
  }

  async function exportTenantAutopilotData(tenantId: string) {
    const strategy = await getLatestStrategy(tenantId);
    const strategyVersions = strategy ? await listStrategyVersions(tenantId, strategy.id) : [];
    const [business, brand, brandVersions, tokens, assets, items, briefs, runs, pubs, metrics, recommendations, experiments, audit] = await Promise.all([
      getBusinessProfile(tenantId),
      getBrandProfile(tenantId),
      listBrandVersions(tenantId),
      listBrandTokens(tenantId),
      listBrandAssets(tenantId),
      listContentItems(tenantId),
      usePg() ? pool.query('SELECT * FROM autopilot_creative_briefs WHERE tenant_id = $1', [tenantId]).then((r: any) => r.rows).catch(() => []) : [...mem.creativeBriefs.values()].filter((b) => b.tenant_id === tenantId),
      listWorkflowRuns(tenantId),
      listPublications(tenantId),
      listChannelMetrics(tenantId),
      listRecommendations(tenantId),
      listExperiments(tenantId),
      listAuditEvents(tenantId, 500),
    ]);
    return {
      exported_at: new Date().toISOString(),
      tenant_id: tenantId,
      business_profile: business,
      brand_profile: brand,
      brand_versions: brandVersions,
      brand_tokens: tokens,
      brand_assets: assets,
      current_strategy: strategy,
      strategy_versions: strategyVersions,
      content_items: items,
      creative_briefs: briefs,
      workflow_runs: runs,
      publications: pubs,
      channel_metrics: metrics,
      recommendations,
      experiments,
      audit_events: audit,
    };
  }

  // Retention & GDPR/Tenant data deletion control (Section 13)
  async function purgeTenantAutopilotData(tenantId: string) {
    if (usePg()) {
      await pool.query(`DELETE FROM autopilot_website_scans WHERE tenant_id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM autopilot_asset_blobs WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_assets WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_budget_reservations WHERE tenant_id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM autopilot_tenant_controls WHERE tenant_id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM autopilot_content_item_revisions WHERE tenant_id = $1`, [tenantId]).catch(() => {});
      await pool.query(`DELETE FROM autopilot_publication_attempts WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_publications WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_approval_events WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_workflow_runs WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_creative_briefs WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_content_items WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_experiments WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_recommendations WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_channel_metrics WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_strategy_versions WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_strategies WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_brand_tokens WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_brand_assets WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_brand_versions WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_brand_profiles WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_business_profiles WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM autopilot_audit_events WHERE tenant_id = $1`, [tenantId]);
      return;
    }

    mem.businessProfiles.delete(tenantId);
    mem.brandProfiles.delete(tenantId);
    mem.brandVersions = mem.brandVersions.filter((v) => v.tenant_id !== tenantId);
    for (const [k, v] of mem.brandTokens) if (v.tenant_id === tenantId) mem.brandTokens.delete(k);
    for (const [k, v] of mem.brandAssets) if (v.tenant_id === tenantId) mem.brandAssets.delete(k);
    for (const [k, v] of mem.strategies) if (v.tenant_id === tenantId) mem.strategies.delete(k);
    mem.strategyVersions = mem.strategyVersions.filter((v) => v.tenant_id !== tenantId);
    for (const [k, v] of mem.contentItems) if (v.tenant_id === tenantId) mem.contentItems.delete(k);
    for (const [k, v] of mem.creativeBriefs) if (v.tenant_id === tenantId) mem.creativeBriefs.delete(k);
    for (const [k, v] of mem.workflowRuns) if (v.tenant_id === tenantId) mem.workflowRuns.delete(k);
    mem.approvalEvents = mem.approvalEvents.filter((e) => e.tenant_id !== tenantId);
    for (const [k, v] of mem.publications) if (v.tenant_id === tenantId) mem.publications.delete(k);
    for (const [k, v] of mem.publicationAttempts) if (v.tenant_id === tenantId) mem.publicationAttempts.delete(k);
    mem.channelMetrics = mem.channelMetrics.filter((m) => m.tenant_id !== tenantId);
    for (const [k, v] of mem.experiments) if (v.tenant_id === tenantId) mem.experiments.delete(k);
    for (const [k, v] of mem.recommendations) if (v.tenant_id === tenantId) mem.recommendations.delete(k);
    mem.auditEvents = mem.auditEvents.filter((a) => a.tenant_id !== tenantId);
    for (const [k, v] of mem.assets) if (v.tenant_id === tenantId) mem.assets.delete(k);
  }

  async function listTenantAssetKeys(tenantId: string): Promise<Array<{ storage_driver: string; storage_key: string }>> {
    if (usePg()) {
      const { rows } = await pool.query(`SELECT storage_driver, storage_key FROM autopilot_assets WHERE tenant_id = $1`, [tenantId]);
      return rows;
    }
    return [...mem.assets.values()].filter((a) => a.tenant_id === tenantId).map((a) => ({ storage_driver: a.storage_driver, storage_key: a.storage_key }));
  }

  return {
    recordAudit,
    listAuditEvents,
    getBusinessProfile,
    upsertBusinessProfile,
    getBrandProfile,
    upsertBrandProfile,
    listBrandVersions,
    listBrandTokens,
    saveBrandTokens,
    updateBrandToken,
    listBrandAssets,
    getBrandAssetById,
    addBrandAsset,
    deleteBrandAsset,
    deleteBrandToken,
    getLatestStrategy,
    getStrategyById,
    saveStrategy,
    listStrategyVersions,
    listContentItems,
    getContentItem,
    saveContentItem,
    getCreativeBrief,
    saveCreativeBrief,
    saveWorkflowRun,
    listWorkflowRuns,
    recordApprovalEvent,
    listApprovalEvents,
    savePublication,
    getPublication,
    listPublications,
    findAttemptByIdempotencyKey,
    listPublicationAttempts,
    savePublicationAttempt,
    ingestChannelMetric,
    listChannelMetrics,
    saveRecommendation,
    listRecommendations,
    getRecommendation,
    saveExperiment,
    listExperiments,
    claimPublicationForExecution,
    listDuePublications,
    transitionPublication,
    leaseDuePublications,
    saveAsset,
    getAsset,
    findAssetByKey,
    getAssetsByIds,
    updateAssetDelivery,
    findWorkflowRunByIdempotencyKey,
    listTenantAssetKeys,
    recordContentItemRevision,
    exportTenantAutopilotData,
    purgeTenantAutopilotData,
  };
}

export type AutopilotRepository = ReturnType<typeof createAutopilotRepository>;
