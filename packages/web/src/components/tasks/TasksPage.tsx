import { useEffect, useState } from 'react';
import { BarChart2, Clock, Files, LayoutGrid, Plus, Users } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { API_BASE_URL } from '../../utils/apiBase';
import { Task, TaskStatus, TaskLabel, ProjectMember } from './taskTypes';
import CreateTaskModal from './CreateTaskModal';
import TaskOverview from './tabs/TaskOverview';
import TaskBoard from './tabs/TaskBoard';
import TaskFiles from './tabs/TaskFiles';
import TaskActivity from './tabs/TaskActivity';
import TaskMembers from './tabs/TaskMembers';
import TaskDetailPanel from './detail/TaskDetailPanel';

export type TaskTab = 'overview' | 'board' | 'files' | 'activity' | 'members';

type Props = {
  initialFilter?: string;
};

function tok() { return localStorage.getItem('auth_token') ?? ''; }

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any).error || `Request failed ${r.status}`);
  return data as T;
}

export default function TasksPage({ initialFilter }: Props) {
  const { currentProject, currentOrg } = useWorkspace();
  const [activeTab, setActiveTab] = useState<TaskTab>('board');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>(
    (initialFilter as TaskStatus) || 'all'
  );
  const [showCreateModal, setShowCreateModal] = useState(false);

  const projectId = currentProject?.id ?? '';
  const [projectMembers, setProjectMembers] = useState<{ id: string; name: string; avatar_url: string | null }[]>([]);
  const [projectLabels, setProjectLabels] = useState<TaskLabel[]>([]);

  const loadTasks = async (status?: TaskStatus | 'all') => {
    if (!projectId) return;
    setLoading(true);
    try {
      const qs = status && status !== 'all' ? `?status=${status}` : '';
      const data = await apiFetch<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks${qs}`);
      setTasks(data.tasks);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks(filterStatus !== 'all' ? filterStatus : undefined);
    if (projectId) {
      apiFetch<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`)
        .then((d) => setProjectMembers(d.members.map((m) => ({ id: m.id, name: m.name, avatar_url: m.avatar_url }))))
        .catch(() => undefined);
      apiFetch<{ labels: TaskLabel[] }>(`/api/projects/${projectId}/labels`)
        .then((d) => setProjectLabels(d.labels))
        .catch(() => undefined);
    }
  }, [projectId, filterStatus]);

  useEffect(() => {
    if (initialFilter && initialFilter !== 'all') {
      setFilterStatus(initialFilter as TaskStatus);
    }
  }, [initialFilter]);

  if (!currentProject) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
        <p className="text-sm text-gray-400">Select a project to view tasks</p>
      </div>
    );
  }

  const TABS: { id: TaskTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart2 },
    { id: 'board', label: 'Board', icon: LayoutGrid },
    { id: 'files', label: 'Files', icon: Files },
    { id: 'activity', label: 'Activity', icon: Clock },
    { id: 'members', label: 'Members', icon: Users },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: currentProject.color }}>
              {currentProject.name[0].toUpperCase()}
            </span>
            <h1 className="text-xl font-black tracking-tight text-gray-900">{currentProject.name}</h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Tasks</span>
          </div>
          {currentOrg && <p className="mt-0.5 text-xs text-gray-400">{currentOrg.name}</p>}
        </div>
        <button type="button" onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-indigo-700 shadow-sm transition-colors">
          <Plus size={14} /> Create Task
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl border border-gray-200 bg-white p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold transition-colors ${
              activeTab === id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon size={13} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <TaskOverview projectId={projectId} onOpenTask={(t) => setSelectedTask(t)} tasks={tasks} />
      )}
      {activeTab === 'board' && (
        <TaskBoard
          projectId={projectId}
          tasks={tasks}
          loading={loading}
          onTasksChange={setTasks}
          onOpenTask={(t) => setSelectedTask(t)}
          onReload={() => void loadTasks()}
          projectMembers={projectMembers}
          projectLabels={projectLabels}
        />
      )}
      {activeTab === 'files' && <TaskFiles projectId={projectId} />}
      {activeTab === 'activity' && <TaskActivity projectId={projectId} />}
      {activeTab === 'members' && <TaskMembers projectId={projectId} />}

      {/* Global create task modal */}
      {showCreateModal && (
        <CreateTaskModal
          projectId={projectId}
          defaultStatus="todo"
          projectMembers={projectMembers}
          projectLabels={projectLabels}
          onCreated={(task) => setTasks((prev) => [...prev, task])}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Task detail slide-over */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projectId={projectId}
          onClose={() => setSelectedTask(null)}
          onUpdated={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
            setSelectedTask(updated);
          }}
          onDeleted={(id) => {
            setTasks((prev) => prev.filter((t) => t.id !== id));
            setSelectedTask(null);
          }}
        />
      )}
    </div>
  );
}
