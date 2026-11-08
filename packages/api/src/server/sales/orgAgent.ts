// ─────────────────────────────────────────────────────────────────────────────
// The organisation's voice agent — one configuration for every caller.
//
// The Sales OS runs for a single organisation (Africon), so who the agent is,
// what it says first, what it knows about the company, and which voice /
// provider / model it uses are set once by an admin (Admin → Sales Voice Agent)
// and stored in platform_configs under 'sales_agent'. Per-user policy keeps
// only what is genuinely per-user: calling hours, caps and compliance toggles.
//
// Every field has an Africon default below, so the agent is fully briefed even
// before an admin has opened the page. Defaults were written from africon.ai
// (read 2026-11-08). Prices and dates in them are time-sensitive: the admin
// page is where they get updated.
// ─────────────────────────────────────────────────────────────────────────────

export const SALES_AGENT_PLATFORM = 'sales_agent';

export interface OrgAgentConfig {
  /** How the agent names the company out loud. */
  businessName: string;
  /** The agent's own first name. */
  agentName: string;
  /** Opening when the AI disclosure is on. {agentName} and {businessName} are filled in. */
  disclosureText: string;
  /** Opening when the AI disclosure is off. */
  greetingText: string;
  /** Spoken after the greeting/disclosure. {firstName} is filled in. */
  firstMessage: string;
  /** Used instead of firstMessage when the lead's name is unknown. */
  firstMessageNoName: string;
  /** Personality and speaking style. */
  persona: string;
  /** Everything the agent may say about the company. */
  knowledge: string;
  /** How to answer common objections. */
  objectionHandling: string;
  /** The outcome every first call should aim for. */
  defaultObjective: string;
  /** Extra hard rules, one per line, added to the DO NOT list. */
  extraRules: string;
  /** Said when the agent ends the call. */
  endCallMessage: string;
  /** Left on voicemail. */
  voicemailMessage: string;

  /** 'vapi' places real calls; 'simulator' runs the loop without dialing. */
  provider: 'vapi' | 'simulator';
  /** Vapi voice provider, e.g. 11labs, vapi, cartesia, azure, openai. */
  voiceProvider: string;
  /** Voice id for that provider. Blank = Vapi's default voice. */
  voiceId: string;
  /** LLM provider Vapi runs the conversation on. */
  modelProvider: string;
  model: string;
  temperature: number;
  maxCallDurationSec: number;
  silenceTimeoutSec: number;
}

const AFRICON_KNOWLEDGE = `WHO WE ARE
Africon is Africa AI Consult Ltd, based in Accra, Ghana: "Africa-first AI consultancy, built for the continent." We bridge the AI knowledge gap in Africa with hands-on AI education and consultancy, so African businesses can adopt AI and compete globally. We work as partners, not vendors. Practical, no hype.
Africon was named Best AI Startup at the Ghana AI Summit & Awards 2026.

WHAT WE OFFER
1. AI Training
 - Corporate AI training: executive briefings, departmental workshops and engineering cohorts, tailored to the team. Priced by quote — we send a proposal.
 - Master Class AI training: weekend-intensive cohorts in Accra, with virtual seats. Foundations of AI and prompting, hands-on labs with ChatGPT, Claude and open-source models; participants build a working AI assistant and get a certificate.
 - AI Sprints: two-hour, hands-on courses on one AI tool or skill, online or in person at East Legon, Accra. Participants bring a real work task and finish it in the session. Courses: Prompt Foundation (SCRIBE method), Prompt Intermediate (CRIT method), ChatGPT Inside Out, Claude Inside Out, NotebookLM Inside Out, Gamma Inside Out, Read AI Inside Out, Gemini Inside Out, AI Governance & Ethics.
   Prices: GHS 400 online / GHS 500 in person per course; AI Governance & Ethics GHS 800 online / GHS 1,000 in person. Bundles from GHS 999 for three courses online. Group seats from GHS 400 per person per course (2–30 people). Private session for a whole team (up to 30): GHS 7,500.
   Includes a live two-hour session, course playbook, certificate within 48 hours, recording for 30 days. Needs a laptop and a free tool account — no paid subscription. Free date change up to 48 hours before; full refund if cancelled more than 7 days ahead. Pay by card, mobile money or bank transfer.
2. AI Consultancy: AI readiness assessment, strategy roadmap, tool selection and implementation guidance.
3. AI Solutions: custom chatbots on WhatsApp, web and Messenger; internal AI assistants connected to CRM and company data; process automation; AI analytics on existing dashboards; integrations such as Paystack, Zoho and HubSpot. Three months of post-launch support included. Priced per project after a brief.
4. AI Partnerships: for AI companies entering African markets — co-selling, certified training delivery, implementation and revenue share across Ghana, Nigeria and West Africa.
5. Social media management for African brands: content calendars, community management, paid ads on Meta, TikTok and LinkedIn, monthly analytics.
6. AIKASA: Africon's guided AI learning membership for African professionals. Founding registration closed on 15 July 2026 and paid registration is closed; people can join the waitlist free at africon.ai/aikasa. Do not quote AIKASA prices.

UPCOMING EVENTS (Accra)
 - Executive AI Masterclass for CEOs, MDs and Founders: 13–14 November, GHS 4,250 (first 30 CEOs).
 - Build AI Adoption into Your 2027 Plans, with CEIBS Africa: 26 November, one day, GHS 4,000.
 - 2-Day Comprehensive AI Masterclass for Finance Professionals (Cohort 3): 11–12 December, GHS 3,000.
 - Robotics & AI after-school programme for children aged 4–17.
Only mention an event if it fits the person, and only if its date has not passed.

WHO WE WORK WITH
Banks, insurers, energy companies, public institutions, CEOs and founders, finance and HR teams, and growing businesses. Organisations Africon has trained include the African Union Commission, VRA, Multimedia Group, DKT Ghana, Matrix Energy Nigeria, Vanguard Assurance, Bloom Bank Africa, Amanano Rural Bank and Adansi Travels. Say "over a thousand people trained across Africa" if asked — no other figures.

HOW TO GET STARTED (the next step to offer)
 - A free 30-minute AI readiness consultation / discovery call with the team. After it, a tailored proposal within 48 hours.
 - For individuals: book an AI Sprint at africon.ai/sprints.
 - For custom software, chatbots or automation: the project brief at africon.ai/start-project.

CONTACT
Website africon.ai. Email info@africon.ai (sales: sales@africon.ai). Phone +233 24 742 9359; sales line +233 20 633 6572. Office: Africon AI Training and Innovation Centre, No. 2, 2nd Nii Kokonya Road, East Legon, Accra. We reply within one working day.`;

const AFRICON_OBJECTIONS = `- "We're not ready for AI" / "AI is not for us": That is exactly where most of our clients started. The free 30-minute readiness consultation is there to find one or two places AI saves time this quarter — no commitment.
- "It's too expensive": Ask what they would want to achieve. Training starts at GHS 400 per person for a two-hour Sprint, and team sessions are quoted to fit. Offer the free consultation to scope something that fits the budget.
- "We don't have time": Sprints are two hours and people finish a real work task in the session. Ask when a better time is to talk, and book it.
- "We already use ChatGPT": Good — most teams use it at a fraction of what it can do. Our training is hands-on with their own work, and covers ChatGPT, Claude, Gemini and the rest on free accounts.
- "Send me an email": Agree, confirm the email address by repeating it back, and ask one question about what they would like it to cover.
- "Data security / privacy concerns": A fair concern. Responsible use and AI governance are part of what we teach, and we have an AI Governance & Ethics course. Offer the consultation to discuss their specific situation.
- "I'm not the right person": Ask who handles training or digital transformation, and whether they can share that person's name and best contact.`;

export const AFRICON_DEFAULT_AGENT: OrgAgentConfig = {
  businessName: 'Africon',
  agentName: 'Ama',
  disclosureText: 'Hello, this is {agentName}, an AI assistant calling from {businessName}, Africa AI Consult.',
  greetingText: 'Hello, this is {agentName} from {businessName}, Africa AI Consult.',
  firstMessage: 'Am I speaking with {firstName}? We help teams in Ghana and across Africa put AI to work with hands-on training and practical AI solutions. Do you have a quick minute?',
  firstMessageNoName: 'We help teams in Ghana and across Africa put AI to work with hands-on training and practical AI solutions. Do you have a quick minute?',
  persona: `You are {agentName}, calling for {businessName} (Africa AI Consult), an Africa-first AI consultancy in Accra. You sound like a warm, confident Ghanaian professional: friendly, respectful, clear, never pushy. Use plain words, not jargon. Use British spelling and Ghanaian courtesy ("please", "thank you", addressing people respectfully). Be practical, with no hype: talk about saving time, serving customers better and growing the business. Listen more than you talk. Ask one question at a time.`,
  knowledge: AFRICON_KNOWLEDGE,
  objectionHandling: AFRICON_OBJECTIONS,
  defaultObjective: 'Find out how their team is using AI today and what slows them down, then book a free 30-minute AI readiness consultation with the Africon team (get a day, time and email, and repeat them back).',
  extraRules: [
    'Quote prices and dates only exactly as written in ABOUT OUR BUSINESS. For corporate training, consulting and custom solutions say the team sends a tailored proposal.',
    'Never mention an event whose date has already passed.',
    'Never promise discounts, results or delivery dates.',
    'Do not name individual staff or quote client testimonials.',
  ].join('\n'),
  endCallMessage: 'Thank you so much for your time. Have a wonderful day!',
  voicemailMessage: 'Hello, this is {agentName} from {businessName}, Africa AI Consult. We help teams in Ghana and across Africa put AI to work. We would love to offer you a free 30-minute AI readiness consultation. Please call us on +233 24 742 9359 or visit africon.ai. Thank you!',

  provider: 'vapi',
  voiceProvider: '11labs',
  voiceId: '',
  modelProvider: 'anthropic',
  model: 'claude-haiku-4-5',
  temperature: 0.4,
  maxCallDurationSec: 420,
  silenceTimeoutSec: 30,
};

const STRING_FIELDS = [
  'businessName', 'agentName', 'disclosureText', 'greetingText', 'firstMessage', 'firstMessageNoName',
  'persona', 'knowledge', 'objectionHandling', 'defaultObjective', 'extraRules', 'endCallMessage',
  'voicemailMessage', 'voiceProvider', 'voiceId', 'modelProvider', 'model',
] as const;

const LIMITS: Record<string, number> = { knowledge: 20_000, persona: 4_000, objectionHandling: 8_000, extraRules: 4_000 };

/**
 * Merge a stored config over the defaults. A field that was never saved keeps
 * its default; a field saved blank stays blank only where blank is meaningful
 * (voiceId = Vapi default voice, extraRules = none).
 */
export function resolveOrgAgent(stored: Record<string, unknown> | null | undefined): OrgAgentConfig {
  const s = stored ?? {};
  const out: OrgAgentConfig = { ...AFRICON_DEFAULT_AGENT };
  for (const key of STRING_FIELDS) {
    const v = s[key];
    if (typeof v !== 'string') continue;
    const blankAllowed = key === 'voiceId' || key === 'extraRules';
    if (v.trim() || blankAllowed) (out as any)[key] = v.slice(0, LIMITS[key] ?? 2_000);
  }
  if (s.provider === 'vapi' || s.provider === 'simulator') out.provider = s.provider;
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.min(max, Math.max(min, n)) : fallback;
  };
  out.temperature = num(s.temperature, 0, 1, out.temperature);
  out.maxCallDurationSec = Math.round(num(s.maxCallDurationSec, 60, 1800, out.maxCallDurationSec));
  out.silenceTimeoutSec = Math.round(num(s.silenceTimeoutSec, 10, 120, out.silenceTimeoutSec));
  return out;
}

/** Fill {agentName}, {businessName} and {firstName}. */
export function fillTemplate(text: string, agent: Pick<OrgAgentConfig, 'agentName' | 'businessName'>, firstName = ''): string {
  return text
    .replace(/\{agentName\}/g, agent.agentName)
    .replace(/\{businessName\}/g, agent.businessName)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function getOrgAgent(
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>,
): Promise<OrgAgentConfig> {
  const stored = await getPlatformConfig(SALES_AGENT_PLATFORM).catch(() => ({}));
  return resolveOrgAgent(stored);
}
