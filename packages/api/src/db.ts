import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { config } from './config.ts';
import { logger } from './logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Resilient Local / In-Memory Relational Store Shim
// Ensures `pool.query(...)` and `dbQuery(...)` never throw null-pointer or
// "Database is not configured" errors during local development when external
// PostgreSQL is not running.
// ─────────────────────────────────────────────────────────────────────────────

export const localTables: Record<string, any[]> = {
  api_keys: [],
  user_credits: [
    { user_id: 'admin-1', credits: 25000, reset_date: new Date(Date.now() + 30 * 86400000).toISOString(), auto_recharge: true, auto_recharge_pack: 'growth', updated_at: new Date().toISOString() },
    { user_id: 'platform-user-1', credits: 2000, reset_date: new Date(Date.now() + 30 * 86400000).toISOString(), auto_recharge: false, auto_recharge_pack: 'starter', updated_at: new Date().toISOString() },
  ],
  credit_ledger: [],
  ai_usage_log: [],
  user_memories: [
    { id: 'mem-1', user_id: 'admin-1', category: 'brand', title: 'Brand Identity', content: 'Dakyworld — AI-First SaaS & Creative Operating System for high-growth agencies and founders.', sort_order: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'mem-2', user_id: 'admin-1', category: 'audience', title: 'Target Audience', content: 'SaaS founders, digital agencies, creators, and marketing teams scaling multi-channel operations.', sort_order: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  brand_profiles: [
    { user_id: 'admin-1', brand_name: 'Dakyworld', niche: 'AI Marketing & SaaS OS', tone: 'Authoritative, modern, concise', audience: 'Founders, agencies, and growth marketers', goals: ['Grow MRR', 'Automate multi-channel publishing', 'Connect Dakyworld OS'], website: 'https://marketing.dakyx.com' },
  ],
  user_agents: [],
  user_agent_memory: [],
  agent_drafts: [],
  agent_schedules: [],
  agent_schedule_runs: [],
  agent_templates: [],
  user_agent_tasks: [
    { id: 'prop-1', user_id: 'admin-1', agent_key: 'sage', task_type: 'strategy_proposal', title: 'Launch Dakyworld OS Integration Showcase Campaign', body: 'Run a 5-part LinkedIn + X thread series demonstrating 0-token cached agent orchestration and one-click cross-channel distribution.', status: 'pending', payload: { channels: ['linkedin', 'twitter'], estimated_roas: '4.2x' }, created_at: new Date().toISOString() },
    { id: 'prop-2', user_id: 'admin-1', agent_key: 'nova', task_type: 'visual_concept', title: 'Dark-Mode Glassmorphic OS Command Center Hero Card', body: 'High-contrast luxury SaaS visual featuring live credit telemetry and multi-agent status badges in #5B6CF9.', status: 'pending', payload: { aspect_ratio: '16:9', style: 'luxury_tech' }, created_at: new Date().toISOString() },
  ],
  os_webhooks: [],
  blog_posts: [],
  social_accounts: [],
  mailing_contacts: [],
  mailing_automations: [],
  subscriptions: [
    { id: 'sub-admin-1', user_id: 'admin-1', plan_id: 'plan-enterprise-monthly', plan_name: 'Enterprise / Dakyworld OS Pro', price: 199, billing_period: 'monthly', status: 'active', post_limit: 1000, user_limit: 25, cancel_at_period_end: false, current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), created_at: new Date().toISOString() },
  ],
  billing_invoices: [],
  notifications: [],
};

function executeLocalSql(sqlRaw: string, params: any[] = []): { rows: any[]; rowCount: number } {
  const sql = sqlRaw.replace(/\s+/g, ' ').trim();
  const upper = sql.toUpperCase();

  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK' || upper.startsWith('CREATE ') || upper.startsWith('ALTER ') || upper.startsWith('DROP ')) {
    return { rows: [], rowCount: 0 };
  }

  // COUNT(*) queries
  if (/SELECT\s+COUNT\(\*\)/i.test(sql)) {
    const tableMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
    const tbl = tableMatch ? tableMatch[1].toLowerCase() : '';
    const rows = localTables[tbl] ?? [];
    if (tbl === 'api_keys' && params[0]) {
      const c = rows.filter((r) => r.user_id === params[0] && !r.revoked_at).length;
      return { rows: [{ c: String(c), count: c, n: String(c) }], rowCount: 1 };
    }
    return { rows: [{ c: String(rows.length), count: rows.length, n: String(rows.length), total: rows.length, subscribed: rows.length, active: rows.length, won: 0, posts_this_period: rows.length }], rowCount: 1 };
  }

  // api_keys
  if (sql.includes('FROM api_keys') || sql.includes('INTO api_keys') || sql.includes('UPDATE api_keys')) {
    if (upper.startsWith('INSERT INTO API_KEYS')) {
      const [id, user_id, name, key_prefix, key_hash, scopes] = params;
      const row = {
        id: id || randomUUID(),
        user_id,
        name,
        key_prefix,
        key_hash,
        scopes: scopes ? (typeof scopes === 'string' ? JSON.parse(scopes) : scopes) : ['os:full', 'agents:invoke', 'content:write', 'generations:run', 'analytics:read', 'memory:sync'],
        created_at: new Date().toISOString(),
        last_used_at: null,
        revoked_at: null,
      };
      localTables.api_keys.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('SELECT') && sql.includes('key_hash=$1')) {
      const found = localTables.api_keys.filter((k) => k.key_hash === params[0] && !k.revoked_at);
      return { rows: found, rowCount: found.length };
    }
    if (upper.startsWith('SELECT') && sql.includes('user_id=$1')) {
      const found = localTables.api_keys.filter((k) => k.user_id === params[0]);
      return { rows: found, rowCount: found.length };
    }
    if (upper.startsWith('UPDATE API_KEYS SET REVOKED_AT')) {
      const target = localTables.api_keys.find((k) => k.id === params[0] && k.user_id === params[1] && !k.revoked_at);
      if (target) {
        target.revoked_at = new Date().toISOString();
        return { rows: [target], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (upper.startsWith('UPDATE API_KEYS SET LAST_USED_AT')) {
      const target = localTables.api_keys.find((k) => k.id === params[0]);
      if (target) target.last_used_at = new Date().toISOString();
      return { rows: [], rowCount: target ? 1 : 0 };
    }
  }

  // user_credits
  if (sql.includes('user_credits')) {
    if (upper.startsWith('INSERT INTO USER_CREDITS')) {
      const userId = params[0];
      const credits = Number(params[1] ?? 100);
      let existing = localTables.user_credits.find((u) => u.user_id === userId);
      if (!existing) {
        existing = {
          user_id: userId,
          credits,
          reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
          auto_recharge: false,
          auto_recharge_pack: 'starter',
          updated_at: new Date().toISOString(),
        };
        localTables.user_credits.push(existing);
      } else if (upper.includes('DO UPDATE SET CREDITS = USER_CREDITS.CREDITS +')) {
        existing.credits += credits;
        existing.updated_at = new Date().toISOString();
      }
      return { rows: [existing], rowCount: 1 };
    }
    if (upper.startsWith('UPDATE USER_CREDITS')) {
      if (sql.includes('reset_date <= NOW()')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('auto_recharge')) {
        const userId = params[0];
        let existing = localTables.user_credits.find((u) => u.user_id === userId);
        if (!existing) {
          existing = { user_id: userId, credits: 1000, reset_date: new Date(Date.now() + 30 * 86400000).toISOString(), auto_recharge: Boolean(params[1]), auto_recharge_pack: String(params[2] || 'starter'), updated_at: new Date().toISOString() };
          localTables.user_credits.push(existing);
        } else {
          existing.auto_recharge = Boolean(params[1]);
          existing.auto_recharge_pack = String(params[2] || existing.auto_recharge_pack || 'starter');
        }
        return { rows: [existing], rowCount: 1 };
      }
      const delta = Number(params[0] ?? 0);
      const userId = params[1];
      let existing = localTables.user_credits.find((u) => u.user_id === userId);
      if (!existing) {
        existing = { user_id: userId, credits: Math.max(0, 1000 - delta), reset_date: new Date(Date.now() + 30 * 86400000).toISOString(), auto_recharge: false, auto_recharge_pack: 'starter', updated_at: new Date().toISOString() };
        localTables.user_credits.push(existing);
      } else {
        existing.credits = Math.max(0, existing.credits - delta);
        existing.updated_at = new Date().toISOString();
      }
      return { rows: [existing], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      let existing = localTables.user_credits.find((u) => u.user_id === userId);
      if (!existing) {
        existing = { user_id: userId, credits: 1000, reset_date: new Date(Date.now() + 30 * 86400000).toISOString(), auto_recharge: false, auto_recharge_pack: 'starter', updated_at: new Date().toISOString() };
        localTables.user_credits.push(existing);
      }
      return { rows: [existing], rowCount: 1 };
    }
  }

  // credit_ledger
  if (sql.includes('credit_ledger')) {
    if (upper.startsWith('INSERT INTO CREDIT_LEDGER')) {
      const [id, user_id, delta, balance_after, reason, meta] = params;
      const row = {
        id: id || randomUUID(),
        user_id,
        delta: Number(delta),
        balance_after: Number(balance_after),
        reason,
        meta: typeof meta === 'string' ? JSON.parse(meta || '{}') : (meta || {}),
        created_at: new Date().toISOString(),
      };
      localTables.credit_ledger.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.credit_ledger.filter((r) => !userId || r.user_id === userId).slice(0, 100);
      return { rows, rowCount: rows.length };
    }
  }

  // ai_usage_log
  if (sql.includes('ai_usage_log')) {
    if (upper.startsWith('INSERT INTO AI_USAGE_LOG')) {
      const [id, user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, credits_charged] = params;
      const row = {
        id: id || randomUUID(),
        user_id,
        feature,
        provider,
        model,
        input_tokens: Number(input_tokens || 0),
        output_tokens: Number(output_tokens || 0),
        cache_read_tokens: Number(cache_read_tokens || 0),
        cost_usd: Number(cost_usd || 0),
        credits_charged: Number(credits_charged || 0),
        created_at: new Date().toISOString(),
      };
      localTables.ai_usage_log.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.ai_usage_log.filter((r) => !userId || r.user_id === userId);
      return { rows, rowCount: rows.length };
    }
  }

  // brand_profiles
  if (sql.includes('brand_profiles')) {
    const userId = params[0];
    if (upper.startsWith('SELECT')) {
      const rows = localTables.brand_profiles.filter((b) => b.user_id === userId);
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('INSERT INTO BRAND_PROFILES')) {
      const [user_id, brand_name, niche, tone, audience, goals, platforms, website, extra_notes, setup_done] = params;
      let existing = localTables.brand_profiles.find((b) => b.user_id === user_id);
      const row = {
        id: randomUUID(),
        user_id,
        brand_name: brand_name || '',
        niche: niche || '',
        tone: tone || 'professional',
        audience: audience || '',
        goals: Array.isArray(goals) ? goals : (typeof goals === 'string' ? JSON.parse(goals || '[]') : []),
        platforms: Array.isArray(platforms) ? platforms : (typeof platforms === 'string' ? JSON.parse(platforms || '[]') : []),
        website: website || '',
        extra_notes: extra_notes || '',
        setup_done: Boolean(setup_done),
        updated_at: new Date().toISOString(),
      };
      if (existing) {
        Object.assign(existing, row);
      } else {
        localTables.brand_profiles.push(row);
      }
      return { rows: [existing || row], rowCount: 1 };
    }
  }

  // user_agent_memory
  if (sql.includes('user_agent_memory')) {
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const agentKey = params[1];
      let rows = localTables.user_agent_memory.filter((m) => !userId || m.user_id === userId);
      if (agentKey && sql.includes('agent_key=$2')) {
        rows = rows.filter((m) => m.agent_key === agentKey);
      }
      if (sql.includes("key='meta:last_run_at'") || (params[1] && sql.includes("key="))) {
        const k = sql.includes("key='meta:last_run_at'") ? 'meta:last_run_at' : params[1];
        rows = rows.filter((m) => m.key === k);
      }
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('INSERT INTO USER_AGENT_MEMORY')) {
      const [user_id, agent_key, mem_type, key, value] = params;
      let existing = localTables.user_agent_memory.find((m) => m.user_id === user_id && m.agent_key === agent_key && m.key === key);
      if (existing) {
        existing.value = value;
        existing.mem_type = mem_type || existing.mem_type;
        existing.updated_at = new Date().toISOString();
        return { rows: [existing], rowCount: 1 };
      }
      const row = {
        id: randomUUID(),
        user_id,
        agent_key: agent_key || 'global',
        mem_type: mem_type || 'general',
        key,
        value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localTables.user_agent_memory.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('DELETE FROM USER_AGENT_MEMORY')) {
      const idx = localTables.user_agent_memory.findIndex((m) => m.id === params[0] && (!params[1] || m.user_id === params[1]));
      if (idx >= 0) localTables.user_agent_memory.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }
  }

  // agent_drafts
  if (sql.includes('agent_drafts')) {
    if (!localTables.agent_drafts) localTables.agent_drafts = [];
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.agent_drafts.filter((d) => !userId || d.user_id === userId);
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('INSERT INTO AGENT_DRAFTS')) {
      const [user_id, agent_key, task_id, task_type, title, content, payload, blog_post_id] = params;
      const row = {
        id: randomUUID(),
        user_id,
        agent_key,
        task_id: task_id || null,
        task_type: task_type || 'content_post',
        title: title || 'Untitled Draft',
        content: content || '',
        payload: typeof payload === 'string' ? JSON.parse(payload || '{}') : (payload || {}),
        blog_post_id: blog_post_id || null,
        created_at: new Date().toISOString(),
      };
      localTables.agent_drafts.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('DELETE FROM AGENT_DRAFTS')) {
      const idx = localTables.agent_drafts.findIndex((d) => d.id === params[0] && (!params[1] || d.user_id === params[1]));
      if (idx >= 0) localTables.agent_drafts.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }
  }

  // agent_templates
  if (sql.includes('agent_templates')) {
    if (!localTables.agent_templates || localTables.agent_templates.length === 0) {
      localTables.agent_templates = [
        { agent_key: 'sage', name: 'Sage', role: 'Strategy Analyst', icon: '◈', color: '#10B981', base_prompt: 'You are Sage, strategic marketing analyst.' },
        { agent_key: 'daky', name: 'Daky', role: 'Content Writer', icon: '✦', color: '#5b6cf9', base_prompt: 'You are Daky, creative content writer.' },
        { agent_key: 'nova', name: 'Nova', role: 'Creative Director', icon: '◉', color: '#EC4899', base_prompt: 'You are Nova, creative director and visual designer.' },
        { agent_key: 'aria', name: 'Aria', role: 'Analytics & Performance', icon: '⊕', color: '#F59E0B', base_prompt: 'You are Aria, analytics and conversion expert.' },
        { agent_key: 'flux', name: 'Flux', role: 'Automation & Workflows', icon: '⟳', color: '#8B5CF6', base_prompt: 'You are Flux, marketing automation specialist.' },
      ];
    }
    if (params[0] && sql.includes('agent_key = $1')) {
      const found = localTables.agent_templates.filter((t) => t.agent_key === params[0]);
      return { rows: found, rowCount: found.length };
    }
    return { rows: localTables.agent_templates, rowCount: localTables.agent_templates.length };
  }

  // agent_schedules & agent_schedule_runs
  if (sql.includes('agent_schedules')) {
    if (!localTables.agent_schedules) localTables.agent_schedules = [];
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.agent_schedules.filter((s) => !userId || s.user_id === userId);
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('INSERT INTO AGENT_SCHEDULES')) {
      const [id, user_id, name, primary_agent_slug, handoff_agent_slug, prompt_goal, frequency, output_action, next_run_at] = params;
      const row = {
        id: id || randomUUID(),
        user_id,
        name,
        primary_agent_slug,
        handoff_agent_slug: handoff_agent_slug || null,
        prompt_goal,
        frequency: frequency || 'daily',
        output_action: output_action || 'create_post_draft',
        is_active: true,
        last_run_at: null,
        next_run_at: next_run_at || new Date().toISOString(),
        last_result_summary: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localTables.agent_schedules.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('DELETE FROM AGENT_SCHEDULES')) {
      const idx = localTables.agent_schedules.findIndex((s) => s.id === params[0] && (!params[1] || s.user_id === params[1]));
      if (idx >= 0) localTables.agent_schedules.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }
    if (upper.startsWith('UPDATE AGENT_SCHEDULES')) {
      const target = localTables.agent_schedules.find((s) => s.id === params[params.length - 2] || s.id === params[0]);
      if (target) {
        target.last_run_at = new Date().toISOString();
        if (params[1]) target.last_result_summary = String(params[1]);
        target.updated_at = new Date().toISOString();
        return { rows: [target], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  // user_memories
  if (sql.includes('user_memories')) {
    const userId = params[0];
    if (upper.startsWith('SELECT')) {
      const rows = localTables.user_memories.filter((m) => !userId || m.user_id === userId);
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('INSERT INTO USER_MEMORIES')) {
      const row = {
        id: params[0] || randomUUID(),
        user_id: params[1],
        category: params[2] || 'brand',
        title: params[3] || 'Memory',
        content: params[4] || '',
        sort_order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localTables.user_memories.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
  }

  // user_agent_tasks (proposals)
  if (sql.includes('user_agent_tasks')) {
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.user_agent_tasks.filter((t) => !userId || t.user_id === userId);
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('INSERT INTO USER_AGENT_TASKS')) {
      const row = {
        id: randomUUID(),
        user_id: params[0],
        agent_key: params[1],
        task_type: params[2],
        title: params[3],
        body: params[4],
        payload: typeof params[5] === 'string' ? JSON.parse(params[5] || '{}') : (params[5] || {}),
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      localTables.user_agent_tasks.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('UPDATE USER_AGENT_TASKS')) {
      const status = params[0];
      const id = params[1];
      const target = localTables.user_agent_tasks.find((t) => t.id === id);
      if (target) {
        target.status = status;
        target.decided_at = new Date().toISOString();
        return { rows: [target], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  // blog_posts
  if (sql.includes('blog_posts')) {
    if (upper.startsWith('INSERT INTO BLOG_POSTS')) {
      const [id, user_id, title, slug, content, excerpt, scheduled_at] = params;
      const isSched = sql.includes("'scheduled'");
      const row = {
        id: id || randomUUID(),
        user_id,
        title,
        slug,
        content,
        excerpt,
        status: isSched ? 'scheduled' : 'draft',
        scheduled_at: isSched ? scheduled_at : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      localTables.blog_posts.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.blog_posts.filter((p) => !userId || p.user_id === userId);
      return { rows, rowCount: rows.length };
    }
  }

  // os_webhooks
  if (sql.includes('os_webhooks')) {
    if (upper.startsWith('INSERT INTO OS_WEBHOOKS')) {
      const [id, user_id, name, target_url, events, signing_secret] = params;
      const row = {
        id: id || randomUUID(),
        user_id,
        name,
        target_url,
        events: typeof events === 'string' ? JSON.parse(events) : events,
        signing_secret,
        active: true,
        created_at: new Date().toISOString(),
      };
      localTables.os_webhooks.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      const userId = params[0];
      const rows = localTables.os_webhooks.filter((w) => !userId || w.user_id === userId);
      return { rows, rowCount: rows.length };
    }
    if (upper.startsWith('DELETE FROM OS_WEBHOOKS')) {
      const idx = localTables.os_webhooks.findIndex((w) => w.id === params[0] && w.user_id === params[1]);
      if (idx >= 0) {
        localTables.os_webhooks.splice(idx, 1);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  // subscriptions
  if (sql.includes('FROM subscriptions')) {
    const userId = params[0];
    const rows = localTables.subscriptions.filter((s) => !userId || s.user_id === userId);
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

function createLocalPoolShim(): Pool {
  const queryFn = async (sqlOrConfig: any, values?: any[]) => {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : String(sqlOrConfig?.text || '');
    const params = Array.isArray(values) ? values : (Array.isArray(sqlOrConfig?.values) ? sqlOrConfig.values : []);
    return executeLocalSql(sql, params);
  };
  return {
    query: queryFn,
    connect: async () => ({
      query: queryFn,
      release: () => undefined,
    }),
    on: () => undefined,
    end: async () => undefined,
  } as unknown as Pool;
}

export let pool: Pool = createLocalPoolShim();
let usingRealPostgres = false;

try {
  if (config.databaseUrl) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      // Railway private traffic is encrypted by WireGuard; public DB connections verify TLS.
      ssl: (['localhost', '127.0.0.1', '::1'].includes(new URL(config.databaseUrl).hostname) ||
        (Boolean(process.env.RAILWAY_ENVIRONMENT_ID) && new URL(config.databaseUrl).hostname.endsWith('.railway.internal')))
        ? false
        : { rejectUnauthorized: true, ...(process.env.PG_SSL_CA ? { ca: process.env.PG_SSL_CA } : {}) },
      max: 20,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
    });
    usingRealPostgres = true;
  }
} catch (err) {
  throw err;
}

export let dbReady = false;
export let dbInitError: string | null = null;
export function setDbReady(value: boolean) {
  dbReady = value;
}
export function setDbInitError(err: unknown) {
  dbInitError = err instanceof Error ? err.message : String(err);
}

export function hasDatabase() {
  return usingRealPostgres && dbReady;
}

export async function dbQuery<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
  if (usingRealPostgres) {
    if (!dbReady) throw new Error('Database is not ready');
    const result = await pool.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }
  if (config.nodeEnv === 'production') throw new Error('Database unavailable');
  return executeLocalSql(sql, params) as { rows: T[]; rowCount: number };
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
