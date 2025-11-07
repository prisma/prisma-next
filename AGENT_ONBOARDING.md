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
- **`@prisma-next/integration-tests`** - Integration tests that verify end-to-end flows across packages
- **`@prisma-next/e2e-tests`** - End-to-end tests using the CLI to emit contracts and execute queries against a real database

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
import { sql, schema, makeT, param } from '@prisma-next/sql-query/sql';
import { validateContract } from '@prisma-next/sql-query/schema';
import contractJson from './contract.json' assert { type: 'json' };
import type { Contract, CodecTypes } from './contract.d';

const contract = validateContract<Contract>(contractJson);
const t = makeT<Contract, CodecTypes>(contract);  // Table/column accessor: t.user.id
const tables = schema<Contract, CodecTypes>(contract).tables;  // Table builders

// Basic query with where clause
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .where(t.user.id.eq(param('userId')))
  .select({ id: t.user.id, email: t.user.email })
  .limit(10)
  .build({ params: { userId: 42 } });  // Returns immutable Plan

// Query with join
const joinedPlan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .innerJoin(tables.post, (on) => on.eqCol(t.user.id, t.post.userId))
  .where(t.user.active.eq(param('active')))
  .select({
    userId: t.user.id,
    email: t.user.email,
    postId: t.post.id,
    title: t.post.title,
  })
  .build({ params: { active: true } });

// Extract row type from plan
type UserRow = ResultType<typeof plan>;
type JoinedRow = ResultType<typeof joinedPlan>;
```

**Key points:**
- Builder methods (`from()`, `where()`, `select()`, etc.) return new builder instances - always chain them
- Access columns via `table.columns[fieldName]` or `table['columns'][fieldName]` to avoid conflicts with table properties like `name`
- Use `ResultType<typeof plan>` to extract the inferred row type

**Joins:**
- Explicit join methods: `innerJoin()`, `leftJoin()`, `rightJoin()`, `fullJoin()`
- Join ON conditions use `on.eqCol(left, right)` callback pattern
- Self-joins are not supported in MVP (will error at build time)
- Result typing is derived solely from projection, unaffected by joins
- Example:
  ```typescript
  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(tables.user)
    .innerJoin(tables.post, (on) => on.eqCol(t.user.id, t.post.userId))
    .where(t.user.active.eq(param('active')))
    .select({
      userId: t.user.id,
      email: t.user.email,
      postId: t.post.id,
      title: t.post.title,
    })
    .build({ params: { active: true } });
  ```

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
- **Plans include metadata**: `{ ast?, params, meta: { refs?, projection?, projectionTypes?, target, targetFamily?, coreHash, profileHash?, lane, annotations?, paramDescriptors } }`
- **Plans are hashable** - Enable verification and caching
- **Extract row types**: Use `ResultType<typeof plan>` to get the inferred row type from a plan

**Note**: ADR 011 may reference fields like `createdAt` in the Plan meta structure, but the current implementation's `PlanMeta` interface does not include this field. The actual `PlanMeta` structure matches the implementation in `packages/sql-query/src/types.ts`.

## 🛠️ Development Conventions

### TypeScript & Tooling

- **Use `pnpm`** (not npm) - Workspace monorepo
- **Use `turbo`** for builds - `pnpm build` delegates to turborepo
- **Typecheck**: Use `pnpm typecheck` scripts, not raw `tsc`
- **No file extensions in imports** - `import { x } from './file'` not `'./file.ts'`
- **ESM only** - All packages use `"type": "module"`
- **Biome config**: Biome config file is `biome.json` at the root. All package lint scripts explicitly specify the config file using `--config-path ../../biome.json`.
- **Type constraints**: When fixing type errors by replacing `any` with `unknown`, ensure the constraints match the actual interface requirements. For example, `TableBuilderState<unknown, unknown, unknown>` won't work - use the actual constraint types like `TableBuilderState<string, Record<string, ColumnBuilderState<...>>, readonly string[] | undefined>`.

### Code Style

- **Use Arktype for validation** (not Zod) - See `.cursor/rules/arktype-usage.mdc`
- **Prefer code over comments** - Code should express intent
- **No backwards-compat exports** unless explicitly requested
- **Test descriptions**: Omit "should" - `it("returns correct value")` not `it("should return correct value")`
- **Node.js globals restriction**: `console`, `process`, `__dirname`, `__filename`, and `URL` are only permitted in test files (`**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`), `packages/node-utils/**/*.ts`, and `packages/cli/**/*.ts`. Other packages should not use these globals directly.
- **Index signature property access**: When TypeScript requires it (e.g., `TS4111` error), use bracket notation: `contract['targetFamily']` instead of `contract.targetFamily`. This is required when accessing properties from index signatures.
- **Unsafe assignments in tests**: When working with `JSON.parse()` results or dynamic imports in tests, use type assertions and biome-ignore comments as needed: `const json = JSON.parse(content) as Record<string, unknown>;`
- **Avoid unnecessary type casts**: Always check the actual type signature before adding type casts. If a codec accepts `string | Date`, don't cast `Date` to `string` - pass it directly. Only use type casts when testing invalid inputs with `@ts-expect-error`.
- **Use dot notation for guaranteed values**: When accessing values that are guaranteed to exist (e.g., in test fixtures), use dot notation (`.`) instead of optional chaining (`?.`). Don't include `| undefined` in type assertions when values are guaranteed to exist.
- **Biome ignore comments**: If you need to disable a rule for more than a couple of lines in a file, use a file-level ignore comment at the top of the file instead of many inline comments. Example: `// biome-ignore lint: test file with type assertions`
- **Unused variables**: Variables that are only used as types should be prefixed with `_` to indicate they're intentionally unused. Example: `const _plan = sql(...).build(); type Row = ResultType<typeof _plan>;`
- **Empty object types**: Use `Record<string, never>` instead of `{}` for empty object types in type definitions. This provides better type safety.
- **JSON imports**: Use `import` statements with `assert { type: 'json' }` instead of `require()` for JSON files. Example: `import contractJson from './fixtures/contract.json' assert { type: 'json' };`

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
  value: unknown,  // Arbitrary JSON input (must have fully qualified type IDs)
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
- `validateContract()` does not perform canonicalization - it expects all types to already be fully qualified (e.g., `pg/int4@1`, not `int4`)
- The contract JSON must contain only fully qualified type IDs - there is no fallback canonicalization
- The emitter validates that all type IDs come from referenced extensions but does not canonicalize
- **No target-specific branching**: Never use `if (target === 'postgres')` in core packages. Target-specific type mappings belong in adapters or extension pack manifests. See `.cursor/rules/no-target-branches.mdc` for details.

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
- **Type Canonicalization**: Type canonicalization (shorthand → fully qualified IDs) happens at **authoring time** (PSL parser or TS builder), **not during emission**. The emitter only validates that all type IDs come from referenced extensions.
- **I/O Decoupling**: The emitter is decoupled from file I/O. `emit()` returns strings (`contractJson`, `contractDts`); the caller handles all file operations.
- **No Adapter Special Treatment**: The emitter treats all extension packs uniformly. The adapter appears first in `contract.extensions` but is otherwise identical to other packs.

**Implementation:**
- Core emitter: `packages/emitter/src/emitter.ts` - orchestrates validation, hashing, and type generation
- Target family SPI: The `emit()` function accepts a `targetFamily: TargetFamilyHook` parameter directly. Authoring surfaces (CLI, tests) determine which target family SPI to use based on the contract's `targetFamily` field and pass it directly. No global registry or auto-registration.
- SQL target family SPI: `packages/sql-target/src/emitter-hook.ts` - implements SQL-specific validation and type generation, exported as `sqlTargetFamilyHook`
- Extension pack loading: `packages/emitter/src/extension-pack.ts` - loads manifests (uses `@prisma-next/node-utils` for file I/O)

**Outputs:**
- `contract.json`: Canonical JSON with `coreHash` and `profileHash`, all column types as fully qualified IDs (`ns/name@version`). Includes `_generated` metadata field to indicate it's a generated artifact (excluded from canonicalization/hashing).
- `contract.d.ts`: Types-only definitions with `CodecTypes` imports and `Contract` type mapping fields to `CodecTypes[typeId].output`. Includes warning header comment indicating it's a generated file.

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
      }
    }
  }
  ```
  - `types.codecTypes.import`: Used by emitter to generate `contract.d.ts` imports
  - **No `canonicalScalarMap`**: Extension manifests do not include scalar-to-type ID mappings. Type canonicalization happens at authoring time using extension manifests, not via a scalar map in the manifest.
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

### No Target-Specific Branches

**CRITICAL**: Never branch on `target` in core packages. This violates the thin core principle and makes the codebase hard to extend.

**❌ WRONG: Branch on target in core packages**

```typescript
// ❌ WRONG: Don't do this in core packages
function canonicalizeColumnType(scalar: string, target: string): string {
  if (target === 'postgres') {
    const scalarMap: Record<string, string> = {
      int4: 'pg/int4@1',
      text: 'pg/text@1',
    };
    return scalarMap[scalar] ?? scalar;
  }
  throw new Error(`Unknown target: ${target}`);
}
```

**✅ CORRECT: Use adapters or extension packs**

```typescript
// ✅ CORRECT: Adapter handles target-specific logic
interface Adapter {
  canonicalizeType(scalar: string): string;
}

// ✅ CORRECT: Extension pack manifest defines type mappings
// packages/adapter-postgres/packs/manifest.json
{
  "id": "postgres",
  "types": {
    "codecTypes": {
      "import": {
        "package": "@prisma-next/adapter-postgres/exports/codec-types",
        "named": "CodecTypes"
      }
    }
  }
}
```

**Why?**
- Core packages must remain target-agnostic (ADR 005 - Thin Core, Fat Targets)
- Adding new targets should not require changes to core packages
- Target-specific logic belongs in adapters or extension pack manifests
- Enables better testing and mocking

**When is target branching acceptable?**
- In target-specific packages (`packages/adapter-*`, `packages/driver-*`)
- In target-specific lanes (e.g., `raw.ts` for postgres-only features)
- In tests (target-specific fixtures or mocks)

See `.cursor/rules/no-target-branches.mdc` for detailed guidance.

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

**Type Constraint Errors**: When fixing type errors by replacing `any` with `unknown`, ensure the constraints match the actual interface requirements. For example:

```typescript
// ❌ WRONG: unknown doesn't satisfy string constraint
type ExtractColumns<T extends TableBuilderState<unknown, unknown, unknown>> =
  T extends TableBuilderState<unknown, infer C, unknown> ? C : never;

// ✅ CORRECT: Use actual constraint types from the interface
type ExtractColumns<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<string, infer C, readonly string[] | undefined> ? C : never;
```

**DRY Test Patterns**: Common patterns in test files should be extracted into helper functions with JSDoc comments:

```typescript
/**
 * Executes a plan and consumes the first row from the result iterator.
 * This helper DRYs up the common test pattern of executing a plan and breaking
 * after the first row to trigger execution without consuming all results.
 */
const executePlan = async (runtime: ReturnType<typeof createRuntime>, plan: Plan): Promise<void> => {
  for await (const _row of runtime.execute(plan)) {
    void _row;
    break;
  }
};
```

### Contract Validation in Tests

**Always validate contracts in tests** - contracts must have fully qualified type IDs:

```typescript
// ❌ WRONG: Test contract with bare scalars
const testContract: SqlContract<SqlStorage> = {
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'text', nullable: false },  // Bare scalar - invalid!
        },
      },
    },
  },
};

// validateContract will reject this - contracts must have fully qualified type IDs
```

```typescript
// ✅ CORRECT: Use fully qualified type IDs and fully-typed contract type
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract } from '@prisma-next/sql-target';

// Define a fully-typed contract type (or import from contract.d.ts)
type TestContract = SqlContract<{
  readonly tables: {
    readonly user: {
      readonly columns: {
        readonly id: { readonly type: 'pg/text@1'; nullable: false };
      };
    };
  };
}>;

const testContract = validateContract<TestContract>({
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/text@1', nullable: false },  // Fully qualified type ID
        },
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
});

// Now contract is validated and ready to use
const runtime = createRuntime({ contract: testContract, adapter });
```

**Important**: `validateContract()` does not perform canonicalization. It expects all types to already be fully qualified type IDs (`pg/int4@1`, not `int4`). Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation.

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

**See `docs/Testing Guide.md` for comprehensive testing practices and philosophy.**

- **Vitest** for all tests
- **Testing Pyramid**: 70% Unit Tests, 20% Integration Tests, 10% E2E Tests
- **Testing Philosophy**: Conciseness without obscurity, separation of concerns, maintainability, readability
- **DRY Patterns**: Extract helpers when patterns appear 3+ times - see `docs/Testing Guide.md` for examples
- **Type-level tests**: Use `plan-types.test-d.ts` pattern (`.test-d.ts` extension)
- **Integration tests**: Spin up Postgres, create tables, execute queries
- **E2E tests**: Test complete execution paths from CLI to database and back
- **Test fixtures**: `test/fixtures/contract.json` + `contract.d.ts`
- **Type assertions**: Use `toExtend()` not `toMatchTypeOf()` - see `.cursor/rules/vitest-expect-typeof.mdc`
- **Type tests**: Use `expectTypeOf` helpers, not manual type checks with conditional types - see `.cursor/rules/vitest-expect-typeof.mdc`
- **Test descriptions**: Omit "should" - see `.cursor/rules/omit-should-in-tests.mdc`
- **Shared Test Utilities**: Use `@prisma-next/test-utils` for generic test patterns, `@prisma-next/runtime/test/utils` for runtime-specific utilities, and `e2e-tests/test/utils.ts` for contract-related E2E utilities - see "E2E Test Patterns" below

### E2E Test Patterns

**Test Utilities Organization**: Test utilities are organized across multiple locations to avoid circular dependencies:
- **`@prisma-next/test-utils`**: Generic database and async iterable utilities with zero dependencies on other `@prisma-next/*` packages
- **`@prisma-next/runtime/test/utils`**: Runtime-specific test utilities (plan execution, runtime creation, contract markers)
- **`e2e-tests/test/utils.ts`**: Contract-related utilities for E2E tests (contract loading, emission verification)

**Key Helpers:**
- `loadContractFromDisk<TContract>(contractJsonPath)`: Loads an already-emitted contract from disk (in `e2e-tests/test/utils.ts`). The generic type parameter should be specified from the emitted `contract.d.ts` file (e.g., `loadContractFromDisk<Contract>(contractJsonPath)`).
- `emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, expectedContractJsonPath)`: Emits contract via CLI and verifies it matches on-disk artifacts (in `e2e-tests/test/utils.ts`). Used in a single test to verify contract emission correctness.
- `setupE2EDatabase(client, contract, setupFn)`: Sets up database schema, data, and writes contract marker (in `@prisma-next/runtime/test/utils`)
- `createTestRuntimeFromClient(contract, client, adapter)`: Creates a runtime with standard test configuration (in `@prisma-next/runtime/test/utils`)
- `executePlanAndCollect<P extends Plan>(runtime, plan)`: Executes a plan and collects all results into an array (in `@prisma-next/runtime/test/utils`). The return type is automatically inferred from the plan's type parameter using `ResultType<P>[]`.

**E2E Test Structure:**
```typescript
import { withDevDatabase, withClient } from '@prisma-next/test-utils';
import {
  setupE2EDatabase,
  createTestRuntimeFromClient,
  executePlanAndCollect,
} from '@prisma-next/runtime/test/utils';
import { loadContractFromDisk, emitAndVerifyContract } from './utils';
import type { Contract } from './fixtures/generated/contract.d';

describe('end-to-end tests', () => {
  const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');
  const contractTsPath = resolve(__dirname, 'fixtures/contract.ts');
  const cliPath = resolve(repoRoot, 'packages/cli/dist/cli.js');
  const adapterPath = resolve(repoRoot, 'packages/adapter-postgres');

  // Single test to verify contract emission correctness
  it('emits contract and verifies it matches on-disk artifacts', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, contractJsonPath);
  });

  // All other tests load from committed artifacts
  it('test description', async () => {
    // Load contract (already emitted, committed to fixtures)
    // Type parameter comes from emitted contract.d.ts
    const contract = await loadContractFromDisk<Contract>(contractJsonPath);

    await withDevDatabase(
      async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          // Setup database with test-specific schema/data
          await setupE2EDatabase(client, contract, async (c) => {
            await c.query('create table "user" ...');
            await c.query('insert into "user" ...');
          });

          // Create runtime and execute plan
          const adapter = createPostgresAdapter();
          const runtime = createTestRuntimeFromClient(contract, client, adapter);
          try {
            const tables = schema<Contract, CodecTypes>(contract).tables;
            const plan = sql<Contract, CodecTypes>({ contract, adapter })
              .from(tables.user)
              .select({ id: tables.user.columns.id })
              .build();

            // Return type is automatically inferred from plan
            const rows = await executePlanAndCollect(runtime, plan);
            type Row = ResultType<typeof plan>;  // Optional: for type tests
            expect(rows.length).toBeGreaterThan(0);
          } finally {
            await runtime.close();
          }
        });
      },
      { acceleratePort: 54020, databasePort: 54021, shadowDatabasePort: 54022 },
    );
  });
});
```

**Benefits:**
- **Reduced duplication**: Common patterns extracted to shared helpers (28% reduction in e2e test file size)
- **Consistency**: All e2e tests use the same setup/teardown patterns
- **Maintainability**: Changes to test infrastructure happen in one place
- **Readability**: Tests focus on test-specific logic, not boilerplate
- **Type safety**: Return types are automatically inferred from plans, preserving full type information

**Contract Loading Strategy:**
- **Tests rely on already-emitted artifacts**: E2E tests load contracts from committed fixtures (`test/fixtures/generated/contract.json` and `contract.d.ts`) rather than emitting on every test run. This allows tests to use the specific contract types from `contract.d.ts` at compile time.
- **Single verification test**: One test (`emitAndVerifyContract`) verifies that contract emission produces the expected artifacts. This test ensures the on-disk files stay in sync with the contract source.
- **Developer responsibility**: Developers are responsible for keeping the on-disk contract artifacts up-to-date when they change the contract source. The verification test will fail if artifacts are out of sync.
- **Benefits**: Reduces test execution time, ensures contract artifacts are stable, and enables compile-time type checking using the emitted contract types.

See `packages/test-utils/README.md` for full documentation of generic helpers, `packages/runtime/README.md` for runtime-specific test utilities, and `packages/e2e-tests/README.md` for contract-related E2E test utilities.

### Running Tests and Coverage

**Test Commands:**
- `pnpm test` - Run all tests (packages + examples)
- `pnpm test:packages` - Test only packages (exclude examples)
- `pnpm test:examples` - Test only examples

**Coverage Commands:**
- `pnpm test:coverage` - Run tests with coverage for all packages (including examples)
- `pnpm test:coverage:packages` - Run tests with coverage for packages only (excludes example apps)
- `pnpm --filter <package-name> test:coverage` - Run tests with coverage for a specific package

**Examples:**
```bash
# Run all tests
pnpm test

# Run tests for packages only
pnpm test:packages

# Run coverage for all packages (excluding examples)
pnpm test:coverage:packages

# Run coverage for a specific package
pnpm --filter @prisma-next/sql-query test:coverage
```

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
4. **Use bracket notation for index signatures** - `tables['user']` not `tables.user` when TypeScript requires it (e.g., `TS4111` error). This is required when accessing properties from index signatures.
5. **Arktype optional syntax** - Use `'key?'` not `key: 'Type | undefined'`.
6. **Builder chaining** - SQL builder methods return new instances. Always chain: `let query = sql(...).from(...); query = query.where(...); query = query.select(...);`
7. **Column access** - Use `table.columns[fieldName]` or `table['columns'][fieldName]` to avoid conflicts with table properties like `name`.
8. **Type tests** - Use `toExtend()` not `toMatchTypeOf()` - see `.cursor/rules/vitest-expect-typeof.mdc`
9. **Core is lane-agnostic** - Never create discriminated unions based on `lane` field. The core should not be aware of specific lane implementations.
10. **Unified Type Identifiers** - Every column `type` must be a fully qualified type ID (`ns/name@version`). Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation. No codec decorations or scalar fallbacks.
11. **CodecTypes Generic** - Always provide `CodecTypes` as a generic parameter to `sql()` and `schema()` functions. Import from adapter exports: `import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types'`
12. **Contract Validation** - Always validate contracts with `validateContract<Contract>(contractJson)` before use. **CRITICAL**: The type parameter `TContract` must be a fully-typed contract type (from `contract.d.ts`), NOT a generic `SqlContract<SqlStorage>`. Using a generic type will cause all subsequent type inference to fail (types will be `unknown`). **Important**: `validateContract()` does not perform canonicalization - it expects all types to already be fully qualified type IDs (`pg/int4@1`, not `int4`). Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation. The contract JSON must contain only fully qualified type IDs. See `.cursor/rules/validate-contract-usage.mdc` for details.
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
23. **No Target Branches** - **CRITICAL**: Never branch on `target` (e.g., `if (target === 'postgres')`) in core packages. Target-specific logic belongs in adapters or extension packs. See `.cursor/rules/no-target-branches.mdc` for details.
24. **No Global Registry Pattern** - The emitter accepts `targetFamily: TargetFamilyHook` as a direct parameter to `emit()`. Authoring surfaces determine which target family SPI to use based on the contract's `targetFamily` field and pass it directly. No global registry, auto-registration, or hidden state. Dependencies are explicit and passed as parameters.
25. **SQL Types Import Path** - **CRITICAL**: SQL-specific contract types (`SqlContract`, `SqlStorage`, `SqlMappings`, etc.) must be imported from `@prisma-next/sql-target`, **not** from `@prisma-next/contract/types`. See `.cursor/rules/sql-types-imports.mdc` for details.
26. **Node.js Globals Restriction** - `console`, `process`, `__dirname`, `__filename`, and `URL` are only permitted in test files, `packages/node-utils`, and `packages/cli`. Other packages should not use these globals directly. If needed, use `// biome-ignore lint: <reason>` with a comment explaining why.
27. **Generated File Metadata** - `contract.json` files include a `_generated` metadata field to indicate they're generated artifacts. This field is excluded from canonicalization/hashing. `contract.d.ts` files include warning header comments. Both are generated by `prisma-next emit` and should not be edited manually.
28. **Avoid Unnecessary Type Casts** - **CRITICAL**: Always check the actual type signature before adding type casts (`as unknown as T`) or optional chaining (`?.`). Unnecessary casts are a code smell that indicates the actual type already supports what you're trying to do. For example, if a codec accepts `string | Date`, don't cast `Date` to `string` - pass it directly. Only use type casts when testing invalid inputs with `@ts-expect-error`. See `.cursor/rules/typescript-patterns.mdc` for details.
29. **Use Dot Notation for Guaranteed Values** - When accessing values that are guaranteed to exist (e.g., in test fixtures, constants), use dot notation (`.`) instead of optional chaining (`?.`). Optional chaining should only be used for values that might not exist (e.g., user input, API responses). Similarly, don't include `| undefined` in type assertions when values are guaranteed to exist. See `.cursor/rules/typescript-patterns.mdc` for details.
30. **Biome Ignore Comments** - If you need to disable a rule for more than a couple of lines in a file, use a file-level ignore comment at the top of the file instead of many inline comments. Example: `// biome-ignore lint: test file with type assertions`
31. **Unused Variables Pattern** - Variables that are only used as types should be prefixed with `_` to indicate they're intentionally unused. Biome's `noUnusedVariables` rule is configured to ignore variables starting with `_`. Example: `const _plan = sql(...).build(); type Row = ResultType<typeof _plan>;`
32. **Empty Object Types** - Use `Record<string, never>` instead of `{}` for empty object types in type definitions. This provides better type safety.
33. **JSON Imports** - Use `import` statements with `assert { type: 'json' }` instead of `require()` for JSON files. Example: `import contractJson from './fixtures/contract.json' assert { type: 'json' };`
34. **Type Constraint Fixes** - When fixing type errors by replacing `any` with `unknown`, ensure the constraints match the actual interface requirements. Don't use `unknown` for type parameters that have specific constraints (e.g., `string`, `Record<...>`). Use the actual constraint types from the interface definition.
35. **DRY Test Patterns** - Common patterns in test files (like executing plans) should be extracted into helper functions with JSDoc comments explaining their purpose. This reduces code duplication and makes tests more maintainable.
36. **Biome Config File** - Biome config file is `biome.json` at the root. All package lint scripts explicitly specify the config file using `--config-path ../../biome.json`.

## 📖 Documentation Location

- **Architecture**: `docs/architecture docs/` (subsystems + ADRs)
- **MVP Spec**: `docs/MVP-Spec.md`
- **Briefs**: `docs/briefs/` (implementation slices)
- **Workspace Rules**: `.cursor/rules/` (Arktype usage, architecture guidance)

## 📊 Current Projection System State

This section describes the current state of the projection system, which is needed for implementing nested projection shaping (Slice 6).

### Current Implementation

**Type Inference:**
- `InferProjectionRow<P extends Record<string, ColumnBuilder>>` only supports flat projections
- Maps `Record<string, ColumnBuilder>` to `Record<string, JsType>` by extracting pre-computed `JsType` from each `ColumnBuilder`
- Located in `packages/sql-query/src/types.ts`

**Projection Building:**
- `buildProjectionState()` function accepts `Record<string, ColumnBuilder>` (flat only)
- Returns `ProjectionState` with flat `aliases: string[]` and `columns: ColumnBuilder[]` arrays
- Located in `packages/sql-query/src/sql.ts`
- Validates that all projection values are `ColumnBuilder` instances

**Aliasing:**
- Simple 1:1 mapping from projection key to SQL alias
- No collision detection for nested paths
- Aliases are used directly in AST `project` array: `{ alias: string; expr: ColumnRef }[]`

**Plan Meta:**
- `meta.projection`: `Record<string, string>` mapping alias → `table.column`
- `meta.projectionTypes`: `Record<string, string>` mapping alias → type ID (fully qualified `ns/name@version`)
- `meta.annotations.codecs`: `Record<string, string>` mapping alias → type ID
- All built from flat projection aliases

**Joins:**
- Joins are already implemented (Slice 5 complete)
- Supports `innerJoin()`, `leftJoin()`, `rightJoin()`, `fullJoin()` with `on.eqCol(left, right)` pattern
- Join columns are available for selection in projections
- Result typing is derived solely from projection, unaffected by joins

### What Needs to Change for Nested Projections

**Type Inference:**
- Extend `InferProjectionRow` to support recursive nested objects: `Record<string, ColumnBuilder | NestedProjection>`
- `NestedProjection` would be `Record<string, ColumnBuilder | NestedProjection>` (recursive)
- Leaf types use `ComputeColumnJsType` via `CodecTypes[typeId].output`, preserving nullability

**Alias Generation:**
- Implement deterministic alias generator for nested paths
- Options: dotted paths (`post.title`) or flattened paths (`post_title`)
- Must guard against collisions and throw `PLAN.INVALID` on collision
- Need reversible map for meta (if using flattened paths)

**Projection Building:**
- Extend `buildProjectionState()` to accept nested objects
- Flatten nested projection to flat `{ alias, expr: ColumnRef }[]` at AST generation time
- Update `meta.projection`, `meta.projectionTypes`, and `meta.annotations.codecs` to use generated aliases

**AST:**
- `SelectAst.project` remains flat array: `ReadonlyArray<{ alias: string; expr: ColumnRef }>`
- Builder flattens nested projection into this flat structure

**Runtime:**
- Runtime remains flat (no nested row materialization in MVP)
- Returns flat JS objects keyed by aliases
- Type system provides nested shape via `ResultType<typeof plan>`

See `docs/briefs/06-SQL-Lane-Nested-Projection-Shaping.md` for the full implementation brief.

## 🧪 Test Coverage

### Coverage Goals

- **Target**: 90-100% coverage for all packages
- **Priority**: Focus on packages first, examples can be lower priority
- **Strategy**: Use vitest with v8 provider for coverage collection

### Coverage Commands

**Check Coverage:**
- `pnpm test:coverage:packages` - Run tests with coverage for all packages (excludes examples)
- `pnpm --filter <package-name> test:coverage` - Run tests with coverage for a specific package
- `pnpm test:coverage` - Run tests with coverage for all packages including examples

**Examples:**
```bash
# Check coverage for all packages
pnpm test:coverage:packages

# Check coverage for a specific package
pnpm --filter @prisma-next/sql-query test:coverage

# Check coverage for all packages including examples
pnpm test:coverage
```

### Coverage Configuration

- **Provider**: Vitest with v8 provider (`@vitest/coverage-v8`)
- **Exclusions**: `dist/**`, `test/**`, `**/*.test.ts`, `**/*.test-d.ts`, `**/*.config.ts`, `**/exports/**`
- **Reporters**: text, json, html
- **Configuration**: Per-package `vitest.config.ts` files

### Coverage Strategy

1. **Identify gaps**: Run coverage reports to find untested code paths
2. **Prioritize critical paths**: Focus on core functionality first (contract validation, query building, runtime execution)
3. **Add integration tests**: Ensure end-to-end flows are covered
4. **Type tests**: Use `.test-d.ts` files for type-level testing (doesn't affect coverage but ensures type safety)
5. **Edge cases**: Test error conditions, boundary cases, and invalid inputs

## 🔄 CI/CD

### GitHub Actions Workflow

The repository uses GitHub Actions for continuous integration. The workflow is defined in `.github/workflows/ci.yml` and runs on every push and pull request.

### CI Jobs

The workflow consists of separate jobs that run in parallel where possible:

1. **typecheck** - Runs TypeScript type checking for packages and examples
   - No dependencies, runs independently
   - Uses `pnpm typecheck:packages` and `pnpm typecheck:examples`

2. **lint** - Runs Biome for packages and examples
   - No dependencies, runs independently
   - Uses `pnpm lint:packages` and `pnpm lint:examples`

3. **build** - Builds all packages
   - No dependencies, runs independently
   - Required by test jobs

4. **test** - Runs unit and integration tests
   - Depends on `build` job
   - Requires Postgres service (PostgreSQL 15)
   - Uses `pnpm test:packages` and `pnpm test:examples`

5. **test-e2e** - Runs end-to-end tests
   - Depends on `build` job
   - Requires Postgres service (PostgreSQL 15)
   - Uses `pnpm --filter @prisma-next/e2e-tests test`

6. **coverage** - Generates and reports test coverage
   - Depends on `build` job
   - Requires Postgres service (PostgreSQL 15)
   - Uses `pnpm test:coverage:packages`
   - Uploads coverage artifacts (retained for 7 days)
   - Optional Codecov integration (requires `CODECOV_TOKEN` secret)

### Workflow Features

- **Concurrency control**: Cancels in-progress runs when new commits are pushed
- **Caching**: Uses pnpm cache for faster dependency installation
- **Postgres service**: Configured for test, test-e2e, and coverage jobs with health checks
- **Parallel execution**: typecheck, lint, and build run in parallel; test jobs run in parallel after build completes
- **Coverage reporting**: Coverage reports are uploaded as artifacts and optionally sent to Codecov

### Running CI Locally

To simulate CI locally, run the same commands in sequence:

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Type check
pnpm typecheck:packages
pnpm typecheck:examples

# Lint
pnpm lint:packages
pnpm lint:examples

# Build
pnpm build

# Test (requires Postgres)
pnpm test:packages
pnpm test:examples

# E2E tests (requires Postgres)
pnpm --filter @prisma-next/e2e-tests test

# Coverage (requires Postgres)
pnpm test:coverage:packages
```

### CI Configuration

- **Node version**: 20
- **pnpm version**: 9
- **Postgres version**: 15
- **OS**: ubuntu-latest

## 🎯 What to Work On Next

### Recent Implementation (Completed)

1. **Emitter Target Family SPI** - Refactored emitter to accept `TargetFamilyHook` as a direct parameter to `emit()`. Removed global registry pattern. Authoring surfaces determine which target family SPI to use based on contract's `targetFamily` and pass it directly. No auto-registration or global state. SQL target family SPI (`sqlTargetFamilyHook`) lives in `sql-target` package. Adapters treated identically to extension packs.
2. **Type Canonicalization at Authoring Time** - Type canonicalization (shorthand → fully qualified IDs) happens at authoring time (PSL parser or TS builder), not during emission or validation. Emitter only validates type IDs come from referenced extensions.
3. **Removed Canonicalization from validateContract** - `validateContract()` no longer performs canonicalization. Contracts must always have fully qualified type IDs (`pg/int4@1`, not `int4`). This enforces the design principle that canonicalization happens at authoring time, not during validation.
4. **Removed canonicalScalarMap** - Extension pack manifests no longer include `canonicalScalarMap`. Type canonicalization happens at authoring time using extension manifests, not via a scalar map. This keeps manifests focused on type imports for code generation.
5. **No Target-Specific Branches** - Removed target-specific branching (`if (target === 'postgres')`) from core packages. Target-specific logic belongs in adapters or extension packs. See `.cursor/rules/no-target-branches.mdc` for details.
6. **Emitter I/O Decoupling** - Emitter returns strings (`contractJson`, `contractDts`); caller handles all file I/O. Enables testing without file system dependencies and flexible build system integration.
7. **SQL Contract Types Migration** - Moved SQL contract types (`SqlContract`, `SqlStorage`, etc.) from `sql-query` to `sql-target` to break circular dependency. All SQL-specific types now live in `sql-target`.
8. **Package Rename** - Renamed `@prisma-next/sql` to `@prisma-next/sql-query` to better reflect its purpose as query builder.
9. **Node Utils Package** - Created `@prisma-next/node-utils` package for file I/O utilities (`readJsonFile`, `readTextFile`). Extracted from emitter to keep I/O concerns separate.
10. **Unified Type Identifiers** - All column types are fully qualified type IDs (`ns/name@version`). Canonicalization happens at authoring time.
11. **Simplified Type Inference** - `ComputeColumnJsType` pre-computes JS types in `ColumnBuilder` using `CodecTypes[typeId].output`. No fallbacks or scalar mappings.
12. **Runtime Simplification** - Removed target-specific logic from runtime. Codec resolution uses type IDs directly.
13. **Interface-Based Design** - Refactored codec system to export interfaces and factory functions (`createCodecRegistry()`, `defineCodecs()`) instead of classes. Implementation classes are private.
14. **Type Preservation** - Fixed generic type system to preserve literal string types (e.g., `'pg/text@1'`) through mapped types and careful constraints. Removed index signatures from generic parameters.
15. **Test Infrastructure** - Fixed port conflicts in parallel test execution by assigning unique port ranges to each test suite.
16. **E2E Tests Package** - Created `@prisma-next/e2e-tests` package that tests the full flow: CLI emission → contract validation → runtime execution → type verification. Tests emit contracts via CLI, spin up dev Postgres DB, execute queries, and verify both runtime results and compile-time types.
17. **Shared Test Utilities Package** - Created `@prisma-next/test-utils` package to centralize common test patterns across all test suites. Provides helpers for database management, plan execution, runtime creation, contract management, and E2E testing. Refactored e2e tests to use shared utilities, reducing duplication by 28% (1219 → 882 lines). E2E tests now load contracts from committed fixtures rather than emitting on every test run, with a single test verifying contract emission correctness. The `executePlanAndCollect` function now properly infers return types from plans using `ResultType<P>[]`, preserving full type information. Contract loading uses a generic type parameter pattern (`loadContractFromDisk<Contract>`) to enable compile-time type checking with emitted contract types. See "E2E Test Patterns" section above for usage examples.
18. **Test Utilities Dependency Refactoring** - Broke circular dependency between `test-utils` and `runtime` by moving runtime-specific utilities (`executePlanAndCollect`, `drainPlanExecution`, `setupTestDatabase`, `writeTestContractMarker`, `createTestRuntime`, `createTestRuntimeFromClient`, `setupE2EDatabase`) to `runtime/test/utils.ts`. Removed all dependencies from `test-utils` on other `@prisma-next/*` packages by moving contract-related functions (`loadContractFromDisk`, `emitAndVerifyContract`) to `e2e-tests/test/utils.ts`. `test-utils` now has zero dependencies on other `@prisma-next/*` packages, allowing it to be used by all packages without circular dependencies. Runtime-specific utilities are in `@prisma-next/runtime/test/utils`, and contract helpers are in `e2e-tests/test/utils.ts` (local to e2e-tests).
19. **SQL Types Import Correction** - Fixed incorrect imports of SQL types from `@prisma-next/contract/types` to use `@prisma-next/sql-target` instead. SQL-specific types (`SqlContract`, `SqlStorage`, `SqlMappings`) must be imported from `@prisma-next/sql-target`. See `.cursor/rules/sql-types-imports.mdc` for details.
20. **GitHub Actions CI Workflow** - Set up comprehensive CI workflow with separate jobs for typecheck, lint, build, test, e2e tests, and coverage. Workflow includes concurrency control, Postgres service configuration, coverage artifact uploads, and optional Codecov integration. All jobs run in parallel where possible for faster feedback.
21. **Generated File Metadata** - Added `_generated` metadata field to `contract.json` files to indicate they're generated artifacts. This field is excluded from canonicalization/hashing to ensure determinism. Added warning header comments to `contract.d.ts` files. Both prevent accidental manual edits and guide users to regenerate using `prisma-next emit`.
22. **Node.js Globals Restriction** - Restricted Node.js globals (`console`, `process`, `__dirname`, `__filename`, `URL`) to only be permitted in test files, `packages/node-utils`, and `packages/cli` via Biome configuration. This enforces better separation of concerns and prevents accidental use of Node.js-specific APIs in core packages.
23. **Avoiding Unnecessary Type Casts and Optional Chaining** - Added guidance on avoiding unnecessary type casts and optional chaining. Always check the actual type signature before adding casts. Use dot notation (`.`) instead of optional chaining (`?.`) when values are guaranteed to exist. Only use type casts when testing invalid inputs with `@ts-expect-error`. See `.cursor/rules/typescript-patterns.mdc` for details.

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
// IMPORTANT: validateContract() does not canonicalize types - it expects all types to already be fully qualified (e.g., 'pg/int4@1', not 'int4')
// Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation
// CRITICAL: validateContract<TContract>() requires a fully-typed contract type TContract (from contract.d.ts), NOT a generic SqlContract<SqlStorage>
// Using a generic type will cause all subsequent type inference to fail (types will be 'unknown')
const contract = validateContract<Contract>(contractJson);

// In E2E tests, use loadContractFromDisk to load from committed fixtures
// Note: loadContractFromDisk is in e2e-tests/test/utils.ts, not test-utils
import { loadContractFromDisk } from './utils';

const contract = await loadContractFromDisk<Contract>(contractJsonPath);
// Type parameter comes from emitted contract.d.ts, enabling compile-time type checking
```

**Create a query:**
```typescript
import { sql, schema, param } from '@prisma-next/sql-query/sql';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';

const tables = schema<Contract, CodecTypes>(contract).tables;
const t = makeT<Contract, CodecTypes>(contract);

// Basic query
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .select({ id: t.user.id, email: t.user.email })
  .build();

// Query with join
const joinedPlan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .innerJoin(tables.post, (on) => on.eqCol(t.user.id, t.post.userId))
  .where(t.user.active.eq(param('active')))
  .select({
    userId: t.user.id,
    postId: t.post.id,
    title: t.post.title,
  })
  .build({ params: { active: true } });
```

**Emit a contract:**
```typescript
import { emit } from '@prisma-next/emitter';
import { loadExtensionPacks } from '@prisma-next/emitter';
import type { ContractIR, EmitOptions } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';

// Load extension packs (adapter + extensions)
const packs = loadExtensionPacks(
  './packages/adapter-postgres',
  ['./packages/extension-pack']
);

// Determine target family SPI based on contract's targetFamily
// For SQL contracts, use sqlTargetFamilyHook
const targetFamily = sqlTargetFamilyHook;

// Emit contract (returns strings, caller handles file I/O)
const result = await emit(ir, {
  outputDir: './dist',
  packs,
}, targetFamily);

// Write files (caller responsibility)
await writeFile('./contract.json', result.contractJson);
await writeFile('./contract.d.ts', result.contractDts);
```

**Extract row type from plan:**
```typescript
import type { ResultType } from '@prisma-next/sql-query/types';

const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .select({ id: t.user.id, email: t.user.email })
  .build();

type UserRow = ResultType<typeof plan>;  // Inferred type: { id: number; email: string }

// With joins
const joinedPlan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(tables.user)
  .innerJoin(tables.post, (on) => on.eqCol(t.user.id, t.post.userId))
  .select({
    userId: t.user.id,
    postId: t.post.id,
    title: t.post.title,
  })
  .build();

type JoinedRow = ResultType<typeof joinedPlan>;  // { userId: number; postId: number; title: string }
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
    }
  }
}
```

---

**Remember**: This is a prototype. Some design docs describe future state. Focus on the MVP spec and the briefs marked "complete" for implemented features.

