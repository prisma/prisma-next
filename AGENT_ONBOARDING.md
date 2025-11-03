# Agent Onboarding: Prisma Next Repository

Welcome! This document provides the essential context you need to work effectively in the Prisma Next repository.

## 🎯 Project Overview

**Prisma Next** is a prototype of a contract-first data access layer designed for software agents and modern TypeScript workflows. It replaces traditional ORMs with:

- **Contract-first architecture**: A verifiable JSON contract (`contract.json`) + TypeScript types instead of heavy generated client code
- **Composable DSL**: Type-safe query builder (`sql().from(...).select(...)`) instead of generated methods
- **Machine-readable**: Structured artifacts that agents can understand and manipulate
- **Runtime verification**: Contract hashes and guardrails ensure safety before execution
- **Extensible**: Plugin system for budgets, lints, telemetry, and domain-specific capabilities

### Key Principle: Types-Only Emission
We emit `contract.json` and `contract.d.ts` files—**no executable runtime code generation**. Queries are built using a runtime DSL that compiles to SQL at execution time. This enables:
- Faster iteration (no regeneration on schema changes)
- Better agent compatibility (explicit, analyzable queries)
- Composable, predictable behavior

## 📚 Essential Reading (Read First!)

1. **Start Here**: [`docs/Architecture Overview.md`](docs/Architecture%20Overview.md) - High-level architecture and design principles
2. **MVP Spec**: [`docs/MVP-Spec.md`](docs/MVP-Spec.md) - What we're building for the MVP
3. **Core Subsystems** (in `docs/architecture docs/subsystems/`):
   - `1. Data Contract.md` - Contract structure and semantics
   - `2. Contract Emitter & Types.md` - How contracts are generated
   - `3. Query Lanes.md` - SQL DSL, ORM, Raw SQL surfaces
   - `4. Runtime & Plugin Framework.md` - Execution pipeline and plugins

4. **Key ADRs** (Architecture Decision Records):
   - `ADR 007 - Types Only Emission.md` - Why we don't generate runtime code
   - `ADR 011 - Unified Plan Model.md` - Plans are immutable, hashable artifacts
   - `ADR 121 - Contract.d.ts structure.md` - Type definition structure

## 🏗️ Repository Structure

### Core Packages

- **`@prisma-next/contract`** - Core contract types (`ContractBase`, `Source`). **SQL-specific types live in `@prisma-next/sql`**
- **`@prisma-next/sql`** - SQL query DSL, contract validation, SQL-specific contract types (`SqlContract`, `SqlStorage`, `SqlMappings`)
- **`@prisma-next/runtime`** - Execution engine, plugins (budgets, lints), contract verification
- **`@prisma-next/sql-target`** - Target abstraction for SQL dialects
- **`@prisma-next/adapter-postgres`** - Postgres adapter implementation
- **`@prisma-next/driver-postgres`** - Postgres driver (low-level connection)
- **`@prisma-next/compat-prisma`** - Compatibility layer for Prisma ORM import-swap

### Package Organization Principles

- **SQL-specific types** (`SqlContract`, `SqlStorage`, etc.) live in `@prisma-next/sql/src/contract-types.ts`
- **Core contract types** (`ContractBase`) live in `@prisma-next/contract`
- Each package exports curated, tree-shakeable modules
- All packages use ESM and TypeScript source

## 🔑 Key Concepts

### Contract Flow

1. **Authoring**: Developer writes `schema.psl` (or uses TypeScript builders)
2. **Emission**: Tool generates `contract.json` + `contract.d.ts`
3. **Validation**: `validateContract<TContract>(json)` validates structure and returns typed contract
4. **Usage**: DSL functions (`sql()`, `schema()`, `makeT()`) accept contract and propagate types

### Contract Types Pattern

Contracts use a **type parameter pattern** for strict typing:

```typescript
// contract.d.ts defines the strict type
export type Contract = SqlContract<SpecificStorage, SpecificModels, SpecificRelations, SpecificMappings>;

// Runtime validation accepts arbitrary JSON but requires type parameter
function loadContract(): Contract {
  const json = /* load from contract.json */;
  return validateContract<Contract>(json);  // Type comes from .d.ts, validation from JSON
}
```

**Why?** JSON imports lose literal types (`nullable: true` → `nullable: boolean`). The `.d.ts` file provides precise types; `validateContract` validates structure at runtime.

### Query DSL Pattern

```typescript
import { sql, schema, makeT } from '@prisma-next/sql';
import { validateContract } from '@prisma-next/sql/schema';
import contractJson from './contract.json' assert { type: 'json' };
import type { Contract } from './contract.d';

const contract = validateContract<Contract>(contractJson);
const t = makeT(contract);  // Table/column accessor: t.user.id
const tables = schema(contract).tables;  // Table builders

const plan = sql({ contract, adapter })
  .from(tables.user)
  .where(t.user.id.eq(param('userId')))
  .select({ id: t.user.id, email: t.user.email })
  .build();  // Returns immutable Plan
```

### Plan Model

- **Plans are immutable** - Built once, never mutated
- **One query = one statement** - No hidden multi-queries
- **Plans include metadata**: `{ ast, params, meta: { refs, projection, target, coreHash, lane } }`
- **Plans are hashable** - Enable verification and caching

## 🛠️ Development Conventions

### TypeScript & Tooling

- **Use `pnpm`** (not npm) - Workspace monorepo
- **Use `turbo`** for builds - `pnpm build` delegates to turborepo
- **Typecheck**: Use `pnpm typecheck` scripts, not raw `tsc`
- **No file extensions in imports** - `import { x } from './file'` not `'./file.ts'`
- **ESM only** - All packages use `"type": "module"`

### Code Style

- **Use Arktype for validation** (not Zod) - See `.cursor/rules/arktype-usage.mdc`
- **Prefer code over comments** - Code should express intent
- **No backwards-compat exports** unless explicitly requested
- **Test descriptions**: Omit "should" - `it("returns correct value")` not `it("should return correct value")`

### Validation Pattern

```typescript
import { type } from 'arktype';

const Schema = type({
  required: 'string',
  'optional?': 'number',  // Use 'key?' syntax for optional
  nested: type({ '[string]': NestedSchema }),  // Record: type({ '[string]': Schema })
  items: ItemSchema.array(),  // Array: Schema.array()
});

const result = Schema(value);
if (result instanceof type.errors) {
  throw new Error(result.map(p => p.message).join('; '));
}
// TypeScript narrows - result is now validated
return value;  // Preserve literal types from input
```

### Contract Validation

```typescript
// In @prisma-next/sql/src/contract.ts
export function validateContract<TContract extends SqlContract<SqlStorage>>(
  value: unknown,  // Arbitrary JSON input
): TContract {     // Returns strict type from contract.d.ts
  // 1. Validate structure (Arktype)
  // 2. Validate logic (foreign keys, etc.)
  // 3. Add defaults for models/relations/Mappings if missing
  // 4. Return with type assertion
}
```

## 📦 Recent Changes (Current State)

### SQL Contract Types Refactor (Latest)

- **SQL-specific types moved** from `@prisma-next/contract` → `@prisma-next/sql/src/contract-types.ts`
- **`validateContract` updated** to accept type parameter: `validateContract<TContract>(json)`
- **Schema moved**: `contract/schemas/data-contract-sql-v1.json` → `sql/schemas/data-contract-sql-v1.json`
- **All tests updated** to use type parameter pattern

Key files:
- `packages/sql/src/contract-types.ts` - SQL contract type definitions
- `packages/sql/src/contract.ts` - Contract validation (structural + logical)
- `packages/sql/test/fixtures/contract.d.ts` - Example contract type definition

### Contract Structure

Contracts have this structure:
```typescript
SqlContract<
  SqlStorage,           // { tables: Record<string, StorageTable> }
  Models,               // { User: ModelDef & { id: number, ... } }
  Relations,            // { user: { posts: RelationDef } }
  Mappings              // { ModelToTable, TableToModel, FieldToColumn, ColumnToField }
>
```

The `contract.d.ts` file defines all four generic parameters with precise literal types.

## 🧪 Testing

- **Vitest** for all tests
- **Type-level tests**: Use `plan-types.test-d.ts` pattern (`.test-d.ts` extension)
- **Integration tests**: Spin up Postgres, create tables, execute queries
- **Test fixtures**: `test/fixtures/contract.json` + `contract.d.ts`

Example type test:
```typescript
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/contract.d';

test('Contract types are correct', () => {
  type UserTable = Contract['storage']['tables']['user'];
  expectTypeOf<UserTable>().toHaveProperty('id');
});
```

## 🚨 Common Pitfalls

1. **Don't infer types from JSON** - JSON imports lose literal types. Use type parameter pattern.
2. **Don't generate runtime code** - Emit types only (`contract.d.ts`), not executable JS.
3. **SQL types belong in SQL package** - Don't put `SqlContract` in `@prisma-next/contract`.
4. **Use bracket notation for index signatures** - `tables['user']` not `tables.user` when TypeScript requires it.
5. **Arktype optional syntax** - Use `'key?'` not `key: 'Type | undefined'`.

## 📖 Documentation Location

- **Architecture**: `docs/architecture docs/` (subsystems + ADRs)
- **MVP Spec**: `docs/MVP-Spec.md`
- **Briefs**: `docs/briefs/` (implementation slices)
- **Workspace Rules**: `.cursor/rules/` (Arktype usage, architecture guidance)

## 🎯 What to Work On Next

Check the TODO comments in code (especially `packages/sql/src/contract.ts` - "TODO: compute mappings") and open issues. The MVP goals are:
1. Type-safe query DSL
2. Compatibility layer for Prisma ORM import-swap
3. Budgets plugin blocking unbounded reads
4. Extensibility via packs (e.g., pgvector)

## 💡 Quick Reference

**Load a contract:**
```typescript
import { validateContract } from '@prisma-next/sql/schema';
import type { Contract } from './contract.d';
const contract = validateContract<Contract>(contractJson);
```

**Create a query:**
```typescript
const plan = sql({ contract, adapter })
  .from(tables.user)
  .select({ id: t.user.id })
  .build();
```

**Execute:**
```typescript
const runtime = createRuntime({ contract, adapter, driver });
for await (const row of runtime.execute(plan)) {
  // Process row
}
```

---

**Remember**: This is a prototype. Some design docs describe future state. Focus on the MVP spec and the briefs marked "complete" for implemented features.

