import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

// ── CMS type stubs (kept for AdminPagesManagement compatibility) ──────────────

export type FeatureItem = { icon: string; title: string; description: string };
export type StatItem = { value: string; label: string };
export type HomepageContent = {
  hero: {
    badge: string;
    headline: string;
    subheadline: string;
    primaryCta: string;
    secondaryCta: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  features: { title: string; subtitle: string; items: FeatureItem[] };
  stats: { items: StatItem[] };
  cta: { headline: string; subheadline: string; buttonText: string };
};

export const defaultHomepageContent: HomepageContent = {
  hero: {
    badge: 'DakyXTech Marketing · Six channels',
    headline: 'Your brand. Your voice. Six channels, one workspace.',
    subheadline:
      'DakyXTech learns what your audience responds to, drafts content in your exact voice, and publishes across every platform automatically.',
    primaryCta: 'Start for free',
    secondaryCta: 'Explore tools',
    ctaPrimary: 'Start for free',
    ctaSecondary: 'Explore tools',
  },
  features: {
    title: 'Every tool your team needs. Nothing bolted on.',
    subtitle: 'Create, schedule, and measure across six social channels from a single calm workspace.',
    items: [
      { icon: 'Zap', title: 'Nova AI', description: 'AI that learns your brand voice and writes platform-native content.' },
      { icon: 'Image', title: 'AI Studio', description: 'Generate images and design visuals with 200+ templates.' },
      { icon: 'Calendar', title: 'Smart Scheduler', description: 'Drag-and-drop calendar with AI-optimal posting times.' },
    ],
  },
  stats: {
    items: [
      { value: '12,000+', label: 'Brands & creators' },
      { value: '6', label: 'Platforms' },
      { value: '10×', label: 'Faster publishing' },
      { value: '4.8', label: 'Average rating' },
    ],
  },
  cta: {
    headline: 'Ship strategy. Not busywork.',
    subheadline: 'Join thousands of brands publishing smarter with DakyXTech.',
    buttonText: 'Start for free',
  },
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}

function HeroWindowIllustration() {
  return (
    <div className="relative rounded-[18px] bg-navy p-5 sm:p-6 overflow-hidden dot-field border border-navy">
      {/* Drawn UI Window */}
      <div className="relative z-10 rounded-[14px] bg-white border border-line overflow-hidden shadow-lift">
        {/* Window top bar */}
        <div className="h-[38px] px-3.5 bg-soft border-b border-line flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </div>
          <span className="font-mono text-[11px] text-muted bg-white border border-line rounded-md px-2.5 py-0.5">
            marketing.dakyx.com/studio
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-positive">Live</span>
        </div>

        {/* Window body */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* Prompt row */}
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-soft px-3.5 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs text-blue font-medium">›</span>
              <span className="text-[13px] text-ink truncate">
                Draft 3 LinkedIn &amp; X posts for our Q4 product release
              </span>
            </div>
            <span className="shrink-0 rounded-md bg-pale px-2 py-0.5 text-[10.5px] font-medium text-blue-d">
              Brand voice
            </span>
          </div>

          {/* Generated drafts */}
          <div className="space-y-2">
            {[
              {
                num: '01',
                channel: 'LinkedIn',
                text: 'Six months of focused engineering. Here is what we shipped for operations teams this quarter.',
                slot: 'Tue · 08:30',
                status: 'Scheduled',
              },
              {
                num: '02',
                channel: 'X / Thread',
                text: 'Most marketing stacks are five disconnected tabs. We rebuilt the workflow around one calm queue.',
                slot: 'Wed · 11:15',
                status: 'Ready',
              },
            ].map((item) => (
              <div
                key={item.num}
                className="rounded-[12px] border border-line bg-white p-3.5 flex items-start gap-3"
              >
                <span className="font-mono text-[11px] text-faint pt-0.5">{item.num}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                      {item.channel}
                    </span>
                    <span className="font-mono text-[11px] text-faint">{item.slot}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-ink leading-snug">{item.text}</p>
                </div>
                <span className="shrink-0 rounded-md bg-pale px-2 py-0.5 text-[11px] font-medium text-blue-d">
                  {item.status}
                </span>
              </div>
            ))}
          </div>

          {/* Bottom metrics strip */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-[12px] border border-line bg-soft p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">
                  30-day reach
                </span>
                <span className="text-[11px] font-medium text-positive">+34%</span>
              </div>
              <div className="mt-1 text-2xl font-normal tracking-[-0.04em] text-ink tabular-nums">
                2.4M
              </div>
              <div className="mt-2 flex items-end gap-1 h-7">
                {[38, 52, 46, 68, 76, 62, 96].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-[3px]"
                    style={{
                      height: `${h}%`,
                      background: i === 6 ? '#2563EB' : '#D2D7DF',
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-[12px] border border-line bg-soft p-3 flex flex-col justify-between">
              <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">
                Connected channels
              </span>
              <div className="my-2 flex flex-wrap gap-1">
                {['LI', 'X', 'IG', 'FB', 'TT', 'TH'].map((ch) => (
                  <span
                    key={ch}
                    className="inline-flex h-6 items-center rounded-md border border-line bg-white px-2 font-mono text-[10.5px] font-medium text-ink"
                  >
                    {ch}
                  </span>
                ))}
              </div>
              <span className="text-[11.5px] text-muted">Optimal timing active</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <>
      <PublicNav onLoginClick={onLoginClick} activePath="/" />

      <main className="h-frame">
        {/* 1. Hero Panel */}
        <section className="h-panel h-hero h-dots">
          <div className="h-dotfield h-edge" />
          <div className="h-hero-l">
            <span className="h-cap mb-4">DakyXTech Marketing · Six channels</span>
            <h1>
              Your brand. Your voice.
              <br />
              <span>Six channels, one workspace.</span>
            </h1>
            <p className="h-sub">
              DakyXTech learns what your audience responds to, drafts content in your exact voice,
              and schedules across LinkedIn, X, Instagram, Facebook, TikTok, and Threads.
            </p>
            <div className="h-ctas">
              <button type="button" onClick={onLoginClick} className="h-btn h-btn-b">
                Start for free
                <ArrowIcon />
              </button>
              <a href="/tools" className="h-btn h-btn-o">
                Explore tools
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted">
              <span>No credit card required</span>
              <span className="text-line-strong">·</span>
              <span>6 social channels included</span>
              <span className="text-line-strong">·</span>
              <span>Cancel any time</span>
            </div>
          </div>

          <div className="relative z-10">
            <HeroWindowIllustration />
          </div>
        </section>

        {/* 2. Proof & Numbers Panel */}
        <section className="h-panel h-soft h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">By the numbers</span>
                <h2>
                  Built for steady output.
                  <br />
                  <span>Measured in real reach.</span>
                </h2>
              </div>
              <p>
                Replace scattered spreadsheets, design tools, and manual posting queues with one
                structured publishing system.
              </p>
            </div>

            <div className="h-tiles">
              {[
                {
                  cap: 'Active workspaces',
                  val: '12,000+',
                  sub: 'Founders, marketers, and agencies publishing weekly',
                },
                {
                  cap: 'Supported networks',
                  val: '6',
                  sub: 'LinkedIn, X, Instagram, Facebook, TikTok, and Threads',
                },
                {
                  cap: 'Workflow speed',
                  val: '10×',
                  sub: 'From campaign brief to scheduled multi-channel queue',
                },
                {
                  cap: 'Delivery reliability',
                  val: '99.9%',
                  sub: 'Automated queue execution with instant retry logs',
                },
              ].map((t) => (
                <div key={t.cap} className="h-tile">
                  <span className="h-cap">{t.cap}</span>
                  <div>
                    <b>{t.val}</b>
                    <small>{t.sub}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Core Capabilities Panel */}
        <section id="features" className="h-panel h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Platform capabilities</span>
                <h2>
                  Every tool your team needs.
                  <br />
                  <span>Nothing bolted on.</span>
                </h2>
              </div>
              <p>
                Every module shares the same brand memory, asset library, and analytics ledger so
                your team never copies and pastes between tabs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  title: 'Nova AI Writer',
                  desc: 'Drafts platform-native posts, threads, and hooks trained on your past top performers and brand guidelines.',
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
                    </svg>
                  ),
                },
                {
                  title: 'Visual Card Studio',
                  desc: 'Turn quotes, metrics, and announcements into crisp social cards and carousels with 200+ structured templates.',
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                  ),
                },
                {
                  title: 'Smart Scheduler',
                  desc: 'Plan a full month on a visual calendar with automatic per-channel formatting and best-time delivery.',
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="3" y="4" width="18" height="18" rx="3" />
                      <path d="M16 2v4M8 2v4M3 10h18" />
                    </svg>
                  ),
                },
                {
                  title: 'Unified Analytics',
                  desc: 'See follower growth, post-level impressions, and engagement rates across all six networks in one clean report.',
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M3 3v18h18" />
                      <path d="M7 16v-5M12 16V8M17 16v-9" />
                    </svg>
                  ),
                },
                {
                  title: 'Social Inbox & CRM',
                  desc: 'Route comments, messages, and captured leads directly into your pipeline so high-intent replies never slip.',
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  ),
                },
                {
                  title: 'Autopilot Workflows',
                  desc: 'Recycle evergreen posts, ingest blog RSS feeds, and require client sign-off before anything goes live.',
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M17 2.1l4 4-4 4" />
                      <path d="M3 12.2v-2a4 4 0 0 1 4-4h14M7 21.9l-4-4 4-4" />
                      <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  ),
                },
              ].map((card) => (
                <div key={card.title} className="h-card">
                  <div className="h-ic">{card.icon}</div>
                  <div>
                    <h3>{card.title}</h3>
                    <p className="mt-2">{card.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. Operating Loop / How It Works */}
        <section id="studio" className="h-panel h-soft h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">How it works</span>
                <h2>
                  Three steps from brief
                  <br />
                  <span>to published campaign.</span>
                </h2>
              </div>
              <p>
                Designed for clarity and speed: set your voice once, review a week of drafts in
                minutes, and let the scheduler handle distribution.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  step: '01',
                  title: 'Connect your channels & voice',
                  desc: 'Link LinkedIn, X, Instagram, Facebook, TikTok, or Threads. DakyXTech analyzes your best-performing posts to lock in your tone.',
                },
                {
                  step: '02',
                  title: 'Generate & refine in Studio',
                  desc: 'Turn a single topic, URL, or product update into tailored copy and visual cards for every channel simultaneously.',
                },
                {
                  step: '03',
                  title: 'Schedule & measure results',
                  desc: 'Approve the queue for automatic publishing at peak audience hours and track what drives real engagement.',
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-[14px] border border-line bg-white p-6 flex flex-col justify-between gap-6"
                >
                  <span className="font-mono text-xs font-medium text-blue">{item.step}</span>
                  <div>
                    <h3 className="text-[22px] font-normal tracking-[-0.03em] text-ink">
                      {item.title}
                    </h3>
                    <p className="mt-2.5 text-[15px] text-muted leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Pricing Preview */}
        <section className="h-panel h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Transparent pricing</span>
                <h2>
                  Start free.
                  <br />
                  <span>Scale when ready.</span>
                </h2>
              </div>
              <p>
                Every plan includes core publishing, the visual card studio, and multi-channel
                scheduling. Upgrade only when your volume grows.
              </p>
            </div>

            <div className="h-plans">
              {[
                {
                  cap: 'Starter',
                  name: 'Free',
                  desc: 'For individuals building a consistent publishing habit.',
                  price: '$0',
                  per: '/month',
                  credits: '100 AI credits / mo',
                  features: [
                    '2 connected social accounts',
                    'AI post & caption writer',
                    'Visual calendar & queue',
                    '20+ social card templates',
                    'Core post analytics',
                  ],
                  featured: false,
                },
                {
                  cap: 'Growth',
                  chip: 'Most popular',
                  name: 'Pro',
                  desc: 'For active brands and teams publishing across every channel.',
                  price: '$29',
                  per: '/month',
                  credits: '2,000 AI credits / mo',
                  features: [
                    '8 connected social accounts',
                    'AI image generation & Studio',
                    'Custom brand voice memory',
                    'Bulk scheduling & evergreens',
                    'Cross-channel analytics',
                    '3 team seats included',
                  ],
                  featured: true,
                },
                {
                  cap: 'Scale',
                  name: 'Agency',
                  desc: 'For agencies and multi-brand operators running client queues.',
                  price: '$79',
                  per: '/month',
                  credits: '6,000 AI credits / mo',
                  features: [
                    'Unlimited social accounts',
                    'AI video & premium image models',
                    'Dedicated client workspaces',
                    'Client approval portals',
                    'White-label PDF reports',
                    '10 team seats & API access',
                  ],
                  featured: false,
                },
              ].map((plan) => (
                <div key={plan.name} className={`h-plan ${plan.featured ? 'h-on' : ''}`}>
                  <div className="h-top">
                    <span className="h-cap">{plan.cap}</span>
                    {plan.chip && <span className="h-chip">{plan.chip}</span>}
                  </div>
                  <h3>{plan.name}</h3>
                  <p>{plan.desc}</p>

                  <ul className="my-4 space-y-2.5 text-[14.5px]">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className={`flex items-center gap-2.5 ${
                          plan.featured ? 'text-white/85' : 'text-ink'
                        }`}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            plan.featured ? 'bg-blue-light' : 'bg-blue'
                          }`}
                        />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="h-amt">
                    <span>{plan.credits}</span>
                    <b className="mt-1">
                      {plan.price} <small>{plan.per}</small>
                    </b>
                    <button
                      type="button"
                      onClick={onLoginClick}
                      className={`mt-5 w-full h-btn ${
                        plan.featured ? 'h-btn-b' : 'btn-k'
                      }`}
                    >
                      Get started
                      <ArrowIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-line text-[14px] text-muted">
              <span>Annual billing saves 20% · 30-day money-back guarantee</span>
              <a href="/pricing" className="h-lnk">
                Compare all plan features
                <ArrowIcon />
              </a>
            </div>
          </div>
        </section>

        {/* 6. FAQ Accordion */}
        <section className="h-panel h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Common questions</span>
                <h2>
                  Straight answers.
                  <br />
                  <span>No small print.</span>
                </h2>
              </div>
              <p>Everything you need to know about accounts, AI credits, and security.</p>
            </div>

            <div className="h-qa">
              {[
                {
                  q: 'Which social networks can I publish to?',
                  a: 'You can connect and schedule directly to LinkedIn (personal profiles and company pages), X (Twitter), Instagram, Facebook Pages, TikTok, and Threads from a single calendar.',
                },
                {
                  q: 'How does DakyXTech learn my brand voice?',
                  a: 'During setup you can paste sample posts, website copy, or tone rules. Our AI memory references your guidelines on every draft so posts sound like your team wrote them.',
                },
                {
                  q: 'Can clients review posts before they go live?',
                  a: 'Yes. Agency workspaces include shareable client review portals where stakeholders can approve or request changes without needing a full workspace login.',
                },
                {
                  q: 'Do unused AI credits roll over?',
                  a: 'Monthly plan credits refresh each billing cycle, and top-up credit packs never expire for as long as your workspace remains active.',
                },
              ].map((item) => (
                <details key={item.q}>
                  <summary>
                    <span>{item.q}</span>
                    <i>
                      <PlusIcon />
                    </i>
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Closing Navy CTA Band */}
        <section className="h-panel h-band h-navy h-dots h-sec">
          <div className="h-dotfield" />
          <div className="h-in text-center max-w-[680px]">
            <span className="h-cap !text-blue-light">Get started today</span>
            <h2 className="!text-white text-[clamp(36px,4.5vw,60px)] mt-3">
              Ship strategy.
              <br />
              <span className="text-white/60">Not busywork.</span>
            </h2>
            <p className="mt-4 text-[17px] text-white/75 max-w-[48ch] mx-auto">
              Open your free DakyXTech Marketing workspace in under a minute and schedule your next
              week of content today.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={onLoginClick} className="h-btn h-btn-b">
                Start for free
                <ArrowIcon />
              </button>
              <a href="/pricing" className="h-btn h-btn-w">
                View pricing
              </a>
            </div>
          </div>
        </section>

        {/* 8. Footer Panel */}
        <PublicFooter />
      </main>
    </>
  );
}
