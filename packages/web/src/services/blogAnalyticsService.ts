import { API_BASE_URL } from '../utils/apiBase';

const ANALYTICS_FALLBACK_API_BASE_URL = 'https://marketing.dakyx.com';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : null;
  if (!res.ok) {
    const errorMessage = parsed?.error || parsed?.message || text || 'Request failed';
    throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed');
  }
  if (text && parsed === null) {
    throw new Error('Invalid server response');
  }
  return (parsed ?? {}) as T;
}

const FRONTEND_HOST_PATTERNS = [/\.github\.io$/i, /\.dakyworld\.com$/i];

function isFrontendHost(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return FRONTEND_HOST_PATTERNS.some((p) => p.test(hostname));
  } catch {
    return false;
  }
}

function getAnalyticsApiCandidates() {
  const candidates = [API_BASE_URL];
  // Only include the current origin if it looks like a backend (not a SPA-only host)
  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/$/, '');
    if (!isFrontendHost(origin)) {
      candidates.push(origin);
    }
  }
  candidates.push(ANALYTICS_FALLBACK_API_BASE_URL);
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchAnalyticsResponse(path: string, _expected: 'json' | 'file') {
  const candidates = getAnalyticsApiCandidates();
  let lastNetworkError: Error | null = null;

  for (const [index, base] of candidates.entries()) {
    const isLast = index === candidates.length - 1;
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      const looksLikeHtml = contentType.includes('text/html');
      // Never return an HTML response — it's always a SPA fallback, not real API data
      if (looksLikeHtml) {
        if (isLast) throw new Error('Analytics API is unreachable right now.');
        continue;
      }
      if (res.ok) return res;
      if (!isLast && (res.status === 404 || res.status >= 500)) continue;
      return res;
    } catch (error) {
      if ((error as any)?.message === 'Analytics API is unreachable right now.') {
        lastNetworkError = error as Error;
      } else {
        lastNetworkError = error instanceof Error ? error : new Error('Analytics API is unreachable right now.');
      }
      if (isLast) throw lastNetworkError;
    }
  }

  throw lastNetworkError || new Error('Analytics API is unreachable right now.');
}

export type AnalyticsRangePreset = '7d' | '30d' | '90d' | 'custom';

export type BlogAnalyticsDashboard = {
  lastSyncedAt: string | null;
  range: {
    preset: AnalyticsRangePreset;
    start: string;
    end: string;
    label: string;
    days: number;
  };
  metricsAvailability: {
    performance: boolean;
  };
  summaryNote: string | null;
  kpis: {
    publishedPosts: number;
    publishedPostsChange: number | null;
    totalReach: number | null;
    totalReachChange: number | null;
    totalEngagement: number | null;
    totalEngagementChange: number | null;
    engagementRate: number | null;
    engagementRateChange: number | null;
    publishSuccessRate: number | null;
    publishSuccessRateChange: number | null;
    topPlatform: {
      platform: string;
      label: string;
      published: number;
      share: number;
    } | null;
    bestTimeWindow: {
      label: string;
      supportingValue: string;
    } | null;
    futureScheduledCount: number;
  };
  trend: Array<{
    date: string;
    publishedPosts: number;
    successfulPublishes: number;
    failedPublishes: number;
    scheduledPublishes: number;
    reach: number | null;
    engagement: number | null;
    engagementRate: number | null;
  }>;
  platformBreakdown: Array<{
    platform: string;
    label: string;
    published: number;
    failed: number;
    scheduled: number;
    successRate: number | null;
    reach: number | null;
    engagement: number | null;
    engagementRate: number | null;
    accounts: number;
    followerReach: number | null;
  }>;
  topPosts: Array<{
    id: string;
    title: string;
    publishedAt: string | null;
    platforms: string[];
    type: 'image' | 'text';
    hashtags: string[];
    tagNames: string[];
    successfulPublishes: number;
    failedPublishes: number;
    reach: number | null;
    engagement: number | null;
    engagementRate: number | null;
    score: number;
    scoreLabel: string;
  }>;
  insights: Array<{
    type: 'positive' | 'warning' | 'suggestion';
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
  }>;
};

export type DashboardQuery = {
  preset?: AnalyticsRangePreset;
  start?: string;
  end?: string;
};

export const blogAnalyticsService = {
  async fetchDashboard(query: DashboardQuery): Promise<BlogAnalyticsDashboard> {
    const params = new URLSearchParams();
    if (query.preset) params.set('preset', query.preset);
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);

    const res = await fetchAnalyticsResponse(`/api/v1/blog/analytics/dashboard?${params.toString()}`, 'json');
    const payload = await parseApiResponse<{ success?: boolean; data?: BlogAnalyticsDashboard }>(res);
    if (!payload.data) {
      throw new Error('Analytics dashboard was empty');
    }
    return payload.data;
  },

  async syncAnalytics(): Promise<{ synced: number; errors?: string[] }> {
    const token = localStorage.getItem('auth_token') || '';
    const candidates = [API_BASE_URL];
    if (typeof window !== 'undefined') {
      const origin = window.location.origin.replace(/\/$/, '');
      if (!isFrontendHost(origin)) candidates.push(origin);
    }
    candidates.push(ANALYTICS_FALLBACK_API_BASE_URL);
    const bases = Array.from(new Set(candidates.filter(Boolean)));

    let lastErr: Error | null = null;
    for (const base of bases) {
      try {
        const res = await fetch(`${base}/api/v1/blog/analytics/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const text = await res.text();
        const parsed = text ? safeJsonParse(text) : null;
        if (!res.ok) {
          throw new Error(parsed?.error || parsed?.message || text || 'Sync failed');
        }
        return { synced: parsed?.synced ?? 0, errors: parsed?.errors };
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error('Sync failed');
      }
    }
    throw lastErr || new Error('Sync failed');
  },

  async exportDashboard(query: DashboardQuery): Promise<Blob> {
    const params = new URLSearchParams();
    if (query.preset) params.set('preset', query.preset);
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);

    const res = await fetchAnalyticsResponse(`/api/v1/blog/analytics/export?${params.toString()}`, 'file');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Export failed');
    }
    return res.blob();
  },
};
