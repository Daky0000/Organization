import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminUserService } from '../../services/adminUserService';
import {
  AdminRole,
  CreateUserInput,
  JoinedDateFilter,
  ManagedUser,
  ManagedUserStatus,
  PaginatedUsersResponse,
  UpdateUserInput,
} from '../../types/admin';
import AddUserModal from './AddUserModal';
import BulkActionsToolbar from './BulkActionsToolbar';
import EditUserModal from './EditUserModal';
import GrantCreditsModal from './GrantCreditsModal';
import Pagination from './Pagination';
import UserFilters from './UserFilters';
import UserProfilePanel from './UserProfilePanel';
import UserSearch from './UserSearch';
import UserTable from './UserTable';

interface UserManagementPageProps {
  currentAdminRole: AdminRole;
}

const PER_PAGE = 25;

const UserManagementPage = ({ currentAdminRole }: UserManagementPageProps) => {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'All' | 'User'>('All');
  const [status, setStatus] = useState<'All' | ManagedUserStatus>('All');
  const [joined, setJoined] = useState<JoinedDateFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedUsersResponse>({ items: [], total: 0, page: 1, perPage: PER_PAGE });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [profileUser, setProfileUser] = useState<ManagedUser | null>(null);
  const [grantCreditsUser, setGrantCreditsUser] = useState<ManagedUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canDelete = currentAdminRole === 'Admin';

  const refreshUsers = async () => {
    try {
      setErrorMessage(null);
      const nextData = await adminUserService.getUsers({
        search,
        role,
        status,
        joined,
        page,
        perPage: PER_PAGE,
      });
      setData(nextData);
    } catch (error) {
      setData({ items: [], total: 0, page: 1, perPage: PER_PAGE });
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load users');
    }
  };

  useEffect(() => {
    void refreshUsers();
  }, [search, role, status, joined, page]);

  useEffect(() => {
    setSelectedIds([]);
  }, [data.items]);

  const confirmDanger = (message: string) => window.confirm(message);

  const handleCreateUser = async (input: CreateUserInput) => {
    try {
      setErrorMessage(null);
      await adminUserService.createUser(input);
      setAddOpen(false);
      setPage(1);
      await refreshUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create user');
    }
  };

  const handleSaveUser = async (id: string, input: UpdateUserInput) => {
    try {
      setErrorMessage(null);
      await adminUserService.updateUser(id, input);
      setEditUser(null);
      await refreshUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update user');
    }
  };

  const handleChangeStatus = async (user: ManagedUser, nextStatus: ManagedUserStatus) => {
    if (!confirmDanger(`Change ${user.name} to ${nextStatus}?`)) {
      return;
    }
    try {
      setErrorMessage(null);
      await adminUserService.patchUserStatus(user.id, nextStatus);
      await refreshUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update user status');
    }
  };

  const handleDeleteUser = async (user: ManagedUser) => {
    if (!canDelete) {
      window.alert('Only Admin can delete users.');
      return;
    }
    if (!confirmDanger(`Delete ${user.name}? This action cannot be undone.`)) {
      return;
    }
    try {
      setErrorMessage(null);
      await adminUserService.deleteUser(user.id);
      await refreshUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete user');
    }
  };

  const handleChangeRole = async (user: ManagedUser, nextRole: AdminRole) => {
    try {
      setErrorMessage(null);
      await adminUserService.patchUserRole(user.id, nextRole);
      await refreshUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update user role');
    }
  };

  const handleGrantCredits = async (userId: string, amount: number) => {
    await adminUserService.grantCredits(userId, amount);
  };

  const handleBulkAction = async (type: 'activate' | 'suspend' | 'delete' | 'changeRole', nextRole?: AdminRole) => {
    if (selectedIds.length === 0) {
      return;
    }

    if (type === 'delete' && !canDelete) {
      window.alert('Only Admin can delete users.');
      return;
    }

    const label =
      type === 'activate'
        ? 'activate'
        : type === 'suspend'
          ? 'suspend'
          : type === 'delete'
            ? 'delete'
            : `change role to ${nextRole}`;
    if (!confirmDanger(`Confirm bulk action: ${label}?`)) {
      return;
    }

    try {
      setErrorMessage(null);
      await adminUserService.bulkAction({
        type,
        userIds: selectedIds,
        role: nextRole,
      });
      await refreshUsers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to apply bulk action');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">User Management</h1>
        <p className="mt-2 text-base text-slate-500">Manage all platform users and permissions</p>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 md:px-6">
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr_auto]">
            <UserSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
            <UserFilters
              role={role}
              status={status}
              joined={joined}
              onRoleChange={(value) => { setRole(value); setPage(1); }}
              onStatusChange={(value) => { setStatus(value); setPage(1); }}
              onJoinedChange={(value) => { setJoined(value); setPage(1); }}
            />
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white"
            >
              <Plus size={16} />
              Add New User
            </button>
          </div>
        </div>

        <div className="px-4 py-4 md:px-6">
          <BulkActionsToolbar
            selectedCount={selectedIds.length}
            canDelete={canDelete}
            onActivate={() => void handleBulkAction('activate')}
            onSuspend={() => void handleBulkAction('suspend')}
            onDelete={() => void handleBulkAction('delete')}
            onChangeRole={(nextRole) => void handleBulkAction('changeRole', nextRole)}
          />
        </div>

        {errorMessage && (
          <div className="px-4 pb-4 md:px-6">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          </div>
        )}

        <UserTable
          users={data.items}
          selectedIds={selectedIds}
          canDelete={canDelete}
          onToggleAll={() =>
            setSelectedIds((current) =>
              current.length === data.items.length ? [] : data.items.map((user) => user.id),
            )
          }
          onToggleSelected={(userId) =>
            setSelectedIds((current) =>
              current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
            )
          }
          onViewProfile={setProfileUser}
          onEditUser={setEditUser}
          onChangeRole={(user, nextRole) => void handleChangeRole(user, nextRole)}
          onChangeStatus={(user, nextStatus) => void handleChangeStatus(user, nextStatus)}
          onDeleteUser={(user) => void handleDeleteUser(user)}
          onGrantCredits={setGrantCreditsUser}
        />

        <Pagination page={data.page} perPage={data.perPage} total={data.total} onPageChange={setPage} />
      </div>

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={handleCreateUser} />
      <EditUserModal open={Boolean(editUser)} user={editUser} onClose={() => setEditUser(null)} onSave={handleSaveUser} />
      <UserProfilePanel user={profileUser} onClose={() => setProfileUser(null)} />
      <GrantCreditsModal user={grantCreditsUser} onClose={() => setGrantCreditsUser(null)} onGrant={handleGrantCredits} />
    </div>
  );
};

export default UserManagementPage;
