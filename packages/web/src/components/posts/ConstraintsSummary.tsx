import type { PreviewConstraints, PreviewAction } from './platformRules';
import SuggestionsPanel from './SuggestionsPanel';

interface ConstraintsSummaryProps {
  constraints: PreviewConstraints;
  linkLoading?: boolean;
  linkError?: string | null;
  onApplySuggestion?: (action: PreviewAction) => void;
}

const warningStyles: Record<PreviewConstraints['warnings'][number]['type'], string> = {
  error: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
};

const warningIcons: Record<PreviewConstraints['warnings'][number]['type'], string> = {
  error: 'ERROR',
  warning: 'WARN',
  info: 'INFO',
};

const actionLabels: Record<PreviewAction, string> = {
  trim: 'Trim to limit',
  remove_excess_hashtags: 'Remove excess hashtags',
  add_line_break: 'Add line break',
};

const ConstraintsSummary = ({ constraints, linkLoading, linkError, onApplySuggestion }: ConstraintsSummaryProps) => {
  const actions = constraints.warnings
    .filter((warning) => warning.action)
    .map((warning) => ({
      action: warning.action as PreviewAction,
      label: actionLabels[warning.action as PreviewAction],
    }));

  const linkStatus = constraints.hasLink
    ? linkLoading
      ? 'Fetching link preview...'
      : linkError
        ? 'Unable to fetch link preview.'
        : 'Link preview ready'
    : 'No link detected';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-live="polite">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Constraints &amp; Suggestions</div>

      <div className="mt-4 space-y-2 text-xs text-slate-600">
        <div className="flex items-center justify-between">
          <span>Characters</span>
          <span className="font-semibold text-slate-800">
            {constraints.charCount} / {constraints.charLimit}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Hashtags</span>
          <span className="font-semibold text-slate-800">
            {constraints.hashtags.length} (ideal {constraints.idealHashtagRange[0]}-{constraints.idealHashtagRange[1]})
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>First line</span>
          <span className="font-semibold text-slate-800">{constraints.firstLineLength} chars</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Emoji count</span>
          <span className="font-semibold text-slate-800">{constraints.emojiCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Link preview</span>
          <span className="font-semibold text-slate-800">{linkStatus}</span>
        </div>
      </div>

      {constraints.toneNotes && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          {constraints.toneNotes}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {constraints.warnings.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700" role="status">
            All checks passed for this platform.
          </div>
        ) : (
          constraints.warnings.map((warning, idx) => (
            <div key={`${warning.type}-${idx}`} className={`rounded-xl border px-3 py-2 text-xs ${warningStyles[warning.type]}`}>
              <div className="flex items-start gap-2">
                <span>{warningIcons[warning.type]}</span>
                <span>{warning.message}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4">
        <SuggestionsPanel suggestions={constraints.suggestions} actions={actions} onApplySuggestion={onApplySuggestion} />
      </div>
    </div>
  );
};

export default ConstraintsSummary;
