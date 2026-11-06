import {
  CreatePricingPlanInput,
  PricingPlan,
  PricingPlanResponse,
  UpdatePricingPlanInput,
} from '../types/pricing';

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

export const pricingService = {
  async getPlans(): Promise<PricingPlan[]> {
    const response = await fetch(`${API_BASE_URL}/api/pricing/plans`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to fetch pricing plans'));
    }

    const payload = await parseJson<PricingPlanResponse>(response);
    if (!payload || !Array.isArray(payload.plans)) {
      throw new Error('Invalid pricing plans response');
    }

    return payload.plans;
  },

  async createPlan(input: CreatePricingPlanInput): Promise<PricingPlan> {
    const response = await fetch(`${API_BASE_URL}/api/pricing/plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to create pricing plan'));
    }

    const payload = await parseJson<PricingPlanResponse>(response);
    if (!payload || !payload.plan) {
      throw new Error('Invalid create plan response');
    }

    return payload.plan;
  },

  async updatePlan(id: string, input: UpdatePricingPlanInput): Promise<PricingPlan> {
    const response = await fetch(`${API_BASE_URL}/api/pricing/plans/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to update pricing plan'));
    }

    const payload = await parseJson<PricingPlanResponse>(response);
    if (!payload || !payload.plan) {
      throw new Error('Invalid update plan response');
    }

    return payload.plan;
  },

  async deletePlan(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/pricing/plans/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to delete pricing plan'));
    }
  },

  async togglePlanStatus(id: string, isActive: boolean): Promise<PricingPlan> {
    const response = await fetch(`${API_BASE_URL}/api/pricing/plans/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ isActive }),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to update plan status'));
    }

    const payload = await parseJson<PricingPlanResponse>(response);
    if (!payload || !payload.plan) {
      throw new Error('Invalid toggle status response');
    }

    return payload.plan;
  },
};
