import { api } from './apiClient';

function assertSuccess<T extends { success?: boolean; error?: string }>(r: T): T {
  if (r && r.success === false) throw new Error(r.error || 'Request failed');
  return r;
}

// ── Company context ─────────────────────────────────────────────────────────

export const CONTEXT_KINDS = [
  'overview', 'offering', 'event', 'program', 'audience', 'proof', 'policy', 'playbook', 'contact', 'faq', 'note',
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];
export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  overview: 'Company overview', offering: 'Services & offerings', event: 'Events & trainings', program: 'Programmes & projects',
  audience: 'Target audiences', proof: 'Proof & clients', policy: 'Policies', playbook: 'Sales playbook',
  contact: 'Contact', faq: 'FAQ', note: 'Notes',
};

export interface ContextData {
  start_date?: string | null;
  end_date?: string | null;
  time?: string | null;
  venue?: string | null;
  format?: string | null;
  price?: string | null;
  early_bird?: string | null;
  booking_deadline?: string | null;
  capacity?: number | null;
  url?: string | null;
  target_roles?: string[];
  target_industries?: string[];
  keywords?: string[];
}

export interface ContextItem {
  id: string;
  kind: ContextKind;
  title: string;
  summary: string | null;
  body: string | null;
  data: ContextData;
  tags: string[];
  position: number;
  active: boolean;
  source: 'seed' | 'manual' | 'ai';
  seed_key: string | null;
  created_at: string;
  updated_at: string;
}

export type ContextInput = Pick<ContextItem, 'kind' | 'title'> & Partial<Pick<ContextItem, 'summary' | 'body' | 'data' | 'tags' | 'position' | 'active'>>;

export const agentService = {
  async listContext() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; items: ContextItem[] }>('/api/company-context')).items;
  },
  async createContext(input: ContextInput) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; item: ContextItem }>('/api/company-context', input)).item;
  },
  async updateContext(id: string, patch: Partial<ContextInput>) {
    return assertSuccess(await api.patch<{ success: boolean; error?: string; item: ContextItem }>(`/api/company-context/${id}`, patch)).item;
  },
  async deleteContext(id: string) {
    assertSuccess(await api.del<{ success: boolean; error?: string }>(`/api/company-context/${id}`));
  },
  async restoreContextDefaults() {
    return assertSuccess(await api.post<{ success: boolean; error?: string; added: number; items: ContextItem[] }>('/api/company-context/restore-defaults'));
  },
};
