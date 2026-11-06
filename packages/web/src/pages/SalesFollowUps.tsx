import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Mail, MessageSquare, Phone, RefreshCw, CheckSquare, X } from 'lucide-react';
import { leadName, salesService, type SalesFollowUp } from '../services/salesService';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  phone_call: <Phone size={14} />,
  email: <Mail size={14} />,
  sms: <MessageSquare size={14} />,
  task: <CheckSquare size={14} />,
};

const TABS = [
  { key: 'scheduled,due', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'missed,cancelled', label: 'Missed' },
] as const;

export default function SalesFollowUps() {
  const [followUps, setFollowUps] = useState<SalesFollowUp[]>([]);
  const [tab, setTab] = useState<string>(TABS[0].key);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setFollowUps(await salesService.listFollowUps(tab));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, payload: { status?: string; scheduled_for?: string }) => {
    try {
      await salesService.updateFollowUp(id, payload);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update follow-up');
    }
  };

  const snooze = (followUp: SalesFollowUp) => {
    const next = new Date(Math.max(Date.now(), new Date(followUp.scheduled_for).getTime()) + 24 * 60 * 60 * 1000);
    void update(followUp.id, { scheduled_for: next.toISOString(), status: 'scheduled' });
  };

  const now = Date.now();

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Follow-ups</h1>
          <p className="mt-1 text-sm text-slate-500">
            Obligations, not reminders. Phone follow-ups queue a call automatically once they come due.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {!loading && followUps.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <CalendarClock className="mx-auto mb-2 text-slate-300" size={26} />
          <p className="text-sm text-slate-500">Nothing here.</p>
        </div>
      )}

      <ul className="space-y-2">
        {followUps.map((f) => {
          const due = new Date(f.scheduled_for).getTime() <= now;
          return (
            <li
              key={f.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm ${
                due && (f.status === 'scheduled' || f.status === 'due') ? 'border-amber-300' : 'border-slate-200'
              }`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  {TYPE_ICONS[f.type] ?? <CheckSquare size={14} />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{leadName(f)}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(f.scheduled_for).toLocaleString()} · {f.type.replace(/_/g, ' ')} ·{' '}
                    <span className="capitalize">{f.status}</span>
                  </p>
                  {f.objective && <p className="mt-1 text-sm text-slate-600">{f.objective}</p>}
                  {f.reason && <p className="text-xs text-slate-400">{f.reason}</p>}
                  {f.exact_time_requested && (
                    <p className="mt-0.5 text-xs font-semibold text-indigo-600">
                      The lead asked for this exact time — it will not be moved to a "better" slot.
                    </p>
                  )}
                  {f.last_error && <p className="mt-0.5 text-xs text-rose-600">{f.last_error}</p>}
                </div>
              </div>
              {(f.status === 'scheduled' || f.status === 'due') && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    title="Mark done"
                    onClick={() => void update(f.id, { status: 'completed' })}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    title="Snooze a day"
                    onClick={() => snooze(f)}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
                  >
                    <CalendarClock size={14} />
                  </button>
                  <button
                    type="button"
                    title="Cancel"
                    onClick={() => void update(f.id, { status: 'cancelled' })}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
