import { useState } from 'react';
import { AdminRole, ManagedUser, ManagedUserStatus } from '../../types/admin';

interface UserRowProps {
  user: ManagedUser;
  selected: boolean;
  canDelete: boolean;
  onToggleSelected: (userId: string) => void;
  onViewProfile: (user: ManagedUser) => void;
  onEditUser: (user: ManagedUser) => void;
  onChangeRole: (user: ManagedUser, role: AdminRole) => void;
  onChangeStatus: (user: ManagedUser, status: ManagedUserStatus) => void;
  onDeleteUser: (user: ManagedUser) => void;
  onGrantCredits: (user: ManagedUser) => void;
}

const statusClasses: Record<ManagedUserStatus, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Suspended: 'bg-amber-50 text-amber-700',
  Banned: 'bg-rose-50 text-rose-700',
  Pending: 'bg-slate-100 text-slate-600',
};

const UserRow = ({
  user,
  selected,
  canDelete,
  onToggleSelected,
  onViewProfile,
  onEditUser,
  onChangeRole,
  onChangeStatus,
  onDeleteUser,
  onGrantCredits,
}: UserRowProps) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <tr className="border-t border-slate-200">
      <td className="px-4 py-4 align-top">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelected(user.id)} className="h-4 w-4 rounded border-slate-300" />
      </td>
      <td className="px-4 py-4 align-top">
        <div className="flex items-center gap-3">
          <img src={user.avatar} alt={user.name} className="h-11 w-11 rounded-2xl object-cover" />
          <div>
            <div className="font-semibold text-slate-900">{user.name}</div>
            <div className="text-sm text-slate-500">@{user.username}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-sm text-slate-600 align-top">{user.email}</td>
      <td className="px-4 py-4 text-sm font-semibold text-slate-700 align-top">{user.role}</td>
      <td className="px-4 py-4 align-top">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClasses[user.status]}`}>{user.status}</span>
      </td>
      <td className="px-4 py-4 text-sm text-slate-600 align-top">{user.dateJoined}</td>
      <td className="px-4 py-4 text-sm text-slate-600 align-top">{user.lastLogin}</td>
      <td className="px-4 py-4 align-top">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Actions
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
              <button type="button" onClick={() => { onViewProfile(user); setMenuOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                View Profile
              </button>
              <button type="button" onClick={() => { onGrantCredits(user); setMenuOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-indigo-600 hover:bg-indigo-50">
                Grant Credits
              </button>
              <button type="button" onClick={() => { onEditUser(user); setMenuOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                Edit User
              </button>
              <button type="button" onClick={() => { onChangeRole(user, user.role === 'Admin' ? 'User' : 'Admin'); setMenuOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                Change Role
              </button>
              {user.status === 'Active' ? (
                <button type="button" onClick={() => { onChangeStatus(user, 'Suspended'); setMenuOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  Suspend User
                </button>
              ) : (
                <button type="button" onClick={() => { onChangeStatus(user, 'Active'); setMenuOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  Activate User
                </button>
              )}
              <button
                type="button"
                disabled={!canDelete}
                onClick={() => { onDeleteUser(user); setMenuOpen(false); }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40"
              >
                Delete User
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

export default UserRow;
