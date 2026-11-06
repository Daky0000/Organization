import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { Resend } from 'resend';
import axios from 'axios';
import { logger } from '../logger.ts';
import { isValidWebhookUrl } from '../integration-helpers.ts';
import { safeAxios } from '../ssrf-guard.ts';
import { recalcLeadScore } from './leadScoring.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Mailing automation engine.
//
// Executes the step flows built in MarketingAutomations.tsx (stored in
// mailing_automations.steps) as well as legacy rows that only have `actions`.
// Long pauses are durable: hitting a `delay` step persists the remaining steps
// to mailing_automation_jobs with a future run_at; hitting a `wait_trigger`
// persists them with status='waiting' until that trigger fires for the same
// contact. processDueAutomationJobs() is called from the scheduler tick.
// ─────────────────────────────────────────────────────────────────────────────

export type FlowStep = {
  id?: string;
  type: string;
  config?: Record<string, unknown>;
  yes_steps?: FlowStep[];
  no_steps?: FlowStep[];
  a_steps?: FlowStep[];
  b_steps?: FlowStep[];
};

export type AutomationContact = {
  id: string | null;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

type AutomationRow = {
  id: string;
  user_id: string;
  name: string;
  trigger_type: string;
  status: string;
  steps: FlowStep[] | null;
  actions: Array<Record<string, unknown>> | null;
};

// The old executor fired 'signup'; the flow builder calls it 'email_signup'.
const TRIGGER_ALIASES: Record<string, string[]> = {
  signup: ['signup', 'email_signup'],
  email_signup: ['signup', 'email_signup'],
};

const MAX_STEPS_PER_RUN = 200;
const MAX_JOB_ATTEMPTS = 5;
const WEBHOOK_TIMEOUT_MS = 10_000;

export function delayToMs(amount: unknown, unit: unknown): number {
  const n = Math.max(1, Number(amount) || 1);
  const per: Record<string, number> = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000,
  };
  return n * (per[String(unit)] ?? per.days);
}

export function personalize(template: string, contact: AutomationContact): string {
  return String(template ?? '')
    .replaceAll('{{first_name}}', contact.first_name ?? '')
    .replaceAll('{{last_name}}', contact.last_name ?? '')
    .replaceAll('{{email}}', contact.email ?? '');
}

// Legacy automations store a flat `actions` array (subject/content only).
// Convert them so both formats run through the same executor.
export function legacyActionsToSteps(actions: Array<Record<string, unknown>> | null | undefined): FlowStep[] {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({ type: 'send_email', config: { subject: a.subject, content: a.content } }));
}

// The steps an automation should run when its trigger fires: everything after
// the leading trigger node, falling back to legacy actions.
export function runnableSteps(automation: Pick<AutomationRow, 'steps' | 'actions'>): FlowStep[] {
  const steps = Array.isArray(automation.steps) ? automation.steps : [];
  const withoutTrigger = steps.filter((s) => s?.type !== 'trigger');
  if (withoutTrigger.length > 0) return withoutTrigger;
  return legacyActionsToSteps(automation.actions);
}

// A flow matches a fired trigger if its stored trigger_type matches, or the
// trigger node inside its steps names the fired trigger (covers rows created
// before trigger_type was derived from steps).
export function matchesTrigger(automation: Pick<AutomationRow, 'trigger_type' | 'steps'>, firedTrigger: string): boolean {
  const fired = TRIGGER_ALIASES[firedTrigger] ?? [firedTrigger];
  if (fired.includes(automation.trigger_type)) return true;
  const triggerStep = (Array.isArray(automation.steps) ? automation.steps : []).find((s) => s?.type === 'trigger');
  const stepTrigger = String(triggerStep?.config?.trigger ?? '');
  return stepTrigger !== '' && fired.includes(stepTrigger);
}

export function deriveTriggerType(steps: unknown): string {
  if (!Array.isArray(steps)) return 'api';
  const trigger = (steps as FlowStep[]).find((s) => s?.type === 'trigger');
  return String(trigger?.config?.trigger ?? '').trim() || 'api';
}

interface EngineDeps {
  pool: Pool | null;
  getResendConfig: () => Promise<{ apiKey: string; fromEmail: string; fromName: string }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  appUrl: string;
  // The sales steps (place_call, create_followup, set_lead_stage) delegate here
  // rather than writing sales tables directly — queueCall in particular must run
  // the compliance gate, which is not something a flow step gets to skip.
  salesEngine?: {
    ensureLeadProfile: (userId: string, contactId: string) => Promise<string | null>;
    queueCall: (params: { userId: string; contactId: string; objective?: string | null }) => Promise<{ queued: boolean }>;
  };
}

export function buildAutomationEngine({ pool, getResendConfig, getPlatformConfig, appUrl, salesEngine }: EngineDeps) {
  async function loadContact(userId: string, contact: Partial<AutomationContact>): Promise<AutomationContact | null> {
    if (!pool) return null;
    const byId = contact.id ? 'id=$2' : 'LOWER(email)=LOWER($2)';
    const key = contact.id ?? contact.email;
    if (!key) return null;
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, phone, subscribed, custom_data FROM mailing_contacts WHERE user_id=$1 AND ${byId} LIMIT 1`,
      [userId, key]
    );
    if (!rows.length) {
      // Trigger data may reference someone not (yet) in the audience — still run with what we have.
      return contact.email ? { id: null, email: contact.email, first_name: contact.first_name, last_name: contact.last_name } : null;
    }
    return rows[0] as AutomationContact;
  }

  async function isSubscribed(userId: string, contact: AutomationContact): Promise<boolean> {
    if (!pool || !contact.id) return true;
    const { rows } = await pool.query(
      `SELECT subscribed FROM mailing_contacts WHERE user_id=$1 AND id=$2`,
      [userId, contact.id]
    );
    return rows.length === 0 || rows[0].subscribed !== false;
  }

  async function getUnsubscribeUrl(userId: string, contact: AutomationContact): Promise<string | null> {
    if (!pool || !contact.id) return null;
    const { rows } = await pool.query(
      `SELECT unsubscribe_token FROM mailing_contacts WHERE user_id=$1 AND id=$2`,
      [userId, contact.id]
    );
    const token = rows[0]?.unsubscribe_token;
    return token ? `${appUrl.replace(/\/+$/, '')}/api/mailing/unsubscribe/${token}` : null;
  }

  async function sendEmail(userId: string, contact: AutomationContact, opts: { subject: string; html: string; fromName?: string; fromEmail?: string; to?: string }): Promise<void> {
    // Sales leads can be phone-only (mailing_contacts.email is nullable since
    // the sales module landed), so an email step over a phone-only contact is
    // a skip, not a failure that burns the flow's retry budget.
    if (!opts.to && !contact.email) {
      logger.info({ userId, contactId: contact.id }, 'automation_email_skipped_no_email');
      return;
    }
    const { apiKey, fromEmail, fromName } = await getResendConfig();
    if (!apiKey) throw new Error('Resend is not configured');
    const finalFromEmail = String(opts.fromEmail || fromEmail);
    const finalFromName = String(opts.fromName || fromName || '');
    const from = finalFromName ? `${finalFromName} <${finalFromEmail}>` : finalFromEmail;
    // Resolve the builder's {{unsubscribe_url}} footer placeholder (team
    // notifications sent via opts.to keep the contact's link out of them).
    const unsubscribeUrl = opts.to ? null : await getUnsubscribeUrl(userId, contact).catch(() => null);
    const html = personalize(opts.html, contact).replaceAll('{{unsubscribe_url}}', unsubscribeUrl ?? '#');
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to ?? contact.email,
      subject: personalize(opts.subject, contact),
      html,
      headers: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>` } : undefined,
    });
    if (error) throw new Error(error.message);
    if (!opts.to && pool) {
      // resend_id lets the /webhooks/resend endpoint correlate opens/clicks back to this contact
      await pool.query(
        `INSERT INTO mailing_email_events (id, user_id, campaign_id, contact_id, event_type, metadata, created_at) VALUES ($1,$2,NULL,$3,'delivered',$4::jsonb,NOW())`,
        [randomUUID(), userId, contact.id, JSON.stringify({ resend_id: data?.id ?? null })]
      ).catch((err) => logger.warn({ err }, 'automation_email_event_insert_failed'));
    }
  }

  async function sendHubtelSms(userId: string, contact: AutomationContact, message: string): Promise<void> {
    if (!contact.phone) {
      logger.info({ userId, contactId: contact.id }, 'automation_sms_skipped_no_phone');
      return;
    }
    const cfg = await getPlatformConfig('hubtel').catch(() => ({} as Record<string, string>));
    const clientId = cfg.clientId || process.env.HUBTEL_CLIENT_ID || '';
    const clientSecret = cfg.clientSecret || process.env.HUBTEL_CLIENT_SECRET || '';
    const senderId = cfg.smsSenderId || cfg.senderId || process.env.HUBTEL_SMS_SENDER_ID || '';
    if (!clientId || !clientSecret || !senderId) {
      throw new Error('Hubtel SMS is not configured — set clientId, clientSecret and smsSenderId in Admin → Platform Settings (hubtel)');
    }
    const resp = await axios.post(
      'https://smsc.hubtel.com/v1/messages/send',
      { From: senderId, To: contact.phone, Content: personalize(message, contact).slice(0, 480) },
      { auth: { username: clientId, password: clientSecret }, timeout: 15_000, validateStatus: () => true }
    );
    if (resp.status >= 400) {
      throw new Error(`Hubtel SMS failed (${resp.status}): ${JSON.stringify(resp.data)?.slice(0, 200)}`);
    }
  }

  async function hasTag(userId: string, contact: AutomationContact, tag: string): Promise<boolean> {
    if (!pool || !contact.id || !tag) return false;
    const { rows } = await pool.query(
      `SELECT 1 FROM mailing_contact_tags WHERE user_id=$1 AND contact_id=$2 AND LOWER(tag)=LOWER($3) LIMIT 1`,
      [userId, contact.id, tag]
    );
    return rows.length > 0;
  }

  async function hasEmailEvent(userId: string, contact: AutomationContact, eventType: string): Promise<boolean> {
    if (!pool || !contact.id) return false;
    const { rows } = await pool.query(
      `SELECT 1 FROM mailing_email_events WHERE user_id=$1 AND contact_id=$2 AND event_type=$3 LIMIT 1`,
      [userId, contact.id, eventType]
    );
    return rows.length > 0;
  }

  async function getLeadScore(userId: string, contact: AutomationContact): Promise<number> {
    if (!pool || !contact.id) return 0;
    const { rows } = await pool.query(
      `SELECT COALESCE((custom_data->>'lead_score')::numeric, 0) AS score FROM mailing_contacts WHERE user_id=$1 AND id=$2`,
      [userId, contact.id]
    );
    return Number(rows[0]?.score ?? 0);
  }

  async function evaluateCondition(userId: string, contact: AutomationContact, config: Record<string, unknown>): Promise<boolean> {
    const type = String(config.condition_type ?? 'tag');
    const value = String(config.condition ?? '').trim();
    switch (type) {
      case 'tag': return hasTag(userId, contact, value);
      case 'group': return hasTag(userId, contact, `group:${value}`);
      case 'email_opened': return hasEmailEvent(userId, contact, 'open');
      case 'link_clicked': return hasEmailEvent(userId, contact, 'click');
      case 'lead_score': return (await getLeadScore(userId, contact)) >= Number(value || 0);
      case 'lead_stage': {
        if (!pool || !contact.id) return false;
        const { rows } = await pool.query(
          `SELECT stage FROM sales_lead_profiles WHERE user_id=$1 AND contact_id=$2`,
          [userId, contact.id]
        );
        return String(rows[0]?.stage ?? '') === value;
      }
      case 'has_objection': {
        if (!pool || !contact.id) return false;
        // An unresolved objection only — a handled one should not keep gating.
        const { rows } = await pool.query(
          `SELECT 1 FROM sales_conversation_objections
            WHERE user_id=$1 AND contact_id=$2 AND resolved=false
              AND ($3='' OR objection_code=$3) LIMIT 1`,
          [userId, contact.id, value]
        );
        return rows.length > 0;
      }
      case 'call_outcome': {
        if (!pool || !contact.id) return false;
        const { rows } = await pool.query(
          `SELECT outcome FROM sales_call_attempts
            WHERE user_id=$1 AND contact_id=$2 AND outcome IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
          [userId, contact.id]
        );
        return String(rows[0]?.outcome ?? '') === value;
      }
      case 'field': {
        // Single-value UI: true when any core field matches the value.
        const v = value.toLowerCase();
        return [contact.email, contact.first_name, contact.last_name, contact.phone]
          .some((f) => String(f ?? '').toLowerCase() === v);
      }
      case 'in_campaign': {
        // Value from the single-value UI may be a campaign id or its name.
        if (!pool || !contact.id) return false;
        const { rows } = await pool.query(
          `SELECT 1 FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
           WHERE m.user_id=$1 AND m.contact_id=$2 AND ($3='' OR m.campaign_id=$3 OR LOWER(c.name)=LOWER($3)) LIMIT 1`,
          [userId, contact.id, value]
        ).catch(() => ({ rows: [] as unknown[] }));
        return rows.length > 0;
      }
      case 'survey_completed': {
        if (!pool) return false;
        const { rows } = await pool.query(
          `SELECT 1 FROM survey_responses r JOIN surveys s ON s.id = r.survey_id
           WHERE s.user_id=$1 AND (r.contact_id=$2 OR LOWER(r.respondent_email)=LOWER($3)) LIMIT 1`,
          [userId, contact.id ?? '', contact.email ?? '']
        ).catch(() => ({ rows: [] as unknown[] }));
        return rows.length > 0;
      }
      case 'survey_score': {
        // Average of the numeric answers in the contact's latest response.
        if (!pool) return false;
        const { rows } = await pool.query(
          `SELECT r.answers FROM survey_responses r JOIN surveys s ON s.id = r.survey_id
           WHERE s.user_id=$1 AND (r.contact_id=$2 OR LOWER(r.respondent_email)=LOWER($3))
           ORDER BY r.created_at DESC LIMIT 1`,
          [userId, contact.id ?? '', contact.email ?? '']
        ).catch(() => ({ rows: [] as Array<{ answers: unknown }> }));
        if (!rows.length) return false;
        const answers = (typeof rows[0].answers === 'string' ? JSON.parse(rows[0].answers) : rows[0].answers) as Array<{ value?: unknown }>;
        const nums = (Array.isArray(answers) ? answers : [])
          .map((a) => Number(a?.value)).filter((n) => Number.isFinite(n));
        if (!nums.length) return false;
        return nums.reduce((s, n) => s + n, 0) / nums.length >= Number(value || 0);
      }
      case 'purchase': {
        // last_purchase_at is recorded when a purchase event arrives via POST /api/v1/trigger.
        if (!pool || !contact.id) return false;
        const { rows } = await pool.query(
          `SELECT 1 FROM mailing_contacts WHERE user_id=$1 AND id=$2 AND custom_data->>'last_purchase_at' IS NOT NULL LIMIT 1`,
          [userId, contact.id]
        ).catch(() => ({ rows: [] as unknown[] }));
        return rows.length > 0;
      }
      default:
        logger.info({ conditionType: type }, 'automation_condition_unsupported');
        return false;
    }
  }

  async function persistJob(params: {
    userId: string; automationId: string; contact: AutomationContact;
    steps: FlowStep[]; runAt: Date; status: 'pending' | 'waiting'; waitTrigger?: string;
  }): Promise<void> {
    if (!pool || params.steps.length === 0) return;
    await pool.query(
      `INSERT INTO mailing_automation_jobs (id, user_id, automation_id, contact_id, contact, steps, wait_trigger, run_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(), params.userId, params.automationId, params.contact.id,
        JSON.stringify(params.contact), JSON.stringify(params.steps),
        params.waitTrigger ?? null, params.runAt, params.status,
      ]
    );
  }

  // Runs steps sequentially until done or until a delay/wait_trigger persists
  // the continuation. Branch steps are spliced in front of the remaining flow.
  async function executeSteps(userId: string, automationId: string, contact: AutomationContact, steps: FlowStep[]): Promise<void> {
    if (!pool) return;
    const queue = [...steps];
    let executed = 0;

    while (queue.length > 0) {
      if (++executed > MAX_STEPS_PER_RUN) {
        logger.warn({ automationId, userId }, 'automation_step_budget_exceeded');
        return;
      }
      const step = queue.shift()!;
      const cfg = (step.config ?? {}) as Record<string, unknown>;

      switch (step.type) {
        case 'trigger':
          break; // already fired

        case 'delay': {
          const runAt = new Date(Date.now() + delayToMs(cfg.amount, cfg.unit));
          await persistJob({ userId, automationId, contact, steps: queue, runAt, status: 'pending' });
          return;
        }

        case 'wait_trigger': {
          const waitFor = String(cfg.trigger ?? '').trim();
          if (!waitFor) break; // unconfigured — skip
          await persistJob({ userId, automationId, contact, steps: queue, runAt: new Date(), status: 'waiting', waitTrigger: waitFor });
          return;
        }

        case 'if_else': {
          const result = await evaluateCondition(userId, contact, cfg);
          queue.unshift(...((result ? step.yes_steps : step.no_steps) ?? []));
          break;
        }

        case 'split': {
          const percentA = Math.min(99, Math.max(1, Number(cfg.percent_a ?? 50)));
          const pickA = Math.random() * 100 < percentA;
          queue.unshift(...((pickA ? step.a_steps : step.b_steps) ?? []));
          break;
        }

        case 'send_email': {
          if (!(await isSubscribed(userId, contact))) break;
          const subject = String(cfg.subject ?? '').trim() || 'A message for you';
          // The flow builder has no body editor yet — fall back through the best available text.
          const html = String(cfg.content ?? cfg.html ?? cfg.preview ?? subject);
          await sendEmail(userId, contact, { subject, html, fromName: cfg.from_name as string, fromEmail: cfg.from_email as string });
          break;
        }

        case 'send_survey': {
          if (!(await isSubscribed(userId, contact))) break;
          const surveyId = String(cfg.survey_id ?? '').trim();
          if (!surveyId) break;
          const subject = String(cfg.subject ?? '').trim() || "We'd love your feedback";
          const link = `${appUrl}/survey/${surveyId}`;
          await sendEmail(userId, contact, {
            subject,
            html: `<p>Hi {{first_name}},</p><p>${subject}</p><p><a href="${link}">Take the survey</a></p>`,
          });
          break;
        }

        case 'send_sms': {
          await sendHubtelSms(userId, contact, String(cfg.message ?? ''));
          break;
        }

        // ── AI Sales OS steps ──
        // Each one is a thin delegate. The engine deliberately does not touch
        // sales tables itself: queueCall runs the compliance gate, and a flow
        // step must not be able to route around it.
        case 'place_call': {
          if (!contact.id || !salesEngine) break;
          const result = await salesEngine.queueCall({
            userId,
            contactId: contact.id,
            objective: String(cfg.objective ?? '') || null,
          });
          if (!result.queued) {
            logger.info({ userId, contactId: contact.id }, 'automation_call_blocked_by_policy');
          }
          break;
        }

        case 'create_followup': {
          if (!contact.id || !salesEngine) break;
          const leadProfileId = await salesEngine.ensureLeadProfile(userId, contact.id);
          const runAt = new Date(Date.now() + delayToMs(cfg.amount ?? 3, cfg.unit ?? 'days'));
          await pool.query(
            `INSERT INTO sales_followups
               (id, user_id, contact_id, lead_profile_id, type, requested_by, scheduled_for, reason, objective)
             VALUES ($1,$2,$3,$4,$5,'automation',$6,$7,$8)`,
            [
              randomUUID(), userId, contact.id, leadProfileId,
              String(cfg.type ?? 'phone_call'), runAt,
              String(cfg.reason ?? 'Created by an automation'),
              String(cfg.objective ?? '') || null,
            ],
          );
          break;
        }

        case 'set_lead_stage': {
          if (!contact.id || !salesEngine) break;
          const stage = String(cfg.stage ?? '').trim();
          // Guard the CHECK constraint: an unknown stage would abort the query.
          const allowed = ['new', 'contacted', 'qualified', 'interested', 'proposal', 'negotiation', 'won', 'lost', 'unreachable'];
          if (!allowed.includes(stage)) break;
          await salesEngine.ensureLeadProfile(userId, contact.id);
          await pool.query(
            `UPDATE sales_lead_profiles SET stage=$1, updated_at=NOW() WHERE contact_id=$2 AND user_id=$3`,
            [stage, contact.id, userId],
          );
          break;
        }

        case 'tag':
        case 'group': {
          const tag = step.type === 'group' ? `group:${String(cfg.group ?? '').trim()}` : String(cfg.tag ?? '').trim();
          if (!contact.id || !tag || tag === 'group:') break;
          await pool.query(
            `INSERT INTO mailing_contact_tags (id, contact_id, user_id, tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [randomUUID(), contact.id, userId, tag]
          );
          await recalcLeadScore(pool, userId, contact.id);
          break;
        }

        case 'untag':
        case 'ungroup': {
          const tag = step.type === 'ungroup' ? `group:${String(cfg.group ?? '').trim()}` : String(cfg.tag ?? '').trim();
          if (!contact.id || !tag || tag === 'group:') break;
          await pool.query(
            `DELETE FROM mailing_contact_tags WHERE user_id=$1 AND contact_id=$2 AND LOWER(tag)=LOWER($3)`,
            [userId, contact.id, tag]
          );
          await recalcLeadScore(pool, userId, contact.id);
          break;
        }

        case 'update_contact': {
          if (!contact.id) break;
          const field = String(cfg.field ?? '').trim().toLowerCase().replace(/\s+/g, '_');
          const value = String(cfg.value ?? '');
          const columns = new Set(['first_name', 'last_name', 'phone']);
          if (columns.has(field)) {
            await pool.query(`UPDATE mailing_contacts SET ${field}=$1, updated_at=NOW() WHERE user_id=$2 AND id=$3`, [value, userId, contact.id]);
          } else if (field) {
            await pool.query(
              `UPDATE mailing_contacts SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object($1::text, $2::text), updated_at=NOW() WHERE user_id=$3 AND id=$4`,
              [field, value, userId, contact.id]
            );
          }
          break;
        }

        case 'unsubscribe':
        case 'archive': {
          if (!contact.id) break;
          await pool.query(
            `UPDATE mailing_contacts SET subscribed=false, unsubscribed_at=NOW(), updated_at=NOW() WHERE user_id=$1 AND id=$2`,
            [userId, contact.id]
          );
          await recalcLeadScore(pool, userId, contact.id);
          break;
        }

        case 'score_lead': {
          if (!contact.id) break;
          const points = Number(cfg.points ?? 0);
          // Adjustment is a running counter on top of the rules-based score;
          // recalcLeadScore combines both into custom_data.lead_score.
          await pool.query(
            `UPDATE mailing_contacts SET custom_data = COALESCE(custom_data,'{}'::jsonb) ||
               jsonb_build_object('lead_score_adjustment', COALESCE((custom_data->>'lead_score_adjustment')::numeric, 0) + $1::numeric),
             updated_at=NOW() WHERE user_id=$2 AND id=$3`,
            [points, userId, contact.id]
          );
          await recalcLeadScore(pool, userId, contact.id);
          break;
        }

        case 'webhook': {
          const url = String(cfg.url ?? '').trim();
          if (!isValidWebhookUrl(url)) {
            logger.warn({ automationId, url }, 'automation_webhook_invalid_url');
            break;
          }
          try {
            // SSRF-guarded: rejects private/reserved/metadata targets and pins
            // the connection to a safe IP through redirects.
            await safeAxios({
              method: 'POST',
              url,
              headers: { 'Content-Type': 'application/json' },
              data: { automation_id: automationId, contact },
              timeout: WEBHOOK_TIMEOUT_MS,
              validateStatus: () => true,
            });
          } catch (err) {
            logger.warn({ err, automationId }, 'automation_webhook_blocked_or_failed');
          }
          break;
        }

        case 'notify_team': {
          const to = String(cfg.to_email ?? '').trim();
          if (!to) break;
          await sendEmail(userId, contact, {
            to,
            subject: String(cfg.subject ?? 'Automation notification'),
            html: String(cfg.message ?? '').replace(/\n/g, '<br/>') || 'A contact reached a step in your automation.',
          });
          break;
        }

        case 'add_to_campaign': {
          const campaignId = String(cfg.campaign_id ?? '').trim();
          if (!contact.id || !campaignId) break;
          // Ownership check doubles as an existence check for the FK.
          const owned = await pool.query(`SELECT 1 FROM campaigns WHERE id=$1 AND user_id=$2 LIMIT 1`, [campaignId, userId]);
          if (!owned.rows.length) {
            logger.warn({ automationId, campaignId }, 'automation_add_to_campaign_unknown_campaign');
            break;
          }
          await pool.query(
            `INSERT INTO campaign_members (user_id, campaign_id, contact_id, label, source)
             VALUES ($1,$2,$3,$4,'automation') ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
            [userId, campaignId, contact.id, String(cfg.label ?? '').trim() || null]
          );
          break;
        }

        case 'create_project_task': {
          const rawTitle = personalize(String(cfg.title ?? 'Follow up with {{first_name}} ({{email}})'), contact).trim();
          const rawDesc = personalize(String(cfg.description ?? 'Auto-created by cross-module automation flow.'), contact).trim();
          const priority = ['low', 'medium', 'high', 'urgent'].includes(String(cfg.priority))
            ? String(cfg.priority)
            : 'high';
          let projectId = String(cfg.project_id ?? '').trim();
          if (!projectId) {
            const { rows: projRows } = await pool.query(
              `SELECT p.id FROM projects p
               INNER JOIN organization_memberships m ON m.org_id = p.org_id
               WHERE m.user_id = $1
               ORDER BY p.created_at ASC LIMIT 1`,
              [userId]
            ).catch(() => ({ rows: [] as Array<{ id: string }> }));
            projectId = projRows[0]?.id || '';
          }
          if (projectId) {
            await pool.query(
              `INSERT INTO tasks (id, project_id, title, description, status, priority, position, created_by)
               VALUES ($1, $2, $3, $4, 'todo', $5, 0, $6)`,
              [randomUUID(), projectId, rawTitle, rawDesc, priority, userId]
            ).catch(() => undefined);
          }
          break;
        }

        case 'create_crm_deal': {
          const dealTitle = personalize(String(cfg.title ?? 'Opportunity: {{first_name}} {{last_name}}'), contact).trim();
          const dealValue = Number(cfg.value ?? 1000) || 1000;
          await pool.query(
            `INSERT INTO crm_deals (id, user_id, title, value, currency, stage_id, contact_id, description)
             VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7)`,
            [
              randomUUID(),
              userId,
              dealTitle,
              dealValue,
              null,
              contact.id,
              `Created automatically by flow ${automationId} for ${contact.email}`,
            ]
          ).catch(() => undefined);
          break;
        }

        default:
          logger.info({ automationId, stepType: step.type }, 'automation_step_skipped_unsupported');
          break;
      }
    }
  }

  async function runAutomationForContact(userId: string, automation: AutomationRow, contactInput: Partial<AutomationContact>): Promise<void> {
    const contact = await loadContact(userId, contactInput);
    if (!contact) return;
    const steps = runnableSteps(automation);
    if (steps.length === 0) return;
    try {
      await executeSteps(userId, automation.id, contact, steps);
    } catch (err) {
      logger.error({ err, automationId: automation.id, userId }, 'automation_run_failed');
    }
  }

  // Entry point: call when something happens (contact created, tag added, …).
  async function fireAutomationTrigger(userId: string, triggerType: string, contactInput: Partial<AutomationContact>): Promise<void> {
    if (!pool) return;
    try {
      // Resume runs paused on a wait_trigger for this contact.
      if (contactInput.email || contactInput.id) {
        const fired = TRIGGER_ALIASES[triggerType] ?? [triggerType];
        await pool.query(
          `UPDATE mailing_automation_jobs SET status='pending', wait_trigger=NULL, run_at=NOW(), updated_at=NOW()
           WHERE user_id=$1 AND status='waiting' AND wait_trigger = ANY($2)
             AND (($3::text IS NOT NULL AND contact_id=$3) OR LOWER(contact->>'email')=LOWER($4))`,
          [userId, fired, contactInput.id ?? null, contactInput.email ?? '']
        );
      }

      const { rows } = await pool.query<AutomationRow>(
        `SELECT id, user_id, name, trigger_type, status, steps, actions FROM mailing_automations WHERE user_id=$1 AND status='active'`,
        [userId]
      );
      for (const automation of rows) {
        if (!matchesTrigger(automation, triggerType)) continue;
        await runAutomationForContact(userId, automation, contactInput);
      }
    } catch (err) {
      logger.error({ err, userId, triggerType }, 'automation_trigger_failed');
    }
  }

  // Birthday trigger: once per day, run flows with a 'birthday' trigger for
  // contacts whose custom_data.birthday (YYYY-MM-DD or MM-DD) is today. A
  // deterministic job id (automation+contact+year) dedupes across restarts
  // and multiple instances.
  let lastBirthdayRunDate = '';
  async function processBirthdayTriggers(): Promise<void> {
    if (!pool) return;
    const today = new Date().toISOString().slice(0, 10);
    if (lastBirthdayRunDate === today) return;
    lastBirthdayRunDate = today;
    try {
      const { rows: automations } = await pool.query<AutomationRow>(
        `SELECT id, user_id, name, trigger_type, status, steps, actions FROM mailing_automations WHERE status='active'`
      );
      const birthdayFlows = automations.filter((a) => matchesTrigger(a, 'birthday'));
      if (!birthdayFlows.length) return;
      const monthDay = today.slice(5); // MM-DD
      const year = today.slice(0, 4);
      for (const flow of birthdayFlows) {
        const { rows: contacts } = await pool.query(
          `SELECT id, email, first_name, last_name, phone FROM mailing_contacts
           WHERE user_id=$1 AND subscribed=true AND email IS NOT NULL AND RIGHT(custom_data->>'birthday', 5) = $2`,
          [flow.user_id, monthDay]
        );
        for (const contact of contacts) {
          const dedupeId = `bday_${flow.id}_${contact.id}_${year}`;
          const { rowCount } = await pool.query(
            `INSERT INTO mailing_automation_jobs (id, user_id, automation_id, contact_id, contact, steps, run_at, status)
             VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,NOW(),'done') ON CONFLICT (id) DO NOTHING`,
            [dedupeId, flow.user_id, flow.id, contact.id, JSON.stringify(contact)]
          );
          if (rowCount) await runAutomationForContact(flow.user_id, flow, contact);
        }
      }
    } catch (err) {
      logger.error({ err }, 'automation_birthday_tick_failed');
    }
  }

  // specific_date trigger: once per day, run flows whose trigger step is
  // configured with today's date (config.date = YYYY-MM-DD) for every
  // subscribed contact. Deduped like birthdays via a deterministic job id.
  let lastSpecificDateRunDate = '';
  async function processSpecificDateTriggers(): Promise<void> {
    if (!pool) return;
    const today = new Date().toISOString().slice(0, 10);
    if (lastSpecificDateRunDate === today) return;
    lastSpecificDateRunDate = today;
    try {
      const { rows: automations } = await pool.query<AutomationRow>(
        `SELECT id, user_id, name, trigger_type, status, steps, actions FROM mailing_automations WHERE status='active'`
      );
      const dueFlows = automations.filter((a) => {
        if (!matchesTrigger(a, 'specific_date')) return false;
        const triggerStep = (Array.isArray(a.steps) ? a.steps : []).find((s) => s?.type === 'trigger');
        return String(triggerStep?.config?.date ?? '').slice(0, 10) === today;
      });
      if (!dueFlows.length) return;
      for (const flow of dueFlows) {
        const { rows: contacts } = await pool.query(
          `SELECT id, email, first_name, last_name, phone FROM mailing_contacts
           WHERE user_id=$1 AND subscribed=true AND email IS NOT NULL`,
          [flow.user_id]
        );
        for (const contact of contacts) {
          const dedupeId = `sdate_${flow.id}_${contact.id}_${today}`;
          const { rowCount } = await pool.query(
            `INSERT INTO mailing_automation_jobs (id, user_id, automation_id, contact_id, contact, steps, run_at, status)
             VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,NOW(),'done') ON CONFLICT (id) DO NOTHING`,
            [dedupeId, flow.user_id, flow.id, contact.id, JSON.stringify(contact)]
          );
          if (rowCount) await runAutomationForContact(flow.user_id, flow, contact);
        }
      }
    } catch (err) {
      logger.error({ err }, 'automation_specific_date_tick_failed');
    }
  }

  // email_unopened trigger ("Doesn't open email (30 days)"): once per day,
  // find subscribed contacts who received an email 30+ days ago and have not
  // opened anything in the last 30 days. Fires once per contact per flow.
  let lastUnopenedRunDate = '';
  async function processEmailUnopenedTriggers(): Promise<void> {
    if (!pool) return;
    const today = new Date().toISOString().slice(0, 10);
    if (lastUnopenedRunDate === today) return;
    lastUnopenedRunDate = today;
    try {
      const { rows: automations } = await pool.query<AutomationRow>(
        `SELECT id, user_id, name, trigger_type, status, steps, actions FROM mailing_automations WHERE status='active'`
      );
      const unopenedFlows = automations.filter((a) => matchesTrigger(a, 'email_unopened'));
      if (!unopenedFlows.length) return;
      for (const flow of unopenedFlows) {
        const { rows: contacts } = await pool.query(
          `SELECT c.id, c.email, c.first_name, c.last_name, c.phone
           FROM mailing_contacts c
           WHERE c.user_id=$1 AND c.subscribed=true
             AND EXISTS (SELECT 1 FROM mailing_email_events d
                         WHERE d.user_id=c.user_id AND d.contact_id=c.id AND d.event_type='delivered'
                           AND d.created_at <= NOW() - INTERVAL '30 days')
             AND NOT EXISTS (SELECT 1 FROM mailing_email_events o
                             WHERE o.user_id=c.user_id AND o.contact_id=c.id AND o.event_type='open'
                               AND o.created_at >= NOW() - INTERVAL '30 days')
           LIMIT 500`,
          [flow.user_id]
        );
        for (const contact of contacts) {
          const dedupeId = `unopened_${flow.id}_${contact.id}`;
          const { rowCount } = await pool.query(
            `INSERT INTO mailing_automation_jobs (id, user_id, automation_id, contact_id, contact, steps, run_at, status)
             VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,NOW(),'done') ON CONFLICT (id) DO NOTHING`,
            [dedupeId, flow.user_id, flow.id, contact.id, JSON.stringify(contact)]
          );
          if (rowCount) await runAutomationForContact(flow.user_id, flow, contact);
        }
      }
    } catch (err) {
      logger.error({ err }, 'automation_unopened_tick_failed');
    }
  }

  // Called from the scheduler tick: claim and run due continuations.
  async function processDueAutomationJobs(): Promise<void> {
    if (!pool) return;
    void processBirthdayTriggers();
    void processSpecificDateTriggers();
    void processEmailUnopenedTriggers();
    try {
      const { rows: jobs } = await pool.query(
        `UPDATE mailing_automation_jobs SET status='processing', attempts=attempts+1, updated_at=NOW()
         WHERE id IN (
           SELECT id FROM mailing_automation_jobs
           WHERE status='pending' AND run_at <= NOW() AND attempts < $1
           ORDER BY run_at LIMIT 50 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, user_id, automation_id, contact, steps`,
        [MAX_JOB_ATTEMPTS]
      );
      for (const job of jobs) {
        try {
          const contact = (typeof job.contact === 'string' ? JSON.parse(job.contact) : job.contact) as AutomationContact;
          const steps = (typeof job.steps === 'string' ? JSON.parse(job.steps) : job.steps) as FlowStep[];
          await executeSteps(job.user_id, job.automation_id, contact, steps ?? []);
          await pool.query(`UPDATE mailing_automation_jobs SET status='done', updated_at=NOW() WHERE id=$1`, [job.id]);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, jobId: job.id }, 'automation_job_failed');
          await pool.query(
            `UPDATE mailing_automation_jobs SET status=CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
             last_error=$3, run_at=NOW() + INTERVAL '5 minutes', updated_at=NOW() WHERE id=$1`,
            [job.id, MAX_JOB_ATTEMPTS, message.slice(0, 500)]
          ).catch(() => undefined);
        }
      }
    } catch (err) {
      logger.error({ err }, 'automation_jobs_tick_failed');
    }
  }

  return { fireAutomationTrigger, runAutomationForContact, processDueAutomationJobs };
}
