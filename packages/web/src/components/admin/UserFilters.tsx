import { JoinedDateFilter, ManagedUserStatus } from '../../types/admin';

interface UserFiltersProps {
  role: 'All' | 'User';
  status: 'All' | ManagedUserStatus;
  joined: JoinedDateFilter;
  onRoleChange: (value: 'All' | 'User') => void;
  onStatusChange: (value: 'All' | ManagedUserStatus) => void;
  onJoinedChange: (value: JoinedDateFilter) => void;
}

const selectClassName =
  'h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400';

const UserFilters = ({
  role,
  status,
  joined,
  onRoleChange,
  onStatusChange,
  onJoinedChange,
}: UserFiltersProps) => (
  <div className="grid gap-3 sm:grid-cols-3">
    <select value={role} onChange={(event) => onRoleChange(event.target.value as UserFiltersProps['role'])} className={selectClassName}>
      {['All', 'User'].map((option) => (
        <option key={option} value={option}>
          {option === 'All' ? 'All roles' : option}
        </option>
      ))}
    </select>

    <select value={status} onChange={(event) => onStatusChange(event.target.value as UserFiltersProps['status'])} className={selectClassName}>
      {['All', 'Active', 'Suspended', 'Pending', 'Banned'].map((option) => (
        <option key={option} value={option}>
          {option === 'All' ? 'All statuses' : option}
        </option>
      ))}
    </select>

    <select value={joined} onChange={(event) => onJoinedChange(event.target.value as JoinedDateFilter)} className={selectClassName}>
      <option value="all">Any join date</option>
      <option value="7days">Last 7 days</option>
      <option value="30days">Last 30 days</option>
      <option value="1year">Last year</option>
    </select>
  </div>
);

export default UserFilters;
