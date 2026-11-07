import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Trash2, X } from 'lucide-react';
import { FIELD_TYPES, FIELD_TYPE_LABELS, salesService, type FieldType, type LeadField } from '../../../services/salesService';

interface Draft {
  key: string | null;
  label: string;
  type: FieldType;
  options: string;
  builtin: boolean;
  hidden: boolean;
  width: number | null;
  uid: string;
}

const toDraft = (f: LeadField): Draft => ({
  key: f.key, label: f.label, type: f.type, options: (f.options ?? []).join(', '),
  builtin: f.builtin, hidden: f.hidden, width: f.width, uid: f.key,
});

/**
 * "Edit columns" — reordering, renaming, hiding and adding are edited together
 * and saved in one go, so the table never passes through half-applied states.
 *
 * Opened on all leads it edits every column, and removing a custom column
 * deletes its values from every lead. Opened on a list (`list` set) it edits
 * that list's columns: `fields` is what the list shows, `allFields` the full
 * set to add existing columns from, new columns belong to the list, and
 * removing one only takes it off the list.
 */
export default function ColumnManager({
  open, fields, allFields, list, onClose, onSaved,
}: {
  open: boolean;
  fields: LeadField[];
  allFields?: LeadField[];
  list?: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: (fields: LeadField[], listKeys?: string[]) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setDrafts(fields.map(toDraft)); setError(null); } }, [open, fields]);
  if (!open) return null;

  const addable = list
    ? (allFields ?? []).filter((f) => !f.builtin && !drafts.some((d) => d.key === f.key))
    : [];

  const patch = (i: number, p: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) => setDrafts((d) => {
    const j = i + dir;
    if (j < 0 || j >= d.length) return d;
    const next = [...d];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const removedCustom = fields.filter((f) => !f.builtin && !drafts.some((d) => d.key === f.key));

  const save = async () => {
    if (!list && removedCustom.length && !window.confirm(`Delete ${removedCustom.map((f) => `"${f.label}"`).join(', ')} and the values stored in it for every lead?`)) return;
    setSaving(true);
    setError(null);
    try {
      const payload = drafts.map((d) => ({
        key: d.key, label: d.label.trim(), type: d.type, hidden: d.hidden, width: d.width,
        options: d.type === 'select' ? d.options.split(',').map((o) => o.trim()).filter(Boolean) : null,
      }));
      if (list) {
        const res = await salesService.saveListFields(list.id, payload);
        onSaved(res.fields, res.keys);
      } else {
        onSaved(await salesService.saveLeadFields(payload));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save columns');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{list ? `Columns in "${list.name}"` : 'Edit columns'}</h2>
            {list && <p className="text-xs text-slate-500">Removing a column takes it off this list only. Its values are kept.</p>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {drafts.map((d, i) => (
            <div key={d.uid} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${d.hidden ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200'}`}>
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} className="text-slate-400 hover:text-slate-700" aria-label="Move up"><ArrowUp size={12} /></button>
                <button type="button" onClick={() => move(i, 1)} className="text-slate-400 hover:text-slate-700" aria-label="Move down"><ArrowDown size={12} /></button>
              </div>
              {d.builtin ? (
                <span className="min-w-[10rem] flex-1 text-sm font-semibold text-slate-700">{d.label} <span className="text-xs font-normal text-slate-400">built-in</span></span>
              ) : (
                <>
                  <input value={d.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Column name"
                    className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
                  <select value={d.type} onChange={(e) => patch(i, { type: e.target.value as FieldType })}
                    disabled={!!d.key}
                    title={d.key ? 'The type of an existing column cannot change — add a new column instead' : undefined}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-sm disabled:bg-slate-50">
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
                  </select>
                </>
              )}
              <button type="button" onClick={() => patch(i, { hidden: !d.hidden })} className="text-slate-400 hover:text-slate-700" title={d.hidden ? 'Show' : 'Hide'}>
                {d.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              {!d.builtin && (
                <button type="button" onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-500" title={list ? 'Remove from this list' : 'Delete column'}>
                  <Trash2 size={15} />
                </button>
              )}
              {!d.builtin && d.type === 'select' && (
                <input value={d.options} onChange={(e) => patch(i, { options: e.target.value })} placeholder="Choices, separated by commas (e.g. Auditor, Banker, Accountant)"
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs" />
              )}
            </div>
          ))}
          <button type="button"
            onClick={() => setDrafts((d) => [...d, { key: null, label: '', type: 'text', options: '', builtin: false, hidden: false, width: null, uid: `new-${Date.now()}` }])}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-700">
            <Plus size={14} /> {list ? 'New column' : 'Add column'}
          </button>
          {addable.length > 0 && (
            <select value="" onChange={(e) => {
              const f = addable.find((x) => x.key === e.target.value);
              if (f) setDrafts((d) => [...d, toDraft(f)]);
            }}
              className="ml-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600">
              <option value="">Add an existing column…</option>
              {addable.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <p className="text-xs text-rose-600">{error}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving && <Loader2 size={14} className="animate-spin" />} Save columns
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
