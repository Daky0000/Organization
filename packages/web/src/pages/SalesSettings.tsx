import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, Check, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  OBJECTION_LABELS, salesService,
  type SalesCallPolicy, type SalesLead, type SalesPlaybook,
} from '../services/salesService';
import VapiTestConsole from '../components/sales/VapiTestConsole';

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
  const [playbooks, setPlaybooks] = useState<SalesPlaybook[]>([]);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ objection_code: 'price', title: '', content: '' });

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, books, leadPage] = await Promise.all([
        salesService.getPolicy(),
        salesService.listPlaybooks(),
        // Only for the test console's "prefill from a real lead" picker.
        salesService.listLeads({ limit: 50 }).catch(() => ({ leads: [], total: 0 })),
      ]);
      setPolicy(p);
      setPlaybooks(books);
      setLeads(leadPage.leads);
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

  const addPlaybook = async () => {
    if (!draft.content.trim()) return;
    try {
      await salesService.createPlaybook(draft);
      setDraft({ objection_code: 'price', title: '', content: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the response');
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

          {policy.aiDisclosureRequired && (
            <Field label="Disclosure wording" hint="Leave blank for the default.">
              <input
                value={policy.aiDisclosureText ?? ''}
                onChange={(e) => set('aiDisclosureText', e.target.value || null)}
                placeholder="Hi, this is an AI assistant calling on behalf of …"
                className={inputClass}
              />
            </Field>
          )}

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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Voice provider</h2>
        <p className="mt-1 text-xs text-slate-500">
          The simulator runs the whole loop without dialing or spending anything — use it to check the flow first.
          Vapi credentials are configured by an admin under Integrations.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Provider">
            <select value={policy.provider} onChange={(e) => set('provider', e.target.value)} className={inputClass}>
              <option value="simulator">Simulator (no real calls)</option>
              <option value="vapi">Vapi</option>
            </select>
          </Field>
          <Field label="Caller ID"><input value={policy.fromNumber ?? ''} onChange={(e) => set('fromNumber', e.target.value || null)} placeholder="+233…" className={inputClass} /></Field>
          <Field label="Voice ID" hint="ElevenLabs voice.">
            <input value={policy.voiceId ?? ''} onChange={(e) => set('voiceId', e.target.value || null)} className={inputClass} />
          </Field>
          <Field label="Max call length (sec)">
            <input type="number" min={60} value={policy.maxCallDurationSec} onChange={(e) => set('maxCallDurationSec', Number(e.target.value))} className={inputClass} />
          </Field>
        </div>
        {policy.provider === 'vapi' && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Vapi bills per minute on top of the AI credits used to analyse each transcript. Telephony minutes are not
            metered by the credit system, so watch your Vapi dashboard directly.
          </p>
        )}
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

      <VapiTestConsole leads={leads} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <BookOpen size={16} className="text-slate-400" /> Objection playbook
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          How to answer each objection. These are injected into the call brief when the lead has that objection open.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-[160px_1fr_auto]">
          <select
            value={draft.objection_code}
            onChange={(e) => setDraft({ ...draft, objection_code: e.target.value })}
            className={inputClass}
          >
            {Object.entries(OBJECTION_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <input
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="What the caller should say…"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void addPlaybook()}
            disabled={!draft.content.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {playbooks.length === 0 && <li className="text-sm text-slate-400">No responses yet.</li>}
          {playbooks.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">
                  {p.objection_code ? (OBJECTION_LABELS[p.objection_code] ?? p.objection_code) : p.kind.replace(/_/g, ' ')}
                  {p.source !== 'human' && (
                    <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                      AI proposed
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-slate-600">{p.content}</p>
              </div>
              <button
                type="button"
                onClick={() => void salesService.deletePlaybook(p.id).then(load)}
                className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
