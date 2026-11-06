import type { Pool } from 'pg';
import { dbQuery } from '../db.ts';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Shared agent context.
//
// The platform has two agent surfaces that historically didn't talk to each
// other: the chat orchestrator (aiChatRoutes — compiled_skill briefs from
// user_memories) and the scheduled proposal agents (novaRoutes —
// brand_profiles + user_agent_memory + live workspace data). This module is
// the bridge:
//
//  - buildSharedAgentContext() assembles one compact live-workspace block
//    (brand, connected platforms, audience size, cross-agent insights,
//    recent proposals) injected into BOTH surfaces.
//  - recordAgentInsight() writes a team conclusion into user_agent_memory
//    (agent_key='global'), which the scheduled agents already read — so a
//    chat session's synthesis becomes context for the next scheduled run,
//    and vice versa.
//  - processStaleAgentCompilations() is the periodic scan keeping per-agent
//    compiled_skill briefs in sync with user_memories edits.
// ─────────────────────────────────────────────────────────────────────────────

// Personalization cache: every agent decision starts from this context, so
// it's assembled once and reused for 10 minutes. Anything that changes
// personalization (memory CRUD, brand-profile save, image likes) calls
// invalidateSharedContext so agents see the change immediately.
const contextCache = new Map<string, { context: string; expires: number }>();
const CONTEXT_TTL_MS = 10 * 60 * 1000;

export function invalidateSharedContext(userId: string): void {
  contextCache.delete(userId);
}

export async function buildSharedAgentContext(userId: string): Promise<string> {
  const cached = contextCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.context;

  const parts: string[] = [];
  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* section skipped */ } };

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT brand_name, niche, tone, audience, goals, website FROM brand_profiles WHERE user_id=$1`,
      [userId]
    );
    const b = rows[0];
    if (b && (b.brand_name || b.niche)) {
      parts.push(`Brand: ${b.brand_name || 'unnamed'}${b.niche ? ` — ${b.niche}` : ''}${b.tone ? `, tone: ${b.tone}` : ''}${b.audience ? `, audience: ${b.audience}` : ''}${Array.isArray(b.goals) && b.goals.length ? `, goals: ${b.goals.join('; ')}` : ''}`);
    }
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT platform, handle, followers FROM social_accounts WHERE user_id=$1 AND connected=true ORDER BY followers DESC NULLS LAST LIMIT 10`,
      [userId]
    );
    if (rows.length) {
      parts.push(`Connected platforms: ${rows.map((r: any) => `${r.platform}${r.handle ? ` (@${r.handle})` : ''}${r.followers ? ` ${Number(r.followers).toLocaleString()} followers` : ''}`).join(', ')}`);
    }
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT COUNT(*) FILTER (WHERE subscribed=true) AS subscribed, COUNT(*) AS total FROM mailing_contacts WHERE user_id=$1`,
      [userId]
    );
    const c = rows[0];
    if (c && Number(c.total) > 0) parts.push(`Email audience: ${c.subscribed} subscribed contacts (${c.total} total)`);
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT COUNT(*) AS n FROM mailing_automations WHERE user_id=$1 AND status='active'`,
      [userId]
    );
    if (Number(rows[0]?.n) > 0) parts.push(`Active marketing automations: ${rows[0].n}`);
  });

  // Sales pipeline state — so the marketing/content agents know what sales is
  // actually hearing on calls, not just what the campaigns did.
  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE stage IN ('interested','proposal','negotiation'))::int AS active,
              COUNT(*) FILTER (WHERE stage='won')::int AS won
         FROM sales_lead_profiles WHERE user_id=$1`,
      [userId]
    );
    const s = rows[0];
    if (s && Number(s.total) > 0) {
      parts.push(`Sales pipeline: ${s.total} leads, ${s.active} in active conversation, ${s.won} won`);
    }
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT objection_code, COUNT(*)::int AS n FROM sales_conversation_objections
        WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '90 days'
        GROUP BY objection_code ORDER BY n DESC LIMIT 4`,
      [userId]
    );
    if (rows.length) {
      parts.push(`Objections heard on sales calls: ${rows.map((r: any) => `${String(r.objection_code).replace(/_/g, ' ')} (${r.n})`).join(', ')}`);
    }
  });

  // The strategy the director has the whole team on, and why — so chat,
  // content plans and sales briefs pull in the same direction as the agents.
  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT title, rationale, kpi, target, last_verdict FROM agent_strategies WHERE user_id=$1 AND status='active' LIMIT 1`,
      [userId]
    );
    const s = rows[0];
    if (s) parts.push(`Team strategy: ${s.title} (${String(s.last_verdict || 'warming_up').replace(/_/g, ' ')}; judged on ${String(s.kpi).replace(/_/g, ' ')}). Why: ${String(s.rationale).slice(0, 400)}`);
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT findings, method, created_at FROM niche_research WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const f = rows[0]?.findings;
    if (f && f.summary) {
      const trends = Array.isArray(f.trends) ? f.trends.slice(0, 3).map((t: any) => t.name).filter(Boolean) : [];
      const pains = Array.isArray(f.audience?.pains) ? f.audience.pains.slice(0, 3) : [];
      parts.push(`Niche research (${rows[0].method === 'web_search' ? 'web' : 'general knowledge'}, ${new Date(rows[0].created_at).toISOString().slice(0, 10)}): ${String(f.summary).slice(0, 500)}${trends.length ? `\nRising: ${trends.join('; ')}` : ''}${pains.length ? `\nAudience pains: ${pains.join('; ')}` : ''}`);
    }
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT value FROM user_agent_memory WHERE user_id=$1 AND agent_key='global' AND mem_type='insight' ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );
    if (rows.length) parts.push(`Recent team insights:\n${rows.map((r: any) => `- ${String(r.value).slice(0, 240)}`).join('\n')}`);
  });

  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT agent_key, title, status FROM user_agent_tasks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );
    if (rows.length) parts.push(`Recent agent proposals: ${rows.map((r: any) => `${r.agent_key}: "${r.title}" (${r.status})`).join('; ')}`);
  });

  // Personalization memories — the "About you" data every agent must respect.
  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT category, title, content FROM user_memories WHERE user_id=$1 AND title <> '🌐 Full Scraped Memory'
       ORDER BY category, sort_order, created_at LIMIT 12`,
      [userId]
    );
    if (rows.length) parts.push(`About the user (personalization):\n${rows.map((r: any) => `- [${r.category}] ${r.title}: ${String(r.content).slice(0, 160)}`).join('\n')}`);
  });

  // Liked-image style profile — the user's visual taste.
  await safe(async () => {
    const { rows } = await dbQuery(
      `SELECT m.model, m.prompt FROM mcp_media_likes l JOIN mcp_media m ON m.id=l.media_id
       WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 3`,
      [userId]
    );
    if (rows.length) parts.push(`Visual styles the user likes: ${rows.map((r: any) => `[${r.model || 'ai'}] ${String(r.prompt || '').slice(0, 120)}`).join(' | ')}`);
  });

  const context = parts.join('\n');
  contextCache.set(userId, { context, expires: Date.now() + CONTEXT_TTL_MS });
  if (contextCache.size > 2000) {
    for (const [k, v] of contextCache) if (v.expires < Date.now()) contextCache.delete(k);
  }
  return context;
}

// Store a cross-agent insight in the global channel; keeps only the newest 20
// so the context block stays compact.
export async function recordAgentInsight(userId: string, key: string, value: string): Promise<void> {
  try {
    await dbQuery(
      `INSERT INTO user_agent_memory (user_id, agent_key, mem_type, key, value)
       VALUES ($1,'global','insight',$2,$3)
       ON CONFLICT (user_id, agent_key, key) DO UPDATE SET value=EXCLUDED.value, created_at=NOW()`,
      [userId, key.slice(0, 120), value.slice(0, 1000)]
    );
    await dbQuery(
      `DELETE FROM user_agent_memory WHERE user_id=$1 AND agent_key='global' AND mem_type='insight'
       AND id NOT IN (SELECT id FROM user_agent_memory WHERE user_id=$1 AND agent_key='global' AND mem_type='insight' ORDER BY created_at DESC LIMIT 20)`,
      [userId]
    );
  } catch (err) {
    logger.warn({ err, userId }, 'agent_insight_record_failed');
  }
}

// Periodic scan (server.ts scheduler): recompile agent skill briefs for users
// whose memories changed after the agents were last compiled, so the briefs
// track personalization edits without requiring another manual memory save.
export async function processStaleAgentCompilations(
  pool: Pool | null,
  triggerAgentCompilation: (userId: string) => Promise<void>
): Promise<void> {
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      `SELECT a.user_id FROM user_agents a
       JOIN user_memories m ON m.user_id = a.user_id
       GROUP BY a.user_id
       HAVING MAX(m.updated_at) > COALESCE(MIN(a.last_compiled_at), 'epoch'::timestamptz)
       LIMIT 15`
    );
    for (const row of rows) {
      await triggerAgentCompilation(row.user_id).catch(() => undefined);
    }
    if (rows.length) logger.info({ users: rows.length }, 'agent_compilation_refresh');
  } catch (err) {
    logger.error({ err }, 'agent_compilation_scan_failed');
  }
}
