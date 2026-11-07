// ─────────────────────────────────────────────────────────────────────────────
// Company context — what the orchestrator knows about the business it works
// for: who they are, what they sell, upcoming events, programmes, audiences,
// policies, proof points and the sales playbook.
//
// Every item is editable by the account owner. The Africon.ai defaults are
// seeded once per admin account (company_context_seeds remembers it, so an
// item the user deletes is never re-created behind their back). "Restore
// defaults" only re-adds seed items whose seed_key is missing.
//
// companyContextBlock() renders the active items for a model prompt, events
// first and sorted by date, with past events dropped.
// ─────────────────────────────────────────────────────────────────────────────

import type { Pool } from 'pg';
import { logger } from '../logger.ts';

export const CONTEXT_KINDS = [
  'overview', 'offering', 'event', 'program', 'audience', 'proof', 'policy', 'playbook', 'contact', 'faq', 'note',
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  overview: 'Company overview', offering: 'Service / offering', event: 'Event / training', program: 'Programme / project',
  audience: 'Target audience', proof: 'Proof & clients', policy: 'Policies', playbook: 'Sales playbook',
  contact: 'Contact', faq: 'FAQ', note: 'Note',
};

/** Structured fields an event (or programme) can carry. All optional. */
export interface EventData {
  start_date?: string | null;   // YYYY-MM-DD
  end_date?: string | null;
  time?: string | null;
  venue?: string | null;
  format?: string | null;       // in person | online | hybrid
  price?: string | null;
  early_bird?: string | null;
  booking_deadline?: string | null; // YYYY-MM-DD
  capacity?: number | null;
  url?: string | null;
  target_roles?: string[];
  target_industries?: string[];
  keywords?: string[];
  [k: string]: unknown;
}

export interface ContextItem {
  id: string;
  kind: ContextKind;
  title: string;
  summary: string | null;
  body: string | null;
  data: EventData;
  tags: string[];
  position: number;
  active: boolean;
  source: 'seed' | 'manual' | 'ai';
  seed_key: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, kind, title, summary, body, data, tags, position, active, source, seed_key, created_at, updated_at`;

// ── Africon.ai defaults (researched from africon.ai, Nov 2026) ───────────────

interface SeedItem { key: string; kind: ContextKind; title: string; summary: string; body: string; data?: EventData; tags?: string[] }

export const AFRICON_SEED: SeedItem[] = [
  {
    key: 'overview',
    kind: 'overview',
    title: 'Africon — Africa AI Consult Ltd (africon.ai)',
    summary: 'Africa-first AI training and consultancy based in East Legon, Accra. Tagline: "AI for Growth".',
    body: [
      'Africa AI Consult Ltd ("Africon", africon.ai) is an AI consultancy and training company built for the African market — "Africa-first by design", unlike global consultancies that treat Africa as an afterthought.',
      'Mission: bridge the AI knowledge gap in Africa through practical AI education and end-to-end consultancy, so African businesses can thrive in the digital economy.',
      'Vision: foster innovation and growth across Africa by helping businesses adopt AI and compete globally.',
      'Values: Excellence, Impact, Collaboration (partners, not vendors), Innovation.',
      'What we do: (1) AI training — weekend masterclasses, executive masterclasses, 2-hour AI Sprints, corporate cohorts; (2) AI consultancy — readiness assessment, strategy roadmap, tool selection, implementation guidance; (3) long-term AI partnerships; (4) custom AI solutions — chatbots, agents, automation, AI inside existing apps; (5) social media management for African brands.',
      'Founder & lead facilitator: Gideon Asare — AI Strategy Consultant, Trainer and Businessman; has led AI initiatives in finance, education, tourism and health.',
      'Base: Africon AI Training and Innovation Centre, No. 2, 2nd Nii Kokonya Road, East Legon, Accra, Ghana. US office: Mountain Road PL NE STE R, Albuquerque, NM 87110.',
      'Markets: Ghana first, then Nigeria and wider West Africa; virtual seats for the diaspora.',
    ].join('\n'),
    tags: ['company'],
  },
  {
    key: 'proof',
    kind: 'proof',
    title: 'Proof points, awards and clients',
    summary: 'Best AI Startup of the Year (Ghana AI Summit & Awards 2026); 1,000+ people trained; 10+ corporate clients.',
    body: [
      'Award: named Best AI Startup of the Year at the Ghana AI Summit & Awards 2026 (29–30 July 2026, Accra).',
      'Reach: 1,000+ people trained across Africa (homepage also states 150+ professionals in masterclasses); 10+ institutional/corporate clients; 10+ trained AI facilitators; almost two years of hands-on AI training in Ghana, Nigeria and beyond.',
      'Clients and organisations trained: African Union Commission, VRA (Human Resource), Multimedia Group / Multimedia Ghana (80 staff trained), Adansi Travels (70 staff), DKT Ghana, Matrix Energy Nigeria, Vanguard, Bloom Bank Africa (executive session on AI governance and strategy), Amanano Rural Bank, Oakwood Green, Sunseekers Ghana, Stem Robo, Royal Crown Packaging.',
      'CEO masterclass cohort 1: 20+ executives from banking, hospitality, manufacturing, ICT, logistics and education.',
      'Partner: CEIBS Africa (Accra campus of the China Europe International Business School) — co-host of "Build AI Adoption into Your 2027 Plans".',
      'Testimonials: Sally Osei-Boateng (GM HR & Corporate Communications, Royal Crown Packaging); Abenaa Antwiwaa Adusei (CEO, Manners on Point School of Etiquette).',
      'Use these in calls as social proof: name a client in the lead\'s own industry first (e.g. Bloom Bank / Amanano Rural Bank for finance, Adansi Travels for travel & hospitality, Multimedia for media).',
    ].join('\n'),
    tags: ['social proof'],
  },
  {
    key: 'event-ceo-masterclass-c5',
    kind: 'event',
    title: 'Executive AI Masterclass for CEOs (Cohort 5)',
    summary: '2-day hands-on strategic AI masterclass for Ghanaian CEOs, MDs and founders. Limited to the first 30 CEOs.',
    body: [
      'Dates: Friday 13 – Saturday 14 November 2026, 9:00am–4:45pm GMT both days. In person, beginner friendly.',
      'Venue: Africon AI Training and Innovation Centre, East Legon, Accra.',
      'Price: GHS 4,250 per person early bird (until 9 November); GHS 5,000 standard.',
      'Who: CEOs, MDs and founders in Ghana. No prior AI knowledge required. Limited to 30 seats.',
      'Outcomes: a CEO-level AI Playbook to guide internal AI conversations; AI risks, ethical leadership and data governance; turning company documents into an intelligent assistant with NotebookLM; automatic meeting summaries and action plans with Read AI; board decks and strategy reports with Gamma; ChatGPT for decision-making, communication and ideation.',
      'Included: participation certificate, coffee breaks and lunch both days, course materials and the CEO AI Playbook, post-training access to selected AI resources.',
      'Facilitator: Gideon Asare.',
      'Payment: Paystack (mobile money, card, bank transfer); reserve now and pay later.',
      'Selling angle: "beyond the buzzwords" — leave with tools set up and a playbook to lead AI adoption; only 30 seats; previous cohorts drew executives from banking, hospitality, manufacturing, ICT, logistics and education.',
    ].join('\n'),
    data: {
      start_date: '2026-11-13', end_date: '2026-11-14', time: '9:00am–4:45pm GMT', venue: 'Africon Training Centre, East Legon, Accra',
      format: 'in person', price: 'GHS 5,000', early_bird: 'GHS 4,250 until 9 Nov', booking_deadline: '2026-11-12', capacity: 30,
      url: 'https://africon.ai/events/executive-ai-masterclass-for-ceos',
      target_roles: ['CEO', 'Managing Director', 'MD', 'Founder', 'Co-founder', 'Owner', 'Executive Director', 'President', 'Chairman', 'General Manager'],
      target_industries: ['banking', 'hospitality', 'manufacturing', 'ICT', 'logistics', 'education', 'real estate', 'retail', 'health'],
      keywords: ['ceo', 'founder', 'managing director', 'executive', 'leadership', 'business owner'],
    },
    tags: ['masterclass', 'executive'],
  },
  {
    key: 'event-ai-adoption-2027',
    kind: 'event',
    title: 'Build AI Adoption into Your 2027 Plans (with CEIBS Africa)',
    summary: 'One-day hands-on programme with CEIBS Africa for leaders, managers and HR heads — leave with a draft 2027 AI adoption plan.',
    body: [
      'Date: Thursday 26 November 2026, 8:00am–4:00pm GMT (doors 8:00, programme 9:00).',
      'Venue: CEIBS Africa Auditorium, 5 Monrovia Road, East Legon, Accra.',
      'Fee: GHS 4,000 per participant, lunch and coffee included. 80 slots. Bookings close Friday 20 November 2026.',
      'Who: CEOs, business owners and leaders; senior managers and heads of department; HR directors and people leaders responsible for staff capability.',
      'Agenda: setup help with AI tools → welcome (CEIBS Africa & Africon) → AI in simple terms → responsible AI: ethics & governance → hands-on tool setup and customisation → prompt engineering with Africon\'s prompting framework → AI strategy and adoption for organisations → group practical: build the organisation\'s 2027 AI adoption plan → presentations & Q&A → certificates.',
      'Outcomes: AI tools set up and ready; a practical prompting method; a draft 2027 AI adoption plan for the team; responsible AI (ethics, data security, governance); certificate with unique ID and QR verification.',
      'Facilitators: Gideon Asare; Oscar Mills (Chartered Data Analyst, PMP, senior AI instructor); Nadiet Azanu (Sales & Marketing Lead).',
      'Booking: Paystack (card / mobile money) confirms immediately; companies can request an invoice (slot held up to 7 days); team bookings up to 10 slots per order; substitutions until Monday 23 November.',
      'Bring: charged laptop, access to work email, one real work challenge. No paid AI subscription needed.',
      'Selling angle: it is budget season — this is the day to put AI into the 2027 plan; CEIBS co-branding; ideal for HR/L&D heads sending a team; invoice option for companies.',
    ].join('\n'),
    data: {
      start_date: '2026-11-26', end_date: '2026-11-26', time: '8:00am–4:00pm GMT', venue: 'CEIBS Africa Auditorium, 5 Monrovia Road, East Legon, Accra',
      format: 'in person', price: 'GHS 4,000', booking_deadline: '2026-11-20', capacity: 80,
      url: 'https://africon.ai/events/ai-adoption-2027',
      target_roles: ['CEO', 'Business owner', 'Founder', 'Managing Director', 'Director', 'Head of Department', 'Senior Manager', 'HR Director', 'HR Manager', 'People', 'L&D', 'Training Manager', 'Strategy', 'Operations Manager', 'COO'],
      target_industries: ['banking', 'finance', 'insurance', 'telecoms', 'manufacturing', 'energy', 'education', 'public sector', 'NGO', 'hospitality', 'logistics', 'health'],
      keywords: ['hr', 'human resource', 'people', 'learning', 'training', 'strategy', 'planning', 'director', 'head of', 'manager'],
    },
    tags: ['masterclass', 'corporate', 'CEIBS'],
  },
  {
    key: 'event-finance-masterclass-c3',
    kind: 'event',
    title: '2-Day Comprehensive AI Masterclass for Finance Professionals (Cohort 3)',
    summary: 'Hands-on AI for finance teams: analysis, forecasting, reporting, reconciliations and workflow automation.',
    body: [
      'Dates: Friday 11 – Saturday 12 December 2026, 9:00am–5:00pm GMT. In person, beginner friendly.',
      'Venue: Africon AI Training and Innovation Centre, East Legon, Accra.',
      'Price: GHS 4,000 per person standard; GHS 3,000 early bird until 13 November (GHS 1,000 off).',
      'Who: must be in the finance field — finance leaders and teams: CFOs, finance managers, accountants, auditors, analysts, controllers, treasury, tax, budget officers, bankers.',
      'Focus: financial analysis, forecasting, reporting, reconciliations and workflow automation, with practical tools, reusable frameworks and industry use cases.',
      'Outcomes: faster analysis and insights; better budgeting and forecasting; time saved through automation; better reports and reconciliations; confidence with AI tools; stronger executive reporting.',
      'Included: guided setup of essential AI tools; reusable finance workflows; hands-on exercises; AI Finance Toolkit (templates, prompts, resources); lunch and refreshments; post-training support; certificate of completion.',
      'Facilitator: Gideon Asare (has led AI initiatives in finance).',
      'Payment: Paystack (mobile money, card, bank transfer); reserve now and pay later.',
      'Selling angle: year-end close and 2027 budgeting are around the corner; early bird saves GHS 1,000 if booked by 13 Nov; cohort 3 = proven format; finance clients include Bloom Bank Africa and Amanano Rural Bank.',
    ].join('\n'),
    data: {
      start_date: '2026-12-11', end_date: '2026-12-12', time: '9:00am–5:00pm GMT', venue: 'Africon Training Centre, East Legon, Accra',
      format: 'in person', price: 'GHS 4,000', early_bird: 'GHS 3,000 until 13 Nov', booking_deadline: '2026-12-10',
      url: 'https://africon.ai/events/2-day-comprehensive-ai-masterclass-for-finance-professionals-cohort-3',
      target_roles: ['CFO', 'Finance Director', 'Finance Manager', 'Accountant', 'Chartered Accountant', 'Auditor', 'Financial Analyst', 'Controller', 'Treasury', 'Tax', 'Budget Officer', 'Credit Officer', 'Relationship Manager', 'Banker', 'Investment Analyst'],
      target_industries: ['banking', 'finance', 'microfinance', 'rural bank', 'insurance', 'accounting', 'audit', 'fintech', 'investment', 'pension', 'asset management'],
      keywords: ['finance', 'financial', 'accounting', 'accountant', 'audit', 'bank', 'cfo', 'tax', 'treasury', 'budget', 'insurance', 'investment', 'credit', 'microfinance'],
    },
    tags: ['masterclass', 'finance'],
  },
  {
    key: 'event-robotics-after-school',
    kind: 'event',
    title: 'Robotics & AI After-School Programme (ages 4–17)',
    summary: 'Hands-on robotics, coding and AI for children 4–17, after school and Saturdays, with a final project showcase.',
    body: [
      'Runs: Monday 21 September – Monday 7 December 2026. Mon–Thu 4:00–5:00pm; Saturday 9:00–11:30am and 12:30–3:30pm; make-up classes Friday 9am–5pm.',
      'Venue: Africon centre, East Legon, Accra (delivered with Aslan Robotics).',
      'Price: GHS 1,500 per child; early bird GHS 1,200. Maximum 25 students; grouped by age and level.',
      'Curriculum: building and programming robots (WeDo, EV3, RAF 1.0 kits), sensors and motors, coding logic, engineering challenges, final engineering project and showcase.',
      'Included: supervised environment, snacks and water, kits, certificate of completion.',
      'Who to call: parents — especially executives and professionals already in our lists who have children; schools and PTA contacts.',
      'Programme team: 055 242 5644 / 059 241 2150.',
    ].join('\n'),
    data: {
      start_date: '2026-09-21', end_date: '2026-12-07', venue: 'Africon centre, East Legon, Accra', format: 'in person',
      price: 'GHS 1,500', early_bird: 'GHS 1,200', capacity: 25,
      url: 'https://africon.ai/events/robotics-ai-after-school-programme',
      target_roles: ['Parent', 'Head teacher', 'School administrator', 'Teacher'],
      target_industries: ['education', 'schools'],
      keywords: ['school', 'parent', 'teacher', 'education', 'stem', 'kids', 'children'],
    },
    tags: ['kids', 'STEM'],
  },
  {
    key: 'program-ai-sprints',
    kind: 'program',
    title: 'AI Sprints — master a practical AI skill in two hours',
    summary: 'Weekly 2-hour hands-on courses (online or in person) on one tool or skill, 6 Oct – 24 Dec 2026. From GHS 400.',
    body: [
      'What: two-hour hands-on courses; participants bring a real work task and finish it in the session. Online, or in person in East Legon (in-person ends Thu 17 Dec; 22–24 Dec online only).',
      'Schedule (weekly, GMT): Tue 09:00 Sprint 01 Prompt Foundation (SCRIBE method); Tue 12:00 Sprint 03 ChatGPT Inside Out; Tue 15:00 Sprint 04 Claude Inside Out; Wed 09:00 Sprint 02 Prompt Intermediate (CRIT method); Wed 12:00 Sprint 05 Gemini Notebook (NotebookLM) Inside Out; Wed 15:00 Sprint 06 Gamma Inside Out; Thu 09:00 Sprint 07 Read AI Inside Out; Thu 12:00 Sprint 08 Gemini Inside Out; Thu 15:00 Sprint 09 AI Governance & Ethics.',
      'Prices: Sprints 01–08 GHS 400 online / GHS 500 in person; Sprint 09 GHS 800 online / GHS 1,000 in person; pack of three online GHS 999; group bookings (2–30 people) from GHS 400 per person per course; private session for one organisation GHS 7,500 for up to 30 people, any course, any time.',
      'Included: live session, course playbook with every step and prompt, certificate within 48 hours, recording for 30 days. Two certified facilitators per sprint.',
      'Who: professionals, managers, business owners and students — no technical background needed. New learners start with Prompt Foundation.',
      'Policies: free date/course change up to 48 hours before; full refund if cancelled more than 7 days ahead.',
      'Selling angle: the low-commitment entry product — perfect for leads who say the masterclass is too expensive or too long; private GHS 7,500 session is a strong corporate upsell; pack of three is good value.',
      'Booking: africon.ai/sprints#book. Sales: sales@africon.ai.',
    ].join('\n'),
    data: {
      start_date: '2026-10-06', end_date: '2026-12-24', format: 'online or in person', price: 'from GHS 400',
      url: 'https://africon.ai/sprints',
      target_roles: ['Professional', 'Manager', 'Business owner', 'Student', 'Executive assistant', 'Marketing', 'HR', 'Admin'],
      target_industries: [],
      keywords: ['productivity', 'chatgpt', 'prompt', 'tools'],
    },
    tags: ['sprints', 'entry product'],
  },
  {
    key: 'program-aikasa',
    kind: 'program',
    title: 'AIKASA — guided AI implementation community',
    summary: 'Africon\'s membership: short lessons, live sessions, templates, weekly challenges and a community. Waitlist open.',
    body: [
      'What: a guided AI learning and implementation ecosystem for African professionals — "AI that works". Short lessons, live support sessions, a Toolbox of templates, weekly challenges and a community of practice.',
      'Tracks launching first: AI for Daily Productivity; AI for Business & Entrepreneurship (sales, marketing, operations); AI Navigation & Clarity. Planned next: AI Leadership & Workplace Transformation; AI for Careers & Employability; Responsible AI, Ethics & Governance.',
      '90-day GROW path: days 1–7 quick win; 8–30 confidence; 31–60 own the habit; 61–90 win with a documented transformation project.',
      'Time: about 1–2 hours per week; mobile friendly. Ghana members get in-person office hours by appointment; others online.',
      'Status: founding registration closed 15 July 2026; new paid registration closed; waitlist is free (no payment or price reservation). Plans and prices to be shared before joining.',
      'Who: professionals, entrepreneurs, business owners, students, job seekers, managers, executives and organisations.',
      'Selling angle: invite every training graduate and every lead who is "not ready to pay now" to join the waitlist — it keeps them warm for the next paid offer.',
      'Link: africon.ai/aikasa#waitlist.',
    ].join('\n'),
    data: { url: 'https://africon.ai/aikasa', price: 'waitlist (free)', format: 'online community + office hours', keywords: ['community', 'membership'] },
    tags: ['membership', 'nurture'],
  },
  {
    key: 'offering-corporate-training',
    kind: 'offering',
    title: 'Corporate AI training',
    summary: 'Executive briefings, departmental workshops and engineering cohorts tailored to each team\'s daily tools.',
    body: [
      'Formats: executive briefings, departmental workshops, engineering-level cohorts; content tailored to the tools each team uses.',
      'References: Adansi Travels (70 staff), Multimedia Group (80 trained), Stem Robo, Bloom Bank Africa executive session, VRA HR, African Union Commission.',
      'Also: private AI Sprint for one organisation (GHS 7,500, up to 30 people).',
      'Next step: "Request proposal" (africon.ai/contact?service=corporate-training) or a free 30-minute consultation.',
      'Who to call: HR / L&D heads, training managers, CEOs and MDs of companies with 20+ staff.',
    ].join('\n'),
    data: { url: 'https://africon.ai/services/ai-training', target_roles: ['HR Director', 'HR Manager', 'L&D', 'Training Manager', 'CEO', 'MD'], keywords: ['hr', 'training', 'staff', 'team'] },
    tags: ['B2B'],
  },
  {
    key: 'offering-consultancy',
    kind: 'offering',
    title: 'AI consultancy & long-term partnership',
    summary: 'Readiness assessment, AI strategy roadmap, tool selection and implementation guidance; month-by-month partnerships.',
    body: [
      'Consultancy: AI readiness assessment → strategy roadmap → tool selection → implementation guidance.',
      'Partnership: long-term, month-by-month engagement that builds AI capability inside the client organisation.',
      'Partnerships for AI vendors: co-selling, certified training delivery, implementation services and revenue share for AI tooling companies entering Ghana, Nigeria and West Africa.',
      'Entry point: free 30-minute AI readiness consultation; response within 24 hours.',
      'Who: leadership teams that attended a masterclass or the 2027 planning day and now want help executing.',
    ].join('\n'),
    data: { url: 'https://africon.ai/services/ai-consulting', target_roles: ['CEO', 'COO', 'CTO', 'Strategy', 'Transformation', 'IT Director'], keywords: ['strategy', 'digital transformation', 'innovation'] },
    tags: ['B2B'],
  },
  {
    key: 'offering-ai-solutions',
    kind: 'offering',
    title: 'Custom AI solutions & digital projects',
    summary: 'Chatbots (WhatsApp, web, Messenger), internal AI assistants on your CRM/data, automation, AI analytics, integrations.',
    body: [
      'Included: customer-facing chatbots on WhatsApp, web and Messenger; internal assistants connected to CRM and data; process automation; AI analytics on existing dashboards; integrations (Paystack, Zoho, HubSpot, custom APIs); three months of post-launch support.',
      'Also: software, websites, apps and custom platforms — starts with a 7–12 minute project brief (africon.ai/start-project).',
      'Who: operations, customer-service and IT leads; businesses with high WhatsApp/customer volume (banks, travel, retail, telecoms, health).',
    ].join('\n'),
    data: { url: 'https://africon.ai/services/ai-solutions', target_roles: ['CTO', 'IT Manager', 'Operations Manager', 'Customer Service Manager', 'Digital Manager'], keywords: ['it', 'technology', 'digital', 'customer service', 'operations'] },
    tags: ['B2B', 'build'],
  },
  {
    key: 'offering-social-media',
    kind: 'offering',
    title: 'Social media management',
    summary: 'Content calendars, community management, paid ads (Meta, TikTok, LinkedIn) and analytics for African brands.',
    body: 'Monthly in-house content calendar; daily community management and inbox response; paid ads on Meta, TikTok and LinkedIn with regional targeting; quarterly growth sprints; cross-platform campaigns; monthly analytics review with recommendations.',
    data: { url: 'https://africon.ai/services/social-media-management', target_roles: ['Marketing Manager', 'Brand Manager', 'Communications', 'Business owner'], keywords: ['marketing', 'brand', 'communications', 'social media'] },
    tags: ['B2B'],
  },
  {
    key: 'audience-segments',
    kind: 'audience',
    title: 'Who buys what (target segments)',
    summary: 'Executives → CEO masterclass & consultancy; finance teams → finance masterclass; HR/L&D → corporate training & 2027 planning day; individuals → AI Sprints & AIKASA; parents → robotics.',
    body: [
      'Executives (CEO, MD, founder, GM, director): Executive AI Masterclass, Build AI Adoption into Your 2027 Plans, consultancy, private sprints.',
      'Finance (CFO, finance manager, accountant, auditor, banker, insurance, microfinance, rural banks): Finance Masterclass; Sprint 09 Governance for risk/compliance.',
      'HR, L&D and people leaders: corporate training, 2027 planning day (send a team), private sprint (GHS 7,500 for 30 staff).',
      'Managers and professionals (marketing, sales, operations, admin, executive assistants): AI Sprints (start with Prompt Foundation), AIKASA waitlist.',
      'IT / operations / customer service: AI solutions (chatbots, automation), consultancy.',
      'Parents and schools: Robotics & AI after-school programme.',
      'Industries with proven wins: banking & microfinance, hospitality & travel, media, manufacturing, ICT, logistics, education, energy, public sector & NGOs.',
      'Past attendees: offer the next step — CEO masterclass graduates → 2027 planning day for their team or consultancy; sprint graduates → pack of three or AIKASA.',
    ].join('\n'),
    tags: ['segmentation'],
  },
  {
    key: 'playbook-calls',
    kind: 'playbook',
    title: 'Sales call playbook',
    summary: 'Open with the lead\'s role and a same-industry client, sell the outcome, handle price with early bird / sprints / invoice, always book the next step.',
    body: [
      'Daily target: at least 100 calls per salesperson. Log every outcome so the AI can schedule the follow-up.',
      'Opening: name, Africon, award ("Best AI Startup of the Year 2026"), and why you are calling THIS person (role + upcoming event that fits).',
      'Discovery: what does your team spend too much time on? (reports, proposals, meeting notes, customer replies, reconciliations). Tie the answer to a concrete outcome from the event.',
      'Proof: mention a client from their industry (banks: Bloom Bank Africa, Amanano Rural Bank; travel/hospitality: Adansi Travels; media: Multimedia; energy: VRA, Matrix Energy).',
      'Price objections: (1) early bird deadline; (2) company invoice / sponsorship by employer; (3) "reserve now, pay later" on Paystack; (4) smaller entry: a GHS 400 AI Sprint; (5) group or private sessions for teams.',
      '"I\'m busy": the CEO class is 2 days, the planning day is 1 day, a sprint is 2 hours online.',
      '"I already use ChatGPT": the value is the frameworks (SCRIBE/CRIT prompting), playbooks, governance and a plan — not the tool.',
      'Not ready: add to the AIKASA waitlist and log a follow-up date.',
      'WhatsApp: after a no-answer, send a short WhatsApp with the event link, then call again at a different time of day.',
      'Close: book the seat (Paystack link) or the invoice request; for teams, ask for the HR/L&D contact.',
    ].join('\n'),
    tags: ['sales'],
  },
  {
    key: 'policies',
    kind: 'policy',
    title: 'Booking, payment and refund policies',
    summary: 'Paystack (card, MoMo, bank); reserve now pay later; invoices for companies; substitutions allowed; sprints changeable up to 48h.',
    body: [
      'Payment: Paystack secure checkout — mobile money, card, bank transfer. Masterclasses allow "reserve now, pay later".',
      'Companies: request an invoice; slots held up to 7 days while it is approved. Team bookings up to 10 slots per order (2027 planning day).',
      'Substitutions: send a colleague (2027 planning day: by Monday 23 November).',
      'Postponement by Africon: full refund or free transfer.',
      'AI Sprints: free change of date/course up to 48 hours before; full refund if cancelled more than 7 days ahead (africon.ai/sprints/policies).',
      'Certificates: issued by Africon; 2027 planning day certificates have a unique ID and QR verification; sprint certificates within 48 hours.',
    ].join('\n'),
    tags: ['policy'],
  },
  {
    key: 'contact',
    kind: 'contact',
    title: 'Contact details & links',
    summary: 'info@africon.ai · sales@africon.ai · +233 247 429 359 (WhatsApp) · +233 20 633 6572.',
    body: [
      'Email: info@africon.ai (general), sales@africon.ai (sales).',
      'Phone / WhatsApp: +233 247 429 359; also +233 20 633 6572.',
      'Address: Africon AI Training and Innovation Centre, No. 2, 2nd Nii Kokonya Road, East Legon, Accra.',
      'Links: events africon.ai/events · sprints africon.ai/sprints · AIKASA africon.ai/aikasa · shop shop.africon.ai · affiliates africon.ai/affiliates · teach with us africon.ai/teach.',
      'Social: LinkedIn linkedin.com/company/africonai · Instagram @africon.ai · X @AfriconAi · YouTube @AfricaAIConsult · TikTok @africon.ai.for.gr.',
    ].join('\n'),
    tags: ['contact'],
  },
];

// ── Store ───────────────────────────────────────────────────────────────────

function rowToItem(r: any): ContextItem {
  return {
    ...r,
    data: r.data && typeof r.data === 'object' ? r.data : {},
    tags: Array.isArray(r.tags) ? r.tags : [],
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

export async function listContextItems(pool: Pool, userId: string, opts: { kind?: ContextKind; activeOnly?: boolean } = {}): Promise<ContextItem[]> {
  const where = ['user_id=$1'];
  const params: unknown[] = [userId];
  if (opts.kind) { params.push(opts.kind); where.push(`kind=$${params.length}`); }
  if (opts.activeOnly) where.push('active');
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM company_context_items WHERE ${where.join(' AND ')}
      ORDER BY array_position($${params.length + 1}::text[], kind), position, (data->>'start_date') NULLS LAST, created_at`,
    [...params, [...CONTEXT_KINDS]],
  );
  return rows.map(rowToItem);
}

export async function getContextItem(pool: Pool, userId: string, id: string): Promise<ContextItem | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM company_context_items WHERE id=$1 AND user_id=$2`, [id, userId]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export interface ContextInput {
  kind: ContextKind;
  title: string;
  summary?: string | null;
  body?: string | null;
  data?: EventData;
  tags?: string[];
  position?: number;
  active?: boolean;
}

export async function createContextItem(pool: Pool, userId: string, input: ContextInput, source: 'manual' | 'ai' = 'manual'): Promise<ContextItem> {
  const { rows } = await pool.query(
    `INSERT INTO company_context_items (user_id, kind, title, summary, body, data, tags, position, active, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLUMNS}`,
    [userId, input.kind, input.title, input.summary ?? null, input.body ?? null, JSON.stringify(input.data ?? {}),
      input.tags ?? [], input.position ?? 0, input.active ?? true, source],
  );
  return rowToItem(rows[0]);
}

export async function updateContextItem(pool: Pool, userId: string, id: string, patch: Partial<ContextInput>): Promise<ContextItem | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, userId];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col}=$${params.length}`); };
  if (patch.kind !== undefined) set('kind', patch.kind);
  if (patch.title !== undefined) set('title', patch.title);
  if (patch.summary !== undefined) set('summary', patch.summary);
  if (patch.body !== undefined) set('body', patch.body);
  if (patch.data !== undefined) set('data', JSON.stringify(patch.data));
  if (patch.tags !== undefined) set('tags', patch.tags);
  if (patch.position !== undefined) set('position', patch.position);
  if (patch.active !== undefined) set('active', patch.active);
  if (!sets.length) return getContextItem(pool, userId, id);
  const { rows } = await pool.query(
    `UPDATE company_context_items SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function deleteContextItem(pool: Pool, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM company_context_items WHERE id=$1 AND user_id=$2`, [id, userId]);
  return Boolean(rowCount);
}

/** Adds the Africon defaults whose seed_key is missing. Returns how many were added. */
export async function seedAfriconContext(pool: Pool, userId: string): Promise<number> {
  let added = 0;
  for (const [i, s] of AFRICON_SEED.entries()) {
    const { rowCount } = await pool.query(
      `INSERT INTO company_context_items (user_id, kind, title, summary, body, data, tags, position, source, seed_key)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,'seed',$9
        WHERE NOT EXISTS (SELECT 1 FROM company_context_items WHERE user_id=$1 AND seed_key=$9)`,
      [userId, s.kind, s.title, s.summary, s.body, JSON.stringify(s.data ?? {}), s.tags ?? [], i, s.key],
    );
    added += rowCount ?? 0;
  }
  await pool.query(
    `INSERT INTO company_context_seeds (user_id, seed) VALUES ($1, 'africon') ON CONFLICT DO NOTHING`,
    [userId],
  );
  return added;
}

/** Boot-time: seeds Africon context once for every admin account that never had it. */
export async function seedAdminCompanyContext(pool: Pool): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT u.id FROM users u
        WHERE u.role='admin'
          AND NOT EXISTS (SELECT 1 FROM company_context_seeds s WHERE s.user_id=u.id AND s.seed='africon')`,
    );
    for (const r of rows) {
      const n = await seedAfriconContext(pool, r.id);
      logger.info({ userId: r.id, added: n }, 'company_context_seeded');
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'company_context_seed_failed');
  }
}

// ── Prompt rendering ────────────────────────────────────────────────────────

/** An event is upcoming while its end (or start) date is today or later. */
export function isUpcoming(item: Pick<ContextItem, 'kind' | 'data'>, todayKey: string): boolean {
  const end = (item.data?.end_date || item.data?.start_date) as string | undefined;
  if (!end) return true;
  return end >= todayKey;
}

function fmtData(d: EventData): string {
  const parts: string[] = [];
  if (d.start_date) parts.push(`dates ${d.start_date}${d.end_date && d.end_date !== d.start_date ? ` → ${d.end_date}` : ''}`);
  if (d.time) parts.push(`time ${d.time}`);
  if (d.venue) parts.push(`venue ${d.venue}`);
  if (d.format) parts.push(`format ${d.format}`);
  if (d.price) parts.push(`price ${d.price}`);
  if (d.early_bird) parts.push(`early bird ${d.early_bird}`);
  if (d.booking_deadline) parts.push(`booking closes ${d.booking_deadline}`);
  if (d.capacity) parts.push(`capacity ${d.capacity}`);
  if (d.target_roles?.length) parts.push(`target roles: ${d.target_roles.join(', ')}`);
  if (d.target_industries?.length) parts.push(`target industries: ${d.target_industries.join(', ')}`);
  if (d.url) parts.push(`link ${d.url}`);
  return parts.join(' · ');
}

export function renderContext(items: ContextItem[], todayKey: string, opts: { maxChars?: number; detail?: 'full' | 'summary' } = {}): string {
  const max = opts.maxChars ?? 24000;
  const active = items.filter((i) => i.active && (i.kind !== 'event' || isUpcoming(i, todayKey)));
  const events = active.filter((i) => i.kind === 'event').sort((a, b) => String(a.data.start_date ?? '').localeCompare(String(b.data.start_date ?? '')));
  const rest = active.filter((i) => i.kind !== 'event');
  const order: ContextItem[] = [...rest.filter((i) => i.kind === 'overview'), ...events, ...rest.filter((i) => i.kind !== 'overview')];
  const out: string[] = [`Today is ${todayKey}.`];
  for (const i of order) {
    const head = `### [${CONTEXT_KIND_LABELS[i.kind]}] ${i.title}${i.kind === 'event' || i.kind === 'program' ? ` (id ${i.id})` : ''}`;
    const data = fmtData(i.data);
    const text = opts.detail === 'summary' ? (i.summary ?? '') : [i.summary, i.body].filter(Boolean).join('\n');
    out.push([head, data, text].filter(Boolean).join('\n'));
  }
  let s = out.join('\n\n');
  if (s.length > max) s = `${s.slice(0, max)}\n[… company context truncated]`;
  return s;
}

export async function companyContextBlock(pool: Pool, userId: string, todayKey: string, opts: { maxChars?: number; detail?: 'full' | 'summary' } = {}): Promise<string> {
  try {
    const items = await listContextItems(pool, userId, { activeOnly: true });
    if (!items.length) return '';
    return renderContext(items, todayKey, opts);
  } catch {
    return '';
  }
}
