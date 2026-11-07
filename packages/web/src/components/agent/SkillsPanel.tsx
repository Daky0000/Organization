import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { agentService, type Skill, type SkillSource } from '../../services/agentService';

const GROUPS: Array<{ source: SkillSource; title: string; blurb: string }> = [
  { source: 'core', title: 'Core', blurb: 'Decision making and business analysis.' },
  { source: 'sales', title: 'Sales', blurb: 'Lead targeting, the daily call plan and call insights.' },
  { source: 'marketing_team', title: 'Marketing & creative (the former agent team)', blurb: 'Each former team agent is now a skill the orchestrator can call, alone or in parallel.' },
  { source: 'platform', title: 'Platform leads (admin only)', blurb: 'The former platform agents. The orchestrator asks them for advice; their scheduled autonomous runs stay on the admin Agents page.' },
  { source: 'background', title: 'Always-on', blurb: 'These run on their own inside the app as part of the same agent.' },
];

export default function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [packs, setPacks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    agentService.skills().then((r) => { setSkills(r.skills); setPacks(r.packs); }).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Skills</h2>
        <p className="text-sm text-slate-500">One agent, {skills ? skills.length : '…'} skills. The agent breaks each request into steps, picks the skills, and runs independent steps at the same time.</p>
      </div>
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
      {!skills && !error && <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}
      {skills && GROUPS.map((g) => {
        const list = skills.filter((s) => s.source === g.source);
        if (!list.length) return null;
        return (
          <section key={g.source} className="space-y-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{g.title}</h3>
              <p className="text-xs text-slate-500">{g.blurb}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {list.map((s) => (
                <article key={s.key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm text-white" style={{ background: s.color || '#475569' }}>{s.icon}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{s.name}</p>
                      <p className="truncate text-xs text-slate-500">{s.role}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{s.description}</p>
                  {s.packs.length > 0 && <p className="mt-1.5 text-[11px] text-slate-400">Reads: {s.packs.map((p) => packs[p]?.split(' (')[0] ?? p).join(', ')}</p>}
                  {s.tools.length > 0 && <p className="mt-0.5 text-[11px] text-slate-400">Can: {s.tools.join(', ').replace(/_/g, ' ')}</p>}
                  {s.editable_at && <p className="mt-0.5 text-[11px] text-slate-400">Edit at: {s.editable_at}</p>}
                  {s.prompt && (
                    <button type="button" onClick={() => setOpen(open === s.key ? null : s.key)} className="mt-1.5 text-[11px] font-semibold text-blue-600">
                      {open === s.key ? 'Hide prompt' : 'Show prompt'}
                    </button>
                  )}
                  {open === s.key && <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{s.prompt}</pre>}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
