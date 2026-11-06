import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Ban, CheckCircle2, Clock, Loader2, PhoneCall,
  PhoneOff, Plus, Search, ShieldAlert, UserCircle2,
} from 'lucide-react';
import {
  LEAD_STAGES, STAGE_COLORS, formatDuration, leadName, salesService,
  type CallPreview, type LeadStage, type SalesConversation, type SalesFollowUp,
  type SalesLead, type SalesObjection, type SalesCallAttempt,
  OBJECTION_LABELS,
} from '../services/salesService';

const ACCENT = '#2563EB';

function StageBadge({ stage }: { stage: LeadStage | null }) {
  const s = stage ?? 'new';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STAGE_COLORS[s] ?? STAGE_COLORS.new}`}>
      {s}
    </span>
  );
}

/**
 * The gate's verdict, rendered plainly. This is the answer to "why didn't it
 * call this lead?" — the question that otherwise turns into a support ticket.
 */
function GateVerdict({ preview }: { preview: CallPreview }) {
  const d = preview.decision;
  if (d.action === 'call') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
        <span>Clear to call now.</span>
      </div>
    );
  }
  if (d.action === 'reschedule') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
        <Clock size={15} className="mt-0.5 shrink-0" />
        <span>
          Next permitted slot is {new Date(d.runAt).toLocaleString()} ({preview.timezone}).
          <span className="text-sky-600"> Reason: {d.reason.replace(/_/g, ' ')}.</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <ShieldAlert size={15} className="mt-0.5 shrink-0" />
      <span>Blocked — {d.reason}</span>
    </div>
  );
}

function LeadDetail({ contactId, onBack }: { contactId: string; onBack: () => void }) {
  const [lead, setLead] = useState<(SalesLead & Record<string, any>) | null>(null);
  const [conversations, setConversations] = useState<SalesConversation[]>([]);
  const [followUps, setFollowUps] = useState<SalesFollowUp[]>([]);
  const [objections, setObjections] = useState<SalesObjection[]>([]);
  const [attempts, setAttempts] = useState<SalesCallAttempt[]>([]);
  const [preview, setPreview] = useState<CallPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [detail, prev] = await Promise.all([
        salesService.getLead(contactId),
        salesService.previewCall(contactId).catch(() => null),
      ]);
      setLead(detail.lead);
      setConversations(detail.conversations);
      setFollowUps(detail.followUps);
      setObjections(detail.objections);
      setAttempts(detail.attempts);
      if (prev) setPreview(prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);

  const logCall = async () => {
    if (!transcript.trim()) return;
    setSaving(true);
    try {
      await salesService.logConversation({ contact_id: contactId, transcript });
      setTranscript('');
      setLogging(false);
      // The analyst runs on the worker; give it a beat then refresh.
      setTimeout(() => void load(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log the call');
    } finally {
      setSaving(false);
    }
  };

  const setStage = async (stage: string) => {
    try {
      await salesService.updateLead(contactId, { stage });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update stage');
    }
  };

  const markDnc = async () => {
    if (!window.confirm('Mark this lead do-not-call? Any queued calls and follow-ups will be cancelled.')) return;
    try {
      await salesService.markDoNotCall(contactId, 'Marked from the lead page');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set do-not-call');
    }
  };

  if (loading) return <div className="p-6"><Loader2 className="animate-spin text-slate-400" /></div>;
  if (!lead) return <div className="p-6 text-sm text-slate-500">Lead not found.</div>;

  const openObjections = objections.filter((o) => !o.resolved);

  return (
    <div className="space-y-5 p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900">
        <ArrowLeft size={15} /> All leads
      </button>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <UserCircle2 size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-950">{leadName(lead)}</h1>
            <p className="text-sm text-slate-500">
              {[lead.role_title, lead.phone, lead.email].filter(Boolean).join(' · ') || 'No contact details'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lead.stage ?? 'new'}
            onChange={(e) => void setStage(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold capitalize text-slate-700"
          >
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setLogging((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white"
            style={{ background: ACCENT }}
          >
            <PhoneCall size={14} /> Log a call
          </button>
          {!lead.do_not_call && (
            <button
              type="button"
              onClick={() => void markDnc()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            >
              <Ban size={14} /> Do not call
            </button>
          )}
        </div>
      </div>

      {lead.do_not_call && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <PhoneOff size={16} className="mt-0.5 shrink-0" />
          <span>On the do-not-call list{lead.do_not_call_reason ? ` — ${lead.do_not_call_reason}` : ''}.</span>
        </div>
      )}

      {logging && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">Log a call</h3>
          <p className="mb-3 text-xs text-slate-500">
            Paste the transcript or your notes. The analyst extracts the summary, objections, promises and follow-up —
            the same path an AI call takes.
          </p>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={8}
            placeholder={'Me: Hi, do you have a minute?\nThem: Sure, what is this about?\n…'}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setLogging(false)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void logCall()}
              disabled={saving || !transcript.trim()}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {saving ? 'Saving…' : 'Analyse call'}
            </button>
          </div>
        </div>
      )}

      {preview && <GateVerdict preview={preview} />}

      {preview && preview.timing.status === 'ready' && preview.timing.windows.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900">Best times to reach them</h3>
          <p className="mb-3 text-xs text-slate-500">
            Blended from this lead's history and your account-wide answer rates.
          </p>
          <div className="flex flex-wrap gap-2">
            {preview.timing.windows.map((w) => (
              <span key={w.label} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs">
                <span className="font-semibold text-slate-800">{w.label}</span>
                <span className="ml-2 text-slate-500">{Math.round(w.probability * 100)}%</span>
                <span className="ml-1 text-slate-400">({Math.round(w.confidence * 100)}% conf.)</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {preview && preview.timing.status === 'learning' && (
        <p className="text-xs text-slate-400">
          Still learning the best times to call — {preview.timing.totalAttempts} attempts recorded so far.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Conversations</h3>
            {conversations.length === 0 && <p className="text-sm text-slate-400">No conversations yet.</p>}
            <ul className="space-y-3">
              {conversations.map((c) => (
                <li key={c.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-500">
                      {new Date(c.started_at).toLocaleString()} · {formatDuration(c.duration_sec)} · {c.created_by === 'human' ? 'logged by hand' : 'AI call'}
                    </span>
                    {c.analysis_status === 'done' ? (
                      <span className="text-xs text-slate-400">
                        {c.intent?.replace(/_/g, ' ')}
                        {c.analyst_confidence != null && ` · ${Math.round(c.analyst_confidence * 100)}% confidence`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        {c.analysis_status === 'failed' ? 'analysis failed' : 'analysing…'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700">{c.summary || '—'}</p>
                  {!!c.promises?.length && (
                    <p className="mt-2 text-xs text-slate-500">
                      <span className="font-semibold">We promised:</span> {c.promises.join('; ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Call attempts</h3>
            {attempts.length === 0 && <p className="text-sm text-slate-400">No attempts yet.</p>}
            <ul className="space-y-2">
              {attempts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-600">{new Date(a.started_at ?? a.run_at).toLocaleString()}</span>
                  <span className="text-slate-500">
                    {a.outcome ?? a.status}
                    {a.block_reason && <span className="text-rose-500"> — {a.block_reason}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Open objections</h3>
            {openObjections.length === 0 && <p className="text-sm text-slate-400">None recorded.</p>}
            <ul className="space-y-2">
              {openObjections.map((o) => (
                <li key={o.id} className="rounded-xl bg-slate-50 p-2.5">
                  <p className="text-xs font-bold text-slate-800">{OBJECTION_LABELS[o.objection_code] ?? o.objection_code}</p>
                  {o.raw_text && <p className="mt-0.5 text-xs italic text-slate-500">"{o.raw_text}"</p>}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Follow-ups</h3>
            {followUps.length === 0 && <p className="text-sm text-slate-400">Nothing scheduled.</p>}
            <ul className="space-y-2">
              {followUps.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">{new Date(f.scheduled_for).toLocaleString()}</span>
                    <span className="text-xs capitalize text-slate-400">{f.status}</span>
                  </div>
                  {f.reason && <p className="text-xs text-slate-500">{f.reason}</p>}
                  {f.exact_time_requested && (
                    <p className="text-xs font-medium text-indigo-600">Lead asked for this time</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {lead.summary && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-bold text-slate-900">What we know</h3>
              <p className="text-sm text-slate-600">{lead.summary}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SalesLeads() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ first_name: '', last_name: '', phone: '', email: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const { leads: rows, total: count } = await salesService.listLeads({ search, stage });
      setLeads(rows);
      setTotal(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [search, stage]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const create = async () => {
    if (!draft.phone && !draft.email) return;
    try {
      await salesService.createLead(draft);
      setDraft({ first_name: '', last_name: '', phone: '', email: '' });
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead');
    }
  };

  if (detailId) return <LeadDetail contactId={detailId} onBack={() => { setDetailId(null); void load(); }} />;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">{total} leads in the sales pipeline.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white"
          style={{ background: ACCENT }}
        >
          <Plus size={15} /> Add lead
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {creating && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-4">
            {(['first_name', 'last_name', 'phone', 'email'] as const).map((field) => (
              <input
                key={field}
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                placeholder={field.replace('_', ' ')}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm capitalize focus:border-indigo-400 focus:outline-none"
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">A phone number or an email is enough — phone-only leads are fine.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!draft.phone && !draft.email}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              Add lead
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email…"
            className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </div>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm capitalize text-slate-700"
        >
          <option value="">All stages</option>
          {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Lead</th>
              <th className="px-4 py-3 font-semibold">Stage</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 font-semibold">Last contact</th>
              <th className="px-4 py-3 font-semibold">Next action</th>
              <th className="px-4 py-3 font-semibold">Objections</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No leads yet.</td></tr>
            )}
            {leads.map((lead) => (
              <tr
                key={lead.contact_id}
                onClick={() => setDetailId(lead.contact_id)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-semibold text-slate-900">
                    {leadName(lead)}
                    {lead.do_not_call && <PhoneOff size={13} className="text-rose-500" />}
                    {lead.human_handling && <UserCircle2 size={13} className="text-amber-500" />}
                  </div>
                  {lead.role_title && <div className="text-xs text-slate-500">{lead.role_title}</div>}
                </td>
                <td className="px-4 py-3"><StageBadge stage={lead.stage} /></td>
                <td className="px-4 py-3 text-slate-600">{lead.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-500">
                  {lead.last_contacted_at ? new Date(lead.last_contacted_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {lead.next_action_at ? new Date(lead.next_action_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  {lead.open_objections > 0
                    ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{lead.open_objections} open</span>
                    : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
