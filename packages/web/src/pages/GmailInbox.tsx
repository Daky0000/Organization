import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Loader2, Mail, Phone,
  RefreshCw, Sparkles, Trash2, X, ListFilter, Building2,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  totalFetched: number;
  lastSyncedAt: string | null;
  errorMessage: string | null;
};

type Contact = {
  email: string;
  name: string;
  company: string;
  domain: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
  lastSnippet: string;
  lastSubject: string;
};

type EmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  date: string | null;
  isRead: boolean;
  isSent: boolean;
  bodyText: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fullDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// Clearbit logo service — free, no auth required
function companyLogoUrl(domain: string): string {
  if (!domain || ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'live.com', 'msn.com', 'aol.com'].includes(domain)) {
    return '';
  }
  return `https://logo.clearbit.com/${domain}`;
}

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
];

function contactColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Company Logo with fallback ─────────────────────────────────────────────────

function CompanyLogo({ domain, name, size = 40 }: { domain: string; name: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const logoUrl = companyLogoUrl(domain);

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className="rounded-xl object-contain bg-white border border-slate-100"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-xl font-black text-sm ${contactColor(name)}`}
      style={{ width: size, height: size }}
    >
      {avatarInitials(name)}
    </div>
  );
}

// ── Email activity item ───────────────────────────────────────────────────────

function ActivityItem({ msg, onLoadBody }: { msg: EmailMessage; onLoadBody: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!expanded && !msg.bodyText) {
      setLoading(true);
      await onLoadBody(msg.id);
      setLoading(false);
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="group relative pl-8">
      {/* Timeline dot */}
      <div className="absolute left-0 top-1.5 flex h-5 w-5 items-center justify-center">
        <div className={`h-2.5 w-2.5 rounded-full border-2 border-white ring-1 ${msg.isSent ? 'bg-[#2563EB] ring-[#2563EB]' : 'bg-slate-300 ring-slate-300'}`} />
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${msg.isSent ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                {msg.isSent ? 'Sent' : 'Received'}
              </span>
              {!msg.isRead && !msg.isSent && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
              )}
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">
              {msg.subject || '(No subject)'}
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">{fullDate(msg.date)}</span>
        </div>

        {/* Snippet / expanded body */}
        <div className="mt-2 text-sm text-slate-600 leading-relaxed">
          {expanded && msg.bodyText ? (
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 max-h-64 overflow-y-auto">
              {msg.bodyText.slice(0, 6000)}
              {msg.bodyText.length > 6000 ? '\n…[truncated]' : ''}
            </pre>
          ) : (
            <span>{msg.snippet || '—'}</span>
          )}
        </div>

        {/* Toggle */}
        <button
          type="button"
          onClick={handleToggle}
          className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {loading ? 'Loading…' : expanded ? 'Collapse' : 'Read full email'}
        </button>
      </div>
    </div>
  );
}

// ── Contact preview panel ─────────────────────────────────────────────────────

function ContactPanel({
  contact,
  onClose,
}: {
  contact: Contact;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadBody = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/messages/${encodeURIComponent(id)}/body`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.body) {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, bodyText: data.body } : m)));
      }
    } catch { /* ignore */ }
  }, []);

  const generateSummary = async () => {
    setLoadingAI(true);
    setAiError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/gmail/contacts/${encodeURIComponent(contact.email)}/ai-summary`,
        { method: 'POST', headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (data.success) setAiSummary(data.summary || '');
      else setAiError(data.error || 'Failed to generate summary');
    } catch {
      setAiError('Network error');
    } finally {
      setLoadingAI(false);
    }
  };

  useEffect(() => {
    setLoadingMessages(true);
    setMessages([]);
    setAiSummary(null);
    fetch(
      `${API_BASE_URL}/api/gmail/chats/${encodeURIComponent(contact.email)}/messages`,
      { headers: authHeaders() }
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMessages(false));
  }, [contact.email]);

  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
        <button type="button" onClick={onClose} className="md:hidden flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Preview</span>
        <button type="button" onClick={onClose} className="hidden md:flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Contact card */}
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <CompanyLogo domain={contact.domain} name={contact.name} size={48} />
            <div className="min-w-0">
              <p className="truncate text-base font-black text-slate-950">{contact.name}</p>
              <p className="flex items-center gap-1 truncate text-xs text-slate-400">
                <Building2 size={11} className="shrink-0" />
                {contact.company}
              </p>
            </div>
          </div>

          {/* Contact details */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Mail size={12} className="shrink-0 text-slate-400" />
              <a href={`mailto:${contact.email}`} className="hover:underline truncate">{contact.email}</a>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Phone size={12} className="shrink-0 text-slate-400" />
              <span>—</span>
            </div>
          </div>

          {/* Quick-action bar */}
          <div className="mt-4 flex items-center gap-2">
            {(['Note', 'Email', 'Call', 'Task', 'Meeting'] as const).map((action) => (
              <button
                key={action}
                type="button"
                className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-1 py-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <span className="text-base leading-none">
                  {action === 'Note' ? '📝' : action === 'Email' ? '✉️' : action === 'Call' ? '📞' : action === 'Task' ? '✅' : '📅'}
                </span>
                {action}
              </button>
            ))}
          </div>
        </div>

        {/* AI Summary */}
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-indigo-500" />
              <span className="text-xs font-bold text-slate-700">AI Record Summary</span>
            </div>
            <button
              type="button"
              onClick={generateSummary}
              disabled={loadingAI}
              className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100 disabled:opacity-60"
            >
              {loadingAI ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {aiSummary ? 'Regenerate' : 'Generate'}
            </button>
          </div>

          {aiError && <p className="mt-2 text-xs text-red-500">{aiError}</p>}

          {aiSummary ? (
            <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs leading-relaxed text-slate-700">
              {aiSummary}
              <p className="mt-2 text-[10px] text-slate-400">Generated by AI · {new Date().toLocaleDateString()}</p>
            </div>
          ) : !loadingAI && !aiError ? (
            <p className="mt-2 text-xs text-slate-400">Click "Generate" for an AI summary of this conversation.</p>
          ) : null}
        </div>

        {/* Activity timeline */}
        <div className="px-5 py-4">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Activity ({messages.length})
          </p>

          {loadingMessages ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-slate-300" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-slate-400">No emails found</p>
          ) : (
            <div className="relative space-y-3">
              {/* Vertical timeline line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-slate-100" />
              {[...messages].reverse().map((msg) => (
                <ActivityItem key={msg.id} msg={msg} onLoadBody={loadBody} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function GmailInbox({ onNavigateToCRM }: { onNavigateToCRM?: () => void } = {}) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    status: 'idle', totalFetched: 0, lastSyncedAt: null, errorMessage: null,
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filtered, setFiltered] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── API ──────────────────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/sync/status`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.success !== false) setSyncStatus(data);
    } catch { /* ignore */ }
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/chats`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.chats)) {
        setContacts(data.chats);
        setFiltered(data.chats);
      }
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const startSync = async () => {
    await fetch(`${API_BASE_URL}/api/gmail/sync`, { method: 'POST', headers: authHeaders() });
    await fetchStatus();
  };

  const resetInbox = async () => {
    await fetch(`${API_BASE_URL}/api/gmail/messages`, { method: 'DELETE', headers: authHeaders() });
    setContacts([]);
    setFiltered([]);
    setSelected(null);
    setSyncStatus({ status: 'idle', totalFetched: 0, lastSyncedAt: null, errorMessage: null });
    setConfirmReset(false);
  };

  // ── Polling ──────────────────────────────────────────────────────────────────

  const autoSyncTriggered = useRef(false);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (syncStatus.status === 'running') {
      pollRef.current = setTimeout(() => void fetchStatus(), 2000);
    } else {
      if (pollRef.current) clearTimeout(pollRef.current);
      // Auto-start on first visit when Gmail was just connected (status idle + never synced)
      if (syncStatus.status === 'idle' && syncStatus.totalFetched === 0 && !autoSyncTriggered.current) {
        autoSyncTriggered.current = true;
        void startSync();
        return;
      }
      if ((syncStatus.status === 'done' || syncStatus.totalFetched > 0) && contacts.length === 0) {
        void fetchContacts();
      }
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [syncStatus, fetchStatus, fetchContacts, contacts.length]);

  // ── Search ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const q = search.toLowerCase().trim();
    if (!q) { setFiltered(contacts); return; }
    setFiltered(contacts.filter(
      (c) => c.email.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
    ));
  }, [search, contacts]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const isSyncing = syncStatus.status === 'running';
  const hasSynced = syncStatus.totalFetched > 0;
  const syncPct = Math.min(Math.round((syncStatus.totalFetched / 2000) * 100), 100);

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-slate-50">
      {/* ── Sync progress banner (HubSpot-style) ────────────────────────────── */}
      {isSyncing && (
        <div className="shrink-0 border-b border-indigo-100 bg-indigo-50 px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Syncing your emails ({syncPct}%)
              </p>
              <p className="text-xs text-slate-500">
                {syncStatus.totalFetched.toLocaleString()} of 2,000 emails synced. We'll ignore spam and promotional emails.
              </p>
            </div>
            <div className="h-1.5 w-32 rounded-full bg-indigo-100 overflow-hidden">
              <div className="h-full rounded-full bg-[#2563EB] transition-all" style={{ width: `${syncPct}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {syncStatus.status === 'error' && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-6 py-3">
          <p className="text-sm font-semibold text-red-700">Sync failed: {syncStatus.errorMessage}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Contacts table / list ─────────────────────────────────────────── */}
        <div className={`flex flex-col overflow-hidden bg-white ${selected ? 'hidden md:flex md:flex-1' : 'flex-1'}`}>
          {/* Table toolbar */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3 gap-3">
            <div className="flex items-center gap-2 flex-1">
              <h1 className="text-base font-black text-slate-950 whitespace-nowrap">Gmail Contacts</h1>
              {hasSynced && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {filtered.length.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasSynced && onNavigateToCRM && (
                <button
                  type="button"
                  onClick={onNavigateToCRM}
                  className="flex items-center gap-1.5 rounded-xl border border-[#2563EB] bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  <ExternalLink size={12} />
                  View in CRM
                </button>
              )}
              {hasSynced && (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  <Trash2 size={12} />
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={() => void startSync()}
                disabled={isSyncing}
                className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {isSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {isSyncing ? 'Syncing…' : hasSynced ? 'Re-sync' : 'Sync Gmail'}
              </button>
            </div>
          </div>

          {/* Search + filter row */}
          {hasSynced && (
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type / to search"
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-3 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <button type="button" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <ListFilter size={12} />
                Filter
              </button>
            </div>
          )}

          {/* Empty state */}
          {!hasSynced && !isSyncing && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center px-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
                <Mail size={30} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-lg font-black text-slate-900">Sync your Gmail contacts</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Import up to 2,000 emails. Each business domain creates a <strong>CRM Company</strong>, each sender becomes a <strong>CRM Contact</strong>, and all emails appear on their activity timeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void startSync()}
                className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-600"
              >
                <RefreshCw size={14} />
                Sync Gmail Now
              </button>
            </div>
          )}

          {/* Contact list */}
          {(hasSynced || isSyncing) && (
            <div className="flex-1 overflow-y-auto">
              {/* Column headers */}
              <div className="sticky top-0 z-10 grid grid-cols-[2fr_2fr_1.5fr_1fr_80px] gap-3 border-b border-slate-100 bg-white px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <span>Name</span>
                <span>Email</span>
                <span>Company</span>
                <span>Last Activity</span>
                <span className="text-right">Emails</span>
              </div>

              {loadingContacts && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-slate-300" />
                </div>
              )}

              {!loadingContacts && filtered.length === 0 && (
                <div className="py-10 text-center text-sm text-slate-400">
                  {search ? 'No contacts match your search' : 'No contacts synced yet'}
                </div>
              )}

              {filtered.map((contact) => (
                <button
                  key={contact.email}
                  type="button"
                  onClick={() => setSelected(contact)}
                  className={`grid w-full grid-cols-[2fr_2fr_1.5fr_1fr_80px] gap-3 border-b border-slate-50 px-5 py-3 text-left transition-colors hover:bg-slate-50 ${selected?.email === contact.email ? 'bg-indigo-50/60 hover:bg-indigo-50/60' : ''}`}
                >
                  {/* Name + avatar */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <CompanyLogo domain={contact.domain} name={contact.name} size={32} />
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold ${contact.unreadCount > 0 ? 'text-slate-950' : 'text-slate-700'}`}>
                        {contact.name}
                      </p>
                      {contact.unreadCount > 0 && (
                        <span className="rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[9px] font-bold text-white">
                          {contact.unreadCount} new
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex min-w-0 items-center">
                    <span className="truncate text-xs text-slate-500">{contact.email}</span>
                  </div>

                  {/* Company */}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs text-slate-600">{contact.company}</span>
                  </div>

                  {/* Last activity */}
                  <div className="flex items-center">
                    <span className="text-xs text-slate-400">{relativeTime(contact.lastMessageAt)}</span>
                  </div>

                  {/* Email count */}
                  <div className="flex items-center justify-end">
                    <span className="text-xs font-semibold text-slate-500">{contact.messageCount}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Contact preview panel ──────────────────────────────────────────── */}
        {selected && (
          <div className={`flex-1 overflow-hidden md:flex-none md:w-[420px] lg:w-[460px] ${selected ? 'flex' : 'hidden'}`}>
            <ContactPanel
              key={selected.email}
              contact={selected}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      {/* ── Reset confirmation ───────────────────────────────────────────────── */}
      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-black text-slate-950">Clear Gmail data?</h3>
            <p className="mt-2 text-sm text-slate-500">
              This removes all {syncStatus.totalFetched.toLocaleString()} synced messages from ContentFlow. Your actual Gmail is not affected.
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setConfirmReset(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={() => void resetInbox()}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700">
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
