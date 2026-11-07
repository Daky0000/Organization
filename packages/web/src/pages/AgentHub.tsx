import { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen, Boxes, MessageSquare, Sparkles, Target } from 'lucide-react';

const AgentConsole = lazy(() => import('../components/agent/AgentConsole'));
const TargetingPanel = lazy(() => import('../components/agent/TargetingPanel'));
const SkillsPanel = lazy(() => import('../components/agent/SkillsPanel'));
const CompanyContextEditor = lazy(() => import('../components/agent/CompanyContextEditor'));

type Tab = 'ask' | 'targeting' | 'skills' | 'context';
const TABS: Array<{ id: Tab; label: string; icon: typeof Sparkles }> = [
  { id: 'ask', label: 'Ask the agent', icon: MessageSquare },
  { id: 'targeting', label: 'Who to call', icon: Target },
  { id: 'skills', label: 'Skills', icon: Boxes },
  { id: 'context', label: 'Company context', icon: BookOpen },
];

function readParams(): { tab: Tab; event: string | null } {
  try {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('tab');
    return { tab: TABS.find((x) => x.id === t)?.id ?? 'ask', event: q.get('event') };
  } catch { return { tab: 'ask', event: null }; }
}

export default function AgentHub() {
  const [{ tab, event }, setState] = useState(readParams);

  useEffect(() => {
    const onPop = () => setState(readParams());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (t: Tab) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    url.searchParams.delete('event');
    window.history.pushState({}, document.title, `${url.pathname}${url.search}`);
    setState({ tab: t, event: null });
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-950">
          <Sparkles size={22} className="text-violet-600" /> AI Agent
        </h1>
        <p className="mt-1 text-sm text-slate-500">One agent for the whole business: it plans the work, uses every skill, knows your company, and helps you decide.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => go(t.id)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}>
        {tab === 'ask' && <AgentConsole />}
        {tab === 'targeting' && <TargetingPanel key={event ?? 'none'} initialEventId={event} />}
        {tab === 'skills' && <SkillsPanel />}
        {tab === 'context' && <CompanyContextEditor />}
      </Suspense>
    </div>
  );
}
