import type { Pool } from 'pg';
import { Resend } from 'resend';
import { logger } from '../logger.ts';

type MailConfig = { apiKey: string; fromEmail: string; fromName: string };
export async function processCampaignEmails(pool: Pool,getConfig: ()=>Promise<MailConfig>) {
  const cfg=await getConfig();if (!cfg.apiKey) return;
  const provider=new Resend(cfg.apiKey);
  const { rows }=await pool.query(`WITH due AS(SELECT id FROM campaign_email_jobs WHERE status IN ('pending','processing') AND run_at<=NOW()
    ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 20)
    UPDATE campaign_email_jobs j SET status='processing',run_at=NOW()+INTERVAL '5 minutes' FROM due WHERE j.id=due.id RETURNING j.*`);
  for (const job of rows) {
    try {
      const contact=await pool.query('SELECT subscribed FROM mailing_contacts WHERE id=$1 AND user_id=$2',[job.contact_id,job.user_id]);
      if (!contact.rows[0]?.subscribed) { await pool.query("UPDATE campaign_email_jobs SET status='canceled' WHERE id=$1",[job.id]);continue; }
      const result=await provider.emails.send({ from: cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail,
        to: job.recipient,subject: job.subject,html: job.html,headers: { 'List-Unsubscribe': `<${job.unsubscribe_url}>` } },{ idempotencyKey: job.id });
      if (result.error || !result.data?.id) throw new Error(result.error?.message || 'Email provider did not accept the message');
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("UPDATE campaign_email_jobs SET status='sent',provider_message_id=$2,attempts=attempts+1,last_error=NULL WHERE id=$1",[job.id,result.data.id]);
        await client.query(`INSERT INTO mailing_email_events(id,user_id,campaign_id,contact_id,event_type,metadata)
          VALUES($1,$2,$3,$4,'sent',$5::jsonb) ON CONFLICT(id) DO NOTHING`,[job.id,job.user_id,job.campaign_id,job.contact_id,JSON.stringify({ resend_id: result.data.id })]);
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
    } catch(error) {
      await pool.query(`UPDATE campaign_email_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
        attempts=attempts+1,run_at=NOW()+INTERVAL '10 minutes',last_error=$2 WHERE id=$1`,[job.id,error instanceof Error ? error.message.slice(0,300) : 'Email send failed']);
      logger.warn({ err: error,jobId: job.id },'campaign_email_retry');
    }
    await pool.query(`UPDATE mailing_campaigns c SET sent_count=(SELECT COUNT(*) FROM campaign_email_jobs WHERE campaign_id=c.id AND status='sent'),
      failed_count=(SELECT COUNT(*) FROM campaign_email_jobs WHERE campaign_id=c.id AND status='failed'),
      status=CASE WHEN EXISTS(SELECT 1 FROM campaign_email_jobs WHERE campaign_id=c.id AND status IN ('pending','processing')) THEN 'queued'
        WHEN EXISTS(SELECT 1 FROM campaign_email_jobs WHERE campaign_id=c.id AND status='failed') THEN 'failed' ELSE 'sent' END WHERE c.id=$1`,[job.campaign_id]);
  }
}
