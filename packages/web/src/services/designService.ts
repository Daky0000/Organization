import { api } from './apiClient';

export interface UserDesign {
  id: string;
  user_id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  canvas_data: object;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

type DesignResponse = { success: boolean; error?: string; design: UserDesign };
type DesignListResponse = { success: boolean; error?: string; designs: UserDesign[] };

function assertSuccess<T extends { success: boolean; error?: string }>(data: T): T {
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data;
}

export const designService = {
  async list(): Promise<UserDesign[]> {
    return assertSuccess(await api.get<DesignListResponse>('/api/designs')).designs;
  },

  async get(id: string): Promise<UserDesign> {
    return assertSuccess(await api.get<DesignResponse>(`/api/designs/${id}`)).design;
  },

  async create(payload: {
    name?: string;
    canvas_width?: number;
    canvas_height?: number;
    canvas_data?: object;
    thumbnail_url?: string | null;
  }): Promise<UserDesign> {
    return assertSuccess(await api.post<DesignResponse>('/api/designs', payload)).design;
  },

  async update(
    id: string,
    payload: Partial<{
      name: string;
      canvas_width: number;
      canvas_height: number;
      canvas_data: object;
      thumbnail_url: string | null;
    }>,
  ): Promise<UserDesign> {
    return assertSuccess(await api.put<DesignResponse>(`/api/designs/${id}`, payload)).design;
  },

  async delete(id: string): Promise<void> {
    assertSuccess(await api.del<{ success: boolean; error?: string }>(`/api/designs/${id}`));
  },

  async clearAll(): Promise<number> {
    const res = assertSuccess(await api.del<{ success: boolean; error?: string; deleted?: number }>('/api/designs'));
    return res.deleted ?? 0;
  },
};
