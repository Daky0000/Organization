import { useCallback, useEffect, useState } from 'react';
import { Loader2, PhoneCall } from 'lucide-react';
import { CALL_TYPE_LABELS, salesService, type SalesCallAttempt } from '../../../services/salesService';

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: 'Waiting for approval',
  queued: 'Queued',
  dialing: 'Dialling',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  blocked: 'Not called',
  failed: 'Failed',
};

/** AI calls for one lead: status, outcome, the AI's summary, recording and transcript. */
export default function LeadCalls({ contactId, refreshKey }: { contactId: string; refreshKey: number }) {
  const [calls, setCalls] = useState<SalesCallAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setError(null); setCalls(await salesService.listLeadCalls(contactId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load calls'); }
  }, [contactId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!calls) return <Loader2 size={16} className="animate-spin text-slate-400" />;
  if (!calls.length) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800"><PhoneCall size={14} /> AI calls</h3>
      <ul className="space-y-3">
        {calls.map((c) => (
          <li key={c.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700">
                {c.call_type ? CALL_TYPE_LABELS[c.call_type] : 'Call'} · {STATUS_LABEL[c.status] ?? c.status}
                {c.outcome && c.status === 'completed' && ` · ${c.outcome.replace(/_/g, ' ')}`}
              </span>
              <span className="text-slate-400">
                {new Date(c.started_at || c.run_at).toLocaleString()}
                {c.duration_sec ? ` · ${Math.max(1, Math.round(c.duration_sec / 60))} min` : ''}
              </span>
            </div>
            {c.status === 'blocked' && c.block_reason && <p className="mt-1 text-xs text-slate-500">{c.block_reason}</p>}
            {c.status === 'failed' && c.last_error && <p className="mt-1 text-xs text-rose-600">{c.last_error}</p>}
            {c.call_note && <p className="mt-1 text-xs text-slate-500">Notes: {c.call_note}</p>}
            {c.summary && <p className="mt-1 text-sm text-slate-700">{c.summary}</p>}
            {c.recording_url && (
              <audio controls preload="none" src={c.recording_url} className="mt-2 h-8 w-full">
                <a href={c.recording_url}>Recording</a>
              </audio>
            )}
            {c.transcript && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-blue-600">Transcript</summary>
                <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">{c.transcript}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
