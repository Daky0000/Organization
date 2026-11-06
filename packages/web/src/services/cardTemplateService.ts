import {
  AdminCardTemplate,
  CreateAdminCardTemplateInput,
  UpdateAdminCardTemplateInput,
  PublishCardTemplateInput,
  CardTemplateResponse,
} from '../types/cardTemplate';

import { API_BASE_URL } from '../utils/apiBase';

const authHeaders = () => {
  if (typeof window === 'undefined') return {} as Record<string, string>;
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const parseJson = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const extractError = async (response: Response, fallback: string) => {
  const payload = await parseJson<{ error?: string; message?: string }>(response);
  return payload?.error || payload?.message || fallback;
};

export const cardTemplateService = {
  async getTemplates(): Promise<AdminCardTemplate[]> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to fetch card templates'));
    }

    const payload = await parseJson<CardTemplateResponse>(response);
    if (!payload || !Array.isArray(payload.templates)) {
      throw new Error('Invalid card templates response');
    }

    return payload.templates;
  },

  async getPublishedTemplates(): Promise<AdminCardTemplate[]> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates/published`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to fetch published card templates'));
    }

    const payload = await parseJson<CardTemplateResponse>(response);
    if (!payload || !Array.isArray(payload.templates)) {
      throw new Error('Invalid published card templates response');
    }

    return payload.templates;
  },

  async createTemplate(input: CreateAdminCardTemplateInput): Promise<AdminCardTemplate> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description || '',
        designData: input.designData,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to create card template'));
    }

    const payload = await parseJson<CardTemplateResponse>(response);
    if (!payload?.template) {
      throw new Error('Invalid card template response');
    }

    return payload.template;
  },

  async updateTemplate(
    id: string,
    input: UpdateAdminCardTemplateInput
  ): Promise<AdminCardTemplate> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description || '',
        designData: input.designData,
        ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl }),
      }),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to update card template'));
    }

    const payload = await parseJson<CardTemplateResponse>(response);
    if (!payload?.template) {
      throw new Error('Invalid card template response');
    }

    return payload.template;
  },

  async publishTemplate(
    id: string,
    input: PublishCardTemplateInput
  ): Promise<AdminCardTemplate> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates/${id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        coverImageUrl: input.coverImageUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to publish card template'));
    }

    const payload = await parseJson<CardTemplateResponse>(response);
    if (!payload?.template) {
      throw new Error('Invalid card template response');
    }

    return payload.template;
  },

  async unpublishTemplate(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates/${id}/unpublish`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to unpublish card template'));
    }
  },

  async deleteTemplate(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/card-templates/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to delete card template'));
    }
  },
};
