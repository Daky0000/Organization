import { safeAxios } from '../ssrf-guard.ts';
import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import axios from 'axios';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';
import { hasAICredits, chargeAICredits } from '../ai-helpers.ts';
import { invalidateSharedContext } from './agentSharedContext.ts';
import { withMcpClient, listMcpTools, extractToolPayload, type McpServerConn } from './mcpClient.ts';

// ─────────────────────────────────────────────────────────────────────────────
// MCP integrations (Admin → MCP) + the media they feed.
//
// Admin configures MCP servers (command/env for stdio, url/headers for http).
// The MeiGen AI Design adapter pulls its curated gallery (image + prompt +
// model) into mcp_media, filtered to the allowed models (GPT / Gemini by
// default). Users browse that feed in AI Studio → Discover, like images
// (mcp_media_likes → Personalization → Images), and get "AI Suggestions"
// based on what they liked.
// ─────────────────────────────────────────────────────────────────────────────

type AuthResult = { userId: string; role?: string } | null;

interface AdminDeps {
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  pool: Pool;
  encryptIntegrationSecret: (plain: string) => string;
  decryptIntegrationSecret: (encrypted: string) => string;
}

interface UserDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  pool: Pool;
}

const DEFAULT_MEIGEN_CONFIG = {
  adapter: 'meigen',
  categories: ['Photography', 'Illustration & 3D', 'Product & Brand', 'Food & Drink', 'Poster Design', 'UI & Graphic'],
  pages_per_category: 2,
  page_size: 20,
  sort_by: 'likes',
  // First sync pass per category — pulls newly posted items so the gallery
  // stays current instead of re-fetching the same all-time-popular set.
  recency_sort: 'latest',
  allowed_models: ['gpt', 'gemini', 'nano banana', 'nanobanana', 'nano-banana', 'imagen'],
  // Model + full prompt come from get_inspiration; one call per new item.
  max_detail_lookups: 80,
  // Items whose model we couldn't resolve are kept (they appear under "All"
  // but not under the GPT/Gemini tabs). Set false to drop them instead.
  keep_unknown_models: true,
};

function decryptJson(decrypt: (s: string) => string, value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try { return JSON.parse(decrypt(value)); } catch { return {}; }
}

function maskKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj)) out[k] = obj[k] ? '••••••' : '';
  return out;
}

async function buildConn(row: any, decrypt: (s: string) => string): Promise<McpServerConn> {
  return {
    transport: row.transport === 'http' ? 'http' : 'stdio',
    command: row.command,
    args: typeof row.args === 'string' ? JSON.parse(row.args) : row.args,
    url: row.url,
    env: decryptJson(decrypt, row.env_encrypted),
    headers: decryptJson(decrypt, row.headers_encrypted),
  };
}

// ── MeiGen gallery sync ───────────────────────────────────────────────────────
//
// The meigen MCP server returns human-readable markdown, not JSON. Verified
// live output shapes:
//
//   search_gallery → "1. **#691** by 𝐌 — Product & Brand\n   ![Preview](url)\n
//                     Prompt: …\n   Stats: 224 likes, 4,986 views\n   ID: 2015…"
//   get_inspiration → "## Full Prompt\n```…```\n## Metadata\n- Model: nanobanana\n…"

type GalleryEntry = { id: string; image: string; prompt: string; likes: number; title: string | null };

export function parseGalleryMarkdown(text: string): GalleryEntry[] {
  const entries: GalleryEntry[] = [];
  for (const block of String(text).split(/\n(?=\d+\.\s+\*\*)/)) {
    const id = block.match(/\bID:\s*(\S+)/)?.[1];
    const image = block.match(/!\[[^\]]*\]\((https?:[^)\s]+)\)/)?.[1];
    if (!id || !image) continue;
    const title = block.match(/^\d+\.\s+\*\*(#?[^*]+)\*\*/)?.[1]?.trim() ?? null;
    const prompt = (block.match(/Prompt:\s*([\s\S]*?)(?=\n\s*(?:Stats:|ID:))/)?.[1] ?? '').trim();
    const likes = Number((block.match(/([\d,]+)\s+likes/)?.[1] ?? '0').replace(/,/g, '')) || 0;
    entries.push({ id, image, prompt, likes, title });
  }
  return entries;
}

export function parseInspirationMarkdown(text: string): { prompt: string; model: string } {
  const s = String(text);
  return {
    prompt: (s.match(/## Full Prompt\s*```([\s\S]*?)```/)?.[1] ?? '').trim(),
    model: (s.match(/-\s*Model:\s*([^\n]+)/)?.[1] ?? '').trim(),
  };
}

function modelAllowed(model: string, allowed: string[]): boolean {
  const m = model.toLowerCase();
  return allowed.some((a) => m.includes(a.toLowerCase()));
}

export async function syncMeigenGallery(
  pool: Pool,
  serverRow: any,
  decrypt: (s: string) => string
): Promise<{ scanned: number; stored: number; errors: string[] }> {
  const cfg = { ...DEFAULT_MEIGEN_CONFIG, ...(typeof serverRow.config === 'object' && serverRow.config ? serverRow.config : {}) };
  const conn = await buildConn(serverRow, decrypt);
  const errors: string[] = [];
  let scanned = 0;
  let stored = 0;
  let detailBudget = Number(cfg.max_detail_lookups) || 0;

  // Items already enriched (model known) don't need another detail lookup.
  const { rows: existingRows } = await pool.query(
    `SELECT external_id, model FROM mcp_media WHERE server_id=$1`, [serverRow.id]
  );
  const existingModels = new Map<string, string | null>(existingRows.map((r: any) => [r.external_id, r.model]));

  // Two passes per category: a recency pass first (so items newly posted on
  // MeiGen actually enter the crawl window — sorting only by likes re-fetches
  // the same all-time-popular set forever), then the quality pass by likes.
  const sortPasses = Array.from(new Set([String(cfg.recency_sort || 'latest'), String(cfg.sort_by || 'likes')]));

  await withMcpClient(conn, async (client) => {
    for (const sortBy of sortPasses) {
    for (const category of cfg.categories.slice(0, 8)) {
      // The recency pass only needs the first page — new posts are at the top.
      const pages = sortBy === cfg.sort_by ? Math.max(1, Number(cfg.pages_per_category) || 1) : 1;
      for (let page = 0; page < pages; page++) {
        let items: GalleryEntry[] = [];
        try {
          const result = await client.callTool({
            name: 'search_gallery',
            arguments: { category, limit: Math.min(20, Number(cfg.page_size) || 20), offset: page * (Number(cfg.page_size) || 20), sortBy },
          });
          items = parseGalleryMarkdown(String(extractToolPayload(result) ?? ''));
        } catch (err) {
          errors.push(`browse "${category}" ${sortBy} p${page}: ${err instanceof Error ? err.message : 'failed'}`);
          continue;
        }
        if (!items.length) break; // past the end of this category

        for (const item of items) {
          scanned++;
          let prompt = item.prompt;
          let model = existingModels.get(item.id) ?? '';

          // Full prompt + model live in the detail view — fetch for new items.
          if (!model && detailBudget > 0) {
            detailBudget--;
            try {
              const detail = await client.callTool({ name: 'get_inspiration', arguments: { imageId: item.id } });
              const parsed = parseInspirationMarkdown(String(extractToolPayload(detail) ?? ''));
              if (parsed.prompt) prompt = parsed.prompt;
              if (parsed.model) model = parsed.model;
            } catch { /* keep the truncated prompt */ }
          }

          if (model && !modelAllowed(model, cfg.allowed_models)) continue;
          if (!model && !cfg.keep_unknown_models) continue;

          try {
            const inserted = await pool.query(
              `INSERT INTO mcp_media (server_id, external_id, title, prompt, model, category, image_url, likes_count, featured, raw, fetched_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
               ON CONFLICT (server_id, external_id) DO UPDATE SET
                 title=COALESCE(NULLIF(EXCLUDED.title,''), mcp_media.title),
                 prompt=CASE WHEN LENGTH(COALESCE(EXCLUDED.prompt,'')) > LENGTH(COALESCE(mcp_media.prompt,'')) THEN EXCLUDED.prompt ELSE mcp_media.prompt END,
                 model=COALESCE(NULLIF(EXCLUDED.model,''), mcp_media.model),
                 category=COALESCE(NULLIF(EXCLUDED.category,''), mcp_media.category),
                 image_url=EXCLUDED.image_url,
                 featured=EXCLUDED.featured,
                 fetched_at=NOW()`,
              [
                serverRow.id, item.id, item.title, prompt || null, model || null, category,
                item.image, item.likes, item.likes >= 1000,
                JSON.stringify({ source_likes: item.likes }),
              ]
            );
            if (inserted.rowCount) stored++;
          } catch (err) {
            errors.push(`store ${item.id}: ${err instanceof Error ? err.message : 'failed'}`);
          }
        }
      }
    }
    }
  });

  await pool.query(
    `UPDATE mcp_servers SET last_synced_at=NOW(), status='ok', status_message=$2, updated_at=NOW() WHERE id=$1`,
    [serverRow.id, `Synced ${stored} of ${scanned} items${errors.length ? ` (${errors.length} errors)` : ''}`]
  ).catch(() => undefined);

  return { scanned, stored, errors: errors.slice(0, 10) };
}

// Periodic scan (server.ts scheduler): sync media for every enabled MCP
// server whose adapter produces media. Currently only the meigen adapter.
export async function processMcpMediaSync(pool: Pool | null, decrypt: (s: string) => string): Promise<void> {
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcp_servers WHERE enabled=true AND (config->>'adapter')='meigen'
       AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '5 hours')`
    );
    for (const row of rows) {
      try {
        const result = await syncMeigenGallery(pool, row, decrypt);
        logger.info({ server: row.slug, ...result, errors: result.errors.length }, 'mcp_media_sync_done');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        logger.warn({ err, server: row.slug }, 'mcp_media_sync_failed');
        await pool.query(
          `UPDATE mcp_servers SET status='error', status_message=$2, updated_at=NOW() WHERE id=$1`,
          [row.id, message.slice(0, 300)]
        ).catch(() => undefined);
      }
    }
  } catch (err) {
    logger.error({ err }, 'mcp_media_sync_tick_failed');
  }
}

// Seed the MeiGen server row once so the admin only has to paste the token.
// The MCP server ships as the `meigen` npm package (per the repo's mcpServers
// config: command "npx", args ["-y","meigen@1.3.3"]).
export async function seedDefaultMcpServers(pool: Pool | null): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO mcp_servers (name, slug, transport, command, args, config, enabled, status, status_message)
     VALUES ('MeiGen AI Design', 'meigen', 'stdio', 'npx', '["-y","meigen"]'::jsonb, $1::jsonb, false, 'unconfigured', 'Add your MeiGen API token and enable to start syncing')
     ON CONFLICT (slug) DO NOTHING`,
    [JSON.stringify(DEFAULT_MEIGEN_CONFIG)]
  ).catch(() => undefined);
  // Repair rows seeded with the wrong package name (meigen-ai-design-mcp is
  // the GitHub repo name; the npm package is just `meigen`).
  await pool.query(
    `UPDATE mcp_servers SET args='["-y","meigen"]'::jsonb, updated_at=NOW()
     WHERE slug='meigen' AND args::text LIKE '%meigen-ai-design-mcp%'`
  ).catch(() => undefined);
  // Repair the v1 config shape (keyword search) — the live server browses by
  // category with pagination instead.
  await pool.query(
    `UPDATE mcp_servers SET config=$1::jsonb, updated_at=NOW()
     WHERE slug='meigen' AND config ? 'sync_keywords'`,
    [JSON.stringify(DEFAULT_MEIGEN_CONFIG)]
  ).catch(() => undefined);

  // Seed the official Magnific MCP server (https://mcp.magnific.com)
  // Exposes 236 tools across 13 categories: Magnific One, Images, Video, Lip-Sync (video_speak),
  // Audio (TTS, Music, SFX, Isolation), Spaces, Flows, Library, Brand Kits, 3D, Design, and Stock.
  const magnificMcpConfig = {
    adapter: 'magnific',
    url: 'https://mcp.magnific.com',
    capabilities: [
      'magnific-one', 'images', 'video', 'lip-sync', 'audio',
      'spaces', 'flows', 'library', 'brand-kits', '3d-models', '3d-scenes', 'design', 'stock',
    ],
  };
  await pool.query(
    `INSERT INTO mcp_servers (name, slug, transport, url, config, enabled, status, status_message)
     VALUES ('Magnific AI MCP', 'magnific', 'http', 'https://mcp.magnific.com', $1::jsonb, true, 'ok', 'Magnific MCP (https://mcp.magnific.com) — 236 tools for Magnific One, Video, Lip-Sync, Audio, Spaces & Flows')
     ON CONFLICT (slug) DO UPDATE SET
       url = COALESCE(NULLIF(mcp_servers.url, ''), 'https://mcp.magnific.com'),
       transport = 'http',
       config = COALESCE(mcp_servers.config, $1::jsonb)`,
    [JSON.stringify(magnificMcpConfig)]
  ).catch(() => undefined);
}

/**
 * Invoke a tool on the Magnific MCP server (https://mcp.magnific.com).
 * Automatically attaches any configured headers from mcp_servers or the platform Magnific API key.
 */
export async function callMagnificMcpTool(
  pool: Pool | null,
  toolName: string,
  toolArgs: Record<string, unknown> = {},
  decryptSecret?: (encrypted: string) => string
): Promise<{ ok: boolean; payload: unknown; error?: string }> {
  try {
    let url = 'https://mcp.magnific.com';
    const headers: Record<string, string> = {};

    if (pool) {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers WHERE slug='magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
      const row = rows[0];
      if (row?.url) url = String(row.url).trim();
      if (row?.headers_encrypted && decryptSecret) {
        Object.assign(headers, decryptJson(decryptSecret, row.headers_encrypted));
      }
      const cfgRow = await pool.query(`SELECT config FROM platform_configs WHERE platform='magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
      const apiKey = decryptPlatformConfig(cfgRow.rows[0]?.config)?.apiKey || process.env.MAGNIFIC_API_KEY || '';
      if (apiKey && !headers['x-magnific-api-key']) {
        headers['x-magnific-api-key'] = apiKey;
      }
      if (apiKey && !headers['Authorization'] && !headers['authorization']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    } else if (process.env.MAGNIFIC_API_KEY) {
      headers['x-magnific-api-key'] = process.env.MAGNIFIC_API_KEY;
      headers['Authorization'] = `Bearer ${process.env.MAGNIFIC_API_KEY}`;
    }

    const conn: McpServerConn = {
      transport: 'http',
      url,
      headers,
    };

    const payload = await withMcpClient(conn, async (client) => {
      const result = await client.callTool({
        name: toolName,
        arguments: toolArgs,
      });
      return extractToolPayload(result);
    });
    return { ok: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, payload: null, error: message };
  }
}

// Map raw MCP transport failures to something an admin can act on.
export function friendlyMcpError(err: unknown, conn: { transport: string; command?: string | null }): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/connection closed|-32000/i.test(raw)) {
    return conn.transport === 'stdio'
      ? `The MCP server process exited immediately (${raw}). Usually this means the command/package name is wrong, the package failed to download, or a required env var is missing. Check the Command + Arguments in Configure — for MeiGen it should be: npx -y meigen`
      : `The MCP server closed the connection (${raw}). Check the server URL and auth headers.`;
  }
  if (/ENOENT/i.test(raw)) return `Command not found: "${conn.command}". Make sure it is installed on the server.`;
  if (/timed out/i.test(raw)) return `${raw}. First run can be slow while npx downloads the package — try Test again.`;
  return raw;
}

// ── Admin routes (mounted at /api/admin/mcp) ─────────────────────────────────

export function registerMcpAdminRoutes({ requireAdmin, pool, encryptIntegrationSecret, decryptIntegrationSecret }: AdminDeps): Router {
  const router = express.Router();

  router.get('/servers', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers ORDER BY created_at`);
      return res.json({
        success: true,
        servers: rows.map((r: any) => ({
          ...r,
          env_encrypted: undefined,
          headers_encrypted: undefined,
          env_keys: maskKeys(decryptJson(decryptIntegrationSecret, r.env_encrypted)),
          header_keys: maskKeys(decryptJson(decryptIntegrationSecret, r.headers_encrypted)),
        })),
      });
    } catch (err) {
      logger.error({ err }, 'mcp_servers_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to list MCP servers' });
    }
  });

  router.post('/servers', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { name, slug, transport = 'stdio', command, args, url, env, headers, config } = req.body as Record<string, any>;
      if (!name?.trim() || !slug?.trim()) return res.status(400).json({ success: false, error: 'name and slug are required' });
      const { rows } = await pool.query(
        `INSERT INTO mcp_servers (name, slug, transport, command, args, url, env_encrypted, headers_encrypted, config)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb) RETURNING id`,
        [
          String(name).trim(), String(slug).trim().toLowerCase(), transport === 'http' ? 'http' : 'stdio',
          command || null, JSON.stringify(Array.isArray(args) ? args : []), url || null,
          env && Object.keys(env).length ? encryptIntegrationSecret(JSON.stringify(env)) : null,
          headers && Object.keys(headers).length ? encryptIntegrationSecret(JSON.stringify(headers)) : null,
          JSON.stringify(config && typeof config === 'object' ? config : {}),
        ]
      );
      return res.json({ success: true, id: rows[0].id });
    } catch (err: any) {
      if (String(err?.message || '').includes('unique')) return res.status(400).json({ success: false, error: 'A server with that slug already exists' });
      logger.error({ err }, 'mcp_server_create_failed');
      return res.status(500).json({ success: false, error: 'Failed to create MCP server' });
    }
  });

  router.put('/servers/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows: existing } = await pool.query(`SELECT * FROM mcp_servers WHERE id=$1`, [req.params.id]);
      if (!existing.length) return res.status(404).json({ success: false, error: 'Server not found' });
      const cur = existing[0];
      const b = req.body as Record<string, any>;

      // Secrets: merge with existing so masked values ('••••••') keep old secrets.
      const mergeSecrets = (incoming: Record<string, string> | undefined, encrypted: string | null) => {
        if (!incoming) return encrypted;
        const current = decryptJson(decryptIntegrationSecret, encrypted);
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(incoming)) {
          if (!k.trim()) continue;
          next[k.trim()] = v && !/^•+$/.test(v) ? v : (current[k.trim()] ?? '');
        }
        const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== ''));
        return Object.keys(clean).length ? encryptIntegrationSecret(JSON.stringify(clean)) : null;
      };

      await pool.query(
        `UPDATE mcp_servers SET
           name=COALESCE($2,name), transport=COALESCE($3,transport), command=$4, args=COALESCE($5::jsonb,args),
           url=$6, env_encrypted=$7, headers_encrypted=$8, config=COALESCE($9::jsonb,config),
           enabled=COALESCE($10,enabled), updated_at=NOW()
         WHERE id=$1`,
        [
          req.params.id,
          b.name?.trim() || null,
          b.transport === 'http' ? 'http' : b.transport === 'stdio' ? 'stdio' : null,
          b.command !== undefined ? (b.command || null) : cur.command,
          b.args !== undefined ? JSON.stringify(Array.isArray(b.args) ? b.args : []) : null,
          b.url !== undefined ? (b.url || null) : cur.url,
          mergeSecrets(b.env, cur.env_encrypted),
          mergeSecrets(b.headers, cur.headers_encrypted),
          b.config && typeof b.config === 'object' ? JSON.stringify(b.config) : null,
          typeof b.enabled === 'boolean' ? b.enabled : null,
        ]
      );
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'mcp_server_update_failed');
      return res.status(500).json({ success: false, error: 'Failed to update MCP server' });
    }
  });

  router.delete('/servers/:id', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await pool.query(`DELETE FROM mcp_servers WHERE id=$1`, [req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'mcp_server_delete_failed');
      return res.status(500).json({ success: false, error: 'Failed to delete MCP server' });
    }
  });

  // Test connection: connect + list tools, record status.
  router.post('/servers/:id/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers WHERE id=$1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Server not found' });
      const row = rows[0];
      const conn = await buildConn(row, decryptIntegrationSecret);
      try {
        const tools = await listMcpTools(conn);
        await pool.query(
          `UPDATE mcp_servers SET status='ok', status_message=$2, last_checked_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [req.params.id, `Connected — ${tools.length} tools`]
        );
        return res.json({ success: true, tools });
      } catch (err) {
        const message = friendlyMcpError(err, { transport: row.transport, command: row.command });
        await pool.query(
          `UPDATE mcp_servers SET status='error', status_message=$2, last_checked_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [req.params.id, message.slice(0, 300)]
        ).catch(() => undefined);
        return res.status(502).json({ success: false, error: message });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
    }
  });

  // Manual sync now (meigen adapter).
  router.post('/servers/:id/sync', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res); if (!admin) return;
    try {
      const { rows } = await pool.query(`SELECT * FROM mcp_servers WHERE id=$1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Server not found' });
      if (rows[0].config?.adapter !== 'meigen') return res.status(400).json({ success: false, error: 'This server has no media sync adapter' });
      try {
        const result = await syncMeigenGallery(pool, rows[0], decryptIntegrationSecret);
        return res.json({ success: true, ...result });
      } catch (err) {
        const message = friendlyMcpError(err, { transport: rows[0].transport, command: rows[0].command });
        await pool.query(
          `UPDATE mcp_servers SET status='error', status_message=$2, updated_at=NOW() WHERE id=$1`,
          [req.params.id, message.slice(0, 300)]
        ).catch(() => undefined);
        return res.status(502).json({ success: false, error: message });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  return router;
}

// ── User media routes (mounted at /api/mcp) ─────────────────────────────────

export function registerMcpMediaRoutes({ requireAuth, pool }: UserDeps): Router {
  const router = express.Router();

  // GET /api/mcp/media?tab=all|gpt|gemini&sort=featured|newest|popular
  router.get('/media', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const tab = String(req.query.tab || 'all');
      const sort = String(req.query.sort || 'featured');
      const limit = Math.min(80, Math.max(1, parseInt(String(req.query.limit || '48'), 10)));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));

      const params: unknown[] = [auth.userId];
      let where = 'TRUE';
      if (tab === 'gpt') { where = `LOWER(m.model) LIKE '%gpt%'`; }
      else if (tab === 'gemini') { where = `(LOWER(m.model) LIKE '%gemini%' OR LOWER(m.model) LIKE '%nano%' OR LOWER(m.model) LIKE '%imagen%')`; }

      // Default view surfaces fresh arrivals (last 7 days) first, then the
      // featured/popular ranking — otherwise the same old top-liked items sit
      // on top forever and the gallery looks frozen.
      const order = sort === 'newest' ? 'm.created_at DESC'
        : sort === 'popular' ? 'm.likes_count DESC, m.created_at DESC'
        : `(m.created_at > NOW() - INTERVAL '7 days') DESC, m.featured DESC, m.likes_count DESC, m.created_at DESC`;

      params.push(limit, offset);
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.prompt, m.model, m.category, m.image_url, m.thumb_url, m.likes_count, m.featured, m.created_at,
                (l.id IS NOT NULL) AS liked
         FROM mcp_media m
         LEFT JOIN mcp_media_likes l ON l.media_id = m.id AND l.user_id = $1
         WHERE ${where}
         ORDER BY ${order} LIMIT $2 OFFSET $3`,
        params
      );
      return res.json({ success: true, media: rows });
    } catch (err) {
      logger.error({ err }, 'mcp_media_list_failed');
      return res.status(500).json({ success: false, error: 'Failed to load media' });
    }
  });

  // GET /api/mcp/media/liked — powers Personalization → Images
  router.get('/media/liked', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.prompt, m.model, m.image_url, m.thumb_url, l.created_at AS liked_at
         FROM mcp_media_likes l JOIN mcp_media m ON m.id = l.media_id
         WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
        [auth.userId]
      );
      return res.json({ success: true, media: rows });
    } catch (err) {
      logger.error({ err }, 'mcp_media_liked_failed');
      return res.status(500).json({ success: false, error: 'Failed to load liked images' });
    }
  });

  // GET /api/mcp/media/suggestions — similar style to what the user liked
  router.get('/media/suggestions', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      // Style profile: the models + categories of liked images. Suggest
      // unliked media matching either, most-liked models first.
      const { rows } = await pool.query(
        `WITH liked AS (
           SELECT m.model, m.category FROM mcp_media_likes l JOIN mcp_media m ON m.id=l.media_id WHERE l.user_id=$1
         )
         SELECT m.id, m.title, m.prompt, m.model, m.category, m.image_url, m.thumb_url, m.likes_count,
                ((m.model IN (SELECT model FROM liked))::int + (m.category IN (SELECT category FROM liked))::int) AS score
         FROM mcp_media m
         WHERE m.id NOT IN (SELECT media_id FROM mcp_media_likes WHERE user_id=$1)
           AND (EXISTS (SELECT 1 FROM liked) AND (m.model IN (SELECT model FROM liked) OR m.category IN (SELECT category FROM liked)))
         ORDER BY score DESC, m.likes_count DESC, m.created_at DESC
         LIMIT 40`,
        [auth.userId]
      );
      // Suggestions are strictly similarity-based: no likes yet → nothing to
      // suggest (the UI points the user at Discover instead).
      return res.json({ success: true, media: rows, based_on_likes: rows.length > 0 });
    } catch (err) {
      logger.error({ err }, 'mcp_media_suggestions_failed');
      return res.status(500).json({ success: false, error: 'Failed to load suggestions' });
    }
  });

  // GET /api/mcp/media/:id/image — same-origin image proxy. The "Edit
  // element" editor composites the image onto a <canvas>; remote gallery
  // hosts don't send CORS headers, which would taint the canvas and block
  // saving. Streaming it from our origin avoids that.
  router.get('/media/:id/image', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(`SELECT image_url FROM mcp_media WHERE id=$1`, [req.params.id]);
      const url = rows[0]?.image_url;
      if (!url || !/^https?:\/\//i.test(url)) return res.status(404).json({ success: false, error: 'Not found' });
      // SSRF-guarded: gallery image URLs come from an external MCP server, so
      // treat them as untrusted and block private/metadata targets.
      const upstream = await safeAxios<ArrayBuffer>({ method: 'GET', url, responseType: 'arraybuffer', timeout: 20_000, validateStatus: () => true });
      if (upstream.status >= 400) return res.status(502).json({ success: false, error: 'Image unavailable' });
      res.setHeader('Content-Type', String(upstream.headers['content-type'] || 'image/jpeg'));
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(Buffer.from(upstream.data));
    } catch (err) {
      logger.warn({ err }, 'mcp_media_image_proxy_failed');
      return res.status(502).json({ success: false, error: 'Image unavailable' });
    }
  });

  // POST /api/mcp/media/:id/make-editable — "Edit element": turn the image's
  // baked-in text into editable layers. Two Gemini vision calls:
  //  1. extract every text block (content, position, size, color, style)
  //  2. regenerate the image with the text removed (clean background)
  // Returns the layers + the cleaned image as a data URL (canvas-safe, no
  // extra hosting). Falls back to the original image if cleanup fails.
  router.post('/media/:id/make-editable', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(`SELECT image_url FROM mcp_media WHERE id=$1`, [req.params.id]);
      const url = rows[0]?.image_url;
      if (!url) return res.status(404).json({ success: false, error: 'Not found' });

      if (!(await hasAICredits(auth.userId))) return res.status(402).json({ success: false, error: 'Out of AI credits' });

      const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
        || (await pool.query(`SELECT config FROM platform_configs WHERE platform='google'`).then(r => decryptPlatformConfig(r.rows[0]?.config)?.api_key ?? null).catch(() => null));
      if (!googleKey) return res.status(503).json({ success: false, error: 'Google AI is not configured (needed for text extraction)' });

      const img = await safeAxios<ArrayBuffer>({ method: 'GET', url, responseType: 'arraybuffer', timeout: 20_000, validateStatus: () => true });
      if (img.status >= 400) return res.status(502).json({ success: false, error: 'Image unavailable' });
      const mime = String(img.headers['content-type'] || 'image/jpeg');
      const b64 = Buffer.from(img.data).toString('base64');
      const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';
      const imagePart = { inlineData: { mimeType: mime, data: b64 } };

      // 1. Extract text blocks
      let layers: any[] = [];
      try {
        const extract = await axios.post(
          `${GOOGLE_BASE}/models/gemini-2.0-flash:generateContent`,
          {
            contents: [{ parts: [imagePart, { text: `Detect every piece of visible text in this image. Respond ONLY with a JSON array (no markdown): [{"text": "the exact text", "x_pct": left edge as % of image width (0-100), "y_pct": top edge as % of image height (0-100), "size_pct": font height as % of image WIDTH (typically 2-15), "color": "#rrggbb of the text", "bold": true/false, "style": "sans-serif"|"serif"|"script"|"display"|"monospace"}]. Return [] if there is no text.` }] }],
            generationConfig: { temperature: 0 },
          },
          { headers: { 'x-goog-api-key': googleKey, 'Content-Type': 'application/json' }, timeout: 45_000 }
        );
        const text: string = extract.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? '';
        const jsonStr = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          layers = parsed
            .filter((l: any) => l && typeof l.text === 'string' && l.text.trim())
            .slice(0, 20)
            .map((l: any, i: number) => ({
              id: `x${i}`,
              text: String(l.text).slice(0, 500),
              xPct: Math.min(96, Math.max(0, Number(l.x_pct) || 0)),
              yPct: Math.min(96, Math.max(0, Number(l.y_pct) || 0)),
              sizePct: Math.min(20, Math.max(1.5, Number(l.size_pct) || 5)),
              color: /^#[0-9a-fA-F]{6}$/.test(String(l.color)) ? l.color : '#ffffff',
              bold: Boolean(l.bold),
              fontFamily: ['serif', 'script', 'display', 'monospace'].includes(String(l.style)) ? String(l.style) : 'sans-serif',
            }));
        }
      } catch (err) {
        logger.warn({ err }, 'make_editable_extract_failed');
      }

      // 2. Remove the text from the image (only worth it if there was text)
      let cleanedImage: string | null = null;
      if (layers.length > 0) {
        try {
          const clean = await axios.post(
            `${GOOGLE_BASE}/models/gemini-2.0-flash-exp:generateContent`,
            {
              contents: [{ parts: [imagePart, { text: 'Remove ALL text from this image. Reconstruct the background seamlessly where the text was, keeping everything else identical. Output only the edited image.' }] }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
            },
            { headers: { 'x-goog-api-key': googleKey, 'Content-Type': 'application/json' }, timeout: 90_000 }
          );
          const parts: any[] = clean.data?.candidates?.[0]?.content?.parts ?? [];
          const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
          if (imgPart) cleanedImage = `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
        } catch (err) {
          logger.warn({ err }, 'make_editable_clean_failed');
        }
      }

      await chargeAICredits(auth.userId, cleanedImage ? 5 : 2, 'edit_element_extract', { media_id: req.params.id }).catch(() => undefined);
      return res.json({ success: true, layers, cleaned_image: cleanedImage, text_found: layers.length > 0 });
    } catch (err) {
      logger.error({ err }, 'make_editable_failed');
      return res.status(500).json({ success: false, error: 'Could not analyze the image' });
    }
  });

  // GET /api/mcp/media/:id — detail + more-like-this
  router.get('/media/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows } = await pool.query(
        `SELECT m.*, (l.id IS NOT NULL) AS liked
         FROM mcp_media m LEFT JOIN mcp_media_likes l ON l.media_id=m.id AND l.user_id=$2
         WHERE m.id=$1`,
        [req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      const item = rows[0];
      const { rows: similar } = await pool.query(
        `SELECT id, image_url, thumb_url, model FROM mcp_media
         WHERE id <> $1 AND (model=$2 OR category=$3)
         ORDER BY likes_count DESC, created_at DESC LIMIT 12`,
        [item.id, item.model, item.category]
      );
      return res.json({ success: true, media: { ...item, raw: undefined }, similar });
    } catch (err) {
      logger.error({ err }, 'mcp_media_detail_failed');
      return res.status(500).json({ success: false, error: 'Failed to load media' });
    }
  });

  // POST /api/mcp/media/:id/like — toggle
  router.post('/media/:id/like', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const { rows: existing } = await pool.query(
        `SELECT id FROM mcp_media_likes WHERE user_id=$1 AND media_id=$2`, [auth.userId, req.params.id]
      );
      let liked: boolean;
      if (existing.length) {
        await pool.query(`DELETE FROM mcp_media_likes WHERE id=$1`, [existing[0].id]);
        await pool.query(`UPDATE mcp_media SET likes_count=GREATEST(0, likes_count-1) WHERE id=$1`, [req.params.id]);
        liked = false;
      } else {
        await pool.query(
          `INSERT INTO mcp_media_likes (user_id, media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [auth.userId, req.params.id]
        );
        await pool.query(`UPDATE mcp_media SET likes_count=likes_count+1 WHERE id=$1`, [req.params.id]);
        liked = true;
      }
      invalidateSharedContext(auth.userId); // likes shape the visual style profile
      const { rows } = await pool.query(`SELECT likes_count FROM mcp_media WHERE id=$1`, [req.params.id]);
      return res.json({ success: true, liked, likes_count: rows[0]?.likes_count ?? 0 });
    } catch (err) {
      logger.error({ err }, 'mcp_media_like_failed');
      return res.status(500).json({ success: false, error: 'Failed to update like' });
    }
  });

  return router;
}
