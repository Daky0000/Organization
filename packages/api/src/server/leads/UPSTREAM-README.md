# Leads module

A lead pipeline you can drop into another application: an Express + Prisma API,
a React front end, spreadsheet import, and Excel/PDF export.

The thing that makes it worth reusing is the **column system**. A lead has
built-in columns that address a `Lead` scalar (`contactName`, `city`, …) and
custom columns that live in `Lead.customFields`. Which columns exist, what
they're called and what order they're in is a database row, not code — and a
batch of leads can override the whole set. That's what lets a spreadsheet whose
columns are "Alternate Phone" and "Call outcome" keep every one of them, and two
batches imported from one workbook look nothing like each other.

Extracted from Dakyworld OS and decoupled: nothing here references a model,
route or user system outside this package.

---

## What's in it

| | |
|---|---|
| **Leads API** | Filter, sort, page, group, bulk-edit, inline-edit, delete |
| **Column system** | Per-batch column sets, custom fields, an editor UI |
| **Spreadsheet import** | Multi-table detection, a plan you correct before it runs, de-duplication, refresh-don't-overwrite |
| **Export** | Excel (one sheet per batch, every column) and printable PDF, of exactly the filtered view |
| **Contact log** | Calls, emails, meetings against a lead |
| **React UI** | `<Leads />` and `<LeadImport />`, plus the components they're built from |
| **Scraper mapping** | Optional pure functions for turning a scraped record into a lead |

**Not included** (they were Dakyworld-specific and are the host's job): user
accounts and auth, proposals/invoices/projects, email sending, and the Apify
scraper runner. Each one that the module used to touch is now a hook — see
[Configuration](#configuration).

---

## Install

```bash
npm install ./leads-module          # or copy the folder into your repo
npm install exceljs pdfkit zod      # if you vendored rather than installed
```

Peer dependencies: `@prisma/client` (5.20+) and `express` 4. The React side
additionally needs `react` 18+ and `@tanstack/react-query` 5.

---

## 1. Schema

Paste [`prisma/leads.prisma`](prisma/leads.prisma) into your own
`schema.prisma`, below your `datasource` and `generator` blocks, then:

```bash
npx prisma migrate dev --name add_leads
npx prisma generate
```

It adds five models — `Lead`, `LeadGroup`, `LeadField`, `LeadActivity`,
`LeadImport` — and six enums. Nothing in it references a model outside itself,
so it won't collide with what you already have. If any of those names is
already taken in your schema, rename it in the fragment and in the matching
`prisma.<model>` calls in `src/`.

Two columns are deliberately *not* foreign keys:

- **`Lead.clientId`** — set by your `convertLead` hook. Add a real relation to
  your own customer model if you want referential integrity.
- **`Lead.scraperSourceId` / `scraperRunId`** — free-form provenance, filterable
  via `?scraperSourceId=`, for anyone wiring in a scraper.

## 2. Server

```ts
import express from "express";
import { PrismaClient } from "@prisma/client";
import { configureLeads, leadsRouter, importsRouter } from "leads-module";

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

configureLeads({ prisma });

app.use("/api/leads", leadsRouter);
app.use("/api/imports", requireAdmin, importsRouter);   // your guard
```

That is the whole minimum. The module never constructs its own Prisma client —
it shares yours, and therefore your connection pool.

`configureLeads` must run before the routers handle a request; calling a route
without it throws a message saying so.

**Auth is yours.** The module ships no authentication and checks none. Mount the
routers behind your own middleware. `/api/imports` in particular parses 28 MB
bodies and can spend money on an analyst call — put it behind your strictest
guard.

## 3. Front end

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Leads, LeadImport, configureLeadsUi } from "leads-module/client";
import "leads-module/client/leads.css";

configureLeadsUi({ apiBase: "/api", currency: "USD" });

<QueryClientProvider client={queryClient}>
  <Leads />
</QueryClientProvider>
```

Add the Tailwind preset and — this is the one people miss — the module's own
path to `content`, or Tailwind never sees its class names and the pages render
unstyled:

```js
// tailwind.config.js
module.exports = {
  presets: [require("leads-module/client/tailwind-preset.cjs")],
  content: ["./src/**/*.{ts,tsx}", "./node_modules/leads-module/client/**/*.{ts,tsx}"],
};
```

The preset defines five colours — `ink`, `ivory`, `gold`, `bronze`, `slate`.
Every class in the module is written in terms of them, so defining those five
names yourself instead of using the preset re-skins the whole thing.

The UI ships as TSX, not a bundle, on purpose: it has to compile against *your*
React and *your* Tailwind, or you get two React copies and a class layer that
doesn't cascade.

**No router required.** The open lead is kept in the URL through the History
API, so the pages work under React Router, TanStack Router, Next's app router,
or nothing at all.

---

## Configuration

Everything except `prisma` is optional, and each one left out disables exactly
one feature rather than breaking anything else. Full types in
[`src/config.ts`](src/config.ts).

```ts
configureLeads({
  prisma,

  /** Branding for the generated Excel and PDF files. */
  export: { brandName: "Acme", ink: "#111", accent: "#2563EB" },
  exportLimit: 5000,

  /** Fires after an import writes new leads. Failures are logged, not thrown. */
  onLeadsCreated: (leadIds) => enrolInSequence(leadIds),

  /** What "convert to customer" means here. Omitted → the route answers 501. */
  convertLead: (lead) => prisma.customer.create({ data: { name: lead.contactName } }),

  /** Refuse a delete with a message a person can act on. */
  canDelete: async (ids) => {
    const held = await prisma.quote.count({ where: { leadId: { in: ids } } });
    return held ? `${held} of these have quotes. Mark them LOST instead.` : null;
  },

  /** Who is acting, for the contact log's byline. */
  resolveActor: (req) => req.user && { id: req.user.id, name: req.user.name },

  /** An LLM that reads messy workbooks. Omitted → pattern rules only. */
  analyst: { configured: () => true, analyze: async (grids, hints) => ({ plan, model }) },

  /** A remote file source. Omitted → uploads only. */
  drive: { connected: () => true, listFiles, getFile, listTabs, readGrids },
});
```

### Errors from your hooks

Throw `LeadsHttpError(status, message)` for anything the person doing the import
should read — a rejected API key, a deleted file. Anything else your hooks throw
is treated as a bug and reaches your app's error handler as a 500, which is the
right default: an unexpected failure should be loud, not rendered as advice.

---

## API

Paths are relative to wherever you mounted each router.

### Leads

| Method | Path | |
|---|---|---|
| `GET` | `/` | Filtered, sorted, paged. See [Filtering](#filtering). |
| `GET` | `/stats` | Counters plus the distinct values the filter bar offers, in one call |
| `GET` | `/export?format=xlsx\|pdf` | The current view as a file — same query string as `GET /` |
| `POST` | `/` | Create |
| `GET` | `/:id` | One lead, with its batch and contact history |
| `PATCH` | `/:id` | Update. `customFields` merges rather than replaces |
| `DELETE` | `/:id` | Delete, subject to `canDelete` |
| `PATCH` | `/bulk` | `{ ids, status?, groupId?, addTags? }` |
| `POST` | `/bulk/delete` | `{ ids }` |
| `POST` | `/:id/convert` | Promote to a customer via `convertLead` |
| `POST` | `/:id/activities` | Log a call/email/meeting |

### Batches and columns

| Method | Path | |
|---|---|---|
| `GET` `POST` | `/groups` | List / create a batch |
| `PATCH` `DELETE` | `/groups/:id` | Rename / delete. **Deleting a batch never deletes its leads** — they become Ungrouped |
| `GET` | `/fields?groupId=` | The columns this view should render, plus every built-in for the picker |
| `PUT` | `/fields` | Replace a scope's whole column set |
| `DELETE` | `/fields?groupId=` | Drop the override and fall back |

### Imports

| Method | Path | |
|---|---|---|
| `GET` | `/status` | Whether an analyst and a drive are available |
| `POST` | `/sheets` | Tab names for an upload, before a full read |
| `POST` | `/analyze` | Read the file, return a plan. **Writes no leads** |
| `POST` | `/:id/preview` | Re-run an edited plan. **Writes no leads** |
| `POST` | `/:id/commit` | Run the approved plan |
| `GET` | `/` `/:id` | Import history |
| `DELETE` | `/:id` | Delete the record. Keeps the leads |

### Filtering

`GET /` and `GET /export` take the same query string:

```
?q=dental&status=NEW,QUALIFYING&source=DIRECTORY&groupId=<id|none>
&city=Accra&category=Clinic&minScore=60&has=email,phone,noWebsite
&sort=newest|oldest|score|name|reviews|rating&take=300&skip=0
```

---

## How the pieces work

**Column sets resolve in three steps.** A batch's own `LeadField` rows win; then
the saved default set (`groupId = null`); then the built-ins in
`src/services/leadFields.ts`. `GET /fields` returns which of the three you're
looking at as `scope`, so the editor can say whether a change affects one batch
or all of them.

**Imports are a plan, not a parse.** A real lead sheet has a title banner, blank
spacer rows, a block of people, and further down a block of companies with
different columns. `POST /analyze` describes the file as a list of tables — each
with its own header row, row range and column mapping — and returns it for
correction. Nothing is written until `/commit`. Each table becomes its own batch
with its own columns.

**Re-importing refreshes.** Every lead gets a `dedupeKey` — email, else website
domain, else phone, else name+city — which is unique. A second import of an
updated sheet updates the same leads, and only the fields the sheet actually
filled in, so it can never blank out something typed in by hand.

**Exports mirror the view.** Same filters, same column set, one worksheet per
batch — because two batches with different columns can't share a sheet without
one of them losing columns.

---

## Layout

```
prisma/leads.prisma          paste into your schema
prisma/schema.prisma         generated; standalone use only

src/config.ts                every hook, and the only file you must read
src/index.ts                 public exports
src/routes/leads.ts          the leads API
src/routes/imports.ts        the import wizard's API
src/services/leadFields.ts   the column system + value coercion
src/services/leadImport.ts   running an approved plan
src/services/leadExport.ts   xlsx + pdf
src/services/sheetPlan.ts    table detection, plan validation
src/services/spreadsheet.ts  xlsx/csv → string[][]
src/services/leadMapping.ts  optional: scraped record → lead

client/index.ts              public exports
client/pages/Leads.tsx       the pipeline page
client/pages/LeadImport.tsx  the import wizard
client/components/           LeadColumns, LeadDrawer, ui
client/lib/                  api client, types, ui config
client/tailwind-preset.cjs   the five theme colours

example/server.ts            smallest working server
example/App.tsx              smallest working front end
```

## Working on the module itself

```bash
npm install          # node_modules is not shipped — install before running anything
npm run generate     # rebuild schema.prisma from the fragment, then prisma generate
npm run typecheck    # server + client
npm run build        # → dist/
npm run smoke        # end-to-end check, no database needed
```

`npm run smoke` runs [`example/smoke.mjs`](example/smoke.mjs): it feeds a
deliberately messy CSV (title banner, two stacked tables, a column the schema
has never heard of) through detection, planning and preview, checks value
coercion and de-duplication, renders a real `.xlsx` and `.pdf`, and mounts both
routers against a stand-in Prisma client. Worth running first — it proves the
module works before you touch your own database.

`prisma/schema.prisma` is generated from `prisma/leads.prisma` by
`scripts/build-schema.mjs` — edit the fragment, never the generated file.
