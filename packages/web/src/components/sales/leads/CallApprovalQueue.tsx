import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { CALL_TYPE_LABELS, salesService, type CallApproval } from '../../../services/salesService';

const name = (c: CallApproval) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone || 'Unknown lead';

/**
 * Calls waiting for a person's OK: calls prepared in bulk and follow-up calls
 * the AI booked. Nothing here dials until it is approved, and an approved call
 * still dials only inside the call hours and limits.
 */
export default function CallApprovalQueue({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [calls, setCalls] = useState<CallApproval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<Record<string, string | 'loading'>>({});

  const load = useCallback(async () => {
    try { setError(null); setCalls(await salesService.listCallApprovals()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load calls'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (kind: 'approve' | 'decline', ids: string[]) => {
    if (!ids.length) return;
    setBusy(ids.length === 1 ? ids[0] : 'all');
    try {
      if (kind === 'approve') await salesService.approveCalls(ids);
      else await salesService.declineCalls(ids);
      setCalls((c) => (c ?? []).filter((x) => !ids.includes(x.id)));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update calls');
    } finally {
      setBusy(null);
    }
  };

  const toggleBrief = async (id: string) => {
    if (briefs[id]) { setBriefs(({ [id]: _, ...rest }) => rest); return; }
    setBriefs((b) => ({ ...b, [id]: 'loading' }));
    try {
      const brief = await salesService.getCallBrief(id);
      setBriefs((b) => ({ ...b, [id]: brief.systemPrompt }));
    } catch (err) {
      setBriefs((b) => ({ ...b, [id]: err instanceof Error ? err.message : 'Could not load the brief' }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="approvals-title" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div>
            <h2 id="approvals-title" className="text-base font-bold text-slate-900">Calls to approve</h2>
            <p className="text-xs text-slate-500">Approved calls dial within your call hours and daily limit.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {!calls && !error && <Loader2 size={18} className="mx-auto animate-spin text-slate-400" />}
          {calls?.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nothing waiting for approval.</p>}
          {calls?.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{name(c)} <span className="font-normal text-slate-400">{c.phone}</span></p>
                  <p className="text-xs text-slate-500">
                    {c.call_type ? CALL_TYPE_LABELS[c.call_type] : 'Call'}
                    {c.followup_id && ' · booked by the AI on an earlier call'}
                    {c.lists.length > 0 && ` · ${c.lists.join(', ')}`}
                  </p>
                  {(c.call_note || c.objective) && <p className="mt-1 text-sm text-slate-700">{c.call_note || c.objective}</p>}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => void act('decline', [c.id])} disabled={busy !== null}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-600">
                    <X size={12} /> Skip
                  </button>
                  <button type="button" onClick={() => void act('approve', [c.id])} disabled={busy !== null}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
                    {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                  </button>
                </div>
              </div>
              <button type="button" onClick={() => void toggleBrief(c.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
                {briefs[c.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />} What the AI will be told
              </button>
              {briefs[c.id] && (
                <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                  {briefs[c.id] === 'loading' ? 'Loading…' : briefs[c.id]}
                </pre>
              )}
            </div>
          ))}
        </div>

        {calls && calls.length > 1 && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={() => void act('decline', calls.map((c) => c.id))} disabled={busy !== null}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Skip all</button>
            <button type="button" onClick={() => void act('approve', calls.map((c) => c.id))} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve all {calls.length}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
