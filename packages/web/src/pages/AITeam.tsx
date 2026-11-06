import { useCallback, useEffect, useRef, useState } from 'react';
import AgentSchedulesPanel from '../components/AgentSchedulesPanel';
import TeamDirectorPanel from '../components/TeamDirectorPanel';
import {
  CheckCircle, ChevronRight, Loader2, RefreshCw, Sparkles,
  Target, Users, Globe, MessageSquare, BarChart2, Zap,
  CheckSquare, Square, Clock, ThumbsUp, ThumbsDown, X,
  Pencil, Bot, Play, ArrowRight, Network,
  FileText, ExternalLink, Lightbulb, LayoutList,
  MessageCircle, Calendar, ChevronLeft, Send,
  Wand2, CalendarDays, Rocket, Copy, Trash2, Check, CheckCheck, Layers,
  type LucideIcon,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

function tok() { return localStorage.getItem('auth_token') ?? ''; }
const BASE = () => getApiBaseUrl();

// ── Types ──────────────────────────────────────────────────────────────────────

type BrandProfile = {
  id: string;
  user_id: string;
  brand_name: string;
  niche: string;
  tone: string;
  audience: string;
  goals: string[];
  platforms: string[];
  website: string;
  extra_notes: string;
  setup_done: boolean;
  updated_at: string;
};

type AgentTask = {
  id: string;
  agent_key: string;
  task_type: string;
  title: string;
  body: string;
  payload: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: string;
  decided_at: string | null;
  created_at: string;
};

type AgentDraft = {
  id: string;
  agent_key: string;
  task_id: string | null;
  task_type: string;
  title: string;
  content: string;
  payload: Record<string, any>;
  blog_post_id: string | null;
  created_at: string;
};

type ExecToast = {
  message: string;
  blog_post_id?: string | null;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type VoiceResult = {
  tone?: string;
  vocabulary?: string;
  personality?: string[];
  do_list?: string[];
  dont_list?: string[];
  one_liner?: string;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const AGENT_DEFS = [
  // Strategy & Intelligence
  {
    key: 'sage', name: 'Sage', role: 'Strategy Analyst', icon: '◈', color: '#10B981',
    description: 'Builds marketing strategies, competitor analyses, and 30-day content roadmaps.',
  },
  {
    key: 'trend_research', name: 'Trend', role: 'Trend Research', icon: '◎', color: '#06B6D4',
    description: 'Scans viral content, rising topics, and niche trends to keep your brand ahead of the curve.',
  },
  {
    key: 'audience_research', name: 'Persona', role: 'Audience Research', icon: '◑', color: '#2563EB',
    description: 'Builds detailed audience personas from pain points, objections, and buying motivations.',
  },
  {
    key: 'seo_research', name: 'SEO', role: 'SEO Keyword Research', icon: '⊗', color: '#059669',
    description: 'Discovers keyword clusters, search intent, and content briefs optimized for organic growth.',
  },
  // Content Creation
  {
    key: 'daky', name: 'Daky', role: 'Content Writer', icon: '✦', color: '#2563EB',
    description: 'Crafts long-form blog posts, articles, and marketing copy that drives traffic and conversions.',
  },
  {
    key: 'hook_writing', name: 'Hook', role: 'Hook Writing', icon: '⚡', color: '#D97706',
    description: 'Generates scroll-stopping opening lines, subject lines, and ad headlines built to capture attention.',
  },
  {
    key: 'social_caption', name: 'Caption', role: 'Social Caption', icon: '✎', color: '#DB2777',
    description: 'Writes platform-optimized captions with hooks, CTAs, and hashtag strategies for every network.',
  },
  {
    key: 'video_script', name: 'Script', role: 'Video Script', icon: '▶', color: '#DC2626',
    description: 'Scripts short-form Reels/TikTok content and long-form YouTube videos with retention structure.',
  },
  // Creative & Paid
  {
    key: 'nova', name: 'Nova', role: 'Creative Director', icon: '◉', color: '#EC4899',
    description: 'Generates visual concepts, creative briefs, and branded image/video direction for campaigns.',
  },
  {
    key: 'ad_copy', name: 'Ads', role: 'Ad Copy', icon: '◆', color: '#EA580C',
    description: 'Creates high-converting ad copy packs for Meta, Google, and YouTube with multiple angle variations.',
  },
  {
    key: 'thumbnail_design', name: 'Thumb', role: 'Thumbnail Design', icon: '▣', color: '#9333EA',
    description: 'Produces YouTube thumbnail concepts, A/B test briefs, and social creative direction.',
  },
  {
    key: 'meta_ads', name: 'Meta', role: 'Paid Social Manager', icon: '⊛', color: '#1877F2',
    description: 'Plans campaign structures, audience targeting, budget allocation, and daily performance optimizations.',
  },
  // Analytics & Automation
  {
    key: 'aria', name: 'Aria', role: 'Analytics & Performance', icon: '⊕', color: '#F59E0B',
    description: 'Tracks KPIs, surfaces performance insights, and recommends data-driven optimizations.',
  },
  {
    key: 'flux', name: 'Flux', role: 'Automation & Workflows', icon: '⟳', color: '#2563EB',
    description: 'Automates post scheduling, platform integrations, and end-to-end workflow orchestration.',
  },
  // Campaign Planning
  {
    key: 'campaign_brief', name: 'Brief', role: 'Campaign Brief Builder', icon: '◫', color: '#0EA5E9',
    description: 'Produces complete, ready-to-execute campaign briefs — channel plan, content calendar, email sequence, UTM parameters, and KPIs in one document.',
  },
];

const NICHES = [
  'E-commerce', 'SaaS / Tech', 'Coaching & Consulting', 'Health & Wellness',
  'Fashion & Beauty', 'Food & Beverage', 'Real Estate', 'Finance',
  'Education', 'Fitness', 'Travel', 'Gaming', 'Entertainment', 'Non-profit', 'Other',
];

const TONES = [
  'Professional', 'Casual & Friendly', 'Bold & Confident', 'Inspirational',
  'Humorous', 'Educational', 'Luxury & Premium', 'Minimalist',
];

const GOAL_OPTIONS = [
  'Grow followers', 'Increase engagement', 'Drive website traffic',
  'Generate leads', 'Boost sales', 'Build brand awareness',
  'Launch a product', 'Nurture existing audience',
];

const PLATFORM_OPTIONS = [
  'Instagram', 'Facebook', 'Twitter / X', 'LinkedIn',
  'TikTok', 'YouTube', 'Pinterest', 'Threads',
];

const AGENT_GROUPS = [
  { label: 'Strategy & Intelligence', keys: ['sage', 'trend_research', 'audience_research', 'seo_research'] },
  { label: 'Content Creation', keys: ['daky', 'hook_writing', 'social_caption', 'video_script'] },
  { label: 'Creative & Paid', keys: ['nova', 'ad_copy', 'thumbnail_design', 'meta_ads'] },
  { label: 'Analytics & Automation', keys: ['aria', 'flux'] },
  { label: 'Campaign Planning', keys: ['campaign_brief'] },
];

const BRAND_PRESETS = [
  {
    name: 'SaaS / AI OS',
    brand_name: 'Dakyworld AI OS',
    niche: 'SaaS / Tech',
    website: 'https://dakyworld.com',
    tone: 'Bold & Confident',
    audience: 'Agencies, founders, and growth marketers looking to orchestrate multi-channel content autonomously.',
    goals: ['Generate leads', 'Drive website traffic', 'Build brand awareness'],
    platforms: ['LinkedIn', 'Twitter / X', 'YouTube'],
    extra_notes: 'Emphasize high ROI, autonomous multi-agent speed, and replacing fragmented marketing tools.',
  },
  {
    name: 'Luxury E-Commerce',
    brand_name: 'Aura Maison',
    niche: 'Fashion & Beauty',
    website: 'https://auramaison.com',
    tone: 'Luxury & Premium',
    audience: 'Discerning buyers seeking sustainable luxury craftsmanship, timeless aesthetics, and mindful design.',
    goals: ['Boost sales', 'Build brand awareness', 'Nurture existing audience'],
    platforms: ['Instagram', 'Pinterest', 'TikTok'],
    extra_notes: 'Tone must remain understated, elevated, and sensory. Avoid aggressive sales copy.',
  },
  {
    name: 'B2B Tech Agency',
    brand_name: 'Apex Growth Partners',
    niche: 'Coaching & Consulting',
    website: 'https://apexgrowth.io',
    tone: 'Professional',
    audience: 'Venture-backed B2B founders and CMOs seeking predictable enterprise pipeline.',
    goals: ['Generate leads', 'Grow followers', 'Launch a product'],
    platforms: ['LinkedIn', 'Twitter / X'],
    extra_notes: 'Lead with hard metrics, conversion case studies, and proprietary growth playbooks.',
  },
  {
    name: 'Creator / Solo Founder',
    brand_name: 'The Modern Solopreneur',
    niche: 'Education',
    website: 'https://modernsolo.co',
    tone: 'Casual & Friendly',
    audience: 'Creators, freelancers, and indie hackers scaling one-person profitable media businesses.',
    goals: ['Grow followers', 'Increase engagement', 'Build brand awareness'],
    platforms: ['Twitter / X', 'YouTube', 'Instagram'],
    extra_notes: 'Share actionable frameworks, transparent build-in-public metrics, and authentic personal anecdotes.',
  },
];

// ── Brand Wizard ───────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

function BrandWizard({
  initial,
  onSaved,
}: {
  initial: BrandProfile | null;
  onSaved: (p: BrandProfile) => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brandName, setBrandName] = useState(initial?.brand_name ?? '');
  const [niche, setNiche]         = useState(initial?.niche ?? '');
  const [website, setWebsite]     = useState(initial?.website ?? '');
  const [tone, setTone]           = useState(initial?.tone ?? '');
  const [audience, setAudience]   = useState(initial?.audience ?? '');
  const [goals, setGoals]         = useState<string[]>(initial?.goals ?? []);
  const [platforms, setPlatforms] = useState<string[]>(initial?.platforms ?? []);
  const [extraNotes, setExtraNotes] = useState(initial?.extra_notes ?? '');

  const applyPreset = (preset: typeof BRAND_PRESETS[number]) => {
    setBrandName(preset.brand_name);
    setNiche(preset.niche);
    setWebsite(preset.website);
    setTone(preset.tone);
    setAudience(preset.audience);
    setGoals(preset.goals);
    setPlatforms(preset.platforms);
    setExtraNotes(preset.extra_notes);
  };

  const toggleGoal = (g: string) =>
    setGoals((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const save = async (done: boolean) => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BASE()}/api/user/brand-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({
          brand_name: brandName, niche, tone, audience, goals, platforms,
          website, extra_notes: extraNotes, setup_done: done,
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onSaved(d.profile);
      if (done) return;
      setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const STEPS = [
    { num: 1, label: 'Brand' },
    { num: 2, label: 'Audience' },
    { num: 3, label: 'Goals' },
    { num: 4, label: 'Confirm' },
  ];

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ background: '#10B98118', color: '#10B981' }}>
          ◈
        </div>
        <div>
          <p className="font-black text-slate-950 tracking-tight">
            {initial?.setup_done ? 'Edit Brand Profile' : 'Set up your brand with Sage'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Your AI team reads this profile to tailor every piece of content to your brand.
          </p>
        </div>
      </div>

      {/* 1-Click Brand Presets banner */}
      <div className="mb-6 rounded-xl border border-emerald-200 bg-white/90 p-3.5 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 mb-2">
          <Sparkles size={13} className="text-emerald-500" />
          <span>Quick Setup: 1-Click Brand Presets</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {BRAND_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition flex items-center gap-1"
            >
              <span>+</span> {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStep(s.num as WizardStep)}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition ${
                step === s.num
                  ? 'bg-emerald-500 text-white'
                  : step > s.num
                  ? 'bg-emerald-200 text-emerald-700'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > s.num ? <CheckCircle size={12} /> : s.num}
            </button>
            <span className={`text-[11px] font-medium ${step === s.num ? 'text-emerald-700' : 'text-slate-400'}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className="w-4 h-px bg-slate-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 1 — Brand basics */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Brand / Business Name</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="e.g. Dakyworld Studio" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Industry / Niche</label>
            <div className="flex flex-wrap gap-1.5">
              {NICHES.map((n) => (
                <button key={n} type="button" onClick={() => setNiche(n)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    niche === n
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Website (optional)</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="https://yourwebsite.com" type="url" />
          </div>
        </div>
      )}

      {/* Step 2 — Audience & tone */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Target Audience</label>
            <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="e.g. Entrepreneurs aged 25–40 who want to grow their online presence…" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Brand Tone</label>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button key={t} type="button" onClick={() => setTone(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    tone === t
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Goals & platforms */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Marketing Goals (select all that apply)</label>
            <div className="grid grid-cols-2 gap-1.5">
              {GOAL_OPTIONS.map((g) => (
                <button key={g} type="button" onClick={() => toggleGoal(g)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium text-left transition ${
                    goals.includes(g)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}>
                  {goals.includes(g) ? <CheckSquare size={12} className="text-emerald-500 shrink-0" /> : <Square size={12} className="text-slate-300 shrink-0" />}
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Active Platforms</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_OPTIONS.map((p) => (
                <button key={p} type="button" onClick={() => togglePlatform(p)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    platforms.includes(p)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Additional Notes (optional)</label>
            <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              placeholder="Anything else your AI team should know about your brand…" />
          </div>
        </div>
      )}

      {/* Step 4 — Confirm */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {[
              { label: 'Brand', value: brandName || '—' },
              { label: 'Niche', value: niche || '—' },
              { label: 'Tone', value: tone || '—' },
              { label: 'Audience', value: audience.slice(0, 80) + (audience.length > 80 ? '…' : '') || '—' },
              { label: 'Goals', value: goals.length ? goals.join(', ') : '—' },
              { label: 'Platforms', value: platforms.length ? platforms.join(', ') : '—' },
              { label: 'Website', value: website || '—' },
            ].map((row) => (
              <div key={row.label} className="flex items-start gap-3 px-4 py-2.5">
                <span className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-400">{row.label}</span>
                <span className="text-sm text-slate-700">{row.value}</span>
              </div>
            ))}
          </div>
          {extraNotes && (
            <p className="text-xs text-slate-500 italic px-1">{extraNotes}</p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {/* Footer buttons */}
      <div className="flex items-center justify-between mt-5">
        <button type="button" onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
          disabled={step === 1}
          className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40">
          Back
        </button>
        {step < 4 ? (
          <button type="button" onClick={() => save(false)} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white transition disabled:opacity-50"
            style={{ background: '#10B981' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            Save & Continue <ChevronRight size={13} />
          </button>
        ) : (
          <button type="button" onClick={() => save(true)} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white transition disabled:opacity-50"
            style={{ background: '#10B981' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={13} />}
            Complete Setup
          </button>
        )}
      </div>
    </div>
  );
}

// ── Agent Cards ────────────────────────────────────────────────────────────────

function AgentCard({
  agent, ready, lastRunAt, onRun, running, onChat,
}: {
  agent: typeof AGENT_DEFS[number];
  ready: boolean;
  lastRunAt: string | null;
  onRun: (key: string) => void;
  running: boolean;
  onChat: (key: string) => void;
}) {
  const lastRunLabel = lastRunAt
    ? (() => {
        const diff = Date.now() - new Date(lastRunAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      })()
    : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition flex flex-col">
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl font-black select-none"
            style={{ background: `${agent.color}18`, color: agent.color }}>
            {running ? <Loader2 size={20} className="animate-spin" style={{ color: agent.color }} /> : agent.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-lg tracking-tight" style={{ color: agent.color }}>{agent.name}</span>
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                running ? 'bg-blue-100 text-blue-600' :
                ready   ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
              }`}>
                {running ? 'Running…' : ready ? 'Ready' : 'Setup needed'}
              </span>
            </div>
            <p className="text-xs text-slate-500">{agent.role}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed flex-1">{agent.description}</p>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
          <span className="text-[11px] text-slate-400">
            {lastRunLabel ? `Last run: ${lastRunLabel}` : 'Never run'}
          </span>
          <div className="flex items-center gap-1.5">
            {ready && (
              <button type="button" onClick={() => onChat(agent.key)}
                className="flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition"
                title={`Chat with ${agent.name}`}>
                <MessageCircle size={11} /> Chat
              </button>
            )}
            <button
              type="button"
              disabled={!ready || running}
              onClick={() => onRun(agent.key)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: ready && !running ? agent.color : '#94a3b8' }}
              title={!ready ? 'Complete brand setup to run this agent' : `Begin ${agent.name}`}
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              {running ? 'Running…' : 'Begin'}
            </button>
          </div>
        </div>
        {!ready && (
          <p className="mt-2 text-[11px] text-amber-600 font-medium">
            Complete your brand profile to activate this agent.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Approval Queue ─────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  daky: '#2563EB', nova: '#EC4899', sage: '#10B981', aria: '#F59E0B', flux: '#2563EB',
  trend_research: '#06B6D4', audience_research: '#2563EB', seo_research: '#059669',
  hook_writing: '#D97706', social_caption: '#DB2777', video_script: '#DC2626',
  ad_copy: '#EA580C', thumbnail_design: '#9333EA', meta_ads: '#1877F2',
  campaign_brief: '#0EA5E9',
};
const AGENT_ICONS: Record<string, string> = {
  daky: '✦', nova: '◉', sage: '◈', aria: '⊕', flux: '⟳',
  trend_research: '◎', audience_research: '◑', seo_research: '⊗',
  hook_writing: '⚡', social_caption: '✎', video_script: '▶',
  ad_copy: '◆', thumbnail_design: '▣', meta_ads: '⊛',
  campaign_brief: '◫',
};

const STATUS_STYLES: Record<AgentTask['status'], string> = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  expired:  'bg-slate-100 text-slate-500',
};

function ApprovalQueue({
  tasks,
  onDecide,
  onBatchDecide,
  onEditAndApprove,
}: {
  tasks: AgentTask[];
  onDecide: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
  onBatchDecide?: (decision: 'approved' | 'rejected') => Promise<void>;
  onEditAndApprove?: (id: string, title: string, body: string) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const [batching, setBatching] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setDeciding((d) => ({ ...d, [id]: true }));
    await onDecide(id, decision);
    setDeciding((d) => ({ ...d, [id]: false }));
  };

  const handleStartEdit = (t: AgentTask) => {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditBody(t.body || '');
  };

  const handleSaveAndApprove = async (id: string) => {
    if (!onEditAndApprove) {
      await decide(id, 'approved');
      setEditingId(null);
      return;
    }
    setDeciding((d) => ({ ...d, [id]: true }));
    await onEditAndApprove(id, editTitle, editBody);
    setDeciding((d) => ({ ...d, [id]: false }));
    setEditingId(null);
  };

  const handleBatch = async (decision: 'approved' | 'rejected') => {
    if (!onBatchDecide) return;
    setBatching(decision);
    try {
      await onBatchDecide(decision);
    } finally {
      setBatching(null);
    }
  };

  const pending = tasks.filter((t) => t.status === 'pending');
  const history = tasks.filter((t) => t.status !== 'pending').slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-black text-slate-950 tracking-tight">Approval Queue</h3>
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-500 text-white text-[11px] font-bold px-2.5 py-0.5">
              {pending.length} pending
            </span>
          )}
        </div>
        {pending.length > 1 && onBatchDecide && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={Boolean(batching)}
              onClick={() => handleBatch('rejected')}
              className="flex items-center gap-1 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition disabled:opacity-50"
            >
              {batching === 'rejected' ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
              Reject All ({pending.length})
            </button>
            <button
              type="button"
              disabled={Boolean(batching)}
              onClick={() => handleBatch('approved')}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
              style={{ background: '#10B981' }}
            >
              {batching === 'approved' ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={13} />}
              Approve All ({pending.length})
            </button>
          </div>
        )}
      </div>

      {pending.length === 0 && history.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
          <Bot size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-semibold text-slate-400">No proposals yet</p>
          <p className="text-xs text-slate-400 mt-1">Your agents will surface proposals here once active.</p>
        </div>
      )}

      {pending.map((task) => {
        const color = AGENT_COLORS[task.agent_key] ?? '#2563EB';
        const icon  = AGENT_ICONS[task.agent_key] ?? '◆';
        const expiresIn = Math.max(0, Math.round((new Date(task.expires_at).getTime() - Date.now()) / 3600000));
        const isEditing = editingId === task.id;

        return (
          <div key={task.id} className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-black select-none"
                style={{ background: `${color}18`, color }}>
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
                    {task.agent_key}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                    {task.task_type}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                    <Clock size={10} /> {expiresIn}h left
                  </span>
                </div>

                {isEditing ? (
                  <div className="space-y-2 mt-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-indigo-400 focus:outline-none"
                    />
                    <textarea
                      rows={4}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none resize-none"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-900 mb-1">{task.title}</p>
                    {task.body && (
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{task.body}</p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4 justify-end flex-wrap">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Cancel Edit
                  </button>
                  <button
                    type="button"
                    disabled={deciding[task.id]}
                    onClick={() => handleSaveAndApprove(task.id)}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
                    style={{ background: '#10B981' }}
                  >
                    {deciding[task.id] ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                    Save & Approve
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleStartEdit(task)}
                    className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  <button
                    type="button"
                    disabled={deciding[task.id]}
                    onClick={() => decide(task.id, 'rejected')}
                    className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {deciding[task.id] ? <Loader2 size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={deciding[task.id]}
                    onClick={() => decide(task.id, 'approved')}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
                    style={{ background: '#10B981' }}
                  >
                    {deciding[task.id] ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {history.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Recent Decisions</p>
          <div className="space-y-2">
            {history.map((task) => {
              const color = AGENT_COLORS[task.agent_key] ?? '#2563EB';
              const icon  = AGENT_ICONS[task.agent_key] ?? '◆';
              return (
                <div key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm"
                    style={{ background: `${color}18`, color }}>
                    {icon}
                  </div>
                  <p className="flex-1 text-xs text-slate-700 truncate">{task.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[task.status]}`}>
                    {task.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Brand Profile Summary Card ─────────────────────────────────────────────────

function BrandCard({
  profile,
  onEdit,
  onExtractVoice,
}: {
  profile: BrandProfile;
  onEdit: () => void;
  onExtractVoice: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl text-base"
            style={{ background: '#10B98118', color: '#10B981' }}>◈</div>
          <div>
            <p className="font-black text-slate-950 tracking-tight">{profile.brand_name || 'Your Brand'}</p>
            <p className="text-[11px] text-slate-400">{profile.niche || 'No niche set'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onExtractVoice}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition">
            <Wand2 size={11} /> Extract Voice
          </button>
          <button type="button" onClick={onEdit}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
            <Pencil size={11} /> Edit
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {profile.tone && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <MessageSquare size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium">{profile.tone}</span>
          </div>
        )}
        {profile.audience && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <Users size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium truncate">{profile.audience.slice(0, 35)}</span>
          </div>
        )}
        {profile.website && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <Globe size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium truncate">{profile.website.replace(/^https?:\/\//, '')}</span>
          </div>
        )}
        {profile.platforms.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <BarChart2 size={11} className="text-slate-400" />
            <span className="text-slate-600 font-medium">{profile.platforms.slice(0, 3).join(', ')}{profile.platforms.length > 3 ? '…' : ''}</span>
          </div>
        )}
      </div>
      {profile.goals.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {profile.goals.map((g) => (
            <span key={g} className="rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5">
              {g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agent Chat Modal ──────────────────────────────────────────────────────────

function AgentChatModal({
  agentKey, onClose,
}: { agentKey: string; onClose: () => void }) {
  const agent = AGENT_DEFS.find((a) => a.key === agentKey)!;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(`${BASE()}/api/user/agents/${agentKey}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ messages: next }),
      });
      const d = await res.json();
      if (d.success) {
        setMessages((prev) => [...prev, { role: 'assistant', content: d.reply }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${d.error || 'Agent service unavailable'}` }]);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Connection error: ${err.message || 'Check network connection'}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
      <div className="pointer-events-auto flex flex-col w-full max-w-sm h-[520px] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100" style={{ background: `${agent.color}10` }}>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl text-lg font-black"
            style={{ background: `${agent.color}20`, color: agent.color }}>{agent.icon}</div>
          <div className="flex-1">
            <p className="text-sm font-black text-slate-900">{agent.name}</p>
            <p className="text-[10px] text-slate-500">{agent.role}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <X size={14} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-xs text-slate-400 text-center mt-8">
              Say hello to {agent.name} — ask anything about {agent.role.toLowerCase()}.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                <Loader2 size={14} className="animate-spin text-slate-400" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex items-end gap-2 px-3 py-3 border-t border-slate-100">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={`Ask ${agent.name} anything…`}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none"
            style={{ maxHeight: '80px' }}
          />
          <button type="button" onClick={send} disabled={!input.trim() || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition disabled:opacity-40"
            style={{ background: agent.color }}>
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Content Calendar ──────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function ContentCalendar({ tasks, drafts, onClose }: {
  tasks: AgentTask[];
  drafts: AgentDraft[];
  onClose: () => void;
}) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const prevMonth = () => { if (month === 0) { setYear(y => y-1); setMonth(11); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y+1); setMonth(0); } else setMonth(m => m+1); };

  // Build a map of day-of-month → items
  const itemsByDay: Record<number, { label: string; color: string }[]> = {};
  const addItem = (dateStr: string | null | undefined, label: string, color: string) => {
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!itemsByDay[day]) itemsByDay[day] = [];
      itemsByDay[day].push({ label, color });
    }
  };
  tasks.filter(t => t.status === 'approved').forEach(t =>
    addItem(t.decided_at, t.title, AGENT_COLORS[t.agent_key] ?? '#2563EB')
  );
  drafts.forEach(d =>
    addItem(d.created_at, d.title, AGENT_COLORS[d.agent_key] ?? '#2563EB')
  );

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1
  );
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <CalendarDays size={16} className="text-indigo-500" />
          <h3 className="font-black text-slate-950 tracking-tight">Content Calendar</h3>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={prevMonth}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition">
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-bold text-slate-700 w-24 text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button type="button" onClick={nextMonth}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition">
            <ChevronRight size={14} />
          </button>
          <button type="button" onClick={onClose}
            className="ml-2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="p-4">
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-slate-400 py-1">{d}</div>
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, i) => {
            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const items   = day ? (itemsByDay[day] ?? []) : [];
            return (
              <div key={i} className={`min-h-[64px] rounded-xl p-1.5 ${day ? 'bg-slate-50 hover:bg-slate-100 transition' : ''} ${isToday ? 'ring-2 ring-indigo-400 bg-indigo-50' : ''}`}>
                {day && (
                  <>
                    <p className={`text-[11px] font-bold mb-1 ${isToday ? 'text-indigo-600' : 'text-slate-500'}`}>{day}</p>
                    <div className="space-y-0.5">
                      {items.slice(0, 3).map((item, j) => (
                        <div key={j} className="rounded px-1 py-0.5 text-[9px] font-semibold truncate text-white"
                          style={{ background: item.color }}
                          title={item.label}>
                          {item.label.slice(0, 16)}
                        </div>
                      ))}
                      {items.length > 3 && (
                        <p className="text-[9px] text-slate-400 font-semibold">+{items.length - 3} more</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {Object.keys(itemsByDay).length === 0 && (
        <p className="text-xs text-slate-400 text-center pb-4">
          No approved content this month. Approve some proposals to populate the calendar.
        </p>
      )}
    </div>
  );
}

// ── Brand Voice Modal ─────────────────────────────────────────────────────────

function BrandVoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [samples, setSamples]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<VoiceResult | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const extract = async () => {
    if (samples.trim().length < 20) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${BASE()}/api/user/brand-voice-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ samples }),
      });
      const d = await res.json();
      if (d.success) { setResult(d.voice); onSaved(); }
      else setError(d.error ?? 'Extraction failed');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-indigo-500" />
            <h3 className="font-black text-slate-950 tracking-tight">Extract Brand Voice</h3>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!result ? (
            <>
              <p className="text-sm text-slate-500">
                Paste 3–5 examples of your existing posts, captions, or copy. Sage will analyse them and extract your brand voice automatically.
              </p>
              <textarea
                rows={8}
                value={samples}
                onChange={(e) => setSamples(e.target.value)}
                placeholder={"Paste your content samples here…\n\nExample:\n- Your best Instagram caption\n- A tagline you love\n- A blog intro paragraph"}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-400 focus:outline-none resize-none"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button type="button" onClick={extract} disabled={loading || samples.trim().length < 20}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
                style={{ background: '#2563EB' }}>
                {loading ? <><Loader2 size={14} className="animate-spin" /> Analysing…</> : <><Wand2 size={14} /> Extract Brand Voice</>}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-bold text-emerald-800 mb-1">Brand Voice Extracted</p>
                {result.one_liner && <p className="text-sm text-emerald-700 italic">"{result.one_liner}"</p>}
              </div>
              {result.tone && <div><p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Tone</p><p className="text-sm text-slate-700">{result.tone}</p></div>}
              {result.personality && result.personality.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Personality</p>
                  <div className="flex flex-wrap gap-1">
                    {result.personality.map((t) => <span key={t} className="rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold px-2 py-0.5">{t}</span>)}
                  </div>
                </div>
              )}
              {result.do_list && result.do_list.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-1">Do</p>
                  <ul className="space-y-0.5">{result.do_list.map((d) => <li key={d} className="text-sm text-slate-700 flex gap-1.5"><CheckCircle size={12} className="shrink-0 text-emerald-500 mt-0.5" />{d}</li>)}</ul>
                </div>
              )}
              {result.dont_list && result.dont_list.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-red-500 uppercase tracking-wide mb-1">Don't</p>
                  <ul className="space-y-0.5">{result.dont_list.map((d) => <li key={d} className="text-sm text-slate-700 flex gap-1.5"><X size={12} className="shrink-0 text-red-400 mt-0.5" />{d}</li>)}</ul>
                </div>
              )}
              <p className="text-xs text-slate-400">Saved to your brand memory — all agents will use this going forward.</p>
              <button type="button" onClick={onClose}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white"
                style={{ background: '#10B981' }}>
                <CheckCircle size={14} /> Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function navigateToPosts() {
  window.history.pushState({}, '', '/posts');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const DRAFT_TYPE_LABELS: Record<string, string> = {
  content_post:       'Blog Draft',
  strategy_proposal:  'Strategy',
  analysis_report:    'Analysis',
  visual_concept:     'Visual Brief',
  workflow_setup:     'Workflow',
};

const DRAFT_TYPE_ICONS: Record<string, LucideIcon> = {
  content_post:      FileText,
  strategy_proposal: Lightbulb,
  analysis_report:   BarChart2,
  visual_concept:    Sparkles,
  workflow_setup:    LayoutList,
};

function navigateToCards() {
  window.history.pushState({}, '', '/cards');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function AgentDraftsPanel({
  drafts,
  onDelete,
}: {
  drafts: AgentDraft[];
  onDelete?: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (drafts.length === 0) return null;

  const handleCopy = async (draft: AgentDraft, e: React.MouseEvent) => {
    e.stopPropagation();
    const text = draft.content || draft.title;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(draft.id);
      setTimeout(() => setCopiedId((id) => (id === draft.id ? null : id)), 2500);
    } catch { /* fallback */ }
  };

  const handleCreatePost = (draft: AgentDraft, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      localStorage.setItem('contentflow_prefill_post', JSON.stringify({
        title: draft.title,
        content: draft.content,
        agent_key: draft.agent_key,
      }));
    } catch { /* ignore */ }
    navigateToPosts();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-black text-slate-950 tracking-tight">Executed Drafts</h3>
          <span className="rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold px-2 py-0.5">
            {drafts.length}
          </span>
        </div>
        <p className="text-xs text-slate-400">Approved deliverables ready for publishing or visual design</p>
      </div>
      <div className="space-y-2">
        {drafts.map((draft) => {
          const color   = AGENT_COLORS[draft.agent_key] ?? '#2563EB';
          const icon    = AGENT_ICONS[draft.agent_key]  ?? '◆';
          const DraftIcon = DRAFT_TYPE_ICONS[draft.task_type] ?? FileText;
          const isOpen  = expanded === draft.id;
          const isCopied = copiedId === draft.id;

          return (
            <div key={draft.id}
              className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:border-slate-300 transition">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : draft.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base"
                  style={{ background: `${color}18`, color }}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold" style={{ color }}>
                      {AGENT_NAMES[draft.agent_key] ?? draft.agent_key}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                      <DraftIcon size={9} />
                      {DRAFT_TYPE_LABELS[draft.task_type] ?? draft.task_type}
                    </span>
                    {draft.blog_post_id && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                        blog post linked
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 truncate mt-0.5">{draft.title}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    title="Copy content"
                    onClick={(e) => handleCopy(draft, e)}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                  >
                    {isCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      title="Delete draft"
                      disabled={deletingId === draft.id}
                      onClick={(e) => handleDelete(draft.id, e)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                    >
                      {deletingId === draft.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  )}
                  <ChevronRight size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                  {draft.content ? (
                    <div className="rounded-xl bg-slate-50 p-3.5 mb-3 border border-slate-100">
                      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-sans">
                        {draft.content}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => handleCopy(draft, e)}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      {isCopied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                      {isCopied ? 'Copied to Clipboard' : 'Copy Content'}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleCreatePost(draft, e)}
                      className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
                    >
                      <ExternalLink size={11} /> {draft.blog_post_id ? 'Open in Posts' : 'Send to Posts'}
                    </button>

                    <button
                      type="button"
                      onClick={navigateToCards}
                      className="flex items-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50 px-3 py-1.5 text-xs font-bold text-pink-700 hover:bg-pink-100 transition"
                    >
                      <Layers size={11} /> Open in Cards
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type RunResult = { agent_key: string; proposals_created: number; error?: string };

// ── Orchestration pipeline step ───────────────────────────────────────────────

type OrchStep = {
  key: string;
  name: string;
  role: string;
  color: string;
  icon: string;
  status: 'idle' | 'running' | 'done' | 'error';
  count?: number;
};

const ORCH_PIPELINE: Omit<OrchStep, 'status'>[] = [
  { key: 'sage', name: 'Sage', role: 'Strategy', color: '#10B981', icon: '◈' },
  { key: 'daky', name: 'Daky', role: 'Content', color: '#2563EB', icon: '✦' },
  { key: 'nova', name: 'Nova', role: 'Visuals', color: '#EC4899', icon: '◉' },
  { key: 'aria', name: 'Aria', role: 'Analytics', color: '#F59E0B', icon: '⊕' },
  { key: 'flux', name: 'Flux', role: 'Automation', color: '#2563EB', icon: '⟳' },
];

function OrchestrationPanel({
  steps,
  running,
  result,
  onRun,
  onDismiss,
}: {
  steps: OrchStep[];
  running: boolean;
  result: { proposals_by_agent: Record<string, number>; total: number } | null;
  onRun: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
            <Network size={18} />
          </div>
          <div>
            <p className="font-black text-slate-950 tracking-tight">Orchestrate Full Campaign</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Sage sets strategy → Daky writes content → Nova designs visuals → Aria tracks → Flux automates
            </p>
          </div>
        </div>
        <button type="button" onClick={onDismiss}
          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
          <X size={14} />
        </button>
      </div>

      {/* Pipeline steps */}
      <div className="flex items-center gap-1 flex-wrap mb-5">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 rounded-xl px-3 py-2 transition ${
              step.status === 'done'    ? 'bg-white border border-emerald-200' :
              step.status === 'running' ? 'bg-white border-2 shadow-sm' :
              step.status === 'error'   ? 'bg-red-50 border border-red-200' :
              'bg-slate-50 border border-slate-200'
            }`}
              style={step.status === 'running' ? { borderColor: step.color } : {}}>
              <span className="text-sm" style={{ color: step.color }}>{step.icon}</span>
              <span className="text-xs font-bold text-slate-700">{step.name}</span>
              {step.status === 'running' && <Loader2 size={11} className="animate-spin" style={{ color: step.color }} />}
              {step.status === 'done'    && <CheckCircle size={11} className="text-emerald-500" />}
              {step.status === 'done' && step.count != null && (
                <span className="text-[10px] font-bold" style={{ color: step.color }}>{step.count}</span>
              )}
            </div>
            {i < steps.length - 1 && (
              <ArrowRight size={12} className={`shrink-0 ${
                step.status === 'done' && (steps[i+1].status === 'running' || steps[i+1].status === 'done')
                  ? 'text-emerald-400' : 'text-slate-300'
              }`} />
            )}
          </div>
        ))}
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={14} className="text-emerald-600" />
            <span className="text-sm font-bold text-emerald-800">Orchestration complete — {result.total} proposals created</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(result.proposals_by_agent).map(([k, n]) => (
              <span key={k} className="text-[11px] font-semibold text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">
                {AGENT_NAMES[k] ?? k}: {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={running}
        onClick={onRun}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition disabled:opacity-50"
        style={{ background: '#2563EB' }}
      >
        {running
          ? <><Loader2 size={14} className="animate-spin" /> Orchestrating…</>
          : result
          ? <><Network size={14} /> Run Again</>
          : <><Network size={14} /> Launch Full Orchestration</>
        }
      </button>
    </div>
  );
}

const AGENT_NAMES: Record<string, string> = {
  daky: 'Daky', nova: 'Nova', sage: 'Sage', aria: 'Aria', flux: 'Flux',
  trend_research: 'Trend', audience_research: 'Persona', seo_research: 'SEO',
  hook_writing: 'Hook', social_caption: 'Caption', video_script: 'Script',
  ad_copy: 'Ads', thumbnail_design: 'Thumb', meta_ads: 'Meta',
  campaign_brief: 'Brief',
};

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AITeam() {
  const [profile, setProfile]   = useState<BrandProfile | null>(null);
  const [tasks, setTasks]       = useState<AgentTask[]>([]);
  const [drafts, setDrafts]     = useState<AgentDraft[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [runningAgents, setRunningAgents]   = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll]         = useState(false);
  const [runAllStatus, setRunAllStatus]     = useState('');
  const [lastRunAt, setLastRunAt]           = useState<Record<string, string>>({});
  const [runToasts, setRunToasts]           = useState<RunResult[]>([]);
  const [execToasts, setExecToasts]         = useState<ExecToast[]>([]);
  // brand voice modal
  const [showVoice, setShowVoice]           = useState(false);
  // agent chat
  const [chatKey, setChatKey]               = useState<string | null>(null);
  // campaign launch modal
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaignBrief, setCampaignBrief]   = useState('');
  // Plan 12: content calendar
  const [showCalendar, setShowCalendar]     = useState(false);

  // Phase 8 — orchestration state
  const [showOrch, setShowOrch]             = useState(false);
  const [orchRunning, setOrchRunning]       = useState(false);
  const [orchSteps, setOrchSteps]           = useState<OrchStep[]>(
    ORCH_PIPELINE.map((s) => ({ ...s, status: 'idle' as const }))
  );
  const [orchResult, setOrchResult]         = useState<{ proposals_by_agent: Record<string, number>; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const h = { Authorization: `Bearer ${tok()}` };
      const [pr, tr, sr, dr] = await Promise.all([
        fetch(`${BASE()}/api/user/brand-profile`,    { headers: h }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agent-tasks`,      { headers: h }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agents/status`,    { headers: h }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agent-drafts`,     { headers: h }).then((r) => r.json()),
      ]);
      setProfile(pr.success ? pr.profile : null);
      setTasks(tr.success ? tr.tasks : []);
      if (sr.success) setLastRunAt(sr.status ?? {});
      if (dr.success) setDrafts(dr.drafts ?? []);
      if (!pr.profile?.setup_done) setShowWizard(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDecide = async (id: string, decision: 'approved' | 'rejected') => {
    const res = await fetch(`${BASE()}/api/user/agent-tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      body: JSON.stringify({ decision }),
    });
    const d = await res.json();
    if (d.success) {
      setTasks((prev) => prev.map((t) => t.id === id ? d.task : t));
      if (decision === 'approved' && d.execution) {
        const exec = d.execution as { type: string; blog_post_id?: string; draft_id?: string };
        const toast: ExecToast = exec.type === 'blog_draft'
          ? { message: 'Blog draft created!', blog_post_id: exec.blog_post_id }
          : { message: 'Draft saved to your team!' };
        setExecToasts((prev) => [...prev, toast]);
        setTimeout(() => setExecToasts((prev) => prev.filter((t) => t !== toast)), 7000);
        // Reload drafts list
        fetch(`${BASE()}/api/user/agent-drafts`, { headers: { Authorization: `Bearer ${tok()}` } })
          .then((r) => r.json())
          .then((dr) => { if (dr.success) setDrafts(dr.drafts ?? []); })
          .catch(() => {});
      }
    }
  };

  const handleEditAndApprove = async (id: string, title: string, body: string) => {
    const res = await fetch(`${BASE()}/api/user/agent-tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      body: JSON.stringify({ decision: 'approved', title, body }),
    });
    const d = await res.json();
    if (d.success) {
      setTasks((prev) => prev.map((t) => t.id === id ? d.task : t));
      if (d.execution) {
        const exec = d.execution as { type: string; blog_post_id?: string; draft_id?: string };
        const toast: ExecToast = exec.type === 'blog_draft'
          ? { message: 'Edited blog draft created!', blog_post_id: exec.blog_post_id }
          : { message: 'Edited proposal draft saved to your team!' };
        setExecToasts((prev) => [...prev, toast]);
        setTimeout(() => setExecToasts((prev) => prev.filter((t) => t !== toast)), 7000);
        fetch(`${BASE()}/api/user/agent-drafts`, { headers: { Authorization: `Bearer ${tok()}` } })
          .then((r) => r.json())
          .then((dr) => { if (dr.success) setDrafts(dr.drafts ?? []); })
          .catch(() => {});
      }
    }
  };

  const handleBatchDecide = async (decision: 'approved' | 'rejected') => {
    const pendingIds = tasks.filter((t) => t.status === 'pending').map((t) => t.id);
    if (pendingIds.length === 0) return;
    const res = await fetch(`${BASE()}/api/user/agent-tasks/batch-decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
      body: JSON.stringify({ task_ids: pendingIds, decision }),
    });
    const d = await res.json();
    if (d.success) {
      const [tr, dr] = await Promise.all([
        fetch(`${BASE()}/api/user/agent-tasks`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
        fetch(`${BASE()}/api/user/agent-drafts`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
      ]);
      if (tr.success) setTasks(tr.tasks);
      if (dr.success) setDrafts(dr.drafts ?? []);
      const count = d.count ?? pendingIds.length;
      const toast: ExecToast = { message: `${count} proposal${count !== 1 ? 's' : ''} ${decision}!` };
      setExecToasts((prev) => [...prev, toast]);
      setTimeout(() => setExecToasts((prev) => prev.filter((t) => t !== toast)), 5000);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    const res = await fetch(`${BASE()}/api/user/agent-drafts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    });
    const d = await res.json();
    if (d.success) {
      setDrafts((prev) => prev.filter((dr) => dr.id !== id));
    }
  };

  const runAgent = async (key: string, brief?: string) => {
    setRunningAgents((s) => new Set(s).add(key));
    try {
      const res = await fetch(`${BASE()}/api/user/agents/${key}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ brief, force: true }),
      });
      const d = await res.json();
      const result: RunResult = d.success
        ? { agent_key: key, proposals_created: d.proposals_created }
        : { agent_key: key, proposals_created: 0, error: d.error };
      setRunToasts((prev) => [...prev, result]);
      setTimeout(() => setRunToasts((prev) => prev.filter((r) => r !== result)), 5000);
      if (d.success) {
        setLastRunAt((prev) => ({ ...prev, [key]: new Date().toISOString() }));
        // Reload tasks to show new proposals
        const tr = await fetch(`${BASE()}/api/user/agent-tasks`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json());
        if (tr.success) setTasks(tr.tasks);
      }
    } catch (e: any) {
      const result: RunResult = { agent_key: key, proposals_created: 0, error: e.message };
      setRunToasts((prev) => [...prev, result]);
      setTimeout(() => setRunToasts((prev) => prev.filter((r) => r !== result)), 5000);
    } finally {
      setRunningAgents((s) => { const ns = new Set(s); ns.delete(key); return ns; });
    }
  };

  const runAll = async () => {
    if (runningAll) return;
    setRunningAll(true);
    const agents = AGENT_DEFS;
    for (let i = 0; i < agents.length; i++) {
      setRunAllStatus(`Running ${agents[i].name} (${i + 1}/${agents.length})…`);
      await runAgent(agents[i].key, campaignBrief || undefined);
    }
    setRunningAll(false);
    setRunAllStatus('');
  };

  // Phase 8 — orchestration: streams step-by-step UI updates then calls backend
  const runOrchestrate = async (overrideBrief?: string) => {
    if (orchRunning) return;
    setOrchRunning(true);
    setOrchResult(null);
    setOrchSteps(ORCH_PIPELINE.map((s) => ({ ...s, status: 'idle' as const })));

    const DELAYS = [0, 2500, 5000, 7500, 7500];
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    ORCH_PIPELINE.forEach((_step, i) => {
      timeouts.push(setTimeout(() => {
        setOrchSteps((prev) =>
          prev.map((s, j) =>
            j === i ? { ...s, status: 'running' }
            : j < i  ? { ...s, status: 'done' }
            : s
          )
        );
      }, DELAYS[i]));
    });

    try {
      const effectiveBrief = overrideBrief ?? campaignBrief;
      const res = await fetch(`${BASE()}/api/user/agents/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ brief: effectiveBrief || undefined }),
      });
      const d = await res.json();
      timeouts.forEach(clearTimeout);

      if (d.success) {
        setOrchSteps(ORCH_PIPELINE.map((s) => ({
          ...s,
          status: 'done' as const,
          count: d.proposals_by_agent?.[s.key] ?? 0,
        })));
        setOrchResult({ proposals_by_agent: d.proposals_by_agent, total: d.total });
        setLastRunAt((prev) => {
          const now = new Date().toISOString();
          const next = { ...prev };
          for (const k of ['sage','daky','nova','aria','flux','campaign_brief']) next[k] = now;
          return next;
        });
        // Reload tasks
        const tr = await fetch(`${BASE()}/api/user/agent-tasks`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json());
        if (tr.success) setTasks(tr.tasks);
      } else {
        setOrchSteps((prev) => prev.map((s) => s.status === 'running' ? { ...s, status: 'error' as const } : s));
        const toast: RunResult = { agent_key: 'orchestration', proposals_created: 0, error: d.error };
        setRunToasts((prev) => [...prev, toast]);
        setTimeout(() => setRunToasts((prev) => prev.filter((r) => r !== toast)), 5000);
      }
    } catch (e: any) {
      timeouts.forEach(clearTimeout);
      setOrchSteps((prev) => prev.map((s) => s.status === 'running' ? { ...s, status: 'error' as const } : s));
    } finally {
      setOrchRunning(false);
    }
  };

  const launchCampaign = async () => {
    setShowCampaignModal(false);
    const brief = campaignBrief.trim();
    if (brief) {
      setShowOrch(true);
      await runOrchestrate(brief);
    } else {
      await runAll();
    }
    setCampaignBrief('');
  };

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const profileReady = Boolean(profile?.setup_done);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Loading AI Team…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex items-center gap-3">
        <X size={16} className="shrink-0" /> {error}
        <button type="button" onClick={load} className="ml-auto text-xs font-semibold hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Run toasts */}
      {(runToasts.length > 0 || execToasts.length > 0) && (
        <div className="fixed top-5 right-5 z-50 space-y-2">
          {runToasts.map((r, i) => (
            <div key={i} className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 shadow-lg text-sm font-semibold ${
              r.error ? 'border-red-200 bg-white text-red-600' : 'border-emerald-200 bg-white text-emerald-700'
            }`}>
              {r.error
                ? <><X size={14} className="shrink-0" /> {r.agent_key}: {r.error}</>
                : <><CheckCircle size={14} className="shrink-0" /> {r.agent_key} created {r.proposals_created} proposal{r.proposals_created !== 1 ? 's' : ''}</>
              }
            </div>
          ))}
          {execToasts.map((t, i) => (
            <div key={`exec-${i}`}
              className="flex items-center gap-2.5 rounded-2xl border border-indigo-200 bg-white px-4 py-3 shadow-lg text-sm font-semibold text-indigo-700">
              <CheckCircle size={14} className="shrink-0 text-indigo-500" />
              <span>{t.message}</span>
              {t.blog_post_id && (
                <button
                  type="button"
                  onClick={navigateToPosts}
                  className="ml-2 flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline">
                  Open in Posts <ExternalLink size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Agent chat modal */}
      {chatKey && <AgentChatModal agentKey={chatKey} onClose={() => setChatKey(null)} />}

      {/* Brand voice modal */}
      {showVoice && <BrandVoiceModal onClose={() => setShowVoice(false)} onSaved={() => {}} />}

      {/* Launch Campaign modal */}
      {showCampaignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <Rocket size={16} />
                </div>
                <h3 className="font-black text-slate-950 tracking-tight">Launch Campaign</h3>
              </div>
              <button type="button" onClick={() => setShowCampaignModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Give your AI team a campaign brief. All {AGENT_DEFS.length} agents will run in sequence and generate proposals based on your brand profile and this brief.
            </p>
            <textarea
              rows={4}
              value={campaignBrief}
              onChange={(e) => setCampaignBrief(e.target.value)}
              placeholder="e.g. Launch our new product to early adopters on LinkedIn and Instagram — focus on pain points around manual workflows and show how we automate the repetitive stuff…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-300 focus:bg-white focus:outline-none resize-none mb-4"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCampaignModal(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
                Cancel
              </button>
              <button
                type="button"
                disabled={runningAll || runningAgents.size > 0}
                onClick={launchCampaign}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
                style={{ background: '#2563EB' }}
              >
                <Rocket size={14} /> Begin All Agents
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">AI Team</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your full AI marketing team — {AGENT_DEFS.length} specialized agents powered by your brand profile.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500 text-white text-xs font-bold px-2.5 py-1">
              {pendingCount} pending
            </span>
          )}
          {runningAll && (
            <span className="text-xs font-semibold text-slate-500">
              <Loader2 size={12} className="inline animate-spin mr-1" />{runAllStatus}
            </span>
          )}
          {profileReady && (
            <>
              <button type="button" onClick={() => setShowCalendar((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition">
                <Calendar size={13} /> Calendar
              </button>
              <button
                type="button"
                disabled={orchRunning || runningAll || runningAgents.size > 0}
                onClick={() => setShowOrch((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50"
              >
                <Network size={13} /> Orchestrate
              </button>
              <button
                type="button"
                disabled={runningAll || runningAgents.size > 0 || orchRunning}
                onClick={() => setShowCampaignModal(true)}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
                style={{ background: '#2563EB' }}
              >
                <Rocket size={13} /> Launch Campaign
              </button>
            </>
          )}
          <button type="button" onClick={load}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 transition">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Content calendar */}
      {showCalendar && profileReady && (
        <ContentCalendar tasks={tasks} drafts={drafts} onClose={() => setShowCalendar(false)} />
      )}

      {/* Phase 8 — Orchestration panel */}
      {showOrch && profileReady && (
        <OrchestrationPanel
          steps={orchSteps}
          running={orchRunning}
          result={orchResult}
          onRun={runOrchestrate}
          onDismiss={() => setShowOrch(false)}
        />
      )}

      {/* Brand Wizard / Profile */}
      {showWizard ? (
        <BrandWizard
          initial={profile}
          onSaved={(p) => {
            setProfile(p);
            if (p.setup_done) setShowWizard(false);
          }}
        />
      ) : (
        profile && (
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <BrandCard profile={profile} onEdit={() => setShowWizard(true)} onExtractVoice={() => setShowVoice(true)} />
            </div>
            {!profileReady && (
              <button type="button" onClick={() => setShowWizard(true)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition shrink-0">
                <Sparkles size={12} /> Complete Setup
              </button>
            )}
          </div>
        )
      )}

      {/* Setup prompt if no profile yet */}
      {!showWizard && !profile && (
        <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl mx-auto mb-3 text-2xl"
            style={{ background: '#10B98118', color: '#10B981' }}>◈</div>
          <p className="font-black text-slate-950 mb-1">Start with Sage</p>
          <p className="text-sm text-slate-500 mb-4">Tell your AI team about your brand so they can create content that actually fits.</p>
          <button type="button" onClick={() => setShowWizard(true)}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: '#10B981' }}>
            <Sparkles size={14} /> Set Up Brand Profile
          </button>
        </div>
      )}

      {/* Performance director: strategy, research and the team channel */}
      {profileReady && <TeamDirectorPanel agents={AGENT_DEFS.map((a) => ({ key: a.key, name: a.name }))} />}

      {/* Agent grid — grouped by category */}
      <div className="space-y-8">
        {AGENT_GROUPS.map((group) => {
          const agents = group.keys
            .map((k) => AGENT_DEFS.find((a) => a.key === k))
            .filter((a): a is typeof AGENT_DEFS[number] => Boolean(a));
          return (
            <div key={group.label}>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-sm font-black text-slate-700 tracking-tight whitespace-nowrap">{group.label}</h3>
                <div className="flex-1 h-px bg-slate-100" />
                {profileReady && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 whitespace-nowrap">
                    <Zap size={10} /> {agents.length} ready
                  </span>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.key}
                    agent={agent}
                    ready={profileReady}
                    lastRunAt={lastRunAt[agent.key] ?? null}
                    running={runningAgents.has(agent.key)}
                    onRun={runAgent}
                    onChat={setChatKey}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Approval queue */}
      <ApprovalQueue
        tasks={tasks}
        onDecide={handleDecide}
        onBatchDecide={handleBatchDecide}
        onEditAndApprove={handleEditAndApprove}
      />

      {/* Executed Drafts */}
      <AgentDraftsPanel drafts={drafts} onDelete={handleDeleteDraft} />

      {/* Autonomous Schedules & Multi-Agent Handoffs */}
      <AgentSchedulesPanel />

      {/* Info panel */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-bold text-slate-600 mb-2">How your AI team works</p>
        <ul className="space-y-1.5 text-xs text-slate-500">
          <li>• <strong>Brand Profile</strong> — Complete setup so all 15 agents know your niche, tone, goals, and audience.</li>
          <li>• <strong>Begin individual agents</strong> — Each generates 2-3 proposals tailored to your brand in seconds.</li>
          <li>• <strong>Launch Campaign</strong> — Runs your team with your custom campaign brief to produce coordinated deliverables across channels.</li>
          <li>• <strong>Orchestrate</strong> — Structured pipeline: Sage sets strategy → Daky writes content → Nova designs visuals → Aria tracks performance → Flux automates distribution.</li>
          <li>• <strong>Approve or reject</strong> — Your decisions are remembered. Agents adapt their future proposals based on your feedback, and approved work is handed to the teammates who build on it.</li>
          <li>• <strong>Team strategy</strong> — Helm, the performance director, keeps everyone on one strategy, explains why it was chosen, measures it, and replaces it when it keeps missing its target.</li>
          <li>• <strong>Niche research</strong> — The team researches your niche on the web weekly; each agent works from the findings that matter to its role.</li>
          <li>• <strong>Executed Drafts</strong> — Approving a <em>content post</em> auto-creates a blog draft you can edit and publish.</li>
          <li>• <strong>Chat</strong> — Click Chat on any agent card to have a direct conversation about strategy, content, or ideas.</li>
          <li>• <strong>Brand Voice</strong> — Click "Extract Voice" on your brand card to paste sample content and have Sage identify your voice automatically.</li>
          <li>• <strong>Calendar</strong> — Shows all approved content and drafts plotted on a monthly grid.</li>
          <li>• Proposals expire after 48 hours if not actioned.</li>
        </ul>
      </div>

      {/* Target & Goals summary */}
      {profileReady && profile && profile.goals.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className="text-indigo-500" />
            <p className="text-xs font-bold text-indigo-700">Active Goals</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.goals.map((g) => (
              <span key={g} className="rounded-full bg-white border border-indigo-200 text-indigo-700 text-[11px] font-semibold px-3 py-1">
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
