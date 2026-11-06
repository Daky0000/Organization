import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, FlaskConical, Loader2, RefreshCw, Route, ShieldCheck, XCircle } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

// Admin → AI Ops. Whether the AI is working (call traces, alerts), what it
// costs, whether it is any good (evals), and what the guardrails stopped.

type FeatureMetrics = {
  feature: string; calls: number; errors: number; errorRate: number; cacheHits: number; blocked: number;
  paidAfterFree: number; p50Ms: number; p95Ms: number; inputTokens: number; outputTokens: number; costUsd: number; formatFailures: number;
};
type EvalSummary = { id: string; suite: string; passed: number; total: number; score: string | number; created_at: string; failed: Array<{ id: string; detail: string }> };
type EvalResult = { id: string; pass: boolean; detail: string; ms: number; output?: string };
type Ops = {
  windowHours: number;
  totals: FeatureMetrics | null;
  features: FeatureMetrics[];
  models: Array<{ model: string; calls: number; errors: number; costUsd: number }>;
  guardEvents: Array<{ at: string; feature: string; status: string; guard: any }>;
  recentErrors: Array<{ at: string; feature: string; provider: string; model: string; error: string }>;
  alerts: Array<{ key: string; message: string; at: number }>;
  routing: 'auto' | 'off';
  dailyCostAlertUsd: number;
  tokenEfficiency: { cacheHits: number; promptCacheReadTokens: number; estimatedTokensSaved: number; estimatedUsdSaved: number };
  evals: EvalSummary[];
};

const tok = () => localStorage.getItem('auth_token') ?? '';
const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const when = (v: string | number) => new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AdminAIOps() {
  const [hours, setHours] = useState(24);
  const [ops, setOps] = useState<Ops | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evalRunning, setEvalRunning] = useState<'offline' | 'live' | null>(null);
  const [evalRun, setEvalRun] = useState<{ suite: string; passed: number; total: number; results: EvalResult[] } | null>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` };

  async function load(h = hours) {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/ai/ops?hours=${h}`, { headers });
      const d = await r.json();
      if (d.success) setOps(d); else setError(d.error ?? 'Failed to load');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function setRouting(mode: 'auto' | 'off') {
    const r = await fetch(`${getApiBaseUrl()}/api/admin/ai/ops/routing`, { method: 'PUT', headers, body: JSON.stringify({ mode }) });
    const d = await r.json();
    if (d.success && ops) setOps({ ...ops, routing: d.routing }); else if (!d.success) setError(d.error ?? 'Save failed');
  }

  async function runEvals(suite: 'offline' | 'live') {
    setEvalRunning(suite); setEvalRun(null); setError(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/ai/evals/run`, { method: 'POST', headers, body: JSON.stringify({ suite }) });
      const d = await r.json();
      if (d.success) { setEvalRun(d.run); void load(); } else setError(d.error ?? 'Eval failed');
    } catch (e: any) { setError(e.message); } finally { setEvalRunning(null); }
  }

  if (!ops) {
    return <div className="flex justify-center py-12">{error ? <p className="text-sm text-red-500">{error}</p> : <Loader2 size={20} className="animate-spin text-slate-300" />}</div>;
  }

  const t = ops.totals;
  const card = 'rounded-2xl border border-slate-200 bg-white p-6';
  const btn = 'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';
  const stat = (label: string, value: string, warn = false) => (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${warn ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2"><Activity size={16} className="text-slate-500" /><h2 className="text-base font-bold text-slate-900">AI calls</h2></div>
          <div className="flex items-center gap-2">
            <select value={hours} onChange={(e) => { const h = Number(e.target.value); setHours(h); void load(h); }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
              <option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option>
            </select>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        {t ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {stat('Calls', String(t.calls))}
            {stat('Error rate', pct(t.errorRate), t.errorRate >= 0.2)}
            {stat('Cache hits', String(t.cacheHits))}
            {stat('Paid after free failed', String(t.paidAfterFree))}
            {stat('p95 latency', secs(t.p95Ms), t.p95Ms >= 60_000)}
            {stat('Paid spend', usd(t.costUsd), t.costUsd >= ops.dailyCostAlertUsd)}
            {stat('Bad format', String(t.formatFailures), t.formatFailures > 0)}
          </div>
        ) : <p className="text-sm text-slate-500">No AI calls in this window.</p>}

        {ops.features.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-3 font-semibold">Feature</th><th className="pr-3">Calls</th><th className="pr-3">Errors</th><th className="pr-3">Cached</th>
                <th className="pr-3">Fallback</th><th className="pr-3">p50</th><th className="pr-3">p95</th><th className="pr-3">Tokens in/out</th><th className="pr-3">Cost</th><th>Bad format</th>
              </tr></thead>
              <tbody>
                {ops.features.map((f) => (
                  <tr key={f.feature} className="border-b border-slate-50 text-slate-700">
                    <td className="py-1.5 pr-3 font-mono">{f.feature}</td><td className="pr-3">{f.calls}</td>
                    <td className={`pr-3 ${f.errorRate >= 0.2 ? 'text-red-600 font-semibold' : ''}`}>{f.errors} ({pct(f.errorRate)})</td>
                    <td className="pr-3">{f.cacheHits}</td><td className="pr-3">{f.paidAfterFree}</td>
                    <td className="pr-3">{secs(f.p50Ms)}</td><td className="pr-3">{secs(f.p95Ms)}</td>
                    <td className="pr-3">{f.inputTokens.toLocaleString()} / {f.outputTokens.toLocaleString()}</td>
                    <td className="pr-3">{usd(f.costUsd)}</td><td className={f.formatFailures ? 'text-amber-600' : ''}>{f.formatFailures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ops.models.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {ops.models.map((m) => (
              <span key={m.model} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                <span className="font-mono">{m.model}</span> · {m.calls} calls{m.errors ? ` · ${m.errors} errors` : ''}{m.costUsd ? ` · ${usd(m.costUsd)}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <div className="flex items-center gap-2 mb-1"><AlertTriangle size={16} className="text-slate-500" /><h2 className="text-base font-bold text-slate-900">Alerts and errors</h2></div>
          <p className="text-xs text-slate-500 mb-3">Checked every 5 minutes: a feature failing 30%+ of 8 or more calls in 15 minutes, p95 over 90 s, or paid spend over ${ops.dailyCostAlertUsd} a day (AI_DAILY_COST_ALERT_USD). Alerts go to the logs and Sentry.</p>
          {ops.alerts.length === 0 && ops.recentErrors.length === 0 && <p className="text-xs text-green-600">Nothing to report.</p>}
          {ops.alerts.map((a) => <p key={a.key + a.at} className="text-xs text-red-600 mb-1">{when(a.at)} — {a.message}</p>)}
          <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
            {ops.recentErrors.map((e, i) => (
              <p key={i} className="text-xs text-slate-600"><span className="text-slate-400">{when(e.at)}</span> <span className="font-mono">{e.feature}</span> · {e.provider}/{e.model}: <span className="text-red-500">{e.error}</span></p>
            ))}
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center gap-2 mb-1"><ShieldCheck size={16} className="text-slate-500" /><h2 className="text-base font-bold text-slate-900">Guardrails</h2></div>
          <p className="text-xs text-slate-500 mb-3">Prompt-injection signals, tools refused in a tainted turn or over their per-turn budget, and answers cut off for leaking the system prompt or redacted for containing a key.</p>
          {ops.guardEvents.length === 0 ? <p className="text-xs text-green-600">No guard events in this window.</p> : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {ops.guardEvents.map((g, i) => (
                <div key={i} className="text-xs text-slate-600">
                  <span className="text-slate-400">{when(g.at)}</span> <span className="font-mono">{g.feature}</span>
                  {g.guard?.signals?.length ? <span> · injection signals: {g.guard.signals.join(', ')}</span> : null}
                  {g.guard?.deniedTools?.length ? <span className="text-amber-700"> · refused: {g.guard.deniedTools.map((d: any) => `${d.tool} (${d.code})`).join(', ')}</span> : null}
                  {g.guard?.outputIssues?.length ? <span className="text-red-600"> · output: {g.guard.outputIssues.join(', ')}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <div className="flex items-center gap-2 mb-1"><Route size={16} className="text-slate-500" /><h2 className="text-base font-bold text-slate-900">Cost: routing and caching</h2></div>
          <p className="text-xs text-slate-500 mb-3">
            The free NVIDIA models answer first. When they cannot, routing sends short structured work to the vendor's small model and ordinary work to its mid model; long or strategic work keeps the model set in Configuration. It never picks a dearer model than that one.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={ops.routing === 'auto'} onChange={(e) => void setRouting(e.target.checked ? 'auto' : 'off')} />
            <span className="text-sm font-semibold text-slate-700">Route paid calls by size</span>
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {stat('Cache hits (since restart)', String(ops.tokenEfficiency.cacheHits))}
            {stat('Prompt-cache tokens read', ops.tokenEfficiency.promptCacheReadTokens.toLocaleString())}
            {stat('Tokens saved (est.)', ops.tokenEfficiency.estimatedTokensSaved.toLocaleString())}
            {stat('Saved (est.)', usd(ops.tokenEfficiency.estimatedUsdSaved))}
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center gap-2 mb-1"><FlaskConical size={16} className="text-slate-500" /><h2 className="text-base font-bold text-slate-900">Evals</h2></div>
          <p className="text-xs text-slate-500 mb-3">
            Offline checks the guardrails and router against fixed cases, instantly. Live sends five real prompts down the production path — post JSON, two injection attacks, a prompt-extraction attempt and a judged caption. Run it after changing a prompt, model or ladder, and compare with the last score.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(evalRunning)} onClick={() => void runEvals('offline')} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              {evalRunning === 'offline' ? <Loader2 size={14} className="animate-spin" /> : null} Run offline
            </button>
            <button type="button" disabled={Boolean(evalRunning)} onClick={() => void runEvals('live')} className={`${btn} bg-[#2563EB] text-white hover:bg-[#1D4ED8]`}>
              {evalRunning === 'live' ? <Loader2 size={14} className="animate-spin" /> : null} Run live
            </button>
          </div>
          {evalRun && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold text-slate-700">{evalRun.suite}: {evalRun.passed}/{evalRun.total} passed</p>
              {evalRun.results.filter((r) => !r.pass || evalRun.suite === 'live').map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-xs">
                  {r.pass ? <CheckCircle2 size={13} className="mt-0.5 text-green-500 shrink-0" /> : <XCircle size={13} className="mt-0.5 text-red-500 shrink-0" />}
                  <span className="font-mono text-slate-700">{r.id}</span>
                  <span className="text-slate-400">{secs(r.ms)}</span>
                  {!r.pass && <span className="text-red-500">{r.detail}</span>}
                </div>
              ))}
            </div>
          )}
          {ops.evals.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3 space-y-1">
              <p className="text-xs font-semibold text-slate-600">Previous runs</p>
              {ops.evals.map((e) => (
                <p key={e.id} className="text-xs text-slate-600">
                  <span className="text-slate-400">{when(e.created_at)}</span> {e.suite} · {e.passed}/{e.total}
                  {e.failed.length ? <span className="text-red-500"> · failed: {e.failed.map((f) => f.id).join(', ')}</span> : null}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
