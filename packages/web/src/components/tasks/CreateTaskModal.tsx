import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Building2 } from 'lucide-react';
import CalendarPicker from './CalendarPicker';
import { Task, TaskStatus, TaskPriority, TaskLabel, TaskType, ReminderOption, ACTION_TYPES, TASK_TYPE_OPTIONS, REMINDER_OPTIONS, reminderToTimestamp } from './taskTypes';
import { apiFetch } from './TasksPage';
import { ColorPickerPopover } from '../cards/builder/ColorPicker';
import { useWorkspace } from '../../contexts/WorkspaceContext';

type ActionDraft = { action_type: string; label: string; target_count: number };

type Props = {
  /** Pass a projectId to use that project directly. Omit to show a project picker. */
  projectId?: string;
  defaultStatus?: TaskStatus;
  projectMembers?: { id: string; name: string; avatar_url: string | null }[];
  projectLabels?: TaskLabel[];
  /** CRM context: when set, the task is linked to this company */
  crmCompanyId?: string;
  crmCompanyName?: string;
  onCreated: (task: Task) => void;
  onClose: () => void;
};

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'low',    label: 'Low',    color: 'text-slate-500' },
  { value: 'medium', label: 'Medium', color: 'text-blue-500'  },
  { value: 'high',   label: 'High',   color: 'text-amber-500' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-500'   },
];

export default function CreateTaskModal({
  projectId: propProjectId,
  defaultStatus = 'todo',
  projectMembers: propMembers,
  projectLabels: propLabels,
  crmCompanyId,
  crmCompanyName,
  onCreated,
  onClose,
}: Props) {
  const { projects, currentProject } = useWorkspace();

  // Project selection — use prop if given, else default to current workspace project
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    propProjectId ?? currentProject?.id ?? ''
  );

  // When workspace loads, default to currentProject if nothing selected yet
  useEffect(() => {
    if (!selectedProjectId && currentProject?.id) setSelectedProjectId(currentProject.id);
  }, [currentProject?.id]);

  const resolvedProjectId = propProjectId ?? selectedProjectId;

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus]           = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority]       = useState<TaskPriority>('medium');
  const [taskType, setTaskType]       = useState<TaskType>('todo');
  const [reminder, setReminder]       = useState<ReminderOption>('none');
  const [customReminderDate, setCustomReminderDate] = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [labelIds, setLabelIds]       = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<TaskLabel[]>(propLabels ?? []);
  const [loadedMembers, setLoadedMembers]     = useState<{ id: string; name: string; avatar_url: string | null }[]>(propMembers ?? []);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#2563EB');
  const [actions, setActions]         = useState<ActionDraft[]>([]);
  const [saving, setSaving]           = useState(false);
  const titleRef      = useRef<HTMLInputElement>(null);
  const reminderRef   = useRef<HTMLDivElement>(null);
  const [calPos, setCalPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  // If no props were passed for members/labels (CRM context), load them when project is picked
  useEffect(() => {
    if (!resolvedProjectId) return;
    if (propMembers === undefined) {
      apiFetch<{ members: { id: string; name: string; avatar_url: string | null }[] }>(`/api/projects/${resolvedProjectId}/members`)
        .then(d => setLoadedMembers(d.members)).catch(() => undefined);
    }
    if (propLabels === undefined) {
      apiFetch<{ labels: TaskLabel[] }>(`/api/projects/${resolvedProjectId}/labels`)
        .then(d => setAvailableLabels(d.labels)).catch(() => undefined);
    }
  }, [resolvedProjectId]);

  const members = propMembers ?? loadedMembers;
  const labels  = propLabels  ?? availableLabels;

  const showCalendar = reminder === 'custom' && !customReminderDate;

  useEffect(() => {
    if (showCalendar && reminderRef.current) {
      const rect = reminderRef.current.getBoundingClientRect();
      const CAL_W = 288; // w-72
      const CAL_H = 420;
      const GAP   = 8;
      let top  = rect.bottom + GAP;
      let left = rect.left;
      if (left + CAL_W > window.innerWidth - 8) left = window.innerWidth - CAL_W - 8;
      if (left < 8) left = 8;
      if (top + CAL_H > window.innerHeight - 8) top = Math.max(8, rect.top - CAL_H - GAP);
      setCalPos({ top, left });
    } else {
      setCalPos(null);
    }
  }, [showCalendar]);

  const toggleAssignee = (id: string) =>
    setAssigneeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleLabel = (id: string) =>
    setLabelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const addAction    = () => setActions(prev => [...prev, { action_type: ACTION_TYPES[0].value, label: ACTION_TYPES[0].label, target_count: 1 }]);
  const updateAction = (i: number, patch: Partial<ActionDraft>) => setActions(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  const removeAction = (i: number) => setActions(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!title.trim() || !resolvedProjectId) return;
    setSaving(true);
    try {
      const reminderAt = reminder === 'custom'
        ? (customReminderDate ? new Date(customReminderDate).toISOString() : null)
        : (dueDate ? reminderToTimestamp(dueDate, reminder) : null);
      const data = await apiFetch<{ task: Task }>(`/api/projects/${resolvedProjectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description,
          status,
          priority,
          task_type: taskType,
          due_date: dueDate || undefined,
          reminder_at: reminderAt || undefined,
          crm_company_id: crmCompanyId || undefined,
          assignee_ids: assigneeIds,
          label_ids: labelIds,
          actions,
        }),
      });
      onCreated(data.task);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const showProjectPicker = !propProjectId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-bold text-gray-900">New Task</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* CRM company badge */}
          {crmCompanyName && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-[12px] text-indigo-700 font-medium w-fit">
              <Building2 size={12} /> {crmCompanyName}
            </div>
          )}

          {/* Project picker (only when no projectId prop) */}
          {showProjectPicker && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Project</label>
              <select
                value={selectedProjectId}
                onChange={e => { setSelectedProjectId(e.target.value); setLabelIds([]); setAssigneeIds([]); }}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {projects.length === 0 && <option value="">No projects — create one first</option>}
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Title */}
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) void handleSubmit(); }}
            placeholder="Task title…"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[15px] font-semibold text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />

          {/* Description */}
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Add description…"
            rows={2}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
          />

          {/* Task Type + Status + Priority */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Task Type</label>
              <select value={taskType} onChange={e => setTaskType(e.target.value as TaskType)}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {TASK_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">Need Review</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Due Date + Reminder */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Due Date & Time</label>
              <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div ref={reminderRef}>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Send Reminder</label>
              <select value={reminder} onChange={e => { setReminder(e.target.value as ReminderOption); setCustomReminderDate(''); }}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {REMINDER_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>

              {/* "Fires at" label (relative reminders) */}
              {reminder !== 'none' && reminder !== 'custom' && (() => {
                if (!dueDate) return (
                  <p className="mt-1 text-[10px] text-amber-500">Set a due date to enable this reminder</p>
                );
                const firesAt = reminderToTimestamp(dueDate, reminder);
                if (!firesAt) return null;
                const label = new Date(firesAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                return <p className="mt-1 text-[10px] text-indigo-500 font-medium">Fires at {label}</p>;
              })()}

              {/* Custom date: summary + change/clear controls */}
              {reminder === 'custom' && customReminderDate && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <p className="text-[10px] text-indigo-500 font-medium flex-1">
                    Fires at {new Date(customReminderDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                  <button
                    onClick={() => setCustomReminderDate('')}
                    className="text-[10px] text-[#2563EB] hover:underline font-semibold"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Assignees */}
          {members.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Assign To</label>
              <div className="flex flex-wrap gap-1.5">
                {members.map(m => {
                  const on = assigneeIds.includes(m.id);
                  return (
                    <button key={m.id} type="button" onClick={() => toggleAssignee(m.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt={m.name} className="h-4 w-4 rounded-full object-cover" />
                        : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">{m.name[0]}</span>
                      }
                      {m.name.split(' ')[0]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Labels */}
          {resolvedProjectId && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Labels</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {labels.map(l => {
                  const on = labelIds.includes(l.id);
                  return (
                    <button key={l.id} type="button" onClick={() => toggleLabel(l.id)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${on ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                      style={on ? { backgroundColor: l.color, borderColor: l.color } : {}}>
                      {l.name}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <input value={newLabelName} onChange={e => setNewLabelName(e.target.value)}
                  placeholder="New label name…"
                  className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <ColorPickerPopover value={newLabelColor} onChange={setNewLabelColor} />
                <button type="button" disabled={!newLabelName.trim()} onClick={async () => {
                  if (!newLabelName.trim() || !resolvedProjectId) return;
                  try {
                    const d = await apiFetch<{ label: TaskLabel }>(`/api/projects/${resolvedProjectId}/labels`, {
                      method: 'POST', body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor }),
                    });
                    setAvailableLabels(p => [...p, d.label]);
                    setLabelIds(p => [...p, d.label.id]);
                    setNewLabelName('');
                  } catch { /* ignore */ }
                }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                  + Add
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Actions (auto-tracked)</label>
              <button type="button" onClick={addAction}
                className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-600">
                <Plus size={11} /> Add Action
              </button>
            </div>
            {actions.length === 0 && (
              <p className="text-[12px] text-gray-400 italic">No actions — add actions to auto-track progress as the team works in the platform.</p>
            )}
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <select value={a.action_type}
                    onChange={e => {
                      const found = ACTION_TYPES.find(t => t.value === e.target.value);
                      updateAction(i, { action_type: e.target.value, label: found?.label ?? e.target.value });
                    }}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] text-gray-400">×</span>
                    <input type="number" min={1} max={9999} value={a.target_count}
                      onChange={e => updateAction(i, { target_count: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-14 rounded-lg border border-gray-200 bg-white px-2 py-1 text-center text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  <button type="button" onClick={() => removeAction(i)} className="text-gray-300 hover:text-red-400 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-[13px] text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving || !title.trim() || !resolvedProjectId}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
            {saving ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>

      {/* Calendar portal — floats above the modal */}
      {showCalendar && calPos && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setReminder('none')}
          />
          <div style={{ position: 'fixed', top: calPos.top, left: calPos.left, zIndex: 9999 }}>
            <CalendarPicker
              value={customReminderDate}
              onChange={val => setCustomReminderDate(val)}
              onCancel={() => setReminder('none')}
            />
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
