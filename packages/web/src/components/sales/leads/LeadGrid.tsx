import { useState } from 'react';
import { AlarmClock, Sparkles } from 'lucide-react';
import {
  LEAD_STAGES, STAGE_COLORS, formatInZone,
  type LeadField, type WorkspaceLead,
} from '../../../services/salesService';
import { StatusChip } from './ActivityTimeline';

export function fullName(lead: Pick<WorkspaceLead, 'first_name' | 'last_name' | 'email' | 'phone'>): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || lead.email || lead.phone || 'Unnamed lead';
}

/** Built-in columns users may type over directly in the grid. */
const INLINE_BUILTINS = new Set(['email', 'phone', 'stage']);

export function isInlineEditable(field: LeadField): boolean {
  return field.builtin ? INLINE_BUILTINS.has(field.key) : true;
}

function rawValue(lead: WorkspaceLead, field: LeadField): unknown {
  if (!field.builtin) return lead.custom_data?.[field.key];
  if (field.key === 'email') return lead.email;
  if (field.key === 'phone') return lead.phone;
  if (field.key === 'stage') return lead.stage;
  return null;
}

function Empty() {
  return <span className="text-slate-300">—</span>;
}

function relativeDay(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function LeadCell({ lead, field }: { lead: WorkspaceLead; field: LeadField }) {
  if (field.builtin) {
    switch (field.key) {
      case 'name':
        return <span className="font-semibold text-slate-900">{fullName(lead)}</span>;
      case 'stage': {
        const s = lead.stage ?? 'new';
        return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STAGE_COLORS[s] ?? STAGE_COLORS.new}`}>{s}</span>;
      }
      case 'lists':
        return lead.lists.length ? (
          <span className="flex flex-wrap gap-1">
            {lead.lists.map((l) => (
              <span key={l.id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{l.name}</span>
            ))}
          </span>
        ) : <Empty />;
      case 'last_status':
        return lead.last_response_status ? <StatusChip status={lead.last_response_status} /> : <Empty />;
      case 'last_contacted': {
        const at = lead.last_activity_at ?? lead.last_contacted_at;
        return at ? <span className="whitespace-nowrap text-xs text-slate-500">{relativeDay(at)}</span> : <Empty />;
      }
      case 'next_followup':
        if (!lead.next_followup_at) return <Empty />;
        return (
          <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${new Date(lead.next_followup_at).getTime() < Date.now() ? 'text-rose-600' : 'text-slate-700'}`}>
            {lead.next_followup_needs_confirmation ? <Sparkles size={11} className="text-amber-500" /> : <AlarmClock size={11} />}
            {formatInZone(lead.next_followup_at)}
          </span>
        );
      default:
        break;
    }
  }

  const value = rawValue(lead, field);
  if (value === null || value === undefined || value === '') return <Empty />;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  switch (field.type) {
    case 'email':
      return <a href={`mailto:${value}`} onClick={stop} className="text-blue-600 hover:underline">{String(value)}</a>;
    case 'phone':
      return <a href={`tel:${String(value).replace(/\s/g, '')}`} onClick={stop} className="whitespace-nowrap text-blue-600 hover:underline">{String(value)}</a>;
    case 'url':
      return <a href={String(value)} target="_blank" rel="noreferrer" onClick={stop} className="text-blue-600 hover:underline">{String(value).replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>;
    case 'currency':
      return <span className="whitespace-nowrap tabular-nums">{Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    case 'number':
      return <span className="tabular-nums">{Number(value).toLocaleString()}</span>;
    case 'date':
      return <span className="whitespace-nowrap text-xs">{new Date(`${String(value)}T00:00:00`).toLocaleDateString()}</span>;
    case 'boolean':
      return <span>{value === true ? 'Yes' : 'No'}</span>;
    case 'long_text':
      return <span className="block max-w-[22rem] truncate text-slate-600" title={String(value)}>{String(value)}</span>;
    case 'select':
      return <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

export function editableText(lead: WorkspaceLead, field: LeadField): string {
  const v = rawValue(lead, field);
  if (v === null || v === undefined) return '';
  if (field.key === 'stage' && field.builtin) return String(v || 'new');
  return String(v);
}

export function CellEditor({
  field, value, onChange, onCommit, onCancel,
}: {
  field: LeadField; value: string;
  onChange: (v: string) => void; onCommit: () => void; onCancel: () => void;
}) {
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && field.type !== 'long_text') { e.preventDefault(); onCommit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };
  const cls = 'w-full min-w-[7rem] rounded-md border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-200';

  if (field.builtin && field.key === 'stage') {
    return (
      <select autoFocus value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={keys} className={cls}>
        {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  }
  if (field.type === 'select' || field.type === 'boolean') {
    const options = field.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : (field.options ?? []).map((o) => [o, o]);
    return (
      <select autoFocus value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={keys} className={cls}>
        <option value="">—</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  if (field.type === 'long_text') {
    return <textarea autoFocus rows={3} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={keys} className={cls} />;
  }
  const type = field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'currency' ? 'number' : field.type === 'email' ? 'email' : 'text';
  return <input autoFocus type={type} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onKeyDown={keys} className={cls} />;
}

/** Turns an edited cell into the PATCH body for /workspace/leads/:id. */
export function cellPatch(field: LeadField, raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (field.builtin) return { [field.key]: text || null };
  let value: unknown = text === '' ? null : text;
  if (text !== '' && (field.type === 'number' || field.type === 'currency')) value = Number(text);
  if (text !== '' && field.type === 'boolean') value = text === 'true';
  return { custom_data: { [field.key]: value } };
}

export type GroupBy = 'none' | 'list' | 'status' | 'stage';

function groupLeads(leads: WorkspaceLead[], by: GroupBy): Array<{ key: string; label: string; leads: WorkspaceLead[] }> {
  if (by === 'none') return [{ key: 'all', label: '', leads }];
  const groups = new Map<string, { key: string; label: string; leads: WorkspaceLead[] }>();
  const put = (key: string, label: string, lead: WorkspaceLead) => {
    if (!groups.has(key)) groups.set(key, { key, label, leads: [] });
    groups.get(key)!.leads.push(lead);
  };
  for (const lead of leads) {
    if (by === 'list') {
      if (!lead.lists.length) put('_none', 'Not in a list', lead);
      for (const l of lead.lists) put(l.id, l.name, lead);
    } else if (by === 'status') {
      put(lead.last_response_status ?? '_none', lead.last_response_status ? lead.last_response_status.replace(/_/g, ' ') : 'No outcome yet', lead);
    } else {
      put(lead.stage ?? 'new', lead.stage ?? 'new', lead);
    }
  }
  return [...groups.values()];
}

export default function LeadGrid({
  leads, fields, selected, onToggle, onToggleAll, onOpen, onSave, groupBy,
}: {
  leads: WorkspaceLead[];
  fields: LeadField[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], on: boolean) => void;
  onOpen: (id: string) => void;
  onSave: (lead: WorkspaceLead, patch: Record<string, unknown>) => Promise<void>;
  groupBy: GroupBy;
}) {
  const visible = fields.filter((f) => !f.hidden);
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const allIds = leads.map((l) => l.contact_id);
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const startEdit = (lead: WorkspaceLead, field: LeadField) => {
    if (!isInlineEditable(field)) return onOpen(lead.contact_id);
    setEditing({ id: lead.contact_id, key: field.key });
    setDraft(editableText(lead, field));
  };

  const commit = async (lead: WorkspaceLead, field: LeadField) => {
    if (saving) return;
    const before = editableText(lead, field);
    if (draft === before) { setEditing(null); return; }
    setSaving(true);
    try { await onSave(lead, cellPatch(field, draft)); setEditing(null); }
    finally { setSaving(false); }
  };

  const groups = groupLeads(leads, groupBy);

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-10 px-3 py-2.5">
              <input type="checkbox" aria-label="Select all" checked={allOn} onChange={(e) => onToggleAll(allIds, e.target.checked)} />
            </th>
            {visible.map((f) => (
              <th key={f.key} className="whitespace-nowrap px-3 py-2.5" style={f.width ? { minWidth: f.width } : undefined}>{f.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.key} label={g.label} count={g.leads.length} colSpan={visible.length + 1}>
              {g.leads.map((lead) => (
                <tr key={`${g.key}:${lead.contact_id}`}
                  className={`border-t border-slate-100 hover:bg-slate-50/70 ${selected.has(lead.contact_id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${fullName(lead)}`} checked={selected.has(lead.contact_id)} onChange={() => onToggle(lead.contact_id)} />
                  </td>
                  {visible.map((f) => {
                    const isEditing = editing?.id === lead.contact_id && editing.key === f.key;
                    return (
                      <td key={f.key}
                        className={`px-3 py-2 align-middle ${f.key === 'name' ? 'cursor-pointer' : isInlineEditable(f) ? 'cursor-text' : 'cursor-pointer'}`}
                        onClick={() => (f.key === 'name' || !isInlineEditable(f) ? onOpen(lead.contact_id) : undefined)}
                        onDoubleClick={() => startEdit(lead, f)}
                        title={isInlineEditable(f) ? 'Double-click to edit' : undefined}>
                        {isEditing ? (
                          <CellEditor field={f} value={draft} onChange={setDraft}
                            onCommit={() => void commit(lead, f)} onCancel={() => setEditing(null)} />
                        ) : (
                          <LeadCell lead={lead} field={f} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ label, count, colSpan, children }: { label: string; count: number; colSpan: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!label) return <>{children}</>;
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/80">
        <td colSpan={colSpan} className="px-3 py-1.5">
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-bold capitalize text-slate-600">
            {open ? '▾' : '▸'} {label} <span className="font-normal text-slate-400">({count})</span>
          </button>
        </td>
      </tr>
      {open && children}
    </>
  );
}
