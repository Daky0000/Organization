// ─────────────────────────────────────────────────────────────────────────────
// Delivery of human lead reminders.
//
// runLeadReminders — every 2 minutes. Claims due human reminders and writes the
//   bell notification IN THE SAME TRANSACTION as the claim, so a failed insert
//   rolls the claim back and the reminder is retried instead of silently lost.
//   (createNotification swallows its errors, which is why it is not used here.)
//
// runLeadDigests — every 10 minutes. Once a user's local time is 07:00 or later,
//   the day is claimed by inserting sales_digest_log; the email lists overdue,
//   today's and unconfirmed reminders. A failed send releases the claim.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import { logger } from '../../logger.ts';
import { isValidIanaTimezone, resolveZonedLocal, zonedDateKey, zonedParts } from '../timezones.ts';
import { DEFAULT_TIMEZONE } from './leadActivities.ts';

export const DIGEST_LOCAL_HOUR = 7;

const CHANNEL_LABEL: Record<string, string> = {
  call: 'Call', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', meeting: 'Meeting', other: 'Follow up',
};

export function leadUrl(contactId: string): string {
  return `/sales/leads?lead=${encodeURIComponent(contactId)}&tab=activity`;
}

function displayName(r: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null }): string {
  return [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email || r.phone || 'a lead';
}

export async function runLeadReminders(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE sales_followups f SET notified_at=NOW(), updated_at=NOW()
         FROM mailing_contacts c
        WHERE c.id = f.contact_id
          AND f.id IN (
            SELECT id FROM sales_followups
             WHERE mode='human' AND status='scheduled' AND notified_at IS NULL AND scheduled_for <= NOW()
             ORDER BY scheduled_for LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING f.id, f.user_id, f.contact_id, f.channel, f.reason, f.needs_confirmation, f.scheduled_for,
                  c.first_name, c.last_name, c.email, c.phone`,
    );
    for (const r of rows) {
      const who = displayName(r);
      const verb = CHANNEL_LABEL[r.channel as string] ?? 'Follow up';
      const title = r.needs_confirmation ? `Suggested follow-up: ${who}` : `${verb}: ${who}`;
      await client.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'lead_reminder', $2, $3, $4)`,
        [
          r.user_id, title.slice(0, 200), String(r.reason ?? '').slice(0, 500),
          JSON.stringify({ contact_id: r.contact_id, followup_id: r.id, channel: r.channel, url: leadUrl(r.contact_id) }),
        ],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error({ err }, 'sales_lead_reminders_failed');
    return 0;
  } finally {
    client.release();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

interface DigestItem { contact_id: string; name: string; reason: string; channel: string; at: Date; needs_confirmation: boolean }

export function buildDigestHtml(p: { appUrl: string; tz: string; overdue: DigestItem[]; today: DigestItem[]; confirm: DigestItem[] }): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: p.tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  const section = (title: string, items: DigestItem[]) => items.length === 0 ? '' : `
    <h3 style="margin:20px 0 8px;font:600 15px system-ui">${escapeHtml(title)} (${items.length})</h3>
    <ul style="padding-left:18px;margin:0">${items.map((i) => `
      <li style="margin:6px 0;font:14px system-ui">
        <a href="${p.appUrl}${leadUrl(i.contact_id)}" style="color:#2563eb">${escapeHtml(i.name)}</a>
        — ${escapeHtml(CHANNEL_LABEL[i.channel] ?? 'Follow up')}, ${escapeHtml(fmt(i.at))}
        ${i.reason ? `<br><span style="color:#555">${escapeHtml(i.reason)}</span>` : ''}
      </li>`).join('')}
    </ul>`;
  return `<div style="max-width:560px">
    <p style="font:14px system-ui">Here are your lead follow-ups for today.</p>
    ${section('Overdue', p.overdue)}${section('Due today', p.today)}${section('AI suggestions to confirm', p.confirm)}
    <p style="font:13px system-ui;margin-top:24px"><a href="${p.appUrl}/sales/followups" style="color:#2563eb">Open all reminders</a></p>
    <p style="font:12px system-ui;color:#888">You can turn this email off in Sales → Settings.</p>
  </div>`;
}

export async function runLeadDigests(
  pool: Pool,
  sendPlatformEmail: (input: { to: string; subject: string; html: string }) => Promise<unknown>,
  opts: { appUrl: string; now?: () => number },
): Promise<number> {
  const nowMs = (opts.now ?? Date.now)();
  let candidates: any[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.timezone,
              (SELECT default_timezone FROM sales_call_policies p WHERE p.user_id=u.id) AS policy_tz
         FROM users u
        WHERE u.lead_digest_enabled AND u.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM sales_followups f
                       WHERE f.user_id=u.id AND f.mode='human' AND f.status='scheduled'
                         AND (f.scheduled_for < to_timestamp($1 / 1000.0) + INTERVAL '1 day' OR f.needs_confirmation))`,
      [nowMs],
    );
    candidates = rows;
  } catch (err) {
    logger.error({ err }, 'sales_lead_digest_candidates_failed');
    return 0;
  }

  let sent = 0;
  for (const u of candidates) {
    const tz = [u.timezone, u.policy_tz].find((t) => typeof t === 'string' && isValidIanaTimezone(t)) ?? DEFAULT_TIMEZONE;
    if (zonedParts(nowMs, tz).hour < DIGEST_LOCAL_HOUR) continue;
    const day = zonedDateKey(nowMs, tz);
    const claim = await pool.query(
      `INSERT INTO sales_digest_log (user_id, digest_date) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`,
      [u.id, day],
    ).catch((err) => { logger.error({ err }, 'sales_lead_digest_claim_failed'); return { rowCount: 0 }; });
    if (!claim.rowCount) continue;

    try {
      const endOfDay = resolveZonedLocal(`${day}T23:59`, tz);
      const endMs = endOfDay.ok ? Date.parse(endOfDay.iso) : nowMs + 12 * 3600_000;
      const { rows } = await pool.query(
        `SELECT f.contact_id, f.reason, f.channel, f.scheduled_for, f.needs_confirmation,
                c.first_name, c.last_name, c.email, c.phone
           FROM sales_followups f JOIN mailing_contacts c ON c.id=f.contact_id
          WHERE f.user_id=$1 AND f.mode='human' AND f.status='scheduled'
            AND (f.scheduled_for <= to_timestamp($2 / 1000.0) OR f.needs_confirmation)
          ORDER BY f.scheduled_for LIMIT 200`,
        [u.id, endMs],
      );
      const items: DigestItem[] = rows.map((r) => ({
        contact_id: r.contact_id, name: displayName(r), reason: String(r.reason ?? ''),
        channel: r.channel ?? 'other', at: new Date(r.scheduled_for), needs_confirmation: r.needs_confirmation,
      }));
      const confirm = items.filter((i) => i.needs_confirmation);
      const rest = items.filter((i) => !i.needs_confirmation);
      const overdue = rest.filter((i) => i.at.getTime() < nowMs);
      const today = rest.filter((i) => i.at.getTime() >= nowMs && i.at.getTime() <= endMs);
      if (!overdue.length && !today.length && !confirm.length) continue;

      const total = overdue.length + today.length;
      await sendPlatformEmail({
        to: u.email,
        subject: total ? `${total} lead follow-up${total === 1 ? '' : 's'} today` : 'AI follow-up suggestions to confirm',
        html: buildDigestHtml({ appUrl: opts.appUrl, tz, overdue, today, confirm }),
      });
      sent += 1;
    } catch (err) {
      logger.error({ err, userId: u.id }, 'sales_lead_digest_send_failed');
      // Release the claim so the next tick retries today's digest.
      await pool.query(`DELETE FROM sales_digest_log WHERE user_id=$1 AND digest_date=$2`, [u.id, day]).catch(() => undefined);
    }
  }
  return sent;
}
