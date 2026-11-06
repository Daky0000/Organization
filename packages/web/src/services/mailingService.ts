import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`Server error (${res.status})`); }
}

export type MailingContact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  custom_data: Record<string, string>;
  source: string;
  subscribed: boolean;
  email_marketing_consent: boolean;
  unsubscribed_at: string | null;
  created_at: string;
  tags: string[];
};

export type MailingSegment = {
  id: string;
  name: string;
  rules: unknown;
  contact_count?: number;
  created_at: string;
  updated_at: string;
};

export type MailingCampaign = {
  id: string;
  name: string;
  subject: string;
  preview_text: string | null;
  content: string;
  segment_id: string | null;
  segment_name: string | null;
  status: 'draft' | 'scheduled' | 'sent';
  scheduled_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  created_at: string;
  updated_at: string;
};

export type MailingAutomation = {
  id: string;
  name: string;
  trigger_type: string;
  conditions: unknown[];
  actions: unknown[];
  steps?: unknown[]; // flow-builder automations (Marketing → Automations)
  status: 'draft' | 'active' | 'paused';
  created_at: string;
  updated_at: string;
};

export type MailingAnalytics = {
  contacts: { total: number; subscribed: number; unsubscribed: number };
  campaigns: { total: number; sent: number; draft: number; scheduled: number };
  events: Record<string, number>;
  rates: { openRate: number; clickRate: number; bounceRate: number };
};

export type CampaignAnalyticsRow = {
  campaign_id: string;
  name: string;
  sent_at: string | null;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  open_rate: number;
  click_rate: number;
};

const BASE = `${API_BASE_URL}/api/mailing`;

export type ContactAnalytics = {
  overview: { total: number; subscribed: number; unsubscribed: number; non_subscribed: number };
  over_time: { label: string; new_contacts: number; cumulative: number }[];
  by_source: { source: string; total: number; subscribed: number; unsubscribed: number }[];
};

export const mailingService = {
  // Contacts
  async listContacts(params?: { search?: string; tag?: string }): Promise<MailingContact[]> {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.tag) q.set('tag', params.tag);
    const res = await fetch(`${BASE}/contacts?${q}`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; contacts: MailingContact[] }>(res);
    return data.contacts ?? [];
  },

  async createContact(payload: Partial<MailingContact> & { email: string; tags?: string[]; phone?: string; custom_data?: Record<string, string> }): Promise<MailingContact> {
    const res = await fetch(`${BASE}/contacts`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; contact: MailingContact; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create contact');
    return data.contact;
  },

  async updateContact(id: string, payload: Partial<MailingContact>): Promise<MailingContact> {
    const res = await fetch(`${BASE}/contacts/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; contact: MailingContact; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update contact');
    return data.contact;
  },

  async getContact(id: string): Promise<MailingContact> {
    const res = await fetch(`${BASE}/contacts/${id}`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; contact: MailingContact; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Contact not found');
    return data.contact;
  },

  async deleteContact(id: string): Promise<void> {
    await fetch(`${BASE}/contacts/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async addTag(contactId: string, tag: string): Promise<void> {
    const res = await fetch(`${BASE}/contacts/${contactId}/tags`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ tag }) });
    const data = await parseJson<{ success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to add tag');
  },

  async removeTag(contactId: string, tag: string): Promise<void> {
    const res = await fetch(`${BASE}/contacts/${contactId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE', headers: authHeaders() });
    const data = await parseJson<{ success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to remove tag');
  },

  async getContactAnalytics(): Promise<ContactAnalytics> {
    const res = await fetch(`${BASE}/contacts/analytics`, { headers: authHeaders() });
    const data = await parseJson<ContactAnalytics & { success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data;
  },

  async sendEmailToContact(id: string, payload: { subject: string; html: string; include_unsubscribe_footer?: boolean }): Promise<void> {
    const res = await fetch(`${BASE}/contacts/${id}/send-email`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to send email');
  },

  async listTags(): Promise<string[]> {
    const res = await fetch(`${BASE}/contacts/tags`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; tags: string[] }>(res);
    return data.tags ?? [];
  },

  async importContacts(contacts: { email: string; first_name?: string; last_name?: string }[]): Promise<{ imported: number; skipped: number }> {
    const res = await fetch(`${BASE}/contacts/import`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ contacts }) });
    const data = await parseJson<{ success: boolean; imported: number; skipped: number; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Import failed');
    return { imported: data.imported, skipped: data.skipped };
  },

  // Segments
  async listSegments(): Promise<MailingSegment[]> {
    const res = await fetch(`${BASE}/segments`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; segments: MailingSegment[] }>(res);
    return data.segments ?? [];
  },

  async createSegment(payload: { name: string; rules?: unknown }): Promise<MailingSegment> {
    const res = await fetch(`${BASE}/segments`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; segment: MailingSegment; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create segment');
    return data.segment;
  },

  async updateSegment(id: string, payload: { name?: string; rules?: unknown }): Promise<MailingSegment> {
    const res = await fetch(`${BASE}/segments/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; segment: MailingSegment; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update segment');
    return data.segment;
  },

  async deleteSegment(id: string): Promise<void> {
    await fetch(`${BASE}/segments/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async getSegmentContacts(id: string): Promise<MailingContact[]> {
    const res = await fetch(`${BASE}/segments/${id}/contacts`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; contacts: MailingContact[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data.contacts ?? [];
  },

  async bulkAction(action: 'tag' | 'archive' | 'delete', ids: string[], tag?: string): Promise<void> {
    const res = await fetch(`${BASE}/contacts/bulk`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ action, ids, tag }) });
    const data = await parseJson<{ success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Bulk action failed');
  },

  async previewSegment(rules: unknown): Promise<{ count: number; sample: { email: string; first_name: string | null; last_name: string | null }[] }> {
    const res = await fetch(`${BASE}/segments/preview`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ rules }) });
    const data = await parseJson<{ success: boolean; count: number; sample: { email: string; first_name: string | null; last_name: string | null }[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Preview failed');
    return { count: data.count, sample: data.sample };
  },

  // Campaigns
  async listCampaigns(): Promise<MailingCampaign[]> {
    const res = await fetch(`${BASE}/campaigns`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; campaigns: MailingCampaign[] }>(res);
    return data.campaigns ?? [];
  },

  async createCampaign(payload: Partial<MailingCampaign>): Promise<MailingCampaign> {
    const res = await fetch(`${BASE}/campaigns`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; campaign: MailingCampaign; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create campaign');
    return data.campaign;
  },

  async updateCampaign(id: string, payload: Partial<MailingCampaign>): Promise<MailingCampaign> {
    const res = await fetch(`${BASE}/campaigns/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; campaign: MailingCampaign; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update campaign');
    return data.campaign;
  },

  async deleteCampaign(id: string): Promise<void> {
    await fetch(`${BASE}/campaigns/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async sendCampaign(id: string): Promise<{ sent: number; failed: number; queued: number }> {
    const res = await fetch(`${BASE}/campaigns/${id}/send`, { method: 'POST', headers: authHeaders() });
    const data = await parseJson<{ success: boolean; sent: number; failed: number; queued?: number; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to send campaign');
    return { sent: data.sent, failed: data.failed, queued: data.queued || 0 };
  },

  // Automations
  async listAutomations(): Promise<MailingAutomation[]> {
    const res = await fetch(`${BASE}/automations`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; automations: MailingAutomation[] }>(res);
    return data.automations ?? [];
  },

  async createAutomation(payload: Partial<MailingAutomation>): Promise<MailingAutomation> {
    const res = await fetch(`${BASE}/automations`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; automation: MailingAutomation; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create automation');
    return data.automation;
  },

  async updateAutomation(id: string, payload: Partial<MailingAutomation>): Promise<MailingAutomation> {
    const res = await fetch(`${BASE}/automations/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; automation: MailingAutomation; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update automation');
    return data.automation;
  },

  async deleteAutomation(id: string): Promise<void> {
    await fetch(`${BASE}/automations/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  // Analytics
  async getAnalytics(): Promise<MailingAnalytics> {
    const res = await fetch(`${BASE}/analytics`, { headers: authHeaders() });
    const data = await parseJson<MailingAnalytics & { success: boolean }>(res);
    return data;
  },

  async getCampaignAnalytics(): Promise<CampaignAnalyticsRow[]> {
    const res = await fetch(`${BASE}/analytics/campaigns`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; rows: CampaignAnalyticsRow[] }>(res);
    return data.rows ?? [];
  },
};
