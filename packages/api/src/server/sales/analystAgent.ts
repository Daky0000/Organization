// ─────────────────────────────────────────────────────────────────────────────
// The Conversation Analyst.
//
// Runs after every conversation and turns a transcript into the structured
// Conversation Record the rest of the system reads. This is the only agent that
// touches raw transcripts, and it runs on every single call — so it uses
// FAST_MODEL and caps transcript length rather than optimizing for eloquence.
//
// Its output is a PROPOSAL. It goes to validateSalesOps before anything is
// written. The enums in the JSON schema are load-bearing: they are what stops
// the model returning objection_code "kinda_pricey" and quietly destroying the
// dashboard's ability to group.
//
// The failure mode that matters most here is not a malformed response — it is a
// plausible, well-formed hallucination. An invented commitment poisons the lead
// memory and the next call opens on a false premise. The prompt is written
// against that specifically, and analyst_confidence is surfaced in the UI with
// the raw transcript one click away.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { logger } from '../../logger.ts';
import {
  callAINonStreaming,
  classifyAIProviderError,
  FAST_MODEL,
  getAIConfig,
  recordAIUsage,
  resolveActiveKey,
} from '../../ai-helpers.ts';
import {
  INTENTS,
  LEAD_STAGES,
  OBJECTION_CODES,
  RECOMMENDED_ACTIONS,
  SENTIMENTS,
  isIntent,
  isLeadStage,
  isObjectionCode,
  isRecommendedAction,
  isSentiment,
  type Intent,
  type LeadStage,
  type ObjectionCode,
  type RecommendedAction,
  type Sentiment,
} from './types.ts';

/** ~6k tokens. A longer call gets its middle dropped, not the whole analysis. */
const MAX_TRANSCRIPT_CHARS = 24_000;

export interface AnalystRecord {
  summary: string;
  sentiment: Sentiment;
  intent: Intent;
  suggested_stage: LeadStage | null;
  objections: { code: ObjectionCode; raw_text: string }[];
  commitments: string[];
  promises: string[];
  questions: string[];
  buying_signals: string[];
  follow_up: {
    required: boolean;
    requested_datetime: string | null;
    exact_time_requested: boolean;
    reason: string;
  };
  recommended_action: RecommendedAction;
  confidence: number;
}

export const ANALYST_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['summary', 'sentiment', 'intent', 'objections', 'commitments', 'promises', 'recommended_action', 'confidence'],
  properties: {
    summary: { type: 'string', description: '2-4 sentences. Factual account of what was said. No speculation.' },
    sentiment: { type: 'string', enum: [...SENTIMENTS] },
    intent: { type: 'string', enum: [...INTENTS] },
    suggested_stage: { type: 'string', enum: [...LEAD_STAGES] },
    objections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'raw_text'],
        properties: {
          code: { type: 'string', enum: [...OBJECTION_CODES] },
          raw_text: { type: 'string', description: "the lead's own words, quoted" },
        },
      },
    },
    commitments: { type: 'array', items: { type: 'string' }, description: 'What the LEAD agreed to do.' },
    promises: { type: 'array', items: { type: 'string' }, description: 'What WE owe the lead.' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Questions the lead asked that went unanswered.' },
    buying_signals: { type: 'array', items: { type: 'string' } },
    follow_up: {
      type: 'object',
      additionalProperties: false,
      required: ['required'],
      properties: {
        required: { type: 'boolean' },
        requested_datetime: { type: 'string', description: 'ISO 8601. Only if the lead named a time.' },
        exact_time_requested: { type: 'boolean' },
        reason: { type: 'string' },
      },
    },
    recommended_action: { type: 'string', enum: [...RECOMMENDED_ACTIONS] },
    confidence: { type: 'number', description: '0-1. How well the transcript supports this reading.' },
  },
};

export const ANALYST_SYSTEM_PROMPT = `You are a sales conversation analyst. You read one call transcript and extract a structured record of what actually happened.

Rules that override everything else:
- Extract only what was SAID. Never infer, embellish, or fill gaps with what a sales call usually contains.
- A commitment is something the LEAD explicitly agreed to do. Politeness is not commitment: "sure, send it over" is a promise on OUR side, not a commitment on theirs.
- A promise is something WE said we would do. List it even if it sounds minor — these become tasks someone is held to.
- Set follow_up.exact_time_requested to true ONLY if the lead named a specific day or time. "Call me sometime next week" is not an exact time. "Thursday at 3" is.
- If the lead asked not to be contacted again, set intent to "do_not_call". This is acted on automatically, so do not use it loosely.
- Choose the closest objection code from the allowed list and put the lead's actual words in raw_text. Do not invent codes.
- If the transcript is too short, garbled, or clearly a voicemail or wrong number, say so in the summary, set the matching intent, and give a low confidence.
- confidence reflects how well the transcript supports your reading, not how good the call was.

Return only the structured record.`;

/** Keeps the head and tail of a long call — the open and the close carry the outcome. */
export function truncateTranscript(transcript: string, max = MAX_TRANSCRIPT_CHARS): string {
  const t = String(transcript ?? '');
  if (t.length <= max) return t;
  const half = Math.floor(max / 2) - 40;
  return `${t.slice(0, half)}\n\n[… ${t.length - max} characters of the middle omitted …]\n\n${t.slice(-half)}`;
}

export function buildAnalystUserMessage(params: {
  transcript: string;
  leadContext?: string;
  durationSec?: number | null;
  channel?: string;
}): string {
  const parts: string[] = [];
  if (params.leadContext) parts.push(`WHO WE CALLED\n${params.leadContext}`);
  const meta: string[] = [];
  if (params.channel) meta.push(`channel: ${params.channel}`);
  if (params.durationSec) meta.push(`duration: ${Math.round(params.durationSec / 60)} min`);
  if (meta.length) parts.push(`CALL METADATA\n${meta.join(', ')}`);
  parts.push(`TRANSCRIPT\n${truncateTranscript(params.transcript)}`);
  return parts.join('\n\n');
}

/**
 * Parse and harden a model response into an AnalystRecord.
 *
 * Pure and defensive: falls back to extracting the first balanced-looking JSON
 * object when structured output is unavailable or the provider wraps the reply
 * in prose, then coerces every field. Returns null only when there is no JSON
 * at all — a partially valid record is more useful than none.
 */
export function parseAnalystOutput(raw: string): AnalystRecord | null {
  if (!raw || typeof raw !== 'string') return null;
  let obj: Record<string, any> | null = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(raw.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  const strArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, 20)
      : [];

  const objections = Array.isArray(obj.objections)
    ? obj.objections
        .map((o: any) => {
          if (!o || typeof o !== 'object') return null;
          if (!isObjectionCode(o.code)) return null;
          return { code: o.code as ObjectionCode, raw_text: typeof o.raw_text === 'string' ? o.raw_text.slice(0, 500) : '' };
        })
        .filter(Boolean)
        .slice(0, 10) as { code: ObjectionCode; raw_text: string }[]
    : [];

  const fu = (obj.follow_up ?? {}) as Record<string, any>;
  let requested: string | null = null;
  if (typeof fu.requested_datetime === 'string' && fu.requested_datetime.trim()) {
    const d = new Date(fu.requested_datetime);
    if (!Number.isNaN(d.getTime())) requested = d.toISOString();
  }

  const confidence = Number(obj.confidence);

  return {
    summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 4000) : '',
    sentiment: isSentiment(obj.sentiment) ? obj.sentiment : 'neutral',
    intent: isIntent(obj.intent) ? obj.intent : 'undecided',
    suggested_stage: isLeadStage(obj.suggested_stage) ? obj.suggested_stage : null,
    objections,
    commitments: strArray(obj.commitments),
    promises: strArray(obj.promises),
    questions: strArray(obj.questions),
    buying_signals: strArray(obj.buying_signals),
    follow_up: {
      required: fu.required === true,
      requested_datetime: requested,
      exact_time_requested: fu.exact_time_requested === true,
      reason: typeof fu.reason === 'string' ? fu.reason.slice(0, 500) : '',
    },
    recommended_action: isRecommendedAction(obj.recommended_action) ? obj.recommended_action : 'none',
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
  };
}

/**
 * Translate a record into proposed operations. Pure — the result still goes
 * through validateSalesOps, which is what actually decides what may run.
 *
 * The default follow-up delay when the lead wanted one but named no time.
 */
const DEFAULT_FOLLOWUP_DAYS = 3;

export function analystRecordToOps(
  record: AnalystRecord,
  ctx: { now: Date; currentStage: LeadStage | null },
): unknown[] {
  const ops: unknown[] = [];

  if (record.summary) ops.push({ op: 'add_note', body: record.summary });

  for (const o of record.objections) {
    ops.push({ op: 'record_objection', code: o.code, raw_text: o.raw_text });
  }

  // Only propose a stage change that actually moves. Re-asserting the current
  // stage on every call generates audit noise and nothing else.
  if (record.suggested_stage && record.suggested_stage !== ctx.currentStage) {
    ops.push({
      op: 'update_lead_stage',
      stage: record.suggested_stage,
      reason: `Analyst read of the last call (${record.intent})`,
    });
  }

  // Every promise becomes a task someone is accountable for. This is the whole
  // reason promises are extracted separately from commitments.
  for (const promise of record.promises) {
    ops.push({ op: 'create_task', title: promise, due_date: null });
  }

  if (record.intent === 'do_not_call') {
    ops.push({ op: 'set_do_not_call', reason: 'Lead asked not to be contacted again' });
  }

  if (record.recommended_action === 'human_handoff') {
    ops.push({ op: 'request_human_handoff', reason: record.summary || 'Analyst recommended handoff' });
  }

  if (record.follow_up.required && record.intent !== 'do_not_call') {
    const when =
      record.follow_up.requested_datetime ??
      new Date(ctx.now.getTime() + DEFAULT_FOLLOWUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    ops.push({
      op: 'create_followup',
      type: record.recommended_action === 'send_info' ? 'email' : 'phone_call',
      scheduled_for: when,
      exact_time_requested: record.follow_up.exact_time_requested,
      reason: record.follow_up.reason || 'Follow-up from the last call',
      objective: nextObjective(record),
    });
  }

  return ops;
}

function nextObjective(record: AnalystRecord): string {
  if (record.objections.length) {
    return `Address the ${record.objections.map((o) => o.code).join(' and ')} objection, then move toward a meeting.`;
  }
  if (record.recommended_action === 'book_meeting') return 'Book a meeting.';
  if (record.recommended_action === 'send_info') return 'Confirm they received the information and answer questions.';
  return 'Continue the conversation and qualify further.';
}

export interface AnalystOutcome {
  record: AnalystRecord | null;
  ops: unknown[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Run the Analyst against one transcript. Throws on provider failure so the
 * caller can mark the conversation's analysis_status 'failed' and retry —
 * a lost analysis must stay visible.
 */
export async function runAnalyst(params: {
  pool: Pool;
  userId: string;
  transcript: string;
  leadContext?: string;
  durationSec?: number | null;
  channel?: string;
  currentStage: LeadStage | null;
  now?: Date;
}): Promise<AnalystOutcome> {
  const now = params.now ?? new Date();
  const cfg = await getAIConfig();
  const apiKey = resolveActiveKey(cfg);
  if (!apiKey) throw new Error('No AI provider key configured');

  const userMessage = buildAnalystUserMessage({
    transcript: params.transcript,
    leadContext: params.leadContext,
    durationSec: params.durationSec,
    channel: params.channel,
  });

  // Gemini has no json_schema output config here, so it goes through the shared
  // non-streaming helper and relies on the parser's brace extraction.
  if (cfg.provider === 'google') {
    const text = await callAINonStreaming(
      'google', apiKey, FAST_MODEL,
      `${ANALYST_SYSTEM_PROMPT}\n\nRespond with a single JSON object matching this shape:\n${JSON.stringify(ANALYST_SCHEMA)}`,
      userMessage, 2000,
      { userId: params.userId, feature: 'sales_analyst' },
    );
    const record = parseAnalystOutput(text);
    return {
      record,
      ops: record ? analystRecordToOps(record, { now, currentStage: params.currentStage }) : [],
      model: FAST_MODEL,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const client = new Anthropic({ apiKey });
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const resp = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 2000,
      system: ANALYST_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: ANALYST_SCHEMA } },
      messages: [{ role: 'user', content: userMessage }],
    } as any);
    text = (resp as any).content?.[0]?.type === 'text' ? (resp as any).content[0].text : '';
    inputTokens = (resp as any).usage?.input_tokens ?? 0;
    outputTokens = (resp as any).usage?.output_tokens ?? 0;
  } catch (structuredErr) {
    // Structured output is not available on every model/version combination.
    // Fall back to plain generation; the parser handles prose-wrapped JSON.
    logger.warn({ err: structuredErr }, 'sales_analyst_structured_output_failed_falling_back');
    try {
      const resp = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: 2000,
        system: `${ANALYST_SYSTEM_PROMPT}\n\nRespond with a single JSON object and nothing else, matching:\n${JSON.stringify(ANALYST_SCHEMA)}`,
        messages: [{ role: 'user', content: userMessage }],
      });
      text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
      inputTokens = resp.usage.input_tokens;
      outputTokens = resp.usage.output_tokens;
    } catch (err: any) {
      throw classifyAIProviderError('anthropic', FAST_MODEL, err);
    }
  }

  await recordAIUsage({
    userId: params.userId,
    feature: 'sales_analyst',
    provider: 'anthropic',
    model: FAST_MODEL,
    inputTokens,
    outputTokens,
  });

  const record = parseAnalystOutput(text);
  return {
    record,
    ops: record ? analystRecordToOps(record, { now, currentStage: params.currentStage }) : [],
    model: FAST_MODEL,
    inputTokens,
    outputTokens,
  };
}
