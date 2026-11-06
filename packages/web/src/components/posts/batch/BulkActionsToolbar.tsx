interface BulkActionsToolbarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onReschedule: () => void;
  onTag: () => void;
  onPlatforms: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  isLoading?: boolean;
  message?: string | null;
}

const BulkActionsToolbar = ({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onReschedule,
  onTag,
  onPlatforms,
  onArchive,
  onDelete,
  onDuplicate,
  onExport,
  onUndo,
  canUndo,
  isLoading,
  message,
}: BulkActionsToolbarProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl space-y-3 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-700">
            {selectedCount} of {totalCount} selected
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
            <button type="button" onClick={onSelectAll} disabled={isLoading} className="hover:text-slate-800">
              {selectedCount === totalCount ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={onClearSelection} disabled={isLoading} className="hover:text-slate-800">
              Clear
            </button>
          </div>
        </div>

        {selectedCount > 50 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Large selection ({selectedCount} posts). Actions may take a moment.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReschedule}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
            data-testid="reschedule-btn"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={onTag}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
            data-testid="tag-btn"
          >
            Tag
          </button>
          <button
            type="button"
            onClick={onPlatforms}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
            data-testid="platforms-btn"
          >
            Platforms
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
            data-testid="archive-btn"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
            disabled={isLoading}
            data-testid="delete-btn"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
            data-testid="duplicate-btn"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onExport}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            disabled={isLoading}
            data-testid="export-btn"
          >
            Export CSV
          </button>
          {canUndo && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              disabled={isLoading}
              data-testid="undo-btn"
            >
              Undo
            </button>
          )}
        </div>

        {message && (
          <div className="text-xs text-slate-600" aria-live="polite">
            {message}
          </div>
        )}
        {isLoading && (
          <div className="text-xs text-slate-500" role="status" aria-live="polite">
            Processing...
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkActionsToolbar;
