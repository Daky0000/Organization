import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Image as ImageIcon, Loader2, Pause, Play, Plus, Sparkles, Trash2, Wand2, X, XCircle } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Content plans — "generate promo content with featured images 3× a day
// for a month". Runs in the background; each piece lands as a draft blog
// post and fires an in-app notification. Completion sends an email.
// ─────────────────────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  name: string;
  topic: string;
  tone: string;
  per_day: number;
  duration_days: number;
  ends_at: string | null;
  use_liked_style: boolean;
  generate_image: boolean;
  status: 'pricing' | 'priced' | 'active' | 'paused' | 'completed';
  runs_count: number;
  next_run_at: string | null;
  estimated_credits: number;
  plan_blueprint?: { total_posts?: number; total_images?: number } | null;
  pieces_created: number;
  pieces_failed: number;
};

const hdrs = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}`, 'Content-Type': 'application/json' });

// Only real social media count as content targets.
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'twitter', 'x', 'pinterest', 'tiktok', 'threads', 'youtube'];

const STATUS_CLS: Record<Plan['status'], string> = {
  pricing: 'bg-indigo-50 text-indigo-600',
  priced: 'bg-blue-50 text-blue-600',
  active: 'bg-emerald-50 text-emerald-600',
  paused: 'bg-amber-50 text-amber-600',
  completed: 'bg-slate-100 text-slate-500',
};

const STATUS_LABEL: Record<Plan['status'], string> = {
  pricing: 'Calculating cost…',
  priced: 'Ready to start',
  active: 'active',
  paused: 'paused',
  completed: 'completed',
};

type PlanRun = {
  id: string;
  status: 'running' | 'done' | 'failed' | 'skipped';
  title: string | null;
  image_url: string | null;
  blog_post_id: string | null;
  error: string | null;
  created_at: string;
};

export default function AutoContentPlans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, PlanRun[]>>({});

  const loadRuns = useCallback(async (planId: string) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/content-plans/${planId}/runs`, { headers: hdrs() });
      const d = await r.json();
      if (d.success) setRuns((prev) => ({ ...prev, [planId]: d.runs ?? [] }));
    } catch { /* ignore */ }
  }, []);

  // Live progress: refresh the expanded plan's log every 5s (a run in
  // progress shows as "Generating…" until it finishes or fails).
  useEffect(() => {
    if (!expandedId) return;
    void loadRuns(expandedId);
    const t = setInterval(() => void loadRuns(expandedId), 5000);
    return () => clearInterval(t);
  }, [expandedId, loadRuns]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/content-plans`, { headers: hdrs() });
      const d = await r.json();
      if (d.success) setPlans(d.plans ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // While any plan is being priced, poll so the total appears without a refresh.
  useEffect(() => {
    if (!plans?.some((p) => p.status === 'pricing')) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [plans, load]);

  const act = async (plan: Plan, action: 'toggle' | 'delete' | 'run' | 'start') => {
    setBusy(`${action}:${plan.id}`);
    setMsg(null);
    try {
      if (action === 'delete') {
        if (!window.confirm(`Delete plan "${plan.name}"? Already-generated posts stay in Content → Posts.`)) { setBusy(null); return; }
        await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}`, { method: 'DELETE', headers: hdrs() });
      } else if (action === 'toggle') {
        await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}`, {
          method: 'PATCH', headers: hdrs(),
          body: JSON.stringify({ status: plan.status === 'active' ? 'paused' : 'active' }),
        });
      } else if (action === 'start') {
        const r = await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}/start`, { method: 'POST', headers: hdrs() });
        const d = await r.json();
        setMsg({ ok: Boolean(d.success), text: d.success ? `"${plan.name}" started — first piece is on its way.` : (d.error || 'Start failed') });
      } else {
        const r = await fetch(`${API_BASE_URL}/api/content-plans/${plan.id}/run`, { method: 'POST', headers: hdrs() });
        const d = await r.json();
        setMsg({ ok: Boolean(d.success), text: d.message || d.error || 'Started' });
        if (d.success) { setExpandedId(plan.id); void loadRuns(plan.id); }
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Action failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-indigo-500" />
            <h2 className="text-lg font-black text-slate-950">Auto-Content plans</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500 max-w-xl">
            Your AI team creates promotional content with featured images on a schedule — e.g. 3 pieces a day for a month.
            Everything runs in the background; each piece lands as a draft in Content → Posts and you get a notification.
          </p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
          <Plus size={14} /> New plan
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {plans === null ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
      ) : plans.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-14 gap-3">
          <Sparkles size={24} className="text-slate-300" />
          <p className="text-sm font-bold text-slate-600">No content plans yet</p>
          <p className="text-xs text-slate-400">Create one and your AI team starts producing on schedule.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-slate-950 truncate">{p.name}</span>
                    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLS[p.status]}`}>
                      {p.status === 'pricing' && <Loader2 size={9} className="animate-spin" />}
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 truncate">{p.topic || 'AI-recommended promotion'}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {p.per_day}×/day{p.ends_at ? ` until ${new Date(p.ends_at).toLocaleDateString()}` : ` for ${p.duration_days} days`}
                    {p.status === 'pricing' && ' · Atlas is planning, Ledger is calculating the cost — you\'ll get a notification'}
                    {p.status === 'priced' && ` · ${p.plan_blueprint?.total_posts ?? p.per_day * p.duration_days} posts (${p.plan_blueprint?.total_images ?? 0} with images) · total: ✦${Number(p.estimated_credits).toLocaleString()} credits`}
                    {['active', 'paused', 'completed'].includes(p.status) && ` · ${p.pieces_created} piece${Number(p.pieces_created) === 1 ? '' : 's'} created${Number(p.pieces_failed) > 0 ? ` · ${p.pieces_failed} failed` : ''}`}
                    {p.status === 'active' && p.next_run_at ? ` · next: ${new Date(p.next_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {p.status === 'priced' && (
                    <button type="button" onClick={() => void act(p, 'start')} disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800">
                      {busy === `start:${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Start plan
                    </button>
                  )}
                  {['active', 'paused'].includes(p.status) && (
                    <>
                      <button type="button" onClick={() => void act(p, 'run')} disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50">
                        {busy === `run:${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate now
                      </button>
                      <button type="button" onClick={() => void act(p, 'toggle')} disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                        {busy === `toggle:${p.id}` ? <Loader2 size={12} className="animate-spin" /> : p.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                        {p.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => void act(p, 'delete')} disabled={busy !== null}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedId((cur) => cur === p.id ? null : p.id)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${expandedId === p.id ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    Activity <ChevronDown size={11} className={`transition-transform ${expandedId === p.id ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Activity log */}
              {expandedId === p.id && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  {!runs[p.id] ? (
                    <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-slate-300" /></div>
                  ) : runs[p.id].length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">No runs yet — the first piece generates at the scheduled slot, or use Generate now.</p>
                  ) : (
                    <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                      {runs[p.id].map((r) => (
                        <div key={r.id} className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
                          <span className="mt-0.5 shrink-0">
                            {r.status === 'running' ? <Loader2 size={12} className="animate-spin text-indigo-500" />
                              : r.status === 'done' ? <Check size={12} className="text-emerald-500" />
                              : r.status === 'skipped' ? <AlertTriangle size={12} className="text-amber-500" />
                              : <XCircle size={12} className="text-red-500" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-semibold text-slate-800">
                                {r.status === 'running' ? 'Generating piece…' : r.title || (r.status === 'done' ? 'Piece created' : r.status === 'skipped' ? 'Skipped' : 'Failed')}
                              </p>
                              <span className="shrink-0 text-[10px] text-slate-400">
                                {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            {r.error && <p className="mt-0.5 text-[11px] leading-snug text-red-600">{r.error}</p>}
                            {r.status === 'done' && (
                              <p className="mt-0.5 text-[11px] text-slate-400">{r.image_url ? 'With featured image · ' : ''}Scheduled — see Content → Posts / Calendar</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} onCreated={() => {
        setShowCreate(false);
        setMsg({ ok: true, text: 'Your AI team is planning this and calculating the exact credit cost — you\'ll get a notification with the total, then you can start the plan.' });
        void load();
      }} />}
    </div>
  );
}

function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('Monthly promo push');
  const [topic, setTopic] = useState('');
  const [aiRecommended, setAiRecommended] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [tone, setTone] = useState('engaging');
  const [perDay, setPerDay] = useState(3);
  const [durationDays, setDurationDays] = useState(30);
  const [imageMode, setImageMode] = useState<'auto' | 'always' | 'never'>('auto');
  const [useLikedStyle, setUseLikedStyle] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [socials, setSocials] = useState<string[] | null>(null);

  // Connected SOCIAL MEDIA — calendar/email integrations don't count.
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/social/accounts`, { headers: hdrs() })
      .then(r => r.json())
      .then(d => {
        const accounts = Array.isArray(d?.accounts) ? d.accounts : Array.isArray(d?.data) ? d.data : [];
        const platforms = [...new Set(
          accounts
            .filter((a: any) => a.connected !== false && SOCIAL_PLATFORMS.includes(String(a.platform).toLowerCase()))
            .map((a: any) => String(a.platform))
        )] as string[];
        setSocials(platforms);
      })
      .catch(() => setSocials([]));
  }, []);

  const create = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/content-plans`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({
          name, topic, tone, per_day: perDay, duration_days: durationDays,
          image_mode: imageMode, ai_recommended: aiRecommended,
          custom_instructions: customInstructions, use_liked_style: useLikedStyle,
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed to create plan');
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create plan');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400';
  const labelCls = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
  const canProceed = !saving && Boolean(name.trim()) && (aiRecommended || Boolean(topic.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-black text-slate-950">New Auto-Content plan</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

          {/* Connected socials notice */}
          {socials !== null && (
            socials.length > 0 ? (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                <p className="text-xs text-indigo-900">
                  <span className="font-bold">Your connected socials: {socials.join(', ')}.</span>{' '}
                  Content will be created for these channels. To target more, {' '}
                  <a href="/integrations" className="font-bold underline">connect socials on the Integrations page</a>.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-900">
                  <span className="font-bold">No socials connected yet</span> — content will be platform-neutral.{' '}
                  <a href="/integrations" className="font-bold underline">Connect your socials on the Integrations page</a> so pieces are written for your channels.
                </p>
              </div>
            )
          )}

          <label className={`block ${labelCls}`}>Plan name
            <input value={name} onChange={e => setName(e.target.value)} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`} />
          </label>

          <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer ${aiRecommended ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
            <input type="checkbox" checked={aiRecommended} onChange={e => setAiRecommended(e.target.checked)} className="accent-indigo-500" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-700">AI recommended</span>
              <span className="block text-[11px] text-slate-500">Leave the topic to your AI team — it picks what will work best from your personalization (Memory → About you), not random content.</span>
            </span>
          </label>

          {!aiRecommended && (
            <label className={`block ${labelCls}`}>What to promote
              <textarea rows={2} value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="e.g. Our summer collection launch, weekly offers, brand awareness…"
                className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal resize-none`} />
            </label>
          )}

          <label className={`block ${labelCls}`}>Custom instructions <span className="normal-case font-normal text-slate-400">(optional)</span>
            <textarea rows={2} value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
              placeholder="Anything the AI must follow — e.g. always mention free shipping, never use emojis, end with a question…"
              className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal resize-none`} />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className={`block ${labelCls}`}>Per day
              <select value={perDay} onChange={e => setPerDay(Number(e.target.value))} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}×</option>)}
              </select>
            </label>
            <label className={`block ${labelCls}`}>For
              <select value={durationDays} onChange={e => setDurationDays(Number(e.target.value))} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
                <option value={7}>1 week</option>
                <option value={14}>2 weeks</option>
                <option value={30}>1 month</option>
                <option value={60}>2 months</option>
                <option value={90}>3 months</option>
              </select>
            </label>
            <label className={`block ${labelCls}`}>Tone
              <select value={tone} onChange={e => setTone(e.target.value)} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
                {['engaging', 'professional', 'playful', 'bold', 'friendly'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>

          <label className={`block ${labelCls}`}>Featured images
            <select value={imageMode} onChange={e => setImageMode(e.target.value as 'auto' | 'always' | 'never')} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
              <option value="auto">AI decides per post (default)</option>
              <option value="always">Every post gets one</option>
              <option value="never">No images</option>
            </select>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={useLikedStyle} onChange={e => setUseLikedStyle(e.target.checked)} className="accent-indigo-500" />
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ImageIcon size={14} className="text-slate-400" /> Match my liked images' visual style</span>
          </label>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <span className="font-bold text-slate-700">What happens when you proceed:</span>{' '}
              Atlas (Planner) turns this into a full production plan — number of posts, which get images, platform mix —
              then Ledger (Credit Calculator) works out the exact credit cost. You'll get a notification with the total,
              and nothing is generated or charged until you click Start plan.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
          <button type="button" onClick={() => void create()} disabled={!canProceed}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Proceed
          </button>
        </div>
      </div>
    </div>
  );
}
