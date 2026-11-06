import { calculateContrastRatio } from './deterministicCompositor.ts';
import type {
  BrandAssetRecord,
  BrandProfileRecord,
  BusinessProfileRecord,
  ContentItemRecord,
  CreativeBriefRecord,
  ValidationIssue,
  ValidationReport,
} from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Assurance, Brand, Factual, Industry Risk & Accessibility Gates (Sec 10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redacts secrets, API keys, emails, bearer tokens, and phone numbers from
 * captions, scripts, and demo descriptions (Workflow D & Section 13).
 */
export function maskSecretsAndPii(text: string): { masked: string; redactionsCount: number } {
  let redactions = 0;
  const replaceCounted = (input: string, regex: RegExp, replacement: string) =>
    input.replace(regex, () => {
      redactions += 1;
      return replacement;
    });

  let out = String(text || '');
  // API keys & bearer tokens (sk-..., cf_live_..., dwos_live_..., ghp_..., JWTs)
  out = replaceCounted(out, /\b(sk-[a-zA-Z0-9_-]{12,}|cf_live_[a-zA-Z0-9_-]{8,}|dwos_live_[a-zA-Z0-9_-]{8,}|ghp_[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_SECRET]');
  out = replaceCounted(out, /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]');
  out = replaceCounted(out, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
  // Email addresses
  out = replaceCounted(out, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
  return { masked: out, redactionsCount: redactions };
}


export const PROMPT_INJECTION_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts|commands)\b/i, reason: 'system instruction override' },
  { re: /\byou\s+are\s+now\s+(dan|unfiltered|jailbroken|an\s+ai\s+without\s+rules|an\s+adversary)\b/i, reason: 'roleplay jailbreak' },
  { re: /\b(system\s*prompt|system\s*instructions|developer\s*instructions)\s*[:=]/i, reason: 'prompt extraction or mock system directive' },
  { re: /\b(show|reveal|leak|print|output|dump)\s+(your\s+)?(system\s*prompt|initial\s*prompt|system\s*instructions)\b/i, reason: 'prompt exfiltration attempt' },
  { re: /<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|Human:\s*Assistant:/i, reason: 'raw template delimiter injection' },
];

export function scanForPromptInjection(text: string): { safe: boolean; reason?: string } {
  const str = String(text || '');
  for (const { re, reason } of PROMPT_INJECTION_PATTERNS) {
    if (re.test(str)) {
      return { safe: false, reason };
    }
  }
  return { safe: true };
}

const NUMERICAL_CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b\d+(?:\.\d+)?%\s*(?:increase|growth|faster|more|higher|reduction|roi|conversion|lift|better)/i, label: 'percentage performance claim' },
  { re: /\b(?:10x|5x|3x|2x|\d+x)\s+(?:faster|roi|leads|revenue|growth|output)/i, label: 'multiplier performance claim' },
  { re: /\b(?:rated|rating)\s*[45](?:\.\d)?\s*\/\s*5\b|\b[45]\.\d\s*stars?\b/i, label: 'star rating claim' },
  { re: /\b(?:trusted\s+by|over|serving)\s+\d[\d,+]*\s+(?:customers|clients|companies|teams|users|patients)\b/i, label: 'customer count claim' },
  { re: /["“][^"”]{15,180}["”]\s*[—\-–]\s*[A-Z][a-z]+/, label: 'quoted customer testimonial' },
  { re: /\b(?:#1|number\s+one|award[- ]winning|iso[- ]?\d+|soc\s*2\s*certified|fda[- ]approved|guaranteed\s+(?:results|roi|leads|revenue|reach))\b/i, label: 'superlative, certification, or guarantee claim' },
];

const INDUSTRY_RISK_RULES: Record<string, Array<{ re: RegExp; code: string; message: string; remediation: string }>> = {
  healthcare: [
    {
      re: /\b(cures?|guarantees?\s+recovery|diagnos(?:e|is)|treats?\s+your|100%\s+safe|replace\s+your\s+doctor)\b/i,
      code: 'HEALTHCARE_MEDICAL_PROMISE',
      message: 'Healthcare content contains diagnostic or treatment-guarantee language.',
      remediation: 'Use neutral educational phrasing and include a qualified clinical disclaimer.',
    },
  ],
  finance: [
    {
      re: /\b(guaranteed\s+returns?|risk[- ]free\s+(?:profit|yield|investment)|beat\s+the\s+market|get\s+rich)\b/i,
      code: 'FINANCE_RETURN_GUARANTEE',
      message: 'Financial content contains prohibited return-guarantee or risk-free language.',
      remediation: 'Remove return guarantees and include required risk/suitability disclosures.',
    },
  ],
  legal: [
    {
      re: /\b(guaranteed\s+(?:verdict|settlement|win)|we\s+always\s+win)\b/i,
      code: 'LEGAL_OUTCOME_GUARANTEE',
      message: 'Legal content implies a guaranteed case outcome.',
      remediation: 'State factual practice areas without promising specific legal outcomes.',
    },
  ],
  employment: [
    {
      re: /\b(young\s+energetic\s+natives?\s+only|men\s+only|women\s+only|recent\s+grads?\s+under\s+\d+)\b/i,
      code: 'EMPLOYMENT_DISCRIMINATORY_TARGETING',
      message: 'Employment copy includes potentially discriminatory age/gender/origin phrasing.',
      remediation: 'Describe role skills and qualifications neutrally.',
    },
  ],
  age_restricted: [
    {
      re: /\b(kids|teens|underage|high[- ]school|drink\s+responsibly\s+optional)\b/i,
      code: 'AGE_RESTRICTED_AUDIENCE_VIOLATION',
      message: 'Age-restricted sector content references minors or omits age-gating rules.',
      remediation: 'Target verified adult audiences only and include mandatory age/responsibility disclosures.',
    },
  ],
  children_sensitive: [
    {
      re: /\b(dm\s+us\s+your\s+(?:address|phone|school|photo)|share\s+personal\s+info)\b/i,
      code: 'CHILDREN_PRIVACY_SAFEGUARD',
      message: 'Content directed at sensitive/youth audiences solicits personal information.',
      remediation: 'Remove any call to share personal data or direct messages from minors.',
    },
  ],
};

export function validateAutopilotContentItem(params: {
  item: ContentItemRecord;
  brief: CreativeBriefRecord;
  business: BusinessProfileRecord;
  brand: BrandProfileRecord | null;
  referencedAssets?: BrandAssetRecord[];
  proposedPaletteHexes?: string[];
}): ValidationReport {
  const { item, brief, business, brand } = params;
  const issues: ValidationIssue[] = [];
  const escalationReasons: string[] = [];

  const fullCopy = [
    item.title,
    item.hook,
    item.caption,
    ...item.slides.map((s) => `${s.heading} ${s.body}`),
    ...item.storyboard.map((sc) => `${sc.voiceover} ${sc.caption_text}`),
  ].join('\n');

  
  // 0. Prompt Injection & Adversarial Pattern Scanner
  const injectionCheck = scanForPromptInjection(fullCopy);
  if (!injectionCheck.safe) {
    issues.push({
      gate: 'brand_compliance',
      severity: 'blocker',
      code: 'PROMPT_INJECTION_DETECTED',
      message: `Copy contains prohibited prompt injection or adversarial pattern (${injectionCheck.reason}).`,
      remediation: 'Remove prompt override phrasing and maintain standard brand copy.',
    });
    escalationReasons.push(`Adversarial prompt injection pattern detected: ${injectionCheck.reason}`);
  }

  // ── 1. Brand Compliance Gate (Section 10.1) ─────────────────────────────────
  const approvedHexSet = new Set(
    (brand?.visual?.colors ?? []).map((c) => c.hex.toUpperCase()),
  );
  const retiredTokens = (brand?.visual?.retired_colors ?? []).map((c) => c.toLowerCase());

  const paletteToInspect = [
    ...(params.proposedPaletteHexes ?? []),
    ...(item.deterministic_overlay?.palette_applied
      ? [
          item.deterministic_overlay.palette_applied.background_hex,
          item.deterministic_overlay.palette_applied.accent_hex,
          item.deterministic_overlay.palette_applied.text_hex,
        ].filter(Boolean)
      : []),
  ];

  for (const hexOrColor of paletteToInspect) {
    const normLower = String(hexOrColor).toLowerCase();
    const normUpper = String(hexOrColor).toUpperCase();
    if (retiredTokens.includes(normLower)) {
      issues.push({
        gate: 'brand_compliance',
        severity: 'blocker',
        code: 'RETIRED_BRAND_COLOR',
        message: `Color "${hexOrColor}" is on this brand's retired color list and must not be reintroduced.`,
        remediation: 'Replace with an approved brand palette token.',
      });
    } else if (brief.creative_mode === 'strict_brand' && approvedHexSet.size > 0 && normUpper.startsWith('#') && !approvedHexSet.has(normUpper)) {
      issues.push({
        gate: 'brand_compliance',
        severity: 'blocker',
        code: 'STRICT_MODE_UNAPPROVED_COLOR',
        message: `Strict brand mode forbids unapproved color "${normUpper}".`,
        remediation: `Use one of the approved brand colors (${[...approvedHexSet].slice(0, 5).join(', ')}) or switch creative mode to brand_inspired.`,
      });
    }
  }

  // Also check if copy/prompts reintroduce retired color names or banned terms
  for (const avoidTerm of brand?.voice?.avoid_terms ?? []) {
    if (avoidTerm && fullCopy.toLowerCase().includes(avoidTerm.toLowerCase())) {
      issues.push({
        gate: 'brand_compliance',
        severity: 'blocker',
        code: 'BANNED_VOICE_TERM',
        message: `Copy contains prohibited brand phrase "${avoidTerm}".`,
        remediation: `Remove "${avoidTerm}" and align with brand voice attributes.`,
      });
    }
  }

  // Cross-tenant & unapproved asset checks
  for (const asset of params.referencedAssets ?? []) {
    if (asset.tenant_id !== item.tenant_id) {
      issues.push({
        gate: 'brand_compliance',
        severity: 'blocker',
        code: 'CROSS_TENANT_ASSET_VIOLATION',
        message: `Referenced asset "${asset.name}" does not belong to tenant ${item.tenant_id}.`,
        remediation: 'Remove foreign asset immediately; strict tenant isolation enforced.',
      });
    }
    if (!asset.rights_confirmed || asset.approval_status === 'needs_review') {
      escalationReasons.push(`Uses unverified brand asset "${asset.name}"`);
    }
    if (asset.asset_type === 'founder_footage' && !asset.consented_likeness) {
      issues.push({
        gate: 'brand_compliance',
        severity: 'blocker',
        code: 'UNCONSENTED_LIKENESS',
        message: `Human likeness/founder asset "${asset.name}" lacks confirmed consent.`,
        remediation: 'Confirm likeness consent in Brand Studio before generating or publishing.',
      });
    }
  }

  // Logo policy enforcement
  if (brief.controls.logo_policy === 'never' && item.deterministic_overlay?.logo_layer?.enabled) {
    issues.push({
      gate: 'brand_compliance',
      severity: 'blocker',
      code: 'LOGO_POLICY_NEVER_VIOLATED',
      message: 'Logo layer is enabled despite brief logo_policy="never".',
      remediation: 'Disable the deterministic logo layer for this asset.',
    });
  }
  if (brief.controls.logo_policy === 'always' && brand?.visual?.logos?.length && !item.deterministic_overlay?.logo_layer?.enabled) {
    issues.push({
      gate: 'brand_compliance',
      severity: 'warning',
      code: 'LOGO_POLICY_ALWAYS_MISSING',
      message: 'Brief requires logo_policy="always" but no deterministic logo layer is attached yet.',
      remediation: 'Run the deterministic compositor with an approved logo master.',
    });
  }

  // ── 2. Factual Integrity Gate (Enforced EVEN in `creative_freedom`! Sec 6 & 10.2) ──
  const approvedClaimsCorpus = [
    ...brief.permitted_claims,
    ...(brand?.identity?.approved_claims ?? []),
    ...business.available_proof.filter((p) => p.verified).map((p) => `${p.summary} ${p.metric_or_claim || ''}`),
  ].join(' \n ').toLowerCase();

  for (const { re, label } of NUMERICAL_CLAIM_PATTERNS) {
    const match = fullCopy.match(re);
    if (match) {
      const matchedSnippet = match[0].trim().toLowerCase();
      // Check whether the exact number/phrase exists in verified evidence
      const numbersInClaim = matchedSnippet.match(/\d+(?:\.\d+)?/g) ?? [];
      const isBackedByEvidence =
        approvedClaimsCorpus.includes(matchedSnippet) ||
        (numbersInClaim.length > 0 && numbersInClaim.every((n) => approvedClaimsCorpus.includes(n)));

      if (!isBackedByEvidence) {
        issues.push({
          gate: 'factual_integrity',
          severity: 'blocker',
          code: 'UNSUPPORTED_FACTUAL_CLAIM',
          message: `Detected unsupported ${label} ("${match[0]}") with no matching verified proof in Business/Brand Profile.`,
          remediation: 'Remove the unverified claim/metric/testimonial, or add verified source evidence to Available Proof first.',
        });
        escalationReasons.push(`Unsupported ${label}: "${match[0]}"`);
      }
    }
  }

  // Product demo authenticity check (Section 8.4 & 18)
  if (item.workflow_type === 'product_demo') {
    // Require at least one verified authentic product UI screenshot or video recording
    const hasRealAsset =
      item.media_assets.some((m) => m.provenance === 'real_product_capture' || m.type === 'video' || (m.url && !m.url.includes('placeholder'))) ||
      (params.referencedAssets ?? []).some((a) => a.asset_type === 'product_screenshot' || a.asset_type === 'video_capture') ||
      (brief.reference_asset_ids?.length > 0 && brief.controls.media_source_mode !== 'ai_generated');

    if (!hasRealAsset) {
      issues.push({
        gate: 'factual_integrity',
        severity: 'blocker',
        code: 'PRODUCT_DEMO_REQUIRES_REAL_CAPTURE',
        message: 'Product demo workflow cannot fabricate UI pixels; an authentic product screen capture or verified recording is required.',
        remediation: 'Attach an authentic product screenshot or screen recording in Brand Studio or Creative Queue.',
      });
    }
  }

  // Video synthetic testimonial ban (Section 8.2)
  if (item.workflow_type === 'short_form_video') {
    const hasSyntheticTestimonial = item.storyboard.some(
      (sc) => sc.source_type === 'ai_generated' && /\b(customer\s+testimonial|founder\s+speaking\s+to\s+camera|client\s+review)\b/i.test(sc.visual_description),
    );
    if (hasSyntheticTestimonial) {
      issues.push({
        gate: 'factual_integrity',
        severity: 'blocker',
        code: 'SYNTHETIC_TESTIMONIAL_PROHIBITED',
        message: 'AI-synthesized founder or customer testimonials presented as authentic footage are prohibited.',
        remediation: 'Use real consented customer/founder footage or reframe the scene as an illustrative concept.',
      });
    }
  }

  // ── 3. Industry & Regulatory Risk Gate (Section 10.3) ───────────────────────
  const riskCategory = business.risk_profile?.category || 'standard';
  if (riskCategory !== 'standard') {
    escalationReasons.push(`Regulated/sensitive industry profile (${riskCategory}) requires human review`);
    const rules = INDUSTRY_RISK_RULES[riskCategory] ?? [];
    for (const rule of rules) {
      if (rule.re.test(fullCopy)) {
        issues.push({
          gate: 'industry_risk',
          severity: 'blocker',
          code: rule.code,
          message: rule.message,
          remediation: rule.remediation,
        });
      }
    }
    const reqDisclosures = business.risk_profile?.required_disclosures ?? [];
    for (const disc of reqDisclosures) {
      if (disc && !item.disclosures.includes(disc) && !fullCopy.includes(disc)) {
        issues.push({
          gate: 'industry_risk',
          severity: 'warning',
          code: 'MISSING_REQUIRED_DISCLOSURE',
          message: `Missing configured ${riskCategory} disclosure: "${disc}".`,
          remediation: 'Append the required disclosure to the item disclosures or caption.',
        });
      }
    }
  }

  // ── 4. Accessibility & Platform Format Gate (Section 10.4) ──────────────────
  let contrastRatio: number | undefined;
  if (item.deterministic_overlay?.palette_applied) {
    const { text_hex, background_hex } = item.deterministic_overlay.palette_applied;
    if (text_hex && background_hex) {
      contrastRatio = calculateContrastRatio(text_hex, background_hex);
      if (contrastRatio < 4.5) {
        issues.push({
          gate: 'accessibility',
          severity: 'blocker',
          code: 'LOW_COLOR_CONTRAST',
          message: `Text contrast ratio (${contrastRatio}:1) is below the WCAG AA 4.5:1 minimum.`,
          remediation: 'Adjust foreground text or background surface hex to achieve >= 4.5:1 contrast.',
        });
      }
    }
    const clippedBlock = (item.deterministic_overlay.text_blocks ?? []).find((b: any) => b.clipped);
    if (clippedBlock) {
      issues.push({
        gate: 'accessibility',
        severity: 'warning',
        code: 'TEXT_CLIPPING_RISK',
        message: `Text block "${clippedBlock.role}" exceeds recommended character length and risks clipping.`,
        remediation: 'Shorten the overlay headline/body copy and move detail into the post caption.',
      });
    }
  }

  if ((item.format === 'static_graphic' || item.format === 'carousel') && !item.alt_text.trim()) {
    issues.push({
      gate: 'accessibility',
      severity: 'warning',
      code: 'MISSING_ALT_TEXT',
      message: 'Visual asset is missing accessible alt text.',
      remediation: 'Add concise alt text describing the visual and key text for screen readers.',
    });
  }

  if (item.format === 'carousel' && item.slides.length > 0 && (item.slides.length < 2 || item.slides.length > 10)) {
    issues.push({
      gate: 'platform_format',
      severity: 'blocker',
      code: 'CAROUSEL_SLIDE_COUNT_INVALID',
      message: `Carousel has ${item.slides.length} slide(s); Instagram/LinkedIn carousels require 2–10 slides.`,
      remediation: 'Adjust slide count to between 2 and 10 slides.',
    });
  }

  if ((item.format === 'short_video' || item.format === 'product_demo') && item.storyboard.length > 0) {
    const missingCaptions = item.storyboard.some((sc) => sc.voiceover?.trim() && !sc.caption_text?.trim());
    if (missingCaptions) {
      issues.push({
        gate: 'accessibility',
        severity: 'warning',
        code: 'MISSING_VIDEO_SUBTITLES',
        message: 'One or more spoken video scenes lack synchronized captions/subtitles.',
        remediation: 'Populate caption_text for every spoken storyboard scene.',
      });
    }
  }

  for (const ch of item.target_channels) {
    const variantCaption = item.channel_variants?.[ch]?.caption ?? item.caption;
    if (ch === 'twitter' && variantCaption.length > 280) {
      issues.push({
        gate: 'platform_format',
        severity: 'blocker',
        code: 'TWITTER_CHAR_LIMIT_EXCEEDED',
        message: `X/Twitter variant is ${variantCaption.length} characters (max 280).`,
        remediation: 'Trim X/Twitter variant to 280 characters or fewer.',
      });
    }
    if (ch === 'instagram' && variantCaption.length > 2200) {
      issues.push({
        gate: 'platform_format',
        severity: 'blocker',
        code: 'INSTAGRAM_CHAR_LIMIT_EXCEEDED',
        message: `Instagram caption is ${variantCaption.length} characters (max 2,200).`,
        remediation: 'Trim Instagram caption to 2,200 characters or fewer.',
      });
    }
  }

  const blockerCount = issues.filter((i) => i.severity === 'blocker').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const score = Math.max(0, 100 - blockerCount * 30 - warningCount * 8);

  const requiresHumanReview =
    blockerCount > 0 ||
    escalationReasons.length > 0 ||
    business.capacity.approval_mode === 'mandatory' ||
    Boolean(business.risk_profile?.require_human_review_always) ||
    brand?.approval_status !== 'approved';

  const outcome: 'pass' | 'warning' | 'fail' = blockerCount > 0 ? 'fail' : (warningCount > 0 ? 'warning' : 'pass');

  return {
    passed: blockerCount === 0,
    outcome,
    score,
    requires_human_review: requiresHumanReview,
    escalation_reasons: escalationReasons,
    issues,
    contrast_ratio: contrastRatio,
    checked_at: new Date().toISOString(),
  };
}
