import axios from 'axios';
import type { Response } from 'express';
import type { Request } from '../../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface AnalyticsDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  pool: Pool | null;
  decryptIntegrationSecret: (encrypted: string) => string;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  getPlatformConfig?: (platform: string) => Promise<Record<string, string>>;
}

// ─── Module-level constants ───────────────────────────────────────────────────

export { META_GRAPH_BASE } from '../../meta-graph.ts';
export const INSTAGRAM_PROFILE_FIELDS = 'id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website,is_verified';

const LINKEDIN_MARKETING_VERSION = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';

export function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function parseAnalyticsRange(preset: string | undefined, startStr: string | undefined, endStr: string | undefined) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date, end: Date, label: string;
  const p = preset || '30d';
  if (p === 'custom' && startStr && endStr) {
    start = new Date(startStr);
    end = new Date(endStr);
    label = `${startStr} – ${endStr}`;
  } else if (p === '7d') {
    start = new Date(today); start.setDate(start.getDate() - 6);
    end = today; label = 'Last 7 days';
  } else if (p === '90d') {
    start = new Date(today); start.setDate(start.getDate() - 89);
    end = today; label = 'Last 90 days';
  } else {
    start = new Date(today); start.setDate(start.getDate() - 29);
    end = today; label = 'Last 30 days';
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    preset: p as '7d' | '30d' | '90d' | 'custom',
    start, end, label, days, prevStart, prevEnd,
    startIso: start.toISOString(),
    endIso: new Date(end.getTime() + 86399999).toISOString(),
    prevStartIso: prevStart.toISOString(),
    prevEndIso: new Date(prevEnd.getTime() + 86399999).toISOString(),
  };
}

export function analyticsPlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', twitter: 'X (Twitter)',
    linkedin: 'LinkedIn', pinterest: 'Pinterest', threads: 'Threads',
    tiktok: 'TikTok', wordpress: 'WordPress',
  };
  return map[platform?.toLowerCase()] || platform;
}

export function analyticsFmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── TikTok profile fetcher ───────────────────────────────────────────────────

export async function fetchTikTokUserProfile(token: string): Promise<{ user: any; scopeLimited: boolean }> {
  const ttGet = (fields: string) =>
    axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields },
      validateStatus: () => true,
      timeout: 15000,
    });

  const basicResp = await ttGet('open_id,display_name');
  const basicErr  = basicResp.data?.error?.code;
  if (basicResp.status !== 200 || (basicErr && basicErr !== 'ok') || !basicResp.data?.data?.user) {
    const msg = basicResp.data?.error?.message || basicErr || `HTTP ${basicResp.status}`;
    throw new Error(msg || 'TikTok user info unavailable');
  }
  const user: any = { ...basicResp.data.data.user };

  try {
    const profileResp = await ttGet('username,bio_description,is_verified');
    const profileErr  = profileResp.data?.error?.code;
    if (profileResp.status === 200 && (!profileErr || profileErr === 'ok') && profileResp.data?.data?.user) {
      const p = profileResp.data.data.user;
      if (p.username        != null) user.username        = p.username;
      if (p.bio_description != null) user.bio_description = p.bio_description;
      if (p.is_verified     != null) user.is_verified     = p.is_verified;
    }
  } catch (profileErr: any) {
    logger.info('[TikTok profile] user.info.profile exception:', profileErr?.message);
  }

  try {
    const statsResp = await ttGet('follower_count,following_count,likes_count,video_count');
    const statsErr  = statsResp.data?.error?.code;
    logger.info('[TikTok stats] status:', statsResp.status, 'error:', statsErr, 'user:', JSON.stringify(statsResp.data?.data?.user));
    if (statsResp.status === 200 && (!statsErr || statsErr === 'ok') && statsResp.data?.data?.user) {
      const s = statsResp.data.data.user;
      if (s.follower_count  != null) user.follower_count  = s.follower_count;
      if (s.following_count != null) user.following_count = s.following_count;
      if (s.likes_count     != null) user.likes_count     = s.likes_count;
      if (s.video_count     != null) user.video_count     = s.video_count;
    }
  } catch (statsErr: any) {
    logger.info('[TikTok stats] exception:', statsErr?.message);
  }

  logger.info('[TikTok profile] final user object:', JSON.stringify(user));
  const hasStats = user.follower_count != null;
  return { user, scopeLimited: !hasStats };
}
