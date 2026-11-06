import { useEffect, useId, useRef, useState } from 'react';

interface DeleteConfirmModalProps {
  count: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const DeleteConfirmModal = ({ count, onConfirm, onCancel }: DeleteConfirmModalProps) => {
  const titleId=useId();
  const dialog=useRef<HTMLDivElement>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string | null>(null);
  useEffect(() => {
    const previous=document.activeElement as HTMLElement | null;
    const bodyOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys=(event: KeyboardEvent) => {
      if (event.key==='Escape' && !pending) onCancel();
      if (event.key!=='Tab') return;
      const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first=buttons[0],last=buttons[buttons.length-1];
      if (!first) { event.preventDefault();return; }
      if (event.shiftKey && document.activeElement===first) { event.preventDefault();last.focus(); }
      else if (!event.shiftKey && document.activeElement===last) { event.preventDefault();first.focus(); }
    };
    document.addEventListener('keydown',keys);
    return () => { document.removeEventListener('keydown',keys);document.body.style.overflow=bodyOverflow;previous?.focus(); };
  },[onCancel,pending]);
  const confirm=async () => {
    if (pending) return;
    setPending(true);setError(null);
    try { await onConfirm(); } catch(error) { setError(error instanceof Error ? error.message : 'Delete failed. Please retry.'); }
    finally { setPending(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={pending} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 id={titleId} className="text-lg font-semibold text-slate-900">Delete {count} posts?</h3>
        <p className="mt-2 text-sm text-slate-600">This will move the selected posts to deleted status. You can undo for 30 seconds.</p>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            data-testid="cancel-delete"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={pending}
            className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            data-testid="confirm-delete"
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
