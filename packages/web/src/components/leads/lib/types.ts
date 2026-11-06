/**
 * The wire shapes the leads API returns.
 *
 * Dates arrive as ISO strings and Prisma `Decimal` columns as strings, because
 * that is what JSON does to them — `estimatedDealSize` and `rating` are strings
 * here on purpose, not by oversight.
 */

export interface LeadGroup {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  autoCreated: boolean;
  /** "Contacts!5-210" for a group that came out of a spreadsheet. */
  sourceLabel?: string | null;
  leadImportId?: string | null;
  createdAt: string;
  _count?: { leads: number };
}

// --- Columns ---------------------------------------------------------------

export type LeadFieldType =
  | "TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "CURRENCY"
  | "DATE"
  | "BOOLEAN"
  | "EMAIL"
  | "PHONE"
  | "URL"
  | "SELECT";

/** One column of the leads table. `id` is null for the built-in defaults. */
export interface LeadFieldDef {
  id: string | null;
  key: string;
  label: string;
  type: LeadFieldType;
  builtin: boolean;
  hidden: boolean;
  position: number;
  width: number | null;
  meta?: unknown;
}

export interface BuiltinFieldDef {
  key: string;
  label: string;
  type: LeadFieldType;
  writable: boolean;
  visible: boolean;
  hint: string;
}

export interface LeadFieldSet {
  /** Which set is in force: this group's own, the saved default, or the shipped default. */
  scope: "group" | "default" | "builtin";
  groupId: string | null;
  fields: LeadFieldDef[];
  builtins: BuiltinFieldDef[];
}

// --- Leads -----------------------------------------------------------------

export interface Lead {
  id: string;
  contactName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  companyName?: string | null;
  source: string;
  status: string;
  leadScore: number;
  estimatedDealSize?: string | null;
  discoveryNotes?: string | null;
  discoveryCallAt?: string | null;
  winLossReason?: string | null;
  createdAt: string;
  updatedAt?: string;

  // Firmographics, mostly filled by imports and scrapers.
  website?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  category?: string | null;
  rating?: string | null;
  reviewsCount?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  socialLinks?: Record<string, string> | null;
  tags?: string[];
  externalId?: string | null;
  enrichment?: Record<string, unknown> | null;
  /** Values for columns that aren't Lead scalars, keyed by LeadFieldDef.key. */
  customFields?: Record<string, unknown> | null;

  groupId?: string | null;
  group?: LeadGroup | null;
  /** Set once `convertLead` has run — the id of whatever your app calls a customer. */
  clientId?: string | null;
  /** Provenance when the lead came from a scraper integration. */
  scraperSourceId?: string | null;
  scraperRunId?: string | null;

  activities?: LeadActivity[];
}

export type LeadActivityType = "EMAIL" | "CALL" | "MESSAGE" | "MEETING" | "NOTE";

export interface LeadActivity {
  id: string;
  type: LeadActivityType;
  summary: string;
  outcome?: string | null;
  occurredAt: string;
  actorId?: string | null;
  actorName?: string | null;
}

export interface LeadStats {
  total: number;
  averageScore: number;
  pipelineValue: string;
  reachable: number;
  newThisWeek: number;
  byStatus: { status: string; _count: number }[];
  bySource: { source: string; _count: number }[];
  cities: { city: string | null; _count: number }[];
  categories: { category: string | null; _count: number }[];
  groups: LeadGroup[];
}

// --- Spreadsheet imports ---------------------------------------------------

export interface PlanColumn {
  /** 0-based column index in the sheet. */
  index: number;
  header: string;
  label: string;
  /** A Lead field key, or "custom" to keep it as its own column, or "ignore". */
  field: string;
  key?: string;
  type: LeadFieldType;
}

export interface PlanTable {
  id: string;
  sheet: string;
  title: string;
  headerRow: number | null;
  firstDataRow: number;
  lastDataRow: number;
  startColumn: number;
  endColumn: number;
  columns: PlanColumn[];
  leadSource: string;
  status: string;
  confidence: number;
  notes: string;
  include: boolean;
}

export interface ImportPlan {
  tables: PlanTable[];
  summary: string;
}

export interface TablePreview {
  tableId: string;
  columns: { key: string; label: string; field: string; type: string; builtin: boolean }[];
  sample: Record<string, string>[];
  rowCount: number;
  skipped: number;
  reachable: number;
}

export interface LeadImportRecord {
  id: string;
  source: "UPLOAD" | "GOOGLE_SHEET" | "GOOGLE_DRIVE_FILE";
  status: "ANALYZING" | "READY" | "IMPORTED" | "FAILED";
  fileName?: string | null;
  driveFileId?: string | null;
  sheetNames: string[];
  analyzedBy?: string | null;
  notes?: string | null;
  error?: string | null;
  tablesFound: number;
  groupsCreated: number;
  leadsCreated: number;
  leadsUpdated: number;
  rowsSkipped: number;
  createdAt: string;
  groups?: { id: string; name: string; _count?: { leads: number } }[];
}

export interface AnalyzeResponse {
  import: LeadImportRecord;
  plan: ImportPlan;
  previews: TablePreview[];
  sheets: { name: string; rows: number; columns: number }[];
  warning: string | null;
}

/** GET /imports/status — what the import page can offer today. */
export interface ImportCapabilities {
  analyst: { configured: boolean };
  drive: { available: boolean; connected: boolean; account: string | null };
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
}
