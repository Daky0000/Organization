import { API_BASE_URL } from '../utils/apiBase';

export interface AutopilotOverview {
  tenant: {
    tenantId: string;
    orgId: string | null;
    projectId: string | null;
    role: 'owner' | 'admin' | 'editor' | 'viewer';
    canEdit: boolean;
    canApprove: boolean;
    canPublish: boolean;
  };
  business: any | null;
  brand: any | null;
  strategy: any | null;
  counts: {
    total_items: number;
    planned: number;
    review_required: number;
    approved: number;
    scheduled: number;
    published: number;
    publish_failed: number;
    pending_recommendations: number;
  };
}

async function requestJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const err: any = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    err.details = data?.details;
    throw err;
  }
  return data as T;
}

export const autopilotService = {
  getOverview: () => requestJson<{ success: true } & AutopilotOverview>('/autopilot/overview'),
  getPrefillContext: () => requestJson<{ success: true; prefill: any }>('/autopilot/prefill-context'),

  getBusinessProfile: () =>
    requestJson<{ success: true; profile: any; follow_up_questions: any[] }>('/autopilot/business-profile'),
  saveBusinessProfile: (payload: Record<string, any>) =>
    requestJson<{ success: true; profile: any; follow_up_questions: any[] }>('/autopilot/business-profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  loadDakyXTechPilot: () =>
    requestJson<{ success: true; business: any; brand: any; strategy: any }>('/autopilot/pilot/dakyxtech', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  scanWebsiteBrand: (url: string, preserveTokens = true) =>
    requestJson<{ success: true; scan: any; brand: any }>('/autopilot/brand/scan-website', {
      method: 'POST',
      body: JSON.stringify({ url, preserve_approved_tokens: preserveTokens }),
    }),
  getBrandStudio: () =>
    requestJson<{ success: true; brand: any; tokens: any[]; assets: any[]; versions: any[] }>('/autopilot/brand-profile'),
  saveBrandProfile: (payload: Record<string, any>) =>
    requestJson<{ success: true; brand: any }>('/autopilot/brand-profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  approveBrandProfile: (rationale?: string) =>
    requestJson<{ success: true; brand: any }>('/autopilot/brand-profile/approve', {
      method: 'POST',
      body: JSON.stringify({ rationale }),
    }),
  createBrandToken: (payload: Record<string, any>) =>
    requestJson<{ success: true; token: any }>('/autopilot/brand/tokens', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBrandToken: (tokenId: string, payload: Record<string, any>) =>
    requestJson<{ success: true; token: any }>(`/autopilot/brand/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteBrandToken: (tokenId: string) =>
    requestJson<{ success: true; deleted: boolean }>(`/autopilot/brand/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    }),
  addBrandAsset: (payload: Record<string, any>) =>
    requestJson<{ success: true; asset: any }>('/autopilot/brand/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteBrandAsset: (assetId: string) =>
    requestJson<{ success: true }>(`/autopilot/brand/assets/${encodeURIComponent(assetId)}`, {
      method: 'DELETE',
    }),

  getStrategy: () => requestJson<{ success: true; strategy: any; versions: any[] }>('/autopilot/strategy'),
  generateStrategy: (payload: Record<string, any> = {}) =>
    requestJson<{ success: true; strategy: any }>('/autopilot/strategy/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateStrategy: (id: string, payload: Record<string, any>) =>
    requestJson<{ success: true; strategy: any }>(`/autopilot/strategy/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  approveStrategy: (id: string) =>
    requestJson<{ success: true; strategy: any }>(`/autopilot/strategy/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  generateCalendarBatch: (payload: { batch_size?: number; campaign_name?: string; creative_mode?: string }) =>
    requestJson<{ success: true; items: any[]; briefs: any[]; batch_cost_summary: any }>('/autopilot/calendar/generate-batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listItems: (state?: string) =>
    requestJson<{ success: true; items: any[] }>(`/autopilot/items${state ? `?state=${encodeURIComponent(state)}` : ''}`),
  createItem: (payload: Record<string, any>) =>
    requestJson<{ success: true; item: any; brief: any }>('/autopilot/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getItemDetail: (id: string) =>
    requestJson<{ success: true; item: any; brief: any; runs: any[]; approvals: any[]; publications: any[] }>(
      `/autopilot/items/${encodeURIComponent(id)}`,
    ),
  updateItem: (id: string, payload: Record<string, any>) =>
    requestJson<{ success: true; item: any }>(`/autopilot/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listModels: () => requestJson<{ success: true; models: any[] }>('/autopilot/models'),
  updateBrief: (itemId: string, payload: Record<string, any>) =>
    requestJson<{ success: true; brief: any; cost_estimate: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/brief`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  estimateItemCost: (itemId: string, payload: Record<string, any> = {}) =>
    requestJson<{ success: true; estimate: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/estimate-cost`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateItemAssets: (itemId: string, payload: Record<string, any> = {}) =>
    requestJson<{ success: true; item: any; brief: any; run: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/generate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  validateItem: (itemId: string) =>
    requestJson<{ success: true; validation_report: any; item: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/validate`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  submitForReview: (itemId: string, notes?: string) =>
    requestJson<{ success: true; item: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/submit-review`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  approveItem: (itemId: string, notes?: string) =>
    requestJson<{ success: true; item: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  requestItemChanges: (itemId: string, notes?: string) =>
    requestJson<{ success: true; item: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  rejectItem: (itemId: string, notes?: string) =>
    requestJson<{ success: true; item: any }>(`/autopilot/items/${encodeURIComponent(itemId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  createShareReviewLink: (itemId: string) =>
    requestJson<{ success: true; token: string; review_path: string; expires_at: string }>(
      `/autopilot/items/${encodeURIComponent(itemId)}/share-review-link`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  scheduleItem: (itemId: string, payload: Record<string, any>) =>
    requestJson<{ success: true; item: any; publications: any[] }>(`/autopilot/items/${encodeURIComponent(itemId)}/schedule`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listPublications: (itemId?: string) =>
    requestJson<{ success: true; publications: any[] }>(
      `/autopilot/publications${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''}`,
    ),
  getPublicationAttempts: (pubId: string) =>
    requestJson<{ success: true; publication: any; attempts: any[] }>(
      `/autopilot/publications/${encodeURIComponent(pubId)}/attempts`,
    ),
  publishNow: (pubId: string) =>
    requestJson<{ success: true; publication: any; attempt: any; deduplicated: boolean }>(
      `/autopilot/publications/${encodeURIComponent(pubId)}/publish`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  retryPublication: (pubId: string) =>
    requestJson<{ success: true; publication: any; attempt: any; deduplicated: boolean }>(
      `/autopilot/publications/${encodeURIComponent(pubId)}/retry`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  cancelPublication: (pubId: string) =>
    requestJson<{ success: true; publication: any }>(
      `/autopilot/publications/${encodeURIComponent(pubId)}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getAnalyticsSummary: () =>
    requestJson<{ success: true; summary: any; recommendations: any[]; experiments: any[] }>('/autopilot/analytics/summary'),
  ingestMetrics: (entry: Record<string, any>) =>
    requestJson<{ success: true; ingested: number }>('/autopilot/analytics/metrics', {
      method: 'POST',
      body: JSON.stringify(entry),
    }),
  generateRecommendations: () =>
    requestJson<{ success: true; generated: any[]; insufficient_evidence: boolean; message: string }>(
      '/autopilot/analytics/recommendations/generate',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  getBrandDiff: (v1: number, v2: number) =>
    requestJson<{ success: true; v1: number; v2: number; diff: any }>(`/autopilot/brand/diff?v1=${v1}&v2=${v2}`),
  restoreBrandVersion: (version: number) =>
    requestJson<{ success: true; brand: any }>('/autopilot/brand/restore', {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),

  getTenantControls: () => requestJson<{ success: true; controls: any }>('/autopilot/controls'),
  updateTenantControls: (controls: Record<string, any>) =>
    requestJson<{ success: true; controls: any }>('/autopilot/controls', {
      method: 'POST',
      body: JSON.stringify(controls),
    }),
  getUsageLedger: () => requestJson<{ success: true; ledger: any }>('/autopilot/usage/ledger'),
  exportTenantData: () => requestJson<{ success: true; export: any }>('/autopilot/tenant/export'),
  purgeTenantData: () => requestJson<{ success: true }>('/autopilot/tenant-data', { method: 'DELETE' }),

  getOpsHealth: () =>
    requestJson<{ success: true; service: string; timestamp: string; providers: any; controls: any }>('/autopilot/ops/health'),

  pausePublication: (pubId: string) =>
    requestJson<{ success: true; publication: any }>(`/autopilot/publications/${encodeURIComponent(pubId)}/pause`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  resumePublication: (pubId: string) =>
    requestJson<{ success: true; publication: any }>(`/autopilot/publications/${encodeURIComponent(pubId)}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  reschedulePublication: (pubId: string, scheduled_at: string) =>
    requestJson<{ success: true; publication: any }>(`/autopilot/publications/${encodeURIComponent(pubId)}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_at }),
    }),

  decideRecommendation: (recId: string, decision: 'accepted' | 'rejected' | 'defer') =>
    requestJson<{ success: true; recommendation: any; updatedStrategy: any }>(
      `/autopilot/analytics/recommendations/${encodeURIComponent(recId)}/decide`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    ),
  createExperiment: (payload: Record<string, any>) =>
    requestJson<{ success: true; experiment: any }>('/autopilot/experiments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  evaluateExperiment: (expId: string, payload: Record<string, any>) =>
    requestJson<{ success: true; experiment: any }>(`/autopilot/experiments/${encodeURIComponent(expId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  listAuditEvents: () => requestJson<{ success: true; events: any[] }>('/autopilot/audit-events'),
};
