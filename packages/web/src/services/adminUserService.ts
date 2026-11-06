import {
  BulkUserAction,
  CreateUserInput,
  ManagedUser,
  ManagedUserStatus,
  PaginatedUsersResponse,
  UpdateUserInput,
  UserQueryParams,
} from '../types/admin';

import { api } from './apiClient';

export const adminUserService = {
  async getUsers(query: UserQueryParams): Promise<PaginatedUsersResponse> {
    const params = new URLSearchParams({
      search: query.search,
      role: query.role,
      status: query.status,
      joined: query.joined,
      page: String(query.page),
      perPage: String(query.perPage),
    });
    return api.get<PaginatedUsersResponse>(`/api/users?${params.toString()}`);
  },

  async createUser(input: CreateUserInput): Promise<ManagedUser> {
    return api.post<ManagedUser>('/api/users', input);
  },

  async updateUser(id: string, input: UpdateUserInput): Promise<ManagedUser> {
    return api.put<ManagedUser>(`/api/users/${id}`, input);
  },

  async deleteUser(id: string): Promise<void> {
    await api.del(`/api/users/${id}`);
  },

  async patchUserStatus(id: string, status: ManagedUserStatus): Promise<void> {
    await api.patch(`/api/users/${id}/status`, { status });
  },

  async patchUserRole(id: string, role: ManagedUser['role']): Promise<void> {
    await api.patch(`/api/users/${id}/role`, { role });
  },

  async grantCredits(userId: string, amount: number): Promise<void> {
    await api.post('/api/credits/admin/grant', { user_id: userId, amount });
  },

  async bulkAction(action: BulkUserAction): Promise<void> {
    if (action.type === 'delete') {
      await Promise.all(action.userIds.map((userId) => this.deleteUser(userId)));
      return;
    }

    if (action.type === 'changeRole' && action.role) {
      await Promise.all(action.userIds.map((userId) => this.patchUserRole(userId, action.role!)));
      return;
    }

    const nextStatus: Record<'activate' | 'suspend', ManagedUserStatus> = {
      activate: 'Active',
      suspend: 'Suspended',
    };

    await Promise.all(
      action.userIds.map((userId) =>
        this.patchUserStatus(userId, nextStatus[action.type as 'activate' | 'suspend']),
      ),
    );
  },
};
