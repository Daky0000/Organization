import { validateRasterDataUrl } from './mediaValidation.ts';
import { assertSafePublicUrl } from '../ssrf-guard.ts';
import { randomUUID } from 'node:crypto';
import type { DbUserRow } from '../user-auth.ts';
import type { DbDesign } from './userDesignRoutes.ts';
import axios from 'axios';
import path from 'path';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import type { Pool } from 'pg';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export type DbMediaImageRow = {
  id: string;
  user_id: string;
  file_name: string;
  original_name: string;
  file_size: number;
  file_type: string;
  width: number | null;
  height: number | null;
  upload_date: string | null;
  url: string;
  thumbnail_url: string | null;
  alt_text: string | null;
  caption: string | null;
  description: string | null;
  tags: string[] | null;
  used_in: unknown;
  category: string | null;
};

type MediaSourceTable = 'users' | 'blog_posts' | 'user_designs' | 'card_templates';
export type EnsureMediaRecordOptions = {
  userId: string;
  sourceTable: MediaSourceTable;
  sourceId: string;
  sourceField: string;
  url: string | null | undefined;
  thumbnailUrl?: string | null;
  fileName?: string;
  fileType?: string;
  tags?: string[];
  category?: 'user' | 'admin';
};

export interface MediaDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  pool: Pool | null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface MediaModule {
  router: Router;
  ensureMediaRecordForSource: (options: EnsureMediaRecordOptions) => Promise<{ row: DbMediaImageRow; created: boolean } | null>;
  syncProfileMedia: (user: any) => Promise<number>;
  syncBlogPostMedia: (userId: string, post: any) => Promise<number>;
  syncUserDesignMedia: (userId: string, design: any) => Promise<number>;
  syncCardTemplateMedia: (adminId: string, template: any) => Promise<number>;
}

export function buildMediaModule(deps: MediaDeps): MediaModule {
  const { requireAuth, requireAdmin, hasDatabase, pool } = deps;
  const router = Router();


function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

function getMediaServerBase(): string {
  return String(
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.VITE_API_BASE_URL ||
    config.appUrl
  ).replace(/\/$/, '');
}

function buildMediaServeUrl(id: string, fileName: string): string {
  return `${getMediaServerBase()}/media/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`;
}







function transformMediaRow(row: any): any {
  if (!row) return row;
  const rawUrl = String(row.url || '');
  const rawThumb = String(row.thumbnail_url || '');
  const serveUrl = buildMediaServeUrl(row.id, row.file_name);
  return {
    ...row,
    url: rawUrl.startsWith('data:') ? serveUrl : rawUrl,
    thumbnail_url: rawThumb.startsWith('data:') ? serveUrl : rawThumb,
  };
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter(Boolean)));
}

function parseTextArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return uniqueStrings(raw.map((value) => String(value)));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return uniqueStrings(parsed.map((value) => String(value)));
    } catch (err) {
    logger.error('Unhandled error:', err);
      return raw.trim() ? [raw.trim()] : [];
    }
  }
  return [];
}

function parseUsedInList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return uniqueStrings(raw.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return uniqueStrings(parsed.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))));
      }
    } catch (err) {
    logger.error('Unhandled error:', err);
      return raw.trim() ? [raw.trim()] : [];
    }
  }
  return [];
}

function isPersistableImageUrl(value: string): boolean {
  const normalized = String(value || '').trim();
  return (
    normalized.startsWith('data:image/') ||
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith('/media/') ||
    normalized.startsWith('/api/media/') ||
    normalized.startsWith(`${getMediaServerBase()}/media/`)
  );
}

function inferMimeTypeFromUrl(url: string, fallback = 'image/jpeg'): string {
  const normalized = String(url || '').trim();
  if (normalized.startsWith('data:image/')) {
    const commaIdx = normalized.indexOf(',');
    if (commaIdx > 5) {
      return normalized.slice(5, commaIdx).replace(';base64', '') || fallback;
    }
  }

  const lower = normalized.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.svg')) return 'image/svg+xml';
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  return fallback;
}

function extFromMime(fileType: string): string {
  switch (String(fileType || '').toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '.jpg';
  }
}

function guessFileNameFromUrl(url: string, fallbackBase: string, fallbackType = 'image/jpeg'): string {
  const normalized = String(url || '').trim();
  if (normalized.startsWith('data:image/')) {
    return sanitizeFileName(`${fallbackBase}${extFromMime(inferMimeTypeFromUrl(normalized, fallbackType))}`);
  }

  try {
    const parsed = new URL(normalized, getMediaServerBase());
    const candidate = path.posix.basename(parsed.pathname || '');
    if (candidate && candidate.includes('.')) return sanitizeFileName(candidate);
  } catch (err) {
    logger.error('Unhandled error:', err);
    // Ignore malformed URLs and fall back to a synthetic filename.
  }

  return sanitizeFileName(`${fallbackBase}${extFromMime(fallbackType)}`);
}

function extractImageUrlsFromHtml(html: string): string[] {
  const matches = html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
  const urls = Array.from(matches, (match) => String(match[1] || '').trim());
  return uniqueStrings(urls.filter(isPersistableImageUrl));
}

function extractImageUrlsFromCanvasData(input: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown, keyHint = '') => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      const key = keyHint.toLowerCase();
      const likelyImageKey =
        key === 'src' ||
        key === 'url' ||
        key === 'thumbnail_url' ||
        key === 'backgroundimage' ||
        key === 'imageurl' ||
        key.includes('image') ||
        key.includes('thumbnail') ||
        key.includes('cover');
      if ((likelyImageKey || normalized.startsWith('data:image/')) && isPersistableImageUrl(normalized)) {
        urls.add(normalized);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, keyHint));
      return;
    }

    if (value && typeof value === 'object') {
      for (const [nextKey, nextValue] of Object.entries(value as Record<string, unknown>)) {
        visit(nextValue, nextKey);
      }
    }
  };

  visit(input);
  return Array.from(urls);
}

async function upsertMediaImageLink(
  mediaImageId: string,
  userId: string,
  sourceTable: MediaSourceTable,
  sourceId: string,
  sourceField: string,
) {
  if (!hasDatabase()) return;
  await pool!.query(
    `INSERT INTO media_image_links (id, media_image_id, user_id, source_table, source_id, source_field, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (user_id, media_image_id, source_table, source_id, source_field)
     DO UPDATE SET updated_at = NOW()`,
    [randomUUID(), mediaImageId, userId, sourceTable, sourceId, sourceField],
  );
}

async function pruneMediaLinksForSource(
  userId: string,
  sourceTable: MediaSourceTable,
  sourceId: string,
  sourceField: string,
  mediaImageIds: string[],
) {
  if (!hasDatabase()) return;
  const params: unknown[] = [userId, sourceTable, sourceId, sourceField];
  let sql =
    'DELETE FROM media_image_links WHERE user_id = $1 AND source_table = $2 AND source_id = $3 AND source_field = $4';
  if (mediaImageIds.length) {
    sql += ' AND NOT (media_image_id = ANY($5::text[]))';
    params.push(mediaImageIds);
  }
  await pool!.query(sql, params);
}

async function ensureMediaRecordForSource(
  options: EnsureMediaRecordOptions,
): Promise<{ row: DbMediaImageRow; created: boolean } | null> {
  if (!hasDatabase()) return null;

  const normalizedUrl = String(options.url || '').trim();
  if (!normalizedUrl || !isPersistableImageUrl(normalizedUrl)) return null;

  const usageKey = `${options.sourceTable}:${options.sourceId}:${options.sourceField}`;
  const normalizedTags = uniqueStrings(options.tags ?? []);
  const nextCategory = options.category === 'admin' ? 'admin' : 'user';
  const nextFileType = options.fileType || inferMimeTypeFromUrl(normalizedUrl);
  const fallbackBase = `${options.sourceTable}-${options.sourceId}-${options.sourceField}`;
  const nextFileName = sanitizeFileName(
    options.fileName || guessFileNameFromUrl(normalizedUrl, fallbackBase, nextFileType),
  );
  const nextThumbnailUrl = String(options.thumbnailUrl || normalizedUrl).trim() || normalizedUrl;

  const existingResult = await pool!.query<DbMediaImageRow>(
    'SELECT * FROM media_images WHERE user_id = $1 AND url = $2 LIMIT 1',
    [options.userId, normalizedUrl],
  );

  if (existingResult.rows.length) {
    const existing = existingResult.rows[0];
    const mergedTags = uniqueStrings([...(parseTextArray(existing.tags) ?? []), ...normalizedTags]);
    const mergedUsedIn = uniqueStrings([...parseUsedInList(existing.used_in), usageKey]);
    const category = existing.category === 'admin' || nextCategory === 'admin' ? 'admin' : 'user';
    const thumbnailUrl = String(existing.thumbnail_url || nextThumbnailUrl || normalizedUrl);

    const updatedResult = await pool!.query<DbMediaImageRow>(
      `UPDATE media_images
       SET tags = $3,
           used_in = $4::jsonb,
           thumbnail_url = $5,
           category = $6
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [existing.id, options.userId, mergedTags, JSON.stringify(mergedUsedIn), thumbnailUrl, category],
    );

    const row = updatedResult.rows[0] || existing;
    await upsertMediaImageLink(row.id, options.userId, options.sourceTable, options.sourceId, options.sourceField);
    return { row, created: false };
  }

  const inserted = await pool!.query<DbMediaImageRow>(
    `INSERT INTO media_images (
       id, user_id, file_name, original_name, file_size, file_type, width, height, url, thumbnail_url, tags, used_in, category
     ) VALUES (
       $1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, $10::jsonb, $11
     )
     RETURNING *`,
    [
      randomUUID(),
      options.userId,
      nextFileName,
      nextFileName,
      0,
      nextFileType,
      normalizedUrl,
      nextThumbnailUrl,
      normalizedTags,
      JSON.stringify([usageKey]),
      nextCategory,
    ],
  );

  const row = inserted.rows[0];
  await upsertMediaImageLink(row.id, options.userId, options.sourceTable, options.sourceId, options.sourceField);
  return { row, created: true };
}

async function syncProfileMedia(user: Pick<DbUserRow, 'id' | 'avatar_url' | 'cover_url'>): Promise<number> {
  let created = 0;
  const avatarResult = await ensureMediaRecordForSource({
    userId: user.id,
    sourceTable: 'users',
    sourceId: user.id,
    sourceField: 'avatar_url',
    url: user.avatar_url,
    fileName: `profile-avatar-${user.id}.jpg`,
    tags: ['profile', 'avatar'],
    category: 'user',
  });
  if (avatarResult?.created) created += 1;
  await pruneMediaLinksForSource(user.id, 'users', user.id, 'avatar_url', avatarResult ? [avatarResult.row.id] : []);

  const coverResult = await ensureMediaRecordForSource({
    userId: user.id,
    sourceTable: 'users',
    sourceId: user.id,
    sourceField: 'cover_url',
    url: user.cover_url,
    fileName: `profile-cover-${user.id}.jpg`,
    tags: ['profile', 'cover'],
    category: 'user',
  });
  if (coverResult?.created) created += 1;
  await pruneMediaLinksForSource(user.id, 'users', user.id, 'cover_url', coverResult ? [coverResult.row.id] : []);

  return created;
}

async function syncBlogPostMedia(
  userId: string,
  post: { id: string; title?: string | null; featured_image?: string | null; social_image?: string | null; content?: string | null },
): Promise<number> {
  let created = 0;

  const featured = await ensureMediaRecordForSource({
    userId,
    sourceTable: 'blog_posts',
    sourceId: post.id,
    sourceField: 'featured_image',
    url: post.featured_image,
    fileName: `post-featured-${post.id}.jpg`,
    tags: ['post', 'featured'],
    category: 'user',
  });
  if (featured?.created) created += 1;
  await pruneMediaLinksForSource(userId, 'blog_posts', post.id, 'featured_image', featured ? [featured.row.id] : []);

  const social = await ensureMediaRecordForSource({
    userId,
    sourceTable: 'blog_posts',
    sourceId: post.id,
    sourceField: 'social_image',
    url: post.social_image,
    fileName: `post-social-${post.id}.jpg`,
    tags: ['post', 'social'],
    category: 'user',
  });
  if (social?.created) created += 1;
  await pruneMediaLinksForSource(userId, 'blog_posts', post.id, 'social_image', social ? [social.row.id] : []);

  const contentUrls = extractImageUrlsFromHtml(String(post.content || ''));
  const contentMediaIds: string[] = [];
  for (const [index, contentUrl] of contentUrls.entries()) {
    const synced = await ensureMediaRecordForSource({
      userId,
      sourceTable: 'blog_posts',
      sourceId: post.id,
      sourceField: 'content',
      url: contentUrl,
      fileName: `post-inline-${post.id}-${index + 1}.jpg`,
      tags: ['post', 'content'],
      category: 'user',
    });
    if (synced) {
      contentMediaIds.push(synced.row.id);
      if (synced.created) created += 1;
    }
  }
  await pruneMediaLinksForSource(userId, 'blog_posts', post.id, 'content', uniqueStrings(contentMediaIds));

  return created;
}

async function syncUserDesignMedia(
  userId: string,
  design: { id: string; name?: string | null; thumbnail_url?: string | null; canvas_data?: unknown },
): Promise<number> {
  let created = 0;

  const thumbnail = await ensureMediaRecordForSource({
    userId,
    sourceTable: 'user_designs',
    sourceId: design.id,
    sourceField: 'thumbnail_url',
    url: design.thumbnail_url,
    fileName: `${sanitizeFileName(design.name || 'design') || 'design'}-thumb.jpg`,
    tags: ['design', 'thumbnail'],
    category: 'user',
  });
  if (thumbnail?.created) created += 1;
  await pruneMediaLinksForSource(userId, 'user_designs', design.id, 'thumbnail_url', thumbnail ? [thumbnail.row.id] : []);

  const canvasMediaIds: string[] = [];
  const canvasUrls = extractImageUrlsFromCanvasData(design.canvas_data);
  for (const [index, canvasUrl] of canvasUrls.entries()) {
    const synced = await ensureMediaRecordForSource({
      userId,
      sourceTable: 'user_designs',
      sourceId: design.id,
      sourceField: 'canvas_data',
      url: canvasUrl,
      fileName: `${sanitizeFileName(design.name || 'design') || 'design'}-asset-${index + 1}.jpg`,
      tags: ['design', 'asset'],
      category: 'user',
    });
    if (synced) {
      canvasMediaIds.push(synced.row.id);
      if (synced.created) created += 1;
    }
  }
  await pruneMediaLinksForSource(userId, 'user_designs', design.id, 'canvas_data', uniqueStrings(canvasMediaIds));

  return created;
}

async function syncCardTemplateMedia(
  adminUserId: string,
  template: { id: string; name?: string | null; cover_image_url?: string | null },
): Promise<number> {
  const cover = await ensureMediaRecordForSource({
    userId: adminUserId,
    sourceTable: 'card_templates',
    sourceId: template.id,
    sourceField: 'cover_image_url',
    url: template.cover_image_url,
    fileName: `${sanitizeFileName(template.name || 'card-template') || 'card-template'}-cover.jpg`,
    tags: ['card-template', 'cover'],
    category: 'admin',
  });
  await pruneMediaLinksForSource(
    adminUserId,
    'card_templates',
    template.id,
    'cover_image_url',
    cover ? [cover.row.id] : [],
  );
  return cover?.created ? 1 : 0;
}

async function syncAllPersistedMediaForUser(userId: string): Promise<{ created: number; scanned: number }> {
  if (!hasDatabase()) return { created: 0, scanned: 0 };

  let created = 0;
  let scanned = 0;

  const userResult = await pool!.query<Pick<DbUserRow, 'id' | 'avatar_url' | 'cover_url'>>(
    'SELECT id, avatar_url, cover_url FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  const userRow = userResult.rows[0];
  if (userRow) {
    scanned += [userRow.avatar_url, userRow.cover_url].filter(Boolean).length;
    created += await syncProfileMedia(userRow);
  }

  const postsResult = await pool!.query<{ id: string; title: string | null; featured_image: string | null; social_image: string | null; content: string | null }>(
    'SELECT id, title, featured_image, social_image, content FROM blog_posts WHERE user_id = $1',
    [userId],
  );
  for (const post of postsResult.rows) {
    scanned += [post.featured_image, post.social_image].filter(Boolean).length;
    scanned += extractImageUrlsFromHtml(String(post.content || '')).length;
    created += await syncBlogPostMedia(userId, post);
  }

  const designsResult = await pool!.query<DbDesign>(
    'SELECT id, name, canvas_data, thumbnail_url, created_at, updated_at, user_id, canvas_width, canvas_height FROM user_designs WHERE user_id = $1',
    [userId],
  );
  for (const design of designsResult.rows) {
    scanned += design.thumbnail_url ? 1 : 0;
    scanned += extractImageUrlsFromCanvasData(design.canvas_data).length;
    created += await syncUserDesignMedia(userId, design);
  }

  return { created, scanned };
}

// GET /media/:id/:filename — public binary image serve (no auth, for external embeds & featured images)
router.get('/media/:id/:filename', async (req: Request, res: Response) => {
  if (!hasDatabase()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await pool!.query(
      'SELECT url, file_type, file_name FROM media_images WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const row = rows[0] as { url: string; file_type: string; file_name: string };
    const dataUrl = String(row.url || '');
    if (!dataUrl) return res.status(404).send('Image data missing');
    if (!dataUrl.startsWith('data:')) return res.redirect(dataUrl);
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return res.status(500).send('Invalid image format');
    const mime = row.file_type;
    if (!['image/jpeg','image/png','image/webp'].includes(mime)) return res.status(415).send('Unsupported media content');
    const buffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    logger.error('media serve error:', err);
    return res.status(500).send('Failed to serve image');
  }
});

// Upload image to media library
router.post('/api/media/upload', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { url, thumbnail_url, file_name, original_name, file_size, file_type, width, height, category, force } =
    req.body as {
      url: string; thumbnail_url?: string; file_name: string; original_name: string;
      file_size: number; file_type: string; width?: number; height?: number; category?: string; force?: boolean;
    };
  if (!url || !file_name || !original_name || !file_type)
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file_type))
    return res.status(400).json({ success: false, error: 'Unsupported image type' });
  try {
    if (url.startsWith('data:')) {
      const bytes=validateRasterDataUrl(url,file_type);
      if (Number(file_size)!==bytes.length) return res.status(400).json({ error: 'Image size does not match the uploaded bytes' });
    } else { await assertSafePublicUrl(url); }
  } catch(error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid image' }); }
  if (!Number.isFinite(Number(file_size)) || Number(file_size)<=0) return res.status(400).json({ error: 'Invalid file size' });
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file_size > MAX_SIZE)
    return res.status(400).json({ success: false, error: 'Image exceeds the maximum upload size of 10MB.' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const safeName = sanitizeFileName(file_name);
    // Duplicate check
    if (!force) {
      const dup = await pool!.query(
        'SELECT id, file_name, file_size, upload_date FROM media_images WHERE user_id = $1 AND file_name = $2 LIMIT 1',
        [user.userId, safeName]
      );
      if (dup.rows.length) {
        // Find next available name: base(1).ext, base(2).ext, ...
        const dotIdx = safeName.lastIndexOf('.');
        const base = dotIdx !== -1 ? safeName.slice(0, dotIdx) : safeName;
        const ext = dotIdx !== -1 ? safeName.slice(dotIdx) : '';
        const existingNames = await pool!.query(
          `SELECT file_name FROM media_images WHERE user_id = $1 AND file_name LIKE $2`,
          [user.userId, `${base}(%${ext}`]
        );
        const existingSet = new Set(existingNames.rows.map((r: any) => r.file_name));
        let n = 1;
        while (existingSet.has(`${base}(${n})${ext}`)) n++;
        const suggestedName = `${base}(${n})${ext}`;
        return res.status(409).json({
          success: false,
          error: 'duplicate',
          existingImage: transformMediaRow(dup.rows[0]),
          suggestedName,
        });
      }
    }
    const id = randomUUID();
    // Only admins may upload directly as category='admin' (shared library).
    // For all other callers — including admins uploading personal images — default to 'user'.
    let imgCategory = 'user';
    if (category === 'admin' && hasDatabase()) {
      const roleRow = await pool!.query('SELECT role FROM users WHERE id=$1', [user.userId]).catch(() => ({ rows: [] as any[] }));
      if (roleRow.rows[0]?.role === 'admin') imgCategory = 'admin';
    }
    const { rows } = await pool!.query(
      `INSERT INTO media_images (id, user_id, file_name, original_name, file_size, file_type, width, height, url, thumbnail_url, tags, used_in, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}','[]',$11) RETURNING *`,
      [id, user.userId, safeName, original_name, file_size ?? 0, file_type, width ?? null, height ?? null, url, thumbnail_url ?? url, imgCategory]
    );
    return res.json({ success: true, image: transformMediaRow(rows[0]) });
  } catch (err) {
    logger.error('media upload error:', err);
    return res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// List user's media images
router.get('/api/media', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, images: [] });
  const { search, tag } = req.query as { search?: string; tag?: string };
  try {
    await syncAllPersistedMediaForUser(user.userId).catch((error) => {
      logger.error('Media list sync error:', error);
    });

    const params: unknown[] = [user.userId];
    // Strict user isolation — only return the requesting user's own images.
    // Admin-shared library assets are served separately via GET /api/media/admin-assets.
    let query = `SELECT * FROM media_images WHERE user_id = $1 AND COALESCE(category, 'user') = 'user'`;
    if (search) { query += ` AND (file_name ILIKE $${params.length + 1} OR original_name ILIKE $${params.length + 1})`; params.push(`%${search}%`); }
    if (tag) { query += ` AND $${params.length + 1} = ANY(tags)`; params.push(tag); }
    query += ' ORDER BY upload_date DESC';
    const { rows } = await pool!.query(query, params);
    return res.json({ success: true, images: rows.map(transformMediaRow) });
  } catch (err) {
    logger.error('media list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

// GET /api/media/:id/image — serve the raw image as binary (used by external platforms like Facebook)
router.get('/api/media/:id/image', async (req: Request, res: Response) => {
  if (!hasDatabase()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await pool!.query(
      'SELECT url, file_type, file_name FROM media_images WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const row = rows[0] as { url: string; file_type: string; file_name: string };
    const dataUrl = String(row.url || '');
    if (!dataUrl) return res.status(404).send('Image data missing');

    // data URL format: "data:<mime>;base64,<data>"
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1 || !dataUrl.startsWith('data:')) {
      // Already a plain HTTP URL — redirect to it
      return res.redirect(dataUrl);
    }
    const mimeMatch = dataUrl.slice(5, commaIdx).replace(';base64', '');
    const mime = mimeMatch || row.file_type || 'image/jpeg';
    const base64Data = dataUrl.slice(commaIdx + 1);
    const buffer = Buffer.from(base64Data, 'base64');

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    logger.error('media serve error:', err);
    return res.status(500).send('Failed to serve image');
  }
});

// Update image metadata (rename / tags / alt text / caption / description)
router.put('/api/media/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  const { file_name, tags, alt_text, caption, description } = req.body as {
    file_name?: string;
    tags?: string[];
    alt_text?: string;
    caption?: string;
    description?: string;
  };
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const updates: string[] = [];
    const params: unknown[] = [id, user.userId];
    if (file_name !== undefined) { updates.push(`file_name = $${params.length + 1}`); params.push(sanitizeFileName(file_name)); }
    if (tags !== undefined) { updates.push(`tags = $${params.length + 1}`); params.push(tags); }
    if (alt_text !== undefined) { updates.push(`alt_text = $${params.length + 1}`); params.push(String(alt_text).slice(0, 1000)); }
    if (caption !== undefined) { updates.push(`caption = $${params.length + 1}`); params.push(String(caption).slice(0, 2000)); }
    if (description !== undefined) { updates.push(`description = $${params.length + 1}`); params.push(String(description).slice(0, 5000)); }
    if (!updates.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    const { rows } = await pool!.query(
      `UPDATE media_images SET ${updates.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Image not found' });
    return res.json({ success: true, image: transformMediaRow(rows[0]) });
  } catch (err) {
    logger.error('media update error:', err);
    return res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// Delete single image
router.delete('/api/media/:id', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { id } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = $1 AND user_id = $2', [id, user.userId]);
    return res.json({ success: true });
  } catch (err) {
    logger.error('media delete error:', err);
    return res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Bulk delete
router.post('/api/media/bulk-delete', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, error: 'ids required' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = ANY($1) AND user_id = $2', [ids, user.userId]);
    return res.json({ success: true });
  } catch (err) {
    logger.error('media bulk delete error:', err);
    return res.status(500).json({ success: false, error: 'Bulk delete failed' });
  }
});

// Admin: list all images
router.get('/api/admin/media', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, images: [] });
  const { search, userId } = req.query as { search?: string; userId?: string };
  try {
    if (userId) {
      await syncAllPersistedMediaForUser(userId).catch((error) => {
        logger.error('Admin media list sync error:', error);
      });
    }

    const params: unknown[] = [];
    const where: string[] = [];
    if (userId) { where.push(`m.user_id = $${params.length + 1}`); params.push(userId); }
    if (search) { where.push(`(m.file_name ILIKE $${params.length + 1} OR u.username ILIKE $${params.length + 1})`); params.push(`%${search}%`); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool!.query(
      `SELECT m.*, u.username, u.email as user_email
       FROM media_images m JOIN users u ON m.user_id = u.id
       ${whereClause} ORDER BY m.upload_date DESC LIMIT 500`,
      params
    );
    return res.json({ success: true, images: rows.map(transformMediaRow) });
  } catch (err) {
    logger.error('admin media list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

// Admin: stats
router.get('/api/admin/media/stats', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, stats: { total_images: 0, total_size: 0, users_count: 0 } });
  try {
    const { rows } = await pool!.query(
      `SELECT COUNT(*) as total_images, COALESCE(SUM(file_size),0) as total_size, COUNT(DISTINCT user_id) as users_count FROM media_images`
    );
    return res.json({ success: true, stats: rows[0] });
  } catch (err) {
    logger.error('admin media stats error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Admin: delete any image
router.delete('/api/admin/media/:id', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.params;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    await pool!.query('DELETE FROM media_images WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (err) {
    logger.error('admin media delete error:', err);
    return res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Get admin-category assets (accessible to authenticated users for template suggestions)
router.get('/api/media/admin-assets', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const { rows } = await pool!.query(
      `SELECT id, file_name, file_type, width, height, url, thumbnail_url, tags, upload_date
       FROM media_images WHERE category = 'admin' ORDER BY upload_date DESC LIMIT 200`
    );
    return res.json({ success: true, images: rows.map(transformMediaRow) });
  } catch (err) {
    logger.error('admin assets error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load admin assets' });
  }
});

// Admin: update media category
router.patch('/api/admin/media/:id/category', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { id } = req.params;
  const { category } = req.body as { category: string };
  const allowed = ['user', 'admin'];
  if (!allowed.includes(category)) return res.status(400).json({ success: false, error: 'Invalid category' });
  if (!hasDatabase()) return res.status(503).json({ success: false, error: 'No database' });
  try {
    const { rows } = await pool!.query('UPDATE media_images SET category=$1 WHERE id=$2 RETURNING *', [category, id]);
    return res.json({ success: true, image: transformMediaRow(rows[0]) });
  } catch (err) {
    logger.error('admin media category error:', err);
    return res.status(500).json({ success: false, error: 'Update failed' });
  }
});

// User: Audit images - shows all images and identifies missing registrations
router.get('/api/media/audit', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, audit: { media_images: 0, featured_images: 0, unregistered: [] } });
  try {
    // 1. Count images in media_images (should only show user's images)
    const mediaCount = await pool!.query(
      'SELECT COUNT(*) as count FROM media_images WHERE user_id = $1 AND category = $2',
      [user.userId, 'user']
    );
    
    // 2. Find all featured images in blog posts for this user
    const featuredImages = await pool!.query(
      'SELECT id, featured_image FROM blog_posts WHERE user_id = $1 AND featured_image IS NOT NULL AND featured_image != $2',
      [user.userId, '']
    );

    // 3. Check which featured images are NOT in media_images table
    const unregistered: any[] = [];
    for (const post of featuredImages.rows) {
      if (!post.featured_image) continue;
      const found = await pool!.query(
        'SELECT id FROM media_images WHERE url = $1 AND user_id = $2',
        [post.featured_image, user.userId]
      );
      if (!found.rows.length) {
        unregistered.push({
          post_id: post.id,
          featured_image: post.featured_image,
          in_media_images: false
        });
      }
    }

    // 4. Get user avatar/cover if they exist
    const userProfile = await pool!.query(
      'SELECT avatar_url, cover_url FROM users WHERE id = $1',
      [user.userId]
    );
    const profileImages: any[] = [];
    if (userProfile.rows[0]?.avatar_url) {
      profileImages.push({ type: 'avatar', url: userProfile.rows[0].avatar_url });
    }
    if (userProfile.rows[0]?.cover_url) {
      profileImages.push({ type: 'cover', url: userProfile.rows[0].cover_url });
    }

    return res.json({
      success: true,
      audit: {
        media_images_count: mediaCount.rows[0].count,
        featured_images_count: featuredImages.rows.length,
        unregistered_featured: unregistered,
        profile_images: profileImages,
        summary: `Total media: ${mediaCount.rows[0].count}, Featured posts: ${featuredImages.rows.length}, Unregistered featured: ${unregistered.length}`
      }
    });
  } catch (err) {
    logger.error('media audit error:', err);
    return res.status(500).json({ success: false, error: 'Audit failed' });
  }
});

// User: Sync all images - registers missing featured images to media_images table
router.post('/api/media/sync-all-images', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!hasDatabase()) return res.json({ success: true, synced: 0 });
  try {
    const sync = await syncAllPersistedMediaForUser(user.userId);
    return res.json({
      success: true,
      synced: sync.created,
      scanned: sync.scanned,
      message: `Synced ${sync.created} missing image(s) from ${sync.scanned} persisted source reference(s)`,
    });
  } catch (err) {
    logger.error('media sync error:', err);
    return res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

// Admin: Verify media database integrity and clean up
router.post('/api/admin/media/verify-integrity', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, issues: [] });
  try {
    const issues: any[] = [];

    // Check 1: Find admin images that belong to regular users
    const adminOwnedByUsers = await pool!.query(
      `SELECT m.id, m.user_id, u.role FROM media_images m
       JOIN users u ON m.user_id = u.id
       WHERE m.category = 'admin' AND u.role != 'admin'`
    );
    if (adminOwnedByUsers.rows.length) {
      issues.push({
        type: 'category_mismatch',
        count: adminOwnedByUsers.rows.length,
        description: 'Found admin-category images owned by non-admin users',
        ids: adminOwnedByUsers.rows.map((r: any) => r.id)
      });
    }

    // Check 2: Find users with images where user_id doesn't match
    const orphanedImages = await pool!.query(
      `SELECT m.id, m.user_id FROM media_images m
       WHERE m.user_id NOT IN (SELECT id FROM users)`
    );
    if (orphanedImages.rows.length) {
      issues.push({
        type: 'orphaned_images',
        count: orphanedImages.rows.length,
        description: 'Found images with non-existent user_id',
        ids: orphanedImages.rows.map((r: any) => r.id)
      });
    }

    // Check 3: Count images per user
    const userImageStats = await pool!.query(
      `SELECT u.id, u.username, COUNT(m.id) as image_count
       FROM users u LEFT JOIN media_images m ON u.id = m.user_id AND COALESCE(m.category, 'user') = 'user'
       GROUP BY u.id, u.username
       HAVING COUNT(m.id) > 0
       ORDER BY COUNT(m.id) DESC`
    );

    // Check 4: Find featured images not registered in media_images
    const unregisteredFeatured = await pool!.query(
      `SELECT DISTINCT bp.user_id, COUNT(*) as unregistered_count
       FROM blog_posts bp
       WHERE bp.featured_image IS NOT NULL AND bp.featured_image != ''
       AND NOT EXISTS (
         SELECT 1 FROM media_images m
         WHERE m.url = bp.featured_image AND m.user_id = bp.user_id
       )
       GROUP BY bp.user_id`
    );
    if (unregisteredFeatured.rows.length) {
      issues.push({
        type: 'unregistered_featured_images',
        count: unregisteredFeatured.rows.length,
        description: 'Found featured images not registered in media_images',
        details: unregisteredFeatured.rows
      });
    }

    return res.json({
      success: true,
      integrity_check: {
        timestamp: new Date().toISOString(),
        total_users_with_images: userImageStats.rows.length,
        user_image_stats: userImageStats.rows,
        issues: issues.length > 0 ? issues : null,
        summary: issues.length === 0 
          ? 'No integrity issues found' 
          : `Found ${issues.length} integrity issue(s)`
      }
    });
  } catch (err) {
    logger.error('media integrity check error:', err);
    return res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// Admin: Auto-fix media database issues
router.post('/api/admin/media/fix-integrity', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!hasDatabase()) return res.json({ success: true, fixed: 0 });
  try {
    let fixed = 0;

    // Fix 1: Change admin-category images to user-category if owned by non-admins
    const fixCategoryResult = await pool!.query(
      `UPDATE media_images SET category = 'user'
       WHERE category = 'admin' AND user_id NOT IN (SELECT id FROM users WHERE role = 'admin')
       RETURNING id`
    );
    fixed += fixCategoryResult.rows.length;
    if (fixCategoryResult.rows.length > 0) {
      logger.info(`[media-fix] Fixed category for ${fixCategoryResult.rows.length} images`);
    }

    // Fix 2: Delete orphaned images
    const deleteOrphanResult = await pool!.query(
      `DELETE FROM media_images WHERE user_id NOT IN (SELECT id FROM users) RETURNING id`
    );
    fixed += deleteOrphanResult.rows.length;
    if (deleteOrphanResult.rows.length > 0) {
      logger.info(`[media-fix] Deleted ${deleteOrphanResult.rows.length} orphaned images`);
    }

    // Fix 3: Re-scan persisted image sources for every user and register anything missing.
    const usersResult = await pool!.query<{ id: string }>('SELECT id FROM users');
    for (const row of usersResult.rows) {
      const sync = await syncAllPersistedMediaForUser(row.id);
      fixed += sync.created;
    }
    if (usersResult.rows.length > 0) {
      logger.info(`[media-fix] Re-scanned persisted media sources for ${usersResult.rows.length} user(s)`);
    }

    return res.json({ 
      success: true, 
      fixed,
      message: `Fixed ${fixed} media integrity issues`
    });
  } catch (err) {
    logger.error('media fix integrity error:', err);
    return res.status(500).json({ success: false, error: 'Fix failed' });
  }
});

  return { router, ensureMediaRecordForSource, syncProfileMedia, syncBlogPostMedia, syncUserDesignMedia, syncCardTemplateMedia };
}
