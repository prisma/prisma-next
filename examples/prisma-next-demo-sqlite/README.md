# Prisma Next Demo (SQLite)

This example mirrors `prisma-next-demo` but targets **SQLite** via
`@prisma-next/sqlite`. It only includes queries and patterns that make sense
on SQLite — pgvector similarity search, `DISTINCT ON`, native enums, and the
`ilike` operator are intentionally not ported (SQLite either lacks the
feature or has a different idiomatic equivalent).

## What's included

- TypeScript contract authoring (`prisma/contract.ts`)
- Emit workflow (`src/prisma/db.ts` + emitted `contract.json` / `contract.d.ts`)
- No-emit workflow (`src/prisma-no-emit/`)
- SQL DSL queries (`src/queries/`)
- ORM client examples (`src/orm-client/`)
- Telemetry middleware
- Integration tests against a temporary SQLite file database

## What was dropped vs. the Postgres demo

| Original feature | Reason it's not ported |
|---|---|
| pgvector vector type / cosine-distance similarity | SQLite has no pgvector |
| `similarity-search`, `cross-author-similarity`, `find-similar-posts`, `search-posts-by-embedding` | Depend on pgvector |
| `get-latest-user-per-kind` (`distinctOn`) | SQLite has no `DISTINCT ON` |
| `Task` / `Bug` / `Feature` polymorphic models (`@@discriminator`, `@@base`) | PSL-only authoring; this demo uses TS contract authoring |
| `@@enum user_type` | SQLite has no native enums (`enums: false`); `kind` is plain text |
| `ilike` in collection scopes | SQLite has no `ILIKE`; `LIKE` is case-insensitive for ASCII by default |
| `budgets()` middleware + `budget-violation` command | SQLite has no LATERAL, so ORM `include().take(...)` falls back to N+1 sub-queries with no LIMIT — strict budget enforcement would reject those, hiding the rest of the demo. |
| `lints()` middleware + `guardrail-delete` command | Removed alongside `budgets()` — see the SQL-family demo for the lint guardrail walkthrough. |
| React contract viewer (`src/app/`) | Out of scope for this demo |

## Setup

```bash
pnpm install
pnpm emit                  # generates src/prisma/contract.json + contract.d.ts
SQLITE_PATH=./demo.db pnpm db:init
SQLITE_PATH=./demo.db pnpm seed
```

Drop the database with `pnpm db:drop` (removes the SQLite file).

## Run the CLI

```bash
SQLITE_PATH=./demo.db pnpm start -- users
SQLITE_PATH=./demo.db pnpm start -- repo-users 5
SQLITE_PATH=./demo.db pnpm start -- repo-admins 5
SQLITE_PATH=./demo.db pnpm start -- repo-user alice@example.com
SQLITE_PATH=./demo.db pnpm start -- repo-dashboard example.com Post 10 2
SQLITE_PATH=./demo.db pnpm start -- repo-post-feed Post 10
SQLITE_PATH=./demo.db pnpm start -- repo-users-cursor "" 5
SQLITE_PATH=./demo.db pnpm start -- repo-user-insights 5
SQLITE_PATH=./demo.db pnpm start -- repo-kind-breakdown 1
SQLITE_PATH=./demo.db pnpm start -- repo-upsert-user 00000000-0000-0000-0000-000000000099 demo@example.com user
```

No-emit workflow:

```bash
SQLITE_PATH=./demo.db pnpm start:no-emit -- users
SQLITE_PATH=./demo.db pnpm start:no-emit -- users-with-posts 5
```

## Tests

```bash
pnpm test
```

The integration suite spins up a temporary file-based SQLite database per
test (under `os.tmpdir()`), applies the contract via `dbInit`, and exercises
each ORM-client example end-to-end.

## Key files

- `prisma/contract.ts` — TypeScript contract (User, Post, foreign keys)
- `prisma-next.config.ts` — CLI config wiring SQLite target/adapter/driver
- `src/prisma/db.ts` — `sqlite()` one-liner client (emit workflow)
- `src/prisma-no-emit/` — Hand-wired execution stack (no-emit workflow)
- `src/orm-client/` — ORM client examples
- `src/queries/` — SQL DSL examples
- `scripts/seed.ts` — Demo seed
- `scripts/drop-db.ts` — Removes the SQLite file (and any WAL/SHM sidecars)
