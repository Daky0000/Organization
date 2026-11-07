import { useState } from 'react';
import { Loader2, PhoneCall, X } from 'lucide-react';
import {
  CALL_TYPES, CALL_TYPE_HINTS, CALL_TYPE_LABELS, salesService, type CallType,
} from '../../../services/salesService';

/**
 * Starts AI calls. For one lead, the click is the approval and the call goes
 * straight to the dial queue (still inside your call hours and caps). For
 * several leads, each call is prepared and waits in the approval queue.
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
  const [callType, setCallType] = useState<CallType>('follow_up');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = contactIds.length === 1;

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
        onDone(r.decision.action === 'reschedule'
          ? `Call queued for the next allowed time: ${new Date(r.decision.runAt).toLocaleString()}.`
          : 'Call queued. The AI will dial shortly.');
      } else {
        const r = await salesService.queueCallsBulk(contactIds, { callType, note: note.trim() || undefined });
        const skipped = r.blocked.length ? ` ${r.blocked.length} could not be called (no phone, do-not-call, or limits).` : '';
        onDone(r.awaitingApproval
          ? `${r.prepared} call${r.prepared === 1 ? '' : 's'} waiting for your approval.${skipped}`
          : `${r.prepared} call${r.prepared === 1 ? '' : 's'} queued.${skipped}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the call');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="ai-call-title" onClick={onClose}>
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ai-call-title" className="text-lg font-bold text-slate-900">
              {single ? `AI call${leadName ? ` to ${leadName}` : ''}` : `AI calls to ${contactIds.length} leads`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {single
                ? 'The AI dials within your call hours. It uses this lead\'s sheet row, activity, company and your business details.'
                : 'Each call is prepared and waits in "Calls to approve" until you approve it.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <fieldset className="grid gap-1.5 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold text-slate-500">Type of call</legend>
          {CALL_TYPES.map((t) => (
            <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${callType === t ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>
              <input type="radio" name="call-type" checked={callType === t} onChange={() => setCallType(t)} />
              {CALL_TYPE_LABELS[t]}
            </label>
          ))}
        </fieldset>

        <label className="block text-xs font-semibold text-slate-500">
          Notes for the AI (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder={CALL_TYPE_HINTS[callType]}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
        </label>

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="button" onClick={() => void go()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />}
            {single ? 'Call now' : 'Prepare calls'}
          </button>
        </div>
      </div>
    </div>
  );
}
