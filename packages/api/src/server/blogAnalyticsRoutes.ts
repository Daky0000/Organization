import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; email?: string } | null;

type RequireAuthFn = (
  req: Request,
  res: Response,
) => AuthResult | Promise<AuthResult>;

type RouteDeps = {
  /** Express Router to mount routes on. Caller is responsible for mounting at the desired path. */
  router: Router;
  getPool: () => Pool | null;
  requireAuth: RequireAuthFn;
};

type AnalyticsRangePreset = '7d' | '30d' | '90d' | 'custom';

type BlogAnalyticsRange = {
  preset: AnalyticsRangePreset;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  label: string;
  days: number;
};

type BlogPerformanceMetrics = {
  reach: number;
  impressions: number;
  engagement: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
};

const EMPTY_BLOG_METRICS = (): BlogPerformanceMetrics => ({
  reach: 0,
  impressions: 0,
  engagement: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  clicks: 0,
});

function sendApiError(
  res: Response,
  status: number,
  error: string,
  code: string,
  details?: Record<string, any>,
) {
  return res.status(status).json({
    error,
    code,
    details,
    timestamp: new Date().toISOString(),
  });
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatAnalyticsDateLabel(value: Date) {
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildBlogAnalyticsRange(query: Record<string, any>): BlogAnalyticsRange | { error: string; details?: Record<string, any> } {
  const presetRaw = String(query.preset || '').trim().toLowerCase();
  const startRaw = String(query.start || '').trim();
  const endRaw = String(query.end || '').trim();

  let preset: AnalyticsRangePreset = '30d';
  let start: Date;
  let end: Date;

  if (startRaw || endRaw || presetRaw === 'custom') {
    if (!startRaw || !endRaw) {
      return {
        error: 'Both start and end dates are required for a custom range.',
        details: { start: startRaw, end: endRaw },
      };
    }

    start = startOfDay(new Date(startRaw));
    end = endOfDay(new Date(endRaw));

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return {
        error: 'Invalid date range.',
        details: { start: startRaw, end: endRaw },
      };
    }

    if (start > end) {
      return {
        error: 'Start date must be before end date.',
        details: { start: startRaw, end: endRaw },
      };
    }

    preset = 'custom';
  } else {
    const presetMap: Record<string, AnalyticsRangePreset> = {
      '7d': '7d',
      '30d': '30d',
      '90d': '90d',
    };
    preset = presetMap[presetRaw] || '30d';
    const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30;
    end = endOfDay(new Date());
    start = startOfDay(addDays(end, -(days - 1)));
  }

  const days = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = startOfDay(addDays(start, -days));
  const label = `${formatAnalyticsDateLabel(start)} - ${formatAnalyticsDateLabel(end)}`;

  return {
    preset,
    start,
    end,
    previousStart,
    previousEnd,
    label,
    days,
  };
}

function inRange(value: string | Date | null | undefined, start: Date, end: Date) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
}

function dayKey(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function percentChange(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function normalizeAnalyticsPlatform(value: string | null | undefined) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'x' || raw.includes('twitter')) return 'twitter';
  if (raw.includes('instagram')) return 'instagram';
  if (raw.includes('linkedin')) return 'linkedin';
  if (raw.includes('facebook')) return 'facebook';
  if (raw.includes('tiktok')) return 'tiktok';
  if (raw.includes('pinterest')) return 'pinterest';
  if (raw.includes('wordpress')) return 'wordpress';
  return raw;
}

function displayPlatformName(platform: string) {
  const normalized = normalizeAnalyticsPlatform(platform);
  switch (normalized) {
    case 'twitter':
      return 'Twitter';
    case 'instagram':
      return 'Instagram';
    case 'linkedin':
      return 'LinkedIn';
    case 'facebook':
      return 'Facebook';
    case 'tiktok':
      return 'TikTok';
    case 'pinterest':
      return 'Pinterest';
    case 'wordpress':
      return 'WordPress';
    default:
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
  }
}

function stripHtmlForAnalytics(value: string | null | undefined) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPostText(post: Record<string, any>) {
  return [
    String(post.title || '').trim(),
    String(post.excerpt || '').trim(),
    stripHtmlForAnalytics(post.content),
    String(post.social_title || '').trim(),
    String(post.social_description || '').trim(),
  ]
    .filter(Boolean)
    .join('\n');
}

function extractAnalyticsHashtags(text: string) {
  return Array.from(
    new Set((text.match(/#[\p{L}0-9_]+/gu) || []).map((tag) => tag.toLowerCase())),
  );
}

function deriveContentType(post: Record<string, any>): 'image' | 'text' {
  const featured = String(post.featured_image || post.social_image || '').trim();
  return featured ? 'image' : 'text';
}

function addMetrics(
  target: BlogPerformanceMetrics,
  metrics: Partial<BlogPerformanceMetrics> | null | undefined,
) {
  if (!metrics) return target;
  target.reach += Number(metrics.reach || 0);
  target.impressions += Number(metrics.impressions || 0);
  target.engagement += Number(metrics.engagement || 0);
  target.likes += Number(metrics.likes || 0);
  target.comments += Number(metrics.comments || 0);
  target.shares += Number(metrics.shares || 0);
  target.saves += Number(metrics.saves || 0);
  target.clicks += Number(metrics.clicks || 0);
  return target;
}

function engagementRate(metrics: BlogPerformanceMetrics) {
  if (metrics.impressions <= 0) return null;
  return Number(((metrics.engagement / metrics.impressions) * 100).toFixed(1));
}

function safeJsonObject(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function collectNumericMetrics(
  source: any,
  bag: Map<string, number[]>,
  depth = 0,
  seen = new WeakSet<object>(),
) {
  if (source === null || source === undefined || depth > 3) return;
  if (Array.isArray(source)) {
    source.forEach((item) => collectNumericMetrics(item, bag, depth + 1, seen));
    return;
  }
  if (typeof source !== 'object') return;
  if (seen.has(source)) return;
  seen.add(source);

  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (typeof value === 'number' && Number.isFinite(value)) {
      const values = bag.get(normalizedKey) || [];
      values.push(value);
      bag.set(normalizedKey, values);
      return;
    }
    collectNumericMetrics(value, bag, depth + 1, seen);
  });
}

function findMetricValue(bag: Map<string, number[]>, candidates: string[]) {
  for (const key of candidates) {
    const values = bag.get(key.toLowerCase());
    if (!values || values.length === 0) continue;
    return Math.max(...values);
  }
  return 0;
}

function extractPerformanceMetrics(value: any): BlogPerformanceMetrics {
  const payload = safeJsonObject(value);
  if (!Object.keys(payload).length) {
    return EMPTY_BLOG_METRICS();
  }

  const bag = new Map<string, number[]>();
  collectNumericMetrics(payload, bag);

  const metrics: BlogPerformanceMetrics = {
    reach: findMetricValue(bag, ['reach', 'totalreach', 'uniquereach']),
    impressions: findMetricValue(bag, ['impressions', 'totalimpressions', 'views', 'viewcount', 'impressioncount']),
    likes: findMetricValue(bag, ['likes', 'likecount', 'like_count']),
    comments: findMetricValue(bag, ['comments', 'commentcount', 'comment_count', 'replies', 'replycount', 'reply_count']),
    shares: findMetricValue(bag, ['shares', 'sharecount', 'share_count', 'retweets', 'retweetcount', 'retweet_count', 'reposts']),
    saves: findMetricValue(bag, ['saves', 'saved', 'savecount', 'save_count']),
    clicks: findMetricValue(bag, ['clicks', 'clickcount', 'click_count', 'linkclicks']),
    engagement: findMetricValue(bag, ['engagement', 'totalengagement', 'engagedusers', 'post_engaged_users']),
  };

  if (metrics.engagement === 0) {
    metrics.engagement = metrics.likes + metrics.comments + metrics.shares + metrics.saves + metrics.clicks;
  }

  if (metrics.reach === 0 && metrics.impressions > 0) {
    metrics.reach = metrics.impressions;
  }

  return metrics;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatHour(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const twelveHour = normalized % 12 || 12;
  return `${twelveHour} ${suffix}`;
}

function bestTimeWindowLabel(dayIndex: number, hour: number) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[dayIndex]} ${formatHour(hour)} - ${formatHour(hour + 2)}`;
}

async function buildBlogAnalyticsDashboard(pool: Pool, userId: string, range: BlogAnalyticsRange) {
  const queryStart = range.previousStart;
  const queryEnd = range.end;

  const [postResult, logResult, targetResult, accountResult] = await Promise.all([
    pool.query(
      `SELECT p.*,
        COALESCE(ARRAY(
          SELECT DISTINCT t.name
          FROM blog_post_tags pt
          JOIN blog_tags t ON t.id = pt.tag_id
          WHERE pt.post_id = p.id
        ), ARRAY[]::text[]) AS tag_names
       FROM blog_posts p
       WHERE p.user_id=$1 AND p.status <> 'deleted'
       ORDER BY COALESCE(p.published_at, p.updated_at, p.created_at) DESC`,
      [userId],
    ),
    pool.query(
      `SELECT *
       FROM publishing_logs
       WHERE user_id=$1
         AND COALESCE(posted_at, scheduled_for, created_at) BETWEEN $2 AND $3
       ORDER BY created_at DESC`,
      [userId, queryStart.toISOString(), queryEnd.toISOString()],
    ),
    pool.query(
      `SELECT s.post_id, LOWER(sa.platform) AS platform
       FROM social_post_settings s
       JOIN social_post_targets t ON t.social_post_id = s.id AND t.enabled = true
       JOIN social_accounts sa ON sa.id = t.social_account_id
       JOIN blog_posts p ON p.id = s.post_id
       WHERE p.user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT platform, followers
       FROM social_accounts
       WHERE user_id=$1 AND connected=true`,
      [userId],
    ),
  ]);

  const allPosts = postResult.rows as Record<string, any>[];
  const allLogs = logResult.rows as Record<string, any>[];
  const targetRows = targetResult.rows as Array<{ post_id: string; platform: string }>;
  const connectedAccounts = accountResult.rows as Array<{ platform: string; followers: number | null }>;

  const targetPlatformsByPostId = new Map<string, string[]>();
  targetRows.forEach((row) => {
    const existing = targetPlatformsByPostId.get(row.post_id) || [];
    existing.push(normalizeAnalyticsPlatform(row.platform));
    targetPlatformsByPostId.set(row.post_id, uniqueStrings(existing));
  });

  const currentPosts = allPosts.filter(
    (post) =>
      inRange(post.published_at, range.start, range.end) ||
      inRange(post.scheduled_at, range.start, range.end) ||
      inRange(post.created_at, range.start, range.end) ||
      inRange(post.updated_at, range.start, range.end),
  );
  const previousPosts = allPosts.filter(
    (post) =>
      inRange(post.published_at, range.previousStart, range.previousEnd) ||
      inRange(post.scheduled_at, range.previousStart, range.previousEnd) ||
      inRange(post.created_at, range.previousStart, range.previousEnd) ||
      inRange(post.updated_at, range.previousStart, range.previousEnd),
  );

  const publishedPosts = currentPosts.filter((post) => inRange(post.published_at, range.start, range.end));
  const previousPublishedPosts = previousPosts.filter((post) => inRange(post.published_at, range.previousStart, range.previousEnd));
  const futureScheduledCount = allPosts.filter(
    (post) =>
      String(post.status || '').toLowerCase() === 'scheduled' &&
      inRange(post.scheduled_at, new Date(), addDays(new Date(), 30)),
  ).length;

  const currentLogs = allLogs.filter((log) => inRange(log.posted_at || log.scheduled_for || log.created_at, range.start, range.end));
  const previousLogs = allLogs.filter((log) => inRange(log.posted_at || log.scheduled_for || log.created_at, range.previousStart, range.previousEnd));

  const currentPublishedLogs = currentLogs.filter((log) => String(log.status || '').toLowerCase() === 'published');
  const previousPublishedLogs = previousLogs.filter((log) => String(log.status || '').toLowerCase() === 'published');
  const currentFailedLogs = currentLogs.filter((log) => String(log.status || '').toLowerCase() === 'failed');
  const previousFailedLogs = previousLogs.filter((log) => String(log.status || '').toLowerCase() === 'failed');

  const logsByPostId = new Map<string, Record<string, any>[]>();
  currentLogs.forEach((log) => {
    const existing = logsByPostId.get(String(log.post_id)) || [];
    existing.push(log);
    logsByPostId.set(String(log.post_id), existing);
  });

  const platformBreakdownMap = new Map<
    string,
    {
      platform: string;
      published: number;
      failed: number;
      scheduled: number;
      metrics: BlogPerformanceMetrics;
      accounts: number;
      followerReach: number;
    }
  >();

  connectedAccounts.forEach((account) => {
    const platform = normalizeAnalyticsPlatform(account.platform);
    if (!platform) return;
    const entry =
      platformBreakdownMap.get(platform) ||
      { platform, published: 0, failed: 0, scheduled: 0, metrics: EMPTY_BLOG_METRICS(), accounts: 0, followerReach: 0 };
    entry.accounts += 1;
    entry.followerReach += Number(account.followers || 0);
    platformBreakdownMap.set(platform, entry);
  });

  currentLogs.forEach((log) => {
    const platform = normalizeAnalyticsPlatform(String(log.platform || ''));
    if (!platform) return;
    const entry =
      platformBreakdownMap.get(platform) ||
      { platform, published: 0, failed: 0, scheduled: 0, metrics: EMPTY_BLOG_METRICS(), accounts: 0, followerReach: 0 };
    const status = String(log.status || '').toLowerCase();
    if (status === 'published') entry.published += 1;
    if (status === 'failed') entry.failed += 1;
    if (status === 'scheduled') entry.scheduled += 1;
    addMetrics(entry.metrics, extractPerformanceMetrics(log.response));
    platformBreakdownMap.set(platform, entry);
  });

  const performanceTotals = currentPublishedLogs.reduce<BlogPerformanceMetrics>(
    (acc, log) => addMetrics(acc, extractPerformanceMetrics(log.response)),
    EMPTY_BLOG_METRICS(),
  );
  const previousPerformanceTotals = previousPublishedLogs.reduce<BlogPerformanceMetrics>(
    (acc, log) => addMetrics(acc, extractPerformanceMetrics(log.response)),
    EMPTY_BLOG_METRICS(),
  );
  const hasPerformanceMetrics =
    performanceTotals.reach > 0 || performanceTotals.impressions > 0 || performanceTotals.engagement > 0;

  const trendMap = new Map<
    string,
    {
      date: string;
      publishedPosts: number;
      successfulPublishes: number;
      failedPublishes: number;
      scheduledPublishes: number;
      metrics: BlogPerformanceMetrics;
    }
  >();

  for (let cursor = new Date(range.start); cursor <= range.end; cursor = addDays(cursor, 1)) {
    const key = dayKey(cursor);
    trendMap.set(key, {
      date: key,
      publishedPosts: 0,
      successfulPublishes: 0,
      failedPublishes: 0,
      scheduledPublishes: 0,
      metrics: EMPTY_BLOG_METRICS(),
    });
  }

  publishedPosts.forEach((post) => {
    const key = dayKey(post.published_at);
    const entry = trendMap.get(key);
    if (entry) entry.publishedPosts += 1;
  });

  currentLogs.forEach((log) => {
    const key = dayKey(log.posted_at || log.scheduled_for || log.created_at);
    const entry = trendMap.get(key);
    if (!entry) return;
    const status = String(log.status || '').toLowerCase();
    if (status === 'published') entry.successfulPublishes += 1;
    if (status === 'failed') entry.failedPublishes += 1;
    if (status === 'scheduled') entry.scheduledPublishes += 1;
    addMetrics(entry.metrics, extractPerformanceMetrics(log.response));
  });

  const trend = Array.from(trendMap.values()).map((item) => ({
    date: item.date,
    publishedPosts: item.publishedPosts,
    successfulPublishes: item.successfulPublishes,
    failedPublishes: item.failedPublishes,
    scheduledPublishes: item.scheduledPublishes,
    reach: item.metrics.reach || null,
    engagement: item.metrics.engagement || null,
    engagementRate: engagementRate(item.metrics),
  }));

  const timeWindowMap = new Map<string, { count: number; metrics: BlogPerformanceMetrics; dayIndex: number; hour: number }>();
  currentPublishedLogs.forEach((log) => {
    const dateValue = log.posted_at || log.created_at;
    if (!dateValue) return;
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return;
    const bucketHour = Math.floor(date.getHours() / 2) * 2;
    const dayIndex = date.getDay();
    const key = `${dayIndex}-${bucketHour}`;
    const current =
      timeWindowMap.get(key) || { count: 0, metrics: EMPTY_BLOG_METRICS(), dayIndex, hour: bucketHour };
    current.count += 1;
    addMetrics(current.metrics, extractPerformanceMetrics(log.response));
    timeWindowMap.set(key, current);
  });

  const bestTimeWindow = Array.from(timeWindowMap.values()).sort((a, b) => {
    if (hasPerformanceMetrics) {
      const aRate = engagementRate(a.metrics) || 0;
      const bRate = engagementRate(b.metrics) || 0;
      if (bRate !== aRate) return bRate - aRate;
    }
    return b.count - a.count;
  })[0];

  const platformBreakdown = Array.from(platformBreakdownMap.values())
    .map((entry) => {
      const attempts = entry.published + entry.failed;
      return {
        platform: entry.platform,
        label: displayPlatformName(entry.platform),
        published: entry.published,
        failed: entry.failed,
        scheduled: entry.scheduled,
        successRate: attempts > 0 ? Number(((entry.published / attempts) * 100).toFixed(1)) : null,
        reach: entry.metrics.reach || null,
        engagement: entry.metrics.engagement || null,
        engagementRate: engagementRate(entry.metrics),
        accounts: entry.accounts,
        followerReach: entry.followerReach || null,
      };
    })
    .filter((entry) => entry.published > 0 || entry.failed > 0 || entry.accounts > 0)
    .sort((a, b) => b.published - a.published || b.accounts - a.accounts);

  const topPlatform = platformBreakdown[0] || null;
  const totalPlatformPublishes = platformBreakdown.reduce((sum, entry) => sum + entry.published, 0);

  const topPosts = publishedPosts
    .map((post) => {
      const copy = extractPostText(post);
      const hashtags = extractAnalyticsHashtags(copy);
      const logs = logsByPostId.get(String(post.id)) || [];
      const platformsFromLogs = logs.map((log) => normalizeAnalyticsPlatform(String(log.platform || '')));
      const platforms = uniqueStrings([...(platformsFromLogs || []), ...(targetPlatformsByPostId.get(String(post.id)) || [])]);
      const metrics = logs.reduce<BlogPerformanceMetrics>(
        (acc, log) => addMetrics(acc, extractPerformanceMetrics(log.response)),
        EMPTY_BLOG_METRICS(),
      );
      const successfulPublishes = logs.filter((log) => String(log.status || '').toLowerCase() === 'published').length;
      const failedPublishes = logs.filter((log) => String(log.status || '').toLowerCase() === 'failed').length;
      const rate = engagementRate(metrics);
      const distributionScore =
        successfulPublishes * 40 +
        platforms.length * 16 +
        (deriveContentType(post) === 'image' ? 12 : 0) +
        Math.min(hashtags.length, 4) * 3 +
        Math.min(Array.isArray(post.tag_names) ? post.tag_names.length : 0, 4) * 4;
      const score = hasPerformanceMetrics ? Number((rate ?? 0).toFixed(1)) : distributionScore;

      return {
        id: String(post.id),
        title: String(post.title || '(Untitled)'),
        publishedAt: post.published_at ? new Date(post.published_at).toISOString() : null,
        platforms,
        type: deriveContentType(post),
        hashtags,
        tagNames: Array.isArray(post.tag_names) ? post.tag_names.map((value: string) => String(value)) : [],
        successfulPublishes,
        failedPublishes,
        reach: metrics.reach || null,
        engagement: metrics.engagement || null,
        engagementRate: rate,
        score,
        scoreLabel: hasPerformanceMetrics ? 'Engagement rate' : 'Distribution score',
      };
    })
    .sort((a, b) => b.score - a.score || b.successfulPublishes - a.successfulPublishes)
    .slice(0, 8);

  const currentAttempts = currentPublishedLogs.length + currentFailedLogs.length;
  const previousAttempts = previousPublishedLogs.length + previousFailedLogs.length;
  const publishSuccessRate =
    currentAttempts > 0 ? Number(((currentPublishedLogs.length / currentAttempts) * 100).toFixed(1)) : null;
  const previousPublishSuccessRate =
    previousAttempts > 0 ? Number(((previousPublishedLogs.length / previousAttempts) * 100).toFixed(1)) : null;

  const contentTypeStats = publishedPosts.reduce(
    (acc, post) => {
      const type = deriveContentType(post);
      const logs = logsByPostId.get(String(post.id)) || [];
      const metrics = logs.reduce<BlogPerformanceMetrics>(
        (metricAcc, log) => addMetrics(metricAcc, extractPerformanceMetrics(log.response)),
        EMPTY_BLOG_METRICS(),
      );
      acc[type].posts += 1;
      acc[type].successfulPublishes += logs.filter((log) => String(log.status || '').toLowerCase() === 'published').length;
      acc[type].engagement += metrics.engagement;
      acc[type].impressions += metrics.impressions;
      return acc;
    },
    {
      image: { posts: 0, successfulPublishes: 0, engagement: 0, impressions: 0 },
      text: { posts: 0, successfulPublishes: 0, engagement: 0, impressions: 0 },
    },
  );

  const tagFrequency = new Map<string, number>();
  publishedPosts.forEach((post) => {
    const postTags = Array.isArray(post.tag_names) ? post.tag_names.map((value: string) => String(value).toLowerCase()) : [];
    const hashtags = extractAnalyticsHashtags(extractPostText(post));
    uniqueStrings([...postTags, ...hashtags]).forEach((tag) => {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    });
  });
  const topTags = Array.from(tagFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);

  const insights: Array<{
    type: 'positive' | 'warning' | 'suggestion';
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
  }> = [];

  if (bestTimeWindow) {
    const windowRate = engagementRate(bestTimeWindow.metrics);
    insights.push({
      type: 'suggestion',
      title: `Best publishing window: ${bestTimeWindowLabel(bestTimeWindow.dayIndex, bestTimeWindow.hour)}`,
      description: hasPerformanceMetrics && windowRate !== null
        ? `This slot is producing the strongest logged engagement signal at ${windowRate.toFixed(1)}% average engagement.`
        : `Most of your successful publishes land in this two-hour window. Schedule more content here next week.`,
      actionLabel: 'Open Posts',
      actionHref: '/posts',
    });
  }

  if (contentTypeStats.image.posts > 0 && contentTypeStats.text.posts > 0) {
    const imageScore = hasPerformanceMetrics
      ? (contentTypeStats.image.engagement / Math.max(contentTypeStats.image.impressions, 1)) * 100
      : contentTypeStats.image.successfulPublishes / Math.max(contentTypeStats.image.posts, 1);
    const textScore = hasPerformanceMetrics
      ? (contentTypeStats.text.engagement / Math.max(contentTypeStats.text.impressions, 1)) * 100
      : contentTypeStats.text.successfulPublishes / Math.max(contentTypeStats.text.posts, 1);

    if (imageScore > textScore * 1.2) {
      insights.push({
        type: 'positive',
        title: 'Visual posts are outperforming text-only content',
        description: hasPerformanceMetrics
          ? 'Image-led posts are generating stronger engagement than text-only posts in this range.'
          : 'Posts with a featured image are distributing more consistently across channels than text-only posts.',
        actionLabel: 'Create a visual post',
        actionHref: '/posts',
      });
    }
  }

  if (topPlatform && totalPlatformPublishes > 0) {
    const share = Number(((topPlatform.published / totalPlatformPublishes) * 100).toFixed(0));
    insights.push({
      type: share >= 55 ? 'positive' : 'suggestion',
      title: `${topPlatform.label} is carrying your current distribution`,
      description: `${topPlatform.label} accounts for ${share}% of successful publishes in this range.${share >= 55 ? ' Consider repurposing your best posts for a second channel to reduce concentration risk.' : ''}`,
      actionLabel: 'Review integrations',
      actionHref: '/integrations',
    });
  }

  if (currentFailedLogs.length > 0) {
    insights.push({
      type: 'warning',
      title: `${currentFailedLogs.length} publish attempt${currentFailedLogs.length === 1 ? '' : 's'} failed in this range`,
      description: `Your publish success rate is ${publishSuccessRate ?? 0}%. Review affected channels and reconnect any account that has expired credentials.`,
      actionLabel: 'Open integrations',
      actionHref: '/integrations',
    });
  }

  if (topTags.length > 0) {
    insights.push({
      type: 'suggestion',
      title: `Recurring themes: ${topTags.join(', ')}`,
      description: 'These tags and hashtags show up most often in your published content. Build your next batch around the strongest recurring themes.',
      actionLabel: 'Plan next posts',
      actionHref: '/posts',
    });
  }

  if (futureScheduledCount < 3) {
    insights.push({
      type: 'suggestion',
      title: 'Your publishing queue is getting thin',
      description: `Only ${futureScheduledCount} scheduled post${futureScheduledCount === 1 ? '' : 's'} are lined up for the next 30 days. Batch scheduling a few more posts will keep your cadence steady.`,
      actionLabel: 'Schedule posts',
      actionHref: '/posts',
    });
  }

  return {
    range: {
      preset: range.preset,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      label: range.label,
      days: range.days,
    },
    metricsAvailability: {
      performance: hasPerformanceMetrics,
    },
    summaryNote: hasPerformanceMetrics
      ? null
      : 'Native reach and engagement metrics are not being persisted by this workspace yet, so this dashboard is using publishing activity, delivery success, and platform mix as the core analytics baseline.',
    kpis: {
      publishedPosts: publishedPosts.length,
      publishedPostsChange: percentChange(publishedPosts.length, previousPublishedPosts.length),
      totalReach: performanceTotals.reach || null,
      totalReachChange: percentChange(performanceTotals.reach || null, previousPerformanceTotals.reach || null),
      totalEngagement: performanceTotals.engagement || null,
      totalEngagementChange: percentChange(performanceTotals.engagement || null, previousPerformanceTotals.engagement || null),
      engagementRate: engagementRate(performanceTotals),
      engagementRateChange: percentChange(engagementRate(performanceTotals), engagementRate(previousPerformanceTotals)),
      publishSuccessRate,
      publishSuccessRateChange: percentChange(publishSuccessRate, previousPublishSuccessRate),
      topPlatform: topPlatform
        ? {
            platform: topPlatform.platform,
            label: topPlatform.label,
            published: topPlatform.published,
            share: totalPlatformPublishes > 0 ? Number(((topPlatform.published / totalPlatformPublishes) * 100).toFixed(0)) : 0,
          }
        : null,
      bestTimeWindow: bestTimeWindow
        ? {
            label: bestTimeWindowLabel(bestTimeWindow.dayIndex, bestTimeWindow.hour),
            supportingValue: hasPerformanceMetrics
              ? `${(engagementRate(bestTimeWindow.metrics) || 0).toFixed(1)}% avg ER`
              : `${bestTimeWindow.count} successful publish${bestTimeWindow.count === 1 ? '' : 'es'}`,
          }
        : null,
      futureScheduledCount,
    },
    trend,
    platformBreakdown,
    topPosts,
    insights: insights.slice(0, 5),
  };
}

function dashboardToCsv(dashboard: any) {
  const rows = [
    ['Section', 'Label', 'Value'],
    ['Range', 'Label', dashboard.range.label],
    ['KPI', 'Published posts', String(dashboard.kpis.publishedPosts)],
    ['KPI', 'Publish success rate', dashboard.kpis.publishSuccessRate !== null ? `${dashboard.kpis.publishSuccessRate}%` : 'N/A'],
    ['KPI', 'Total reach', dashboard.kpis.totalReach !== null ? String(dashboard.kpis.totalReach) : 'N/A'],
    ['KPI', 'Engagement rate', dashboard.kpis.engagementRate !== null ? `${dashboard.kpis.engagementRate}%` : 'N/A'],
    ['KPI', 'Top platform', dashboard.kpis.topPlatform?.label || 'N/A'],
    ['KPI', 'Best time window', dashboard.kpis.bestTimeWindow?.label || 'N/A'],
    ...dashboard.platformBreakdown.map((entry: any) => [
      'Platform',
      entry.label,
      `published=${entry.published}; failed=${entry.failed}; success_rate=${entry.successRate ?? 'N/A'}%`,
    ]),
    ...dashboard.topPosts.map((post: any) => [
      'Top post',
      post.title,
      `${post.scoreLabel}=${post.score}; platforms=${post.platforms.join('|')}; published_at=${post.publishedAt || 'N/A'}`,
    ]),
  ];

  return rows
    .map((row) => row.map((value: string) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function registerBlogAnalyticsRoutes({ router, getPool, requireAuth }: RouteDeps) {
  router.get('/dashboard', async (req: Request, res: Response) => {
    const user = await Promise.resolve(requireAuth(req, res));
    if (!user) return;

    const pool = getPool();
    if (!pool) {
      return sendApiError(res, 503, 'Database not configured', 'DATABASE_UNAVAILABLE');
    }

    const range = buildBlogAnalyticsRange(req.query as Record<string, any>);
    if ('error' in range) {
      return sendApiError(res, 400, range.error, 'INVALID_DATE_RANGE', range.details);
    }

    try {
      const dashboard = await buildBlogAnalyticsDashboard(pool, user.userId, range);
      return res.json({ success: true, data: dashboard });
    } catch (error) {
      logger.error({ err: error }, 'blog_analytics_dashboard_error');
      return sendApiError(res, 500, 'Failed to load analytics dashboard.', 'ANALYTICS_DASHBOARD_ERROR');
    }
  });

  router.get('/export', async (req: Request, res: Response) => {
    const user = await Promise.resolve(requireAuth(req, res));
    if (!user) return;

    const pool = getPool();
    if (!pool) {
      return sendApiError(res, 503, 'Database not configured', 'DATABASE_UNAVAILABLE');
    }

    const range = buildBlogAnalyticsRange(req.query as Record<string, any>);
    if ('error' in range) {
      return sendApiError(res, 400, range.error, 'INVALID_DATE_RANGE', range.details);
    }

    try {
      const dashboard = await buildBlogAnalyticsDashboard(pool, user.userId, range);
      const csv = dashboardToCsv(dashboard);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=analytics-${range.preset}-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      return res.send(csv);
    } catch (error) {
      logger.error({ err: error }, 'blog_analytics_export_error');
      return sendApiError(res, 500, 'Failed to export analytics.', 'ANALYTICS_EXPORT_ERROR');
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const user = await Promise.resolve(requireAuth(req, res));
    if (!user) return;

    const pool = getPool();
    if (!pool) {
      return sendApiError(res, 503, 'Database not configured', 'DATABASE_UNAVAILABLE');
    }

    // Re-compute the dashboard for the default 30-day range to warm the data
    try {
      const range = buildBlogAnalyticsRange({ preset: '30d' });
      if (!('error' in range)) {
        await buildBlogAnalyticsDashboard(pool, user.userId, range);
      }
      return res.json({ success: true, message: 'Analytics refreshed.' });
    } catch (error) {
      logger.error({ err: error }, 'blog_analytics_refresh_error');
      return sendApiError(res, 500, 'Failed to refresh analytics.', 'ANALYTICS_REFRESH_ERROR');
    }
  });
}
