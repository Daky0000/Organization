// ─────────────────────────────────────────────────────────────────────────────
// The Insight / Opportunity agent.
//
// Runs weekly per account over AGGREGATES, never raw transcripts — that keeps
// the cost bounded and means the pattern mining is arithmetic, not vibes. The
// model's only job is to turn numbers that already exist into a readable
// recommendation and a concrete proposed change.
//
// Two hard rules:
//   1. Nothing here is ever applied automatically. Every row lands with
//      status='new' and waits for a human to accept or reject.
//   2. Nothing below MIN_SAMPLE_SIZE is emitted at all. "3 of 4 leads objected
//      to price" is noise, and shipping noise as an insight destroys trust in
//      the whole panel faster than shipping nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { logger } from '../../logger.ts';
import { FAST_MODEL, getAIConfig, hasAICredits, recordAIUsage, resolveActiveKey } from '../../ai-helpers.ts';
import { OBJECTION_LABELS, type ObjectionCode } from './types.ts';

/** Below this many observations a pattern is not a pattern. */
export const MIN_SAMPLE_SIZE = 30;

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface SalesAggregates {
  totalConversations: number;
  totalAttempts: number;
  answeredAttempts: number;
  objections: { code: ObjectionCode; count: number; share: number }[];
  intents: { intent: string; count: number }[];
  bestWindows: { weekday: number; hour: number; attempts: number; answered: number; rate: number }[];
  meetingsBooked: number;
  won: number;
  lost: number;
  unresolvedObjectionLeads: number;
}

/** Every number the Insight agent is allowed to reason about. Pure SQL. */
export async function collectSalesAggregates(pool: Pool, userId: string, days = 90): Promise<SalesAggregates> {
  const since = `${days} days`;

  const [convRes, attemptRes, objRes, intentRes, windowRes, stageRes, unresolvedRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n FROM sales_conversations
        WHERE user_id=$1 AND started_at >= NOW() - INTERVAL '${since}'`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE outcome='answered')::int AS answered
         FROM sales_call_attempts
        WHERE user_id=$1 AND outcome IS NOT NULL AND is_test = false
          AND created_at >= NOW() - INTERVAL '${since}'`,
      [userId],
    ),
    pool.query(
      `SELECT objection_code, COUNT(*)::int AS n FROM sales_conversation_objections
        WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${since}'
        GROUP BY objection_code ORDER BY n DESC`,
      [userId],
    ),
    pool.query(
      `SELECT intent, COUNT(*)::int AS n FROM sales_conversations
        WHERE user_id=$1 AND intent IS NOT NULL AND started_at >= NOW() - INTERVAL '${since}'
        GROUP BY intent ORDER BY n DESC`,
      [userId],
    ),
    pool.query(
      `SELECT local_weekday AS weekday, local_hour AS hour,
              COUNT(*)::int AS attempts,
              COUNT(*) FILTER (WHERE outcome='answered')::int AS answered
         FROM sales_call_attempts
        WHERE user_id=$1 AND outcome IS NOT NULL AND local_weekday IS NOT NULL
          AND is_test = false
          AND created_at >= NOW() - INTERVAL '${since}'
        GROUP BY 1,2 HAVING COUNT(*) >= 5
        ORDER BY (COUNT(*) FILTER (WHERE outcome='answered'))::numeric / COUNT(*) DESC
        LIMIT 5`,
      [userId],
    ),
    pool.query(
      `SELECT stage, COUNT(*)::int AS n FROM sales_lead_profiles WHERE user_id=$1 GROUP BY stage`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(DISTINCT contact_id)::int AS n FROM sales_conversation_objections
        WHERE user_id=$1 AND resolved=false`,
      [userId],
    ),
  ]);

  const totalObjections = objRes.rows.reduce((s: number, r: any) => s + Number(r.n), 0);
  const stageCounts = new Map<string, number>(stageRes.rows.map((r: any) => [String(r.stage), Number(r.n)]));

  return {
    totalConversations: Number(convRes.rows[0]?.n ?? 0),
    totalAttempts: Number(attemptRes.rows[0]?.total ?? 0),
    answeredAttempts: Number(attemptRes.rows[0]?.answered ?? 0),
    objections: objRes.rows.map((r: any) => ({
      code: String(r.objection_code) as ObjectionCode,
      count: Number(r.n),
      share: totalObjections ? Number(r.n) / totalObjections : 0,
    })),
    intents: intentRes.rows.map((r: any) => ({ intent: String(r.intent), count: Number(r.n) })),
    bestWindows: windowRes.rows.map((r: any) => ({
      weekday: Number(r.weekday),
      hour: Number(r.hour),
      attempts: Number(r.attempts),
      answered: Number(r.answered),
      rate: Number(r.attempts) ? Number(r.answered) / Number(r.attempts) : 0,
    })),
    meetingsBooked: Number(intentRes.rows.find((r: any) => r.intent === 'meeting_booked')?.n ?? 0),
    won: stageCounts.get('won') ?? 0,
    lost: stageCounts.get('lost') ?? 0,
    unresolvedObjectionLeads: Number(unresolvedRes.rows[0]?.n ?? 0),
  };
}

/** Render the aggregates as the model's entire view of the world. */
export function formatAggregates(agg: SalesAggregates): string {
  const lines: string[] = [
    `Conversations (90d): ${agg.totalConversations}`,
    `Dial attempts (90d): ${agg.totalAttempts}, answered: ${agg.answeredAttempts} (${agg.totalAttempts ? Math.round((agg.answeredAttempts / agg.totalAttempts) * 100) : 0}%)`,
    `Meetings booked: ${agg.meetingsBooked}`,
    `Leads won: ${agg.won}, lost: ${agg.lost}`,
    `Leads carrying an unresolved objection: ${agg.unresolvedObjectionLeads}`,
  ];
  if (agg.objections.length) {
    lines.push(
      '',
      'Objections by frequency:',
      ...agg.objections.map(
        (o) => `- ${OBJECTION_LABELS[o.code] ?? o.code} (${o.code}): ${o.count} (${Math.round(o.share * 100)}%)`,
      ),
    );
  }
  if (agg.bestWindows.length) {
    lines.push(
      '',
      'Answer rate by calling window (buckets with 5+ attempts):',
      ...agg.bestWindows.map(
        (w) => `- ${WEEKDAY_NAMES[w.weekday] ?? w.weekday} ${String(w.hour).padStart(2, '0')}:00 — ${Math.round(w.rate * 100)}% of ${w.attempts} attempts`,
      ),
    );
  }
  if (agg.intents.length) {
    lines.push('', 'Call outcomes by intent:', ...agg.intents.map((i) => `- ${i.intent}: ${i.count}`));
  }
  return lines.join('\n');
}

const INSIGHT_SYSTEM_PROMPT = `You are a sales operations analyst. You are given aggregate statistics from an outbound calling operation and you propose concrete, testable changes.

Rules:
- Base every claim on the numbers given. Never estimate, extrapolate, or refer to data you were not shown.
- Always state the sample size behind a claim in the body.
- Propose changes a person can actually action this week. "Improve the pitch" is useless; "when price comes up, ask what would make the investment worthwhile before quoting" is actionable.
- If the data does not support a confident recommendation, say so and return fewer insights. Returning zero insights is a valid and useful answer.
- For an objection_pattern insight, proposed_change.content must be the actual script or response you want the caller to use, written in the words the caller would say.

Return between 0 and 3 insights.`;

const INSIGHT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['insights'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'body', 'confidence', 'sample_size'],
        properties: {
          kind: { type: 'string', enum: ['objection_pattern', 'timing', 'script', 'segment', 'risk'] },
          title: { type: 'string', description: 'One line, specific and quantified.' },
          body: { type: 'string', description: 'What the data shows and what to do about it.' },
          confidence: { type: 'number' },
          sample_size: { type: 'number', description: 'Observations this rests on.' },
          proposed_change: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['playbook', 'policy', 'none'] },
              objection_code: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

export interface GeneratedInsight {
  kind: string;
  title: string;
  body: string;
  confidence: number;
  sample_size: number;
  proposed_change: Record<string, unknown> | null;
}

export function parseInsightOutput(raw: string): GeneratedInsight[] {
  if (!raw) return [];
  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(raw.slice(start, end + 1));
      } catch {
        return [];
      }
    }
  }
  const list = Array.isArray(obj?.insights) ? obj.insights : [];
  const allowed = new Set(['objection_pattern', 'timing', 'script', 'segment', 'risk']);
  return list
    .filter((i: any) => i && typeof i === 'object' && allowed.has(i.kind) && typeof i.title === 'string')
    .slice(0, 3)
    .map((i: any) => ({
      kind: String(i.kind),
      title: String(i.title).slice(0, 300),
      body: typeof i.body === 'string' ? i.body.slice(0, 4000) : '',
      confidence: Number.isFinite(Number(i.confidence)) ? Math.min(1, Math.max(0, Number(i.confidence))) : 0.5,
      sample_size: Math.max(0, Math.round(Number(i.sample_size) || 0)),
      proposed_change:
        i.proposed_change && typeof i.proposed_change === 'object' && i.proposed_change.type !== 'none'
          ? i.proposed_change
          : null,
    }));
}

/**
 * Generate and store insight proposals for one account.
 * Returns the number written — zero is a normal outcome, not a failure.
 */
export async function runInsightAgent(pool: Pool, userId: string): Promise<number> {
  const agg = await collectSalesAggregates(pool, userId);

  // The gate that keeps noise out of the panel.
  const observations = agg.totalConversations + agg.totalAttempts;
  if (observations < MIN_SAMPLE_SIZE) {
    logger.info({ userId, observations }, 'sales_insights_skipped_low_sample');
    return 0;
  }
  if (!(await hasAICredits(userId))) return 0;

  const cfg = await getAIConfig();
  const apiKey = resolveActiveKey(cfg);
  if (!apiKey || cfg.provider !== 'anthropic') return 0;

  const client = new Anthropic({ apiKey });
  let text = '';
  try {
    const resp = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 1600,
      system: INSIGHT_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: INSIGHT_SCHEMA } },
      messages: [{ role: 'user', content: formatAggregates(agg) }],
    } as any);
    text = (resp as any).content?.[0]?.type === 'text' ? (resp as any).content[0].text : '';
    await recordAIUsage({
      userId,
      feature: 'sales_insights',
      provider: 'anthropic',
      model: FAST_MODEL,
      inputTokens: (resp as any).usage?.input_tokens ?? 0,
      outputTokens: (resp as any).usage?.output_tokens ?? 0,
    });
  } catch (err) {
    logger.warn({ err, userId }, 'sales_insight_generation_failed');
    return 0;
  }

  const insights = parseInsightOutput(text).filter((i) => i.sample_size >= MIN_SAMPLE_SIZE || i.sample_size === 0);
  let written = 0;
  for (const insight of insights) {
    // Don't re-raise an identical open recommendation every week.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sales_insights WHERE user_id=$1 AND title=$2 AND status IN ('new','accepted') LIMIT 1`,
      [userId, insight.title],
    );
    if (rowCount) continue;

    await pool
      .query(
        `INSERT INTO sales_insights (id, user_id, kind, title, body, evidence, confidence, sample_size, proposed_change)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
        [
          randomUUID(), userId, insight.kind, insight.title, insight.body,
          JSON.stringify({ aggregates: agg }), insight.confidence,
          insight.sample_size || observations, JSON.stringify(insight.proposed_change),
        ],
      )
      .then(() => { written += 1; })
      .catch((err) => logger.warn({ err, userId }, 'sales_insight_insert_failed'));
  }
  return written;
}
