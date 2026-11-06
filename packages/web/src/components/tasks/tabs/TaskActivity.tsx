import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { apiFetch } from '../TasksPage';
import { ActivityItem, STATUS_LABELS, TaskStatus } from '../taskTypes';

const ACTION_LABELS: Record<string, string> = {
  task_created: 'created',
  status_changed: 'moved',
  comment_added: 'commented on',
  assigned: 'was assigned to',
};

export default function TaskActivity({ projectId }: { projectId: string }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ activity: ActivityItem[] }>(`/api/projects/${projectId}/activity`)
      .then((d) => setActivity(d.activity))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;

  if (!activity.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <Clock size={28} className="mx-auto mb-2 text-gray-300" />
        <p className="text-sm font-semibold text-gray-500">No activity yet</p>
        <p className="mt-1 text-xs text-gray-400">Task changes, comments, and updates will appear here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <p className="text-sm font-bold text-gray-900">Project Activity</p>
      </div>
      <div className="divide-y divide-gray-50 px-5">
        {activity.map((a) => (
          <div key={a.id} className="flex items-start gap-3 py-3.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-black text-indigo-600">
              {(a.user_name ?? '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-gray-700">
                <span className="font-semibold">{a.user_name ?? 'Someone'}</span>
                {' '}{ACTION_LABELS[a.action] ?? a.action}{' '}
                {a.task_title && <span className="font-medium text-indigo-600">"{a.task_title}"</span>}
                {a.action === 'status_changed' && a.metadata && (
                  <span className="ml-1 text-gray-400">
                    <span className="text-gray-500">{STATUS_LABELS[(a.metadata.from as TaskStatus)] ?? a.metadata.from}</span>
                    {' → '}
                    <span className="font-semibold text-gray-700">{STATUS_LABELS[(a.metadata.to as TaskStatus)] ?? a.metadata.to}</span>
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-400">{new Date(a.created_at).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
