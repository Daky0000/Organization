import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw, Sparkles } from 'lucide-react';
import {
  OBJECTION_LABELS, formatDuration, leadName, salesService,
  type SalesConversation, type SalesObjection,
} from '../services/salesService';

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  negative: 'bg-rose-100 text-rose-700',
};

export default function SalesConversations() {
  const [conversations, setConversations] = useState<SalesConversation[]>([]);
  const [selected, setSelected] = useState<SalesConversation | null>(null);
  const [objections, setObjections] = useState<SalesObjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setConversations(await salesService.listConversations({ limit: 100 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = async (conversation: SalesConversation) => {
    setSelected(conversation);
    setShowTranscript(false);
    try {
      const detail = await salesService.getConversation(conversation.id);
      setSelected(detail.conversation);
      setObjections(detail.objections);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    }
  };

  const reanalyze = async (id: string) => {
    try {
      await salesService.reanalyze(id);
      setTimeout(() => void load(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-run the analysis');
    }
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Conversations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every call, with what the analyst extracted from it.
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
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading && <p className="p-6 text-sm text-slate-400">Loading…</p>}
          {!loading && conversations.length === 0 && (
            <div className="p-8 text-center">
              <FileText className="mx-auto mb-2 text-slate-300" size={24} />
              <p className="text-sm text-slate-500">
                No conversations yet. Log a call from a lead's page to get started.
              </p>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void open(c)}
                  className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selected?.id === c.id ? 'bg-indigo-50/60' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{leadName(c)}</span>
                    {c.sentiment && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${SENTIMENT_STYLES[c.sentiment]}`}>
                        {c.sentiment}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {new Date(c.started_at).toLocaleString()} · {formatDuration(c.duration_sec)}
                  </p>
                  {c.analysis_status !== 'done' && (
                    <p className="mt-1 text-xs font-medium text-amber-600">
                      {c.analysis_status === 'failed' ? 'Analysis failed' : 'Analysing…'}
                    </p>
                  )}
                  {c.summary && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{c.summary}</p>}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {!selected && <p className="py-16 text-center text-sm text-slate-400">Select a conversation.</p>}
          {selected && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black tracking-tight text-slate-950">{leadName(selected)}</h2>
                  <p className="text-sm text-slate-500">
                    {new Date(selected.started_at).toLocaleString()} · {formatDuration(selected.duration_sec)} ·{' '}
                    {selected.created_by === 'human' ? 'logged by hand' : 'AI call'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void reanalyze(selected.id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Sparkles size={13} /> Re-analyse
                </button>
              </div>

              {selected.analysis_status === 'failed' && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Analysis failed{selected.analysis_error ? `: ${selected.analysis_error}` : ''}.
                </div>
              )}

              {selected.summary && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Summary</h3>
                  <p className="mt-1 text-sm text-slate-700">{selected.summary}</p>
                  {selected.analyst_confidence != null && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      Analyst confidence {Math.round(selected.analyst_confidence * 100)}% — check the transcript
                      before acting on anything surprising.
                    </p>
                  )}
                </section>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Read as</h3>
                  <p className="mt-1 text-sm capitalize text-slate-700">
                    {selected.intent?.replace(/_/g, ' ') || '—'}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Recommended</h3>
                  <p className="mt-1 text-sm capitalize text-slate-700">
                    {selected.recommended_action?.replace(/_/g, ' ') || '—'}
                  </p>
                </div>
              </div>

              {objections.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Objections</h3>
                  <ul className="mt-2 space-y-2">
                    {objections.map((o) => (
                      <li key={o.id} className="rounded-xl bg-slate-50 p-2.5">
                        <p className="text-xs font-bold text-slate-800">
                          {OBJECTION_LABELS[o.objection_code] ?? o.objection_code}
                        </p>
                        {o.raw_text && <p className="mt-0.5 text-xs italic text-slate-500">"{o.raw_text}"</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {([
                ['They committed to', selected.commitments],
                ['We promised', selected.promises],
                ['Open questions', selected.questions],
                ['Buying signals', selected.buying_signals],
              ] as const).map(([label, items]) =>
                items && items.length ? (
                  <section key={label}>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</h3>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                      {items.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </section>
                ) : null,
              )}

              {selected.recording_url && (
                <audio controls src={selected.recording_url} className="w-full">
                  <track kind="captions" />
                </audio>
              )}

              {selected.transcript && (
                <section>
                  <button
                    type="button"
                    onClick={() => setShowTranscript((v) => !v)}
                    className="text-xs font-bold uppercase tracking-wide text-slate-400 hover:text-slate-700"
                  >
                    {showTranscript ? 'Hide' : 'Show'} transcript
                  </button>
                  {showTranscript && (
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                      {selected.transcript}
                    </pre>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
