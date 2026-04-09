# M1 Implementation Plan: Family Migration SPI + Vertical Slice

## Goal

Prove the full migration architecture works for MongoDB by cutting a thin vertical slice through every layer: contract → schema IR → planner → runner → CLI. The simplest case: one ascending index on one collection.

## Design references

| Area | Design doc |
|---|---|
| Schema IR | [schema-ir.spec.md](../specs/schema-ir.spec.md) |
| DDL commands + operation envelope | [operation-ast.spec.md](../specs/operation-ast.spec.md) |
| Operation envelope + serialization SPI | [operation-envelope.spec.md](../specs/operation-envelope.spec.md) |
| DDL command dispatch | [ddl-command-dispatch.spec.md](../specs/ddl-command-dispatch.spec.md) |
| Check evaluator | [check-evaluator.spec.md](../specs/check-evaluator.spec.md) |
| Contract types + contractToSchema | [contract-to-schema-and-introspection.spec.md](../specs/contract-to-schema-and-introspection.spec.md) |
| Planner + runner | [planner-runner.spec.md](../specs/planner-runner.spec.md) |
| CLI display | [cli-display.spec.md](../specs/cli-display.spec.md) |

## Implementation sequence

Tasks are grouped into **phases** by dependency. Tasks within a phase are independent and can be worked in parallel.

### Phase 1: Foundation (no inter-task dependencies)

#### 1.1 Validate migration SPI for Mongo

**Goal:** Confirm the existing `TargetMigrationsCapability` / `MigrationPlanner` / `MigrationRunner` interfaces work for the Mongo target without structural changes.

**What to do:**
- Read the existing SPI types in `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`
- Identify any assumptions that prevent Mongo usage (e.g., SQL-specific type constraints)
- If everything works: document the finding, no code changes
- If something blocks: make the minimal change to unblock, document the change

**Artifacts:**
- Finding documented in this plan or a design note
- If changes needed: tests proving SQL still works through the modified surface

**Package:** `packages/1-framework/1-core/framework-components/`

---

#### 1.3 Extend `MongoStorageCollection` with index definitions

**Goal:** Change `MongoStorageCollection` from `Record<string, never>` to carry index definitions.

**What to do:**
- Define `MongoIndexKey` type: `{ field: string; direction: MongoIndexKeyDirection }` where `MongoIndexKeyDirection = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed'`
- Define `MongoStorageIndex`: `{ keys: ReadonlyArray<MongoIndexKey>; unique?: boolean; sparse?: boolean; expireAfterSeconds?: number; partialFilterExpression?: Record<string, unknown> }`
- Update `MongoStorageCollection` to: `{ indexes?: ReadonlyArray<MongoStorageIndex> }`
- M1 scope: only `keys` with direction `1` or `-1`, and `unique` option. Other key types and options exist in the type definition but are only exercised in M2.

**Tests:**
- Type-level tests: `MongoStorageCollection` accepts index definitions
- Snapshot or structural tests for the type shape

**Package:** `packages/2-mongo-family/1-foundation/mongo-contract/`

---

#### 1.4 Update `MongoContractSchema` (Arktype validation)

**Goal:** Update the Arktype schema so it validates index definitions instead of rejecting all keys.

**What to do:**
- Replace `StorageCollectionSchema = type({ '+': 'reject' })` with a schema accepting `indexes?: MongoStorageIndexSchema[]`
- Define `MongoIndexKeySchema`, `MongoStorageIndexSchema`
- For M1: validate the full shape (all key directions, all options) even though only ascending/descending + unique are tested

**Tests:**
- Valid: collection with no indexes (backward compat), collection with one ascending index, collection with unique index
- Invalid: missing `keys`, invalid direction, extra unknown properties

**Package:** `packages/2-mongo-family/1-foundation/mongo-contract/`

**Depends on:** 1.3

---

#### 1.5 Define `MongoSchemaIR` AST

**Goal:** Implement the class-based AST representing MongoDB server-side state for diffing.

**What to do:**
- Create new package `@prisma-next/mongo-schema-ir` at `packages/2-mongo-family/3-tooling/mongo-schema-ir/`
- Implement:
  - `MongoSchemaNode` abstract base: abstract `kind`, `accept(visitor)`, `freeze()`
  - `MongoSchemaIndex`: `kind = 'index'`, keys, unique, sparse, expireAfterSeconds, partialFilterExpression
  - `MongoSchemaCollection`: `kind = 'collection'`, name, indexes array, optional validator/options (typed but not populated in M1)
  - `MongoSchemaIR` interface: `{ collections: Record<string, MongoSchemaCollection> }`
  - `MongoSchemaVisitor<R>`: methods for `collection`, `index`, `validator`, `collectionOptions` (validator/options methods throw for M1)
  - `AnyMongoSchemaNode` union type
  - `MongoIndexKey` type (shared with contract types — re-export or shared)
  - `indexesEquivalent` helper function
- Register in `architecture.config.json` under mongo domain, tooling layer, migration plane
- Add `package.json`, `tsconfig.json`, `tsdown.config.ts` following existing package patterns

**Tests:**
- AST construction: create collection with indexes, verify fields
- Freeze behavior: mutation after construction throws
- Visitor dispatch: visitor receives correct node types
- `indexesEquivalent`: same keys = equivalent, different order = not equivalent, different direction = not equivalent, different unique = not equivalent, name ignored

**Package:** `packages/2-mongo-family/3-tooling/mongo-schema-ir/`

---

#### 1.7a Add DDL and inspection commands to `mongo-query-ast`

**Goal:** Add DDL command AST classes and inspection command AST classes, split package into `/execution` and `/control` entrypoints.

**What to do:**
- **DDL commands** (in new source file, e.g. `ddl-commands.ts`):
  - `CreateIndexCommand extends MongoAstNode`: collection, keys, options (unique, sparse, etc.), name; `accept<R>(visitor: MongoDdlCommandVisitor<R>): R`
  - `DropIndexCommand extends MongoAstNode`: collection, name; `accept(visitor)`
  - `AnyMongoDdlCommand` union
  - `MongoDdlCommandVisitor<R>` interface
- **Inspection commands** (in new source file, e.g. `inspection-commands.ts`):
  - `ListIndexesCommand extends MongoAstNode`: collection; `accept(visitor)`
  - `ListCollectionsCommand extends MongoAstNode`: no fields; `accept(visitor)`
  - `AnyMongoInspectionCommand` union
  - `MongoInspectionCommandVisitor<R>` interface
- **Entrypoint split:**
  - Delete existing `"."` entrypoint from `package.json` exports
  - Create `src/exports/execution.ts`: re-export existing DML commands, raw commands, `MongoQueryPlan`
  - Create `src/exports/control.ts`: export DDL commands, inspection commands, visitors, migration check/step/operation types
  - Keep shared types (filter expressions, `MongoAstNode`, aggregation expressions, stages, visitors) accessible from both — either via a shared `"."` entrypoint or by re-exporting from both
  - Update all existing consumers to import from `@prisma-next/mongo-query-ast/execution` instead of `@prisma-next/mongo-query-ast`
- Register `/control` entrypoint in `architecture.config.json` under mongo domain, query layer, migration plane (or shared if needed by both planes)

**Tests:**
- DDL command construction: fields set correctly, frozen
- Inspection command construction: fields set, frozen
- Visitor dispatch: visitor methods called with correct command instances
- Import paths: consumers can import from `/execution` and `/control`

**Package:** `packages/2-mongo-family/4-query/query-ast/`

---

#### 1.7c Implement client-side `FilterEvaluator`

**Goal:** Implement `MongoFilterVisitor<boolean>` that evaluates filter expressions against in-memory JavaScript objects.

**What to do:**
- Implement `FilterEvaluator` class implementing `MongoFilterVisitor<boolean>`
- Support: `$eq` (deep structural equality, key-order sensitive), `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`, `$and`, `$or`, `$not`, `$exists`
- Support dotted field paths (`options.validator.$jsonSchema`)
- `MongoExprFilter` (aggregation expressions) → throw unsupported error
- Implement `getNestedField(doc, path)` helper
- Implement `deepEquals(a, b)` helper (key-order sensitive for objects)

**Tests:** (see [check-evaluator.spec.md](../specs/check-evaluator.spec.md) for full list)
- Operator semantics: `$eq` on primitives, nested objects, arrays; `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`
- Logical combinators: `$and`, `$or`, `$not` with nested expressions
- `$exists`: true/false
- Dotted field paths: resolve through nested objects
- Deep equality: key-order sensitivity, array comparison, mixed types
- Edge cases: missing fields, `null` values, empty objects, empty arrays
- Error: `MongoExprFilter` throws

**Package:** `packages/3-mongo-target/` (alongside runner)

---

### Phase 2: Composition (depends on Phase 1 types)

#### 1.6 Implement `contractToSchema` for Mongo

**Goal:** Convert a `MongoContract` into a `MongoSchemaIR` for offline planning. `null` contract → empty IR.

**What to do:**
- Implement `contractToMongoSchemaIR(contract: MongoContract | null): MongoSchemaIR`
- Convert each `MongoStorageCollection` → `MongoSchemaCollection` with `MongoSchemaIndex` nodes
- Filter out `_id` index (never modeled)
- For M1: indexes only (no validator or options conversion)

**Tests:**
- Null contract → `{ collections: {} }`
- Empty collection (no indexes) → collection node with empty indexes
- Collection with one ascending index → correct IR
- Collection with unique index → correct IR
- Multiple collections → all converted

**Package:** `packages/3-mongo-target/`

**Depends on:** 1.3, 1.5

---

#### 1.7b Define `MongoMigrationPlanOperation` data envelope

**Goal:** Define the symmetric operation envelope that composes DDL commands, inspection commands, and filter-expression checks.

**What to do:**
- Define `MongoMigrationCheck`: description, source (inspection command), filter (MongoFilterExpr), expect ('exists' | 'notExists')
- Define `MongoMigrationStep`: description, command (DDL command)
- Define `MongoMigrationPlanOperation extends MigrationPlanOperation`: precheck[], execute[], postcheck[]
- Implement serialization: `serializeMongoOps(ops: MongoMigrationPlanOperation[]): string` (JSON)
- Implement deserialization: `deserializeMongoOps(json: string): MongoMigrationPlanOperation[]` (reconstruct AST nodes from kind discriminants)
- Implement Arktype validation schemas for deserialization
- Implement `buildIndexOpId(verb, collection, keys)` for deterministic operation IDs
- Implement `defaultMongoIndexName(keys)` for deterministic index names

**Tests:**
- Construction: fields set correctly
- JSON serialization round-trip: serialize → deserialize → structurally equal
- Operation ID generation: deterministic, unique per operation
- Index name generation: matches MongoDB convention
- Deserialization validation: invalid JSON shapes rejected

**Package:** `packages/2-mongo-family/4-query/query-ast/` (types in `/control` entrypoint), serialization in `packages/3-mongo-target/`

**Depends on:** 1.7a

---

### Phase 3: Planner (depends on Phases 1 + 2)

#### 1.8 Implement `MongoMigrationPlanner`

**Goal:** Diff destination contract against origin schema IR and produce index operations.

**What to do:**
- Implement `MongoMigrationPlanner` implementing `MigrationPlanner<'mongo', 'mongo'>`
- `plan()` method:
  1. Convert destination contract to schema IR via `contractToMongoSchemaIR`
  2. Diff origin IR vs destination IR collection by collection
  3. Index diffing: structural match by lookup key (keys + options), not by name
  4. Emit `createIndex` operations for added indexes (additive)
  5. Emit `dropIndex` operations for removed indexes (destructive)
  6. Policy gate: filter by allowed operation classes, return conflicts if disallowed ops exist
- Implement `planCreateIndex()` and `planDropIndex()` convenience functions
- Operation ordering: drops before creates (within M1 scope)

**Tests:**
- Add index: origin has none, destination has one → one createIndex op
- Drop index: origin has one, destination has none → one dropIndex op
- No-op: same indexes in both → empty operations
- Index identity: same keys different name → no-op (equivalent)
- Index identity: same name different keys → drop + create
- Multiple indexes: correct operations for each
- Policy: destructive disallowed → conflict for drop operations
- Correct precheck/execute/postcheck arrays on generated operations

**Package:** `packages/3-mongo-target/`

**Depends on:** 1.5, 1.6, 1.7a, 1.7b

---

### Phase 4: Runner + wiring (depends on Phase 3)

#### 1.9 Implement `MongoMigrationRunner`

**Goal:** Execute migration operations against a live MongoDB instance using the generic three-phase loop.

**What to do:**
- Implement `MongoMigrationRunner` implementing `MigrationRunner<'mongo', 'mongo'>`
- `execute()` method:
  1. Deserialize operations from plan (JSON → `MongoMigrationPlanOperation[]`)
  2. Read marker from `_prisma_migrations`
  3. Validate marker matches plan origin (if set)
  4. For each operation:
     - Idempotency probe: if postchecks already satisfied → skip
     - Prechecks: evaluate filter expressions against inspection command results → abort if any fail
     - Execute: dispatch DDL commands via visitor (`MongoDdlCommandVisitor<Promise<void>>`)
     - Postchecks: evaluate filter expressions → abort if any fail
  5. Update marker via CAS
  6. Write ledger entry
- Implement `MongoCommandExecutor` as `MongoDdlCommandVisitor<Promise<void>>`
- Implement `MongoInspectionExecutor` as `MongoInspectionCommandVisitor<Promise<Document[]>>` — runs inspection commands and returns result documents
- Implement check evaluation: run inspection command → evaluate filter against each result document via `FilterEvaluator` → check `expect`

**Tests (integration, using `mongodb-memory-server`):**
- Create index: operation creates the index on a real MongoDB instance
- Drop index: operation drops the index
- Idempotency: re-running a completed operation skips it (postchecks satisfied)
- Precheck failure: attempting to create an already-existing index with prechecks enabled → fails
- Three-phase flow: precheck → execute → postcheck order verified
- Multiple operations: all executed in order

**Package:** `packages/3-mongo-target/`

**Depends on:** 1.7b, 1.7c, 1.8

---

#### 1.10 Implement marker and ledger in `_prisma_migrations`

**Goal:** Store `ContractMarkerRecord` and migration ledger in a MongoDB collection.

**What to do:**
- Marker document shape: `{ _id: "marker", coreHash, profileHash, updatedAt, meta: {} }`
- Ledger document shape: `{ _id: ObjectId, type: "ledger", edgeId, from, to, appliedAt }`
- Implement `readMarker(db): Promise<ContractMarkerRecord | null>`
- Implement `initMarker(db, destination): Promise<void>` (insert)
- Implement `updateMarker(db, expectedFrom, destination): Promise<boolean>` (CAS via `findOneAndUpdate`)
- Implement `writeLedgerEntry(db, entry): Promise<void>`
- Wire `readMarker()` on the Mongo control family instance

**Tests (integration):**
- Read from empty collection → null
- Init marker → read returns correct values
- Update marker with correct expected hash → succeeds, returns true
- Update marker with wrong expected hash → returns false (CAS failure)
- Write ledger entry → entry exists in collection
- Multiple ledger entries → append-only

**Package:** `packages/3-mongo-target/`

**Depends on:** none (can start in Phase 1, but naturally integrates during Phase 4)

---

#### 1.2 Generalize CLI operation display

**Goal:** Replace the SQL-only `extractSqlDdl` path with a family-aware dispatch.

**What to do:**
- Implement `MongoDdlCommandFormatter` as `MongoDdlCommandVisitor<string>`
- Implement `formatMongoOperations(ops: readonly MigrationPlanOperation[]): string[]`
- Add `extractOperationStatements(familyId, operations)` dispatch function in CLI
- Update `migration-plan.ts`, `migration-show.ts`, `db-update.ts` to use the dispatch function instead of directly calling `extractSqlDdl`
- Remove `familyId === 'sql'` guard in `db-update.ts`

**Tests:**
- `formatMongoOperations`: createIndex → correct display string, dropIndex → correct display string
- CLI dispatch: SQL still uses `extractSqlDdl`, Mongo uses `formatMongoOperations`
- Existing SQL CLI tests continue to pass

**Package:** `packages/3-mongo-target/` (formatter), `packages/1-framework/3-tooling/cli/` (dispatch)

**Depends on:** 1.7a (DDL command types)

---

#### 1.11 Wire Mongo target descriptor

**Goal:** Add `migrations` capability to the Mongo target descriptor.

**What to do:**
- Add `migrations: { createPlanner, createRunner, contractToSchema }` to the Mongo target descriptor
- `createPlanner` returns `MongoMigrationPlanner` cast to `MigrationPlanner<'mongo', 'mongo'>`
- `createRunner` returns `MongoMigrationRunner` cast to `MigrationRunner<'mongo', 'mongo'>`
- `contractToSchema` delegates to `contractToMongoSchemaIR`
- Change the descriptor type from `ControlTargetDescriptor` to `MigratableTargetDescriptor`
- Verify the CLI discovers and uses the migrations capability via `hasMigrations()` / `getTargetMigrations()`

**Tests:**
- Descriptor shape assertion: `migrations` property exists and satisfies `TargetMigrationsCapability`
- `createPlanner()` returns a functional planner
- `createRunner()` returns a functional runner
- `contractToSchema(null)` returns empty IR

**Package:** `packages/3-mongo-target/1-mongo-target/` and/or `packages/2-mongo-family/9-family/`

**Depends on:** 1.6, 1.8, 1.9

---

### Phase 5: End-to-end proof

#### 1.12 End-to-end test: plan + apply single index

**Goal:** Prove the full pipeline works against a real MongoDB instance.

**What to do:**
- Hand-craft a contract with one collection and one ascending unique index
- Wire test through the CLI command surface (or directly through the SPI)
- Verify:
  1. `migration plan` produces a plan with one `createIndex` operation
  2. `migration apply` creates the index on a real MongoDB instance
  3. The index exists on the MongoDB instance (verify via `listIndexes`)
  4. The marker is updated with the destination contract hash
  5. A second contract removing the index → plan produces `dropIndex` → apply drops it
  6. Re-running `migration apply` after completion is idempotent (no-op)

**Tests (integration, using `mongodb-memory-server`):**
- Full create cycle: plan → apply → verify index exists + marker updated
- Full drop cycle: plan → apply → verify index removed + marker updated
- Idempotent re-apply: already-applied plan → no-op
- Ledger: entries recorded for each applied edge

**Package:** `test/integration/test/mongo/` or `packages/3-mongo-target/`

**Depends on:** all previous tasks

---

## Package summary

| New package | Location | Layer | Plane |
|---|---|---|---|
| `@prisma-next/mongo-schema-ir` | `packages/2-mongo-family/3-tooling/mongo-schema-ir/` | tooling | migration |

| Modified package | Changes |
|---|---|
| `@prisma-next/mongo-contract` | Index types on `MongoStorageCollection`, Arktype schema |
| `@prisma-next/mongo-query-ast` | DDL/inspection commands, entrypoint split to `/execution` + `/control` |
| `@prisma-next/target-mongo` / adapter | Planner, runner, command executor, filter evaluator, marker/ledger, contractToSchema, CLI formatter |
| `@prisma-next/cli` | `extractOperationStatements` dispatch replacing direct `extractSqlDdl` |
| Mongo family descriptor | `migrations` capability on target descriptor |

## Testing strategy

| Test type | Location | Framework | Infrastructure |
|---|---|---|---|
| Unit (types, AST, planner, evaluator) | Colocated `test/` in each package | Vitest | None |
| Integration (runner, marker, E2E) | `test/integration/test/mongo/` or package `test/` | Vitest | `mongodb-memory-server` via `MongoMemoryReplSet` |

**Mongo test setup patterns:**
- Use `MongoMemoryReplSet` (replica set mode) for integration tests — required for transactions and change streams
- Use `describeWithMongoDB` from `test/integration/test/mongo/setup.ts` for integration tests, or `withMongod` from the package-level helpers
- Set `timeout` and `hookTimeout` to `timeouts.spinUpDbServer` from `@prisma-next/test-utils`
- `beforeEach`: drop test database for isolation
- `fileParallelism: false` in vitest config for DB tests

## Dependency graph

```
Phase 1 (parallel):
  1.1  SPI validation ─────────────────────────────────────────┐
  1.3  Contract types ──────────┬───────────────────────────────┤
  1.4  Arktype schema ─────────┤                               │
  1.5  Schema IR ──────────────┤                               │
  1.7a DDL commands + split ───┤                               │
  1.7c Filter evaluator ───────┤                               │
  1.10 Marker/ledger ──────────┤                               │
                               │                               │
Phase 2:                       │                               │
  1.6  contractToSchema ───────┤  (needs 1.3, 1.5)            │
  1.7b Operation envelope ─────┤  (needs 1.7a)                │
  1.2  CLI display ────────────┤  (needs 1.7a)                │
                               │                               │
Phase 3:                       │                               │
  1.8  Planner ────────────────┤  (needs 1.5, 1.6, 1.7a, 1.7b)│
                               │                               │
Phase 4:                       │                               │
  1.9  Runner ─────────────────┤  (needs 1.7c, 1.8, 1.10)    │
  1.11 Target wiring ──────────┤  (needs 1.6, 1.8, 1.9)      │
                               │                               │
Phase 5:                       │                               │
  1.12 E2E proof ──────────────┘  (needs all)                  │
```

## Risk and open items

- **SPI compatibility (1.1):** If the framework SPI has SQL-specific assumptions that block Mongo, we refactor the minimum needed. This is an architectural validation exercise — document findings regardless.
- **Entrypoint migration (1.7a):** Deleting the `"."` entrypoint and updating all consumers is a potentially wide blast radius. Use a codemod or systematic search to find all import sites.
- **`MongoIndexKey` shared type:** Both `@prisma-next/mongo-contract` (1.3) and `@prisma-next/mongo-schema-ir` (1.5) need the `MongoIndexKey` type. Options: define in `mongo-contract` and import, or define in a shared package. Since `mongo-schema-ir` is in the tooling layer and `mongo-contract` is in foundation, the schema IR can import from the contract package. Define `MongoIndexKey` in `mongo-contract`.
