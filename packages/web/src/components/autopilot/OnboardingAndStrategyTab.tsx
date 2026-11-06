import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Field,
  Loading,
  Notice,
  SectionHeading,
  StatGrid,
  StatTile,
  Toggle,
} from '../ui';
import { autopilotService } from '../../services/autopilotService';

const BUSINESS_MODELS = [
  'B2B', 'B2C', 'B2B2C', 'saas', 'ecommerce', 'local_service',
  'professional_services', 'education', 'hospitality', 'nonprofit',
  'creator', 'media', 'healthcare', 'finance', 'marketplace', 'other',
];

const OBJECTIVES = [
  'awareness', 'education', 'engagement', 'lead_generation', 'sales',
  'retention', 'hiring', 'community', 'launches', 'thought_leadership',
];

const RISK_CATEGORIES = [
  'standard', 'healthcare', 'finance', 'legal', 'employment', 'age_restricted', 'children_sensitive', 'custom',
];

const CHANNELS = ['instagram', 'linkedin', 'facebook', 'twitter', 'tiktok', 'pinterest', 'wordpress'];

const INDUSTRY_PRESETS = [
  {
    id: 'b2b_saas',
    label: 'B2B SaaS',
    industry: 'B2B SaaS',
    niche: 'Developer tooling & cloud infrastructure',
    businessModel: 'saas',
    primaryOffer: 'Self-serve cloud automation platform',
    priceRange: '$99–$499/month',
    audienceSegment: 'Engineering Leads & DevOps Directors',
    audienceRole: 'VP of Engineering',
    audienceJob: 'Eliminate manual release errors and reduce deployment cycle time',
    primaryObjective: 'lead_generation',
    successMetric: 'Qualified self-serve trial activations',
    preferredChannels: ['linkedin', 'twitter'],
    riskCategory: 'standard',
    proofType: 'demo' as const,
    proofSummary: 'Automated 1-click zero-downtime deployment screen capture',
  },
  {
    id: 'healthcare',
    label: 'Healthcare & Wellness',
    industry: 'Healthcare',
    niche: 'Preventive digital health & physiotherapy',
    businessModel: 'local_service',
    primaryOffer: 'Personalized evidence-based recovery program',
    priceRange: '$150/session',
    audienceSegment: 'Active adults recovering from mobility injuries',
    audienceRole: 'Patient / Health Consumer',
    audienceJob: 'Restore painless movement without surgery',
    primaryObjective: 'education',
    successMetric: 'Educational saves & verified clinic inquiries',
    preferredChannels: ['instagram', 'facebook'],
    riskCategory: 'healthcare',
    proofType: 'case_study' as const,
    proofSummary: 'Verified clinical outcome study on range-of-motion recovery',
  },
  {
    id: 'finance',
    label: 'Regulated Finance',
    industry: 'Finance',
    niche: 'Treasury & cross-border FX hedging for SMEs',
    businessModel: 'professional_services',
    primaryOffer: 'Automated FX exposure risk mitigation',
    priceRange: 'Basis points on settled volume',
    audienceSegment: 'CFOs and Controllers at import/export companies',
    audienceRole: 'Chief Financial Officer',
    audienceJob: 'Protect operating margins from currency volatility',
    primaryObjective: 'thought_leadership',
    successMetric: 'Consultation requests from certified SME finance teams',
    preferredChannels: ['linkedin'],
    riskCategory: 'finance',
    proofType: 'data' as const,
    proofSummary: 'Audited benchmark demonstrating margin preservation during currency swings',
  },
  {
    id: 'ecommerce',
    label: 'Ecommerce & DTC',
    industry: 'Ecommerce',
    niche: 'Clean sustainable skincare formulations',
    businessModel: 'ecommerce',
    primaryOffer: 'Microbiome-friendly daily essentials bundle',
    priceRange: '$35–$85',
    audienceSegment: 'Eco-conscious skincare enthusiasts',
    audienceRole: 'Consumer Shopper',
    audienceJob: 'Soothe reactive barrier without synthetic fragrances',
    primaryObjective: 'sales',
    successMetric: 'Add-to-cart clicks and unboxing saves',
    preferredChannels: ['instagram', 'tiktok', 'pinterest'],
    riskCategory: 'standard',
    proofType: 'portfolio' as const,
    proofSummary: 'Lab-tested ingredient breakdown and dermatological patch tests',
  },
  {
    id: 'local_service',
    label: 'Local Services',
    industry: 'Local Services',
    niche: 'Commercial HVAC & electrical engineering',
    businessModel: 'local_service',
    primaryOffer: 'Preventative quarterly building maintenance contract',
    priceRange: '$500–$2,500/quarter',
    audienceSegment: 'Commercial property managers and facility heads',
    audienceRole: 'Facilities Director',
    audienceJob: 'Prevent costly emergency cooling failures during heat spikes',
    primaryObjective: 'lead_generation',
    successMetric: 'Scheduled on-site building audits',
    preferredChannels: ['linkedin', 'facebook'],
    riskCategory: 'standard',
    proofType: 'case_study' as const,
    proofSummary: 'Before-after thermal audit of commercial distribution hub',
  },
  {
    id: 'education',
    label: 'Education & Coaching',
    industry: 'Education',
    niche: 'Data engineering & AI infrastructure bootcamp',
    businessModel: 'education',
    primaryOffer: '12-week part-time production data systems accelerator',
    priceRange: '$2,800 tuition',
    audienceSegment: 'Software engineers transitioning to data engineering',
    audienceRole: 'Mid-Level Software Engineer',
    audienceJob: 'Build portfolio of real production pipelines to land senior roles',
    primaryObjective: 'education',
    successMetric: 'Syllabus downloads and application submissions',
    preferredChannels: ['linkedin', 'twitter', 'instagram'],
    riskCategory: 'standard',
    proofType: 'review' as const,
    proofSummary: 'Consented graduate career outcomes and salary progression audit',
  },
  {
    id: 'creator',
    label: 'Creator & Media',
    industry: 'Creator',
    niche: 'Design systems and product architecture newsletter',
    businessModel: 'creator',
    primaryOffer: 'Weekly deep-dive newsletter & Figma component kit',
    priceRange: '$12/month or $99/year',
    audienceSegment: 'Product designers and frontend developers',
    audienceRole: 'Senior Product Designer',
    audienceJob: 'Master component tokens and multi-brand design architectures',
    primaryObjective: 'awareness',
    successMetric: 'Newsletter subscriptions and social shares',
    preferredChannels: ['twitter', 'linkedin', 'instagram'],
    riskCategory: 'standard',
    proofType: 'portfolio' as const,
    proofSummary: 'Interactive token architecture preview and case teardowns',
  },
  {
    id: 'hospitality',
    label: 'Hospitality & Dining',
    industry: 'Hospitality',
    niche: 'Boutique farm-to-table culinary retreats',
    businessModel: 'hospitality',
    primaryOffer: 'Seasonal weekend tasting retreat & workshop',
    priceRange: '$450/guest',
    audienceSegment: 'Food lovers and urban professionals seeking culinary escapes',
    audienceRole: 'Guest / Experience Buyer',
    audienceJob: 'Unplug and experience authentic seasonal culinary craftsmanship',
    primaryObjective: 'engagement',
    successMetric: 'Weekend retreat reservations and waitlist joins',
    preferredChannels: ['instagram', 'facebook'],
    riskCategory: 'standard',
    proofType: 'portfolio' as const,
    proofSummary: 'Photographic seasonal menu audit and guest experience footage',
  },
];

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Accra',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Hong_Kong',
  'Australia/Sydney',
];

interface Props {
  onRefreshOverview: () => void;
  onOpenCreativeQueue: () => void;
  onOpenBrandStudio: () => void;
}

export default function OnboardingAndStrategyTab({
  onRefreshOverview,
  onOpenCreativeQueue,
  onOpenBrandStudio,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [businessName, setBusinessName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [niche, setNiche] = useState('');
  const [businessModel, setBusinessModel] = useState('B2B');
  const [primaryOffer, setPrimaryOffer] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [audienceSegment, setAudienceSegment] = useState('');
  const [audienceRole, setAudienceRole] = useState('Decision Maker');
  const [audienceJob, setAudienceJob] = useState('');
  const [primaryObjective, setPrimaryObjective] = useState('lead_generation');
  const [successMetric, setSuccessMetric] = useState('');
  const [preferredChannels, setPreferredChannels] = useState<string[]>(['instagram', 'linkedin']);
  const [desiredCadence, setDesiredCadence] = useState('recommend');
  const [weeklyHours, setWeeklyHours] = useState(4);
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(50);
  const [monthlyCreditCap, setMonthlyCreditCap] = useState(1000);
  const [hasProductDemos, setHasProductDemos] = useState(false);
  const [hasFounderFootage, setHasFounderFootage] = useState(false);
  const [hasPhotography, setHasPhotography] = useState(false);
  const [hasCustomerPermissions, setHasCustomerPermissions] = useState(false);
  const [approvalMode, setApprovalMode] = useState<'mandatory' | 'risk_based' | 'streamlined_evergreen'>('mandatory');
  const [riskCategory, setRiskCategory] = useState('standard');
  const [jurisdiction, setJurisdiction] = useState('');
  const [proofSummary, setProofSummary] = useState('');
  const [proofType, setProofType] = useState<'demo' | 'case_study' | 'review' | 'data' | 'portfolio'>('demo');
  const [availableProof, setAvailableProof] = useState<any[]>([]);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [blackoutDatesInput, setBlackoutDatesInput] = useState('');
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [newBlackoutDate, setNewBlackoutDate] = useState('');

  const [followUpQuestions, setFollowUpQuestions] = useState<any[]>([]);
  const [strategy, setStrategy] = useState<any | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [batchSize, setBatchSize] = useState(4);
  const [batchCreativeMode, setBatchCreativeMode] = useState<'strict_brand' | 'brand_inspired' | 'creative_freedom'>('brand_inspired');

  const hydrateFromProfile = useCallback((p: any) => {
    if (!p) return;
    setBusinessName(p.business_name || '');
    setWebsiteUrl(p.website_url || '');
    setIndustry(p.industry || '');
    setNiche(p.niche || '');
    setBusinessModel(p.business_model || 'B2B');
    setPrimaryOffer(p.primary_offer || '');
    setPriceRange(p.price_range || '');
    if (p.audiences?.[0]) {
      setAudienceSegment(p.audiences[0].segment || '');
      setAudienceRole(p.audiences[0].role || 'Decision Maker');
      setAudienceJob(p.audiences[0].jobs_to_be_done?.[0] || '');
    }
    setPrimaryObjective(p.primary_objective || 'lead_generation');
    setSuccessMetric(p.success_metric || '');
    if (p.channels?.preferred?.length) setPreferredChannels(p.channels.preferred);
    if (p.channels?.desired_cadence) setDesiredCadence(p.channels.desired_cadence);
    if (p.capacity) {
      setWeeklyHours(p.capacity.weekly_hours ?? 4);
      setMonthlyBudgetUsd(p.capacity.monthly_budget_usd ?? 50);
      setMonthlyCreditCap(p.capacity.monthly_credit_cap ?? 1000);
      setHasProductDemos(Boolean(p.capacity.has_product_demos));
      setHasFounderFootage(Boolean(p.capacity.has_founder_footage));
      setHasPhotography(Boolean(p.capacity.has_photography));
      setHasCustomerPermissions(Boolean(p.capacity.has_customer_permissions));
      setApprovalMode(p.capacity.approval_mode || 'mandatory');
    }
    if (p.risk_profile) {
      setRiskCategory(p.risk_profile.category || 'standard');
      setJurisdiction(p.risk_profile.jurisdiction || '');
    }
    setAvailableProof(Array.isArray(p.available_proof) ? p.available_proof : []);
    if (p.schedule_config?.timezone) setTimezone(p.schedule_config.timezone);
    if (Array.isArray(p.schedule_config?.blackout_dates)) {
      setBlackoutDates(p.schedule_config.blackout_dates);
      setBlackoutDatesInput(p.schedule_config.blackout_dates.join(', '));
    }
  }, []);

  const handleAddBlackoutDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newBlackoutDate)) return;
    if (!blackoutDates.includes(newBlackoutDate)) {
      const updated = [...blackoutDates, newBlackoutDate].sort();
      setBlackoutDates(updated);
      setBlackoutDatesInput(updated.join(', '));
    }
    setNewBlackoutDate('');
  };

  const handleRemoveBlackoutDate = (d: string) => {
    const updated = blackoutDates.filter((x) => x !== d);
    setBlackoutDates(updated);
    setBlackoutDatesInput(updated.join(', '));
  };

  const handleSelectPreset = (preset: (typeof INDUSTRY_PRESETS)[0]) => {
    setIndustry(preset.industry);
    setNiche(preset.niche);
    setBusinessModel(preset.businessModel);
    setPrimaryOffer(preset.primaryOffer);
    setPriceRange(preset.priceRange);
    setAudienceSegment(preset.audienceSegment);
    setAudienceRole(preset.audienceRole);
    setAudienceJob(preset.audienceJob);
    setPrimaryObjective(preset.primaryObjective);
    setSuccessMetric(preset.successMetric);
    setPreferredChannels(preset.preferredChannels);
    setRiskCategory(preset.riskCategory);
    if (!businessName.trim()) {
      setBusinessName(`My ${preset.label} Brand`);
    }
    setAvailableProof([
      {
        id: `proof_${Date.now().toString(36)}`,
        type: preset.proofType,
        summary: preset.proofSummary,
        verified: true,
        permission_confirmed: true,
      },
    ]);
    setStatusNote(`Loaded "${preset.label}" industry profile preset with tailored audience, channels, and proof asset.`);
  };

  const handlePauseStrategy = async () => {
    if (!strategy?.id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await autopilotService.updateStrategy(strategy.id, { status: 'paused' });
      setStrategy(res.strategy);
      setStatusNote(`Strategy v${res.strategy.current_version} is now paused.`);
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to pause strategy');
    } finally {
      setSaving(false);
    }
  };

  const handleRejectStrategy = async () => {
    if (!strategy?.id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await autopilotService.updateStrategy(strategy.id, { status: 'rejected' });
      setStrategy(res.strategy);
      setStatusNote(`Strategy marked as rejected. Edit parameters and re-generate.`);
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to reject strategy');
    } finally {
      setSaving(false);
    }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bizRes, stratRes, prefillRes] = await Promise.all([
        autopilotService.getBusinessProfile(),
        autopilotService.getStrategy(),
        autopilotService.getPrefillContext().catch(() => ({ prefill: null })),
      ]);

      if (bizRes.profile) {
        hydrateFromProfile(bizRes.profile);
        setFollowUpQuestions(bizRes.follow_up_questions || []);
      } else if (prefillRes.prefill) {
        const lb = prefillRes.prefill.legacy_brand;
        if (lb) {
          setBusinessName(lb.name || '');
          setWebsiteUrl(lb.website_url || '');
          setIndustry(lb.industry || '');
          setAudienceSegment(lb.target_audience || '');
        }
        if (prefillRes.prefill.connected_channels?.length) {
          setPreferredChannels(prefillRes.prefill.connected_channels);
        }
      }

      setStrategy(stratRes.strategy || null);
      setVersions(stratRes.versions || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load business profile and strategy');
    } finally {
      setLoading(false);
    }
  }, [hydrateFromProfile]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const toggleChannel = (ch: string) => {
    setPreferredChannels((prev) =>
      prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch],
    );
  };

  const addProofItem = () => {
    if (!proofSummary.trim()) return;
    setAvailableProof((prev) => [
      ...prev,
      {
        id: `proof_${Date.now().toString(36)}`,
        type: proofType,
        summary: proofSummary.trim(),
        verified: true,
        permission_confirmed: true,
      },
    ]);
    setProofSummary('');
  };

  const handleSaveAndGenerateStrategy = async () => {
    setSaving(true);
    setError(null);
    setStatusNote(null);
    try {
      const blackoutDates = blackoutDatesInput
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

      const payload = {
        business_name: businessName.trim(),
        website_url: websiteUrl.trim(),
        industry: industry.trim(),
        niche: niche.trim(),
        business_model: businessModel,
        primary_offer: primaryOffer.trim(),
        price_range: priceRange.trim(),
        audiences: audienceSegment.trim()
          ? [
              {
                segment: audienceSegment.trim(),
                role: audienceRole.trim() || 'Decision Maker',
                sophistication: 'intermediate',
                jobs_to_be_done: audienceJob.trim() ? [audienceJob.trim()] : [],
              },
            ]
          : [],
        primary_objective: primaryObjective,
        success_metric: successMetric.trim(),
        available_proof: availableProof,
        capacity: {
          weekly_hours: Number(weeklyHours) || 4,
          monthly_budget_usd: Number(monthlyBudgetUsd) || 50,
          monthly_credit_cap: Number(monthlyCreditCap) || 1000,
          has_product_demos: hasProductDemos,
          has_founder_footage: hasFounderFootage,
          has_photography: hasPhotography,
          has_customer_permissions: hasCustomerPermissions,
          approval_mode: approvalMode,
        },
        channels: {
          preferred: preferredChannels,
          desired_cadence: desiredCadence,
        },
        risk_profile: {
          category: riskCategory,
          jurisdiction: jurisdiction.trim() || undefined,
        },
        schedule_config: {
          timezone,
          blackout_dates: blackoutDates,
          holidays: [],
          named_slots: [
            { id: 'slot_tue_am', name: 'Tuesday Morning Pillar', day_of_week: 2, hour: 9, minute: 30, timezone, channels: preferredChannels },
            { id: 'slot_thu_pm', name: 'Thursday Afternoon Proof', day_of_week: 4, hour: 14, minute: 0, timezone, channels: preferredChannels },
          ],
        },
        onboarding_step: step,
        onboarding_completed: true,
      };

      const savedBiz = await autopilotService.saveBusinessProfile(payload);
      setFollowUpQuestions(savedBiz.follow_up_questions || []);

      const genRes = await autopilotService.generateStrategy();
      setStrategy(genRes.strategy);
      const latest = await autopilotService.getStrategy();
      setVersions(latest.versions || []);
      setStatusNote('Saved Business Profile and generated an industry-adaptive strategy proposal.');
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to generate adaptive strategy');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDakyXPilot = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await autopilotService.loadDakyXTechPilot();
      hydrateFromProfile(res.business);
      setStrategy(res.strategy);
      setStatusNote('Loaded tenant-scoped DakyXTech pilot configuration (4 Instagram posts/week, restrained corporate visual rules, mandatory human approval). Review in Brand Studio & Strategy before approving.');
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to load pilot configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveStrategy = async () => {
    if (!strategy?.id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await autopilotService.approveStrategy(strategy.id);
      setStrategy(res.strategy);
      setStatusNote(`Approved Strategy v${res.strategy.current_version}. Ready to generate a reviewable pilot batch.`);
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to approve strategy');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePilotBatch = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await autopilotService.generateCalendarBatch({
        batch_size: batchSize,
        creative_mode: batchCreativeMode,
      });
      setStatusNote(
        `Created ${res.items.length} planned content briefs (Est. provider spend $${res.batch_cost_summary.estimated_provider_cost_usd.toFixed(2)} USD · ${res.batch_cost_summary.estimated_internal_credits} workspace credits).`,
      );
      onRefreshOverview();
      onOpenCreativeQueue();
    } catch (e: any) {
      setError(e.message || 'Failed to generate calendar batch');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loading label="Loading adaptive strategy workspace" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Strategy Error">{error}</Notice>}
      {statusNote && <Notice tone="positive" title="Updated">{statusNote}</Notice>}

      {/* Progressive 5-Step Onboarding & Context Intake */}
      <Card>
        <SectionHeading
          title="Business Context & Progressive Onboarding"
          hint="Every strategy, format mix, risk gate, and KPI adapts to your industry, proof assets, channels, and real team capacity."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onOpenBrandStudio}>
                Scan Website Brand
              </Button>
              <Button variant="secondary" size="sm" onClick={handleLoadDakyXPilot} disabled={saving} title="Opt-in tenant-scoped pilot preset for DakyXTech">
                Load DakyXTech Pilot Preset
              </Button>
            </div>
          }
        />

        {/* Stepper */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-line pb-4">
          {[
            { n: 1 as const, label: '1. Business & Niche' },
            { n: 2 as const, label: '2. Audience & Goals' },
            { n: 3 as const, label: '3. Proof & Regulatory Risk' },
            { n: 4 as const, label: '4. Capacity, Budget & Slots' },
            { n: 5 as const, label: '5. Pilot Batch Launch' },
          ].map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n)}
              className={`rounded-[10px] border px-3 py-1.5 font-mono text-xs transition ${
                step === s.n
                  ? 'border-ink bg-ink text-white'
                  : 'border-line bg-sunken text-muted hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-sunken p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11px] font-medium text-ink uppercase">8-Industry Tailored Presets</span>
                <span className="text-[11px] text-muted">Auto-populates positioning, audience, risk, and verified proof</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {INDUSTRY_PRESETS.map((prs) => (
                  <button
                    key={prs.id}
                    type="button"
                    onClick={() => handleSelectPreset(prs)}
                    className="rounded-[8px] border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-sunken hover:border-ink transition"
                  >
                    {prs.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business Name">
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Northstar Dental, Looma Skincare, Vertex Cloud" />
              </Field>
              <Field label="Public Website URL" hint="Optional — used for Brand Studio candidate token extraction">
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
              </Field>
              <Field label="Industry">
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. B2B SaaS, Ecommerce, Local Services, Healthcare, Finance" />
              </Field>
              <Field label="Specific Niche / Category">
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. Workflow automation for logistics teams" />
              </Field>
              <Field label="Business Model">
                <select className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={businessModel} onChange={(e) => setBusinessModel(e.target.value)}>
                  {BUSINESS_MODELS.map((m) => (
                    <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price Positioning / Sales Cycle">
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={priceRange} onChange={(e) => setPriceRange(e.target.value)} placeholder="e.g. $49/mo self-serve or $8k consultative retainer" />
              </Field>
              <Field label="Primary Offer / Core Product" full>
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={primaryOffer} onChange={(e) => setPrimaryOffer(e.target.value)} placeholder="Describe what customers actually buy and the concrete outcome it delivers" />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary Audience Segment">
              <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={audienceSegment} onChange={(e) => setAudienceSegment(e.target.value)} placeholder="e.g. Operations Directors at mid-market distributors" />
            </Field>
            <Field label="Decision-Maker Role">
              <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={audienceRole} onChange={(e) => setAudienceRole(e.target.value)} placeholder="e.g. Founder, Clinic Manager, Consumer Shopper" />
            </Field>
            <Field label="Core Job-To-Be-Done / Problem Solved" full>
              <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={audienceJob} onChange={(e) => setAudienceJob(e.target.value)} placeholder="What urgent bottleneck or need prompts them to care?" />
            </Field>
            <Field label="Primary Marketing Objective">
              <select className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={primaryObjective} onChange={(e) => setPrimaryObjective(e.target.value)}>
                {OBJECTIVES.map((o) => (
                  <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="Success Metric">
              <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={successMetric} onChange={(e) => setSuccessMetric(e.target.value)} placeholder="e.g. Qualified demo bookings, educational saves, or SKU clicks" />
            </Field>
            <Field label="Preferred Distribution Channels" full>
              <div className="flex flex-wrap gap-2 pt-1">
                {CHANNELS.map((ch) => {
                  const selected = preferredChannels.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium capitalize transition ${
                        selected ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:text-ink'
                      }`}
                    >
                      {ch}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Industry Regulatory / Sensitivity Profile" hint="Elevated profiles automatically require human compliance sign-off">
                <select className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={riskCategory} onChange={(e) => setRiskCategory(e.target.value)}>
                  {RISK_CATEGORIES.map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </Field>
              <Field label="Applicable Jurisdiction (Optional)">
                <input className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. US FTC/FDA, UK FCA, EU GDPR, Ghana" />
              </Field>
            </div>

            <div className="rounded-xl border border-line bg-sunken p-4">
              <Eyebrow>VERIFIED PROOF & EVIDENCE VAULT (NO INVENTED CLAIMS)</Eyebrow>
              <p className="mt-1 text-xs text-muted">
                Autopilot blocks unverified percentages, star ratings, customer counts, and synthetic testimonials. Add real evidence here so briefs can cite it safely.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select className="rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={proofType} onChange={(e) => setProofType(e.target.value as any)}>
                  <option value="demo">Real Product Demo</option>
                  <option value="case_study">Verified Case Study</option>
                  <option value="review">Consented Customer Review</option>
                  <option value="data">Audited Benchmark / Data</option>
                  <option value="portfolio">Portfolio / Before-After</option>
                </select>
                <input
                  className="min-w-[240px] flex-1 rounded-[10px] border border-line bg-white px-3.5 py-2 text-xs text-ink"
                  value={proofSummary}
                  onChange={(e) => setProofSummary(e.target.value)}
                  placeholder="e.g. Shipped live multi-channel approval queue screen recording"
                />
                <Button variant="secondary" size="sm" onClick={addProofItem}>Add Verified Proof</Button>
              </div>
              {availableProof.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {availableProof.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-[10px] border border-line bg-white px-3 py-2 text-xs">
                      <span><strong className="font-mono uppercase text-muted">[{p.type}]</strong> {p.summary}</span>
                      <button
                        type="button"
                        onClick={() => setAvailableProof((prev) => prev.filter((x) => x.id !== p.id))}
                        className="text-muted hover:text-danger-text"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Weekly Team Hours" hint="Strategy downscales if cadence exceeds this">
                <input type="number" min={0.5} step={0.5} className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-sm text-ink" value={weeklyHours} onChange={(e) => setWeeklyHours(Number(e.target.value))} />
              </Field>
              <Field label="Monthly Provider Budget (USD)" hint="Third-party model spend cap">
                <input type="number" min={0} step={5} className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-sm text-ink" value={monthlyBudgetUsd} onChange={(e) => setMonthlyBudgetUsd(Number(e.target.value))} />
              </Field>
              <Field label="Monthly Internal Credit Cap" hint="Separate SaaS workspace credit ceiling">
                <input type="number" min={10} step={50} className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-sm text-ink" value={monthlyCreditCap} onChange={(e) => setMonthlyCreditCap(Number(e.target.value))} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Desired Cadence Tier">
                <select className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={desiredCadence} onChange={(e) => setDesiredCadence(e.target.value)}>
                  <option value="recommend">Recommend sustainable cadence</option>
                  <option value="minimum_viable">Minimum viable (1–2/wk)</option>
                  <option value="balanced_growth">Balanced growth (3–5/wk)</option>
                  <option value="high_output_campaign">High-output campaign (5–7+/wk)</option>
                </select>
              </Field>
              <Field label="Approval Policy">
                <select className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as any)}>
                  <option value="mandatory">Mandatory human approval (Recommended)</option>
                  <option value="risk_based">Risk-based escalation</option>
                  <option value="streamlined_evergreen">Streamlined low-risk evergreen</option>
                </select>
              </Field>
              <Field label="Schedule Timezone" hint="Controls named-slot posting time calculations">
                <div className="flex gap-2">
                  <select
                    className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-xs text-ink"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                    {!COMMON_TIMEZONES.includes(timezone) && (
                      <option value={timezone}>{timezone}</option>
                    )}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}
                    title="Auto-detect browser timezone"
                  >
                    Detect
                  </Button>
                </div>
              </Field>
            </div>

            <div className="space-y-2 rounded-xl border border-line bg-sunken p-3.5">
              <Field label="Blackout Dates Manager" hint="Calendar scheduler automatically holds outgoing publications during blackout windows">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="date"
                    className="os-input rounded-[10px] border border-line bg-white px-3 py-1.5 font-mono text-xs text-ink"
                    value={newBlackoutDate}
                    onChange={(e) => setNewBlackoutDate(e.target.value)}
                  />
                  <Button variant="secondary" size="sm" onClick={handleAddBlackoutDate} disabled={!newBlackoutDate}>
                    Add Blackout Date
                  </Button>
                </div>
              </Field>

              {blackoutDates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {blackoutDates.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 font-mono text-xs text-ink shadow-sm"
                    >
                      <span>{d}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveBlackoutDate(d)}
                        className="text-muted hover:text-danger-text font-bold"
                        title="Remove date"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-muted italic">No blackout windows active. Publications will run on all scheduled days.</div>
              )}
            </div>

            <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
              <Toggle checked={hasProductDemos} onChange={setHasProductDemos} label="Has real product screen captures" />
              <Toggle checked={hasFounderFootage} onChange={setHasFounderFootage} label="Has consented founder footage" />
              <Toggle checked={hasPhotography} onChange={setHasPhotography} label="Has real product photography" />
              <Toggle checked={hasCustomerPermissions} onChange={setHasCustomerPermissions} label="Has customer quote permissions" />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pilot Batch Size (3–5 recommended)" hint="Generates reviewable briefs before spending on heavy renders">
              <input type="number" min={1} max={12} className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-sm text-ink" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} />
            </Field>
            <Field label="Default Creative Mode for Pilot Batch">
              <select className="os-input w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={batchCreativeMode} onChange={(e) => setBatchCreativeMode(e.target.value as any)}>
                <option value="strict_brand">Strict Brand (palette & layout locked)</option>
                <option value="brand_inspired">Brand-Inspired (balanced storytelling)</option>
                <option value="creative_freedom">Creative Freedom (expressive visuals, factual guardrails kept)</option>
              </select>
            </Field>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="secondary" size="sm" onClick={() => setStep((s) => (s - 1) as any)}>
                Previous Step
              </Button>
            )}
            {step < 5 && (
              <Button variant="secondary" size="sm" onClick={() => setStep((s) => (s + 1) as any)}>
                Next Step
              </Button>
            )}
          </div>
          {/* Single accent CTA on this view (DakyXTech v22 §5) */}
          <Button variant="accent" onClick={handleSaveAndGenerateStrategy} disabled={saving}>
            {saving ? 'Generating Strategy…' : 'Save Context & Generate Adaptive Strategy'}
          </Button>
        </div>
      </Card>

      {/* High-impact follow-up questions */}
      {followUpQuestions.length > 0 && (
        <Notice tone="info" title="High-Impact Context Questions">
          <ul className="mt-1.5 space-y-1 text-xs">
            {followUpQuestions.map((q) => (
              <li key={q.id}>
                <strong>{q.question}</strong> — <span className="text-muted">{q.why_it_matters}</span>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/* Adaptive Strategy Proposal & Versioned Plan */}
      {!strategy ? (
        <EmptyState message="Complete your business context above and generate an adaptive strategy proposal." />
      ) : (
        <div className="space-y-6">
          <StatGrid columns={4}>
            <StatTile
              label="WEEKLY CADENCE"
              value={`${strategy.cadence?.total_posts_per_week ?? 0}/wk`}
              sub={`Tier: ${(strategy.cadence?.tier || 'balanced').replace(/_/g, ' ')}`}
            />
            <StatTile
              label="EST. TEAM EFFORT"
              value={`${strategy.cadence?.estimated_weekly_hours ?? 0}h`}
              sub="Creation + review per week"
            />
            <StatTile
              label="EST. PROVIDER USD / WK"
              value={`$${Number(strategy.cadence?.estimated_weekly_provider_usd ?? 0).toFixed(2)}`}
              sub="3rd-party model rate estimate"
            />
            <StatTile
              label="EST. CREDITS / WK"
              value={strategy.cadence?.estimated_weekly_credits ?? 0}
              sub={`Strategy v${strategy.current_version} (${strategy.status})`}
            />
          </StatGrid>

          {strategy.cadence?.capacity_warning && (
            <Notice tone="warn" title="Sustainable Cadence Auto-Adjustment">
              {strategy.cadence.capacity_warning}
            </Notice>
          )}

          <Card>
            <SectionHeading
              title={strategy.name}
              hint={strategy.rationale}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={strategy.status === 'approved' ? 'positive' : strategy.status === 'paused' ? 'muted' : 'warn'}>
                    v{strategy.current_version} · {strategy.status}
                  </Badge>
                  {strategy.status !== 'approved' ? (
                    <Button variant="primary" size="sm" onClick={handleApproveStrategy} disabled={saving}>
                      Approve Strategy
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={handlePauseStrategy} disabled={saving}>
                      Pause Strategy
                    </Button>
                  )}
                  {strategy.status !== 'rejected' && (
                    <Button variant="ghost" size="sm" onClick={handleRejectStrategy} disabled={saving}>
                      Reject
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={handleGeneratePilotBatch} disabled={saving}>
                    Generate {batchSize}-Post Pilot Batch
                  </Button>
                </div>
              }
            />

            <div className="grid gap-4 lg:grid-cols-3">
              {(strategy.pillars || []).map((p: any) => (
                <div key={p.id} className="rounded-xl border border-line bg-sunken p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Eyebrow>{p.objective?.replace(/_/g, ' ').toUpperCase()}</Eyebrow>
                    <span className="font-mono text-xs font-medium text-ink">{p.allocation_pct}%</span>
                  </div>
                  <h3 className="mt-2 font-display text-base font-medium text-ink">{p.name}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{p.purpose}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(p.formats || []).map((f: string) => (
                      <Badge key={f} tone="muted">{f.replace(/_/g, ' ')}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
              <div>
                <Eyebrow>MEASUREMENT & ATTRIBUTION GUARDRAILS</Eyebrow>
                <p className="mt-1.5 text-xs text-ink">
                  <strong>Primary KPIs:</strong> {(strategy.measurement?.primary_kpis || []).join(' · ')}
                </p>
                <p className="mt-1 text-xs text-muted">{strategy.measurement?.attribution_notes}</p>
              </div>
              <div>
                <Eyebrow>PROVISIONAL ASSUMPTIONS & PROOF POLICY</Eyebrow>
                <p className="mt-1.5 text-xs text-ink">
                  <strong>Prohibited:</strong> {(strategy.proof_policy?.prohibited_claims || []).slice(0, 2).join('; ')}
                </p>
                {versions.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    Saved strategy versions: {versions.map((v) => `v${v.version}`).join(', ')}
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
