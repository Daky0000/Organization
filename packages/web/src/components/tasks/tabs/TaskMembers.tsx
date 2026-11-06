import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { apiFetch } from '../TasksPage';
import { ProjectMember } from '../taskTypes';

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  editor: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-600',
};

export default function TaskMembers({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`)
      .then((d) => setMembers(d.members))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <p className="text-sm font-bold text-gray-900">Project Members ({members.length})</p>
      </div>
      {members.length === 0 ? (
        <div className="py-12 text-center">
          <Users size={24} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">No members found</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3.5">
              {m.avatar_url ? (
                <img src={m.avatar_url} alt={m.name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">
                  {m.name[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-gray-900">{m.name}</p>
                <p className="truncate text-[11px] text-gray-400">{m.email}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                {m.role}
              </span>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600">
                {m.task_count} tasks
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
