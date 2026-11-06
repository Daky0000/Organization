import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  ChevronDown,
  Edit2,
  Globe,
  Heart,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function api<T>(method: string, path: string, body?: object): Promise<T> {
  const r = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(e.error ?? `${r.status}`);
  }
  return r.json() as Promise<T>;
}

type MemoryField = {
  id: string;
  category: string;
  title: string;
  content: string;
  source: 'manual' | 'generated' | 'scraped' | 'inferred';
  created_at: string;
};

type GroupedMemory = { category: string; label: string; fields: MemoryField[] };

const CATEGORIES: { id: string; label: string; description: string }[] = [
  { id: 'brand', label: 'Brand & Identity', description: 'Your brand name, voice, personality, and visual identity.' },
  { id: 'business', label: 'Business & Products', description: 'What you sell, your niche, and what makes you unique.' },
  { id: 'audience', label: 'Target Audience', description: 'Who you\'re talking to, their pain points and goals.' },
  { id: 'content', label: 'Content Strategy', description: 'Content pillars, formats, posting frequency, and goals.' },
  { id: 'social', label: 'Social Presence', description: 'Your platforms, handles, followers, and performance.' },
  { id: 'website', label: 'Website Intelligence', description: 'What your website communicates about your brand.' },
  { id: 'custom', label: 'Custom', description: 'Anything else you want the AI to know.' },
];

const SOURCE_STYLES: Record<string, string> = {
  manual: 'bg-slate-100 text-slate-600',
  generated: 'bg-violet-100 text-violet-700',
  scraped: 'bg-blue-100 text-blue-700',
  inferred: 'bg-amber-100 text-amber-700',
};

function HealthBar({ pct }: { pct: number }) {
  const color = pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-gray-100">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-500">{pct}% complete</span>
    </div>
  );
}

type AddFieldFormProps = {
  category: string;
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
};
function AddFieldForm({ category: _category, onSave, onCancel }: AddFieldFormProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Field title (e.g. Brand Voice)"
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What should the AI know about this?"
        rows={3}
        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none resize-none"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
          Cancel
        </button>
        <button
          type="button"
          disabled={!title.trim() || !content.trim() || saving}
          onClick={async () => {
            setSaving(true);
            await onSave(title.trim(), content.trim());
            setSaving(false);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save
        </button>
      </div>
    </div>
  );
}

type EditFieldFormProps = {
  field: MemoryField;
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
};
function EditFieldForm({ field, onSave, onCancel }: EditFieldFormProps) {
  const [title, setTitle] = useState(field.title);
  const [content, setContent] = useState(field.content);
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 focus:border-indigo-400 focus:outline-none"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none resize-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors">Cancel</button>
        <button
          type="button"
          disabled={!title.trim() || !content.trim() || saving}
          onClick={async () => { setSaving(true); await onSave(title.trim(), content.trim()); setSaving(false); }}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}

type GenerateModalProps = {
  onClose: () => void;
  onGenerated: () => void;
};
function GenerateModal({ onClose, onGenerated }: GenerateModalProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    brandName: '',
    industry: '',
    offerings: '',
    audience: '',
    voiceTones: [] as string[],
    goals: [] as string[],
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  const tones = ['Professional', 'Casual', 'Educational', 'Witty', 'Inspirational', 'Bold', 'Friendly', 'Minimalist'];
  const goals = ['Brand Awareness', 'Drive Sales', 'Build Community', 'Get Leads', 'Educate Audience', 'Grow Followers'];

  const toggle = (arr: string[], val: string) => arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api<{ count: number }>('POST', '/api/memory/generate', form);
      setCount(res.count);
      setStep(4);
      onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-4 pb-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-600" />
            <span className="text-sm font-bold text-gray-900">Generate Memories</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Progress */}
        {step < 4 && (
          <div className="flex gap-1 px-6 pt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-indigo-600' : 'bg-gray-100'}`} />
            ))}
          </div>
        )}

        <div className="px-6 py-5">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Step 1 — Your Brand</p>
              <input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} placeholder="Brand / business name" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
              <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Industry or niche (e.g. Fashion, SaaS, Fitness)" className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
              <textarea value={form.offerings} onChange={(e) => setForm({ ...form, offerings: e.target.value })} placeholder="What do you sell or offer?" rows={3} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm resize-none focus:border-indigo-400 focus:outline-none" />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Step 2 — Your Audience & Voice</p>
              <textarea value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="Who is your ideal customer? Describe them." rows={3} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm resize-none focus:border-indigo-400 focus:outline-none" />
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-600">Brand voice / tone</p>
                <div className="flex flex-wrap gap-2">
                  {tones.map((t) => (
                    <button key={t} type="button" onClick={() => setForm({ ...form, voiceTones: toggle(form.voiceTones, t) })}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${form.voiceTones.includes(t) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Step 3 — Your Goals</p>
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-600">Content goals (pick all that apply)</p>
                <div className="flex flex-wrap gap-2">
                  {goals.map((g) => (
                    <button key={g} type="button" onClick={() => setForm({ ...form, goals: toggle(form.goals, g) })}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${form.goals.includes(g) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>}
            </div>
          )}

          {step === 4 && (
            <div className="py-4 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
                <Brain size={24} />
              </div>
              <p className="text-lg font-black text-gray-900">{count} memories created</p>
              <p className="mt-1 text-sm text-gray-500">Your AI now knows your brand better. Review and edit them below.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          {step < 4 ? (
            <>
              <button type="button" onClick={() => step > 1 ? setStep((s) => s - 1) : onClose()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                {step === 1 ? 'Cancel' : 'Back'}
              </button>
              {step < 3 ? (
                <button type="button" onClick={() => setStep((s) => s + 1)}
                  disabled={step === 1 && !form.brandName.trim()}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  Next
                </button>
              ) : (
                <button type="button" onClick={generate} disabled={generating}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {generating ? 'Generating…' : 'Generate'}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={onClose} className="ml-auto rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition-colors">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Scrape modal ───────────────────────────────────────────────────────────────

const SCRAPE_PLATFORMS = [
  { key: 'website',   label: 'Website',     placeholder: 'https://yourbrand.com',                emoji: '🌐' },
  { key: 'instagram', label: 'Instagram',   placeholder: 'https://instagram.com/yourbrand',       emoji: '📸' },
  { key: 'linkedin',  label: 'LinkedIn',    placeholder: 'https://linkedin.com/company/yourbrand', emoji: '💼' },
  { key: 'twitter',   label: 'Twitter / X', placeholder: 'https://x.com/yourbrand',               emoji: '🐦' },
  { key: 'facebook',  label: 'Facebook',    placeholder: 'https://facebook.com/yourbrand',         emoji: '👥' },
] as const;

type ScrapeModalProps = { onClose: () => void; onScraped: () => void };
function ScrapeModal({ onClose, onScraped }: ScrapeModalProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number } | null>(null);

  const hasUrl = Object.values(urls).some((v) => v.trim());

  const startScrape = async () => {
    setScraping(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(urls).filter(([, v]) => v.trim()),
      );
      const res = await api<{ count: number }>('POST', '/api/memory/scrape', payload);
      setResult(res);
      onScraped();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scrape failed');
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-4 pb-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-600" />
            <span className="text-sm font-bold text-gray-900">Scrape Brand Data</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Scraping loading state */}
        {scraping && (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
              <Loader2 size={28} className="animate-spin text-blue-600" />
            </div>
            <p className="text-base font-bold text-gray-900">Scraping brand data…</p>
            <p className="mt-1 text-sm text-gray-500">Running your Apify actors. This may take up to a minute.</p>
          </div>
        )}

        {/* Success state */}
        {!scraping && result && (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
              <Brain size={24} />
            </div>
            <p className="text-lg font-black text-gray-900">{result.count} memories created</p>
            <p className="mt-1 text-sm text-gray-500">Scraped data has been analysed and filled into your memory.</p>
            <button type="button" onClick={onClose} className="mt-5 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition-colors">
              Done
            </button>
          </div>
        )}

        {/* Form */}
        {!scraping && !result && (
          <>
            <div className="px-6 py-5 space-y-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                Paste your brand URLs below. Daky will use your Apify actors to scrape them and automatically fill your memory. All fields are optional — only filled URLs are scraped.
              </p>
              {SCRAPE_PLATFORMS.map(({ key, label, placeholder, emoji }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">
                    {emoji} {label}
                  </label>
                  <input
                    type="url"
                    value={urls[key] ?? ''}
                    onChange={(e) => setUrls((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:outline-none"
                  />
                </div>
              ))}
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void startScrape()}
                disabled={!hasUrl}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Globe size={14} />
                Start Scrape
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Images: liked visuals + AI style suggestions ──────────────────────────────
// Liked images become the user's visual style profile. Future auto-generated
// posts, campaigns, and promotional media use them as style references, so
// this lives with the rest of the personalization data.

type StyleImage = {
  id: string;
  title: string | null;
  prompt: string | null;
  model: string | null;
  image_url: string;
  thumb_url: string | null;
};

function ImagesSection() {
  const [liked, setLiked] = useState<StyleImage[]>([]);
  const [suggestions, setSuggestions] = useState<StyleImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(true);
  const [likingId, setLikingId] = useState<string | null>(null);

  const loadImages = async () => {
    try {
      const [likedRes, sugRes] = await Promise.all([
        api<{ media: StyleImage[] }>('GET', '/api/mcp/media/liked'),
        api<{ media: StyleImage[]; based_on_likes?: boolean }>('GET', '/api/mcp/media/suggestions'),
      ]);
      setLiked(likedRes.media ?? []);
      setSuggestions(sugRes.media ?? []);
    } catch { /* sections stay empty */ }
    finally { setLoadingImages(false); }
  };

  useEffect(() => { void loadImages(); }, []);

  const likeSuggestion = async (img: StyleImage) => {
    setLikingId(img.id);
    try {
      await api('POST', `/api/mcp/media/${img.id}/like`);
      setSuggestions((prev) => prev.filter((s) => s.id !== img.id));
      setLiked((prev) => [img, ...prev]);
    } catch { /* ignore */ }
    finally { setLikingId(null); }
  };

  const unlike = async (img: StyleImage) => {
    setLikingId(img.id);
    try {
      await api('POST', `/api/mcp/media/${img.id}/like`);
      setLiked((prev) => prev.filter((s) => s.id !== img.id));
    } catch { /* ignore */ }
    finally { setLikingId(null); }
  };

  if (loadingImages) return null;

  return (
    <div className="space-y-6">
      {/* Liked images */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Heart size={14} className="text-red-500" />
            <span className="text-sm font-bold text-gray-900">Images</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">{liked.length}</span>
          </div>
          <p className="text-[11px] text-gray-400">Your liked images define the visual style AI will use for future posts and campaigns</p>
        </div>
        {liked.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">
            No liked images yet. Like images in AI Studio → Discover, or from the suggestions below.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 md:grid-cols-5">
            {liked.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-xl bg-gray-100 aspect-square">
                <img src={img.thumb_url || img.image_url} alt={img.title ?? ''} loading="lazy" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => void unlike(img)}
                  disabled={likingId === img.id}
                  title="Remove from liked"
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  {likingId === img.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Suggestions — strictly based on liked styles */}
      {suggestions.length === 0 && liked.length === 0 ? null : suggestions.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 text-center">
          <Sparkles size={16} className="mx-auto text-gray-300" />
          <p className="mt-2 text-sm font-bold text-gray-700">AI Suggestions</p>
          <p className="mt-1 text-xs text-gray-400">No similar styles found yet — new gallery media syncs regularly, check back soon.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-500" />
              <span className="text-sm font-bold text-gray-900">AI Suggestions</span>
            </div>
            <p className="text-[11px] text-gray-400">
              Similar styles to what you liked — tap ♥ to add
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 md:grid-cols-5">
            {suggestions.slice(0, 15).map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-xl bg-gray-100 aspect-square">
                <img src={img.thumb_url || img.image_url} alt={img.title ?? ''} loading="lazy" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => void likeSuggestion(img)}
                  disabled={likingId === img.id}
                  title="Add to liked images"
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  {likingId === img.id ? <Loader2 size={11} className="animate-spin" /> : <Heart size={11} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Memory() {
  const [activeTab, setActiveTab] = useState<'about' | 'images'>('about');
  const [memories, setMemories] = useState<MemoryField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showScrape, setShowScrape] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(CATEGORIES.map((c) => c.id))
  );

  const load = async () => {
    try {
      const data = await api<{ memories: MemoryField[] }>('GET', '/api/memory');
      setMemories(data.memories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const grouped: GroupedMemory[] = CATEGORIES.map((cat) => ({
    category: cat.id,
    label: cat.label,
    fields: memories.filter((m) => m.category === cat.id),
  }));

  const filled = memories.length;
  const healthPct = Math.min(100, Math.round((filled / Math.max(filled + 5, 15)) * 100));

  const addField = async (category: string, title: string, content: string) => {
    const mem = await api<{ memory: MemoryField }>('POST', '/api/memory', { category, title, content });
    setMemories((prev) => [...prev, mem.memory]);
    setAddingTo(null);
  };

  const updateField = async (id: string, title: string, content: string) => {
    const mem = await api<{ memory: MemoryField }>('PUT', `/api/memory/${id}`, { title, content });
    setMemories((prev) => prev.map((m) => (m.id === id ? mem.memory : m)));
    setEditingId(null);
  };

  const deleteField = async (id: string) => {
    setDeletingId(id);
    await api('DELETE', `/api/memory/${id}`);
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setDeletingId(null);
  };

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Brain size={20} className="text-indigo-600" />
            <h1 className="text-xl font-black tracking-tight text-gray-900">Memory</h1>
          </div>
          <p className="mt-0.5 text-sm text-gray-500">What your AI knows about you and your brand</p>
          <div className="mt-2">
            <HealthBar pct={healthPct} />
          </div>
        </div>
        {activeTab === 'about' && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowScrape(true)}
              className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Globe size={14} />
              Scrape
            </button>
            <button
              type="button"
              data-tour-id="btn-generate-memory"
              onClick={() => setShowGenerate(true)}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              <Sparkles size={14} />
              Generate with AI
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        {([
          { id: 'about' as const, label: 'About you', icon: <Brain size={13} /> },
          { id: 'images' as const, label: 'Images', icon: <Heart size={13} /> },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              activeTab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {activeTab === 'images' && <ImagesSection />}

      {activeTab === 'about' && <>
      {/* Full scraped memory — pinned at top */}
      {memories.filter((m) => m.source === 'scraped' && m.title === '🌐 Full Scraped Memory').map((m) => (
        <div key={m.id} className="rounded-2xl border border-blue-200 bg-blue-50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-blue-100">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-blue-600 shrink-0" />
              <span className="text-sm font-bold text-blue-900">Full Scraped Memory</span>
              <span className="rounded-full bg-blue-100 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-700">scraped</span>
            </div>
            <button type="button" onClick={() => deleteField(m.id)} disabled={deletingId === m.id}
              className="rounded-lg p-1.5 text-blue-400 hover:bg-blue-100 hover:text-red-500 transition-colors disabled:opacity-50">
              {deletingId === m.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
          <details className="group">
            <summary className="cursor-pointer px-5 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100/50 transition-colors list-none flex items-center gap-1.5">
              <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
              View raw scraped data
            </summary>
            <div className="px-5 pb-4">
              <pre className="whitespace-pre-wrap text-[11px] text-blue-900 leading-relaxed max-h-64 overflow-y-auto bg-white/60 rounded-xl border border-blue-100 p-3">{m.content}</pre>
            </div>
          </details>
        </div>
      ))}

      {/* Empty state */}
      {memories.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Brain size={22} />
          </div>
          <p className="text-base font-bold text-gray-900">Your AI doesn't know you yet</p>
          <p className="mt-1 text-sm text-gray-500">Generate memories automatically or add them manually below.</p>
          <button
            type="button"
            onClick={() => setShowGenerate(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            <Sparkles size={14} />
            Generate with AI
          </button>
        </div>
      )}

      {/* Categories */}
      <div data-tour-id="memory-categories" className="space-y-4">
      {grouped.map(({ category, label, fields }) => {
        const isExpanded = expandedCategories.has(category);
        const isAdding = addingTo === category;
        const catDef = CATEGORIES.find((c) => c.id === category);

        return (
          <div key={category} className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
            {/* Category header */}
            <div className="flex items-center justify-between px-5 py-4">
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="flex items-center gap-2 text-left"
              >
                <ChevronDown
                  size={15}
                  className={`text-gray-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                />
                <div>
                  <p className="text-sm font-bold text-gray-900">{label}</p>
                  {fields.length === 0 && (
                    <p className="text-[11px] text-gray-400">{catDef?.description}</p>
                  )}
                  {fields.length > 0 && (
                    <p className="text-[11px] text-gray-400">{fields.length} field{fields.length !== 1 ? 's' : ''}</p>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setAddingTo(isAdding ? null : category); setExpandedCategories((p) => new Set([...p, category])); }}
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Plus size={12} />
                Add
              </button>
            </div>

            {/* Fields */}
            {isExpanded && (
              <div className="border-t border-gray-100">
                {fields.length === 0 && !isAdding && (
                  <div className="px-5 py-5 text-center">
                    <p className="text-xs text-gray-400">No fields yet — click <strong>Add</strong> or <strong>Generate</strong> to populate this section.</p>
                  </div>
                )}

                {fields.map((field) => (
                  <div key={field.id} className="border-b border-gray-50 px-5 py-4 last:border-0">
                    {editingId === field.id ? (
                      <EditFieldForm
                        field={field}
                        onSave={(t, c) => updateField(field.id, t, c)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900">{field.title}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SOURCE_STYLES[field.source] ?? SOURCE_STYLES.manual}`}>
                              {field.source}
                            </span>
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">{field.content}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingId(field.id)}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteField(field.id)}
                            disabled={deletingId === field.id}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
                          >
                            {deletingId === field.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {isAdding && (
                  <div className="border-t border-gray-50 px-5 py-4">
                    <AddFieldForm
                      category={category}
                      onSave={(t, c) => addField(category, t, c)}
                      onCancel={() => setAddingTo(null)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
      </>}

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => { void load(); }}
        />
      )}
      {showScrape && (
        <ScrapeModal
          onClose={() => setShowScrape(false)}
          onScraped={() => { void load(); }}
        />
      )}
    </div>
  );
}
