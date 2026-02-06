# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Prisma Next?

Prisma Next is a **contract-first data access layer** that replaces traditional ORMs with a machine-readable, agent-friendly approach:

- **Contract-first**: Schema becomes a verifiable data contract (deterministic JSON + cryptographic hash), not just a schema
- **Lightweight generation**: Emits types and contract JSON instead of heavy client code
- **Composable DSL**: Runtime query builder instead of generated methods
- **Agent-accessible**: Machine-readable IR, structured plans, and explicit APIs enable AI coding assistants

**Key difference from Prisma ORM:** Instead of generating an opaque `PrismaClient`, Prisma Next emits lightweight types and a contract artifact, then uses a composable runtime DSL for queries.

## Development Commands

### Build & Development
```bash
pnpm build                              # Build all packages
pnpm dev                                # Watch mode for all packages
```

### Testing
```bash
pnpm test                               # All tests via Turbo
pnpm test:packages                      # Packages only (exclude examples)
pnpm test:examples                      # Example apps only
pnpm test:integration                   # Integration tests
pnpm test:e2e                           # End-to-end tests
pnpm test:coverage                      # All tests with coverage
pnpm coverage:packages                  # Coverage for packages only

# Test specific package
pnpm --filter @prisma-next/sql-runtime test
pnpm --filter @prisma-next/sql-runtime test --watch
```

### Type Checking & Linting
```bash
pnpm typecheck                          # Type check all packages
pnpm lint                               # Lint all packages
pnpm lint:fix                           # Auto-fix with Biome
pnpm lint:deps                          # Validate architectural boundaries
```

## Core Architecture

### Domain → Layer → Plane Model

Prisma Next organizes packages using a three-dimensional architecture:

**Domains** (what family of functionality):
- `packages/framework/` - **Framework**: Target-agnostic core (contracts, operations, runtime-executor)
- `packages/sql/` - **SQL Family**: SQL-specific implementations (operations, lanes, runtime)
- `packages/targets/` - **Targets**: Concrete adapters and drivers (postgres-adapter, postgres-driver)
- `packages/extensions/` - **Extensions**: Optional capability packs (pgvector)

**Layers** (what responsibility within domain):
```
Core → Authoring → Targets → Lanes → Runtime Core → Family Runtime → Adapters
```
Dependencies flow downward; lateral dependencies within the same layer are allowed.

**Planes** (when does it run):
- **Shared**: Code usable by both migration and runtime
- **Migration**: Build-time authoring, emission, and planning (CLI, emitter, control plane)
- **Runtime**: Execution-time query building and execution (DSL, executor, adapters)

See [architecture.config.json](../architecture.config.json) for the complete domain/layer/plane mappings.

### Contract-First Design

**Contract** = Deterministic JSON artifact that describes the database schema:
- Generated from PSL or TypeScript via `prisma-next emit`
- Contains `contractHash` (cryptographic identifier) for verification
- Distributed alongside TypeScript types (`.d.ts`)
- Enables drift detection, versioning, and agent accessibility

**Plan** = Immutable, auditable query object:
- Created by query DSL, compiled to SQL AST
- Contains AST, SQL, parameters, contract hash
- Verifiable before execution (no hidden behaviors)
- Machine-readable for agents and tooling

### Package Organization

```
prisma-next/
├── packages/
│   ├── framework/              # Target-agnostic (contract, operations, cli, runtime-executor)
│   ├── sql/                    # SQL family (sql-contract, sql-operations, sql-lane, sql-runtime)
│   ├── targets/                # Concrete implementations (postgres-adapter, postgres-driver)
│   └── extensions/             # Extension packs (pgvector)
├── examples/
│   ├── prisma-next-demo/       # Main demo using Prisma Next
│   └── prisma-orm-demo/        # Prisma ORM compatibility demo
├── test/
│   ├── integration/            # Integration test suite
│   └── e2e/                    # End-to-end test suite
└── docs/
    └── architecture docs/      # Complete architectural design (140+ ADRs)
```

## Critical Patterns

### Always Apply

Read the architecture overview before writing code:
```
@.cursor/rules/schema-driven-architecture.mdc
```

Package placement rules (SQL family vs concrete targets):
```
@.cursor/rules/directory-layout.mdc
```

No barrel files - use explicit imports:
```
@.cursor/rules/no-barrel-files.mdc
```

Multi-plane package structure (`src/core/`, `src/exports/control.ts`, `src/exports/runtime.ts`):
```
@.cursor/rules/multi-plane-packages.mdc
```

Test descriptions omit "should":
```
@.cursor/rules/omit-should-in-tests.mdc
```

### Testing Patterns

Testing guide and patterns:
```
@.cursor/rules/testing-guide.mdc
@.cursor/rules/test-import-patterns.mdc
@.cursor/rules/test-file-organization.mdc
```

Use factory functions for AST and Contract IR objects:
```
@.cursor/rules/use-ast-factories.mdc
@.cursor/rules/use-contract-ir-factories.mdc
```

### Imports & Architecture

Plane boundary enforcement (shared/migration/runtime):
```
@.cursor/rules/import-validation.mdc
@.cursor/rules/shared-plane-packages.mdc
@.cursor/rules/multi-plane-entrypoints.mdc
```

### SQL & Query Patterns

Query DSL patterns and best practices:
```
@.cursor/rules/query-patterns.mdc
@.cursor/rules/postgres-lateral-patterns.mdc
@.cursor/rules/include-many-patterns.mdc
```

### TypeScript Patterns

TypeScript conventions and Arktype usage:
```
@.cursor/rules/typescript-patterns.mdc
@.cursor/rules/arktype-usage.mdc
@.cursor/rules/validate-contract-usage.mdc
@.cursor/rules/type-extraction-from-contract.mdc
```

### Complete Rule Index

See [.cursor/rules/README.md](.cursor/rules/README.md) for the complete index of all cursor rules organized by category.

## Architecture Validation

**Architectural boundaries** are enforced by dependency-cruiser:
```bash
pnpm lint:deps
```

Configuration lives in:
- [architecture.config.json](../architecture.config.json) - Domain/Layer/Plane mappings
- [dependency-cruiser.config.mjs](../dependency-cruiser.config.mjs) - Dependency validation rules

## Key Documentation

Architecture and design:
- [docs/Architecture Overview.md](../docs/Architecture%20Overview.md) - Complete architectural design
- [docs/architecture docs/Package-Layering.md](../docs/architecture%20docs/Package-Layering.md) - Layer details and dependencies
- [docs/architecture docs/ADR-INDEX.md](../docs/architecture%20docs/ADR-INDEX.md) - Index of 140+ architecture decision records

Subsystems (detailed design docs for major components):
- [docs/architecture docs/subsystems/](../docs/architecture%20docs/subsystems/) - 9 detailed subsystem specifications

## Two-Plane Architecture

Prisma Next separates concerns into two planes that share the same contract:

**Migration Plane (Build-Time):**
- Authoring: Define schema in PSL or TypeScript
- Emission: Generate contract JSON and types
- Planning: Compute contract diffs as migration edges
- Execution: Apply migrations with verification

**Query Plane (Runtime):**
- DSL: Composable query builder (`sql().from(...).where(...).select(...)`)
- Plans: Immutable, auditable query objects
- Runtime: Execution engine with plugin hooks
- Adapters: Dialect-specific SQL lowering and execution

Both planes reference the **contract** (deterministic JSON artifact) and store a **marker** in the database to track contract identity and migration history.

## Example Workflow

1. **Define schema** (`prisma/schema.psl`):
   ```prisma
   model User {
     id    Int    @id @default(autoincrement())
     email String @unique
   }
   ```

2. **Emit contract and types**:
   ```bash
   pnpm exec prisma-next emit schema.psl -o .prisma
   # Generates: .prisma/contract.json + .prisma/contract.d.ts
   ```

3. **Build type-safe queries**:
   ```typescript
   import { sql, makeT } from '@prisma-next/sql-lane';
   import { createRuntime } from '@prisma-next/sql-runtime';
   import contract from './.prisma/contract.json' assert { type: 'json' };

   const runtime = createRuntime({ ir: contract, driver, verify: 'onFirstUse' });
   const t = makeT(contract);

   const query = sql()
     .from('user')
     .where(t.user.active.eq(true))
     .select({ id: t.user.id, email: t.user.email });

   const results = await runtime.execute(query);
   // Type: Array<{ id: number; email: string }>
   ```

## Common Pitfalls

1. **Barrel files**: Don't create `index.ts` files that only re-export. Use explicit package exports in `package.json`.

2. **Plane boundaries**: Shared plane can't import from migration or runtime planes. Use `pnpm lint:deps` to validate.

3. **Package placement**: SQL family packages go in `packages/sql/`, concrete targets go in `packages/targets/`.

4. **Test naming**: Omit "should" - write `it('returns user by id')` not `it('should return user by id')`.

5. **Factory usage**: Use factory functions for AST nodes and Contract IR objects instead of manual object creation.
