import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import {
  LIST_SOURCE_LABELS, LIST_SOURCE_TYPES, salesService,
  type ImportBlock, type ImportSummary, type ListSourceType,
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
    ? [[column.suggested, `Column "${column.header}"`] as [string, string]]
    : column.header ? [[`custom:${columnKey(column.header)}`, `Column "${column.header}"`] as [string, string]] : [];
  return [...BASE_TARGETS, ...rounds, ...custom];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

interface BlockPlan { include: boolean; listName: string; sourceType: ListSourceType; mapping: Record<string, string> }

/**
 * Upload → see the lists found in the sheet → check each column's mapping
 * (note columns become follow-up rounds) → import. Nothing is stored until
 * "Import" — the file is re-read on commit.
 */
export default function ImportWizard({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [blocks, setBlocks] = useState<ImportBlock[]>([]);
  const [plans, setPlans] = useState<BlockPlan[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { setError('That file is larger than 12 MB.'); return; }
    setBusy(true);
    setError(null);
    try {
      const base64 = await fileToBase64(f);
      const res = await salesService.analyzeImport(base64, f.name);
      setFile({ name: f.name, base64 });
      setBlocks(res.blocks);
      setWarnings(res.warnings);
      setPlans(res.blocks.map((b) => ({
        include: true,
        listName: b.title,
        sourceType: /facebook|fb|ads?\b/i.test(b.title) ? 'facebook_ads' : /masterclass|event|class|webinar/i.test(b.title) ? 'event' : 'import',
        mapping: Object.fromEntries(b.columns.map((c) => [String(c.index), c.suggested])),
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const setPlan = (i: number, p: Partial<BlockPlan>) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const commit = async () => {
    if (!file) return;
    const missing = plans.findIndex((p) => p.include && !Object.values(p.mapping).some((t) => t === 'email' || t === 'phone'));
    if (missing >= 0) { setError(`"${plans[missing].listName}" needs an Email or Phone column.`); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await salesService.commitImport({
        fileBase64: file.base64, fileName: file.name,
        blocks: plans.map((p, i) => ({ index: blocks[i].index, ...p })),
      });
      setSummary(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const totalRows = blocks.reduce((s, b, i) => s + (plans[i]?.include ? b.rowCount : 0), 0);

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
          ) : !file ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center hover:border-blue-400">
              {busy ? <Loader2 size={24} className="animate-spin text-slate-400" /> : <Upload size={24} className="text-slate-400" />}
              <span className="text-sm font-semibold text-slate-700">Choose an .xlsx or .csv file</span>
              <span className="text-xs text-slate-500">Each titled section of the sheet becomes a list. Note and follow-up columns become each lead's activity history.</span>
              <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
          ) : (
            <>
              <p className="text-sm text-slate-600"><span className="font-semibold">{file.name}</span> — {blocks.length} section{blocks.length === 1 ? '' : 's'} found. Check each one, then import.</p>
              {warnings.map((w) => (
                <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{w}</span>
                </div>
              ))}
              {blocks.map((b, i) => (
                <div key={b.index} className={`rounded-2xl border p-4 ${plans[i]?.include ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={plans[i]?.include ?? false} onChange={(e) => setPlan(i, { include: e.target.checked })} aria-label="Include this section" />
                    <input value={plans[i]?.listName ?? ''} onChange={(e) => setPlan(i, { listName: e.target.value })}
                      className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold" aria-label="List name" />
                    <select value={plans[i]?.sourceType} onChange={(e) => setPlan(i, { sourceType: e.target.value as ListSourceType })}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs" aria-label="Source">
                      {LIST_SOURCE_TYPES.map((s) => <option key={s} value={s}>{LIST_SOURCE_LABELS[s]}</option>)}
                    </select>
                    <span className="text-xs text-slate-400">{b.rowCount} row{b.rowCount === 1 ? '' : 's'} · {b.sheet}</span>
                  </div>
                  {plans[i]?.include && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {b.columns.map((c) => (
                        <label key={c.index} className="flex items-center gap-2 text-xs">
                          <span className="w-40 shrink-0 truncate" title={c.sample.join(' · ')}>
                            <span className="font-semibold text-slate-700">{c.header || `Column ${c.index + 1}`}</span>
                            {c.sample[0] && <span className="block truncate text-slate-400">{c.sample[0]}</span>}
                          </span>
                          <select value={plans[i].mapping[String(c.index)] ?? 'skip'}
                            onChange={(e) => setPlan(i, { mapping: { ...plans[i].mapping, [String(c.index)]: e.target.value } })}
                            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1">
                            {targetOptions(c).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {summary ? (
            <button type="button" onClick={onImported} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Done</button>
          ) : (
            <>
              {file && <button type="button" onClick={() => { setFile(null); setBlocks([]); setPlans([]); setWarnings([]); }} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Choose another file</button>}
              <button type="button" onClick={() => void commit()} disabled={!file || busy || totalRows === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy && <Loader2 size={14} className="animate-spin" />} Import {totalRows ? `${totalRows} rows` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
