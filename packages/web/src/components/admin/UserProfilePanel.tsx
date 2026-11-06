import { ManagedUser, ROLE_PERMISSIONS } from '../../types/admin';

interface UserProfilePanelProps {
  user: ManagedUser | null;
  onClose: () => void;
}

const UserProfilePanel = ({ user, onClose }: UserProfilePanelProps) => {
  if (!user) {
    return null;
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
        <div>
          <h3 className="text-2xl font-black text-slate-950">User Profile</h3>
          <p className="mt-1 text-sm text-slate-500">Profile, status, and account activity</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="space-y-6 overflow-y-auto px-6 py-6">
        <div className="flex items-center gap-4">
          <img src={user.avatar} alt={user.name} className="h-16 w-16 rounded-2xl object-cover" />
          <div>
            <div className="text-xl font-black text-slate-950">{user.name}</div>
            <div className="text-sm text-slate-500">{user.email}</div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Role</div>
            <div className="mt-2 text-sm font-semibold text-slate-800">{user.role}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Status</div>
            <div className="mt-2 text-sm font-semibold text-slate-800">{user.status}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Date Joined</div>
            <div className="mt-2 text-sm font-semibold text-slate-800">{user.dateJoined}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Last Login</div>
            <div className="mt-2 text-sm font-semibold text-slate-800">{user.lastLogin}</div>
          </div>
        </div>

        <div>
          <div className="text-sm font-bold text-slate-900">Permissions</div>
          <ul className="mt-3 space-y-2">
            {ROLE_PERMISSIONS[user.role].map((permission) => (
              <li key={permission} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {permission}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-sm font-bold text-slate-900">Account Activity</div>
          <ul className="mt-3 space-y-2">
            {user.recentActions.map((action) => (
              <li key={action} className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                {action}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default UserProfilePanel;
