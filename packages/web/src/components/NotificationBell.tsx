import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  Bell,
  Bot,
  Brain,
  Calendar,
  CheckCheck,
  Clock,
  FileText,
  Mail,
  Megaphone,
  PenLine,
  Pin,
  Plug,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any>;
  is_read: boolean;
  pinned: boolean;
  created_at: string;
};

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

const TYPE_META: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  welcome:           { icon: Star,      color: 'text-indigo-600', bg: 'bg-indigo-50' },
  social_connected:  { icon: Plug,      color: 'text-emerald-600', bg: 'bg-emerald-50' },
  social_reconnected:{ icon: RefreshCw, color: 'text-blue-600',    bg: 'bg-blue-50' },
  post_scheduled:    { icon: Calendar,  color: 'text-blue-600',    bg: 'bg-blue-50' },
  post_published:    { icon: Send,      color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  draft_created:     { icon: FileText,  color: 'text-slate-600',   bg: 'bg-slate-100' },
  plan_executed:     { icon: Zap,       color: 'text-violet-600',  bg: 'bg-violet-50' },
  memory_saved:      { icon: Brain,     color: 'text-amber-600',   bg: 'bg-amber-50' },
  skill_compiled:    { icon: Sparkles,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
  agent_activity:    { icon: Bot,       color: 'text-purple-600',  bg: 'bg-purple-50' },
  team_invite:       { icon: UserPlus,  color: 'text-pink-600',    bg: 'bg-pink-50' },
  member_joined:     { icon: Mail,      color: 'text-teal-600',    bg: 'bg-teal-50' },
  invite_declined:   { icon: X,        color: 'text-red-500',     bg: 'bg-red-50' },
  task_due_soon:     { icon: Clock,       color: 'text-amber-600',  bg: 'bg-amber-50' },
  task_reminder:     { icon: Clock,       color: 'text-orange-600', bg: 'bg-orange-50' },
  campaign_launched: { icon: Megaphone,   color: 'text-indigo-600', bg: 'bg-indigo-50' },
  campaign_alert:    { icon: Target,      color: 'text-violet-600', bg: 'bg-violet-50' },
  survey_response:   { icon: FileText,    color: 'text-teal-600',   bg: 'bg-teal-50' },
  lead_hot:          { icon: TrendingUp,  color: 'text-red-600',    bg: 'bg-red-50' },
  marketing_alert:   { icon: Star,        color: 'text-amber-600',  bg: 'bg-amber-50' },
  email_sent:        { icon: Send,        color: 'text-emerald-600',bg: 'bg-emerald-50' },
  automation_fired:  { icon: Zap,         color: 'text-purple-600', bg: 'bg-purple-50' },
  note_edited:       { icon: PenLine,     color: 'text-amber-600',  bg: 'bg-amber-50'  },
  note_deleted:      { icon: Trash2,      color: 'text-red-500',    bg: 'bg-red-50'    },
};

function getMeta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, color: 'text-slate-500', bg: 'bg-slate-100' };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h left`;
  const d = Math.floor(h / 24);
  return `${d}d left`;
}

export default function NotificationBell() {
  const { refresh: refreshWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toastQueue, setToastQueue] = useState<Notification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/v1/notifications`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await r.json();
      if (d.success) {
        setNotifications(d.notifications);
        setUnreadCount(d.unreadCount);

        if (isFirstLoad.current) {
          // Seed seen IDs on first load — don't toast for existing reminders
          (d.notifications as Notification[]).forEach(n => seenIds.current.add(n.id));
          isFirstLoad.current = false;
        } else {
          // On subsequent polls, toast any new task_reminder notifications
          const incoming = (d.notifications as Notification[]).filter(
            n => n.type === 'task_reminder' && !seenIds.current.has(n.id)
          );
          (d.notifications as Notification[]).forEach(n => seenIds.current.add(n.id));
          if (incoming.length > 0) {
            setToastQueue(q => [...q, ...incoming]);
          }
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const markAllRead = async () => {
    await fetch(`${getApiBaseUrl()}/api/v1/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const markRead = async (id: string) => {
    await fetch(`${getApiBaseUrl()}/api/v1/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const dismiss = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${getApiBaseUrl()}/api/v1/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    const wasUnread = notifications.find((n) => n.id === id && !n.is_read);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
  };

  const clearAll = async () => {
    await fetch(`${getApiBaseUrl()}/api/v1/notifications`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    // Keep pinned notifications in local state
    setNotifications((prev) => prev.filter((n) => n.pinned));
    setUnreadCount(notifications.filter((n) => n.pinned && !n.is_read).length);
  };

  const handleInviteAction = async (n: Notification, action: 'accept' | 'decline') => {
    const token = n.data?.token as string;
    if (!token) return;
    setActionLoading(`${n.id}-${action}`);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/v1/invitations/${token}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await r.json();
      if (d.success) {
        setNotifications((prev) => prev.filter((x) => x.id !== n.id));
        setUnreadCount((c) => (!n.is_read ? Math.max(0, c - 1) : c));
        if (action === 'accept' && d.orgId) {
          // Write the target org into localStorage before refresh so WorkspaceContext
          // switches to it automatically (avoids stale-closure issue with switchOrg)
          localStorage.setItem('workspace_state', JSON.stringify({ orgId: d.orgId, projectId: null }));
          await refreshWorkspace();
          void fetchNotifications();
        }
      }
    } finally {
      setActionLoading(null);
    }
  };

  const nonPinnedCount = notifications.filter((n) => !n.pinned).length;

  const dismissToast = (id: string) => setToastQueue(q => q.filter(n => n.id !== id));

  // Auto-dismiss toasts after 8 s
  useEffect(() => {
    if (toastQueue.length === 0) return;
    const t = setTimeout(() => setToastQueue(q => q.slice(1)), 8000);
    return () => clearTimeout(t);
  }, [toastQueue]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unreadCount > 0) void markAllRead();
        }}
        className="relative flex items-center justify-center w-8 h-8 rounded-[10px] hover:bg-soft transition-colors text-muted hover:text-ink"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger font-mono text-[9px] font-medium text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Reminder toast stack — fixed top-right, outside the bell's relative container */}
      {toastQueue.length > 0 && (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toastQueue.map(n => (
            <div key={n.id}
              className="pointer-events-auto flex items-start gap-3 w-80 rounded-[16px] bg-white border border-warn-line shadow-menu px-4 py-3 animate-in slide-in-from-right-4 fade-in duration-300"
            >
              <div className="mt-0.5 shrink-0 flex h-8 w-8 items-center justify-center rounded-[10px] bg-warn-surface">
                <Clock size={15} className="text-warn-text" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink leading-snug">{n.title}</p>
                <p className="text-[11px] text-muted leading-relaxed mt-0.5">{n.message}</p>
              </div>
              <button onClick={() => dismissToast(n.id)}
                className="shrink-0 mt-0.5 text-faint hover:text-ink transition-colors">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div
          ref={panelRef}
          className="absolute bottom-full left-0 mb-2 w-80 rounded-[16px] border border-line bg-white shadow-menu z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-sm font-medium text-ink">Notifications</span>
            <div className="flex items-center gap-1">
              {nonPinnedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="rounded-[8px] p-1.5 text-faint hover:text-blue hover:bg-pale transition-colors"
                    title="Mark all read"
                  >
                    <CheckCheck size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-[8px] p-1.5 text-faint hover:text-danger hover:bg-danger-surface transition-colors"
                    title="Clear all"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] p-1.5 text-faint hover:bg-soft hover:text-ink transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Bell size={22} className="text-gray-300" />
                <p className="text-xs text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                if (n.type === 'team_invite') {
                  const expired = n.data?.expiresAt && new Date(n.data.expiresAt) < new Date();
                  return (
                    <div
                      key={n.id}
                      className="border-b border-pink-100 bg-pink-50/60 px-4 py-3"
                    >
                      {/* Pin badge */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <Pin size={10} className="text-pink-400 fill-pink-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-pink-500">
                          Team Invitation
                        </span>
                        {n.data?.expiresAt && (
                          <span className={`ml-auto text-[10px] font-semibold ${expired ? 'text-red-400' : 'text-pink-400'}`}>
                            {timeUntil(n.data.expiresAt)}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex items-start gap-2 mb-3">
                        <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-xl bg-pink-100">
                          <UserPlus size={13} className="text-pink-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-900 leading-snug">{n.title}</p>
                          <p className="text-[11px] text-gray-600 leading-relaxed mt-0.5">{n.message}</p>
                          <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      {expired ? (
                        <p className="text-[11px] text-red-400 font-semibold text-center py-1">This invitation has expired</p>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => void handleInviteAction(n, 'decline')}
                            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === `${n.id}-decline` ? 'Declining…' : 'Decline'}
                          </button>
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => void handleInviteAction(n, 'accept')}
                            className="flex-1 rounded-lg bg-pink-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-pink-700 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === `${n.id}-accept` ? 'Joining…' : 'Accept'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }

                const { icon: Icon, color, bg } = getMeta(n.type);
                return (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && void markRead(n.id)}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${!n.is_read ? 'bg-indigo-50/40' : ''}`}
                  >
                    <div className={`mt-0.5 shrink-0 flex h-7 w-7 items-center justify-center rounded-xl ${bg}`}>
                      <Icon size={13} className={color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold leading-snug ${n.is_read ? 'text-gray-700' : 'text-gray-900'}`}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      {!n.is_read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => void dismiss(n.id, e)}
                        className="rounded p-0.5 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
