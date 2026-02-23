# Prisma Next Demo

This example demonstrates **Prisma Next in its native form**, using the Prisma Next APIs directly without the compatibility layer.

## Purpose

This demo shows:
- Using Prisma Next's query lanes (SQL DSL, Raw SQL, etc.)
- Creating Plans and executing them via the Runtime
- Contract verification and marker management
- Native Prisma Next patterns and best practices
- **Two workflows**: Emit workflow (JSON-based) and No-Emit workflow (TypeScript-based)
- Client-generated UUID identifiers via `@prisma-next/ids`

## Comparison

- **`prisma-next-demo`** (this example): Shows Prisma Next native APIs
- **`prisma-orm-demo`**: Shows using Prisma Next via the compatibility layer (mimics legacy Prisma Client API)

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
# Emit contract artifacts first
pnpm emit

# Then run the app
pnpm start -- users
```

### 2. No-Emit Workflow

Uses contract directly from TypeScript:

- **Files**: `src/prisma-no-emit/runtime-no-emit.ts`, `src/prisma-no-emit/context-no-emit.ts`, `src/main-no-emit.ts`
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

3. Seed the database:
   ```bash
   pnpm seed
   ```

4. Run tests:
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
- `src/prisma-no-emit/context-no-emit.ts` - Env-free execution stack/context + query roots (no-emit workflow)
- `src/prisma-no-emit/runtime-no-emit.ts` - Runtime factory (no-emit workflow)
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

