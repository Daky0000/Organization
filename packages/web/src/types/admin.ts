export type AdminRole = 'Admin' | 'User';
export type ManagedUserStatus = 'Active' | 'Suspended' | 'Pending' | 'Banned';
export type JoinedDateFilter = 'all' | '7days' | '30days' | '1year';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: AdminRole;
  status: ManagedUserStatus;
  avatar: string;
  dateJoined: string;
  lastLogin: string;
  recentActions: string[];
}

export interface UserQueryParams {
  search: string;
  role: 'All' | 'User';
  status: 'All' | ManagedUserStatus;
  joined: JoinedDateFilter;
  page: number;
  perPage: number;
}

export interface PaginatedUsersResponse {
  items: ManagedUser[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateUserInput {
  name: string;
  email: string;
  username: string;
  password: string;
  role: 'User';
  status: Extract<ManagedUserStatus, 'Active' | 'Pending'>;
}

export interface UpdateUserInput {
  name: string;
  email: string;
  username: string;
  role: AdminRole;
  status: ManagedUserStatus;
  avatar: string;
}

export interface BulkUserAction {
  type: 'activate' | 'suspend' | 'delete' | 'changeRole';
  userIds: string[];
  role?: AdminRole;
}

export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  'Admin': ['manage users', 'manage content', 'manage billing'],
  'User': ['standard platform access'],
};
