import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { salesService, type SalesCallPolicy } from '../services/salesService';
import ReminderSettingsCard from '../components/sales/leads/ReminderSettingsCard';

const ACCENT = '#2563EB';
const DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 7, label: 'Sun' },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none';

export default function SalesSettings() {
  const [policy, setPolicy] = useState<SalesCallPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setPolicy(await salesService.getPolicy());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      setError(null);
      setPolicy(await salesService.updatePolicy(policy));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the calling policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !policy) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const set = <K extends keyof SalesCallPolicy>(key: K, value: SalesCallPolicy[K]) =>
    setPolicy({ ...policy, [key]: value });

  const toggleDay = (n: number) =>
    set('allowedDays', policy.allowedDays.includes(n)
      ? policy.allowedDays.filter((d) => d !== n)
      : [...policy.allowedDays, n].sort());

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950">Sales settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          The calling policy is enforced before every single call — no call is placed without passing it.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <ReminderSettingsCard />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <ShieldCheck size={16} className="text-slate-400" /> Compliance
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Automated outbound calling is regulated, and the rules differ by country. These defaults are deliberately
          conservative. Check what applies where you are calling before loosening them.
        </p>

        <div className="mt-4 space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="text-sm font-semibold text-slate-800">Enable automated outbound calling</span>
              <span className="block text-xs text-slate-500">
                While this is off, nothing dials. Conversations you log by hand are still analysed.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={policy.requireConsent}
              onChange={(e) => set('requireConsent', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="text-sm font-semibold text-slate-800">Require recorded consent before calling</span>
              <span className="block text-xs text-slate-500">
                Leads without a consent source on file are skipped.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={policy.aiDisclosureRequired}
              onChange={(e) => set('aiDisclosureRequired', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="text-sm font-semibold text-slate-800">Disclose that the caller is an AI</span>
              <span className="block text-xs text-slate-500">
                Added to the opening line in code, not in the prompt — so it cannot be talked away mid-call.
              </span>
            </span>
          </label>


          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={policy.recordingDisclosureRequired}
              onChange={(e) => set('recordingDisclosureRequired', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="text-sm font-semibold text-slate-800">Announce that the call is recorded</span>
              <span className="block text-xs text-slate-500">
                Required wherever all parties must consent to recording.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={policy.requireCallApproval ?? true}
              onChange={(e) => set('requireCallApproval', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="text-sm font-semibold text-slate-800">Approve each AI call before it dials</span>
              <span className="block text-xs text-slate-500">
                Calls prepared for several leads at once, and follow-up calls the AI books itself, wait in
                "Calls to approve" on the Leads page. A call you start on one lead is approved by that click.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">When calls may be placed</h2>
        <p className="mt-1 text-xs text-slate-500">Evaluated in the lead's own timezone, not yours.</p>

        <div className="mt-4 space-y-4">
          <Field label="Days">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    policy.allowedDays.includes(d.n)
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="From"><input type="time" value={policy.windowStart} onChange={(e) => set('windowStart', e.target.value)} className={inputClass} /></Field>
            <Field label="Until"><input type="time" value={policy.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} className={inputClass} /></Field>
            <Field label="Default timezone" hint="Used when a lead's own timezone is unknown.">
              <input value={policy.defaultTimezone} onChange={(e) => set('defaultTimezone', e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Max attempts / lead / week">
              <input type="number" min={1} value={policy.maxAttemptsPerLeadPerWeek} onChange={(e) => set('maxAttemptsPerLeadPerWeek', Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Give up after N no-answers">
              <input type="number" min={1} value={policy.maxConsecutiveNoAnswer} onChange={(e) => set('maxConsecutiveNoAnswer', Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Min hours between attempts">
              <input type="number" min={0} value={policy.minHoursBetweenAttempts} onChange={(e) => set('minHoursBetweenAttempts', Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label="Daily call cap">
              <input type="number" min={1} value={policy.dailyCallCap} onChange={(e) => set('dailyCallCap', Number(e.target.value))} className={inputClass} />
            </Field>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: ACCENT }}
        >
          {saving ? 'Saving…' : 'Save policy'}
        </button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check size={15} /> Saved</span>}
      </div>

    </div>
  );
}
