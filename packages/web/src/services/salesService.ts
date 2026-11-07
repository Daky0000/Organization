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
  mode?: 'ai_agent' | 'human';
  last_error: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

// ─── Lead workspace vocabularies (mirror api/src/server/sales/leadActivities.ts
// and the CHECK constraints in db-migrations.ts) ────────────────────────────
export const ACTIVITY_TYPES = ['call', 'whatsapp', 'sms', 'email', 'meeting', 'note', 'task'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const RESPONSE_STATUSES = [
  'no_answer', 'unreachable', 'call_back', 'interested', 'not_interested', 'registered', 'paid',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/** Replaces the colour coding of the old spreadsheet. */
export const RESPONSE_STATUS_META: Record<ResponseStatus, { label: string; className: string }> = {
  no_answer:      { label: 'No answer',      className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  unreachable:    { label: 'Unreachable',    className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  call_back:      { label: 'Call back',      className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  interested:     { label: 'Interested',     className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  not_interested: { label: 'Not interested', className: 'bg-zinc-100 text-zinc-600 ring-zinc-200' },
  registered:     { label: 'Registered',     className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  paid:           { label: 'Paid',           className: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: 'Call', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', meeting: 'Meeting', note: 'Note', task: 'Task',
};

export const REMINDER_CHANNELS = ['call', 'whatsapp', 'sms', 'email', 'meeting', 'other'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  call: 'Call', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', meeting: 'Meeting', other: 'Follow up',
};

export interface LeadActivity {
  id: string;
  type: ActivityType;
  title: string | null;
  body: string | null;
  outcome: string | null;
  follow_up_round: number | null;
  response_status: ResponseStatus | null;
  ai_status: 'none' | 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
  completed_at: string | null;
  created_at: string;
}

export interface LeadReminder {
  id: string;
  contact_id: string;
  status: SalesFollowUp['status'];
  mode: 'human';
  channel: ReminderChannel | null;
  scheduled_for: string;
  due_tz: string | null;
  reason: string | null;
  requested_by: 'agent' | 'human' | string;
  needs_confirmation: boolean;
  ai_confidence: number | null;
  exact_time_requested: boolean;
  source_activity_id: string | null;
  completed_activity_id: string | null;
  notified_at: string | null;
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** "Fri 13 Nov, 15:00" in the given zone. */
export function formatInZone(iso: string, tz?: string | null): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz || undefined, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" wall clock in tz (for datetime-local inputs). */
export function toZonedLocalInput(iso: string, tz?: string | null): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export const LIST_SOURCE_TYPES = ['facebook_ads', 'event', 'company', 'referral', 'import', 'manual', 'other'] as const;
export type ListSourceType = (typeof LIST_SOURCE_TYPES)[number];
export const LIST_SOURCE_LABELS: Record<ListSourceType, string> = {
  facebook_ads: 'Facebook ads', event: 'Event', company: 'Company', referral: 'Referral',
  import: 'Import', manual: 'Manual', other: 'Other',
};

export interface LeadList {
  id: string;
  name: string;
  source_type: ListSourceType;
  color: string | null;
  archived_at: string | null;
  created_at: string;
  lead_count: number;
}

export const FIELD_TYPES = ['text', 'long_text', 'number', 'currency', 'date', 'boolean', 'email', 'phone', 'url', 'select'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text', long_text: 'Long text', number: 'Number', currency: 'Amount', date: 'Date',
  boolean: 'Yes / no', email: 'Email', phone: 'Phone', url: 'Link', select: 'Choice',
};

export interface LeadField {
  key: string;
  label: string;
  type: FieldType;
  options: string[] | null;
  builtin: boolean;
  position: number;
  width: number | null;
  hidden: boolean;
}

export interface WorkspaceLead {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  stage: LeadStage | null;
  do_not_call: boolean | null;
  timezone: string | null;
  last_contacted_at: string | null;
  custom_data: Record<string, unknown>;
  lists: Array<{ id: string; name: string; color: string | null }>;
  last_response_status: ResponseStatus | null;
  last_activity_at: string | null;
  next_followup_at: string | null;
  next_followup_needs_confirmation: boolean | null;
  next_followup_channel: ReminderChannel | null;
}

export interface ImportColumn { index: number; header: string; sample: string[]; suggested: string }
export interface ImportBlock { index: number; sheet: string; title: string; headerRow: number | null; rows: number[]; rowCount: number; columns: ImportColumn[] }
export interface ImportSheet { name: string; rowCount: number; selected: boolean; sections: number }
export interface ImportAnalysis {
  sheets: ImportSheet[];
  analyzedBy: 'ai' | 'rules';
  model: string | null;
  summary: string | null;
  blocks: ImportBlock[];
  warnings: string[];
}
export interface ImportCommitBlock {
  index: number; include: boolean; listName: string; sourceType: ListSourceType; mapping: Record<string, string>;
  sheet?: string; rows?: number[]; headers?: Record<string, string>;
}
export interface ImportSummary {
  created: number; updated: number; unchanged: number; skipped: number; activities: number; lists: string[];
  phoneWarnings: Array<{ list: string; row: number; name: string; raw: string }>;
}

export interface LeadOverview {
  timezone: string;
  totals: { leads: number; newThisWeek: number; contacted: number; neverContacted: number };
  byResponseStatus: Record<string, number>;
  byStage: Record<string, number>;
  byList: Array<{ id: string; name: string; source_type: ListSourceType; leads: number; contacted: number; responded: number; interested: number; converted: number }>;
  followups: { overdue: number; today: number; week: number; needs_confirmation: number };
  activityTrend30d: Array<{ day: string; activities: number; responses: number }>;
}

export const QUEUE_REASONS = [
  'overdue', 'due_today', 'call_back', 'interested', 'payment', 'no_answer', 'unreachable', 'stale', 'new',
] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];

export interface QueueItem {
  contact_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lists: string[];
  reason: QueueReason;
  detail: string;
  last_status: ResponseStatus | null;
  last_activity_at: string | null;
  last_note: string | null;
  next_round: number;
  attempts: number;
  followup: { id: string; at: string; reason: string | null; channel: ReminderChannel | null; needs_confirmation: boolean } | null;
}

export interface PlanTask {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  category: 'follow_up' | 'calls' | 'pipeline' | 'list' | 'admin';
  bucket: QueueReason | null;
  lead_ids: string[];
  target_count: number | null;
  done: boolean;
}

export interface DailyPlan {
  date: string;
  source: 'ai' | 'rules';
  model: string | null;
  headline: string;
  tasks: PlanTask[];
  tips: string[];
  warning: string | null;
  generated_at: string;
}

export interface SalesToday {
  date: string;
  timezone: string;
  target: number;
  progress: { calls: number; touches: number; responses: number; conversions: number; leads_reached: number; remaining: number };
  counts: Record<QueueReason, number> & { needs_confirmation: number; total: number };
  queue: QueueItem[];
  buckets: Record<QueueReason, QueueItem[]>;
  ai: { available: boolean; notes_waiting: number; notes_failed: number; notes_skipped: number };
  plan: DailyPlan | null;
}

let timezoneSync: Promise<void> | null = null;

export function browserTimezone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
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

  // ─── Lead activity log + human reminders ──────────────────────────────────
  async listReminders(status = 'scheduled') {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; followUps: LeadReminder[] }>(
        `/api/sales/followups${qs({ status, mode: 'human' })}`,
      ),
    );
    return data.followUps;
  },

  async listAiFollowUps(status = 'scheduled,due') {
    const data = assertSuccess(
      await api.get<{ success: boolean; error?: string; followUps: SalesFollowUp[] }>(
        `/api/sales/followups${qs({ status, mode: 'ai_agent' })}`,
      ),
    );
    return data.followUps;
  },

  async getLeadActivity(contactId: string) {
    return assertSuccess(
      await api.get<{
        success: boolean; error?: string; timezone: string;
        activities: LeadActivity[]; followups: LeadReminder[];
      }>(`/api/sales/leads/${contactId}/activities`),
    );
  },

  async logActivity(contactId: string, payload: {
    type: ActivityType; body?: string | null; follow_up_round?: number | null;
    response_status?: ResponseStatus | null; outcome?: string | null;
    manual_followup?: { due_local: string; due_tz?: string | null; channel?: ReminderChannel | null; reason?: string | null } | null;
    completes_followup_id?: string | null;
  }) {
    return assertSuccess(
      await api.post<{
        success: boolean; error?: string; activity: LeadActivity;
        reminder: LeadReminder | null; ai: 'done' | 'pending' | 'skipped' | 'failed' | 'none';
      }>(`/api/sales/leads/${contactId}/activities`, payload),
    );
  },

  async updateActivity(id: string, payload: { body?: string | null; follow_up_round?: number | null; response_status?: ResponseStatus | null; outcome?: string | null }) {
    return assertSuccess(
      await api.patch<{ success: boolean; error?: string; activity: LeadActivity }>(`/api/sales/activities/${id}`, payload),
    ).activity;
  },

  async deleteActivity(id: string) {
    assertSuccess(await api.del<{ success: boolean; error?: string }>(`/api/sales/activities/${id}`));
  },

  async confirmReminder(id: string) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; reminder: LeadReminder }>(`/api/sales/followups/${id}/confirm`)).reminder;
  },

  async cancelReminder(id: string) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; reminder: LeadReminder }>(`/api/sales/followups/${id}/cancel`)).reminder;
  },

  async rescheduleReminder(id: string, payload: { due_local: string; due_tz?: string | null; channel?: ReminderChannel | null; reason?: string | null }) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; reminder: LeadReminder }>(`/api/sales/followups/${id}/reschedule`, payload)).reminder;
  },

  async getReminderSettings() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; timezone: string | null; lead_digest_enabled: boolean }>('/api/sales/reminder-settings'));
  },

  // ─── Lead workspace ───────────────────────────────────────────────────────
  async listWorkspaceLeads(params: {
    listId?: string; search?: string; stage?: string; responseStatus?: string;
    due?: string; neverContacted?: boolean; sort?: string; limit?: number; offset?: number;
  } = {}) {
    return assertSuccess(
      await api.get<{ success: boolean; error?: string; leads: WorkspaceLead[]; total: number }>(
        `/api/sales/workspace/leads${qs({
          ...params,
          neverContacted: params.neverContacted ? 'true' : undefined,
          limit: params.limit ? String(params.limit) : undefined,
          offset: params.offset ? String(params.offset) : undefined,
        })}`,
      ),
    );
  },

  async getWorkspaceLead(contactId: string) {
    return assertSuccess(await api.get<{ success: boolean; error?: string; lead: WorkspaceLead }>(`/api/sales/workspace/leads/${contactId}`)).lead;
  },

  async createWorkspaceLead(payload: { first_name?: string; last_name?: string; email?: string; phone?: string; stage?: string; list_ids?: string[]; custom_data?: Record<string, unknown> }) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; lead: WorkspaceLead }>('/api/sales/workspace/leads', payload)).lead;
  },

  async updateWorkspaceLead(contactId: string, payload: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null; stage?: string | null; custom_data?: Record<string, unknown> }) {
    return assertSuccess(await api.patch<{ success: boolean; error?: string; lead: WorkspaceLead }>(`/api/sales/workspace/leads/${contactId}`, payload)).lead;
  },

  async bulkLeads(contactIds: string[], action: 'set_stage' | 'add_to_list' | 'remove_from_list' | 'delete', value?: string | null) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; affected: number }>('/api/sales/workspace/leads/bulk', { contactIds, action, value })).affected;
  },

  async listLeadLists() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; lists: LeadList[] }>('/api/sales/lists')).lists;
  },

  async createLeadList(payload: { name: string; source_type?: ListSourceType; color?: string | null }) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; list: LeadList }>('/api/sales/lists', payload)).list;
  },

  async updateLeadList(id: string, payload: { name?: string; source_type?: ListSourceType; color?: string | null; archived?: boolean }) {
    return assertSuccess(await api.patch<{ success: boolean; error?: string; list: LeadList }>(`/api/sales/lists/${id}`, payload)).list;
  },

  async deleteLeadList(id: string) {
    assertSuccess(await api.del<{ success: boolean; error?: string }>(`/api/sales/lists/${id}`));
  },

  async changeListMembers(id: string, payload: { add?: string[]; remove?: string[] }) {
    return assertSuccess(await api.post<{ success: boolean; error?: string; added: number; removed: number }>(`/api/sales/lists/${id}/members`, payload));
  },

  async getLeadFields() {
    return assertSuccess(await api.get<{ success: boolean; error?: string; fields: LeadField[] }>('/api/sales/fields')).fields;
  },

  async saveLeadFields(fields: Array<Pick<LeadField, 'label' | 'type'> & { key?: string | null; options?: string[] | null; width?: number | null; hidden?: boolean }>) {
    return assertSuccess(await api.put<{ success: boolean; error?: string; fields: LeadField[] }>('/api/sales/fields', { fields })).fields;
  },

  /** `useAi` asks the AI to find the lists; `sheets` limits which worksheets are read (all when omitted). */
  async analyzeImport(fileBase64: string, fileName: string, opts: { useAi?: boolean; sheets?: string[] } = {}) {
    return assertSuccess(await api.post<{ success: boolean; error?: string } & ImportAnalysis>(
      '/api/sales/import/analyze', { fileBase64, fileName, ...opts },
    ));
  },

  async commitImport(payload: { fileBase64: string; fileName: string; blocks: ImportCommitBlock[] }) {
    return assertSuccess(await api.post<{ success: boolean; error?: string } & ImportSummary>('/api/sales/import/commit', payload));
  },

  async getLeadOverview() {
    return assertSuccess(await api.get<{ success: boolean; error?: string } & LeadOverview>('/api/sales/workspace/overview'));
  },

  async getToday() {
    return assertSuccess(await api.get<{ success: boolean; error?: string } & SalesToday>('/api/sales/workspace/today'));
  },

  /** Writes (or rewrites) today's to-do list with the AI; falls back to rules server-side. */
  async generateDailyPlan() {
    return assertSuccess(await api.post<{ success: boolean; error?: string; plan: DailyPlan }>('/api/sales/workspace/today/plan')).plan;
  },

  async setPlanTaskDone(date: string, index: number, done: boolean) {
    return assertSuccess(await api.patch<{ success: boolean; error?: string; plan: DailyPlan }>(`/api/sales/workspace/today/plan/tasks/${index}`, { date, done })).plan;
  },

  async setDailyCallTarget(target: number) {
    return assertSuccess(await api.put<{ success: boolean; error?: string; target: number }>('/api/sales/workspace/today/target', { target })).target;
  },

  /** Re-queues notes the AI reader failed on or skipped (last 14 days). */
  async retryAiReads() {
    return assertSuccess(await api.post<{ success: boolean; error?: string; queued: number }>('/api/sales/workspace/today/retry-ai')).queued;
  },

  /** Saves the browser's timezone once, if the user has never set one. Never throws. */
  ensureReminderTimezone(): Promise<void> {
    timezoneSync ??= (async () => {
      try {
        const s = await salesService.getReminderSettings();
        const tz = browserTimezone();
        if (!s.timezone && tz) await salesService.updateReminderSettings({ timezone: tz });
      } catch { /* best effort: the server falls back to the call-policy zone */ }
    })();
    return timezoneSync;
  },

  async updateReminderSettings(payload: { timezone?: string | null; lead_digest_enabled?: boolean }) {
    return assertSuccess(await api.put<{ success: boolean; error?: string; timezone: string | null; lead_digest_enabled: boolean }>('/api/sales/reminder-settings', payload));
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
