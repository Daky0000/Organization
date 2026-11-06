import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';
import { FAST_MODEL } from '../ai-helpers.ts';
import { invalidateSharedContext } from './agentSharedContext.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AIConfig {
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}

interface MemoryAgentDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  hasDatabase: () => boolean;
  triggerAgentCompilation: (userId: string) => Promise<void>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<unknown[]>;
  provisionUserAgents: (userId: string) => Promise<void>;
  AGENT_DEFS: Record<string, { name: string; role: string; icon: string; color: string; memoryKeywords: string[] }>;
  getAIConfig: () => Promise<AIConfig>;
  decryptAIKey: (encryptedKey: string) => string;
}

export function registerMemoryAgentRoutes({
  requireAuth,
  requireAdmin,
  dbQuery,
  hasDatabase,
  triggerAgentCompilation,
  createNotification,
  checkTaskActions,
  provisionUserAgents,
  AGENT_DEFS,
  getAIConfig,
  decryptAIKey,
}: MemoryAgentDeps): Router {
  const router = express.Router();

  async function getApifyToken(): Promise<string | null> {
    try {
      const r = await dbQuery<{ config: Record<string, string> }>(
        `SELECT config FROM platform_configs WHERE platform = 'apify' AND enabled = true LIMIT 1`
      );
      return decryptPlatformConfig((r.rows[0] as any)?.config)?.apiKey ?? null;
    } catch (_err) { return null; }
  }

  // ── User Memory Routes ────────────────────────────────────────────────────────

  // GET /api/memory — all memories for authenticated user
  router.get('/memory', async (req: Request, res: Response) => {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    try {
      const rows = await dbQuery<{ id: string; category: string; title: string; content: string; source: string; sort_order: number; created_at: string }>(
        `SELECT id, category, title, content, source, sort_order, created_at FROM user_memories WHERE user_id = $1 ORDER BY category, sort_order, created_at`,
        [auth.userId]
      );
      return res.json({ success: true, memories: rows.rows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/memory — create a memory field
  router.post('/memory', async (req: Request, res: Response) => {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { category = 'custom', title, content, source = 'manual' } = req.body as Record<string, string>;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ success: false, error: 'title and content are required' });
    try {
      const row = await dbQuery<{ id: string; category: string; title: string; content: string; source: string; created_at: string }>(
        `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, category, title, content, source, created_at`,
        [auth.userId, category.trim(), title.trim(), content.trim(), source]
      );
      triggerAgentCompilation(auth.userId).catch(() => undefined);
      invalidateSharedContext(auth.userId);
      createNotification(auth.userId, 'memory_saved',
        'Memory saved',
        `"${title.trim()}" added to your personalization memory.`,
        { memoryId: row.rows[0]?.id },
      ).catch(() => undefined);
      void checkTaskActions(auth.userId, 'save_memory');
      return res.json({ success: true, memory: row.rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/memory/:id — update a memory field
  router.put('/memory/:id', async (req: Request, res: Response) => {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;
    const { title, content } = req.body as Record<string, string>;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ success: false, error: 'title and content are required' });
    try {
      const row = await dbQuery<{ id: string; category: string; title: string; content: string; source: string; created_at: string }>(
        `UPDATE user_memories SET title=$1, content=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4
         RETURNING id, category, title, content, source, created_at`,
        [title.trim(), content.trim(), id, auth.userId]
      );
      if (!row.rows[0]) return res.status(404).json({ success: false, error: 'Memory not found' });
      triggerAgentCompilation(auth.userId).catch(() => undefined);
      invalidateSharedContext(auth.userId);
      return res.json({ success: true, memory: row.rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/memory/:id — delete a memory field
  router.delete('/memory/:id', async (req: Request, res: Response) => {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { id } = req.params;
    try {
      await dbQuery(`DELETE FROM user_memories WHERE id=$1 AND user_id=$2`, [id, auth.userId]);
      triggerAgentCompilation(auth.userId).catch(() => undefined);
      invalidateSharedContext(auth.userId);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── Agent Routes ──────────────────────────────────────────────────────────────

  // GET /api/agents — list user's agents with compiled skills
  router.get('/agents', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      await provisionUserAgents(auth.userId);
      const { rows: agentRows } = await dbQuery(
        `SELECT ua.agent_key, ua.compiled_skill, ua.last_compiled_at,
                at2.name, at2.role, at2.icon, at2.color, at2.base_prompt, at2.memory_keywords
         FROM user_agents ua
         LEFT JOIN agent_templates at2 ON at2.agent_key = ua.agent_key
         WHERE ua.user_id = $1 ORDER BY ua.created_at`,
        [auth.userId]
      );
      return res.json({ success: true, agents: agentRows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/agents/compile — force recompile all agents for user
  router.post('/agents/compile', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    triggerAgentCompilation(auth.userId).catch(() => undefined);
      invalidateSharedContext(auth.userId);
    return res.json({ success: true, message: 'Compilation started' });
  });

  // GET /api/agent-activity — activity feed for dashboard
  router.get('/agent-activity', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const { rows } = await dbQuery(
        `SELECT id, agent_key, agent_name, activity_type, title, content, is_read, created_at
         FROM agent_activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
        [auth.userId]
      );
      const unread = rows.filter((r: any) => !r.is_read).length;
      return res.json({ success: true, activities: rows, unread });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /api/agent-activity/:id/read — mark as read
  router.patch('/agent-activity/:id/read', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await dbQuery(`UPDATE agent_activity SET is_read=true WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]).catch(() => undefined);
    return res.json({ success: true });
  });

  // DELETE /api/agent-activity/:id — delete activity item
  router.delete('/agent-activity/:id', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    await dbQuery(`DELETE FROM agent_activity WHERE id=$1 AND user_id=$2`, [req.params.id, auth.userId]).catch(() => undefined);
    return res.json({ success: true });
  });

  // GET /api/admin/agent-templates — list all templates (admin only)
  router.get('/admin/agent-templates', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    try {
      const { rows } = await dbQuery(`SELECT * FROM agent_templates ORDER BY agent_key`, []);
      return res.json({ success: true, templates: rows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/admin/agent-templates/:key — update a template's prompt (admin only)
  router.put('/admin/agent-templates/:key', async (req: Request, res: Response) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const { key } = req.params;
    const { base_prompt } = req.body as { base_prompt: string };
    if (!base_prompt?.trim()) return res.status(400).json({ success: false, error: 'base_prompt required' });
    if (!AGENT_DEFS[key]) return res.status(404).json({ success: false, error: 'Unknown agent key' });
    try {
      const { rows } = await dbQuery(
        `UPDATE agent_templates SET base_prompt=$1, updated_at=NOW() WHERE agent_key=$2 RETURNING *`,
        [base_prompt.trim(), key]
      );
      return res.json({ success: true, template: rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/memory/generate — AI-generate memories from wizard input
  router.post('/memory/generate', async (req: Request, res: Response) => {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { brandName, industry, offerings, audience, voiceTones = [], goals = [] } = req.body as Record<string, any>;
    if (!brandName?.trim()) return res.status(400).json({ success: false, error: 'brandName is required' });

    const { encryptedKey } = await getAIConfig();
    const apiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured — add Anthropic API key in Admin → AI Assistant' });

    const prompt = `You are a brand strategist AI. Generate a structured memory profile for a brand based on the following info.

Brand: ${brandName}
Industry: ${industry || 'Not specified'}
Products/Services: ${offerings || 'Not specified'}
Target Audience: ${audience || 'Not specified'}
Brand Voice/Tone: ${Array.isArray(voiceTones) ? voiceTones.join(', ') : voiceTones || 'Not specified'}
Content Goals: ${Array.isArray(goals) ? goals.join(', ') : goals || 'Not specified'}

Output ONLY a valid JSON array of memory objects. Each object must have exactly these keys:
- "category": one of: brand, business, audience, content, social, website, custom
- "title": short descriptive title (max 50 chars)
- "content": detailed, useful content (1-4 sentences)

Generate 20-35 diverse, specific memories covering all categories. No markdown, no explanation — pure JSON array only.`;

    try {
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('AI did not return valid JSON');

      const items = JSON.parse(jsonMatch[0]) as { category: string; title: string; content: string }[];
      const validCategories = new Set(['brand', 'business', 'audience', 'content', 'social', 'website', 'custom']);

      let count = 0;
      for (const item of items) {
        if (!item.title?.trim() || !item.content?.trim()) continue;
        const cat = validCategories.has(item.category) ? item.category : 'custom';
        await dbQuery(
          `INSERT INTO user_memories (user_id, category, title, content, source)
           VALUES ($1,$2,$3,$4,'generated')
           ON CONFLICT DO NOTHING`,
          [auth.userId, cat, item.title.trim().slice(0, 100), item.content.trim().slice(0, 2000)]
        );
        count++;
      }

      return res.json({ success: true, count });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/memory/scrape — trigger Apify actors for provided URLs, extract & store memories
  router.post('/memory/scrape', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ error: 'Database unavailable' });

    const { website, instagram, linkedin, twitter, facebook } = req.body as {
      website?: string; instagram?: string; linkedin?: string; twitter?: string; facebook?: string;
    };

    type ScrapeJob = { url: string; type: string; actorMatches: string[] };
    const jobs: ScrapeJob[] = [
      { url: website ?? '',   type: 'website',   actorMatches: ['website-content-crawler'] },
      { url: instagram ?? '', type: 'instagram', actorMatches: ['instagram-scraper', 'instagram'] },
      { url: linkedin ?? '',  type: 'linkedin',  actorMatches: ['linkedin-profile-scraper', 'linkedin'] },
      { url: twitter ?? '',   type: 'twitter',   actorMatches: ['twitter-scraper', 'x-scraper', 'twitter'] },
      { url: facebook ?? '',  type: 'facebook',  actorMatches: ['facebook-pages-scraper', 'facebook'] },
    ].filter((j): j is ScrapeJob => Boolean(j.url.trim()));

    if (jobs.length === 0) return res.status(400).json({ error: 'Please provide at least one URL to scrape' });

    const apiToken = await getApifyToken();
    if (!apiToken) return res.status(503).json({ error: 'Apify not configured — ask your admin to add the API key in Admin → Integrations → Apify' });

    let savedActors: any[] = [];
    try {
      const r = await dbQuery('SELECT * FROM apify_actors');
      savedActors = r.rows;
    } catch (_err) { /* ignore */ }
    if (savedActors.length === 0) return res.status(503).json({ error: 'No Apify actors set up — ask your admin to add actors in Admin → Integrations → Apify' });

    function buildActorInput(url: string, actorId: string): Record<string, unknown> {
      if (actorId.includes('website-content-crawler')) return { startUrls: [{ url }], maxCrawlPages: 5, maxCrawlDepth: 1 };
      if (actorId.includes('instagram')) return { directUrls: [url], resultsLimit: 10 };
      if (actorId.includes('linkedin')) return { profileUrls: [url] };
      if (actorId.includes('twitter') || actorId.includes('x-scraper')) return { startUrls: [{ url }], maxItems: 20 };
      if (actorId.includes('facebook')) return { startUrls: [{ url }], maxPosts: 10 };
      return { startUrls: [{ url }] };
    }

    const scrapedSections: string[] = [];

    for (const job of jobs) {
      const actor = savedActors.find((a: any) =>
        job.actorMatches.some((m) => a.actor_id.toLowerCase().includes(m)),
      );
      if (!actor) continue;

      try {
        const apifyActorId = (actor.actor_id as string).replace('/', '~');
        const input = buildActorInput(job.url, actor.actor_id as string);
        const runResp = await axios.post(
          `https://api.apify.com/v2/acts/${apifyActorId}/runs`,
          input,
          { headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
            params: { token: apiToken, waitForFinish: 60 },
            timeout: 70000 },
        );
        const run = runResp.data?.data ?? {};
        if (run.defaultDatasetId) {
          const dsResp = await axios.get(
            `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`,
            { headers: { Authorization: `Bearer ${apiToken}` }, params: { token: apiToken, limit: 10, clean: true }, timeout: 30000 },
          );
          const items: unknown[] = Array.isArray(dsResp.data) ? dsResp.data : [];
          if (items.length > 0) {
            const text = items.slice(0, 5).map((item) => JSON.stringify(item).slice(0, 1500)).join('\n---\n');
            scrapedSections.push(`=== ${job.type.toUpperCase()}: ${job.url} ===\n${text}`);
          }
        }
      } catch (e) {
        logger.error(`Apify scrape error for ${job.type}:`, (e as any)?.message);
      }
    }

    if (scrapedSections.length === 0) {
      return res.status(400).json({ error: 'Scraping finished but no data was returned. Check that your Apify actors are configured and the URLs are accessible.' });
    }

    const fullRaw = scrapedSections.join('\n\n').slice(0, 12000);

    await dbQuery(
      `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1,$2,$3,$4,$5)`,
      [auth.userId, 'custom', '🌐 Full Scraped Memory', fullRaw, 'scraped'],
    );
    let memoriesCreated = 1;

    const { encryptedKey } = await getAIConfig();
    const aiKey = (encryptedKey ? decryptAIKey(encryptedKey) : null) || process.env.ANTHROPIC_API_KEY || '';
    if (aiKey) {
      try {
        const client = new Anthropic({ apiKey: aiKey });
        const resp = await client.messages.create({
          model: FAST_MODEL,
          max_tokens: 2500,
          messages: [{
            role: 'user',
            content: `Analyse this scraped brand data and extract structured memory fields as a JSON array.

SCRAPED DATA:
${fullRaw.slice(0, 6000)}

Return ONLY a valid JSON array, no markdown fences:
[
  { "category": "brand", "title": "Brand Name", "content": "..." },
  ...
]

Valid categories: brand, business, audience, content, social, website, custom

Extract 8–15 fields covering: brand name, tagline/description, mission, products/services, target audience, brand voice/tone, social media handles, website purpose, key messages, contact details, unique value proposition, competitors, pricing (if visible). Only include fields that have real data from the scraped content. Skip anything empty or irrelevant.`,
          }],
        });
        const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const fields = JSON.parse(match[0]) as { category?: string; title?: string; content?: string }[];
          for (const f of fields) {
            if (f.title?.trim() && f.content?.trim()) {
              await dbQuery(
                `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
                [auth.userId, f.category ?? 'custom', f.title.trim().slice(0, 200), f.content.trim().slice(0, 2000), 'scraped'],
              );
              memoriesCreated++;
            }
          }
        }
      } catch (e) {
        logger.error('AI memory extraction error:', (e as any)?.message);
      }
    }

    return res.json({ success: true, count: memoriesCreated });
  });

  return router;
}
