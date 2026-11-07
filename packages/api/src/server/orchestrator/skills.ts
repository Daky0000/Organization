// ─────────────────────────────────────────────────────────────────────────────
// Skill registry — every agent in the app, as a skill of ONE orchestrator.
//
// Nothing was deleted. The prompts still live where they always did and are
// still edited where they always were:
//   • marketing team  → agent_templates (Admin → Agents → templates): Nova,
//     Sage, Aria, Flux, Trend, Persona, SEO, Hook, Caption, Script, Ads,
//     Thumb, Meta, Brief (Daky, the old team lead, is the orchestrator itself)
//   • platform leads  → admin_agents (APEX, NEXUS, VERA, FORGE, PULSE) —
//     admin accounts only; their autonomous runs stay on the admin page
//   • sales           → built-in skills below (lead targeting, sales coach,
//     call insights) plus the background sales agents, listed so staff can
//     see they are part of the same agent
//   • core            → decision advisor, planner
//
// Each skill names the context packs it reads by default (see dataPacks.ts);
// the planner can add more per step.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import type { PackKey } from './dataPacks.ts';

export type SkillSource = 'core' | 'sales' | 'marketing_team' | 'platform' | 'background';

export interface Skill {
  key: string;
  name: string;
  role: string;
  description: string;
  source: SkillSource;
  icon: string;
  color: string;
  prompt: string;
  packs: PackKey[];
  /** Things this skill can make happen (shown to the planner and the user). */
  tools: string[];
  adminOnly?: boolean;
  /** Background skills run on their own inside the app and are not planned. */
  plannable: boolean;
  /** Where the prompt is edited. */
  editable_at?: string;
}

const DECISION_PROMPT = `You are the decision advisor. When a choice has to be made you lay out the real options (2-4), what each costs and gains (money, time, risk, people), what the data says, and which one you recommend and why — then the first concrete step. You are honest about uncertainty and name the one fact that would change your recommendation. You never pretend data exists when it does not.`;

const TARGETING_PROMPT = `You are the lead targeting strategist. For an upcoming event, programme or offer you decide which groups of leads the sales team should call, in which order, and why: fit with the agenda, the lead's role and industry, timing (budget season, deadlines, early-bird dates), warmth (interested / call-back leads first) and who can bring a whole team (HR, L&D, CEOs). You give a pitch and objection handling per group. When you recommend groups for an event, say so plainly so the app can build the call lists.`;

const COACH_PROMPT = `You are the sales coach. You turn today's call queue, follow-ups and pipeline into a concrete plan: how to reach the daily call target (at least 100 calls per salesperson), who to call first and what to say, how to recover no-answers (WhatsApp first, different time of day), and how to move interested leads to registration and payment. You use the company's call playbook and prices.`;

const INSIGHT_PROMPT = `You are the call insights analyst. You read call statistics (answer rates by hour and weekday, objections, intents, outcomes) and say what is working, what is not, and the single change most likely to raise conversions. Below 30 observations you say the sample is too small instead of guessing.`;

const RESEARCH_PROMPT = `You are the business analyst. You answer questions about the company's own offerings, events, customers and numbers using only the company context and workspace data you are given. You quote dates, prices and deadlines exactly. When something is missing you say what to add to the company context.`;

const BUILT_IN: Skill[] = [
  { key: 'decision_advisor', name: 'Decide', role: 'Decision advisor', source: 'core', icon: '⚖', color: '#0f172a', prompt: DECISION_PROMPT,
    description: 'Lays out options, trade-offs and a recommendation for business decisions (pricing, which event to push, where to spend, who to hire).',
    packs: ['company', 'sales_pipeline', 'workspace'], tools: [], plannable: true },
  { key: 'business_analyst', name: 'Analyst', role: 'Business analyst', source: 'core', icon: '◐', color: '#334155', prompt: RESEARCH_PROMPT,
    description: 'Answers questions about the company\'s offerings, events, customers and numbers from the company context and workspace data.',
    packs: ['company', 'workspace'], tools: [], plannable: true },
  { key: 'lead_targeting', name: 'Target', role: 'Lead targeting strategist', source: 'sales', icon: '◎', color: '#2563eb', prompt: TARGETING_PROMPT,
    description: 'Decides which leads to call for an upcoming event and why; groups them into segments the team can turn into call lists.',
    packs: ['company', 'lead_base', 'sales_pipeline'], tools: ['target_leads', 'create_call_list'], plannable: true },
  { key: 'sales_coach', name: 'Coach', role: 'Sales coach', source: 'sales', icon: '☎', color: '#0891b2', prompt: COACH_PROMPT,
    description: 'Builds the day\'s call plan from the queue, follow-ups and pipeline: who to call, in what order, what to say.',
    packs: ['sales_today', 'sales_pipeline', 'company'], tools: ['open_sales_overview'], plannable: true },
  { key: 'call_insights', name: 'Insights', role: 'Call insights analyst', source: 'sales', icon: '⌁', color: '#7c3aed', prompt: INSIGHT_PROMPT,
    description: 'Reads AI-call and logged-call statistics (answer rates, objections, outcomes) and recommends changes.',
    packs: ['call_stats', 'sales_pipeline'], tools: [], plannable: true },

  // Background agents: part of the same agent, run automatically.
  { key: 'followup_reader', name: 'Follow-up reader', role: 'Reads every call note', source: 'background', icon: '✎', color: '#64748b', prompt: '',
    description: 'Reads each logged call note and sets a follow-up reminder when the note implies a next step ("call me Friday 3pm").',
    packs: [], tools: ['create_reminder'], plannable: false, editable_at: 'Sales → Leads (runs on every note)' },
  { key: 'sheet_reader', name: 'Spreadsheet reader', role: 'Lead import', source: 'background', icon: '▦', color: '#64748b', prompt: '',
    description: 'Reads imported spreadsheets, finds every list of people and maps their columns.',
    packs: [], tools: ['import_leads'], plannable: false, editable_at: 'Sales → Leads → Import' },
  { key: 'daily_planner', name: 'Daily planner', role: 'To-do list writer', source: 'background', icon: '☑', color: '#64748b', prompt: '',
    description: 'Writes each salesperson\'s daily to-do list from the call queue and recent outcomes.',
    packs: [], tools: [], plannable: false, editable_at: 'Sales → Overview' },
  { key: 'ai_caller', name: 'AI caller', role: 'Voice agent', source: 'background', icon: '☏', color: '#64748b', prompt: '',
    description: 'Places AI phone calls, briefs itself on each lead, logs outcomes and objections.',
    packs: [], tools: ['place_ai_call'], plannable: false, editable_at: 'Sales → AI Calling / Settings' },
];

const TEMPLATE_TOOLS: Record<string, string[]> = {
  nova: ['create_posts', 'generate_image'], hook_writing: ['create_posts'], social_caption: ['create_posts'],
  video_script: ['generate_video'], thumbnail_design: ['generate_image'], ad_copy: ['create_posts'],
  flux: ['schedule_posts'], campaign_brief: ['create_posts'],
};

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  nova: 'Creative direction: brand voice, visual direction, content ideas.',
  sage: 'Campaign strategy: positioning, goals, channels, cadence, risks.',
  aria: 'Analytics: KPI health checks, bottlenecks, channel ranking, forecasts.',
  flux: 'Automation and workflows: scheduling, integrations, tool orchestration.',
  trend_research: 'Trends and timely content angles in the niche.',
  audience_research: 'Audience personas, pain points, objections, vocabulary.',
  seo_research: 'SEO keyword clusters by intent and funnel stage.',
  hook_writing: 'Scroll-stopping hooks and headlines.',
  social_caption: 'Platform-native captions with A/B variants.',
  video_script: 'Short- and long-form video scripts.',
  ad_copy: 'Paid ad copy variations by angle for Meta, Google, LinkedIn, TikTok.',
  thumbnail_design: 'Thumbnail and creative concept briefs.',
  meta_ads: 'Meta paid-campaign structure and decision rules.',
  campaign_brief: 'Complete, ready-to-run campaign briefs for an event or launch.',
};

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  ceo: 'Platform strategy, revenue, pricing and executive priorities (platform data).',
  coo: 'Platform operations, user experience and escalations (platform data).',
  cco: 'Content quality standards and the content ecosystem (platform data).',
  cto: 'Platform performance, API health and integrations (platform data).',
  cro: 'Revenue, conversion funnels, retention and churn (platform data).',
};

/** Replaces {brand.x} placeholders in the old agent prompts. */
export function fillBrand(prompt: string, brand: Record<string, string | null | undefined>): string {
  return prompt.replace(/\{brand\.([a-z_]+)\}/g, (_m, k: string) => {
    const v = brand[k];
    return v && String(v).trim() ? String(v).trim() : k === 'brand_name' ? 'the company' : `the ${k.replace(/_/g, ' ')}`;
  });
}

export async function loadSkills(pool: Pool, opts: { isAdmin: boolean }): Promise<Skill[]> {
  const skills: Skill[] = [...BUILT_IN];
  try {
    const { rows } = await pool.query(`SELECT agent_key, name, role, icon, color, base_prompt FROM agent_templates ORDER BY agent_key`);
    for (const r of rows) {
      if (r.agent_key === 'daky') continue; // the old team lead is now the orchestrator itself
      skills.push({
        key: r.agent_key,
        name: r.name,
        role: r.role,
        description: TEMPLATE_DESCRIPTIONS[r.agent_key] ?? r.role,
        source: 'marketing_team',
        icon: r.icon || '✦',
        color: r.color || '#5B6CF9',
        prompt: r.base_prompt || `You are ${r.name}, ${r.role}.`,
        packs: ['company', 'workspace'],
        tools: TEMPLATE_TOOLS[r.agent_key] ?? [],
        plannable: true,
        editable_at: 'Admin → Agents → Templates',
      });
    }
  } catch { /* table missing: built-ins only */ }
  if (opts.isAdmin) {
    try {
      const { rows } = await pool.query(`SELECT key, name, role, icon, color, system_prompt FROM admin_agents ORDER BY tier, key`);
      for (const r of rows) {
        skills.push({
          key: `platform_${r.key}`,
          name: r.name,
          role: r.role,
          description: PLATFORM_DESCRIPTIONS[r.key] ?? r.role,
          source: 'platform',
          icon: r.icon || '◆',
          color: r.color || '#0f172a',
          prompt: `${r.system_prompt}\n\nIn this session you advise only: autonomous platform actions stay on the admin Agents page.`,
          packs: ['platform', 'company'],
          tools: [],
          adminOnly: true,
          plannable: true,
          editable_at: 'Admin → Agents → Platform agents',
        });
      }
    } catch { /* table missing */ }
  }
  return skills;
}

/** The catalogue line the planner sees for each plannable skill. */
export function skillCatalog(skills: Skill[]): string {
  return skills.filter((s) => s.plannable)
    .map((s) => `- ${s.key} — ${s.name}, ${s.role}: ${s.description}${s.tools.length ? ` [can: ${s.tools.join(', ')}]` : ''}`)
    .join('\n');
}
