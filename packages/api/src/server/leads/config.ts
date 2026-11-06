/**
 * How the module attaches to a host application.
 *
 * The module owns leads, their columns, their batches and their imports, and
 * nothing else. Everything that would tie it to one particular app — what a
 * "customer" is, who is logged in, whether a lead may be deleted, which model
 * reads spreadsheets — arrives through here instead of being imported, so the
 * module can drop into a codebase that has never heard of any of it.
 *
 *   import { configureLeads, leadsRouter } from "@leads/module";
 *
 *   configureLeads({ prisma });
 *   app.use("/api/leads", leadsRouter);
 *
 * That is the whole minimum. Every field below except `prisma` is optional,
 * and each one that is left out disables exactly one feature rather than
 * breaking the rest.
 */

import type { Request } from '../../types/http.ts';
import type { Lead, PrismaClient } from "@prisma/client";
import type { SheetGrid } from "./services/spreadsheet.ts";
import type { ImportPlan, PlanTable } from "./services/sheetPlan.ts";

// --- Optional collaborators -------------------------------------------------

/** A file in whatever remote drive the host has connected. */
export interface RemoteFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
}

/**
 * Reads spreadsheets out of a remote drive. Supply one to turn on the "from
 * Google Drive" tab of the import wizard; leave it out and imports are uploads
 * only, which is a complete feature on its own.
 */
export interface DriveProvider {
  /** True once the host actually holds credentials for an account. */
  connected(): Promise<boolean> | boolean;
  /** For the read-out at the top of the import page. */
  account?(): Promise<string | null> | string | null;
  listFiles(search?: string): Promise<RemoteFile[]>;
  getFile(fileId: string): Promise<RemoteFile>;
  listTabs(file: RemoteFile): Promise<string[]>;
  readGrids(fileId: string, sheetNames?: string[]): Promise<{ file: RemoteFile; grids: SheetGrid[] }>;
}

/**
 * An LLM that reads a messy workbook and says what tables are in it. Supply one
 * for sheets the pattern rules in services/sheetPlan.ts can't untangle — a file
 * with three stacked tables, a title banner and no header row. Without it,
 * every import still works; it is just mapped by rules.
 */
export interface SheetAnalyst {
  /** False when no API key is set, so the UI can say so rather than failing mid-import. */
  configured(): Promise<boolean> | boolean;
  /** `hints` is the rule-based reading, offered as a starting point to correct. */
  analyze(grids: SheetGrid[], hints: PlanTable[]): Promise<{ plan: ImportPlan; model: string }>;
}

/** Who is acting, for the contact log. */
export interface LeadActor {
  id?: string;
  name?: string;
}

/** Colours and wording for the Excel and PDF exports. */
export interface ExportBranding {
  /** Printed at the top of the PDF and set as the workbook's author. */
  brandName: string;
  /** Hex. The near-black used for headers and body text. */
  ink: string;
  /** Hex. The rule under the PDF's title. */
  accent: string;
  /** Hex. Secondary text. */
  muted: string;
  /** Hex. Row separators. */
  hairline: string;
}

// --- The configuration ------------------------------------------------------

export interface LeadsConfig {
  /**
   * Your own PrismaClient. The module never constructs one, so it shares the
   * host's connection pool and its transactions rather than opening a second
   * pool against the same database.
   */
  prisma: PrismaClient;

  /**
   * Called with the ids of leads an import just created — the hook for
   * enrolling new leads into an email sequence, firing a webhook, or
   * reindexing. Failures here are logged, not thrown: an import that wrote 300
   * leads has succeeded even if the follow-up didn't.
   */
  onLeadsCreated?: (leadIds: string[]) => Promise<void> | void;

  /**
   * Promotes a qualified lead to whatever the host calls a customer, and
   * returns that record. Omit it and `POST /leads/:id/convert` answers 501
   * rather than pretending; the rest of the pipeline is unaffected.
   */
  convertLead?: (lead: Lead) => Promise<{ id: string; [key: string]: unknown }>;

  /**
   * Veto a delete. Return a message to refuse it, null to allow. This is where
   * a host with proposals or invoices pointing at leads says so, instead of the
   * database raising a foreign-key error nobody can read.
   */
  canDelete?: (leadIds: string[]) => Promise<string | null> | string | null;

  /** Resolves the acting user from the request, for the contact log's byline. */
  resolveActor?: (req: Request) => LeadActor | undefined;

  /** See {@link SheetAnalyst}. Without it, sheets are mapped by pattern rules. */
  analyst?: SheetAnalyst;

  /** See {@link DriveProvider}. Without it, imports are uploads only. */
  drive?: DriveProvider;

  /** How many leads one export may contain. Big enough to be useful, bounded enough to finish. */
  exportLimit?: number;

  /** Branding for the generated files. */
  export?: Partial<ExportBranding>;
}

const DEFAULT_BRANDING: ExportBranding = {
  brandName: "Leads",
  ink: "#0B0B0C",
  accent: "#C7A24C",
  muted: "#6E6A63",
  hairline: "#E5E2DB",
};

export interface ResolvedLeadsConfig extends LeadsConfig {
  exportLimit: number;
  export: ExportBranding;
}

let current: ResolvedLeadsConfig | null = null;

/** Call once at boot, before mounting the routers. */
export function configureLeads(config: LeadsConfig): void {
  current = {
    ...config,
    exportLimit: config.exportLimit ?? 5000,
    export: { ...DEFAULT_BRANDING, ...config.export },
  };
}

export function getLeadsConfig(): ResolvedLeadsConfig {
  if (!current) {
    throw new Error("Leads module is not configured. Call configureLeads({ prisma }) before mounting its routers.");
  }
  return current;
}

/** The Prisma client the module writes through. */
export function db(): PrismaClient {
  return getLeadsConfig().prisma;
}

/**
 * Runs an `onLeadsCreated` hook without letting it fail the import that
 * triggered it — the leads are already written by the time this runs.
 */
export async function notifyLeadsCreated(leadIds: string[]): Promise<void> {
  const hook = getLeadsConfig().onLeadsCreated;
  if (!hook || !leadIds.length) return;
  try {
    await hook(leadIds);
  } catch (err) {
    console.error("[leads] onLeadsCreated hook failed:", err);
  }
}
