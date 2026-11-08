import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, Link2, Loader2, MapPin, Pencil, Phone, RefreshCw,
  RotateCcw, Sparkles, Ticket, Users, X,
} from 'lucide-react';
import { getStoredUser } from '../utils/userSession';
import { formatDateTime, leadName, salesService, type LeadList } from '../services/salesService';
import {
  BOOKING_STATUS_LABELS, CALL_SEGMENTS, SEGMENT_COLORS, SEGMENT_LABELS, SEGMENT_SHORT, dayLabel, money, nextSessionOf,
  priceToday, salesEventsService, type BookingSegment, type CallSegment, type EventDetail, type EventSummary,
  type SegmentStrategy, type SyncRun,
} from '../services/salesEventsService';
import { openAppUrl } from '../components/sales/leads/useLeadParam';

// Sales → Events. Africon's events, read from africon.ai on a schedule, and
// the people to call about each one: who tried to book and did not finish,
// who booked but has not paid, who has a class coming up, and who showed
// interest. Each group has its own call strategy; calls go through the same
// gate and approval queue as every other AI call.

const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';
const OTHER = 'other' as const;
type Tab = CallSegment | typeof OTHER;

function seatsOf(e: EventSummary['event']): number | null {
  const s = nextSessionOf(e);
  if (s?.available != null) return s.available;
  if (s?.capacity && s.registered != null) return Math.max(0, s.capacity - s.registered);
  return null;
}

function SyncLine({ run }: { run: SyncRun | null }) {
  if (!run) return <span>Not read from africon.ai yet.</span>;
  const tone = run.status === 'failed' ? 'text-rose-600' : run.status === 'partial' ? 'text-amber-600' : 'text-slate-500';
  return (
    <span className={tone}>
      Last read {formatDateTime(run.finished_at ?? run.started_at)}
      {run.source ? ` via ${run.source === 'apify' ? 'Apify' : 'direct fetch'}` : ''}
      {run.status === 'failed' ? ` — failed: ${run.error ?? 'unknown error'}` : ` — ${run.events_found} events`}
      {run.status === 'partial' ? ' (with warnings)' : ''}
    </span>
  );
}

function EventCard({ e, active, onClick }: { e: EventSummary; active: boolean; onClick: () => void }) {
  const session = nextSessionOf(e.event);
  const p = priceToday(e.event);
  const seats = seatsOf(e.event);
  const callable = CALL_SEGMENTS.reduce((n, s) => n + (e.segmentCounts[s] ?? 0), 0);
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full flex-col gap-2 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 ${active ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'} ${e.past || e.removedAt ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold leading-snug text-slate-900">{e.title}</p>
        {e.recentChanges > 0 && !e.past && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Changed</span>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <CalendarDays size={12} />
        {e.removedAt ? 'No longer on the site' : e.past ? 'Event over' : session ? `${dayLabel(session.startDate)}${session.endDate && session.endDate !== session.startDate ? ` – ${dayLabel(session.endDate)}` : ''}` : 'Date not published'}
      </p>
      <p className="text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{money(p.price, e.event.currency)}</span>
        {p.tier ? ` · ${p.tier}${p.until ? ` until ${dayLabel(p.until)}` : ''}` : ''}
        {seats !== null ? ` · ${seats} seat${seats === 1 ? '' : 's'} left` : ''}
      </p>
      <div className="flex flex-wrap gap-1">
        {CALL_SEGMENTS.map((s) => (e.segmentCounts[s] ?? 0) > 0 && (
          <span key={s} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEGMENT_COLORS[s]}`}>
            {SEGMENT_SHORT[s]} {e.segmentCounts[s]}
          </span>
        ))}
        {callable === 0 && <span className="text-[11px] text-slate-400">No bookings yet</span>}
      </div>
    </button>
  );
}

function StrategyView({ st }: { st: SegmentStrategy }) {
  return (
    <div className="grid gap-4 text-sm text-slate-700 lg:grid-cols-2">
      <div className="space-y-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Goal</p><p>{st.goal}</p></div>
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">How the agent opens</p><p>{st.opener}</p></div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Points to make</p>
          <ul className="ml-4 list-disc space-y-0.5">{st.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Reason to act now</p><p>{st.offer}</p></div>
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Close</p><p>{st.close}</p></div>
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">If they say…</p>
          <ul className="space-y-1.5">
            {st.objections.map((o, i) => (
              <li key={i} className="rounded-xl bg-slate-50 p-2.5"><p className="font-semibold text-slate-800">{o.scenario}</p><p className="text-slate-600">{o.response}</p></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Avoid</p>
          <ul className="ml-4 list-disc space-y-0.5">{st.avoid.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <p className="mt-1 text-xs text-slate-400">Always added: never take card, PIN or mobile money details on a call; never promise discounts or held seats that are not on the site.</p>
        </div>
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">When the call goes out</p><p>{st.timing}</p></div>
      </div>
    </div>
  );
}

function StrategyEditor({ st, onCancel, onSave, saving }: { st: SegmentStrategy; onCancel: () => void; onSave: (s: Partial<SegmentStrategy>) => void; saving: boolean }) {
  const [goal, setGoal] = useState(st.goal);
  const [opener, setOpener] = useState(st.opener);
  const [points, setPoints] = useState(st.talkingPoints.join('\n'));
  const [offer, setOffer] = useState(st.offer);
  const [objections, setObjections] = useState(st.objections.map((o) => `${o.scenario} :: ${o.response}`).join('\n'));
  const [close, setClose] = useState(st.close);
  const [avoid, setAvoid] = useState(st.avoid.join('\n'));
  const area = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400';
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-slate-600">Goal<textarea className={area} rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600">How the agent opens<textarea className={area} rows={2} value={opener} onChange={(e) => setOpener(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600">Points to make (one per line)<textarea className={area} rows={4} value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600">Reason to act now<textarea className={area} rows={2} value={offer} onChange={(e) => setOffer(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600">Objections — one per line, as <code>what they say :: how to answer</code><textarea className={area} rows={5} value={objections} onChange={(e) => setObjections(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600">Close<textarea className={area} rows={2} value={close} onChange={(e) => setClose(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600">Avoid (one per line)<textarea className={area} rows={3} value={avoid} onChange={(e) => setAvoid(e.target.value)} /></label>
      <div className="flex gap-2">
        <button type="button" disabled={saving} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
          onClick={() => onSave({
            goal, opener, offer, close, talkingPoints: lines(points), avoid: lines(avoid),
            objections: lines(objections).map((l) => { const [a, ...b] = l.split('::'); return { scenario: a.trim(), response: b.join('::').trim() }; }).filter((o) => o.scenario && o.response),
          })}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save strategy
        </button>
        <button type="button" className={`${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function bookingCallText(b: EventDetail['bookings'][number]): string {
  if (b.last_call_status === 'awaiting_approval') return 'Waiting for approval';
  if (b.last_call_status === 'queued') return 'Call queued';
  if (b.last_call_status === 'dialing' || b.last_call_status === 'in_progress') return 'On a call';
  if (b.last_call_status === 'blocked') return `Blocked: ${(b.last_call_block ?? '').replace(/^[a-z_]+: /, '')}`;
  if (b.last_call_status === 'cancelled') return 'Call cancelled';
  if (b.last_call_outcome) return `Last call: ${b.last_call_outcome.replace(/_/g, ' ')}`;
  if (b.next_call_at) return `Planned ${formatDateTime(b.next_call_at)}`;
  return '—';
}

export default function SalesEvents() {
  const isAdmin = getStoredUser()?.role === 'admin';
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [meta, setMeta] = useState<{ isOwner: boolean; hasOwner: boolean; autoCall: boolean; lastRun: SyncRun | null }>({ isOwner: false, hasOwner: false, autoCall: false, lastRun: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [tab, setTab] = useState<Tab>('failed_booking');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [linkListId, setLinkListId] = useState('');
  const [linkStatus, setLinkStatus] = useState('confirmed');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const d = await salesEventsService.listEvents();
      setEvents(d.events);
      setMeta({ isOwner: d.isOwner, hasOwner: d.hasOwner, autoCall: d.autoCall, lastRun: d.lastRun });
      setSelectedId((cur) => cur ?? d.events.find((e) => !e.past && !e.removedAt)?.id ?? d.events[0]?.id ?? null);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to load events' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await salesEventsService.getEvent(id));
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to load the event' });
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) { setPicked(new Set()); setEditing(false); void loadDetail(selectedId); } }, [selectedId, loadDetail]);
  useEffect(() => { salesService.listLeadLists().then(setLists).catch(() => undefined); }, []);

  const people = useMemo(() => {
    const all = detail?.bookings ?? [];
    return tab === OTHER ? all.filter((b) => !(CALL_SEGMENTS as readonly string[]).includes(b.segment)) : all.filter((b) => b.segment === tab);
  }, [detail, tab]);

  const counts = useMemo(() => {
    const c: Partial<Record<BookingSegment | 'other', number>> = {};
    for (const b of detail?.bookings ?? []) {
      const key = (CALL_SEGMENTS as readonly string[]).includes(b.segment) ? b.segment : OTHER;
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [detail]);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  const syncNow = () => run('sync', async () => {
    const s = await salesEventsService.syncNow();
    await loadList();
    if (selectedId) await loadDetail(selectedId);
    if (s.status === 'failed') throw new Error(s.error || 'Sync failed');
    return `Read ${s.found} events${s.source ? ` via ${s.source === 'apify' ? 'Apify' : 'direct fetch'}` : ''}: ${s.created} new, ${s.changed} changed, ${s.removed} removed.${s.warnings.length ? ` ${s.warnings.length} warning(s).` : ''}`;
  });

  const callPeople = (payload: { segment?: CallSegment; bookingIds?: string[] }) => run('call', async () => {
    if (!detail) return;
    const r = await salesEventsService.queueCalls(detail.id, payload);
    await loadDetail(detail.id);
    setPicked(new Set());
    const parts = [
      r.awaitingApproval ? `${r.awaitingApproval} waiting for approval in AI Calling` : '',
      r.queued ? `${r.queued} queued` : '',
      r.blocked.length ? `${r.blocked.length} blocked (${[...new Set(r.blocked.map((b) => b.reason))].slice(0, 2).join('; ')})` : '',
    ].filter(Boolean);
    return r.considered ? parts.join(', ') + '.' : 'Nobody to call — everyone here already has a call waiting.';
  });

  const segStrategy = detail && tab !== OTHER ? detail.strategy.segments[tab] : null;
  const ev = detail?.event;
  const session = ev ? nextSessionOf(ev) : null;
  const p = ev ? priceToday(ev) : null;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Events</h1>
          <p className="mt-1 text-sm text-slate-500">
            Africon events from africon.ai, and the people to call about each one. <SyncLine run={meta.lastRun} />
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { void loadList(); if (selectedId) void loadDetail(selectedId); }}
            className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><RefreshCw size={14} /> Refresh</button>
          {isAdmin && (
            <button type="button" disabled={busy === 'sync'} onClick={() => void syncNow()} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
              {busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Read africon.ai now
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {!meta.isOwner && meta.hasOwner && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Bookings from Africon land on the account set in Admin → Sales Events, so the people lists here are empty for your account.
        </p>
      )}
      {!meta.hasOwner && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No account receives bookings yet. An admin sets it in Admin → Sales Events.
        </p>
      )}

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {!loading && events.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Ticket className="mx-auto mb-2 text-slate-300" size={26} />
          <p className="text-sm text-slate-500">No events yet. They are read from africon.ai automatically every few hours{isAdmin ? ', or now with the button above' : ''}.</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {events.map((e) => <EventCard key={e.id} e={e} active={e.id === selectedId} onClick={() => setSelectedId(e.id)} />)}
        </div>
      )}

      {detail && ev && (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">{ev.title}{ev.coHost ? <span className="font-semibold text-slate-500"> · with {ev.coHost}</span> : null}</h2>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                {session && <span className="flex items-center gap-1"><CalendarDays size={13} />{session.label ? `${session.label}: ` : ''}{dayLabel(session.startDate)}{session.endDate && session.endDate !== session.startDate ? ` – ${dayLabel(session.endDate)}` : ''}{session.startTime ? `, ${session.startTime}` : ''}</span>}
                {(session?.venue ?? ev.venue) && <span className="flex items-center gap-1"><MapPin size={13} />{session?.venue ?? ev.venue}</span>}
                {p && <span className="font-semibold text-slate-800">{money(p.price, ev.currency)}{p.tier ? ` (${p.tier}${p.until ? ` until ${dayLabel(p.until)}` : ''})` : ''}</span>}
                {ev.registrationDeadline && <span>Registration closes {dayLabel(ev.registrationDeadline)}</span>}
                {ev.allowPayLater && <span className="text-indigo-600">Pay later allowed</span>}
              </div>
            </div>
            <a href={ev.url} target="_blank" rel="noreferrer" className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              <ExternalLink size={14} /> Open on africon.ai
            </a>
          </div>

          {detail.changes.length > 0 && (
            <div className="rounded-xl bg-amber-50/60 p-3">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">What changed on the site</p>
              <ul className="space-y-0.5 text-sm text-slate-700">
                {detail.changes.slice(0, 5).map((c, i) => <li key={i}><span className="text-slate-400">{formatDateTime(c.created_at)} · </span>{c.summary}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {[...CALL_SEGMENTS, OTHER].map((s) => (
              <button key={s} type="button" onClick={() => { setTab(s as Tab); setPicked(new Set()); setEditing(false); }}
                className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === s ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                {s === OTHER ? 'Other' : SEGMENT_SHORT[s as CallSegment]} <span className="text-xs text-slate-400">{counts[s as BookingSegment] ?? 0}</span>
              </button>
            ))}
          </div>

          {segStrategy && tab !== OTHER && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">Call strategy — {SEGMENT_LABELS[tab]}</p>
                  <p className="text-xs text-slate-500">
                    {detail.strategy.source === 'default' ? 'Written from the event facts on the site.' : detail.strategy.source === 'ai' ? `Reworded by AI${detail.strategy.model ? ` (${detail.strategy.model})` : ''}.` : 'Edited by your team.'}
                    {detail.strategyStale && <span className="ml-1 font-semibold text-amber-600">The event changed since this was written — check it.</span>}
                  </p>
                </div>
                {isAdmin && !editing && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!!busy} className={`${btn} border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
                      onClick={() => void run('ai', async () => { await salesEventsService.generateStrategy(detail.id); await loadDetail(detail.id); return 'Strategies rewritten for all four groups.'; })}>
                      {busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Rewrite with AI
                    </button>
                    <button type="button" className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
                    {detail.strategy.source !== 'default' && (
                      <button type="button" disabled={!!busy} className={`${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}
                        onClick={() => void run('reset', async () => { await salesEventsService.resetStrategy(detail.id); await loadDetail(detail.id); return 'Back to the strategy written from the event facts.'; })}>
                        <RotateCcw size={14} /> Reset
                      </button>
                    )}
                  </div>
                )}
              </div>
              {editing
                ? <StrategyEditor st={segStrategy} saving={busy === 'save'} onCancel={() => setEditing(false)}
                    onSave={(s) => void run('save', async () => {
                      await salesEventsService.saveStrategy(detail.id, { segments: { [tab]: s } as any });
                      setEditing(false);
                      await loadDetail(detail.id);
                      return 'Strategy saved.';
                    })} />
                : <StrategyView st={segStrategy} />}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Users size={15} /> People ({people.length})</p>
              {tab !== OTHER && meta.isOwner && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!picked.size || !!busy} onClick={() => void callPeople({ bookingIds: [...picked] })}
                    className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
                    <Phone size={14} /> Call selected ({picked.size})
                  </button>
                  <button type="button" disabled={!people.length || !!busy || detail.past} onClick={() => void callPeople({ segment: tab })}
                    className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
                    {busy === 'call' ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />} Call everyone in this group
                  </button>
                </div>
              )}
            </div>
            {tab !== OTHER && (
              <p className="text-xs text-slate-500">
                {meta.autoCall ? 'Auto-calling is on: these calls are queued when their planned time comes.' : 'Auto-calling is off: calls go out only when someone starts them here.'}
                {' '}Every call still respects calling hours, daily caps, consent and do-not-call, and waits for approval when your settings ask for it.
              </p>
            )}
            {people.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">Nobody in this group yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      {tab !== OTHER && <th className="w-8 px-3 py-2" />}
                      <th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Date chosen</th><th className="px-3 py-2">When</th><th className="px-3 py-2">Call</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {people.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/60">
                        {tab !== OTHER && (
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={picked.has(b.id)} aria-label={`Select ${leadName(b)}`}
                              onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <button type="button" className="font-semibold text-slate-900 hover:text-indigo-700" onClick={() => openAppUrl(`/sales/leads?lead=${b.contact_id}`)}>{leadName(b)}</button>
                          {b.email && <p className="text-xs text-slate-400">{b.email}</p>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {b.phone ?? '—'}
                          {b.do_not_call && <p className="text-xs font-semibold text-rose-600">Do not call</p>}
                          {!b.consent_at && !b.do_not_call && <p className="text-xs text-amber-600">No consent on record</p>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEGMENT_COLORS[b.segment]}`}>{BOOKING_STATUS_LABELS[b.status] ?? b.status}</span>
                          {b.amount != null && <p className="mt-0.5 text-xs text-slate-500">{money(b.amount, b.currency ?? ev.currency)}</p>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{b.cohort_label ?? (b.session_date ? dayLabel(b.session_date) : '—')}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(b.last_event_at ?? b.booked_at)}<br />{b.source ?? b.via}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{bookingCallText(b)}{b.calls_made > 0 && <span className="text-slate-400"> · {b.calls_made} call{b.calls_made === 1 ? '' : 's'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {meta.isOwner && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Link2 size={14} /> Add people from a lead list</p>
              <p className="mt-0.5 text-xs text-slate-500">Exported bookings from the Africon dashboard? Import the sheet in Leads → Import, then link that list here and say what those people did.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <select value={linkListId} onChange={(e) => setLinkListId(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">Choose a list…</option>
                  {lists.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.lead_count})</option>)}
                </select>
                <select value={linkStatus} onChange={(e) => setLinkStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="confirmed">They booked and paid</option>
                  <option value="pay_later">They booked, not paid yet</option>
                  <option value="payment_failed">They tried to pay and failed</option>
                  <option value="started">They started booking, did not finish</option>
                  <option value="interested">They showed interest</option>
                </select>
                <button type="button" disabled={!linkListId || !!busy} className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}
                  onClick={() => void run('link', async () => {
                    const r = await salesEventsService.linkList(detail.id, linkListId, linkStatus);
                    await loadDetail(detail.id);
                    await loadList();
                    return `${r.accepted} of ${r.received} people added (${r.created} new, ${r.updated} updated)${r.rejected.length ? `; ${r.rejected.length} skipped` : ''}.`;
                  })}>
                  {busy === 'link' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link list
                </button>
              </div>
            </div>
          )}

          {detail.removedAt && (
            <p className="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle size={14} /> This event is no longer listed on africon.ai.</p>
          )}
        </section>
      )}
    </div>
  );
}
