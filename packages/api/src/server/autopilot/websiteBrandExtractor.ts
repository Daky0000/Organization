import { assertSafePublicUrl, safeAxios } from '../../ssrf-guard.ts';
import type { BrandTokenRecord } from './types.ts';

export interface WebsiteFetchFn {
  (url: string, timeoutMs?: number): Promise<{ status: number; body: string; contentType: string }>;
}

export interface ExtractedBrandScanResult {
  website_url: string;
  scanned_at: string;
  pages_scanned: string[];
  robots_respected: boolean;
  inferred_brand_name: string;
  inferred_description: string;
  inferred_offerings: string[];
  candidate_tokens: Array<Omit<BrandTokenRecord, 'id' | 'brand_profile_id' | 'tenant_id' | 'created_at' | 'updated_at'>>;
  warnings: string[];
}

const SUBPAGE_RE = /\b(about|brand|services|products|pricing|solutions)\b/i;

// Strip prompt-injection patterns from untrusted HTML/CSS text (Section 13:
// "Treat fetched website content as untrusted data, never as instructions to the agent.")
export function sanitizeUntrustedWebText(input: string, maxLen = 1200): string {
  return String(input || '')
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi, '[redacted]')
    .replace(/system\s*prompt\s*:/gi, '[redacted]')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed)[^>]*>/gi, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeHex(raw: string): string | null {
  const clean = raw.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(clean)) return clean;
  if (/^#[0-9A-F]{3}$/.test(clean)) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  return null;
}

function isDisallowedByRobots(robotsTxt: string, pathname: string): boolean {
  if (!robotsTxt) return false;
  const lines = robotsTxt.split(/\r?\n/);
  let appliesToUs = false;
  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [directiveRaw, ...rest] = line.split(':');
    const directive = directiveRaw.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (directive === 'user-agent') {
      appliesToUs = val === '*' || /dakyworld|contentflow/i.test(val);
    } else if (appliesToUs && directive === 'disallow' && val) {
      if (val === '/' || pathname.startsWith(val)) return true;
    }
  }
  return false;
}

const defaultSafeFetcher: WebsiteFetchFn = async (url: string, timeoutMs = 10_000) => {
  await assertSafePublicUrl(url);
  const resp = await safeAxios<string>({
    url,
    method: 'GET',
    responseType: 'text',
    timeout: timeoutMs,
    maxRedirects: 2,
    maxContentLength: 2 * 1024 * 1024,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'ContentflowBrandScanner/1.0 (+https://dakyx.com)',
      Accept: 'text/html,text/css,text/plain;q=0.9,*/*;q=0.1',
    },
  });
  return {
    status: resp.status,
    body: typeof resp.data === 'string' ? resp.data : '',
    contentType: String(resp.headers?.['content-type'] || ''),
  };
};

export function extractBrandCandidatesFromHtmlAndCss(
  pageUrl: string,
  html: string,
  cssText = '',
): {
  brandName: string;
  description: string;
  offerings: string[];
  tokens: Array<Omit<BrandTokenRecord, 'id' | 'brand_profile_id' | 'tenant_id' | 'created_at' | 'updated_at'>>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const tokens: Array<Omit<BrandTokenRecord, 'id' | 'brand_profile_id' | 'tenant_id' | 'created_at' | 'updated_at'>> = [];
  const combinedStyles = `${cssText}\n${[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')}`;

  // 1. Metadata & JSON-LD
  let brandName = '';
  let description = '';
  const offerings = new Set<string>();

  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of jsonLdBlocks.slice(0, 6)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (!brandName && typeof item.name === 'string' && /organization|brand|corporation|localbusiness|store/i.test(String(item['@type'] || ''))) {
          brandName = sanitizeUntrustedWebText(item.name, 100);
        }
        if (!description && typeof item.description === 'string') {
          description = sanitizeUntrustedWebText(item.description, 320);
        }
        if (typeof item.logo === 'string' && /^https?:\/\//i.test(item.logo)) {
          tokens.push({
            name: 'Structured Data Logo',
            value: { url: item.logo, variant: 'observed-web-logo' },
            category: 'logo',
            sub_type: 'primary_logo',
            source_url: pageUrl,
            source_type: 'observed',
            confidence: 0.9,
            rights_confirmed: false,
            approval_status: 'candidate',
            version: 1,
            notes: 'Observed in schema.org JSON-LD. Confirm ownership/rights or upload vector/high-res master before publishing.',
            allowed_contexts: ['social_graphic', 'carousel'],
            last_verified_at: null,
          });
        }
        if (/product|service/i.test(String(item['@type'] || '')) && typeof item.name === 'string') {
          offerings.add(sanitizeUntrustedWebText(item.name, 80));
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  if (!brandName) {
    const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    brandName = sanitizeUntrustedWebText(ogSite || (titleTag ? titleTag.split(/[|\-–—]/)[0] : ''), 100);
  }
  if (!description) {
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1];
    description = sanitizeUntrustedWebText(metaDesc || '', 320);
  }

  // 2. CSS Custom Properties & Hex Colors
  const seenColors = new Set<string>();
  const cssVarRegex = /--([a-zA-Z0-9_-]*(?:primary|accent|brand|bg|surface|ink|text|navy|secondary)[a-zA-Z0-9_-]*)\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi;
  for (const m of combinedStyles.matchAll(cssVarRegex)) {
    const varName = m[1];
    const hex = normalizeHex(m[2]);
    if (!hex || seenColors.has(hex)) continue;
    seenColors.add(hex);
    const subType = /accent|brand/i.test(varName)
      ? 'accent'
      : /bg|surface/i.test(varName)
        ? 'background'
        : /ink|text/i.test(varName)
          ? 'text'
          : 'primary';
    tokens.push({
      name: `--${varName}`,
      value: { hex, css_var: `--${varName}` },
      category: 'color',
      sub_type: subType,
      source_url: pageUrl,
      source_type: 'observed',
      confidence: 0.88,
      rights_confirmed: true,
      approval_status: 'candidate',
      version: 1,
      notes: `Extracted from CSS custom property --${varName}. Candidate until customer confirms.`,
      allowed_contexts: ['all'],
      last_verified_at: null,
    });
  }

  // General hex frequency scan for sites without named CSS variables
  const hexCounts = new Map<string, number>();
  for (const m of combinedStyles.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = normalizeHex(m[0]);
    if (!hex || seenColors.has(hex)) continue;
    hexCounts.set(hex, (hexCounts.get(hex) ?? 0) + 1);
  }
  const topHexes = [...hexCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [hex, count] of topHexes) {
    tokens.push({
      name: `Observed Color ${hex}`,
      value: { hex, occurrences: count },
      category: 'color',
      sub_type: hex === '#FFFFFF' || hex === '#000000' ? 'neutral' : 'candidate_palette',
      source_url: pageUrl,
      source_type: 'observed',
      confidence: Math.min(0.8, Number((0.45 + Math.min(count, 10) * 0.03).toFixed(2))),
      rights_confirmed: true,
      approval_status: 'candidate',
      version: 1,
      notes: `Observed ${count} time(s) in page stylesheet. Website practice may differ from official brand guide.`,
      allowed_contexts: ['all'],
      last_verified_at: null,
    });
  }

  // 3. Typography (distinguish website-rendered fonts from licensed/uploaded font files!)
  const seenFonts = new Set<string>();
  const googleFontMatches = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"&']+)/gi)];
  for (const gm of googleFontMatches) {
    const families = decodeURIComponent(gm[1]).split('&family=');
    for (const famRaw of families) {
      const fam = famRaw.split(':')[0].replace(/\+/g, ' ').trim();
      if (!fam || seenFonts.has(fam.toLowerCase())) continue;
      seenFonts.add(fam.toLowerCase());
      tokens.push({
        name: `Web Font: ${fam}`,
        value: { family: fam, provider: 'google_fonts', licensed_file_uploaded: false },
        category: 'typography',
        sub_type: seenFonts.size === 1 ? 'display' : 'body',
        source_url: pageUrl,
        source_type: 'observed',
        confidence: 0.9,
        rights_confirmed: true, // Google Fonts are open-source (OFL), though customer still approves brand usage
        approval_status: 'candidate',
        version: 1,
        notes: 'Google Fonts stylesheet detected on public page. Confirm whether this is your official brand typeface.',
        allowed_contexts: ['all'],
        last_verified_at: null,
      });
    }
  }

  for (const fm of combinedStyles.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const primaryFont = fm[1].split(',')[0].replace(/["']/g, '').trim();
    if (!primaryFont || /^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|ui-sans-serif)$/i.test(primaryFont)) continue;
    if (seenFonts.has(primaryFont.toLowerCase())) continue;
    seenFonts.add(primaryFont.toLowerCase());
    warnings.push(`Detected web-rendered font "${primaryFont}". Confirm commercial font license or upload an authorized font file before embedding.`);
    tokens.push({
      name: `Rendered Font: ${primaryFont}`,
      value: { family: primaryFont, provider: 'web_css', licensed_file_uploaded: false },
      category: 'typography',
      sub_type: 'body',
      source_url: pageUrl,
      source_type: 'observed',
      confidence: 0.72,
      rights_confirmed: false,
      approval_status: 'candidate',
      version: 1,
      notes: 'Website-rendered font detected in CSS. Confirm commercial license rights or upload authorized font asset before use.',
      allowed_contexts: ['preview_only_until_licensed'],
      last_verified_at: null,
    });
    if (seenFonts.size >= 4) break;
  }

  // 4. Logo img / link candidates
  if (!tokens.some((t) => t.category === 'logo')) {
    const logoImgMatch = html.match(/<img[^>]+(?:alt|class|id|src)=["'][^"']*logo[^"']*["'][^>]*>/i)?.[0];
    const srcMatch = logoImgMatch?.match(/src=["']([^"']+)["']/i)?.[1];
    if (srcMatch) {
      try {
        const absLogo = new URL(srcMatch, pageUrl).toString();
        if (/^https?:\/\//i.test(absLogo)) {
          tokens.push({
            name: 'Header Logo Candidate',
            value: { url: absLogo, variant: 'header-img' },
            category: 'logo',
            sub_type: 'primary_logo',
            source_url: pageUrl,
            source_type: 'observed',
            confidence: 0.78,
            rights_confirmed: false,
            approval_status: 'candidate',
            version: 1,
            notes: 'Observed <img> with logo attribute. Confirm ownership and upload clean master lockup.',
            allowed_contexts: ['social_graphic'],
            last_verified_at: null,
          });
        }
      } catch { /* ignore invalid URL */ }
    }
  }

  // 5. Inferred Tone & Voice from visible headings/copy
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => sanitizeUntrustedWebText(m[1].replace(/<[^>]+>/g, ' '), 140))
    .filter(Boolean)
    .slice(0, 6);

  if (headings.length > 0) {
    const joined = headings.join(' ');
    const inferredAttributes: string[] = [];
    if (/\b(automate|api|platform|system|deploy|workflow|data|security|compliance)\b/i.test(joined)) {
      inferredAttributes.push('Technical', 'Direct');
    }
    if (/\b(craft|luxury|bespoke|curated|timeless|artisan)\b/i.test(joined)) {
      inferredAttributes.push('Refined', 'Editorial');
    }
    if (/\b(community|together|impact|care|family|local|welcome)\b/i.test(joined)) {
      inferredAttributes.push('Warm', 'Community-oriented');
    }
    if (inferredAttributes.length === 0) inferredAttributes.push('Clear', 'Professional');

    tokens.push({
      name: 'Inferred Voice & Headline Tone',
      value: { attributes: inferredAttributes, sample_headings: headings.slice(0, 3) },
      category: 'voice',
      sub_type: 'tone_attributes',
      source_url: pageUrl,
      source_type: 'inferred',
      confidence: 0.58,
      rights_confirmed: true,
      approval_status: 'candidate',
      version: 1,
      notes: 'Inferred from public H1-H3 headings. Review and adjust to match your official voice rules.',
      allowed_contexts: ['copywriting'],
      last_verified_at: null,
    });
  }

  return {
    brandName,
    description,
    offerings: [...offerings],
    tokens,
    warnings,
  };
}

export async function scanWebsiteForBrandCandidates(
  rawUrl: string,
  fetcher: WebsiteFetchFn = defaultSafeFetcher,
): Promise<ExtractedBrandScanResult> {
  const normalizedInput = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  // Enforce SSRF blocklist when using default fetcher; custom test fetchers still validate URL syntax & private literal IPs
  const parsedBase = new URL(normalizedInput);
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  if (fetcher === defaultSafeFetcher) {
    await assertSafePublicUrl(normalizedInput);
  } else {
    const host = parsedBase.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('169.254.') || host.startsWith('10.') || host.startsWith('192.168.')) {
      throw new Error('Blocked private or reserved address (SSRF protection)');
    }
  }

  const warnings: string[] = [];
  let robotsTxt = '';
  try {
    const robotsUrl = new URL('/robots.txt', parsedBase.origin).toString();
    const robResp = await fetcher(robotsUrl, 5000);
    if (robResp.status >= 200 && robResp.status < 300) {
      robotsTxt = robResp.body;
    }
  } catch {
    // Missing robots.txt is normal; proceed politely
  }

  if (isDisallowedByRobots(robotsTxt, parsedBase.pathname || '/')) {
    return {
      website_url: normalizedInput,
      scanned_at: new Date().toISOString(),
      pages_scanned: [],
      robots_respected: true,
      inferred_brand_name: '',
      inferred_description: '',
      inferred_offerings: [],
      candidate_tokens: [],
      warnings: ['Scanning blocked because robots.txt disallows automated access to this path. Please import brand tokens and assets manually.'],
    };
  }

  const homeResp = await fetcher(normalizedInput, 10_000);
  if (homeResp.status >= 400 || !homeResp.body) {
    return {
      website_url: normalizedInput,
      scanned_at: new Date().toISOString(),
      pages_scanned: [],
      robots_respected: true,
      inferred_brand_name: '',
      inferred_description: '',
      inferred_offerings: [],
      candidate_tokens: [],
      warnings: [`Website returned HTTP ${homeResp.status || 'empty'}. Manual brand import is available.`],
    };
  }

  const pagesScanned = [normalizedInput];
  let combinedCss = '';

  // Fetch up to 2 linked same-origin stylesheets for accurate CSS token extraction
  const cssLinks = [...homeResp.body.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)]
    .map((m) => {
      try { return new URL(m[1], normalizedInput); } catch { return null; }
    })
    .filter((u): u is URL => Boolean(u && u.origin === parsedBase.origin))
    .slice(0, 2);

  for (const cssUrl of cssLinks) {
    if (isDisallowedByRobots(robotsTxt, cssUrl.pathname)) continue;
    try {
      const cssResp = await fetcher(cssUrl.toString(), 6000);
      if (cssResp.status >= 200 && cssResp.status < 300) {
        combinedCss += `\n${cssResp.body.slice(0, 120_000)}`;
      }
    } catch { /* non-fatal */ }
  }

  const primaryExtract = extractBrandCandidatesFromHtmlAndCss(normalizedInput, homeResp.body, combinedCss);
  warnings.push(...primaryExtract.warnings);
  const allTokens = [...primaryExtract.tokens];
  const allOfferings = new Set<string>(primaryExtract.offerings);

  // Polite scan of at most 1 relevant same-origin informational subpage (e.g. /about or /services)
  const subLinks = [...homeResp.body.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
    .map((m) => {
      try { return new URL(m[1], normalizedInput); } catch { return null; }
    })
    .filter((u): u is URL => Boolean(u && u.origin === parsedBase.origin && u.pathname !== parsedBase.pathname && SUBPAGE_RE.test(u.pathname)))
    .slice(0, 1);

  for (const subUrl of subLinks) {
    if (isDisallowedByRobots(robotsTxt, subUrl.pathname)) continue;
    try {
      const subResp = await fetcher(subUrl.toString(), 7000);
      if (subResp.status >= 200 && subResp.status < 300 && subResp.body) {
        pagesScanned.push(subUrl.toString());
        const subExtract = extractBrandCandidatesFromHtmlAndCss(subUrl.toString(), subResp.body, '');
        subExtract.offerings.forEach((o) => allOfferings.add(o));
      }
    } catch { /* non-fatal */ }
  }

  return {
    website_url: normalizedInput,
    scanned_at: new Date().toISOString(),
    pages_scanned: pagesScanned,
    robots_respected: true,
    inferred_brand_name: primaryExtract.brandName,
    inferred_description: primaryExtract.description,
    inferred_offerings: [...allOfferings].slice(0, 12),
    candidate_tokens: allTokens,
    warnings: [...new Set(warnings)],
  };
}
