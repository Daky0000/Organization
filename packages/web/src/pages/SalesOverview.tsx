import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, AlarmClock, RefreshCw, Sparkles } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  LIST_SOURCE_LABELS, RESPONSE_STATUSES, RESPONSE_STATUS_META, salesService, type LeadOverview,
} from '../services/salesService';
import { openAppUrl } from '../components/sales/leads/useLeadParam';

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

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export default function SalesOverview() {
  const [data, setData] = useState<LeadOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await salesService.getLeadOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const statusTotal = data ? Object.values(data.byResponseStatus).reduce((s, n) => s + n, 0) : 0;
  const converted = data ? (data.byResponseStatus.registered ?? 0) + (data.byResponseStatus.paid ?? 0) : 0;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Sales overview</h1>
          <p className="mt-1 text-sm text-slate-500">Every list at a glance — outcomes come from each lead's latest logged activity.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Total leads" value={data.totals.leads.toLocaleString()} hint={`${data.totals.newThisWeek} new this week`} />
            <Stat label="Contacted" value={pct(data.totals.contacted, data.totals.leads)} hint={`${data.totals.neverContacted} never contacted`} />
            <Stat label="Registered / paid" value={converted} tone="emerald" hint={pct(converted, data.totals.leads) + ' of all leads'} />
            <Stat label="Overdue follow-ups" value={data.followups.overdue} tone={data.followups.overdue ? 'rose' : 'slate'} hint={`${data.followups.today} due today`} />
            <Stat label="AI reminders to confirm" value={data.followups.needs_confirmation} tone={data.followups.needs_confirmation ? 'amber' : 'slate'} hint={`${data.followups.week} due this week`} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openAppUrl('/sales/followups')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
              <AlarmClock size={14} /> Open today's reminders
            </button>
            {data.followups.needs_confirmation > 0 && (
              <button type="button" onClick={() => openAppUrl('/sales/followups')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                <Sparkles size={14} /> Confirm AI reminders
              </button>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
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
    </div>
  );
}
