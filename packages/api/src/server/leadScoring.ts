import type { Pool } from 'pg';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Lead scoring.
//
// Rules (crm_lead_scoring_rules, managed in CRM → Lead Scoring) describe
// contact state: tags, subscription status, marketing consent. The total score
// is rules score + custom_data.lead_score_adjustment (the running counter the
// automation engine's "Score Lead" step increments), clamped to 0–100, stored
// in custom_data.lead_score.
//
// recalcLeadScore is called automatically whenever contact state changes
// (tags, subscribe/unsubscribe, consent, suppression) — previously it only ran
// via the manual POST /api/crm/scoring/recalculate/:contactId endpoint.
// ─────────────────────────────────────────────────────────────────────────────

type RuleCondition = { field: string; op: string; value: string };

export function evaluateRule(
  cond: RuleCondition,
  contact: { tags: string[]; subscribed: boolean; email_marketing_consent: boolean }
): boolean {
  if (cond.field === 'tag') {
    const has = contact.tags.includes(cond.value);
    return cond.op === 'has' ? has : !has;
  }
  if (cond.field === 'subscribed') return contact.subscribed === (cond.op === 'is_true');
  if (cond.field === 'email_consent') return contact.email_marketing_consent === (cond.op === 'is_true');
  return false;
}

export async function recalcLeadScore(pool: Pool | null, userId: string, contactId: string): Promise<number | null> {
  if (!pool || !contactId) return null;
  try {
    const [{ rows: rules }, { rows: contactRows }] = await Promise.all([
      pool.query(
        `SELECT condition, points FROM crm_lead_scoring_rules WHERE user_id=$1 AND active=true ORDER BY position`,
        [userId]
      ),
      pool.query(
        `SELECT mc.subscribed, mc.email_marketing_consent, mc.custom_data,
                COALESCE(ARRAY_AGG(mct.tag) FILTER (WHERE mct.tag IS NOT NULL), '{}') AS tags
         FROM mailing_contacts mc
         LEFT JOIN mailing_contact_tags mct ON mct.contact_id = mc.id
         WHERE mc.id=$1 AND mc.user_id=$2 GROUP BY mc.id`,
        [contactId, userId]
      ),
    ]);
    const contact = contactRows[0];
    if (!contact) return null;

    let rulesScore = 0;
    for (const rule of rules) {
      const cond = (typeof rule.condition === 'string' ? JSON.parse(rule.condition) : rule.condition) as RuleCondition;
      if (evaluateRule(cond, {
        tags: contact.tags ?? [],
        subscribed: contact.subscribed !== false,
        email_marketing_consent: contact.email_marketing_consent === true,
      })) {
        rulesScore += Number(rule.points) || 0;
      }
    }

    const adjustment = Number(contact.custom_data?.lead_score_adjustment ?? 0) || 0;
    const total = Math.max(0, Math.min(100, rulesScore + adjustment));
    await pool.query(
      `UPDATE mailing_contacts SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('lead_score', $1::numeric), updated_at=NOW()
       WHERE id=$2 AND user_id=$3`,
      [total, contactId, userId]
    );
    return total;
  } catch (err) {
    logger.warn({ err, userId, contactId }, 'lead_score_recalc_failed');
    return null;
  }
}
