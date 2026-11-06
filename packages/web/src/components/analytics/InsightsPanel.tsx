type Insight = {
  type: 'positive' | 'warning' | 'suggestion';
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

type InsightsPanelProps = {
  insights: Insight[];
};

const STYLES: Record<Insight['type'], string> = {
  positive: 'border-emerald-200 bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50',
  suggestion: 'border-blue-200 bg-blue-50',
};

const InsightsPanel = ({ insights }: InsightsPanelProps) => {
  if (insights.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6" data-testid="insights-panel">
      <h3 className="text-lg font-bold text-slate-950">Insights And Recommendations</h3>
      <div className="mt-5 space-y-3">
        {insights.map((insight) => (
          <div key={`${insight.type}-${insight.title}`} className={`rounded-2xl border px-4 py-4 ${STYLES[insight.type]}`}>
            <div className="text-sm font-semibold text-slate-900">{insight.title}</div>
            <div className="mt-1 text-sm text-slate-700">{insight.description}</div>
            {insight.actionHref && insight.actionLabel && (
              <a href={insight.actionHref} className="mt-3 inline-block text-sm font-semibold text-slate-900 underline">
                {insight.actionLabel}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default InsightsPanel;
