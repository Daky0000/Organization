import express from 'express';
import { FAST_MODEL } from '../ai-helpers.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AIConfig {
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}

interface DakyLearnDeps {
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: AIConfig) => string;
  callAINonStreaming: typeof import('../ai-helpers.ts').callAINonStreaming;
  GEMINI_MODELS: string[];
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
}

export function registerDakyLearnRoutes({
  requireAdmin,
  dbQuery,
  pool,
  getAIConfig,
  resolveActiveKey,
  callAINonStreaming,
  GEMINI_MODELS,
  createNotification,
}: DakyLearnDeps): Router {
  const router = express.Router();

  // GET /api/learn — list all learned items (admin only) with optional filters
  router.get('/learn', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!pool) return res.json({ success: true, items: [] });
      const { search, category, label, from, to } = req.query as Record<string, string>;
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (search) { conditions.push(`(title ILIKE $${idx} OR summary ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
      if (category) { conditions.push(`category = $${idx}`); params.push(category); idx++; }
      if (label) { conditions.push(`$${idx} = ANY(labels)`); params.push(label); idx++; }
      if (from) { conditions.push(`created_at >= $${idx}`); params.push(from); idx++; }
      if (to) { conditions.push(`created_at <= $${idx}`); params.push(to); idx++; }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await dbQuery(
        `SELECT id, title, url, source_type, summary, key_points, saas_application, category, labels, created_at FROM learned_items ${where} ORDER BY created_at DESC`,
        params
      );
      return res.json({ success: true, items: rows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/learn/meta — distinct categories and labels (for filter dropdowns)
  router.get('/learn/meta', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!pool) return res.json({ success: true, categories: [], labels: [] });
      const { rows: catRows } = await dbQuery(`SELECT DISTINCT category FROM learned_items ORDER BY category`, []);
      const { rows: lblRows } = await dbQuery(`SELECT DISTINCT unnest(labels) AS label FROM learned_items ORDER BY label`, []);
      return res.json({
        success: true,
        categories: catRows.map((r: any) => r.category),
        labels: lblRows.map((r: any) => r.label),
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/learn — add a URL, scrape content, extract learnings
  router.post('/learn', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { url, category, labels } = req.body as { url: string; category?: string; labels?: string[] };
      if (!url || !url.startsWith('http')) return res.status(400).json({ success: false, error: 'Valid URL required' });

      const learnCfg = await getAIConfig();
      const apiKey = resolveActiveKey(learnCfg);
      if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });

      const isYouTube = /youtube\.com|youtu\.be/.test(url);
      const source_type = isYouTube ? 'video' : 'article';

      let rawContent = '';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
          signal: ctrl.signal,
          headers: { Accept: 'text/plain', 'X-No-Cache': 'true' },
        });
        clearTimeout(timer);
        rawContent = (await jinaRes.text()).slice(0, 15000);
      } catch (_err) { /* non-fatal */ }

      const LEARN_EXTRACT_PROMPT = `You are an expert marketing analyst. Analyze this content FULLY and return ONLY a valid JSON object — no markdown, no explanation, no extra text.

JSON shape:
{
  "title": "Specific, descriptive title of what this content covers (under 80 chars)",
  "summary": "3-4 sentences summarizing exactly what this content covers. Be specific to THIS content, not generic.",
  "key_points": [
    "Specific insight 1 extracted from this content",
    "Specific insight 2 extracted from this content",
    "Specific insight 3 extracted from this content",
    "Specific insight 4",
    "Specific insight 5",
    "Specific insight 6"
  ],
  "saas_application": "3-4 sentences on HOW SPECIFICALLY the insights from this content apply to marketing a SaaS product. Reference actual tactics, platforms, or strategies mentioned in the content. Be concrete — name what the SaaS should do differently.",
  "category": "one of: Content Strategy | Audience Growth | Platform Algorithms | Brand Voice | Analytics | Engagement | Copywriting | Visual Design | Scheduling | General",
  "labels": ["specific-tag-1", "specific-tag-2", "specific-tag-3"]
}`;

      let extracted: any = {};

      if (isYouTube && learnCfg.provider === 'google') {
        try {
          const videoModel = GEMINI_MODELS.includes(learnCfg.model) ? learnCfg.model : 'gemini-2.0-flash';
          const genAI = new GoogleGenerativeAI(apiKey);
          const gModel = genAI.getGenerativeModel({ model: videoModel });
          const result = await gModel.generateContent([
            { fileData: { fileUri: url, mimeType: 'video/mp4' } },
            { text: `${LEARN_EXTRACT_PROMPT}\n\nAnalyze this YouTube video and return the JSON:` },
          ]);
          const raw = result.response.text();
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
        } catch (err) {
          logger.error('Unhandled error:', err);
        }
      }

      if (!extracted.title) {
        try {
          const learnFastModel = learnCfg.provider === 'google'
            ? (GEMINI_MODELS.includes(learnCfg.model) ? learnCfg.model : 'gemini-2.0-flash')
            : FAST_MODEL;
          const raw = await callAINonStreaming(
            learnCfg.provider,
            apiKey,
            learnFastModel,
            LEARN_EXTRACT_PROMPT,
            `URL: ${url}\n\nContent:\n${rawContent || '(could not fetch content)'}`,
            1500,
          );
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
        } catch (_err) { /* use defaults */ }
      }

      const finalCategory = category || extracted.category || 'General';
      const finalLabels = labels?.length ? labels : (extracted.labels || []);

      const { rows: [item] } = await dbQuery(
        `INSERT INTO learned_items (title, url, source_type, summary, key_points, saas_application, category, labels, raw_content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, title, url, source_type, summary, key_points, saas_application, category, labels, created_at`,
        [
          extracted.title || url,
          url,
          source_type,
          extracted.summary || '',
          extracted.key_points || [],
          extracted.saas_application || '',
          finalCategory,
          finalLabels,
          rawContent.slice(0, 8000),
        ]
      );

      return res.json({ success: true, item });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/learn/:id
  router.delete('/learn/:id', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      await dbQuery(`DELETE FROM learned_items WHERE id = $1`, [req.params.id]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/learn/:id/analyze — deep-analyze an existing item and fill in saas_application
  router.post('/learn/:id/analyze', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { rows } = await dbQuery(
        `SELECT id, title, url, summary, key_points, raw_content FROM learned_items WHERE id = $1`,
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Item not found' });
      const item = rows[0];

      const cfg = await getAIConfig();
      const apiKey = resolveActiveKey(cfg);
      if (!apiKey) return res.status(503).json({ success: false, error: 'AI not configured' });

      const fastModel = cfg.provider === 'google'
        ? (GEMINI_MODELS.includes(cfg.model) ? cfg.model : 'gemini-2.0-flash')
        : FAST_MODEL;

      const isYouTubeItem = /youtube\.com|youtu\.be/.test(item.url || '');

      let freshContent = (item.raw_content || '').slice(0, 12000);
      if (!freshContent || freshContent.length < 500) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20000);
          const jinaRes = await fetch(`https://r.jina.ai/${item.url}`, {
            signal: ctrl.signal,
            headers: { Accept: 'text/plain', 'X-No-Cache': 'true' },
          });
          clearTimeout(timer);
          freshContent = (await jinaRes.text()).slice(0, 12000);
        } catch (_err) { /* use stored content */ }
      }

      const analyzeJsonShape = `{
  "title": "Specific descriptive title (under 80 chars)",
  "summary": "3-4 sentences summarizing exactly what this content covers. Be specific.",
  "key_points": ["Specific insight 1 from this content", "Specific insight 2", "Specific insight 3", "insight 4", "insight 5", "insight 6"],
  "saas_application": "3-4 sentences: HOW SPECIFICALLY do the insights from this content apply to marketing a SaaS? Reference actual tactics or strategies from the content. Name what the SaaS should do."
}`;

      let parsed: any = {};

      if (isYouTubeItem && cfg.provider === 'google') {
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const gModel = genAI.getGenerativeModel({ model: fastModel });
          const result = await gModel.generateContent([
            { fileData: { fileUri: item.url, mimeType: 'video/mp4' } },
            { text: `You are a SaaS marketing analyst. Watch this video fully and return ONLY a valid JSON object — no markdown, no extra text.\n\nJSON shape:\n${analyzeJsonShape}` },
          ]);
          const raw = result.response.text();
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        } catch (_err) { /* fall through to text */ }
      }

      if (!parsed.saas_application) {
        try {
          const raw = await callAINonStreaming(
            cfg.provider, apiKey, fastModel,
            'You are a SaaS marketing analyst. Return only valid JSON — no markdown, no extra text.',
            `Analyze this content and return the JSON:\n\nURL: ${item.url}\nTitle: ${item.title}\n\nContent:\n${freshContent || '(none)'}\n\nJSON shape:\n${analyzeJsonShape}`,
            1200,
          );
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        } catch (_err) { /* fallback */ }
      }

      const newTitle = parsed.title || item.title;
      const newSummary = parsed.summary || item.summary;
      const newKeyPoints = Array.isArray(parsed.key_points) && parsed.key_points.length > 0
        ? parsed.key_points : item.key_points;
      const newSaasApplication = parsed.saas_application || '';
      const newRawContent = freshContent || item.raw_content || '';

      const { rows: [updated] } = await dbQuery(
        `UPDATE learned_items
           SET title = $1, summary = $2, key_points = $3, saas_application = $4, raw_content = $5
         WHERE id = $6
         RETURNING id, title, url, source_type, summary, key_points, saas_application, category, labels, created_at`,
        [newTitle, newSummary, newKeyPoints, newSaasApplication, newRawContent.slice(0, 8000), item.id],
      );

      return res.json({ success: true, item: updated });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/learn/compile — compile all items in a category into an AI skill
  router.post('/learn/compile', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { category } = req.body as { category: string };
      if (!category) return res.status(400).json({ success: false, error: 'Category required' });

      if (!pool) return res.status(503).json({ success: false, error: 'No database' });
      const { rows } = await dbQuery(
        `SELECT title, summary, key_points FROM learned_items WHERE category = $1 ORDER BY created_at ASC`,
        [category]
      );
      if (rows.length === 0) return res.status(400).json({ success: false, error: 'No items in this category' });

      const aiCfgCompile = await getAIConfig();
      const compileKey = resolveActiveKey(aiCfgCompile);
      if (!compileKey) return res.status(503).json({ success: false, error: 'AI not configured' });

      const knowledgeBlob = rows.map((r: any) => {
        const pts = (r.key_points as string[]).map((p: string) => `  - ${p}`).join('\n');
        return `### ${r.title}\n${r.summary}\n${pts}`;
      }).join('\n\n');

      const fastModel = aiCfgCompile.provider === 'google'
        ? (GEMINI_MODELS.includes(aiCfgCompile.model) ? aiCfgCompile.model : 'gemini-2.0-flash')
        : FAST_MODEL;

      const compiledPrompt = await callAINonStreaming(
        aiCfgCompile.provider,
        compileKey,
        fastModel,
        'You are a system prompt engineer. Given a collection of marketing learnings in a category, write a concise, expert skill block that Daky (an AI social media marketing butler) should internalize and apply. Write in directive second-person ("When you..."). Be specific, not generic. Output ONLY the skill prompt text — no JSON, no headers.',
        `Category: ${category}\n\nLearnings:\n${knowledgeBlob}`,
        1500,
      );

      const skillName = `Learned: ${category}`;
      const existing = await dbQuery(`SELECT id FROM ai_skills WHERE name = $1`, [skillName]);
      if (existing.rows.length > 0) {
        await dbQuery(
          `UPDATE ai_skills SET system_prompt = $1, description = $2, updated_at = NOW() WHERE name = $3`,
          [compiledPrompt, `Auto-compiled from ${rows.length} learned item(s) in "${category}"`, skillName]
        );
      } else {
        await dbQuery(
          `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order) VALUES ($1,$2,$3,$4,'all',true,100)`,
          [randomUUID(), skillName, `Auto-compiled from ${rows.length} learned item(s) in "${category}"`, compiledPrompt]
        );
      }

      createNotification(admin.userId, 'skill_compiled',
        'Skill compiled',
        `"${skillName}" was built from ${rows.length} item(s) in "${category}" and is now active.`,
        { category, itemCount: rows.length },
      ).catch(() => undefined);
      return res.json({ success: true, skillName, itemCount: rows.length });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
