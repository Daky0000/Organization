# Leads module — how it is wired into ContentFlow

This directory is **vendored third-party code**, copied from `leads-module` and
adapted as little as possible. `UPSTREAM-README.md` is its own documentation —
the API surface, the column system, the filter query string — and is still
accurate. This file only records what the host does around it, and the handful
of places the source itself was changed.

## The seams

| Concern | Where |
|---|---|
| Mounting, config hooks, error shaping | `../leadgenRoutes.ts` |
| Prisma client, tenancy, request context | `../leads-tenancy.ts` |
| Schema | `packages/api/prisma/schema.prisma` |
| Tables | `packages/api/src/db-migrations.ts` → `createLeadgenTables` |
| React pages | `packages/web/src/components/leads` + `pages/MarketingLeads*.tsx` |
| Host shell for the UI | `packages/web/src/components/LeadsModuleHost.tsx` |

Mounted at **`/api/leadgen`** — `/leads` and `/imports` beneath it. Not
`/api/leads`: that path already belongs to the Contacts feature's lead groups
(`../leadsRoutes.ts`), which is a different thing with its own live UI.

## Tenancy

The module has no concept of a user — it was extracted from a single-tenant app,
so every query it makes reads "all leads". The host is multi-tenant.

Rather than edit ~1,600 lines of query code (which is where cross-tenant leaks
come from, and which would fork this copy from upstream forever), `userId` is
injected by a Prisma client extension in `../leads-tenancy.ts`: into `where` on
reads, into `data` on writes, for all five models. The request's user comes from
an `AsyncLocalStorage` store that `withLeadsTenant` fills in after
authenticating. Outside that context, queries **throw** rather than running
unscoped.

Consequences worth knowing:

- `userId` is `@default("")` in the schema so the module's create calls still
  compile. It is never written — the extension always overwrites it — and the
  column has a foreign key to `users(id)`, so a `""` that somehow escaped is
  rejected by Postgres instead of becoming an invisible orphan row.
- The unique constraints that were global upstream are now per-user:
  `Lead.dedupeKey`, `LeadGroup.slug`, `LeadField(groupId, key)`. Global ones
  would let one user's import collide with — or upsert into — another's rows.

## Changes to the vendored source

Each one is marked `HOST PATCH` in place. There are four:

1. `routes/leads.ts` — `POST /groups` was one `upsert({ where: { slug } })`.
   `slug` is unique per user here, not globally, so it is now find-then-write.
2. `services/leadImport.ts` — `uniqueSlug` used `findUnique({ where: { slug } })`
   for the same reason; now `findFirst`, which the extension scopes.
3. `web/components/leads/lib/api.ts` — sends the host's JWT as a bearer token
   instead of relying on a session cookie, and gained a `download` helper.
4. `web/components/leads/pages/Leads.tsx` — the Excel/PDF exports were plain
   `<a href>` links, which cannot carry an auth header; they now fetch and save
   the blob.

Nothing else was touched. Keep it that way — patches are what make the next
upstream update expensive.

## Not wired up (optional by design)

Both are hooks the module treats as optional, and it degrades honestly without
them — `GET /imports/status` reports what is available and the wizard adapts.

- **`analyst`** — an LLM that reads messy workbooks. Without it, imports are
  mapped by the pattern rules in `services/sheetPlan.ts`, which is a complete
  feature. The host already has `@anthropic-ai/sdk`, so this is a small job.
- **`drive`** — a remote file source. Without it, imports are uploads only. The
  host already has Google Sheets OAuth (`google_sheets_tokens`, `../leadsRoutes.ts`).
- **`convertLead`** — "convert to customer". Omitted, so `POST /leads/:id/convert`
  answers 501. Wiring it to CRM companies/deals would make sense.
- **`canDelete`**, **`onLeadsCreated`** — no host rules to enforce yet.

## After changing anything here

```bash
npm --workspace @contentflow/api run typecheck:leads   # the package tsconfig can't compile — see tsconfig.leads.json
npm --workspace @contentflow/api run prisma:generate   # after any schema.prisma change
npm test                                               # includes test/leadgen-routes.test.ts
```

If you change `prisma/schema.prisma`, regenerate the DDL and update
`createLeadgenTables` to match:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

The tables are created by the host's own migration runner, not `prisma migrate`,
so that the project keeps one migration path. That output has no idempotency
guards — re-apply them by hand.

## Upload size

Spreadsheets ride in the JSON body as base64. The module's own router asks for a
28 MB limit, but the app-level `express.json({ limit: '20mb' })` in `server.ts`
runs first and wins, so the practical ceiling is about 15 MB of spreadsheet once
encoded. Raising it means raising the global limit for every route — think
before doing that.
