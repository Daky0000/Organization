// Platform colours, names and limits for social posts (calendar legend, cards, previews).

export type SocialPlatformId = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'youtube' | 'pinterest';

export const PLATFORM_META: Record<SocialPlatformId, { label: string; color: string; soft: string; limit: number }> = {
  instagram: { label: 'Instagram', color: '#E1306C', soft: '#FDF0F5', limit: 2200 },
  facebook: { label: 'Facebook', color: '#1877F2', soft: '#EEF5FF', limit: 5000 },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', soft: '#EDF4FB', limit: 3000 },
  x: { label: 'X', color: '#0F1419', soft: '#F1F3F5', limit: 280 },
  threads: { label: 'Threads', color: '#6B21A8', soft: '#F5EEFB', limit: 500 },
  tiktok: { label: 'TikTok', color: '#00B2A9', soft: '#E9FAF9', limit: 2200 },
  youtube: { label: 'YouTube', color: '#FF0000', soft: '#FFF0F0', limit: 1000 },
  pinterest: { label: 'Pinterest', color: '#BD081C', soft: '#FDEEEF', limit: 500 },
};

/** Blog / article posts (no platform) get their own legend entry. */
export const BLOG_META = { label: 'Blog / article', color: '#F59E0B', soft: '#FFF8EB' };

export const FORMAT_LABEL: Record<string, string> = {
  text: 'Text', single_image: 'Image', carousel: 'Carousel', reel: 'Reel', story: 'Story', video: 'Video', blog: 'Article',
};

export function platformId(raw: unknown): SocialPlatformId | null {
  const p = String(raw ?? '').toLowerCase();
  if (p === 'twitter') return 'x';
  return p in PLATFORM_META ? (p as SocialPlatformId) : null;
}

export type MediaAsset = { url: string; type?: 'image' | 'video'; caption?: string };

export function mediaOf(post: { media_assets?: unknown; featured_image?: string | null; video_url?: string | null }): MediaAsset[] {
  let list: MediaAsset[] = [];
  const raw = post.media_assets;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) list = arr.filter((m: any) => m && typeof m.url === 'string' && m.url);
  } catch { /* ignore */ }
  if (!list.length && post.video_url) list.push({ url: post.video_url, type: 'video' });
  if (!list.length && post.featured_image) list.push({ url: post.featured_image, type: 'image' });
  return list;
}
