import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { invalidateSharedContext } from './agentSharedContext.ts';
import { safeAxios } from '../ssrf-guard.ts';
import { FAST_MODEL, GEMINI_MODELS } from '../ai-helpers.ts';
import { logger } from '../logger.ts';
import { runNicheResearch } from './agentTeam/coordination.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AIConfig {
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
  systemPrompt: string | null;
}

interface OnboardingDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  hasDatabase: () => boolean;
  triggerAgentCompilation: (userId: string) => Promise<void>;
  createNotification: (userId: string, type: string, title: string, message: string, data?: Record<string, any>, pinned?: boolean) => Promise<void>;
  checkTaskActions: (userId: string, actionType: string) => Promise<unknown[]>;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }) => string;
  callAINonStreaming: (
    provider: 'anthropic' | 'google',
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
  ) => Promise<string>;
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 60)).slice(0, max) : [];

// Must mirror the chip lists in packages/web/src/components/OnboardingWizard.tsx —
// suggestions outside these sets can't be rendered as selected chips.
const INDUSTRIES = [
  'E-commerce', 'SaaS & Tech', 'Agency & Services', 'Creator & Media',
  'Local business', 'Education', 'Health & Wellness', 'Nonprofit', 'Other',
];
const TONES = ['Professional', 'Friendly', 'Bold', 'Playful', 'Luxury', 'Technical', 'Inspirational', 'Witty'];

// Domain -> chip label. Matched against actual anchor hrefs (not raw text), so a
// page that merely mentions "Instagram" in a paragraph doesn't false-positive.
const PLATFORM_DOMAIN_MATCHERS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/i, 'Instagram'],
  [/(^|\.)facebook\.com$/i, 'Facebook'],
  [/(^|\.)(twitter\.com|x\.com)$/i, 'X (Twitter)'],
  [/(^|\.)linkedin\.com$/i, 'LinkedIn'],
  [/(^|\.)tiktok\.com$/i, 'TikTok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, 'YouTube'],
  [/(^|\.)pinterest\.[a-z.]+$/i, 'Pinterest'],
];

const SUBPAGE_KEYWORDS = /\b(about[-_]?us?|services?|solutions?|products?|shop|store|pricing|what[-_]?we[-_]?do|offerings?)\b/i;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  return m?.[1] ? htmlToText(m[1]).slice(0, 300) : '';
}

// Parses <script type="application/ld+json"> blocks. Schema.org markup is
// author-supplied, not guessed, so it's the single most reliable source we
// have for the brand name, description, official social profiles (sameAs),
// and a structured product/service catalog.
function extractJsonLd(html: string): Record<string, any>[] {
  const blocks: Record<string, any>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && blocks.length < 8) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
      for (const it of items) if (it && typeof it === 'object') blocks.push(it);
    } catch {
      // malformed JSON-LD is common in the wild — skip it, not fatal
    }
  }
  return blocks;
}

function summarizeJsonLd(blocks: Record<string, any>[]): { name: string; description: string; sameAs: string[]; offerings: string[] } {
  let name = '';
  let description = '';
  const sameAs = new Set<string>();
  const offerings = new Set<string>();
  for (const b of blocks) {
    const type = String(b?.['@type'] || '').toLowerCase();
    if (!name && b?.name && /organization|localbusiness|corporation|store|brand/.test(type)) name = String(b.name).slice(0, 120);
    if (!description && b?.description) description = String(b.description).slice(0, 500);
    const sa = b?.sameAs;
    (Array.isArray(sa) ? sa : sa ? [sa] : []).forEach((u: unknown) => { if (typeof u === 'string') sameAs.add(u); });
    const catalog = b?.hasOfferCatalog?.itemListElement ?? b?.makesOffer;
    (Array.isArray(catalog) ? catalog : catalog ? [catalog] : []).forEach((o: any) => {
      const label = o?.itemOffered?.name ?? o?.name;
      if (typeof label === 'string' && label.trim()) offerings.add(label.trim().slice(0, 80));
    });
    if ((type === 'product' || type === 'service') && b?.name) offerings.add(String(b.name).trim().slice(0, 80));
  }
  return { name, description, sameAs: [...sameAs].slice(0, 10), offerings: [...offerings].slice(0, 12) };
}

// Scans actual <a href> targets (not substring text matches) for known social
// domains, skipping generic share/intent links. Returns label -> profile URL
// so the frontend can show "found on your site" next to a Connect button.
function extractSocialLinks(html: string): Map<string, string> {
  const found = new Map<string, string>();
  const re = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let u: URL;
    try { u = new URL(m[1]); } catch { continue; }
    for (const [domainRe, label] of PLATFORM_DOMAIN_MATCHERS) {
      if (domainRe.test(u.hostname) && !found.has(label) && !/\/(intent|sharer|share|dialog)\b/i.test(u.pathname)) {
        u.hash = '';
        found.set(label, u.toString());
      }
    }
  }
  return found;
}

// Finds same-origin links whose href or anchor text suggests an informational
// page (About/Services/Products/...) worth reading alongside the homepage.
function discoverSubpageLinks(html: string, baseUrl: URL): string[] {
  const links = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.size < 40) {
    const href = m[1];
    const text = htmlToText(m[2]);
    if (!SUBPAGE_KEYWORDS.test(`${href} ${text}`)) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.hostname !== baseUrl.hostname) continue;
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      abs.hash = '';
      links.add(abs.toString());
    } catch {
      // invalid href — ignore
    }
  }
  return [...links].slice(0, 2);
}

async function fetchPageText(url: string, timeout: number): Promise<string> {
  try {
    const resp = await safeAxios<string>({
      url,
      method: 'GET',
      responseType: 'text',
      timeout,
      maxContentLength: 3 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DakyworldBot/1.0; +https://dakyworldhub.com)', Accept: 'text/html' },
    });
    return typeof resp.data === 'string' ? resp.data : '';
  } catch {
    return '';
  }
}

export function registerOnboardingRoutes({
  requireAuth,
  dbQuery,
  hasDatabase,
  triggerAgentCompilation,
  createNotification,
  checkTaskActions,
  getAIConfig,
  resolveActiveKey,
  callAINonStreaming,
}: OnboardingDeps): Router {
  const router = express.Router();

  function pickAiModel(cfg: AIConfig): string {
    return cfg.provider === 'google'
      ? (GEMINI_MODELS.includes(cfg.model) ? cfg.model : 'gemini-2.0-flash')
      : FAST_MODEL;
  }

  // GET /api/onboarding — completion status + saved answers
  router.get('/onboarding', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, completed: true, skipped: false, data: {} });
    try {
      const r = await dbQuery<{ onboarding: Record<string, any> | null }>(
        `SELECT onboarding FROM users WHERE id = $1`,
        [auth.userId]
      );
      const data = r.rows[0]?.onboarding ?? {};
      return res.json({
        success: true,
        completed: Boolean(data.completed_at),
        skipped: Boolean(data.skipped_at),
        data,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding/analyze-website — fetch the homepage (+ up to 2 same-origin
  // About/Services/Products pages), pull schema.org JSON-LD and real <a href> social
  // links, then ask the AI to extract wizard-ready fields. Best-effort throughout —
  // returns whatever could be determined rather than failing outright.
  router.post('/onboarding/analyze-website', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;

    let website = str((req.body as Record<string, unknown>)?.website, 200);
    if (!website) return res.status(400).json({ success: false, error: 'website is required' });
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;

    let baseUrl: URL;
    let homeHtml = '';
    try {
      baseUrl = new URL(website);
      homeHtml = await fetchPageText(website, 12000);
      if (!homeHtml) throw new Error('empty response');
    } catch (e: any) {
      return res.status(400).json({ success: false, error: `Couldn't reach that website (${e?.message ?? 'fetch failed'})` });
    }

    // Read a couple of same-origin informational pages in parallel — much better
    // signal for "what do they actually sell" than the homepage hero copy alone.
    const subpageUrls = discoverSubpageLinks(homeHtml, baseUrl);
    const subpageResults = await Promise.all(subpageUrls.map((u) => fetchPageText(u, 8000)));
    const subpages = subpageUrls
      .map((url, i) => ({ url, html: subpageResults[i] }))
      .filter((p) => p.html.length > 200);

    const allHtml = [homeHtml, ...subpages.map((p) => p.html)].join('\n');
    const jsonLd = summarizeJsonLd(extractJsonLd(allHtml));
    const socialLinks = extractSocialLinks(allHtml);
    const isWordPress = /wp-content\/|wp-includes\//i.test(allHtml);

    const platforms = [...socialLinks.keys()];
    for (const sameAsUrl of jsonLd.sameAs) {
      try {
        const host = new URL(sameAsUrl).hostname;
        for (const [domainRe, label] of PLATFORM_DOMAIN_MATCHERS) {
          if (domainRe.test(host) && !socialLinks.has(label)) { socialLinks.set(label, sameAsUrl); platforms.push(label); }
        }
      } catch { /* ignore malformed sameAs URL */ }
    }
    if (isWordPress) platforms.push('WordPress');

    const title = extractTag(homeHtml, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescription =
      extractTag(homeHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
      extractTag(homeHtml, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const siteName = extractTag(homeHtml, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i);
    const homeText = htmlToText(homeHtml).slice(0, 6000);

    // Heuristic fallbacks in case the AI step is unavailable
    const suggestions = {
      brandName: jsonLd.name || siteName || (title.split(/\s*\|\s*|\s+[—–-]\s+/)[0] ?? '').slice(0, 120),
      industry: '',
      offering: jsonLd.description || metaDescription,
      offerings: jsonLd.offerings,
      audience: '',
      tones: [] as string[],
      platforms: Array.from(new Set(platforms)),
    };
    let summary = '';

    const cfg = await getAIConfig().catch(() => null);
    const apiKey = cfg ? resolveActiveKey(cfg) : '';
    if (apiKey && homeText.length > 50) {
      try {
        const promptSections = [
          `HOMEPAGE (${website}):\nTITLE: ${title || 'n/a'}\nMETA DESCRIPTION: ${metaDescription || 'n/a'}\n${homeText}`,
          ...subpages.map((p) => `SUBPAGE (${p.url}):\n${htmlToText(p.html).slice(0, 2500)}`),
          jsonLd.name || jsonLd.description || jsonLd.offerings.length
            ? `STRUCTURED DATA (schema.org, author-supplied — trust this over guesswork):\nName: ${jsonLd.name || 'n/a'}\nDescription: ${jsonLd.description || 'n/a'}\nListed offerings: ${jsonLd.offerings.join(', ') || 'n/a'}`
            : '',
        ].filter(Boolean).join('\n\n---\n\n');

        const raw = await callAINonStreaming(
          cfg!.provider,
          apiKey,
          pickAiModel(cfg!),
          'You extract precise brand facts for a marketing onboarding form from real website content. Only state what the pages actually say or strongly imply. Return ONLY valid JSON, no markdown fences, no commentary.',
          `${promptSections}\n\n---\n\nReturn ONLY valid JSON with exactly these keys:
{
  "brandName": "official brand/company name, or empty string",
  "industry": "the single closest match from this exact list, or empty string: ${INDUSTRIES.join(', ')}",
  "offering": "1-2 plain sentences describing what they offer, written from the brand's perspective (e.g. 'We sell ...'), or empty string",
  "offerings": ["3-8 short, specific product or service names actually mentioned across the pages above — e.g. 'Espresso subscriptions', not vague categories"],
  "audience": "1-2 plain sentences describing who their target audience appears to be, or empty string",
  "tones": ["up to 3 that match the site's voice, only from this exact list: ${TONES.join(', ')}"],
  "summary": "2-3 sentences on what the website communicates about the brand"
}
Use empty strings/arrays when the pages don't support a confident answer — do not invent information.`,
          900,
        );
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const ai = JSON.parse(match[0]) as Record<string, unknown>;
          const aiBrand = str(ai.brandName, 120);
          const aiIndustry = str(ai.industry, 80);
          const aiOffering = str(ai.offering);
          const aiOfferings = strList(ai.offerings, 8);
          const aiAudience = str(ai.audience);
          if (aiBrand) suggestions.brandName = aiBrand;
          if (INDUSTRIES.includes(aiIndustry)) suggestions.industry = aiIndustry;
          if (aiOffering) suggestions.offering = aiOffering;
          if (aiOfferings.length) suggestions.offerings = aiOfferings;
          if (aiAudience) suggestions.audience = aiAudience;
          suggestions.tones = strList(ai.tones).filter((t) => TONES.includes(t)).slice(0, 3);
          summary = str(ai.summary, 600);
        }
      } catch (e: any) {
        logger.warn(`Onboarding website analysis AI step failed for ${website}: ${e?.message}`);
      }
    }

    // Stash what the site communicates as Website Intelligence memory
    if (hasDatabase() && (summary || suggestions.offerings.length)) {
      try {
        const content = [summary, suggestions.offerings.length ? `Offers: ${suggestions.offerings.join(', ')}.` : '']
          .filter(Boolean).join(' ');
        await dbQuery(`DELETE FROM user_memories WHERE user_id = $1 AND source = 'scraped' AND title = 'Website snapshot'`, [auth.userId]);
        await dbQuery(
          `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1, 'website', 'Website snapshot', $2, 'scraped')`,
          [auth.userId, `${website} — ${content || 'analyzed, no summary available'}`]
        );
      } catch (e: any) {
        logger.warn(`Onboarding website memory save failed: ${e?.message}`);
      }
    }

    return res.json({
      success: true,
      suggestions,
      socialLinks: Object.fromEntries(socialLinks),
      sourceUrl: website,
    });
  });

  // POST /api/onboarding/analyze-account — after the user connects a social account
  // from the wizard (see storeUserConnection/seedSocialMemory in socialConnectRoutes,
  // which already writes a "social" memory entry from the profile), pull the same
  // profile data back and run a small AI pass to suggest tone/audience fields the
  // wizard can merge in live.
  router.post('/onboarding/analyze-account', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const platform = str((req.body as Record<string, unknown>)?.platform, 40).toLowerCase();
    if (!platform) return res.status(400).json({ success: false, error: 'platform is required' });

    try {
      const r = await dbQuery<{ handle: string; account_name: string | null; followers: number; token_data: any }>(
        `SELECT handle, account_name, followers, token_data FROM social_accounts
         WHERE user_id = $1 AND platform = $2 AND account_type = 'profile' AND connected = true
         ORDER BY connected_at DESC LIMIT 1`,
        [auth.userId, platform]
      );
      const acct = r.rows[0];
      if (!acct) return res.status(404).json({ success: false, error: 'That account is not connected yet' });

      const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
      const bio = str(acct.token_data?.bio, 500);
      const followers = Number(acct.followers || acct.token_data?.followers_count || 0);
      const suggestions = { tones: [] as string[], audience: '' };

      const cfg = await getAIConfig().catch(() => null);
      const apiKey = cfg ? resolveActiveKey(cfg) : '';
      if (apiKey && bio) {
        try {
          const raw = await callAINonStreaming(
            cfg!.provider,
            apiKey,
            pickAiModel(cfg!),
            'You extract structured brand signal from a social bio for a marketing onboarding form. Return ONLY compact JSON, no markdown fences.',
            `Platform: ${platformLabel}\nHandle: @${acct.handle}\nDisplay name: ${acct.account_name || ''}\nFollowers: ${followers}\nBio: "${bio}"\n\nReturn JSON: {"tones": ["up to 3, only from this exact list: ${TONES.join(', ')}"], "audience": "1 sentence guess at their target audience based on the bio, or empty string"}`,
            300,
          );
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            suggestions.tones = strList(parsed.tones).filter((t) => TONES.includes(t)).slice(0, 3);
            suggestions.audience = str(parsed.audience, 300);
          }
        } catch (e: any) {
          logger.warn(`Onboarding account analysis AI step failed for ${platform}: ${e?.message}`);
        }
      }

      return res.json({
        success: true,
        platform,
        platformLabel,
        handle: acct.handle,
        followers,
        bio: bio || null,
        suggestions,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding — save answers, seed the AI memory, recompile agents
  router.post('/onboarding', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, memoriesCreated: 0 });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const brandName = str(body.brandName, 120);
    const website = str(body.website, 200);
    const industry = str(body.industry, 80);
    const offering = str(body.offering);
    const offerings = strList(body.offerings, 10);
    const audience = str(body.audience);
    const tones = strList(body.tones);
    const goals = strList(body.goals);
    const platforms = strList(body.platforms);

    // Each answered question becomes a memory entry the agents compile into context.
    const entries: { category: string; title: string; content: string }[] = [];
    if (brandName) entries.push({ category: 'brand', title: 'Brand name', content: website ? `${brandName} (${website})` : brandName });
    if (industry || offering) entries.push({ category: 'business', title: 'What we do', content: [industry, offering].filter(Boolean).join(' — ') });
    if (offerings.length) entries.push({ category: 'business', title: 'Products & services', content: offerings.join(', ') });
    if (audience) entries.push({ category: 'audience', title: 'Target audience', content: audience });
    if (tones.length) entries.push({ category: 'brand', title: 'Tone of voice', content: tones.join(', ') });
    if (goals.length) entries.push({ category: 'content', title: 'Marketing goals', content: goals.join(', ') });
    if (platforms.length) entries.push({ category: 'social', title: 'Priority platforms', content: platforms.join(', ') });

    try {
      const answers = {
        brandName, website, industry, offering, offerings, audience, tones, goals, platforms,
        completed_at: new Date().toISOString(),
      };
      await dbQuery(`UPDATE users SET onboarding = $2::jsonb WHERE id = $1`, [auth.userId, JSON.stringify(answers)]);
      if (website) {
        await dbQuery(`UPDATE users SET website = COALESCE(NULLIF(website, ''), $2) WHERE id = $1`, [auth.userId, website]).catch(() => undefined);
      }

      // Synchronize brand_profiles immediately so agent team & director have verified niche & facts
      const niche = industry || offering || 'General';
      await dbQuery(
        `INSERT INTO brand_profiles (user_id, brand_name, niche, tone, audience, goals, platforms, website, setup_done, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           brand_name = COALESCE(NULLIF(EXCLUDED.brand_name, ''), brand_profiles.brand_name),
           niche = COALESCE(NULLIF(EXCLUDED.niche, ''), brand_profiles.niche),
           tone = COALESCE(NULLIF(EXCLUDED.tone, ''), brand_profiles.tone),
           audience = COALESCE(NULLIF(EXCLUDED.audience, ''), brand_profiles.audience),
           goals = CASE WHEN array_length(EXCLUDED.goals, 1) > 0 THEN EXCLUDED.goals ELSE brand_profiles.goals END,
           platforms = CASE WHEN array_length(EXCLUDED.platforms, 1) > 0 THEN EXCLUDED.platforms ELSE brand_profiles.platforms END,
           website = COALESCE(NULLIF(EXCLUDED.website, ''), brand_profiles.website),
           setup_done = true,
           updated_at = NOW()`,
        [auth.userId, brandName, niche, tones[0] || 'Professional', audience, goals, platforms, website]
      ).catch((err) => logger.warn({ err, userId: auth.userId }, 'brand_profile_onboarding_sync_failed'));

      if (entries.length) {
        // Re-running onboarding replaces the entries it owns instead of duplicating them.
        await dbQuery(
          `DELETE FROM user_memories WHERE user_id = $1 AND source = 'manual' AND title = ANY($2)`,
          [auth.userId, entries.map((e) => e.title)]
        );
        for (const e of entries) {
          await dbQuery(
            `INSERT INTO user_memories (user_id, category, title, content, source) VALUES ($1, $2, $3, $4, 'manual')`,
            [auth.userId, e.category, e.title, e.content]
          );
        }
        triggerAgentCompilation(auth.userId).catch(() => undefined);
        invalidateSharedContext(auth.userId);
        void checkTaskActions(auth.userId, 'save_memory');

        // Automatically trigger Omnichannel Niche & Competitor Research in the background
        runNicheResearch(auth.userId).catch((err) =>
          logger.warn({ err, userId: auth.userId }, 'post_onboarding_niche_research_failed')
        );

        createNotification(
          auth.userId, 'onboarding_complete',
          'Your AI team is briefed & researching your niche',
          `${entries.length} brand ${entries.length === 1 ? 'fact' : 'facts'} saved to memory. We're actively analyzing top accounts in your niche across your connected channels to prepare your starter content.`,
        ).catch(() => undefined);
      }

      return res.json({ success: true, memoriesCreated: entries.length });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/onboarding/skip — remember the dismissal across devices
  router.post('/onboarding/skip', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true });
    try {
      await dbQuery(
        `UPDATE users SET onboarding = COALESCE(onboarding, '{}'::jsonb) || jsonb_build_object('skipped_at', NOW()) WHERE id = $1`,
        [auth.userId]
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
