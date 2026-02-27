# ParadeDB Core Extension — Execution Plan

## Summary

Implement the contract authoring foundation for ParadeDB BM25 full-text search indexes in Prisma Next, following the pgvector extension as a reference implementation.

**Spec:** `projects/parade-db-core/spec.md`

---

## Milestones

### Milestone 1: Extend Core Contract IR with Index Access Method

**Goal:** Make the `Index` type generic enough to support BM25 and other Postgres index access methods.

**Tasks:**

- [ ] **1.1** Add `IndexAccessMethod` type and extend `Index` in `packages/2-sql/1-core/contract/src/types.ts`
  - Add `IndexAccessMethod = 'btree' | 'bm25'` (closed union, see DD-1)
  - Add `using?: IndexAccessMethod` to `Index`
  - Add `Bm25FieldConfig` type with `column?`, `expression?`, `tokenizer`, `tokenizerParams`, `alias`
  - Add `keyField?: string` and `fieldConfigs?: readonly Bm25FieldConfig[]` to `Index`
- [ ] **1.2** Add `IndexDef` extensions in `packages/1-framework/2-authoring/contract/src/builder-state.ts`
  - Mirror the IR changes in the builder state types
- [ ] **1.3** Add factory functions in `packages/2-sql/1-core/contract/src/factories.ts`
  - `bm25Index(opts)` — creates an `Index` with `using: 'bm25'`
  - `bm25Field(column, opts?)` — creates a `Bm25FieldConfig` with `column`
  - `bm25ExprField(expression, opts)` — creates a `Bm25FieldConfig` with `expression` (requires `alias`)
- [ ] **1.4** Write unit tests for IR types and factory functions
  - Round-trip serialization (JSON.stringify → JSON.parse → type check)
  - Factory output validation
  - Backward compat: existing `index('col')` still works unchanged

### Milestone 2: Create `@prisma-next/extension-paradedb` Package

**Goal:** Scaffold the extension package following the pgvector pattern.

**Tasks:**

- [ ] **2.1** Scaffold package structure at `packages/3-extensions/paradedb/`
  - `package.json` (name: `@prisma-next/extension-paradedb`)
  - `tsconfig.json`, `tsconfig.prod.json`
  - `tsdown.config.ts`
  - Directory structure: `src/core/`, `src/exports/`, `src/types/`
- [ ] **2.2** Define constants (`src/core/constants.ts`)
  - `PARADEDB_EXTENSION_ID = 'paradedb'`
  - Tokenizer ID constants for all 12 tokenizers
- [ ] **2.3** Define extension descriptor metadata (`src/core/descriptor-meta.ts`)
  - `paradedbPackMeta` with `kind: 'extension'`, `familyId: 'sql'`, `targetId: 'postgres'`
  - Capabilities: `{ postgres: { 'paradedb/bm25': true } }`
- [ ] **2.4** Define index types (`src/types/index-types.ts`)
  - TypeScript types for BM25 index configuration
  - Tokenizer config types with per-tokenizer parameter shapes
- [ ] **2.5** Export control plane descriptor (`src/exports/control.ts`)
- [ ] **2.6** Export BM25 index helpers (`src/exports/index-types.ts`)
  - `bm25.text(column, opts?)`, `bm25.numeric(column)`, `bm25.boolean(column)`
  - `bm25.json(column, opts?)`, `bm25.datetime(column)`, `bm25.range(column)`
  - `bm25.expression(sql, opts)` — raw SQL expression field (requires `alias`)
- [ ] **2.7** Export extension pack (`src/exports/pack.ts`)
- [ ] **2.8** Register package in workspace root `pnpm-workspace.yaml` and `architecture.config.json`

### Milestone 3: Extend Table Builder with `bm25Index()` Method

**Goal:** Let contract authors declaratively define BM25 indexes in the table builder DSL.

**Tasks:**

- [ ] **3.1** Add `bm25Index()` method to `TableBuilder` in `packages/1-framework/2-authoring/contract/src/table-builder.ts`
  - Accepts `{ keyField?, fields, name? }`
  - Auto-infers `keyField` from single-column PK when omitted (see DD-4)
  - Throws at build time if PK is composite/missing and `keyField` is omitted
  - Produces an `IndexDef` with `using: 'bm25'` in the builder state
- [ ] **3.2** Ensure `SqlTableBuilder` in `packages/2-sql/2-authoring/contract-ts/` exposes the method
- [ ] **3.3** Write unit tests for the builder
  - Builder produces correct `IndexDef` with BM25 metadata
  - `keyField` auto-inferred from single-column PK
  - `keyField` explicit override with non-PK unique column
  - Error when composite PK and no explicit `keyField`
  - Field configs map to correct `Bm25FieldConfig` objects
  - Expression-based fields require `alias`

### Milestone 4: Extend Emitter for BM25 Indexes

**Goal:** The emitter serializes BM25 index definitions into `contract.json` and generates typed definitions in `contract.d.ts`.

**Tasks:**

- [ ] **4.1** Update `generateStorageType()` in `packages/2-sql/3-tooling/emitter/src/index.ts`
  - Serialize `using`, `keyField`, and `fieldConfigs` for BM25 indexes
  - Generate TypeScript type literals that capture BM25 index structure
- [ ] **4.2** Add emitter validation
  - `keyField` must reference a column with a unique constraint or primary key
  - All `fieldConfigs[*].column` values must reference existing columns
  - Expression-based fields (`fieldConfigs[*].expression`) must have a non-empty `alias`
  - Expression-based fields skip column-existence validation (raw SQL is opaque)
- [ ] **4.3** Write snapshot tests for emitter output
  - `contract.json` with BM25 indexes
  - `contract.d.ts` with typed BM25 index definitions

### Milestone 5: Integration & Validation

**Goal:** Ensure everything works end-to-end and passes CI checks.

**Tasks:**

- [ ] **5.1** Run `pnpm build` — all packages build successfully
- [ ] **5.2** Run `pnpm typecheck` — no type errors
- [ ] **5.3** Run `pnpm lint:deps` — no architectural boundary violations
- [ ] **5.4** Run `pnpm test:packages` — all tests pass
- [ ] **5.5** Write an integration test: author a contract with BM25 index → emit → verify `contract.json` contains correct BM25 IR
- [ ] **5.6** Update `architecture.config.json` with paradedb extension domain/layer/plane mapping

---

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/parade-db-core/spec.md`
- [ ] Migrate long-lived docs into `docs/`
- [ ] Delete `projects/parade-db-core/`
