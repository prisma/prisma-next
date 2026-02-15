# Prisma Next Demo

This example demonstrates **Prisma Next in its native form**, using the Prisma Next APIs directly without the compatibility layer.

## Purpose

This demo shows:
- Using Prisma Next's query lanes (SQL DSL, Raw SQL, etc.)
- Creating Plans and executing them via the Runtime
- Contract verification and marker management
- Native Prisma Next patterns and best practices
- ORM client end-to-end examples using `@prisma-next/sql-orm-client`
- **Two workflows**: Emit workflow (JSON-based) and No-Emit workflow (TypeScript-based)
- Client-generated UUID identifiers via `@prisma-next/ids`

## Comparison

- **`prisma-next-demo`** (this example): Shows Prisma Next native APIs
- **`prisma-orm-demo`**: Shows using Prisma Next via the compatibility layer (mimics Prisma 7 API)

## Workflows

This demo includes two runtime implementations demonstrating different approaches:

### 1. Emit Workflow (Default)

Uses emitted `contract.json` and `contract.d.ts` files with the Postgres one-liner client. The emitted workflow uses `Contract` and `TypeMaps` explicitly: `postgres<Contract, TypeMaps>({ contractJson, url })`.

- **Files**: `src/prisma/db.ts`, `src/main.ts`
- **Contract source**: `src/prisma/contract.json` (emitted from `prisma/contract.ts`)
- **Usage**: `pnpm start -- [command]`
- **Benefits**:
  - Contract is validated and normalized at emit time
  - JSON can be loaded from external sources
  - Type definitions are separate from runtime code

**Setup**:
```bash
pnpm emit
pnpm db:init   # Creates schema + contract marker
pnpm seed
pnpm start -- users
```

### 2. No-Emit Workflow

Uses contract directly from TypeScript:

- **Files**: `src/prisma-no-emit/runtime.ts`, `src/prisma-no-emit/context.ts`, `src/main-no-emit.ts`
- **Contract source**: `prisma/contract.ts` (direct import)
- **Usage**: `pnpm start:no-emit -- [command]`
- **Benefits**:
  - No emit step required - contract is used directly
  - Full type safety from TypeScript
  - Simpler workflow for development

**Usage**:
```bash
# No emit step needed - just run the app
pnpm start:no-emit -- users
```

## Architecture

```mermaid
flowchart LR
  Contract[Contract artifacts] --> Db[postgres(...)]
  Db --> Static[Static roots]
  Db --> Lazy[runtime()]
  Lazy --> Runtime[Runtime]
```

Contract artifacts are `contract.json` and `contract.d.ts`. Static roots are `sql`, `schema`, `orm`, `context`, and `stack`.

## Related Docs

- **[Query Lanes](../../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)** — DSL and ORM authoring surfaces
- **[Runtime & Plugin Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Plugin%20Framework.md)** — Runtime execution pipeline
- **[ADR 164 - Repository Layer](../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md)** — Multi-query repository orchestration layer

## ORM Client Examples

The demo includes ORM client examples under `src/orm-client/`:

- `ormClientGetUsers(limit, runtime)` — list users using ORM client API
- `ormClientGetAdminUsers(limit, runtime)` — filter through a custom collection scope
- `ormClientFindUserByEmail(email, runtime)` — `first()` with collection helpers
- `ormClientGetUserPosts(userId, limit, runtime)` — fetch user posts with collection filters + ordering
- `ormClientGetDashboardUsers(emailDomain, postTitleTerm, limit, postsPerUser, runtime)` — compound `and/or/not` filters + relation filters + `select()` and `include()` composition
- `ormClientGetPostFeed(postTitleTerm, limit, runtime)` — to-one include (`post -> user`) with projected fields
- `ormClientGetUsersByIdCursor(cursor, limit, runtime)` — cursor pagination with `orderBy()` + `cursor()`
- `ormClientGetLatestUserPerKind(runtime)` — `distinctOn()` with deterministic ordering
- `ormClientGetUserInsights(limit, runtime)` — `include().combine()` metrics and latest related row
- `ormClientGetUserKindBreakdown(minUsers, runtime)` — `groupBy().having().aggregate()` breakdown
- `ormClientUpsertUser(data, runtime)` — `upsert()` for create-or-update by primary key

Run from the CLI:

```bash
pnpm start -- repo-users 5
pnpm start -- repo-admins 5
pnpm start -- repo-user admin@example.com
pnpm start -- repo-posts user_001 10
pnpm start -- repo-dashboard example.com post 10 2
pnpm start -- repo-post-feed post 10
pnpm start -- repo-users-cursor user_001 5
pnpm start -- repo-latest-per-kind
pnpm start -- repo-user-insights 5
pnpm start -- repo-kind-breakdown 1
pnpm start -- repo-upsert-user 00000000-0000-0000-0000-000000000099 demo@example.com user
```

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up your database connection:
   - Create a `.env` file
   - Add your PostgreSQL connection string: `DATABASE_URL=postgresql://user:pass@localhost:5432/prisma_next_demo?schema=public`
   - **Note**: This demo uses the pgvector extension. Ensure pgvector is installed in your PostgreSQL database:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     ```
     The seed script will create the extension automatically if it doesn't exist.

3. Emit contract and initialize database:
   ```bash
   pnpm emit
   pnpm db:init
   ```

4. Seed the database:
   ```bash
   pnpm seed
   ```

5. Run tests:
   ```bash
   pnpm test
   ```

## Browser Visualization

Run `pnpm dev` for the Vite app that visualizes the contract. It renders directly from the constructed Contract (`validateContract` output), with HMR when contract.json is re-emitted. See `src/entry.ts`.

## Key Files

- `prisma/contract.ts` - Contract definition (source of truth)
- `src/prisma/contract.json` - Emitted contract (emit workflow only)
- `src/prisma/contract.d.ts` - Emitted types (emit workflow only)
- `src/prisma/db.ts` - One-liner Postgres client + query roots (emit workflow)
- `src/prisma-no-emit/context.ts` - Env-free execution stack/context + query roots (no-emit workflow)
- `src/prisma-no-emit/runtime.ts` - Runtime factory (no-emit workflow)
- `src/orm-client/client.ts` - ORM client + custom collection scopes
- `src/orm-client/*.ts` - End-to-end ORM client query examples
- `src/main.ts` - App entrypoint with arktype config validation (emit workflow)
- `src/main-no-emit.ts` - App entrypoint with arktype config validation (no-emit workflow)
- `src/entry.ts` - Browser visualization (validates contract, renders from constructed Contract)
- `scripts/stamp-marker.ts` - Contract marker management
- `scripts/seed.ts` - Database seeding (includes vector embeddings)
- `src/queries/similarity-search.ts` - Example vector similarity search query
- `test/` - Integration tests demonstrating Prisma Next usage

## Features Demonstrated

- **Vector Similarity Search**: The demo includes a `similarity-search.ts` query that demonstrates cosine distance operations using the pgvector extension pack.
- **Extension Packs**: Shows how to configure and use extension packs (pgvector) in `prisma-next.config.ts`.
- **Kysely Lane Parity**: `src/kysely/` contains Kysely equivalents for demo queries:
  - `get-user-by-id.ts`
  - `get-user-posts.ts`
  - `get-users.ts`
  - `get-users-with-posts.ts`
  - `dml-operations.ts`
  - `insert-user-transaction.ts`
  - `delete-without-where.ts`
  - `get-all-posts-unbounded.ts`
  - `update-without-where.ts`
  - Run commands:
    - `pnpm start -- user-kysely <id>`
    - `pnpm start -- posts-kysely <userId>`
    - `pnpm start -- users-kysely`
    - `pnpm start -- users-with-posts-kysely`
    - `pnpm start -- dml-kysely`
    - `pnpm start -- user-transaction-kysely`
    - `pnpm start -- guardrail-delete-kysely`
  - Additional guardrail examples (`update-without-where.ts`, `get-all-posts-unbounded.ts`) are available in `src/kysely/` for direct invocation from tests or scripts.
