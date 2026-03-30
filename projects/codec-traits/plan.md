# Codec Trait System

## Summary

Introduce a trait system for codecs so that DSL surfaces can gate operators and functions based on semantic type capabilities (`equality`, `order`, `boolean`, `numeric`, `textual`) rather than hardcoded codec IDs or native type names. This removes target-specific hacks like `NumericNativeType`, gives extension codecs first-class operator access, and produces compile-time type errors for semantically invalid queries (e.g., `sum()` on a text column). Success means: every codec declares its traits, the contract emitter propagates them into `CodecTypes`, the ORM uses traits for gating, and `NumericNativeType` is deleted. SQL lane trait-gating is out of scope for this project.

**Spec:** `docs/architecture docs/adrs/ADR 170 - Codec trait system.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | TBD | Drives execution |
| Reviewer | TBD | Architectural review — touches core codec infra, contract emitter, and ORM types |

## Milestones

### Milestone 1: Core trait infrastructure

Adds the `CodecTrait` type, extends the `Codec` interface and factory, and extends `CodecRegistry` with trait-query methods. After this milestone, codecs *can* declare traits and the registry *can* answer trait queries — but no codecs do yet.

**Tasks:**

- [ ] **M1-T1**: Define `CodecTrait` type in `relational-core/src/ast/codec-types.ts`
  - `type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual'`
  - Export from `relational-core/ast` barrel

- [ ] **M1-T2**: Add `traits` field to `Codec` interface
  - `readonly traits?: readonly CodecTrait[]`
  - Field is optional for backward compatibility

- [ ] **M1-T3**: Add `traits` param to `codec()` factory function
  - Accept `traits?: readonly CodecTrait[]` in the config object
  - Spread into result using `ifDefined('traits', config.traits)`

- [ ] **M1-T4**: Propagate `traits` through `aliasCodec()` in Postgres adapter
  - `aliasCodec()` inherits `traits` from the base codec by default
  - Accept optional `traits` override in the options object
  - Located in `postgres/src/core/codecs.ts`

- [ ] **M1-T5**: Add `hasTrait()` and `traitsOf()` to `CodecRegistry` interface and `CodecRegistryImpl`
  - `hasTrait(codecId: string, trait: CodecTrait): boolean` — returns `false` if codec not found
  - `traitsOf(codecId: string): readonly CodecTrait[]` — returns `[]` if codec not found or has no traits

- [ ] **M1-T6**: Extend `ExtractCodecTypes` to include `traits` in the extracted type
  - Currently extracts `{ input, output }` per codec; extend to `{ input, output, traits }` where `traits` is a union of the codec's declared trait string literals
  - Update `CodecDefBuilder` / `CodecDefBuilderImpl` so `CodecTypes` carries `traits`
  - This is the key type-level plumbing — codec declarations flow traits through `defineCodecs().add(...)` into the `CodecTypes` type used by contract.d.ts

- [ ] **M1-T7**: Unit tests for trait infrastructure
  - Test `hasTrait` / `traitsOf` on registry with codecs that have traits and codecs that don't
  - Test `codec()` factory produces a codec with traits
  - Test `aliasCodec()` forwards traits
  - Type-level test: `ExtractCodecTypes` carries traits through to the output type

### Milestone 2: Trait declarations on all codecs

Declare traits on every existing codec: core SQL codecs, all Postgres adapter codecs, and the pgvector extension codec.

**Tasks:**

- [ ] **M2-T1**: Add traits to core SQL codecs in `relational-core/src/ast/sql-codecs.ts`
  - `sql/char@1`: `['equality', 'order', 'textual']`
  - `sql/varchar@1`: `['equality', 'order', 'textual']`
  - `sql/int@1`: `['equality', 'order', 'numeric']`
  - `sql/float@1`: `['equality', 'order', 'numeric']`

- [ ] **M2-T2**: Add traits to Postgres adapter codecs in `postgres/src/core/codecs.ts`
  - Numeric codecs (`pg/int4@1`, `pg/int2@1`, `pg/int8@1`, `pg/float4@1`, `pg/float8@1`, `pg/numeric@1`, aliased `pg/int@1`, `pg/float@1`): `['equality', 'order', 'numeric']`
  - Text codecs (`pg/text@1`, `pg/char@1`, `pg/varchar@1`): `['equality', 'order', 'textual']`
  - Bool (`pg/bool@1`): `['equality', 'boolean']`
  - Temporal codecs (`pg/timestamp@1`, `pg/timestamptz@1`, `pg/time@1`, `pg/timetz@1`, `pg/interval@1`): `['equality', 'order']`
  - JSON codecs (`pg/json@1`, `pg/jsonb@1`): `['equality']`
  - Bit codecs (`pg/bit@1`, `pg/varbit@1`): `['equality', 'order']`
  - Enum (`pg/enum@1`): `['equality', 'order']`

- [ ] **M2-T3**: Add traits to pgvector codec in `pgvector/src/core/codecs.ts`
  - `pg/vector@1`: `['equality']`

- [ ] **M2-T4**: Verify trait propagation through `defineCodecs()` builder
  - Ensure `CodecTypes` type for Postgres includes `traits` field for each codec entry
  - Snapshot or type-level test confirming the shape of `CodecTypes` after trait addition

### Milestone 3: Contract emitter emits traits into `CodecTypes`

The contract emitter already intersects `CodecTypes` from adapters/extensions. After Milestone 2, those types already carry `traits`. This milestone ensures the emitted `contract.d.ts` makes traits available and that the exported `CodecTypes` from `postgres/src/exports/codec-types.ts` includes traits.

**Tasks:**

- [ ] **M3-T1**: Verify/update Postgres codec-types export
  - `postgres/src/exports/codec-types.ts` re-exports `CodecTypes` from core codecs
  - Confirm `traits` field is present in the re-exported type (it should be if M1-T6 / M2 were done correctly)
  - If JSON codec overrides lose traits in the intersection, fix by preserving `traits` in the `&` type

- [ ] **M3-T2**: Verify emitted `contract.d.ts` carries traits
  - Re-emit a test fixture contract (e.g., `sql-orm-client/test/fixtures/generated/contract.d.ts`) and verify each `CodecTypes` entry has `traits`
  - Also check `test/integration/test/fixtures/contract.d.ts`

- [ ] **M3-T3**: Update any manually-written `CodecTypes` in test fixtures
  - Integration test fixtures with hand-written `CodecTypes` (e.g., `{ output: number }`) need `traits` added
  - Search for `CodecTypes` in test fixtures and update

### Milestone 4: ORM trait-based gating

Replace the ORM's `NumericNativeType` with trait-based checks and gate `ComparisonMethods` by traits in the ORM lane. SQL lane gating is out of scope.

**Tasks:**

- [ ] **M4-T1**: Implement `HasTrait` utility type
  - Create a generic `HasTrait<CodecId, Trait, CTypes>` conditional type in a shared location (likely `relational-core` or `sql-contract`)
  - Returns `true` if `Trait extends CTypes[CodecId]['traits']`, `false` otherwise

- [ ] **M4-T2**: Replace `IsNumericStorageColumn` in `sql-orm-client/src/types.ts`
  - Change from native type enumeration to: check if the column's `codecId` maps to a codec entry in `CodecTypes` whose `traits` include `'numeric'`
  - Delete `NumericNativeType` union
  - Update `StrictNumericFieldNames` to use the new check
  - The `NumericFieldNamesFromRowType` fallback (JS-type-based) may still be needed for contracts without `CodecTypes`; evaluate whether to keep it

- [ ] **M4-T3**: Update `AggregateBuilder` and `HavingBuilder` if needed
  - These use `NumericFieldNames<TContract, ModelName>` which flows through `StrictNumericFieldNames`
  - Verify the updated trait-based `NumericFieldNames` still correctly gates `sum()` and `avg()`

- [ ] **M4-T4**: Trait-gate `ComparisonMethods` in ORM `ModelAccessor`
  - `ComparisonMethods<T>` currently exposes all operators on every field
  - Split into trait-conditional groups:
    - `eq`, `neq`, `in`, `notIn`, `isNull`, `isNotNull`: always available (or gated by `equality`)
    - `gt`, `lt`, `gte`, `lte`: require `order` trait
    - `like`, `ilike`: require `textual` trait
    - `asc`, `desc`: require `order` trait
  - Use conditional types resolving from `CodecTypes` traits in `ScalarModelAccessor`
  - This requires threading `CodecTypes` (or `TypeMaps`) through `ModelAccessor` — evaluate the type plumbing needed

- [ ] **M4-T5**: Test ORM type safety
  - Type-level test: `sum()` and `avg()` accept numeric fields, reject text/bool/json fields
  - Type-level test: `gt()`/`lt()` available on int/text columns, absent on json/bool columns
  - Type-level test: `like()`/`ilike()` available on text columns, absent on int/json columns
  - Existing ORM tests should pass

### Milestone 5: Close-out

**Tasks:**

- [ ] **M5-T1**: Run full test suite and fix any regressions
  - `pnpm test:packages`, `pnpm test:e2e`, `pnpm test:integration`
  - `pnpm build` must pass
  - `pnpm lint:deps` must pass (no import violations)

- [ ] **M5-T2**: Verify all acceptance criteria are met (see Test Coverage table below)

- [ ] **M5-T3**: Finalize ADR 170 — move from `docs/architecture docs/adrs/` if needed, ensure it reflects final implementation

- [ ] **M5-T4**: Delete `projects/codec-traits/` and remove any transient references

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| `CodecTrait` type with 5 traits exported | Unit / Type-level | M1-T1, M1-T7 | Verify the union type is correct |
| `Codec` interface has optional `traits` field | Type-level | M1-T2, M1-T7 | Backward-compat: codecs without traits still compile |
| `codec()` factory accepts and produces `traits` | Unit | M1-T3, M1-T7 | |
| `aliasCodec()` forwards traits | Unit | M1-T4, M1-T7 | |
| `CodecRegistry.hasTrait()` works | Unit | M1-T5, M1-T7 | Returns false for unknown codec or missing trait |
| `CodecRegistry.traitsOf()` works | Unit | M1-T5, M1-T7 | Returns [] for unknown codec |
| `ExtractCodecTypes` carries `traits` in type | Type-level | M1-T6, M1-T7 | Key type-level test |
| All core SQL codecs have traits | Unit/snapshot | M2-T1, M2-T4 | 4 codecs |
| All Postgres codecs have traits | Unit/snapshot | M2-T2, M2-T4 | 21+ codecs |
| pgvector codec has traits | Unit | M2-T3 | `['equality']` |
| Emitted `contract.d.ts` has `traits` per `CodecTypes` entry | Snapshot / Integration | M3-T2 | Re-emit and check fixtures |
| `NumericNativeType` deleted | Manual / grep | M4-T2 | Verify no references remain |
| `IsNumericStorageColumn` uses trait-based check | Type-level | M4-T2, M4-T5 | |
| `sum()`/`avg()` gated by `numeric` trait | Type-level | M4-T3, M4-T5 | Must reject text/bool fields |
| ORM `gt`/`lt` gated by `order` trait | Type-level | M4-T4, M4-T5 | Absent on json/bool columns |
| ORM `like`/`ilike` gated by `textual` trait | Type-level | M4-T4, M4-T5 | Absent on int/json columns |
| All existing tests pass | Integration / E2E | M5-T1 | Full suite |
| Import layering valid | Lint | M5-T1 | `pnpm lint:deps` |

## Open Items

1. **Comparison results and the `boolean` trait** (from ADR open questions): Should comparison results (e.g., `col.eq(value)`) automatically carry the `boolean` trait, or should they be a distinct predicate type? The ADR notes the simpler approach (implicit boolean) vs. the more precise approach (distinct predicate type). **Recommendation**: Start with implicit boolean for MVP; revisit if type-level `where()` gating needs to distinguish comparison results from boolean columns.

2. **SQL lane trait-gating**: Out of scope. The SQL lane column builders currently attach operators via `forTypeId` matching from the operation registry. Trait-gating the SQL lane's column/expression builders is a follow-up project.

3. **`NumericFieldNamesFromRowType` fallback**: Currently used when `StrictNumericFieldNames` resolves to `never` (e.g., contracts without `nativeType`). After the trait migration, this fallback may still be needed for contracts that lack `CodecTypes`. Evaluate during M4-T2.

4. **ORM `ComparisonMethods` type plumbing**: Gating `ComparisonMethods` by traits requires threading `CodecTypes` through `ModelAccessor` → `ScalarModelAccessor` → per-field conditional types. This may require adding a `TypeMaps` type parameter to several ORM types. Evaluate complexity during M4-T4.

## Decisions

- **Aliased codecs inherit traits**: `aliasCodec()` inherits `traits` from the base codec by default, with optional override.
- **ORM lane gets trait-gating**: `ComparisonMethods` in the ORM are split by trait. SQL lane is out of scope.
- **SQL lane out of scope**: Column builder trait-gating in the SQL lane is a follow-up project.
