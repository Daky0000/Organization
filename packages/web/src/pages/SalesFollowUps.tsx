import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, CalendarClock, Check, CheckSquare, ExternalLink, Mail, MessageSquare, Phone, RefreshCw, User, X,
} from 'lucide-react';
import {
  leadName, salesService, type LeadReminder, type SalesFollowUp,
} from '../services/salesService';
import { ReminderCard } from '../components/sales/leads/ActivityTimeline';
import { openAppUrl } from '../components/sales/leads/useLeadParam';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  phone_call: <Phone size={14} />,
  email: <Mail size={14} />,
  sms: <MessageSquare size={14} />,
  task: <CheckSquare size={14} />,
};

const AI_TABS = [
  { key: 'scheduled,due', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'missed,cancelled', label: 'Missed' },
] as const;

type Mode = 'human' | 'ai_agent';

function startOfTomorrow(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** Reminders created from salespeople's notes (or by hand). Never dialled. */
function MyReminders({ onError }: { onError: (msg: string | null) => void }) {
  const [reminders, setReminders] = useState<LeadReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState('Africa/Accra');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      onError(null);
      const [rows, settings] = await Promise.all([
        salesService.listReminders('scheduled'),
        salesService.getReminderSettings().catch(() => null),
      ]);
      setReminders(rows);
      if (settings?.timezone) setTimezone(settings.timezone);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load reminders');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const now = Date.now();
    const tomorrow = startOfTomorrow();
    const confirm = reminders.filter((r) => r.needs_confirmation);
    const rest = reminders.filter((r) => !r.needs_confirmation);
    return [
      { key: 'confirm', title: 'AI suggestions to confirm', items: confirm },
      { key: 'overdue', title: 'Overdue', items: rest.filter((r) => new Date(r.scheduled_for).getTime() < now) },
      { key: 'today', title: 'Today', items: rest.filter((r) => { const t = new Date(r.scheduled_for).getTime(); return t >= now && t < tomorrow; }) },
      { key: 'upcoming', title: 'Upcoming', items: rest.filter((r) => new Date(r.scheduled_for).getTime() >= tomorrow) },
    ].filter((g) => g.items.length > 0);
  }, [reminders]);

  const markDone = async (id: string) => {
    try {
      await salesService.updateFollowUp(id, { status: 'completed' });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update reminder');
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <CalendarClock className="mx-auto mb-2 text-slate-300" size={26} />
        <p className="text-sm text-slate-500">No reminders. Log an activity on a lead — if the note mentions a date, the AI schedules one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{g.title} ({g.items.length})</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {g.items.map((r) => (
              <li key={r.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <button type="button" onClick={() => openAppUrl(`/sales/leads?lead=${encodeURIComponent(r.contact_id)}&tab=activity`)}
                    className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-bold text-slate-900 hover:text-blue-700">
                    {leadName(r)} <ExternalLink size={12} className="shrink-0 text-slate-400" />
                  </button>
                  <button type="button" onClick={() => void markDone(r.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                    <Check size={12} /> Done
                  </button>
                </div>
                <ReminderCard reminder={r} timezone={timezone} onChange={() => void load()} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The original Sales OS follow-ups: obligations the AI dialer acts on. */
function AiFollowUps({ onError }: { onError: (msg: string | null) => void }) {
  const [followUps, setFollowUps] = useState<SalesFollowUp[]>([]);
  const [tab, setTab] = useState<string>(AI_TABS[0].key);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      onError(null);
      setFollowUps(await salesService.listAiFollowUps(tab));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [tab, onError]);

  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, payload: { status?: string; scheduled_for?: string }) => {
    try {
      await salesService.updateFollowUp(id, payload);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update follow-up');
    }
  };

  const snooze = (followUp: SalesFollowUp) => {
    const next = new Date(Math.max(Date.now(), new Date(followUp.scheduled_for).getTime()) + 24 * 60 * 60 * 1000);
    void update(followUp.id, { scheduled_for: next.toISOString(), status: 'scheduled' });
  };

  const now = Date.now();

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Obligations, not reminders. Phone follow-ups queue a call automatically once they come due.</p>
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {AI_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === t.key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}>
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
            <li key={f.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm ${due && (f.status === 'scheduled' || f.status === 'due') ? 'border-amber-300' : 'border-slate-200'}`}>
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
                  <button type="button" title="Mark done" onClick={() => void update(f.id, { status: 'completed' })}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"><Check size={14} /></button>
                  <button type="button" title="Snooze a day" onClick={() => snooze(f)}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><CalendarClock size={14} /></button>
                  <button type="button" title="Cancel" onClick={() => void update(f.id, { status: 'cancelled' })}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X size={14} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function SalesFollowUps() {
  const [mode, setMode] = useState<Mode>('human');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Follow-ups</h1>
          <p className="mt-1 text-sm text-slate-500">Your reminders, and the calls the AI agent will make.</p>
        </div>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="inline-flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {([['human', 'My reminders', User], ['ai_agent', 'AI calls', Bot]] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setMode(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mode === key ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {mode === 'human'
        ? <MyReminders key={`h${reloadKey}`} onError={setError} />
        : <AiFollowUps key={`a${reloadKey}`} onError={setError} />}
    </div>
  );
}
