import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock, AlertTriangle, Bot, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, MessageCircle,
  Pencil, Phone, PhoneMissed, RefreshCw, Sparkles, Target, UserPlus, Wand2,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  LIST_SOURCE_LABELS, RESPONSE_STATUSES, RESPONSE_STATUS_META, salesService,
  type LeadField, type LeadList, type LeadOverview, type PlanTask, type QueueItem, type QueueReason,
  type ResponseStatus, type SalesToday,
} from '../services/salesService';
import LeadDrawer from '../components/sales/leads/LeadDrawer';
import { openAppUrl } from '../components/sales/leads/useLeadParam';

// ── Small pieces ────────────────────────────────────────────────────────────

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function Stat({ label, value, hint, tone = 'slate' }: { label: string; value: string | number; hint?: string; tone?: 'slate' | 'rose' | 'amber' | 'emerald' }) {
  const color = { slate: 'text-slate-950', rose: 'text-rose-600', amber: 'text-amber-600', emerald: 'text-emerald-700' }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const BAR_COLORS: Record<string, string> = {
  no_answer: '#f43f5e', unreachable: '#94a3b8', call_back: '#f59e0b', interested: '#0ea5e9',
  not_interested: '#71717a', registered: '#10b981', paid: '#047857', none: '#cbd5e1',
};

/** Call-list tabs. A tab can cover several queue reasons. */
type TabId = 'next' | 'followups' | 'call_back' | 'no_answer' | 'interested' | 'payment' | 'new' | 'stale';
const TABS: Array<{ id: TabId; label: string; reasons: QueueReason[]; empty: string }> = [
  { id: 'next', label: 'Up next', reasons: [], empty: 'Nothing left in the queue for today.' },
  { id: 'followups', label: 'Follow-ups due', reasons: ['overdue', 'due_today'], empty: 'No follow-ups due today.' },
  { id: 'call_back', label: 'Call backs', reasons: ['call_back'], empty: 'Nobody is waiting for a call back.' },
  { id: 'no_answer', label: "Didn't pick up", reasons: ['no_answer', 'unreachable'], empty: 'No missed calls to retry.' },
  { id: 'interested', label: 'Interested', reasons: ['interested'], empty: 'No interested leads waiting.' },
  { id: 'payment', label: 'Payment pending', reasons: ['payment'], empty: 'No registered leads waiting to pay.' },
  { id: 'new', label: 'New leads', reasons: ['new'], empty: 'No new leads — import a list on the Leads page.' },
  { id: 'stale', label: 'Gone quiet', reasons: ['stale'], empty: 'No leads without an outcome.' },
];
const tabForReason = (r: QueueReason | null): TabId =>
  (r && TABS.find((t) => t.reasons.includes(r))?.id) || 'next';

const REASON_CHIP: Record<QueueReason, { label: string; className: string }> = {
  overdue: { label: 'Overdue', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  due_today: { label: 'Due today', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  call_back: { label: 'Call back', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  interested: { label: 'Interested', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  payment: { label: 'Payment', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  no_answer: { label: 'No answer', className: 'bg-rose-50 text-rose-600 ring-rose-200' },
  unreachable: { label: 'Unreachable', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  stale: { label: 'Gone quiet', className: 'bg-zinc-100 text-zinc-600 ring-zinc-200' },
  new: { label: 'New', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
};

const PRIORITY_CHIP: Record<PlanTask['priority'], string> = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
};

/** Outcomes offered on each call row, in the order a caller reaches for them. */
const QUICK_OUTCOMES: ResponseStatus[] = ['no_answer', 'call_back', 'interested', 'registered', 'paid', 'not_interested', 'unreachable'];
const NOTE_HINT: Partial<Record<ResponseStatus, string>> = {
  call_back: 'When? e.g. "call back tomorrow 3pm" — the AI sets the reminder',
  interested: 'What did they say? e.g. "wants the brochure, will decide Friday"',
  registered: 'e.g. "will pay on Monday by MoMo"',
};

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}`;
}

// ── Progress toward the call target ─────────────────────────────────────────

function TargetCard({ today, onSaveTarget }: { today: SalesToday; onSaveTarget: (n: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(today.target));
  const [saving, setSaving] = useState(false);
  const { calls, touches, responses, conversions } = today.progress;
  const ratio = Math.min(1, calls / Math.max(1, today.target));
  const done = calls >= today.target;

  const save = async () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 1) return;
    setSaving(true);
    try { await onSaveTarget(Math.round(n)); setEditing(false); } finally { setSaving(false); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
            <Target size={18} />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Today's calls</h2>
            <p className="text-xs text-slate-500">{done ? 'Target reached — keep the warm leads moving.' : `${today.progress.remaining} more to reach the target`}</p>
          </div>
        </div>
        {editing ? (
          <div className="flex items-center gap-1">
            <input type="number" min={1} max={1000} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" autoFocus aria-label="Daily call target" />
            <button type="button" onClick={() => void save()} disabled={saving}
              className="rounded-lg bg-blue-600 p-1.5 text-white disabled:opacity-50" aria-label="Save target">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => { setDraft(String(today.target)); setEditing(true); }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50">
            <Pencil size={12} /> Target {today.target}
          </button>
        )}
      </div>

      <div className="mt-4 flex items-end gap-2">
        <span className="text-4xl font-black tabular-nums text-slate-950">{calls}</span>
        <span className="pb-1 text-sm font-semibold text-slate-400">/ {today.target} calls</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={calls} aria-valuemin={0} aria-valuemax={today.target}>
        <div className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${ratio * 100}%` }} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 px-2 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Other touches</dt>
          <dd className="text-lg font-black tabular-nums text-slate-800">{Math.max(0, touches - calls)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 px-2 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Responded</dt>
          <dd className="text-lg font-black tabular-nums text-slate-800">{responses}</dd>
        </div>
        <div className="rounded-xl bg-emerald-50 px-2 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Won today</dt>
          <dd className="text-lg font-black tabular-nums text-emerald-700">{conversions}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── AI to-do list ───────────────────────────────────────────────────────────

function PlanCard({
  today, generating, onGenerate, onToggle, onOpenBucket, leadName, onOpenLead,
}: {
  today: SalesToday;
  generating: boolean;
  onGenerate: () => void;
  onToggle: (index: number, done: boolean) => void;
  onOpenBucket: (r: QueueReason | null) => void;
  leadName: (id: string) => string | null;
  onOpenLead: (id: string) => void;
}) {
  const plan = today.plan;
  const doneCount = plan?.tasks.filter((t) => t.done).length ?? 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Sparkles size={18} /></span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Today's to-do list</h2>
            <p className="text-xs text-slate-500">
              {plan
                ? <>{plan.source === 'ai' ? 'Written by AI' : 'Written from your follow-up rules'} · {doneCount}/{plan.tasks.length} done</>
                : 'Built from your lists, reminders and recent call outcomes'}
            </p>
          </div>
        </div>
        <button type="button" onClick={onGenerate} disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60">
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          {plan ? 'Rewrite plan' : 'Write my plan'}
        </button>
      </div>

      {!plan && generating && (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      )}

      {plan && (
        <>
          {plan.headline && <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">{plan.headline}</p>}
          {plan.warning && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{plan.warning}</p>
          )}
          <ol className="mt-3 space-y-2">
            {plan.tasks.map((t, i) => (
              <li key={i} className={`rounded-xl border px-3 py-2.5 ${t.done ? 'border-slate-100 bg-slate-50' : 'border-slate-200'}`}>
                <div className="flex items-start gap-2.5">
                  <button type="button" onClick={() => onToggle(i, !t.done)} className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-600"
                    aria-label={t.done ? 'Mark not done' : 'Mark done'}>
                    {t.done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-semibold ${t.done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.title}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ${PRIORITY_CHIP[t.priority]}`}>{t.priority}</span>
                    </div>
                    {t.detail && <p className={`mt-0.5 text-xs ${t.done ? 'text-slate-400' : 'text-slate-600'}`}>{t.detail}</p>}
                    {(t.lead_ids.length > 0 || t.bucket) && !t.done && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {t.lead_ids.slice(0, 5).map((id) => {
                          const name = leadName(id);
                          return name ? (
                            <button key={id} type="button" onClick={() => onOpenLead(id)}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200">{name}</button>
                          ) : null;
                        })}
                        {t.bucket && (
                          <button type="button" onClick={() => onOpenBucket(t.bucket)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-600 hover:underline">
                            Open list <ChevronRight size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {plan.tips.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
              {plan.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600"><Sparkles size={12} className="mt-0.5 shrink-0 text-violet-500" />{tip}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ── AI health ───────────────────────────────────────────────────────────────

function AiStatus({ today, onRetry, retrying }: { today: SalesToday; onRetry: () => void; retrying: boolean }) {
  const { available, notes_waiting, notes_failed, notes_skipped } = today.ai;
  const missed = notes_failed + notes_skipped;
  if (!available) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Bot size={16} className="mt-0.5 shrink-0" />
        <span><b>AI is switched off.</b> No AI provider key is set, so call notes are not turned into reminders and the to-do list uses the built-in rules. An admin can add one under Admin → AI Configuration (or switch on the free NVIDIA models).</span>
      </div>
    );
  }
  if (!missed && !notes_waiting) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700">
      <Bot size={16} className="shrink-0 text-violet-600" />
      {notes_waiting > 0 && <span>{notes_waiting} note{notes_waiting === 1 ? '' : 's'} being read by the AI…</span>}
      {missed > 0 && (
        <>
          <span>{missed} note{missed === 1 ? '' : 's'} from the last 14 days {missed === 1 ? 'was' : 'were'} not read by the AI, so no reminder was set.</span>
          <button type="button" onClick={onRetry} disabled={retrying}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
            {retrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Read them again
          </button>
        </>
      )}
    </div>
  );
}

// ── Call list row ───────────────────────────────────────────────────────────

function CallRow({ item, onOpen, onLogged }: { item: QueueItem; onOpen: () => void; onLogged: (msg: string) => void }) {
  const [outcome, setOutcome] = useState<ResponseStatus | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = REASON_CHIP[item.reason];
  const due = item.followup && (item.reason === 'overdue' || item.reason === 'due_today');

  const save = async (status: ResponseStatus, body: string) => {
    setSaving(true);
    setError(null);
    try {
      const r = await salesService.logActivity(item.contact_id, {
        type: 'call',
        body: body.trim() || null,
        follow_up_round: item.next_round,
        response_status: status,
        completes_followup_id: due ? item.followup!.id : null,
      });
      const label = RESPONSE_STATUS_META[status].label;
      onLogged(r.reminder
        ? `${item.name}: ${label} — reminder set for ${new Date(r.reminder.scheduled_for).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
        : r.ai === 'pending' ? `${item.name}: ${label} — the AI is still reading the note` : `${item.name}: ${label}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  };

  const pick = (s: ResponseStatus) => {
    // A missed call is one tap; anything that needs context opens the note box.
    if (s === 'no_answer' || s === 'unreachable') { void save(s, note); return; }
    setOutcome(s === outcome ? null : s);
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onOpen} className="truncate text-sm font-bold text-slate-900 hover:text-blue-700 hover:underline">{item.name}</button>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ${chip.className}`}>{chip.label}</span>
            {item.followup?.needs_confirmation && due && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">AI date — check</span>
            )}
            {item.lists.slice(0, 2).map((l) => <span key={l} className="text-[11px] text-slate-400">{l}</span>)}
          </div>
          <p className="mt-0.5 text-xs font-medium text-slate-600">{item.detail}</p>
          {item.last_note && <p className="mt-0.5 line-clamp-2 text-xs italic text-slate-400">“{item.last_note}”</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.phone ? (
            <>
              <a href={`tel:${item.phone}`} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                <Phone size={12} /> {item.phone}
              </a>
              <a href={waLink(item.phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp"
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100">
                <MessageCircle size={14} />
              </a>
            </>
          ) : (
            <span className="text-xs text-slate-400">No phone</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Outcome</span>
        {QUICK_OUTCOMES.map((s) => (
          <button key={s} type="button" disabled={saving} onClick={() => pick(s)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition disabled:opacity-50 ${
              outcome === s ? 'bg-slate-900 text-white ring-slate-900' : RESPONSE_STATUS_META[s].className
            }`}>
            {s === 'no_answer' && <PhoneMissed size={10} className="mr-0.5 inline" />}
            {RESPONSE_STATUS_META[s].label}
          </button>
        ))}
        {saving && <Loader2 size={14} className="animate-spin text-slate-400" />}
      </div>

      {outcome && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void save(outcome, note); }}
            placeholder={NOTE_HINT[outcome] ?? 'Add a note (optional)'}
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          <button type="button" disabled={saving} onClick={() => void save(outcome, note)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save call</button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SalesOverview() {
  const [today, setToday] = useState<SalesToday | null>(null);
  const [data, setData] = useState<LeadOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<TabId>('next');
  const [toast, setToast] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [fields, setFields] = useState<LeadField[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [showPipeline, setShowPipeline] = useState(true);
  const autoPlanned = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const loadToday = useCallback(async () => {
    const t = await salesService.getToday();
    setToday(t);
    return t;
  }, []);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const plan = await salesService.generateDailyPlan();
      setToday((t) => (t ? { ...t, plan } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write the plan');
    } finally {
      setGenerating(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const [t, o] = await Promise.all([loadToday(), salesService.getLeadOverview()]);
      setData(o);
      // First visit of the day: write the plan straight away.
      if (!t.plan && !autoPlanned.current) { autoPlanned.current = true; void generate(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [loadToday, generate]);

  useEffect(() => { void salesService.ensureReminderTimezone(); void load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const openDrawer = useCallback(async (id: string) => {
    setOpenLead(id);
    if (!fields.length) {
      try {
        const [f, l] = await Promise.all([salesService.getLeadFields(), salesService.listLeadLists()]);
        setFields(f); setLists(l);
      } catch { /* the drawer still shows the timeline */ }
    }
  }, [fields.length]);

  const allItems = useMemo(() => {
    const m = new Map<string, QueueItem>();
    if (today) for (const r of Object.keys(today.buckets) as QueueReason[]) for (const i of today.buckets[r]) m.set(i.contact_id, i);
    return m;
  }, [today]);

  const rows: QueueItem[] = useMemo(() => {
    if (!today) return [];
    const def = TABS.find((t) => t.id === tab)!;
    if (tab === 'next') return today.queue;
    return def.reasons.flatMap((r) => today.buckets[r]);
  }, [today, tab]);

  const tabCount = (id: TabId) => {
    if (!today) return 0;
    if (id === 'next') return today.queue.length;
    return TABS.find((t) => t.id === id)!.reasons.reduce((s, r) => s + today.counts[r], 0);
  };

  const onLogged = (msg: string) => {
    setToast(msg);
    void loadToday().catch(() => undefined);
  };

  const toggleTask = async (index: number, done: boolean) => {
    if (!today?.plan) return;
    const date = today.plan.date;
    setToday((t) => (t?.plan ? { ...t, plan: { ...t.plan, tasks: t.plan.tasks.map((x, i) => (i === index ? { ...x, done } : x)) } } : t));
    try {
      const plan = await salesService.setPlanTaskDone(date, index, done);
      setToday((t) => (t ? { ...t, plan } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task');
    }
  };

  const openBucket = (r: QueueReason | null) => {
    setTab(tabForReason(r));
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const retryAi = async () => {
    setRetrying(true);
    try {
      const n = await salesService.retryAiReads();
      setToast(n ? `${n} note${n === 1 ? '' : 's'} sent back to the AI — reminders appear within a few minutes.` : 'Nothing to re-read.');
      await loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue the notes');
    } finally {
      setRetrying(false);
    }
  };

  const statusTotal = data ? Object.values(data.byResponseStatus).reduce((s, n) => s + n, 0) : 0;
  const converted = data ? (data.byResponseStatus.registered ?? 0) + (data.byResponseStatus.paid ?? 0) : 0;
  const dateLabel = today
    ? new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: today.timezone }).format(new Date())
    : '';
  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Sales overview</h1>
          <p className="mt-1 text-sm text-slate-500">{dateLabel ? `${dateLabel} · ` : ''}Your calls, follow-ups and to-do list for today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openAppUrl('/sales/followups')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <AlarmClock size={14} /> All reminders
          </button>
          <button type="button" onClick={() => openAppUrl('/sales/leads')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <UserPlus size={14} /> Leads
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {!today && !error && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100 lg:col-span-2" />
        </div>
      )}

      {today && (
        <>
          <AiStatus today={today} onRetry={() => void retryAi()} retrying={retrying} />

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5">
              <TargetCard today={today} onSaveTarget={async (n) => {
                const target = await salesService.setDailyCallTarget(n);
                setToday((t) => (t ? { ...t, target } : t));
                await loadToday();
              }} />
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-bold text-slate-900">Waiting on you</h2>
                <ul className="space-y-1 text-sm">
                  {([
                    ['followups', 'Follow-ups due', today.counts.overdue + today.counts.due_today, today.counts.overdue ? `${today.counts.overdue} overdue` : null],
                    ['call_back', 'Asked for a call back', today.counts.call_back, null],
                    ['no_answer', "Didn't pick up", today.counts.no_answer + today.counts.unreachable, today.counts.unreachable ? `${today.counts.unreachable} unreachable` : null],
                    ['interested', 'Interested, not registered', today.counts.interested, null],
                    ['payment', 'Registered, not paid', today.counts.payment, null],
                    ['new', 'New, never called', today.counts.new, null],
                    ['stale', 'Gone quiet (7+ days)', today.counts.stale, null],
                  ] as Array<[TabId, string, number, string | null]>).map(([id, label, n, sub]) => (
                    <li key={id}>
                      <button type="button" onClick={() => { setTab(id); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                        <span className="text-slate-700">{label}{sub && <span className="ml-1.5 text-xs text-rose-600">{sub}</span>}</span>
                        <span className={`tabular-nums font-bold ${n ? 'text-slate-900' : 'text-slate-300'}`}>{n}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {today.counts.needs_confirmation > 0 && (
                  <button type="button" onClick={() => openAppUrl('/sales/followups')}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    <Sparkles size={13} /> Confirm {today.counts.needs_confirmation} AI-dated reminder{today.counts.needs_confirmation === 1 ? '' : 's'}
                  </button>
                )}
              </section>
            </div>

            <div className="min-w-0 lg:col-span-2">
              <PlanCard today={today} generating={generating} onGenerate={() => void generate()} onToggle={(i, d) => void toggleTask(i, d)}
                onOpenBucket={openBucket} leadName={(id) => allItems.get(id)?.name ?? null} onOpenLead={(id) => void openDrawer(id)} />
            </div>
          </div>

          <div ref={listRef} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 pt-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Call list</h2>
                <p className="text-xs text-slate-500">
                  {tab === 'next'
                    ? `Ranked for today: follow-ups first, then warm leads, retries and new leads — up to your ${today.target}-call target.`
                    : 'Tap an outcome after each call. Notes are read by the AI to set the next reminder.'}
                </p>
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
              {TABS.map((t) => {
                const n = tabCount(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => setTab(t.id)}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {t.label} <span className={`ml-0.5 tabular-nums ${tab === t.id ? 'text-slate-300' : 'text-slate-400'}`}>{n}</span>
                  </button>
                );
              })}
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">{activeTab.empty}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.slice(0, 150).map((item) => (
                  <CallRow key={`${tab}-${item.contact_id}`} item={item} onOpen={() => void openDrawer(item.contact_id)} onLogged={onLogged} />
                ))}
              </ul>
            )}
            {rows.length > 150 && (
              <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first 150 of {rows.length}. Log outcomes and the list refills.</p>
            )}
          </div>
        </>
      )}

      {data && (
        <section className="space-y-4">
          <button type="button" onClick={() => setShowPipeline((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
            {showPipeline ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Pipeline
          </button>
          {showPipeline && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label="Total leads" value={data.totals.leads.toLocaleString()} hint={`${data.totals.newThisWeek} new this week`} />
                <Stat label="Contacted" value={pct(data.totals.contacted, data.totals.leads)} hint={`${data.totals.neverContacted} never contacted`} />
                <Stat label="Registered / paid" value={converted} tone="emerald" hint={pct(converted, data.totals.leads) + ' of all leads'} />
                <Stat label="Overdue follow-ups" value={data.followups.overdue} tone={data.followups.overdue ? 'rose' : 'slate'} hint={`${data.followups.today} due today`} />
                <Stat label="AI reminders to confirm" value={data.followups.needs_confirmation} tone={data.followups.needs_confirmation ? 'amber' : 'slate'} hint={`${data.followups.week} due this week`} />
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 min-w-0 shadow-sm lg:col-span-2">
                  <h2 className="mb-3 text-sm font-bold text-slate-900">Lists</h2>
                  {data.byList.length === 0 ? (
                    <p className="text-sm text-slate-400">No lists yet — import a spreadsheet or create a list on the Leads page.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="py-2 pr-3">List</th><th className="px-3 py-2 text-right">Leads</th>
                            <th className="px-3 py-2 text-right">Contacted</th><th className="px-3 py-2 text-right">Responded</th>
                            <th className="px-3 py-2 text-right">Interested</th><th className="px-3 py-2 text-right">Registered / paid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.byList.map((l) => (
                            <tr key={l.id} className="border-t border-slate-100">
                              <td className="py-2 pr-3">
                                <span className="font-semibold text-slate-800">{l.name}</span>
                                <span className="ml-2 text-xs text-slate-400">{LIST_SOURCE_LABELS[l.source_type]}</span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.leads}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.contacted} <span className="text-xs text-slate-400">{pct(l.contacted, l.leads)}</span></td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.responded}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.interested}</td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{l.converted} <span className="text-xs font-normal text-slate-400">{pct(l.converted, l.leads)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-3 text-sm font-bold text-slate-900">Latest outcome</h2>
                  <ul className="space-y-2">
                    {[...RESPONSE_STATUSES, 'none' as const].map((s) => {
                      const n = data.byResponseStatus[s] ?? 0;
                      const meta = s === 'none' ? { label: 'Not contacted yet', className: 'bg-slate-100' } : RESPONSE_STATUS_META[s];
                      return (
                        <li key={s} className="text-sm">
                          <div className="flex justify-between"><span className="text-slate-700">{meta.label}</span><span className="tabular-nums text-slate-500">{n}</span></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full" style={{ width: statusTotal ? `${(n / statusTotal) * 100}%` : 0, background: BAR_COLORS[s] }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-bold text-slate-900">Activity, last 30 days</h2>
                {data.activityTrend30d.length === 0 ? (
                  <p className="text-sm text-slate-400">No activity logged in the last 30 days.</p>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.activityTrend30d}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} />
                        <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} width={28} />
                        <Tooltip />
                        <Bar dataKey="activities" name="Activities logged" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="responses" name="Lead responded" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg" role="status">
          {toast}
        </div>
      )}

      {openLead && (
        <LeadDrawer contactId={openLead} fields={fields} lists={lists}
          onClose={() => setOpenLead(null)} onChanged={() => void loadToday().catch(() => undefined)} />
      )}
    </div>
  );
}
