import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { ensureMagnificBrandKit, findId, findImageUrls, findString, getDesignSystem, saveDesignSystem, type DesignSystem } from './designSystem.ts';
import { nvidiaDescribeImages } from './nvidiaModels.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Teaching the image generators what the user wants — without retraining a
// model (Magnific offers no custom-model training). Three things persist:
//
// 1. Example designs (up to 12): uploaded, pasted, or 👍 on a generated image.
//    Each is uploaded to Magnific once (a creation) and attached to the user's
//    Brand Kit, then passed as a style reference on every image. A vision
//    model sums up their shared style in words for agents and other models.
// 2. Image rules: 👎 with a reason, or typed. Each becomes a Brand Kit hard-ban
//    rule (directive + avoid term) that Magnific enforces, and an "avoid" in
//    the prompt for models that cannot take a kit.
// 3. Products, people and places: 1–6 photos + a name, saved once in
//    Magnific's library and referenced whenever the item appears (@name).
// ─────────────────────────────────────────────────────────────────────────────

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
export type McpCaller = (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; payload: unknown; error?: string }>;
/** Turns a reason ("too dark, no stock people") into { directive, avoid_term }. */
export type RuleWriter = (reason: string) => Promise<{ directive: string; avoid_term: string } | null>;

export const MAX_EXAMPLES = 12;
export const MAX_RULES = 40;
export const MAX_ASSETS = 30;
export type AssetType = 'product' | 'character' | 'locations';

export interface StyleExample { id: string; url: string; note: string; source: string; magnific_creation_id: string | null; in_kit: boolean; created_at: string }
export interface ImageRule { id: string; directive: string; avoid_term: string; source: string; image_url: string | null; magnific_rule_id: string | null; synced: boolean; created_at: string }
export interface LibraryAsset { id: string; type: AssetType; name: string; description: string; images: string[]; magnific_library_id: number | null; created_at: string }

let ensured: Promise<void> | null = null;
export function ensureTasteTables(query: Query): Promise<void> {
  ensured ??= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS user_style_examples (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'upload', magnific_creation_id TEXT, in_kit BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`CREATE INDEX IF NOT EXISTS user_style_examples_user_idx ON user_style_examples(user_id, created_at DESC)`);
    await query(`
      CREATE TABLE IF NOT EXISTS user_image_rules (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, directive TEXT NOT NULL, avoid_term TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'typed', image_url TEXT, magnific_rule_id TEXT, synced BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await query(`CREATE INDEX IF NOT EXISTS user_image_rules_user_idx ON user_image_rules(user_id, created_at DESC)`);
    await query(`
      CREATE TABLE IF NOT EXISTS user_library_assets (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        images JSONB NOT NULL DEFAULT '[]'::jsonb, magnific_library_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, name)
      )`);
    await query(`ALTER TABLE user_custom_instructions ADD COLUMN IF NOT EXISTS autopilot_style BOOLEAN NOT NULL DEFAULT true`).catch(() => undefined);
    await query(`
      CREATE TABLE IF NOT EXISTS user_style_profile (
        user_id TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', examples_key TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

// ── Example designs ──────────────────────────────────────────────────────────

export async function listStyleExamples(query: Query, userId: string): Promise<StyleExample[]> {
  try {
    await ensureTasteTables(query);
    const { rows } = await query(`SELECT * FROM user_style_examples WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX_EXAMPLES]);
    return rows as StyleExample[];
  } catch { return []; }
}

/** Adds an example design (oldest dropped beyond 12). Returns null when the URL is already an example. */
export async function addStyleExample(query: Query, userId: string, url: string, note = '', source = 'upload'): Promise<StyleExample | null> {
  await ensureTasteTables(query);
  const clean = String(url || '').trim();
  if (!/^https:\/\//i.test(clean)) throw new Error('An example needs a public https image address.');
  const dup = await query(`SELECT id FROM user_style_examples WHERE user_id=$1 AND url=$2`, [userId, clean]);
  if (dup.rows.length) return null;
  const id = randomUUID();
  await query(`INSERT INTO user_style_examples (id, user_id, url, note, source) VALUES ($1,$2,$3,$4,$5)`, [id, userId, clean, String(note || '').slice(0, 300), source]);
  await query(
    `DELETE FROM user_style_examples WHERE user_id=$1 AND id IN (SELECT id FROM user_style_examples WHERE user_id=$1 ORDER BY created_at DESC OFFSET $2)`,
    [userId, MAX_EXAMPLES],
  );
  const { rows } = await query(`SELECT * FROM user_style_examples WHERE id=$1`, [id]);
  return (rows[0] as StyleExample) ?? null;
}

export async function removeStyleExample(query: Query, userId: string, id: string): Promise<void> {
  await ensureTasteTables(query);
  await query(`DELETE FROM user_style_examples WHERE user_id=$1 AND id=$2`, [userId, id]);
}

/** A vision model's summary of what the examples have in common (refreshed when the set changes). */
export async function refreshStyleSummary(query: Query, userId: string, describe: typeof nvidiaDescribeImages = nvidiaDescribeImages): Promise<string> {
  await ensureTasteTables(query);
  const examples = await listStyleExamples(query, userId);
  const key = examples.map((e) => e.id).sort().join(',');
  const { rows } = await query(`SELECT summary, examples_key FROM user_style_profile WHERE user_id=$1`, [userId]);
  if (rows[0] && rows[0].examples_key === key) return String(rows[0].summary || '');
  let summary = '';
  if (examples.length) {
    const notes = examples.map((e) => e.note).filter(Boolean);
    try {
      const r = await describe({
        system: 'You are an art director. Describe a visual style precisely and briefly so an image generator can reproduce it. No preamble.',
        prompt: `These are designs the client loves${notes.length ? ` (their notes: ${notes.join('; ')})` : ''}. In at most 80 words, describe what they share: palette, lighting, composition, typography and layout, photography vs illustration, mood, textures. Write it as a style direction ("Bold flat colour blocks, …").`,
        imageUrls: examples.map((e) => e.url),
      });
      summary = r.text.replace(/\s+/g, ' ').trim().slice(0, 700);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'style_summary_failed');
      summary = notes.length ? `Designs the user likes: ${notes.join('; ')}`.slice(0, 700) : '';
    }
  }
  await query(
    `INSERT INTO user_style_profile (user_id, summary, examples_key, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (user_id) DO UPDATE SET summary=EXCLUDED.summary, examples_key=EXCLUDED.examples_key, updated_at=NOW()`,
    [userId, summary, key],
  );
  return summary;
}

export async function getStyleSummary(query: Query, userId: string): Promise<string> {
  try {
    await ensureTasteTables(query);
    const { rows } = await query(`SELECT summary FROM user_style_profile WHERE user_id=$1`, [userId]);
    return String(rows[0]?.summary || '');
  } catch { return ''; }
}

// ── Image rules ──────────────────────────────────────────────────────────────

export async function listImageRules(query: Query, userId: string): Promise<ImageRule[]> {
  try {
    await ensureTasteTables(query);
    const { rows } = await query(`SELECT * FROM user_image_rules WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX_RULES]);
    return rows as ImageRule[];
  } catch { return []; }
}

/** A plain fallback when no AI is available: the reason is the directive; its first phrase the avoid term. */
export function ruleFromReason(reason: string): { directive: string; avoid_term: string } {
  const r = String(reason || '').replace(/\s+/g, ' ').trim();
  const first = r.split(/[.;,]| and | but /i)[0].replace(/^(too|no|not|don'?t|never|avoid|less|stop)\s+(use\s+|using\s+|show\s+|showing\s+)?/i, '').trim();
  return { directive: (/^(avoid|never|don'?t|no)\b/i.test(r) ? r : `Avoid: ${r}`).slice(0, 300), avoid_term: (first || r).slice(0, 200) };
}

export async function addImageRule(query: Query, userId: string, input: { reason?: string; directive?: string; avoid_term?: string; source?: string; imageUrl?: string | null }, write?: RuleWriter): Promise<ImageRule> {
  await ensureTasteTables(query);
  let directive = String(input.directive || '').trim();
  let avoid = String(input.avoid_term || '').trim();
  if ((!directive || !avoid) && input.reason) {
    const fromAi = write ? await write(input.reason).catch(() => null) : null;
    const plain = ruleFromReason(input.reason);
    directive ||= fromAi?.directive || plain.directive;
    avoid ||= fromAi?.avoid_term || plain.avoid_term;
  }
  if (!directive || !avoid) throw new Error('Say what to avoid, e.g. "No dark backgrounds".');
  const id = randomUUID();
  await query(
    `INSERT INTO user_image_rules (id, user_id, directive, avoid_term, source, image_url) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, userId, directive.slice(0, 300), avoid.slice(0, 200), String(input.source || 'typed').slice(0, 40), input.imageUrl ?? null],
  );
  await query(
    `DELETE FROM user_image_rules WHERE user_id=$1 AND id IN (SELECT id FROM user_image_rules WHERE user_id=$1 ORDER BY created_at DESC OFFSET $2)`,
    [userId, MAX_RULES],
  );
  const { rows } = await query(`SELECT * FROM user_image_rules WHERE id=$1`, [id]);
  return rows[0] as ImageRule;
}

export async function removeImageRule(query: Query, userId: string, id: string, mcp?: McpCaller): Promise<void> {
  await ensureTasteTables(query);
  const { rows } = await query(`SELECT magnific_rule_id FROM user_image_rules WHERE user_id=$1 AND id=$2`, [userId, id]);
  await query(`DELETE FROM user_image_rules WHERE user_id=$1 AND id=$2`, [userId, id]);
  const ruleId = rows[0]?.magnific_rule_id;
  const ds = await getDesignSystem(query, userId);
  if (mcp && ruleId && ds?.magnific_kit_id) {
    await mcp('brand_kit_update', { id: ds.magnific_kit_id, atoms: { user_rule_delete: ruleId } }).catch(() => undefined);
  }
}

// ── Products, people and places ──────────────────────────────────────────────

export function assetName(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

export async function listLibraryAssets(query: Query, userId: string): Promise<LibraryAsset[]> {
  try {
    await ensureTasteTables(query);
    const { rows } = await query(`SELECT * FROM user_library_assets WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX_ASSETS]);
    return rows.map((r: any) => ({ ...r, images: Array.isArray(r.images) ? r.images : [], magnific_library_id: r.magnific_library_id == null ? null : Number(r.magnific_library_id) })) as LibraryAsset[];
  } catch { return []; }
}

/** Saves a product/person/place and registers it in Magnific's library (once). */
export async function createLibraryAsset(query: Query, userId: string, input: { type: AssetType; name: string; description?: string; images: string[] }, mcp?: McpCaller): Promise<LibraryAsset> {
  await ensureTasteTables(query);
  const name = assetName(input.name);
  if (!name) throw new Error('Give it a short name, e.g. coffee_bag.');
  const type: AssetType = (['product', 'character', 'locations'] as const).includes(input.type) ? input.type : 'product';
  const images = (input.images || []).map(String).filter((u) => /^https:\/\//i.test(u)).slice(0, 6);
  if (!images.length) throw new Error('Add at least one photo.');
  const existing = await listLibraryAssets(query, userId);
  if (existing.length >= MAX_ASSETS) throw new Error(`You can save up to ${MAX_ASSETS} items — remove one first.`);
  if (existing.some((a) => a.name === name)) throw new Error(`"${name}" already exists — pick another name.`);
  let libId: number | null = null;
  if (mcp) {
    // Magnific library names are unique per account, so the user id keeps them apart.
    const r = await mcp('library_create', {
      name: `${name}-${userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`.slice(0, 50), type,
      description: String(input.description || '').slice(0, 1000), images: images.map((url) => ({ url })),
    }).catch((err) => ({ ok: false, payload: null, error: String(err) }));
    const id = r.ok ? Number(findId(r.payload, ['id', 'assetId', 'libraryId'])) : NaN;
    if (Number.isFinite(id) && id > 0) libId = id;
    else logger.warn({ err: (r as any).error }, 'magnific_library_create_failed');
  }
  const id = randomUUID();
  await query(
    `INSERT INTO user_library_assets (id, user_id, type, name, description, images, magnific_library_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, userId, type, name, String(input.description || '').slice(0, 1000), JSON.stringify(images), libId],
  );
  return (await listLibraryAssets(query, userId)).find((a) => a.id === id)!;
}

export async function removeLibraryAsset(query: Query, userId: string, id: string, mcp?: McpCaller): Promise<void> {
  await ensureTasteTables(query);
  const { rows } = await query(`SELECT magnific_library_id FROM user_library_assets WHERE user_id=$1 AND id=$2`, [userId, id]);
  await query(`DELETE FROM user_library_assets WHERE user_id=$1 AND id=$2`, [userId, id]);
  const libId = rows[0]?.magnific_library_id;
  if (mcp && libId) await mcp('library_delete', { id: Number(libId) }).catch(() => undefined);
}

// ── Syncing to Magnific (each thing once) ────────────────────────────────────

/** A design system to hang the Brand Kit on, even before a website scan. */
async function ensureDesignForKit(query: Query, userId: string): Promise<void> {
  if (await getDesignSystem(query, userId)) return;
  const blank: DesignSystem = { brand_name: 'My brand', website_url: '', captured_at: new Date().toISOString(), colors: [], typography: [], logos: [], voice: [], imagery: [], description: 'Style taught through example designs and rules.', rules: [] };
  await saveDesignSystem(query, userId, blank);
}

/**
 * Uploads new examples to Magnific (once each), attaches them to the Brand
 * Kit, and pushes new rules into it as hard bans. Never throws.
 */
export async function syncTasteToMagnific(query: Query, userId: string, mcp: McpCaller): Promise<{ kitId: string | null; examples: number; rules: number }> {
  let examplesSynced = 0;
  let rulesSynced = 0;
  try {
    await ensureTasteTables(query);
    const examples = await listStyleExamples(query, userId);
    const rules = (await listImageRules(query, userId)).filter((r) => !r.synced);
    if (!examples.some((e) => !e.magnific_creation_id || !e.in_kit) && !rules.length) {
      return { kitId: (await getDesignSystem(query, userId))?.magnific_kit_id ?? null, examples: 0, rules: 0 };
    }
    await ensureDesignForKit(query, userId);
    const kitId = await ensureMagnificBrandKit(query, userId, mcp);
    for (const e of examples) {
      let creation = e.magnific_creation_id;
      if (!creation) {
        const up = await mcp('creations_upload_image', { url: e.url, fileName: `style-example-${e.id.slice(0, 8)}.jpg` }).catch(() => null);
        creation = up?.ok ? findString(up.payload, ['identifier', 'creationIdentifier', 'id']) : null;
        if (creation) await query(`UPDATE user_style_examples SET magnific_creation_id=$2 WHERE id=$1`, [e.id, creation]);
      }
      if (creation && kitId && !e.in_kit) {
        const doc = await mcp('brand_kit_add_document', { id: kitId, documents: [{ filename: `style-example-${e.id.slice(0, 8)}.jpg`, type: 'image', source: { kind: 'creation', identifier: creation } }] }).catch(() => null);
        if (doc?.ok) { await query(`UPDATE user_style_examples SET in_kit=true WHERE id=$1`, [e.id]); examplesSynced++; }
      }
    }
    if (kitId) {
      for (const r of rules) {
        const res = await mcp('brand_kit_add_rule', { id: kitId, directive: r.directive, avoid_term: r.avoid_term }).catch(() => null);
        if (res?.ok) {
          const ruleId = findId(res.payload, ['rule_id', 'ruleId', 'id']);
          await query(`UPDATE user_image_rules SET synced=true, magnific_rule_id=$2 WHERE id=$1`, [r.id, ruleId]);
          rulesSynced++;
        }
      }
    }
    return { kitId, examples: examplesSynced, rules: rulesSynced };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, userId }, 'taste_sync_failed');
    return { kitId: null, examples: examplesSynced, rules: rulesSynced };
  }
}

// ── Using it ─────────────────────────────────────────────────────────────────

export interface Taste {
  styleSummary: string;
  examples: StyleExample[];
  rules: ImageRule[];
  assets: LibraryAsset[];
}

export async function loadTaste(query: Query, userId: string | null | undefined): Promise<Taste> {
  if (!userId) return { styleSummary: '', examples: [], rules: [], assets: [] };
  const [styleSummary, examples, rules, assets] = await Promise.all([
    getStyleSummary(query, userId), listStyleExamples(query, userId), listImageRules(query, userId), listLibraryAssets(query, userId),
  ]);
  return { styleSummary, examples, rules, assets };
}

export function hasTaste(t: Taste): boolean {
  return Boolean(t.styleSummary || t.examples.length || t.rules.length || t.assets.length);
}

/** Saved items this prompt mentions (by @name or plain name). */
export function assetsIn(prompt: string, assets: LibraryAsset[], named: string[] = []): LibraryAsset[] {
  const p = ` ${String(prompt || '').toLowerCase().replace(/[^a-z0-9_@-]+/g, ' ')} `;
  const wanted = new Set(named.map(assetName));
  return assets.filter((a) => wanted.has(a.name) || p.includes(` @${a.name} `) || p.includes(` ${a.name} `) || p.includes(` ${a.name.replace(/_/g, ' ')} `));
}

/** The prompt add-on for any image model: the learned style, what to avoid, and what each saved item looks like. */
export function tastePromptHint(t: Taste, used: LibraryAsset[] = []): string {
  const parts: string[] = [];
  if (t.styleSummary) parts.push(`Style direction: ${t.styleSummary}`);
  if (used.length) parts.push(used.map((a) => `${a.name.replace(/_/g, ' ')}: ${a.description || a.type}`).join('; '));
  if (t.rules.length) parts.push(`Avoid: ${t.rules.map((r) => r.avoid_term).slice(0, 12).join(', ')}.`);
  return parts.join(' ');
}

/** For agents: what the user taught the image generators. */
export function tasteBlock(t: Taste): string {
  if (!hasTaste(t)) return '';
  const lines = ['## IMAGE STYLE THE USER TAUGHT US'];
  if (t.styleSummary) lines.push(`Style of their example designs: ${t.styleSummary}`);
  if (t.rules.length) lines.push(`Never in images: ${t.rules.map((r) => r.directive).slice(0, 15).join(' | ')}`);
  if (t.assets.length) lines.push(`Saved ${t.assets.length === 1 ? 'item' : 'items'} — mention by @name in an image prompt (or the assets field) to show it exactly: ${t.assets.map((a) => `@${a.name} (${a.type === 'character' ? 'person' : a.type === 'locations' ? 'place' : 'product'}${a.description ? `: ${a.description.slice(0, 80)}` : ''})`).join(', ')}`);
  return lines.join('\n');
}

const MAGNIFIC_RATIOS = ['1:1', '21:9', '16:9', '9:16', '2:3', '3:4', '1:2', '2:1', '5:4', '4:5', '3:2', '4:3'];
/** The economy model that can take saved products/people (Nano Banana 2 Lite, 60 Magnific credits) and the one for style alone (Z-Image, 5). */
export const TASTE_ECONOMY_MODELS = { withAssets: 'imagen-nano-banana-2-lite', styleOnly: 'z-image' } as const;
export const TASTE_MODEL_COST: Record<string, number> = { 'imagen-nano-banana-2-lite': 60, 'z-image': 5, 'magnific-one': 180 };

/**
 * One image that follows what the user taught: Brand Kit (Best quality),
 * example designs as style references, saved products/people/places, and the
 * rules. Null when it cannot be made this way — callers fall back to their
 * normal chain with tastePromptHint() added to the prompt.
 */
export async function generateTastefulImage(params: {
  query: Query; userId: string; mcp: McpCaller; prompt: string; aspectRatio: string;
  mode: 'economy' | 'quality'; channel?: string; assetNames?: string[]; taste?: Taste;
}): Promise<{ url: string; model: string; magnificCredits: number } | null> {
  const taste = params.taste ?? await loadTaste(params.query, params.userId);
  await syncTasteToMagnific(params.query, params.userId, params.mcp);
  const fresh = await loadTaste(params.query, params.userId);
  const used = assetsIn(params.prompt, fresh.assets, params.assetNames).filter((a) => a.magnific_library_id);
  const styleRefs = fresh.examples.filter((e) => e.magnific_creation_id).slice(0, 4).map((e) => ({ type: 'style', identifier: e.magnific_creation_id! }));
  const assetRefs = used.slice(0, 4).map((a) => ({ type: a.type, identifier: String(a.magnific_library_id) }));
  const quality = params.mode === 'quality';
  const ds = quality ? await getDesignSystem(params.query, params.userId) : null;
  const kitId = quality ? ds?.magnific_kit_id ?? await ensureMagnificBrandKit(params.query, params.userId, params.mcp) : null;
  if (!quality && !styleRefs.length && !assetRefs.length && !hasTaste(taste)) return null;
  if (quality && !kitId && !styleRefs.length && !assetRefs.length) return null;

  const model = quality ? 'magnific-one' : assetRefs.length ? TASTE_ECONOMY_MODELS.withAssets : TASTE_ECONOMY_MODELS.styleOnly;
  // Z-Image takes style references only; Nano Banana 2 Lite takes style, product and person; Magnific One all of them.
  const references = model === 'z-image' ? styleRefs : model === TASTE_ECONOMY_MODELS.withAssets ? [...assetRefs.filter((r) => r.type !== 'locations'), ...styleRefs].slice(0, 12) : [...assetRefs, ...styleRefs].slice(0, 12);
  // With a Brand Kit the kit owns the look and the rules: keep the prompt short. Without one, the learned style rides in the prompt.
  const prompt = kitId
    ? `${params.prompt}${used.length ? ` ${used.map((a) => `@${a.name}`).join(' ')}` : ''}`
    : [params.prompt, tastePromptHint(fresh, used)].filter(Boolean).join(' ');
  const queued = await params.mcp('images_generate', {
    prompt: prompt.slice(0, 1800), mode: model, count: 1,
    aspectRatio: MAGNIFIC_RATIOS.includes(params.aspectRatio) ? params.aspectRatio : '1:1',
    ...(kitId ? { brandKitId: kitId } : {}),
    ...(references.length ? { references } : {}),
    ...(kitId && params.channel ? { channel: params.channel } : {}),
  }).catch((err) => ({ ok: false, payload: null, error: String(err) }));
  if (!queued.ok) { logger.warn({ err: (queued as any).error, model }, 'taste_image_queue_failed'); return null; }
  const direct = findImageUrls(queued.payload)[0];
  if (direct) return { url: direct, model, magnificCredits: TASTE_MODEL_COST[model] ?? 180 };
  const id = findString(queued.payload, ['identifier', 'creationIdentifier', 'creation_identifier', 'id']);
  if (!id) return null;
  for (let i = 0; i < 6; i++) {
    const waited = await params.mcp('creations_wait', { identifiers: [id], timeoutSeconds: 55 }).catch(() => null);
    if (!waited?.ok) break;
    const url = findImageUrls(waited.payload)[0];
    if (url) return { url, model, magnificCredits: TASTE_MODEL_COST[model] ?? 180 };
    const txt = JSON.stringify(waited.payload ?? '').slice(0, 2000);
    if (/failed|error|rejected/i.test(txt) && !/in_progress|pending|processing|queued/i.test(txt)) break;
  }
  return null;
}


// ── Autopilot: use the taught style (on by default) ──────────────────────────

export async function autopilotUsesStyle(query: Query, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    await ensureTasteTables(query);
    const { rows } = await query(`SELECT autopilot_style FROM user_custom_instructions WHERE user_id=$1`, [userId]);
    return rows[0]?.autopilot_style !== false;
  } catch { return true; }
}

export async function setAutopilotUsesStyle(query: Query, userId: string, on: boolean): Promise<void> {
  await ensureTasteTables(query);
  await query(
    `INSERT INTO user_custom_instructions (user_id, autopilot_style, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (user_id) DO UPDATE SET autopilot_style=EXCLUDED.autopilot_style, updated_at=NOW()`,
    [userId, on],
  );
}

/**
 * The taught style for one Autopilot image: the prompt add-on and the extra
 * reference images (up to 3 examples + photos of saved items it mentions).
 */
export function autopilotTasteInputs(t: Taste, text: string): { promptAddon: string; referenceUrls: string[] } {
  const used = assetsIn(text, t.assets);
  const refs = [...used.flatMap((a) => a.images.slice(0, 2)), ...t.examples.slice(0, 3).map((e) => e.url)];
  return { promptAddon: tastePromptHint(t, used), referenceUrls: [...new Set(refs.filter((u) => /^https:\/\//i.test(u)))] };
}
