import type { PreviewAction } from './platformRules';

type SuggestionAction = {
  action: PreviewAction;
  label: string;
};

interface SuggestionsPanelProps {
  suggestions: string[];
  actions?: SuggestionAction[];
  onApplySuggestion?: (action: PreviewAction) => void;
}

const SuggestionsPanel = ({ suggestions, actions = [], onApplySuggestion }: SuggestionsPanelProps) => {
  return (
    <div className="space-y-3">
      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((suggestion) => (
            <div key={suggestion} className="text-xs text-slate-600">
              {suggestion}
            </div>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => onApplySuggestion?.(item.action)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SuggestionsPanel;
