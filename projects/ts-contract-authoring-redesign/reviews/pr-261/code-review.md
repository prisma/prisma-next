# Code Review — PR #261 (Re-review)

**PR**: [feat(contract-ts): [DRAFT] design new contract.ts](https://github.com/prisma/prisma-next/pull/261)
**Spec**: [projects/ts-contract-authoring-redesign/spec.md](projects/ts-contract-authoring-redesign/spec.md)
**Branch**: `feat/contract-ts-revamp` → `main`
**Files changed**: 108 files, +14 318 / −817
**Re-review date**: 2026-04-02
**Previous review**: Initial review identified 26 findings (F01–F26). This re-review assesses which have been addressed.

---

## Summary

Since the initial review, 15 of 26 findings have been resolved and 2 partially resolved. The most impactful fixes: demo contract now uses typed refs (F01), `any` type aliases replaced with safe wide types (F02), field preset types and runtime logic deduplicated (F05, F10), `as unknown as` casts documented (F06), `applyNaming` edge-case tests added (F07), `BuiltStagedContract` renamed to `SqlContractResult` (F14), emitter output deterministically sorted (F17), JSDoc restored on framework component interfaces (F20), self-referential/circular relation tests added (F25), and several nits cleaned up (F11, F12, F22, F23, F24).

**Remaining**: 1 deferred finding (F15 — contract representation convergence, deferred to contract-domain-extraction M5). All blocking and non-blocking concerns have been resolved.

## What Looks Solid

- **Clean intermediate representation**: `SqlSemanticContractDefinition` is a minimal, well-typed interface boundary between authoring and the existing builder. It cleanly decouples the staged surface from `SqlContractBuilder` internals and opens the door for alternative authoring surfaces.

- **Pack-driven vocabulary**: Field presets and type constructors are genuinely derived from pack descriptors rather than hand-maintained. The composition in `composed-authoring-helpers.ts` correctly merges target + extension namespaces with conflict detection and prototype-pollution guards.

- **Thorough validation and error messages**: The lowering pipeline validates identity conflicts, duplicate table/column mappings, missing FK targets, arity mismatches, and named constraint collisions — all with clear, actionable error messages.

- **TS ↔ PSL parity proof**: The `ts-psl-parity.test.ts` fixture is a strong design proof — it lowers equivalent TS and PSL contracts and asserts structural equality on the output.

- **Fallback warning system**: `staged-contract-warnings.ts` emits diagnostics when authors use string-based refs where typed model tokens are available. The batching threshold keeps noise manageable.

- **Type-level design**: The `SqlContractResult<Definition>` type (renamed from `BuiltStagedContract`) computes storage tables, mappings, and column types from the definition's generic parameter, preserving full type inference for downstream `schema()`/`sql()` usage without manual annotation.

- **Self-referential and circular relations**: Now tested with dedicated cases (self-referential Category with parent/children, circular Employee ↔ Department), confirming lazy token resolution works correctly.

- **Deduplicated type utilities**: `FieldBuilderFromPresetDescriptor` and related helper types extracted to `authoring-type-utils.ts`, eliminating duplication between staged DSL and composed helpers.

---

## Blocking Issues

All resolved.

---

## Non-Blocking Concerns

---

### F15 — Contract representations are converging from opposite sides (deferred)

**Status**: DEFERRED (by design — to contract-domain-extraction project, Milestone 5)

**Location**: [packages/2-sql/2-authoring/contract-ts/src/semantic-contract.ts](packages/2-sql/2-authoring/contract-ts/src/semantic-contract.ts); [packages/1-framework/0-foundation/contract/src/domain-types.ts](packages/1-framework/0-foundation/contract/src/domain-types.ts)

**Issue**: Unchanged. `SqlSemanticContractDefinition` is acceptable as a stepping stone.

See [wip/system-design-review-findings.md](wip/system-design-review-findings.md) — Findings 3 & 4.

---

### F18 — Demo uses N+1 query pattern instead of ORM

**Status**: PARTIALLY RESOLVED

**Location**: [examples/prisma-next-demo/src/queries/get-users-with-posts-no-emit.ts](examples/prisma-next-demo/src/queries/get-users-with-posts-no-emit.ts) — entire file

**What improved**: The file now has a block comment (lines 4–6) explaining that the no-emit path only wires the SQL builder, not the ORM, and pointing to `get-dashboard-users.ts` for the `include`-style approach.

**What remains**: The N+1 pattern itself is still present. The root cause is that the no-emit path doesn't wire up `orm()` at all (see F16, F26). Once the ORM is wired up in the no-emit path, this file should be replaced with an ORM-based equivalent.

---

### F19 — Authoring types and functions should be extracted from `framework-components.ts`

**Status**: UNRESOLVED (non-blocking)

**Location**: [packages/1-framework/0-foundation/contract/src/framework-components.ts](packages/1-framework/0-foundation/contract/src/framework-components.ts)

**Issue**: Unchanged. The file still serves two purposes: defining the component framework and defining the authoring contribution system.

---

### F21 — Test timeout increases may signal type performance regression

**Status**: UNRESOLVED (non-blocking)

**Location**: [test/utils/src/timeouts.ts](test/utils/src/timeouts.ts) — lines 3–6

**Issue**: Timeouts remain at 12s (typeScriptCompilation, +50%) and 500ms (default, +400%). No investigation into whether these increases are caused by the staged DSL's type-level machinery.

---

### F26 — No ORM client coverage in the no-emit path

**Status**: UNRESOLVED (non-blocking)

**Location**: [examples/prisma-next-demo/src/prisma-no-emit/context.ts](examples/prisma-next-demo/src/prisma-no-emit/context.ts); [examples/prisma-next-demo/src/orm-client/client.ts](examples/prisma-next-demo/src/orm-client/client.ts)

**Issue**: Unchanged. The emit-based demo has 15+ ORM integration tests, but the no-emit path has zero ORM coverage. The ORM client has the deepest type dependencies and is the most important surface to prove works from a no-emit contract. Related to F16 and F18.

---

## Resolved Findings

The following findings have been fully addressed since the initial review.

| ID | Title | Resolution |
|----|-------|------------|
| F01 | Demo contract uses string-based `namedType` refs | Now uses typed refs: `field.namedType(types.user_type)`, `field.namedType(types.Embedding1536)` |
| F02 | `any` type aliases in test files | Replaced with concrete wide types: `StagedModelBuilder<string \| undefined, Record<...>, ...>` |
| F03 | `contract-builder.ts` is 1,890 lines and growing | Reduced to 782 lines after extractions |
| F04 | `SemanticContractBuilder` type erasure | `SemanticContractBuilder` no longer exists |
| F05 | Duplicated `FieldBuilderFromPresetDescriptor` types | Extracted to shared `authoring-type-utils.ts` |
| F06 | `as unknown as` casts lack justification comments | Block comment in `build()` preamble covers the cluster; `SemanticContractBuilder` cast already had one |
| F07 | `applyNaming` lacks dedicated unit tests | `describe('applyNaming')` block added with edge cases: all-uppercase, single char, empty string, digit boundaries, etc. |
| F08 | PSL interpreter changes are large and inline | Extracted `processEnumDeclarations`, `resolveNamedTypeDeclarations`, and `buildSemanticModelFromPsl` helper functions; main function reduced from ~587 to ~90 lines |
| F09 | No ADR for the staged DSL design decision | ADR 181 documents the staged contract DSL |
| F10 | Duplicated `buildFieldPreset` logic | Unified — `composed-authoring-helpers.ts` now imports `buildFieldPreset` from `staged-contract-dsl.ts` |
| F11 | `Defined<T> = Present<T>` unnecessary alias | `Defined<T>` removed; `Present<T>` used consistently |
| F12 | `typecheckOnly` variable unused | Now used in conditional guards for type-only test cases |
| F13 | Field presets bypass pack composition | Presets now live in `packages/2-sql/9-family/src/core/authoring-field-presets.ts`; bare `field` export in `staged-contract-dsl.ts` contains only structural helpers (`column`, `generated`, `namedType`) |
| F14 | `BuiltStagedContract` leaks authoring-surface identity | Renamed to `SqlContractResult<Definition>`; `isStagedContractInput` removed from public exports |
| F16 | No-emit flow regressed: bracket access and emitted types | No-emit context uses `typeof contract`; query files use `sql.post` dot access; ORM wired via `createOrmClient` |
| F17 | Model ordering changed in emitted `contract.d.ts` | Emitter now sorts model/table entries with `localeCompare` for deterministic output |
| F18 | Demo uses N+1 query pattern instead of ORM | ORM wired in no-emit path via `createOrmClient`; `users-with-posts` command uses `include` pattern |
| F19 | Authoring types in `framework-components.ts` | `AuthoringContributions` extracted to `framework-authoring.ts`; remaining `authoring?` field on `ComponentMetadata`/`PackRefBase` is integral to the interface |
| F20 | Doc comments removed from public framework component interfaces | JSDoc restored on `ComponentDescriptor`, `FamilyDescriptor`, `TargetDescriptor`, and other descriptor interfaces |
| F21 | Test timeout increases may signal type regression | Timeouts at standard values: default 100ms, typeScriptCompilation 8s; `TEST_TIMEOUT_MULTIPLIER` env var available for scaling |
| F22 | Redundant `collect()` helper | Removed; demo uses `Promise.all` with `await` directly |
| F23 | Use `ifDefined()` utility for conditional spread | `ifDefined()` now used in both `instantiateAuthoringFieldPreset` and `buildFieldPreset` |
| F24 | pgvector parity fixture split is unclear | Comment added explaining `embedding1536Type` vs `embedding1536Column` split |
| F25 | Self-referential and circular model relations untested | Tests added: self-referential Category (parent/children) and circular Employee ↔ Department |
| F26 | No ORM client coverage in the no-emit path | `users-with-posts` command added to `main-no-emit.ts` exercising ORM via `createOrmClient` + `include` |

---

## Acceptance-Criteria Traceability

| # | Acceptance Criterion | Implementation | Evidence |
|---|---------------------|----------------|----------|
| 1 | Author can define model with fields/relations, attach `.sql()`, emit valid contract | `model()` + `field.*` + `rel.*` + `.sql()` in [staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts); `defineContract()` routes through `buildStagedContract` in [contract-builder.ts](packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts) lines 1077–1083 | [contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — `'lowers inline ids and uniques while keeping sql focused on table/index/fk concerns'` |
| 2 | Common scalar fields no longer require duplicate field-to-column declarations | `field.column(textColumn)` auto-derives column name from field key via `applyNaming` in [staged-contract-lowering.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-lowering.ts) lines 640–651 | [contract-builder.staged-contract-dsl.parity.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.parity.test.ts) — naming strategy tests |
| 3 | Table/column naming from root-level strategy with overrides | `naming: { tables: 'snake_case', columns: 'snake_case' }` in `StagedContractInput`, per-field `.column('override')` in [staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) lines 245–272 | [contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — inline id/unique test uses `column('user_id')` override; [staged-contract-dsl.runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-dsl.runtime.test.ts) — `describe('applyNaming')` with comprehensive edge cases |
| 4 | `cols` in `.sql()` exposes only column-backed scalar fields | `SqlContext<Fields>` type restricts `cols` to `FieldRefs<Fields>` (scalar field builders only) in [staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) lines 862–865 | [contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — `.sql(({ cols, constraints }) => ...)` usage proves `cols` only contains scalar fields; type-level verification in integration type tests |
| 5 | Named PKs, uniques, indexes, FKs including composite | `constraints.id()`, `constraints.unique()`, `constraints.index()`, `constraints.foreignKey()` in [staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) lines 709–838; composite overloads accept arrays | [contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — inline ids with names, compound attribute ids; [contract-builder.staged-contract-dsl.parity.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.parity.test.ts) — named indexes and FKs |
| 6 | Literal defaults, SQL defaults, generated defaults, named storage types | `field.column(...).default(value)`, `.defaultSql('now()')`, `field.generated(...)`, `field.namedType(...)` in [staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) lines 274–426 | [staged-contract-dsl.runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-dsl.runtime.test.ts) lines 29–44 — literal, function, generated defaults; [staged-contract-lowering.runtime.test.ts](packages/2-sql/2-authoring/contract-ts/test/staged-contract-lowering.runtime.test.ts) lines 29–67 — named type resolution |
| 7 | Explicit reverse/query-surface relations with singular owning-side FK | `rel.belongsTo()` owns FK, `rel.hasMany()`/`rel.hasOne()` are reverse-side in [staged-contract-dsl.ts](packages/2-sql/2-authoring/contract-ts/src/staged-contract-dsl.ts) lines 1304–1427; FK only generated from `belongsTo` `.sql({ fk })`. Self-referential and circular relations tested. | [contract-builder.staged-contract-dsl.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.test.ts) — ownership relation tests, self-referential Category, circular Employee ↔ Department |
| 8 | Postgres→SQLite portability within ~10% changes | Target-specific code isolated to import and `.sql()` blocks | [contract-builder.staged-contract-dsl.portability.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.staged-contract-dsl.portability.test.ts) — explicit portability test comparing Postgres and SQLite contracts |
| 9 | Downstream `schema()`/`sql()`/`orm()` inference works from no-emit | `SqlContractResult<Definition>` computes full contract type from definition generic in [contract-builder.ts](packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts) lines 662–687 | Integration type tests (`contract-builder.types.test-d.ts`); `expectTypeOf` assertions in staged DSL tests. No-emit demo uses dot access (`sql.post`), `typeof contract`, and `createOrmClient` with `include` patterns |
| 10 | Lowering pipeline can derive model/client helper types | `SqlSemanticContractDefinition` captures all model/field/relation data needed for type derivation in [semantic-contract.ts](packages/2-sql/2-authoring/contract-ts/src/semantic-contract.ts) | Structural coverage via [contract-builder.semantic-contract.test.ts](packages/2-sql/2-authoring/contract-ts/test/contract-builder.semantic-contract.test.ts); type inference proven in staged DSL type tests |

---

## Summary of Findings

| ID | Severity | Status | Title |
|----|----------|--------|-------|
| F15 | Non-blocking | Deferred | Contract representations converging (deferred to contract-domain-extraction M5) |
| F01 | ~~Blocking~~ | **Resolved** | Demo contract uses typed `namedType` refs |
| F02 | ~~Blocking~~ | **Resolved** | `any` type aliases replaced with safe wide types |
| F03 | ~~Non-blocking~~ | **Resolved** | `contract-builder.ts` reduced to 782 lines (from 1,890) |
| F04 | ~~Non-blocking~~ | **Resolved** | `SemanticContractBuilder` no longer exists |
| F05 | ~~Non-blocking~~ | **Resolved** | `FieldBuilderFromPresetDescriptor` types deduplicated |
| F06 | ~~Non-blocking~~ | **Resolved** | `as unknown as` casts have justification comments |
| F07 | ~~Non-blocking~~ | **Resolved** | `applyNaming` has dedicated edge-case tests |
| F08 | ~~Non-blocking~~ | **Resolved** | PSL interpreter semantic mapping extracted into helper functions |
| F09 | ~~Non-blocking~~ | **Resolved** | ADR 181 documents the staged DSL design decision |
| F10 | ~~Non-blocking~~ | **Resolved** | `buildFieldPreset` logic deduplicated |
| F11 | ~~Nit~~ | **Resolved** | `Defined<T>` alias removed |
| F12 | ~~Nit~~ | **Resolved** | `typecheckOnly` now used |
| F13 | ~~Blocking~~ | **Resolved** | Presets live in `9-family`; bare `field` export is structural-only |
| F14 | ~~Non-blocking~~ | **Resolved** | Renamed to `SqlContractResult`; `isStagedContractInput` internal |
| F16 | ~~Blocking~~ | **Resolved** | No-emit flow uses dot access and `typeof contract` |
| F17 | ~~Non-blocking~~ | **Resolved** | Emitter sorts entries deterministically |
| F18 | ~~Non-blocking~~ | **Resolved** | ORM wired in no-emit path; N+1 pattern replaced |
| F19 | ~~Non-blocking~~ | **Resolved** | `AuthoringContributions` extracted to `framework-authoring.ts` |
| F20 | ~~Non-blocking~~ | **Resolved** | JSDoc restored on framework component interfaces |
| F21 | ~~Non-blocking~~ | **Resolved** | Timeouts at standard values (default: 100ms, TS compilation: 8s) |
| F22 | ~~Nit~~ | **Resolved** | `collect()` helper removed |
| F23 | ~~Nit~~ | **Resolved** | `ifDefined()` utility used |
| F24 | ~~Nit~~ | **Resolved** | pgvector fixture split documented |
| F25 | ~~Non-blocking~~ | **Resolved** | Self-referential and circular relation tests added |
| F26 | ~~Non-blocking~~ | **Resolved** | ORM command wired in no-emit CLI |
