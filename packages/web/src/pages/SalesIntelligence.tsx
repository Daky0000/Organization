import { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, Check, Clock, Lightbulb, Phone, PhoneCall,
  RefreshCw, Sparkles, Target, TrendingUp, X,
} from 'lucide-react';
import { salesService, type SalesIntelligence as Intelligence } from '../services/salesService';

const ACCENT = '#2563EB';

function StatCard({
  label, value, sub, icon, accent = ACCENT,
}: { label: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
          {sub && <div className="mt-1 truncate text-xs text-slate-500">{sub}</div>}
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function SalesIntelligence() {
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyInsight, setBusyInsight] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await salesService.getIntelligence());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales intelligence');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      await salesService.generateInsights();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate insights');
    } finally {
      setGenerating(false);
    }
  };

  const review = async (id: string, action: 'accept' | 'reject') => {
    setBusyInsight(id);
    try {
      await salesService.reviewInsight(id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to review insight');
    } finally {
      setBusyInsight(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="grid gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      </div>
    );
  }

  const funnel = data?.funnel;
  const answerRate = funnel?.calls ? Math.round((funnel.answered / funnel.calls) * 100) : 0;
  const hasAnyData = (funnel?.conversations ?? 0) > 0 || (funnel?.calls ?? 0) > 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Sales Intelligence</h1>
          <p className="mt-1 text-sm text-slate-500">
            What the last 30 days of conversations say about your sales operation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: ACCENT }}
          >
            <Sparkles size={14} /> {generating ? 'Analysing…' : 'Find patterns'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && !data.policyEnabled && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Outbound calling is switched off, so nothing will dial automatically. Conversations you log by hand are
            still analysed and still feed everything on this page.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Calls" value={funnel?.calls ?? 0} sub="last 30 days" icon={<Phone size={18} />} />
        <StatCard
          label="Answered"
          value={funnel?.answered ?? 0}
          sub={funnel?.calls ? `${answerRate}% of calls placed` : 'no calls placed yet'}
          icon={<PhoneCall size={18} />}
          accent="#0ea5e9"
        />
        <StatCard
          label="Interested"
          value={funnel?.interested ?? 0}
          sub={`${funnel?.conversations ?? 0} conversations analysed`}
          icon={<TrendingUp size={18} />}
          accent="#2563EB"
        />
        <StatCard
          label="Meetings booked"
          value={funnel?.meetings ?? 0}
          sub={`${funnel?.won ?? 0} leads won`}
          icon={<Target size={18} />}
          accent="#10b981"
        />
      </div>

      {!hasAnyData && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Lightbulb className="mx-auto mb-3 text-slate-300" size={28} />
          <h3 className="text-sm font-bold text-slate-800">Nothing to analyse yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Log a call from a lead's page — paste the transcript or your notes — and the analyst will extract the
            summary, objections and follow-up. Everything on this page is built from those records.
          </p>
        </div>
      )}

      {hasAnyData && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900">Conversations over time</h3>
            <p className="mb-4 text-xs text-slate-500">Total vs. those ending interested or with a meeting booked.</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.trend ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Line type="monotone" dataKey="conversations" stroke={ACCENT} strokeWidth={2} dot={false} name="Conversations" />
                  <Line type="monotone" dataKey="positive" stroke="#10b981" strokeWidth={2} dot={false} name="Positive" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900">Top objections</h3>
            <p className="mb-4 text-xs text-slate-500">Last 90 days, grouped by category.</p>
            {data?.objections.length ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.objections} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(value: number, _n, entry: any) =>
                        [`${value} (${Math.round((entry?.payload?.share ?? 0) * 100)}%)`, 'Mentions']}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16}>
                      {data.objections.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? ACCENT : '#D2D7DF'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-400">No objections recorded yet.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Clock size={15} className="text-slate-400" /> Best calling windows
          </h3>
          <p className="mb-3 text-xs text-slate-500">Observed answer rate, buckets with 5+ attempts.</p>
          {data?.bestWindows.length ? (
            <ul className="space-y-2">
              {data.bestWindows.map((w) => (
                <li key={w.label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-700">{w.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full" style={{ width: `${Math.round(w.rate * 100)}%`, background: ACCENT }} />
                    </span>
                    <span className="w-10 text-right font-semibold text-slate-900">{Math.round(w.rate * 100)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-slate-400">
              Still learning. Answer rates appear once there are enough dialled attempts to be meaningful.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Lightbulb size={15} className="text-slate-400" /> AI recommendations
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Proposals only — nothing changes until you accept it.
          </p>
          {data?.insights.length ? (
            <ul className="space-y-3">
              {data.insights.map((insight) => (
                <li key={insight.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{insight.title}</p>
                      {insight.body && <p className="mt-1 text-sm text-slate-600">{insight.body}</p>}
                      <p className="mt-2 text-xs text-slate-400">
                        {insight.kind.replace(/_/g, ' ')} · {insight.sample_size} observations
                        {insight.confidence != null && ` · ${Math.round(insight.confidence * 100)}% confidence`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        title="Accept"
                        disabled={busyInsight === insight.id}
                        onClick={() => void review(insight.id, 'accept')}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        title="Reject"
                        disabled={busyInsight === insight.id}
                        onClick={() => void review(insight.id, 'reject')}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-slate-400">
              No open recommendations. Patterns need at least 30 observations before they are worth acting on.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
