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
   - `ADR 010 - Canonicalization Rules.md` - Canonicalization and hashing rules
   - `ADR 011 - Unified Plan Model.md` - Plans are immutable, hashable artifacts
   - `ADR 121 - Contract.d.ts structure.md` - Type definition structure
   - `ADR 131 - Codec typing separation.md` - Codec typing separation

5. **Emitter Briefs** (Implementation details):
   - `Slice-Emitter-Canonicalization-and-Types.md` - Overview of emitter slice
   - `01-Emitter-Hook-Architecture.md` - Hook-based architecture design
   - `02-Emitter-Pipeline-From-IR.md` - Emission pipeline implementation
   - `03-TS-Contract-Loader-and-CLI.md` - TS-only contract loading (future)
   - `04-PSL-Parser-and-CLI.md` - PSL parser implementation (future)

## 🏗️ Repository Structure

### Core Packages

- **`@prisma-next/contract`** - Core contract types (`ContractBase`, `Source`). **SQL-specific types live in `@prisma-next/sql-target`**
- **`@prisma-next/emitter`** - Contract emission engine that transforms IR into `contract.json` and `contract.d.ts` using a hook-based architecture
- **`@prisma-next/sql-query`** - SQL query DSL, contract validation, SQL-specific contract types (re-exported from `@prisma-next/sql-target`)
- **`@prisma-next/runtime`** - Execution engine, plugins (budgets, lints), contract verification
- **`@prisma-next/sql-target`** - SQL target family abstraction, emitter hook implementation, and SQL contract types (`SqlContract`, `SqlStorage`, `SqlMappings`)
- **`@prisma-next/adapter-postgres`** - Postgres adapter implementation (extension pack)
- **`@prisma-next/driver-postgres`** - Postgres driver (low-level connection)
- **`@prisma-next/compat-prisma`** - Compatibility layer for Prisma ORM import-swap
- **`@prisma-next/node-utils`** - Node.js file I/O utilities (readJsonFile, readTextFile)

### Package Organization Principles

- **SQL-specific types** (`SqlContract`, `SqlStorage`, etc.) live in `@prisma-next/sql-target/src/contract-types.ts` (moved from `sql-query` to break circular dependency)
- **Core contract types** (`ContractBase`) live in `@prisma-next/contract`
- **Emitter is hook-based**: Target family hooks (e.g., SQL) extend emission with family-specific validation and type generation
- **Adapters are extension packs**: Adapters and extension packs use the same manifest structure and are treated identically
- Each package exports curated, tree-shakeable modules
- All packages use ESM and TypeScript source

## 🔑 Key Concepts

### Contract Flow

1. **Authoring**: Developer writes `schema.psl` (or uses TypeScript builders)
   - Authoring surface canonicalizes shorthand types to fully qualified type IDs (`ns/name@version`) using extension manifests
   - Produces Contract IR with all types already canonicalized
2. **Emission**: Emitter validates IR and generates `contract.json` + `contract.d.ts`
   - Emitter validates that all type IDs come from referenced extensions
   - Emitter uses target family hooks (e.g., SQL hook) for family-specific validation and type generation
   - Emitter computes `coreHash` and `profileHash` from canonical JSON
   - Emitter returns strings; caller handles file I/O
3. **Validation**: `validateContract<TContract>(json)` validates structure and returns typed contract
   - Note: Type canonicalization happens at authoring time, not during validation
   - Contract JSON should contain only fully qualified type IDs
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

**Contract Structure**:
```typescript
SqlContract<
  SqlStorage,           // { tables: Record<string, StorageTable> }
  Models,               // { User: ModelDef & { id: number, ... } }
  Relations,            // { user: { posts: RelationDef } }
  Mappings              // { ModelToTable, TableToModel, FieldToColumn, ColumnToField, scalarToJs }
>
```

**Column Types**:
- Every column `type` is a fully qualified type ID: `pg/int4@1`, `pg/text@1`, `pg/timestamptz@1`, etc.
- **Type canonicalization happens at authoring time** (PSL parser or TS builder), not during emission or validation
- Bare scalars in authoring inputs (e.g., `int4`, `text`) are canonicalized to type IDs (e.g., `pg/int4@1`, `pg/text@1`) using extension manifests
- The emitter validates that all type IDs come from referenced extensions but does not perform canonicalization
- No codec decorations or extension metadata needed - the type ID is the source of truth

**CodecTypes** (imported from adapter):
- `CodecTypes`: `Record<codecId, { input: unknown, output: unknown }>` - TypeScript type info for codec input/output types
- Imported from adapter exports: `import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types'`
- Provided as generic parameter to `sql()` and `schema()` functions

### Query DSL Pattern

```typescript
import { sql, schema, makeT } from '@prisma-next/sql-query/sql';
import { validateContract } from '@prisma-next/sql-query/schema';
import contractJson from './contract.json' assert { type: 'json' };
import type { Contract, CodecTypes } from './contract.d';

const contract = validateContract<Contract>(contractJson);
const t = makeT<Contract, CodecTypes>(contract);  // Table/column accessor: t.user.id
const tables = schema<Contract, CodecTypes>(contract).tables;  // Table builders

// Builder methods return new instances - chain them properly
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .where(t.user.id.eq(param('userId')))
  .select({ id: t.user.id, email: t.user.email })
  .limit(10)
  .build();  // Returns immutable Plan

// Extract row type from plan
type UserRow = ResultType<typeof plan>;
```

**Key points:**
- Builder methods (`from()`, `where()`, `select()`, etc.) return new builder instances - always chain them
- Access columns via `table.columns[fieldName]` or `table['columns'][fieldName]` to avoid conflicts with table properties like `name`
- Use `ResultType<typeof plan>` to extract the inferred row type

### Plan Model

- **Plans are immutable** - Built once, never mutated
- **One query = one statement** - No hidden multi-queries
- **Unified Plan interface** - All plans use the same `Plan<Row>` interface per ADR 011:
  ```typescript
  interface Plan<Row = unknown> {
    readonly sql: string;
    readonly params: readonly unknown[];
    readonly ast?: SelectAst;  // Optional - present for DSL plans
    readonly meta: PlanMeta;   // Unified metadata with lane as string
  }
  ```
- **Core is lane-agnostic** - Never use discriminated unions based on `lane` field. The `lane` field is metadata only, not for type narrowing. Use optional fields (`ast?`) to distinguish capabilities.
- **Plans include metadata**: `{ ast?, params, meta: { refs?, projection?, target, coreHash, lane } }`
- **Plans are hashable** - Enable verification and caching
- **Extract row types**: Use `ResultType<typeof plan>` to get the inferred row type from a plan

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
// In @prisma-next/sql-query/src/contract.ts
export function validateContract<TContract extends SqlContract<SqlStorage>>(
  value: unknown,  // Arbitrary JSON input (should already have canonicalized type IDs)
): TContract {     // Returns strict type from contract.d.ts
  // 1. Validate structure (Arktype)
  // 2. Validate logic (foreign keys, etc.)
  // 3. Add defaults for models/relations/Mappings if missing
  // 4. Return with type assertion
}
```

**Type Canonicalization**:
- **Type canonicalization happens at authoring time** (PSL parser or TS builder), not during validation
- Authoring surfaces use extension manifests to map shorthand types to fully qualified type IDs
- `validateContract()` expects all types to already be canonicalized (e.g., `pg/int4@1`, not `int4`)
- The contract JSON should contain only fully qualified type IDs
- The emitter validates that all type IDs come from referenced extensions but does not canonicalize

### Emitter Architecture (Hook-Based)

The emitter uses a **hook-based architecture** where target families (SQL, Document, etc.) extend emission behavior through pluggable hooks.

**Key Design Decisions:**
- **Target Family Hooks**: Each target family implements `TargetFamilyHook` with:
  - `validateTypes`: Validates all type IDs come from referenced extensions
  - `validateStructure`: Family-specific structural validation
  - `generateContractTypes`: Generates `contract.d.ts` content
  - `getTypesImports`: Determines required type imports from packs
- **Adapters as Extension Packs**: Adapters are treated identically to extension packs. Both use the same manifest structure (`packs/manifest.json`) with:
  - `types.codecTypes.import`: Package/named/alias for importing `CodecTypes`
  - `types.canonicalScalarMap`: Scalar → typeId mapping (used by authoring surfaces, not emitter)
- **Type Canonicalization**: Type canonicalization (shorthand → fully qualified IDs) happens at **authoring time** (PSL parser or TS builder), **not during emission**. The emitter only validates that all type IDs come from referenced extensions.
- **I/O Decoupling**: The emitter is decoupled from file I/O. `emit()` returns strings (`contractJson`, `contractDts`); the caller handles all file operations.
- **No Adapter Special Treatment**: The emitter treats all extension packs uniformly. The adapter appears first in `contract.extensions` but is otherwise identical to other packs.

**Implementation:**
- Core emitter: `packages/emitter/src/emitter.ts` - orchestrates validation, hashing, and type generation
- Target family registry: `packages/emitter/src/target-family-registry.ts` - manages hook registration
- SQL hook: `packages/sql-target/src/emitter-hook.ts` - implements SQL-specific validation and type generation
- Extension pack loading: `packages/emitter/src/extension-pack.ts` - loads manifests (uses `@prisma-next/node-utils` for file I/O)

**Outputs:**
- `contract.json`: Canonical JSON with `coreHash` and `profileHash`, all column types as fully qualified IDs (`ns/name@version`)
- `contract.d.ts`: Types-only definitions with `CodecTypes` imports and `Contract` type mapping fields to `CodecTypes[typeId].output`

**Extension Pack Manifests:**
- Location: `packages/<adapter-or-extension>/packs/manifest.json`
- Structure (adapter and extensions use the same shape):
  ```json
  {
    "id": "postgres",
    "version": "15.0.0",
    "targets": { "postgres": { "minVersion": "12" } },
    "capabilities": {},
    "types": {
      "codecTypes": {
        "import": {
          "package": "@prisma-next/adapter-postgres/exports/codec-types",
          "named": "CodecTypes",
          "alias": "PgTypes"
        }
      },
      "canonicalScalarMap": {
        "int4": "pg/int4@1",
        "text": "pg/text@1"
      }
    }
  }
  ```
- `types.codecTypes.import`: Used by emitter to generate `contract.d.ts` imports
- `types.canonicalScalarMap`: Used by authoring surfaces (PSL parser or TS builder) to canonicalize shorthand types to fully qualified type IDs
- Adapter appears first in `contract.extensions` but is otherwise identical to other packs

**Future Work (Briefs):**
- TS-only emission: esbuild bundles contract entry with allowlist (`@prisma-next/*`); runner imports bundle, validates purity, canonicalizes, and writes artifacts
- CLI surface: `prisma-next emit --contract src/contract.ts --out contracts/` (TS) or `--psl schema.psl` (PSL)
- See briefs: `docs/briefs/Slice-Emitter-Canonicalization-and-Types.md`, `docs/briefs/01-Emitter-Hook-Architecture.md`, `docs/briefs/02-Emitter-Pipeline-From-IR.md`, `docs/briefs/03-TS-Contract-Loader-and-CLI.md`, `docs/briefs/04-PSL-Parser-and-CLI.md`.

## 📦 Current State

### Codec System

- **Unified Type Identifiers**: Every column `type` is a fully qualified type ID (`ns/name@version`, e.g., `pg/int4@1`, `pg/text@1`, `pg/timestamptz@1`). No bare scalars or codec decorations.
- **Type Canonicalization**: Type canonicalization happens at **authoring time** (PSL parser or TS builder), not during emission or validation. Authoring surfaces use extension manifests to map shorthand types to fully qualified type IDs.
- **Codec Registry**: Interface-based registry (`CodecRegistry`) with factory function `createCodecRegistry()`. Classes are private implementation details. Use `register()`, `get()`, `has()`, `getByScalar()`, `getDefaultCodec()`, and `values()` methods.
- **CodecDefBuilder**: Interface-based builder with factory function `defineCodecs()`. The `dataTypes` property returns type IDs (strings), not codec objects. Use `.add(scalarName, codec)` to build codec definitions.
- **CodecTypes Generic**: `CodecTypes` (mapping codec IDs to input/output types) is provided as a generic parameter to `sql()` and `schema()` functions
- **Plan Annotations**: SQL DSL encodes column type IDs into `plan.meta.annotations.codecs` and `plan.meta.projectionTypes`
- **Runtime Resolution**: Runtime uses `plan.meta.annotations.codecs[alias]` or `plan.meta.projectionTypes[alias]` for codec lookups by type ID
- **Type Inference**: `ComputeColumnJsType` pre-computes JS types in `ColumnBuilder` by looking up `CodecTypes[typeId].output`. `InferProjectionRow` extracts these pre-computed types.
- **No Fallbacks**: Removed `ScalarToJs` fallback logic. Type inference directly uses `CodecTypes[typeId].output` - if codec not found, returns `unknown`

## 🏗️ Architecture Patterns

### Interface-Based Design with Factory Functions

**Pattern**: Export interfaces and factory functions, keep classes as private implementation details.

```typescript
// ✅ CORRECT: Export interface and factory function
export interface CodecRegistry {
  register(codec: Codec<string>): void;
  get(id: string): Codec<string> | undefined;
  // ... other methods
}

export function createCodecRegistry(): CodecRegistry {
  return new CodecRegistryImpl();  // Private implementation class
}

// ❌ WRONG: Don't export classes directly
export class CodecRegistry { ... }
```

**Why?** This aligns with the "Types-Only Emission" principle and allows for better abstraction. Consumers work with interfaces, not concrete classes.

**Examples in codebase:**
- `CodecRegistry` → `createCodecRegistry()`
- `CodecDefBuilder` → `defineCodecs()`
- `Runtime` → `createRuntime()`
- `PostgresDriver` → `createPostgresDriverFromOptions()`

### Type Preservation in Generics

**Challenge**: Preserving literal string types (e.g., `'pg/text@1'`) through complex generic type manipulations.

**Solution**: Use mapped types with careful constraints to avoid index signatures:

```typescript
// ❌ WRONG: Record<string, T> introduces index signature
type ExtractCodecTypes<ScalarNames extends Record<string, Codec<string>>>

// ✅ CORRECT: Mapped type preserves literal keys
type ExtractCodecTypes<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> }
>

// Use Record<never, never> for empty defaults (not {})
type CodecDefBuilder<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = Record<never, never>
>
```

**Key insight**: When extracting literal types from codecs, use mapped types that extract keys (which preserve literals) rather than inferring values (which widen to `string`).

### Contract Validation in Tests

**Always validate contracts in tests** - even test fixtures need canonicalization:

```typescript
// ❌ WRONG: Test contract with bare scalars
const testContract: SqlContract<SqlStorage> = {
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'text', nullable: false },  // Bare scalar!
        },
      },
    },
  },
};

// ✅ CORRECT: Validate to canonicalize types
const testContract = validateContract<SqlContract<SqlStorage>>({
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'text', nullable: false },  // Will be canonicalized to 'pg/text@1'
        },
      },
    },
  },
});
```

### Test Port Management

**Issue**: Parallel test execution causes port conflicts when multiple tests use the same hardcoded ports.

**Solution**: Assign unique port ranges to each test suite:

```typescript
// packages/compat-prisma/test/prisma-client.test.ts
database = await createDevDatabase({
  acceleratePort: 54000,
  databasePort: 54001,
  shadowDatabasePort: 54002,
});

// packages/runtime/test/codecs.integration.test.ts
database = await createDevDatabase({
  acceleratePort: 54003,  // Different range
  databasePort: 54004,
  shadowDatabasePort: 54005,
});
```

**Current port assignments:**
- `compat-prisma`: 54000-54002
- `codecs.integration.test.ts`: 54003-54005
- `budgets.integration.test.ts`: 54010-54012
- `runtime.integration.test.ts`: 53213-53215
- `marker.test.ts`: 54216-54218

## 🧪 Testing

- **Vitest** for all tests
- **Type-level tests**: Use `plan-types.test-d.ts` pattern (`.test-d.ts` extension)
- **Integration tests**: Spin up Postgres, create tables, execute queries
- **Test fixtures**: `test/fixtures/contract.json` + `contract.d.ts`
- **Type assertions**: Use `toExtend()` not `toMatchTypeOf()` - see `.cursor/rules/vitest-expect-typeof.mdc`
- **Type tests**: Use `expectTypeOf` helpers, not manual type checks with conditional types - see `.cursor/rules/vitest-expect-typeof.mdc`

Example type test:
```typescript
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/contract.d';
import type { ResultType, Plan } from '@prisma-next/sql-query/types';

test('Contract types are correct', () => {
  type UserTable = Contract['storage']['tables']['user'];
  expectTypeOf<UserTable>().toHaveProperty('id');
});

test('Plan type inference works', () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({ id: t.user.id, email: t.user.email })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf(plan).toExtend<Plan<Row>>();  // Use toExtend, not toMatchTypeOf
});

// ✅ CORRECT: Use expectTypeOf for type assertions
test('Type IDs are literal types', () => {
  type TextTypeId = 'pg/text@1';
  expectTypeOf<TextTypeId>().toEqualTypeOf<'pg/text@1'>();
});

// ❌ WRONG: Don't use manual type checks
// const _check: TextTypeId extends 'pg/text@1' ? true : false = true;
```

## 🚨 Common Pitfalls

1. **Don't infer types from JSON** - JSON imports lose literal types. Use type parameter pattern.
2. **Don't generate runtime code** - Emit types only (`contract.d.ts`), not executable JS.
3. **SQL types belong in sql-target package** - `SqlContract`, `SqlStorage`, etc. live in `@prisma-next/sql-target` (moved from `sql-query` to break circular dependency).
4. **Use bracket notation for index signatures** - `tables['user']` not `tables.user` when TypeScript requires it.
5. **Arktype optional syntax** - Use `'key?'` not `key: 'Type | undefined'`.
6. **Builder chaining** - SQL builder methods return new instances. Always chain: `let query = sql(...).from(...); query = query.where(...); query = query.select(...);`
7. **Column access** - Use `table.columns[fieldName]` or `table['columns'][fieldName]` to avoid conflicts with table properties like `name`.
8. **Type tests** - Use `toExtend()` not `toMatchTypeOf()` - see `.cursor/rules/vitest-expect-typeof.mdc`
9. **Core is lane-agnostic** - Never create discriminated unions based on `lane` field. The core should not be aware of specific lane implementations.
10. **Unified Type Identifiers** - Every column `type` must be a fully qualified type ID (`ns/name@version`). Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation. No codec decorations or scalar fallbacks.
11. **CodecTypes Generic** - Always provide `CodecTypes` as a generic parameter to `sql()` and `schema()` functions. Import from adapter exports: `import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types'`
12. **Contract Validation** - Always validate contracts with `validateContract<Contract>(contractJson)` before use. Note: type canonicalization happens at authoring time, not during validation. The contract JSON should contain only fully qualified type IDs.
13. **No Backward Compatibility** - Never add backward compatibility code, migration paths, or deprecation warnings. This project has no external consumers - change implementations directly.
14. **Runtime Agnostic** - The runtime must not contain target-specific logic (e.g., special-case Date handling for specific codec IDs). Use generic codec resolution only.
15. **Interface-Based APIs** - Export interfaces and factory functions, not classes. Keep implementation classes private. Use `createX()` factory functions instead of `new X()` constructors.
16. **Type Preservation** - Use mapped types `{ readonly [K in keyof T]: ... }` instead of `Record<string, T>` in generic constraints to preserve literal types. Use `Record<never, never>` for empty defaults, not `{}`.
17. **Test Port Management** - Assign unique port ranges to each test suite to avoid conflicts during parallel test execution.
18. **Type Tests** - Use Vitest's `expectTypeOf` helpers instead of manual type checks with conditional types. See `.cursor/rules/vitest-expect-typeof.mdc` for details.
19. **Emitter I/O Decoupling** - The emitter returns strings (`contractJson`, `contractDts`); the caller handles all file I/O. This enables testing without file system dependencies and flexible integration with build systems.
20. **Adapters as Extension Packs** - Adapters and extension packs use the same manifest structure and are treated identically. The adapter appears first in `contract.extensions` but is otherwise identical to other packs.
21. **Type Canonicalization Timing** - Type canonicalization happens at authoring time (PSL parser or TS builder), not during emission or validation. The emitter only validates that all type IDs come from referenced extensions.
22. **Package Naming** - The SQL query package was renamed from `@prisma-next/sql` to `@prisma-next/sql-query` to better reflect its purpose.

## 📖 Documentation Location

- **Architecture**: `docs/architecture docs/` (subsystems + ADRs)
- **MVP Spec**: `docs/MVP-Spec.md`
- **Briefs**: `docs/briefs/` (implementation slices)
- **Workspace Rules**: `.cursor/rules/` (Arktype usage, architecture guidance)

## 🎯 What to Work On Next

### Recent Implementation (Completed)

1. **Emitter Hook-Based Architecture** - Refactored emitter to use pluggable `TargetFamilyHook` system. SQL hook lives in `sql-target` package. Adapters treated identically to extension packs.
2. **Type Canonicalization at Authoring Time** - Type canonicalization (shorthand → fully qualified IDs) happens at authoring time (PSL parser or TS builder), not during emission or validation. Emitter only validates type IDs come from referenced extensions.
3. **Emitter I/O Decoupling** - Emitter returns strings (`contractJson`, `contractDts`); caller handles all file I/O. Enables testing without file system dependencies and flexible build system integration.
4. **SQL Contract Types Migration** - Moved SQL contract types (`SqlContract`, `SqlStorage`, etc.) from `sql-query` to `sql-target` to break circular dependency. All SQL-specific types now live in `sql-target`.
5. **Package Rename** - Renamed `@prisma-next/sql` to `@prisma-next/sql-query` to better reflect its purpose as query builder.
6. **Node Utils Package** - Created `@prisma-next/node-utils` package for file I/O utilities (`readJsonFile`, `readTextFile`). Extracted from emitter to keep I/O concerns separate.
7. **Unified Type Identifiers** - All column types are fully qualified type IDs (`ns/name@version`). Canonicalization happens at authoring time.
8. **Simplified Type Inference** - `ComputeColumnJsType` pre-computes JS types in `ColumnBuilder` using `CodecTypes[typeId].output`. No fallbacks or scalar mappings.
9. **Runtime Simplification** - Removed target-specific logic from runtime. Codec resolution uses type IDs directly.
10. **Interface-Based Design** - Refactored codec system to export interfaces and factory functions (`createCodecRegistry()`, `defineCodecs()`) instead of classes. Implementation classes are private.
11. **Type Preservation** - Fixed generic type system to preserve literal string types (e.g., `'pg/text@1'`) through mapped types and careful constraints. Removed index signatures from generic parameters.
12. **Test Infrastructure** - Fixed port conflicts in parallel test execution by assigning unique port ranges to each test suite.

### Future Work

- Additional adapters (MySQL, SQLite, etc.) with their own codec type IDs
- Extension packs (e.g., pgvector) that register additional codecs

### MVP Goals

Check the TODO comments in code (especially `packages/sql-query/src/contract.ts` - "TODO: compute mappings") and open issues. The MVP goals are:
1. Type-safe query DSL
2. Compatibility layer for Prisma ORM import-swap
3. Budgets plugin blocking unbounded reads
4. Extensibility via packs (e.g., pgvector)

## 💡 Quick Reference

**Load a contract:**
```typescript
import { validateContract } from '@prisma-next/sql-query/schema';
import type { Contract, CodecTypes } from './contract.d';
import contractJson from './contract.json' assert { type: 'json' };

// Always validate - ensures structure and type safety
// Note: type canonicalization happens at authoring time, not during validation
const contract = validateContract<Contract>(contractJson);
```

**Create a query:**
```typescript
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';

const tables = schema<Contract, CodecTypes>(contract).tables;
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .build();
```

**Emit a contract:**
```typescript
import { emit } from '@prisma-next/emitter';
import { loadExtensionPacks } from '@prisma-next/emitter';
import type { ContractIR, EmitOptions } from '@prisma-next/emitter';

// Load extension packs (adapter + extensions)
const packs = loadExtensionPacks(
  './packages/adapter-postgres',
  ['./packages/extension-pack']
);

// Emit contract (returns strings, caller handles file I/O)
const result = await emit(ir, {
  outputDir: './dist',
  packs,
});

// Write files (caller responsibility)
await writeFile('./contract.json', result.contractJson);
await writeFile('./contract.d.ts', result.contractDts);
```

**Extract row type from plan:**
```typescript
import type { ResultType } from '@prisma-next/sql-query/types';

const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .select({ id: tables.user.columns.id, email: tables.user.columns.email })
  .build();

type UserRow = ResultType<typeof plan>;  // Inferred type: { id: number; email: string }
```

**Contract column types:**
```typescript
// Authoring surface (PSL or TS builder) canonicalizes bare scalars to type IDs
// contract.json - already contains fully qualified type IDs
{
  "storage": {
    "tables": {
      "user": {
        "columns": {
          "id": { "type": "pg/int4@1", "nullable": false },
          "email": { "type": "pg/text@1", "nullable": false }
        }
      }
    }
  }
}

// contract.d.ts - matches JSON with canonicalized type IDs
export type Contract = SqlContract<{
  readonly tables: {
    readonly user: {
      readonly columns: {
        readonly id: { readonly type: 'pg/int4@1'; nullable: false };
        readonly email: { readonly type: 'pg/text@1'; nullable: false };
      };
    };
  };
}>;

// Plans encode type IDs in annotations
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .build();

plan.meta.annotations?.codecs;  // { id: 'pg/int4@1' }
plan.meta.projectionTypes;       // { id: 'pg/int4@1' }

// Runtime uses type IDs for codec resolution
// Type system uses CodecTypes[typeId].output for ResultType inference
```

**Extension Pack Manifest:**
```json
{
  "id": "postgres",
  "version": "15.0.0",
  "targets": { "postgres": { "minVersion": "12" } },
  "capabilities": {},
  "types": {
    "codecTypes": {
      "import": {
        "package": "@prisma-next/adapter-postgres/exports/codec-types",
        "named": "CodecTypes",
        "alias": "PgTypes"
      }
    },
    "canonicalScalarMap": {
      "int4": "pg/int4@1",
      "text": "pg/text@1"
    }
  }
}
```

---

**Remember**: This is a prototype. Some design docs describe future state. Focus on the MVP spec and the briefs marked "complete" for implemented features.

