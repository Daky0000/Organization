import { AdminRole, ManagedUser, ManagedUserStatus } from '../../types/admin';
import UserRow from './UserRow';

interface UserTableProps {
  users: ManagedUser[];
  selectedIds: string[];
  canDelete: boolean;
  onToggleAll: () => void;
  onToggleSelected: (userId: string) => void;
  onViewProfile: (user: ManagedUser) => void;
  onEditUser: (user: ManagedUser) => void;
  onChangeRole: (user: ManagedUser, role: AdminRole) => void;
  onChangeStatus: (user: ManagedUser, status: ManagedUserStatus) => void;
  onDeleteUser: (user: ManagedUser) => void;
  onGrantCredits: (user: ManagedUser) => void;
}

const UserTable = ({
  users,
  selectedIds,
  canDelete,
  onToggleAll,
  onToggleSelected,
  onViewProfile,
  onEditUser,
  onChangeRole,
  onChangeStatus,
  onDeleteUser,
  onGrantCredits,
}: UserTableProps) => (
  <div className="overflow-x-auto">
    <table className="min-w-full">
      <thead className="bg-slate-50">
        <tr className="text-left text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
          <th className="px-4 py-3">
            <input
              type="checkbox"
              checked={users.length > 0 && selectedIds.length === users.length}
              onChange={onToggleAll}
              className="h-4 w-4 rounded border-slate-300"
            />
          </th>
          <th className="px-4 py-3">Name</th>
          <th className="px-4 py-3">Email</th>
          <th className="px-4 py-3">Role</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Date Joined</th>
          <th className="px-4 py-3">Last Login</th>
          <th className="px-4 py-3">Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            selected={selectedIds.includes(user.id)}
            canDelete={canDelete}
            onToggleSelected={onToggleSelected}
            onViewProfile={onViewProfile}
            onEditUser={onEditUser}
            onChangeRole={onChangeRole}
            onChangeStatus={onChangeStatus}
            onDeleteUser={onDeleteUser}
            onGrantCredits={onGrantCredits}
          />
        ))}
      </tbody>
    </table>
  </div>
);

export default UserTable;
