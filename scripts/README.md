# Scripts

Operational scripts used by the build/dev/deploy pipeline, plus a few maintenance utilities.
One-shot migration scripts that have already served their purpose live in [`archive/`](archive/).

## Pipeline scripts (referenced by package.json — do not delete)

| Script | Used by | What it does |
| --- | --- | --- |
| `dev.mjs` | `npm run dev` | Starts web (port 3000) and API (port 5000) dev servers together. |
| `use-source-index.mjs` | `npm run dev:web`, `npm run build` | Ensures `packages/web/index.html` points at the source entry before Vite runs. |
| `sync-pages.mjs` | `npm run build`, `npm run build:web` | Copies the Vite build output (`packages/web/dist`) to the root-level gh-pages artifacts (`/index.html`, `/assets`, `/404.html`, `/.nojekyll`). |
| `copy-web-dist-to-api-public.mjs` | API build (Railway) | Copies `packages/web/dist` into `packages/api/.railway-build/public` so the API serves the SPA. |

## Maintenance utilities (run manually)

| Script | Usage | What it does |
| --- | --- | --- |
| `set-production-api.mjs` | `node scripts/set-production-api.mjs https://your-app.example.com` | Points the web build at a production API base URL. |
| `check-dummy-data.cjs` | `node scripts/check-dummy-data.cjs` | Scans the frontend for hardcoded dummy metrics / lorem / placeholder data before release. |
| `clean-temp.mjs` | `node scripts/clean-temp.mjs` | Deletes `tmp_*` scratch files from the repo root. |
| `generate-pricing-doc.mjs` | `node scripts/generate-pricing-doc.mjs` | Regenerates `PRICING_FINANCIALS.docx` (gitignored output). |
| `generate-system-doc.mjs` | `node scripts/generate-system-doc.mjs` | Regenerates `SYSTEM_OVERVIEW.docx` (gitignored output). |

## archive/

One-shot codemod scripts from the era when the backend lived in a single `server.ts`.
Each `extract-*.mjs` cut a route module out of `server.ts`; each `wire-*.mjs` mounted a new
module into it. They are kept for historical reference only — **running them again would
corrupt the current modular code in `packages/api/src/server/`.**
