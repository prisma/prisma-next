# Phase 1.75b: Polymorphism (Both Families) — Execution Plan

## Summary

End-to-end polymorphism in both SQL and Mongo ORM clients: authoring support for `@@discriminator` and `@@base` in both PSL interpreters and the SQL TS authoring DSL, discriminated union return types in both ORMs, `.variant()` API for narrowed variant queries, and SQL query compilation for both STI and MTI. Uses emitter-produced contracts (not hand-crafted fixtures) to prove the full authoring → emit → query path.

**Spec:** [polymorphism.spec.md](../specs/polymorphism.spec.md)
**Design:** [ADR 173 — Polymorphism via discriminator and variants](../../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
**Linear:** [TML-2205](https://linear.app/prisma-company/issue/TML-2205)

## Collaborators

| Role         | Person | Context                                                    |
| ------------ | ------ | ---------------------------------------------------------- |
| Maker        | Will   | Drives execution                                           |
| Collaborator | Alexey | SQL ORM owner — STI/MTI query compilation, `.variant()` on SQL Collection |

## Dependencies

- **TML-2202** (Phase 1.6 codec-owned value serialization) — Framework `Codec` base with `encodeJson`/`decodeJson` has landed. Discriminator values are encoded via the discriminator field's codec. Full Phase 1.6 cleanup (tagged bigint removal, etc.) is not a hard blocker — identity codecs (string, int) work for typical discriminator types.
- **TML-2194** (Phase 1.5 write operations) — **Done.** Mongo write operations are in place.

## Key references (implementation)

### Contract types and validation

- `ContractDiscriminator`, `ContractVariantEntry`, `ContractModelBase`: [`contract/src/domain-types.ts`](../../../packages/1-framework/0-foundation/contract/src/domain-types.ts) (L44–74)
- `Contract` type: [`contract/src/contract-types.ts`](../../../packages/1-framework/0-foundation/contract/src/contract-types.ts) (L40–55)
- Domain validation (`validateDiscriminators`, `validateVariantsAndBases`): [`contract/src/validate-domain.ts`](../../../packages/1-framework/0-foundation/contract/src/validate-domain.ts) (L58–142)
- Framework `Codec` base: [`framework-components/src/codec-types.ts`](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts) (L16–36)

### PSL authoring

- PSL parser (generic attributes): [`psl-parser/src/parser.ts`](../../../packages/1-framework/2-authoring/psl-parser/src/parser.ts) (L223–255)
- SQL PSL interpreter: [`sql-contract-psl/src/interpreter.ts`](../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) (L776–945)
- Mongo PSL interpreter: [`mongo-contract-psl/src/interpreter.ts`](../../../packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts) (L96–303)

### TS authoring DSL

- `SqlSemanticModelNode`: [`sql-contract-ts/src/semantic-contract.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/semantic-contract.ts) (L83–92)
- `StagedModelBuilder`: [`sql-contract-ts/src/staged-contract-dsl.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) (L955–1065)
- `model()` factory: [`sql-contract-ts/src/staged-contract-dsl.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) (L1188–1235)
- Semantic contract lowering: [`sql-contract-ts/src/staged-contract-lowering.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/staged-contract-lowering.ts)
- `buildSqlContractFromSemanticDefinition`: [`sql-contract-ts/src/build-contract.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/build-contract.ts)

### Emission

- Domain type generation (`discriminator`/`variants`/`base` in contract.d.ts): [`emitter/src/domain-type-generation.ts`](../../../packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts) (L124–160)
- Canonicalization (passthrough of models): [`contract/src/canonicalization.ts`](../../../packages/1-framework/0-foundation/contract/src/canonicalization.ts) (L233–243)

### SQL ORM

- Collection class: [`sql-orm-client/src/collection.ts`](../../../packages/3-extensions/sql-orm-client/src/collection.ts)
- `DefaultModelRow` (flat, no variant unions): [`sql-orm-client/src/types.ts`](../../../packages/3-extensions/sql-orm-client/src/types.ts) (L314–316)
- `compileSelect` / `buildStateWhere`: [`sql-orm-client/src/query-plan-select.ts`](../../../packages/3-extensions/sql-orm-client/src/query-plan-select.ts) (L147–398)
- `findModelNameForTable` (1:1 assumption): [`sql-orm-client/src/collection-contract.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-contract.ts) (L75–91)
- `mapStorageRowToModelFields`: [`sql-orm-client/src/collection-runtime.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-runtime.ts) (L73–93)
- `dispatchCollectionRows`: [`sql-orm-client/src/collection-dispatch.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts) (L30–47)
- `ModelAccessor` / `createModelAccessor`: [`sql-orm-client/src/model-accessor.ts`](../../../packages/3-extensions/sql-orm-client/src/model-accessor.ts) (L41–68)

### Mongo ORM

- `InferRootRow` / `VariantRow` (existing type-level polymorphism): [`mongo-orm/src/types.ts`](../../../packages/2-mongo-family/5-query-builders/orm/src/types.ts) (L76–99)
- `MongoCollection` / `MongoCollectionImpl`: [`mongo-orm/src/collection.ts`](../../../packages/2-mongo-family/5-query-builders/orm/src/collection.ts) (L44–525)
- `compileMongoQuery`: [`mongo-orm/src/compile.ts`](../../../packages/2-mongo-family/5-query-builders/orm/src/compile.ts) (L37–85)
- Type tests for polymorphic narrowing: [`mongo-orm/test/orm-types.test-d.ts`](../../../packages/2-mongo-family/5-query-builders/orm/test/orm-types.test-d.ts) (L90–138)

### Test fixtures

- Hand-crafted polymorphic contract: [`mongo-contract/test/fixtures/orm-contract.json`](../../../packages/2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract.json) (L14–71)
- Matching .d.ts stub: [`mongo-contract/test/fixtures/orm-contract.d.ts`](../../../packages/2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract.d.ts)

## Packages touched

| Package | Layer | What changes |
|---------|-------|-------------|
| `@prisma-next/sql-contract-psl` | sql/authoring | Interpret `@@discriminator` and `@@base` attributes; emit `discriminator`, `variants`, `base` on models; derive variant storage (STI vs MTI from `@@map`) |
| `@prisma-next/mongo-contract-psl` | mongo/authoring | Interpret `@@discriminator` and `@@base` attributes; emit `discriminator`, `variants`, `base` on models; enforce single-collection (variant inherits base collection) |
| `@prisma-next/sql-orm-client` | sql/extensions | `InferRootRow`/`VariantRow` equivalent types; `.variant()` method; STI query compilation (discriminator filter, variant columns); MTI query compilation (LEFT JOIN / INNER JOIN); polymorphism-aware result mapper; `findModelNameForTable` fix |
| `@prisma-next/sql-contract-ts` | sql/authoring | `StagedModelBuilder.discriminator()` and `.base()` methods; `SqlSemanticModelNode` polymorphism properties; semantic contract lowering for `discriminator`/`variants`/`base` |
| `@prisma-next/mongo-orm` | mongo/query-builders | `.variant()` method on `MongoCollection`; discriminator filter injection; variant-aware `CreateInput` |

Packages **not touched** (already working):

| Package | Why |
|---------|-----|
| `@prisma-next/contract` | `ContractDiscriminator`, `ContractVariantEntry`, `ContractModelBase` already exist. `validateDiscriminators`/`validateVariantsAndBases` already work. |
| `@prisma-next/emitter` | `contract.json` canonicalization and `contract.d.ts` generation already pass through `discriminator`/`variants`/`base`. |
| `@prisma-next/psl-parser` | Attributes are parsed generically — `@@discriminator(type)` and `@@base(Task, "bug")` work without parser changes. |

## Milestones

### Milestone 1: PSL authoring (both families)

Add `@@discriminator` and `@@base` support to both PSL interpreters. After this milestone, users can author polymorphic schemas in PSL and the emitter produces valid polymorphic contracts.

**Validation:** A PSL schema with `@@discriminator` and `@@base` emits a contract with correct `discriminator`, `variants`, and `base` on the models. The contract passes existing domain validation.

**Tasks:**

- [ ] **1.1 Tests: SQL PSL polymorphism interpretation** — Write tests for the SQL PSL interpreter: `@@discriminator(fieldName)` produces `discriminator: { field }` on the model; `@@base(BaseModel, "value")` produces `base` on variant and `variants` on base; variant without `@@map` inherits base's table (STI); variant with `@@map` gets own table (MTI); thin variant fields (only additional fields); diagnostic tests for orphaned `@@discriminator`, orphaned `@@base`, missing discriminator field, `@@discriminator` + `@@base` on same model, `@@base` targeting non-existent model.
- [ ] **1.2 Implement: SQL PSL `@@discriminator` and `@@base`** — In `sql-contract-psl/src/interpreter.ts`: after processing all models, scan for `@@discriminator` and `@@base` model attributes. Collect variant→base mappings. For each base with `@@discriminator`, resolve the variants map from all `@@base` declarations. Emit `discriminator`, `variants`, `base` on the appropriate model entries. Validate: discriminator field exists on base model, no model has both `@@discriminator` and `@@base`, every `@@base` target has `@@discriminator`. For storage: variant without `@@map` uses base's table name; variant with `@@map` gets its own table. Only variant-specific fields go in the variant's `fields`; base fields are not duplicated.
- [ ] **1.3 Tests: Mongo PSL polymorphism interpretation** — Write tests for the Mongo PSL interpreter: same attribute semantics as SQL. Key difference: variants always inherit the base's collection (no MTI). Diagnostic if a variant uses `@@map` to a different collection (Mongo doesn't support MTI).
- [ ] **1.4 Implement: Mongo PSL `@@discriminator` and `@@base`** — In `mongo-contract-psl/src/interpreter.ts`: same attribute processing as SQL. Variant inherits the base model's collection name. Emit diagnostic if a variant specifies `@@map` that differs from the base's collection.
- [ ] **1.5 End-to-end emit test** — Write a test that parses a polymorphic PSL schema through the full emit pipeline (parse → interpret → emit → validate → load). Verify the emitted `contract.json` has the expected `discriminator`/`variants`/`base` structure and passes `validateContractDomain`. Verify `contract.d.ts` includes literal types for `discriminator`, `variants`, and `base`.

### Milestone 2: SQL ORM polymorphic types and `.variant()`

Add discriminated union return types to the SQL ORM and the `.variant()` narrowing API. After this milestone, querying a polymorphic SQL root returns a discriminated union, and `.variant('Bug')` narrows the type and injects the discriminator filter.

**Validation:** Type tests verify discriminated union return types and variant narrowing. Unit tests verify discriminator filter injection.

**Tasks:**

- [ ] **2.1 Tests: SQL `InferRootRow` / `VariantRow` types** — Write type-level tests (`.test-d.ts`) that mirror the Mongo ORM's existing polymorphism type tests: `InferRootRow<Contract, 'Task'>` produces a discriminated union; narrowing on `type === 'bug'` gives access to `severity` and excludes `priority`; narrowing on `type === 'feature'` gives access to `priority` and excludes `severity`; non-polymorphic models produce a plain row type.
- [ ] **2.2 Implement: SQL `InferRootRow` / `VariantRow`** — Add type utilities to `sql-orm-client/src/types.ts` that produce a discriminated union for polymorphic models. The logic mirrors Mongo's `VariantRow`: if the model has `discriminator` and `variants`, produce a union of `(base fields - discriminator) & variant fields & Record<discriminator, literal value>` for each variant. Use the existing `FieldJsType` / `DefaultModelRow` infrastructure for field type resolution.
- [ ] **2.3 Tests: `.variant()` method on SQL Collection** — Write tests: `.variant('Bug')` returns a collection whose return type is the variant's row (not the union); `.variant('Bug').all()` compiles a SELECT with `WHERE type = 'bug'`; `.variant('Bug').where(...)` chains correctly; `.variant('Bug').create(...)` produces an INSERT with the discriminator value; `.variant('NonExistent')` is a type error.
- [ ] **2.4 Implement: `.variant()` on SQL Collection** — Add a `variant<V>(variantName: V)` method on the SQL `Collection` class. Internally: store the variant name on `CollectionState`; in `buildStateWhere`, if a variant is set, add an `EqExpr` on the discriminator column; in `compileInsertReturning`, if a variant is set, inject the discriminator value into the row data. The return type uses `InferRootRow` with the variant model name instead of the base.
- [ ] **2.5 Wire `Collection.all()` / `first()` to use `InferRootRow`** — Change the `Row` type parameter default on Collection from `DefaultModelRow` to `InferRootRow`. This makes polymorphic roots return the discriminated union by default. Verify all existing non-polymorphic tests still pass (for non-polymorphic models, `InferRootRow` falls through to `DefaultModelRow`).

### Milestone 3: SQL STI query compilation

Implement the SQL runtime support for single-table inheritance: variant-specific columns in SELECT, discriminator-aware result mapping, and STI write compilation.

**Validation:** Integration tests against a real Postgres database with a polymorphic STI schema verify reads and writes.

**Tasks:**

- [ ] **3.1 Tests: STI SELECT compilation** — Write tests: querying the base includes variant-specific columns from the shared table in the projection; querying via `.variant('Bug')` adds a WHERE filter on the discriminator column; the projected columns include base fields + all STI variant fields when querying the base.
- [ ] **3.2 Implement: STI projection and filtering** — In `query-plan-select.ts`: when building the projection for a polymorphic base, iterate `model.variants` to find all STI variants (variants whose `storage.table` matches the base's table). Include their fields in the projection, resolved through their `storage.fields` column mappings. When a variant is selected (via `.variant()`), restrict projection to base + that variant's columns only.
- [ ] **3.3 Implement: STI result mapping** — In `collection-runtime.ts` / `collection-dispatch.ts`: after reading a row from a polymorphic base query, inspect the discriminator column to determine the variant. Map base columns to base field names, variant columns to variant field names. Exclude columns that belong to other variants (they'll be NULL). The result is a JavaScript object matching the variant's row shape.
- [ ] **3.4 Fix `findModelNameForTable` for shared tables** — `findModelNameForTable` currently builds a 1:1 table→model reverse map, which breaks when multiple models share a table (STI). For polymorphism, callers that need a model name should thread `modelName` directly (already flagged in the code). Audit callers and fix those that rely on the reverse lookup for tables shared by variants. Add the variant→base index for resolving which models share a table.
- [ ] **3.5 Tests: STI write compilation** — Write tests: `create()` through a variant produces an INSERT with the discriminator value and variant-specific columns in the shared table; `create()` through the base with an explicit discriminator value works correctly.
- [ ] **3.6 Implement: STI write compilation** — In `compileInsertReturning`: when inserting through a variant, merge base fields + variant fields + discriminator value into a single INSERT. The discriminator value comes from `model.variants[variantName].value`.
- [ ] **3.7 STI integration tests** — Write integration tests against Postgres: create a polymorphic schema (Task/Bug/Feature sharing `tasks` table); seed via ORM; query base → discriminated union; query via `.variant('Bug')` → narrowed type; verify TypeScript narrowing on discriminator; insert through variant; verify discriminator value persistence.

### Milestone 4: SQL MTI query compilation

Implement multi-table inheritance: LEFT JOIN / INNER JOIN for variant tables, cross-table projection, and transactional MTI writes.

**Validation:** Integration tests against Postgres with a mixed STI/MTI schema verify JOINed reads and multi-table writes.

**Tasks:**

- [ ] **4.1 Tests: MTI SELECT compilation** — Write tests: querying the base LEFT JOINs MTI variant tables on the shared PK; querying via `.variant('Feature')` INNER JOINs the variant table; the projected columns include base table columns + variant table columns.
- [ ] **4.2 Implement: MTI JOIN compilation** — In `query-plan-select.ts` / `buildSelectAst`: when building a query for a polymorphic base, identify MTI variants (variants whose `storage.table` differs from the base's). For each MTI variant, add a LEFT JOIN on the variant's table using the shared primary key. When querying a specific MTI variant (via `.variant()`), use INNER JOIN instead. Add the variant table's columns to the projection, qualified with the table name to avoid ambiguity.
- [ ] **4.3 Implement: MTI result mapping** — Extend the result mapper from M3.3: for MTI rows, the discriminator value determines which variant's columns to include. Base columns come from the base table alias; variant columns come from the JOINed table alias. Column-to-field mapping uses the variant model's `storage.fields`.
- [ ] **4.4 Tests: MTI write compilation** — Write tests: `create()` through an MTI variant produces two INSERTs (base table + variant table); the shared PK links both rows; both INSERTs are in a transaction.
- [ ] **4.5 Implement: MTI write compilation** — In the mutation path: when inserting through an MTI variant, split the data into base fields and variant fields. Produce two INSERTs: one for the base table (base fields + discriminator value), one for the variant table (variant fields + shared PK). Wrap in a transaction. For autoincrement PKs, the base INSERT must return the generated PK for use in the variant INSERT.
- [ ] **4.6 MTI integration tests** — Write integration tests against Postgres: create a schema with mixed STI (Bug in `tasks`) and MTI (Feature in `features`); query base → LEFT JOINs Feature table, returns discriminated union; query `.variant('Feature')` → INNER JOINs; insert Feature → two-table transaction; verify round-trip.

### Milestone 5: Mongo ORM `.variant()` and integration tests

Add `.variant()` to MongoCollection with discriminator filter injection and variant-aware writes. Integration tests against mongodb-memory-server.

**Validation:** Integration tests verify variant queries and writes against a real MongoDB instance.

**Tasks:**

- [ ] **5.1 Tests: `.variant()` on MongoCollection** — Write type tests: `.variant('Bug')` narrows return type to Bug's row; `.variant('Bug').create(...)` excludes discriminator from input type; `.variant('NonExistent')` is a type error. Write unit tests: `.variant('Bug')` injects `MongoFieldFilter.eq('type', 'bug')` into the match stage; `create()` through variant auto-injects discriminator value.
- [ ] **5.2 Implement: `.variant()` on MongoCollection** — Add `variant<V>(variantName: V)` method to `MongoCollection`. Internally: read `discriminator.field` and `variants[variantName].value` from the contract model. Inject a `MongoFieldFilter.eq(discriminatorField, discriminatorValue)` into the filters. Change the type parameters so the return type resolves to the variant model's row type (base + variant fields, literal discriminator). For `create()`, auto-inject the discriminator field/value into the insert document.
- [ ] **5.3 Variant-aware `CreateInput`** — Add a `VariantCreateInput` type that includes base + variant fields, excluding the discriminator field. Use this as the `create()` input type when the collection is narrowed to a variant.
- [ ] **5.4 Mongo integration tests** — Write integration tests against `mongodb-memory-server`: use an emitter-produced polymorphic contract (from M1); query base → discriminated union; query `.variant('Bug')` → narrowed Bug rows; insert via variant → discriminator value persisted; TypeScript narrowing on discriminator field; verify existing non-polymorphic queries unaffected.

### Milestone 6: SQL TS authoring DSL (`@prisma-next/sql-contract-ts`)

Add polymorphism to the TypeScript contract authoring DSL so that `model()` can declare `discriminator` and `base`, the semantic IR carries them, and the lowering pipeline emits them into the contract.

**Validation:** Unit tests verify the staged DSL → semantic IR → contract lowering produces correct `discriminator`, `variants`, and `base` on models. Type tests verify builder API type safety.

**Tasks:**

- [ ] **6.1 Tests: `StagedModelBuilder.discriminator()` and `.base()`** — Write tests: `model('Task', {...}).discriminator('type')` produces a `SqlSemanticModelNode` with `discriminator: { field: 'type' }`; `model('Bug', {...}).base('Task', 'bug')` produces a `SqlSemanticModelNode` with `base: { model: 'Task', value: 'bug' }`; lowering resolves `variants` on the base model from `base` declarations on variants; variant without explicit table inherits base's table (STI); variant with explicit table gets its own (MTI); variant's `fields` contain only variant-specific fields; diagnostics for invalid declarations (orphaned discriminator, orphaned base, discriminator field not found, same model with both discriminator and base).
- [ ] **6.2 Extend `SqlSemanticModelNode`** — Add optional `discriminator`, `base` properties to `SqlSemanticModelNode` in `semantic-contract.ts`. These mirror the contract-level `ContractDiscriminator` and `ContractModelBase` shapes.
- [ ] **6.3 Implement: `StagedModelBuilder.discriminator()` and `.base()`** — Add `discriminator(fieldName)` and `base(baseModelName, discriminatorValue)` methods on `StagedModelBuilder`. These store declarations on the builder state for use during lowering.
- [ ] **6.4 Implement: semantic contract lowering for polymorphism** — In `staged-contract-lowering.ts` (`buildStagedSemanticContractDefinition`): after building all models, scan for `discriminator` and `base` declarations. Collect variant→base mappings. For each base with `discriminator`, resolve the `variants` map from all `base` declarations. Validate bidirectional consistency. Emit `discriminator`, `variants`, `base` on the appropriate `SqlSemanticModelNode` entries. Strip variant models from `roots`. For STI vs MTI: variant without explicit table uses base's table; variant with explicit table gets its own.
- [ ] **6.5 Implement: `build-contract.ts` lowering** — In `buildSqlContractFromSemanticDefinition`: ensure `discriminator`, `variants`, and `base` on `SqlSemanticModelNode` are passed through to the contract `models` entries during the semantic→contract lowering step.
- [ ] **6.6 End-to-end test** — Write a test that defines a polymorphic schema via the staged DSL (`model()` → `defineContract()` → emit → validate). Verify the emitted `contract.json` matches the expected structure (same as a PSL-authored contract with the same schema).

### Milestone 7: Demo apps

Add polymorphic models to both demo apps, demonstrating the full PSL → emit → query → response type path.

**Validation:** Both demo apps typecheck and run with polymorphic queries. The response types narrow correctly on the discriminator field.

**Tasks:**

- [ ] **7.1 SQL demo: add polymorphic model to schema** — Add a polymorphic model to `examples/prisma-next-demo/prisma/schema.prisma` (e.g. a `Task` with `Bug` and `Feature` variants). Re-emit the contract. Verify the emitted `contract.json` and `contract.d.ts` include polymorphism metadata.
- [ ] **7.2 SQL demo: add polymorphic query command** — Add an ORM query command to the SQL demo that queries the polymorphic root (`db.tasks.all()`) and a specific variant (`db.tasks.variant('Bug').all()`). Seed polymorphic data. Print results showing discriminated union narrowing.
- [ ] **7.3 Mongo demo: add polymorphic model to schema** — Add a polymorphic model to `examples/mongo-demo/prisma/contract.prisma`. Re-emit the contract. Verify emitted contract includes polymorphism metadata.
- [ ] **7.4 Mongo demo: add polymorphic query endpoint** — Add an API endpoint (or extend existing ones) that queries a polymorphic root and a specific variant via `.variant()`. Seed polymorphic data. The response type threads through the app correctly.
- [ ] **7.5 Typecheck both demos** — Run `pnpm typecheck` on both demo apps to verify the polymorphic types compile correctly end-to-end.

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `@@discriminator` emits `discriminator: { field }` | Unit | M1 (1.1, 1.3) | PSL interpreter tests |
| `@@base` emits `base` + `variants` | Unit | M1 (1.1, 1.3) | PSL interpreter tests |
| Thin variant fields | Unit | M1 (1.1, 1.3) | |
| STI storage (no `@@map`) | Unit | M1 (1.1) | |
| MTI storage (`@@map`) | Unit | M1 (1.1) | SQL only |
| Diagnostics (6 error cases) | Unit | M1 (1.1, 1.3) | |
| Both interpreters support syntax | Unit | M1 (1.1–1.4) | |
| SQL discriminated union return types | Type test | M2 (2.1) | `.test-d.ts` |
| STI SELECT with variant columns | Unit | M3 (3.1) | |
| STI WHERE on discriminator | Unit | M3 (3.1) | |
| MTI LEFT JOIN on base query | Unit | M4 (4.1) | |
| MTI INNER JOIN on variant query | Unit | M4 (4.1) | |
| MTI transactional writes | Integration | M4 (4.4, 4.6) | |
| STI writes with discriminator | Integration | M3 (3.5, 3.7) | |
| Result mapper uses discriminator | Integration | M3 (3.7), M4 (4.6) | |
| Mongo `.variant()` filter injection | Unit | M5 (5.1) | |
| Mongo `.variant()` return type | Type test | M5 (5.1) | |
| Mongo variant create auto-injects discriminator | Unit + Integration | M5 (5.1, 5.4) | |
| Existing `InferRootRow`/`VariantRow` tests pass | Type test | M5 | Regression |
| `.variant()` chains with other methods | Unit | M2 (2.3), M5 (5.1) | |
| `.variant()` type-safe variant names | Type test | M2 (2.3), M5 (5.1) | |
| Emitter-produced contracts (not hand-crafted) | Integration | M1 (1.5), M3 (3.7), M4 (4.6), M5 (5.4) | |
| Both families against real databases | Integration | M3 (3.7), M4 (4.6), M5 (5.4) | |
| TS DSL `discriminator()` → semantic IR | Unit | M6 (6.1) | |
| TS DSL `base()` → semantic IR | Unit | M6 (6.1) | |
| TS DSL lowering resolves `variants` on base | Unit | M6 (6.1) | |
| TS DSL STI/MTI storage derivation | Unit | M6 (6.1) | |
| TS DSL diagnostics (invalid declarations) | Unit | M6 (6.1) | |
| TS DSL → emit → validate end-to-end | Integration | M6 (6.6) | |
| SQL demo: PSL → emit → query → response type | E2E | M7 (7.1, 7.2, 7.5) | |
| Mongo demo: PSL → emit → query → response type | E2E | M7 (7.3, 7.4, 7.5) | |

## Open Items

- **Phase 1.6 completeness.** The framework `Codec` base interface has landed, but the full Phase 1.6 cleanup (tagged bigint removal, etc.) may not be complete. For typical discriminator types (string, int), the identity `encodeJson`/`decodeJson` defaults work fine. Non-JSON-safe discriminator types (unlikely in practice) would need Phase 1.6 to be fully landed.
- **SQL transaction infrastructure for MTI writes.** MTI inserts require two INSERTs in a transaction. Verify the SQL ORM's existing transaction support covers this path. If not, a lightweight transaction wrapper may be needed.
- **Coordination with Alexey.** The SQL ORM changes (M2–M4) touch `collection.ts`, `query-plan-select.ts`, `collection-runtime.ts`, and `types.ts`. Coordinate timing to avoid conflicts with other SQL ORM work.
