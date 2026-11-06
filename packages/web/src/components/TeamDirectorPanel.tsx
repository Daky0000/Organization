import { useCallback, useEffect, useState } from 'react';
import {
  Compass, Loader2, RefreshCw, Search, Send, Shuffle, TrendingUp,
  AlertTriangle, CheckCircle, Clock, MessageSquare, ExternalLink, X,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

// The team's "main body": the director's current strategy and why it was
// chosen, how it is measured, the reviews that judged it, the niche research
// the agents work from, and the messages the agents send each other.

function tok() { return localStorage.getItem('auth_token') ?? ''; }
const BASE = () => getApiBaseUrl();

type Strategy = {
  id: string;
  title: string;
  hypothesis: string;
  rationale: string;
  evidence: string[];
  focus: Record<string, string>;
  kpi: string;
  kpi_label: string;
  target_display: string;
  baseline_display: string;
  last_value_display: string;
  eval_window_days: number;
  last_verdict: string | null;
  created_by: string;
  started_at: string;
};

type Review = { id: string; verdict: string; notes: string; created_at: string };
type PastStrategy = { id: string; title: string; status: string; started_at: string; ended_at: string | null; ended_reason: string | null; created_by: string };
type Kpi = { kpi: string; label: string; display: string; sample: number };
type TeamMessage = { id: string; from_agent: string; to_agent: string; from_name: string; to_name: string; kind: string; subject: string; body: string; status: string; created_at: string };
type Research = {
  niche: string;
  method: string;
  created_at: string;
  sources: Array<{ title: string; url: string }>;
  findings: {
    summary: string;
    trends: Array<{ name: string; why: string; angle?: string }>;
    audience: { pains: string[]; desires: string[]; objections: string[] };
    competitors: Array<{ name: string; positioning?: string; gap?: string }>;
    opportunities: string[];
  };
};

type Overview = {
  director: { key: string; name: string };
  strategy: Strategy | null;
  reviews: Review[];
  history: PastStrategy[];
  research: Research | null;
  performance: { window_days: number; kpis: Kpi[] };
  messages: TeamMessage[];
};

const VERDICT: Record<string, { label: string; className: string }> = {
  warming_up: { label: 'Warming up', className: 'bg-slate-100 text-slate-600' },
  on_track: { label: 'On track', className: 'bg-emerald-100 text-emerald-700' },
  progressing: { label: 'Improving', className: 'bg-sky-100 text-sky-700' },
  underperforming: { label: 'Behind target', className: 'bg-amber-100 text-amber-800' },
  insufficient_data: { label: 'Needs more data', className: 'bg-slate-100 text-slate-600' },
  switched: { label: 'Replaced', className: 'bg-red-100 text-red-700' },
};

const KIND_STYLE: Record<string, string> = {
  directive: 'bg-indigo-100 text-indigo-700',
  request: 'bg-amber-100 text-amber-800',
  handoff: 'bg-emerald-100 text-emerald-700',
  insight: 'bg-sky-100 text-sky-700',
  alert: 'bg-red-100 text-red-700',
};

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function TeamDirectorPanel({ agents }: { agents: Array<{ key: string; name: string }> }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'review' | 'replace' | 'research' | 'send' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [msgTo, setMsgTo] = useState('*');
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE()}/api/user/agent-team/overview`, { headers: { Authorization: `Bearer ${tok()}` } });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) setData(json as Overview);
      else setNotice({ tone: 'error', text: json.error || 'Could not load the team overview.' });
    } catch {
      setNotice({ tone: 'error', text: 'Could not load the team overview.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, body: unknown, method = 'POST') => {
    const res = await fetch(`${BASE()}/api/user/agent-team/${path}`, {
      method,
      headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong.');
    return json;
  };

  const review = async (replace: boolean) => {
    setBusy(replace ? 'replace' : 'review');
    setNotice(null);
    try {
      const r = await post('review', { replace });
      const text = r.switched
        ? `New strategy: ${r.strategy?.title}. ${r.previous_strategy?.reason ?? ''}`
        : r.evaluation?.reason ?? (r.strategy ? `Strategy set: ${r.strategy.title}` : 'Review complete.');
      setNotice({ tone: 'ok', text: r.research_error ? `${text} (Research: ${r.research_error})` : text });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'The review failed.' });
    } finally {
      setBusy(null);
    }
  };

  const refreshResearch = async () => {
    setBusy('research');
    setNotice(null);
    try {
      await post('research', {});
      setNotice({ tone: 'ok', text: 'Niche research updated. Agents will use it on their next run.' });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Research failed.' });
    } finally {
      setBusy(null);
    }
  };

  const sendMessage = async () => {
    if (!msgSubject.trim() || !msgBody.trim()) return;
    setBusy('send');
    setNotice(null);
    try {
      await post('messages', { to: msgTo, subject: msgSubject.trim(), body: msgBody.trim() });
      setMsgSubject('');
      setMsgBody('');
      setNotice({ tone: 'ok', text: 'Sent. It will be read on the agent\'s next run.' });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not send.' });
    } finally {
      setBusy(null);
    }
  };

  const directorName = data?.director.name ?? 'Helm';
  const s = data?.strategy ?? null;
  const verdict = VERDICT[s?.last_verdict ?? 'warming_up'] ?? VERDICT.warming_up;
  const agentName = (key: string) => agents.find((a) => a.key === key)?.name ?? key;
  const messages = data?.messages ?? [];
  const shownMessages = showAllMessages ? messages : messages.slice(0, 6);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
            <Compass size={18} />
          </div>
          <div className="min-w-0">
            <p className="font-black text-slate-950 tracking-tight">Team strategy · {directorName}, performance director</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {directorName} reviews results daily, keeps the whole team on one strategy, and replaces it when the numbers say it isn't working.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" disabled={busy !== null} onClick={() => review(false)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
            {busy === 'review' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Review now
          </button>
          {s && (
            <button type="button" disabled={busy !== null} onClick={() => review(true)}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50">
              {busy === 'replace' ? <Loader2 size={13} className="animate-spin" /> : <Shuffle size={13} />} New strategy
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {notice.tone === 'ok' ? <CheckCircle size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss"><X size={12} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading team state…</div>
      ) : (
        <>
          {/* Current strategy */}
          {s ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <p className="font-black text-slate-950">{s.title}</p>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${verdict.className}`}>{verdict.label}</span>
              </div>
              {s.hypothesis && <p className="text-sm text-slate-700">{s.hypothesis}</p>}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Why this strategy</p>
                <p className="text-sm text-slate-700">{s.rationale}</p>
                {s.evidence.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                    {s.evidence.map((e) => <li key={e}>• {e}</li>)}
                  </ul>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-4 text-xs">
                <div className="rounded-lg bg-white border border-slate-100 p-2.5"><p className="text-slate-500">Judged on</p><p className="font-bold text-slate-900">{s.kpi_label}</p></div>
                <div className="rounded-lg bg-white border border-slate-100 p-2.5"><p className="text-slate-500">Started at</p><p className="font-bold text-slate-900">{s.baseline_display}</p></div>
                <div className="rounded-lg bg-white border border-slate-100 p-2.5"><p className="text-slate-500">Latest</p><p className="font-bold text-slate-900">{s.last_value_display}</p></div>
                <div className="rounded-lg bg-white border border-slate-100 p-2.5"><p className="text-slate-500">Target</p><p className="font-bold text-slate-900">{s.target_display}</p></div>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Clock size={11} /> Set {shortDate(s.started_at)} by {s.created_by === 'user' ? 'you' : directorName}; first judged after {s.eval_window_days} days, replaced after two reviews in a row behind target.
              </p>
              {Object.keys(s.focus).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">What each agent does under it</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {Object.entries(s.focus).map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-white border border-slate-100 px-2.5 py-2 text-xs">
                        <span className="font-bold text-slate-800">{agentName(k)}:</span> <span className="text-slate-600">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data!.reviews.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Reviews</p>
                  <ul className="space-y-1">
                    {data!.reviews.slice(0, 4).map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-xs">
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${(VERDICT[r.verdict] ?? VERDICT.warming_up).className}`}>{(VERDICT[r.verdict] ?? VERDICT.warming_up).label}</span>
                        <span className="text-slate-600">{shortDate(r.created_at)} — {r.notes}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No team strategy yet. {directorName} sets one on the first daily review, or press <strong>Review now</strong>.
            </div>
          )}

          {/* Performance */}
          {data && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-2"><TrendingUp size={13} /> Last {data.performance.window_days} days</p>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                {data.performance.kpis.map((k) => (
                  <div key={k.kpi} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">{k.label}</p>
                    <p className="text-lg font-black text-slate-900">{k.display}</p>
                    <p className="text-[10px] text-slate-400">{k.sample} data point{k.sample === 1 ? '' : 's'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past strategies */}
          {data && data.history.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-700 mb-2">Earlier strategies</p>
              <ul className="space-y-1.5">
                {data.history.slice(0, 4).map((h) => (
                  <li key={h.id} className="text-xs text-slate-600">
                    <span className="font-bold text-slate-800">{h.title}</span>
                    <span className="text-slate-400"> · {shortDate(h.started_at)}–{shortDate(h.ended_at)}</span>
                    {h.ended_reason && <span> — {h.ended_reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Research */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><Search size={13} /> Niche research</p>
              <button type="button" disabled={busy !== null} onClick={refreshResearch}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50">
                {busy === 'research' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Research now
              </button>
            </div>
            {data?.research ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3 text-xs text-slate-600">
                <p className="text-[11px] text-slate-400">
                  {data.research.niche} · {shortDate(data.research.created_at)} · {data.research.method === 'web_search' ? `from ${data.research.sources.length} web sources` : 'from general knowledge (web search unavailable)'}
                </p>
                <p className="text-sm text-slate-700">{data.research.findings.summary}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.research.findings.trends.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-800 mb-1">Rising</p>
                      <ul className="space-y-1">{data.research.findings.trends.slice(0, 4).map((t) => <li key={t.name}>• <strong>{t.name}</strong>{t.why ? ` — ${t.why}` : ''}</li>)}</ul>
                    </div>
                  )}
                  {data.research.findings.audience.pains.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-800 mb-1">Audience pains</p>
                      <ul className="space-y-1">{data.research.findings.audience.pains.slice(0, 4).map((p) => <li key={p}>• {p}</li>)}</ul>
                    </div>
                  )}
                  {data.research.findings.competitors.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-800 mb-1">Competitors</p>
                      <ul className="space-y-1">{data.research.findings.competitors.slice(0, 4).map((c) => <li key={c.name}>• <strong>{c.name}</strong>{c.gap ? ` — gap: ${c.gap}` : ''}</li>)}</ul>
                    </div>
                  )}
                  {data.research.findings.opportunities.length > 0 && (
                    <div>
                      <p className="font-bold text-slate-800 mb-1">Opportunities</p>
                      <ul className="space-y-1">{data.research.findings.opportunities.slice(0, 4).map((o) => <li key={o}>• {o}</li>)}</ul>
                    </div>
                  )}
                </div>
                {data.research.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.research.sources.slice(0, 6).map((src) => (
                      <a key={src.url} href={src.url} target="_blank" rel="noreferrer noopener"
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500 hover:text-indigo-600">
                        <span className="truncate max-w-[180px]">{src.title}</span> <ExternalLink size={9} className="shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No research yet. It runs with the first review once your brand profile has a niche, and refreshes weekly.</p>
            )}
          </div>

          {/* Messages */}
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-2"><MessageSquare size={13} /> Team channel</p>
            {messages.length === 0 ? (
              <p className="text-xs text-slate-500">No messages yet. Agents post here when they hand off work, ask a teammate for help, or flag a problem to {directorName}.</p>
            ) : (
              <ul className="space-y-1.5">
                {shownMessages.map((m) => (
                  <li key={m.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${KIND_STYLE[m.kind] ?? 'bg-slate-100 text-slate-600'}`}>{m.kind}</span>
                      <span className="font-bold text-slate-800">{m.from_name}</span>
                      <span className="text-slate-400">→ {m.to_name}</span>
                      <span className="text-slate-400 ml-auto">{shortDate(m.created_at)}</span>
                    </div>
                    <p className="mt-1 font-semibold text-slate-700">{m.subject}</p>
                    <p className="text-slate-500 whitespace-pre-line line-clamp-3">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {messages.length > 6 && (
              <button type="button" onClick={() => setShowAllMessages((v) => !v)} className="mt-2 text-[11px] font-bold text-indigo-600 hover:underline">
                {showAllMessages ? 'Show fewer' : `Show all ${messages.length}`}
              </button>
            )}

            <div className="mt-3 rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-[11px] font-bold text-slate-600">Direct your team</p>
              <div className="flex gap-2 flex-wrap">
                <select value={msgTo} onChange={(e) => setMsgTo(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
                  <option value="*">Whole team</option>
                  <option value="director">{directorName} (director)</option>
                  {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
                </select>
                <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} maxLength={140} placeholder="Subject"
                  className="flex-1 min-w-[140px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" />
              </div>
              <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={2} maxLength={2000}
                placeholder="e.g. We're launching a gluten-free range on the 1st — prioritise it this month."
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs resize-none" />
              <div className="flex justify-end">
                <button type="button" disabled={busy !== null || !msgSubject.trim() || !msgBody.trim()} onClick={sendMessage}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50">
                  {busy === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
