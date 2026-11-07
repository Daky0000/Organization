// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet import for the Sales lead workspace.
//
// Built for how sales teams actually keep leads: one sheet, several blocks
// ("Finance class – 1st list", "NEW LIST – July ads", "CEO MASTERCLASS"), each
// block a name / email / phone table followed by note columns per follow-up
// round ("NOTES", "1st Follow up", "SECOND FOLLOW UP (15th May)").
//
//   analyze → blocks, each with a suggested mapping per column
//   commit  → the same file + the user's mapping. Stateless: the file is parsed
//             again, so nothing is stored between the two steps.
//
// Rules: emails are normalised (lower/trim); existing leads are matched on
// email then phone and only EMPTY fields are filled; each note cell becomes an
// activity with an import_hash so re-importing adds nothing; phone numbers that
// a spreadsheet already turned into "2.33241E+11" are reported, never saved.
// The AI reader does not run on imported history.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { parseWorkbook, SpreadsheetError, type SheetGrid } from '../leads/services/spreadsheet.ts';
import { ActivityError, type ResponseStatus } from './leadActivities.ts';
import { findOrCreateLeadList, slugifyKey, type ListSourceType } from './leadWorkspace.ts';
import { analyzeSheetsWithAI, NoSheetAnalystError } from './sheetAnalyst.ts';
import { logger } from '../../logger.ts';

export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

export type ColumnTarget =
  | 'full_name' | 'first_name' | 'last_name' | 'email' | 'phone' | 'skip'
  | `custom:${string}` | `round:${number}`;

export interface ImportColumn { index: number; header: string; sample: string[]; suggested: ColumnTarget }
export interface ImportBlock {
  index: number;
  sheet: string;
  title: string;
  headerRow: number | null;   // 0-based row in the sheet, null when headers were inherited
  rows: number[];             // 0-based data rows
  columns: ImportColumn[];
}

// ── Cell classification ─────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCI_RE = /^\d(\.\d+)?e\+?\d+$/i;

export function isEmailLike(v: string): boolean { return EMAIL_RE.test(v.trim()); }
export function isScientificPhone(v: string): boolean { return SCI_RE.test(v.trim()); }
export function isPhoneLike(v: string): boolean {
  const s = v.trim();
  if (isScientificPhone(s)) return true;
  const digits = s.replace(/\D/g, '');
  return /^\+?[\d\s\-().]+$/.test(s) && digits.length >= 7 && digits.length <= 15;
}

export type PhoneResult = { ok: true; value: string } | { ok: false; reason: 'scientific' | 'invalid' } | { ok: true; value: null };

/** Normalises a phone cell. Scientific notation has lost digits for good. */
export function normalizePhone(raw: string): PhoneResult {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  if (isScientificPhone(s)) return { ok: false, reason: 'scientific' };
  if (!isPhoneLike(s)) return { ok: false, reason: 'invalid' };
  const digits = s.replace(/\D/g, '');
  // An international number saved without its "+" (e.g. 233241234567).
  if (!s.startsWith('+') && !s.startsWith('0') && digits.length >= 11) return { ok: true, value: `+${digits}` };
  return { ok: true, value: s };
}

const HEADER_WORDS = /\b(name|e-?mail|phone|contact|mobile|tel|telephone|number|notes?|follow|remarks?|comments?|feedback|role|company|organi[sz]ation|title|status)\b/i;
const NOTE_HEADER = /\b(notes?|follow|remarks?|comments?|feedback|call\s*log|response)\b/i;

function nonEmpty(row: string[]): string[] { return row.filter((c) => c.trim()); }

function isDataRow(row: string[]): boolean {
  return row.some((c) => isEmailLike(c) || (isPhoneLike(c) && c.replace(/\D/g, '').length >= 9));
}

function isHeaderRow(row: string[]): boolean {
  const cells = nonEmpty(row);
  if (cells.length < 2 || isDataRow(row)) return false;
  return cells.filter((c) => HEADER_WORDS.test(c) && c.length <= 60).length >= 2
    || cells.some((c) => /^e-?mail$/i.test(c.trim()));
}

function isTitleRow(row: string[]): boolean {
  const cells = nonEmpty(row);
  return cells.length === 1 && !isDataRow(row) && cells[0].length <= 80;
}

const SECTION_WORDS = /\b(list|class|masterclass|cohort|ads?|event|webinar|group|campaign|leads?|batch|training|course|new)\b/i;

/** "Zaney Bonsu" — a lead with no contact details, not a section title. */
export function looksLikePersonName(text: string): boolean {
  const s = text.trim();
  if (SECTION_WORDS.test(s) || s === s.toUpperCase()) return false;
  const words = s.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[\p{Lu}][\p{L}.'\-]*$/u.test(w));
}

// ── Block detection ─────────────────────────────────────────────────────────

/**
 * Splits sheets into blocks. A header row starts a block; a single-cell title
 * row starts a new block that inherits the previous headers ("NEW LIST" in the
 * middle of the same table). Data rows are those carrying an email or phone.
 */
export function detectBlocks(grids: SheetGrid[]): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  for (const grid of grids) {
    let headers: string[] | null = null;
    let pendingTitle: string[] = [];
    let current: Omit<ImportBlock, 'columns' | 'index'> & { headers: string[] } | null = null;

    const close = () => {
      if (current && current.rows.length) {
        blocks.push({ ...current, index: blocks.length, columns: [] } as ImportBlock & { headers: string[] });
      }
      current = null;
    };

    grid.rows.forEach((row, r) => {
      if (!nonEmpty(row).length) return;
      if (isHeaderRow(row)) {
        close();
        headers = row.map((c) => c.trim());
        // A header cell in the name column that is not a header word is usually the block's title ("Finance comprehensive").
        const titleish = headers.find((h) => h && !HEADER_WORDS.test(h));
        const title = [...pendingTitle, titleish].filter(Boolean).join(' – ');
        current = { sheet: grid.name, title, headerRow: r, rows: [], headers };
        pendingTitle = [];
        return;
      }
      if (current && isTitleRow(row) && row[0]?.trim() && looksLikePersonName(row[0])) {
        // Kept so the import summary can report it as skipped (no email or phone).
        (current as any).rows.push(r);
        return;
      }
      if (isTitleRow(row) && !isDataRow(row)) {
        if (current && (current as any).rows.length) {
          close();
        }
        pendingTitle.push(nonEmpty(row)[0].trim());
        return;
      }
      if (!isDataRow(row)) {
        // Multi-cell non-data rows before the first header (e.g. "isaac | CONTACT") are context for the title.
        if (!headers) pendingTitle.push(nonEmpty(row).join(' '));
        return;
      }
      if (!current) {
        const inherited: string[] = headers ?? row.map((_, i) => `Column ${i + 1}`);
        current = { sheet: grid.name, title: pendingTitle.join(' – '), headerRow: null, rows: [], headers: inherited };
        pendingTitle = [];
      }
      (current as any).rows.push(r);
    });
    close();
  }

  // Columns + suggestions
  return blocks.map((b, i) => {
    const grid = grids.find((g) => g.name === b.sheet)!;
    const headers = (b as any).headers as string[];
    let round = 0;
    const columns: ImportColumn[] = headers.map((header, index) => {
      const values = b.rows.map((r) => grid.rows[r]?.[index] ?? '').filter((v) => v.trim());
      const sample = values.slice(0, 3);
      return { index, header, sample, suggested: suggestTarget(header, values, index) };
    }).filter((c) => c.header || c.sample.length);
    // Note columns become rounds 1, 2, 3 … in left-to-right order.
    for (const c of columns) if (c.suggested === 'round:0') c.suggested = `round:${++round}`;
    // Only one column per contact target.
    const seen = new Set<string>();
    for (const c of columns) {
      if (['full_name', 'first_name', 'last_name', 'email', 'phone'].includes(c.suggested)) {
        if (seen.has(c.suggested)) c.suggested = 'skip';
        seen.add(c.suggested);
      }
    }
    return {
      index: i, sheet: b.sheet, title: b.title || `${b.sheet} – block ${i + 1}`,
      headerRow: b.headerRow, rows: b.rows, columns,
    };
  });
}

function suggestTarget(header: string, values: string[], index: number): ColumnTarget {
  const h = header.toLowerCase();
  const share = (fn: (v: string) => boolean) => (values.length ? values.filter(fn).length / values.length : 0);
  if (share(isEmailLike) > 0.6 || /^e-?mail/.test(h)) return 'email';
  if (share(isPhoneLike) > 0.6 || /\b(phone|mobile|tel|contact|number)\b/.test(h)) {
    if (share(isPhoneLike) > 0.3 || !values.length) return 'phone';
  }
  if (/\bfirst\b/.test(h)) return 'first_name';
  if (/\b(last|surname)\b/.test(h)) return 'last_name';
  if (NOTE_HEADER.test(h)) return 'round:0';
  if (/\bname\b/.test(h) || (index === 0 && share((v) => /^[\p{L}][\p{L}.'\- ]+$/u.test(v)) > 0.6)) return 'full_name';
  if (!header.trim()) {
    // An unlabelled column of sentences is most likely notes.
    return share((v) => v.split(/\s+/).length >= 3) > 0.5 ? 'round:0' : 'skip';
  }
  return `custom:${slugifyKey(header)}`;
}

// ── Response status from note text ──────────────────────────────────────────

/** Conservative keyword mapping from a note to an outcome. Null when unsure. */
export function inferResponseStatus(note: string): ResponseStatus | null {
  const n = note.toLowerCase();
  // A partial payment counts as paid: the lead has converted.
  if (/\bpaid\b|made (a )?payment/.test(n) && !/not paid|has(n'?t| not) paid/.test(n)) return 'paid';
  if (/\bregist(e)?red\b/.test(n)) return 'registered';
  if (/not interested|not really interested/.test(n)) return 'not_interested';
  if (/unreachable|not reachable|cannot be reached|switched off|invalid|wrong number/.test(n)) return 'unreachable';
  if (/did not (answer|pick|respond)|didn'?t (answer|pick)|no (answer|response)|number busy|not available|unavailable/.test(n)) return 'no_answer';
  if (/call (me |him |her )?back|will revert|get back to me|follow up|call tomorrow/.test(n)) return 'call_back';
  if (/\binterested\b/.test(n)) return 'interested';
  return null;
}

// ── Analyze / commit ────────────────────────────────────────────────────────

function decodeFile(fileBase64: string): Buffer {
  const buffer = Buffer.from(fileBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (!buffer.length) throw new ActivityError(400, 'The file is empty');
  if (buffer.length > MAX_IMPORT_BYTES) throw new ActivityError(413, 'The file is larger than 12 MB');
  return buffer;
}

async function readGrids(fileBase64: string, fileName: string): Promise<SheetGrid[]> {
  try {
    return await parseWorkbook(decodeFile(fileBase64), fileName);
  } catch (err) {
    if (err instanceof SpreadsheetError) throw new ActivityError(400, err.message);
    throw err;
  }
}

export interface AnalyzeOptions {
  userId?: string;
  /** Ask the AI where the lists are (falls back to the rules when it can't). */
  useAi?: boolean;
  /** Worksheets to read. Absent or empty means every worksheet. */
  sheets?: string[];
}

export async function analyzeImport(fileBase64: string, fileName: string, opts: AnalyzeOptions = {}) {
  const all = await readGrids(fileBase64, fileName);
  const wanted = opts.sheets?.length ? new Set(opts.sheets) : null;
  const grids = wanted ? all.filter((g) => wanted.has(g.name)) : all;
  if (wanted && !grids.length) throw new ActivityError(400, 'None of the chosen worksheets are in the file');
  const warnings: string[] = [];

  let blocks = detectBlocks(grids);
  let analyzedBy: 'ai' | 'rules' = 'rules';
  let model: string | null = null;
  let aiSummary: string | null = null;
  if (opts.useAi && opts.userId && grids.length) {
    try {
      const ai = await analyzeSheetsWithAI(opts.userId, grids, blocks);
      blocks = ai.blocks;
      analyzedBy = 'ai';
      model = ai.model;
      aiSummary = ai.summary || null;
      warnings.push(...ai.repairs);
    } catch (err) {
      if (err instanceof NoSheetAnalystError) {
        warnings.push(err.message);
      } else {
        logger.warn({ err: err instanceof Error ? err.message : err }, 'sales_sheet_analyst_failed');
        warnings.push(`The AI could not read the sheet (${err instanceof Error ? err.message : 'unknown error'}), so the pattern rules were used.`);
      }
    }
  }

  for (const g of grids) if (g.truncated) warnings.push(`Sheet "${g.name}" has more than 5,000 rows; only the first 5,000 are read.`);
  let scientific = 0;
  for (const b of blocks) {
    const grid = grids.find((g) => g.name === b.sheet)!;
    const phoneCol = b.columns.find((c) => c.suggested === 'phone');
    if (phoneCol) scientific += b.rows.filter((r) => isScientificPhone(grid.rows[r]?.[phoneCol.index] ?? '')).length;
  }
  if (scientific) {
    warnings.push(`${scientific} phone number${scientific === 1 ? ' was' : 's were'} saved by the spreadsheet as "2.33241E+11"-style numbers, which have lost their last digits. They will be left blank — export the sheet as .xlsx, or format the phone column as text, to keep them.`);
  }
  if (!blocks.length) warnings.push('No lists of people were found.');
  return {
    // Every worksheet in the file, so the user can choose which to read.
    sheets: all.map((g) => ({
      name: g.name,
      rowCount: g.rows.filter((r) => r.some((c) => c.trim())).length,
      selected: !wanted || wanted.has(g.name),
      sections: blocks.filter((b) => b.sheet === g.name).length,
    })),
    analyzedBy,
    model,
    summary: aiSummary,
    blocks: blocks.map((b) => ({
      index: b.index, sheet: b.sheet, title: b.title, headerRow: b.headerRow, rows: b.rows, rowCount: b.rows.length, columns: b.columns,
    })),
    warnings,
  };
}

export interface CommitBlock {
  index: number;
  include: boolean;
  listName: string;
  sourceType: ListSourceType;
  mapping: Record<string, ColumnTarget>; // column index → target
  /**
   * The section as analyse returned it. Sent back because an AI reading is
   * not repeatable — re-detecting on commit could land on different rows.
   * Absent means "re-run the pattern rules and take block `index`".
   */
  sheet?: string;
  rows?: number[];
  headers?: Record<string, string>;
}

interface ResolvedBlock { sheet: string; rows: number[]; headerOf: (col: number) => string }

function resolveBlock(cb: CommitBlock, grids: SheetGrid[], detected: () => ImportBlock[]): ResolvedBlock {
  if (cb.sheet !== undefined && cb.rows) {
    const grid = grids.find((g) => g.name === cb.sheet);
    if (!grid) throw new ActivityError(400, `Worksheet "${cb.sheet}" is not in the file — analyse it again`);
    const rows = [...new Set(cb.rows)].filter((r) => Number.isInteger(r) && r >= 0 && r < grid.rows.length).sort((a, b) => a - b);
    return { sheet: grid.name, rows, headerOf: (col) => cb.headers?.[String(col)] ?? '' };
  }
  const block = detected()[cb.index];
  if (!block) throw new ActivityError(400, `Block ${cb.index} no longer matches the file — analyse it again`);
  return { sheet: block.sheet, rows: block.rows, headerOf: (col) => block.columns.find((c) => c.index === col)?.header ?? '' };
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') || null };
}

export async function commitImport(pool: Pool, userId: string, input: { fileBase64: string; fileName: string; blocks: CommitBlock[] }) {
  const grids = await readGrids(input.fileBase64, input.fileName);
  let cached: ImportBlock[] | null = null;
  const detected = () => (cached ??= detectBlocks(grids));
  const resolved = new Map<CommitBlock, ResolvedBlock>();
  for (const cb of input.blocks.filter((b) => b.include)) resolved.set(cb, resolveBlock(cb, grids, detected));
  const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0, activities: 0, lists: [] as string[], phoneWarnings: [] as Array<{ list: string; row: number; name: string; raw: string }> };

  // Custom columns referenced by any mapping must exist first.
  const customLabels = new Map<string, string>();
  for (const cb of input.blocks.filter((b) => b.include)) {
    const block = resolved.get(cb)!;
    for (const [col, target] of Object.entries(cb.mapping)) {
      if (target.startsWith('custom:')) {
        const key = target.slice(7);
        if (!/^[a-z_][a-z0-9_]{0,39}$/.test(key)) throw new ActivityError(400, `Invalid column key "${key}"`);
        if (!customLabels.has(key)) customLabels.set(key, block.headerOf(Number(col)) || key.replace(/_/g, ' '));
      }
    }
  }
  if (customLabels.size) {
    const { rows } = await pool.query(`SELECT COALESCE(MAX(position), 10) AS p FROM sales_lead_fields WHERE user_id=$1`, [userId]);
    let pos = Number(rows[0].p) + 1;
    for (const [key, label] of customLabels) {
      await pool.query(
        `INSERT INTO sales_lead_fields (id, user_id, key, label, type, position)
         VALUES ($1,$2,$3,$4,'text',$5) ON CONFLICT (user_id, key) DO NOTHING`,
        [randomUUID(), userId, key, label.slice(0, 60), pos++],
      );
    }
  }

  for (const cb of input.blocks.filter((b) => b.include)) {
    const block = resolved.get(cb)!;
    const grid = grids.find((g) => g.name === block.sheet)!;
    const listName = cb.listName.trim().slice(0, 120) || block.sheet;
    const col = (t: ColumnTarget) => Object.entries(cb.mapping).find(([, v]) => v === t)?.[0];
    const iFull = col('full_name'); const iFirst = col('first_name'); const iLast = col('last_name');
    const iEmail = col('email'); const iPhone = col('phone');
    const rounds = Object.entries(cb.mapping)
      .filter(([, v]) => v.startsWith('round:'))
      .map(([c, v]) => ({ col: Number(c), round: Math.max(1, Math.min(50, Number(v.slice(6)) || 1)) }));
    const customs = Object.entries(cb.mapping).filter(([, v]) => v.startsWith('custom:')).map(([c, v]) => ({ col: Number(c), key: v.slice(7) }));
    if (iEmail === undefined && iPhone === undefined) throw new ActivityError(400, `"${listName}": map an email or a phone column`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const list = await findOrCreateLeadList(client, userId, listName, cb.sourceType);
      // Several sections can share one list (grouped by worksheet, or all in one).
      if (!summary.lists.includes(list.name)) summary.lists.push(list.name);
      const maxRound = rounds.reduce((m, r) => Math.max(m, r.round), 0);
      const baseTime = Date.now();

      for (const r of block.rows) {
        const row = grid.rows[r] ?? [];
        const cell = (i: string | number | undefined) => (i === undefined ? '' : (row[Number(i)] ?? '').trim());
        const email = cell(iEmail).toLowerCase();
        const phone = normalizePhone(cell(iPhone));
        let first = cell(iFirst) || null;
        let last = cell(iLast) || null;
        if (iFull !== undefined && !first && !last) ({ first, last } = splitName(cell(iFull)));
        const validEmail = email && isEmailLike(email) ? email : null;
        const phoneValue = phone.ok ? phone.value : null;
        if (!phone.ok && phone.reason === 'scientific') {
          summary.phoneWarnings.push({ list: list.name, row: r + 1, name: [first, last].filter(Boolean).join(' ') || validEmail || '', raw: cell(iPhone) });
        }
        if (!validEmail && !phoneValue) { summary.skipped += 1; continue; }

        // Match: email first, then phone.
        const found = await client.query(
          `SELECT id, first_name, last_name, email, phone FROM mailing_contacts
            WHERE user_id=$1 AND (($2::text IS NOT NULL AND lower(email)=$2) OR ($3::text IS NOT NULL AND phone=$3))
            ORDER BY (lower(email)=$2) DESC NULLS LAST LIMIT 1`,
          [userId, validEmail, phoneValue],
        );
        let contactId: string;
        if (found.rows[0]) {
          const ex = found.rows[0];
          contactId = ex.id;
          const fill = {
            first_name: ex.first_name || first, last_name: ex.last_name || last,
            email: ex.email || validEmail, phone: ex.phone || phoneValue,
          };
          const changed = fill.first_name !== ex.first_name || fill.last_name !== ex.last_name || fill.email !== ex.email || fill.phone !== ex.phone;
          if (changed) {
            // A savepoint, because a failed statement would otherwise abort the
            // whole block's transaction.
            await client.query('SAVEPOINT fill_contact');
            try {
              await client.query(
                `UPDATE mailing_contacts SET first_name=$3, last_name=$4, email=$5, phone=$6, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
                [contactId, userId, fill.first_name, fill.last_name, fill.email, fill.phone],
              );
              await client.query('RELEASE SAVEPOINT fill_contact');
              summary.updated += 1;
            } catch (err) {
              // Another contact already owns that email/phone — keep this one as it was.
              if ((err as { code?: string }).code !== '23505') throw err;
              await client.query('ROLLBACK TO SAVEPOINT fill_contact');
              summary.unchanged += 1;
            }
          } else {
            summary.unchanged += 1;
          }
        } else {
          contactId = randomUUID();
          await client.query(
            `INSERT INTO mailing_contacts (id, user_id, email, first_name, last_name, phone, source)
             VALUES ($1,$2,$3,$4,$5,$6,'sales_import')`,
            [contactId, userId, validEmail, first, last, phoneValue],
          );
          summary.created += 1;
        }

        const custom: Record<string, string> = {};
        for (const c of customs) { const v = cell(c.col); if (v) custom[c.key] = v.slice(0, 2000); }
        await client.query(
          `INSERT INTO sales_lead_profiles (id, user_id, contact_id, custom_data)
           VALUES ($1,$2,$3,$4::jsonb)
           ON CONFLICT (contact_id) DO UPDATE
             SET custom_data = EXCLUDED.custom_data || COALESCE(sales_lead_profiles.custom_data, '{}'::jsonb), updated_at=NOW()`,
          [randomUUID(), userId, contactId, JSON.stringify(custom)],
        );
        await client.query(
          `INSERT INTO sales_lead_list_members (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [list.id, contactId],
        );

        for (const rd of rounds) {
          const body = cell(rd.col);
          if (!body) continue;
          const hash = createHash('sha1').update(`${contactId}|${rd.round}|${body}`).digest('hex');
          // Later rounds sort as more recent; real dates are unknown.
          const at = new Date(baseTime - (maxRound - rd.round + 1) * 60_000);
          const ins = await client.query(
            `INSERT INTO crm_activities (id, user_id, contact_id, type, title, body, follow_up_round, response_status, completed_at, import_hash, ai_status)
             VALUES ($1,$2,$3,'note','Imported',$4,$5,$6,$7,$8,'none')
             ON CONFLICT (user_id, import_hash) WHERE import_hash IS NOT NULL DO NOTHING`,
            [randomUUID(), userId, contactId, body.slice(0, 5000), rd.round, inferResponseStatus(body), at, hash],
          );
          summary.activities += ins.rowCount ?? 0;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  return summary;
}
