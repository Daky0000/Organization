import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, Check, Loader2 } from 'lucide-react';
import { browserTimezone, salesService } from '../../../services/salesService';

function allTimezones(current: string | null): string[] {
  let zones: string[] = [];
  try { zones = (Intl as any).supportedValuesOf?.('timeZone') ?? []; } catch { /* old browser */ }
  if (!zones.length) zones = ['Africa/Accra', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London', 'America/New_York', 'UTC'];
  const extra = [current, browserTimezone()].filter((z): z is string => !!z && !zones.includes(z));
  return [...extra, ...zones];
}

/** Timezone used to read dates in notes, and the daily 07:00 reminder email. */
export default function ReminderSettingsCard() {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [digest, setDigest] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await salesService.getReminderSettings();
        setTimezone(s.timezone ?? browserTimezone());
        setDigest(s.lead_digest_enabled);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reminder settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const zones = useMemo(() => allTimezones(timezone), [timezone]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await salesService.updateReminderSettings({ timezone, lead_digest_enabled: digest });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <AlarmClock size={16} className="text-slate-400" /> Follow-up reminders
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        When you log an activity, the AI reads your note and schedules a reminder for dates like "call back Friday 3pm".
        Dates are read in this timezone unless the lead has their own.
      </p>
      {loading ? (
        <Loader2 size={16} className="mt-3 animate-spin text-slate-400" />
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Your timezone</span>
            <select value={timezone ?? ''} onChange={(e) => setTimezone(e.target.value || null)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} />
            Email me a daily summary at 07:00 of due and overdue follow-ups
          </label>
          <button type="button" onClick={() => void save()} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </section>
  );
}
