import { useEffect, useState } from 'react';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

// ── Exported types for admin CMS compatibility ────────────────────────────────

export type ToolItem = {
  icon: string;
  name: string;
  tagline: string;
  description: string;
  bullets: string[];
};

export type ToolsPageContent = {
  hero: { badge: string; headline: string; subheadline: string };
  tools: ToolItem[];
  cta: { headline: string; subheadline: string; buttonText: string };
};

export const defaultToolsContent: ToolsPageContent = {
  hero: {
    badge: 'DakyXTech Platform Tools',
    headline: 'Create. Publish. Measure.',
    subheadline: 'A focused, integrated toolkit for creating, scheduling, and measuring your social content.',
  },
  tools: [],
  cta: {
    headline: 'Ready to publish?',
    subheadline: 'Create and schedule your next week of content in minutes.',
    buttonText: 'Get started',
  },
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

const CORE_TOOLS = [
  {
    num: '01',
    name: 'Nova AI Content Writer',
    tag: 'Brand-trained copywriting',
    desc: 'Turn product updates, articles, or rough notes into platform-native LinkedIn posts, X threads, and Instagram captions.',
    bullets: [
      'Custom brand voice profiles and banned-phrase guardrails',
      'One-click Improve Prompt assistant for sharper hooks',
      'Multi-channel adaptation in a single pass',
    ],
  },
  {
    num: '02',
    name: 'Visual Card & Image Studio',
    tag: 'Templates & AI visuals',
    desc: 'Produce crisp quote cards, metric callouts, carousels, and AI-generated imagery without leaving your publishing workflow.',
    bullets: [
      '200+ structured social card templates',
      '6 AI image generation models + HD upscaling',
      'Automatic aspect-ratio resizing for every feed',
    ],
  },
  {
    num: '03',
    name: 'Multi-Channel Scheduler',
    tag: 'Calendar & evergreen queues',
    desc: 'Plan campaigns across LinkedIn, X, Instagram, Facebook, TikTok, and Threads on one clean visual timeline.',
    bullets: [
      'Drag-and-drop monthly and weekly calendar views',
      'AI-recommended optimal posting slots per channel',
      'Automated retry logs and evergreen recycling',
    ],
  },
  {
    num: '04',
    name: 'Unified Analytics Ledger',
    tag: 'Cross-channel reporting',
    desc: 'Track impressions, follower growth, engagement rate, and top-performing posts without stitching spreadsheets together.',
    bullets: [
      'Normalized metrics across all 6 social networks',
      'Post-level performance breakdown and hook analysis',
      'Exportable client-ready PDF and CSV reports',
    ],
  },
  {
    num: '05',
    name: 'Social Inbox & Lead CRM',
    tag: 'Engagement & pipeline',
    desc: 'Capture high-intent comments, DMs, and inbound leads into a structured pipeline with automated scoring.',
    bullets: [
      'Unified inbox for replies and mentions',
      'Kanban deal stages and contact timeline',
      'Lead finder, website audit, and outreach sequences',
    ],
  },
  {
    num: '06',
    name: 'Client Portals & Workflows',
    tag: 'Team & agency operations',
    desc: 'Keep internal stakeholders and external clients aligned with shareable approval links and role-based workspaces.',
    bullets: [
      'No-login client review portals for fast sign-off',
      'RSS-to-social and webhook automation triggers',
      'Isolated brand memory per workspace',
    ],
  },
];

export default function Tools({ onLoginClick }: { onLoginClick: () => void }) {
  const [content, setContent] = useState<ToolsPageContent>(defaultToolsContent);

  useEffect(() => {
    fetchPageContent<ToolsPageContent>('tools')
      .then((data) => {
        if (data?.hero) setContent(data);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <PublicNav onLoginClick={onLoginClick} activePath="/tools" />

      <main className="h-frame">
        {/* 1. Hero Panel */}
        <section className="h-panel h-dots h-sec">
          <div className="h-dotfield h-edge" />
          <div className="h-in">
            <div className="max-w-[740px]">
              <span className="h-cap">{content.hero.badge || 'Platform tools'}</span>
              <h1 className="text-[clamp(40px,5vw,66px)] mt-3">
                Create. Publish.
                <br />
                <span className="text-muted">Measure in one place.</span>
              </h1>
              <p className="mt-5 text-[17.5px] text-muted max-w-[54ch] leading-relaxed">
                {content.hero.subheadline}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" onClick={onLoginClick} className="h-btn h-btn-b">
                  Start for free
                  <ArrowIcon />
                </button>
                <a href="/pricing" className="h-btn h-btn-o">
                  View pricing
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Deep-dive Tools Grid */}
        <section className="h-panel h-soft h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">The full suite</span>
                <h2>
                  Six focused modules.
                  <br />
                  <span>One shared brain.</span>
                </h2>
              </div>
              <p>
                Every tool in DakyXTech Marketing reads from the same brand memory and asset library
                so your workflow stays calm and consistent.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {CORE_TOOLS.map((tool) => (
                <div
                  key={tool.num}
                  className="rounded-[16px] border border-line bg-white p-7 flex flex-col justify-between gap-6"
                >
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-medium text-blue">{tool.num}</span>
                      <span className="rounded-md bg-pale px-2.5 py-1 text-[11px] font-medium text-blue-d">
                        {tool.tag}
                      </span>
                    </div>
                    <h3 className="mt-4 text-[24px] font-normal tracking-[-0.03em] text-ink">
                      {tool.name}
                    </h3>
                    <p className="mt-2.5 text-[15px] text-muted leading-relaxed">{tool.desc}</p>
                  </div>

                  <ul className="space-y-2 pt-5 border-t border-line text-[14px] text-ink">
                    {tool.bullets.map((b) => (
                      <li key={b} className="flex items-center gap-2.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Supported Channels & Integrations */}
        <section className="h-panel h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Connected ecosystem</span>
                <h2>
                  Works with your
                  <br />
                  <span>entire stack.</span>
                </h2>
              </div>
              <p>
                Direct OAuth publishing to six major social platforms plus webhooks, RSS ingestion,
                and CRM sync.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { code: 'LI', name: 'LinkedIn', sub: 'Profiles & Pages' },
                { code: 'X', name: 'X / Twitter', sub: 'Posts & Threads' },
                { code: 'IG', name: 'Instagram', sub: 'Feed, Reels & Stories' },
                { code: 'FB', name: 'Facebook', sub: 'Business Pages' },
                { code: 'TT', name: 'TikTok', sub: 'Short-form Video' },
                { code: 'TH', name: 'Threads', sub: 'Posts & Replies' },
              ].map((ch) => (
                <div
                  key={ch.code}
                  className="rounded-[14px] border border-line bg-soft p-5 flex flex-col justify-between gap-4 hover:bg-white hover:border-line-strong transition-colors"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-white font-mono text-xs font-medium text-blue">
                    {ch.code}
                  </span>
                  <div>
                    <div className="text-[15px] font-medium text-ink">{ch.name}</div>
                    <div className="text-[12.5px] text-muted mt-0.5">{ch.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. Closing Navy Band */}
        <section className="h-panel h-band h-navy h-dots h-sec">
          <div className="h-dotfield" />
          <div className="h-in text-center max-w-[680px]">
            <span className="h-cap !text-blue-light">All tools included</span>
            <h2 className="!text-white text-[clamp(34px,4.2vw,56px)] mt-3">
              All the tools.
              <br />
              <span className="text-white/60">None of the chaos.</span>
            </h2>
            <p className="mt-4 text-[16.5px] text-white/75 max-w-[46ch] mx-auto">
              Start on the free plan and experience the full DakyXTech Marketing workflow today.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={onLoginClick} className="h-btn h-btn-b">
                {content.cta.buttonText || 'Get started'}
                <ArrowIcon />
              </button>
              <a href="/pricing" className="h-btn h-btn-w">
                View pricing
              </a>
            </div>
          </div>
        </section>

        <PublicFooter />
      </main>
    </>
  );
}
