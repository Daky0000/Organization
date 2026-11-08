import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PhoneCall, Sparkles, X } from 'lucide-react';
import {
  CALL_TYPES, CALL_TYPE_HINTS, CALL_TYPE_LABELS, salesService,
  type CallPlan, type CallTypeChoice,
} from '../../../services/salesService';

/**
 * Starts AI calls. For one lead, the click is the approval and the call goes
 * straight to the dial queue (still inside your call hours and caps). For
 * several leads, each call is prepared and waits in the approval queue.
 *
 * "Let the AI decide" plans each call from the reason and the lead's own data:
 * what it is for (sales, follow-up, reminder, notice) and which number to dial
 * (country, mobile or landline, which column it came from).
 */
export default function AiCallDialog({
  contactIds, leadName, onClose, onDone,
}: {
  contactIds: string[];
  /** Shown for a single lead. */
  leadName?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [callType, setCallType] = useState<CallTypeChoice>('auto');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CallPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const single = contactIds.length === 1;

  // One lead: show the plan as the reason is typed.
  useEffect(() => {
    if (!single) return;
    let cancelled = false;
    setPlanning(true);
    const t = setTimeout(() => {
      salesService.planCall(contactIds[0], { callType, note: note.trim() || undefined })
        .then((p) => { if (!cancelled) setPlan(p); })
        .catch(() => { if (!cancelled) setPlan(null); })
        .finally(() => { if (!cancelled) setPlanning(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the lead id, not the array identity
  }, [single, contactIds[0], callType, note]);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (single) {
        const r = await salesService.queueCall(contactIds[0], undefined, { callType, note: note.trim() || undefined });
        if (!r.queued) {
          setError(r.decision.action === 'stop' ? `Not called: ${r.decision.reason}` : 'This call could not be queued.');
          return;
        }
        const what = r.purpose ? `${CALL_TYPE_LABELS[r.purpose.callType]} ` : '';
        onDone(r.decision.action === 'reschedule'
          ? `${what}queued for the next allowed time: ${new Date(r.decision.runAt).toLocaleString()}.`
          : `${what}queued. The AI will dial shortly.`);
      } else {
        const r = await salesService.queueCallsBulk(contactIds, { callType, note: note.trim() || undefined });
        const skipped = r.blocked.length ? ` ${r.blocked.length} could not be called (no valid number, do-not-call, or limits).` : '';
        const mix = callType === 'auto' && r.purposes && Object.keys(r.purposes).length
          ? ` Detected: ${Object.entries(r.purposes).map(([t, n]) => `${n} ${CALL_TYPE_LABELS[t as keyof typeof CALL_TYPE_LABELS]?.toLowerCase() ?? t}`).join(', ')}.`
          : '';
        onDone(r.awaitingApproval
          ? `${r.prepared} call${r.prepared === 1 ? '' : 's'} waiting for your approval.${mix}${skipped}`
          : `${r.prepared} call${r.prepared === 1 ? '' : 's'} queued.${mix}${skipped}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the call');
    } finally {
      setBusy(false);
    }
  };

  const blocked = single && plan?.decision.action === 'stop';
  const hint = callType === 'auto'
    ? 'Say why you are calling, e.g. "Remind him the GHS 500 balance is due Friday" or "Tell them Saturday\'s class moves to Sunday 10am". The AI works out the kind of call.'
    : CALL_TYPE_HINTS[callType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="ai-call-title" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ai-call-title" className="text-lg font-bold text-slate-900">
              {single ? `AI call${leadName ? ` to ${leadName}` : ''}` : `AI calls to ${contactIds.length} leads`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {single
                ? 'The AI dials within your call hours. It uses this lead\'s sheet row, activity, company and your business details.'
                : 'Each call is planned for its own lead, then waits in "Calls to approve" until you approve it.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <label className="block text-xs font-semibold text-slate-500">
          Reason for the call {callType === 'auto' ? '(the AI reads it to decide the kind of call)' : '(optional)'}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder={hint}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
        </label>

        <fieldset className="grid gap-1.5 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold text-slate-500">Type of call</legend>
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm sm:col-span-2 ${callType === 'auto' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>
            <input type="radio" name="call-type" checked={callType === 'auto'} onChange={() => setCallType('auto')} />
            <Sparkles size={14} /> Let the AI decide (recommended)
          </label>
          {CALL_TYPES.map((t) => (
            <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${callType === t ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>
              <input type="radio" name="call-type" checked={callType === t} onChange={() => setCallType(t)} />
              {CALL_TYPE_LABELS[t]}
            </label>
          ))}
        </fieldset>

        {single && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" aria-live="polite">
            <p className="flex items-center gap-1.5 font-semibold text-slate-700">
              Call plan {planning && <Loader2 size={12} className="animate-spin text-slate-400" />}
            </p>
            {plan ? (
              <ul className="mt-1.5 space-y-1 text-slate-600">
                <li>
                  <span className="font-semibold text-slate-800">{CALL_TYPE_LABELS[plan.purpose.callType]}</span>
                  {plan.purpose.autoDetected && <span> — {plan.purpose.reason}</span>}
                </li>
                <li className="flex items-start gap-1.5">
                  {plan.number.callable
                    ? <CheckCircle2 size={13} className="mt-px shrink-0 text-emerald-600" />
                    : <AlertTriangle size={13} className="mt-px shrink-0 text-rose-600" />}
                  <span>
                    {plan.number.phone
                      ? <>Dials <span className="font-mono font-semibold text-slate-800">{plan.number.phone.e164}</span> · {plan.number.phone.countryName ?? plan.number.phone.country} · {plan.number.typeLabel}{plan.number.source && plan.number.source !== 'Phone' ? ` · from "${plan.number.source}"` : ''}</>
                      : 'No number that can be called.'}
                    {plan.number.warning && <span className={plan.number.callable ? 'text-amber-700' : 'text-rose-700'}> {plan.number.warning}</span>}
                  </span>
                </li>
                {plan.decision.action === 'reschedule' && (
                  <li className="text-amber-700">Outside call hours — it will dial at {new Date(plan.decision.runAt).toLocaleString()}.</li>
                )}
                {plan.decision.action === 'stop' && (
                  <li className="text-rose-700">Will not be called: {plan.decision.reason}</li>
                )}
              </ul>
            ) : !planning && <p className="mt-1 text-slate-500">Could not plan this call.</p>}
          </div>
        )}

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="button" onClick={() => void go()} disabled={busy || blocked}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />}
            {single ? 'Call now' : 'Prepare calls'}
          </button>
        </div>
      </div>
    </div>
  );
}
