// ─────────────────────────────────────────────────────────────────────────────
// Lead overview: the numbers the team used to count by hand from row colours.
// "Outcome" is each lead's LATEST activity response_status.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import { isValidIanaTimezone } from '../timezones.ts';
import { DEFAULT_TIMEZONE } from './leadActivities.ts';
import { endOfLocalDay } from './leadWorkspace.ts';

export async function leadOverview(pool: Pool, userId: string, nowMs = Date.now()) {
  const { rows: tzRows } = await pool.query(
    `SELECT (SELECT timezone FROM users WHERE id=$1) AS user_tz,
            (SELECT default_timezone FROM sales_call_policies WHERE user_id=$1) AS policy_tz`,
    [userId],
  );
  const tz = [tzRows[0]?.user_tz, tzRows[0]?.policy_tz].find((t) => typeof t === 'string' && isValidIanaTimezone(t)) ?? DEFAULT_TIMEZONE;
  const now = new Date(nowMs);
  const endToday = endOfLocalDay(nowMs, tz);

  const latest = `
    WITH latest AS (
      SELECT DISTINCT ON (a.contact_id) a.contact_id, a.response_status
        FROM crm_activities a
       WHERE a.user_id=$1 AND a.contact_id IS NOT NULL
       ORDER BY a.contact_id, COALESCE(a.completed_at, a.created_at) DESC
    )`;

  const [totals, byStatus, byStage, byList, followups, trend] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS leads,
              COUNT(*) FILTER (WHERE c.created_at >= $2::timestamptz - INTERVAL '7 days')::int AS new_this_week,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_activities a WHERE a.contact_id=c.id AND a.user_id=c.user_id)
                               OR p.last_contacted_at IS NOT NULL)::int AS contacted
         FROM mailing_contacts c LEFT JOIN sales_lead_profiles p ON p.contact_id=c.id
        WHERE c.user_id=$1`,
      [userId, now],
    ),
    pool.query(`${latest} SELECT COALESCE(response_status, 'none') AS status, COUNT(*)::int AS n FROM latest GROUP BY 1`, [userId]),
    pool.query(
      `SELECT COALESCE(p.stage, 'new') AS stage, COUNT(*)::int AS n
         FROM mailing_contacts c LEFT JOIN sales_lead_profiles p ON p.contact_id=c.id
        WHERE c.user_id=$1 GROUP BY 1`,
      [userId],
    ),
    pool.query(
      `${latest}
       SELECT l.id, l.name, l.source_type,
              COUNT(m.contact_id)::int AS leads,
              COUNT(DISTINCT m.contact_id) FILTER (WHERE EXISTS (SELECT 1 FROM crm_activities a WHERE a.contact_id=m.contact_id AND a.user_id=$1))::int AS contacted,
              COUNT(*) FILTER (WHERE lt.response_status NOT IN ('no_answer','unreachable'))::int AS responded,
              COUNT(*) FILTER (WHERE lt.response_status IN ('interested','call_back'))::int AS interested,
              COUNT(*) FILTER (WHERE lt.response_status IN ('registered','paid'))::int AS converted
         FROM sales_lead_lists l
         LEFT JOIN sales_lead_list_members m ON m.list_id=l.id
         LEFT JOIN latest lt ON lt.contact_id=m.contact_id
        WHERE l.user_id=$1 AND l.archived_at IS NULL
        GROUP BY l.id ORDER BY l.created_at DESC`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE scheduled_for < $2)::int AS overdue,
              COUNT(*) FILTER (WHERE scheduled_for >= $2 AND scheduled_for <= $3)::int AS today,
              COUNT(*) FILTER (WHERE scheduled_for <= $2::timestamptz + INTERVAL '7 days')::int AS week,
              COUNT(*) FILTER (WHERE needs_confirmation)::int AS needs_confirmation
         FROM sales_followups
        WHERE user_id=$1 AND mode='human' AND status='scheduled'`,
      [userId, now, endToday],
    ),
    pool.query(
      `SELECT to_char(date_trunc('day', COALESCE(completed_at, created_at) AT TIME ZONE $3), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS activities,
              COUNT(*) FILTER (WHERE response_status IS NOT NULL AND response_status NOT IN ('no_answer','unreachable'))::int AS responses
         FROM crm_activities
        WHERE user_id=$1 AND contact_id IS NOT NULL AND import_hash IS NULL
          AND COALESCE(completed_at, created_at) >= $2::timestamptz - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1`,
      [userId, now, tz],
    ),
  ]);

  const t = totals.rows[0] ?? { leads: 0, new_this_week: 0, contacted: 0 };
  const statusCounts = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const withActivity = Object.entries(statusCounts).reduce((s, [, n]) => s + n, 0);
  statusCounts.none = (statusCounts.none ?? 0) + Math.max(0, t.leads - withActivity);

  return {
    timezone: tz,
    totals: { leads: t.leads, newThisWeek: t.new_this_week, contacted: t.contacted, neverContacted: Math.max(0, t.leads - t.contacted) },
    byResponseStatus: statusCounts,
    byStage: Object.fromEntries(byStage.rows.map((r) => [r.stage, r.n])),
    byList: byList.rows,
    followups: followups.rows[0] ?? { overdue: 0, today: 0, week: 0, needs_confirmation: 0 },
    activityTrend30d: trend.rows,
  };
}
