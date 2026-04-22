# react-router-demo

A minimal React Router v7 Framework Mode example that proves Prisma Next's Vite plugin re-emits contract artifacts on save, inside a real framework. Closes [April VP3](../../docs/planning/april-milestone.md).

## What this demonstrates

- `@prisma-next/vite-plugin-contract-emit` auto-emits `contract.json` + `contract.d.ts` on dev-server startup and on every contract edit.
- A React Router `loader` and `action` on `/` exercise the Prisma Next runtime against Postgres via the emitted contract.
- Editing `prisma/schema.prisma` (or `prisma/contract.ts`) while `pnpm dev` is running re-emits the artifacts — no manual `prisma-next contract emit`.

## Prerequisites

- Node ≥ 24
- A Postgres instance reachable via `DATABASE_URL`

## Quickstart

```bash
cp .env.example .env   # edit DATABASE_URL
pnpm install
pnpm db:init           # creates the prisma_contract.marker table + your model tables
pnpm dev
```

Open <http://localhost:5173>. Create a user via the form; the list revalidates after the action.

## Switching authoring surfaces

The same `prisma-next.config.ts` supports both PSL and TypeScript contract authoring, selected at dev-server startup by one env var:

```bash
# PSL (default) — watches prisma/schema.prisma
pnpm dev

# TypeScript — watches prisma/contract.ts
PRISMA_NEXT_CONTRACT_SOURCE=ts pnpm dev
```

Re-toggling mid-session requires restarting the dev server; the config is read once at startup.

## Proving the VP3 stop condition by hand

1. `pnpm dev`
2. Load <http://localhost:5173> and submit the form once to confirm the runtime works.
3. Edit `prisma/schema.prisma` — add a nullable column to `model User`, e.g. `nickname String?`.
4. Save. The dev server emits a new `src/prisma/contract.json` and `src/prisma/contract.d.ts` without any command.
5. Reload the page. The app still serves; types in your editor pick up the new field.

For the TypeScript path, start with `PRISMA_NEXT_CONTRACT_SOURCE=ts pnpm dev` and edit `prisma/contract.ts` instead.

## HMR and stale runtimes

This example caches the Prisma Next runtime on `globalThis` via a plain `getDb()` helper. When HMR re-runs `db.server.ts`, the cached runtime keeps serving — which means after a contract re-emit, the runtime still references the **previous** contract until the process restarts. That's a known footgun; [APR-VP3-07](../../projects/vite-vp3-auto-emit/tickets/apr-vp3-07-hmr-safe-runtime-helper.md) replaces the simple cache with a hash-keyed one.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Start Vite dev server with React Router and auto-emit |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm emit` | Explicit contract emit (normally unnecessary in dev) |
| `pnpm db:init` | Create the `prisma_contract.marker` table and your model tables |
| `pnpm test` | Run the smoke test |
| `pnpm typecheck` | `react-router typegen` + `tsc --noEmit` |
| `pnpm lint` | Biome |
