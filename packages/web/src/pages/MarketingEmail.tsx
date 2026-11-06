import { useEffect, useState } from 'react';
import {
  BarChart2, CheckCircle, Clock, Loader2, Mail, MousePointerClick,
  Pencil, Plus, Send, Star, Trash2, TrendingUp, Users, X, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  mailingService,
  type CampaignAnalyticsRow,
  type MailingAutomation,
  type MailingCampaign,
  type MailingContact,
  type MailingSegment,
  type MailingAnalytics,
} from '../services/mailingService';
import EmailBuilder from '../components/email/EmailBuilder';

type Tab = 'emails' | 'automations' | 'analytics' | 'leads';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'emails',      label: 'Emails',      icon: Mail },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'analytics',   label: 'Analytics',   icon: BarChart2 },
  { id: 'leads',       label: 'Lead Scores', icon: Star },
];

const STATUS_COLORS: Record<string, { badge: string; dot: string; icon: string }> = {
  draft:     { badge: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-300',   icon: 'bg-slate-100' },
  scheduled: { badge: 'bg-amber-50 text-amber-700',    dot: 'bg-amber-400',   icon: 'bg-amber-50' },
  sent:      { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-400', icon: 'bg-emerald-50' },
  active:    { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-400', icon: 'bg-emerald-50' },
  paused:    { badge: 'bg-amber-50 text-amber-700',    dot: 'bg-amber-400',   icon: 'bg-amber-50' },
};

const TRIGGER_LABELS: Record<string, string> = {
  signup:         'New signup',
  unsubscribe:    'Unsubscribe',
  tag_added:      'Tag added',
  campaign_open:  'Email opened',
  campaign_click: 'Link clicked',
  date:           'Specific date',
};

function formatDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Emails Tab ───────────────────────────────────────────────────────────────

function EmailStatusIcon({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.icon}`}>
      {status === 'sent'      ? <CheckCircle size={18} className="text-emerald-500" /> :
       status === 'scheduled' ? <Clock       size={18} className="text-amber-500"   /> :
                                <Mail        size={18} className="text-slate-400"   />}
    </div>
  );
}

function EmailsTab() {
  const [emails, setEmails]     = useState<MailingCampaign[]>([]);
  const [segments, setSegments] = useState<MailingSegment[]>([]);
  const [loading, setLoading]   = useState(true);

  // Builder
  const [builderOpen, setBuilderOpen]         = useState(false);
  const [editingEmail, setEditingEmail]       = useState<MailingCampaign | null>(null);
  const [builderSubject, setBuilderSubject]   = useState('');
  const [builderPreview, setBuilderPreview]   = useState('');
  const [builderSegmentId, setBuilderSegmentId] = useState('');

  // UI state
  const [saving, setSaving]         = useState(false);
  const [sendingId, setSendingId]   = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [notification, setNotification] = useState<{ ok: boolean; msg: string } | null>(null);

  const notify = (ok: boolean, msg: string) => {
    setNotification({ ok, msg });
    setTimeout(() => setNotification(null), 4000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [e, s] = await Promise.all([mailingService.listCampaigns(), mailingService.listSegments()]);
      setEmails(e); setSegments(s);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openNew = () => {
    setEditingEmail(null);
    setBuilderSubject('');
    setBuilderPreview('');
    setBuilderSegmentId('');
    setBuilderOpen(true);
  };

  const openEdit = (email: MailingCampaign) => {
    setEditingEmail(email);
    setBuilderSubject(email.subject);
    setBuilderPreview(email.preview_text || '');
    setBuilderSegmentId(email.segment_id || '');
    setBuilderOpen(true);
  };

  const closeBuilder = () => { setBuilderOpen(false); setEditingEmail(null); };

  const handleSaveDraft = async (html: string) => {
    setSaving(true);
    try {
      const name = builderSubject.trim() || `Email — ${new Date().toLocaleDateString()}`;
      if (editingEmail) {
        await mailingService.updateCampaign(editingEmail.id, {
          name, subject: builderSubject,
          preview_text: builderPreview || undefined,
          segment_id: builderSegmentId || undefined,
          content: html,
        });
        notify(true, 'Draft saved.');
      } else {
        const created = await mailingService.createCampaign({
          name, subject: builderSubject,
          preview_text: builderPreview || undefined,
          segment_id: builderSegmentId || undefined,
          content: html,
        });
        setEditingEmail(created);
        notify(true, 'Draft saved.');
      }
      await load();
    } catch (err) {
      notify(false, err instanceof Error ? err.message : 'Failed to save.');
    } finally { setSaving(false); }
  };

  const handleSendFromBuilder = async (html: string) => {
    setSaving(true);
    try {
      const name = builderSubject.trim() || `Email — ${new Date().toLocaleDateString()}`;
      let id = editingEmail?.id;
      if (id) {
        await mailingService.updateCampaign(id, {
          name, subject: builderSubject,
          preview_text: builderPreview || undefined,
          segment_id: builderSegmentId || undefined,
          content: html,
        });
      } else {
        const created = await mailingService.createCampaign({
          name, subject: builderSubject,
          preview_text: builderPreview || undefined,
          segment_id: builderSegmentId || undefined,
          content: html,
        });
        id = created.id;
      }
      const result = await mailingService.sendCampaign(id!);
      closeBuilder();
      notify(true, result.queued ? `Sending to ${result.queued} contacts. Check campaign status for progress.` : `Sent to ${result.sent} contact${result.sent !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}.`);
      await load();
    } catch (err) {
      notify(false, err instanceof Error ? err.message : 'Failed to send.');
    } finally { setSaving(false); }
  };

  const handleSendNow = async (email: MailingCampaign) => {
    if (!confirm(`Send "${email.subject || 'this email'}" now to ${email.segment_name || 'all contacts'}?`)) return;
    setSendingId(email.id);
    try {
      const result = await mailingService.sendCampaign(email.id);
      notify(true, result.queued ? `Sending to ${result.queued} contacts. Check campaign status for progress.` : `Sent to ${result.sent} contact${result.sent !== 1 ? 's' : ''}.`);
      await load();
    } catch (err) {
      notify(false, err instanceof Error ? err.message : 'Send failed.');
    } finally { setSendingId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this email?')) return;
    try { await mailingService.deleteCampaign(id); await load(); } catch { }
  };

  const handleSchedule = async () => {
    if (!schedulingId || !scheduleDateTime) return;
    try {
      await mailingService.updateCampaign(schedulingId, { scheduled_at: new Date(scheduleDateTime).toISOString() });
      setSchedulingId(null); setScheduleDateTime('');
      notify(true, 'Email scheduled.');
      await load();
    } catch { }
  };

  const drafts    = emails.filter(e => e.status === 'draft');
  const scheduled = emails.filter(e => e.status === 'scheduled');
  const sent      = emails.filter(e => e.status === 'sent');

  return (
    <div className="space-y-5">
      {/* Builder full-screen */}
      {builderOpen && (
        <EmailBuilder
          subject={builderSubject}
          previewText={builderPreview}
          segmentId={builderSegmentId}
          segments={segments}
          onSubjectChange={setBuilderSubject}
          onPreviewTextChange={setBuilderPreview}
          onSegmentChange={setBuilderSegmentId}
          onSave={handleSaveDraft}
          onSend={handleSendFromBuilder}
          sending={saving}
          hasContacts={true}
          onClose={closeBuilder}
          initialHtml={editingEmail?.content || undefined}
        />
      )}

      {/* Schedule modal */}
      {schedulingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900">Schedule Email</h3>
              <button onClick={() => setSchedulingId(null)}><X size={16} className="text-slate-400" /></button>
            </div>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Send Date & Time</label>
            <input type="datetime-local" value={scheduleDateTime} onChange={e => setScheduleDateTime(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-400 mb-4" />
            {scheduleDateTime && <p className="text-xs text-amber-600 mb-4">Will send {formatDateTime(scheduleDateTime)}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSchedulingId(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button disabled={!scheduleDateTime} onClick={() => void handleSchedule()} className="rounded-xl bg-amber-500 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-amber-600">Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Notification toast */}
      {notification && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${notification.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {notification.ok ? <CheckCircle size={14} /> : <X size={14} />}
          {notification.msg}
          <button onClick={() => setNotification(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Stats bar + action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span>{emails.length} total</span>
          {drafts.length > 0    && <span className="text-slate-400">{drafts.length} draft{drafts.length !== 1 ? 's' : ''}</span>}
          {scheduled.length > 0 && <span className="text-amber-500">{scheduled.length} scheduled</span>}
          {sent.length > 0      && <span className="text-emerald-600">{sent.length} sent</span>}
        </div>
        <button
          data-tour-id="btn-new-email"
          onClick={openNew}
          className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus size={14} /> Compose Email
        </button>
      </div>

      {/* Email list */}
      {loading ? (
        <div className="flex justify-center py-16 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
      ) : emails.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 py-20 text-slate-400">
          <Mail size={36} className="mb-4 opacity-30" />
          <p className="text-base font-bold text-slate-700">No emails yet</p>
          <p className="mt-1 text-sm text-slate-500">Compose your first email and send it to your contacts.</p>
          <button onClick={openNew} className="mt-5 flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus size={14} /> Compose Email
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {emails.map((email, i) => {
            const c = STATUS_COLORS[email.status] ?? STATUS_COLORS.draft;
            const isLast = i === emails.length - 1;
            return (
              <div key={email.id} className={`group flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors ${isLast ? '' : 'border-b border-slate-100'}`}>
                <EmailStatusIcon status={email.status} />

                <div className="flex-1 min-w-0">
                  {/* Subject + badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900 truncate">
                      {email.subject || <em className="font-normal text-slate-400">No subject</em>}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.badge}`}>
                      {email.status}
                    </span>
                  </div>
                  {/* Meta line */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                    <span>To: {email.segment_name || 'All contacts'}</span>
                    {email.preview_text && (
                      <span className="hidden sm:inline truncate max-w-xs text-slate-300">"{email.preview_text}"</span>
                    )}
                    {email.status === 'sent' && email.sent_at && (
                      <span>Sent {formatDate(email.sent_at)}</span>
                    )}
                    {email.status === 'sent' && email.recipient_count > 0 && (
                      <span className="font-medium text-emerald-600">{email.recipient_count} delivered</span>
                    )}
                    {email.status === 'scheduled' && email.scheduled_at && (
                      <span className="font-medium text-amber-600">Scheduled {formatDateTime(email.scheduled_at)}</span>
                    )}
                    {email.status === 'draft' && (
                      <span>Last edited {formatDate(email.updated_at)}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {email.status !== 'sent' && (
                    <>
                      <button
                        onClick={() => openEdit(email)}
                        title="Edit in builder"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => { setSchedulingId(email.id); setScheduleDateTime(''); }}
                        title="Schedule"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                      >
                        <Clock size={13} />
                      </button>
                      <button
                        onClick={() => void handleSendNow(email)}
                        disabled={sendingId === email.id}
                        title="Send now"
                        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                      >
                        {sendingId === email.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <><Send size={12} /> Send</>}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => void handleDelete(email.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Automations Tab ──────────────────────────────────────────────────────────

function AutomationsTab() {
  const [automations, setAutomations] = useState<MailingAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'signup', email_subject: '', email_body: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setAutomations(await mailingService.listAutomations()); } catch { } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    if (!form.name || !form.email_subject) return;
    setSaving(true);
    try {
      await mailingService.createAutomation({
        name: form.name,
        trigger_type: form.trigger_type,
        actions: [{ subject: form.email_subject, content: form.email_body }],
      });
      setForm({ name: '', trigger_type: 'signup', email_subject: '', email_body: '' });
      setShowAdd(false); await load();
    } catch { } finally { setSaving(false); }
  };

  const handleToggle = async (a: MailingAutomation) => {
    const next = a.status === 'active' ? 'paused' : 'active';
    await mailingService.updateAutomation(a.id, { status: next }); await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this automation?')) return;
    await mailingService.deleteAutomation(id); await load();
  };

  const STATUS_BADGE_AUTO: Record<string, string> = {
    draft:  'bg-slate-100 text-slate-600',
    active: 'bg-emerald-50 text-emerald-700',
    paused: 'bg-amber-50 text-amber-700',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Automatically send emails when contacts take specific actions.</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus size={14} /> New Automation
        </button>
      </div>

      {/* Same table as the visual flow builder — point users at the richer tool */}
      <a
        href="/marketing/automations"
        className="flex items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-3.5 transition-colors hover:bg-indigo-100"
      >
        <div className="flex items-center gap-3">
          <Zap size={16} className="text-indigo-500 shrink-0" />
          <p className="text-sm text-indigo-900">
            <span className="font-bold">Need delays, branches, tags or SMS?</span>{' '}
            Build multi-step flows in the visual automation builder.
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold text-indigo-600">Open builder →</span>
      </a>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="text-sm font-bold">New Automation</span>
              <button onClick={() => setShowAdd(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Automation name *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Welcome Email" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Trigger</label>
                <select value={form.trigger_type} onChange={e => setForm(f => ({...f, trigger_type: e.target.value}))} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                  {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-semibold text-slate-500">Email to send</p>
                <input value={form.email_subject} onChange={e => setForm(f => ({...f, email_subject: e.target.value}))} placeholder="Subject line *" className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400 mb-2" />
                <textarea value={form.email_body} onChange={e => setForm(f => ({...f, email_body: e.target.value}))} placeholder="Email body (HTML or plain text)" rows={4} className="w-full resize-none rounded-xl border border-slate-200 px-4 py-2 text-sm outline-none focus:border-slate-400" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowAdd(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => void handleAdd()} disabled={saving || !form.name || !form.email_subject} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {loading ? (
          <div className="col-span-full flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : automations.length === 0 ? (
          <div className="col-span-full flex flex-col items-center py-16 text-slate-400">
            <Zap size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No automations yet</p>
          </div>
        ) : automations.map(a => {
          const stepCount = Array.isArray(a.steps) ? a.steps.filter((s: any) => s?.type !== 'trigger').length : 0;
          const isFlow = stepCount > 0;
          const firstSubject = Array.isArray(a.actions) ? (a.actions as { subject?: string }[])[0]?.subject : undefined;
          return (
          <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <span className="truncate">{a.name}</span>
                  {isFlow && <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black uppercase text-indigo-600">Flow</span>}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Trigger: {TRIGGER_LABELS[a.trigger_type] || a.trigger_type}</div>
                {isFlow ? (
                  <div className="text-xs text-slate-400 mt-0.5">{stepCount} step{stepCount === 1 ? '' : 's'} · edit in the visual builder</div>
                ) : firstSubject ? (
                  <div className="text-xs text-slate-400 mt-0.5 truncate">"{firstSubject}"</div>
                ) : null}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_AUTO[a.status] ?? 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <button onClick={() => void handleToggle(a)} className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {a.status === 'active' ? 'Pause' : 'Activate'}
              </button>
              {isFlow && (
                <a href="/marketing/automations" className="rounded-lg border border-indigo-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">Edit flow</a>
              )}
              <button onClick={() => void handleDelete(a.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<MailingAnalytics | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      mailingService.getAnalytics(),
      mailingService.getCampaignAnalytics(),
    ]).then(([summary, rows]) => { setData(summary); setCampaigns(rows); }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>;
  if (!data) return <div className="py-12 text-center text-sm text-slate-400">Failed to load analytics.</div>;

  const kpis = [
    { label: 'Total Contacts',  value: data.contacts.total.toLocaleString(),        sub: `${data.contacts.subscribed} subscribed`, icon: <Users size={16} className="text-slate-400" /> },
    { label: 'Unsubscribed',    value: data.contacts.unsubscribed.toLocaleString(),  sub: 'all time', icon: <X size={16} className="text-slate-400" /> },
    { label: 'Emails Sent',     value: data.campaigns.sent.toLocaleString(),         sub: `${data.campaigns.draft} drafts`, icon: <Send size={16} className="text-slate-400" /> },
    { label: 'Open Rate',       value: `${data.rates.openRate}%`,                    sub: 'of delivered', icon: <Mail size={16} className="text-[#2563EB]" /> },
    { label: 'Click Rate',      value: `${data.rates.clickRate}%`,                   sub: 'of delivered', icon: <MousePointerClick size={16} className="text-emerald-500" /> },
    { label: 'Bounce Rate',     value: `${data.rates.bounceRate}%`,                  sub: 'of delivered', icon: <TrendingUp size={16} className="text-red-400" /> },
  ];

  const chartData = campaigns.slice(0, 10).reverse().map(c => ({
    name: c.name.length > 18 ? c.name.slice(0, 16) + '…' : c.name,
    Opens: c.opens,
    Clicks: c.clicks,
    Delivered: c.delivered,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-5 flex items-start gap-3">
            <div className="mt-1">{k.icon}</div>
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{k.label}</div>
              <div className="mt-1.5 text-3xl font-black text-slate-950">{k.value}</div>
              <div className="mt-0.5 text-xs text-slate-400">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-bold text-slate-900">Opens &amp; Clicks by Campaign</div>
          <p className="mb-4 text-xs text-slate-400">Last {chartData.length} sent campaigns</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Delivered" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Opens" fill="#2563EB" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Clicks" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-bold text-slate-900">Campaign Performance</h3>
            <p className="mt-0.5 text-xs text-slate-400">Detailed stats for each sent campaign.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 text-left">Campaign</th>
                  <th className="px-4 py-3 text-right">Delivered</th>
                  <th className="px-4 py-3 text-right">Opens</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Unsubs</th>
                  <th className="px-4 py-3 text-right">Open %</th>
                  <th className="px-4 py-3 text-right">Click %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map(c => (
                  <tr key={c.campaign_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900 truncate max-w-[200px]">{c.name}</div>
                      <div className="text-[11px] text-slate-400">{c.sent_at ? new Date(c.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{c.delivered.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#2563EB] font-semibold">{c.opens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600 font-semibold">{c.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">{c.unsubscribes.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-[#2563EB]">{c.open_rate}%</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">{c.click_rate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {campaigns.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <BarChart2 size={32} className="mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-semibold text-slate-500">No sent campaigns yet</p>
          <p className="mt-1 text-xs text-slate-400">Send your first email to start tracking opens, clicks, and unsubscribes.</p>
        </div>
      )}
    </div>
  );
}

// ─── Lead Scores Tab ──────────────────────────────────────────────────────────

function LeadsTab() {
  const [contacts, setContacts] = useState<MailingContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    mailingService.listContacts()
      .then(all => {
        const sorted = [...all].sort((a, b) => {
          const sa = parseInt((a.custom_data as Record<string, string>)?.lead_score || '0', 10);
          const sb = parseInt((b.custom_data as Record<string, string>)?.lead_score || '0', 10);
          return sb - sa;
        });
        setContacts(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const withScore = contacts.filter(c => parseInt(c.custom_data?.lead_score || '0', 10) > 0);
  const maxScore = withScore.length > 0 ? parseInt((withScore[0].custom_data as Record<string, string>)?.lead_score || '1', 10) : 1;

  const getTier = (score: number) => {
    if (score >= 80) return { label: 'Hot',  color: 'text-red-600 bg-red-50',   bar: 'bg-red-400' };
    if (score >= 50) return { label: 'Warm', color: 'text-amber-600 bg-amber-50', bar: 'bg-amber-400' };
    if (score >= 20) return { label: 'Cool', color: 'text-blue-600 bg-blue-50',  bar: 'bg-blue-400' };
    return             { label: 'Cold', color: 'text-slate-500 bg-slate-100', bar: 'bg-slate-300' };
  };

  const avgScore = withScore.length > 0
    ? Math.round(withScore.reduce((sum, c) => sum + parseInt(c.custom_data?.lead_score || '0', 10), 0) / withScore.length)
    : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Scored Leads',   value: withScore.length, sub: `of ${contacts.length} total contacts`, icon: <TrendingUp size={16} /> },
          { label: 'Hot Leads (80+)', value: withScore.filter(c => parseInt(c.custom_data?.lead_score || '0', 10) >= 80).length, sub: 'ready to convert', icon: <Star size={16} className="text-red-500" /> },
          { label: 'Avg Lead Score', value: avgScore, sub: 'across scored contacts', icon: <Users size={16} /> },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-5 flex items-start gap-3">
            <div className="mt-0.5 text-slate-400">{k.icon}</div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className="mt-1 text-3xl font-black text-slate-950">{k.value}</div>
              <div className="mt-0.5 text-xs text-slate-400">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">Lead Score Leaderboard</h3>
          <p className="text-xs text-slate-500 mt-0.5">Contacts ranked by engagement score.</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : withScore.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <Star size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No lead scores yet</p>
            <p className="mt-1 text-xs text-center max-w-xs">Use "Score Lead" in Automations to assign points when contacts engage.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-xs font-semibold text-slate-500">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Tags</th>
                <th className="px-4 py-3 text-left">Tier</th>
                <th className="px-4 py-3 text-left w-48">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {withScore.map((c, i) => {
                const score = parseInt(c.custom_data?.lead_score || '0', 10);
                const pct   = Math.round((score / maxScore) * 100);
                const tier  = getTier(score);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{c.first_name || c.last_name ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : c.email}</div>
                      {(c.first_name || c.last_name) && <div className="text-xs text-slate-400">{c.email}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags ?? []).slice(0, 3).map(t => (
                          <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{t}</span>
                        ))}
                        {(c.tags ?? []).length > 3 && <span className="text-[10px] text-slate-400">+{(c.tags ?? []).length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tier.color}`}>{tier.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${tier.bar} transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-slate-700 w-8 text-right">{score}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarketingEmail() {
  const [tab, setTab] = useState<Tab>('emails');

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Email</h1>
        <p className="mt-2 text-base text-slate-500">Compose, send and track emails to your contacts.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              tab === id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'emails'      && <EmailsTab />}
        {tab === 'automations' && <AutomationsTab />}
        {tab === 'analytics'   && <AnalyticsTab />}
        {tab === 'leads'       && <LeadsTab />}
      </div>
    </div>
  );
}
