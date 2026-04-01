closes [TML-2175](https://linear.app/prisma-company/issue/TML-2175/migrate-consumers-to-new-domain-level-type-fields-m2)

## Before / After (intention in code)

```ts
// BEFORE — consumer reads SQL-specific mappings and top-level relations
const column = contract.mappings.fieldToColumn[modelName][fieldName];
const table = contract.mappings.modelToTable[modelName];
const rel = contract.relations[tableName][relationName];
```

```ts
// AFTER — consumer reads domain-level fields on the model
const column = resolveFieldToColumn(contract, modelName, fieldName);
const table = resolveModelTableName(contract, modelName);
const rel = resolveIncludeRelation(contract, modelName, relationName);
// ↑ backed by model.storage.fields, model.storage.table, model.relations
```

## Intent

Implement ADR 172's domain-storage separation in the emitted contract: widen `ContractBase` with a shared domain structure (`roots`, `models` with typed fields, relations, and storage metadata), update the SQL emitter to produce the ADR 172 JSON layout, bridge `validateContract()` so old fields remain available, then migrate all consumers to read from the new domain-level fields. This is the foundational step toward cross-family consumer code and unblocks M3 (removing the old fields entirely).

## Change map

- **Domain types and validation** (M1):
  - [packages/1-framework/1-core/shared/contract/src/domain-types.ts](packages/1-framework/1-core/shared/contract/src/domain-types.ts) — new `DomainModel`, `DomainField`, `DomainRelation` types
  - [packages/1-framework/1-core/shared/contract/src/validate-domain.ts](packages/1-framework/1-core/shared/contract/src/validate-domain.ts) — extracted shared domain validation
  - [packages/2-sql/1-core/contract/src/validate.ts](packages/2-sql/1-core/contract/src/validate.ts) — `validateContract()` bridge: derives old fields from new
  - [packages/2-sql/1-core/contract/src/types.ts](packages/2-sql/1-core/contract/src/types.ts) — `ContractBase` widened with `roots`, `models`
- **Emitter** (M1):
  - [packages/2-sql/3-tooling/emitter/src/index.ts](packages/2-sql/3-tooling/emitter/src/index.ts) — emits ADR 172 JSON structure
  - [packages/1-framework/2-authoring/migration/control-plane/src/emission/emit.ts](packages/1-framework/2-authoring/migration/control-plane/src/emission/emit.ts) — updated canonicalization
- **Consumer migration** (M2 — sql-orm-client, 11 source files):
  - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts) — centralized resolution helpers with WeakMap memoization
  - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts) — reads `model.relations`, `model.fields[f].codecId`
  - [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts) — reads `model.fields[f].codecId` for trait gating
  - [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts) — reads `model.relations`
  - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts) — type-level generics migrated to domain paths
  - [packages/3-extensions/sql-orm-client/src/collection-column-mapping.ts](packages/3-extensions/sql-orm-client/src/collection-column-mapping.ts), [collection-runtime.ts](packages/3-extensions/sql-orm-client/src/collection-runtime.ts), [collection.ts](packages/3-extensions/sql-orm-client/src/collection.ts), [collection-dispatch.ts](packages/3-extensions/sql-orm-client/src/collection-dispatch.ts), [query-plan-select.ts](packages/3-extensions/sql-orm-client/src/query-plan-select.ts), [aggregate-builder.ts](packages/3-extensions/sql-orm-client/src/aggregate-builder.ts), [grouped-collection.ts](packages/3-extensions/sql-orm-client/src/grouped-collection.ts)
- **Consumer migration** (M2 — relational-core, 1 file):
  - [packages/2-sql/4-lanes/relational-core/src/types.ts](packages/2-sql/4-lanes/relational-core/src/types.ts) — `ExtractTableToModel`, `ExtractColumnToField`, `ExtractColumnJsTypeFromModels`
- **ADR 177** (ownership replaces relation strategy):
  - [docs/architecture docs/adrs/ADR 177 - Ownership replaces relation strategy.md](docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)
- **Tests (evidence)**:
  - [packages/1-framework/1-core/shared/contract/test/validate-domain.test.ts](packages/1-framework/1-core/shared/contract/test/validate-domain.test.ts)
  - [packages/1-framework/1-core/shared/contract/test/domain-types.test.ts](packages/1-framework/1-core/shared/contract/test/domain-types.test.ts)
  - [packages/2-sql/1-core/contract/test/validate.test.ts](packages/2-sql/1-core/contract/test/validate.test.ts)
  - [packages/2-sql/1-core/contract/test/domain-types.test.ts](packages/2-sql/1-core/contract/test/domain-types.test.ts)
  - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
  - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
  - [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)
  - [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts)
  - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)
  - [packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts](packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts)
- **Project artifacts**:
  - [projects/contract-domain-extraction/spec.md](projects/contract-domain-extraction/spec.md)
  - [projects/contract-domain-extraction/plan.md](projects/contract-domain-extraction/plan.md)
  - [projects/contract-domain-extraction/reviews/](projects/contract-domain-extraction/reviews/)

## The story

1. **Widen `ContractBase` with shared domain structure.** `ContractBase` gains `roots` (aggregate root model names) and `models` (each carrying `fields` with `{ codecId, nullable }`, optional `relations` with `{ to, cardinality, on: { localFields, targetFields } }`, and `storage` with `{ table, fields: { [f]: { column } } }`). A new `DomainModel`/`DomainField`/`DomainRelation` type family defines the cross-family domain shape. Shared validation is extracted to `validate-domain.ts` at the framework level.

2. **Update the SQL emitter to produce ADR 172 JSON.** The emitter now emits the new domain-level structure directly in `contract.json`: models carry `storage.fields`, `relations`, and typed `fields`. The old `mappings` and top-level `relations` sections are no longer emitted in JSON — they exist only in `contract.d.ts` types, derived by `validateContract()`.

3. **Bridge `validateContract()` for backward compatibility.** `validateContract()` reads the new ADR 172 JSON and derives the old fields (`mappings.modelToTable`, `mappings.fieldToColumn`, `mappings.tableToModel`, `mappings.columnToField`, top-level `relations`) so existing consumer code continues to work without changes. This makes the migration non-breaking and incremental.

4. **ADR 177: Ownership replaces relation strategy.** Relations lose their `strategy` field and models gain an `owner` field pointing to the owning model. This simplifies the contract's relation model and reflects the domain-level semantics more clearly. Validated and enforced in domain validation.

5. **Migrate ORM-client runtime to domain-level reads.** Every file in `sql-orm-client/src/` that accessed `contract.mappings.*` or `contract.relations[tableName]` is updated to use centralized resolution helpers in `collection-contract.ts`. These helpers read from `model.storage.fields`, `model.storage.table`, and `model.relations`, with WeakMap-backed memoization. The include-relation naming is aligned with ADR 172 vocabulary: `localColumn`/`targetColumn` replaces `fkColumn`/`parentPkColumn`.

6. **Migrate type-level generics.** Conditional types in `sql-orm-client/src/types.ts` and `relational-core/src/types.ts` that extracted table names, column names, relations, and FK fields from `TContract['mappings']` and `TContract['relations']` are rewritten to derive from `model.storage`, `model.relations`, and `model.fields`. Several intermediate types are eliminated.

7. **Update test fixtures and e2e contracts.** All test `contract.json` and `contract.d.ts` fixtures are updated to the ADR 172 structure. E2e expected contract files gain the new domain-level sections.

## Behavior changes & evidence

- **Contract JSON emits ADR 172 structure**: The emitter produces `model.storage.fields`, `model.relations`, domain-level `model.fields`, and `roots` directly in `contract.json`. The old `mappings` and top-level `relations` sections are no longer in the JSON — they are derived at validation time.
  - **Why**: ADR 172 mandates domain-storage separation. Emitting the target structure directly avoids dual-format complexity.
  - **Implementation**:
    - [packages/2-sql/3-tooling/emitter/src/index.ts](packages/2-sql/3-tooling/emitter/src/index.ts)
  - **Tests**:
    - [packages/1-framework/3-tooling/emitter/test/emitter.test.ts](packages/1-framework/3-tooling/emitter/test/emitter.test.ts)
    - E2e expected contract fixtures under [test/e2e/](test/e2e/)

- **`validateContract()` bridges old fields from new structure**: `validateContract()` derives `mappings` and top-level `relations` from the domain-level fields, so existing consumers see no difference in the TypeScript contract type.
  - **Why**: Enables incremental migration — consumers can adopt new fields at their own pace without breaking.
  - **Implementation**:
    - [packages/2-sql/1-core/contract/src/validate.ts](packages/2-sql/1-core/contract/src/validate.ts)
  - **Tests**:
    - [packages/2-sql/1-core/contract/test/validate.test.ts](packages/2-sql/1-core/contract/test/validate.test.ts)

- **Domain validation extracted to framework level**: Validation rules for model fields, relations, roots, and ownership are now shared between SQL and MongoDB families.
  - **Why**: Cross-family code reuse — both families validate the same domain invariants.
  - **Implementation**:
    - [packages/1-framework/1-core/shared/contract/src/validate-domain.ts](packages/1-framework/1-core/shared/contract/src/validate-domain.ts)
  - **Tests**:
    - [packages/1-framework/1-core/shared/contract/test/validate-domain.test.ts](packages/1-framework/1-core/shared/contract/test/validate-domain.test.ts)

- **Relations use ownership instead of strategy (ADR 177)**: Relations lose `strategy` and models gain `owner`. Validated in domain validation.
  - **Why**: Ownership is a clearer domain-level concept than strategy, and avoids per-relation strategy configuration.
  - **Implementation**:
    - [docs/architecture docs/adrs/ADR 177 - Ownership replaces relation strategy.md](docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)
    - [packages/1-framework/1-core/shared/contract/src/validate-domain.ts](packages/1-framework/1-core/shared/contract/src/validate-domain.ts)

- **ORM client reads from domain-level fields instead of `mappings`**: Field-to-column, model-to-table, relations, and codec traits all read from `model.storage.*`, `model.relations`, and `model.fields[f].codecId`. Centralized helpers with WeakMap memoization. `resolveModelTableName` throws on missing `storage.table` instead of falling back to string manipulation. Include-relation naming uses `localColumn`/`targetColumn`.
  - **Why**: Required by ADR 172 — `mappings` will be removed in M3.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/collection-contract.ts](packages/3-extensions/sql-orm-client/src/collection-contract.ts)
    - [packages/3-extensions/sql-orm-client/src/model-accessor.ts](packages/3-extensions/sql-orm-client/src/model-accessor.ts)
    - [packages/3-extensions/sql-orm-client/src/filters.ts](packages/3-extensions/sql-orm-client/src/filters.ts)
    - [packages/3-extensions/sql-orm-client/src/mutation-executor.ts](packages/3-extensions/sql-orm-client/src/mutation-executor.ts)
    - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts)
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/collection-contract.test.ts](packages/3-extensions/sql-orm-client/test/collection-contract.test.ts)
    - [packages/3-extensions/sql-orm-client/test/model-accessor.test.ts](packages/3-extensions/sql-orm-client/test/model-accessor.test.ts)
    - [packages/3-extensions/sql-orm-client/test/filters.test.ts](packages/3-extensions/sql-orm-client/test/filters.test.ts)
    - [packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts](packages/3-extensions/sql-orm-client/test/mutation-executor.test.ts)
    - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)

- **Type-level generics derive from domain-level fields (no runtime behavior change)**: Conditional types in `types.ts` and `relational-core/types.ts` rewritten to read from `model.storage`, `model.relations`, and `model.fields`. Several intermediate types eliminated.
  - **Why**: Types must match runtime code paths.
  - **Implementation**:
    - [packages/3-extensions/sql-orm-client/src/types.ts](packages/3-extensions/sql-orm-client/src/types.ts)
    - [packages/2-sql/4-lanes/relational-core/src/types.ts](packages/2-sql/4-lanes/relational-core/src/types.ts)
  - **Tests**:
    - [packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts](packages/3-extensions/sql-orm-client/test/generated-contract-types.test-d.ts)
    - [packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts](packages/2-sql/4-lanes/relational-core/test/schema.types.test-d.ts)

## Compatibility / migration / risk

- **No breaking changes for external consumers.** `validateContract()` still returns a type with both old and new fields. The old fields (`mappings`, top-level `relations`) are derived from the new structure, so values are identical.
- **Legacy relation format removed from ORM client.** The `{ model, foreignKey }` relation fallback is gone. All relations must use `{ to, cardinality, on: { localFields, targetFields } }`. This is intentional — M1 already ensures this structure.
- **`resolveModelTableName` is strict.** It throws if `storage.table` is missing rather than falling back to a lowercase model name. A validated contract always provides `storage.table`.
- **`as Record<string, ...>` casts on `contract.models`.** Several ORM-client files cast `contract.models` to local shape types. These will be removed in M3 when `ContractBase.models` is concretely typed (tracked as plan task 3.6.1).

## Follow-ups / open questions

- **M3: Remove old type fields.** No consumer source references `mappings` or top-level `relations`. M3 can proceed to remove them from `SqlContract` and `validateContract()`.
- **M3 task 3.6.1: Remove `as Record<string, ...>` casts.** Once `ContractBase.models` is concretely typed (3.6), the casts become unnecessary.
- **M4: Contract IR alignment.** Align internal `ContractIR` with emitted JSON to reduce impedance mismatch.

## Non-goals / intentionally out of scope

- Removing old fields from `SqlContract` or `validateContract()` (M3 scope)
- Contract IR alignment (M4 scope)
- Emitter generalization for cross-family support (M5 scope)
