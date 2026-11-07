import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Phone, Plus, X } from 'lucide-react';
import {
  LEAD_STAGES, salesService,
  type LeadField, type LeadList, type WorkspaceLead,
} from '../../../services/salesService';
import ActivityTimeline from './ActivityTimeline';
import { CellEditor, LeadCell, cellPatch, editableText, fullName } from './LeadGrid';

function FieldRow({ lead, field, onSave }: { lead: WorkspaceLead; field: LeadField; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = async () => {
    if (draft !== editableText(lead, field)) await onSave(cellPatch(field, draft));
    setEditing(false);
  };
  return (
    <div className="grid grid-cols-[8.5rem_1fr] items-start gap-2 py-1.5 text-sm">
      <span className="pt-1 text-xs font-semibold text-slate-500">{field.label}</span>
      {editing ? (
        <CellEditor field={field} value={draft} onChange={setDraft} onCommit={() => void commit()} onCancel={() => setEditing(false)} />
      ) : (
        <button type="button" onClick={() => { setDraft(editableText(lead, field)); setEditing(true); }}
          className="min-h-[1.75rem] rounded-md px-1 text-left hover:bg-slate-50">
          <LeadCell lead={lead} field={field} />
        </button>
      )}
    </div>
  );
}

export default function LeadDrawer({
  contactId, fields, lists, onClose, onChanged,
}: {
  contactId: string;
  fields: LeadField[];
  lists: LeadList[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lead, setLead] = useState<WorkspaceLead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<{ first: string; last: string } | null>(null);
  const [addingList, setAddingList] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLead(await salesService.getWorkspaceLead(contactId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead');
    }
  }, [contactId]);

  useEffect(() => { setLead(null); void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      setError(null);
      setLead(await salesService.updateWorkspaceLead(contactId, patch));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const toggleList = async (listId: string, on: boolean) => {
    try {
      await salesService.changeListMembers(listId, on ? { add: [contactId] } : { remove: [contactId] });
      setAddingList(false);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update lists');
    }
  };

  const editable = fields.filter((f) => !f.builtin || ['email', 'phone', 'stage'].includes(f.key));
  const otherLists = lists.filter((l) => !l.archived_at && !lead?.lists.some((x) => x.id === l.id));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <aside className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          {lead ? (
            <div className="min-w-0">
              {nameDraft ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input autoFocus value={nameDraft.first} onChange={(e) => setNameDraft({ ...nameDraft, first: e.target.value })} placeholder="First name"
                    className="w-36 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
                  <input value={nameDraft.last} onChange={(e) => setNameDraft({ ...nameDraft, last: e.target.value })} placeholder="Last name"
                    className="w-36 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
                  <button type="button" className="text-sm font-semibold text-blue-600"
                    onClick={() => { void save({ first_name: nameDraft.first, last_name: nameDraft.last }); setNameDraft(null); }}>Save</button>
                  <button type="button" className="text-sm text-slate-500" onClick={() => setNameDraft(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" title="Edit name" onClick={() => setNameDraft({ first: lead.first_name ?? '', last: lead.last_name ?? '' })}
                  className="truncate text-left text-xl font-black tracking-tight text-slate-950 hover:text-blue-700">
                  {fullName(lead)}
                </button>
              )}
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                {lead.phone && <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 hover:text-blue-600"><Phone size={12} />{lead.phone}</a>}
                {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 hover:text-blue-600"><Mail size={12} />{lead.email}</a>}
              </div>
            </div>
          ) : <Loader2 size={18} className="animate-spin text-slate-400" />}
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        {error && <p className="mx-5 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        {lead && (
          <div className="space-y-4 p-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {lead.lists.map((l) => (
                  <span key={l.id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {l.name}
                    <button type="button" onClick={() => void toggleList(l.id, false)} aria-label={`Remove from ${l.name}`} className="text-slate-400 hover:text-rose-500"><X size={11} /></button>
                  </span>
                ))}
                {addingList ? (
                  <select autoFocus defaultValue="" onBlur={() => setAddingList(false)}
                    onChange={(e) => e.target.value && void toggleList(e.target.value, true)}
                    className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs">
                    <option value="" disabled>Add to list…</option>
                    {otherLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                ) : otherLists.length > 0 && (
                  <button type="button" onClick={() => setAddingList(true)} className="inline-flex items-center gap-0.5 text-xs font-semibold text-blue-600">
                    <Plus size={12} /> List
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-50">
                {editable.map((f) => <FieldRow key={f.key} lead={lead} field={f} onSave={save} />)}
              </div>
              {!editable.some((f) => !f.builtin) && (
                <p className="mt-2 text-xs text-slate-400">Add your own columns (role, company, amount paid…) with "Columns" on the leads page.</p>
              )}
              <p className="mt-2 text-[11px] text-slate-400">Stage: {LEAD_STAGES.includes(lead.stage as any) ? lead.stage : 'new'} · added {new Date(lead.created_at).toLocaleDateString()}</p>
            </section>

            <ActivityTimeline contactId={contactId} onChanged={() => { void load(); onChanged(); }} />
          </div>
        )}
      </aside>
    </div>
  );
}
