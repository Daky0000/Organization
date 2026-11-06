import { BarChart2, Calendar, Image, Inbox, Sparkles, Workflow } from 'lucide-react';
import type { PageType } from '../App';

const LINKS: { label: string; desc: string; page: PageType; icon: React.ReactNode }[] = [
  { label: 'Posts & Calendar', desc: 'Plan, schedule and publish social posts', page: 'posts', icon: <Calendar size={18} /> },
  { label: 'AI Studio', desc: 'Generate images, video and branded cards', page: 'cards', icon: <Sparkles size={18} /> },
  { label: 'Media Library', desc: 'All your uploaded and generated assets', page: 'media', icon: <Image size={18} /> },
  { label: 'Workflow', desc: 'Automate content from idea to publish', page: 'workflow', icon: <Workflow size={18} /> },
  { label: 'Analytics', desc: 'Reach and engagement across platforms', page: 'analytics', icon: <BarChart2 size={18} /> },
  { label: 'Social Inbox', desc: 'Replies, comments and client approvals', page: 'social-inbox', icon: <Inbox size={18} /> },
];

export default function MarketingOverview({ navigateToPage }: { navigateToPage: (page: PageType) => void }) {
  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Marketing</h1>
        <p className="mt-2 text-base text-slate-500">Create, publish and measure your content in one place.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map(item => (
          <button
            key={item.page}
            onClick={() => navigateToPage(item.page)}
            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group"
          >
            <div className="mt-0.5 text-slate-400 group-hover:text-indigo-500 transition-colors">{item.icon}</div>
            <div>
              <div className="text-sm font-bold text-slate-900">{item.label}</div>
              <div className="mt-0.5 text-xs text-slate-500">{item.desc}</div>
            </div>
          </button>
        ))}
      </section>
    </div>
  );
}
