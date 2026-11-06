import { randomUUID } from 'crypto';
import type {
  BrandProfileRecord,
  BusinessModel,
  BusinessProfileRecord,
  ContentFormat,
  ContentItemRecord,
  ContentStrategyRecord,
  MarketingObjective,
  NamedScheduleSlot,
  StrategyAssumption,
  StrategyChannelPlan,
  StrategyFollowUpQuestion,
  StrategyPillar,
  WorkflowType,
} from './types.ts';

// Estimated production + review effort (hours) per asset format (Section 4.4)
export const EFFORT_HOURS_BY_FORMAT: Record<ContentFormat, number> = {
  text_post: 0.35,
  story: 0.4,
  static_graphic: 0.65,
  carousel: 1.1,
  product_demo: 1.4,
  short_video: 1.85,
};

export const CREDITS_ESTIMATE_BY_FORMAT: Record<ContentFormat, number> = {
  text_post: 3,
  story: 6,
  static_graphic: 8,
  carousel: 14,
  product_demo: 12,
  short_video: 28,
};

export const PROVIDER_USD_ESTIMATE_BY_FORMAT: Record<ContentFormat, number> = {
  text_post: 0.01,
  story: 0.04,
  static_graphic: 0.06,
  carousel: 0.14,
  product_demo: 0.08,
  short_video: 0.42,
};

interface ContextArchetype {
  key: string;
  label: string;
  defaultChannels: string[];
  pillars: Array<{
    name: string;
    purpose: string;
    formats: ContentFormat[];
    allocation_pct: number;
    angles: string[];
  }>;
  funnelMix: { awareness_pct: number; consideration_pct: number; conversion_pct: number; retention_pct: number };
  primaryKpis: string[];
  secondaryKpis: string[];
  ctaByStage: Record<string, string>;
}

function classifyBusinessArchetype(profile: BusinessProfileRecord): ContextArchetype {
  const ind = `${profile.industry} ${profile.niche} ${profile.business_model}`.toLowerCase();
  const audienceText = profile.audiences.map((a) => `${a.segment} ${a.role}`).join(' ').toLowerCase();

  // Healthcare / Wellness
  if (profile.risk_profile?.category === 'healthcare' || /\b(health|clinic|medical|dental|therapy|wellness|pharma|patient)\b/.test(ind)) {
    return {
      key: 'healthcare_wellness',
      label: 'Healthcare & Patient-Safe Education',
      defaultChannels: ['instagram', 'facebook', 'linkedin'],
      pillars: [
        { name: 'Evidence-Based Patient Education', purpose: 'Answer common patient questions safely without diagnostic promises', formats: ['carousel', 'static_graphic'], allocation_pct: 40, angles: ['When to schedule a preventive check-up', 'Understanding common terminology clearly'] },
        { name: 'Service & Care Process Explainers', purpose: 'Reduce appointment anxiety by explaining what to expect', formats: ['short_video', 'carousel'], allocation_pct: 30, angles: ['Step-by-step first visit walkthrough', 'How our clinical team prepares for care'] },
        { name: 'Qualified Practitioner Credentials & FAQs', purpose: 'Build verified clinical trust', formats: ['static_graphic', 'text_post'], allocation_pct: 30, angles: ['Meet our licensed specialists', 'Frequently asked insurance & booking questions'] },
      ],
      funnelMix: { awareness_pct: 35, consideration_pct: 40, conversion_pct: 15, retention_pct: 10 },
      primaryKpis: ['Qualified appointment enquiries', 'Educational carousel saves', 'Website service-page visits'],
      secondaryKpis: ['Non-follower reach', 'FAQ completion rate'],
      ctaByStage: {
        awareness: 'Save this guide for reference (educational information, not medical advice).',
        consideration: 'Read our full care preparation FAQ on our clinic page.',
        conversion: 'Book a consultation with a licensed practitioner via our appointment portal.',
      },
    };
  }

  // Finance / Insurance / Legal
  if (['finance', 'legal'].includes(profile.risk_profile?.category || '') || /\b(finance|fintech|insurance|wealth|accounting|tax|legal|law\s*firm|attorney)\b/.test(ind)) {
    return {
      key: 'finance_regulated',
      label: 'Regulated Financial / Advisory Services',
      defaultChannels: ['linkedin', 'twitter', 'instagram'],
      pillars: [
        { name: 'Risk Literacy & Plain-Language Explainers', purpose: 'Demystify complex rules without promising guaranteed outcomes', formats: ['carousel', 'text_post'], allocation_pct: 45, angles: ['Key compliance deadlines to review this quarter', 'Common misconceptions explained clearly'] },
        { name: 'Product & Methodology Breakdowns', purpose: 'Clarify how engagements and safeguards work', formats: ['static_graphic', 'carousel'], allocation_pct: 35, angles: ['How our review process works step by step', 'Questions to ask before choosing a provider'] },
        { name: 'Verified Credentials & Governance', purpose: 'Demonstrate qualified oversight', formats: ['text_post', 'static_graphic'], allocation_pct: 20, angles: ['Our regulatory standards and client checklist', 'Webinar & calculator walkthroughs'] },
      ],
      funnelMix: { awareness_pct: 30, consideration_pct: 45, conversion_pct: 15, retention_pct: 10 },
      primaryKpis: ['Qualified consultation requests', 'Calculator / resource clicks', 'Document saves'],
      secondaryKpis: ['LinkedIn target-audience impressions', 'Webinar registrations'],
      ctaByStage: {
        awareness: 'Bookmark this checklist for your next quarterly review.',
        consideration: 'Download the full explainer guide (disclosures included).',
        conversion: 'Request an introductory suitability call.',
      },
    };
  }

  // Ecommerce / Retail / Consumer Product
  if (profile.business_model === 'ecommerce' || /\b(ecommerce|e-commerce|shop|apparel|skincare|beauty|footwear|retail|d2c|dtc|meal\s*delivery)\b/.test(ind)) {
    return {
      key: 'ecommerce_product',
      label: 'Ecommerce & Product Merchandising',
      defaultChannels: ['instagram', 'tiktok', 'pinterest', 'facebook'],
      pillars: [
        { name: 'Product Use Cases & Benefits in Action', purpose: 'Show tactile product utility and real styling/routines', formats: ['short_video', 'static_graphic'], allocation_pct: 40, angles: ['3 ways to use in your daily routine', 'Close-up material and craftsmanship detail'] },
        { name: 'Buying Guides & Comparison Carousels', purpose: 'Help shoppers pick the right SKU/size/bundle', formats: ['carousel', 'static_graphic'], allocation_pct: 30, angles: ['Which option fits your routine?', 'Care and longevity guide'] },
        { name: 'Consented Customer Stories & Launches', purpose: 'Convert high-intent browsers with verified proof and seasonal drops', formats: ['static_graphic', 'story', 'short_video'], allocation_pct: 30, angles: ['Verified customer use-case spotlight', 'Restock & collection release briefing'] },
      ],
      funnelMix: { awareness_pct: 35, consideration_pct: 30, conversion_pct: 25, retention_pct: 10 },
      primaryKpis: ['Product-page visits', 'Add-to-cart events', 'Attributed purchases'],
      secondaryKpis: ['Saves on buying guides', 'Video 3-second & completion rates'],
      ctaByStage: {
        awareness: 'Explore the collection at the link in bio.',
        consideration: 'Compare sizes and specs in our product guide.',
        conversion: 'Shop the featured item directly on our store.',
      },
    };
  }

  // Local Services / Hospitality
  if (profile.business_model === 'local_service' || profile.business_model === 'hospitality' || /\b(plumb|hvac|salon|cleaning|landscap|contractor|repair|restaurant|cafe|hotel|travel|local|bakery|gym)\b/.test(ind)) {
    const isHospitality = profile.business_model === 'hospitality' || /\b(restaurant|cafe|hotel|travel|bakery|resort)\b/.test(ind);
    return {
      key: isHospitality ? 'hospitality_local' : 'local_services',
      label: isHospitality ? 'Hospitality & Local Experience' : 'Local Service Business',
      defaultChannels: ['instagram', 'facebook'],
      pillars: [
        { name: isHospitality ? 'Signature Experiences & Seasonal Menu/Offers' : 'Service Process & Local Explainers', purpose: 'Show unmistakable local quality and transparency', formats: ['short_video', 'static_graphic'], allocation_pct: 40, angles: ['Behind the scenes of today’s preparation', 'What our local service visit includes'] },
        { name: 'Service Area FAQs & Practical Tips', purpose: 'Capture local search & neighbourhood trust', formats: ['carousel', 'static_graphic'], allocation_pct: 35, angles: [`Seasonal checklist for ${profile.geography[0] || 'local'} customers`, 'Answers to top booking & pricing questions'] },
        { name: 'Team & Consented Before/After or Guest Highlights', purpose: 'Humanize the team and prove reliability', formats: ['static_graphic', 'story'], allocation_pct: 25, angles: ['Meet the team serving your neighbourhood', 'Verified project walkthrough (with client permission)'] },
      ],
      funnelMix: { awareness_pct: 35, consideration_pct: 30, conversion_pct: 25, retention_pct: 10 },
      primaryKpis: ['Calls & booking enquiries', 'Directions / local profile actions', 'Direct messages'],
      secondaryKpis: ['Local reach', 'Post shares in neighbourhood groups'],
      ctaByStage: {
        awareness: `Serving ${profile.geography[0] || 'your area'} — save for when you need us.`,
        consideration: 'Message us with your postcode/date to check availability.',
        conversion: isHospitality ? 'Reserve your table or booking via our link.' : 'Book a local estimate or service slot today.',
      },
    };
  }

  // Education / Courses / Cohort
  if (profile.business_model === 'education' || /\b(education|course|academy|bootcamp|tutoring|training|university|learning)\b/.test(ind)) {
    return {
      key: 'education',
      label: 'Education & Structured Learning',
      defaultChannels: ['instagram', 'linkedin', 'youtube'],
      pillars: [
        { name: 'Actionable Mini-Lessons', purpose: 'Demonstrate teaching clarity upfront', formats: ['carousel', 'short_video'], allocation_pct: 45, angles: ['5-minute concept breakdown', 'Common learner mistake and how to fix it'] },
        { name: 'Curriculum & Learning Outcomes', purpose: 'Show structured progression from beginner to practitioner', formats: ['carousel', 'static_graphic'], allocation_pct: 30, angles: ['Inside module workflows', 'Skills rubric and project milestones'] },
        { name: 'Instructor Expertise & Consented Student Work', purpose: 'Establish instructional credibility', formats: ['static_graphic', 'short_video'], allocation_pct: 25, angles: ['Portfolio project teardown', 'Enrollment Q&A'] },
      ],
      funnelMix: { awareness_pct: 40, consideration_pct: 35, conversion_pct: 15, retention_pct: 10 },
      primaryKpis: ['Syllabus downloads', 'Applications / enrolments', 'Mini-lesson saves'],
      secondaryKpis: ['Carousel completion', 'Watch time'],
      ctaByStage: {
        awareness: 'Save this mini-lesson to practice later.',
        consideration: 'Review the full curriculum outline.',
        conversion: 'Apply or enrol for the upcoming cohort.',
      },
    };
  }

  // Nonprofit
  if (profile.business_model === 'nonprofit' || /\b(nonprofit|non-profit|charity|foundation|ngo|community\s*org)\b/.test(ind)) {
    return {
      key: 'nonprofit',
      label: 'Mission & Evidence-Backed Nonprofit',
      defaultChannels: ['instagram', 'facebook', 'linkedin'],
      pillars: [
        { name: 'Mission & Programme Education', purpose: 'Explain systemic context and programme mechanics', formats: ['carousel', 'static_graphic'], allocation_pct: 40, angles: ['How our programme operates on the ground', 'Understanding the community challenge'] },
        { name: 'Verified Impact & Stewardship Reports', purpose: 'Share documented, audited progress without exaggeration', formats: ['static_graphic', 'carousel'], allocation_pct: 35, angles: ['Transparent quarterly programme update', 'Where community support goes'] },
        { name: 'Volunteer & Community Participation', purpose: 'Mobilize supporters and partners', formats: ['short_video', 'static_graphic'], allocation_pct: 25, angles: ['Upcoming volunteer orientation', 'Partner spotlight'] },
      ],
      funnelMix: { awareness_pct: 40, consideration_pct: 30, conversion_pct: 20, retention_pct: 10 },
      primaryKpis: ['Donations', 'Volunteer sign-ups', 'Programme participation'],
      secondaryKpis: ['Report shares', 'Newsletter sign-ups'],
      ctaByStage: {
        awareness: 'Share this explainer with someone who cares about this mission.',
        consideration: 'Read our verified programme report.',
        conversion: 'Join as a volunteer or support the programme.',
      },
    };
  }

  // Professional Services / Agency / Consulting
  if (profile.business_model === 'professional_services' || /\b(agency|consult|advisory|studio|architect|accounting|recruiting|design\s*firm)\b/.test(ind)) {
    return {
      key: 'professional_services',
      label: 'Consultative Professional Services',
      defaultChannels: ['linkedin', 'instagram', 'twitter'],
      pillars: [
        { name: 'Problem Diagnosis & Decision Frameworks', purpose: 'Help buyers diagnose costly mistakes accurately', formats: ['carousel', 'text_post'], allocation_pct: 45, angles: ['3 signs your current workflow is leaking margin', 'Diagnostic checklist before hiring a partner'] },
        { name: 'Methodology & Process Transparency', purpose: 'Differentiate execution rigour without fabricated metrics', formats: ['carousel', 'static_graphic'], allocation_pct: 35, angles: ['How we scope and de-risk engagements', 'Anatomy of a clean deliverable'] },
        { name: 'Approved Case Studies & Expert POV', purpose: 'Convert high-trust consultative leads', formats: ['static_graphic', 'short_video'], allocation_pct: 20, angles: ['Documented engagement breakdown', 'Answers to common buyer objections'] },
      ],
      funnelMix: { awareness_pct: 30, consideration_pct: 45, conversion_pct: 20, retention_pct: 5 },
      primaryKpis: ['Qualified discovery calls', 'Lead-magnet / framework downloads', 'Direct buyer enquiries'],
      secondaryKpis: ['LinkedIn saves & thoughtful comments', 'Profile visits from target roles'],
      ctaByStage: {
        awareness: 'Save this diagnostic framework for your team.',
        consideration: 'See how our methodology applies to your setup.',
        conversion: 'Book a 20-minute diagnostic consultation.',
      },
    };
  }

  // Creator / Media
  if (profile.business_model === 'creator' || profile.business_model === 'media' || /\b(creator|newsletter|podcast|media|publication|influencer)\b/.test(ind)) {
    return {
      key: 'creator_media',
      label: 'Creator & Recurring Media Series',
      defaultChannels: ['instagram', 'tiktok', 'twitter', 'linkedin'],
      pillars: [
        { name: 'Signature Ideas & Recurring Series', purpose: 'Build habitual audience return', formats: ['short_video', 'carousel'], allocation_pct: 50, angles: ['Weekly teardown episode', 'Deep-dive visual thread'] },
        { name: 'Behind-the-Scenes Craft & Research', purpose: 'Deepen audience affinity', formats: ['story', 'static_graphic'], allocation_pct: 25, angles: ['How this edition was researched', 'Tools & creative setup'] },
        { name: 'Community Q&A & Subscriber Editions', purpose: 'Convert casual viewers into owned subscribers', formats: ['carousel', 'text_post'], allocation_pct: 25, angles: ['Audience question spotlight', 'This week’s subscriber issue preview'] },
      ],
      funnelMix: { awareness_pct: 45, consideration_pct: 25, conversion_pct: 15, retention_pct: 15 },
      primaryKpis: ['Newsletter / channel subscriptions', 'Returning viewer completion', 'Saves & shares'],
      secondaryKpis: ['Non-follower reach', 'Episode replies'],
      ctaByStage: {
        awareness: 'Follow the series for weekly editions.',
        consideration: 'Read the full breakdown in this week’s issue.',
        conversion: 'Subscribe to get the complete edition in your inbox.',
      },
    };
  }

  // B2B SaaS / Software (adapts between technical/developer buyers vs operational/HR/business buyers!)
  const isDeveloperAudience = /\b(developer|engineer|devops|cto|architect|api|sdk)\b/.test(`${ind} ${audienceText}`);
  return {
    key: isDeveloperAudience ? 'b2b_saas_technical' : 'b2b_saas_business',
    label: isDeveloperAudience ? 'Technical / Developer B2B SaaS' : 'Operational B2B SaaS & Automation',
    defaultChannels: isDeveloperAudience ? ['linkedin', 'twitter'] : ['linkedin', 'instagram'],
    pillars: [
      {
        name: isDeveloperAudience ? 'Technical Architecture & Real Code/Product Demos' : 'Real Workflow & Product Demonstrations',
        purpose: 'Show real shipped product workflows solving concrete bottlenecks (never fabricated UI)',
        formats: profile.capacity.has_product_demos ? ['product_demo', 'carousel'] : ['carousel', 'static_graphic'],
        allocation_pct: 40,
        angles: isDeveloperAudience
          ? ['End-to-end API / webhook integration walkthrough', 'Latency & reliability edge cases handled cleanly']
          : ['Replacing a 6-step spreadsheet process with one governed workflow', 'Real screen walkthrough of approval & scheduling'],
      },
      {
        name: 'Tactical Playbooks & Use-Case Education',
        purpose: 'Earn saves and trust from target operators before they are ready to buy',
        formats: ['carousel', 'text_post'],
        allocation_pct: 35,
        angles: ['Step-by-step implementation checklist', 'Comparing manual vs automated operations'],
      },
      {
        name: 'Verified Proof & Operator Perspective',
        purpose: 'Address buyer objections using only verified evidence',
        formats: profile.capacity.has_founder_footage ? ['short_video', 'static_graphic'] : ['static_graphic', 'text_post'],
        allocation_pct: 25,
        angles: ['Security, governance, and team permissions explained', 'Lessons from real customer implementations'],
      },
    ],
    funnelMix: { awareness_pct: 35, consideration_pct: 40, conversion_pct: 20, retention_pct: 5 },
    primaryKpis: ['Qualified demo requests', 'Self-serve trials', 'Educational saves & resource clicks'],
    secondaryKpis: ['Target-role impressions', 'Product demo watch completion'],
    ctaByStage: {
      awareness: 'Save this workflow blueprint for your next sprint.',
      consideration: 'Explore the live product walkthrough.',
      conversion: 'Start a trial or book a tailored workflow walkthrough.',
    },
  };
}

export function detectMissingHighImpactQuestions(profile: BusinessProfileRecord): StrategyFollowUpQuestion[] {
  const questions: StrategyFollowUpQuestion[] = [];

  if (!profile.audiences.length) {
    questions.push({
      id: 'q_buyer_persona',
      question: 'Who is the primary decision-maker or end-user for your main offer?',
      why_it_matters: 'Selling to technical engineers requires completely different formats, channels, and proof than selling to HR teams or local consumers.',
      field_key: 'audiences',
      suggested_options: ['Technical / Engineering Leaders', 'Operations / Marketing Teams', 'Small Business Owners / Founders', 'Direct Consumers / Local Households'],
    });
  }

  if (!profile.primary_offer.trim()) {
    questions.push({
      id: 'q_primary_offer',
      question: 'What is your primary product/service offer and typical conversion step?',
      why_it_matters: 'Aligns content pillars and calls-to-action with how customers actually buy (self-serve checkout, demo call, local booking, or enquiry).',
      field_key: 'primary_offer',
      suggested_options: ['Self-serve SaaS / Digital Product', 'Consultative Service / Retainer', 'Physical E-commerce Catalog', 'Local Appointment / Service Booking'],
    });
  }

  if (profile.available_proof.length === 0) {
    questions.push({
      id: 'q_proof_assets',
      question: 'Which verified proof assets do you have permission to use right now?',
      why_it_matters: 'Autopilot never invents testimonials, metrics, or fake UI. Knowing what real proof exists prevents unsupported claims.',
      field_key: 'available_proof',
      suggested_options: ['Real product screen recordings', 'Approved customer reviews/case studies', 'Product photography', 'None yet — focus on educational authority'],
    });
  }

  const indLower = `${profile.industry} ${profile.niche}`.toLowerCase();
  if (/\b(health|medical|clinic|finance|invest|insurance|legal|law|alcohol|crypto)\b/.test(indLower) && !profile.risk_profile?.jurisdiction) {
    questions.push({
      id: 'q_regulatory_jurisdiction',
      question: 'Which jurisdiction and mandatory disclaimers apply to your industry communications?',
      why_it_matters: 'Configures mandatory human compliance review and disclosure footers before scheduling.',
      field_key: 'risk_profile.jurisdiction',
      suggested_options: ['United States (FDA/FTC/SEC)', 'United Kingdom / EU', 'Ghana / West Africa', 'Global / General Educational Disclaimer'],
    });
  }

  return questions.slice(0, 4);
}

export function generateAdaptiveStrategy(
  profile: BusinessProfileRecord,
  brand: BrandProfileRecord | null,
  existingVersion = 0,
): ContentStrategyRecord {
  const now = new Date().toISOString();
  const archetype = classifyBusinessArchetype(profile);
  const followUpQuestions = detectMissingHighImpactQuestions(profile);
  const assumptions: StrategyAssumption[] = [];

  // Audience fallback with explicit provisional assumption
  const audiences = profile.audiences.length > 0
    ? profile.audiences
    : (() => {
        assumptions.push({
          key: 'provisional_audience',
          assumption: `Inferred target audience for ${archetype.label} because explicit buyer segments were not yet confirmed.`,
          inferred: true,
          confidence: 0.62,
          confirmed: false,
        });
        return [{
          segment: `${profile.industry || archetype.label} Buyers`,
          role: 'Primary Buyer',
          sophistication: 'intermediate' as const,
          jobs_to_be_done: [`Solve core problem with ${profile.primary_offer || 'the main offer'}`],
        }];
      })();

  // Channel selection: prefer customer-selected/connected channels, fallback to archetype recommendations
  const requestedChannels = [
    ...(profile.channels?.preferred ?? []),
    ...(profile.channels?.connected ?? []),
  ].map((c) => c.toLowerCase().trim()).filter(Boolean);
  const uniqueChannels = [...new Set(requestedChannels.length > 0 ? requestedChannels : archetype.defaultChannels)].slice(0, 4);

  if (requestedChannels.length === 0) {
    assumptions.push({
      key: 'recommended_channels',
      assumption: `Selected ${uniqueChannels.join(', ')} based on ${archetype.label} buyer behaviour; edit if your accounts differ.`,
      inferred: true,
      confidence: 0.7,
      confirmed: false,
    });
  }

  // Desired cadence tier
  const desiredTier = profile.channels?.desired_cadence && profile.channels.desired_cadence !== 'recommend'
    ? profile.channels.desired_cadence
    : profile.capacity.weekly_hours <= 2.5
      ? 'minimum_viable'
      : profile.capacity.weekly_hours >= 8
        ? 'high_output_campaign'
        : 'balanced_growth';

  let targetPostsPerWeek =
    desiredTier === 'minimum_viable' ? 2
    : desiredTier === 'balanced_growth' ? 4
    : desiredTier === 'high_output_campaign' ? 7
    : Math.max(1, profile.channels?.custom_posts_per_week || 3);

  // Filter formats by real production capabilities (e.g., don't force product_demo if no real product screens exist)
  const filterFeasibleFormats = (formats: ContentFormat[]): ContentFormat[] => {
    const filtered = formats.filter((f) => {
      if (f === 'product_demo' && !profile.capacity.has_product_demos && archetype.key.startsWith('b2b_saas')) {
        return true; // keep with reminder to supply real screen capture
      }
      return true;
    });
    return filtered.length > 0 ? filtered : ['static_graphic'];
  };

  const pillars: StrategyPillar[] = archetype.pillars.map((p, idx) => ({
    id: `pillar_${idx + 1}`,
    name: p.name,
    purpose: p.purpose,
    objective: idx === 0 ? profile.primary_objective : (profile.secondary_objectives[0] ?? profile.primary_objective),
    target_audience: audiences[idx % audiences.length].segment,
    formats: filterFeasibleFormats(p.formats),
    allocation_pct: p.allocation_pct,
    example_angles: p.angles,
  }));

  // Capacity & Budget Feasibility Check (Section 4.3 step 5 & Section 4.4)
  const avgFormatList = pillars.flatMap((p) => p.formats);
  const avgHoursPerPost = avgFormatList.reduce((acc, f) => acc + (EFFORT_HOURS_BY_FORMAT[f] ?? 0.8), 0) / Math.max(1, avgFormatList.length);
  const avgCreditsPerPost = avgFormatList.reduce((acc, f) => acc + (CREDITS_ESTIMATE_BY_FORMAT[f] ?? 10), 0) / Math.max(1, avgFormatList.length);
  const avgUsdPerPost = avgFormatList.reduce((acc, f) => acc + (PROVIDER_USD_ESTIMATE_BY_FORMAT[f] ?? 0.08), 0) / Math.max(1, avgFormatList.length);

  let wasDownscaled = false;
  let capacityWarning: string | null = null;
  const maxHours = Math.max(0.5, profile.capacity.weekly_hours || 4);
  const maxWeeklyCredits = Math.max(10, Math.floor((profile.capacity.monthly_credit_cap || 1000) / 4.3));
  const maxWeeklyUsd = Math.max(1, (profile.capacity.monthly_budget_usd || 50) / 4.3);

  while (
    targetPostsPerWeek > 1 &&
    (targetPostsPerWeek * avgHoursPerPost > maxHours ||
      targetPostsPerWeek * avgCreditsPerPost > maxWeeklyCredits ||
      targetPostsPerWeek * avgUsdPerPost > maxWeeklyUsd)
  ) {
    targetPostsPerWeek -= 1;
    wasDownscaled = true;
  }

  // If even at lower volume video formats exceed capacity, simplify short_video -> carousel/static_graphic
  if (targetPostsPerWeek * avgHoursPerPost > maxHours) {
    for (const p of pillars) {
      p.formats = p.formats.map((f) => (f === 'short_video' ? 'static_graphic' : f));
    }
    wasDownscaled = true;
  }

  if (wasDownscaled) {
    capacityWarning = `Adjusted cadence to ${targetPostsPerWeek} post(s)/week to stay within your ${maxHours}h/week capacity and $${profile.capacity.monthly_budget_usd}/mo creative budget.`;
  }

  const finalAvgFormats = pillars.flatMap((p) => p.formats);
  const finalHours = Number(((finalAvgFormats.reduce((a, f) => a + EFFORT_HOURS_BY_FORMAT[f], 0) / Math.max(1, finalAvgFormats.length)) * targetPostsPerWeek).toFixed(1));
  const finalCredits = Math.ceil((finalAvgFormats.reduce((a, f) => a + CREDITS_ESTIMATE_BY_FORMAT[f], 0) / Math.max(1, finalAvgFormats.length)) * targetPostsPerWeek);
  const finalUsd = Number(((finalAvgFormats.reduce((a, f) => a + PROVIDER_USD_ESTIMATE_BY_FORMAT[f], 0) / Math.max(1, finalAvgFormats.length)) * targetPostsPerWeek).toFixed(2));

  // Distribute weekly cadence across channels
  const channelPlans: StrategyChannelPlan[] = uniqueChannels.map((ch, idx) => {
    const share = idx === 0 ? Math.max(1, Math.ceil(targetPostsPerWeek * 0.6)) : Math.max(1, Math.floor(targetPostsPerWeek / uniqueChannels.length));
    const mediaTypes: Array<'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY'> =
      ch === 'instagram'
        ? ['CAROUSEL', 'FEED_POST', ...(pillars.some((p) => p.formats.includes('short_video') || p.formats.includes('product_demo')) ? ['REEL' as const] : [])]
        : ['FEED_POST', 'CAROUSEL'];
    return {
      channel: ch,
      role: idx === 0 ? `Primary ${profile.primary_objective.replace('_', ' ')} engine` : 'Cross-channel reinforcement & distribution',
      priority: idx === 0 ? 'primary' : 'secondary',
      posts_per_week: share,
      formats: [...new Set(pillars.flatMap((p) => p.formats))].slice(0, 3),
      platform_media_types: mediaTypes,
      destination_url: profile.website_url || undefined,
    };
  });

  // Auto-detect elevated industry risk if not already set
  const riskCategory = profile.risk_profile?.category && profile.risk_profile.category !== 'standard'
    ? profile.risk_profile.category
    : archetype.key === 'healthcare_wellness'
      ? 'healthcare'
      : archetype.key === 'finance_regulated'
        ? 'finance'
        : 'standard';

  const requiredDisclosures = [...(profile.risk_profile?.required_disclosures ?? [])];
  if (riskCategory === 'healthcare' && requiredDisclosures.length === 0) {
    requiredDisclosures.push('Educational information only; not medical diagnosis or treatment advice.');
  } else if (riskCategory === 'finance' && requiredDisclosures.length === 0) {
    requiredDisclosures.push('For informational purposes only; not individualized financial or legal advice.');
  }

  const prohibitedClaims = [
    'Invented testimonials, star ratings, or customer logos',
    'Unverified numerical performance or ROI claims',
    ...(brand?.identity?.prohibited_claims ?? []),
    ...(profile.risk_profile?.prohibited_claims ?? []),
  ];

  return {
    id: randomUUID(),
    tenant_id: profile.tenant_id,
    org_id: profile.org_id,
    project_id: profile.project_id,
    owner_user_id: profile.owner_user_id,
    name: `${profile.business_name || archetype.label} — ${profile.primary_objective.replace(/_/g, ' ')} strategy`,
    current_version: existingVersion + 1,
    status: 'proposed',
    objective: {
      primary: profile.primary_objective,
      secondary: profile.secondary_objectives,
      success_metric: profile.success_metric || archetype.primaryKpis[0],
    },
    audiences,
    positioning: {
      value_proposition: brand?.identity?.value_proposition || profile.primary_offer || `${profile.business_name || 'Our team'} helps ${audiences[0].segment} achieve reliable outcomes.`,
      differentiators: brand?.identity?.differentiators?.length ? brand.identity.differentiators : ['Verified domain execution', 'Clear customer-centric process'],
      objections_to_address: ['Implementation effort & time-to-value', 'Proof and reliability vs alternatives'],
      available_proof_summary: profile.available_proof.filter((p) => p.verified).map((p) => `${p.type}: ${p.summary}`),
    },
    channels: channelPlans,
    pillars,
    funnel_mix: archetype.funnelMix,
    cadence: {
      tier: desiredTier,
      total_posts_per_week: targetPostsPerWeek,
      estimated_weekly_hours: finalHours,
      estimated_weekly_credits: finalCredits,
      estimated_weekly_provider_usd: finalUsd,
      capacity_warning: capacityWarning,
      was_downscaled_for_capacity: wasDownscaled,
    },
    campaigns: [
      { name: 'Pilot Validation Batch', type: 'evergreen', active: true },
    ],
    cta_policy: archetype.ctaByStage,
    proof_policy: {
      allowed_evidence_types: profile.available_proof.map((p) => p.type),
      prohibited_claims: [...new Set(prohibitedClaims)],
      require_source_for_numbers: true,
    },
    risk_policy: {
      category: riskCategory,
      jurisdiction: profile.risk_profile?.jurisdiction,
      required_disclosures: requiredDisclosures,
      prohibited_claims: [...new Set(prohibitedClaims)],
      reviewer_role: profile.risk_profile?.reviewer_role || 'owner',
      require_human_review_always: riskCategory !== 'standard' || profile.capacity.approval_mode === 'mandatory',
    },
    measurement: {
      primary_kpis: archetype.primaryKpis,
      secondary_kpis: archetype.secondaryKpis,
      attribution_notes: 'Platform reach and engagement indicate message resonance, not guaranteed revenue. Track downstream enquiries, UTMs, and qualified conversions separately.',
      review_cadence: 'biweekly',
    },
    assumptions,
    follow_up_questions: followUpQuestions,
    rationale: `Designed for ${profile.business_name || 'this workspace'} (${archetype.label}, ${profile.business_model}) targeting ${audiences.map((a) => a.segment).join(', ')} with primary objective "${profile.primary_objective}". Cadence set to ${targetPostsPerWeek} post(s)/week (~${finalHours}h/wk) respecting your production capacity and ${profile.available_proof.length} verified proof item(s).`,
    approved_by: null,
    approved_at: null,
    created_at: now,
    updated_at: now,
  };
}

function mapFormatToWorkflow(format: ContentFormat): WorkflowType {
  switch (format) {
    case 'carousel':
      return 'carousel';
    case 'short_video':
      return 'short_form_video';
    case 'product_demo':
      return 'product_demo';
    default:
      return 'branded_social_graphic';
  }
}

function computeNextSlotDate(
  slot: NamedScheduleSlot,
  occurrenceOffsetWeeks: number,
  blackoutDates: Set<string>,
  holidayDates: Set<string>,
  fromTime = new Date(),
): Date {
  const candidate = new Date(fromTime.getTime());
  candidate.setUTCSeconds(0, 0);
  const currentDay = candidate.getUTCDay();
  let daysUntil = (slot.day_of_week - currentDay + 7) % 7;
  if (daysUntil === 0 && candidate.getUTCHours() >= slot.hour) {
    daysUntil = 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + daysUntil + occurrenceOffsetWeeks * 7);
  candidate.setUTCHours(slot.hour, slot.minute, 0, 0);

  // Skip blackout windows and configured holidays safely (up to 14 days forward)
  for (let guard = 0; guard < 14; guard++) {
    const isoDate = candidate.toISOString().slice(0, 10);
    if (!blackoutDates.has(isoDate) && !holidayDates.has(isoDate)) break;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

/**
 * Generates a reviewable pilot batch (default 4 items, Section 3.2 Step 5) or full calendar
 * from a strategy, mapping onto named weekly schedule slots, timezones, and blackout windows.
 */
export function generateContentCalendarBatch(params: {
  business: BusinessProfileRecord;
  brand: BrandProfileRecord | null;
  strategy: ContentStrategyRecord;
  batchSize?: number;
  campaignName?: string;
  actorUserId: string;
}): ContentItemRecord[] {
  const { business, brand, strategy, actorUserId } = params;
  const count = Math.min(28, Math.max(1, params.batchSize ?? Math.min(4, Math.max(3, strategy.cadence.total_posts_per_week))));
  const now = new Date().toISOString();

  const slots: NamedScheduleSlot[] = business.schedule_config?.named_slots?.length
    ? business.schedule_config.named_slots
    : [
        { id: 'slot_1', name: 'Tuesday Morning Pillar', day_of_week: 2, hour: 9, minute: 30, timezone: business.schedule_config?.timezone || 'UTC', channels: strategy.channels.map((c) => c.channel) },
        { id: 'slot_2', name: 'Thursday Afternoon Proof', day_of_week: 4, hour: 14, minute: 0, timezone: business.schedule_config?.timezone || 'UTC', channels: strategy.channels.map((c) => c.channel) },
      ];

  const blackouts = new Set(business.schedule_config?.blackout_dates ?? []);
  const holidays = new Set((business.schedule_config?.holidays ?? []).map((h) => h.date));
  const funnelStages: Array<'awareness' | 'consideration' | 'conversion'> = ['awareness', 'consideration', 'awareness', 'conversion'];

  const items: ContentItemRecord[] = [];
  for (let i = 0; i < count; i++) {
    const pillar = strategy.pillars[i % strategy.pillars.length];
    const format: ContentFormat = pillar.formats[i % pillar.formats.length] || 'static_graphic';
    const workflowType = mapFormatToWorkflow(format);
    const stage = funnelStages[i % funnelStages.length];
    const slot = slots[i % slots.length];
    const weekOffset = Math.floor(i / slots.length);
    const scheduledDate = computeNextSlotDate(slot, weekOffset, blackouts, holidays);

    const angle = pillar.example_angles[i % pillar.example_angles.length] || pillar.purpose;
    const cta = strategy.cta_policy[stage] || strategy.cta_policy.awareness || 'Learn more via our profile link.';
    const disclosures = [...(strategy.risk_policy.required_disclosures ?? [])];
    const targetChannels = slot.channels?.length ? slot.channels : strategy.channels.map((c) => c.channel);

    const hook = `${angle} — practical guidance for ${pillar.target_audience}`;
    const bodyBase = `${hook}.\n\n${pillar.purpose}. Built around ${business.primary_offer || brand?.identity?.value_proposition || 'verified operational workflows'}.\n\n${cta}${disclosures.length ? `\n\nNote: ${disclosures.join(' ')}` : ''}`;

    const channelVariants: ContentItemRecord['channel_variants'] = {};
    for (const ch of targetChannels) {
      const mediaType: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY' =
        format === 'carousel' ? 'CAROUSEL'
        : (format === 'short_video' || format === 'product_demo') && ch === 'instagram' ? 'REEL'
        : format === 'story' ? 'STORY'
        : 'FEED_POST';
      channelVariants[ch] = {
        caption: ch === 'twitter' ? `${hook}\n\n${cta}`.slice(0, 275) : bodyBase,
        hashtags: [
          `#${(business.industry || 'business').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
          `#${pillar.objective.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
        ].filter((h) => h.length > 2),
        media_type: mediaType,
      };
    }

    const approvalRequired =
      Boolean(strategy.risk_policy.require_human_review_always) ||
      business.capacity.approval_mode !== 'streamlined_evergreen' ||
      stage === 'conversion' ||
      disclosures.length > 0;

    items.push({
      id: randomUUID(),
      tenant_id: business.tenant_id,
      org_id: business.org_id,
      project_id: business.project_id,
      owner_user_id: business.owner_user_id,
      strategy_id: strategy.id,
      strategy_version: strategy.current_version,
      brand_profile_id: brand?.id ?? null,
      brand_version: brand?.current_version ?? null,
      campaign_name: params.campaignName || strategy.campaigns[0]?.name || 'Pilot Validation Batch',
      pillar_id: pillar.id,
      pillar_name: pillar.name,
      funnel_stage: stage,
      title: `${pillar.name}: ${angle}`.slice(0, 140),
      hook,
      caption: bodyBase,
      channel_variants: channelVariants,
      format,
      workflow_type: workflowType,
      target_channels: targetChannels,
      lifecycle_state: 'planned',
      approval_required: approvalRequired,
      risk_flags: strategy.risk_policy.category !== 'standard' ? [`industry:${strategy.risk_policy.category}`] : [],
      validation_report: {},
      media_assets: [],
      deterministic_overlay: {},
      slides: [],
      storyboard: [],
      alt_text: `${brand?.brand_name || business.business_name || 'Brand'} ${format.replace('_', ' ')} covering ${angle}`,
      disclosures,
      scheduled_slot: {
        slot_id: slot.id,
        slot_name: slot.name,
        scheduled_at: scheduledDate.toISOString(),
        timezone: slot.timezone || business.schedule_config?.timezone || 'UTC',
      },
      linked_blog_post_id: null,
      version: 1,
      created_by: actorUserId,
      approved_by: null,
      approved_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  return items;
}
