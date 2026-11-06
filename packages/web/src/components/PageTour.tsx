import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X, ChevronRight, Compass, Sparkles } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TourStep = {
  title: string;
  description: string;
  emoji?: string;
  target?: string;
  placement?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  illu?: string;
  cta?: string;
  action?: string;
  badge?: string;
  page?: string;
};

type Props = {
  steps: TourStep[];
  pageTitle?: string;
  pageKey?: string;
  forceStart?: boolean;
  onForceStartConsumed?: () => void;
  onStartInteractiveTour?: () => void;
  onStartSystemTour?: () => void;
};

// ── Main export ────────────────────────────────────────────────────────────────

export default function PageTour({
  steps,
  pageTitle,
  pageKey,
  forceStart,
  onForceStartConsumed,
  onStartInteractiveTour,
  onStartSystemTour,
}: Props) {
  const storageKey = `tour_seen_${pageKey ?? pageTitle?.toLowerCase().replace(/\s+/g, '-') ?? 'page'}`;
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => localStorage.getItem(storageKey) === '1');
  const panelRef = useRef<HTMLDivElement>(null);

  function openPanel() {
    setOpen(true);
    if (!seen) {
      localStorage.setItem(storageKey, '1');
      setSeen(true);
    }
  }

  function closePanel() {
    setOpen(false);
    onForceStartConsumed?.();
  }

  // forceStart: open the panel or interactive tour
  useEffect(() => {
    if (forceStart && steps.length > 0) {
      if (onStartSystemTour) {
        onStartSystemTour();
        onForceStartConsumed?.();
      } else {
        const t = setTimeout(() => openPanel(), 300);
        return () => clearTimeout(t);
      }
    }
  }, [forceStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') closePanel(); }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!steps.length) return null;

  return (
    <>
      {/* Floating ? button */}
      <button
        type="button"
        data-tour-id="help-guide-button"
        onClick={openPanel}
        title={`Quick guide${pageTitle ? ` — ${pageTitle}` : ''}`}
        className="fixed bottom-6 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white shadow-menu text-muted hover:text-blue hover:border-blue transition-all"
        style={{ position: 'fixed', right: 88 }}
      >
        <HelpCircle size={16} />
        {!seen && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue rounded-full border-2 border-white" style={{ animation: 'tourDot 2s ease-in-out infinite' }} />
        )}
      </button>

      {/* Compact floating panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-50"
          style={{
            bottom: 56,
            right: 20,
            width: 340,
            background: '#fff',
            borderRadius: 16,
            border: '1px solid #E3E6EB',
            boxShadow: '0 24px 64px -18px rgba(13, 21, 38, 0.24)',
            animation: 'tourPanelIn 220ms cubic-bezier(0.2, 0.7, 0.2, 1)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid #E3E6EB' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: '#EAF1FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <HelpCircle size={14} color="#2563EB" />
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: '#0D1526' }}>{pageTitle || 'Quick guide'}</span>
            </div>
            <button
              type="button"
              onClick={closePanel}
              style={{ width: 24, height: 24, border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A91A0' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F6F7F9'; e.currentTarget.style.color = '#0D1526'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8A91A0'; }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Interactive Walkthrough Action Banners */}
          <div style={{ padding: '10px 14px', background: '#F8FAFC', borderBottom: '1px solid #E3E6EB', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {onStartInteractiveTour && (
              <button
                type="button"
                onClick={() => {
                  closePanel();
                  onStartInteractiveTour();
                }}
                className="flex items-center justify-between w-full rounded-xl bg-blue px-3 py-2 text-left text-xs font-semibold text-white shadow-sm hover:bg-blue-600 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles size={13} />
                  Start {pageTitle || 'Page'} Interactive Tour
                </span>
                <ChevronRight size={13} />
              </button>
            )}

            {onStartSystemTour && (
              <button
                type="button"
                onClick={() => {
                  closePanel();
                  onStartSystemTour();
                }}
                className="flex items-center justify-between w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Compass size={13} className="text-blue" />
                  Take Full System Tour
                </span>
                <ChevronRight size={13} className="text-slate-400" />
              </button>
            )}
          </div>

          {/* Steps list */}
          <div style={{ maxHeight: 290, overflowY: 'auto' }}>
            {steps.map((step, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 12, padding: '12px 16px',
                  borderBottom: i < steps.length - 1 ? '1px solid #E3E6EB' : 'none',
                }}
              >
                {/* Step number / emoji badge */}
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: step.emoji ? '#EAF1FF' : '#2563EB',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: step.emoji ? 16 : 11, fontWeight: 500,
                  color: step.emoji ? 'inherit' : '#fff',
                  marginTop: 1,
                }}>
                  {step.emoji || String(i + 1)}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#0D1526', lineHeight: 1.3 }}>{step.title}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#5B6374', lineHeight: 1.5 }}>{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #E3E6EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#8A91A0' }}>{steps.length} tip{steps.length !== 1 ? 's' : ''}</span>
            <button
              type="button"
              onClick={closePanel}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '7px 14px', borderRadius: 10, border: 0,
                background: '#2563EB', color: '#fff',
                fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1D4ED8'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2563EB'; }}
            >
              Got it <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes tourDot { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes tourPanelIn { from{opacity:0;transform:translateY(10px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
      `}</style>
    </>
  );
}

// ── Page guides ────────────────────────────────────────────────────────────────

export const PAGE_GUIDES: Record<string, { title: string; steps: TourStep[] }> = {
  dashboard: {
    title: 'Dashboard',
    steps: [
      { emoji: '🏠', title: 'Your command centre', description: 'The dashboard shows your key stats, scheduled posts, upcoming tasks, and live activity from your AI agent team.', target: '[data-tour-id="nav-dashboard"]', placement: 'right' },
      { emoji: '📊', title: 'Stats at a glance', description: 'The top row shows your total posts, scheduled items, and connected social accounts. Click any card to drill in.', target: '[data-tour-id="dashboard-stats"]', placement: 'bottom' },
      { emoji: '🤖', title: 'Agent activity feed', description: 'The right column shows what your agents (Nova, Sage, Aria, Flux) are learning and doing for your brand in real time.', target: '[data-tour-id="dashboard-agent-activity"]', placement: 'left' },
      { emoji: '⚡', title: 'Quick Action Shortcuts', description: 'One-click shortcuts to compose a new post, launch the visual studio, brainstorm fresh angles, or import leads.', target: '[data-tour-id="dashboard-quick-actions"]', placement: 'top' },
      { emoji: '💬', title: 'Chat with Daky', description: 'Click the chat bubble in the bottom-right to open your AI marketing butler. Ask anything — content ideas, strategies, analytics.', target: '[data-tour-id="chat-widget-button"]', placement: 'left' },
    ],
  },
  posts: {
    title: 'Posts',
    steps: [
      { emoji: '✍️', title: 'Create your first post', description: 'Click "Add Post" to open the editor. Write your content, add images, and choose which social accounts to publish to.', target: '[data-tour-id="btn-new-post"]', placement: 'bottom' },
      { emoji: '📅', title: 'Your post library', description: 'All your posts appear here — draft, scheduled, published, and archived. Click any post to edit or reschedule it.', target: '[data-tour-id="posts-list"]', placement: 'top' },
      { emoji: '🔄', title: 'Platform previews', description: 'Each platform has character limits and format rules. The editor shows a live preview per platform.' },
      { emoji: '🤖', title: 'AI-assisted writing', description: 'Open the Daky chat and say "Write me a LinkedIn post about X" — the AI will create a draft you can edit and schedule.', target: '[data-tour-id="chat-widget-button"]', placement: 'left' },
    ],
  },
  tasks: {
    title: 'Tasks',
    steps: [
      { emoji: '📋', title: 'Kanban board', description: 'Tasks are organised by status: Backlog → In Progress → Review → Done. Drag cards between columns to update status.' },
      { emoji: '➕', title: 'Create a task', description: 'Click the + button in any column or "New Task" at the top. Give it a title, description, priority, and due date.' },
      { emoji: '👤', title: 'Assign team members', description: 'Open any task and use the Assignees field to assign it to members. They get alerted 1 day before the due date.' },
      { emoji: '🏷️', title: 'Labels and priority', description: 'Use labels to tag tasks by type. Priority levels (Low/Medium/High/Urgent) appear as coloured indicators.' },
    ],
  },
  memory: {
    title: 'Memory',
    steps: [
      { emoji: '🧠', title: 'Your brand memory', description: 'Memory items are facts about your brand that all agents read before every response. The more you add, the better the advice.', target: '[data-tour-id="memory-categories"]', placement: 'top' },
      { emoji: '➕', title: 'Add a memory item', description: 'Click the "Add" button inside any category to write anything relevant — niche, audience, tone of voice, key products.' },
      { emoji: '🤖', title: 'AI-generated memory', description: 'Click "Generate with AI" to let Daky ask you questions and automatically fill in your brand profile.', target: '[data-tour-id="btn-generate-memory"]', placement: 'bottom' },
      { emoji: '⚡', title: 'Agent compilation', description: 'Every time you save a memory item, all 5 agents automatically recompile — so the next chat is already smarter.' },
    ],
  },
  integrations: {
    title: 'Integrations',
    steps: [
      { emoji: '🔌', title: 'Connect your socials', description: 'Connect Twitter/X, Instagram, LinkedIn, Facebook, and more. Each connection enables scheduling and AI insights for that platform.', target: '[data-tour-id="integrations-cards"]', placement: 'top' },
      { emoji: '🔐', title: 'OAuth login', description: "Clicking \"Connect\" opens a secure OAuth flow. You approve access — no passwords are stored." },
      { emoji: '🧠', title: 'Auto memory', description: 'On first connection, your profile (handle, follower count, bio) is automatically saved to Memory so agents know your social presence.' },
      { emoji: '♻️', title: 'Refresh tokens', description: 'Tokens expire over time. If a platform shows "Reconnect", click it to refresh without losing settings.' },
    ],
  },
  analytics: {
    title: 'Analytics',
    steps: [
      { emoji: '📈', title: 'Performance overview', description: 'View publishing trends, engagement metrics, and growth data across all your connected social accounts in one place.', target: '[data-tour-id="analytics-stats"]', placement: 'bottom' },
      { emoji: '📆', title: 'Date range filter', description: 'Use the date picker to compare performance across different time periods — last 7 days, last month, or a custom range.', target: '[data-tour-id="analytics-filters"]', placement: 'bottom' },
      { emoji: '🤖', title: 'Ask Aria', description: 'Open the Daky chat and ask "What do my analytics say?" — Aria will interpret your numbers and suggest improvements.', target: '[data-tour-id="chat-widget-button"]', placement: 'left' },
    ],
  },
  cards: {
    title: 'Cards',
    steps: [
      { emoji: '🎨', title: 'Visual card builder', description: 'Create social media graphics, announcement cards, and promotional visuals using the drag-and-drop canvas editor.' },
      { emoji: '📐', title: 'Canvas presets', description: 'Choose from preset sizes for Instagram (1080×1080), LinkedIn, Twitter, TikTok, or set a custom canvas size.' },
      { emoji: '🖼️', title: 'Add elements', description: 'Use the left panel to add text, shapes, and images. The right panel controls position, size, color, and font.' },
      { emoji: '💾', title: 'Export your design', description: 'Click "Export" to download as PNG or JPG at high resolution. Save designs to your library for re-use.' },
    ],
  },
  marketing: {
    title: 'Marketing Overview',
    steps: [
      { emoji: '📊', title: 'Your marketing hub', description: 'See email and campaign performance at a glance — open rates, active campaigns, total clicks, and conversions in one place.' },
      { emoji: '🔗', title: 'Jump into any section', description: 'Use the sidebar to navigate to Contacts, Email, Campaigns, or Surveys. Each section has its own focused workspace.' },
    ],
  },
  'marketing-contacts': {
    title: 'Contacts',
    steps: [
      { emoji: '👥', title: 'Contact management', description: 'Import contacts via CSV or add them manually. Segment your list with tags to target specific groups.', target: '[data-tour-id="mailing-contacts"]', placement: 'top' },
      { emoji: '🏷️', title: 'Segments', description: 'Group contacts by shared properties to send targeted campaigns.' },
    ],
  },
  'marketing-email': {
    title: 'Email Marketing',
    steps: [
      { emoji: '📧', title: 'Email campaigns', description: 'Create and send email campaigns to your subscriber list. Write content in the rich-text editor or use AI to generate copy.', target: '[data-tour-id="btn-new-email"]', placement: 'bottom' },
      { emoji: '⚡', title: 'Automations', description: 'Set up trigger-based email sequences — welcome emails on signup, re-engagement on inactivity, and more.' },
      { emoji: '📊', title: 'Analytics', description: 'Track open rates, click rates, and unsubscribes directly in the analytics tab.' },
    ],
  },
  'marketing-campaigns': {
    title: 'Campaigns',
    steps: [
      { emoji: '➕', title: 'Create a campaign', description: 'Click "New Campaign", set a goal, add channels, and generate UTM tracking links.', target: '[data-tour-id="btn-new-campaign"]', placement: 'bottom' },
      { emoji: '🎯', title: 'Multi-channel campaigns', description: 'Group posts, emails, and paid ads under one campaign goal.', target: '[data-tour-id="campaigns-list"]', placement: 'top' },
      { emoji: '📌', title: 'Track performance', description: 'The Performance tab shows clicks by source, conversion rates, and funnel drop-off.' },
    ],
  },
  'marketing-surveys': {
    title: 'Surveys',
    steps: [
      { emoji: '📝', title: 'Create a survey', description: 'Click "New Survey" to start. Give it a title and description, then add blocks to build your questions.' },
      { emoji: '⊕', title: 'Add blocks', description: 'Click the ── ⊕ ── dividers to add blocks: radio buttons, checkboxes, rating stars, NPS, open text, and more.' },
      { emoji: '👁️', title: 'Preview before sharing', description: 'Click "Preview" in the builder header to see exactly what respondents will see — works even in Draft mode.' },
      { emoji: '🔗', title: 'Share your survey', description: 'Set status to Active, then copy the public link from the Share panel. Anyone with the link can respond.' },
    ],
  },
  'project-settings': {
    title: 'Project Settings',
    steps: [
      { emoji: '⚙️', title: 'General settings', description: 'The General tab lets you rename the project, change its colour, and update the description.' },
      { emoji: '👥', title: 'Team tab', description: 'Switch to the Team tab to see all org members and their roles. You can invite new people here.' },
      { emoji: '📬', title: 'Invite by email', description: "Enter a colleague's email, choose their role (Viewer / Editor / Admin), and click Invite." },
      { emoji: '🗑️', title: 'Danger zone', description: 'Deleting a project removes all its tasks permanently — type the project name to confirm.' },
    ],
  },
  admin: {
    title: 'Admin',
    steps: [
      { emoji: '🧑‍🤝‍🧑', title: 'User Management', description: 'View all registered users, their plans, and last active dates. Promote users to admin or suspend accounts.', target: '[data-tour-id="admin-tab-users"]', placement: 'right' },
      { emoji: '💳', title: 'Billing & Subscriptions', description: 'See MRR, ARR, active subscriptions, and recent transactions. Drill into individual payments.', target: '[data-tour-id="admin-tab-billing"]', placement: 'right' },
      { emoji: '🤖', title: 'AI Configuration', description: 'Set your Anthropic or Google Gemini API key, choose the model, and customise the Daky system prompt.', target: '[data-tour-id="admin-accordion-ai"]', placement: 'bottom' },
      { emoji: '🎓', title: 'Daky Learn', description: 'Add article and video URLs for Daky to extract marketing insights from and compile into AI skills.' },
    ],
  },
  billing: {
    title: 'Billing',
    steps: [
      { emoji: '💳', title: 'Your current plan', description: 'This card shows your active subscription, next billing date, and usage for the current period.', target: '[data-tour-id="billing-plan-card"]', placement: 'bottom' },
      { emoji: '⬆️', title: 'Upgrade', description: 'Click "Upgrade plan" to move to a higher tier and unlock more posts, agents, team seats, and analytics.', target: '[data-tour-id="btn-upgrade"]', placement: 'bottom' },
      { emoji: '🔄', title: 'Manage subscription', description: 'Cancel, pause, or change your plan at any time. Changes take effect at the end of your current billing period.' },
    ],
  },
  workspace: {
    title: 'Workspace',
    steps: [
      { emoji: '🏢', title: 'Your organisation', description: "The workspace shows your organisation's name, logo, and all member roles. You can rename the org or update its description." },
      { emoji: '👥', title: 'Member roles', description: 'Owners can do everything. Admins manage members and projects. Editors create content. Viewers can only read.' },
      { emoji: '📬', title: 'Invitations', description: "Pending invitations appear in the Invitations tab. You can resend or cancel invites that haven't been accepted." },
    ],
  },
  notifications: {
    title: 'Notifications',
    steps: [
      { emoji: '🔔', title: 'Everything in one inbox', description: 'Task reminders, team invites, agent updates, and publishing results all land here so you never miss anything.' },
      { emoji: '✅', title: 'Mark as read', description: 'Click a notification to open the related page. Use "Mark all read" to clear the badge in one click.' },
    ],
  },
  'post-automation': {
    title: 'Post Automation',
    steps: [
      { emoji: '🔁', title: 'Publish on autopilot', description: 'Automation reposts your blog content to connected social platforms automatically — write once, publish everywhere.' },
      { emoji: '⚙️', title: 'Per-platform templates', description: 'Each platform gets its own template: set the caption style, hashtags, and link format that fits that network.' },
      { emoji: '🧪', title: 'Preview before enabling', description: 'Use the preview to see exactly what an auto-generated post will look like before you switch automation on.' },
    ],
  },
  media: {
    title: 'Media Library',
    steps: [
      { emoji: '🖼️', title: 'One home for your visuals', description: 'Every image you upload or generate — card designs, AI images, post attachments — is collected here for re-use.' },
      { emoji: '⬆️', title: 'Upload anything', description: 'Drag and drop or click Upload. Add tags so you can find images later with the search box.' },
      { emoji: '🔍', title: 'Search by name or tag', description: 'Type in the search box to filter instantly. Click any image to copy its link or use it in a post.' },
    ],
  },
  'marketing-automations': {
    title: 'Automations',
    steps: [
      { emoji: '⚡', title: 'Emails that send themselves', description: 'An automation is a flow: something happens (a trigger), then your emails go out — automatically, to the right person.' },
      { emoji: '🎬', title: 'Start with a trigger', description: 'The "starting point" is the event that kicks the flow off — like someone joining your list or clicking a link.' },
      { emoji: '⏱️', title: 'Add delays and conditions', description: 'Wait steps space emails out over days. Conditions branch the flow — e.g. only email people with a certain tag.' },
      { emoji: '▶️', title: 'Activate when ready', description: 'Flows start as drafts. Flip the status to Active and the automation runs for every new person who triggers it.' },
    ],
  },
  'marketing-forms': {
    title: 'Forms',
    steps: [
      { emoji: '📥', title: 'Capture leads anywhere', description: 'Build a signup form here, then embed it on your website or share its link. Every submission becomes a contact.' },
      { emoji: '🏷️', title: 'Auto-tag new signups', description: 'Give the form a tag and every signup gets it — perfect for triggering a welcome automation or segmenting later.' },
      { emoji: '🔗', title: 'Share or embed', description: 'Each form has a hosted page you can link to directly, or an embed snippet for your own site.' },
    ],
  },
  'crm-companies': {
    title: 'CRM — Companies',
    steps: [
      { emoji: '🏢', title: 'Track the businesses you talk to', description: 'Companies group your contacts by organisation, with notes, activity history, and deal links in one profile.' },
      { emoji: '📝', title: 'Notes and comments', description: 'Log calls, meetings, and context on each company so the whole team sees the full story.' },
    ],
  },
  'crm-pipeline': {
    title: 'CRM — Pipeline',
    steps: [
      { emoji: '📊', title: 'Your deals, visualised', description: 'Each column is a stage. Drag a deal card to the next column as it progresses toward closing.' },
      { emoji: '💰', title: 'Deal value adds up', description: 'Each stage shows its total value, so you can see how much revenue is sitting at each step.' },
      { emoji: '🗂️', title: 'Click a deal for detail', description: 'Open any card to edit value, contacts, notes, and history — or mark it won or lost.' },
    ],
  },
  'crm-scoring': {
    title: 'Lead Scoring',
    steps: [
      { emoji: '🎯', title: 'Find your hottest leads', description: 'Scoring gives each contact points based on what they do — opens, clicks, form fills. High score = ready to talk.' },
      { emoji: '➕', title: 'Rules add points', description: 'Create a rule like "has newsletter tag: +10" or "clicked a link: +5". Scores update automatically as contacts act.' },
      { emoji: '🥇', title: 'Sort by score', description: 'The leaderboard ranks contacts by score, so sales attention always goes where it counts most.' },
    ],
  },
  'gmail-agent': {
    title: 'Gmail Agent',
    steps: [
      { emoji: '📬', title: 'AI inside your inbox', description: 'Connect Gmail and the agent reads context, summarises long threads, and drafts replies for you.' },
      { emoji: '🔐', title: 'Private and revocable', description: 'You approve access through Google — disconnect anytime and the agent loses access instantly.' },
      { emoji: '✍️', title: 'Draft, never send', description: 'The agent prepares drafts — you always review and hit send yourself.' },
    ],
  },
  'connector-hub': {
    title: 'Connector Hub',
    steps: [
      { emoji: '🔌', title: 'Bring your other tools', description: 'Connectors link outside tools (CRMs, e-commerce, calendars) so their data can flow into your workspace.' },
      { emoji: '🧭', title: 'Pick a category, pick a provider', description: 'Browse by what you need — contacts, deals, products — then choose the provider you already use.' },
    ],
  },
  'connector-sync': {
    title: 'Data Sync',
    steps: [
      { emoji: '🔄', title: 'Scheduled data pulls', description: 'A sync job fetches data from a connected provider on a schedule — hourly, daily, or weekly.' },
      { emoji: '🕓', title: 'Run history', description: 'Every run is logged with its result, so you can see exactly when data last came in and whether it worked.' },
    ],
  },
  discover: {
    title: 'Discover',
    steps: [
      { emoji: '✨', title: 'Browse AI-made visuals', description: 'A gallery of images and videos generated on the platform — use it for inspiration or as a starting point.' },
      { emoji: '🎨', title: 'Remix anything', description: 'Open any item to see its prompt, then tweak it in the AI studio to make your own version.' },
    ],
  },
  'ai-team': {
    title: 'AI Team',
    steps: [
      { emoji: '🤖', title: 'Meet your agents', description: 'Each agent has a specialty — content, strategy, analytics, design. They all share what they know about your brand.' },
      { emoji: '🧠', title: 'Teach them once', description: 'Fill in your brand details (voice, audience, products) and every agent uses it in every answer from then on.' },
      { emoji: '🗣️', title: 'Extract your voice', description: 'Paste examples of your writing and click "Extract Voice" — agents will learn to write the way you do.' },
    ],
  },
  pricing: {
    title: 'Plans',
    steps: [
      { emoji: '💡', title: 'Pick the plan that fits', description: 'Plans differ mainly in monthly AI credits, team seats, and connected accounts. Upgrade or downgrade anytime.' },
      { emoji: '🪙', title: 'What are credits?', description: 'Credits are your AI budget. Generating content, images, or videos uses a few credits each; they refill every month.' },
    ],
  },
  profile: {
    title: 'Profile',
    steps: [
      { emoji: '👤', title: 'Your public identity', description: 'Your name, photo, and details shown to teammates. Keep it current so collaborators know who did what.' },
      { emoji: '🔒', title: 'Security', description: 'Change your password here. "Log out all devices" instantly signs out every session everywhere.' },
    ],
  },
};
