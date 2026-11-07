import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Flame, ListPlus, Loader2, MessageCircle, Phone, Sparkles, Target, Users, X,
} from 'lucide-react';
import {
  agentService, type ContextItem, type TargetLead, type TargetSuggestion, type TargetingResult,
} from '../../services/agentService';
import { RESPONSE_STATUS_META, type ResponseStatus } from '../../services/salesService';
import { openAppUrl } from '../sales/leads/useLeadParam';

const daysUntil = (date: string | null | undefined, today: string) => {
  if (!date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
};
const fmt = (d?: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');

function SuggestionDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (s: TargetSuggestion) => void }) {
  const [data, setData] = useState<{ suggestion: TargetSuggestion; leads: TargetLead[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    agentService.targetDetail(id).then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [id]);

  const createList = async () => {
    setCreating(true);
    try {
      const r = await agentService.targetToList(id);
      setCreated(r.list);
      if (data) {
        const s = { ...data.suggestion, status: 'list_created' as const, list_id: r.list.id };
        setData({ ...data, suggestion: s });
        onChanged(s);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the list'); }
    finally { setCreating(false); }
  };

  const s = data?.suggestion;
  const listId = created?.id ?? s?.list_id ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{s?.event_title ?? 'Lead group'}</p>
            <h2 className="mt-0.5 text-lg font-bold text-slate-900">{s?.title ?? 'Loading…'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700"><AlertTriangle size={15} className="mt-0.5" />{error}</p>}
          {!data && !error && <div className="h-40 animate-pulse rounded-xl bg-slate-100" />}
          {s && (
            <>
              <section className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
                <p><span className="font-semibold text-slate-900">Why call them: </span><span className="text-slate-700">{s.reason}</span></p>
                {s.pitch && <p><span className="font-semibold text-slate-900">What to say: </span><span className="text-slate-700">{s.pitch}</span></p>}
                <p className="text-xs text-slate-500">
                  Matched on {s.criteria.fields.join(', ')}: {s.criteria.keywords.slice(0, 14).join(', ')}{s.criteria.keywords.length > 14 ? '…' : ''}
                  {s.criteria.statuses.length ? ` · only leads marked ${s.criteria.statuses.join(' / ')}` : ''}
                </p>
              </section>
              <div className="flex flex-wrap items-center gap-2">
                {listId ? (
                  <button type="button" onClick={() => openAppUrl(`/sales/leads?list=${listId}`)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">
                    <CheckCircle2 size={15} /> Open call list{created ? ` “${created.name}”` : ''}
                  </button>
                ) : (
                  <button type="button" onClick={() => void createList()} disabled={creating}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    {creating ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />} Create call list ({s.lead_ids.length})
                  </button>
                )}
                <span className="text-xs text-slate-500">The list appears under Sales → Leads, ready to work through.</span>
              </div>
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                {data.leads.map((l) => {
                  const meta = l.last_status ? RESPONSE_STATUS_META[l.last_status as ResponseStatus] : null;
                  return (
                    <li key={l.contact_id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => openAppUrl(`/sales/leads?lead=${l.contact_id}`)} className="text-sm font-bold text-slate-900 hover:text-blue-700 hover:underline">{l.name}</button>
                          {meta && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ${meta.className}`}>{meta.label}</span>}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{l.evidence.join(' · ')}</p>
                        {l.lists.length > 0 && <p className="text-[11px] text-slate-400">{l.lists.slice(0, 3).join(', ')}</p>}
                      </div>
                      {l.phone && (
                        <div className="flex items-center gap-1.5">
                          <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Phone size={12} /> {l.phone}</a>
                          <a href={`https://wa.me/${l.phone.replace(/[^\d]/g, '')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"
                            className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700"><MessageCircle size={14} /></a>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function TargetingPanel({ initialEventId }: { initialEventId?: string | null }) {
  const [events, setEvents] = useState<ContextItem[] | null>(null);
  const [today, setToday] = useState('');
  const [eventId, setEventId] = useState<string | null>(initialEventId ?? null);
  const [suggestions, setSuggestions] = useState<TargetSuggestion[]>([]);
  const [meta, setMeta] = useState<Pick<TargetingResult, 'source' | 'summary' | 'warning' | 'total_leads'> | null>(null);
  const [focus, setFocus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    agentService.targetingEvents()
      .then((r) => { setEvents(r.events); setToday(r.today); setEventId((cur) => cur ?? r.events.find((e) => e.kind === 'event')?.id ?? r.events[0]?.id ?? null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load events'));
  }, []);

  const loadLatest = useCallback(async (id: string) => {
    try { setSuggestions(await agentService.latestTargets(id)); setMeta(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load suggestions'); }
  }, []);
  useEffect(() => { if (eventId) void loadLatest(eventId); }, [eventId, loadLatest]);

  const suggest = async () => {
    if (!eventId) return;
    setLoading(true); setError(null);
    try {
      const r = await agentService.suggestTargets(eventId, { focus: focus.trim() || null });
      setSuggestions(r.suggestions);
      setMeta({ source: r.source, summary: r.summary, warning: r.warning, total_leads: r.total_leads });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not build the lead groups'); }
    finally { setLoading(false); }
  };

  const dismiss = async (id: string) => {
    try { await agentService.dismissTarget(id); setSuggestions((xs) => xs.filter((x) => x.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not dismiss'); }
  };

  const ev = events?.find((e) => e.id === eventId) ?? null;
  const summary = meta?.summary ?? suggestions[0]?.summary ?? null;
  const source = meta?.source ?? suggestions[0]?.source ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Who to call</h2>
        <p className="text-sm text-slate-500">Pick an upcoming event or programme. The agent groups your leads by who is most likely to sign up, explains why, and builds the call lists.</p>
      </div>
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}

      {!events && !error && <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />}
      {events && events.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No upcoming events. Add one under <button type="button" className="font-semibold text-blue-600" onClick={() => openAppUrl('/agent?tab=context')}>Company context</button>.
        </p>
      )}
      {events && events.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((e) => {
            const d = daysUntil(e.data.start_date, today);
            const close = daysUntil(e.data.booking_deadline, today);
            const active = e.id === eventId;
            return (
              <button key={e.id} type="button" onClick={() => setEventId(e.id)}
                className={`rounded-2xl border p-4 text-left transition ${active ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <p className="text-sm font-bold text-slate-900">{e.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {e.data.start_date && <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{fmt(e.data.start_date)}{e.data.end_date && e.data.end_date !== e.data.start_date ? ` – ${fmt(e.data.end_date)}` : ''}</span>}
                  {e.data.price && <span>{e.data.price}</span>}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  {d !== null && d >= 0 && <span className={`rounded-full px-2 py-0.5 ${d <= 7 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}</span>}
                  {d !== null && d < 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">running now</span>}
                  {close !== null && close >= 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">booking closes in {close}d</span>}
                  {e.data.early_bird && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">early bird {e.data.early_bird}</span>}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {ev && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1">
              <span className="text-xs font-semibold text-slate-600">Anything to focus on? (optional)</span>
              <input value={focus} onChange={(e) => setFocus(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void suggest(); }}
                placeholder='e.g. "banks first", "people who can send a team", "past masterclass attendees"'
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            </label>
            <button type="button" onClick={() => void suggest()} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {suggestions.length ? 'Suggest again' : 'Suggest who to call'}
            </button>
          </div>
          {loading && <p className="mt-2 text-xs text-slate-500">Reading your leads and the event details…</p>}
          {meta?.warning && <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{meta.warning}</p>}
          {summary && <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900"><Target size={14} className="mr-1 inline" />{summary}</p>}
        </section>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {source === 'ai' ? 'Groups chosen by AI' : 'Groups from the event\'s target roles and industries'}
            {meta ? ` · ${meta.total_leads} leads searched` : ''} · best first. Click a group to see the leads.
          </p>
          {suggestions.map((s, i) => (
            <article key={s.id} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-black text-blue-700">{i + 1}</span>
                <button type="button" onClick={() => setOpen(s.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-700">{s.title}</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"><Users size={11} />{s.lead_ids.length}</span>
                    {s.warm_count > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><Flame size={11} />{s.warm_count} warm</span>}
                    {s.status === 'list_created' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">call list created</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{s.reason}</p>
                  {s.pitch && <p className="mt-1 text-xs text-slate-500"><b className="text-slate-600">Pitch:</b> {s.pitch}</p>}
                  <span className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-blue-600">See the {s.lead_ids.length} lead{s.lead_ids.length === 1 ? '' : 's'} <ChevronRight size={13} /></span>
                </button>
                <button type="button" onClick={() => void dismiss(s.id)} className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500" aria-label="Dismiss"><X size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      {ev && !loading && suggestions.length === 0 && !meta && (
        <p className="text-sm text-slate-400">No suggestions for this event yet.</p>
      )}

      {open && <SuggestionDrawer id={open} onClose={() => setOpen(null)} onChanged={(s) => setSuggestions((xs) => xs.map((x) => (x.id === s.id ? s : x)))} />}
    </div>
  );
}
