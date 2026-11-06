import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Compass,
  Globe,
  Loader2,
  Megaphone,
  Plug,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import { onboardingService, type OnboardingAnswers } from '../services/onboardingService';
import { integrationService } from '../services/integrationService';
import { PlatformLogo } from './PlatformLogo';

const STORAGE_KEY = 'dw_onboarded';

const INDUSTRIES = [
  'E-commerce', 'SaaS & Tech', 'Agency & Services', 'Creator & Media',
  'Local business', 'Education', 'Health & Wellness', 'Nonprofit', 'Other',
];

const TONES = [
  'Professional', 'Friendly', 'Bold', 'Playful', 'Luxury', 'Technical', 'Inspirational', 'Witty',
];

const GOALS = [
  'Grow my audience', 'Create content faster', 'Email marketing',
  'Automate posting', 'Manage leads & CRM', 'Understand analytics',
];

const PLATFORMS = [
  'Instagram', 'Facebook', 'X (Twitter)', 'LinkedIn', 'TikTok', 'YouTube', 'Pinterest', 'WordPress',
];

// Platforms the app can actually OAuth-connect (mirrors OAuthCallback.tsx's
// SUPPORTED_PLATFORMS, minus non-social integrations like Gmail/Slack/Zoom).
// slug is what the OAuth + PlatformLogo + analyze-account APIs expect.
const CONNECTABLE_PLATFORMS: { label: string; slug: string }[] = [
  { label: 'Instagram', slug: 'instagram' },
  { label: 'Facebook', slug: 'facebook' },
  { label: 'X (Twitter)', slug: 'twitter' },
  { label: 'LinkedIn', slug: 'linkedin' },
  { label: 'TikTok', slug: 'tiktok' },
  { label: 'Pinterest', slug: 'pinterest' },
  { label: 'Threads', slug: 'threads' },
];

type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'error';

const STEP_META = [
  { icon: Building2, title: 'Your brand' },
  { icon: Sparkles, title: 'What you do' },
  { icon: Users, title: 'Audience & voice' },
  { icon: Target, title: 'Goals & platforms' },
];

type Phase = 'form' | 'saving' | 'done' | 'error';

type Props = {
  user?: { name: string | null } | null;
  onNavigate: (page: string) => void;
  onComplete?: () => void;
  onDismiss?: () => void;
};

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition-all ${
        active
          ? 'border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-200'
          : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
      }`}
    >
      {label}
    </button>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v.slice(0, 60)]);
    setDraft('');
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((item) => (
            <span key={item} className="flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[13px] font-semibold text-indigo-700">
              {item}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== item))} className="text-indigo-400 hover:text-indigo-700">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] text-gray-900 placeholder:text-gray-300 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-50 transition-all"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="mb-1.5 flex items-baseline gap-2 text-[13px] font-bold text-gray-700">
      {children}
      {optional && <span className="text-[11px] font-medium text-gray-400">optional</span>}
    </label>
  );
}

function BriefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">{label}</p>
      <div className="mt-0.5 text-[13px] font-semibold text-white leading-snug">{value}</div>
    </div>
  );
}

export default function OnboardingWizard({ user, onNavigate, onComplete, onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>('form');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [memoriesCreated, setMemoriesCreated] = useState(0);
  const brandInputRef = useRef<HTMLInputElement>(null);

  const [brandName, setBrandName] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [offering, setOffering] = useState('');
  const [offerings, setOfferings] = useState<string[]>([]);
  const [audience, setAudience] = useState('');
  const [tones, setTones] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);

  // Website analysis: pre-fills later steps, but never a field the user touched.
  const [analysis, setAnalysis] = useState<{ state: 'idle' | 'loading' | 'done' | 'failed'; host: string }>({ state: 'idle', host: '' });
  const [foundSocialLinks, setFoundSocialLinks] = useState<Record<string, string>>({});
  const touchedRef = useRef<Set<string>>(new Set());
  const analyzedUrlRef = useRef('');
  const touch = (field: string) => touchedRef.current.add(field);

  // Connected-account state: one entry per CONNECTABLE_PLATFORMS slug.
  const [connectStatus, setConnectStatus] = useState<Record<string, ConnectStatus>>({});
  const [accountInsights, setAccountInsights] = useState<Record<string, { handle: string; followers: number }>>({});
  const oauthCleanupRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => () => { oauthCleanupRef.current.forEach((cleanup) => cleanup()); }, []);

  const maybeAnalyzeWebsite = () => {
    const url = website.trim();
    if (!url || url === analyzedUrlRef.current) return;
    analyzedUrlRef.current = url;
    let host = url;
    try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname; } catch { /* keep raw */ }
    setAnalysis({ state: 'loading', host });
    onboardingService.analyzeWebsite(url)
      .then(({ suggestions: s, socialLinks }) => {
        const untouched = (f: string) => !touchedRef.current.has(f);
        if (s.industry && INDUSTRIES.includes(s.industry) && untouched('industry')) setIndustry(s.industry);
        if (s.offering && untouched('offering')) setOffering(s.offering);
        if (s.offerings?.length && untouched('offerings')) setOfferings(s.offerings.slice(0, 8));
        if (s.audience && untouched('audience')) setAudience(s.audience);
        if (s.tones?.length && untouched('tones')) setTones(s.tones.filter((t) => TONES.includes(t)).slice(0, 3));
        if (s.platforms?.length && untouched('platforms')) setPlatforms(s.platforms.filter((p) => PLATFORMS.includes(p)));
        if (socialLinks) setFoundSocialLinks(socialLinks);
        setAnalysis({ state: 'done', host });
      })
      .catch(() => setAnalysis({ state: 'failed', host }));
  };

  // Opens the platform's OAuth flow in a popup so the wizard never unmounts, then
  // asks the AI to read the freshly-connected profile (bio/followers) and merges
  // whatever it can infer into the still-open form — respecting touched fields.
  const connectPlatform = (label: string, slug: string) => {
    touch('platforms');
    setConnectStatus((p) => ({ ...p, [slug]: 'connecting' }));

    // Open synchronously (before any await) so browsers don't treat it as a
    // blocked auto-popup; redirect it to the real URL once we have it.
    // Unique window name per platform — a shared name would let a second
    // Connect click (e.g. Facebook while Instagram is still mid-flow) hijack
    // the first popup instead of opening its own.
    const popup = window.open('about:blank', `dw_oauth_${slug}`, 'width=560,height=700,left=200,top=100');
    if (!popup) {
      setConnectStatus((p) => ({ ...p, [slug]: 'error' }));
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closeTimer);
      oauthCleanupRef.current.delete(slug);
    };
    const onMessage = (evt: MessageEvent) => {
      if (evt.origin !== window.location.origin) return;
      if (evt.data?.type !== 'oauth_connected' || evt.data?.platform !== slug) return;
      settled = true;
      cleanup();
      if (!evt.data.success) { setConnectStatus((p) => ({ ...p, [slug]: 'error' })); return; }
      setPlatforms((prev) => (prev.includes(label) ? prev : [...prev, label]));
      setConnectStatus((p) => ({ ...p, [slug]: 'connected' }));
      onboardingService.analyzeAccount(slug)
        .then(({ handle, followers, suggestions }) => {
          setAccountInsights((p) => ({ ...p, [slug]: { handle, followers } }));
          const untouched = (f: string) => !touchedRef.current.has(f);
          if (suggestions.tones?.length && untouched('tones')) {
            setTones((prev) => Array.from(new Set([...prev, ...suggestions.tones])).slice(0, 3));
          }
          if (suggestions.audience && untouched('audience')) setAudience(suggestions.audience);
        })
        .catch(() => undefined);
    };
    const closeTimer = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        if (!settled) setConnectStatus((p) => (p[slug] === 'connecting' ? { ...p, [slug]: 'idle' } : p));
      }
    }, 800);
    window.addEventListener('message', onMessage);
    oauthCleanupRef.current.set(slug, cleanup);

    integrationService.getOAuthPopupUrl(slug, '/dashboard').then((r) => {
      if (!r.success || !r.url) {
        cleanup();
        setConnectStatus((p) => ({ ...p, [slug]: 'error' }));
        popup.close();
        return;
      }
      popup.location.href = r.url;
    });
  };

  useEffect(() => {
    if (step === 0) brandInputRef.current?.focus();
  }, [step]);

  const firstName = useMemo(() => (user?.name ?? '').trim().split(/\s+/)[0] || null, [user]);
  const isLast = step === STEP_META.length - 1;
  const canContinue = step !== 0 || brandName.trim().length > 0;
  const progress = phase === 'done' ? 100 : ((step + 1) / (STEP_META.length + 1)) * 100;

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const markDone = () => localStorage.setItem(STORAGE_KEY, '1');

  const skip = () => {
    markDone();
    onboardingService.skip().catch(() => undefined);
    onDismiss?.();
  };

  const finish = async () => {
    setPhase('saving');
    setErrorMessage(null);
    const answers: OnboardingAnswers = {
      brandName: brandName.trim(), website: website.trim(), industry,
      offering: offering.trim(), offerings, audience: audience.trim(), tones, goals, platforms,
    };
    try {
      const result = await onboardingService.complete(answers);
      markDone();
      setMemoriesCreated(result.memoriesCreated ?? 0);
      setPhase('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Something went wrong saving your answers.');
      setPhase('error');
    }
  };

  const next = () => {
    if (!canContinue) return;
    if (step === 0) maybeAnalyzeWebsite();
    if (isLast) { void finish(); return; }
    setStep((s) => s + 1);
  };

  const answered = {
    brand: brandName.trim().length > 0,
    industry: industry.length > 0,
    offerings: offerings.length > 0,
    audience: audience.trim().length > 0,
    tones: tones.length > 0,
    goals: goals.length > 0,
    platforms: platforms.length > 0,
  };
  const briefEmpty = !Object.values(answered).some(Boolean);

  const inputClass =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[14px] text-gray-900 placeholder:text-gray-300 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-50 transition-all';

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <>
            <h1 className="text-3xl font-black tracking-tight text-gray-900 leading-tight">
              {firstName ? `Welcome, ${firstName}!` : 'Welcome!'} Let&apos;s brief your AI team.
            </h1>
            <p className="text-[15px] text-gray-500 leading-relaxed">
              Daky and your specialist agents personalize everything — posts, emails, designs, strategy — around your brand. Sixty seconds of answers makes every result sharper.
            </p>
            <div className="space-y-4 pt-1">
              <div>
                <FieldLabel>What&apos;s your brand or business called?</FieldLabel>
                <input
                  ref={brandInputRef}
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. Meridian Coffee Co."
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel optional>Website</FieldLabel>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://…"
                  className={inputClass}
                />
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-gray-400">
                  <Sparkles size={12} className="shrink-0 text-indigo-400" />
                  Add it and we&apos;ll read your site to pre-fill the next steps for you.
                </p>
              </div>
            </div>
          </>
        );
      case 1:
        return (
          <>
            <h1 className="text-3xl font-black tracking-tight text-gray-900 leading-tight">
              What kind of business is {brandName.trim() || 'it'}?
            </h1>
            <div>
              <FieldLabel>Industry</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map((i) => (
                  <Chip key={i} label={i} active={industry === i} onClick={() => { touch('industry'); setIndustry(industry === i ? '' : i); }} />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel optional>What do you offer?</FieldLabel>
              <textarea
                value={offering}
                onChange={(e) => { touch('offering'); setOffering(e.target.value); }}
                placeholder="e.g. Specialty coffee subscriptions and brewing gear for home baristas."
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>
            <div>
              <FieldLabel optional>Specific products or services</FieldLabel>
              <TagInput
                value={offerings}
                onChange={(v) => { touch('offerings'); setOfferings(v); }}
                placeholder="e.g. Espresso subscriptions — press Enter to add"
              />
              <p className="mt-1.5 text-[12px] text-gray-400">
                Listed individually so every agent can reference exact products, not just a vague category.
              </p>
            </div>
          </>
        );
      case 2:
        return (
          <>
            <h1 className="text-3xl font-black tracking-tight text-gray-900 leading-tight">
              Who are you talking to?
            </h1>
            <div>
              <FieldLabel optional>Describe your target audience</FieldLabel>
              <textarea
                value={audience}
                onChange={(e) => { touch('audience'); setAudience(e.target.value); }}
                placeholder="e.g. Urban 25–40s who care about quality coffee, sustainability, and small rituals."
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>
            <div>
              <FieldLabel optional>How should your brand sound?</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <Chip key={t} label={t} active={tones.includes(t)} onClick={() => { touch('tones'); toggle(tones, setTones, t); }} />
                ))}
              </div>
            </div>
          </>
        );
      default:
        return (
          <>
            <h1 className="text-3xl font-black tracking-tight text-gray-900 leading-tight">
              What should we focus on first?
            </h1>
            <div>
              <FieldLabel optional>Your goals</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <Chip key={g} label={g} active={goals.includes(g)} onClick={() => toggle(goals, setGoals, g)} />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel optional>Platforms that matter to you</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <Chip key={p} label={p} active={platforms.includes(p)} onClick={() => { touch('platforms'); toggle(platforms, setPlatforms, p); }} />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel optional>Connect an account — Daky reads it for you</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {CONNECTABLE_PLATFORMS.map(({ label, slug }) => {
                  const status = connectStatus[slug] ?? 'idle';
                  const insight = accountInsights[slug];
                  const foundOnSite = Boolean(foundSocialLinks[label]);
                  const busy = status === 'connecting' || status === 'connected';
                  return (
                    <button
                      key={slug}
                      type="button"
                      disabled={busy}
                      onClick={() => connectPlatform(label, slug)}
                      className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-all ${
                        status === 'connected'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : status === 'error'
                            ? 'border-red-200 bg-red-50 text-red-600 hover:border-red-300'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      {status === 'connecting' ? (
                        <Loader2 size={14} className="shrink-0 animate-spin" />
                      ) : status === 'connected' ? (
                        <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                      ) : (
                        <span className="shrink-0"><PlatformLogo platform={slug} size={16} /></span>
                      )}
                      <span>
                        {status === 'connected'
                          ? `${label}${insight ? ` — @${insight.handle}` : ''}`
                          : status === 'connecting'
                            ? `Connecting ${label}…`
                            : status === 'error'
                              ? `Retry ${label}`
                              : label}
                      </span>
                      {status === 'idle' && foundOnSite && (
                        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-500">found</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[12px] text-gray-400">
                Opens a secure popup. We read your bio and follower count to sharpen your brief — nothing is posted on your behalf.
              </p>
            </div>
          </>
        );
    }
  };

  const renderSuccess = () => (
    <div className="w-full max-w-lg space-y-6 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-2xl shadow-emerald-200">
        <CheckCircle2 size={38} className="text-white" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Your AI team is briefed 🎉</h1>
        <p className="text-[15px] text-gray-500 leading-relaxed">
          {memoriesCreated > 0
            ? `${memoriesCreated} verified brand ${memoriesCreated === 1 ? 'fact' : 'facts'} saved to memory. In the background, your AI team is scanning top accounts in your niche across your connected channels to discover what works and prepare your first posts.`
            : 'Your workspace is ready. Your AI team is analyzing your niche and connected social channels to prepare your starter strategy.'}
        </p>
      </div>
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => { onComplete?.(); onDismiss?.(); onNavigate('nova'); }}
          className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-[14px] font-bold text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
        >
          <Sparkles size={15} /> View AI Team & Content
        </button>
        <button
          type="button"
          onClick={() => { onDismiss?.(); onNavigate('integrations'); }}
          className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-6 py-3 text-[14px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
        >
          <Plug size={15} /> Connect more platforms
        </button>
      </div>
      <div className="flex flex-col items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => { onComplete?.(); onDismiss?.(); onNavigate('dashboard'); }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          <Compass size={14} /> Start guided system tour
        </button>
        <button
          type="button"
          onClick={() => onDismiss?.()}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );

  const StepIcon = STEP_META[step].icon;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-white overflow-hidden">
      {/* Top progress bar */}
      <div className="h-1 w-full bg-soft shrink-0">
        <div
          className="h-full bg-blue transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — live brand brief on DakyXTech navy dot-field */}
        <div className="hidden md:flex w-[420px] shrink-0 flex-col bg-navy dot-field text-white p-10 relative overflow-hidden">
          <div className="relative z-10 flex items-center justify-between gap-2">
            <img src="/brand/lockup-on-dark.png" alt="DakyXTech" className="h-7 w-auto" />
          </div>

          <div className="relative z-10 mt-10">
            <div className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue-light">
              <Sparkles size={13} /> Your AI brand brief
            </div>
            <p className="mt-1 text-[13px] text-white/75 leading-relaxed">
              Every agent reads this before every task. Watch it build as you answer.
            </p>
          </div>

          <div className="relative z-10 mt-6 flex-1 overflow-y-auto rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 p-5">
            {briefEmpty ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Megaphone size={28} className="text-white/40" />
                <p className="text-[13px] text-white/50 leading-relaxed max-w-[220px]">
                  Your answers will appear here as a brief for Daky, Nova, Sage, Aria, and Flux.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {answered.brand && (
                  <BriefRow
                    label="Brand"
                    value={
                      <span className="flex items-center gap-1.5">
                        {brandName.trim()}
                        {website.trim() && <Globe size={12} className="text-white/60" />}
                      </span>
                    }
                  />
                )}
                {answered.industry && <BriefRow label="Industry" value={industry} />}
                {offering.trim() && <BriefRow label="Offering" value={<span className="font-medium text-white/85">{offering.trim()}</span>} />}
                {answered.offerings && (
                  <BriefRow
                    label="Products & services"
                    value={
                      <span className="flex flex-wrap gap-1.5 pt-0.5">
                        {offerings.map((o) => (
                          <span key={o} className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">{o}</span>
                        ))}
                      </span>
                    }
                  />
                )}
                {answered.audience && <BriefRow label="Audience" value={<span className="font-medium text-white/85">{audience.trim()}</span>} />}
                {answered.tones && (
                  <BriefRow
                    label="Voice"
                    value={
                      <span className="flex flex-wrap gap-1.5 pt-0.5">
                        {tones.map((t) => (
                          <span key={t} className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">{t}</span>
                        ))}
                      </span>
                    }
                  />
                )}
                {answered.goals && (
                  <BriefRow
                    label="Goals"
                    value={
                      <span className="flex flex-wrap gap-1.5 pt-0.5">
                        {goals.map((g) => (
                          <span key={g} className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">{g}</span>
                        ))}
                      </span>
                    }
                  />
                )}
                {answered.platforms && (
                  <BriefRow
                    label="Platforms"
                    value={
                      <span className="flex flex-wrap gap-1.5 pt-0.5">
                        {platforms.map((p) => (
                          <span key={p} className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">{p}</span>
                        ))}
                      </span>
                    }
                  />
                )}
                {Object.keys(accountInsights).length > 0 && (
                  <BriefRow
                    label="Connected accounts"
                    value={
                      <span className="flex flex-col gap-1 pt-0.5">
                        {Object.entries(accountInsights).map(([slug, info]) => (
                          <span key={slug} className="flex items-center gap-1.5 text-[12px] font-medium text-white/85">
                            <CheckCircle2 size={12} className="shrink-0 text-emerald-300" />
                            @{info.handle} · {info.followers.toLocaleString()} followers
                          </span>
                        ))}
                      </span>
                    }
                  />
                )}
              </div>
            )}
          </div>

          {phase === 'form' && (
            <div className="relative z-10 mt-6 flex justify-center gap-2">
              {STEP_META.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => i < step && setStep(i)}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: i === step ? 24 : 6,
                    background: i === step ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right panel — form / saving / success */}
        <div className="flex flex-1 flex-col items-center justify-center p-8 md:p-16 overflow-y-auto">
          {phase === 'done' ? (
            renderSuccess()
          ) : phase === 'saving' ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 size={36} className="animate-spin text-indigo-500" />
              <p className="text-[15px] font-semibold text-gray-700">Briefing your AI team…</p>
              <p className="text-[13px] text-gray-400">Saving your brand to memory and recompiling your agents.</p>
            </div>
          ) : (
            <form
              className="w-full max-w-lg space-y-6"
              onSubmit={(e) => { e.preventDefault(); next(); }}
            >
              {/* Step header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-navy">
                    <StepIcon size={18} className="text-white" />
                  </div>
                  <span className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">
                    Step {step + 1} of {STEP_META.length} — {STEP_META[step].title}
                  </span>
                </div>
                <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="h-6 w-auto" />
              </div>

              {step > 0 && analysis.state === 'loading' && (
                <div className="flex items-center gap-2.5 rounded-2xl bg-violet-50 border border-violet-100 px-4 py-3 text-[13px] text-violet-700">
                  <Loader2 size={14} className="shrink-0 animate-spin" />
                  <span>Reading <span className="font-semibold">{analysis.host}</span> — your answers will pre-fill as we learn about your brand…</span>
                </div>
              )}
              {step > 0 && analysis.state === 'done' && (
                <div className="flex items-center gap-2.5 rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-[13px] text-indigo-700">
                  <Sparkles size={14} className="shrink-0" />
                  <span>Pre-filled from <span className="font-semibold">{analysis.host}</span> — review and change anything.</span>
                </div>
              )}

              {renderStep()}

              {phase === 'error' && errorMessage && (
                <div className="rounded-2xl bg-red-50 border border-red-100 px-5 py-4 text-[13px] text-red-600 leading-relaxed">
                  <span className="font-semibold">Couldn&apos;t save — </span>{errorMessage}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => { setPhase('form'); setStep((s) => s - 1); }}
                    className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-[13px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    <ArrowLeft size={14} /> Back
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!canContinue}
                  className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-[14px] font-bold text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {phase === 'error' ? 'Try again' : isLast ? 'Finish setup' : 'Continue'}
                  {!isLast && phase !== 'error' && <ArrowRight size={15} />}
                </button>
              </div>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={skip}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Skip setup — I&apos;ll do this later
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
