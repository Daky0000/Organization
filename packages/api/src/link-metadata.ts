import { randomUUID } from 'crypto';
import type { Request } from './types/http.ts';
import { safeAxios } from './ssrf-guard.ts';
import { logger } from './logger.ts';
import { pool, hasDatabase } from './db.ts';

const CALENDAR_CACHE_TTL_MS = 60 * 60 * 1000;
const calendarCache = new Map<string, { expiresAt: number; value: any }>();
const LINK_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_METADATA_TIMEOUT_MS = 5_000;
// Enough for any page head; the endpoint is public, so downloads are capped.
const LINK_METADATA_MAX_BYTES = 2 * 1024 * 1024;
const LINK_METADATA_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 100 };

type LinkMetadataRecord = {
  url: string;
  title: string;
  description: string;
  image: string | null;
  fetchedAt: string;
  expiresAt: string;
};

const linkMetadataCache = new Map<string, { expiresAt: number; value: LinkMetadataRecord }>();
const linkMetadataRate = new Map<string, { windowStart: number; count: number }>();

export function getCalendarCache(key: string) {
  const entry = calendarCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    calendarCache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCalendarCache(key: string, value: any) {
  calendarCache.set(key, { value, expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS });
}

export function clearCalendarCacheForUser(userId: string) {
  const prefix = `calendar:${userId}:`;
  for (const key of calendarCache.keys()) {
    if (key.startsWith(prefix)) calendarCache.delete(key);
  }
}

function getLinkMetadataCache(url: string) {
  const entry = linkMetadataCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    linkMetadataCache.delete(url);
    return null;
  }
  return entry.value;
}

function setLinkMetadataCache(url: string, value: LinkMetadataRecord) {
  linkMetadataCache.set(url, { value, expiresAt: Date.now() + LINK_METADATA_TTL_MS });
}

export function getClientIp(req: Request) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || req.ip || 'unknown';
}

export function checkLinkMetadataRateLimit(ip: string) {
  const now = Date.now();
  const current = linkMetadataRate.get(ip);
  if (!current || now - current.windowStart > LINK_METADATA_RATE_LIMIT.windowMs) {
    linkMetadataRate.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (current.count >= LINK_METADATA_RATE_LIMIT.max) {
    return false;
  }
  current.count += 1;
  return true;
}

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMetaContent(html: string, attr: 'property' | 'name', value: string) {
  const tagRegex = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*>`, 'i');
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) return '';
  const tag = tagMatch[0];
  const contentMatch = tag.match(/content=["']([^"']+)["']/i);
  return contentMatch ? decodeHtmlEntities(contentMatch[1]) : '';
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function resolveMetaUrl(base: string, value: string) {
  if (!value) return '';
  try {
    return new URL(value, base).toString();
  } catch (err) {
    logger.error('Unhandled error:', err);
    return value;
  }
}

async function loadLinkMetadataFromDb(url: string): Promise<LinkMetadataRecord | null> {
  if (!hasDatabase()) return null;
  try {
    const { rows } = await pool!.query(
      'SELECT url, title, description, image, fetched_at, expires_at FROM link_metadata WHERE url=$1 AND expires_at > NOW() LIMIT 1',
      [url]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
      url: row.url,
      title: row.title || 'Link',
      description: row.description || '',
      image: row.image || null,
      fetchedAt: new Date(row.fetched_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  } catch (err) {
    logger.warn('Failed to read link metadata cache:', err);
    return null;
  }
}

async function saveLinkMetadataToDb(data: LinkMetadataRecord) {
  if (!hasDatabase()) return;
  try {
    await pool!.query(
      `INSERT INTO link_metadata (id, url, title, description, image, fetched_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (url)
       DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, image=EXCLUDED.image,
       fetched_at=EXCLUDED.fetched_at, expires_at=EXCLUDED.expires_at`,
      [randomUUID(), data.url, data.title, data.description, data.image, data.fetchedAt, data.expiresAt]
    );
  } catch (err) {
    logger.warn('Failed to save link metadata cache:', err);
  }
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadataRecord | null> {
  const cached = getLinkMetadataCache(url);
  if (cached) return cached;

  const dbRecord = await loadLinkMetadataFromDb(url);
  if (dbRecord) {
    setLinkMetadataCache(url, dbRecord);
    return dbRecord;
  }

  try {
    // Anyone can call /api/link-metadata: never let it reach private hosts.
    const response = await safeAxios({
      method: 'GET',
      url,
      timeout: LINK_METADATA_TIMEOUT_MS,
      maxContentLength: LINK_METADATA_MAX_BYTES,
      maxRedirects: 3,
      responseType: 'text',
      headers: { 'User-Agent': 'ContentflowBot/1.0', Accept: 'text/html,application/xhtml+xml' },
    });
    if (typeof response.data !== 'string') return null;
    const html = response.data as string;

    const ogTitle = extractMetaContent(html, 'property', 'og:title');
    const ogDescription = extractMetaContent(html, 'property', 'og:description');
    const ogImage = extractMetaContent(html, 'property', 'og:image');
    const twitterDescription =
      extractMetaContent(html, 'name', 'twitter:description') || extractMetaContent(html, 'property', 'twitter:description');
    const twitterImage =
      extractMetaContent(html, 'name', 'twitter:image') || extractMetaContent(html, 'property', 'twitter:image');
    const title = ogTitle || extractTitle(html) || 'Link';
    const description =
      ogDescription || extractMetaContent(html, 'name', 'description') || twitterDescription;
    const image = resolveMetaUrl(url, ogImage || twitterImage);

    const now = new Date();
    const record: LinkMetadataRecord = {
      url,
      title: title.slice(0, 80),
      description: description.slice(0, 160),
      image: image || null,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LINK_METADATA_TTL_MS).toISOString(),
    };

    setLinkMetadataCache(url, record);
    await saveLinkMetadataToDb(record);
    return record;
  } catch (err) {
    logger.warn(`Failed to fetch link metadata for ${url}:`, err);
    return null;
  }
}

export async function recordAuditLog(userId: string, action: string, postIds: string[], changes: Record<string, any> = {}) {
  if (!hasDatabase()) return;
  try {
    await pool!.query(
      'INSERT INTO audit_logs (id, user_id, action, post_ids, changes) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
      [randomUUID(), userId, action, JSON.stringify(postIds), JSON.stringify(changes)]
    );
  } catch (err) {
    logger.warn('Failed to record audit log:', err);
  }
}
