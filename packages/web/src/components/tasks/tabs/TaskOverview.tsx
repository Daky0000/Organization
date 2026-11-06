import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Task, TaskStats, STATUS_LABELS, STATUS_COLORS } from '../taskTypes';
import { apiFetch } from '../TasksPage';

type Props = { projectId: string; tasks?: Task[]; onOpenTask?: (t: Task) => void };

function Avatar({ name, avatar, size = 28 }: { name: string; avatar: string | null; size?: number }) {
  if (avatar) return <img src={avatar} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  task_created: 'created task',
  status_changed: 'moved task',
  comment_added: 'commented on',
};

export default function TaskOverview({ projectId }: Props) {
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<TaskStats>(`/api/projects/${projectId}/task-stats`)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading || !stats) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;
  }

  const total = stats.total || 1;
  const done = stats.byStatus.done ?? 0;
  const pct = Math.round((done / total) * 100);

  const STATUS_ORDER = ['todo', 'in_progress', 'in_review', 'done'] as const;

  return (
    <div className="space-y-4">
      {/* Top row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Completion ring */}
        <div className="col-span-2 flex items-center gap-5 rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-1">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
            <svg className="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.9" fill="none" stroke="#2563EB" strokeWidth="3"
                strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-lg font-black text-gray-900">{pct}%</span>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Completion</p>
            <p className="mt-1 text-2xl font-black text-gray-900">{done}<span className="text-sm font-medium text-gray-400">/{stats.total}</span></p>
            <p className="text-xs text-gray-400">tasks done</p>
          </div>
        </div>

        {/* Status counts */}
        <div className="col-span-2 rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-3">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">By Status</p>
          <div className="space-y-2">
            {STATUS_ORDER.map((s) => {
              const count = stats.byStatus[s] ?? 0;
              const barPct = Math.round((count / total) * 100);
              return (
                <div key={s} className="flex items-center gap-3">
                  <span className={`w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${STATUS_COLORS[s]}`}>
                    {STATUS_LABELS[s]}
                  </span>
                  <div className="h-2 flex-1 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="w-6 text-right text-[12px] font-bold text-gray-700">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Alert row */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`flex items-center gap-3 rounded-2xl border p-4 ${stats.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
          <AlertTriangle size={18} className={stats.overdue > 0 ? 'text-red-500' : 'text-gray-300'} />
          <div>
            <p className="text-sm font-bold text-gray-900">{stats.overdue} overdue</p>
            <p className="text-xs text-gray-400">tasks past due date</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
          <CheckCircle2 size={18} className="text-emerald-500" />
          <div>
            <p className="text-sm font-bold text-gray-900">{pct}% complete</p>
            <p className="text-xs text-gray-400">{done} of {stats.total} tasks done</p>
          </div>
        </div>
      </div>

      {/* Member workload */}
      {stats.memberLoad.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Member Workload</p>
          <div className="space-y-3">
            {stats.memberLoad.map((m) => (
              <div key={m.name} className="flex items-center gap-3">
                <Avatar name={m.name} avatar={m.avatar} />
                <span className="w-24 shrink-0 truncate text-[13px] font-medium text-gray-700">{m.name}</span>
                <div className="h-2 flex-1 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${Math.min((m.task_count / (stats.memberLoad[0]?.task_count || 1)) * 100, 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-[12px] font-bold text-gray-500">{m.task_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {stats.recentActivity.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Recent Activity</p>
          <div className="space-y-3">
            {stats.recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-black text-indigo-600">
                  {(a.user_name ?? '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-[13px] text-gray-700">
                    <span className="font-semibold">{a.user_name ?? 'Someone'}</span>
                    {' '}{ACTION_LABELS[a.action] ?? a.action}{' '}
                    {a.task_title && <span className="font-medium text-indigo-600">"{a.task_title}"</span>}
                    {a.action === 'status_changed' && a.metadata && (
                      <span className="text-gray-400"> → {(STATUS_LABELS as Record<string, string>)[a.metadata.to] ?? a.metadata.to}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
