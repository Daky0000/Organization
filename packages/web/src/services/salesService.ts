import { api } from './apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// AI Sales OS API client.
//
// The vocabularies below mirror packages/api/src/server/sales/types.ts. This
// repo has no shared types package, so they are duplicated deliberately — if
// you add an objection code or a stage, change both files and the CHECK
// constraint in db-migrations.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const LEAD_STAGES = [
  'new', 'contacted', 'qualified', 'interested',
  'proposal', 'negotiation', 'won', 'lost', 'unreachable',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const OBJECTION_LABELS: Record<string, string> = {
  price: 'Price too high',
  budget: 'No budget right now',
  timing: 'Bad timing',
  no_authority: 'Needs approval',
  existing_provider: 'Has a provider',
  no_need: 'Sees no need',
  trust: 'Trust concern',
  missing_feature: 'Missing a feature',
  contract_lock_in: 'Locked into a contract',
  bad_experience: 'Prior bad experience',
  other: 'Other',
};

export const STAGE_COLORS: Record<LeadStage, string> = {
  new: 'bg-slate-100 text-slate-700',
  contacted: 'bg-sky-100 text-sky-700',
  qualified: 'bg-indigo-100 text-indigo-700',
  interested: 'bg-violet-100 text-violet-700',
  proposal: 'bg-amber-100 text-amber-700',
  negotiation: 'bg-orange-100 text-orange-700',
  won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-rose-100 text-rose-700',
  unreachable: 'bg-gray-100 text-gray-500',
};

export interface SalesLead {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  profile_id: string | null;
  stage: LeadStage | null;
  do_not_call: boolean | null;
  consent_at: string | null;
  timezone: string | null;
  human_handling: boolean | null;
  is_decision_maker: boolean | null;
  role_title: string | null;
  last_contacted_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  attempt_count: number | null;
  consecutive_no_answer: number | null;
  summary: string | null;
  conversation_count: number;
  open_objections: number;
}

export interface SalesConversation {
  id: string;
  contact_id: string;
  channel: string;
  direction?: string;
  started_at: string;
  duration_sec: number | null;
  summary: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  intent: string | null;
  recommended_action: string | null;
  analyst_confidence: number | null;
  analysis_status: 'pending' | 'analyzing' | 'done' | 'failed' | 'skipped';
  analysis_error?: string | null;
  recording_url: string | null;
  transcript?: string | null;
  commitments?: string[];
  promises?: string[];
  questions?: string[];
  buying_signals?: string[];
  created_by?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface SalesFollowUp {
  id: string;
  contact_id: string;
  type: 'phone_call' | 'email' | 'sms' | 'task';
  requested_by: string;
  scheduled_for: string;
  exact_time_requested: boolean;
  reason: string | null;
  objective: string | null;
  status: 'scheduled' | 'due' | 'in_progress' | 'completed' | 'cancelled' | 'missed';
  last_error: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface SalesObjection {
  id: string;
  conversation_id: string;
  objection_code: string;
  raw_text: string | null;
  resolved: boolean;
  created_at: string;
}

export interface SalesCallAttempt {
  id: string;
  provider: string;
  status: string;
  outcome: string | null;
  run_at: string;
  started_at: string | null;
  duration_sec: number | null;
  block_reason: string | null;
  last_error: string | null;
  objective?: string | null;
  local_weekday?: number | null;
  local_hour?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface SalesCallPolicy {
  enabled: boolean;
  requireConsent: boolean;
  allowedDays: number[];
  windowStart: string;
  windowEnd: string;
  defaultTimezone: string;
  maxAttemptsPerLeadPerWeek: number;
  maxConsecutiveNoAnswer: number;
  minHoursBetweenAttempts: number;
  dailyCallCap: number;
  aiDisclosureRequired: boolean;
  aiDisclosureText: string | null;
  recordingDisclosureRequired: boolean;
  blackoutDates: string[];
  requireApprovalFor: string[];
  provider: string;
  fromNumber: string | null;
  voiceId: string | null;
  maxCallDurationSec: number;
}

export type CallDecision =
  | { action: 'call' }
  | { action: 'reschedule'; runAt: string; reason: string }
  | { action: 'stop'; code: string; reason: string };

export interface CallPreview {
  decision: CallDecision;
  timezone: string;
  timing: {
    status: 'learning' | 'ready';
    totalAttempts: number;
    windows: { label: string; probability: number; confidence: number; sampleSize: number }[];
  };
}

export interface SalesInsight {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  confidence: number | null;
  sample_size: number;
  status: 'new' | 'accepted' | 'rejected' | 'applied';
  proposed_change: Record<string, unknown> | null;
  created_at: string;
}

export interface SalesPlaybook {
  id: string;
  kind: string;
  objection_code: string | null;
  title: string | null;
  content: string;
  source: string;
  active: boolean;
  created_at: string;
}

export interface SalesIntelligence {
  funnel: {
    calls: number; answered: number; interested: number;
    meetings: number; won: number; conversations: number;
  };
  objections: { code: string; label: string; count: number; share: number }[];
  bestWindows: { label: string; rate: number; attempts: number }[];
  trend: { label: string; conversations: number; positive: number }[];
  insights: SalesInsight[];
  policyEnabled: boolean;
}

export interface VapiStatus {
  ok: boolean;
  error?: string;
  phoneNumbers: { id: string; number: string | null; name: string | null }[];
  phoneNumberIdValid: boolean;
  hasPublicKey: boolean;
}

export interface TestCallRecord {
  id: string;
  to_number: string | null;
  status: string;
  outcome: string | null;
  started_at: string | null;
  duration_sec: number | null;
  transcript: string | null;
  recording_url: string | null;
  ended_reason: string | null;
  last_error: string | null;
  objective: string | null;
}

function assertSuccess<T extends { success: boolean; error?: string }>(data: T): T {
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

export const salesService = {
  // ─── Leads ────────────────────────────────────────────────────────────────
  async listLeads(params: { search?: string; stage?: string; limit?: number; offset?: number } = {}) {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; leads: SalesLead[]; total: number }>(
        `/api/sales/leads${qs(params)}`,
      ),
    );
    return { leads: data.leads, total: data.total };
  },

  async getLead(contactId: string) {
    return assertSuccess(
      await api.get<{
        success: boolean; error?: string;
        lead: SalesLead & Record<string, unknown>;
        conversations: SalesConversation[];
        followUps: SalesFollowUp[];
        objections: SalesObjection[];
        attempts: SalesCallAttempt[];
      }>(`/api/sales/leads/${contactId}`),
    );
  },

  async createLead(payload: {
    first_name?: string; last_name?: string; email?: string; phone?: string;
    role_title?: string; timezone?: string; consent_source?: string;
  }) {
    const data = assertSuccess(
      await api.post<{ success: boolean; error?: string; contactId: string }>('/api/sales/leads', payload),
    );
    return data.contactId;
  },

  async updateLead(contactId: string, payload: Record<string, unknown>) {
    assertSuccess(await api.put<{ success: boolean; error?: string }>(`/api/sales/leads/${contactId}`, payload));
  },

  async markDoNotCall(contactId: string, reason: string) {
    assertSuccess(
      await api.post<{ success: boolean; error?: string }>(`/api/sales/leads/${contactId}/dnc`, { reason }),
    );
  },

  // ─── Conversations ────────────────────────────────────────────────────────
  async listConversations(params: { limit?: number; offset?: number; intent?: string } = {}) {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; conversations: SalesConversation[] }>(
        `/api/sales/conversations${qs(params)}`,
      ),
    );
    return data.conversations;
  },

  async getConversation(id: string) {
    return assertSuccess(
      await api.get<{
        success: boolean; error?: string;
        conversation: SalesConversation; objections: SalesObjection[];
      }>(`/api/sales/conversations/${id}`),
    );
  },

  /** Log a call a human made — the doorway that drives the whole loop. */
  async logConversation(payload: {
    contact_id: string; transcript: string; channel?: string;
    duration_sec?: number; started_at?: string; recording_url?: string;
  }) {
    const data = assertSuccess(
      await api.post<{ success: boolean; error?: string; conversationId: string }>(
        '/api/sales/conversations',
        payload,
      ),
    );
    return data.conversationId;
  },

  async reanalyze(id: string) {
    assertSuccess(await api.post<{ success: boolean; error?: string }>(`/api/sales/conversations/${id}/reanalyze`));
  },

  // ─── Follow-ups ───────────────────────────────────────────────────────────
  async listFollowUps(status = 'scheduled,due') {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; followUps: SalesFollowUp[] }>(
        `/api/sales/followups${qs({ status })}`,
      ),
    );
    return data.followUps;
  },

  async createFollowUp(payload: {
    contact_id: string; type?: string; scheduled_for: string;
    reason?: string; objective?: string; exact_time_requested?: boolean;
  }) {
    assertSuccess(await api.post<{ success: boolean; error?: string }>('/api/sales/followups', payload));
  },

  async updateFollowUp(id: string, payload: { status?: string; scheduled_for?: string }) {
    assertSuccess(await api.put<{ success: boolean; error?: string }>(`/api/sales/followups/${id}`, payload));
  },

  // ─── Calls ────────────────────────────────────────────────────────────────
  /** What would happen if we called right now — without dialing. */
  async previewCall(contactId: string) {
    return assertSuccess(
      await api.get<{ success: boolean; error?: string } & CallPreview>(`/api/sales/calls/preview/${contactId}`),
    );
  },

  async queueCall(contactId: string, objective?: string) {
    return assertSuccess(
      await api.post<{ success: boolean; error?: string; queued: boolean; decision: CallDecision }>(
        '/api/sales/calls/queue',
        { contact_id: contactId, objective },
      ),
    );
  },

  async listCalls() {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; calls: SalesCallAttempt[] }>('/api/sales/calls'),
    );
    return data.calls;
  },

  // ─── Policy ───────────────────────────────────────────────────────────────
  async getPolicy() {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; policy: SalesCallPolicy }>('/api/sales/policy'),
    );
    return data.policy;
  },

  async updatePolicy(payload: Partial<SalesCallPolicy>) {
    const data = assertSuccess(
      await api.put<{ success: boolean; error?: string; policy: SalesCallPolicy }>('/api/sales/policy', payload),
    );
    return data.policy;
  },

  // ─── Intelligence ─────────────────────────────────────────────────────────
  async getIntelligence() {
    return assertSuccess(
      await api.get<{ success: boolean; error?: string } & SalesIntelligence>('/api/sales/intelligence'),
    );
  },

  async listInsights() {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; insights: SalesInsight[] }>('/api/sales/insights'),
    );
    return data.insights;
  },

  async reviewInsight(id: string, action: 'accept' | 'reject') {
    assertSuccess(await api.post<{ success: boolean; error?: string }>(`/api/sales/insights/${id}/${action}`));
  },

  async generateInsights() {
    const data = assertSuccess(
      await api.post<{ success: boolean; error?: string; written: number }>('/api/sales/insights/generate'),
    );
    return data.written;
  },

  // ─── Vapi setup + developer test calls ────────────────────────────────────
  async getVapiStatus() {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; status: VapiStatus }>('/api/sales/vapi/status'),
    );
    return data.status;
  },

  /** The exact brief a real lead would get — for testing against reality. */
  async getTestBrief(contactId: string) {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; brief: { systemPrompt: string; firstMessage: string; objective: string } }>(
        `/api/sales/test-call/brief/${contactId}`,
      ),
    );
    return data.brief;
  },

  /** Public key + assistant config for an in-browser mic call. */
  async getWebTestConfig(payload: { context: string; first_message?: string; voice_id?: string }) {
    return assertSuccess(
      await api.post<{ success: boolean; error?: string; publicKey: string; assistant: Record<string, unknown> }>(
        '/api/sales/test-call/web',
        payload,
      ),
    );
  },

  async placeTestCall(payload: { to_number: string; context: string; first_message?: string; voice_id?: string }) {
    return assertSuccess(
      await api.post<{ success: boolean; error?: string; attemptId: string; externalId: string }>(
        '/api/sales/test-call/phone',
        payload,
      ),
    );
  },

  async listTestCalls() {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; calls: TestCallRecord[] }>('/api/sales/test-call/history'),
    );
    return data.calls;
  },

  // ─── Playbooks ────────────────────────────────────────────────────────────
  async listPlaybooks() {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; playbooks: SalesPlaybook[] }>('/api/sales/playbooks'),
    );
    return data.playbooks;
  },

  async createPlaybook(payload: { kind?: string; objection_code?: string; title?: string; content: string }) {
    assertSuccess(await api.post<{ success: boolean; error?: string }>('/api/sales/playbooks', payload));
  },

  async deletePlaybook(id: string) {
    assertSuccess(await api.del<{ success: boolean; error?: string }>(`/api/sales/playbooks/${id}`));
  },
};

export function leadName(lead: { first_name?: string | null; last_name?: string | null; phone?: string | null }): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  return name || lead.phone || 'Unnamed lead';
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
