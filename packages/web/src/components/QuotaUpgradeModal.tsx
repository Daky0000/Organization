import { Sparkles, X, ArrowUpRight, Zap } from 'lucide-react';

export interface QuotaExceededPayload {
  error: string;
  resource?: string;
  currentCount?: number;
  limit?: number;
  currentPlan?: string;
}

interface QuotaUpgradeModalProps {
  payload: QuotaExceededPayload | null;
  onClose: () => void;
  onNavigateToPricing: () => void;
  onNavigateToBilling: () => void;
}

export default function QuotaUpgradeModal({
  payload,
  onClose,
  onNavigateToPricing,
  onNavigateToBilling,
}: QuotaUpgradeModalProps) {
  if (!payload) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-3">
          <div className="h-11 w-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <Zap className="h-5 w-5" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
            <Sparkles className="h-3 w-3" />
            Plan Limit or Credit Threshold Reached
          </div>
          <h3 className="text-lg font-black text-slate-900">
            {!payload.resource && /credit/i.test(payload.error) ? 'You need more AI credits' : 'Workspace limit reached'}
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            {payload.error || 'You have reached the quota for your current subscription tier.'}
          </p>
        </div>

        {payload.limit !== undefined && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium capitalize">
              {(payload.resource || 'Resource').replace(/_/g, ' ')} Usage
            </span>
            <span className="font-bold text-slate-900">
              {payload.currentCount ?? payload.limit} / {payload.limit} ({payload.currentPlan || 'Current Plan'})
            </span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onNavigateToBilling();
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Buy credits
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onNavigateToPricing();
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm"
          >
            Upgrade Plan <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
