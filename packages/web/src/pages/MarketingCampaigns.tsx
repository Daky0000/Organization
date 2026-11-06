import { useEffect, useState, useCallback } from 'react';
import { PlatformLogo } from '../components/PlatformLogo';
import {
  Activity, BarChart2, Calendar, ChevronLeft, ChevronRight, Copy, ExternalLink,
  FileText, Flag, Filter, Link2, Loader2, Megaphone, Pencil, Play, Pause, Plus,
  Target, Trash2, TrendingUp, X, Check, ArrowRight, Zap,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  campaignService,
  type Campaign,
  type CampaignKpi,
  type CampaignContentItem,
  type ActivityEvent,
  type CampaignDetail as CampaignDetailType,
  type Funnel,
  type FunnelStep,
  type UtmLink,
  type CampaignMetrics,
  type CampaignGoal,
  type CampaignStatus,
} from '../services/campaignService';
import { API_BASE_URL } from '../utils/apiBase';

// ─── Constants ───────────────────────────────────────────────────────────────

const GOAL_OPTIONS: { value: CampaignGoal; label: string; description: string }[] = [
  { value: 'awareness', label: 'Brand Awareness', description: 'Maximize reach and impressions' },
  { value: 'traffic', label: 'Drive Traffic', description: 'Send visitors to your website' },
  { value: 'leads', label: 'Generate Leads', description: 'Collect emails and contacts' },
  { value: 'engagement', label: 'Boost Engagement', description: 'Likes, comments, shares' },
  { value: 'sales', label: 'Drive Sales', description: 'Conversions and revenue' },
];

const CHANNEL_OPTIONS = [
  { value: 'facebook', label: 'Facebook', color: '#1877F2' },
  { value: 'instagram', label: 'Instagram', color: '#E1306C' },
  { value: 'twitter', label: 'X (Twitter)', color: '#000000' },
  { value: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
  { value: 'email', label: 'Email', color: '#2563EB' },
  { value: 'landing_page', label: 'Landing Page', color: '#10B981' },
];

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-slate-100 text-slate-500',
};

const MEDIUM_OPTIONS = ['social', 'cpc', 'email', 'banner', 'affiliate', 'referral', 'organic'];

const COLORS = ['#2563EB', '#10b981', '#f59e0b', '#ef4444', '#2563EB', '#06b6d4'];

const CAMPAIGN_TEMPLATES: Array<{ id: string; name: string; emoji: string; goal: CampaignGoal; hint: string; channels: string[]; color: string; type: string; tone: string; cta: string }> = [
  { id: 'product_launch', name: 'Product Launch', emoji: '🚀', goal: 'sales', hint: 'Drive pre-orders, waitlist signups, and launch-day sales.', channels: ['email', 'instagram', 'facebook'], color: '#2563EB', type: 'product_marketing', tone: 'urgent', cta: 'Pre-Order Now' },
  { id: 'seasonal_sale', name: 'Seasonal Sale', emoji: '🛍️', goal: 'sales', hint: 'Time-limited promotions with urgency messaging across social.', channels: ['email', 'instagram', 'facebook'], color: '#ef4444', type: 'paid_media', tone: 'urgent', cta: 'Shop Now' },
  { id: 'lead_gen', name: 'Lead Generation', emoji: '🎯', goal: 'leads', hint: 'Capture emails with a lead magnet or gated offer.', channels: ['linkedin', 'landing_page', 'email'], color: '#10b981', type: 'acquisition', tone: 'professional', cta: 'Get Free Access' },
  { id: 'brand_awareness', name: 'Brand Awareness', emoji: '📣', goal: 'awareness', hint: 'Maximize reach and impressions across social channels.', channels: ['instagram', 'twitter', 'facebook'], color: '#f59e0b', type: 'brand_development', tone: 'inspirational', cta: 'Learn More' },
  { id: 'event_promo', name: 'Event Promo', emoji: '🎪', goal: 'traffic', hint: 'Drive registrations for a webinar, live event, or workshop.', channels: ['email', 'linkedin', 'landing_page'], color: '#2563EB', type: 'pr_awareness', tone: 'friendly', cta: 'Register Free' },
  { id: 're_engagement', name: 'Re-engagement', emoji: '🔄', goal: 'engagement', hint: 'Win back inactive subscribers and followers.', channels: ['email', 'facebook'], color: '#06b6d4', type: 'email_marketing', tone: 'friendly', cta: 'Come Back' },
  { id: 'ugc', name: 'UGC Campaign', emoji: '📸', goal: 'engagement', hint: 'Invite users to share content with a branded hashtag.', channels: ['instagram', 'twitter', 'facebook'], color: '#ec4899', type: 'ugc', tone: 'playful', cta: 'Share Your Story' },
  { id: 'affiliate', name: 'Affiliate Launch', emoji: '🤝', goal: 'sales', hint: 'Activate creator referrals with tracked affiliate links.', channels: ['instagram', 'twitter', 'landing_page'], color: '#14b8a6', type: 'affiliate', tone: 'professional', cta: 'Join as Affiliate' },
  { id: 'content_marketing', name: 'Content Marketing', emoji: '✍️', goal: 'traffic', hint: 'Build authority through blogs, videos, and SEO content.', channels: ['landing_page', 'email', 'twitter'], color: '#a855f7', type: 'content_marketing', tone: 'inspirational', cta: 'Read More' },
];

const CAMPAIGN_TYPES = [
  { value: 'product_marketing', label: 'Product Marketing', description: 'Bring a product to market with targeted positioning' },
  { value: 'brand_development', label: 'Brand Development', description: 'Build positive lasting impressions and awareness' },
  { value: 'email_marketing', label: 'Email Marketing', description: 'Nurture leads through email sequences with a clear CTA' },
  { value: 'content_marketing', label: 'Content Marketing', description: 'Build authority via blogs, videos, and podcasts' },
  { value: 'ugc', label: 'User-Generated Content', description: 'Invite users to create authentic campaign content' },
  { value: 'pr_awareness', label: 'PR / Awareness', description: 'Educate the public about a brand, cause, or message' },
  { value: 'social_media', label: 'Social Media', description: 'Influence followers to feel or act about your brand' },
  { value: 'paid_media', label: 'Paid Media', description: 'Reach audiences through sponsored ads and placements' },
  { value: 'acquisition', label: 'Acquisition Marketing', description: 'Convert new audiences into paying customers via SEO, email, ads' },
  { value: 'affiliate', label: 'Affiliate Marketing', description: 'Drive sales through trusted creator referrals' },
  { value: 'direct_mail', label: 'Direct Mail', description: 'Reach customers through physical letters, postcards, or flyers' },
];

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', emoji: '👔' },
  { value: 'friendly', label: 'Friendly', emoji: '😊' },
  { value: 'urgent', label: 'Urgent', emoji: '⚡' },
  { value: 'playful', label: 'Playful', emoji: '🎉' },
  { value: 'inspirational', label: 'Inspirational', emoji: '✨' },
];

const GOAL_KPI_SUGGESTIONS: Record<CampaignGoal, Array<{ name: string; metric_type: 'number' | 'percentage' | 'currency' | 'ratio'; unit: string }>> = {
  awareness: [
    { name: 'Total Impressions', metric_type: 'number', unit: 'impressions' },
    { name: 'Reach', metric_type: 'number', unit: 'people' },
    { name: 'Brand Mentions', metric_type: 'number', unit: 'mentions' },
  ],
  traffic: [
    { name: 'Website Visits', metric_type: 'number', unit: 'visits' },
    { name: 'Click-Through Rate', metric_type: 'percentage', unit: '%' },
    { name: 'Bounce Rate', metric_type: 'percentage', unit: '%' },
  ],
  leads: [
    { name: 'Leads Generated', metric_type: 'number', unit: 'leads' },
    { name: 'Conversion Rate', metric_type: 'percentage', unit: '%' },
    { name: 'Cost Per Lead', metric_type: 'currency', unit: '' },
  ],
  engagement: [
    { name: 'Engagement Rate', metric_type: 'percentage', unit: '%' },
    { name: 'Likes & Reactions', metric_type: 'number', unit: 'interactions' },
    { name: 'Shares & Reposts', metric_type: 'number', unit: 'shares' },
  ],
  sales: [
    { name: 'Total Revenue', metric_type: 'currency', unit: '' },
    { name: 'Conversions', metric_type: 'number', unit: 'sales' },
    { name: 'Return on Investment', metric_type: 'percentage', unit: '%' },
  ],
};

function fmtNum(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function goalLabel(goal: string) {
  return GOAL_OPTIONS.find(g => g.value === goal)?.label ?? goal;
}

function getShortLink(link: UtmLink): string {
  const base = API_BASE_URL.replace(/\/$/, '');
  return `${base}/r/${link.short_code}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChannelIcon({ value, size = 32 }: { value: string; size?: number }) {
  if (value === 'email') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#2563EB" />
        <rect x="7" y="11" width="18" height="12" rx="2" stroke="white" strokeWidth="1.5" />
        <path d="M7 13.5l9 5.5 9-5.5" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (value === 'landing_page') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#10B981" />
        <rect x="7" y="10" width="18" height="13" rx="2" stroke="white" strokeWidth="1.5" />
        <path d="M7 14.5h18" stroke="white" strokeWidth="1.5" />
        <path d="M10.5 18.5h7M10.5 21h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return <PlatformLogo platform={value} size={size} />;
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function GoalBadge({ goal }: { goal: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
      <Flag size={10} /> {goalLabel(goal)}
    </span>
  );
}

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">{icon}</div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ─── Builder Wizard ───────────────────────────────────────────────────────────

type WizardStep = 'template' | 'goal' | 'channels' | 'messaging' | 'links' | 'review';

type CreationProgressStep = { label: string; status: 'pending' | 'running' | 'done' | 'error' };

function BuilderWizard({ onDone, onClose }: { onDone: (campaign: Campaign) => void; onClose: () => void }) {
  const [step, setStep] = useState<WizardStep>('goal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [progressSteps, setProgressSteps] = useState<CreationProgressStep[]>([]);

  // Template step
  const [_selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Goal step
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState<CampaignGoal>('awareness');
  const [targetUrl, setTargetUrl] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [objective, setObjective] = useState('');
  const [targetAudience, setTargetAudience] = useState('');

  // Channels step
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Messaging step
  const [campaignType, setCampaignType] = useState('');
  const [valueProp, setValueProp] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [tone, setTone] = useState('friendly');

  // UTM step
  const [utmLinks, setUtmLinks] = useState<Array<{ label: string; utm_source: string; utm_medium: string }>>([
    { label: 'Primary Link', utm_source: '', utm_medium: 'social' },
  ]);

  // KPI suggestions on review
  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(new Set());
  const kpiSuggestions = GOAL_KPI_SUGGESTIONS[goal] ?? [];

  const STEPS: WizardStep[] = ['template', 'goal', 'channels', 'messaging', 'links', 'review'];
  const stepIdx = STEPS.indexOf(step);

  const toggleChannel = (ch: string) =>
    setSelectedChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);

  const addUtmRow = () =>
    setUtmLinks(prev => [...prev, { label: '', utm_source: '', utm_medium: 'social' }]);

  const updateUtmRow = (i: number, field: string, value: string) =>
    setUtmLinks(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const removeUtmRow = (i: number) =>
    setUtmLinks(prev => prev.filter((_, idx) => idx !== i));

  const PROGRESS_LABELS = [
    'Validating inputs',
    'Creating campaign record',
    'Attaching channels',
    'Initializing funnel',
    'Generating UTM links',
    'Queuing background jobs',
  ];

  function advanceProgress(idx: number, status: 'done' | 'error') {
    setProgressSteps(prev => prev.map((s, i) => {
      if (i === idx) return { ...s, status };
      if (i === idx + 1 && status === 'done') return { ...s, status: 'running' };
      return s;
    }));
  }

  async function handleLaunch() {
    setSaving(true);
    setError('');
    const steps: CreationProgressStep[] = PROGRESS_LABELS.map((label, i) => ({
      label,
      status: i === 0 ? 'running' : 'pending',
    }));
    setProgressSteps(steps);

    try {
      await new Promise(r => setTimeout(r, 80));
      advanceProgress(0, 'done');
      await new Promise(r => setTimeout(r, 60));

      const result = await campaignService.createCampaignAtomic({
        name,
        description: description || undefined,
        goal,
        target_url: targetUrl || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        budget: budget ? parseFloat(budget) : undefined,
        channels: selectedChannels,
        utm_links: utmLinks.filter(l => l.label && l.utm_source),
        attribution_model: 'last_touch',
      });

      advanceProgress(1, 'done');
      await new Promise(r => setTimeout(r, 120));
      advanceProgress(2, 'done');
      await new Promise(r => setTimeout(r, 100));

      // Save strategy/messaging fields into campaign settings
      const settings: Record<string, string> = {};
      if (objective) settings.objective = objective;
      if (targetAudience) settings.target_audience = targetAudience;
      if (campaignType) settings.campaign_type = campaignType;
      if (valueProp) settings.value_prop = valueProp;
      if (ctaText) settings.cta = ctaText;
      if (tone) settings.tone = tone;
      if (Object.keys(settings).length > 0) {
        await campaignService.updateCampaign(result.campaign.id, { settings } as any);
      }

      advanceProgress(3, 'done');
      await new Promise(r => setTimeout(r, 100));

      // Create selected KPIs
      const kpisToCreate = kpiSuggestions.filter(k => selectedKpis.has(k.name));
      for (const kpi of kpisToCreate) {
        await campaignService.createKpi(result.campaign.id, { name: kpi.name, metric_type: kpi.metric_type, target_value: 0, current_value: 0, unit: kpi.unit });
      }

      advanceProgress(4, 'done');
      await new Promise(r => setTimeout(r, 100));
      advanceProgress(5, 'done');
      await new Promise(r => setTimeout(r, 300));
      onDone(result.campaign);
    } catch (e: any) {
      setProgressSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
      setError(e.message || 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  }

  function applyTemplate(tpl: typeof CAMPAIGN_TEMPLATES[0] | null) {
    if (tpl) {
      setSelectedTemplateId(tpl.id);
      setGoal(tpl.goal);
      setSelectedChannels(tpl.channels);
      setCampaignType(tpl.type);
      setTone(tpl.tone);
      setCtaText(tpl.cta);
      if (!name) setDescription(tpl.hint);
    } else {
      setSelectedTemplateId(null);
    }
    setStep('goal');
  }

  const canNext = step === 'goal' ? name.trim().length > 0 : true;

  function toggleKpi(name: string) {
    setSelectedKpis(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-5 top-5 rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>

        {/* Header */}
        <div className="border-b border-slate-100 px-8 pt-8 pb-6">
          <h2 className="text-2xl font-black tracking-tight text-slate-950">New Campaign</h2>
          <div className="mt-4 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${i < stepIdx ? 'bg-green-500 text-white' : i === stepIdx ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {i < stepIdx ? <Check size={12} /> : i + 1}
                </div>
                <span className={`text-xs font-semibold capitalize ${i === stepIdx ? 'text-slate-950' : 'text-slate-400'}`}>{s}</span>
                {i < STEPS.length - 1 && <ArrowRight size={12} className="text-slate-300" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-6 min-h-[320px]">
          {step === 'template' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Choose a template to get started faster, or build from scratch.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CAMPAIGN_TEMPLATES.map(tpl => (
                  <button key={tpl.id} onClick={() => applyTemplate(tpl)} className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400 transition-all">
                    <span className="mb-2 text-2xl">{tpl.emoji}</span>
                    <span className="text-sm font-bold text-slate-900">{tpl.name}</span>
                    <span className="mt-0.5 text-xs text-slate-500 leading-relaxed">{tpl.hint}</span>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tpl.channels.map(ch => {
                        const opt = CHANNEL_OPTIONS.find(c => c.value === ch);
                        return <span key={ch} className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: opt?.color ?? '#888' }}>{opt?.label ?? ch}</span>;
                      })}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => applyTemplate(null)} className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900">
                <Plus size={14} /> Start from scratch
              </button>
            </div>
          )}

          {step === 'goal' && (
            <div className="space-y-4 overflow-y-auto max-h-[420px] pr-1">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Campaign Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q2 Product Launch" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Campaign Goal</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {GOAL_OPTIONS.map(g => (
                    <button key={g.value} onClick={() => setGoal(g.value)} className={`rounded-2xl border p-3 text-left transition-all ${goal === g.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div className={`text-sm font-bold ${goal === g.value ? 'text-white' : 'text-slate-900'}`}>{g.label}</div>
                      <div className={`mt-0.5 text-xs ${goal === g.value ? 'text-slate-300' : 'text-slate-500'}`}>{g.description}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Specific Objective</label>
                <input value={objective} onChange={e => setObjective(e.target.value)} placeholder='e.g. "Increase newsletter signups by 500 in 30 days"' className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Target Audience</label>
                <textarea value={targetAudience} onChange={e => setTargetAudience(e.target.value)} rows={2} placeholder='e.g. "Tech-savvy millennials aged 25–35 who value convenience and premium UX"' className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Target URL</label>
                  <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://yoursite.com" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Budget (USD)</label>
                  <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="e.g. 500" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Start Date</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">End Date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Optional notes..." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 resize-none" />
              </div>
            </div>
          )}

          {step === 'channels' && (
            <div>
              <p className="mb-4 text-sm text-slate-500">Select which channels this campaign will run on.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CHANNEL_OPTIONS.map(ch => {
                  const active = selectedChannels.includes(ch.value);
                  return (
                    <button key={ch.value} onClick={() => toggleChannel(ch.value)} className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${active ? 'border-slate-950 bg-slate-950' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <ChannelIcon value={ch.value} size={32} />
                      <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-800'}`}>{ch.label}</span>
                    </button>
                  );
                })}
              </div>
              {selectedChannels.length === 0 && <p className="mt-4 text-xs text-slate-400">You can add channels later. Skip to continue.</p>}
            </div>
          )}

          {step === 'messaging' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Campaign Type</label>
                <div className="grid grid-cols-1 gap-2 max-h-[180px] overflow-y-auto pr-1">
                  {CAMPAIGN_TYPES.map(ct => (
                    <button key={ct.value} onClick={() => setCampaignType(ct.value)} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${campaignType === ct.value ? 'border-slate-950 bg-slate-950' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div>
                        <div className={`text-sm font-bold ${campaignType === ct.value ? 'text-white' : 'text-slate-900'}`}>{ct.label}</div>
                        <div className={`text-xs mt-0.5 ${campaignType === ct.value ? 'text-slate-300' : 'text-slate-500'}`}>{ct.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Tone of Voice</label>
                <div className="flex flex-wrap gap-2">
                  {TONE_OPTIONS.map(t => (
                    <button key={t.value} onClick={() => setTone(t.value)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition-all ${tone === t.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                      {t.emoji} {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Value Proposition</label>
                <textarea value={valueProp} onChange={e => setValueProp(e.target.value)} rows={2} placeholder='e.g. "The only tool that lets you build a campaign in under 5 minutes — no agency needed."' className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">Call-to-Action Text</label>
                <input value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder='e.g. "Start Free Trial", "Shop Now", "Get the Guide"' className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400" />
              </div>
            </div>
          )}

          {step === 'links' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Generate tracked UTM links for each channel. Each link will auto-track clicks.</p>
              {utmLinks.map((lnk, i) => (
                <div key={i} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Label</label>
                      <input value={lnk.label} onChange={e => updateUtmRow(i, 'label', e.target.value)} placeholder="e.g. Facebook Post" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Source</label>
                      <input value={lnk.utm_source} onChange={e => updateUtmRow(i, 'utm_source', e.target.value)} placeholder="e.g. facebook" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Medium</label>
                      <select value={lnk.utm_medium} onChange={e => updateUtmRow(i, 'utm_medium', e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400">
                        {MEDIUM_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                  {utmLinks.length > 1 && (
                    <button onClick={() => removeUtmRow(i)} className="mt-5 shrink-0 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
              <button onClick={addUtmRow} className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900">
                <Plus size={14} /> Add another link
              </button>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4 overflow-y-auto max-h-[420px] pr-1">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Campaign</span>
                  <GoalBadge goal={goal} />
                </div>
                <div className="text-xl font-black text-slate-950">{name}</div>
                {objective && <p className="text-sm font-semibold text-indigo-700">🎯 {objective}</p>}
                {targetAudience && <p className="text-sm text-slate-500">👤 {targetAudience}</p>}
                {description && <p className="text-sm text-slate-500">{description}</p>}
                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                  {targetUrl && <span>🔗 {targetUrl}</span>}
                  {budget && <span>💰 ${budget}</span>}
                  {startDate && <span>📅 {startDate}{endDate ? ` → ${endDate}` : ''}</span>}
                </div>
              </div>
              {(campaignType || ctaText || valueProp || tone) && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                  <span className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Strategy</span>
                  {campaignType && <div className="text-xs text-slate-600">Type: <span className="font-semibold">{CAMPAIGN_TYPES.find(t => t.value === campaignType)?.label ?? campaignType}</span></div>}
                  {tone && <div className="text-xs text-slate-600">Tone: <span className="font-semibold capitalize">{TONE_OPTIONS.find(t => t.value === tone)?.emoji} {tone}</span></div>}
                  {ctaText && <div className="text-xs text-slate-600">CTA: <span className="font-semibold">"{ctaText}"</span></div>}
                  {valueProp && <div className="text-xs text-slate-500 italic mt-1">"{valueProp}"</div>}
                </div>
              )}
              {selectedChannels.length > 0 && (
                <div>
                  <span className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Channels</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedChannels.map(ch => {
                      const opt = CHANNEL_OPTIONS.find(c => c.value === ch);
                      return <span key={ch} className="rounded-xl px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: opt?.color ?? '#888' }}>{opt?.label ?? ch}</span>;
                    })}
                  </div>
                </div>
              )}
              {utmLinks.filter(l => l.label && l.utm_source).length > 0 && (
                <div>
                  <span className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">UTM Links ({utmLinks.filter(l => l.label && l.utm_source).length})</span>
                  {utmLinks.filter(l => l.label && l.utm_source).map((l, i) => (
                    <div key={i} className="text-xs text-slate-600">• {l.label} — {l.utm_source} / {l.utm_medium}</div>
                  ))}
                </div>
              )}
              {kpiSuggestions.length > 0 && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                  <span className="block text-xs font-bold uppercase tracking-widest text-indigo-400 mb-2">Suggested KPIs for {goalLabel(goal)}</span>
                  <p className="text-xs text-indigo-500 mb-3">Select which KPIs to track — you can add targets after creation.</p>
                  <div className="space-y-2">
                    {kpiSuggestions.map(k => (
                      <label key={k.name} className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={selectedKpis.has(k.name)} onChange={() => toggleKpi(k.name)} className="rounded accent-indigo-600" />
                        <span className="text-sm font-semibold text-slate-800">{k.name}</span>
                        <span className="text-xs text-slate-400 capitalize">{k.metric_type}{k.unit ? ` (${k.unit})` : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {saving && progressSteps.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Creating Campaign…</p>
              {progressSteps.map((ps, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${ps.status === 'done' ? 'bg-green-500 text-white' : ps.status === 'running' ? 'bg-indigo-500 text-white' : ps.status === 'error' ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {ps.status === 'done' ? <Check size={10} /> : ps.status === 'running' ? <Loader2 size={10} className="animate-spin" /> : ps.status === 'error' ? <X size={10} /> : i + 1}
                  </div>
                  <span className={`text-sm ${ps.status === 'done' ? 'text-green-700 font-semibold' : ps.status === 'running' ? 'text-indigo-700 font-semibold' : ps.status === 'error' ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{ps.label}</span>
                </div>
              ))}
            </div>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-8 py-5">
          <button disabled={saving} onClick={() => stepIdx > 0 ? setStep(STEPS[stepIdx - 1]) : onClose()} className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            {stepIdx === 0 ? 'Cancel' : 'Back'}
          </button>
          {step === 'template' ? null : step !== 'review' ? (
            <button disabled={!canNext} onClick={() => setStep(STEPS[stepIdx + 1])} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button disabled={saving} onClick={handleLaunch} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {saving ? 'Launching…' : 'Launch Campaign'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Campaign Calendar ────────────────────────────────────────────────────────

function CampaignCalendar({ campaigns, onSelect }: { campaigns: Campaign[]; onSelect: (c: Campaign) => void }) {
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const year = cur.getFullYear();
  const month = cur.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const today = new Date().toISOString().split('T')[0];

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function getCampsForDay(day: number): Campaign[] {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return campaigns.filter(c => {
      const s = c.start_date ? c.start_date.split('T')[0] : null;
      const e = c.end_date ? c.end_date.split('T')[0] : null;
      if (s && e) return dayStr >= s && dayStr <= e;
      if (s) return dayStr === s;
      if (e) return dayStr === e;
      return false;
    });
  }

  const unscheduled = campaigns.filter(c => !c.start_date && !c.end_date);
  const monthLabel = cur.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setCur(new Date(year, month - 1, 1))} className="rounded-xl p-2 hover:bg-slate-100"><ChevronLeft size={16} /></button>
        <span className="text-sm font-bold text-slate-800">{monthLabel}</span>
        <button onClick={() => setCur(new Date(year, month + 1, 1))} className="rounded-xl p-2 hover:bg-slate-100"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-2xl overflow-hidden border border-slate-200">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="bg-slate-50 min-h-[72px]" />;
          const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayCamps = getCampsForDay(day);
          const isToday = dayStr === today;
          return (
            <div key={day} className="bg-white min-h-[72px] p-1.5">
              <div className={`text-[11px] font-bold mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-slate-950 text-white' : 'text-slate-400'}`}>{day}</div>
              {dayCamps.slice(0, 2).map(c => (
                <button key={c.id} onClick={() => onSelect(c)} title={c.name} className="w-full text-left mb-0.5 rounded px-1 py-0.5 text-[9px] font-bold truncate text-white hover:opacity-80"
                  style={{ backgroundColor: COLORS[GOAL_OPTIONS.findIndex(g => g.value === c.goal) % COLORS.length] }}>
                  {c.name}
                </button>
              ))}
              {dayCamps.length > 2 && <div className="text-[9px] text-slate-400">+{dayCamps.length - 2}</div>}
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">No dates set ({unscheduled.length})</p>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map(c => (
              <button key={c.id} onClick={() => onSelect(c)} className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">{c.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────

function CampaignsTab({ onSelect }: { onSelect: (c: Campaign) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'calendar'>('grid');

  const load = useCallback(async () => {
    setLoading(true);
    try { setCampaigns(await campaignService.listCampaigns()); } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleStatus(c: Campaign) {
    const next = c.status === 'active' ? 'paused' : 'active';
    setUpdating(c.id);
    try {
      const updated = await campaignService.updateCampaign(c.id, { status: next } as any);
      setCampaigns(prev => prev.map(x => x.id === c.id ? updated : x));
    } catch { /* */ } finally { setUpdating(null); }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign and all its data?')) return;
    await campaignService.deleteCampaign(id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
  }

  async function cloneCampaign(c: Campaign) {
    setCloning(c.id);
    try {
      const clone = await campaignService.createCampaign({
        name: `${c.name} (copy)`, description: c.description, goal: c.goal,
        target_url: c.target_url, budget: c.budget ?? undefined, currency: c.currency, tags: c.tags,
      } as any);
      if (c.settings && Object.keys(c.settings).length > 0) {
        await campaignService.updateCampaign(clone.id, { settings: c.settings } as any);
      }
      setCampaigns(prev => [{ ...clone, settings: c.settings }, ...prev]);
    } catch { /* */ } finally { setCloning(null); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-slate-400" /></div>;

  return (
    <>
      {showBuilder && <BuilderWizard onClose={() => setShowBuilder(false)} onDone={c => { setCampaigns(prev => [c, ...prev]); setShowBuilder(false); }} />}
      {campaigns.length === 0 ? (
        <EmptyState icon={<Megaphone size={24} />} title="No campaigns yet" description="Create your first campaign to start tracking performance across channels." action={<button onClick={() => setShowBuilder(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={14} /> New Campaign</button>} />
      ) : (
      <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            <button onClick={() => setViewMode('grid')} title="Grid view" className={`px-3 py-2 text-xs font-semibold transition-colors ${viewMode === 'grid' ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
              ▦ Grid
            </button>
            <button onClick={() => setViewMode('calendar')} title="Calendar view" className={`px-3 py-2 text-xs font-semibold transition-colors flex items-center gap-1 ${viewMode === 'calendar' ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
              <Calendar size={12} /> Calendar
            </button>
          </div>
          <button data-tour-id="btn-new-campaign" onClick={() => setShowBuilder(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus size={14} /> New Campaign
          </button>
        </div>
      </div>
      {viewMode === 'calendar' ? (
        <CampaignCalendar campaigns={campaigns} onSelect={onSelect} />
      ) : (
      <div data-tour-id="campaigns-list" className="space-y-3">
        {campaigns.map(c => (
          <div key={c.id} className="group flex items-center gap-5 rounded-2xl border border-slate-200 bg-white px-6 py-5 hover:border-slate-300 transition-all">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => onSelect(c)} className="text-base font-bold text-slate-950 hover:text-indigo-600 transition-colors truncate max-w-xs">{c.name}</button>
                <StatusBadge status={c.status as CampaignStatus} />
                <GoalBadge goal={c.goal} />
              </div>
              {c.description && <p className="mt-1 text-sm text-slate-500 truncate">{c.description}</p>}
              <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
                <span>{Number(c.channel_count || 0)} channel{Number(c.channel_count) !== 1 ? 's' : ''}</span>
                <span>{Number(c.funnel_count || 0)} funnel{Number(c.funnel_count) !== 1 ? 's' : ''}</span>
                <span>{fmtNum(Number(c.total_clicks || 0))} clicks</span>
                {Number(c.total_conversions || 0) > 0 && <span className="font-semibold text-green-600">{fmtNum(Number(c.total_conversions))} conversions</span>}
                {c.start_date && <span>📅 {c.start_date.split('T')[0]}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onSelect(c)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">View</button>
              <button disabled={cloning === c.id} onClick={() => cloneCampaign(c)} title="Duplicate" className="rounded-xl p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 disabled:opacity-40">
                {cloning === c.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
              </button>
              <button disabled={updating === c.id} onClick={() => toggleStatus(c)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {updating === c.id ? <Loader2 size={12} className="animate-spin" /> : c.status === 'active' ? <><Pause size={12} className="inline mr-1" />Pause</> : <><Play size={12} className="inline mr-1" />Activate</>}
              </button>
              <button onClick={() => deleteCampaign(c.id)} className="rounded-xl p-2 text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      )}
      </>
      )}
    </>
  );
}

// ─── Funnels Tab ──────────────────────────────────────────────────────────────

function FunnelStepBar({ step, total, index }: { step: FunnelStep & { event_count?: number }; total: number; index: number }) {
  const count = Number(step.event_count || 0);
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const width = index === 0 ? 100 : pct;
  return (
    <div className="group relative">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-700">{step.name}</span>
        <span className="text-slate-400">{fmtNum(count)} events {index > 0 && total > 0 && <span className="text-indigo-600 font-bold">({pct}%)</span>}</span>
      </div>
      <div className="h-9 w-full overflow-hidden rounded-xl bg-slate-100">
        <div className="h-full rounded-xl bg-indigo-500 transition-all duration-500 flex items-center justify-end pr-3" style={{ width: `${width}%` }}>
          {width > 15 && <span className="text-xs font-bold text-white">{pct}%</span>}
        </div>
      </div>
      {index > 0 && total > 0 && count < total && (
        <div className="mt-1 text-xs text-slate-400">↓ {fmtNum(total - count)} dropped off</div>
      )}
    </div>
  );
}

function FunnelsTab({ campaignId }: { campaignId?: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignId ?? '');
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState('');
  const [steps, setSteps] = useState<Array<FunnelStep & { event_count?: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newFunnelName, setNewFunnelName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    campaignService.listCampaigns().then(cs => {
      setCampaigns(cs);
      if (!selectedCampaignId && cs[0]) setSelectedCampaignId(cs[0].id);
    }).catch(() => undefined);
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!selectedCampaignId) return;
    setFunnels([]); setSelectedFunnelId(''); setSteps([]);
    campaignService.listFunnels(selectedCampaignId).then(fs => {
      setFunnels(fs);
      if (fs[0]) setSelectedFunnelId(fs[0].id);
    }).catch(() => undefined);
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!selectedFunnelId) return;
    setLoading(true);
    campaignService.getFunnelSteps(selectedFunnelId).then(ss => setSteps(ss)).catch(() => undefined).finally(() => setLoading(false));
  }, [selectedFunnelId]);

  async function createFunnel() {
    if (!newFunnelName || !selectedCampaignId) return;
    setCreating(true);
    try {
      const f = await campaignService.createFunnel(selectedCampaignId, {
        name: newFunnelName,
        steps: [
          { name: 'Awareness', step_type: 'page_view' },
          { name: 'Interest', step_type: 'click' },
          { name: 'Consideration', step_type: 'page_view' },
          { name: 'Conversion', step_type: 'purchase' },
        ],
      });
      setFunnels(prev => [...prev, f]);
      setSelectedFunnelId(f.id);
      setShowCreate(false);
      setNewFunnelName('');
    } catch { /* */ } finally { setCreating(false); }
  }

  const topCount = steps[0] ? Number((steps[0] as any).event_count || 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <select value={selectedCampaignId} onChange={e => setSelectedCampaignId(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400">
          <option value="">— Select Campaign —</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {funnels.length > 0 && (
          <select value={selectedFunnelId} onChange={e => setSelectedFunnelId(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400">
            {funnels.map(f => <option key={f.id} value={f.id}>{f.name} ({f.event_count ?? 0} events)</option>)}
          </select>
        )}
        {selectedCampaignId && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Plus size={14} /> Add Funnel
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
          <div className="flex items-center gap-3">
            <input value={newFunnelName} onChange={e => setNewFunnelName(e.target.value)} placeholder="Funnel name, e.g. Checkout Flow" className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            <button disabled={creating || !newFunnelName} onClick={createFunnel} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {creating ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={14} /></button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Creates a 4-step funnel: Awareness → Interest → Consideration → Conversion</p>
        </div>
      )}

      {!selectedCampaignId && <EmptyState icon={<Filter size={24} />} title="Select a campaign" description="Choose a campaign to view or create funnels." />}

      {selectedCampaignId && funnels.length === 0 && !showCreate && (
        <EmptyState icon={<Filter size={24} />} title="No funnels yet" description="Add a funnel to visualize how visitors move through your campaign." action={<button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={14} /> Create Funnel</button>} />
      )}

      {selectedFunnelId && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-950">{funnels.find(f => f.id === selectedFunnelId)?.name}</h3>
              <p className="text-sm text-slate-500">{steps.length} steps · {fmtNum(topCount)} total entries</p>
            </div>
            {topCount > 0 && steps.length > 1 && (
              <div className="text-right">
                <div className="text-2xl font-black text-indigo-600">
                  {steps[steps.length - 1] ? Math.round((Number((steps[steps.length - 1] as any).event_count || 0) / topCount) * 100) : 0}%
                </div>
                <div className="text-xs text-slate-400">overall conversion</div>
              </div>
            )}
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
          ) : steps.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No steps or events yet. Send events to <code className="bg-slate-100 rounded px-1">/api/track/event</code> with the funnel_id.</p>
          ) : (
            <div className="space-y-4">
              {steps.map((step, i) => (
                <FunnelStepBar key={step.id} step={step} total={topCount} index={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Links Tab ────────────────────────────────────────────────────────────────

function LinksTab({ campaignId }: { campaignId?: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignId ?? '');
  const [links, setLinks] = useState<UtmLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState('');
  const [form, setForm] = useState({ label: '', base_url: '', utm_source: '', utm_medium: 'social', utm_campaign: '', utm_term: '', utm_content: '' });

  useEffect(() => {
    campaignService.listCampaigns().then(cs => {
      setCampaigns(cs);
      if (!selectedCampaignId && cs[0]) {
        setSelectedCampaignId(cs[0].id);
        setForm(prev => ({ ...prev, utm_campaign: cs[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) }));
      }
    }).catch(() => undefined);
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!selectedCampaignId) return;
    setLoading(true);
    campaignService.listUtmLinks(selectedCampaignId).then(ls => setLinks(ls)).catch(() => undefined).finally(() => setLoading(false));
    const c = campaigns.find(x => x.id === selectedCampaignId);
    if (c) setForm(prev => ({ ...prev, utm_campaign: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) }));
  }, [selectedCampaignId, campaigns]);

  async function createLink() {
    if (!form.label || !form.base_url || !form.utm_source || !selectedCampaignId) return;
    setCreating(true);
    try {
      const link = await campaignService.createUtmLink(selectedCampaignId, form);
      setLinks(prev => [link, ...prev]);
      setShowCreate(false);
      setForm(prev => ({ ...prev, label: '', utm_source: '', utm_content: '', utm_term: '' }));
    } catch { /* */ } finally { setCreating(false); }
  }

  async function deleteLink(id: string) {
    await campaignService.deleteUtmLink(id);
    setLinks(prev => prev.filter(l => l.id !== id));
  }

  function copyLink(link: UtmLink, type: 'short' | 'full') {
    const text = type === 'short' ? getShortLink(link) : link.full_url;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(link.id + type);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  const previewUrl = form.base_url && form.utm_source ? (() => {
    try {
      const url = new URL(form.base_url.startsWith('http') ? form.base_url : `https://${form.base_url}`);
      url.searchParams.set('utm_source', form.utm_source);
      url.searchParams.set('utm_medium', form.utm_medium);
      url.searchParams.set('utm_campaign', form.utm_campaign || 'campaign');
      if (form.utm_term) url.searchParams.set('utm_term', form.utm_term);
      if (form.utm_content) url.searchParams.set('utm_content', form.utm_content);
      return url.toString();
    } catch { return ''; }
  })() : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <select value={selectedCampaignId} onChange={e => setSelectedCampaignId(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400">
          <option value="">— Select Campaign —</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selectedCampaignId && (
          <button onClick={() => setShowCreate(!showCreate)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Link2 size={14} /> Generate UTM Link
          </button>
        )}
      </div>

      {showCreate && selectedCampaignId && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="font-bold text-slate-950">Generate UTM Link</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Label *</label>
              <input value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Facebook Ad #1" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Base URL *</label>
              <input value={form.base_url} onChange={e => setForm(p => ({ ...p, base_url: e.target.value }))} placeholder="https://yoursite.com/page" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Source *</label>
              <input value={form.utm_source} onChange={e => setForm(p => ({ ...p, utm_source: e.target.value }))} placeholder="e.g. facebook, newsletter" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Medium *</label>
              <select value={form.utm_medium} onChange={e => setForm(p => ({ ...p, utm_medium: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400">
                {MEDIUM_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Campaign Name</label>
              <input value={form.utm_campaign} onChange={e => setForm(p => ({ ...p, utm_campaign: e.target.value }))} placeholder="auto-filled from campaign" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Content (optional)</label>
              <input value={form.utm_content} onChange={e => setForm(p => ({ ...p, utm_content: e.target.value }))} placeholder="e.g. banner_top" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            </div>
          </div>
          {previewUrl && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-widest">Preview URL</p>
              <p className="text-xs text-indigo-600 break-all font-mono">{previewUrl}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button disabled={creating || !form.label || !form.base_url || !form.utm_source} onClick={createLink} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Generate & Save
            </button>
            <button onClick={() => setShowCreate(false)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
      ) : !selectedCampaignId ? (
        <EmptyState icon={<Link2 size={24} />} title="Select a campaign" description="Choose a campaign to view and manage its UTM tracking links." />
      ) : links.length === 0 ? (
        <EmptyState icon={<Link2 size={24} />} title="No UTM links yet" description="Generate tracked links to measure which sources drive the most clicks." action={<button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={14} /> Generate Link</button>} />
      ) : (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-widest text-slate-400">Label / Source</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-widest text-slate-400">Short Link</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-widest text-slate-400">Clicks</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-widest text-slate-400">Conv.</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-widest text-slate-400">CTR</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {links.map(link => (
                <tr key={link.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-slate-900">{link.label}</div>
                    <div className="text-xs text-slate-400">{link.utm_source} / {link.utm_medium}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-indigo-600 truncate max-w-[160px]">{getShortLink(link)}</span>
                      <button onClick={() => copyLink(link, 'short')} className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        {copied === link.id + 'short' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                      </button>
                      <a href={link.full_url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100"><ExternalLink size={12} /></a>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right font-bold text-slate-900">{fmtNum(link.clicks)}</td>
                  <td className="px-5 py-4 text-right font-bold text-green-600">{fmtNum(link.conversions)}</td>
                  <td className="px-5 py-4 text-right text-slate-600">{link.clicks > 0 ? `${Math.round((link.conversions / link.clicks) * 100)}%` : '—'}</td>
                  <td className="px-3 py-4">
                    <button onClick={() => deleteLink(link.id)} className="opacity-0 group-hover:opacity-100 rounded-xl p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-opacity">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Metrics Tab ──────────────────────────────────────────────────────────────

function MetricsTab({ campaignId }: { campaignId?: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignId ?? '');
  const [data, setData] = useState<{ campaign: Campaign; metrics: CampaignMetrics } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    campaignService.listCampaigns().then(cs => {
      setCampaigns(cs);
      if (!selectedCampaignId && cs[0]) setSelectedCampaignId(cs[0].id);
    }).catch(() => undefined);
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!selectedCampaignId) return;
    setLoading(true);
    campaignService.getCampaignMetrics(selectedCampaignId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [selectedCampaignId]);

  const sourceData = data?.metrics.clicksBySource.map((r, i) => ({
    name: `${r.utm_source}/${r.utm_medium}`,
    clicks: Number(r.clicks),
    conversions: Number(r.conversions),
    fill: COLORS[i % COLORS.length],
  })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <select value={selectedCampaignId} onChange={e => setSelectedCampaignId(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400">
          <option value="">— Select Campaign —</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!selectedCampaignId && <EmptyState icon={<BarChart2 size={24} />} title="Select a campaign" description="Choose a campaign to view its performance metrics." />}

      {loading && <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>}

      {data && !loading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Total Clicks', value: fmtNum(data.metrics.totalClicks), icon: <TrendingUp size={18} />, color: 'text-indigo-600' },
              { label: 'Conversions', value: fmtNum(data.metrics.totalConversions), icon: <Target size={18} />, color: 'text-green-600' },
              { label: 'Conv. Rate', value: `${data.metrics.conversionRate}%`, icon: <BarChart2 size={18} />, color: 'text-amber-600' },
              { label: 'Channels', value: String(data.metrics.channels.length), icon: <Megaphone size={18} />, color: 'text-blue-600' },
            ].map(kpi => (
              <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className={`mb-3 ${kpi.color}`}>{kpi.icon}</div>
                <div className="text-2xl font-black text-slate-950">{kpi.value}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Clicks by source */}
          {sourceData.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="mb-5 text-sm font-bold uppercase tracking-widest text-slate-400">Clicks by Source</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sourceData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="clicks" radius={[6, 6, 0, 0]}>
                    {sourceData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Channels */}
          {data.metrics.channels.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-400">Active Channels</h3>
              <div className="flex flex-wrap gap-3">
                {data.metrics.channels.map((ch, i) => {
                  const opt = CHANNEL_OPTIONS.find(c => c.value === ch.channel_type);
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: opt?.color ?? '#888' }} />
                      <span className="text-sm font-semibold text-slate-700">{opt?.label ?? ch.channel_type}</span>
                      <span className="text-xs text-slate-400">{ch.status}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No data note */}
          {sourceData.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="text-sm font-semibold text-slate-500">No click data yet.</p>
              <p className="mt-1 text-xs text-slate-400">Share your UTM links to start collecting metrics. Clicks are tracked automatically via the short link redirects.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Campaign Detail View ─────────────────────────────────────────────────────

type DetailTab = 'overview' | 'brief' | 'content' | 'links' | 'kpis' | 'activity';

function HealthRing({ score }: { score: number }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#ef4444' : '#94a3b8';
  const label = score >= 80 ? 'Exceeding' : score >= 60 ? 'On Track' : score >= 40 ? 'Needs Work' : 'Critical';
  const deg = score * 3.6;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, #f1f5f9 0deg)` }}>
        <div className="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-white">
          <span className="text-xl font-black text-slate-950">{score}</span>
        </div>
      </div>
      <span className="text-xs font-bold" style={{ color }}>{label}</span>
    </div>
  );
}

function KpiProgressBar({ kpi, onEdit, onDelete }: { kpi: CampaignKpi; onEdit: (k: CampaignKpi) => void; onDelete: (id: string) => void }) {
  const pct = Number(kpi.target_value) > 0 ? Math.min(100, Math.round((Number(kpi.current_value) / Number(kpi.target_value)) * 100)) : 0;
  const color = pct >= 100 ? '#10b981' : pct >= 60 ? '#2563EB' : pct >= 30 ? '#f59e0b' : '#ef4444';
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-900 text-sm">{kpi.name}</span>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(kpi)} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={12} /></button>
          <button onClick={() => onDelete(kpi.id)} className="rounded-lg p-1 text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-1.5">
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <span className="text-xs font-bold w-9 text-right" style={{ color }}>{pct}%</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{kpi.metric_type === 'currency' ? '$' : ''}{fmtNum(Number(kpi.current_value))}{kpi.unit ? ` ${kpi.unit}` : ''}</span>
        <span>Target: {kpi.metric_type === 'currency' ? '$' : ''}{fmtNum(Number(kpi.target_value))}{kpi.unit ? ` ${kpi.unit}` : ''}</span>
      </div>
    </div>
  );
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  post: 'Social Post', email: 'Email', automation: 'Automation',
  card: 'Card', survey: 'Survey', custom: 'Custom',
};

function CampaignDetail({ campaign: initialCampaign, onBack }: { campaign: Campaign; onBack: () => void }) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [detail, setDetail] = useState<CampaignDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  const [kpis, setKpis] = useState<CampaignKpi[]>([]);
  const [showKpiForm, setShowKpiForm] = useState(false);
  const [editingKpi, setEditingKpi] = useState<CampaignKpi | null>(null);
  const [kpiForm, setKpiForm] = useState({ name: '', metric_type: 'number', target_value: '', current_value: '', unit: '' });
  const [savingKpi, setSavingKpi] = useState(false);

  const [content, setContent] = useState<CampaignContentItem[]>([]);
  const [showContentForm, setShowContentForm] = useState(false);
  const [contentForm, setContentForm] = useState({ content_type: 'post', title: '', description: '', status: 'draft', channel: '' });
  const [savingContent, setSavingContent] = useState(false);

  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [aov, setAov] = useState('');

  // KPI suggestions for existing campaigns
  const [showKpiSuggestions, setShowKpiSuggestions] = useState(false);
  const [suggestSelected, setSuggestSelected] = useState<Set<string>>(new Set(
    (GOAL_KPI_SUGGESTIONS[initialCampaign.goal as CampaignGoal] ?? []).map(k => k.name)
  ));

  function toggleSuggest(name: string) {
    setSuggestSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  async function createSuggestedKpis() {
    setSavingKpi(true);
    const toCreate = (GOAL_KPI_SUGGESTIONS[campaign.goal as CampaignGoal] ?? []).filter(k => suggestSelected.has(k.name));
    try {
      const created: CampaignKpi[] = [];
      for (const kpi of toCreate) {
        const k = await campaignService.createKpi(campaign.id, { name: kpi.name, metric_type: kpi.metric_type, target_value: 0, current_value: 0, unit: kpi.unit });
        created.push(k);
      }
      setKpis(prev => [...prev, ...created]);
      setShowKpiSuggestions(false);
    } catch { /* */ } finally { setSavingKpi(false); }
  }

  // Brief tab state
  const s = (campaign.settings ?? {}) as Record<string, string>;
  const [briefObjective, setBriefObjective] = useState(s.objective ?? '');
  const [briefAudience, setBriefAudience] = useState(s.target_audience ?? '');
  const [briefType, setBriefType] = useState(s.campaign_type ?? '');
  const [briefValueProp, setBriefValueProp] = useState(s.value_prop ?? '');
  const [briefCta, setBriefCta] = useState(s.cta ?? '');
  const [briefTone, setBriefTone] = useState(s.tone ?? '');
  const [briefNotes, setBriefNotes] = useState(s.notes ?? '');
  const [savingBrief, setSavingBrief] = useState(false);
  const [briefSaved, setBriefSaved] = useState(false);

  async function saveBrief() {
    setSavingBrief(true);
    try {
      const updated = await campaignService.updateCampaign(campaign.id, {
        settings: { objective: briefObjective, target_audience: briefAudience, campaign_type: briefType, value_prop: briefValueProp, cta: briefCta, tone: briefTone, notes: briefNotes },
      } as any);
      setCampaign(updated);
      setBriefSaved(true);
      setTimeout(() => setBriefSaved(false), 2000);
    } catch { /* */ } finally { setSavingBrief(false); }
  }

  function copyBrief() {
    const lines = [
      `CAMPAIGN BRIEF — ${campaign.name}`,
      `Goal: ${goalLabel(campaign.goal)}`,
      briefObjective ? `Objective: ${briefObjective}` : '',
      briefAudience ? `Target Audience: ${briefAudience}` : '',
      '',
      briefType ? `Campaign Type: ${CAMPAIGN_TYPES.find(t => t.value === briefType)?.label ?? briefType}` : '',
      briefTone ? `Tone of Voice: ${briefTone}` : '',
      briefValueProp ? `Value Proposition: ${briefValueProp}` : '',
      briefCta ? `Call-to-Action: "${briefCta}"` : '',
      '',
      campaign.start_date ? `Timeline: ${campaign.start_date}${campaign.end_date ? ` → ${campaign.end_date}` : ''}` : '',
      campaign.budget ? `Budget: $${campaign.budget}` : '',
      campaign.target_url ? `Target URL: ${campaign.target_url}` : '',
      briefNotes ? `\nNotes:\n${briefNotes}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines).catch(() => {});
  }

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await campaignService.getCampaignDetail(campaign.id);
      setDetail(d);
      setKpis(d.kpis);
      setContent(d.content);
    } catch { /* */ } finally { setLoading(false); }
  }, [campaign.id]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (activeTab === 'activity' && activity.length === 0) {
      setActivityLoading(true);
      campaignService.getActivity(campaign.id).then(setActivity).catch(() => {}).finally(() => setActivityLoading(false));
    }
  }, [activeTab, campaign.id, activity.length]);

  async function handleLaunch() {
    if (!confirm('Launch this campaign? Status will be set to active.')) return;
    setLaunching(true);
    try {
      const updated = await campaignService.launchCampaign(campaign.id);
      setCampaign(updated);
    } catch { /* */ } finally { setLaunching(false); }
  }

  async function saveKpi() {
    setSavingKpi(true);
    try {
      if (editingKpi) {
        const updated = await campaignService.updateKpi(editingKpi.id, { name: kpiForm.name, metric_type: kpiForm.metric_type as any, target_value: parseFloat(kpiForm.target_value) || 0, current_value: parseFloat(kpiForm.current_value) || 0, unit: kpiForm.unit });
        setKpis(prev => prev.map(k => k.id === updated.id ? updated : k));
      } else {
        const created = await campaignService.createKpi(campaign.id, { name: kpiForm.name, metric_type: kpiForm.metric_type as any, target_value: parseFloat(kpiForm.target_value) || 0, current_value: parseFloat(kpiForm.current_value) || 0, unit: kpiForm.unit });
        setKpis(prev => [...prev, created]);
      }
      setShowKpiForm(false); setEditingKpi(null);
      setKpiForm({ name: '', metric_type: 'number', target_value: '', current_value: '', unit: '' });
    } catch { /* */ } finally { setSavingKpi(false); }
  }

  async function deleteKpi(id: string) {
    if (!confirm('Delete this KPI?')) return;
    await campaignService.deleteKpi(id);
    setKpis(prev => prev.filter(k => k.id !== id));
  }

  function startEditKpi(kpi: CampaignKpi) {
    setEditingKpi(kpi);
    setKpiForm({ name: kpi.name, metric_type: kpi.metric_type, target_value: String(kpi.target_value), current_value: String(kpi.current_value), unit: kpi.unit });
    setShowKpiForm(true);
  }

  async function saveContent() {
    setSavingContent(true);
    try {
      const item = await campaignService.addContent(campaign.id, contentForm as any);
      setContent(prev => [item, ...prev]);
      setShowContentForm(false);
      setContentForm({ content_type: 'post', title: '', description: '', status: 'draft', channel: '' });
    } catch { /* */ } finally { setSavingContent(false); }
  }

  const stats = detail?.stats;
  const TABS: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'brief', label: 'Brief' },
    { id: 'content', label: content.length > 0 ? `Content (${content.length})` : 'Content' },
    { id: 'links', label: 'UTM Links' },
    { id: 'kpis', label: kpis.length > 0 ? `KPIs (${kpis.length})` : 'KPIs' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="mt-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 shrink-0">← Back</button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-black text-slate-950">{campaign.name}</h2>
              <StatusBadge status={campaign.status as CampaignStatus} />
              <GoalBadge goal={campaign.goal} />
            </div>
            {campaign.description && <p className="text-sm text-slate-500 mt-0.5">{campaign.description}</p>}
          </div>
        </div>
        {campaign.status !== 'active' && campaign.status !== 'completed' && (
          <button disabled={launching} onClick={handleLaunch} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0">
            {launching ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {launching ? 'Launching…' : 'Launch Campaign'}
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px ${activeTab === t.id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
      ) : (
        <>
          {/* OVERVIEW */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center gap-5">
                  <HealthRing score={stats.healthScore} />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Campaign Health</div>
                    <div className="text-sm text-slate-500">Based on setup, links, and KPI progress</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Timeline</div>
                  <div className="mb-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${stats.progressPct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Day {stats.elapsedDays}</span>
                    <span className="font-bold">{stats.progressPct}%</span>
                    <span>{stats.totalDays} days total</span>
                  </div>
                  {campaign.start_date && <div className="mt-2 text-xs text-slate-400">{campaign.start_date}{campaign.end_date ? ` → ${campaign.end_date}` : ''}</div>}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 grid grid-cols-2 gap-3">
                  {[
                    { label: 'Clicks', value: fmtNum(stats.totalClicks), color: 'text-slate-950' },
                    { label: 'Conversions', value: fmtNum(stats.totalConversions), color: 'text-green-600' },
                    { label: 'KPI Progress', value: `${stats.kpiProgress}%`, color: 'text-indigo-600' },
                    { label: 'Channels', value: String(detail?.channels.length ?? 0), color: 'text-slate-950' },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="text-xs text-slate-400">{s.label}</div>
                      <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {detail?.channels && detail.channels.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Channels</h3>
                  <div className="flex flex-wrap gap-3">
                    {detail.channels.map(ch => {
                      const opt = CHANNEL_OPTIONS.find(c => c.value === ch.channel_type);
                      return (
                        <div key={ch.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2">
                          <ChannelIcon value={ch.channel_type} size={22} />
                          <span className="text-sm font-semibold text-slate-700">{opt?.label ?? ch.channel_type}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {kpis.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">KPI Overview</h3>
                    <button onClick={() => setActiveTab('kpis')} className="text-xs font-semibold text-indigo-600 hover:underline">Manage →</button>
                  </div>
                  <div className="space-y-3">
                    {kpis.slice(0, 3).map(k => {
                      const pct = Number(k.target_value) > 0 ? Math.min(100, Math.round((Number(k.current_value) / Number(k.target_value)) * 100)) : 0;
                      const color = pct >= 100 ? '#10b981' : pct >= 60 ? '#2563EB' : pct >= 30 ? '#f59e0b' : '#ef4444';
                      return (
                        <div key={k.id} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 text-xs font-semibold text-slate-600 truncate">{k.name}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-xs font-bold w-10 text-right" style={{ color }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {detail?.funnels && detail.funnels.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Funnels</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {detail.funnels.map((f: any) => (
                      <div key={f.id} className="rounded-xl border border-slate-100 p-3">
                        <div className="font-semibold text-slate-900 text-sm truncate">{f.name}</div>
                        <div className="mt-1 text-xs text-slate-400">{f.steps} steps · {fmtNum(f.events)} events</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* BRIEF */}
          {activeTab === 'brief' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-slate-950">Campaign Brief</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Document your strategy so your whole team stays aligned.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={copyBrief} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                    <Copy size={13} /> Copy Brief
                  </button>
                  <button disabled={savingBrief} onClick={saveBrief} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                    {savingBrief ? <Loader2 size={13} className="animate-spin" /> : briefSaved ? <Check size={13} /> : null}
                    {briefSaved ? 'Saved!' : 'Save Brief'}
                  </button>
                </div>
              </div>

              {/* Overview */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Campaign Overview</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Specific Objective</label>
                    <input value={briefObjective} onChange={e => setBriefObjective(e.target.value)} placeholder='"Increase newsletter signups by 500 in 30 days"' className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Target Audience / Buyer Persona</label>
                    <textarea value={briefAudience} onChange={e => setBriefAudience(e.target.value)} rows={2} placeholder='"Tech-savvy millennials aged 25–35 who value convenience..."' className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400 resize-none" />
                  </div>
                </div>
              </div>

              {/* Strategy */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Campaign Strategy</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Campaign Type</label>
                    <select value={briefType} onChange={e => setBriefType(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none">
                      <option value="">— Select type —</option>
                      {CAMPAIGN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Tone of Voice</label>
                    <select value={briefTone} onChange={e => setBriefTone(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none">
                      <option value="">— Select tone —</option>
                      {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Value Proposition</label>
                    <textarea value={briefValueProp} onChange={e => setBriefValueProp(e.target.value)} rows={2} placeholder='"The only tool that lets you build campaigns in under 5 minutes..."' className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400 resize-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Call-to-Action</label>
                    <input value={briefCta} onChange={e => setBriefCta(e.target.value)} placeholder='"Start Free Trial", "Shop Now", "Get the Guide"' className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  </div>
                </div>
              </div>

              {/* Metrics to Monitor */}
              <div className="rounded-2xl border border-indigo-50 bg-indigo-50/60 p-5">
                <h4 className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-3">Metrics to Monitor</h4>
                <div className="grid grid-cols-3 gap-3">
                  {(GOAL_KPI_SUGGESTIONS[campaign.goal as CampaignGoal] ?? []).map(k => (
                    <div key={k.name} className="rounded-xl border border-indigo-100 bg-white px-3 py-2.5">
                      <div className="text-sm font-semibold text-slate-800">{k.name}</div>
                      <div className="text-xs text-slate-400 capitalize mt-0.5">{k.metric_type}{k.unit ? ` · ${k.unit}` : ''}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-indigo-400">These are recommended for <strong>{goalLabel(campaign.goal)}</strong> campaigns. Add them in the KPIs tab to start tracking.</p>
              </div>

              {/* Notes */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Additional Notes</h4>
                <textarea value={briefNotes} onChange={e => setBriefNotes(e.target.value)} rows={4} placeholder="Competitive notes, key differentiators, messaging guidelines, influencer strategy, contingency plans..." className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400 resize-none" />
              </div>
            </div>
          )}

          {/* CONTENT */}
          {activeTab === 'content' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">Link posts, emails, automations, and other assets to this campaign.</p>
                <button onClick={() => setShowContentForm(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                  <Plus size={14} /> Add Content
                </button>
              </div>
              {showContentForm && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                  <h3 className="font-bold text-slate-950">Add Content Item</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Type</label>
                      <select value={contentForm.content_type} onChange={e => setContentForm(p => ({ ...p, content_type: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none">
                        {Object.entries(CONTENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Channel</label>
                      <select value={contentForm.channel} onChange={e => setContentForm(p => ({ ...p, channel: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none">
                        <option value="">— Any —</option>
                        {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Title *</label>
                      <input value={contentForm.title} onChange={e => setContentForm(p => ({ ...p, title: e.target.value }))} placeholder="Content title" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Status</label>
                      <select value={contentForm.status} onChange={e => setContentForm(p => ({ ...p, status: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none">
                        {['draft', 'scheduled', 'live', 'published', 'archived'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button disabled={savingContent || !contentForm.title} onClick={saveContent} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                      {savingContent ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                    </button>
                    <button onClick={() => setShowContentForm(false)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              )}
              {content.length === 0 && !showContentForm ? (
                <EmptyState icon={<FileText size={24} />} title="No content linked" description="Link posts, emails, and other assets to track what's part of this campaign." action={<button onClick={() => setShowContentForm(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={14} /> Add Content</button>} />
              ) : (
                <div className="space-y-2">
                  {content.map(item => {
                    const chOpt = CHANNEL_OPTIONS.find(c => c.value === item.channel);
                    return (
                      <div key={item.id} className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                          <span className="text-xs font-bold text-slate-500">{item.content_type.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-900 text-sm">{item.title}</div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                            <span>{CONTENT_TYPE_LABELS[item.content_type] ?? item.content_type}</span>
                            {chOpt && <><span className="text-slate-300">·</span><span>{chOpt.label}</span></>}
                            <span className="rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-500 font-semibold">{item.status}</span>
                          </div>
                        </div>
                        <button onClick={() => { campaignService.removeContent(item.id); setContent(prev => prev.filter(c => c.id !== item.id)); }} className="opacity-0 group-hover:opacity-100 rounded-xl p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-opacity"><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* LINKS */}
          {activeTab === 'links' && <LinksTab campaignId={campaign.id} />}

          {/* KPIs */}
          {activeTab === 'kpis' && (
            <div className="space-y-4">
              {/* ROI Calculator */}
              {campaign.budget != null && campaign.budget > 0 && (
                <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-bold text-indigo-900">ROI Calculator</span>
                    <span className="text-xs text-indigo-400">Based on your campaign budget</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Avg. Order Value ($)</label>
                      <input type="number" value={aov} onChange={e => setAov(e.target.value)} placeholder="e.g. 49" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Conversions</label>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900">{fmtNum(Number(campaign.total_conversions || detail?.stats.totalConversions || 0))}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Budget</label>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900">${fmtNum(campaign.budget)}</div>
                    </div>
                  </div>
                  {Number(aov) > 0 && (() => {
                    const convs = Number(campaign.total_conversions || detail?.stats.totalConversions || 0);
                    const revenue = Number(aov) * convs;
                    const profit = revenue - campaign.budget!;
                    const roi = (profit / campaign.budget!) * 100;
                    return (
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 text-center">
                          <div className="text-lg font-black text-slate-900">${fmtNum(revenue)}</div>
                          <div className="text-xs text-slate-400 mt-0.5">Revenue</div>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200 px-4 py-3 text-center">
                          <div className={`text-lg font-black ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{profit >= 0 ? '+' : ''}${fmtNum(Math.abs(profit))}</div>
                          <div className="text-xs text-slate-400 mt-0.5">Profit / Loss</div>
                        </div>
                        <div className={`rounded-xl border px-4 py-3 text-center ${roi >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                          <div className={`text-lg font-black ${roi >= 0 ? 'text-green-600' : 'text-red-500'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
                          <div className="text-xs text-slate-400 mt-0.5">ROI</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">Define measurable targets and track progress against each goal.</p>
                <div className="flex items-center gap-2">
                  {kpis.length > 0 && (GOAL_KPI_SUGGESTIONS[campaign.goal as CampaignGoal] ?? []).some(k => !kpis.find(x => x.name === k.name)) && (
                    <button onClick={() => setShowKpiSuggestions(v => !v)} className="inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
                      <TrendingUp size={14} /> Suggest KPIs
                    </button>
                  )}
                  <button onClick={() => { setEditingKpi(null); setKpiForm({ name: '', metric_type: 'number', target_value: '', current_value: '', unit: '' }); setShowKpiForm(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                    <Plus size={14} /> Add KPI
                  </button>
                </div>
              </div>

              {showKpiSuggestions && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-indigo-500">Suggested for {goalLabel(campaign.goal)}</span>
                    <button onClick={() => setShowKpiSuggestions(false)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                  </div>
                  <div className="space-y-2 mb-4">
                    {(GOAL_KPI_SUGGESTIONS[campaign.goal as CampaignGoal] ?? [])
                      .filter(k => !kpis.find(x => x.name === k.name))
                      .map(k => (
                        <label key={k.name} className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={suggestSelected.has(k.name)} onChange={() => toggleSuggest(k.name)} className="rounded accent-indigo-600" />
                          <span className="text-sm font-semibold text-slate-800">{k.name}</span>
                          <span className="text-xs text-slate-400 capitalize">{k.metric_type}{k.unit ? ` · ${k.unit}` : ''}</span>
                        </label>
                      ))
                    }
                  </div>
                  <button disabled={savingKpi || suggestSelected.size === 0} onClick={createSuggestedKpis} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {savingKpi ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Create {suggestSelected.size} KPI{suggestSelected.size !== 1 ? 's' : ''}
                  </button>
                </div>
              )}
              {showKpiForm && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                  <h3 className="font-bold text-slate-950">{editingKpi ? 'Edit KPI' : 'Add KPI'}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Name *</label>
                      <input value={kpiForm.name} onChange={e => setKpiForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Email Open Rate, Website Traffic, Signups" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Type</label>
                      <select value={kpiForm.metric_type} onChange={e => setKpiForm(p => ({ ...p, metric_type: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none">
                        <option value="number">Number</option>
                        <option value="percentage">Percentage (%)</option>
                        <option value="currency">Currency ($)</option>
                        <option value="ratio">Ratio</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Unit (optional)</label>
                      <input value={kpiForm.unit} onChange={e => setKpiForm(p => ({ ...p, unit: e.target.value }))} placeholder="e.g. subscribers, clicks" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Target *</label>
                      <input type="number" value={kpiForm.target_value} onChange={e => setKpiForm(p => ({ ...p, target_value: e.target.value }))} placeholder="e.g. 1000" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Current</label>
                      <input type="number" value={kpiForm.current_value} onChange={e => setKpiForm(p => ({ ...p, current_value: e.target.value }))} placeholder="0" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button disabled={savingKpi || !kpiForm.name || !kpiForm.target_value} onClick={saveKpi} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                      {savingKpi ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editingKpi ? 'Update' : 'Add KPI'}
                    </button>
                    <button onClick={() => { setShowKpiForm(false); setEditingKpi(null); }} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              )}
              {kpis.length === 0 && !showKpiForm && !showKpiSuggestions ? (
                <EmptyState icon={<Target size={24} />} title="No KPIs set" description="Add measurable goals and targets to track this campaign's success."
                  action={
                    <div className="flex flex-col items-center gap-3">
                      {(GOAL_KPI_SUGGESTIONS[campaign.goal as CampaignGoal] ?? []).length > 0 && (
                        <button onClick={() => setShowKpiSuggestions(true)} className="inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
                          <TrendingUp size={14} /> Suggest KPIs for {goalLabel(campaign.goal)}
                        </button>
                      )}
                      <button onClick={() => { setKpiForm({ name: '', metric_type: 'number', target_value: '', current_value: '', unit: '' }); setShowKpiForm(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={14} /> Add KPI manually</button>
                    </div>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {kpis.map(k => <KpiProgressBar key={k.id} kpi={k} onEdit={startEditKpi} onDelete={deleteKpi} />)}
                </div>
              )}
            </div>
          )}

          {/* ACTIVITY */}
          {activeTab === 'activity' && (
            <div className="space-y-3">
              {activityLoading ? (
                <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
              ) : activity.length === 0 ? (
                <EmptyState icon={<Activity size={24} />} title="No activity yet" description="Events will appear here as visitors interact with your funnels and UTM links." />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                  {activity.map(ev => (
                    <div key={ev.id} className="flex items-start gap-4 px-5 py-3.5">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                        <span className="text-[10px] font-bold text-slate-400">{(ev.event_type ?? 'EV').slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{ev.event_name ?? ev.event_type}</span>
                          {ev.utm_source && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">{ev.utm_source}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                          {ev.funnel_name && <span>{ev.funnel_name}</span>}
                          {ev.step_name && <><span>·</span><span>{ev.step_name}</span></>}
                          {ev.url && <span className="truncate max-w-[200px]">{ev.url}</span>}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{new Date(ev.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'campaigns' | 'funnels' | 'links' | 'metrics';

export default function MarketingCampaigns() {
  const [activeTab, setActiveTab] = useState<Tab>('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'campaigns', label: 'Campaigns', icon: <Megaphone size={15} /> },
    { id: 'funnels', label: 'Funnels', icon: <Filter size={15} /> },
    { id: 'links', label: 'UTM Links', icon: <Link2 size={15} /> },
    { id: 'metrics', label: 'Performance', icon: <BarChart2 size={15} /> },
  ];

  if (selectedCampaign) {
    return (
      <div className="space-y-0">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Campaigns</div>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] text-slate-950">Campaigns</h1>
        </div>
        <CampaignDetail campaign={selectedCampaign} onBack={() => setSelectedCampaign(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Marketing</div>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] text-slate-950">Campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Create multi-channel campaigns, build conversion funnels, generate UTM-tracked links, and measure performance in one place.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px ${activeTab === t.id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'campaigns' && <CampaignsTab onSelect={setSelectedCampaign} />}
      {activeTab === 'funnels' && <FunnelsTab />}
      {activeTab === 'links' && <LinksTab />}
      {activeTab === 'metrics' && <MetricsTab />}
    </div>
  );
}
