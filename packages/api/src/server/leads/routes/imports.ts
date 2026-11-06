/**
 * The spreadsheet import wizard's API.
 *
 * Three steps, in this order, and nothing is written until the last one:
 *   POST /sheets       — what tabs does this file have?
 *   POST /analyze      — read it, and here is the plan I'd run
 *   POST /:id/commit   — run the plan I just approved
 *
 * Mount this behind whatever guard the host uses for privileged routes. It
 * parses bodies far larger than a normal API allows, and it can spend money if
 * a `SheetAnalyst` is configured.
 */

import express, { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, getLeadsConfig } from "../config.ts";
import { httpStatusOf } from "../errors.ts";
import { detectTables, normalizePlan, type ImportPlan } from "../services/sheetPlan.ts";
import { SpreadsheetError, isSpreadsheetName, listWorkbookSheets, parseWorkbook, type SheetGrid } from "../services/spreadsheet.ts";
import { buildPreviews, commitPlan } from "../services/leadImport.ts";

export const importsRouter = Router();

// An uploaded workbook rides in the JSON body as base64, so these routes parse
// bodies far larger than the rest of an API normally allows.
importsRouter.use(express.json({ limit: "28mb" }));

/**
 * Parsed sheets, kept between "analyse" and "commit" so a 3,000-row workbook
 * isn't re-read on every edit of the plan. Losing the cache is harmless: the
 * commit route re-reads from the drive, or from the file the client still holds.
 */
const gridCache = new Map<string, { grids: SheetGrid[]; at: number }>();
const GRID_CACHE_TTL_MS = 60 * 60_000;
const GRID_CACHE_MAX = 8;

function cacheGrids(importId: string, grids: SheetGrid[]) {
  gridCache.set(importId, { grids, at: Date.now() });
  for (const [key, entry] of gridCache) {
    if (Date.now() - entry.at > GRID_CACHE_TTL_MS) gridCache.delete(key);
  }
  while (gridCache.size > GRID_CACHE_MAX) {
    const oldest = [...gridCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    gridCache.delete(oldest[0]);
  }
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function decodeUpload(dataBase64: string): Buffer {
  // Accepts a bare base64 string or a data: URL, since both are one line of
  // client code away and neither is worth failing over.
  const payload = dataBase64.includes(",") && dataBase64.startsWith("data:") ? dataBase64.slice(dataBase64.indexOf(",") + 1) : dataBase64;
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) throw new SpreadsheetError("That file came through empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new SpreadsheetError("That file is over 20 MB. Split it, or import it from a connected drive instead.");
  }
  return buffer;
}

/** Everything the module can't do because the host didn't wire it up. */
function sendKnownError(res: express.Response, err: unknown): boolean {
  if (err instanceof SpreadsheetError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  const status = httpStatusOf(err);
  if (status !== null) {
    res.status(status).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

// --- What's connected ------------------------------------------------------

/**
 * GET /imports/status — what the import page can offer today. Both integrations
 * are optional (an upload mapped by pattern rules is a complete import), so
 * this reports rather than blocks.
 */
importsRouter.get("/status", async (_req, res, next) => {
  try {
    const { analyst, drive } = getLeadsConfig();
    const connected = drive ? await drive.connected() : false;
    res.json({
      analyst: { configured: analyst ? await analyst.configured() : false },
      drive: {
        available: Boolean(drive),
        connected,
        account: connected && drive?.account ? await drive.account() : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- Remote drive browsing -------------------------------------------------

function requireDrive() {
  const { drive } = getLeadsConfig();
  if (!drive) throw new SpreadsheetError("No drive is connected. Upload the file instead.");
  return drive;
}

importsRouter.get("/drive/files", async (req, res, next) => {
  try {
    const search = typeof req.query.q === "string" ? req.query.q : undefined;
    res.json({ files: await requireDrive().listFiles(search) });
  } catch (err) {
    if (!sendKnownError(res, err)) next(err);
  }
});

importsRouter.get("/drive/files/:id", async (req, res, next) => {
  try {
    const drive = requireDrive();
    const file = await drive.getFile(req.params.id);
    res.json({ file, sheets: await drive.listTabs(file) });
  } catch (err) {
    if (!sendKnownError(res, err)) next(err);
  }
});

// --- Reading a file --------------------------------------------------------

// POST /imports/sheets — tab names for an upload, before committing to a full read.
importsRouter.post("/sheets", async (req, res, next) => {
  try {
    const { fileName, dataBase64 } = z.object({ fileName: z.string().min(1), dataBase64: z.string().min(1) }).parse(req.body);
    if (!isSpreadsheetName(fileName)) {
      return res.status(400).json({ error: "Upload an .xlsx, .csv or .tsv file." });
    }
    res.json({ sheets: await listWorkbookSheets(decodeUpload(dataBase64), fileName) });
  } catch (err) {
    if (!sendKnownError(res, err)) next(err);
  }
});

const analyzeInput = z.object({
  source: z.enum(["UPLOAD", "GOOGLE_SHEET", "GOOGLE_DRIVE_FILE"]).default("UPLOAD"),
  fileName: z.string().optional(),
  dataBase64: z.string().optional(),
  driveFileId: z.string().optional(),
  sheetNames: z.array(z.string()).optional(),
  /** False maps the sheet with the pattern rules only — no analyst call. */
  useAi: z.boolean().default(true),
});

async function loadGrids(input: z.infer<typeof analyzeInput>): Promise<{ grids: SheetGrid[]; fileName: string }> {
  if (input.driveFileId) {
    const { file, grids } = await requireDrive().readGrids(input.driveFileId, input.sheetNames);
    return { grids, fileName: file.name };
  }
  if (!input.dataBase64 || !input.fileName) {
    throw new SpreadsheetError("Send a file to import, or pick one from a connected drive.");
  }
  if (!isSpreadsheetName(input.fileName)) throw new SpreadsheetError("Upload an .xlsx, .csv or .tsv file.");
  const grids = await parseWorkbook(decodeUpload(input.dataBase64), input.fileName, input.sheetNames);
  return { grids, fileName: input.fileName };
}

/**
 * POST /imports/analyze — reads the file and returns a plan to review.
 *
 * Nothing is written to the pipeline here. The reading of the file, a preview
 * of the rows it would create, and the record of the attempt are all that come
 * back; the plan is approved at /commit.
 */
importsRouter.post("/analyze", async (req, res, next) => {
  let record: { id: string } | null = null;
  const prisma = db();
  try {
    const { analyst } = getLeadsConfig();
    const input = analyzeInput.parse(req.body);
    const { grids, fileName } = await loadGrids(input);
    if (!grids.length) return res.status(400).json({ error: "That file has no readable rows." });

    record = await prisma.leadImport.create({
      data: {
        source: input.driveFileId ? "GOOGLE_SHEET" : "UPLOAD",
        status: "ANALYZING",
        fileName,
        driveFileId: input.driveFileId ?? null,
        sheetNames: grids.map((grid) => grid.name),
      },
      select: { id: true },
    });
    cacheGrids(record.id, grids);

    const hints = detectTables(grids);
    let plan: ImportPlan = { tables: hints, summary: "" };
    let analyzedBy = "rules";
    let warning: string | null = null;

    if (input.useAi && analyst && (await analyst.configured())) {
      try {
        const analysis = await analyst.analyze(grids, hints);
        plan = analysis.plan;
        analyzedBy = analysis.model;
      } catch (err) {
        // A failed analyst call is a degraded import, not a failed one — the
        // pattern rules still produced something that can be corrected.
        warning =
          httpStatusOf(err) !== null
            ? (err as Error).message
            : "The AI analyst couldn't be reached; used pattern rules instead.";
      }
    } else if (input.useAi && analyst) {
      warning = "The AI analyst isn't configured, so the sheet was mapped with pattern rules.";
    }

    const normalized = normalizePlan(plan, grids);
    const saved = await prisma.leadImport.update({
      where: { id: record.id },
      data: {
        status: normalized.tables.length ? "READY" : "FAILED",
        plan: normalized as unknown as Prisma.InputJsonValue,
        analyzedBy,
        notes: normalized.summary || null,
        tablesFound: normalized.tables.length,
        error: normalized.tables.length ? null : "No lead tables were found in this file.",
      },
    });

    res.status(201).json({
      import: saved,
      plan: normalized,
      previews: buildPreviews(grids, normalized),
      sheets: grids.map((grid) => ({ name: grid.name, rows: grid.rows.length, columns: grid.rows[0]?.length ?? 0 })),
      warning,
    });
  } catch (err) {
    if (record) {
      await prisma.leadImport
        .update({ where: { id: record.id }, data: { status: "FAILED", error: (err as Error).message.slice(0, 500) } })
        .catch(() => undefined);
    }
    if (!sendKnownError(res, err)) next(err);
  }
});

// --- Plans -----------------------------------------------------------------

const planInput = z.object({
  plan: z.object({ tables: z.array(z.any()), summary: z.string().optional() }),
  /** Re-sent when the server no longer holds the parsed file. */
  dataBase64: z.string().optional(),
  fileName: z.string().optional(),
});

/** The grids for an import: from cache, from the drive, or from the file the client still has. */
async function grabGrids(importId: string, fallback: { dataBase64?: string; fileName?: string }): Promise<SheetGrid[]> {
  const cached = gridCache.get(importId);
  if (cached) {
    cached.at = Date.now();
    return cached.grids;
  }

  const record = await db().leadImport.findUnique({ where: { id: importId } });
  if (!record) throw new SpreadsheetError("That import no longer exists. Start again.");

  if (record.driveFileId) {
    const { grids } = await requireDrive().readGrids(record.driveFileId, record.sheetNames);
    cacheGrids(importId, grids);
    return grids;
  }

  const name = fallback.fileName ?? record.fileName;
  if (!fallback.dataBase64 || !name) {
    throw new SpreadsheetError("The uploaded file is no longer in memory. Upload it again to finish the import.");
  }
  const grids = await parseWorkbook(decodeUpload(fallback.dataBase64), name, record.sheetNames);
  cacheGrids(importId, grids);
  return grids;
}

// POST /imports/:id/preview — re-run an edited plan without writing anything.
importsRouter.post("/:id/preview", async (req, res, next) => {
  try {
    const input = planInput.parse(req.body);
    const grids = await grabGrids(req.params.id, input);
    const normalized = normalizePlan(input.plan as ImportPlan, grids);

    await db().leadImport.update({
      where: { id: req.params.id },
      data: { plan: normalized as unknown as Prisma.InputJsonValue, tablesFound: normalized.tables.length },
    });

    res.json({ plan: normalized, previews: buildPreviews(grids, normalized) });
  } catch (err) {
    if (!sendKnownError(res, err)) next(err);
  }
});

// POST /imports/:id/commit — writes the approved plan into the pipeline.
importsRouter.post("/:id/commit", async (req, res, next) => {
  try {
    const prisma = db();
    const input = planInput.parse(req.body);
    const record = await prisma.leadImport.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Import not found" });
    if (record.status === "IMPORTED") {
      return res.status(409).json({ error: "This import has already been run. Start a new one to import the file again." });
    }

    const grids = await grabGrids(req.params.id, input);
    const normalized = normalizePlan(input.plan as ImportPlan, grids);
    if (!normalized.tables.some((table) => table.include !== false)) {
      return res.status(400).json({ error: "No tables are ticked for import." });
    }

    const result = await commitPlan(record.id, grids, normalized);
    const saved = await prisma.leadImport.update({
      where: { id: record.id },
      data: {
        status: "IMPORTED",
        plan: normalized as unknown as Prisma.InputJsonValue,
        groupsCreated: result.groupsCreated,
        leadsCreated: result.leadsCreated,
        leadsUpdated: result.leadsUpdated,
        rowsSkipped: result.rowsSkipped,
      },
      include: { groups: { include: { _count: { select: { leads: true } } } } },
    });

    res.json({ import: saved, result });
  } catch (err) {
    if (!sendKnownError(res, err)) next(err);
  }
});

// --- History ---------------------------------------------------------------

importsRouter.get("/", async (_req, res, next) => {
  try {
    const imports = await db().leadImport.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { groups: { select: { id: true, name: true, _count: { select: { leads: true } } } } },
    });
    res.json(imports);
  } catch (err) {
    next(err);
  }
});

importsRouter.get("/:id", async (req, res, next) => {
  try {
    const record = await db().leadImport.findUnique({
      where: { id: req.params.id },
      include: { groups: { select: { id: true, name: true, _count: { select: { leads: true } } } } },
    });
    if (!record) return res.status(404).json({ error: "Import not found" });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// Deleting the record keeps the leads — they belong to the pipeline now.
importsRouter.delete("/:id", async (req, res, next) => {
  try {
    const prisma = db();
    gridCache.delete(req.params.id);
    await prisma.leadGroup.updateMany({ where: { leadImportId: req.params.id }, data: { leadImportId: null } });
    await prisma.leadImport.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
