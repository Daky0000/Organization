export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskAssignee = {
  user_id: string;
  name: string;
  avatar: string | null;
};

export type TaskLabel = {
  id: string;
  name: string;
  color: string;
};

export type TaskAction = {
  id: string;
  task_id: string;
  action_type: string;
  label: string;
  target_count: number;
  current_count: number;
};

export const ACTION_TYPES: { value: string; label: string }[] = [
  { value: 'create_post', label: 'Create Post' },
  { value: 'create_card', label: 'Create Card / Design' },
  { value: 'create_campaign', label: 'Create Campaign' },
  { value: 'send_email', label: 'Send Email' },
  { value: 'upload_media', label: 'Upload Media' },
  { value: 'create_automation', label: 'Set Up Automation' },
  { value: 'custom', label: 'Custom Action' },
];

export type Subtask = {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
};

export type TaskAttachment = {
  id: string;
  task_id: string;
  name: string;
  url: string;
  size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
  created_at: string;
};

export type TaskType = 'todo' | 'call' | 'email';

export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'todo',  label: 'To-do' },
  { value: 'call',  label: 'Call'  },
  { value: 'email', label: 'Email' },
];

export type ReminderOption = 'none' | 'at_due' | '30min' | '1hour' | '1day' | '1week' | 'custom';

export const REMINDER_OPTIONS: { value: ReminderOption; label: string }[] = [
  { value: 'none',   label: 'No reminder'       },
  { value: 'at_due', label: 'At task due time'  },
  { value: '30min',  label: '30 minutes before' },
  { value: '1hour',  label: '1 hour before'     },
  { value: '1day',   label: '1 day before'      },
  { value: '1week',  label: '1 week before'     },
  { value: 'custom', label: 'Custom date…'      },
];

export function reminderToTimestamp(dueDateIso: string, reminder: ReminderOption): string | null {
  if (reminder === 'none' || reminder === 'custom' || !dueDateIso) return null;
  const d = new Date(dueDateIso);
  const offsets: Record<Exclude<ReminderOption, 'custom'>, number> = { none: 0, at_due: 0, '30min': 30, '1hour': 60, '1day': 60*24, '1week': 60*24*7 };
  d.setMinutes(d.getMinutes() - offsets[reminder]);
  return d.toISOString();
}

export type Task = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: TaskType;
  reminder_at: string | null;
  crm_company_id: string | null;
  position: number;
  due_date: string | null;
  supervisor_id: string | null;
  supervisor_name: string | null;
  supervisor_avatar: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignees: TaskAssignee[];
  labels: TaskLabel[];
  subtask_count: number;
  subtask_done: number;
  comment_count: number;
  subtasks?: Subtask[];
  attachments?: TaskAttachment[];
  actions?: TaskAction[];
};

export type Comment = {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar: string | null;
  reactions: { emoji: string; count: number; reacted: boolean }[];
  replies: Comment[];
};

export type ProjectMember = {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  task_count: number;
};

export type TaskStats = {
  byStatus: Partial<Record<TaskStatus, number>>;
  total: number;
  overdue: number;
  memberLoad: { name: string; avatar: string | null; task_count: number }[];
  recentActivity: ActivityItem[];
};

export type ActivityItem = {
  id: string;
  action: string;
  created_at: string;
  metadata: Record<string, string> | null;
  user_name: string | null;
  avatar_url: string | null;
  task_title: string | null;
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'Need Review',
  done: 'Done',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  in_review: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#94a3b8',
  medium: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const QUICK_EMOJIS = ['👍', '❤️', '🎉', '😂', '🔥', '✅'];
