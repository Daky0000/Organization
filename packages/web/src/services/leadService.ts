import { API_BASE_URL } from '../utils/apiBase';

const BASE = `${API_BASE_URL}/api/leads`;

function getToken() { return localStorage.getItem('auth_token') || ''; }
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`Server error (${res.status})`); }
}

export type LeadGroup = {
  id: string;
  name: string;
  fields: string[];
  lead_count: number;
  linked_sheet_id: string | null;
  linked_sheet_tab: string | null;
  linked_sheet_name: string | null;
  sheet_key_field: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export type Lead = {
  id: string;
  group_id: string;
  data: Record<string, string>;
  sync_key: string | null;
  created_at: string;
  updated_at: string;
};

export const leadService = {
  async listGroups(): Promise<LeadGroup[]> {
    const res = await fetch(`${BASE}/groups`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; groups: LeadGroup[] }>(res);
    return data.groups ?? [];
  },

  async createGroup(name: string): Promise<LeadGroup> {
    const res = await fetch(`${BASE}/groups`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
    const data = await parseJson<{ success: boolean; group: LeadGroup; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data.group;
  },

  async deleteGroup(id: string): Promise<void> {
    await fetch(`${BASE}/groups/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async getGroupLeads(id: string): Promise<{ group: LeadGroup; leads: Lead[] }> {
    const res = await fetch(`${BASE}/groups/${id}/leads`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; group: LeadGroup; leads: Lead[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return { group: data.group, leads: data.leads };
  },

  async addLead(groupId: string, data: Record<string, string>): Promise<Lead> {
    const res = await fetch(`${BASE}/groups/${groupId}/leads`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data }) });
    const json = await parseJson<{ success: boolean; lead: Lead; error?: string }>(res);
    if (!json.success) throw new Error(json.error || 'Failed');
    return json.lead;
  },

  async importLeads(groupId: string, leads: Record<string, string>[]): Promise<number> {
    const res = await fetch(`${BASE}/groups/${groupId}/import`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ leads }) });
    const data = await parseJson<{ success: boolean; imported: number; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Import failed');
    return data.imported;
  },

  async deleteLead(id: string): Promise<void> {
    await fetch(`${BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async syncLeads(groupId: string, leads: Record<string, string>[], keyField: string): Promise<{ updated: number; added: number }> {
    const res = await fetch(`${BASE}/groups/${groupId}/sync`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ leads, keyField }) });
    const data = await parseJson<{ success: boolean; updated: number; added: number; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Sync failed');
    return { updated: data.updated, added: data.added };
  },

  async parseExcelFile(file: File): Promise<{ name: string; fields: string[]; leads: Record<string, string>[] }[]> {
    const buf = await file.arrayBuffer();
    const res = await fetch(`${API_BASE_URL}/api/leads/parse-excel`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream', 'X-File-Name': file.name },
      body: buf,
    });
    const data = await parseJson<{ success: boolean; sheets: { name: string; fields: string[]; leads: Record<string, string>[] }[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Parse failed');
    return data.sheets;
  },

  async bulkImportSheets(sheets: { name: string; leads: Record<string, string>[]; fields: string[] }[]): Promise<{ groupId: string; name: string; imported: number }[]> {
    const res = await fetch(`${BASE}/bulk-import`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ sheets }) });
    const data = await parseJson<{ success: boolean; results: { groupId: string; name: string; imported: number }[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Bulk import failed');
    return data.results;
  },
};

const GS_BASE = `${API_BASE_URL}/api/google-sheets`;

export const googleSheetsService = {
  async getConnectUrl(): Promise<string> {
    const res = await fetch(`${GS_BASE}/connect`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; url: string; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data.url;
  },

  async getStatus(): Promise<{ connected: boolean; email?: string; connectedAt?: string }> {
    const res = await fetch(`${GS_BASE}/status`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; connected: boolean; email?: string; connectedAt?: string }>(res);
    return data;
  },

  async disconnect(): Promise<void> {
    await fetch(`${GS_BASE}/disconnect`, { method: 'DELETE', headers: authHeaders() });
  },

  async listFiles(): Promise<{ id: string; name: string; modifiedTime: string }[]> {
    const res = await fetch(`${GS_BASE}/files`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; files: { id: string; name: string; modifiedTime: string }[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data.files;
  },

  async listSheets(fileId: string): Promise<{ id: number; title: string }[]> {
    const res = await fetch(`${GS_BASE}/files/${fileId}/sheets`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; sheets: { id: number; title: string }[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data.sheets;
  },

  async linkSheet(groupId: string, sheetId: string, sheetTab: string, sheetName: string, keyField: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/leads/groups/${groupId}/link-sheet`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ sheetId, sheetTab, sheetName, keyField }) });
    const data = await parseJson<{ success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
  },

  async syncSheet(groupId: string): Promise<{ updated: number; added: number; total: number }> {
    const res = await fetch(`${API_BASE_URL}/api/leads/groups/${groupId}/sync-sheet`, { method: 'POST', headers: authHeaders() });
    const data = await parseJson<{ success: boolean; updated: number; added: number; total: number; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Sync failed');
    return data;
  },
};
