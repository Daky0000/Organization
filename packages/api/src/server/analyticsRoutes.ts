import { Router } from 'express';
import { logger } from '../logger.ts';
import type { AnalyticsDeps } from './analytics/helpers.ts';
import { createSyncHelpers } from './analytics/syncHelpers.ts';
import { registerSocialAccountRoutes } from './analytics/socialAccountRoutes.ts';
import { registerTikTokRoutes } from './analytics/tiktokRoutes.ts';
import { registerFacebookRoutes } from './analytics/facebookRoutes.ts';
import { registerInstagramRoutes } from './analytics/instagramRoutes.ts';
import { registerPinterestRoutes } from './analytics/pinterestRoutes.ts';
import { registerThreadsRoutes } from './analytics/threadsRoutes.ts';
import { registerLinkedInAnalyticsRoutes, syncLinkedInAnalyticsForUser } from './analytics/linkedinAnalyticsRoutes.ts';
import { syncFacebookAnalyticsForUser } from './analytics/facebookRoutes.ts';
import { syncTikTokAnalyticsForUser } from './analytics/tiktokRoutes.ts';
import { registerAdapterRoutes } from './analytics/adapterRoutes.ts';

export type { AnalyticsDeps };

// The account's current token, renewed first where the platform allows; null
// when the connection needs the user to reconnect.
export async function getUsableAccessToken(
  deps: Pick<AnalyticsDeps, 'getPublishableSocialConnection'>,
  userId: string,
  platform: string,
): Promise<string | null> {
  const conn = await deps.getPublishableSocialConnection(userId, platform).catch(() => null);
  const token = String(conn?.access_token || '').trim();
  return conn && !conn.needs_reapproval && token ? token : null;
}

export function registerAnalyticsRoutes(deps: AnalyticsDeps): Router {
  const router = Router();

  function decodeStoredIntegrationSecret(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { return deps.decryptIntegrationSecret(raw); } catch { return ''; }
  }

  const syncHelpers = createSyncHelpers(deps.pool, decodeStoredIntegrationSecret);

  registerSocialAccountRoutes(router, deps);
  registerTikTokRoutes(router, deps);
  registerFacebookRoutes(router, deps);
  registerInstagramRoutes(router, deps, syncHelpers);
  registerPinterestRoutes(router, deps, syncHelpers);
  registerThreadsRoutes(router, deps, syncHelpers);
  registerLinkedInAnalyticsRoutes(router, deps);
  registerAdapterRoutes(router, deps);

  return router;
}

// Periodic analytics scan: refreshes analytics for every connected account on
// all six analytics platforms (Instagram, Threads, Pinterest, Facebook,
// TikTok, LinkedIn) so dashboards show current data without the user opening
// the page (the on-demand sync buttons keep working on top of this).
// Called from the server.ts scheduler block.
export function buildAnalyticsAutoSync(deps: AnalyticsDeps): () => Promise<void> {
  function decodeStoredIntegrationSecret(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { return deps.decryptIntegrationSecret(raw); } catch { return ''; }
  }
  const syncHelpers = createSyncHelpers(deps.pool, decodeStoredIntegrationSecret);

  return async function runAnalyticsAutoSync(): Promise<void> {
    const pool = deps.pool;
    if (!pool) return;

    // Per-account platforms (Instagram/Threads/Pinterest). Each token goes
    // through getPublishableSocialConnection first so expiring tokens are
    // renewed; connections waiting on the user are skipped.
    try {
      const { rows: accounts } = await pool.query(
        `SELECT user_id, id, account_id, account_name, handle, followers, profile_image,
                access_token, access_token_encrypted, token_data, platform, account_type
         FROM social_accounts
         WHERE connected=true AND platform IN ('instagram','threads','pinterest')
           AND (account_type = 'profile' OR account_type IS NULL)
         ORDER BY user_id`
      );
      for (const acct of accounts as any[]) {
        try {
          const accessToken = await getUsableAccessToken(deps, acct.user_id, acct.platform);
          if (!accessToken) continue;
          const account = { ...acct, access_token: accessToken, access_token_encrypted: null };
          if (acct.platform === 'instagram') {
            await syncHelpers.syncInstagramAnalyticsAccount({ userId: acct.user_id, account, days: 30 });
          } else if (acct.platform === 'threads') {
            await syncHelpers.syncThreadsAnalyticsAccount({ userId: acct.user_id, account, days: 30, maxPosts: 120 });
          } else {
            await syncHelpers.syncPinterestAnalyticsAccount({ userId: acct.user_id, account, days: 30, maxPins: 250 });
          }
        } catch (err) {
          logger.warn({ err, platform: acct.platform, userId: acct.user_id }, 'analytics_auto_sync_account_failed');
        }
      }
    } catch (err) {
      logger.error({ err }, 'analytics_auto_sync_failed');
    }

    // Per-user platforms (Facebook/TikTok/LinkedIn sync all of a user's accounts at once)
    try {
      const { rows: userRows } = await pool.query(
        `SELECT DISTINCT user_id, platform FROM social_accounts
         WHERE connected=true AND platform IN ('facebook','tiktok','linkedin')
         ORDER BY user_id`
      );
      for (const row of userRows as any[]) {
        try {
          if (row.platform === 'facebook') await syncFacebookAnalyticsForUser(deps, row.user_id);
          // TikTok tokens last a day: renew before the sync reads the stored one.
          else if (!(await getUsableAccessToken(deps, row.user_id, row.platform))) continue;
          else if (row.platform === 'tiktok') await syncTikTokAnalyticsForUser(deps, row.user_id);
          else await syncLinkedInAnalyticsForUser(deps, row.user_id);
        } catch (err) {
          logger.warn({ err, platform: row.platform, userId: row.user_id }, 'analytics_auto_sync_user_failed');
        }
      }
    } catch (err) {
      logger.error({ err }, 'analytics_auto_sync_failed');
    }
  };
}
