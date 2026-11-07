import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet, Layers, Loader2, Sparkles, Upload, X } from 'lucide-react';
import {
  LIST_SOURCE_LABELS, LIST_SOURCE_TYPES, salesService,
  type ImportAnalysis, type ImportBlock, type ImportSummary, type ListSourceType,
} from '../../../services/salesService';

const BASE_TARGETS: Array<[string, string]> = [
  ['skip', "Don't import"],
  ['full_name', 'Full name'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
];

/** Same rule as the API's slugifyKey: [a-z_][a-z0-9_]{0,39}. */
function columnKey(header: string): string {
  const base = header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 38) || 'field';
  return /^[a-z_]/.test(base) ? base : `f_${base}`;
}

function targetOptions(column: { header: string; suggested: string }): Array<[string, string]> {
  const rounds: Array<[string, string]> = Array.from({ length: 8 }, (_, i) => [`round:${i + 1}`, `Follow-up round ${i + 1} (note)`]);
  const custom = column.suggested.startsWith('custom:')
    ? [[column.suggested, `Column "${column.header || column.suggested.slice(7)}"`] as [string, string]]
    : column.header ? [[`custom:${columnKey(column.header)}`, `Column "${column.header}"`] as [string, string]] : [];
  return [...BASE_TARGETS, ...rounds, ...custom];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reader.error ? reject(reader.error) : reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** How detected sections become lead lists. */
type Grouping = 'section' | 'sheet' | 'single';
const GROUPING_LABELS: Record<Grouping, string> = {
  section: 'One list per section',
  sheet: 'One list per worksheet',
  single: 'Everything in one list',
};

function guessSource(title: string): ListSourceType {
  return /facebook|fb|ads?\b/i.test(title) ? 'facebook_ads' : /masterclass|event|class|webinar/i.test(title) ? 'event' : 'import';
}

function groupKey(grouping: Grouping, b: ImportBlock): string {
  return grouping === 'section' ? `b:${b.index}` : grouping === 'sheet' ? `s:${b.sheet}` : 'all';
}

interface BlockPlan { include: boolean; mapping: Record<string, string> }
interface GroupPlan { name: string; sourceType: ListSourceType }

/**
 * Upload → the AI reads every worksheet and finds the lists of people in it
 * (falling back to pattern rules) → choose worksheets, how sections group
 * into lists, and each column's mapping → import. Nothing is stored until
 * "Import"; the sections found here are sent back so the import uses exactly
 * the rows that were shown.
 */
export default function ImportWizard({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [plans, setPlans] = useState<BlockPlan[]>([]);
  const [sheetOn, setSheetOn] = useState<Record<string, boolean>>({});
  const [grouping, setGrouping] = useState<Grouping>('section');
  const [groups, setGroups] = useState<Record<string, GroupPlan>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<false | 'reading' | 'ai' | 'importing'>(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const blocks = analysis?.blocks ?? [];
  const baseOf = (name: string | undefined) => (name ?? 'Imported leads').replace(/\.[^.]+$/, '');

  const defaultGroups = (g: Grouping, bs: ImportBlock[], fileName = file?.name): Record<string, GroupPlan> => {
    const out: Record<string, GroupPlan> = {};
    for (const b of bs) {
      const key = groupKey(g, b);
      if (out[key]) continue;
      const name = g === 'section' ? b.title : g === 'sheet' ? b.sheet : baseOf(fileName);
      out[key] = { name, sourceType: guessSource(name) };
    }
    return out;
  };

  const run = async (f: { name: string; base64: string }, opts: { ai: boolean; sheets?: string[] }) => {
    setBusy(opts.ai ? 'ai' : 'reading');
    setError(null);
    try {
      const res = await salesService.analyzeImport(f.base64, f.name, { useAi: opts.ai, sheets: opts.sheets });
      setFile(f);
      setAnalysis(res);
      setPlans(res.blocks.map((b) => ({ include: true, mapping: Object.fromEntries(b.columns.map((c) => [String(c.index), c.suggested])) })));
      setSheetOn(Object.fromEntries(res.sheets.map((s) => [s.name, s.selected])));
      // A workbook with one sheet of many sections usually means "keep them apart";
      // a workbook of many single-section sheets means "a list per sheet" — same result either way.
      setGroups(defaultGroups(grouping, res.blocks, f.name));
      setOpen({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { setError('That file is larger than 12 MB.'); return; }
    try {
      const base64 = await fileToBase64(f);
      await run({ name: f.name, base64 }, { ai: useAi });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const changeGrouping = (g: Grouping) => {
    setGrouping(g);
    setGroups(defaultGroups(g, blocks));
  };

  const setPlan = (i: number, p: Partial<BlockPlan>) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setGroup = (key: string, p: Partial<GroupPlan>) => setGroups((gs) => ({ ...gs, [key]: { ...gs[key], ...p } }));

  const included = (i: number) => Boolean(plans[i]?.include && sheetOn[blocks[i]?.sheet]);

  // Sections in display order, bucketed by the list they will land in.
  const grouped = useMemo(() => {
    const out: Array<{ key: string; items: Array<{ block: ImportBlock; i: number }> }> = [];
    blocks.forEach((block, i) => {
      if (!sheetOn[block.sheet]) return;
      const key = groupKey(grouping, block);
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, items: [] }; out.push(g); }
      g.items.push({ block, i });
    });
    return out;
  }, [blocks, sheetOn, grouping]);

  const commit = async () => {
    if (!file) return;
    const missing = blocks.findIndex((_, i) => included(i) && !Object.values(plans[i].mapping).some((t) => t === 'email' || t === 'phone'));
    if (missing >= 0) { setError(`"${blocks[missing].title}" needs an Email or Phone column.`); return; }
    const unnamed = grouped.find((g) => g.items.some(({ i }) => included(i)) && !groups[g.key]?.name.trim());
    if (unnamed) { setError('Every list needs a name.'); return; }
    setBusy('importing');
    setError(null);
    try {
      const res = await salesService.commitImport({
        fileBase64: file.base64, fileName: file.name,
        blocks: blocks.map((b, i) => {
          const g = groups[groupKey(grouping, b)] ?? { name: b.title, sourceType: 'import' as ListSourceType };
          return {
            index: b.index,
            include: included(i),
            listName: g.name,
            sourceType: g.sourceType,
            mapping: plans[i].mapping,
            sheet: b.sheet,
            rows: b.rows,
            headers: Object.fromEntries(b.columns.filter((c) => c.header).map((c) => [String(c.index), c.header])),
          };
        }),
      });
      setSummary(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setFile(null); setAnalysis(null); setPlans([]); setSheetOn({}); setGroups({}); setError(null); };
  const totalRows = blocks.reduce((s, b, i) => s + (included(i) ? b.rowCount : 0), 0);
  const listCount = grouped.filter((g) => g.items.some(({ i }) => included(i))).length;
  const checkedSheets = analysis?.sheets.filter((s) => sheetOn[s.name]).map((s) => s.name) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><FileSpreadsheet size={18} /> Import leads</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {summary ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                <span>
                  {summary.created} new lead{summary.created === 1 ? '' : 's'}, {summary.updated} updated, {summary.unchanged} already up to date,
                  {' '}{summary.activities} past follow-up note{summary.activities === 1 ? '' : 's'} added to timelines.
                  {summary.skipped > 0 && <> {summary.skipped} row{summary.skipped === 1 ? '' : 's'} skipped (no email or phone).</>}
                  {' '}Lists: {summary.lists.join(', ')}.
                </span>
              </div>
              {summary.phoneWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">{summary.phoneWarnings.length} phone number{summary.phoneWarnings.length === 1 ? '' : 's'} could not be saved</p>
                  <p className="mt-1 text-xs">The spreadsheet stored them as rounded numbers (e.g. 2.33241E+11), so the real digits are gone. Add them by hand, or re-export the sheet as .xlsx with the phone column formatted as text and import again — existing leads are only filled in, never overwritten.</p>
                  <ul className="mt-2 max-h-32 overflow-y-auto text-xs">
                    {summary.phoneWarnings.slice(0, 50).map((w) => <li key={`${w.list}-${w.row}`}>{w.name || '(no name)'} — {w.list}, row {w.row}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-slate-500">Imported notes are history only — the AI does not create reminders from them. Row colours are not imported; each lead's outcome is read from its notes where it's clear.</p>
            </div>
          ) : !analysis ? (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center hover:border-blue-400">
                {busy ? <Loader2 size={24} className="animate-spin text-slate-400" /> : <Upload size={24} className="text-slate-400" />}
                <span className="text-sm font-semibold text-slate-700">
                  {busy === 'ai' ? 'The AI is reading every worksheet…' : busy ? 'Reading the file…' : 'Choose an .xlsx or .csv file'}
                </span>
                <span className="text-xs text-slate-500">Every worksheet is read and each list of people in it is found. You choose how they group into lead lists before anything is saved.</span>
                <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" disabled={Boolean(busy)} onChange={(e) => void pick(e.target.files?.[0])} />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                <Sparkles size={14} className="text-violet-500" /> Let the AI find the lists and columns (slower, better with banners, titles and messy sheets)
              </label>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="font-semibold text-slate-800">{file?.name}</span>
                <span>— {blocks.length} section{blocks.length === 1 ? '' : 's'} on {analysis.sheets.length} worksheet{analysis.sheets.length === 1 ? '' : 's'}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${analysis.analyzedBy === 'ai' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                  {analysis.analyzedBy === 'ai' ? <><Sparkles size={12} /> Read by AI</> : 'Read by pattern rules'}
                </span>
              </div>
              {analysis.summary && <p className="rounded-xl bg-violet-50/60 px-3 py-2 text-xs text-violet-900">{analysis.summary}</p>}

              {/* Worksheets */}
              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Worksheets found</p>
                  <button type="button" disabled={Boolean(busy) || !checkedSheets.length}
                    onClick={() => file && void run(file, { ai: true, sheets: checkedSheets })}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-200 px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50">
                    {busy === 'ai' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {analysis.analyzedBy === 'ai' ? 'Re-read checked worksheets with AI' : 'Read checked worksheets with AI'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {analysis.sheets.map((s) => (
                    <label key={s.name} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${sheetOn[s.name] ? 'border-blue-200 bg-blue-50 text-slate-800' : 'border-slate-200 text-slate-400'}`}>
                      <input type="checkbox" checked={Boolean(sheetOn[s.name])} onChange={(e) => setSheetOn((m) => ({ ...m, [s.name]: e.target.checked }))} />
                      <span className="font-semibold">{s.name}</span>
                      <span>{s.rowCount} rows · {blocks.filter((b) => b.sheet === s.name).length} section{blocks.filter((b) => b.sheet === s.name).length === 1 ? '' : 's'}</span>
                    </label>
                  ))}
                </div>
                {analysis.sheets.some((s) => !s.selected) && (
                  <p className="mt-2 text-xs text-slate-400">Unread worksheets show 0 sections — check them and read again to include them.</p>
                )}
              </div>

              {/* Grouping */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Layers size={14} className="text-slate-500" />
                <span className="font-semibold text-slate-700">Group into lists:</span>
                {(Object.keys(GROUPING_LABELS) as Grouping[]).map((g) => (
                  <button key={g} type="button" onClick={() => changeGrouping(g)}
                    className={`rounded-lg border px-2 py-1 font-semibold ${grouping === g ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {GROUPING_LABELS[g]}
                  </button>
                ))}
              </div>

              {analysis.warnings.map((w) => (
                <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{w}</span>
                </div>
              ))}

              {grouped.map((g) => {
                const plan = groups[g.key] ?? { name: '', sourceType: 'import' as ListSourceType };
                const rows = g.items.reduce((s, { block, i }) => s + (included(i) ? block.rowCount : 0), 0);
                return (
                  <div key={g.key} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">List</span>
                      <input value={plan.name} onChange={(e) => setGroup(g.key, { name: e.target.value })}
                        className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold" aria-label="List name" />
                      <select value={plan.sourceType} onChange={(e) => setGroup(g.key, { sourceType: e.target.value as ListSourceType })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs" aria-label="Source">
                        {LIST_SOURCE_TYPES.map((s) => <option key={s} value={s}>{LIST_SOURCE_LABELS[s]}</option>)}
                      </select>
                      <span className="text-xs text-slate-400">{rows} row{rows === 1 ? '' : 's'}</span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {g.items.map(({ block: b, i }) => (
                        <div key={b.index} className={`rounded-xl border px-3 py-2 ${plans[i]?.include ? 'border-slate-100 bg-slate-50/60' : 'border-slate-100 opacity-60'}`}>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <input type="checkbox" checked={plans[i]?.include ?? false} onChange={(e) => setPlan(i, { include: e.target.checked })} aria-label="Include this section" />
                            <button type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} className="inline-flex items-center gap-1 font-semibold text-slate-700">
                              {open[i] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{b.title}
                            </button>
                            <span className="text-slate-400">{b.rowCount} row{b.rowCount === 1 ? '' : 's'} · {b.sheet}{b.rows.length ? ` · rows ${b.rows[0] + 1}–${b.rows[b.rows.length - 1] + 1}` : ''}</span>
                          </div>
                          {plans[i]?.include && open[i] && (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {b.columns.map((c) => (
                                <label key={c.index} className="flex items-center gap-2 text-xs">
                                  <span className="w-40 shrink-0 truncate" title={c.sample.join(' · ')}>
                                    <span className="font-semibold text-slate-700">{c.header || `Column ${c.index + 1}`}</span>
                                    {c.sample[0] && <span className="block truncate text-slate-400">{c.sample[0]}</span>}
                                  </span>
                                  <select value={plans[i].mapping[String(c.index)] ?? 'skip'}
                                    onChange={(e) => setPlan(i, { mapping: { ...plans[i].mapping, [String(c.index)]: e.target.value } })}
                                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
                                    {targetOptions(c).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {summary ? (
            <button type="button" onClick={onImported} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Done</button>
          ) : (
            <>
              {analysis && <button type="button" onClick={reset} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Choose another file</button>}
              <button type="button" onClick={() => void commit()} disabled={!analysis || Boolean(busy) || totalRows === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy === 'importing' && <Loader2 size={14} className="animate-spin" />}
                Import {totalRows ? `${totalRows} rows into ${listCount} list${listCount === 1 ? '' : 's'}` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
