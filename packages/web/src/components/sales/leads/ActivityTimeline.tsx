import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock, Bot, Check, CheckCircle2, Loader2, Pencil, Sparkles, Trash2, X,
} from 'lucide-react';
import {
  ACTIVITY_LABELS, ACTIVITY_TYPES, CHANNEL_LABELS, REMINDER_CHANNELS, RESPONSE_STATUSES, RESPONSE_STATUS_META,
  formatInZone, salesService, toZonedLocalInput,
  type ActivityType, type LeadActivity, type LeadReminder, type ReminderChannel, type ResponseStatus,
} from '../../../services/salesService';

const ACCENT = '#2563EB';

export function StatusChip({ status }: { status: ResponseStatus | null | undefined }) {
  if (!status) return null;
  const meta = RESPONSE_STATUS_META[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export function ReminderCard({
  reminder, highlight, timezone, onChange,
}: {
  reminder: LeadReminder;
  highlight?: boolean;
  timezone: string;
  onChange: (next: LeadReminder | null) => void;
}) {
  const tz = reminder.due_tz || timezone;
  const [editing, setEditing] = useState(false);
  const [due, setDue] = useState(() => toZonedLocalInput(reminder.scheduled_for, tz));
  const [channel, setChannel] = useState<ReminderChannel>(reminder.channel ?? 'call');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overdue = new Date(reminder.scheduled_for).getTime() < Date.now();

  const run = async (fn: () => Promise<LeadReminder | null>) => {
    setBusy(true);
    setError(null);
    try { onChange(await fn()); setEditing(false); }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <div className={`rounded-xl border p-3 text-sm ${highlight ? 'border-blue-300 bg-blue-50' : overdue ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-2">
        <AlarmClock size={15} className={`mt-0.5 shrink-0 ${overdue ? 'text-rose-500' : 'text-blue-600'}`} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">
            {highlight ? 'Reminder set: ' : ''}{CHANNEL_LABELS[reminder.channel ?? 'other']} · {formatInZone(reminder.scheduled_for, tz)}
            <span className="ml-1 text-xs font-normal text-slate-400">({tz})</span>
          </p>
          {reminder.reason && <p className="mt-0.5 text-xs text-slate-600">{reminder.reason}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {reminder.requested_by === 'agent' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                <Sparkles size={11} /> Set by AI from your note
              </span>
            )}
            {reminder.needs_confirmation && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Please confirm the time</span>
            )}
            {overdue && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Overdue</span>}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
          <select value={channel} onChange={(e) => setChannel(e.target.value as ReminderChannel)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
            {REMINDER_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
          </select>
          <button type="button" disabled={busy || !due}
            onClick={() => void run(() => salesService.rescheduleReminder(reminder.id, { due_local: due.slice(0, 16), due_tz: tz, channel }))}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
          {reminder.needs_confirmation && (
            <button type="button" disabled={busy} onClick={() => void run(() => salesService.confirmReminder(reminder.id))}
              className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Check size={12} /> Confirm</button>
          )}
          <button type="button" disabled={busy} onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-slate-600 hover:underline"><Pencil size={12} /> Change time</button>
          <button type="button" disabled={busy}
            onClick={() => void run(async () => { await salesService.cancelReminder(reminder.id); return null; })}
            className="inline-flex items-center gap-1 text-rose-600 hover:underline"><X size={12} /> Remove</button>
          {busy && <Loader2 size={12} className="animate-spin text-slate-400" />}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/**
 * Activity log for one lead: quick-log form, the reminders the AI (or the
 * salesperson) scheduled, and the history of follow-up rounds.
 */
export default function ActivityTimeline({ contactId, onChanged }: { contactId: string; onChanged?: () => void }) {
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [reminders, setReminders] = useState<LeadReminder[]>([]);
  const [timezone, setTimezone] = useState('Africa/Accra');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<ActivityType>('call');
  const [status, setStatus] = useState<ResponseStatus | null>(null);
  const [note, setNote] = useState('');
  const [round, setRound] = useState<number | ''>('');
  const [scheduleManually, setScheduleManually] = useState(false);
  const [manualDue, setManualDue] = useState('');
  const [manualChannel, setManualChannel] = useState<ReminderChannel>('call');
  const [completeDue, setCompleteDue] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSet, setJustSet] = useState<LeadReminder | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await salesService.getLeadActivity(contactId);
      setActivities(data.activities);
      setReminders(data.followups);
      setTimezone(data.timezone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    setLoading(true);
    // Make sure the server knows this user's timezone before the AI reads dates.
    void salesService.ensureReminderTimezone().then(load);
  }, [load]);
  useEffect(() => () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); }, []);

  const nextRound = useMemo(
    () => activities.reduce((max, a) => Math.max(max, a.follow_up_round ?? 0), 0) + 1,
    [activities],
  );
  const open = reminders.filter((r) => r.status === 'scheduled');
  const dueNow = open.find((r) => new Date(r.scheduled_for).getTime() <= Date.now() + 12 * 3600_000);

  const save = async () => {
    if (!note.trim() && !status) return;
    if (scheduleManually && !manualDue) return;
    setSaving(true);
    setError(null);
    setJustSet(null);
    setAiNotice(null);
    try {
      const result = await salesService.logActivity(contactId, {
        type,
        body: note.trim() || null,
        follow_up_round: round === '' ? nextRound : round,
        response_status: status,
        manual_followup: scheduleManually ? { due_local: manualDue.slice(0, 16), due_tz: timezone, channel: manualChannel } : null,
        completes_followup_id: dueNow && completeDue ? dueNow.id : null,
      });
      setNote('');
      setStatus(null);
      setRound('');
      setScheduleManually(false);
      setManualDue('');
      if (result.reminder) setJustSet(result.reminder);
      else if (result.ai === 'pending') {
        setAiNotice('The AI is still reading this note — any reminder will appear here shortly.');
        pollTimer.current = window.setTimeout(() => { setAiNotice(null); void load(); }, 20_000);
      } else if (result.ai === 'done') {
        setAiNotice('No follow-up date found in this note.');
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this activity? A reminder it created that has not fired yet is removed too.')) return;
    try {
      await salesService.deleteActivity(id);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const onReminderChange = (id: string) => (next: LeadReminder | null) => {
    if (justSet?.id === id) setJustSet(next && next.status === 'scheduled' ? next : null);
    void load();
    onChanged?.();
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Activity &amp; follow-ups</h3>
        <span className="text-xs text-slate-400">Times in {timezone}</span>
      </div>

      {open.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming</p>
          {open.filter((r) => r.id !== justSet?.id).map((r) => (
            <ReminderCard key={r.id} reminder={r} timezone={timezone} onChange={onReminderChange(r.id)} />
          ))}
        </div>
      )}

      {/* Quick log */}
      <div className="space-y-3 rounded-xl bg-slate-50 p-3">
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${type === t ? 'text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
              style={type === t ? { background: ACCENT } : undefined}>
              {ACTIVITY_LABELS[t]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
            Round
            <input type="number" min={1} max={50} value={round === '' ? nextRound : round}
              onChange={(e) => setRound(e.target.value ? Number(e.target.value) : '')}
              className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {RESPONSE_STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(status === s ? null : s)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${status === s ? RESPONSE_STATUS_META[s].className : 'bg-white text-slate-500 ring-slate-200'}`}>
              {RESPONSE_STATUS_META[s].label}
            </button>
          ))}
        </div>

        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder='What happened? e.g. "Shared details on WhatsApp, will call back Friday 3pm"'
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={scheduleManually} onChange={(e) => setScheduleManually(e.target.checked)} />
            Set follow-up myself
          </label>
          {scheduleManually && (
            <>
              <input type="datetime-local" value={manualDue} onChange={(e) => setManualDue(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1" />
              <select value={manualChannel} onChange={(e) => setManualChannel(e.target.value as ReminderChannel)}
                className="rounded-lg border border-slate-200 px-2 py-1">
                {REMINDER_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </>
          )}
          {!scheduleManually && (
            <span className="inline-flex items-center gap-1 text-slate-400"><Bot size={12} /> AI sets a reminder if the note mentions a date</span>
          )}
          {dueNow && (
            <label className="flex items-center gap-1.5 text-slate-600">
              <input type="checkbox" checked={completeDue} onChange={(e) => setCompleteDue(e.target.checked)} />
              Completes the follow-up due {formatInZone(dueNow.scheduled_for, dueNow.due_tz || timezone)}
            </label>
          )}
          <button type="button" onClick={() => void save()} disabled={saving || (!note.trim() && !status) || (scheduleManually && !manualDue)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {saving ? 'Saving…' : 'Log activity'}
          </button>
        </div>
      </div>

      {justSet && (
        <div className="mt-3">
          <ReminderCard reminder={justSet} highlight timezone={timezone} onChange={onReminderChange(justSet.id)} />
        </div>
      )}
      {aiNotice && <p className="mt-2 text-xs text-slate-500">{aiNotice}</p>}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

      {/* History */}
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">History</p>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        {!loading && activities.length === 0 && <p className="text-sm text-slate-400">No activity logged yet.</p>}
        <ul className="space-y-2">
          {activities.map((a) => (
            <li key={a.id} className="group rounded-xl border border-slate-100 p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                {a.follow_up_round && <span className="rounded bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">Round {a.follow_up_round}</span>}
                <StatusChip status={a.response_status} />
                {a.ai_status === 'pending' || a.ai_status === 'processing'
                  ? <span className="inline-flex items-center gap-1 text-[11px] text-violet-500"><Loader2 size={10} className="animate-spin" /> AI reading</span>
                  : null}
                <span className="ml-auto text-xs text-slate-400">{formatInZone(a.completed_at ?? a.created_at, timezone)}</span>
                <button type="button" onClick={() => void remove(a.id)} title="Delete"
                  className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-500">
                  <Trash2 size={13} />
                </button>
              </div>
              {a.body && <p className="mt-1 whitespace-pre-wrap text-slate-600">{a.body}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
