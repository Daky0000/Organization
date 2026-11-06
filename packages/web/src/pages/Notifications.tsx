import { useEffect, useState } from 'react';
import {
  Bell, Loader2, CheckCheck, Trash2, Pin, Zap, FileText,
  CreditCard, AlertCircle, Info, Megaphone, Bot,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any> | null;
  is_read: boolean;
  pinned: boolean;
  created_at: string;
};

function getToken() {
  return localStorage.getItem('auth_token') ?? '';
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  post:           <FileText size={16} />,
  billing:        <CreditCard size={16} />,
  workflow:       <Zap size={16} />,
  agent:          <Bot size={16} />,
  system:         <Info size={16} />,
  alert:          <AlertCircle size={16} />,
  announcement:   <Megaphone size={16} />,
};

const TYPE_COLOR: Record<string, string> = {
  post:         'bg-blue-100 text-blue-600',
  billing:      'bg-green-100 text-green-600',
  workflow:     'bg-purple-100 text-purple-600',
  agent:        'bg-indigo-100 text-indigo-600',
  system:       'bg-gray-100 text-gray-500',
  alert:        'bg-red-100 text-red-500',
  announcement: 'bg-amber-100 text-amber-600',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/notifications`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setItems(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const markRead = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/v1/notifications/${id}/read`, {
      method: 'PATCH', headers: authHeaders(),
    });
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await fetch(`${API_BASE_URL}/api/v1/notifications/read-all`, {
      method: 'PATCH', headers: authHeaders(),
    });
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const dismiss = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/v1/notifications/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    setItems((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((c) => {
      const dismissed = items.find((n) => n.id === id);
      return dismissed && !dismissed.is_read ? Math.max(0, c - 1) : c;
    });
  };

  const clearAll = async () => {
    if (!confirm('Clear all non-pinned notifications?')) return;
    await fetch(`${API_BASE_URL}/api/v1/notifications`, {
      method: 'DELETE', headers: authHeaders(),
    });
    setItems((prev) => prev.filter((n) => n.pinned));
    setUnreadCount(0);
  };

  const pinned = items.filter((n) => n.pinned);
  const regular = items.filter((n) => !n.pinned);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Bell size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-gray-900">Notifications</h1>
              {unreadCount > 0 && (
                <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">Stay updated on your workspace activity</p>
          </div>
        </div>

        {items.length > 0 && (
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
            <button
              onClick={() => void clearAll()}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
            >
              <Trash2 size={13} />
              Clear all
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-300" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
            <Bell size={22} />
          </div>
          <p className="text-sm font-bold text-gray-700">You're all caught up</p>
          <p className="mt-1 text-sm text-gray-400">
            Notifications about your posts, workflows, agents, and billing will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pinned */}
          {pinned.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <Pin size={11} /> Pinned
              </p>
              {pinned.map((n) => (
                <NotifCard key={n.id} n={n} onRead={markRead} onDismiss={dismiss} />
              ))}
            </div>
          )}

          {/* Regular */}
          {regular.length > 0 && (
            <div className="space-y-2">
              {pinned.length > 0 && (
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Recent</p>
              )}
              {regular.map((n) => (
                <NotifCard key={n.id} n={n} onRead={markRead} onDismiss={dismiss} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotifCard({
  n,
  onRead,
  onDismiss,
}: {
  n: Notification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const iconColor = TYPE_COLOR[n.type] ?? 'bg-gray-100 text-gray-500';
  const icon = TYPE_ICON[n.type] ?? <Bell size={16} />;

  return (
    <div
      className={`group flex items-start gap-3 rounded-2xl border p-4 transition-colors ${
        n.is_read
          ? 'border-gray-100 bg-white'
          : 'border-indigo-100 bg-indigo-50/40'
      }`}
      onClick={() => { if (!n.is_read) onRead(n.id); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && !n.is_read) onRead(n.id); }}
    >
      {/* Icon */}
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconColor}`}>
        {icon}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold leading-snug ${n.is_read ? 'text-gray-700' : 'text-gray-900'}`}>
            {n.title}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {!n.is_read && (
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
              className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded-lg text-gray-300 hover:bg-gray-100 hover:text-gray-500"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{n.message}</p>
        <p className="mt-1.5 text-[10px] text-gray-400">{timeAgo(n.created_at)}</p>
      </div>
    </div>
  );
}
