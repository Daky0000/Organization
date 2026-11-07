// ─────────────────────────────────────────────────────────────────────────────
// Context packs: the company and workspace data a skill reads for one step.
// Each pack is plain text, built once per run and shared by every step that
// asks for it. Lead names and notes are user data and are fenced.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import { fence } from '../aiGuard.ts';
import { buildSharedAgentContext } from '../agentSharedContext.ts';
import { companyContextBlock } from '../companyContext.ts';
import { collectSalesAggregates } from '../sales/insightAgent.ts';
import { leadOverview } from '../sales/leadOverview.ts';
import { todaySnapshot, userSalesTimezone } from '../sales/dailyPlan.ts';
import { loadLeadProfiles, summarizeFacets } from '../sales/leadTargeting.ts';
import { zonedDateKey } from '../timezones.ts';

export const PACK_KEYS = ['company', 'workspace', 'sales_pipeline', 'sales_today', 'lead_base', 'call_stats', 'platform'] as const;
export type PackKey = (typeof PACK_KEYS)[number];

export const PACK_LABELS: Record<PackKey, string> = {
  company: 'Company context (overview, events, offerings, playbook)',
  workspace: 'Workspace (brand, channels, audience, preferences, recent agent insights)',
  sales_pipeline: 'Sales pipeline (lists, outcomes, follow-ups, 30-day activity)',
  sales_today: "Today's call queue and progress toward the call target",
  lead_base: 'What the lead base looks like (job titles, companies, industries, lists)',
  call_stats: 'Call statistics (answer rates, objections, outcomes, 90 days)',
  platform: 'Platform metrics (admin only)',
};

export class PackCache {
  private cache = new Map<PackKey, Promise<string>>();
  constructor(private pool: Pool, private userId: string, private isAdmin: boolean) {}

  get(key: PackKey): Promise<string> {
    if (key === 'platform' && !this.isAdmin) return Promise.resolve('');
    let p = this.cache.get(key);
    if (!p) {
      p = buildPack(this.pool, this.userId, key).catch(() => '');
      this.cache.set(key, p);
    }
    return p;
  }

  async render(keys: PackKey[]): Promise<string> {
    const parts = await Promise.all([...new Set(keys)].map(async (k) => {
      const text = await this.get(k);
      return text ? `## ${PACK_LABELS[k]}\n${text}` : '';
    }));
    return parts.filter(Boolean).join('\n\n');
  }
}

async function buildPack(pool: Pool, userId: string, key: PackKey): Promise<string> {
  switch (key) {
    case 'company': {
      const tz = await userSalesTimezone(pool, userId);
      return (await companyContextBlock(pool, userId, zonedDateKey(Date.now(), tz), { maxChars: 20000 }))
        || 'No company context has been written yet (AI Agent → Company context).';
    }
    case 'workspace':
      return await buildSharedAgentContext(userId);
    case 'sales_pipeline': {
      const o = await leadOverview(pool, userId);
      const lines = [
        `Leads: ${o.totals.leads} (${o.totals.newThisWeek} new this week); contacted ${o.totals.contacted}; never contacted ${o.totals.neverContacted}.`,
        `Latest outcome per lead: ${Object.entries(o.byResponseStatus).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
        `Follow-ups: ${o.followups.overdue} overdue, ${o.followups.today} due today, ${o.followups.week} this week, ${o.followups.needs_confirmation} AI-dated waiting for confirmation.`,
        'Lists (leads / contacted / responded / interested / registered-or-paid):',
        ...o.byList.slice(0, 25).map((l: any) => `- ${String(l.name).slice(0, 80)}: ${l.leads} / ${l.contacted} / ${l.responded} / ${l.interested} / ${l.converted}`),
        `Activity last 30 days: ${o.activityTrend30d.reduce((s: number, d: any) => s + d.activities, 0)} activities, ${o.activityTrend30d.reduce((s: number, d: any) => s + d.responses, 0)} responses.`,
      ];
      return fence('sales pipeline', lines.join('\n'), 6000);
    }
    case 'sales_today': {
      const s = await todaySnapshot(pool, userId);
      const lines = [
        `Date ${s.date}. Call target ${s.target}; calls today ${s.progress.calls}; responses ${s.progress.responses}; registered/paid today ${s.progress.conversions}; calls still needed ${s.progress.remaining}.`,
        `Queue: ${Object.entries(s.counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
        'Top of the queue:',
        ...s.queue.slice(0, 25).map((i) => `- ${i.name.slice(0, 60)} (${i.reason}): ${i.detail.slice(0, 120)}${i.last_note ? ` | note: ${i.last_note.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`),
      ];
      return fence('call queue', lines.join('\n'), 7000);
    }
    case 'lead_base': {
      const profiles = await loadLeadProfiles(pool, userId);
      if (!profiles.length) return 'No leads yet.';
      return `${profiles.length} callable leads. Summary (value: count):\n${fence('lead base summary', JSON.stringify(summarizeFacets(profiles, 20)), 6000)}`;
    }
    case 'call_stats': {
      const a = await collectSalesAggregates(pool, userId, 90);
      return JSON.stringify({
        conversations: a.totalConversations, attempts: a.totalAttempts, answered: a.answeredAttempts,
        objections: a.objections.slice(0, 8), intents: a.intents.slice(0, 8), best_windows: a.bestWindows.slice(0, 8),
        meetings_booked: a.meetingsBooked, won: a.won, lost: a.lost, unresolved_objection_leads: a.unresolvedObjectionLeads,
      });
    }
    case 'platform': {
      const { rows } = await pool.query(
        `SELECT (SELECT COUNT(*) FROM users WHERE role='user')::int AS users,
                (SELECT COUNT(*) FROM users WHERE role='user' AND created_at > NOW() - INTERVAL '7 days')::int AS new_users_7d,
                (SELECT COUNT(*) FROM users WHERE role='user' AND status='active')::int AS active_users`,
      );
      return JSON.stringify(rows[0] ?? {});
    }
    default:
      return '';
  }
}
