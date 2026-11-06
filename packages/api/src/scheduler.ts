import { logger } from './logger.ts';
import { pool, dbQuery, hasDatabase } from './db.ts';

// Runs every hour. Sends a notification to each assignee of tasks due in ~24h.
export async function runDueDateAlerts() {
  try {
    const { rows } = await pool!.query<{
      task_id: string; title: string; due_date: string;
      user_id: string; project_id: string;
    }>(`
      SELECT t.id AS task_id, t.title, t.due_date, t.project_id,
             ta.user_id
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.status != 'done'
        AND t.due_date IS NOT NULL
        AND t.due_date BETWEEN NOW() + INTERVAL '20 hours' AND NOW() + INTERVAL '28 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = ta.user_id
            AND n.type = 'task_due_soon'
            AND (n.data->>'task_id') = t.id::text
            AND n.created_at > NOW() - INTERVAL '24 hours'
        )
    `);
    for (const row of rows) {
      const due = new Date(row.due_date);
      const formatted = due.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      await pool!.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'task_due_soon', $2, $3, $4)`,
        [
          row.user_id,
          `Due tomorrow: "${row.title}"`,
          `Your task is due on ${formatted}. Make sure to complete it in time.`,
          JSON.stringify({ task_id: row.task_id, project_id: row.project_id }),
        ]
      );
    }
    if (rows.length > 0) logger.info({ count: rows.length }, 'due_date_alerts_sent');
  } catch (err) {
    logger.error({ err }, 'due_date_alert_error');
  }
}

// Runs every 2 minutes. Fires a notification when a task's reminder_at falls
// within the current 2-minute window. Uses the notifications table to dedup.
export async function runTaskReminders() {
  if (!hasDatabase()) return;
  try {
    // Collect assignees + creator for tasks whose reminder window has arrived
    const { rows } = await pool!.query<{
      task_id: string; title: string; due_date: string | null;
      project_id: string; user_id: string;
    }>(`
      SELECT DISTINCT t.id AS task_id, t.title, t.due_date, t.project_id,
             recipient.user_id
      FROM tasks t
      CROSS JOIN LATERAL (
        SELECT ta.user_id FROM task_assignees ta WHERE ta.task_id = t.id
        UNION
        SELECT t.created_by AS user_id
      ) recipient
      WHERE t.status != 'done'
        AND t.reminder_at IS NOT NULL
        AND t.reminder_at <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = recipient.user_id
            AND n.type = 'task_reminder'
            AND (n.data->>'task_id') = t.id::text
        )
    `);
    for (const row of rows) {
      const due = row.due_date ? new Date(row.due_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
      await pool!.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'task_reminder', $2, $3, $4)`,
        [
          row.user_id,
          `Reminder: "${row.title}"`,
          due ? `This task is due on ${due}.` : 'This task is due soon.',
          JSON.stringify({ task_id: row.task_id, project_id: row.project_id }),
        ]
      );
    }
    if (rows.length > 0) logger.info({ count: rows.length }, 'task_reminders_sent');
  } catch (err) {
    logger.error({ err }, 'task_reminder_error');
  }
}

export interface PublishDuePostsDeps {
  queueSocialAutomationForPublishedPost: (userId: string, post: any) => Promise<void>;
  fireWorkflowTriggers: (userId: string, event: string, data: any) => Promise<void>;
  dbPool?: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };
  forceRun?: boolean;
}

// Runs every 2 minutes. Finds posts whose scheduled_at has passed, promotes them
// to published, fires social automation + workflow triggers for each.
// Safety gate: never auto-publishes unapproved drafts/items or social-only records.
export async function publishDuePosts(deps?: Partial<PublishDuePostsDeps>) {
  if ((!hasDatabase() && !deps?.forceRun) || !deps?.queueSocialAutomationForPublishedPost) return;
  const activePool = deps.dbPool ?? pool;
  try {
    // The publication transition and its durable delivery intent commit together.
    await activePool.query(`WITH published AS (
      UPDATE blog_posts SET status='published',published_at=NOW(),updated_at=NOW()
      WHERE status='scheduled'
        AND scheduled_at<=NOW()
        AND COALESCE(approval_status, 'not_required') NOT IN ('pending', 'review_required', 'rejected', 'needs_changes')
        AND COALESCE(post_format, 'blog') != 'social_only'
      RETURNING *
    ) INSERT INTO publication_outbox(id,post_id,user_id,payload)
      SELECT id,id,user_id,to_jsonb(published) FROM published ON CONFLICT(id) DO NOTHING`);
    const { rows }=await activePool.query(`WITH due AS (
      SELECT id FROM publication_outbox WHERE status IN ('pending','processing') AND run_at<=NOW()
      ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 30
    ) UPDATE publication_outbox o SET status='processing',run_at=NOW()+INTERVAL '15 minutes'
      FROM due WHERE o.id=due.id RETURNING o.*`);
    for (const event of rows) {
      try {
        const { rows: posts }=await activePool.query(`SELECT p.*,
          ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
          FROM blog_posts p WHERE p.id=$1 AND p.user_id=$2`,[event.post_id,event.user_id]);
        if (!posts[0]) throw new Error('Published post is unavailable');
        if (!event.distribution_enqueued) {
          await deps.queueSocialAutomationForPublishedPost(event.user_id,posts[0]);
          await activePool.query('UPDATE publication_outbox SET distribution_enqueued=true WHERE id=$1',[event.id]);
        }
        await deps.fireWorkflowTriggers?.(event.user_id,'post_published',posts[0]);
        await activePool.query(`UPDATE publication_outbox SET status='completed',last_error=NULL WHERE id=$1`,[event.id]);
        await (deps.dbPool ? deps.dbPool.query.bind(deps.dbPool) : dbQuery)(`INSERT INTO notifications(user_id,type,title,message,data) VALUES($1,'post','Blog post published',$2,$3)`,
          [event.user_id,`"${posts[0].title}" is published. Social distribution is queued separately.`,JSON.stringify({ post_id: event.post_id })]);
      } catch(error) {
        await activePool.query(`UPDATE publication_outbox SET status=CASE WHEN attempts>=7 THEN 'failed' ELSE 'pending' END,
          attempts=attempts+1,run_at=NOW()+INTERVAL '5 minutes',last_error=$2 WHERE id=$1`,[event.id,error instanceof Error ? error.message.slice(0,300) : 'Delivery failed']);
        logger.error({ err: error,eventId: event.id },'publication_delivery_failed');
      }
    }
  } catch(error) { logger.error({ err: error },'scheduled_posts_publish_error'); }
}

// Runs periodically to scan post performance across all platforms and update tactical guidance.
export async function runWeeklyPostScans() {
  if (!hasDatabase()) return;
  try {
    const { runAllWeeklyPerformanceScans } = await import('./server/agentTeam/weeklyScanner.ts');
    await runAllWeeklyPerformanceScans();
  } catch (err) {
    logger.error({ err }, 'weekly_post_scans_scheduler_error');
  }
}
