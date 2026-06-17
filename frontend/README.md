<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# ContactSheet — Frontend

The web UI for [ContactSheet](../README.md): the admin dashboard (`/admin`), the public client
gallery (`/g/[share_token]`), and the first-run setup wizard. **Next.js 16** (App Router) +
TypeScript (strict) + Tailwind + shadcn/ui, with TanStack Query for server state and `next-intl`
for i18n.

> **Heads up:** this is not the Next.js you may know — see [`AGENTS.md`](AGENTS.md). Read the bundled
> guides under `node_modules/next/dist/docs/` before relying on training-data assumptions.

## Develop

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE → your backend (default http://localhost:8000)
npm install
npm run dev        # http://localhost:3000
```

The dev server proxies `/api/*`, `/uploads/*`, and `/branding/*` to the backend (see
[`next.config.ts`](next.config.ts)), so run the FastAPI backend on `:8000` alongside it (instructions
in the root [README](../README.md#development)).

```bash
npm run lint       # ESLint (next/core-web-vitals + TypeScript)
npm run build      # production build; also runs the tsc type-check
```

## Conventions

- **All backend calls go through [`src/lib/api.ts`](src/lib/api.ts)** — one typed `api` object
  namespaced by domain (`api.galleries.*`, `api.public.*`, …). Don't `fetch` the backend directly.
- **i18n** — message catalogs in [`messages/`](messages) (`en.json` is the source of truth). After
  editing them, validate: `node scripts/validate-i18n.mjs` (ICU + en↔de parity + key resolution).
- **App icons / favicon / manifest** are rendered by the backend from the instance branding
  (`/api/branding/*`); there are no static icon assets here. See
  [`docs/architecture/branding-aware-favicon.md`](../docs/architecture/branding-aware-favicon.md).

See [`CLAUDE.md`](CLAUDE.md) and the root [`CLAUDE.md`](../CLAUDE.md) for the full map of key files
and architecture notes.
