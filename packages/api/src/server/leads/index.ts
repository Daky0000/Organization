/**
 * The Leads module — a lead pipeline with a user-definable table, spreadsheet
 * import, and Excel/PDF export, packaged to drop into any Express + Prisma app.
 *
 *   import { configureLeads, leadsRouter, importsRouter } from "leads-module";
 *
 *   configureLeads({ prisma });
 *   app.use("/api/leads", leadsRouter);
 *   app.use("/api/imports", requireAdmin, importsRouter);
 *
 * See README.md for the schema fragment that has to go into your own
 * schema.prisma first, and src/config.ts for every hook this exposes.
 */

export {
  configureLeads,
  getLeadsConfig,
  type DriveProvider,
  type ExportBranding,
  type LeadActor,
  type LeadsConfig,
  type RemoteFile,
  type SheetAnalyst,
} from "./config.ts";

export { LeadsHttpError } from "./errors.ts";

export { leadsRouter } from "./routes/leads.ts";
export { importsRouter } from "./routes/imports.ts";

// --- The table's shape -----------------------------------------------------

export {
  BUILTIN_FIELDS,
  LEAD_ACTIVITY_TYPES,
  LEAD_FIELD_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  WRITABLE_BUILTIN_KEYS,
  builtinField,
  coerceValue,
  isBuiltinKey,
  replaceFields,
  resolveFields,
  slugifyKey,
  type BuiltinField,
  type FieldInput,
  type ResolvedField,
} from "./services/leadFields.ts";

// --- Importing -------------------------------------------------------------

export {
  MAX_COLUMNS,
  MAX_ROWS_PER_SHEET,
  SpreadsheetError,
  isCsvName,
  isSpreadsheetName,
  listWorkbookSheets,
  parseCsv,
  parseWorkbook,
  toGrid,
  type SheetGrid,
} from "./services/spreadsheet.ts";

export {
  columnLetter,
  detectTables,
  extractRows,
  normalizePlan,
  renderGrid,
  renderHints,
  type ExtractedRow,
  type ImportPlan,
  type PlanColumn,
  type PlanTable,
} from "./services/sheetPlan.ts";

export { buildPreviews, commitPlan, type CommitResult, type TablePreview } from "./services/leadImport.ts";

// --- Exporting -------------------------------------------------------------

export { renderLeadsPdf, renderLeadsXlsx, type ExportGroup } from "./services/leadExport.ts";

// --- Scraper ingestion (optional) ------------------------------------------
//
// Pure functions for turning an arbitrary scraped record — an Apify dataset
// item, a directory listing — into a Lead. Nothing else in the module depends
// on them; ignore this export entirely if you only import spreadsheets.

export {
  buildDedupeKey,
  cleanWebsite,
  mapItemToLead,
  resolvePreset,
  scoreLead,
  websiteDomain,
  type MappingOptions,
  type NormalizedLead,
  type Preset,
} from "./services/leadMapping.ts";
