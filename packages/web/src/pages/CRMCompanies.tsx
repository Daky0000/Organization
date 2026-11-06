import React, { useState, useEffect, useRef } from 'react';
import {
  Building2, Plus, Search, Globe, Mail, Users, X, Trash2, Edit2,
  MessageSquare, PhoneCall, Calendar, FileText, Clock,
  ArrowUpRight, ArrowDownLeft, RefreshCw, Loader2, MoreHorizontal,
  ChevronDown, ChevronRight, StickyNote, ChevronLeft, Sparkles,
  PenLine,
} from 'lucide-react';
import CreateTaskModal from '../components/tasks/CreateTaskModal';
import RichTextEditor from '../components/RichTextEditor';
import ScheduleMeetingModal from '../components/crm/ScheduleMeetingModal';
import DOMPurify from 'dompurify';

const API = '/api/crm';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  logo_url: string | null;
  contact_count: number;
  open_deals_count: number;
  open_deals_value: number;
  created_at: string;
}

interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_name: string | null;
  stage_color: string | null;
}

interface Activity {
  id: string;
  type: 'note' | 'call' | 'email' | 'meeting' | 'task' | 'whatsapp' | 'sms';
  title: string | null;
  body: string | null;
  outcome: string | null;
  duration: number | null;
  scheduled_at: string | null;
  end_time: string | null;
  completed_at: string | null;
  created_at: string;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  gmail_message_id: string | null;
  author_name: string | null;
  recurrence: string | null;
  attendees: { id?: string; type: string; name: string; email: string }[] | null;
  reminder_minutes: number[] | null;
  google_event_id: string | null;
}

const INDUSTRY_OPTIONS = ['Technology','Finance','Healthcare','Retail','Manufacturing','Education','Media','Real Estate','Consulting','Other'];
const SIZE_OPTIONS = ['1-10','11-50','51-200','201-500','501-1000','1000+'];


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

function paletteFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PALETTE[h % PALETTE.length];
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function Avatar({ name, round = false, size = 'w-9 h-9', textSize = 'text-sm' }: { name: string; round?: boolean; size?: string; textSize?: string }) {
  const { bg, text } = paletteFor(name);
  return (
    <div className={`${size} ${round ? 'rounded-full' : 'rounded-lg'} ${bg} ${text} flex items-center justify-center flex-shrink-0 font-semibold ${textSize}`}>
      {getInitials(name)}
    </div>
  );
}

function CompanyLogo({ name, domain, size = 'w-9 h-9', round = false }: { name: string; domain: string | null; size?: string; round?: boolean }) {
  const [state, setState] = React.useState<'try' | 'ok' | 'fallback'>('try');
  const prevDomain = useRef<string | null>(null);

  React.useEffect(() => {
    if (domain !== prevDomain.current) {
      prevDomain.current = domain;
      setState(domain ? 'try' : 'fallback');
    }
  }, [domain]);

  const url = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null;

  if (!url || state === 'fallback') return <Avatar name={name} round={round} size={size} />;

  return (
    <>
      <img
        src={url}
        alt=""
        className={`${size} ${round ? 'rounded-full' : 'rounded-lg'} object-contain bg-white border border-gray-100 p-0.5 flex-shrink-0 ${state === 'ok' ? '' : 'hidden'}`}
        onLoad={e => { setState(e.currentTarget.naturalWidth < 20 ? 'fallback' : 'ok'); }}
        onError={() => setState('fallback')}
      />
      {state === 'try' && <Avatar name={name} round={round} size={size} />}
    </>
  );
}

function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function ActivityIcon({ type }: { type: Activity['type'] }) {
  const cfg: Record<Activity['type'], { icon: React.ReactNode; bg: string; color: string }> = {
    email:    { icon: <Mail className="w-3.5 h-3.5" />,         bg: 'bg-blue-50',    color: 'text-blue-500'   },
    call:     { icon: <PhoneCall className="w-3.5 h-3.5" />,    bg: 'bg-green-50',   color: 'text-green-500'  },
    note:     { icon: <FileText className="w-3.5 h-3.5" />,     bg: 'bg-yellow-50',  color: 'text-yellow-600' },
    meeting:  { icon: <Calendar className="w-3.5 h-3.5" />,     bg: 'bg-purple-50',  color: 'text-purple-500' },
    task:     { icon: <Clock className="w-3.5 h-3.5" />,        bg: 'bg-gray-100',   color: 'text-gray-500'   },
    whatsapp: { icon: <MessageSquare className="w-3.5 h-3.5" />,bg: 'bg-emerald-50', color: 'text-emerald-500'},
    sms:      { icon: <MessageSquare className="w-3.5 h-3.5" />,bg: 'bg-gray-100',   color: 'text-gray-500'   },
  };
  const { icon, bg, color } = cfg[type] ?? cfg.note;
  return <div className={`w-7 h-7 rounded-full ${bg} ${color} flex items-center justify-center flex-shrink-0`}>{icon}</div>;
}

function ActivityItem({ act }: { act: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const isGmail = Boolean(act.gmail_message_id);
  const isSent = act.title?.startsWith('Sent: ');
  const isNote = act.type === 'note';
  const isMeeting = act.type === 'meeting';
  const displayTitle = isNote
    ? `Note by ${act.author_name ?? 'You'}`
    : (act.title?.replace(/^(Sent|Received): /, '') ?? `${act.type.charAt(0).toUpperCase() + act.type.slice(1)} activity`);
  const when = new Date(act.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const contactName = [act.contact_first_name, act.contact_last_name].filter(Boolean).join(' ') || act.contact_email || '';
  const bodyPlain = isNote && act.body ? stripHtml(act.body) : act.body;

  const meetingTime = isMeeting && act.scheduled_at
    ? new Date(act.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    : null;

  return (
    <div className="flex gap-3 py-4 border-b border-gray-100 last:border-0">
      <ActivityIcon type={act.type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-gray-800">{displayTitle}</span>
              {isGmail && (
                <span className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full font-medium ${isSent ? 'bg-indigo-50 text-indigo-600' : 'bg-sky-50 text-sky-600'}`}>
                  {isSent ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                  {isSent ? 'Sent' : 'Received'}
                </span>
              )}
              {isMeeting && act.google_event_id && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">
                  <Calendar className="w-2.5 h-2.5" /> Synced
                </span>
              )}
            </div>
            {meetingTime && <p className="text-xs text-[#2563EB] mt-0.5 font-medium">{meetingTime}</p>}
            {!meetingTime && contactName && <p className="text-xs text-gray-400 mt-0.5">{contactName}</p>}
            {isMeeting && Array.isArray(act.attendees) && act.attendees.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                {act.attendees.slice(0, 3).map(a => a.name || a.email).join(', ')}
                {act.attendees.length > 3 && ` +${act.attendees.length - 3} more`}
              </p>
            )}
          </div>
          <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{when}</span>
        </div>
        {act.body && (
          <div className="mt-1">
            {isNote && expanded
              ? <div className="text-xs text-gray-500 prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(act.body) }} />
              : <p className={`text-xs text-gray-500 ${!expanded ? 'line-clamp-2' : ''}`}>{bodyPlain}</p>
            }
            {(bodyPlain?.length ?? 0) > 120 && (
              <button onClick={() => setExpanded(e => !e)} className="text-xs text-[#2563EB] mt-0.5 hover:underline">
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {act.outcome && <p className="text-xs text-gray-400 mt-1">Outcome: {act.outcome}</p>}
      </div>
    </div>
  );
}

interface NoteComment {
  id: string;
  note_id: string;
  user_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
}

const crmHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` });

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function groupNotesByMonth(notes: Activity[]) {
  const groups: { label: string; notes: Activity[] }[] = [];
  const map = new Map<string, Activity[]>();
  for (const n of notes) {
    const key = new Date(n.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!map.has(key)) { map.set(key, []); groups.push({ label: key, notes: map.get(key)! }); }
    map.get(key)!.push(n);
  }
  return groups;
}

function NoteItem({ note, onUpdate, onDelete }: {
  note: Activity;
  onUpdate: (id: string, body: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentBody, setCurrentBody] = useState(note.body ?? '');
  const [editBody, setEditBody] = useState(note.body ?? '');
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  useEffect(() => {
    if (expanded && !commentsLoaded) {
      fetch(`/api/crm/activities/${note.id}/comments`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` } })
        .then(r => r.ok ? r.json() : [])
        .then(data => { setComments(Array.isArray(data) ? data : []); setCommentsLoaded(true); })
        .catch(() => setCommentsLoaded(true));
    }
  }, [expanded, commentsLoaded, note.id]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/crm/activities/${note.id}`, {
        method: 'PATCH', headers: crmHeaders(), body: JSON.stringify({ body: editBody }),
      });
      if (r.ok) { setCurrentBody(editBody); onUpdate(note.id, editBody); setEditing(false); }
    } finally { setSaving(false); }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || sendingComment) return;
    setSendingComment(true);
    try {
      const r = await fetch(`/api/crm/activities/${note.id}/comments`, {
        method: 'POST', headers: crmHeaders(), body: JSON.stringify({ body: newComment.trim() }),
      });
      if (r.ok) { const c = await r.json(); setComments(p => [...p, c]); setNewComment(''); }
    } finally { setSendingComment(false); }
  };

  const handleDeleteComment = async (cid: string) => {
    await fetch(`/api/crm/activities/${note.id}/comments/${cid}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` },
    }).catch(() => {});
    setComments(p => p.filter(c => c.id !== cid));
  };

  const plain = currentBody ? stripHtml(currentBody) : '';
  const when = new Date(note.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        onClick={() => { setExpanded(e => !e); if (editing) { setEditing(false); setEditBody(currentBody); } }}
      >
        <ChevronRight className={`w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-800">
              Note by <span className="text-[#2563EB]">{note.author_name ?? 'You'}</span>
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">{when}</span>
          </div>
          {!expanded && plain && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{plain}</p>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Note body / edit */}
          <div className="px-4 pt-3 pb-2">
            {editing ? (
              <div className="space-y-2">
                <RichTextEditor value={editBody} onChange={setEditBody} />
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => { setEditing(false); setEditBody(currentBody); }}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => void handleSave()} disabled={saving || !stripHtml(editBody).trim()}
                    className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#4a5be8] disabled:opacity-40 transition-colors">
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {currentBody
                  ? <div className="prose prose-sm max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(currentBody) }} />
                  : <p className="text-xs text-gray-400 italic">No content</p>}
                <div className="flex items-center gap-3 mt-2.5">
                  <button onClick={e => { e.stopPropagation(); setEditBody(currentBody); setEditing(true); }}
                    className="text-xs text-[#2563EB] hover:underline font-medium">Edit</button>
                  <button onClick={e => { e.stopPropagation(); onDelete(note.id); }}
                    className="text-xs text-red-400 hover:text-red-600 hover:underline">Delete</button>
                </div>
              </>
            )}
          </div>

          {/* Comments */}
          {!editing && (
            <div className="px-4 pb-4 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
                Comments{comments.length > 0 ? ` (${comments.length})` : ''}
              </p>

              {comments.length > 0 && (
                <div className="space-y-3 mb-3">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-2 group">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                        {(c.author_name ?? 'Y')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[11px] font-semibold text-gray-700">{c.author_name ?? 'You'}</span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[12px] text-gray-600 leading-relaxed">{c.body}</p>
                      </div>
                      <button onClick={() => void handleDeleteComment(c.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddComment(); } }}
                  placeholder="Add a comment…"
                  className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <button onClick={() => void handleAddComment()} disabled={!newComment.trim() || sendingComment}
                  className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-[11px] font-bold text-white hover:bg-[#4a5be8] disabled:opacity-40 transition-colors flex-shrink-0">
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateNoteModal({ companyId, companyName, onCreated, onClose }: {
  companyId: string;
  companyName: string;
  onCreated: (note: Activity) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const plain = stripHtml(body).trim();
    if (!plain) return;
    setSaving(true);
    try {
      const r = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` },
        body: JSON.stringify({ type: 'note', body, company_id: companyId }),
      });
      if (!r.ok) return;
      const note = await r.json();
      onCreated(note);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
            <PenLine size={15} className="text-[#2563EB]" /> Note
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* "For" badge */}
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            <span>For</span>
            <span className="px-2.5 py-0.5 rounded-full border border-gray-300 text-gray-700 font-medium text-[11px]">
              {companyName}
            </span>
          </div>

          {/* Rich text editor */}
          <RichTextEditor value={body} onChange={setBody} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-[13px] text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={saving || !stripHtml(body).trim()}
            className="rounded-xl bg-[#2563EB] px-5 py-2 text-[13px] font-bold text-white hover:bg-[#4a5be8] disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Create note'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesView({ notes, companyId, companyName, onNoteCreated, onNoteUpdated, onNoteDeleted }: {
  notes: Activity[];
  companyId: string;
  companyName: string;
  onNoteCreated: (note: Activity) => void;
  onNoteUpdated: (id: string, body: string) => void;
  onNoteDeleted: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const filtered = search.trim()
    ? notes.filter(n => stripHtml(n.body ?? '').toLowerCase().includes(search.toLowerCase()))
    : notes;

  const groups = groupNotesByMonth(filtered);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-[12px] font-semibold hover:bg-[#4a5be8] transition-colors flex-shrink-0"
        >
          <PenLine size={13} /> Create a note
        </button>
      </div>

      {/* Notes list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center flex-1">
          <div className="w-10 h-10 rounded-full bg-yellow-50 flex items-center justify-center mb-3">
            <FileText className="w-5 h-5 text-yellow-400" />
          </div>
          <p className="text-sm text-gray-400">{search ? 'No notes match your search' : 'No notes yet'}</p>
          {!search && (
            <button onClick={() => setShowModal(true)} className="mt-3 text-xs text-[#2563EB] hover:underline">
              Create the first note
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5 pb-6">
          {groups.map(({ label, notes: groupNotes }) => (
            <div key={label}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
              <div className="space-y-2">
                {groupNotes.map(n => (
                  <NoteItem key={n.id} note={n} onUpdate={onNoteUpdated} onDelete={onNoteDeleted} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <CreateNoteModal
          companyId={companyId}
          companyName={companyName}
          onCreated={note => { onNoteCreated(note); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

type ActivitySubTab = 'All activities' | 'Notes' | 'Emails' | 'Calls' | 'Tasks' | 'Meetings';
const ACTIVITY_SUBTABS: ActivitySubTab[] = ['All activities', 'Notes', 'Emails', 'Calls', 'Tasks', 'Meetings'];
const ACTIVITY_TYPE_MAP: Record<ActivitySubTab, Activity['type'] | null> = {
  'All activities': null, 'Notes': 'note', 'Emails': 'email', 'Calls': 'call', 'Tasks': 'task', 'Meetings': 'meeting',
};

function AddContactToCompanyModal({
  companyId, companyName, existingContactIds,
  query, setQuery, results, setResults, searching, setSearching, saving, setSaving,
  onAdded, onClose,
}: {
  companyId: string; companyName: string; existingContactIds: string[];
  query: string; setQuery: (q: string) => void;
  results: { id: string; email: string; first_name: string | null; last_name: string | null }[];
  setResults: (r: { id: string; email: string; first_name: string | null; last_name: string | null }[]) => void;
  searching: boolean; setSearching: (v: boolean) => void;
  saving: string | null; setSaving: (id: string | null) => void;
  onAdded: (c: { id: string; email: string; first_name: string | null; last_name: string | null }) => void;
  onClose: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = (q: string) => {
    setQuery(q);
    clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/mailing/contacts?search=${encodeURIComponent(q)}`, { headers: authHeaders() });
        const d = r.ok ? await r.json() : { contacts: [] };
        setResults((d.contacts || []).filter((c: any) => !existingContactIds.includes(c.id)).slice(0, 10));
      } finally { setSearching(false); }
    }, 250);
  };

  const linkContact = async (c: { id: string; email: string; first_name: string | null; last_name: string | null }) => {
    setSaving(c.id);
    try {
      const r = await fetch(`/api/crm/companies/${companyId}/contacts`, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ contact_id: c.id }),
      });
      if (r.ok) { onAdded(c); setResults(results.filter(x => x.id !== c.id)); }
    } finally { setSaving(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
            <Users size={15} className="text-[#2563EB]" /> Add Contact to {companyName}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              placeholder="Search contacts by name or email…"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              autoFocus
            />
            {searching && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-gray-400" />}
          </div>
          {results.length > 0 && (
            <div className="mt-2 divide-y divide-gray-50 max-h-64 overflow-y-auto rounded-lg border border-gray-100">
              {results.map(c => {
                const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                const { bg, text } = paletteFor(c.email);
                return (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className={`w-8 h-8 rounded-full ${bg} ${text} flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                      {(c.first_name?.[0] || c.email[0]).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                      <p className="text-xs text-gray-400 truncate">{c.email}</p>
                    </div>
                    <button
                      onClick={() => void linkContact(c)}
                      disabled={saving === c.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-60 flex-shrink-0"
                    >
                      {saving === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {!searching && query.trim() && results.length === 0 && (
            <p className="text-xs text-gray-400 mt-3 text-center">No contacts found for "{query}"</p>
          )}
          {!query.trim() && (
            <p className="text-xs text-gray-400 mt-3 text-center">Start typing to search your contacts</p>
          )}
        </div>
        <div className="flex justify-end px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl border border-gray-200">Done</button>
        </div>
      </div>
    </div>
  );
}

function CatchupTab({ company }: { company: Company & { activities?: Activity[] } }) {
  const emailCount = company.activities?.filter(a => a.type === 'email').length ?? 0;
  const activityCount = company.activities?.length ?? 0;
  const lastActivity = company.activities?.[0];
  const lastContactedStr = lastActivity
    ? new Date(lastActivity.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="space-y-4 py-4">
      {/* Overview section */}
      <div>
        <button className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3 group">
          <ChevronDown className="w-4 h-4 text-gray-400" />
          Overview
        </button>

        {/* Company insights card */}
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-800">Company insights</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-pink-100 text-pink-600">
              <Sparkles className="w-3 h-3" /> AI
            </span>
          </div>
          <div className="px-4 py-4 bg-gray-50">
            {activityCount > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  {emailCount > 0
                    ? `${emailCount} email${emailCount !== 1 ? 's' : ''} exchanged with this company${lastContactedStr ? `. Last contact: ${lastContactedStr}.` : '.'}`
                    : `${activityCount} activit${activityCount !== 1 ? 'ies' : 'y'} recorded.`
                  }
                  {company.domain ? ` Domain: ${company.domain}.` : ''}
                  {company.industry ? ` Industry: ${company.industry}.` : ''}
                </p>
                <p className="text-xs text-gray-400">Connect an AI model to generate full summaries and insights.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  No recent activities or communications are recorded. Add activities or sync Gmail to see an updated summary.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-white transition-colors">
                    + Sync Gmail
                  </button>
                  <button className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-white transition-colors">
                    + Add activity
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Recent interactions card */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-800">Recent interactions</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-pink-100 text-pink-600">
              <Sparkles className="w-3 h-3" /> AI
            </span>
          </div>
          <div className="px-4 py-4 bg-gray-50">
            {(company.activities?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center text-center py-3">
                <p className="text-xs text-gray-500 mb-3">No activity on this record.</p>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-white transition-colors">
                  Create activity <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {company.activities!.slice(0, 3).map(act => {
                  const title = act.title?.replace(/^(Sent|Received): /, '') ?? `${act.type} activity`;
                  const when = new Date(act.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return (
                    <div key={act.id} className="flex items-start gap-2">
                      <ActivityIcon type={act.type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{title}</p>
                        <p className="text-[10px] text-gray-400">{when}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Health section */}
      <div>
        <button className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
          <ChevronDown className="w-4 h-4 text-gray-400" />
          Health
        </button>

        {[
          { title: 'Sentiment',         msg: 'No sentiment data available.' },
          { title: 'Challenges',        msg: 'No challenges found.' },
          { title: 'Positive feedback', msg: 'No customer feedback found.' },
        ].map(({ title, msg }) => (
          <div key={title} className="border border-gray-200 rounded-xl overflow-hidden mb-3">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-800">{title}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-pink-100 text-pink-600">
                <Sparkles className="w-3 h-3" /> AI
              </span>
            </div>
            <div className="px-4 py-5 bg-gray-50 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                <Search className="w-5 h-5 text-gray-300" />
              </div>
              <p className="text-xs text-gray-400">{msg}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CRMCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Company & { contacts?: Contact[]; deals?: Deal[]; activities?: Activity[] } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', domain: '', industry: '', size: '', website: '', phone: '', email: '', city: '', country: '', description: '' });

  const [listTab, setListTab] = useState<'all' | 'mine'>('all');

  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailSync, setGmailSync] = useState<{ status: string; totalFetched: number; lastSyncedAt: string | null; errorMessage?: string | null } | null>(null);
  const [gmailSyncing, setGmailSyncing] = useState(false);

  const [detailTab, setDetailTab] = useState<'catchup' | 'activities'>('catchup');
  const [activitySubTab, setActivitySubTab] = useState<ActivitySubTab>('All activities');
  const [contactsExpanded, setContactsExpanded] = useState(true);
  const [dealsExpanded, setDealsExpanded] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [addContactQuery, setAddContactQuery] = useState('');
  const [addContactResults, setAddContactResults] = useState<{ id: string; email: string; first_name: string | null; last_name: string | null }[]>([]);
  const [addContactSearching, setAddContactSearching] = useState(false);
  const [addContactSaving, setAddContactSaving] = useState<string | null>(null);

  // refs so load() can always read latest values without stale closure
  const searchRef = useRef('');
  const listTabRef = useRef<'all' | 'mine'>('all');
  searchRef.current = search;
  listTabRef.current = listTab;

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (searchRef.current) params.set('search', searchRef.current);
      if (listTabRef.current === 'mine') params.set('source', 'manual');
      const r = await fetch(`${API}/companies?${params}`, { headers: authHeaders() });
      const data = await r.json();
      setCompanies(data.companies || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, []); // stable - reads from refs

  useEffect(() => {
    fetch('/api/accounts', { headers: authHeaders() })
      .then(r => r.json()).catch(() => ({ data: [] }))
      .then(data => {
        const accounts: any[] = Array.isArray(data?.data) ? data.data : [];
        setGmailConnected(accounts.some((a: any) => a.platform === 'gmail' && a.connected));
      });
    fetch('/api/gmail/sync/status', { headers: authHeaders() })
      .then(r => r.json()).catch(() => null)
      .then(data => { if (data?.status) setGmailSync(data); });
  }, []);

  useEffect(() => { load(); }, []); // initial
  useEffect(() => { load(); }, [listTab, load]); // tab switch
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
  }, [search]); // search debounce

  const triggerGmailSync = async () => {
    setGmailSyncing(true);
    await fetch('/api/gmail/sync', { method: 'POST', headers: authHeaders() }).catch(() => {});
    const poll = async () => {
      const data = await fetch('/api/gmail/sync/status', { headers: authHeaders() }).then(r => r.json()).catch(() => null);
      if (!data) { setGmailSyncing(false); return; }
      setGmailSync(data);
      if (data.status === 'running') setTimeout(poll, 2500);
      else { setGmailSyncing(false); if (data.status === 'done') load(); }
    };
    await poll();
  };

  const openDetail = async (company: Company) => {
    setSelected(company as any);
    setDetailTab('catchup');
    setActivitySubTab('All activities');
    const [detailRes, activityRes] = await Promise.all([
      fetch(`${API}/companies/${company.id}`, { headers: authHeaders() }),
      fetch(`${API}/activities?company_id=${company.id}&limit=100`, { headers: authHeaders() }),
    ]);
    const detail = detailRes.ok ? await detailRes.json() : company;
    const activities = activityRes.ok ? await activityRes.json() : [];
    setSelected({ ...detail, activities });
  };

  const openCreate = () => {
    setEditingCompany(null);
    setForm({ name: '', domain: '', industry: '', size: '', website: '', phone: '', email: '', city: '', country: '', description: '' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (company: Company) => {
    setEditingCompany(company);
    setForm({ name: company.name, domain: company.domain||'', industry: company.industry||'', size: company.size||'', website: company.website||'', phone: company.phone||'', email: company.email||'', city: company.city||'', country: company.country||'', description: company.description||'' });
    setFormError('');
    setShowForm(true);
  };

  const saveCompany = async () => {
    if (!form.name.trim()) { setFormError('Company name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const url = editingCompany ? `${API}/companies/${editingCompany.id}` : `${API}/companies`;
      const method = editingCompany ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: jsonHeaders(), body: JSON.stringify(form) });
      if (!r.ok) { setFormError((await r.json()).error || 'Save failed'); return; }
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  };

  const deleteCompany = async (id: string) => {
    if (!confirm('Delete this company? This cannot be undone.')) return;
    await fetch(`${API}/companies/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (selected?.id === id) setSelected(null);
    load();
  };

  const isRunning = gmailSyncing || gmailSync?.status === 'running';
  const pct = Math.min(Math.round(((gmailSync?.totalFetched ?? 0) / 2000) * 100), 100);

  const filteredActivities = (selected?.activities ?? []).filter(a => {
    const t = ACTIVITY_TYPE_MAP[activitySubTab];
    return t === null || a.type === t;
  });

  // ── Shared company form modal ────────────────────────────────────────────────
  const companyFormModal = showForm && (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{editingCompany ? 'Edit Company' : 'New Company'}</h2>
          <button onClick={() => setShowForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          {formError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Company Name *</label>
            <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Inc." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Domain</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} placeholder="acme.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Website</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://acme.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Industry</label>
              <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                <option value="">Select…</option>
                {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Company Size</label>
              <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))}>
                <option value="">Select…</option>
                {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} employees</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@acme.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 000 0000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">City</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="New York" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Country</label>
              <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="United States" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
            <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description…" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button onClick={saveCompany} disabled={saving} className="px-5 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : editingCompany ? 'Update Company' : 'Create Company'}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Full-width detail view ────────────────────────────────────────────────────
  if (selected) {
    return (
      <>
      <div className="flex flex-col h-full bg-white overflow-hidden">
        {/* Top breadcrumb bar */}
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Companies
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-800 truncate">{selected.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => openEdit(selected)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        </div>

        {/* 3-column body */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ── Left sidebar ── */}
          <div className="w-72 flex-shrink-0 border-r border-gray-100 overflow-y-auto bg-white">
            <div className="p-5 space-y-5">
              {/* Logo + name + website */}
              <div className="flex flex-col items-center text-center pt-1">
                <CompanyLogo name={selected.name} domain={selected.domain} size="w-16 h-16" />
                <h2 className="mt-3 text-base font-semibold text-gray-900 leading-snug">{selected.name}</h2>
                {(selected.website || selected.domain) && (
                  <a
                    href={selected.website || `https://${selected.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#2563EB] hover:underline mt-0.5 truncate max-w-full flex items-center gap-1"
                  >
                    <Globe className="w-3 h-3" />{selected.domain || selected.website}
                  </a>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-1 pb-1">
                {([
                  { icon: StickyNote,      label: 'Note',    action: () => setShowNoteModal(true) },
                  { icon: Mail,            label: 'Email',   action: undefined         },
                  { icon: PhoneCall,       label: 'Call',    action: undefined         },
                  { icon: Clock,           label: 'Task',    action: () => setShowTaskModal(true) },
                  { icon: Calendar,        label: 'Meeti...',action: () => setShowMeetingModal(true) },
                  { icon: MoreHorizontal,  label: 'More',    action: undefined         },
                ] as { icon: React.ComponentType<{className?:string}>; label: string; action?: () => void }[]).map(({ icon: Icon, label, action }) => (
                  <button key={label} onClick={action} className="flex flex-col items-center gap-1 py-2.5 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-colors">
                    <div className="w-9 h-9 rounded-full border border-gray-200 bg-white flex items-center justify-center shadow-sm">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-medium text-gray-500">{label}</span>
                  </button>
                ))}
              </div>

              {/* Key information */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-700">Key information</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(selected)} className="text-[11px] text-[#2563EB] hover:underline">Actions</button>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { label: 'Company owner', value: null },
                    { label: 'City',          value: selected.city },
                    { label: 'Lifecycle Stage', value: null },
                    { label: 'Lead Status',   value: null },
                    { label: 'Industry',      value: selected.industry },
                    { label: 'Last Contacted', value: selected.activities?.[0] ? new Date(selected.activities[0].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[11px] text-gray-400">{label}</p>
                      <p className={`text-xs mt-0.5 ${value ? 'text-gray-700' : 'text-gray-300'}`}>{value || '--'}</p>
                    </div>
                  ))}
                  {selected.domain && (
                    <div>
                      <p className="text-[11px] text-gray-400">Domain</p>
                      <p className="text-xs text-gray-700 mt-0.5">{selected.domain}</p>
                    </div>
                  )}
                  {selected.size && (
                    <div>
                      <p className="text-[11px] text-gray-400">Company size</p>
                      <p className="text-xs text-gray-700 mt-0.5">{selected.size} employees</p>
                    </div>
                  )}
                  {selected.description && (
                    <div>
                      <p className="text-[11px] text-gray-400">Description</p>
                      <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{selected.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete */}
              <div className="border-t border-gray-100 pt-4">
                <button
                  onClick={() => deleteCompany(selected.id)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-gray-200 text-red-400 text-xs font-medium rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete company
                </button>
              </div>
            </div>
          </div>

          {/* ── Center: Catch-up / Activities ── */}
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 min-w-0">
            {/* Top tabs: Catch-up | Activities */}
            <div className="flex-shrink-0 bg-white border-b border-gray-100">
              <div className="flex">
                {(['catchup', 'activities'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setDetailTab(t)}
                    className={`px-6 py-3.5 text-sm font-semibold border-b-2 transition-colors capitalize ${detailTab === t ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    {t === 'catchup' ? 'Catch-up' : 'Activities'}
                  </button>
                ))}
              </div>
            </div>

            {detailTab === 'catchup' ? (
              <div className="flex-1 overflow-y-auto px-6">
                <CatchupTab company={selected} />
              </div>
            ) : (
              <>
                {/* Activity sub-tabs */}
                <div className="flex-shrink-0 bg-white border-b border-gray-100 px-4 overflow-x-auto">
                  <div className="flex">
                    {ACTIVITY_SUBTABS.map(t => (
                      <button
                        key={t}
                        onClick={() => setActivitySubTab(t)}
                        className={`px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activitySubTab === t ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                      >
                        {t}
                        {t !== 'All activities' && (() => {
                          const typeKey = ACTIVITY_TYPE_MAP[t];
                          const cnt = typeKey ? (selected.activities?.filter(a => a.type === typeKey).length ?? 0) : 0;
                          return cnt > 0 ? <span className="ml-1 text-xs text-gray-400">({cnt})</span> : null;
                        })()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Activity list */}
                <div className="flex-1 overflow-y-auto px-6 py-2">
                  {activitySubTab === 'Notes' ? (
                    <NotesView
                      notes={(selected.activities ?? []).filter(a => a.type === 'note')}
                      companyId={selected.id}
                      companyName={selected.name}
                      onNoteCreated={note => setSelected(s => s ? { ...s, activities: [note, ...(s.activities ?? [])] } : s)}
                      onNoteUpdated={(id, body) => setSelected(s => s ? { ...s, activities: (s.activities ?? []).map(a => a.id === id ? { ...a, body } : a) } : s)}
                      onNoteDeleted={id => {
                        fetch(`/api/crm/activities/${id}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
                        setSelected(s => s ? { ...s, activities: (s.activities ?? []).filter(a => a.id !== id) } : s);
                      }}
                    />
                  ) : filteredActivities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                        <Clock className="w-5 h-5 text-gray-300" />
                      </div>
                      <p className="text-sm text-gray-400">No {activitySubTab === 'All activities' ? 'activity' : activitySubTab.toLowerCase()} yet</p>
                      {activitySubTab === 'All activities' && <p className="text-xs text-gray-300 mt-1">Sync Gmail to see email history here</p>}
                    </div>
                  ) : (
                    filteredActivities.map(act => <ActivityItem key={act.id} act={act} />)
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Right panel ── */}
          <div className="w-64 flex-shrink-0 border-l border-gray-100 overflow-y-auto bg-white">
            {/* Contacts */}
            <div className="border-b border-gray-100">
              <div className="flex items-center justify-between px-4 py-3">
                <button onClick={() => setContactsExpanded(e => !e)} className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900">
                  {contactsExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  Contacts ({selected.contacts?.length ?? selected.contact_count ?? 0})
                </button>
                <button onClick={() => setShowAddContactModal(true)} className="text-xs text-[#2563EB] cursor-pointer hover:underline">+ Add</button>
              </div>
              {contactsExpanded && (
                <div className="px-4 pb-3 space-y-2">
                  {(selected.contacts?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-400 py-1">No contacts yet</p>
                  ) : selected.contacts!.map(c => {
                    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                    const { bg, text } = paletteFor(c.email);
                    return (
                      <div key={c.id} className="py-2 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-6 h-6 rounded-full ${bg} ${text} flex items-center justify-center text-[10px] font-semibold flex-shrink-0`}>
                            {(c.first_name?.[0] || c.email[0]).toUpperCase()}
                          </div>
                          <a href={`mailto:${c.email}`} className="text-xs font-medium text-[#2563EB] hover:underline truncate">{c.email}</a>
                        </div>
                        <p className="text-xs text-gray-600 pl-8">{name !== c.email ? name : ''}</p>
                        <p className="text-xs text-gray-400 pl-8">Email: <a href={`mailto:${c.email}`} className="text-[#2563EB] hover:underline">{c.email}</a></p>
                        {c.is_primary && (
                          <div className="pl-8 mt-1">
                            <span className="text-[9px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">Contact with Primary Company</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(selected.contacts?.length ?? 0) > 0 && (
                    <button className="text-xs text-[#2563EB] hover:underline mt-1">View all associated Contacts ↗</button>
                  )}
                </div>
              )}
            </div>

            {/* Deals */}
            <div className="border-b border-gray-100">
              <div className="flex items-center justify-between px-4 py-3">
                <button onClick={() => setDealsExpanded(e => !e)} className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900">
                  {dealsExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  Deals ({selected.deals?.length ?? selected.open_deals_count ?? 0})
                </button>
                <span className="text-xs text-[#2563EB] cursor-pointer hover:underline">+ Add</span>
              </div>
              {dealsExpanded && (
                <div className="px-4 pb-4">
                  {(selected.deals?.length ?? 0) === 0 ? (
                    <div className="flex flex-col items-center text-center py-3">
                      <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-2">
                        <Users className="w-5 h-5 text-gray-200" />
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">Track the revenue opportunities associated with this record.</p>
                    </div>
                  ) : selected.deals!.map(d => (
                    <div key={d.id} className="flex items-center gap-2 py-1.5">
                      {d.stage_color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.stage_color }} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{d.title}</p>
                        <p className="text-[10px] text-gray-400">{formatCurrency(d.value, d.currency)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tickets */}
            <div className="border-b border-gray-100">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-gray-700">Tickets (0)</span>
                <span className="text-xs text-[#2563EB] cursor-pointer hover:underline">+ Add</span>
              </div>
              <div className="px-4 pb-4 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-2">
                  <Users className="w-5 h-5 text-gray-200" />
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">Track the customer requests associated with this record.</p>
              </div>
            </div>

            {/* Attachments */}
            <div className="border-b border-gray-100">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-gray-700">Attachments</span>
                <span className="text-xs text-[#2563EB] cursor-pointer hover:underline">Add ▼</span>
              </div>
              <div className="px-4 pb-4 flex flex-col items-center text-center">
                <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-2">
                  <Users className="w-5 h-5 text-gray-200" />
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">See the files attached to your activities or uploaded to this record.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      {companyFormModal}
      {showTaskModal && selected && (
        <CreateTaskModal
          crmCompanyId={selected.id}
          crmCompanyName={selected.name}
          onCreated={() => { /* task lives in project task board */ }}
          onClose={() => setShowTaskModal(false)}
        />
      )}
      {showNoteModal && selected && (
        <CreateNoteModal
          companyId={selected.id}
          companyName={selected.name}
          onCreated={note => {
            setSelected(s => s ? { ...s, activities: [note, ...(s.activities ?? [])] } : s);
            setShowNoteModal(false);
          }}
          onClose={() => setShowNoteModal(false)}
        />
      )}
      {showMeetingModal && selected && (
        <ScheduleMeetingModal
          companyId={selected.id}
          companyName={selected.name}
          companyEmail={selected.email}
          defaultAttendees={selected.contacts?.map(c => ({
            id: c.id, type: 'contact' as const,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            email: c.email,
          }))}
          onCreated={activity => {
            setSelected(s => s ? { ...s, activities: [activity, ...(s.activities ?? [])] } : s);
            setShowMeetingModal(false);
          }}
          onClose={() => setShowMeetingModal(false)}
        />
      )}
      {showAddContactModal && selected && (
        <AddContactToCompanyModal
          companyId={selected.id}
          companyName={selected.name}
          existingContactIds={(selected.contacts ?? []).map(c => c.id)}
          query={addContactQuery}
          setQuery={setAddContactQuery}
          results={addContactResults}
          setResults={setAddContactResults}
          searching={addContactSearching}
          setSearching={setAddContactSearching}
          saving={addContactSaving}
          setSaving={setAddContactSaving}
          onAdded={contact => {
            setSelected(s => s ? {
              ...s,
              contacts: [...(s.contacts ?? []), { id: contact.id, email: contact.email, first_name: contact.first_name, last_name: contact.last_name, phone: null, role: null, is_primary: false }],
              contact_count: (s.contact_count ?? 0) + 1,
            } : s);
          }}
          onClose={() => { setShowAddContactModal(false); setAddContactQuery(''); setAddContactResults([]); }}
        />
      )}
      </>
    );
  }

  // ── Full-width list view ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-3">
          {/* List tab switcher */}
          <div className="flex items-center gap-0 border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setListTab('all')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${listTab === 'all' ? 'bg-[#2563EB] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              Companies <span className={`ml-1 text-xs ${listTab === 'all' ? 'text-indigo-200' : 'text-gray-400'}`}>{listTab === 'all' ? total : ''}</span>
            </button>
            <button
              onClick={() => setListTab('mine')}
              className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${listTab === 'mine' ? 'bg-[#2563EB] text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              My Companies <span className={`ml-1 text-xs ${listTab === 'mine' ? 'text-indigo-200' : 'text-gray-400'}`}>{listTab === 'mine' ? total : ''}</span>
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {gmailConnected && (
              <button
                onClick={() => void triggerGmailSync()}
                disabled={isRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {isRunning ? 'Syncing…' : 'Sync Gmail'}
              </button>
            )}
            <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8] transition-colors">
              <Plus className="w-4 h-4" /> Add Company
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
            placeholder={listTab === 'mine' ? 'Search your companies…' : 'Search companies…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Gmail sync banner */}
      {gmailConnected && (isRunning || gmailSync?.status === 'error') && (
        <div className={`flex-shrink-0 border-b px-6 py-2.5 ${isRunning ? 'bg-indigo-50 border-indigo-100' : 'bg-red-50 border-red-100'}`}>
          {isRunning ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[#2563EB] animate-spin flex-shrink-0" />
              <div className="flex items-center gap-3 flex-1">
                <p className="text-sm font-medium text-gray-700">Scanning Gmail for companies…</p>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <div className="flex-1 h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#2563EB] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{pct}%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-red-600 font-medium">Sync failed — {gmailSync?.errorMessage || 'unknown error'}</p>
              <button onClick={() => void triggerGmailSync()} className="text-sm px-3 py-1 bg-red-500 text-white rounded-lg flex-shrink-0 hover:bg-red-600">Retry</button>
            </div>
          )}
        </div>
      )}

      {/* Table column headers */}
      <div className="flex-shrink-0 flex items-center px-6 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Name</div>
        <div className="w-36 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden md:block">Domain</div>
        <div className="w-28 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden lg:block">City</div>
        <div className="w-24 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Contacts</div>
        <div className="w-28 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right hidden lg:block">Pipeline</div>
      </div>

      {/* List body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <Building2 className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-gray-500 font-medium">
              {listTab === 'mine' ? 'No companies added yet' : 'No companies yet'}
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {listTab === 'mine'
                ? 'Click "Add Company" to create your first company'
                : 'Sync Gmail to auto-create companies from business email domains'
              }
            </p>
            <button onClick={openCreate} className="mt-4 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8]">Add Company</button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {companies.map(company => (
              <div
                key={company.id}
                onClick={() => openDetail(company)}
                className="flex items-center px-6 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors group"
              >
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <CompanyLogo name={company.name} domain={company.domain} size="w-8 h-8" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#2563EB] transition-colors">{company.name}</p>
                    {company.industry && <p className="text-xs text-gray-400 truncate">{company.industry}</p>}
                  </div>
                </div>
                <div className="w-36 hidden md:block">
                  {company.domain && <span className="text-xs text-gray-500 flex items-center gap-1"><Globe className="w-3 h-3 text-gray-300 flex-shrink-0" />{company.domain}</span>}
                </div>
                <div className="w-28 hidden lg:block">
                  <span className="text-xs text-gray-500">{company.city || '—'}</span>
                </div>
                <div className="w-24 text-right">
                  <span className="text-sm text-gray-700 font-medium">{company.contact_count}</span>
                </div>
                <div className="w-28 text-right hidden lg:block">
                  {company.open_deals_value > 0
                    ? <span className="text-sm font-medium text-emerald-600">{formatCurrency(company.open_deals_value)}</span>
                    : <span className="text-sm text-gray-300">—</span>
                  }
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {companies.length > 0 && (
        <div className="flex-shrink-0 px-6 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
          {total} {total === 1 ? 'company' : 'companies'} in view
        </div>
      )}

      {companyFormModal}
    </div>
  );
}
