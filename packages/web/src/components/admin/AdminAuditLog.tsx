import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Shield } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

type LogType = 'audit' | 'integration';

type AuditEntry = {
  id: string;
  action?: string;
  event_type?: string;
  status?: string;
  integration?: string;
  post_ids?: string[];
  changes?: Record<string, any>;
  response?: Record<string, any>;
  user_email?: string;
  user_name?: string;
  created_at: string;
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const STATUS_COLOR: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  info:    'bg-blue-50 text-blue-700',
  failed:  'bg-red-50 text-red-600',
  error:   'bg-red-50 text-red-600',
};

export default function AdminAuditLog() {
  const [logType, setLogType] = useState<LogType>('audit');
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async (type: LogType) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/audit-logs?type=${type}&limit=200`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) setLogs(data.logs ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(logType); }, [logType]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-950">Audit Log</h2>
          <p className="text-sm text-slate-500">Track content changes and integration events across your platform.</p>
        </div>
        <button
          onClick={() => void load(logType)}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Type switcher */}
      <div className="flex gap-2">
        {(['audit', 'integration'] as LogType[]).map((t) => (
          <button
            key={t}
            onClick={() => setLogType(t)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
              logType === t
                ? 'bg-slate-950 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t === 'audit' ? 'Content Audit' : 'Integration Events'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <Shield size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No log entries yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr className="text-xs font-semibold text-slate-500">
                <th className="px-4 py-3 text-left">
                  {logType === 'audit' ? 'Action' : 'Event'}
                </th>
                {logType === 'integration' && <th className="px-4 py-3 text-left">Integration</th>}
                {logType === 'integration' && <th className="px-4 py-3 text-left">Status</th>}
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.map((log) => (
                <>
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {log.action ?? log.event_type ?? '—'}
                    </td>
                    {logType === 'integration' && (
                      <td className="px-4 py-3 text-slate-600">{log.integration ?? '—'}</td>
                    )}
                    {logType === 'integration' && (
                      <td className="px-4 py-3">
                        {log.status && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[log.status] ?? 'bg-slate-100 text-slate-600'}`}>
                            {log.status}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {log.user_name || log.user_email || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {timeAgo(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {expanded === log.id ? '▲' : '▼'}
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr key={`${log.id}-detail`}>
                      <td
                        colSpan={logType === 'integration' ? 5 : 4}
                        className="px-4 pb-4 pt-0"
                      >
                        <pre className="overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                          {JSON.stringify(
                            logType === 'audit'
                              ? { post_ids: log.post_ids, changes: log.changes }
                              : log.response,
                            null, 2
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
