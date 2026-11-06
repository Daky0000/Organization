import { AdminRole } from '../../types/admin';

interface BulkActionsToolbarProps {
  selectedCount: number;
  canDelete: boolean;
  onActivate: () => void;
  onSuspend: () => void;
  onDelete: () => void;
  onChangeRole: (role: AdminRole) => void;
}

const buttonClassName =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

const BulkActionsToolbar = ({
  selectedCount,
  canDelete,
  onActivate,
  onSuspend,
  onDelete,
  onChangeRole,
}: BulkActionsToolbarProps) => {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="text-sm font-semibold text-slate-700">{selectedCount} user{selectedCount > 1 ? 's' : ''} selected</div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onActivate} className={buttonClassName}>
          Activate Users
        </button>
        <button type="button" onClick={onSuspend} className={buttonClassName}>
          Suspend Users
        </button>
        <select
          defaultValue=""
          onChange={(event) => {
            if (!event.target.value) return;
            onChangeRole(event.target.value as AdminRole);
            event.target.value = '';
          }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
        >
          <option value="" disabled>
            Change Role
          </option>
          {['Admin', 'User'].map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button type="button" onClick={onDelete} disabled={!canDelete} className={buttonClassName}>
          Delete Users
        </button>
      </div>
    </div>
  );
};

export default BulkActionsToolbar;
