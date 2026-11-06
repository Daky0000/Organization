import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Calendar, Check, ChevronDown, Download, Flag,
  Paperclip, Plus, Send, Trash2, User, X,
} from 'lucide-react';
import { apiFetch } from '../TasksPage';
import {
  Task, TaskStatus, TaskPriority, Subtask, Comment, TaskLabel,
  ProjectMember, TaskAttachment, TaskAction, QUICK_EMOJIS,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, PRIORITY_LABELS,
} from '../taskTypes';
import { compressImage } from '../../../utils/imageCompression';
import FileUploadDropzone from '../../FileUploadDropzone';

type Tab = 'progress' | 'files' | 'comments';

type Props = {
  task: Task;
  projectId: string;
  onClose: () => void;
  onUpdated: (t: Task) => void;
  onDeleted: (id: string) => void;
};

function Avatar({ name, avatar, size = 24 }: { name?: string | null; avatar?: string | null; size?: number }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  if (avatar) return <img src={avatar} alt={name ?? ''} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initial}
    </div>
  );
}

function getCurrentUserId(): string {
  try {
    const token = localStorage.getItem('auth_token') ?? '';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.userId ?? payload.sub ?? '';
  } catch { return ''; }
}

export default function TaskDetailPanel({ task: initialTask, projectId, onClose, onUpdated, onDeleted }: Props) {
  const [task, setTask] = useState<Task>(initialTask);
  const [subtasks, setSubtasks] = useState<Subtask[]>(initialTask.subtasks ?? []);
  const [attachments, setAttachments] = useState<TaskAttachment[]>(initialTask.attachments ?? []);
  const [actions, setActions] = useState<TaskAction[]>(initialTask.actions ?? []);
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [tab, setTab] = useState<Tab>('progress');
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showSupervisorPicker, setShowSupervisorPicker] = useState(false);
  const [supervisorWarning, setSupervisorWarning] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#2563EB');
  const [uploadError, setUploadError] = useState('');
  const [saving, setSaving] = useState(false);
  const currentUserId = getCurrentUserId();

  // Close all pickers on outside click
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) return;
      // Only close pickers if click is outside their trigger areas — handled by the buttons toggling
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const patch = async (updates: Partial<Task>) => {
    const merged = { ...task, ...updates };
    setTask(merged);
    onUpdated(merged);
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PUT', body: JSON.stringify(updates),
      });
    } finally { setSaving(false); }
  };

  const changeStatus = async (status: TaskStatus) => {
    setTask((t) => ({ ...t, status }));
    onUpdated({ ...task, status });
    setShowStatusPicker(false);
    await apiFetch(`/api/projects/${projectId}/tasks/${task.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  };

  const loadFull = async () => {
    const [taskData, commentsData, membersData, labelsData] = await Promise.all([
      apiFetch<{ task: Task }>(`/api/projects/${projectId}/tasks/${task.id}`),
      apiFetch<{ comments: Comment[] }>(`/api/tasks/${task.id}/comments`),
      apiFetch<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`),
      apiFetch<{ labels: TaskLabel[] }>(`/api/projects/${projectId}/labels`),
    ]);
    setTask(taskData.task);
    setSubtasks(taskData.task.subtasks ?? []);
    setAttachments(taskData.task.attachments ?? []);
    setActions(taskData.task.actions ?? []);
    setComments(commentsData.comments);
    setMembers(membersData.members);
    setLabels(labelsData.labels);
  };

  useEffect(() => { void loadFull(); }, [task.id]);

  // Subtasks
  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    const d = await apiFetch<{ subtask: Subtask }>(`/api/tasks/${task.id}/subtasks`, {
      method: 'POST', body: JSON.stringify({ title: newSubtask.trim() }),
    });
    setSubtasks((p) => [...p, d.subtask]);
    setNewSubtask('');
    setTask((t) => ({ ...t, subtask_count: t.subtask_count + 1 }));
  };

  const toggleSubtask = async (s: Subtask) => {
    const updated = { ...s, completed: !s.completed };
    setSubtasks((p) => p.map((x) => (x.id === s.id ? updated : x)));
    await apiFetch(`/api/tasks/${task.id}/subtasks/${s.id}`, {
      method: 'PATCH', body: JSON.stringify({ completed: updated.completed }),
    });
    const arr = subtasks.map((x) => (x.id === s.id ? updated : x));
    setTask((t) => ({ ...t, subtask_done: arr.filter((x) => x.completed).length }));
  };

  const deleteSubtask = async (id: string) => {
    setSubtasks((p) => p.filter((s) => s.id !== id));
    await apiFetch(`/api/tasks/${task.id}/subtasks/${id}`, { method: 'DELETE' });
  };

  // Assignees
  const toggleAssignee = async (member: ProjectMember) => {
    const isAssigned = task.assignees.some((a) => a.user_id === member.id);
    if (isAssigned) {
      setTask((t) => ({ ...t, assignees: t.assignees.filter((a) => a.user_id !== member.id) }));
      await apiFetch(`/api/tasks/${task.id}/assignees/${member.id}`, { method: 'DELETE' });
    } else {
      const newAssignee = { user_id: member.id, name: member.name, avatar: member.avatar_url };
      setTask((t) => ({ ...t, assignees: [...t.assignees, newAssignee] }));
      await apiFetch(`/api/tasks/${task.id}/assignees`, {
        method: 'POST', body: JSON.stringify({ user_id: member.id }),
      });
    }
  };

  // Labels
  const toggleLabel = async (label: TaskLabel) => {
    const isOn = task.labels.some((l) => l.id === label.id);
    if (isOn) {
      setTask((t) => ({ ...t, labels: t.labels.filter((l) => l.id !== label.id) }));
      await apiFetch(`/api/tasks/${task.id}/labels/${label.id}`, { method: 'DELETE' });
    } else {
      setTask((t) => ({ ...t, labels: [...t.labels, label] }));
      await apiFetch(`/api/tasks/${task.id}/labels/${label.id}`, { method: 'POST' });
    }
  };

  const createLabel = async () => {
    if (!newLabel.trim()) return;
    const d = await apiFetch<{ label: TaskLabel }>(`/api/projects/${projectId}/labels`, {
      method: 'POST', body: JSON.stringify({ name: newLabel.trim(), color: newLabelColor }),
    });
    setLabels((p) => [...p, d.label]);
    setNewLabel('');
  };

  // Comments
  const postComment = async () => {
    if (!newComment.trim()) return;
    const d = await apiFetch<{ comment: Comment }>(`/api/tasks/${task.id}/comments`, {
      method: 'POST', body: JSON.stringify({ content: newComment.trim(), parent_id: replyTo?.id }),
    });
    if (replyTo) {
      setComments((p) => p.map((c) => c.id === replyTo.id ? { ...c, replies: [...c.replies, d.comment] } : c));
    } else {
      setComments((p) => [...p, { ...d.comment, reactions: [], replies: [] }]);
    }
    setNewComment('');
    setReplyTo(null);
  };

  const deleteComment = async (commentId: string, parentId?: string) => {
    await apiFetch(`/api/tasks/${task.id}/comments/${commentId}`, { method: 'DELETE' });
    if (parentId) {
      setComments((p) => p.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== commentId) } : c));
    } else {
      setComments((p) => p.filter((c) => c.id !== commentId));
    }
  };

  const toggleReaction = async (commentId: string, emoji: string) => {
    await apiFetch(`/api/tasks/${task.id}/comments/${commentId}/reactions`, {
      method: 'POST', body: JSON.stringify({ emoji }),
    });
    setComments((p) => p.map((c) => {
      if (c.id !== commentId) return c;
      const existing = c.reactions.find((r) => r.emoji === emoji);
      let reactions: typeof c.reactions;
      if (existing) {
        reactions = existing.reacted
          ? c.reactions.map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, reacted: false } : r).filter((r) => r.count > 0)
          : c.reactions.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, reacted: true } : r);
      } else {
        reactions = [...c.reactions, { emoji, count: 1, reacted: true }];
      }
      return { ...c, reactions };
    }));
  };

  // Upload files: compress images → base64 DataURL stored directly in task_attachments
  const uploadFiles = async (files: File[]) => {
    setUploadError('');
    try {
      for (const file of files) {
        let url: string;
        if (file.type.startsWith('image/')) {
          const compressed = await compressImage(file);
          url = compressed.url;
        } else {
          url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
          });
        }
        const att = await apiFetch<{ attachment: TaskAttachment }>(`/api/tasks/${task.id}/attachments`, {
          method: 'POST',
          body: JSON.stringify({ name: file.name, url, size: file.size, mime_type: file.type }),
        });
        setAttachments((p) => [...p, att.attachment]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const deleteAttachment = async (id: string) => {
    setAttachments((p) => p.filter((a) => a.id !== id));
    await apiFetch(`/api/tasks/${task.id}/attachments/${id}`, { method: 'DELETE' });
  };

  const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
  const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

  // Action progress totals
  const totalActionPts = actions.reduce((s, a) => s + a.target_count, 0);
  const doneActionPts = actions.reduce((s, a) => s + Math.min(a.current_count, a.target_count), 0);
  const overallPct = totalActionPts > 0 ? Math.round((doneActionPts / totalActionPts) * 100) : null;
  const subtaskPct = subtasks.length > 0 ? Math.round((subtasks.filter((s) => s.completed).length / subtasks.length) * 100) : 0;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'progress', label: 'Progress' },
    { id: 'files', label: 'Files', count: attachments.length || undefined },
    { id: 'comments', label: 'Comments', count: comments.length || undefined },
  ];

  return (
    <div className="fixed inset-0 z-40 flex" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div ref={panelRef} className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="border-b border-gray-100 px-6 py-4">
          {/* Breadcrumb */}
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-gray-400">
            <span>In list</span>
            <div className="relative">
              <button type="button" onClick={() => setShowStatusPicker((v) => !v)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[task.status]}`}>
                {STATUS_LABELS[task.status]} <ChevronDown size={9} />
              </button>
              {showStatusPicker && (
                <div className="absolute left-0 top-7 z-20 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {STATUSES.map((s) => (
                    <button key={s} type="button" onClick={() => void changeStatus(s)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium hover:bg-gray-50 ${task.status === s ? 'text-indigo-600' : 'text-gray-700'}`}>
                      {task.status === s && <Check size={11} />}
                      {task.status !== s && <span className="w-[11px]" />}
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {saving && <span className="ml-2 text-gray-300">saving…</span>}
          </div>

          {/* Title */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => { setEditingTitle(false); if (titleDraft.trim() !== task.title) void patch({ title: titleDraft.trim() }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false); } }}
                  className="w-full rounded-xl border border-indigo-300 px-3 py-1.5 text-xl font-black text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              ) : (
                <h2 role="button" tabIndex={0} onClick={() => setEditingTitle(true)}
                  className="cursor-text text-xl font-black text-gray-900 hover:text-indigo-700 transition-colors leading-tight">
                  {task.title}
                </h2>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 mt-0.5">
              <button type="button"
                onClick={() => { if (confirm('Delete this task?')) { void apiFetch(`/api/projects/${projectId}/tasks/${task.id}`, { method: 'DELETE' }).then(() => onDeleted(task.id)); } }}
                className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 size={15} />
              </button>
              <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Priority + Labels */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative">
              <button type="button" onClick={() => setShowPriorityPicker((v) => !v)}
                className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600 hover:border-gray-300">
                <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLORS[task.priority] }} />
                {PRIORITY_LABELS[task.priority]} <ChevronDown size={9} />
              </button>
              {showPriorityPicker && (
                <div className="absolute left-0 top-7 z-20 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {PRIORITIES.map((p) => (
                    <button key={p} type="button" onClick={() => { setShowPriorityPicker(false); void patch({ priority: p }); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
                      <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLORS[p] }} />
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {task.labels.map((l) => (
              <span key={l.id} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: l.color }}>
                {l.name}
                <button type="button" onClick={() => void toggleLabel(l)} className="opacity-70 hover:opacity-100"><X size={8} /></button>
              </span>
            ))}
          </div>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 overflow-hidden">

          {/* Main — tabs */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-gray-100 px-5">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-[13px] font-semibold transition-colors ${tab === t.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.id ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>{t.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* ── PROGRESS TAB ── */}
              {tab === 'progress' && (
                <>
                  {/* Overall progress ring */}
                  {overallPct !== null && (
                    <div className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#2563EB" strokeWidth="3.5"
                            strokeDasharray={`${overallPct} ${100 - overallPct}`} strokeLinecap="round" />
                        </svg>
                        <span className="absolute text-[13px] font-black text-gray-900">{overallPct}%</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{overallPct}% complete</p>
                        <p className="text-[12px] text-gray-400">{doneActionPts} of {totalActionPts} action points done</p>
                      </div>
                    </div>
                  )}

                  {/* Action items */}
                  {actions.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Action Items</p>
                      {actions.map((a) => {
                        const pct = Math.round((Math.min(a.current_count, a.target_count) / a.target_count) * 100);
                        const done = a.current_count >= a.target_count;
                        return (
                          <div key={a.id} className={`rounded-xl border p-3.5 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                                  {done && <Check size={11} className="text-white" />}
                                </div>
                                <span className={`text-[13px] font-semibold ${done ? 'text-emerald-700 line-through opacity-70' : 'text-gray-900'}`}>{a.label}</span>
                              </div>
                              <span className={`shrink-0 text-[12px] font-bold ${done ? 'text-emerald-600' : 'text-indigo-600'}`}>
                                {a.current_count}/{a.target_count}
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-gray-100">
                              <div className={`h-2 rounded-full transition-all ${done ? 'bg-emerald-400' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                      <p className="text-[13px] font-semibold text-gray-500">No action items</p>
                      <p className="mt-1 text-[12px] text-gray-400">Actions are added when creating the task and auto-tracked as the team works.</p>
                    </div>
                  )}

                  {/* Description */}
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Description</p>
                    {editingDesc ? (
                      <div>
                        <textarea autoFocus value={descDraft} onChange={(e) => setDescDraft(e.target.value)} rows={4}
                          className="w-full resize-none rounded-xl border border-indigo-200 p-3 text-[13px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        <div className="mt-1.5 flex gap-1.5">
                          <button type="button" onClick={() => { setEditingDesc(false); void patch({ description: descDraft }); }}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">Save</button>
                          <button type="button" onClick={() => { setDescDraft(task.description); setEditingDesc(false); }}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div role="button" tabIndex={0} onClick={() => setEditingDesc(true)}
                        className="min-h-[48px] cursor-text rounded-xl border border-dashed border-gray-200 p-3 text-[13px] text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/20">
                        {task.description || <span className="text-gray-400 italic">Click to add description…</span>}
                      </div>
                    )}
                  </div>

                  {/* Subtasks */}
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                        Subtasks
                      </p>
                      {subtasks.length > 0 && (
                        <span className="text-[11px] font-bold text-gray-500">{subtasks.filter((s) => s.completed).length}/{subtasks.length}</span>
                      )}
                    </div>
                    {subtasks.length > 0 && (
                      <div className="mb-2 h-1.5 w-full rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${subtaskPct}%` }} />
                      </div>
                    )}
                    <div className="space-y-1.5 mb-2">
                      {subtasks.map((s) => (
                        <div key={s.id} className="group flex items-center gap-2">
                          <button type="button" onClick={() => void toggleSubtask(s)}
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${s.completed ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 hover:border-indigo-400'}`}>
                            {s.completed && <Check size={10} className="text-white" />}
                          </button>
                          <span className={`flex-1 text-[13px] ${s.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{s.title}</span>
                          <button type="button" onClick={() => void deleteSubtask(s.id)}
                            className="hidden rounded p-0.5 text-gray-300 hover:text-red-400 group-hover:block">
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void addSubtask()}
                        placeholder="Add subtask…"
                        className="flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                      <button type="button" onClick={() => void addSubtask()} disabled={!newSubtask.trim()}
                        className="rounded-xl bg-indigo-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── FILES TAB ── */}
              {tab === 'files' && (
                <div className="space-y-3">
                  {/* Existing attachments */}
                  {attachments.length > 0 && (
                    <div className="space-y-2">
                      {attachments.map((a) => (
                        <div key={a.id} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:border-gray-300 transition-colors">
                          {a.mime_type?.startsWith('image/') ? (
                            <img src={a.url} alt={a.name} className="h-10 w-10 rounded-lg object-cover shrink-0" />
                          ) : (
                            <Paperclip size={15} className="shrink-0 text-gray-400" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-[13px] font-medium text-gray-800">{a.name}</p>
                            {a.size && <p className="text-[11px] text-gray-400">{(a.size / 1024).toFixed(0)} KB · {a.mime_type}</p>}
                          </div>
                          <a href={a.url} download={a.name} target="_blank" rel="noreferrer"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 transition-colors">
                            <Download size={14} />
                          </a>
                          <button type="button" onClick={() => void deleteAttachment(a.id)}
                            className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {uploadError && (
                    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                      <AlertCircle size={13} /> {uploadError}
                      <button type="button" onClick={() => setUploadError('')} className="ml-auto"><X size={11} /></button>
                    </div>
                  )}
                  {/* Drop zone */}
                  <FileUploadDropzone multiple onUpload={uploadFiles} />
                </div>
              )}

              {/* ── COMMENTS TAB ── */}
              {tab === 'comments' && (
                <>
                  {/* Comment list */}
                  <div className="space-y-4">
                    {comments.map((c) => (
                      <div key={c.id}>
                        <div className="flex items-start gap-2.5">
                          <Avatar name={c.author_name} avatar={c.author_avatar} size={30} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[12px] font-bold text-gray-900">{c.author_name}</span>
                              <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
                            </div>
                            <p className="mt-0.5 rounded-xl rounded-tl-none bg-gray-50 px-3 py-2 text-[13px] text-gray-700">{c.content}</p>
                            {/* Reactions */}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {c.reactions.map((r) => (
                                <button key={r.emoji} type="button" onClick={() => void toggleReaction(c.id, r.emoji)}
                                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${r.reacted ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                                  {r.emoji} {r.count}
                                </button>
                              ))}
                              {QUICK_EMOJIS.map((e) => (
                                <button key={e} type="button" onClick={() => void toggleReaction(c.id, e)}
                                  className="rounded-full border border-transparent p-0.5 text-[13px] opacity-30 hover:border-gray-200 hover:opacity-100 transition-all">
                                  {e}
                                </button>
                              ))}
                              <button type="button" onClick={() => setReplyTo(c)} className="ml-1 text-[11px] font-medium text-gray-400 hover:text-indigo-600">Reply</button>
                              <button type="button" onClick={() => void deleteComment(c.id)} className="ml-1 text-[11px] text-gray-300 hover:text-red-400">Delete</button>
                            </div>
                            {/* Replies */}
                            {c.replies.map((r) => (
                              <div key={r.id} className="mt-2 flex items-start gap-2 border-l-2 border-gray-100 pl-3">
                                <Avatar name={r.author_name} avatar={r.author_avatar} size={22} />
                                <div className="flex-1 min-w-0">
                                  <span className="text-[11px] font-bold text-gray-900">{r.author_name}</span>
                                  <span className="ml-1.5 text-[10px] text-gray-400">{new Date(r.created_at).toLocaleString()}</span>
                                  <p className="mt-0.5 text-[12px] text-gray-700">{r.content}</p>
                                </div>
                                <button type="button" onClick={() => void deleteComment(r.id, c.id)} className="mt-0.5 text-[10px] text-gray-300 hover:text-red-400">×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    {comments.length === 0 && (
                      <p className="text-center text-[13px] text-gray-400 py-8">No comments yet. Be the first!</p>
                    )}
                  </div>

                  {/* Comment input */}
                  {replyTo && (
                    <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-[12px] text-indigo-600">
                      Replying to <span className="font-bold">{replyTo.author_name}</span>
                      <button type="button" onClick={() => setReplyTo(null)} className="ml-auto"><X size={12} /></button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postComment(); } }}
                      placeholder={replyTo ? `Reply to ${replyTo.author_name}…` : 'Write a comment… (Enter to send)'}
                      rows={2}
                      className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    <button type="button" onClick={() => void postComment()} disabled={!newComment.trim()}
                      className="self-end rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-40">
                      <Send size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-52 shrink-0 space-y-4 overflow-y-auto border-l border-gray-100 p-4">

            {/* Assignees */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Assignees</p>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {task.assignees.map((a) => (
                  <div key={a.user_id} className="flex items-center gap-1 rounded-full bg-gray-100 pl-0.5 pr-2 py-0.5">
                    <Avatar name={a.name} avatar={a.avatar} size={18} />
                    <span className="text-[11px] font-medium text-gray-700">{a.name.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
              <div className="relative">
                <button type="button" onClick={() => setShowAssignPicker((v) => !v)}
                  className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-[11px] text-gray-400 hover:border-indigo-300 hover:text-indigo-600">
                  <User size={11} /> Assign
                </button>
                {showAssignPicker && (
                  <div className="absolute left-0 top-8 z-20 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {members.map((m) => {
                      const assigned = task.assignees.some((a) => a.user_id === m.id);
                      return (
                        <button key={m.id} type="button" onClick={() => void toggleAssignee(m)}
                          className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50">
                          <Avatar name={m.name} avatar={m.avatar_url} size={20} />
                          <span className="flex-1 truncate text-[12px] text-gray-700">{m.name}</span>
                          {assigned && <Check size={11} className="text-indigo-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Supervisor */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Supervisor</p>
              <div className="relative">
                <button type="button" onClick={() => setShowSupervisorPicker((v) => !v)}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-600 hover:border-indigo-300">
                  <User size={11} className={task.supervisor_name ? 'text-indigo-500' : ''} />
                  <span className="flex-1 truncate text-left">{task.supervisor_name ?? 'None'}</span>
                  <ChevronDown size={10} className="shrink-0" />
                </button>
                {showSupervisorPicker && (
                  <div className="absolute left-0 top-10 z-20 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {supervisorWarning && (
                      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-amber-600 bg-amber-50 border-b border-amber-100">
                        <AlertCircle size={11} /> You can't assign yourself as supervisor
                      </div>
                    )}
                    <button type="button" onClick={() => { setShowSupervisorPicker(false); setSupervisorWarning(false); void patch({ supervisor_id: null }); }}
                      className="w-full px-3 py-2 text-left text-[12px] text-gray-400 hover:bg-gray-50">None</button>
                    {members.map((m) => (
                      <button key={m.id} type="button" onClick={() => {
                        if (m.id === currentUserId) { setSupervisorWarning(true); return; }
                        setSupervisorWarning(false);
                        setShowSupervisorPicker(false);
                        void patch({ supervisor_id: m.id });
                      }}
                        className={`flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50 ${m.id === currentUserId ? 'opacity-50' : ''}`}>
                        <Avatar name={m.name} avatar={m.avatar_url} size={18} />
                        <span className="flex-1 truncate text-[12px] text-gray-700">{m.name}</span>
                        {task.supervisor_id === m.id && <Check size={11} className="text-indigo-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Due Date */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Due Date</p>
              <div className="flex items-center gap-1">
                <Calendar size={12} className="shrink-0 text-gray-400" />
                <input type="datetime-local" value={task.due_date ? task.due_date.slice(0, 16) : ''}
                  onChange={(e) => void patch({ due_date: e.target.value || null })}
                  className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                {task.due_date && (
                  <button type="button" onClick={() => void patch({ due_date: null })} className="shrink-0 text-gray-300 hover:text-red-400">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Labels */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Labels</p>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {task.labels.map((l) => (
                  <span key={l.id} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: l.color }}>
                    {l.name}
                    <button type="button" onClick={() => void toggleLabel(l)} className="opacity-70 hover:opacity-100"><X size={8} /></button>
                  </span>
                ))}
              </div>
              <div className="relative">
                <button type="button" onClick={() => setShowLabelPicker((v) => !v)}
                  className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-[11px] text-gray-400 hover:border-indigo-300 hover:text-indigo-600">
                  <Flag size={11} /> Labels
                </button>
                {showLabelPicker && (
                  <div className="absolute left-0 top-8 z-20 w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                    <div className="mb-2 space-y-0.5">
                      {labels.map((l) => {
                        const on = task.labels.some((x) => x.id === l.id);
                        return (
                          <button key={l.id} type="button" onClick={() => void toggleLabel(l)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: l.color }} />
                            <span className="flex-1 text-left text-[12px] text-gray-700">{l.name}</span>
                            {on && <Check size={11} className="text-indigo-600" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-gray-100 pt-2">
                      <p className="mb-1 text-[10px] font-semibold text-gray-400">Create new</p>
                      <div className="flex gap-1">
                        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label name"
                          className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                        <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)}
                          className="h-7 w-7 cursor-pointer rounded-lg border border-gray-200 p-0.5" />
                        <button type="button" onClick={() => void createLabel()} disabled={!newLabel.trim()}
                          className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">+</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="rounded-xl bg-gray-50 p-3 text-[10px] text-gray-400 space-y-0.5">
              <p>Created {new Date(task.created_at).toLocaleDateString()}</p>
              <p>Updated {new Date(task.updated_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
