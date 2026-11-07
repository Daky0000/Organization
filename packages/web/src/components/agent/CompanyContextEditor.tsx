import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Eye, EyeOff, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import {
  agentService, CONTEXT_KIND_LABELS, CONTEXT_KINDS,
  type ContextData, type ContextInput, type ContextItem, type ContextKind,
} from '../../services/agentService';

const DATED: ContextKind[] = ['event', 'program'];
const TARGETED: ContextKind[] = ['event', 'program', 'offering'];

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const joinList = (a?: string[]) => (a ?? []).join(', ');

function fmtDates(d: ContextData): string {
  if (!d.start_date) return '';
  const f = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return d.end_date && d.end_date !== d.start_date ? `${f(d.start_date)} – ${f(d.end_date)}` : f(d.start_date);
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const input = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none';

function ItemForm({ initial, onCancel, onSave }: {
  initial: ContextInput;
  onCancel: () => void;
  onSave: (v: ContextInput) => Promise<void>;
}) {
  const [v, setV] = useState<ContextInput>(initial);
  const [roles, setRoles] = useState(joinList(initial.data?.target_roles));
  const [industries, setIndustries] = useState(joinList(initial.data?.target_industries));
  const [keywords, setKeywords] = useState(joinList(initial.data?.keywords));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = v.data ?? {};
  const setData = (patch: Partial<ContextData>) => setV((x) => ({ ...x, data: { ...(x.data ?? {}), ...patch } }));
  const blank = (s: string) => (s.trim() ? s : null);

  const submit = async () => {
    if (!v.title.trim()) { setError('Give it a title'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...v,
        title: v.title.trim(),
        data: {
          ...d,
          target_roles: splitList(roles),
          target_industries: splitList(industries),
          keywords: splitList(keywords),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Type">
          <select className={input} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as ContextKind })}>
            {CONTEXT_KINDS.map((k) => <option key={k} value={k}>{CONTEXT_KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Title">
          <input className={input} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
      </div>
      <Field label="Summary" hint="One or two sentences. The agent reads this first.">
        <textarea className={input} rows={2} value={v.summary ?? ''} onChange={(e) => setV({ ...v, summary: e.target.value })} />
      </Field>
      <Field label="Details" hint="Everything the agent should know: agenda, outcomes, selling points, objections, links.">
        <textarea className={`${input} font-mono text-[13px]`} rows={10} value={v.body ?? ''} onChange={(e) => setV({ ...v, body: e.target.value })} />
      </Field>

      {DATED.includes(v.kind) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Start date"><input type="date" className={input} value={d.start_date ?? ''} onChange={(e) => setData({ start_date: blank(e.target.value) })} /></Field>
          <Field label="End date"><input type="date" className={input} value={d.end_date ?? ''} onChange={(e) => setData({ end_date: blank(e.target.value) })} /></Field>
          <Field label="Booking closes"><input type="date" className={input} value={d.booking_deadline ?? ''} onChange={(e) => setData({ booking_deadline: blank(e.target.value) })} /></Field>
          <Field label="Time"><input className={input} value={d.time ?? ''} onChange={(e) => setData({ time: blank(e.target.value) })} /></Field>
          <Field label="Venue"><input className={input} value={d.venue ?? ''} onChange={(e) => setData({ venue: blank(e.target.value) })} /></Field>
          <Field label="Format"><input className={input} value={d.format ?? ''} placeholder="in person / online" onChange={(e) => setData({ format: blank(e.target.value) })} /></Field>
          <Field label="Price"><input className={input} value={d.price ?? ''} onChange={(e) => setData({ price: blank(e.target.value) })} /></Field>
          <Field label="Early bird"><input className={input} value={d.early_bird ?? ''} onChange={(e) => setData({ early_bird: blank(e.target.value) })} /></Field>
          <Field label="Capacity">
            <input type="number" min={0} className={input} value={d.capacity ?? ''}
              onChange={(e) => setData({ capacity: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
        </div>
      )}
      {TARGETED.includes(v.kind) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who should attend / buy (roles)" hint="Comma separated. Used to find leads to call.">
            <input className={input} value={roles} onChange={(e) => setRoles(e.target.value)} />
          </Field>
          <Field label="Target industries" hint="Comma separated.">
            <input className={input} value={industries} onChange={(e) => setIndustries(e.target.value)} />
          </Field>
          <Field label="Matching keywords" hint="Words in a lead's job title, company or notes that make them a fit.">
            <input className={input} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </Field>
          <Field label="Link"><input className={input} value={d.url ?? ''} onChange={(e) => setData({ url: blank(e.target.value) })} /></Field>
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
      </div>
    </div>
  );
}

export default function CompanyContextEditor() {
  const [items, setItems] = useState<ContextItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // item id or 'new'
  const [filter, setFilter] = useState<ContextKind | 'all'>('all');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setError(null); setItems(await agentService.listContext()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const grouped = useMemo(() => {
    const g = new Map<ContextKind, ContextItem[]>();
    for (const i of items ?? []) {
      if (filter !== 'all' && i.kind !== filter) continue;
      g.set(i.kind, [...(g.get(i.kind) ?? []), i]);
    }
    return CONTEXT_KINDS.filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const);
  }, [items, filter]);

  const save = async (id: string, v: ContextInput) => {
    const item = id === 'new' ? await agentService.createContext(v) : await agentService.updateContext(id, v);
    setItems((xs) => (id === 'new' ? [...(xs ?? []), item] : (xs ?? []).map((x) => (x.id === id ? item : x))));
    setEditing(null);
  };

  const remove = async (i: ContextItem) => {
    if (!window.confirm(`Delete "${i.title}"? The agent will stop using it.`)) return;
    try { await agentService.deleteContext(i.id); setItems((xs) => (xs ?? []).filter((x) => x.id !== i.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete'); }
  };

  const toggle = async (i: ContextItem) => {
    try { const item = await agentService.updateContext(i.id, { active: !i.active }); setItems((xs) => (xs ?? []).map((x) => (x.id === i.id ? item : x))); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update'); }
  };

  const restore = async () => {
    try {
      const r = await agentService.restoreContextDefaults();
      setItems(r.items);
      setNotice(r.added ? `Restored ${r.added} default item${r.added === 1 ? '' : 's'}.` : 'All defaults are already there.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not restore'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Company context</h2>
          <p className="text-sm text-slate-500">Everything the agent knows about the business. It reads this on every task — keep events, prices and dates current.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void restore()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <RotateCcw size={14} /> Restore defaults
          </button>
          <button type="button" onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
            <Plus size={14} /> Add item
          </button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
      {notice && <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}<button type="button" onClick={() => setNotice(null)}><X size={14} /></button></div>}

      <div className="flex gap-1 overflow-x-auto">
        {(['all', ...CONTEXT_KINDS] as const).filter((k) => k === 'all' || (items ?? []).some((i) => i.kind === k)).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${filter === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {k === 'all' ? 'All' : CONTEXT_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {editing === 'new' && (
        <ItemForm initial={{ kind: filter === 'all' ? 'event' : filter, title: '', summary: '', body: '', data: {} }}
          onCancel={() => setEditing(null)} onSave={(v) => save('new', v)} />
      )}

      {!items && !error && <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}
      {items && items.length === 0 && editing !== 'new' && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No company context yet. Add your overview, offerings and upcoming events so the agent can advise and target leads.
        </p>
      )}

      {grouped.map(([kind, list]) => (
        <section key={kind} className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{CONTEXT_KIND_LABELS[kind]}</h3>
          {list.map((i) => editing === i.id ? (
            <ItemForm key={i.id} initial={i} onCancel={() => setEditing(null)} onSave={(v) => save(i.id, v)} />
          ) : (
            <article key={i.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${i.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-slate-900">{i.title}</h4>
                  {(i.data.start_date || i.data.price) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {i.data.start_date && <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{fmtDates(i.data)}</span>}
                      {i.data.price && <span>{i.data.price}{i.data.early_bird ? ` · early bird ${i.data.early_bird}` : ''}</span>}
                      {i.kind === 'event' && (i.data.end_date || i.data.start_date || '') < today && <span className="rounded bg-slate-100 px-1.5 text-slate-500">past — ignored by the agent</span>}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => void toggle(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title={i.active ? 'Hide from the agent' : 'Show to the agent'}>
                    {i.active ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button type="button" onClick={() => setEditing(i.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="Edit"><Pencil size={15} /></button>
                  <button type="button" onClick={() => void remove(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete"><Trash2 size={15} /></button>
                </div>
              </div>
              {i.summary && <p className="mt-1.5 text-sm text-slate-700">{i.summary}</p>}
              {i.body && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs font-semibold text-blue-600">Details</summary>
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-600">{i.body}</p>
                </details>
              )}
              {((i.data.target_roles?.length ?? 0) > 0 || (i.data.target_industries?.length ?? 0) > 0) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...(i.data.target_roles ?? []).slice(0, 8), ...(i.data.target_industries ?? []).slice(0, 6)].map((t) => (
                    <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
