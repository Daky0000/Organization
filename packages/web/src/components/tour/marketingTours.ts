import type { Tour } from './tourCore';

// ─────────────────────────────────────────────────────────────────────────────
// Marketing is big, so it gets one short tour per tool rather than one long
// tour of everything. Each tour runs on its own page, points at the real
// controls (data-tour="…" in the page), and says only what the tool does.
//
// MARKETING_SETUP_ORDER is the order to set things up in: people first, then
// the ways to reach them, then measuring.
// ─────────────────────────────────────────────────────────────────────────────

export const MARKETING_TOURS: Record<string, Tour> = {
  'marketing-overview': {
    id: 'marketing-overview',
    page: 'marketing',
    scope: 'marketing',
    title: 'Marketing',
    summary: 'Where every marketing tool lives, what the numbers mean, and the order to set things up.',
    minutes: 1,
    welcome: {
      title: 'Welcome to Marketing',
      body: 'Contacts, email, campaigns, automations, forms, surveys and leads all live here. This tour shows you around in about a minute.',
    },
    done: ['Find every tool under Marketing', 'Read your email and campaign health', 'Set things up in order, with a tour for each tool'],
    steps: [
      { id: 'menu', target: '[data-tour="nav-marketing"]', side: 'right', title: 'Every marketing tool, in one menu', body: 'Contacts, Email, Campaigns, Surveys, Automations, Forms and Lead Generation are all under Marketing. Your social content is here too.' },
      { id: 'email-health', target: '[data-tour="mk-email-health"]', title: 'How your emails are doing', body: 'How many contacts you have, how many unsubscribed, and how often your emails are opened and clicked.' },
      { id: 'campaigns', target: '[data-tour="mk-campaign-overview"]', title: 'Campaigns at a glance', body: 'How many campaigns are running, and the clicks and conversions they have brought in.' },
      { id: 'summaries', target: '[data-tour="mk-summaries"]', optional: true, title: 'Jump straight in', body: 'See what is sent, drafted or scheduled, and which campaigns are live — then open Email or Campaigns from here.' },
      { id: 'setup', target: '[data-tour="mk-tours"]', title: 'Set it up in this order', body: 'Start with your contacts, then a form to collect more, then emails and automations. Each tool has its own one-minute tour — start one here, or from the ? button on any page.' },
    ],
  },

  'marketing-contacts': {
    id: 'marketing-contacts',
    page: 'marketing-contacts',
    scope: 'contacts',
    title: 'Contacts',
    summary: 'Find, add and import the people you market to, and group them into segments.',
    minutes: 1,
    done: ['Search and filter people by how engaged they are', 'Import a list or add someone by hand', 'Group people with segments that update themselves'],
    steps: [
      { id: 'tabs', target: '[data-tour="contacts-tabs"]', title: 'Your audience, four ways', body: 'Contacts is everyone you can email. Segments are saved groups. Analytics shows how your list grows. Leads holds prospects you have imported.' },
      { id: 'search', target: '[data-tour="contacts-search"]', tab: 'contacts', optional: true, title: 'Find anyone fast', body: 'Search by name or email. Hot, Warm and Cold filter by lead score, and Sort by score puts the most engaged people first.' },
      { id: 'import', target: '[data-tour="contacts-import"]', tab: 'contacts', optional: true, title: 'Bring your list in', body: 'Import a CSV from another tool to start with everyone you already know. Export takes a copy out any time.' },
      { id: 'add', target: '[data-tour="contacts-add"]', tab: 'contacts', optional: true, title: 'Or add one person', body: 'Add a contact by hand with their name, email and tags. Tags are how automations and segments pick people out.' },
      { id: 'segments', target: '[data-tour="tab-segments"]', waitFor: 'contacts-tab:segments', doText: 'Try it: open Segments', title: 'Group people automatically', body: 'A segment is a saved filter — by email, tags or activity. It updates itself as your contacts change.' },
      { id: 'new-segment', target: '[data-tour="segments-new"]', tab: 'segments', optional: true, title: 'Make your first segment', body: 'Choose conditions like "tag is customer" and save it. When you write an email, you can send it to just this segment.' },
    ],
  },

  'marketing-forms': {
    id: 'marketing-forms',
    page: 'marketing-forms',
    scope: 'forms',
    title: 'Forms',
    summary: 'Collect new contacts from your website with a form.',
    minutes: 1,
    done: ['Build a form with the fields you need', 'Put it on your site, or share its link', 'Every submission becomes a contact'],
    steps: [
      { id: 'create', target: '[data-tour="forms-create"]', title: 'Collect leads from your site', body: 'Build a form with the fields you need. Every submission lands in Contacts and can start an automation.' },
      { id: 'list', target: '[data-tour="forms-list"]', optional: true, title: 'Embed it or share it', body: 'Each form counts its submissions. Embed gives you code for your website, plus a hosted link you can share anywhere. Pause a form to stop new submissions.' },
    ],
  },

  'marketing-email': {
    id: 'marketing-email',
    page: 'marketing-email',
    scope: 'email',
    title: 'Email',
    summary: 'Write an email, choose who gets it, send or schedule it, and see how it did.',
    minutes: 1,
    done: ['Compose an email and pick who gets it', 'Send now or schedule for later', 'Check opens, clicks and unsubscribes'],
    steps: [
      { id: 'tabs', target: '[data-tour="email-tabs"]', title: 'Everything email, four tabs', body: 'Emails are your sends. Automations are emails that send themselves. Analytics shows opens and clicks. Lead Scores ranks your most engaged contacts.' },
      { id: 'compose', target: '[data-tour="email-compose"]', tab: 'emails', optional: true, title: 'Write an email', body: 'Compose opens the editor. Write it, then choose who gets it: all contacts or one segment.' },
      { id: 'list', target: '[data-tour="email-list"]', tab: 'emails', optional: true, title: 'Drafts, scheduled and sent', body: 'Every email shows where it is. A draft can be sent now — you are asked to confirm first — or scheduled with the clock.' },
      { id: 'analytics', target: '[data-tour="tab-email-analytics"]', waitFor: 'email-tab:analytics', doText: 'Try it: open Analytics', title: 'See what landed', body: 'Open rate, click rate and unsubscribes for every email you have sent.' },
    ],
  },

  'marketing-automations': {
    id: 'marketing-automations',
    page: 'marketing-automations',
    scope: 'automations',
    title: 'Automations',
    summary: 'Workflows that reach people at the right moment, on their own.',
    minutes: 1,
    done: ['Start a workflow from something a contact does', 'Chain steps: emails, waits, conditions, tags', 'Pause or edit a workflow any time'],
    steps: [
      { id: 'create', target: '[data-tour="auto-create"]', title: 'Let it run on its own', body: 'An automation starts when something happens — a tag is added, someone signs up, clicks a link, opens an email or has a birthday — and then works through its steps.' },
      { id: 'steps', target: '[data-tour="auto-steps"]', title: 'The building blocks', body: 'Wait, check a condition, split people, send an email, SMS or survey, add or remove tags and groups, update the contact, score the lead or notify your team.' },
      { id: 'list', target: '[data-tour="auto-list"]', optional: true, title: 'On, off and edit', body: 'Each automation shows whether it is active. Pause one at any time, or open it to change its steps.' },
    ],
  },

  'marketing-campaigns': {
    id: 'marketing-campaigns',
    page: 'marketing-campaigns',
    scope: 'campaigns',
    title: 'Campaigns',
    summary: 'Group your work toward one goal, track every link, and measure what worked.',
    minutes: 1,
    done: ['Build a campaign step by step', 'Track clicks per channel with UTM links', 'Compare what each campaign brought in'],
    steps: [
      { id: 'tabs', target: '[data-tour="campaigns-tabs"]', title: 'One goal, four views', body: 'A campaign groups your work toward one goal. Funnels show how people move through it, UTM Links track where clicks come from, and Performance adds it all up.' },
      { id: 'new', target: '[data-tour="campaigns-new"]', tab: 'campaigns', optional: true, title: 'Start a campaign', body: 'The builder walks you through it: pick a template, set the goal, choose channels, write the messages, make tracked links, then review.' },
      { id: 'view', target: '[data-tour="campaigns-view"]', tab: 'campaigns', optional: true, title: 'List or calendar', body: 'Switch to Calendar to see your campaigns laid out by date.' },
      { id: 'links', target: '[data-tour="tab-campaigns-links"]', waitFor: 'campaigns-tab:links', doText: 'Try it: open UTM Links', title: 'Know which link worked', body: 'Each UTM link counts its clicks by channel, so you can see which post or email brought people in.' },
    ],
  },

  'marketing-surveys': {
    id: 'marketing-surveys',
    page: 'marketing-surveys',
    scope: 'surveys',
    title: 'Surveys',
    summary: 'Ask your audience questions and see the answers.',
    minutes: 1,
    done: ['Create a survey and add questions', 'Share its public link', 'Read the answers in Analytics'],
    steps: [
      { id: 'new', target: '[data-tour="surveys-new"]', title: 'Ask your audience', body: 'Create a survey and add your questions. Set it to Active to get a public link you can share.' },
      { id: 'list', target: '[data-tour="surveys-list"]', optional: true, title: 'Answers in one place', body: 'Open a survey to edit it and copy its link. Analytics shows how people answered.' },
    ],
  },

  'marketing-leads': {
    id: 'marketing-leads',
    page: 'marketing-leads',
    scope: 'leads',
    title: 'Lead Generation',
    summary: 'Every prospect from first contact to close.',
    minutes: 1,
    done: ['Add a lead or import a spreadsheet', 'See how many leads you can reach', 'Search and filter to find the right people'],
    steps: [
      { id: 'actions', target: '[data-tour="leads-actions"]', title: 'Your prospect pipeline', body: 'Add one prospect with New lead, or bring a whole spreadsheet in with Import sheet. Choose which columns you see, and export when you need a copy.' },
      { id: 'stats', target: '[data-tour="leads-stats"]', optional: true, title: 'Who you can reach', body: 'How many leads you have, how many were added this week, and how many have an email or phone number.' },
      { id: 'filters', target: '[data-tour="leads-filters"]', optional: true, title: 'Narrow it down', body: 'Search by name, company, email or city, and filter by where the lead came from.' },
    ],
  },

  'marketing-leads-import': {
    id: 'marketing-leads-import',
    page: 'marketing-leads-import',
    scope: 'leads-import',
    title: 'Import Leads',
    summary: 'Bring a spreadsheet of leads in, safely.',
    minutes: 1,
    done: ['Upload a spreadsheet', 'Check how each column will be read', 'Nothing is saved until the last step'],
    steps: [
      { id: 'upload', target: '[data-tour="import-upload"]', title: 'Three steps, nothing saved until the end', body: 'Upload a spreadsheet, check how each column will be read and fix anything that looks wrong, then import. Nothing is written until the last step.' },
    ],
  },
};

/** The order to set Marketing up in (shown on the overview). */
export const MARKETING_SETUP_ORDER: Array<{ tour: string; why: string }> = [
  { tour: 'marketing-contacts', why: 'Bring in the people you already know' },
  { tour: 'marketing-forms', why: 'Collect new contacts from your website' },
  { tour: 'marketing-email', why: 'Send your first email' },
  { tour: 'marketing-automations', why: 'Welcome and follow up automatically' },
  { tour: 'marketing-campaigns', why: 'Group the work and track every link' },
  { tour: 'marketing-surveys', why: 'Ask your audience what they want' },
  { tour: 'marketing-leads', why: 'Work your prospect pipeline' },
];
