import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronRight, Circle, History, Loader2, Scale, Send, Sparkles, XCircle,
} from 'lucide-react';
import { agentService, type AgentRun, type RunAction, type RunStep, type RunSummary } from '../../services/agentService';
import { openAppUrl } from '../sales/leads/useLeadParam';
import Markdown from './Markdown';

const EXAMPLES = [
  'Who should we call for the 26 November "Build AI Adoption into Your 2027 Plans" programme, and why?',
  'Which upcoming event should the sales team push hardest this week? Give me a decision.',
  'Plan a 2-week LinkedIn and WhatsApp campaign to fill the Finance Masterclass before the early bird ends.',
  'How do we reach 100 calls a day per salesperson and convert more of them?',
  'We have 3 sales staff. How should we split them across the CEO masterclass, the 26 Nov programme and AI Sprints?',
];

const PAGE_URLS: Record<string, string> = {
  'sales-overview': '/sales/overview', 'sales-leads': '/sales/leads', 'sales-followups': '/sales/followups',
  'agent-context': '/agent?tab=context', 'agent-targeting': '/agent?tab=targeting',
};

const STATUS_TEXT: Record<AgentRun['status'], string> = {
  planning: 'Planning the work…', running: 'Skills are working…', synthesizing: 'Writing the answer…', done: 'Done', failed: 'Failed',
};

function StepCard({ step }: { step: RunStep }) {
  const [open, setOpen] = useState(false);
  const icon = step.status === 'done' ? <CheckCircle2 size={15} className="text-emerald-600" />
    : step.status === 'running' ? <Loader2 size={15} className="animate-spin text-blue-600" />
    : step.status === 'failed' ? <XCircle size={15} className="text-rose-500" />
    : <Circle size={15} className="text-slate-300" />;
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <span className="mt-0.5">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: step.skill_color || '#475569' }}>{step.skill_icon} {step.skill_name}</span>
            <span className="text-sm font-semibold text-slate-800">{step.title}</span>
          </span>
          <span className="mt-0.5 block line-clamp-1 text-xs text-slate-500">{step.task}</span>
        </span>
        {step.output && (open ? <ChevronDown size={15} className="mt-0.5 text-slate-400" /> : <ChevronRight size={15} className="mt-0.5 text-slate-400" />)}
      </button>
      {open && step.output && (
        <div className="border-t border-slate-100 px-3 py-2">
          <Markdown text={step.output} className="text-[13px]" />
          {step.depends_on.length > 0 && <p className="mt-2 text-[11px] text-slate-400">Used the output of: {step.depends_on.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}

function PlanView({ run }: { run: AgentRun }) {
  const waves = [...new Set(run.steps.map((s) => s.wave))].sort((a, b) => a - b);
  if (!run.steps.length) return null;
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Plan{run.plan?.goal ? ` — ${run.plan.goal}` : ''}
      </p>
      {waves.map((w) => {
        const steps = run.steps.filter((s) => s.wave === w);
        return (
          <div key={w} className="rounded-2xl bg-slate-50 p-2">
            <p className="mb-1.5 px-1 text-[11px] font-semibold text-slate-500">
              Stage {w + 1}{steps.length > 1 ? ` · ${steps.length} skills in parallel` : ''}{w > 0 ? ' · uses earlier results' : ''}
            </p>
            <div className={`grid gap-2 ${steps.length > 1 ? 'md:grid-cols-2' : ''}`}>
              {steps.map((s) => <StepCard key={s.id} step={s} />)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ResultView({ run, onAction, busy }: { run: AgentRun; onAction: (a: RunAction, i: number) => void; busy: number | null }) {
  const r = run.result;
  if (!r) return null;
  const targeting = run.steps.find((s) => s.targeting)?.targeting;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-600"><Sparkles size={13} /> Answer</p>
        <Markdown text={r.answer} />
      </div>
      {r.decision && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><Scale size={13} /> Decision{r.decision.question ? ` — ${r.decision.question}` : ''}</p>
          <div className="grid gap-2 md:grid-cols-2">
            {r.decision.options.map((o) => {
              const rec = r.decision!.recommendation.toLowerCase().includes(o.name.toLowerCase().slice(0, 20));
              return (
                <div key={o.name} className={`rounded-xl border p-3 ${rec ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200'}`}>
                  <p className="text-sm font-bold text-slate-900">{o.name}{rec && <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">recommended</span>}</p>
                  {o.pros && <p className="mt-1 text-xs text-emerald-800"><b>For:</b> {o.pros}</p>}
                  {o.cons && <p className="mt-0.5 text-xs text-rose-700"><b>Against:</b> {o.cons}</p>}
                </div>
              );
            })}
          </div>
          {r.decision.recommendation && (
            <p className="mt-3 text-sm text-slate-800"><b>Recommendation:</b> {r.decision.recommendation} <span className="text-xs text-slate-500">(confidence: {r.decision.confidence})</span></p>
          )}
        </div>
      )}
      {targeting && targeting.suggestions.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-blue-700">Lead groups to call</p>
          <div className="flex flex-wrap gap-2">
            {targeting.suggestions.map((s) => (
              <button key={s.id} type="button" onClick={() => openAppUrl(`/agent?tab=targeting&event=${targeting.event_id}`)}
                className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-left text-xs hover:border-blue-400">
                <span className="font-semibold text-slate-900">{s.title}</span>
                <span className="ml-1.5 text-slate-500">{s.leads} lead{s.leads === 1 ? '' : 's'}{s.warm ? ` · ${s.warm} warm` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {r.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.actions.map((a, i) => (
            <button key={i} type="button" onClick={() => onAction(a, i)} disabled={busy !== null} title={a.reason}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:border-violet-300 hover:bg-violet-50 disabled:opacity-60">
              {busy === i ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} className="text-violet-600" />} {a.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AgentConsole() {
  const [message, setMessage] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [thread, setThread] = useState<AgentRun[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const timer = useRef<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    agentService.skills().then((s) => setAiOn(s.ai_available)).catch(() => setAiOn(null));
    agentService.listRuns().then(setHistory).catch(() => undefined);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, []);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const r = await agentService.getRun(id);
        setRun(r);
        setThread((t) => t.map((x) => (x.id === r.id ? r : x)));
        if (r.status === 'done' || r.status === 'failed') {
          agentService.listRuns().then(setHistory).catch(() => undefined);
          return;
        }
      } catch { /* keep polling */ }
      timer.current = window.setTimeout(tick, 1500);
    };
    void tick();
  }, []);

  const ask = async (text?: string) => {
    const msg = (text ?? message).trim();
    if (!msg) return;
    setStarting(true); setError(null); setNotice(null);
    try {
      const parent = run?.status === 'done' ? run.id : null;
      const r = await agentService.startRun(msg, parent);
      setRun(r);
      setThread((t) => (parent ? [...t, r] : [r]));
      setMessage('');
      poll(r.id);
      window.setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start the agent'); }
    finally { setStarting(false); }
  };

  const openRun = async (id: string) => {
    setShowHistory(false);
    try {
      const r = await agentService.getRun(id);
      // Rebuild the conversation by walking up the parents.
      const chain: AgentRun[] = [r];
      let cur = r;
      for (let i = 0; i < 10 && cur.parent_run_id; i += 1) { cur = await agentService.getRun(cur.parent_run_id); chain.unshift(cur); }
      setThread(chain); setRun(r);
      if (r.status !== 'done' && r.status !== 'failed') poll(r.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open'); }
  };

  const onAction = async (r: AgentRun, a: RunAction, i: number) => {
    if (a.type === 'open_page') { openAppUrl(PAGE_URLS[a.params.page] ?? '/agent'); return; }
    if (a.type === 'open_targeting') { openAppUrl(`/agent?tab=targeting&event=${a.params.event_id}`); return; }
    if (a.type === 'create_posts') {
      window.dispatchEvent(new CustomEvent('agent:open-chat', { detail: { message: `Create posts for this brief:\n\n${a.params.brief}` } }));
      setNotice('The brief is in the assistant (bottom right). It shows the posts and a credit estimate before anything is made.');
      return;
    }
    setBusy(i);
    try {
      const res = await agentService.runAction(r.id, i);
      if (res.type === 'target_leads' && res.targeting) {
        openAppUrl(`/agent?tab=targeting&event=${a.params.event_id}`);
      } else if (res.type === 'save_note') {
        setNotice(`Saved “${a.params.title}” to the company context.`);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'The action failed'); }
    finally { setBusy(null); }
  };

  const working = run && run.status !== 'done' && run.status !== 'failed';

  return (
    <div className="space-y-5">
      {aiOn === false && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Bot size={16} className="mt-0.5 shrink-0" />
          <span><b>AI is switched off.</b> An admin can add the free NVIDIA key (Admin → NVIDIA) or a paid key (Admin → AI Configuration). Lead targeting still works from each event's target roles.</span>
        </div>
      )}
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>}

      {thread.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Ask anything about the business. The agent plans the work, runs the right skills (in parallel where it can), and gives you an answer, a decision and next steps.</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => void ask(e)} disabled={starting}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-violet-300 hover:bg-violet-50">{e}</button>
            ))}
          </div>
        </div>
      )}

      {thread.map((r) => (
        <div key={r.id} className="space-y-3">
          <div className="ml-auto max-w-2xl rounded-2xl bg-slate-900 px-4 py-2.5 text-sm text-white">{r.message}</div>
          {r.status !== 'done' && (
            <p className={`flex items-center gap-2 text-sm ${r.status === 'failed' ? 'text-rose-600' : 'text-slate-500'}`}>
              {r.status === 'failed' ? <XCircle size={15} /> : <Loader2 size={15} className="animate-spin" />}
              {r.status === 'failed' ? (r.error ?? 'Failed') : STATUS_TEXT[r.status]}
            </p>
          )}
          <PlanView run={r} />
          <ResultView run={r} onAction={(a, i) => void onAction(r, a, i)} busy={r.id === run?.id ? busy : null} />
        </div>
      ))}
      <div ref={bottom} />

      <div className="sticky bottom-3 z-10 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" title="History"><History size={18} /></button>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
            placeholder={thread.length && run?.status === 'done' ? 'Ask a follow-up…' : 'Ask the agent… e.g. "Who should we call for the finance masterclass?"'}
            className="min-h-[2.5rem] flex-1 resize-none rounded-xl border-0 px-2 py-1.5 text-sm focus:outline-none focus:ring-0" />
          {thread.length > 0 && !working && (
            <button type="button" onClick={() => { setThread([]); setRun(null); }} className="rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">New</button>
          )}
          <button type="button" onClick={() => void ask()} disabled={starting || Boolean(working) || !message.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Ask
          </button>
        </div>
        {showHistory && (
          <ul className="mt-2 max-h-72 overflow-y-auto border-t border-slate-100 pt-2">
            {history.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">No earlier requests.</li>}
            {history.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => void openRun(h.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${h.status === 'done' ? 'bg-emerald-500' : h.status === 'failed' ? 'bg-rose-500' : 'bg-blue-500'}`} />
                  <span className="flex-1 truncate text-slate-700">{h.message}</span>
                  <span className="shrink-0 text-slate-400">{new Date(h.created_at).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
