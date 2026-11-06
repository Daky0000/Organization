import { MessageSquare, Paperclip, Calendar, AlertTriangle } from 'lucide-react';
import { Task, PRIORITY_COLORS, PRIORITY_LABELS } from '../taskTypes';

type Props = { task: Task; isAdmin: boolean; onClick: () => void };

function Avatar({ name, avatar, size = 22 }: { name: string; avatar: string | null; size?: number }) {
  if (avatar) return <img src={avatar} alt={name} className="rounded-full object-cover ring-2 ring-white" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold text-white ring-2 ring-white" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

export default function TaskCard({ task, isAdmin, onClick }: Props) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

  const actions = task.actions ?? [];
  const totalActions = actions.reduce((s, a) => s + a.target_count, 0);
  const doneActions = actions.reduce((s, a) => s + Math.min(a.current_count, a.target_count), 0);
  const actionPct = totalActions > 0 ? Math.round((doneActions / totalActions) * 100) : null;

  const labels = task.labels ?? [];
  const assignees = task.assignees ?? [];

  return (
    <div
      onClick={onClick}
      className={`group rounded-xl border p-3 shadow-sm transition-all ${
        isAdmin ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${
        isOverdue
          ? 'border-red-100 bg-slate-50 opacity-50 grayscale hover:opacity-75 hover:grayscale-0'
          : 'border-gray-200 bg-white hover:shadow-md hover:border-indigo-200'
      }`}
    >
      {/* Labels */}
      {labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {labels.slice(0, 3).map((l) => (
            <span key={l.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: l.color }}>
              {l.name}
            </span>
          ))}
          {labels.length > 3 && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">+{labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Overdue badge */}
      {isOverdue && (
        <div className="mb-2 flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 w-fit">
          <AlertTriangle size={9} className="text-red-500 shrink-0" />
          <span className="text-[9px] font-black uppercase tracking-widest text-red-600">Overdue</span>
        </div>
      )}

      {/* Title + priority dot */}
      <div className="flex items-start gap-2 mb-2">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} title={PRIORITY_LABELS[task.priority]} />
        <p className={`text-[13px] font-semibold leading-snug line-clamp-2 ${isOverdue ? 'text-gray-400' : 'text-gray-900'}`}>{task.title}</p>
      </div>

      {/* Action progress */}
      {actionPct !== null && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-gray-400">{doneActions}/{totalActions} actions</span>
            <span className="text-[10px] font-semibold text-indigo-600">{actionPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${actionPct}%` }} />
          </div>
        </div>
      )}

      {/* Subtask progress (when no actions) */}
      {actionPct === null && task.subtask_count > 0 && (
        <div className="mb-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.round((task.subtask_done / task.subtask_count) * 100)}%` }} />
          </div>
          <span className="text-[10px] font-medium text-gray-400">{task.subtask_done}/{task.subtask_count}</span>
        </div>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between gap-2 mt-1">
        {/* Assignee avatars */}
        <div className="flex -space-x-1.5">
          {assignees.slice(0, 4).map((a) => (
            <Avatar key={a.user_id} name={a.name} avatar={a.avatar} size={22} />
          ))}
          {assignees.length > 4 && (
            <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 ring-2 ring-white">
              +{assignees.length - 4}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 text-gray-400">
          {task.due_date && (
            <span className={`flex items-center gap-0.5 text-[10px] font-semibold rounded px-1 py-0.5 ${isOverdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
              <Calendar size={10} />
              {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {task.due_date.length > 10 && (
                <span className="ml-0.5 opacity-75">
                  {new Date(task.due_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </span>
          )}
          {task.comment_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <MessageSquare size={10} /> {task.comment_count}
            </span>
          )}
          {(task.attachments?.length ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <Paperclip size={10} /> {task.attachments!.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
