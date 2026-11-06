import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Search, RefreshCw, Loader2, Sparkles, Paperclip,
  ArrowUpRight, ArrowDownLeft, Building2, User, Download,
  ChevronLeft,
} from 'lucide-react';

const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface Chat {
  email: string;
  name: string;
  company: string;
  domain: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
  lastSnippet: string;
  lastSubject: string;
}

interface Message {
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
  bodyText?: string | null;
  attachments?: Attachment[];
  loadingBody?: boolean;
  loadingAttachments?: boolean;
}

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface CompanyGroup {
  domain: string;
  name: string;
  emailCount: number;
  contactEmails: string[];
  lastMessageAt: string | null;
  lastSnippet: string;
}

const PALETTE = [
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-sky-100',    text: 'text-sky-700'    },
  { bg: 'bg-emerald-100',text: 'text-emerald-700' },
  { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  { bg: 'bg-rose-100',   text: 'text-rose-700'   },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-teal-100',   text: 'text-teal-700'   },
  { bg: 'bg-orange-100', text: 'text-orange-700' },
];

function paletteFor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PALETTE[h % PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diff < 7 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CompanyLogo({ domain, name, size = 'w-9 h-9' }: { domain: string; name: string; size?: string }) {
  const [state, setState] = React.useState<'try' | 'ok' | 'fallback'>('try');
  const url = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null;
  React.useEffect(() => { setState(url ? 'try' : 'fallback'); }, [url]);
  const { bg, text } = paletteFor(name || domain);
  const ini = initials(name || domain);
  if (!url || state === 'fallback') {
    return <div className={`${size} rounded-lg ${bg} ${text} flex items-center justify-center flex-shrink-0 font-semibold text-sm`}>{ini}</div>;
  }
  return (
    <>
      <img src={url} alt="" className={`${size} rounded-lg object-contain bg-white border border-gray-100 p-0.5 flex-shrink-0 ${state === 'ok' ? '' : 'hidden'}`}
        onLoad={e => setState(e.currentTarget.naturalWidth < 20 ? 'fallback' : 'ok')} onError={() => setState('fallback')} />
      {state === 'try' && <div className={`${size} rounded-lg ${bg} ${text} flex items-center justify-center flex-shrink-0 font-semibold text-sm`}>{ini}</div>}
    </>
  );
}

export default function GmailAgent() {
  const [tab, setTab] = useState<'inbox' | 'company'>('inbox');
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  // Inbox view
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  // Company view
  const [companyGroups, setCompanyGroups] = useState<CompanyGroup[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyGroup | null>(null);
  const [companyMessages, setCompanyMessages] = useState<Message[]>([]);
  const [loadingCompanyMsgs, setLoadingCompanyMsgs] = useState(false);
  const [companyAiSummary, setCompanyAiSummary] = useState<string | null>(null);
  const [summarizingCompany, setSummarizingCompany] = useState(false);

  const loadChats = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/gmail/chats', { headers: authHeaders() });
      const data = await r.json();
      const list: Chat[] = data.chats || [];
      setChats(list);

      // Derive company groups from chat list
      const domainMap = new Map<string, CompanyGroup>();
      for (const c of list) {
        if (!c.domain) continue;
        const existing = domainMap.get(c.domain);
        if (existing) {
          existing.emailCount += c.messageCount;
          existing.contactEmails.push(c.email);
          if (!existing.lastMessageAt || (c.lastMessageAt && c.lastMessageAt > existing.lastMessageAt)) {
            existing.lastMessageAt = c.lastMessageAt;
            existing.lastSnippet = c.lastSnippet;
          }
        } else {
          domainMap.set(c.domain, {
            domain: c.domain,
            name: c.company || c.domain,
            emailCount: c.messageCount,
            contactEmails: [c.email],
            lastMessageAt: c.lastMessageAt,
            lastSnippet: c.lastSnippet,
          });
        }
      }
      setCompanyGroups(Array.from(domainMap.values()).sort((a, b) => {
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadChats(); }, [loadChats]);

  const syncGmail = async () => {
    setSyncing(true);
    await fetch('/api/gmail/sync', { method: 'POST', headers: authHeaders() }).catch(() => {});
    const poll = async () => {
      const d = await fetch('/api/gmail/sync/status', { headers: authHeaders() }).then(r => r.json()).catch(() => null);
      if (!d) { setSyncing(false); return; }
      if (d.status === 'running') setTimeout(poll, 2500);
      else { setSyncing(false); void loadChats(); }
    };
    await poll();
  };

  const openChat = async (chat: Chat) => {
    setSelectedChat(chat);
    setMessages([]);
    setAiSummary(null);
    setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/gmail/chats/${encodeURIComponent(chat.email)}/messages`, { headers: authHeaders() });
      const data = await r.json();
      setMessages(data.messages || []);
    } finally { setLoadingMsgs(false); }
  };

  const openCompany = async (group: CompanyGroup) => {
    setSelectedCompany(group);
    setCompanyMessages([]);
    setCompanyAiSummary(null);
    setLoadingCompanyMsgs(true);
    try {
      const r = await fetch(`/api/gmail/company/${encodeURIComponent(group.domain)}/messages`, { headers: authHeaders() });
      const data = await r.json();
      setCompanyMessages(data.messages || []);
    } finally { setLoadingCompanyMsgs(false); }
  };

  const loadBody = async (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, loadingBody: true } : m));
    try {
      const r = await fetch(`/api/gmail/messages/${encodeURIComponent(msgId)}/body`, { headers: authHeaders() });
      const data = await r.json().catch(() => ({}));
      const bodyText = r.ok && data.success ? data.body || '' : data.error || 'Could not load this message.';
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, bodyText, loadingBody: false } : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, loadingBody: false } : m));
    }
  };

  const loadAttachments = async (msgId: string, target: 'inbox' | 'company') => {
    const setter = target === 'inbox' ? setMessages : setCompanyMessages;
    setter(prev => prev.map(m => m.id === msgId ? { ...m, loadingAttachments: true } : m));
    try {
      const r = await fetch(`/api/gmail/messages/${encodeURIComponent(msgId)}/attachments`, { headers: authHeaders() });
      const data = await r.json();
      setter(prev => prev.map(m => m.id === msgId ? { ...m, attachments: data.attachments || [], loadingAttachments: false } : m));
    } catch {
      setter(prev => prev.map(m => m.id === msgId ? { ...m, loadingAttachments: false } : m));
    }
  };

  // The API authenticates with a bearer token, which a plain link can't send:
  // fetch the file, then hand the browser a local object URL.
  const downloadAttachment = async (msgId: string, att: Attachment) => {
    const url = `/api/gmail/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(att.id)}?filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`;
    try {
      const r = await fetch(url, { headers: authHeaders() });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(data.error || 'Could not download the attachment.');
        return;
      }
      const objectUrl = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = att.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      alert('Could not download the attachment.');
    }
  };

  const summarize = async () => {
    if (!selectedChat) return;
    setSummarizing(true);
    setAiSummary(null);
    try {
      const r = await fetch(`/api/gmail/contacts/${encodeURIComponent(selectedChat.email)}/ai-summary`, { method: 'POST', headers: jsonHeaders() });
      const data = await r.json();
      setAiSummary(data.summary || data.error || 'No summary generated.');
    } catch { setAiSummary('Failed to generate summary.'); }
    finally { setSummarizing(false); }
  };

  const summarizeCompany = async () => {
    if (!selectedCompany) return;
    setSummarizingCompany(true);
    setCompanyAiSummary(null);
    try {
      const r = await fetch(`/api/gmail/company/${encodeURIComponent(selectedCompany.domain)}/ai-summary`, { method: 'POST', headers: jsonHeaders() });
      const data = await r.json();
      setCompanyAiSummary(data.summary || data.error || 'No summary generated.');
    } catch { setCompanyAiSummary('Failed to generate summary.'); }
    finally { setSummarizingCompany(false); }
  };

  const filteredChats = chats.filter(c =>
    c.email.includes(search.toLowerCase()) ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase())
  );

  const filteredCompanies = companyGroups.filter(g =>
    g.domain.includes(search.toLowerCase()) ||
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  const renderMessageList = (msgList: Message[], target: 'inbox' | 'company') => (
    <div className="flex-1 overflow-y-auto px-5 py-3 space-y-0">
      {msgList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Mail className="w-10 h-10 text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No emails found</p>
        </div>
      ) : msgList.map(msg => (
        <div key={msg.id} className="py-4 border-b border-gray-100 last:border-0">
          <div className="flex items-start gap-2 mb-1">
            <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${msg.isSent ? 'bg-indigo-50' : 'bg-sky-50'}`}>
              {msg.isSent
                ? <ArrowUpRight className="w-3.5 h-3.5 text-indigo-500" />
                : <ArrowDownLeft className="w-3.5 h-3.5 text-sky-500" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-500">
                  {msg.isSent ? `To: ${msg.toEmail}` : `From: ${msg.fromName || msg.fromEmail}`}
                </span>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(msg.date)}</span>
              </div>
              <p className="text-sm font-medium text-gray-800 truncate mt-0.5">{msg.subject || '(No subject)'}</p>
              {msg.bodyText ? (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-4">{msg.bodyText}</p>
              ) : (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{msg.snippet}</p>
              )}
            </div>
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 mt-2 ml-8">
            {!msg.bodyText && (
              <button
                onClick={() => void loadBody(msg.id)}
                disabled={msg.loadingBody}
                className="text-xs text-[#2563EB] hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                {msg.loadingBody ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {msg.loadingBody ? 'Loading…' : 'Show full email'}
              </button>
            )}
            <button
              onClick={() => void loadAttachments(msg.id, target)}
              disabled={msg.loadingAttachments}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 disabled:opacity-50"
            >
              {msg.loadingAttachments ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
              {msg.loadingAttachments ? 'Checking…' : 'Attachments'}
            </button>
          </div>

          {/* Attachments */}
          {msg.attachments !== undefined && (
            <div className="ml-8 mt-2">
              {msg.attachments.length === 0 ? (
                <p className="text-xs text-gray-400">No attachments</p>
              ) : (
                <div className="space-y-1">
                  {msg.attachments.map(att => (
                    <button
                      key={att.id}
                      onClick={() => void downloadAttachment(msg.id, att)}
                      className="flex items-center gap-2 text-xs text-[#2563EB] hover:underline group"
                    >
                      <Download className="w-3 h-3 text-gray-400 group-hover:text-[#2563EB]" />
                      <span className="truncate max-w-xs">{att.filename}</span>
                      <span className="text-gray-400">({fmtSize(att.size)})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderRightPanel = (
    contactOrCompany: string,
    isCompany: boolean,
    msgCount: number,
    summary: string | null,
    isSummarizing: boolean,
    onSummarize: () => void,
    extraInfo?: React.ReactNode,
  ) => (
    <div className="w-64 flex-shrink-0 border-l border-gray-100 bg-white overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Identity */}
        <div className="flex flex-col items-center text-center pt-2">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-2">
            {isCompany
              ? <Building2 className="w-6 h-6 text-gray-400" />
              : <User className="w-6 h-6 text-gray-400" />
            }
          </div>
          <p className="text-sm font-semibold text-gray-800 truncate max-w-full">{contactOrCompany}</p>
          <p className="text-xs text-gray-400 mt-0.5">{msgCount} email{msgCount !== 1 ? 's' : ''}</p>
          {extraInfo}
        </div>

        {/* AI Summary */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-semibold text-gray-700">AI Summary</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-pink-100 text-pink-600">
              <Sparkles className="w-2.5 h-2.5" /> AI
            </span>
          </div>
          <div className="p-3">
            {summary ? (
              <p className="text-xs text-gray-600 leading-relaxed">{summary}</p>
            ) : (
              <div className="text-center">
                <p className="text-xs text-gray-400 mb-3">Generate an AI summary of all interactions with this {isCompany ? 'company' : 'contact'}.</p>
                <button
                  onClick={onSummarize}
                  disabled={isSummarizing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors"
                >
                  {isSummarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {isSummarizing ? 'Summarizing…' : 'Summarize'}
                </button>
              </div>
            )}
            {summary && (
              <button onClick={onSummarize} disabled={isSummarizing} className="mt-2 text-[11px] text-[#2563EB] hover:underline flex items-center gap-1 disabled:opacity-50">
                {isSummarizing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                Refresh
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Mail className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Gmail Agent</h1>
            <p className="text-xs text-gray-400">Inbox intelligence — conversations, summaries & attachments</p>
          </div>
        </div>
        <button
          onClick={() => void syncGmail()}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncing ? 'Syncing…' : 'Sync Gmail'}
        </button>
      </div>

      {/* Tab switcher + search */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-gray-100 flex items-center gap-3">
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          {(['inbox', 'company'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelectedChat(null); setSelectedCompany(null); }}
              className={`px-4 py-1.5 text-sm font-medium border-r last:border-0 border-gray-200 transition-colors ${tab === t ? 'bg-[#2563EB] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {t === 'inbox' ? 'Inbox' : 'By Company'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
            placeholder={tab === 'inbox' ? 'Search contacts…' : 'Search companies…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-gray-400">
          {tab === 'inbox' ? `${filteredChats.length} conversations` : `${filteredCompanies.length} companies`}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── INBOX TAB ── */}
        {tab === 'inbox' && (
          <>
            {/* Left: conversation list */}
            <div className="w-80 flex-shrink-0 border-r border-gray-100 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />Loading…
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <Mail className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">No conversations yet</p>
                  <p className="text-xs text-gray-300 mt-1">Sync Gmail to load your inbox</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredChats.map(chat => {
                    const { bg, text } = paletteFor(chat.email);
                    const ini = initials(chat.name || chat.email.split('@')[0]);
                    return (
                      <div
                        key={chat.email}
                        onClick={() => void openChat(chat)}
                        className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors ${selectedChat?.email === chat.email ? 'bg-indigo-50 border-r-2 border-[#2563EB]' : ''}`}
                      >
                        <div className={`w-9 h-9 rounded-full ${bg} ${text} flex items-center justify-center flex-shrink-0 font-semibold text-sm`}>{ini}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className={`text-sm truncate ${chat.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                              {chat.name || chat.email.split('@')[0]}
                            </span>
                            <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(chat.lastMessageAt)}</span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{chat.email}</p>
                          <p className="text-xs text-gray-400 truncate mt-0.5">{chat.lastSnippet}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{chat.company}</span>
                            <span className="text-[10px] text-gray-400">{chat.messageCount} emails</span>
                            {chat.unreadCount > 0 && (
                              <span className="text-[10px] text-white bg-[#2563EB] px-1.5 py-0.5 rounded-full font-medium">{chat.unreadCount} new</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Middle: email thread */}
            {selectedChat ? (
              <>
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  {/* Thread header */}
                  <div className="flex-shrink-0 px-5 py-3.5 border-b border-gray-100 bg-white">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSelectedChat(null)} className="p-1 text-gray-400 hover:text-gray-600 lg:hidden"><ChevronLeft className="w-4 h-4" /></button>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{selectedChat.name || selectedChat.email.split('@')[0]}</p>
                        <p className="text-xs text-gray-400">{selectedChat.email} · {selectedChat.messageCount} emails · {selectedChat.company}</p>
                      </div>
                    </div>
                  </div>
                  {loadingMsgs ? (
                    <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
                  ) : renderMessageList(messages, 'inbox')}
                </div>

                {renderRightPanel(
                  selectedChat.email,
                  false,
                  selectedChat.messageCount,
                  aiSummary,
                  summarizing,
                  summarize,
                  <span className="text-xs text-gray-400 mt-0.5">{selectedChat.company}</span>,
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <Mail className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">Select a conversation to view emails</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── BY COMPANY TAB ── */}
        {tab === 'company' && (
          <>
            {/* Left: company list */}
            <div className="w-80 flex-shrink-0 border-r border-gray-100 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
              ) : filteredCompanies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <Building2 className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">No companies found</p>
                  <p className="text-xs text-gray-300 mt-1">Sync Gmail to group emails by company domain</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredCompanies.map(group => (
                    <div
                      key={group.domain}
                      onClick={() => void openCompany(group)}
                      className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors ${selectedCompany?.domain === group.domain ? 'bg-indigo-50 border-r-2 border-[#2563EB]' : ''}`}
                    >
                      <CompanyLogo domain={group.domain} name={group.name} size="w-9 h-9" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm font-medium text-gray-900 truncate">{group.name}</span>
                          <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(group.lastMessageAt)}</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{group.domain}</p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{group.lastSnippet}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-gray-400">{group.emailCount} emails</span>
                          <span className="text-[10px] text-gray-400">·</span>
                          <span className="text-[10px] text-gray-400">{group.contactEmails.length} contact{group.contactEmails.length !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Middle: company email thread */}
            {selectedCompany ? (
              <>
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  <div className="flex-shrink-0 px-5 py-3.5 border-b border-gray-100 bg-white">
                    <div className="flex items-center gap-3">
                      <CompanyLogo domain={selectedCompany.domain} name={selectedCompany.name} size="w-8 h-8" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{selectedCompany.name}</p>
                        <p className="text-xs text-gray-400">{selectedCompany.domain} · {selectedCompany.emailCount} emails · {selectedCompany.contactEmails.length} contacts</p>
                      </div>
                    </div>
                    {/* Contact breakdown */}
                    {selectedCompany.contactEmails.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selectedCompany.contactEmails.slice(0, 5).map(e => (
                          <span key={e} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e}</span>
                        ))}
                        {selectedCompany.contactEmails.length > 5 && (
                          <span className="text-[10px] text-gray-400">+{selectedCompany.contactEmails.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  {loadingCompanyMsgs ? (
                    <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
                  ) : renderMessageList(companyMessages, 'company')}
                </div>

                {renderRightPanel(
                  selectedCompany.name,
                  true,
                  selectedCompany.emailCount,
                  companyAiSummary,
                  summarizingCompany,
                  summarizeCompany,
                  <span className="text-xs text-gray-400 mt-0.5">{selectedCompany.domain}</span>,
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">Select a company to view emails</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
