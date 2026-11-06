import { CheckCircle, Compass, PlayCircle, RotateCcw } from 'lucide-react';
import { startTour } from './tourCore';
import { useTourState } from './tourStore';
import { MARKETING_SETUP_ORDER, MARKETING_TOURS } from './marketingTours';

/**
 * "Set up Marketing": the tools in the order to set them up, each with its
 * one-minute tour and whether it has been taken.
 */
export default function MarketingTourHub({ userId }: { userId?: string | null } = {}) {
  const progress = useTourState(userId);
  const taken = MARKETING_SETUP_ORDER.filter((s) => progress.tours[s.tour]?.status === 'done').length;
  const overviewDone = progress.tours['marketing-overview']?.status === 'done';

  return (
    <section data-tour="mk-tours" className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Compass size={15} className="text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-900">Set up Marketing, one tool at a time</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Each tool has a one-minute guided tour on its own page. {taken > 0 ? `${taken} of ${MARKETING_SETUP_ORDER.length} taken.` : 'Start with Contacts.'}</p>
        </div>
        <button
          type="button"
          onClick={() => startTour('marketing-overview')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
        >
          {overviewDone ? <RotateCcw size={12} /> : <PlayCircle size={12} />} {overviewDone ? 'Replay the Marketing tour' : 'Tour this page'}
        </button>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETING_SETUP_ORDER.map((s, i) => {
          const t = MARKETING_TOURS[s.tour];
          const done = progress.tours[s.tour]?.status === 'done';
          return (
            <li key={s.tour}>
              <button
                type="button"
                onClick={() => startTour(s.tour)}
                className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                  {done ? <CheckCircle size={14} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900">{t.title}</span>
                  <span className="block text-xs text-slate-500">{s.why}</span>
                  <span className="mt-1 block text-[11px] font-semibold text-indigo-600">{done ? 'Taken · replay' : `${t.minutes}-minute tour →`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
