import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Sparkles,
  Send,
  CheckCircle2,
  UserPlus,
  Share2,
  Filter,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';
import { integrationService } from '../services/integrationService';

interface SocialThread {
  id: string;
  platform: string;
  sender_name: string;
  sender_handle: string;
  subject_or_post_preview: string;
  channel_type: string;
  sentiment: string;
  status: string;
  unread_count: number;
  linked_contact_id?: string | null;
  last_message_preview: string;
  last_message_at: string;
}

interface SocialMessage {
  id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  sender_name: string;
  body: string;
  ai_generated: boolean;
  created_at: string;
}

// Returned when a reply needs the account reconnected or a permission approved.
interface ReconnectHint {
  platform: 'facebook' | 'instagram';
  method?: 'instagram' | 'facebook';
  extraScopes: string[];
}

interface ApprovalLinkItem {
  id: string;
  token: string;
  title: string;
  client_name: string | null;
  resource_type: string;
  status: string;
  reviewer_name: string | null;
  reviewer_feedback: string | null;
  created_at: string;
}

export default function SocialInbox() {
  const initialSearch = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [activeTab, setActiveTab] = useState<'inbox' | 'approvals'>(
    initialSearch.get('tab') === 'approvals' ? 'approvals' : 'inbox'
  );
  const [threads, setThreads] = useState<SocialThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<SocialThread | null>(null);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string>(initialSearch.get('platform') || 'all');
  const [statusFilter, setStatusFilter] = useState<string>(initialSearch.get('status') || 'all');
  const [loading, setLoading] = useState<boolean>(true);
  const [replyText, setReplyText] = useState<string>('');
  const [aiDrafting, setAiDrafting] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<{ text: string; reconnect?: ReconnectHint } | null>(null);
  const [converting, setConverting] = useState<boolean>(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Client Approval Links state
  const [approvalLinks, setApprovalLinks] = useState<ApprovalLinkItem[]>([]);
  const [newApprovalTitle, setNewApprovalTitle] = useState(initialSearch.get('title') || '');
  const [newClientName, setNewClientName] = useState(initialSearch.get('client') || '');
  const [newApprovalContent, setNewApprovalContent] = useState(initialSearch.get('content') || '');
  const [creatingApproval, setCreatingApproval] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', activeTab);
    if (platformFilter !== 'all') params.set('platform', platformFilter);
    else params.delete('platform');
    if (statusFilter !== 'all') params.set('status', statusFilter);
    else params.delete('status');
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', nextUrl);
  }, [activeTab, platformFilter, statusFilter]);

  const fetchThreads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (platformFilter !== 'all') params.set('platform', platformFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`${API_BASE_URL}/api/social-inbox/threads?${params.toString()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.threads)) {
        setThreads(data.threads);
        if (!selectedThread && data.threads.length > 0) {
          void selectThread(data.threads[0]);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const selectThread = async (thread: SocialThread) => {
    setSelectedThread(thread);
    try {
      const res = await fetch(`${API_BASE_URL}/api/social-inbox/threads/${thread.id}/messages`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages || []);
        setThreads((prev) =>
          prev.map((t) => (t.id === thread.id ? { ...t, unread_count: 0 } : t))
        );
      }
    } catch {
      // ignore
    }
  };

  const fetchApprovalLinks = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/approvals/links`);
      const data = await res.json();
      if (data.success) {
        setApprovalLinks(data.links || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void fetchThreads();
    void fetchApprovalLinks();
  }, [platformFilter, statusFilter]);

  const handleGenerateAiDraft = async () => {
    if (!selectedThread) return;
    setAiDrafting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/social-inbox/threads/${selectedThread.id}/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone: 'helpful, warm, and conversion-focused' }),
      });
      const data = await res.json();
      if (data.success && data.draft) {
        setReplyText(data.draft);
        setAiDraft(data.draft);
      }
    } finally {
      setAiDrafting(false);
    }
  };

  const handleSendReply = async (markResolved = false) => {
    if (!selectedThread || !replyText.trim()) return;
    setSending(true);
    setReplyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/social-inbox/threads/${selectedThread.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: replyText,
          aiGenerated: aiDraft !== null && replyText.trim() === aiDraft.trim(),
          markResolved,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setReplyError({ text: data.error || 'The reply could not be sent.', reconnect: data.reconnect });
        return;
      }
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        setReplyText('');
        setAiDraft(null);
        if (markResolved) {
          setSelectedThread({ ...selectedThread, status: 'resolved' });
          setThreads((prev) =>
            prev.map((t) => (t.id === selectedThread.id ? { ...t, status: 'resolved' } : t))
          );
        }
      }
    } finally {
      setSending(false);
    }
  };

  const handleConvertToLead = async () => {
    if (!selectedThread) return;
    setConverting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/social-inbox/threads/${selectedThread.id}/convert-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealValue: 1500 }),
      });
      const data = await res.json();
      if (data.success) {
        setBannerMsg(data.message || 'Converted to CRM Contact & Deal!');
        setSelectedThread({ ...selectedThread, linked_contact_id: data.contact?.id || 'linked' });
        setTimeout(() => setBannerMsg(null), 4500);
      }
    } finally {
      setConverting(false);
    }
  };

  const handleCreateApprovalLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApprovalTitle.trim()) return;
    setCreatingApproval(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/approvals/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newApprovalTitle,
          clientName: newClientName || 'Client Team',
          resourceType: 'post',
          content: newApprovalContent || 'Scheduled multi-channel campaign post ready for sign-off.',
          platforms: ['instagram', 'linkedin', 'x'],
        }),
      });
      const data = await res.json();
      if (data.success && data.link) {
        setApprovalLinks((prev) => [data.link, ...prev]);
        setNewApprovalTitle('');
        setNewClientName('');
        setNewApprovalContent('');
        setBannerMsg('Created white-label Client Approval Portal link!');
        setTimeout(() => setBannerMsg(null), 4000);
      }
    } finally {
      setCreatingApproval(false);
    }
  };

  const copyShareUrl = (token: string) => {
    const url = `${window.location.origin}/review/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const getPlatformBadge = (platform: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      instagram: { label: 'Instagram', cls: 'bg-pink-50 text-pink-700 border-pink-200' },
      linkedin: { label: 'LinkedIn', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
      x: { label: 'X / Twitter', cls: 'bg-slate-100 text-slate-800 border-slate-300' },
      facebook: { label: 'Facebook', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    };
    return map[platform] || { label: platform, cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
            <MessageSquare className="h-6 w-6 text-indigo-600" />
            Unified Social Inbox & Client Approvals
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Reply to Instagram, LinkedIn, Facebook & X conversations with Brand-Memory AI, convert senders to CRM Deals, and share passwordless client sign-off portals.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl self-start">
          <button
            onClick={() => setActiveTab('inbox')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
              activeTab === 'inbox'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Social Inbox ({threads.length})
          </button>
          <button
            onClick={() => setActiveTab('approvals')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
              activeTab === 'approvals'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Share2 className="h-4 w-4 text-indigo-600" />
            Client Approval Portals ({approvalLinks.length})
          </button>
        </div>
      </div>

      {bannerMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {bannerMsg}
          </span>
          <button onClick={() => setBannerMsg(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {activeTab === 'inbox' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[620px]">
          {/* Left column: Thread list */}
          <div className="lg:col-span-5 border-r border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-100 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <Filter className="h-3.5 w-3.5" />
                  Filter Channels
                </div>
                <button
                  onClick={() => void fetchThreads()}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {['all', 'instagram', 'linkedin', 'x', 'facebook'].map((pf) => (
                  <button
                    key={pf}
                    onClick={() => setPlatformFilter(pf)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition ${
                      platformFilter === pf
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {pf}
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5 pt-1">
                {['all', 'open', 'resolved'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize ${
                      statusFilter === st
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
              {loading ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading threads...</div>
              ) : threads.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">No conversations match this filter.</div>
              ) : (
                threads.map((thread) => {
                  const badge = getPlatformBadge(thread.platform);
                  const isSelected = selectedThread?.id === thread.id;
                  return (
                    <button
                      key={thread.id}
                      onClick={() => void selectThread(thread)}
                      className={`w-full text-left p-4 transition hover:bg-slate-50 flex flex-col gap-1.5 ${
                        isSelected ? 'bg-indigo-50/60 border-l-4 border-l-indigo-600' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-slate-900 truncate">
                          {thread.sender_name}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">{thread.sender_handle}</div>
                      <p className="text-xs text-slate-700 line-clamp-2 mt-0.5">
                        {thread.last_message_preview}
                      </p>
                      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
                        <span className="capitalize">
                          {thread.channel_type} • {thread.sentiment}
                        </span>
                        {thread.status === 'resolved' ? (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Resolved
                          </span>
                        ) : thread.unread_count > 0 ? (
                          <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                            New
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right column: Conversation + AI Draft + Lead Bridge */}
          <div className="lg:col-span-7 flex flex-col justify-between bg-slate-50/40">
            {selectedThread ? (
              <>
                {/* Thread Header */}
                <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-slate-900">{selectedThread.sender_name}</h2>
                      <span className="text-xs text-slate-500">{selectedThread.sender_handle}</span>
                    </div>
                    <p className="text-xs text-indigo-600 font-medium mt-0.5">
                      Context: {selectedThread.subject_or_post_preview}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleConvertToLead}
                      disabled={converting || Boolean(selectedThread.linked_contact_id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                        selectedThread.linked_contact_id
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                      }`}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {selectedThread.linked_contact_id
                        ? 'Synced to CRM Pipeline'
                        : converting
                        ? 'Converting...'
                        : 'Convert to CRM Lead & Deal'}
                    </button>
                  </div>
                </div>

                {/* Messages Stream */}
                <div className="p-5 space-y-4 overflow-y-auto flex-1 max-h-[360px]">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[82%] ${
                        msg.direction === 'outbound' ? 'ml-auto items-end' : 'items-start'
                      }`}
                    >
                      <div className="text-[11px] text-slate-400 mb-1 px-1">
                        {msg.sender_name} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div
                        className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.direction === 'outbound'
                            ? 'bg-indigo-600 text-white rounded-br-none'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
                        }`}
                      >
                        {msg.body}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Composer */}
                <div className="p-4 bg-white border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleGenerateAiDraft}
                      disabled={aiDrafting}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {aiDrafting ? 'Drafting with Brand Memory...' : 'Draft Smart Reply with AI'}
                    </button>
                    <span className="text-[11px] text-slate-400">
                      Replies are sent on {selectedThread.platform === 'facebook' ? 'Facebook' : selectedThread.platform === 'instagram' ? 'Instagram' : 'the platform'} and saved to this thread
                    </span>
                  </div>

                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Reply to ${selectedThread.sender_name}...`}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />

                  {replyError ? (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      <span>{replyError.text}</span>
                      {replyError.reconnect ? (
                        <button
                          type="button"
                          onClick={() => {
                            const hint = replyError.reconnect!;
                            void integrationService.startOAuth(hint.platform, '/social-inbox', {
                              extraScopes: hint.extraScopes,
                              rerequest: hint.extraScopes.length > 0,
                              method: hint.method,
                            });
                          }}
                          className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          Reconnect {replyError.reconnect.platform === 'facebook' ? 'Facebook' : 'Instagram'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={sending || !replyText.trim()}
                      onClick={() => void handleSendReply(true)}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Send & Mark Resolved
                    </button>
                    <button
                      type="button"
                      disabled={sending || !replyText.trim()}
                      onClick={() => void handleSendReply(false)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Send className="h-3.5 w-3.5" />
                      {sending ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 my-auto">
                Select a conversation from the left to view messages and draft AI replies.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Client Approval Portals Tab */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Share2 className="h-5 w-5 text-indigo-600" />
              Create Client Approval Portal Link
            </h2>
            <p className="text-xs text-slate-500">
              Generate a white-label, passwordless review URL (`/review/:token`) for external clients to preview and approve content or request revisions.
            </p>
            <form onSubmit={handleCreateApprovalLink} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Deliverable Title
                </label>
                <input
                  type="text"
                  required
                  value={newApprovalTitle}
                  onChange={(e) => setNewApprovalTitle(e.target.value)}
                  placeholder="e.g., Q4 Product Launch — Instagram & LinkedIn Carousel"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Client / Brand Name
                </label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g., Acme FinTech Team"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Post Copy / Deliverable Preview
                </label>
                <textarea
                  rows={4}
                  value={newApprovalContent}
                  onChange={(e) => setNewApprovalContent(e.target.value)}
                  placeholder="Paste the caption, campaign brief, or talking points for client sign-off..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={creatingApproval}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition"
              >
                {creatingApproval ? 'Generating Link...' : 'Generate White-Label Review Link'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-bold text-slate-900">Active Client Review Portals</h2>
            {approvalLinks.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
                No approval links generated yet. Create one on the left to share with a client!
              </div>
            ) : (
              <div className="space-y-3">
                {approvalLinks.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{item.title}</span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize ${
                            item.status === 'approved'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : item.status === 'changes_requested'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {item.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Client: {item.client_name || 'External Reviewer'} • Created{' '}
                        {new Date(item.created_at).toLocaleDateString()}
                      </div>
                      {item.reviewer_feedback && (
                        <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 mt-1">
                          <strong>{item.reviewer_name || 'Reviewer'}:</strong> "{item.reviewer_feedback}"
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyShareUrl(item.token)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                      >
                        {copiedToken === item.token ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> Copy Link
                          </>
                        )}
                      </button>
                      <a
                        href={`/review/${item.token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold flex items-center gap-1"
                      >
                        Preview <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
