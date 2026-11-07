import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock, AlertTriangle, Columns, FolderPlus, Inbox, Layers, Loader2, Pencil, Plus, Search, Sparkles,
  Trash2, Upload, UserPlus, Users, X,
} from 'lucide-react';
import {
  LEAD_STAGES, LIST_SOURCE_LABELS, LIST_SOURCE_TYPES, RESPONSE_STATUSES, RESPONSE_STATUS_META, salesService,
  type LeadField, type LeadList, type ListSourceType, type WorkspaceLead,
} from '../services/salesService';
import LeadGrid, { type GroupBy } from '../components/sales/leads/LeadGrid';
import LeadDrawer from '../components/sales/leads/LeadDrawer';
import ColumnManager from '../components/sales/leads/ColumnManager';
import ImportWizard from '../components/sales/leads/ImportWizard';
import { useLeadParam } from '../components/sales/leads/useLeadParam';

type View =
  | { kind: 'all' }
  | { kind: 'list'; id: string }
  | { kind: 'smart'; id: 'today' | 'overdue' | 'needs_confirmation' | 'never' };

const SMART_VIEWS = [
  { id: 'today', label: 'Due today', icon: AlarmClock },
  { id: 'overdue', label: 'Overdue', icon: AlertTriangle },
  { id: 'needs_confirmation', label: 'Confirm AI reminders', icon: Sparkles },
  { id: 'never', label: 'Never contacted', icon: Inbox },
] as const;

const PAGE = 100;

function NewListForm({ onCreated, onCancel }: { onCreated: (l: LeadList) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<ListSourceType>('manual');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) return;
    try { onCreated(await salesService.createLeadList({ name: name.trim(), source_type: source })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  };
  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-2">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder="List name, e.g. July Facebook ads" className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
      <select value={source} onChange={(e) => setSource(e.target.value as ListSourceType)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs">
        {LIST_SOURCE_TYPES.map((s) => <option key={s} value={s}>{LIST_SOURCE_LABELS[s]}</option>)}
      </select>
      <div className="flex gap-2">
        <button type="button" onClick={() => void submit()} className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">Create</button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500">Cancel</button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function AddLeadForm({ lists, defaultListId, onCreated, onCancel }: {
  lists: LeadList[]; defaultListId: string | null; onCreated: () => void; onCancel: () => void;
}) {
  const [d, setD] = useState({ first_name: '', last_name: '', phone: '', email: '' });
  const [listId, setListId] = useState(defaultListId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!d.phone.trim() && !d.email.trim()) { setError('Add a phone number or an email'); return; }
    setSaving(true);
    try {
      await salesService.createWorkspaceLead({ ...d, list_ids: listId ? [listId] : [] });
      onCreated();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to add lead'); }
    finally { setSaving(false); }
  };
  return (
    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-6">
      {(['first_name', 'last_name', 'phone', 'email'] as const).map((k) => (
        <input key={k} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })}
          placeholder={{ first_name: 'First name', last_name: 'Last name', phone: 'Phone', email: 'Email' }[k]}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
      ))}
      <select value={listId} onChange={(e) => setListId(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
        <option value="">No list</option>
        {lists.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add</button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-500">Cancel</button>
      </div>
      {error && <p className="text-xs text-rose-600 sm:col-span-6">{error}</p>}
    </div>
  );
}

export default function SalesLeadWorkspace() {
  // ?list=<id> opens that list (used by the AI Agent's "Create call list").
  const [view, setView] = useState<View>(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('list');
      return id ? { kind: 'list', id } as View : { kind: 'all' };
    } catch { return { kind: 'all' }; }
  });
  const [lists, setLists] = useState<LeadList[]>([]);
  const [fields, setFields] = useState<LeadField[]>([]);
  const [leads, setLeads] = useState<WorkspaceLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('recent');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useLeadParam();
  const [showColumns, setShowColumns] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newList, setNewList] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [l, f] = await Promise.all([salesService.listLeadLists(), salesService.getLeadFields()]);
      setLists(l);
      setFields(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lists');
    }
  }, []);

  const query = useMemo(() => ({
    listId: view.kind === 'list' ? view.id : undefined,
    due: view.kind === 'smart' && view.id !== 'never' ? view.id : undefined,
    neverContacted: view.kind === 'smart' && view.id === 'never',
    search: search.trim() || undefined,
    stage: stage || undefined,
    responseStatus: status || undefined,
    sort,
  }), [view, search, stage, status, sort]);

  const load = useCallback(async (append = false) => {
    setLoading(true);
    try {
      setError(null);
      const res = await salesService.listWorkspaceLeads({ ...query, limit: PAGE, offset: append ? leads.length : 0 });
      setLeads(append ? [...leads, ...res.leads] : res.leads);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => { void loadMeta(); void salesService.ensureReminderTimezone(); }, [loadMeta]);
  useEffect(() => {
    const t = setTimeout(() => void load(false), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => { setSelected(new Set()); }, [query]);

  const refresh = () => { void load(false); void loadMeta(); };

  const saveCell = async (lead: WorkspaceLead, patch: Record<string, unknown>) => {
    try {
      const updated = await salesService.updateWorkspaceLead(lead.contact_id, patch);
      setLeads((rows) => rows.map((r) => (r.contact_id === updated.contact_id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      throw err;
    }
  };

  const bulk = async (action: 'set_stage' | 'add_to_list' | 'remove_from_list' | 'delete', value?: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete' && !window.confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'} permanently, with all their activity and reminders? This cannot be undone.`)) return;
    try {
      await salesService.bulkLeads(ids, action, value ?? null);
      setSelected(new Set());
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk action failed');
    }
  };

  const activeList = view.kind === 'list' ? lists.find((l) => l.id === view.id) : null;
  const title = view.kind === 'all' ? 'All leads'
    : view.kind === 'list' ? activeList?.name ?? 'List'
    : SMART_VIEWS.find((s) => s.id === view.id)?.label ?? '';

  const renameList = async (id: string, name: string) => {
    try { await salesService.updateLeadList(id, { name }); setRenaming(null); void loadMeta(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to rename'); }
  };
  const removeList = async (l: LeadList) => {
    if (!window.confirm(`Delete the list "${l.name}"? The leads in it are kept.`)) return;
    try { await salesService.deleteLeadList(l.id); setView({ kind: 'all' }); void loadMeta(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to delete list'); }
  };

  const railBtn = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="flex min-h-full flex-col gap-5 p-6 lg:flex-row">
      {/* Left rail */}
      <nav className="w-full shrink-0 space-y-4 lg:w-60" aria-label="Lead views">
        <div className="space-y-0.5">
          <button type="button" className={railBtn(view.kind === 'all')} onClick={() => setView({ kind: 'all' })}>
            <Users size={15} /> All leads
          </button>
          {SMART_VIEWS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={railBtn(view.kind === 'smart' && view.id === id)} onClick={() => setView({ kind: 'smart', id })}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between px-2.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Lists</span>
            <button type="button" onClick={() => setNewList(true)} title="New list" className="text-slate-400 hover:text-blue-600"><FolderPlus size={15} /></button>
          </div>
          {newList && <NewListForm onCreated={(l) => { setNewList(false); void loadMeta(); setView({ kind: 'list', id: l.id }); }} onCancel={() => setNewList(false)} />}
          <div className="space-y-0.5">
            {lists.filter((l) => !l.archived_at).map((l) => (
              <div key={l.id} className="group relative">
                {renaming === l.id ? (
                  <input autoFocus defaultValue={l.name} onBlur={(e) => void renameList(l.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void renameList(l.id, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null); }}
                    className="w-full rounded-lg border border-blue-300 px-2 py-1 text-sm" />
                ) : (
                  <button type="button" className={railBtn(view.kind === 'list' && view.id === l.id)} onClick={() => setView({ kind: 'list', id: l.id })}>
                    <Layers size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="text-xs text-slate-400 group-hover:hidden">{l.lead_count}</span>
                  </button>
                )}
                {renaming !== l.id && (
                  <span className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                    <button type="button" onClick={() => setRenaming(l.id)} title="Rename" className="text-slate-400 hover:text-slate-700"><Pencil size={13} /></button>
                    <button type="button" onClick={() => void removeList(l)} title="Delete list" className="text-slate-400 hover:text-rose-500"><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
            ))}
            {lists.length === 0 && !newList && <p className="px-2.5 text-xs text-slate-400">Group leads by where they came from — a Facebook campaign, an event, a company.</p>}
          </div>
        </div>
      </nav>

      {/* Main */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {total} lead{total === 1 ? '' : 's'}
              {activeList && <> · {LIST_SOURCE_LABELS[activeList.source_type]}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowImport(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Upload size={14} /> Import
            </button>
            <button type="button" onClick={() => setShowColumns(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Columns size={14} /> Columns
            </button>
            <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
              <UserPlus size={14} /> Add lead
            </button>
          </div>
        </div>

        {adding && (
          <AddLeadForm lists={lists} defaultListId={view.kind === 'list' ? view.id : null}
            onCreated={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone"
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value="">Any outcome</option>
            {RESPONSE_STATUSES.map((s) => <option key={s} value={s}>{RESPONSE_STATUS_META[s].label}</option>)}
            <option value="none">No outcome yet</option>
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value="">Any stage</option>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" aria-label="Group by">
            <option value="none">No grouping</option>
            <option value="list">Group by list</option>
            <option value="status">Group by outcome</option>
            <option value="stage">Group by stage</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" aria-label="Sort">
            <option value="recent">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="next_followup">Next follow-up</option>
            <option value="last_contacted">Last contacted</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-semibold text-blue-800">{selected.size} selected</span>
            <select defaultValue="" onChange={(e) => { if (e.target.value) void bulk('add_to_list', e.target.value); e.target.value = ''; }}
              className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs">
              <option value="">Add to list…</option>
              {lists.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {activeList && (
              <button type="button" onClick={() => void bulk('remove_from_list', activeList.id)} className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                Remove from this list
              </button>
            )}
            <select defaultValue="" onChange={(e) => { if (e.target.value) void bulk('set_stage', e.target.value); e.target.value = ''; }}
              className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs">
              <option value="">Set stage…</option>
              {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={() => void bulk('delete')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">
              <Trash2 size={12} /> Delete
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-blue-700"><X size={14} /></button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
          </div>
        )}

        {!loading && leads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Users className="mx-auto mb-2 text-slate-300" size={28} />
            <p className="text-sm text-slate-500">
              {view.kind === 'smart' ? 'Nothing here right now.' : 'No leads yet. Import your spreadsheet or add a lead.'}
            </p>
            {view.kind !== 'smart' && (
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" onClick={() => setShowImport(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"><Upload size={14} /> Import</button>
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white"><Plus size={14} /> Add lead</button>
              </div>
            )}
          </div>
        ) : (
          <LeadGrid
            leads={leads} fields={fields} selected={selected} groupBy={groupBy}
            onToggle={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onToggleAll={(ids, on) => setSelected(on ? new Set(ids) : new Set())}
            onOpen={(id) => setOpenLead(id)}
            onSave={saveCell}
          />
        )}

        <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
          {loading && <Loader2 size={16} className="animate-spin" />}
          {!loading && leads.length < total && (
            <button type="button" onClick={() => void load(true)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">
              Load more ({total - leads.length} left)
            </button>
          )}
        </div>
      </div>

      {openLead && (
        <LeadDrawer contactId={openLead} fields={fields} lists={lists}
          onClose={() => setOpenLead(null)} onChanged={() => void load(false)} />
      )}
      <ColumnManager open={showColumns} fields={fields} onClose={() => setShowColumns(false)} onSaved={(f) => { setFields(f); void load(false); }} />
      {showImport && (
        <ImportWizard onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); refresh(); }} />
      )}
    </div>
  );
}
