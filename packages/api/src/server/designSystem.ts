import { createHash } from 'crypto';
import { logger } from '../logger.ts';
import { scanWebsiteForBrandCandidates, type ExtractedBrandScanResult, type WebsiteFetchFn } from './autopilot/websiteBrandExtractor.ts';

// ─────────────────────────────────────────────────────────────────────────────
// The user's design system: captured from their website during onboarding,
// saved once, and handed to Magnific once as a Brand Kit.
//
// - Capture: the website scan's colours (with roles), fonts, logo and voice.
// - Magnific: the first Magnific One image creates a Brand Kit from it
//   (design_md + description) and stores the kit id. Later images reuse the
//   kit; it is only re-sent when the design system changes (hash compare).
// - Cheaper models (Z-Image, Flux, free NVIDIA) cannot take a Brand Kit, so
//   their prompts carry a short palette + type hint instead.
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
type McpCaller = (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; payload: unknown; error?: string }>;

export interface DesignSystem {
  brand_name: string;
  website_url: string;
  captured_at: string;
  colors: Array<{ hex: string; role: string; name?: string }>;
  typography: Array<{ family: string; use: string }>;
  logos: Array<{ url: string; variant: string }>;
  voice: string[];
  imagery: string[];
  description: string;
  /** Free-form rules the user added (e.g. "always dark backgrounds"). */
  rules: string[];
}

let ensured: Promise<void> | null = null;
export function ensureDesignTables(query: Query): Promise<void> {
  ensured ??= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS user_design_systems (
        user_id TEXT PRIMARY KEY,
        website_url TEXT NOT NULL DEFAULT '',
        design JSONB NOT NULL DEFAULT '{}'::jsonb,
        design_hash TEXT NOT NULL DEFAULT '',
        magnific_kit_id TEXT,
        magnific_kit_hash TEXT,
        magnific_synced_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Builds the design system from a website scan's candidate tokens. */
export function designFromScan(scan: ExtractedBrandScanResult): DesignSystem {
  const colors: DesignSystem['colors'] = [];
  const typography: DesignSystem['typography'] = [];
  const logos: DesignSystem['logos'] = [];
  const voice: string[] = [];
  const imagery: string[] = [];
  for (const t of scan.candidate_tokens as any[]) {
    const v = t?.value ?? {};
    if (t.category === 'color' && typeof v.hex === 'string' && HEX.test(v.hex)) {
      const hex = v.hex.toLowerCase();
      if (!colors.some((c) => c.hex === hex)) colors.push({ hex, role: String(t.sub_type || 'accent').replace(/_color$/, ''), ...(v.css_var ? { name: String(v.css_var) } : {}) });
    } else if (t.category === 'typography' && v.family) {
      const family = String(v.family).replace(/\+/g, ' ').split(':')[0].trim();
      if (family && !typography.some((f) => f.family.toLowerCase() === family.toLowerCase())) typography.push({ family, use: String(t.sub_type || 'body') });
    } else if (t.category === 'logo' && v.url) {
      logos.push({ url: String(v.url), variant: String(v.variant || t.sub_type || 'primary') });
    } else if (t.category === 'voice' && Array.isArray(v.attributes)) {
      voice.push(...v.attributes.map(String));
    } else if (t.category === 'imagery' && v.style) {
      imagery.push(String(v.style));
    }
  }
  return {
    brand_name: scan.inferred_brand_name || '',
    website_url: scan.website_url,
    captured_at: scan.scanned_at,
    colors: colors.slice(0, 12),
    typography: typography.slice(0, 4),
    logos: logos.slice(0, 3),
    voice: [...new Set(voice)].slice(0, 8),
    imagery: imagery.slice(0, 6),
    description: scan.inferred_description || '',
    rules: [],
  };
}

export function designHash(d: DesignSystem): string {
  const { captured_at: _c, ...stable } = d;
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}

export async function saveDesignSystem(query: Query, userId: string, input: DesignSystem): Promise<DesignSystem> {
  await ensureDesignTables(query);
  const { magnific_kit_id: _k, magnific_synced: _s, design_hash: _h, ...design } = input as any;
  await query(
    `INSERT INTO user_design_systems (user_id, website_url, design, design_hash, updated_at) VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (user_id) DO UPDATE SET website_url=EXCLUDED.website_url, design=EXCLUDED.design, design_hash=EXCLUDED.design_hash, updated_at=NOW()`,
    [userId, design.website_url, JSON.stringify(design), designHash(design)],
  );
  return design;
}

export async function getDesignSystem(query: Query, userId: string | null | undefined): Promise<(DesignSystem & { magnific_kit_id?: string | null; magnific_synced?: boolean; design_hash?: string }) | null> {
  if (!userId) return null;
  try {
    await ensureDesignTables(query);
    const { rows } = await query(`SELECT design, design_hash, magnific_kit_id, magnific_kit_hash FROM user_design_systems WHERE user_id=$1`, [userId]);
    const r = rows[0];
    if (!r?.design || !Object.keys(r.design).length) return null;
    return { ...(r.design as DesignSystem), design_hash: r.design_hash, magnific_kit_id: r.magnific_kit_id ?? null, magnific_synced: Boolean(r.magnific_kit_id && r.magnific_kit_hash === r.design_hash) };
  } catch {
    return null;
  }
}

/** Scans a website and saves its design system for the user. Never throws; null when the site gives nothing usable. */
export async function captureDesignSystem(query: Query, userId: string, url: string, fetcher?: WebsiteFetchFn, scan?: ExtractedBrandScanResult): Promise<DesignSystem | null> {
  try {
    const s = scan ?? await scanWebsiteForBrandCandidates(url, fetcher);
    const design = designFromScan(s);
    if (!design.colors.length && !design.typography.length && !design.logos.length) return null;
    // Keep rules the user added by hand.
    const existing = await getDesignSystem(query, userId);
    if (existing?.rules?.length) design.rules = existing.rules;
    return await saveDesignSystem(query, userId, design);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, url }, 'design_system_capture_failed');
    return null;
  }
}

/** The design system as Markdown tokens (what Magnific's Brand Kit takes as design_md). */
export function designMd(d: DesignSystem): string {
  const lines = [`# ${d.brand_name || 'Brand'} design system`, ''];
  if (d.description) lines.push(d.description, '');
  if (d.colors.length) {
    lines.push('## Colours');
    for (const c of d.colors) lines.push(`- ${c.role}: ${c.hex}${c.name ? ` (${c.name})` : ''}`);
    lines.push('');
  }
  if (d.typography.length) {
    lines.push('## Typography');
    for (const f of d.typography) lines.push(`- ${f.use}: ${f.family}`);
    lines.push('');
  }
  if (d.logos.length) {
    lines.push('## Logo');
    for (const l of d.logos) lines.push(`- ${l.variant}: ${l.url}`);
    lines.push('');
  }
  if (d.voice.length) lines.push('## Voice', d.voice.map((v) => `- ${v}`).join('\n'), '');
  if (d.imagery.length) lines.push('## Imagery', d.imagery.map((v) => `- ${v}`).join('\n'), '');
  if (d.rules.length) lines.push('## Rules', d.rules.map((v) => `- ${v}`).join('\n'), '');
  return lines.join('\n').slice(0, 20_000);
}

/** One sentence for image models that cannot take a Brand Kit. */
export function designPromptHint(d: DesignSystem | null | undefined): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.colors.length) parts.push(`brand colours ${d.colors.slice(0, 5).map((c) => `${c.hex} (${c.role})`).join(', ')}`);
  if (d.typography.length) parts.push(`typography in the style of ${d.typography.map((f) => f.family).join(' / ')}`);
  if (d.imagery.length) parts.push(`imagery: ${d.imagery.slice(0, 3).join(', ')}`);
  if (d.rules.length) parts.push(`rules: ${d.rules.slice(0, 3).join('; ')}`);
  return parts.length ? `Match the brand's design system — ${parts.join('; ')}.` : '';
}

/** A short block for agent prompts. */
export function designSystemBlock(d: DesignSystem | null | undefined): string {
  if (!d) return '';
  return `## THE USER'S DESIGN SYSTEM (from ${d.website_url || 'their website'})\n${designMd(d).split('\n').slice(1).filter(Boolean).slice(0, 30).join('\n')}`;
}

// ── Magnific Brand Kit ───────────────────────────────────────────────────────

/** Depth-first search for the first string under any of these keys. */
export function findString(obj: unknown, keys: string[], depth = 0): string | null {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') {
    try { return findString(JSON.parse(obj), keys, depth + 1); } catch { return null; }
  }
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findString(v, keys, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of keys) {
      const v = (obj as any)[k];
      if (typeof v === 'string' && v) return v;
    }
    for (const v of Object.values(obj as any)) { const r = findString(v, keys, depth + 1); if (r) return r; }
  }
  return null;
}

/** Depth-first search for the first id under any of these keys, as text — numbers count (Magnific library ids are numeric). */
export function findId(obj: unknown, keys: string[], depth = 0): string | null {
  if (obj == null || depth > 6) return null;
  if (typeof obj === 'string') {
    try { return findId(JSON.parse(obj), keys, depth + 1); } catch { return null; }
  }
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findId(v, keys, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of keys) {
      const v = (obj as any)[k];
      if ((typeof v === 'string' && v) || (typeof v === 'number' && Number.isFinite(v))) return String(v);
    }
    for (const v of Object.values(obj as any)) { const r = findId(v, keys, depth + 1); if (r) return r; }
  }
  return null;
}

/** Every https image URL in a tool result. */
export function findImageUrls(obj: unknown, depth = 0, out: string[] = []): string[] {
  if (!obj || depth > 8) return out;
  if (typeof obj === 'string') {
    if (/^https:\/\/\S+$/i.test(obj) && /\.(png|jpe?g|webp)(\?|$)|\/image|cdn|storage/i.test(obj)) out.push(obj);
    else if (obj.trim().startsWith('{') || obj.trim().startsWith('[')) { try { findImageUrls(JSON.parse(obj), depth + 1, out); } catch { /* text */ } }
    return out;
  }
  if (Array.isArray(obj)) { for (const v of obj) findImageUrls(v, depth + 1, out); return out; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as any)) {
      if (/thumb|preview|avatar|logo/i.test(k)) continue;
      findImageUrls(v, depth + 1, out);
    }
  }
  return out;
}

/**
 * The user's Magnific Brand Kit id, creating or refreshing it only when the
 * design system is new or changed since it was last sent. Null when there is
 * no design system or Magnific cannot be reached.
 */
export async function ensureMagnificBrandKit(query: Query, userId: string, mcp: McpCaller): Promise<string | null> {
  const ds = await getDesignSystem(query, userId);
  if (!ds) return null;
  // The hash of the design as stored (not of this enriched copy), so "already sent" compares like with like.
  const { magnific_kit_id: _k, magnific_synced: _s, design_hash: storedHash, ...design } = ds;
  const hash = storedHash || designHash(design as DesignSystem);
  if (ds.magnific_kit_id && ds.magnific_synced) return ds.magnific_kit_id;
  try {
    let kitId = ds.magnific_kit_id ?? null;
    if (!kitId) {
      const created = await mcp('brand_kit_create', {
        name: `${ds.brand_name || 'Brand'} (Dakyworld)`.slice(0, 255),
        description: (ds.description || `Design system captured from ${ds.website_url}`).slice(0, 5000),
      });
      if (!created.ok) throw new Error(created.error || 'brand_kit_create failed');
      kitId = findString(created.payload, ['id', 'sqid', 'brandKitId', 'brand_kit_id']);
      if (!kitId) throw new Error('brand_kit_create returned no id');
    }
    const updated = await mcp('brand_kit_update', { id: kitId, design_md: designMd(design as DesignSystem), status: 'ready' });
    if (!updated.ok) throw new Error(updated.error || 'brand_kit_update failed');
    await query(
      `UPDATE user_design_systems SET magnific_kit_id=$2, magnific_kit_hash=$3, magnific_synced_at=NOW() WHERE user_id=$1`,
      [userId, kitId, hash],
    );
    logger.info({ userId, kitId }, 'magnific_brand_kit_synced');
    return kitId;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, userId }, 'magnific_brand_kit_sync_failed');
    // A kit that exists but could not be refreshed is still better than none.
    return ds.magnific_kit_id ?? null;
  }
}

/**
 * One on-brand Magnific One image through the user's Brand Kit. Null when it
 * cannot be made this way (the caller then uses the plain Magnific One call).
 */
export async function generateWithBrandKit(params: {
  query: Query; userId: string; mcp: McpCaller; prompt: string; aspectRatio: string; channel?: string;
}): Promise<{ url: string; kitId: string } | null> {
  const kitId = await ensureMagnificBrandKit(params.query, params.userId, params.mcp);
  if (!kitId) return null;
  const allowed = ['1:1', '21:9', '16:9', '9:16', '2:3', '3:4', '1:2', '2:1', '5:4', '4:5', '3:2', '4:3'];
  const queued = await params.mcp('images_generate', {
    prompt: params.prompt.slice(0, 1500),
    brandKitId: kitId,
    mode: 'magnific-one',
    count: 1,
    aspectRatio: allowed.includes(params.aspectRatio) ? params.aspectRatio : '1:1',
    ...(params.channel ? { channel: params.channel } : {}),
  });
  if (!queued.ok) { logger.warn({ err: queued.error }, 'brand_kit_image_queue_failed'); return null; }
  const direct = findImageUrls(queued.payload)[0];
  if (direct) return { url: direct, kitId };
  const id = findString(queued.payload, ['identifier', 'creationIdentifier', 'creation_identifier', 'id']);
  if (!id) return null;
  // Magnific One takes about a minute; creations_wait long-polls up to 55 s per call.
  for (let i = 0; i < 6; i++) {
    const waited = await params.mcp('creations_wait', { identifiers: [id], timeoutSeconds: 55 });
    if (!waited.ok) break;
    const url = findImageUrls(waited.payload)[0];
    if (url) return { url, kitId };
    if (/failed|error|rejected/i.test(JSON.stringify(waited.payload ?? '').slice(0, 2000)) && !/in_progress|pending|processing/i.test(JSON.stringify(waited.payload ?? '').slice(0, 2000))) break;
  }
  logger.warn({ id }, 'brand_kit_image_not_ready');
  return null;
}

/** Social platform + format → Magnific's channel, so the kit's surface rules apply. */
export function magnificChannel(platform: string, format: string): string | undefined {
  if (platform === 'instagram') return format === 'story' ? 'instagram_story' : format === 'reel' ? 'instagram_reel_cover' : 'instagram_post';
  if (platform === 'linkedin') return 'linkedin_post';
  if (platform === 'x') return 'x_post';
  if (platform === 'facebook') return 'facebook_post';
  if (platform === 'pinterest') return 'pinterest_pin';
  if (platform === 'tiktok') return 'tiktok_video_cover';
  return 'social';
}
