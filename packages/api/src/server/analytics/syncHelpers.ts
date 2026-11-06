import axios from 'axios';
import type { Pool } from 'pg';
import { logger } from '../../logger.ts';
import { InstagramBusinessPlatform } from '../../../backend/platforms/instagram_business.ts';
import { isInstagramDirectLogin, resolveInstagramGraphBase } from '../../platform-helpers.ts';
import { META_GRAPH_BASE, INSTAGRAM_PROFILE_FIELDS } from './helpers.ts';

// Instagram Graph API media fields for post-level analytics
const INSTAGRAM_MEDIA_FIELDS = 'id,timestamp,media_type,media_url,like_count,comments_count,permalink,thumbnail_url,children{media_url,media_type}';

const instagramBusinessPlatform = new InstagramBusinessPlatform();

type DecodeSecretFn = (value: string | null | undefined) => string;

export interface SyncHelpers {
  syncInstagramAnalyticsAccount(params: { userId: string; account: any; days?: number }): Promise<{ synced: number; errors: string[] }>;
  syncThreadsAnalyticsAccount(params: { userId: string; account: any; days?: number; maxPosts?: number }): Promise<{ synced: number; errors: string[] }>;
  syncPinterestAnalyticsAccount(params: { userId: string; account: any; days?: number; maxPins?: number }): Promise<{ synced: number; errors: string[] }>;
}

export function createSyncHelpers(pool: Pool | null, decodeStoredIntegrationSecret: DecodeSecretFn): SyncHelpers {
  async function syncInstagramAnalyticsAccount(params: {
    userId: string;
    account: any;
    days?: number;
  }): Promise<{ synced: number; errors: string[] }> {
    const { userId, account } = params;
    const days = Math.max(1, Number(params.days || 30));
    const errors: string[] = [];
    let synced = 0;

    let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
    if (!accessToken) accessToken = String(account?.access_token || '').trim();
    const instagramId = String(account?.account_id || '').trim();
    const accountTokenData = account?.token_data || {};
    const isDirectIg = isInstagramDirectLogin({ accessToken, tokenData: accountTokenData });
    const igGraphBase = resolveInstagramGraphBase({ accessToken, tokenData: accountTokenData });

    if (!accessToken) return { synced, errors: ['Instagram access token missing or expired — reconnect Instagram.'] };
    if (!instagramId) return { synced, errors: ['Instagram account ID missing from saved connection.'] };
    if (!pool) return { synced, errors: ['DB not ready'] };

    let profile: any = null;
    try {
      const profileEndpoint = isDirectIg
        ? `${igGraphBase}/me`
        : `${igGraphBase}/${encodeURIComponent(instagramId)}`;
      const profileFields = isDirectIg
        ? 'user_id,id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website'
        : INSTAGRAM_PROFILE_FIELDS;
      let profileResp = await axios.get(profileEndpoint, {
        params: { fields: profileFields, access_token: accessToken },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (profileResp.status >= 400 && isDirectIg) {
        profileResp = await axios.get(profileEndpoint, {
          params: {
            fields: 'user_id,id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count',
            access_token: accessToken,
          },
          validateStatus: () => true,
          timeout: 15000,
        });
      }
      const profileData: any = profileResp.data || {};
      if (profileResp.status >= 400) {
        errors.push(profileData?.error?.message || `Instagram profile lookup failed (${profileResp.status})`);
      } else {
        profile = profileData;
        const followers = Number(profile.followers_count ?? account?.followers ?? 0);
        const following = Number(profile.follows_count ?? 0);
        const postsCount = Number(profile.media_count ?? 0);
        const bio = typeof profile.biography === 'string' ? profile.biography : null;
        const isVerified = profile.is_verified === true;
        const displayName = String(profile.name || profile.username || account?.account_name || '').trim() || null;
        const handle = String(profile.username || account?.handle || '').trim() || null;
        const profileImage = typeof profile.profile_picture_url === 'string' ? profile.profile_picture_url : null;

        await pool.query(
          `INSERT INTO social_profile_stats
             (id, user_id, social_account_id, platform, followers, following, posts_count, bio, is_verified, raw_response, synced_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'instagram', $3, $4, $5, $6, $7, $8::jsonb, NOW())
           ON CONFLICT (social_account_id) DO UPDATE SET
             followers = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
             following = CASE WHEN EXCLUDED.following > 0 THEN EXCLUDED.following ELSE social_profile_stats.following END,
             posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
             bio = COALESCE(EXCLUDED.bio, social_profile_stats.bio),
             is_verified = EXCLUDED.is_verified,
             raw_response = EXCLUDED.raw_response,
             synced_at = NOW()`,
          [userId, account.id, followers, following, postsCount, bio, isVerified, JSON.stringify(profile)]
        );

        await pool.query(
          `UPDATE social_accounts
           SET account_name = COALESCE($1, account_name),
               handle = COALESCE($2, handle),
               profile_image = COALESCE($3, profile_image),
               followers = CASE WHEN $4 > 0 THEN $4 ELSE followers END,
               token_data = COALESCE(token_data, '{}'::jsonb) || $5::jsonb
           WHERE id = $6`,
          [
            displayName, handle, profileImage, followers,
            JSON.stringify({
              instagramUsername: handle,
              instagramName: displayName,
              accountType: profile.account_type || null,
              mediaCount: postsCount,
              website: profile.website || null,
              profilePictureUrl: profileImage,
              pageId: accountTokenData?.pageId || null,
              pageName: accountTokenData?.pageName || null,
            }),
            account.id,
          ]
        );
        synced++;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Instagram profile sync failed');
    }

    try {
      // impressions was retired in April 2025 and profile_views dropped; reach
      // is the only account metric left with a daily series (max 30 days).
      const since = Math.floor((Date.now() - Math.min(days, 30) * 24 * 60 * 60 * 1000) / 1000);
      const until = Math.floor(Date.now() / 1000);
      const insightsTargetId = isDirectIg ? 'me' : encodeURIComponent(instagramId);
      const insightsResp = await axios.get(`${igGraphBase}/${insightsTargetId}/insights`, {
        params: { metric: 'reach', period: 'day', metric_type: 'time_series', since, until, access_token: accessToken },
        validateStatus: () => true,
        timeout: 20000,
      });
      const insightsData: any = insightsResp.data || {};
      if (insightsResp.status < 400 && Array.isArray(insightsData?.data)) {
        const dateMetrics = new Map<string, Record<string, number>>();
        for (const metric of insightsData.data) {
          const metricName = String(metric?.name || '').trim();
          for (const valueRow of Array.isArray(metric?.values) ? metric.values : []) {
            const dateKey = String(valueRow?.end_time || valueRow?.endTime || '').slice(0, 10);
            if (!dateKey) continue;
            const current = dateMetrics.get(dateKey) || {};
            current[metricName] = Number(valueRow?.value ?? 0);
            dateMetrics.set(dateKey, current);
          }
        }
        for (const [date, metrics] of dateMetrics.entries()) {
          await pool.query(
            `INSERT INTO account_metrics
               (id, user_id, platform, social_account_id, date, followers, impressions, reach, profile_views, raw_data)
             VALUES (gen_random_uuid()::text, $1, 'instagram', $2, $3::date, $4, $5, $6, $7, $8::jsonb)
             ON CONFLICT (user_id, platform, social_account_id, date) DO UPDATE SET
               followers = EXCLUDED.followers,
               impressions = EXCLUDED.impressions,
               reach = EXCLUDED.reach,
               profile_views = EXCLUDED.profile_views,
               raw_data = EXCLUDED.raw_data`,
            [
              userId, account.id, date,
              Number(profile?.followers_count ?? account?.followers ?? 0),
              Number(metrics.impressions ?? 0), Number(metrics.reach ?? 0),
              Number(metrics.profile_views ?? 0),
              JSON.stringify({ metrics, source: insightsData.data }),
            ]
          );
          synced++;
        }
      } else if (insightsResp.status >= 400) {
        errors.push(insightsData?.error?.message || `Instagram insights lookup failed (${insightsResp.status})`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Instagram account insights sync failed');
    }

    try {
      const mediaTargetId = isDirectIg ? 'me' : encodeURIComponent(instagramId);
      const mediaResp = await axios.get(`${igGraphBase}/${mediaTargetId}/media`, {
        params: { fields: INSTAGRAM_MEDIA_FIELDS, limit: 50, access_token: accessToken },
        validateStatus: () => true,
        timeout: 20000,
      });
      const mediaData: any = mediaResp.data || {};
      if (mediaResp.status >= 400) {
        errors.push(mediaData?.error?.message || `Instagram media lookup failed (${mediaResp.status})`);
      } else {
        const mediaItems: any[] = Array.isArray(mediaData?.data) ? mediaData.data : [];
        for (const media of mediaItems) {
          const mediaId = String(media?.id || '').trim();
          if (!mediaId) continue;

          const analytics = await instagramBusinessPlatform.getPostAnalytics(mediaId, {
            accessToken,
            accountId: instagramId,
            accountName: account?.account_name || profile?.name || profile?.username || null,
            tokenData: accountTokenData,
            helpers: { graphBase: igGraphBase },
          });

          const likes = Number(analytics.likes ?? media?.like_count ?? 0);
          const comments = Number(analytics.comments ?? media?.comments_count ?? 0);
          const shares = Number(analytics.shares ?? 0);
          const impressions = Number(analytics.impressions ?? 0);
          const reach = Number(analytics.reach ?? 0);
          const saves = Number(analytics.saves ?? 0);
          const totalInteractions = Number((analytics.raw as any)?.total_interactions ?? 0);
          const engagement = totalInteractions > 0 ? totalInteractions : likes + comments + shares + saves;
          const postedAt = media?.timestamp ? new Date(media.timestamp).toISOString() : null;

          await pool.query(
            `INSERT INTO social_metrics
               (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, saves, raw_data, posted_at, fetched_at)
             VALUES (gen_random_uuid()::text, $1, 'instagram', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW())
             ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
               likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
               impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, engagement = EXCLUDED.engagement,
               saves = EXCLUDED.saves, raw_data = EXCLUDED.raw_data,
               posted_at = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at), fetched_at = NOW()`,
            [
              userId, mediaId, account.id, likes, comments, shares, impressions, reach, engagement, saves,
              JSON.stringify({
                media, analytics: analytics.raw || null,
                account: {
                  instagramId, instagramUsername: profile?.username || accountTokenData?.instagramUsername || null,
                  instagramName: profile?.name || accountTokenData?.instagramName || null,
                  pageId: accountTokenData?.pageId || null, pageName: accountTokenData?.pageName || null,
                },
              }),
              postedAt,
            ]
          );
          synced++;
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Instagram media sync failed');
    }

    return { synced, errors };
  }

  async function syncThreadsAnalyticsAccount(params: {
    userId: string;
    account: any;
    days?: number;
    maxPosts?: number;
  }): Promise<{ synced: number; errors: string[] }> {
    const { userId, account } = params;
    const days = Math.max(1, Number(params.days || 30));
    const maxPosts = Math.max(1, Math.min(200, Number(params.maxPosts || 50)));
    const errors: string[] = [];
    let synced = 0;

    if (!pool) return { synced, errors: ['DB not ready'] };

    let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
    if (!accessToken) accessToken = String(account?.access_token || '').trim();
    if (!accessToken) return { synced, errors: ['Threads access token missing or expired — reconnect Threads.'] };

    const threadsBase = 'https://graph.threads.net/v1.0';
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceMs = sinceDate.getTime();

    const extractMetric = (insightsResp: any, name: string) => {
      const data = Array.isArray(insightsResp?.data) ? insightsResp.data : [];
      const match = data.find((m: any) => String(m?.name || '').toLowerCase() === name.toLowerCase());
      const values = Array.isArray(match?.values) ? match.values : [];
      if (values.length === 0) return 0;
      const raw = values[values.length - 1]?.value;
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'));
      return Number.isFinite(num) ? num : 0;
    };

    let profile: any = null;
    try {
      const meResp = await axios.get(`${threadsBase}/me`, {
        params: { fields: 'id,username,name,is_verified,threads_profile_picture_url,threads_biography', access_token: accessToken },
        validateStatus: () => true, timeout: 15000,
      });
      const meData: any = meResp.data || {};
      if (meResp.status >= 400) errors.push(meData?.error?.message || `Threads profile lookup failed (${meResp.status})`);
      else profile = meData;
    } catch (err: any) {
      errors.push(`Threads profile lookup failed: ${err?.message || 'Failed'}`);
    }

    let accountInsights: any = null;
    try {
      const insResp = await axios.get(`${threadsBase}/me/threads_insights`, {
        params: { metric: 'views,likes,replies,reposts,quotes,clicks,followers_count', access_token: accessToken },
        validateStatus: () => true, timeout: 15000,
      });
      const insData: any = insResp.data || {};
      if (insResp.status === 403) errors.push('Threads insights scope not granted (threads_manage_insights) — reconnect Threads to enable analytics.');
      else if (insResp.status >= 400) errors.push(insData?.error?.message || `Threads account insights failed (${insResp.status})`);
      else accountInsights = insData;
    } catch (err: any) {
      errors.push(`Threads account insights failed: ${err?.message || 'Failed'}`);
    }

    const followerDemographics: Record<string, any> = {};
    if (accountInsights) {
      for (const breakdown of ['country', 'city', 'age', 'gender'] as const) {
        try {
          const demoResp = await axios.get(`${threadsBase}/me/threads_insights`, {
            params: { metric: 'follower_demographics', breakdown, access_token: accessToken },
            validateStatus: () => true, timeout: 15000,
          });
          const demoData: any = demoResp.data || {};
          if (demoResp.status === 403) {
            if (!errors.some((e) => e.includes('threads_manage_insights')))
              errors.push('Threads insights scope not granted (threads_manage_insights) — reconnect Threads to enable analytics.');
            break;
          }
          if (demoResp.status >= 400) { errors.push(demoData?.error?.message || `Threads follower demographics failed (${demoResp.status})`); continue; }
          followerDemographics[breakdown] = demoData;
        } catch (err: any) {
          errors.push(`Threads follower demographics failed: ${err?.message || 'Failed'}`);
        }
      }
    }

    const followers = Math.round(extractMetric(accountInsights, 'followers_count'));
    const totalLikes = Math.round(extractMetric(accountInsights, 'likes'));
    const accountMetrics = {
      views: Math.round(extractMetric(accountInsights, 'views')),
      likes: totalLikes,
      replies: Math.round(extractMetric(accountInsights, 'replies')),
      reposts: Math.round(extractMetric(accountInsights, 'reposts')),
      quotes: Math.round(extractMetric(accountInsights, 'quotes')),
      clicks: Math.round(extractMetric(accountInsights, 'clicks')),
      followers_count: followers,
    };

    let postsSynced = 0;
    try {
      const fields = 'id,media_product_type,media_type,media_url,gif_url,permalink,owner,username,text,timestamp,shortcode,thumbnail_url,children,is_quote_post,quoted_post,reposted_post,has_replies,alt_text,link_attachment_url,poll_attachment{option_a,option_b,option_c,option_d,option_a_votes_percentage,option_b_votes_percentage,option_c_votes_percentage,option_d_votes_percentage,expiration_timestamp},location_id,topic_tag,is_verified,profile_picture_url';
      const metricList = 'views,likes,replies,reposts,quotes,shares';

      let after: string | null = null;
      let fetched = 0;
      let page = 0;
      const MAX_PAGES = 10;

      while (fetched < maxPosts && page < MAX_PAGES) {
        const pageSize = Math.min(50, Math.max(1, maxPosts - fetched));
        const listResp = await axios.get(`${threadsBase}/me/threads`, {
          params: { fields, limit: pageSize, ...(after ? { after } : {}), access_token: accessToken },
          validateStatus: () => true, timeout: 20000,
        });
        const listData: any = listResp.data || {};
        if (listResp.status >= 400) { errors.push(listData?.error?.message || `Threads posts fetch failed (${listResp.status})`); break; }

        const items: any[] = Array.isArray(listData?.data) ? listData.data : Array.isArray(listData?.items) ? listData.items : [];
        if (items.length === 0) break;

        let hitOldPost = false;
        for (const post of items) {
          if (fetched >= maxPosts) break;
          const threadId = String(post?.id || '').trim();
          if (!threadId) continue;

          let postedAt: string | null = null;
          let postedAtMs = NaN;
          try {
            const dt = post?.timestamp ? new Date(post.timestamp) : null;
            postedAt = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
            postedAtMs = dt ? dt.getTime() : NaN;
          } catch { postedAt = null; postedAtMs = NaN; }

          if (Number.isFinite(postedAtMs) && postedAtMs < sinceMs) { hitOldPost = true; break; }

          let insights: any = null;
          try {
            const insResp = await axios.get(`${threadsBase}/${encodeURIComponent(threadId)}/insights`, {
              params: { metric: metricList, access_token: accessToken },
              validateStatus: () => true, timeout: 15000,
            });
            const insData: any = insResp.data || {};
            if (insResp.status >= 400) errors.push(insData?.error?.message || `Threads post insights failed (${insResp.status})`);
            else insights = insData;
          } catch (err: any) {
            errors.push(`Threads post insights failed: ${err?.message || 'Failed'}`);
          }

          const views = Math.round(extractMetric(insights, 'views'));
          const likes = Math.round(extractMetric(insights, 'likes'));
          const replies = Math.round(extractMetric(insights, 'replies'));
          const reposts = Math.round(extractMetric(insights, 'reposts'));
          const quotes = Math.round(extractMetric(insights, 'quotes'));
          const shares = Math.round(extractMetric(insights, 'shares'));
          const engagement = likes + replies + reposts + quotes + shares;
          const mediaUrl = typeof post?.media_url === 'string' ? post.media_url : typeof post?.gif_url === 'string' ? post.gif_url : null;

          const raw = {
            post: { id: threadId, text: post?.text ?? null, permalink: post?.permalink ?? null, timestamp: post?.timestamp ?? null, media_product_type: post?.media_product_type ?? null, media_type: post?.media_type ?? null, media_url: mediaUrl, gif_url: post?.gif_url ?? null, thumbnail_url: post?.thumbnail_url ?? null, username: post?.username ?? null, shortcode: post?.shortcode ?? null, children: post?.children ?? null, is_quote_post: post?.is_quote_post ?? null, quoted_post: post?.quoted_post ?? null, reposted_post: post?.reposted_post ?? null, has_replies: post?.has_replies ?? null, alt_text: post?.alt_text ?? null, link_attachment_url: post?.link_attachment_url ?? null, poll_attachment: post?.poll_attachment ?? null, location_id: post?.location_id ?? null, topic_tag: post?.topic_tag ?? null, owner: post?.owner ?? null, is_verified: post?.is_verified ?? null, profile_picture_url: post?.profile_picture_url ?? null },
            metrics: { views, likes, replies, reposts, quotes, shares },
            insights: insights?.data ?? null,
          };

          await pool.query(
            `INSERT INTO social_metrics
               (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, raw_data, posted_at, fetched_at)
             VALUES (gen_random_uuid()::text, $1, 'threads', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW())
             ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
               social_account_id = EXCLUDED.social_account_id, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
               shares = EXCLUDED.shares, impressions = EXCLUDED.impressions, reach = EXCLUDED.reach,
               engagement = EXCLUDED.engagement, raw_data = EXCLUDED.raw_data,
               posted_at = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at), fetched_at = NOW()`,
            [userId, threadId, account.id, likes, replies, shares, views, views, engagement, JSON.stringify(raw), postedAt]
          );
          synced++; postsSynced++; fetched++;
        }

        after = (listData?.paging?.cursors?.after ? String(listData.paging.cursors.after) : null) || (listData?.paging?.after ? String(listData.paging.after) : null) || null;
        if (hitOldPost || !after) break;
        page++;
      }
    } catch (err: any) {
      errors.push(`Threads posts sync failed: ${err?.message || 'Failed'}`);
    }

    try {
      const bio = typeof profile?.threads_biography === 'string' ? profile.threads_biography : (typeof profile?.about === 'string' ? profile.about : null);
      const isVerified = profile?.is_verified === true;
      const handle = typeof profile?.username === 'string' ? profile.username : null;
      const accountName = String(profile?.name || profile?.username || account?.account_name || '').trim() || null;
      const profileImage = typeof profile?.threads_profile_picture_url === 'string' ? profile.threads_profile_picture_url : typeof profile?.profile_picture_url === 'string' ? profile.profile_picture_url : null;
      const accountId = profile?.id ? String(profile.id).trim() : null;

      await pool.query(
        `INSERT INTO social_profile_stats
           (id, user_id, social_account_id, platform, followers, following, posts_count, total_likes, bio, is_verified, raw_response, synced_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'threads', $3, 0, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (social_account_id) DO UPDATE SET
           followers = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
           posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
           total_likes = CASE WHEN EXCLUDED.total_likes > 0 THEN EXCLUDED.total_likes ELSE social_profile_stats.total_likes END,
           bio = COALESCE(EXCLUDED.bio, social_profile_stats.bio), is_verified = EXCLUDED.is_verified,
           raw_response = EXCLUDED.raw_response, synced_at = NOW()`,
        [userId, account.id, followers, postsSynced, totalLikes, bio, isVerified,
          JSON.stringify({ profile, insights: accountInsights, account_metrics: accountMetrics, follower_demographics: followerDemographics })]
      );
      await pool.query(
        `UPDATE social_accounts SET account_id = COALESCE($1, account_id), account_name = COALESCE($2, account_name), handle = COALESCE($3, handle), profile_image = COALESCE($4, profile_image), followers = CASE WHEN $5 > 0 THEN $5 ELSE followers END WHERE id = $6`,
        [accountId, accountName, handle, profileImage, followers, account.id]
      );
      synced++;
    } catch (err: any) {
      errors.push(`Threads profile sync failed: ${err?.message || 'Failed'}`);
    }

    return { synced, errors };
  }

  async function syncPinterestAnalyticsAccount(params: {
    userId: string;
    account: any;
    days?: number;
    maxPins?: number;
  }): Promise<{ synced: number; errors: string[] }> {
    const { userId, account } = params;
    const days = Math.max(1, Number(params.days || 30));
    const maxPins = Math.max(1, Math.min(250, Number(params.maxPins || 50)));
    const errors: string[] = [];
    let synced = 0;

    if (!pool) return { synced, errors: ['DB not ready'] };

    let accessToken = decodeStoredIntegrationSecret(account?.access_token_encrypted);
    if (!accessToken) accessToken = String(account?.access_token || '').trim();
    if (!accessToken) return { synced, errors: ['Pinterest access token missing or expired — reconnect Pinterest.'] };

    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      const meResp = await axios.get('https://api.pinterest.com/v5/user_account', { headers, validateStatus: () => true, timeout: 15000 });
      const me: any = meResp.data || {};
      if (meResp.status === 403) errors.push('Profile scope not granted (user_accounts:read) — reconnect Pinterest to enable follower and profile stats.');
      else if (meResp.status >= 400) errors.push(typeof (me?.message || me?.error) === 'string' ? (me.message || me.error) : `Pinterest profile fetch failed (${meResp.status})`);
      else {
        const followers = Number(me?.follower_count ?? 0);
        const following = Number(me?.following_count ?? 0);
        const pinsCount = Number(me?.pin_count ?? 0);
        const bio = typeof me?.about === 'string' ? me.about : null;
        const handle = typeof me?.username === 'string' ? me.username : null;
        const accountName = String(me?.business_name || me?.username || account?.account_name || '').trim() || null;
        const profileImage = typeof me?.profile_image === 'string' ? me.profile_image : null;
        const accountId = me?.id ? String(me.id).trim() : null;

        await pool.query(
          `INSERT INTO social_profile_stats
             (id, user_id, social_account_id, platform, followers, following, posts_count, total_likes, bio, is_verified, raw_response, synced_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'pinterest', $3, $4, $5, 0, $6, false, $7::jsonb, NOW())
           ON CONFLICT (social_account_id) DO UPDATE SET
             followers = CASE WHEN EXCLUDED.followers > 0 THEN EXCLUDED.followers ELSE social_profile_stats.followers END,
             following = CASE WHEN EXCLUDED.following > 0 THEN EXCLUDED.following ELSE social_profile_stats.following END,
             posts_count = CASE WHEN EXCLUDED.posts_count > 0 THEN EXCLUDED.posts_count ELSE social_profile_stats.posts_count END,
             bio = COALESCE(EXCLUDED.bio, social_profile_stats.bio), raw_response = EXCLUDED.raw_response, synced_at = NOW()`,
          [userId, account.id, followers, following, pinsCount, bio, JSON.stringify(me)]
        );
        await pool.query(
          `UPDATE social_accounts SET account_id = COALESCE($1, account_id), account_name = COALESCE($2, account_name), handle = COALESCE($3, handle), profile_image = COALESCE($4, profile_image), followers = CASE WHEN $5 > 0 THEN $5 ELSE followers END WHERE id = $6`,
          [accountId, accountName, handle, profileImage, followers, account.id]
        );
        synced++;
      }
    } catch (err: any) {
      errors.push(`Pinterest profile sync failed: ${err?.message || 'Failed'}`);
    }

    try {
      const metricNumber = (value: any) => { const num = typeof value === 'number' ? value : parseFloat(String(value || '0')); return Number.isFinite(num) ? num : 0; };
      const pickMetric = (metrics: any, keys: string[]) => { for (const key of keys) { if (metrics && metrics[key] !== undefined && metrics[key] !== null) return metricNumber(metrics[key]); } return 0; };

      let bookmark: string | null = null;
      let fetchedPins = 0;
      let page = 0;
      const MAX_PAGES = 10;

      while (fetchedPins < maxPins && page < MAX_PAGES) {
        const pageSize = Math.min(250, Math.max(1, maxPins - fetchedPins));
        const pinsResp = await axios.get('https://api.pinterest.com/v5/pins', {
          headers, params: { page_size: pageSize, pin_metrics: true, ...(bookmark ? { bookmark } : {}) },
          validateStatus: () => true, timeout: 20000,
        });
        const pinsData: any = pinsResp.data || {};
        if (pinsResp.status >= 400) { errors.push(typeof (pinsData?.message || pinsData?.error) === 'string' ? (pinsData.message || pinsData.error) : `Pinterest pins fetch failed (${pinsResp.status})`); break; }

        const items: any[] = Array.isArray(pinsData?.items) ? pinsData.items : [];
        for (const pin of items) {
          if (fetchedPins >= maxPins) break;
          const pinId = String(pin?.id || '').trim();
          if (!pinId) continue;

          const pinMetrics = pin?.pin_metrics || null;
          const metricsSource = pinMetrics?.lifetime_metrics ? 'lifetime' : pinMetrics?.['90d'] ? '90d' : null;
          const metrics = (metricsSource === 'lifetime' ? pinMetrics?.lifetime_metrics : null) || (metricsSource === '90d' ? pinMetrics?.['90d'] : null) || {};

          const impressions = pickMetric(metrics, ['impression', 'impressions']);
          const outboundClicks = pickMetric(metrics, ['clickthrough', 'outbound_click', 'outbound_clicks']);
          const pinClicks = pickMetric(metrics, ['pin_click', 'pin_clicks']);
          const saves = pickMetric(metrics, ['save', 'saves']);
          const reactions = pickMetric(metrics, ['reaction', 'total_reactions']);
          const comments = pickMetric(metrics, ['comment', 'total_comments']);
          const engagement = saves + pinClicks + reactions + comments;

          let postedAt: string | null = null;
          try { const dt = pin?.created_at ? new Date(pin.created_at) : null; postedAt = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null; } catch { postedAt = null; }

          const raw = { pin: { id: pinId, title: pin?.title ?? null, description: pin?.description ?? null, link: pin?.link ?? null, board_id: pin?.board_id ?? null, board_section_id: pin?.board_section_id ?? null, creative_type: pin?.creative_type ?? null, media: pin?.media ?? null, created_at: pin?.created_at ?? null }, metrics: { impressions, outbound_clicks: outboundClicks, pin_click: pinClicks, saves, reactions, comments, source: metricsSource } };

          await pool.query(
            `INSERT INTO social_metrics
               (id, user_id, platform, platform_post_id, social_account_id, likes, comments, shares, impressions, reach, engagement, clicks, saves, raw_data, posted_at, fetched_at)
             VALUES (gen_random_uuid()::text, $1, 'pinterest', $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW())
             ON CONFLICT (user_id, platform, platform_post_id) DO UPDATE SET
               social_account_id = EXCLUDED.social_account_id, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
               impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, engagement = EXCLUDED.engagement,
               clicks = EXCLUDED.clicks, saves = EXCLUDED.saves, raw_data = EXCLUDED.raw_data,
               posted_at = COALESCE(EXCLUDED.posted_at, social_metrics.posted_at), fetched_at = NOW()`,
            [userId, pinId, account.id, Math.round(reactions), Math.round(comments), Math.round(impressions), Math.round(impressions), Math.round(engagement), Math.round(outboundClicks), Math.round(saves), JSON.stringify(raw), postedAt]
          );
          synced++; fetchedPins++;
        }

        bookmark = pinsData?.bookmark ? String(pinsData.bookmark) : null;
        if (!bookmark) break;
        page++;
      }
    } catch (err: any) {
      errors.push(`Pinterest pins sync failed: ${err?.message || 'Failed'}`);
    }

    return { synced, errors };
  }

  return { syncInstagramAnalyticsAccount, syncThreadsAnalyticsAccount, syncPinterestAnalyticsAccount };
}
