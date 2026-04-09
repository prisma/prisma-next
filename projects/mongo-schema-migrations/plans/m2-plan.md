# M2 Implementation Plan: Full Index Vocabulary + Validators + Collection Options

## Goal

Extend every layer of the MongoDB migration pipeline to cover the full breadth of MongoDB server-side configuration. M1 proved the architecture with a thin vertical slice (single ascending index). M2 fills in the vocabulary: all index types and options, `$jsonSchema` validators, collection options, and PSL authoring support.

## Design references

| Area | Design doc |
|---|---|
| M2 spec | [m2-full-vocabulary.spec.md](../specs/m2-full-vocabulary.spec.md) |
| Schema IR | [schema-ir.spec.md](../specs/schema-ir.spec.md) |
| DDL commands + operation envelope | [operation-ast.spec.md](../specs/operation-ast.spec.md) |
| Operation envelope + serialization | [operation-envelope.spec.md](../specs/operation-envelope.spec.md) |
| DDL command dispatch | [ddl-command-dispatch.spec.md](../specs/ddl-command-dispatch.spec.md) |
| Check evaluator | [check-evaluator.spec.md](../specs/check-evaluator.spec.md) |
| Contract types + contractToSchema | [contract-to-schema-and-introspection.spec.md](../specs/contract-to-schema-and-introspection.spec.md) |
| Planner + runner | [planner-runner.spec.md](../specs/planner-runner.spec.md) |
| CLI display | [cli-display.spec.md](../specs/cli-display.spec.md) |
| ADR 187 — MongoDB schema representation | [ADR 187](../../../docs/architecture%20docs/adrs/ADR%20187%20-%20MongoDB%20schema%20representation%20for%20migration%20diffing.md) |
| ADR 188 — MongoDB migration operation model | [ADR 188](../../../docs/architecture%20docs/adrs/ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) |
| ADR 189 — Structural index matching | [ADR 189](../../../docs/architecture%20docs/adrs/ADR%20189%20-%20Structural%20index%20matching%20for%20MongoDB%20migrations.md) |

## Implementation sequence

Tasks are grouped into **phases** by dependency. Tasks within a phase are independent and can be worked in parallel.

---

### Phase 1: Foundation types (no inter-task dependencies)

#### 2.1 Extend index options in contract types

**Goal:** Add the remaining index options to `MongoStorageIndex` and update Arktype validation.

**What to do:**
- Add to `MongoStorageIndex` (in `@prisma-next/mongo-contract`):
  - `wildcardProjection?: Record<string, 0 | 1>`
  - `collation?: Record<string, unknown>`
  - `weights?: Record<string, number>`
  - `default_language?: string`
  - `language_override?: string`
- Add corresponding Arktype schema entries in `MongoStorageIndexSchema`
- Export new types from `exports/index.ts`

**Tests:**
- Arktype validation: valid index with each new option, invalid shapes rejected
- Type-level: `MongoStorageIndex` accepts all option combinations

**Package:** `packages/2-mongo-family/1-foundation/mongo-contract/`

---

#### 2.2 Add validator and collection options to contract types

**Goal:** Add `MongoStorageValidator` and `MongoStorageCollectionOptions` types and update Arktype validation.

**What to do:**
- Define `MongoStorageValidator`:
  ```typescript
  interface MongoStorageValidator {
    readonly jsonSchema: Record<string, unknown>;
    readonly validationLevel: 'strict' | 'moderate';
    readonly validationAction: 'error' | 'warn';
  }
  ```
- Define `MongoStorageCollectionOptions`:
  ```typescript
  interface MongoStorageCollectionOptions {
    readonly capped?: { size: number; max?: number };
    readonly timeseries?: { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' };
    readonly collation?: Record<string, unknown>;
    readonly changeStreamPreAndPostImages?: { enabled: boolean };
    readonly clusteredIndex?: { name?: string };
  }
  ```
- Update `MongoStorageCollection` to include `validator?` and `options?` fields
- Add Arktype schemas: `MongoStorageValidatorSchema`, `MongoCollectionOptionsSchema`
- Update `StorageCollectionSchema` to accept `validator?` and `options?`

**Tests:**
- Arktype validation: valid/invalid validator shapes, valid/invalid option shapes
- Backward compat: collection with no validator/options still passes validation

**Package:** `packages/2-mongo-family/1-foundation/mongo-contract/`

---

#### 2.3 Extend schema IR with new index options

**Goal:** Add the new index options to `MongoSchemaIndex` and update `indexesEquivalent`.

**What to do:**
- Add to `MongoSchemaIndex` and `MongoSchemaIndexOptions`:
  - `wildcardProjection?: Record<string, 0 | 1>`
  - `collation?: Record<string, unknown>`
  - `weights?: Record<string, number>`
  - `default_language?: string`
  - `language_override?: string`
- Update `indexesEquivalent` to compare new options (using `deepEqual` for object-valued ones)
- Export updated types

**Tests:**
- `indexesEquivalent`: same keys + different `wildcardProjection` → not equivalent
- `indexesEquivalent`: same keys + same `collation` → equivalent
- `indexesEquivalent`: same keys + different `weights` → not equivalent
- Construction and freeze behavior for indexes with new options

**Package:** `packages/2-mongo-family/3-tooling/mongo-schema-ir/`

---

#### 2.4 Add MongoSchemaValidator and MongoSchemaCollectionOptions to schema IR

**Goal:** Implement the validator and collection options node classes, update the visitor interface.

**What to do:**
- Create `MongoSchemaValidator` class:
  ```typescript
  class MongoSchemaValidator extends MongoSchemaNode {
    readonly kind = 'validator' as const;
    readonly jsonSchema: Record<string, unknown>;
    readonly validationLevel: 'strict' | 'moderate';
    readonly validationAction: 'error' | 'warn';
  }
  ```
- Create `MongoSchemaCollectionOptions` class:
  ```typescript
  class MongoSchemaCollectionOptions extends MongoSchemaNode {
    readonly kind = 'collectionOptions' as const;
    readonly capped?: { size: number; max?: number };
    readonly timeseries?: { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' };
    readonly collation?: Record<string, unknown>;
    readonly changeStreamPreAndPostImages?: { enabled: boolean };
    readonly clusteredIndex?: { name?: string };
  }
  ```
- Update `MongoSchemaCollection` to accept `validator?` and `options?`
- Update `MongoSchemaVisitor<R>`: change `validator(node: unknown)` → `validator(node: MongoSchemaValidator)` and `collectionOptions(node: unknown)` → `collectionOptions(node: MongoSchemaCollectionOptions)`
- Update `AnyMongoSchemaNode` union type
- Export new classes from `exports/index.ts`

**Tests:**
- Validator: construction, freeze, visitor dispatch
- CollectionOptions: construction with each option, freeze, visitor dispatch
- Collection with validator and options: construction, nested freeze

**Package:** `packages/2-mongo-family/3-tooling/mongo-schema-ir/`

---

#### 2.5 Add new DDL command classes

**Goal:** Add `CreateCollectionCommand`, `DropCollectionCommand`, and `CollModCommand` to the DDL command AST.

**What to do:**
- Create `CreateCollectionCommand extends MongoAstNode`:
  - Fields: `collection`, `validator?`, `validationLevel?`, `validationAction?`, `capped?`, `size?`, `max?`, `timeseries?`, `collation?`, `changeStreamPreAndPostImages?`, `clusteredIndex?`
  - `accept<R>(visitor: MongoDdlCommandVisitor<R>): R`
- Create `DropCollectionCommand extends MongoAstNode`:
  - Fields: `collection`
  - `accept(visitor)`
- Create `CollModCommand extends MongoAstNode`:
  - Fields: `collection`, `validator?`, `validationLevel?`, `validationAction?`, `changeStreamPreAndPostImages?`
  - `accept(visitor)`
- Update `AnyMongoDdlCommand` union type
- Update `MongoDdlCommandVisitor<R>` with new methods: `createCollection`, `dropCollection`, `collMod`
- Add new index options to `CreateIndexCommand`: `wildcardProjection?`, `collation?`, `weights?`, `default_language?`, `language_override?`

**Tests:**
- Each new command: construction, freeze, kind discriminant, visitor dispatch
- Updated `CreateIndexCommand` with new options: construction, freeze

**Package:** `packages/2-mongo-family/4-query/query-ast/`

---

#### 2.6 Implement canonical serialization utility

**Goal:** Replace `JSON.stringify` with a key-order-independent canonical serialization for index lookup keys.

**What to do:**
- Implement `canonicalize(obj: unknown): string` — recursively sorts object keys, handles arrays, primitives, null/undefined
- Can live in `@prisma-next/mongo-schema-ir` alongside `indexesEquivalent`, or as a shared utility

**Tests:**
- `canonicalize({ b: 1, a: 2 })` === `canonicalize({ a: 2, b: 1 })`
- Nested objects: key order independent at all levels
- Arrays: order preserved (not sorted)
- Primitives, null, undefined handled correctly

**Package:** `packages/2-mongo-family/3-tooling/mongo-schema-ir/` (or utility package)

---

### Phase 2: Composition (depends on Phase 1 types)

#### 2.7 Update `contractToSchema` for validators, options, and new index options

**Goal:** Extend `contractToMongoSchemaIR` to convert validators, collection options, and new index options from contract to IR.

**What to do:**
- Update `convertIndex` to pass through new options (`wildcardProjection`, `collation`, `weights`, `default_language`, `language_override`)
- Add `convertValidator(v: MongoStorageValidator): MongoSchemaValidator`
- Add `convertOptions(o: MongoStorageCollectionOptions): MongoSchemaCollectionOptions`
- Update `convertCollection` to include validator and options

**Tests:**
- Index with each new option → correct IR
- Collection with validator → IR has `MongoSchemaValidator`
- Collection with options (capped, timeseries, collation, changeStreamPreAndPostImages, clusteredIndex) → IR has `MongoSchemaCollectionOptions`
- Null contract → empty IR (still works)
- Collection with no validator/options → IR without them (backward compat)

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.1, 2.2, 2.3, 2.4

---

#### 2.8 Update serializer/deserializer for new DDL commands and index options

**Goal:** Extend `mongo-ops-serializer` to handle the new command kinds and index options.

**What to do:**
- Add Arktype validation schemas for `CreateCollectionCommand`, `DropCollectionCommand`, `CollModCommand` JSON shapes
- Add deserializer cases in `deserializeDdlCommand` for new `kind` values
- Update `CreateIndexJson` schema and `deserializeDdlCommand` case to handle new index options
- Verify serialization: new commands serialize correctly via `JSON.stringify` (frozen AST nodes)

**Tests:**
- Round-trip: construct each new command → serialize → deserialize → structurally equal
- Round-trip: `CreateIndexCommand` with new options → serialize → deserialize → equal
- Invalid JSON shapes for new commands → validation error

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.5

---

#### 2.9 Update DDL formatter for new commands and index options

**Goal:** Extend `MongoDdlCommandFormatter` to render new commands and index options as display strings.

**What to do:**
- Add `createCollection` method: `db.createCollection("name", { ...options })`
- Add `dropCollection` method: `db.name.drop()`
- Add `collMod` method: `db.runCommand({ collMod: "name", validator: ..., ... })`
- Update `createIndex` formatter to include new options (`collation`, `weights`, `default_language`, `language_override`, `wildcardProjection`)

**Tests:**
- `CreateCollectionCommand` with options → correct display string
- `DropCollectionCommand` → correct display string
- `CollModCommand` with validator → correct display string
- `CreateIndexCommand` with text index options → correct display string
- `CreateIndexCommand` with wildcard projection → correct display string

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.5

---

### Phase 3: Planner extensions (depends on Phase 2)

#### 2.10 Extend planner for full index vocabulary

**Goal:** Update the planner's index diffing to include new options in the lookup key, using canonical serialization.

**What to do:**
- Update `buildIndexLookupKey` to include `wildcardProjection`, `collation`, `weights`, `default_language`, `language_override` using `canonicalize()`
- Replace existing `JSON.stringify(index.partialFilterExpression)` with `canonicalize(index.partialFilterExpression)`
- Update `planCreateIndex` to pass new options to `CreateIndexCommand`
- Update precheck/postcheck filter expressions for indexes with new options

**Tests:**
- Same keys + different `wildcardProjection` → detected as different indexes
- Same keys + different `collation` → detected as different indexes
- Same keys + different `weights` → detected as different indexes
- `partialFilterExpression` with different key order → treated as same (canonical serialization)
- Text index: add → `createIndex`, remove → `dropIndex`
- Wildcard index: add → `createIndex`, remove → `dropIndex`
- Compound wildcard: add → `createIndex`, correct key spec

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.6, 2.7

---

#### 2.11 Extend planner for validators

**Goal:** Add validator diffing to the planner.

**What to do:**
- Compare origin and destination collection validators
- No validator → validator added: emit `collMod` (or include in `createCollection` if collection is also new)
- Validator → no validator: emit `collMod` to remove validator
- Validator changed: emit `collMod` with new validator
- Classify validator changes per the spec (widening vs destructive)
- Implement `planUpdateValidator(collection, oldValidator, newValidator): MongoMigrationPlanOperation`
- Postchecks use `ListCollectionsCommand` + filter on `options.validationLevel`

**Tests:**
- No validator → add validator: `collMod` operation, classified as `destructive`
- Remove validator: `collMod` operation, classified as `widening`
- Change `validationAction` error → warn: classified as `widening`
- Change `validationLevel` moderate → strict: classified as `destructive`
- Change `$jsonSchema` body: classified as `destructive` (conservative default)
- New collection with validator: validator included in `createCollection` (not a separate `collMod`)
- Policy gate: destructive validator change blocked when policy disallows destructive

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.7

---

#### 2.12 Extend planner for collection options

**Goal:** Add collection lifecycle and option diffing to the planner.

**What to do:**
- New collection in destination but not in origin:
  - If collection has options or validator → emit `createCollection` with all options (additive)
  - Indexes on new collections are emitted as `createIndex` operations (after collection creation)
- Collection in origin but not in destination → emit `dropCollection` (destructive)
- Option changes on existing collections:
  - `changeStreamPreAndPostImages` changed → emit `collMod` (widening if enabling, destructive if disabling)
  - Immutable option changed (capped, timeseries, collation, clusteredIndex) → emit `MigrationPlannerConflict` with guidance
- Implement `planCreateCollection`, `planDropCollection`
- Operation ordering: collection creates first, collection drops last

**Tests:**
- New collection with no options → no `createCollection` (MongoDB auto-creates on first write; indexes are sufficient)
- New collection with capped option → `createCollection` with capped
- New collection with clusteredIndex → `createCollection` with clusteredIndex
- New collection with timeseries → `createCollection` with timeseries
- New collection with validator + options → single `createCollection` with both
- Collection removed → `dropCollection` (destructive)
- Capped → non-capped on existing collection → conflict
- Collation change on existing collection → conflict
- `changeStreamPreAndPostImages` toggle → `collMod`
- Policy gate: `dropCollection` blocked when destructive disallowed

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.7

---

### Phase 4: Runner + command executor (depends on Phase 3)

#### 2.13 Extend command executor for new DDL commands

**Goal:** Add handler methods to `MongoCommandExecutor` for the new DDL command kinds.

**What to do:**
- Add `createCollection(cmd)` → `db.createCollection(cmd.collection, { ...options })`
- Add `dropCollection(cmd)` → `db.collection(cmd.collection).drop()`
- Add `collMod(cmd)` → `db.command({ collMod: cmd.collection, validator: ..., validationLevel: ..., validationAction: ..., ... })`
- Update `createIndex(cmd)` to pass new options (wildcardProjection, collation, weights, default_language, language_override) to the MongoDB driver

**Tests (integration, using `mongodb-memory-server`):**
- `createCollection` with capped options → collection exists with correct options
- `createCollection` with clusteredIndex → collection exists as clustered
- `createCollection` with validator → collection has validator
- `createCollection` with timeseries → time series collection exists
- `createCollection` with collation → collection has collation
- `dropCollection` → collection no longer exists
- `collMod` with validator → validator updated on collection
- `collMod` with changeStreamPreAndPostImages → option updated
- `createIndex` with text options (weights, default_language) → text index created correctly
- `createIndex` with wildcardProjection → wildcard index with projection
- `createIndex` with collation → index has collation

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.5

---

#### 2.14 Extend inspection executor for collection option/validator checks

**Goal:** Ensure the inspection executor and filter evaluator handle `listCollections` results with nested option fields.

**What to do:**
- Verify `ListCollectionsCommand` returns collection info including `options.validator`, `options.validationLevel`, `options.validationAction`, `options.capped`, etc.
- Verify `FilterEvaluator` handles dotted paths like `options.validator.$jsonSchema` and `options.validationLevel` correctly (already supported — verify with tests)

**Tests (integration):**
- Create collection with validator → `listCollections` → filter on `options.validationLevel` matches
- Create capped collection → `listCollections` → filter on `options.capped` matches

**Package:** `packages/3-mongo-target/2-mongo-adapter/`

**Depends on:** 2.13

---

### Phase 5: PSL authoring + emitter (can start after Phase 1; full integration after Phase 3)

#### 2.15 Add `@@index` and `@@unique` to Mongo PSL interpreter

**Goal:** Handle index-related model attributes in the Mongo PSL interpreter, populating `storage.collections[].indexes`.

**What to do:**
- In `interpretPslDocumentToMongoContract()`, handle `modelAttribute.name === 'index'` and `modelAttribute.name === 'unique'`:
  - Parse field list using `parseAttributeFieldList` (shared with SQL PSL)
  - Parse Mongo-specific named arguments: `sparse`, `expireAfterSeconds`, `type` (for text direction), `weights`, `defaultLanguage`, `languageOverride`, `collation`
  - Map field names to storage field names (respecting `@map`)
  - Construct `MongoStorageIndex` entries
- Handle field-level `@unique` attribute → single-field unique index
- Populate `storage.collections[collectionName].indexes` instead of `{}`

**Tests:**
- `@@index([field1, field2])` → compound ascending index
- `@@unique([field])` → unique index
- `@unique` on field → single-field unique index
- `@@index([field], expireAfterSeconds: 3600)` → TTL index
- `@@index([field], sparse: true)` → sparse index
- `@@index([field], type: "text", weights: { field: 10 })` → text index with weights
- `@@index([field1, field2], map: "custom_name")` → index (name is metadata, not identity)
- Fields with `@map` → index uses mapped field names
- Invalid: `@@index` with no fields → diagnostic
- Multiple `@@index` on same model → multiple indexes on same collection

**Package:** `packages/2-mongo-family/2-authoring/contract-psl/`

**Depends on:** 2.1

---

#### 2.16 Auto-derive `$jsonSchema` validator from model fields

**Goal:** Implement a utility that produces a `$jsonSchema` document from a contract's model field definitions.

**What to do:**
- Implement `deriveJsonSchema(model: MongoModelDefinition): Record<string, unknown>`
- Map contract field types to BSON types:
  - Scalar types via codec ID → BSON type mapping
  - Value objects → `"object"` with nested `properties` (recursive)
  - Nullable fields → `bsonType: ["<type>", "null"]`
  - Array fields (`many: true`) → `bsonType: "array"` with `items`
- Non-nullable fields added to `required` array
- Return a complete `$jsonSchema` object with `bsonType: "object"`, `required`, `properties`
- This is a standalone utility function, testable independently

**Tests:**
- Model with String, Int, Float, Boolean, DateTime fields → correct BSON types
- Nullable field → `["string", "null"]`
- Array field → `"array"` with items
- Value object field → nested `"object"` with properties
- Mixed nullable + array combinations
- Empty model → minimal schema

**Package:** `packages/2-mongo-family/2-authoring/contract-psl/` or `packages/2-mongo-family/3-tooling/emitter/`

**Depends on:** 2.2

---

#### 2.17 Update Mongo emitter to populate enriched `storage.collections`

**Goal:** Wire the PSL interpreter output and `$jsonSchema` derivation into the emitter pipeline so emitted contracts carry indexes and validators.

**What to do:**
- After PSL interpretation produces the contract, run `deriveJsonSchema` on each model
- Populate `storage.collections[collectionName].validator` with the derived schema + default validation policy (`validationLevel: 'strict'`, `validationAction: 'error'`)
- Merge PSL-derived indexes (from 2.15) into `storage.collections[collectionName].indexes`
- Update the emitter's validation to accept the enriched collection shape

**Tests:**
- PSL with `@@index` + model fields → emitted contract has both indexes and validator
- Emitted `$jsonSchema` matches expected derivation from model fields
- No `@@index` attributes → emitted contract has validator but no indexes
- Emitted contract passes Arktype validation

**Package:** `packages/2-mongo-family/3-tooling/emitter/` and/or `packages/2-mongo-family/2-authoring/contract-psl/`

**Depends on:** 2.15, 2.16

---

### Phase 6: End-to-end proof (depends on all previous phases)

#### 2.18 End-to-end integration tests: full vocabulary

**Goal:** Prove the full pipeline works against a real MongoDB instance for all M2 features.

**What to do:**
- Hand-craft contracts exercising:
  - Compound indexes (multi-field, ascending + descending)
  - Text indexes with weights, default_language
  - Wildcard indexes with wildcardProjection
  - TTL indexes
  - Partial indexes
  - Geospatial indexes (2dsphere)
  - Hashed indexes
  - Indexes with collation (case-insensitive)
- Test sequence:
  1. Contract v1 (empty) → plan → apply → verify indexes exist
  2. Contract v2 (modify: change some indexes, add validator, add collection options) → plan → apply → verify changes
  3. Contract v3 (remove indexes, relax validator) → plan → apply → verify removals

**Tests (integration, using `mongodb-memory-server`):**
- Create cycle: plan → apply → listIndexes confirms each index type
- Modify cycle: plan → apply → validator changed, indexes changed
- Remove cycle: plan → apply → dropIndex, validator relaxed
- Collection with options: createCollection with capped → verify
- Collection with clusteredIndex: createCollection → verify
- Idempotent re-apply: already-applied plan → no-op
- Validator: collMod → listCollections confirms validationLevel/validationAction

**Package:** `test/integration/test/mongo/` and/or `packages/3-mongo-target/2-mongo-adapter/test/`

**Depends on:** all previous tasks

---

#### 2.19 End-to-end PSL authoring test

**Goal:** Prove the full PSL → contract → plan → apply flow.

**What to do:**
- Write a PSL schema with `@@index`, `@@unique`, `@unique`, and model fields
- Run through the emitter to produce a contract with indexes and validator
- Feed the contract through `migration plan` → `migration apply`
- Verify indexes and validator exist on `mongodb-memory-server`

**Tests (integration):**
- PSL → emitter → contract → plan → apply → verify indexes
- PSL → emitter → contract with derived validator → plan → apply → verify validator

**Package:** `test/integration/test/mongo/`

**Depends on:** 2.17, 2.18

---

## Package summary

| Modified package | Changes |
|---|---|
| `@prisma-next/mongo-contract` | New index options, `MongoStorageValidator`, `MongoStorageCollectionOptions`, Arktype schemas |
| `@prisma-next/mongo-schema-ir` | New index options on `MongoSchemaIndex`, `MongoSchemaValidator` class, `MongoSchemaCollectionOptions` class, canonical serialization, updated visitor |
| `@prisma-next/mongo-query-ast` | `CreateCollectionCommand`, `DropCollectionCommand`, `CollModCommand`, updated `CreateIndexCommand`, updated visitor |
| `@prisma-next/adapter-mongo` | Extended planner (index, validator, collection diffs), extended command executor, extended formatter, updated serializer |
| `@prisma-next/mongo-contract-psl` | `@@index`, `@@unique`, `@unique` handling, `$jsonSchema` derivation |
| `@prisma-next/mongo-emitter` | Enriched `storage.collections` with indexes + validator |

## Dependency graph

```
Phase 1 (parallel — foundation types):
  2.1  Index options in contract ──────────────────────┐
  2.2  Validator + options in contract ─────────────────┤
  2.3  Index options in schema IR ──────────────────────┤
  2.4  Validator + options nodes in schema IR ───────────┤
  2.5  New DDL command classes ─────────────────────────┤
  2.6  Canonical serialization utility ─────────────────┤
                                                        │
Phase 2 (depends on Phase 1):                           │
  2.7  contractToSchema extensions ─────────────────────┤  (needs 2.1–2.4)
  2.8  Serializer/deserializer extensions ──────────────┤  (needs 2.5)
  2.9  DDL formatter extensions ────────────────────────┤  (needs 2.5)
                                                        │
Phase 3 (depends on Phase 2):                           │
  2.10 Planner: full index vocabulary ──────────────────┤  (needs 2.6, 2.7)
  2.11 Planner: validators ─────────────────────────────┤  (needs 2.7)
  2.12 Planner: collection options ─────────────────────┤  (needs 2.7)
                                                        │
Phase 4 (depends on Phase 1 DDL types):                 │
  2.13 Command executor: new commands ──────────────────┤  (needs 2.5)
  2.14 Inspection executor: option checks ──────────────┤  (needs 2.13)
                                                        │
Phase 5 (PSL — can start after Phase 1):                │
  2.15 PSL interpreter: @@index/@@unique ───────────────┤  (needs 2.1)
  2.16 $jsonSchema derivation ──────────────────────────┤  (needs 2.2)
  2.17 Emitter: enriched storage.collections ───────────┤  (needs 2.15, 2.16)
                                                        │
Phase 6 (E2E — depends on all):                         │
  2.18 E2E integration tests ───────────────────────────┤  (needs Phases 1–4)
  2.19 E2E PSL authoring test ──────────────────────────┘  (needs 2.17, 2.18)
```

Note: Phase 4 (command executor) and Phase 5 (PSL authoring) can proceed in parallel with Phase 3 (planner). The command executor needs only DDL command types (Phase 1), not planner output. PSL authoring needs only contract types (Phase 1).

## Testing strategy

| Test type | Location | Framework | Infrastructure |
|---|---|---|---|
| Unit (types, AST, Arktype, canonical serialization) | Colocated `test/` in each package | Vitest | None |
| Unit (planner diffs, formatter, serialization) | Colocated `test/` in each package | Vitest | None |
| Integration (command executor, runner, E2E) | Package `test/` or `test/integration/test/mongo/` | Vitest | `mongodb-memory-server` via `MongoMemoryReplSet` |
| Unit (PSL interpreter) | `packages/2-mongo-family/2-authoring/contract-psl/test/` | Vitest | None |

**Mongo test setup patterns:**
- Use `MongoMemoryReplSet` for integration tests
- Use `describeWithMongoDB` or `withMongod` helpers
- Set `timeout` and `hookTimeout` to `timeouts.spinUpDbServer`
- `beforeEach`: drop test database for isolation
- `fileParallelism: false` in vitest config for DB tests

## Risk and open items

- **`$jsonSchema` derivation depth:** The derivation maps contract field types to BSON types. Edge cases with deeply nested value objects, union types, or dict fields may require iteration. Start with basic types and build up.
- **Text index restrictions:** Text indexes have unique constraints (only one per collection, special compound rules). The planner should detect and report conflicts if a user defines multiple text indexes on the same collection.
- **Time series collections:** `mongodb-memory-server` support for time series collections should be verified early. If not supported, those tests may need to be deferred or use a different test infrastructure.
- **PSL grammar expressibility:** Some Mongo-specific index options (e.g., `weights: { bio: 10 }`) require object-valued named arguments in PSL attributes. Verify the PSL parser can handle this; if not, consider alternative syntax.
- **Emitter integration:** The relationship between the PSL interpreter and the emitter needs clarification — does the interpreter produce the enriched contract directly, or does the emitter post-process? The SQL pattern should guide this.
