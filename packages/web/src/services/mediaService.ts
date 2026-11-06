import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

export interface MediaImage {
  id: string;
  user_id: string;
  file_name: string;
  original_name: string;
  file_size: number;
  file_type: string;
  width?: number;
  height?: number;
  upload_date: string;
  url: string;
  thumbnail_url?: string;
  alt_text?: string;
  caption?: string;
  description?: string;
  tags: string[];
  used_in: string[];
  category?: string;
  // admin fields
  username?: string;
  user_email?: string;
}

export interface MediaUploadPayload {
  url: string;
  thumbnail_url?: string;
  file_name: string;
  original_name: string;
  file_size: number;
  file_type: string;
  width?: number;
  height?: number;
  category?: string;
  force?: boolean;
}

export interface AdminMediaStats {
  total_images: number;
  total_size: number;
  users_count: number;
}

export interface MediaSyncResult {
  synced: number;
  scanned?: number;
  message?: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data as T;
}

export const mediaService = {
  async upload(payload: MediaUploadPayload): Promise<MediaImage> {
    const res = await fetch(`${API_BASE_URL}/api/media/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.status === 409 && data.error === 'duplicate') {
      const err = Object.assign(new Error('duplicate'), {
        isDuplicate: true as const,
        existingImage: data.existingImage as MediaImage,
        suggestedName: data.suggestedName as string,
      });
      throw err;
    }
    if (!data.success) throw new Error(data.error || 'Upload failed');
    return data.image as MediaImage;
  },

  async list(params?: { search?: string; tag?: string }): Promise<MediaImage[]> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.tag) qs.set('tag', params.tag);
    const res = await fetch(`${API_BASE_URL}/api/media?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    // Ensure we only return user-owned images (filter out any admin images that might be included)
    const images = (data.images as MediaImage[]) ?? [];
    return images.filter(img => !img.user_id || img.category !== 'admin');
  },

  async syncAll(): Promise<MediaSyncResult> {
    const res = await fetch(`${API_BASE_URL}/api/media/sync-all-images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await handleResponse<{ success: boolean; synced: number; scanned?: number; message?: string }>(res);
    return {
      synced: data.synced ?? 0,
      scanned: data.scanned,
      message: data.message,
    };
  },

  async update(
    id: string,
    patch: {
      file_name?: string;
      tags?: string[];
      alt_text?: string;
      caption?: string;
      description?: string;
    }
  ): Promise<MediaImage> {
    const res = await fetch(`${API_BASE_URL}/api/media/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    const data = await handleResponse<{ success: boolean; image: MediaImage }>(res);
    return data.image;
  },

  async remove(id: string): Promise<void> {
    await fetch(`${API_BASE_URL}/api/media/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  },

  async bulkDelete(ids: string[]): Promise<void> {
    await fetch(`${API_BASE_URL}/api/media/bulk-delete`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ids }),
    });
  },

  // Admin
  async adminList(params?: { userId?: string; search?: string }): Promise<MediaImage[]> {
    const qs = new URLSearchParams();
    if (params?.userId) qs.set('userId', params.userId);
    if (params?.search) qs.set('search', params.search);
    const res = await fetch(`${API_BASE_URL}/api/admin/media?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    return (data.images as MediaImage[]) ?? [];
  },

  async adminStats(): Promise<AdminMediaStats> {
    const res = await fetch(`${API_BASE_URL}/api/admin/media/stats`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    return data.stats ?? { total_images: 0, total_size: 0, users_count: 0 };
  },

  async adminDelete(id: string): Promise<void> {
    await fetch(`${API_BASE_URL}/api/admin/media/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  },

  async adminSetCategory(id: string, category: 'user' | 'admin'): Promise<MediaImage> {
    const res = await fetch(`${API_BASE_URL}/api/admin/media/${id}/category`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ category }),
    });
    const data = await handleResponse<{ success: boolean; image: MediaImage }>(res);
    return data.image;
  },

  async listAdminAssets(): Promise<MediaImage[]> {
    const res = await fetch(`${API_BASE_URL}/api/media/admin-assets`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    return (data.images as MediaImage[]) ?? [];
  },
};
