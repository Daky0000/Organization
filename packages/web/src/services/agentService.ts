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

// ── Skills, runs, targeting ─────────────────────────────────────────────────

export type SkillSource = 'core' | 'sales' | 'marketing_team' | 'platform' | 'background';
export interface Skill {
  key: string; name: string; role: string; description: string; source: SkillSource;
  icon: string; color: string; prompt: string; packs: string[]; tools: string[];
  adminOnly?: boolean; plannable: boolean; editable_at?: string;
}

export interface RunStep {
  id: string; skill: string; title: string; task: string; packs: string[]; depends_on: string[];
  skill_name: string; skill_icon: string; skill_color: string; wave: number;
  status: 'waiting' | 'running' | 'done' | 'failed'; output: string | null;
  targeting?: { batch_id: string; event_id: string; suggestions: Array<{ id: string; title: string; leads: number; warm: number }> } | null;
  started_at: string | null; finished_at: string | null;
}
export interface RunAction { type: 'target_leads' | 'open_targeting' | 'create_posts' | 'save_note' | 'open_page'; label: string; reason: string; params: Record<string, string> }
export interface RunResult {
  answer: string;
  decision: { question: string; options: Array<{ name: string; pros: string; cons: string }>; recommendation: string; confidence: 'low' | 'medium' | 'high' } | null;
  actions: RunAction[];
  model: string | null;
}
export interface AgentRun {
  id: string; parent_run_id: string | null; message: string;
  status: 'planning' | 'running' | 'synthesizing' | 'done' | 'failed';
  plan: { goal: string; event_id: string | null } | null;
  steps: RunStep[]; result: RunResult | null; error: string | null;
  created_at: string; updated_at: string;
}
export interface RunSummary { id: string; parent_run_id: string | null; message: string; status: AgentRun['status']; created_at: string; answered: boolean }

export interface TargetSuggestion {
  id: string; batch_id: string; event_id: string | null; event_title: string; title: string; reason: string; pitch: string;
  criteria: { keywords: string[]; fields: string[]; statuses: string[] };
  lead_ids: string[]; warm_count: number; priority: number; source: 'ai' | 'rules'; summary: string | null;
  status: 'new' | 'list_created' | 'dismissed'; list_id: string | null; created_at: string;
}
export interface TargetLead {
  contact_id: string; name: string; email: string | null; phone: string | null; role_title: string | null;
  lists: string[]; last_status: string | null; last_activity_at: string | null; evidence: string[];
}
export interface TargetingResult {
  batch_id: string; source: 'ai' | 'rules'; summary: string | null; warning: string | null; suggestions: TargetSuggestion[]; total_leads: number;
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
  async skills() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; ai_available: boolean; packs: Record<string, string>; skills: Skill[] }>('/api/agent/skills'));
  },
  async startRun(message: string, parentRunId?: string | null) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; run: AgentRun }>('/api/agent/runs', { message, parent_run_id: parentRunId ?? null })).run;
  },
  async getRun(id: string) {
    return assertSuccess(await api.get<{ success: boolean; error?: string; run: AgentRun }>(`/api/agent/runs/${id}`)).run;
  },
  async listRuns() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; runs: RunSummary[] }>('/api/agent/runs')).runs;
  },
  async runAction(runId: string, index: number) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; type: string; targeting?: TargetingResult; item?: ContextItem }>(`/api/agent/runs/${runId}/actions/${index}`));
  },
  async targetingEvents() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; today: string; events: ContextItem[] }>('/api/agent/targeting/events'));
  },
  async suggestTargets(eventId: string, opts: { focus?: string | null; useAi?: boolean } = {}) {
    return assertSuccess(await api.post<{ success: boolean; error?: string } & TargetingResult>('/api/agent/targeting/suggest', { event_id: eventId, focus: opts.focus ?? null, use_ai: opts.useAi }));
  },
  async latestTargets(eventId?: string | null) {
    const qs = eventId ? `?event_id=${encodeURIComponent(eventId)}` : '';
    return assertSuccess(await api.get<{ success: boolean; error?: string; suggestions: TargetSuggestion[] }>(`/api/agent/targeting${qs}`)).suggestions;
  },
  async targetDetail(id: string) {
    return assertSuccess(await api.get<{ success: boolean; error?: string; suggestion: TargetSuggestion; leads: TargetLead[] }>(`/api/agent/targeting/${id}`));
  },
  async targetToList(id: string, name?: string | null) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; list: { id: string; name: string }; added: number; existing: boolean }>(`/api/agent/targeting/${id}/list`, { name: name ?? null }));
  },
  async dismissTarget(id: string) {
    assertSuccess(await api.post<{ success: boolean; error?: string }>(`/api/agent/targeting/${id}/dismiss`));
  },
  async restoreContextDefaults() {
    return assertSuccess(await api.post<{ success: boolean; error?: string; added: number; items: ContextItem[] }>('/api/company-context/restore-defaults'));
  },
};
