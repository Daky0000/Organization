import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, getLeadsConfig } from "../config.ts";
import {
  BUILTIN_FIELDS,
  LEAD_ACTIVITY_TYPES,
  LEAD_FIELD_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  isBuiltinKey,
  replaceFields,
  resolveFields,
  slugifyKey,
} from "../services/leadFields.ts";
import { renderLeadsPdf, renderLeadsXlsx, type ExportGroup } from "../services/leadExport.ts";

export const leadsRouter = Router();

const leadInput = z.object({
  contactName: z.string().min(1),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  source: z.enum(LEAD_SOURCES).default("OTHER"),
  status: z.enum(LEAD_STATUSES).default("NEW"),
  leadScore: z.number().int().min(0).max(100).default(0),
  discoveryCallAt: z.coerce.date().optional().nullable(),
  discoveryNotes: z.string().optional().nullable(),
  estimatedDealSize: z.number().nonnegative().optional().nullable(),
  winLossReason: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  groupId: z.string().cuid().nullable().optional(),
  /** Values for the columns that aren't Lead scalars — see services/leadFields.ts. */
  customFields: z.record(z.unknown()).nullable().optional(),
});

const SORTS: Record<string, Prisma.LeadOrderByWithRelationInput> = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  score: { leadScore: "desc" },
  name: { contactName: "asc" },
  reviews: { reviewsCount: "desc" },
  rating: { rating: "desc" },
};

/** Turns the filter bar's query string into a Prisma filter. */
function buildWhere(query: Record<string, unknown>): Prisma.LeadWhereInput {
  const str = (key: string) => (typeof query[key] === "string" && query[key] ? (query[key] as string) : undefined);
  const where: Prisma.LeadWhereInput = {};

  const status = str("status");
  if (status) where.status = { in: status.split(",") as (typeof LEAD_STATUSES)[number][] };

  const source = str("source");
  if (source) where.source = { in: source.split(",") as (typeof LEAD_SOURCES)[number][] };

  const groupId = str("groupId");
  if (groupId) where.groupId = groupId === "none" ? null : groupId;

  const scraperSourceId = str("scraperSourceId");
  if (scraperSourceId) where.scraperSourceId = scraperSourceId;

  const scraperRunId = str("scraperRunId");
  if (scraperRunId) where.scraperRunId = scraperRunId;

  const city = str("city");
  if (city) where.city = { equals: city, mode: "insensitive" };

  const category = str("category");
  if (category) where.category = { equals: category, mode: "insensitive" };

  const minScore = Number(str("minScore"));
  if (Number.isFinite(minScore) && minScore > 0) where.leadScore = { gte: minScore };

  // `has=email,phone,website` — the "can I actually reach them" filter.
  const has = str("has")?.split(",") ?? [];
  if (has.includes("email")) where.contactEmail = { not: null };
  if (has.includes("phone")) where.contactPhone = { not: null };
  if (has.includes("website")) where.website = { not: null };
  if (has.includes("noWebsite")) where.website = null;

  const q = str("q");
  if (q) {
    where.OR = [
      { contactName: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { contactEmail: { contains: q, mode: "insensitive" } },
      { contactPhone: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

// GET /leads — filtered, sorted, paged.
leadsRouter.get("/", async (req, res, next) => {
  try {
    const prisma = db();
    const where = buildWhere(req.query as Record<string, unknown>);
    const sort = SORTS[String(req.query.sort ?? "newest")] ?? SORTS.newest;
    const take = Math.min(Number(req.query.take) || 300, 1000);
    const skip = Number(req.query.skip) || 0;

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: sort,
        take,
        skip,
        include: { group: { select: { id: true, name: true } } },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ items, total, take, skip });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /leads/stats — pipeline counters plus the distinct values the filter bar
 * offers. One call, because the Leads page needs all of it on first paint.
 */
leadsRouter.get("/stats", async (req, res, next) => {
  try {
    const prisma = db();
    const where = buildWhere(req.query as Record<string, unknown>);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);

    const [byStatus, bySource, byCity, byCategory, totals, reachable, newThisWeek, groups] = await Promise.all([
      prisma.lead.groupBy({ by: ["status"], _count: true, where }),
      prisma.lead.groupBy({ by: ["source"], _count: true, where }),
      prisma.lead.groupBy({ by: ["city"], _count: true, where, orderBy: { _count: { city: "desc" } }, take: 25 }),
      prisma.lead.groupBy({ by: ["category"], _count: true, where, orderBy: { _count: { category: "desc" } }, take: 25 }),
      prisma.lead.aggregate({ where, _count: true, _avg: { leadScore: true }, _sum: { estimatedDealSize: true } }),
      prisma.lead.count({ where: { ...where, OR: [{ contactEmail: { not: null } }, { contactPhone: { not: null } }] } }),
      prisma.lead.count({ where: { ...where, createdAt: { gte: weekAgo } } }),
      prisma.leadGroup.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { leads: true } } },
      }),
    ]);

    res.json({
      total: totals._count,
      averageScore: Math.round(totals._avg.leadScore ?? 0),
      pipelineValue: totals._sum.estimatedDealSize ?? 0,
      reachable,
      newThisWeek,
      byStatus,
      bySource,
      cities: byCity.filter((row) => row.city),
      categories: byCategory.filter((row) => row.category),
      groups,
    });
  } catch (err) {
    next(err);
  }
});

// --- Groups ----------------------------------------------------------------

const groupInput = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\da-z]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "group"
  );
}

leadsRouter.get("/groups", async (_req, res, next) => {
  try {
    const groups = await db().leadGroup.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });
    res.json(groups);
  } catch (err) {
    next(err);
  }
});

leadsRouter.post("/groups", async (req, res, next) => {
  try {
    const data = groupInput.parse(req.body);
    // A hand-made group that collides with an auto one just reuses it.
    //
    // HOST PATCH: was a single `upsert({ where: { slug } })`. `slug` is unique
    // per user here, not globally, so the unique lookup would need a compound
    // key the tenancy extension can't fill in. find-then-write is scoped for
    // us and reads the same.
    const slug = slugify(data.name);
    const existing = await db().leadGroup.findFirst({ where: { slug }, select: { id: true } });
    const group = existing
      ? await db().leadGroup.update({
          where: { id: existing.id },
          data: { name: data.name, description: data.description ?? undefined },
        })
      : await db().leadGroup.create({ data: { ...data, slug } });
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

leadsRouter.patch("/groups/:id", async (req, res, next) => {
  try {
    const data = groupInput.partial().parse(req.body);
    const group = await db().leadGroup.update({ where: { id: req.params.id }, data });
    res.json(group);
  } catch (err) {
    next(err);
  }
});

// Deleting a group never deletes leads — they fall back to "Ungrouped".
leadsRouter.delete("/groups/:id", async (req, res, next) => {
  try {
    const prisma = db();
    await prisma.lead.updateMany({ where: { groupId: req.params.id }, data: { groupId: null } });
    await prisma.leadGroup.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /leads/export?format=xlsx|pdf — the current view, as a file.
 *
 * Takes exactly the same query string as the table, so what downloads is what
 * you were looking at. Grouped by batch, each batch keeps its own columns —
 * one worksheet each, because two batches with different columns can't share a
 * sheet without one of them losing columns.
 */
leadsRouter.get("/export", async (req, res, next) => {
  try {
    const format = String(req.query.format ?? "xlsx").toLowerCase();
    if (format !== "xlsx" && format !== "pdf") {
      return res.status(400).json({ error: "format must be xlsx or pdf" });
    }

    const { exportLimit, export: branding } = getLeadsConfig();
    const where = buildWhere(req.query as Record<string, unknown>);
    const sort = SORTS[String(req.query.sort ?? "newest")] ?? SORTS.newest;
    const leads = await db().lead.findMany({ where, orderBy: sort, take: exportLimit, include: { group: true } });

    // One export per batch when the leads span several, so each keeps its own
    // columns; a single batch (or none) exports flat.
    const byGroup = new Map<string, { name: string; leads: typeof leads }>();
    for (const lead of leads) {
      const key = lead.groupId ?? "none";
      const bucket = byGroup.get(key) ?? { name: lead.group?.name ?? "Ungrouped", leads: [] };
      bucket.leads.push(lead);
      byGroup.set(key, bucket);
    }

    const groups: ExportGroup[] = [];
    for (const [key, bucket] of byGroup) {
      const { fields } = await resolveFields(key === "none" ? null : key);
      groups.push({ name: bucket.name, fields: fields.filter((field) => !field.hidden), leads: bucket.leads });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const slug = slugify(branding.brandName);
    const filename = `${slug}-leads-${stamp}.${format === "pdf" ? "pdf" : "xlsx"}`;
    const subtitle = `${leads.length} lead${leads.length === 1 ? "" : "s"} · exported ${stamp}${
      leads.length === exportLimit ? ` · capped at ${exportLimit}` : ""
    }`;

    const file =
      format === "pdf"
        ? await renderLeadsPdf(groups, "Lead export", subtitle)
        : await renderLeadsXlsx(groups, "Leads");

    res.setHeader(
      "Content-Type",
      format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(file);
  } catch (err) {
    next(err);
  }
});

// --- Columns ---------------------------------------------------------------
//
// The leads table's shape is data, not code: which columns show, in what order,
// under what label, and whether they're a Lead scalar or a value carried in
// `customFields`. A group with its own set overrides the default set entirely,
// which is what lets two batches imported from one workbook look nothing alike.

const fieldInput = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
  type: z.enum(LEAD_FIELD_TYPES).optional(),
  hidden: z.boolean().optional(),
  width: z.number().int().min(60).max(600).nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
});

// GET /leads/fields?groupId= — the columns this view should render.
leadsRouter.get("/fields", async (req, res, next) => {
  try {
    const groupId = typeof req.query.groupId === "string" && req.query.groupId ? req.query.groupId : null;
    const resolved = await resolveFields(groupId);
    res.json({
      ...resolved,
      groupId,
      /** Everything a new column could map onto, for the column editor's picker. */
      builtins: BUILTIN_FIELDS,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /leads/fields — replaces a scope's whole column set.
 *
 * The column editor sends the list it wants to end up with, because reorder,
 * rename, hide, add and remove all arrive together and applying them one at a
 * time would leave the table in states nobody asked for.
 */
leadsRouter.put("/fields", async (req, res, next) => {
  try {
    const { groupId, fields } = z
      .object({ groupId: z.string().cuid().nullable().optional(), fields: z.array(fieldInput) })
      .parse(req.body);

    if (groupId) {
      const group = await db().leadGroup.findUnique({ where: { id: groupId }, select: { id: true } });
      if (!group) return res.status(404).json({ error: "Lead group not found" });
    }

    // A custom column must never claim a Lead scalar's name, or two different
    // things would write to one place.
    const seen = new Set<string>();
    const cleaned = fields.map((field) => {
      let key = field.key.trim();
      if (!isBuiltinKey(key)) key = slugifyKey(key);
      let candidate = key;
      let suffix = 2;
      while (seen.has(candidate)) candidate = `${key}_${suffix++}`;
      seen.add(candidate);
      return { ...field, key: candidate, meta: (field.meta ?? null) as Prisma.InputJsonValue | null };
    });

    const saved = await replaceFields(groupId ?? null, cleaned);
    res.json({ scope: groupId ? "group" : "default", groupId: groupId ?? null, fields: saved });
  } catch (err) {
    next(err);
  }
});

// DELETE /leads/fields?groupId= — drops the override, falling back to the
// default set (or, for the default set, to the built-in columns).
leadsRouter.delete("/fields", async (req, res, next) => {
  try {
    const groupId = typeof req.query.groupId === "string" && req.query.groupId ? req.query.groupId : null;
    await db().leadField.deleteMany({ where: { groupId } });
    res.json(await resolveFields(groupId));
  } catch (err) {
    next(err);
  }
});

// --- Bulk actions ----------------------------------------------------------

// PATCH /leads/bulk — what you need after an import drops 200 rows at once.
leadsRouter.patch("/bulk", async (req, res, next) => {
  try {
    const { ids, status, groupId, addTags } = z
      .object({
        ids: z.array(z.string().cuid()).min(1, "Select at least one lead"),
        status: z.enum(LEAD_STATUSES).optional(),
        groupId: z.string().cuid().nullable().optional(),
        addTags: z.array(z.string()).optional(),
      })
      .parse(req.body);

    // "Unchecked" is the variant that accepts foreign keys like groupId directly.
    const data: Prisma.LeadUncheckedUpdateManyInput = {};
    if (status) data.status = status;
    if (groupId !== undefined) data.groupId = groupId;
    if (addTags?.length) data.tags = { push: addTags };

    if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to change" });

    const result = await db().lead.updateMany({ where: { id: { in: ids } }, data });
    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post("/bulk/delete", async (req, res, next) => {
  try {
    const { ids } = z.object({ ids: z.array(z.string().cuid()).min(1) }).parse(req.body);

    // The host gets to refuse — this is where an app whose proposals or
    // invoices point at leads says so, rather than the database raising a
    // foreign-key error nobody can read.
    const refusal = await getLeadsConfig().canDelete?.(ids);
    if (refusal) return res.status(409).json({ error: refusal });

    const result = await db().lead.deleteMany({ where: { id: { in: ids } } });
    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});

// --- Single lead -----------------------------------------------------------

leadsRouter.get("/:id", async (req, res, next) => {
  try {
    const lead = await db().lead.findUnique({
      where: { id: req.params.id },
      include: {
        group: true,
        activities: { orderBy: { occurredAt: "desc" } },
      },
    });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

/** `customFields` is free-form JSON to zod but typed JSON to Prisma. */
function toPrismaData<T extends { customFields?: Record<string, unknown> | null }>(input: T) {
  const { customFields, ...rest } = input;
  return {
    ...rest,
    ...(customFields === undefined ? {} : { customFields: (customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue }),
  };
}

leadsRouter.post("/", async (req, res, next) => {
  try {
    const data = leadInput.parse(req.body);
    const lead = await db().lead.create({ data: toPrismaData(data) });
    res.status(201).json(lead);
  } catch (err) {
    next(err);
  }
});

leadsRouter.patch("/:id", async (req, res, next) => {
  try {
    const prisma = db();
    const data = leadInput.partial().parse(req.body);
    // A patch of one custom value shouldn't drop the others, so the incoming
    // object is merged over what the lead already holds.
    if (data.customFields) {
      const current = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { customFields: true } });
      const previous = (current?.customFields as Record<string, unknown> | null) ?? {};
      data.customFields = { ...previous, ...data.customFields };
    }
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: toPrismaData(data) });
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

leadsRouter.delete("/:id", async (req, res, next) => {
  try {
    const refusal = await getLeadsConfig().canDelete?.([req.params.id]);
    if (refusal) return res.status(409).json({ error: refusal });

    await db().lead.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /leads/:id/convert — promotes a qualified lead to whatever the host
 * calls a customer, carrying the firmographics across so nothing has to be
 * retyped. Answers 501 when no `convertLead` is configured, because inventing
 * a destination for the record would be worse than saying it isn't wired up.
 */
leadsRouter.post("/:id/convert", async (req, res, next) => {
  try {
    const { convertLead } = getLeadsConfig();
    if (!convertLead) {
      return res.status(501).json({ error: "Converting leads isn't set up. Supply `convertLead` in the leads config." });
    }

    const prisma = db();
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.clientId) return res.status(409).json({ error: "This lead has already been converted" });

    const client = await convertLead(lead);
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { clientId: client.id, status: "CONVERTED" },
    });
    res.status(201).json({ client, lead: updated });
  } catch (err) {
    next(err);
  }
});

// POST /leads/:id/activities — log a call, email or meeting against the lead.
leadsRouter.post("/:id/activities", async (req, res, next) => {
  try {
    const data = z
      .object({
        type: z.enum(LEAD_ACTIVITY_TYPES).default("NOTE"),
        summary: z.string().min(1),
        outcome: z.string().optional().nullable(),
        occurredAt: z.coerce.date().optional(),
      })
      .parse(req.body);

    const actor = getLeadsConfig().resolveActor?.(req);
    const activity = await db().leadActivity.create({
      data: { ...data, leadId: req.params.id, actorId: actor?.id ?? null, actorName: actor?.name ?? null },
    });
    res.status(201).json(activity);
  } catch (err) {
    next(err);
  }
});
