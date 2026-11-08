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

/** One playbook entry: when the lead raises this, answer like this. */
export interface PlaybookEntry {
  /** An objection code (price, budget, timing…) or 'other' for a free scenario. */
  code: string;
  /** What the lead says or the situation, in plain words. */
  scenario: string;
  /** How the agent should respond. */
  response: string;
}

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
  /** Objection playbook: how to answer each objection and other scenarios. */
  playbook: PlaybookEntry[];
  /** Free-form extra guidance on objections, after the playbook. */
  objectionHandling: string;
  /** The outcome every first call should aim for. */
  defaultObjective: string;
  /** Extra hard rules, one per line, added to the DO NOT list. */
  extraRules: string;
  /** Said when the agent ends the call. */
  endCallMessage: string;
  /** Spoken first when someone rings the Vapi number (inbound). Disclosure included. */
  inboundFirstMessage: string;
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

const AFRICON_PLAYBOOK: PlaybookEntry[] = [
  {"code":"price","scenario":"\"It's too expensive\"","response":"Acknowledge it, then ask what they would want AI to help with. Training starts at GHS 400 per person for a two-hour AI Sprint, and team sessions are quoted to fit the group. Offer the free 30-minute consultation to scope something that fits the budget."},
  {"code":"budget","scenario":"\"We have no budget right now\"","response":"Understood. Ask when their next budget or planning cycle is, and whether AI is on the 2027 plan. Offer the free consultation now so they have a costed plan ready, or an individual AI Sprint for one person to start small. Ask for a good time to follow up."},
  {"code":"timing","scenario":"\"Bad timing\" / \"We are too busy\"","response":"Respect it. Mention that Sprints are only two hours and people finish a real work task in the session, so it saves time rather than costing it. Ask for a specific better day and time to call back, and repeat it."},
  {"code":"no_authority","scenario":"\"I need to check with my boss\" / \"It is not my decision\"","response":"Ask who else is involved and what they would need to see. Offer to include them in the free consultation, or to send a short summary they can forward. Get the decision maker's name and best contact if they are happy to share."},
  {"code":"existing_provider","scenario":"\"We already work with someone\" / \"We already use ChatGPT\"","response":"That is good — most teams use these tools at a fraction of what they can do. Africon training is hands-on with their own work, covers ChatGPT, Claude, Gemini and more on free accounts, and is built for the African context. Ask what is working and what is not."},
  {"code":"no_need","scenario":"\"We don't need AI\" / \"AI is not for us\"","response":"Do not argue. Ask how their team handles reports, emails, proposals or customer questions today. Most clients started exactly here; the free consultation finds one or two places AI saves time this quarter, with no commitment."},
  {"code":"trust","scenario":"\"Who are you?\" / \"How do I know you are legitimate?\"","response":"Africon is Africa AI Consult Ltd, based at East Legon, Accra, named Best AI Startup at the Ghana AI Summit & Awards 2026, and has trained teams at organisations such as the African Union Commission, Vanguard Assurance and Bloom Bank Africa. They can check africon.ai or call +233 24 742 9359."},
  {"code":"missing_feature","scenario":"\"Do you do X?\" — something not in our knowledge","response":"Do not guess. Say you will check with the team and have them confirm. If it sounds like custom software, a chatbot or automation, mention the project brief at africon.ai/start-project."},
  {"code":"contract_lock_in","scenario":"\"We are tied into a contract with another vendor\"","response":"No problem — training and consulting work alongside the tools they already have. Suggest a Sprint or a team session to get more from their current tools, and ask when the contract is up for review."},
  {"code":"bad_experience","scenario":"\"We tried AI training before and it was useless\"","response":"Apologise that it did not help and ask what went wrong. Africon sessions are hands-on: each person brings a real task from their own work and finishes it in the session, with two facilitators. Offer the free consultation to shape it around their team."},
  {"code":"other","scenario":"\"Send me an email\"","response":"Agree. Confirm the email address by repeating it back, spelling it if needed, and ask one question about what they want it to cover. Say the team will send it within one working day."},
  {"code":"other","scenario":"Data security, privacy or confidential information","response":"A fair concern. Responsible use and AI governance are part of every Africon programme, and there is a dedicated AI Governance & Ethics course. Offer the consultation to talk about their policies and data."},
  {"code":"other","scenario":"\"Are you a robot?\" / \"Am I talking to a real person?\"","response":"Be honest: you are an AI assistant calling for Africon. Offer to have a person from the team call them back, and take a good time and number."},
  {"code":"other","scenario":"\"How did you get my number?\"","response":"Be honest and calm: say their details are on Africon's contact list, apologise for any inconvenience, and ask if they would prefer not to be called. If they want no more calls, confirm it and end politely."},
  {"code":"other","scenario":"\"I am not the right person\"","response":"Thank them. Ask who handles training, HR or digital transformation, and whether they can share that person's name and best contact."},
  {"code":"other","scenario":"\"Call me later\"","response":"Ask for a specific day and time, repeat it back, thank them and end the call."},
  {"code":"other","scenario":"\"How much is corporate training / consulting / a chatbot?\"","response":"There is no fixed price — the team sends a tailored proposal within 48 hours of the free 30-minute consultation. Offer to book that consultation now."},
  {"code":"other","scenario":"They want to book or pay for a Sprint or event","response":"Great. Sprints are booked at africon.ai/sprints; payment is by card, mobile money or bank transfer. Offer to have the team send the booking link, and confirm their email or WhatsApp number."},
  {"code":"other","scenario":"They ask about AIKASA membership","response":"Founding registration has closed and paid registration is closed for now. They can join the free waitlist at africon.ai/aikasa and will get plans and prices before deciding. Do not quote a price."},
  {"code":"other","scenario":"They are upset or angry","response":"Stay calm, apologise sincerely, do not argue or defend. Ask how you can help, and offer to have a person from the team call them back."},
];

export const AFRICON_DEFAULT_AGENT: OrgAgentConfig = {
  businessName: 'Africon',
  agentName: 'Ama',
  disclosureText: 'Hello, this is {agentName}, an AI assistant calling from {businessName}, Africa AI Consult.',
  greetingText: 'Hello, this is {agentName} from {businessName}, Africa AI Consult.',
  firstMessage: 'Am I speaking with {firstName}? We help teams in Ghana and across Africa put AI to work with hands-on training and practical AI solutions. Do you have a quick minute?',
  firstMessageNoName: 'We help teams in Ghana and across Africa put AI to work with hands-on training and practical AI solutions. Do you have a quick minute?',
  persona: `You are {agentName}, calling for {businessName} (Africa AI Consult), an Africa-first AI consultancy in Accra. You sound like a warm, confident Ghanaian professional: friendly, respectful, clear, never pushy. Use plain words, not jargon. Use British spelling and Ghanaian courtesy ("please", "thank you", addressing people respectfully). Be practical, with no hype: talk about saving time, serving customers better and growing the business. Listen more than you talk. Ask one question at a time.`,
  knowledge: AFRICON_KNOWLEDGE,
  playbook: AFRICON_PLAYBOOK,
  objectionHandling: '',
  defaultObjective: 'Find out how their team is using AI today and what slows them down, then book a free 30-minute AI readiness consultation with the Africon team (get a day, time and email, and repeat them back).',
  extraRules: [
    'Quote prices and dates only exactly as written in ABOUT OUR BUSINESS. For corporate training, consulting and custom solutions say the team sends a tailored proposal.',
    'Never mention an event whose date has already passed.',
    'Never promise discounts, results or delivery dates.',
    'Do not name individual staff or quote client testimonials.',
  ].join('\n'),
  endCallMessage: 'Thank you so much for your time. Have a wonderful day!',
  inboundFirstMessage: 'Hello, thank you for calling {businessName}, Africa AI Consult. This is {agentName}, an AI assistant, and this call is recorded. How can I help you today?',
  voicemailMessage: 'Hello, this is {agentName} from {businessName}, Africa AI Consult. We help teams in Ghana and across Africa put AI to work. We would love to offer you a free 30-minute AI readiness consultation. Please call us on +233 24 742 9359 or visit africon.ai. Thank you!',

  provider: 'vapi',
  // ElevenLabs "Sarah" — a premade voice every Vapi account can use: warm, clear, professional.
  voiceProvider: '11labs',
  voiceId: 'EXAVITQu4vr4xnAyMBLR',
  modelProvider: 'anthropic',
  model: 'claude-haiku-4-5',
  temperature: 0.4,
  maxCallDurationSec: 420,
  silenceTimeoutSec: 30,
};

const STRING_FIELDS = [
  'businessName', 'agentName', 'disclosureText', 'greetingText', 'firstMessage', 'firstMessageNoName',
  'persona', 'knowledge', 'objectionHandling', 'defaultObjective', 'extraRules', 'endCallMessage',
  'voicemailMessage', 'inboundFirstMessage', 'voiceProvider', 'voiceId', 'modelProvider', 'model',
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
    const blankAllowed = key === 'voiceId' || key === 'extraRules' || key === 'objectionHandling';
    if (v.trim() || blankAllowed) (out as any)[key] = v.slice(0, LIMITS[key] ?? 2_000);
  }
  if (s.provider === 'vapi' || s.provider === 'simulator') out.provider = s.provider;
  const playbook = parsePlaybook(s.playbook);
  if (playbook) out.playbook = playbook;
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.min(max, Math.max(min, n)) : fallback;
  };
  out.temperature = num(s.temperature, 0, 1, out.temperature);
  out.maxCallDurationSec = Math.round(num(s.maxCallDurationSec, 60, 1800, out.maxCallDurationSec));
  out.silenceTimeoutSec = Math.round(num(s.silenceTimeoutSec, 10, 120, out.silenceTimeoutSec));
  return out;
}

/** Stored as a JSON string (platform config values are strings) or an array. */
export function parsePlaybook(raw: unknown): PlaybookEntry[] | null {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(list)) return null;
  return list
    .map((e: any) => ({
      code: String(e?.code ?? 'other').slice(0, 40) || 'other',
      scenario: String(e?.scenario ?? '').trim().slice(0, 300),
      response: String(e?.response ?? '').trim().slice(0, 1500),
    }))
    .filter((e) => e.response)
    .slice(0, 60);
}

/** The playbook as brief text — every entry, so the agent can handle any of them. */
export function renderPlaybook(
  agent: Pick<OrgAgentConfig, 'playbook' | 'objectionHandling'>,
  labels: Record<string, string> = {},
): string {
  const lines = agent.playbook.map((e) => `- ${e.scenario || labels[e.code] || e.code}: ${e.response}`);
  return [...lines, agent.objectionHandling.trim()].filter(Boolean).join('\n');
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

/**
 * The brief for someone who rings the number. There is no lead record, so it
 * is the org's persona, knowledge and rules plus inbound guidance: find out
 * who is calling and what they need, answer from the knowledge, and capture
 * the details for the team to follow up.
 */
export function buildInboundSystemPrompt(agent: OrgAgentConfig): string {
  const rules = agent.extraRules
    .split('\n').map((l) => l.trim().replace(/^[-•]\s*/, '')).filter(Boolean).map((l) => `- ${l}`);
  return [
    fillTemplate(agent.persona, agent),
    'You are answering an incoming phone call and speaking out loud, so keep replies short and conversational — one or two sentences, then let them talk. Never read lists, links or symbols aloud; say web addresses simply, like "africon dot A I".',
    '',
    'CALL TYPE: Incoming call',
    'Someone has called us. Find out their name, their organisation and what they need. Answer questions from ABOUT OUR BUSINESS only. When they are interested, offer the free 30-minute AI readiness consultation (or an AI Sprint for an individual), and take their name, phone or email and a preferred day and time — repeat them back to confirm, and say the team will follow up within one working day.',
    '',
    'ABOUT OUR BUSINESS',
    agent.knowledge.trim(),
    '',
    agent.playbook.length || agent.objectionHandling.trim() ? `OBJECTION PLAYBOOK — how to handle what callers say\n${renderPlaybook(agent)}\n` : '',
    'DO NOT',
    '- Pressure the caller or push after a clear no.',
    '- Invent pricing, features, timelines, or customer names. If you do not know, say the team will confirm.',
    '- Claim a booking is confirmed — say the team will confirm it.',
    '- Argue. If they object, acknowledge it and ask a question.',
    ...rules,
    '',
    'HOW TO END',
    'Summarise what happens next, thank them for calling, and end the call.',
  ].filter((l) => l !== '').join('\n');
}

export async function getOrgAgent(
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>,
): Promise<OrgAgentConfig> {
  const stored = await getPlatformConfig(SALES_AGENT_PLATFORM).catch(() => ({}));
  return resolveOrgAgent(stored);
}
