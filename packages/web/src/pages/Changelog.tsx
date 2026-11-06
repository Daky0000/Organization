import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';
import { Badge } from '../components/ui';

type Entry = {
  version: string;
  date: string;
  title: string;
  tags: Array<'New' | 'Improved' | 'Fixed' | 'Removed'>;
  items: string[];
};

const TAG_TONE: Record<Entry['tags'][number], 'positive' | 'info' | 'warn' | 'danger'> = {
  New: 'positive',
  Improved: 'info',
  Fixed: 'warn',
  Removed: 'danger',
};

const ENTRIES: Entry[] = [
  {
    version: '2.5.0',
    date: 'October 2026',
    title: 'DakyXTech Design System v22 Unification',
    tags: ['New', 'Improved'],
    items: [
      'Unified the entire web interface with the DakyXTech v21/v22 Design System across public marketing and signed-in workspace views.',
      'Adopted self-hosted Outfit and JetBrains Mono variable typography and the floating white-panel-on-canvas architecture.',
      'Redesigned workspace navigation, topbar breadcrumbs, executive KPI seam bar, and signed-out authentication frame.',
    ],
  },
  {
    version: '2.4.0',
    date: 'June 2025',
    title: 'Email Analytics & Template Library',
    tags: ['New', 'Improved'],
    items: [
      'Email analytics dashboard: per-campaign open rate, click rate, and unsubscribe tracking with bar charts.',
      'Expanded email template library to 10 pre-built layouts across 6 categories (Onboarding, Marketing, Content, Events, Engagement, Basic).',
      'Visual mini-preview thumbnails in the template picker with category filter tabs.',
      'Per-campaign performance table with delivery, open, click, and unsubscribe counts.',
    ],
  },
  {
    version: '2.3.0',
    date: 'May 2025',
    title: 'Analytics Route Refactor & LinkedIn Helpers',
    tags: ['Improved'],
    items: [
      'Split 4,500-line analytics monolith into 8 focused sub-modules (TikTok, Facebook, Instagram, Pinterest, Threads, LinkedIn, social accounts, adapter).',
      'Extracted shared LinkedIn helper functions into a canonical module used by both analytics and distribution routes.',
      'Fixed double-prefix routing bug affecting all platform analytics endpoints.',
      'Resolved dead code blog analytics duplication.',
    ],
  },
  {
    version: '2.2.0',
    date: 'April 2025',
    title: 'Zod Validation & Route Tests',
    tags: ['New', 'Improved', 'Fixed'],
    items: [
      'Added Zod validation middleware across all billing and mailing API routes.',
      'Wrote a 16-test suite covering mailing, billing, and validation edge cases.',
      'Fixed unsubscribe token generation and URL consistency in email sends.',
      'Corrected Resend SDK v6 error-handling at all send sites.',
    ],
  },
  {
    version: '2.1.0',
    date: 'March 2025',
    title: 'Drag-to-Reorder & Card Builder Fixes',
    tags: ['New', 'Fixed'],
    items: [
      'Drag-to-reorder blocks in the email builder Contents / layers panel.',
      'Fixed AdminFabricBuilder JSON export format (correct wrapper structure for import).',
      'Silent publish errors now surface to the user near the Publish button.',
      'Preview images in the card builder are resized to max 1200×800 JPEG before storing.',
    ],
  },
  {
    version: '1.9.0',
    date: 'January 2025',
    title: 'Social Media Analytics',
    tags: ['New'],
    items: [
      'Instagram analytics: profile sync, posts, reach, and engagement metrics.',
      'Pinterest analytics: pin performance, board-level stats, and follower trends.',
      'Threads analytics: post metrics, reply management, and location search.',
      'LinkedIn company pages: follower count, post performance, and organization sync.',
    ],
  },
];

export default function Changelog() {
  return (
    <>
      <PublicNav
        activePath="/changelog"
        onLoginClick={() => {
          window.location.href = '/login';
        }}
      />

      <main className="h-frame">
        <section className="h-panel h-dots h-sec">
          <div className="h-dotfield h-edge" />
          <div className="h-in max-w-[820px]">
            <span className="h-cap">Product changelog</span>
            <h1 className="text-[clamp(36px,4.5vw,58px)] mt-3">
              What&apos;s new.
              <br />
              <span className="text-muted">Every release, documented.</span>
            </h1>
            <p className="mt-4 text-[16.5px] text-muted">
              New capabilities, interface refinements, and reliability improvements across the
              DakyXTech Marketing platform.
            </p>

            <div className="mt-12 divide-y divide-line border-t border-line">
              {ENTRIES.map((entry) => (
                <article key={entry.version} className="py-9 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
                  <div>
                    <div className="font-mono text-xs font-medium text-ink">v{entry.version}</div>
                    <div className="mt-1 text-xs text-muted">{entry.date}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {entry.tags.map((tag) => (
                        <Badge key={tag} tone={TAG_TONE[tag]}>
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-[22px] font-normal tracking-[-0.03em] text-ink">
                      {entry.title}
                    </h2>
                    <ul className="mt-4 space-y-2.5">
                      {entry.items.map((item, j) => (
                        <li
                          key={j}
                          className="flex items-start gap-2.5 text-[15px] text-muted leading-relaxed"
                        >
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" aria-hidden />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <PublicFooter />
      </main>
    </>
  );
}
